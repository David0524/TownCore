import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { entityKindLabels } from '@towncore/config';
import { SectionHeader } from '@/components/news/SectionHeader';
import { StoryBlock } from '@/components/news/StoryBlock';
import { rssAlternate } from '@/lib/discovery';
import { StandardPage } from '@/lib/pages';
import { requireTown, resolveTown } from '@/lib/town';
import { topicPage } from '@/modules/data';
import styles from './topic.module.css';

type Props = { params: Promise<{ host: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { host, slug } = await params;
  const town = await resolveTown(host);
  const topic = town ? await topicPage(town.id, slug) : null;
  if (!town || !topic) return {};
  return {
    title: topic.entity.name,
    description: `${town.siteName} stories that mention ${topic.entity.name}.`,
    alternates: { canonical: `/topics/${slug}`, types: rssAlternate(town) },
    // Thin topic pages stay out of search until they list 3 or more stories (D-M4-5).
    robots: topic.indexable ? undefined : { index: false, follow: true },
  };
}

/**
 * A topic page (CLAUDE.md §6a; docs/plans/M4.md §4): every story of ours that mentions this
 * business, street, school, official, project or agency, newest first. It shows only what our
 * stories say: no photos, no biographies.
 */
export default async function TopicPage({ params }: Props) {
  const town = await requireTown(params);
  const topic = await topicPage(town.id, (await params).slug);
  // A topic no published story mentions any more has no page.
  if (!topic || topic.stories.length === 0) notFound();
  const { entity, stories } = topic;
  return (
    <StandardPage town={town}>
      <p className="meta" data-testid="topic-kind">
        {entityKindLabels[entity.kind]}
      </p>
      <SectionHeader title={entity.name} as="h1" />
      <p className={`muted ${styles.intro}`}>
        {stories.length === 1 ? 'One story' : `${stories.length} stories`} from {town.siteName} that
        mention {entity.name}, newest first.
      </p>
      <ul className={styles.list}>
        {stories.map((story) => (
          <li key={story.id}>
            <StoryBlock story={story} town={town} variant="brief" />
          </li>
        ))}
      </ul>
    </StandardPage>
  );
}
