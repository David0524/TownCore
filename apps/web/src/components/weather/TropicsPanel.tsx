import { stormMph, stormName, type TropicsSnapshot } from '@towncore/config';
import type { Town } from '@towncore/db';
import { apDate } from '@towncore/pipeline';
import styles from './weather.module.css';

const COMPASS = ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast', 'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest']; // prettier-ignore

const heading = (degrees: number) => COMPASS[Math.round((degrees % 360) / 22.5) % 16]!;
const coord = (value: number, pos: string, neg: string) =>
  `${Math.abs(value).toFixed(1)}° ${value >= 0 ? pos : neg}`;

/**
 * The Weather page's tropics panel (packages/config/src/tropics.ts): active storms in the town's
 * basin with their latest public advisory, then the Tropical Weather Outlook as the National
 * Hurricane Center wrote it. Local watches and warnings stay in the alert bar, from NWS.
 */
export function TropicsPanel({ town, tropics }: { town: Town; tropics: TropicsSnapshot }) {
  const { storms, outlook } = tropics;
  return (
    <section id="tropics" aria-labelledby="tropics-h" className={styles.tropicsPanel}>
      <h2 id="tropics-h">Tropics</h2>
      {storms.length ? (
        <ul className={styles.storms} data-testid="storms">
          {storms.map((s) => {
            const mph = stormMph(s);
            return (
              <li key={s.id}>
                <strong>{stormName(s)}</strong>
                <span>
                  {[
                    mph ? `Maximum sustained winds ${mph} mph` : null,
                    s.movement
                      ? `moving ${heading(s.movement.direction)} at ${s.movement.mph} mph`
                      : null,
                    `near ${coord(s.latitude, 'N', 'S')}, ${coord(s.longitude, 'E', 'W')}`,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  .
                </span>
                {s.advisory ? (
                  <span className="meta">
                    <a href={s.advisory.url} rel="noopener">
                      Advisory {s.advisory.number}
                    </a>
                    , {apDate(new Date(s.advisory.issuedAt), town.timezone)}
                    {s.graphicsUrl ? (
                      <>
                        {' · '}
                        <a href={s.graphicsUrl} rel="noopener">
                          Forecast cone
                        </a>
                      </>
                    ) : null}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {outlook ? (
        <>
          <div className={styles.outlook} data-testid="outlook">
            {outlook.text.split('\n\n').map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <p className="meta">
            <a href={outlook.url} rel="noopener">
              National Hurricane Center
            </a>{' '}
            Tropical Weather Outlook, issued {apDate(new Date(outlook.issuedAt), town.timezone)}.
          </p>
        </>
      ) : null}
    </section>
  );
}
