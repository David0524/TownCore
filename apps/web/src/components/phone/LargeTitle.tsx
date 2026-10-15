import { SearchIcon } from './icons';
import styles from './phone.module.css';

/**
 * A large title, as on iOS (Today, Sections, Events, Search): an optional small line above,
 * the title, and an optional search field below. Phone-only unless `always`.
 */
export function LargeTitle({
  title,
  overline,
  search,
  as: Tag = 'p',
  always = false,
}: {
  title: string;
  overline?: string;
  /** Show a search field that submits to /search. */
  search?: { defaultValue?: string; autoFocus?: boolean };
  as?: 'p' | 'h1';
  always?: boolean;
}) {
  return (
    <div className={`${styles.largeTitle} ${always ? '' : 'phone-only'}`} data-testid="large-title">
      {overline ? <p className={styles.overline}>{overline}</p> : null}
      <Tag className={styles.titleText}>{title}</Tag>
      {search ? (
        <form action="/search" method="get" role="search" className={styles.search}>
          <SearchIcon size={18} />
          <label htmlFor="q" className="sr-only">
            Search stories
          </label>
          <input
            id="q"
            name="q"
            type="search"
            placeholder="Search stories"
            defaultValue={search.defaultValue}
            autoFocus={search.autoFocus}
            enterKeyHint="search"
            autoComplete="off"
          />
        </form>
      ) : null}
    </div>
  );
}
