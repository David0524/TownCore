'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { PollResults, type PollTally, type PollView } from './PollResults';
import styles from './poll.module.css';

const storageKey = (id: string) => `tc-poll:${id}`;

function remembered(id: string): number | null {
  try {
    const v = window.localStorage.getItem(storageKey(id));
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

/**
 * The quick-poll form. Without JavaScript it posts to /poll/vote and lands on the results page;
 * with it, the vote is sent in place and the browser remembers it, so a reader who comes back
 * sees the results instead of the question. The server keeps one vote per address per poll.
 */
export function PollWidget({ poll }: { poll: PollView }) {
  const [tally, setTally] = useState<PollTally | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const previous = remembered(poll.id);
    if (previous === null) return;
    setChosen(previous);
    fetch(`/poll/${poll.id}/results`)
      .then((r) => (r.ok ? (r.json() as Promise<PollTally>) : null))
      .then((t) => t && setTally(t))
      .catch(() => {});
  }, [poll.id]);

  async function vote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('option') === null) {
      setError('Pick an answer.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/poll/vote', {
        method: 'POST',
        body: form,
        headers: { Accept: 'application/json' },
      });
      const body = (await response.json()) as { outcome?: string } & Partial<PollTally>;
      if (!response.ok || !body.counts) throw new Error(body.outcome ?? 'error');
      const option = Number(form.get('option'));
      try {
        window.localStorage.setItem(storageKey(poll.id), String(option));
      } catch {
        // Private windows: the server still counts one vote per address.
      }
      setChosen(option);
      setTally({ counts: body.counts, total: body.total ?? 0 });
    } catch {
      setError('Your vote didn’t go through. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  if (tally) return <PollResults poll={poll} tally={tally} chosen={chosen} />;
  return (
    <form method="post" action="/poll/vote" onSubmit={vote} className={styles.form}>
      <input type="hidden" name="poll" value={poll.id} />
      <fieldset className={styles.options}>
        <legend className="sr-only">{poll.question}</legend>
        {poll.options.map((option, i) => (
          <label key={i} className={styles.option}>
            <input type="radio" name="option" value={i} required />
            <span>{option}</span>
          </label>
        ))}
      </fieldset>
      <div className={styles.trap} aria-hidden="true">
        <label>
          Leave this empty
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className={styles.vote} disabled={busy}>
        Vote
      </button>
    </form>
  );
}
