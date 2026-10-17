import { activePoll } from '@towncore/pipeline';
import { PollWidget } from '@/components/poll/PollWidget';
import styles from '@/components/poll/poll.module.css';
import { db } from '@/lib/db';
import type { HomeModuleComponent } from './types';

/**
 * `quick-poll` (§11a-2; owner, 2026-10-17): the town's running poll, an opinion question about a
 * local topic that staff wrote and approved. Readers vote once and then see the results. Hidden
 * when no approved poll is running.
 */
export const QuickPoll: HomeModuleComponent = async ({ town }) => {
  const poll = await activePoll(db(), town.id);
  if (!poll) return null;
  return (
    <section
      className={styles.poll}
      id="quick-poll"
      aria-labelledby="quick-poll-h"
      data-module="quick-poll"
    >
      <span className="meta">Quick poll</span>
      <h2 id="quick-poll-h" className={styles.question}>
        {poll.question}
      </h2>
      <PollWidget poll={{ id: poll.id, question: poll.question, options: poll.options }} />
    </section>
  );
};
