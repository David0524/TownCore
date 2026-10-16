// Sports (docs/plans/sports.md): team schedules and results as `game` records. The shape every
// sports adapter writes into a record's `raw`, and the Sports page reads back. Team level only:
// never a player's name, so nothing here can name a minor (§7, Tier 4).

export type GameStatus = 'scheduled' | 'final' | 'postponed' | 'cancelled';

export type Game = {
  /** "Football", "Girls Volleyball". */
  sport: string;
  /** "Varsity", "JV", "Pro", "College". */
  level: string | null;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  status: GameStatus;
  venue: string | null;
  /** Which of the two teams belong to this town (names as the town's config lists them). */
  local: string[];
  /** A playoff round, a tournament or a district game, when the source says so. */
  note: string | null;
};

export const GAME_RECORD = 'game';

/** A game's line for lists: "Boca Raton 21, Spanish River 14" or "Boca Raton vs. Spanish River". */
export function gameLine(g: Pick<Game, 'home' | 'away' | 'homeScore' | 'awayScore' | 'status'>) {
  if (g.status === 'final' && g.homeScore !== null && g.awayScore !== null) {
    const [winner, wScore, loser, lScore] =
      g.homeScore >= g.awayScore
        ? [g.home, g.homeScore, g.away, g.awayScore]
        : [g.away, g.awayScore, g.home, g.homeScore];
    return `${winner} ${wScore}, ${loser} ${lScore}`;
  }
  return `${g.away} at ${g.home}`;
}
