import { captionMeetings } from '@towncore/pipeline';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import styles from '../admin.module.css';
import { Pill } from '../Pill';
import { uploadCaptions } from './actions';

export const metadata = { title: 'Meetings' };

type Props = { searchParams: Promise<{ done?: string; error?: string }> };

const when = (d: Date | null, timeZone: string) =>
  d
    ? d.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone,
      })
    : '–';

// Past meetings and their transcripts. Staff may add a caption file for a meeting with none: the
// captions the town publishes with its own video, or the meeting recording's own export (Zoom,
// Teams). Never captions copied from a video site, and no paid transcription (D-M2-4).
export default async function MeetingsPage({ searchParams }: Props) {
  await requireStaff();
  const { done, error } = await searchParams;
  const meetings = await captionMeetings(db());
  return (
    <main>
      <h1>Meetings</h1>
      {done ? (
        <p className={styles.notice} role="status">
          Captions added: {done}.
        </p>
      ) : null}
      {error ? (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      ) : null}
      <p className={styles.muted}>
        Meetings in the past 45 days. A transcript adds detail to a meeting&apos;s recap; the
        minutes or recorded actions stay the source, and any story that cites a transcript waits for
        an editor, since captions can misspell names. Upload a .vtt, .srt or .txt file only when the
        town published it or it&apos;s the meeting recording&apos;s own export; never captions
        copied from a video site.
      </p>
      {meetings.length === 0 ? <p>No meetings in the past 45 days.</p> : null}
      {meetings.length ? (
        <table className={styles.table} data-testid="meetings">
          <thead>
            <tr>
              <th>Meeting</th>
              <th>Site</th>
              <th>Results</th>
              <th>Transcript</th>
            </tr>
          </thead>
          <tbody>
            {meetings.map((m) => (
              <tr key={m.id} data-testid="meeting-row">
                <td>
                  {m.url ? (
                    <a href={m.url} target="_blank" rel="noopener noreferrer">
                      {m.title ?? 'Meeting'}
                    </a>
                  ) : (
                    (m.title ?? 'Meeting')
                  )}
                  <br />
                  <span className={styles.muted}>{when(m.occurredAt, m.timezone)}</span>
                </td>
                <td>{m.siteName}</td>
                <td>
                  <Pill tone={m.hasResults ? 'green' : 'gray'}>
                    {m.hasResults ? 'minutes in' : 'none yet'}
                  </Pill>
                </td>
                <td>
                  {m.transcript ? (
                    <Pill tone="green">{m.transcript.uploaded ? 'uploaded' : 'from platform'}</Pill>
                  ) : (
                    <form action={uploadCaptions} className={styles.form}>
                      <input type="hidden" name="meeting" value={m.id} />
                      <label htmlFor={`captions-${m.id}`}>Caption file (.vtt, .srt or .txt)</label>
                      <input
                        id={`captions-${m.id}`}
                        name="captions"
                        type="file"
                        required
                        accept=".vtt,.srt,.txt,text/vtt,text/plain,application/x-subrip"
                      />
                      <label>
                        <input type="checkbox" name="allowed" value="yes" required /> The town
                        published these captions, or they&apos;re the recording&apos;s own export
                      </label>
                      <div className={styles.actions}>
                        <button type="submit" className={`${styles.button} ${styles.secondary}`}>
                          Add captions
                        </button>
                      </div>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}
