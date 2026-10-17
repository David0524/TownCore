import {
  GAME_RECORD,
  gameLine,
  READER_SCORE_NOTE,
  SCORE_LEVELS,
  TEAM_SPORTS,
  type Game,
} from '@towncore/config';
import {
  and,
  desc,
  eq,
  gte,
  logAdminAction,
  or,
  records,
  scoreReports,
  sources,
  sql,
  towns,
  type Db,
} from '@towncore/db';

// Scores readers send (owner, 2026-10-17: "use reader scores meanwhile", while an FHSAA data
// license is asked for; FHSAA's terms bar reusing its schedules). Team level only: the form has
// structured fields and no free text, so no player is named (§7). Nothing shows until staff
// approve it; approval writes a `game` record on the town's "reader scores" source, which the
// Sports tab shows with a note that a reader sent it. Every decision is audited.

/** Most score reports from one address or email an hour. */
export const SCORES_PER_HOUR = 5;
/** A score must be for a game in the last this many days (and not in the future). */
export const SCORE_MAX_AGE_DAYS = 14;

export type ScoreReport = typeof scoreReports.$inferSelect;
export class ScoreRejected extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v: string | undefined | null, max: number) =>
  (v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const score = (v: string) => (/^\d{1,3}$/.test(v.trim()) ? Number(v.trim()) : null);

export async function submitScore(
  db: Db,
  input: {
    townId: string;
    sport: string;
    level: string;
    home: string;
    away: string;
    homeScore: string;
    awayScore: string;
    /** YYYY-MM-DD. */
    playedOn: string;
    venue?: string;
    localSide: string;
    name: string;
    email: string;
    ip?: string | null;
    now?: Date;
  },
): Promise<ScoreReport> {
  const now = input.now ?? new Date();
  const sport = TEAM_SPORTS.find((s) => s === input.sport);
  const level = SCORE_LEVELS.find((l) => l === input.level);
  if (!sport || !level) throw new ScoreRejected('sport');
  const home = clean(input.home, 60);
  const away = clean(input.away, 60);
  if (!home || !away || home.toLowerCase() === away.toLowerCase()) throw new ScoreRejected('teams');
  const homeScore = score(input.homeScore);
  const awayScore = score(input.awayScore);
  if (homeScore === null || awayScore === null) throw new ScoreRejected('score');
  const played = /^\d{4}-\d{2}-\d{2}$/.test(input.playedOn)
    ? new Date(`${input.playedOn}T12:00:00Z`)
    : null;
  if (
    !played ||
    played.getTime() > now.getTime() + 86_400_000 ||
    played.getTime() < now.getTime() - SCORE_MAX_AGE_DAYS * 86_400_000
  )
    throw new ScoreRejected('date');
  const localSide = (['home', 'away', 'both'] as const).find((s) => s === input.localSide);
  if (!localSide) throw new ScoreRejected('local');
  const name = clean(input.name, 120);
  const email = clean(input.email, 254).toLowerCase();
  if (!name || !EMAIL.test(email)) throw new ScoreRejected('contact');

  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(scoreReports)
    .where(
      and(
        gte(scoreReports.createdAt, new Date(now.getTime() - 3_600_000)),
        or(
          eq(scoreReports.reporterEmail, email),
          input.ip ? eq(scoreReports.consentIp, input.ip) : sql`false`,
        ),
      ),
    );
  if ((recent?.n ?? 0) >= SCORES_PER_HOUR) throw new ScoreRejected('rate');

  const [row] = await db
    .insert(scoreReports)
    .values({
      townId: input.townId,
      sport,
      level,
      home,
      away,
      homeScore,
      awayScore,
      playedOn: input.playedOn,
      venue: clean(input.venue, 100) || null,
      localSide,
      reporterName: name,
      reporterEmail: email,
      consentIp: input.ip ?? null,
      createdAt: now,
    })
    .returning();
  return row!;
}

/** Score reports waiting for a staff decision, oldest first, with their town. */
export async function pendingScores(db: Db) {
  return db
    .select({ report: scoreReports, siteName: towns.siteName })
    .from(scoreReports)
    .innerJoin(towns, eq(towns.id, scoreReports.townId))
    .where(eq(scoreReports.status, 'pending'))
    .orderBy(scoreReports.createdAt);
}

/** Recently decided reports, newest first (for the admin page). */
export async function decidedScores(db: Db, limit = 20) {
  return db
    .select({ report: scoreReports, siteName: towns.siteName })
    .from(scoreReports)
    .innerJoin(towns, eq(towns.id, scoreReports.townId))
    .where(sql`${scoreReports.status} <> 'pending'`)
    .orderBy(desc(scoreReports.reviewedAt))
    .limit(limit);
}

/** The town's source that approved reader scores are recorded on, made on first use. */
async function readerSource(db: Db, townId: string): Promise<string> {
  const key = 'reader-scores';
  const [found] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.townId, townId), eq(sources.key, key)));
  if (found) return found.id;
  const [made] = await db
    .insert(sources)
    .values({ townId, key, kind: 'sports', platform: 'reader', adapter: 'reader', config: {} })
    .onConflictDoNothing()
    .returning({ id: sources.id });
  if (made) return made.id;
  const [again] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.townId, townId), eq(sources.key, key)));
  return again!.id;
}

