import type { Town } from '@towncore/db';
import { townVariant } from '@towncore/db';
import { db } from '@/lib/db';
import { newsletterOpen } from '@/lib/newsletter';
import { NewsletterForm } from './NewsletterForm';
import { OfferReveal } from './OfferReveal';
import styles from './SecondArticleOffer.module.css';

/** The panel's element id; the layout's boot script and OfferReveal find it by this. */
export const OFFER_ID = 'second-article-offer';

const READ_KEY = 'tc-read';
const OFFERED_KEY = 'tc-offered';

/**
 * Defined once per page load by the town layout (owner, 2026-10-17: "offer the email after a
 * reader's second article"). It keeps the story addresses read in this tab in sessionStorage
 * (no cookie, nothing sent anywhere, gone when the tab closes) and reveals the offer on the second
 * distinct story, once per tab. It runs before paint on full loads, and from OfferReveal on
 * in-app navigation, so the panel never shifts the page.
 */
export const offerBootScript = `window.__tcOffer=function(el){try{if(!el)return;var s=el.getAttribute('data-slug');if(el.getAttribute('data-counted')===s)return;el.setAttribute('data-counted',s);var r=JSON.parse(sessionStorage.getItem(${JSON.stringify(READ_KEY)})||'[]');if(!Array.isArray(r))r=[];if(r.indexOf(s)<0){r.push(s);sessionStorage.setItem(${JSON.stringify(READ_KEY)},JSON.stringify(r.slice(-20)))}if(r.length>=2&&!sessionStorage.getItem(${JSON.stringify(OFFERED_KEY)}))sessionStorage.setItem(${JSON.stringify(OFFERED_KEY)},s);el.hidden=sessionStorage.getItem(${JSON.stringify(OFFERED_KEY)})!==s}catch(e){}}`;

const reveal = `window.__tcOffer&&window.__tcOffer(document.getElementById(${JSON.stringify(OFFER_ID)}))`;

/**
 * The email offer a reader sees at the end of their second story. Server-rendered hidden; shown
 * only in the reader's browser. Sign-ups from it are recorded as the `second-article` placement.
 */
export async function SecondArticleOffer({ town, slug }: { town: Town; slug: string }) {
  if (!(await newsletterOpen(town))) return null;
  if ((await townVariant(db(), 'second-article-offer', town)) !== 'on') return null;
  return (
    <>
      <aside
        key={slug}
        id={OFFER_ID}
        className={styles.offer}
        data-slug={slug}
        data-testid="second-article-offer"
        aria-labelledby={`${OFFER_ID}-h`}
        hidden
        suppressHydrationWarning
      >
        <h2 id={`${OFFER_ID}-h`}>Get stories like this every morning</h2>
        <p>
          The morning email brings the new {town.name} stories, the weather and what’s coming up to
          your inbox. Free.
        </p>
        <NewsletterForm source="/" id="offer" placement="second-article" />
      </aside>
      <script dangerouslySetInnerHTML={{ __html: reveal }} />
      <OfferReveal id={OFFER_ID} />
    </>
  );
}
