import type { Metadata } from 'next';
import { beats } from '@towncore/config';
import { Prose } from '@/components/Prose';
import { SectionHeader } from '@/components/news/SectionHeader';
import { aboutInShort, aboutRest, aboutSteps } from '@/content/about';
import { beatCoverage, sourceLabel } from '@/content/beats';
import { fillTemplate } from '@/content/fill';
import { rssAlternate } from '@/lib/discovery';
import { StandardPage } from '@/lib/pages';
import { JsonLd, organizationJsonLd } from '@/lib/structured-data';
import { beatColorVar } from '@/lib/theme';
import { requireTown, resolveTown } from '@/lib/town';
import { townSources } from '@/modules/data';
import styles from './about.module.css';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string }>;
}): Promise<Metadata> {
  const town = await resolveTown((await params).host);
  return {
    title: 'About us',
    alternates: { canonical: '/about', types: town ? rssAlternate(town) : undefined },
  };
}

/** About (Rule 1): scannable sections, ending with "{Site} is published by TownCore." */
export default async function AboutPage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  const ours = await townSources(town.id);
  const fill = (text: string) => fillTemplate(text, town);
  return (
    <StandardPage town={town}>
      <JsonLd data={organizationJsonLd(town)} />
      <SectionHeader title={`About ${town.siteName}`} as="h1" />

      <section className={styles.inShort} aria-labelledby="short-h">
        <h2 id="short-h" className="meta">
          In short
        </h2>
        <ul>
          {aboutInShort.map((line) => (
            <li key={line}>{fill(line)}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how-h" className={styles.section}>
        <h2 id="how-h">How we work</h2>
        <ol className={styles.steps}>
          {aboutSteps.map((step, i) => (
            <li key={step.title}>
              <span className={styles.stepNumber} aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="cover-h" className={styles.section}>
        <h2 id="cover-h">What we cover</h2>
        <ul className={styles.beats}>
          {beats.map((beat) => {
            const coverage = beatCoverage[beat.slug];
            const labels = [
              ...new Set(
                ours.filter((s) => coverage?.kinds.includes(s.kind)).map((s) => sourceLabel(s)),
              ),
            ];
            return (
              <li key={beat.slug}>
                <a href={`/beat/${beat.slug}`} className={styles.beatName}>
                  <span
                    className={styles.dot}
                    style={{ background: beatColorVar(beat.slug) }}
                    aria-hidden="true"
                  />
                  {beat.label}
                </a>
                <span>{coverage?.covers}</span>
                <span className="meta">
                  {labels.length > 0 ? `From ${labels.join(', ')}` : 'Sources coming soon'}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <Prose markdown={fill(aboutRest)} />
    </StandardPage>
  );
}