export class ScoreDecisionError extends Error {}

/**
 * Approves a report (writing its `game` record) or rejects it. Staff check that the teams are
 * real teams and that nothing names a player; a reviewer may correct a team name's spelling.
 */
export async function decideScore(
  db: Db,
  input: {
    reportId: string;
    staffId: string;
    approve: boolean;
    reason?: string;
    home?: string;
    away?: string;
    now?: Date;
  },
): Promise<ScoreReport> {
  const now = input.now ?? new Date();
  const [report] = await db.select().from(scoreReports).where(eq(scoreReports.id, input.reportId));
  if (!report) throw new ScoreDecisionError('That score report no longer exists.');
  if (report.status !== 'pending') throw new ScoreDecisionError('That score was already decided.');
  if (!input.approve) {
    const [rejected] = await db
      .update(scoreReports)
      .set({
        status: 'rejected',
        reviewedBy: input.staffId,
        reviewedAt: now,
        rejectReason: clean(input.reason, 200) || null,
      })
      .where(and(eq(scoreReports.id, report.id), eq(scoreReports.status, 'pending')))
      .returning();
    await logAdminAction(db, {
      staffId: input.staffId,
      action: 'score.reject',
      target: { type: 'score_report', id: report.id },
      detail: { reason: rejected?.rejectReason ?? null },
    });
    return rejected!;
  }
  const home = clean(input.home, 60) || report.home;
  const away = clean(input.away, 60) || report.away;
  const local =
    report.localSide === 'both' ? [home, away] : [report.localSide === 'home' ? home : away];
  const game: Game = {
    sport: report.sport,
    level: report.level,
    home,
    away,
    homeScore: report.homeScore,
    awayScore: report.awayScore,
    status: 'final',
    venue: report.venue,
    local,
    note: READER_SCORE_NOTE,
  };
  const sourceId = await readerSource(db, report.townId);
  const [record] = await db
    .insert(records)
    .values({
      sourceId,
      townId: report.townId,
      externalId: `score:${report.id}`,
      type: GAME_RECORD,
      title: gameLine(game),
      text: `${report.level} ${report.sport}: ${gameLine(game)}. ${READER_SCORE_NOTE}, checked by our staff.`,
      url: null,
      occurredAt: new Date(`${report.playedOn}T12:00:00Z`),
      raw: game,
      contentHash: `score:${report.id}`,
    })
    .returning({ id: records.id });
  const [approved] = await db
    .update(scoreReports)
    .set({
      status: 'approved',
      home,
      away,
      reviewedBy: input.staffId,
      reviewedAt: now,
      recordId: record!.id,
    })
    .where(and(eq(scoreReports.id, report.id), eq(scoreReports.status, 'pending')))
    .returning();
  await logAdminAction(db, {
    staffId: input.staffId,
    action: 'score.approve',
    target: { type: 'score_report', id: report.id },
    detail: { recordId: record!.id, game: gameLine(game) },
  });
  return approved!;
}
