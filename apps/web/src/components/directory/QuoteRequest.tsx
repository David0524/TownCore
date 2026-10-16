import type { DirectoryCategory } from '@towncore/config';
import type { Town } from '@towncore/db';
import { quoteRecipients } from '@towncore/directory';
import { db } from '@/lib/db';
import { directoryMailDeps } from '@/lib/owner';
import { Slot } from '@/slots/Slot';
import slotStyles from '@/slots/Slot.module.css';
import styles from '@/app/sites/[host]/directory/directory.module.css';

const MESSAGES: Record<string, string> = {
  sent: 'Sent. The businesses will reply to you by email.',
  invalid: 'Please fill in your name, email and what you need, and tick the box.',
  rate_limited: 'Too many requests for now. Please try again later.',
  unavailable: 'Quote requests aren’t open on this site yet.',
  no_recipients: 'No business is taking quote requests in this category right now.',
};

/**
 * `directory.quote-request` (CLAUDE.md §11b): one form that goes to up to 3 sponsored businesses
 * in the category (D-M6-9), labeled as sponsored and naming who gets it. With no sponsors, the
 * slot shows its usual fill (a house ad for businesses).
 */
export async function QuoteRequest({
  town,
  category,
  status,
  houseOffOnPhones,
}: {
  town: Town;
  category: DirectoryCategory;
  status?: string;
  /** On a short list, the house ad (no sponsors yet) is left out on phones. */
  houseOffOnPhones?: boolean;
}) {
  const recipients = directoryMailDeps() ? await quoteRecipients(db(), town.id, category.slug) : [];
  if (recipients.length === 0)
    return (
      <Slot
        town={town}
        name="directory.quote-request"
        context={{ category }}
        houseOffOnPhones={houseOffOnPhones}
      />
    );
  const names = recipients.map((r) => r.name).join(', ');
  return (
    <section
      id="quote"
      className={styles.quote}
      data-slot="directory.quote-request"
      data-fill="placement"
      aria-labelledby="quote-h"
    >
      <span className={slotStyles.label} data-testid="slot-label">
        Sponsored · Quotes go to {names}
      </span>
      <div className={`${styles.quoteBody} ${slotStyles.paid}`}>
        <h2 id="quote-h">Get quotes from {category.name.toLowerCase()}</h2>
        {status && MESSAGES[status] ? (
          <p role={status === 'sent' ? 'status' : 'alert'} data-testid="quote-message">
            {MESSAGES[status]}
          </p>
        ) : null}
        <form method="post" action={`/quote/${category.slug}`} className={styles.claim}>
          <label>
            Your name
            <input name="name" required maxLength={100} autoComplete="name" />
          </label>
          <label>
            Email
            <input name="email" type="email" required maxLength={254} autoComplete="email" />
          </label>
          <label>
            Phone (optional)
            <input name="phone" type="tel" maxLength={40} autoComplete="tel" />
          </label>
          <label>
            What do you need?
            <textarea name="message" required rows={3} maxLength={1000} />
          </label>
          <label className={styles.check}>
            <input type="checkbox" name="consent" value="yes" required /> Send my request, name and
            contact details to {names}. They pay to receive quote requests here.
          </label>
          <div className="sr-only" aria-hidden="true">
            <label>
              Leave this empty
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <button type="submit" className="button">
            Send my request
          </button>
        </form>
      </div>
    </section>
  );
}
