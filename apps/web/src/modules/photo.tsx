import Link from 'next/link';
import { photoOfTheWeek, photoPath } from '@towncore/photos/queries';
import { db } from '@/lib/db';
import type { HomeModuleComponent } from './types';
import styles from './photo.module.css';

/**
 * Photo of the week (canvas "Homepage"; M9 reader photos): the newest reader photo an editor
 * approved in the last two weeks, full width, with the sender's caption and credit and a link
 * to send one. Hidden until there is one.
 */
export const PhotoOfTheWeek: HomeModuleComponent = async ({ town }) => {
  const photo = await photoOfTheWeek(db(), town.id);
  if (!photo) return null;
  const when = [photo.takenWhere, photo.takenWhen].filter(Boolean).join(', ');
  return (
    <section
      className={styles.band}
      aria-labelledby="photo-week-h"
      data-module="photo-of-the-week"
      data-bleed=""
    >
      <img
        src={photoPath(photo.id)}
        alt={photo.alt ?? ''}
        width={photo.width}
        height={photo.height}
        loading="lazy"
        decoding="async"
        className={styles.image}
      />
      <div className={styles.caption}>
        <div className={styles.text}>
          <span className="meta">Photo of the week</span>
          <h2 id="photo-week-h" className={styles.title}>
            {photo.caption}
          </h2>
          <span className={styles.credit}>
            {when ? `${when}. ` : ''}
            {photo.credit}
          </span>
        </div>
        <Link href="/photos" className={styles.send}>
          Send us yours
        </Link>
      </div>
    </section>
  );
};
