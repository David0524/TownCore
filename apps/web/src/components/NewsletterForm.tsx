import styles from './NewsletterForm.module.css';

/**
 * The signup form (Mail-5): a plain HTML form, so it works without JavaScript. The "website"
 * field is a honeypot: hidden from people, often filled in by bots.
 */
export function NewsletterForm({ source, id = 'newsletter' }: { source: string; id?: string }) {
  return (
    <form
      method="post"
      action="/newsletter/subscribe"
      className={styles.form}
      data-testid="newsletter-form"
    >
      <label htmlFor={`${id}-email`}>Email address</label>
      <div className={styles.row}>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          maxLength={254}
        />
        <button type="submit">Subscribe</button>
      </div>
      <div className={styles.trap} aria-hidden="true">
        <label htmlFor={`${id}-website`}>Website</label>
        <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <input type="hidden" name="source" value={source} />
      <p className={styles.fine}>
        Free. We’ll email you a link to confirm. Unsubscribe any time.{' '}
        <a href="/privacy">Privacy</a>
      </p>
    </form>
  );
}
