import {
  creativeSchema,
  defaultTheme,
  themeSchema,
  townContactEmail,
  tropicsBasin,
  tropicsLine,
  type Palette,
  type TownConfig,
} from '@towncore/config';
import {
  activePinIds,
  and,
  articles,
  asc,
  corrections,
  desc,
  engagementByArticle,
  eq,
  getActiveCampaign,
  getTropics,
  gt,
  gte,
  isNotNull,
  listRankableArticles,
  lt,
  newsletterIssues,
  records,
  type Db,
  type Town,
} from '@towncore/db';
import { rankArticles } from '@towncore/pipeline';
import { selectIssueItems } from './select';
import { issueWeather, type IssueWeather } from './weather';

/** The Hurricane Center's line for the town's basin, when a storm is active or likely. */
async function issueTropics(db: Db, town: Town, now: Date) {
  const basin = tropicsBasin(town.state);
  const snapshot = basin ? (await getTropics(db, basin, now))?.snapshot : null;
  const line = snapshot ? tropicsLine(snapshot) : null;
  return line ? { line, url: `https://${town.domain}/weather#tropics` } : null;
}

// Everything one issue needs, read from the database (docs/plans/M5.md "What an issue
// contains"). Rendering is separate and pure.

export type SlotFill = {
  paid: boolean;
  /** "Sponsored · Advertiser" for paid units (Rule 6), "From {Site Name}" for house ads. */
  label: string;
  headline: string;
  body?: string | undefined;
  href: string;
  cta?: string | undefined;
};

export type IssueContent = {
  town: Pick<Town, 'id' | 'slug' | 'name' | 'siteName' | 'domain' | 'timezone'>;
  palette: Palette;
  /** The issue's date in the town's timezone (YYYY-MM-DD). */
  date: string;
  since: Date;
  items: { id: string; slug: string; headline: string; dek: string | null; beat: string }[];
  weather: IssueWeather | null;
  meetings: { title: string; url: string | null; startsAt: Date }[];
  corrections: { headline: string; slug: string; note: string }[];
  /** D-M5-4: at most one paid unit; top only when sold, mid falls back to a house ad. */
  top: SlotFill | null;
  mid: SlotFill;
};

export function localDate(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
}

function paletteFor(town: Pick<Town, 'theme'>): Palette {
  const parsed = themeSchema.safeParse(town.theme);
  return (parsed.success ? parsed.data : defaultTheme).palette;
}

async function paidFill(db: Db, townId: string, slot: string, now: Date): Promise<SlotFill | null> {
  const campaign = await getActiveCampaign(db, townId, slot, now);
  const creative = creativeSchema.safeParse(campaign?.creative);
  if (!campaign || !creative.success) return null;
  return {
    paid: true,
    label: `Sponsored · ${creative.data.advertiser}`,
    headline: creative.data.headline,
    body: creative.data.body,
    href: creative.data.href,
    cta: creative.data.cta,
  };
}

/** The mid slot's house ads alternate by day: share the newsletter, or advertise with us. */
export function newsletterHouseAd(
  town: Pick<Town, 'name' | 'siteName' | 'domain' | 'config'>,
  date: string,
): SlotFill {
  const contact = townContactEmail(town.config as TownConfig);
  const even = Number(date.slice(-2)) % 2 === 0;
  return even
    ? {
        paid: false,
        label: `From ${town.siteName}`,
        headline: 'Know a neighbor who’d like this?',
        body: `Forward this email. Anyone can sign up free at ${town.domain}/newsletter.`,
        href: `https://${town.domain}/newsletter`,
        cta: 'Sign up',
      }
    : {
        paid: false,
        label: `From ${town.siteName}`,
        headline: `Advertise in ${town.siteName}`,
        body: `Reach ${town.name} readers every morning with a newsletter sponsorship.`,
        href: `mailto:${contact}?subject=${encodeURIComponent(`Advertising in ${town.siteName}`)}`,
        cta: 'Get in touch',
      };
}

/** When the previous issue went out, so this one covers only what's new (24 hours at first). */
export async function previousIssueAt(
  db: Db,
  townId: string,
  before: string,
  now: Date,
): Promise<Date> {
  const [last] = await db
    .select({ sentAt: newsletterIssues.sentAt })
    .from(newsletterIssues)
    // Only issues that went out: a skipped day leaves its stories for the next issue.
    .where(
      and(
        eq(newsletterIssues.townId, townId),
        lt(newsletterIssues.date, before),
        isNotNull(newsletterIssues.sentAt),
      ),
    )
    .orderBy(desc(newsletterIssues.date))
    .limit(1);
  return last?.sentAt ?? new Date(now.getTime() - 24 * 3_600_000);
}

export async function gatherIssue(db: Db, town: Town, now = new Date()): Promise<IssueContent> {
  const date = localDate(now, town.timezone);
  const since = await previousIssueAt(db, town.id, date, now);
  const [ranked, pinned, engagement] = await Promise.all([
    listRankableArticles(db, town.id, { limit: 120 }),
    activePinIds(db, town.id, now),
    engagementByArticle(db, town.id),
  ]);
  const items = selectIssueItems(rankArticles(ranked, { now, pinned, engagement }), since);

  const [forecast] = await db
    .select()
    .from(records)
    .where(and(eq(records.townId, town.id), eq(records.type, 'forecast')))
    .orderBy(desc(records.occurredAt))
    .limit(1);
  const alerts = await db
    .select()
    .from(records)
    .where(
      and(
        eq(records.townId, town.id),
        eq(records.type, 'alert'),
        gt(records.occurredAt, new Date(now.getTime() - 48 * 3_600_000)),
      ),
    );
  const meetings = await db
    .select({ title: records.title, url: records.url, startsAt: records.occurredAt })
    .from(records)
    .where(
      and(
        eq(records.townId, town.id),
        eq(records.type, 'meeting'),
        gte(records.occurredAt, now),
        lt(records.occurredAt, new Date(now.getTime() + 7 * 86_400_000)),
      ),
    )
    .orderBy(asc(records.occurredAt))
    .limit(6);
  const fixes = await db
    .select({ headline: articles.headline, slug: articles.slug, note: corrections.note })
    .from(corrections)
    .innerJoin(articles, eq(articles.id, corrections.articleId))
    .where(and(eq(articles.townId, town.id), gt(corrections.createdAt, since)))
    .orderBy(asc(corrections.createdAt));

  const top = await paidFill(db, town.id, 'newsletter.top', now);
  const mid =
    (!top && (await paidFill(db, town.id, 'newsletter.mid', now))) || newsletterHouseAd(town, date);

  return {
    town,
    palette: paletteFor(town),
    date,
    since,
    items: items.map((a) => ({
      id: a.id,
      slug: a.slug,
      headline: a.headline,
      dek: a.dek,
      beat: a.beat,
    })),
    weather: issueWeather(forecast ?? null, alerts, now, await issueTropics(db, town, now)),
    meetings: meetings.flatMap((m) =>
      m.startsAt ? [{ title: m.title ?? 'Public meeting', url: m.url, startsAt: m.startsAt }] : [],
    ),
    corrections: fixes,
    top,
    mid,
  };
}
