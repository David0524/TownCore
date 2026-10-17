import { SCORE_LEVELS, TEAM_SPORTS } from '@towncore/config';
import type { Town } from '@towncore/db';
import formStyles from '@/components/NewsletterForm.module.css';
import styles from './score-form.module.css';

/** What the score form says after a send, by the `s` query value. */
export const SCORE_MESSAGES: Record<string, { tone: 'ok' | 'error'; text: string }> = {
  thanks: { tone: 'ok', text: 'Thanks! An editor checks every score before it appears.' },
  sport: { tone: 'error', text: 'Pick the sport and level from the lists.' },
  teams: { tone: 'error', text: 'Enter both teams, and two different ones.' },
  score: { tone: 'error', text: 'Enter each final score as a number.' },
  date: { tone: 'error', text: 'The game must be from the last two weeks.' },
  local: { tone: 'error', text: 'Say which team is from here.' },
  contact: { tone: 'error', text: 'Enter your name and a working email.' },
  rate: { tone: 'error', text: 'That’s a lot of scores at once. Try again in an hour.' },
  origin: { tone: 'error', text: 'Please send the form from this page.' },
  empty: { tone: 'error', text: 'The form came through empty. Please try again.' },
  error: { tone: 'error', text: 'Something went wrong. Please try again.' },
};

/**
 * Readers send a final score (owner, 2026-10-17): structured fields only, with no free text where
 * a player could be named (team level only, §7). An editor approves each one before it shows.
 */
export function ScoreForm({ town, message }: { town: Pick<Town, 'name'>; message?: string }) {
  const note = message ? SCORE_MESSAGES[message] : undefined;
  return (
    <section aria-labelledby="send-score" data-testid="score-form-section">
      <h2 id="send-score">Send us a score</h2>
      {note ? (
        <p
          className={formStyles.notice}
          role={note.tone === 'error' ? 'alert' : 'status'}
          data-testid="score-message"
        >
          {note.text}
        </p>
      ) : null}
      <p className="muted">
        Saw a {town.name} team play? Send the final score. Teams only, never players: an editor
        checks every score before it appears, marked as sent by a reader.
      </p>
      <form method="post" action="/sports/send" className={styles.form} data-testid="score-form">
        <div className={styles.pair}>
          <div>
            <label htmlFor="score-sport">Sport</label>
            <select id="score-sport" name="sport" required defaultValue="">
              <option value="" disabled>
                Choose
              </option>
              {TEAM_SPORTS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="score-level">Level</label>
            <select id="score-level" name="level" required defaultValue="Varsity">
              {SCORE_LEVELS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
        </div>
        <div className={styles.pair}>
          <div>
            <label htmlFor="score-home">Home team</label>
            <input id="score-home" name="home" required maxLength={60} />
          </div>
          <div>
            <label htmlFor="score-home-score">Home score</label>
            <input
              id="score-home-score"
              name="homeScore"
              required
              inputMode="numeric"
              pattern="[0-9]{1,3}"
            />
          </div>
        </div>
        <div className={styles.pair}>
          <div>
            <label htmlFor="score-away">Visiting team</label>
            <input id="score-away" name="away" required maxLength={60} />
          </div>
          <div>
            <label htmlFor="score-away-score">Visiting score</label>
            <input
              id="score-away-score"
              name="awayScore"
              required
              inputMode="numeric"
              pattern="[0-9]{1,3}"
            />
          </div>
        </div>
        <div className={styles.pair}>
          <div>
            <label htmlFor="score-date">Date played</label>
            <input id="score-date" name="playedOn" type="date" required />
          </div>
          <div>
            <label htmlFor="score-local">Which team is from {town.name}?</label>
            <select id="score-local" name="localSide" required defaultValue="home">
              <option value="home">The home team</option>
              <option value="away">The visiting team</option>
              <option value="both">Both</option>
            </select>
          </div>
        </div>
        <label htmlFor="score-venue">Where (optional)</label>
        <input id="score-venue" name="venue" maxLength={100} placeholder="Field or gym" />
        <div className={styles.pair}>
          <div>
            <label htmlFor="score-name">Your name</label>
            <input id="score-name" name="name" required maxLength={120} autoComplete="name" />
          </div>
          <div>
            <label htmlFor="score-email">Your email (never shown)</label>
            <input
              id="score-email"
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
            />
          </div>
        </div>
        <div className={formStyles.trap} aria-hidden="true">
          <label htmlFor="score-website">Website</label>
          <input id="score-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>
        <button type="submit" className={styles.submit}>
          Send score
        </button>
        <p className={formStyles.fine}>
          We use your email only to ask about the score if something looks off.{' '}
          <a href="/privacy">Privacy</a>
        </p>
      </form>
    </section>
  );
}
