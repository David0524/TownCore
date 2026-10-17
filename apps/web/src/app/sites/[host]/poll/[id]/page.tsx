import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq, polls } from '@towncore/db';
import { pollResults } from '@towncore/pipeline';
import { PollResults } from '@/components/poll/PollResults';
import styles from '@/components/poll/poll.module.css';
import { db } from '@/lib/db';
import { THIN_PAGE } from '@/lib/indexing';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';

export const metadata: Metadata = { title: 'Quick poll', robots: THIN_PAGE };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where the quick-poll form lands without JavaScript: thanks, and the results so far. */
export default async function PollPage({
  params,
}: {
  params: Promise<{ host: string; id: string }>;
}) {
  const town = await requireTown(params);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [poll] = await db().select().from(polls).where(eq(polls.id, id));
  if (!poll || poll.townId !== town.id || poll.status !== 'approved') notFound();
  const { counts, total } = await pollResults(db(), poll);
  const now = new Date();
  const open = poll.startsAt <= now && poll.endsAt > now;
  return (
    <StandardPage town={town} shortOnPhones>
      <span className="meta">Quick poll</span>
      <h1 className={styles.question}>{poll.question}</h1>
      <p>{open ? 'Thanks for voting. Here are the results so far.' : 'This poll has closed.'}</p>
      <PollResults
        poll={{ id: poll.id, question: poll.question, options: poll.options }}
        tally={{ counts, total }}
      />
      <p>
        <Link href="/">Back to the front page</Link>
      </p>
    </StandardPage>
  );
}
