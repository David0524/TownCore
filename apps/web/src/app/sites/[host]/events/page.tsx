import type { Metadata } from 'next';
import { apDate } from '@towncore/pipeline';
import { Grouped } from '@/components/phone/Grouped';
import { LargeTitle } from '@/components/phone/LargeTitle';
import { clockTime } from '@/components/weather/format';
import { StandardPage } from '@/lib/pages';
import { requireTown } from '@/lib/town';
import { upcomingMeetings } from '@/modules/data';

export const metadata: Metadata = { title: 'Events', alternates: { canonical: '/events' } };

const DAYS = 30;

/**
 * The Events tab. Until the town has an events source, it lists the public meetings on the
 * city's calendar for the next 30 days (D-M5-3), grouped by day, linking to the city's pages.
 */
export default async function EventsPage({ params }: { params: Promise<{ host: string }> }) {
  const town = await requireTown(params);
  const meetings = await upcomingMeetings(town.id, DAYS, 60);
  const dayLabel = (d: Date) =>
    `${new Intl.DateTimeFormat('en-US', { timeZone: town.timezone, weekday: 'long' }).format(d)}, ${apDate(d, town.timezone)}`;
  const days = new Map<string, typeof meetings>();
  for (const m of meetings) {
    const label = dayLabel(m.when);
    days.set(label, [...(days.get(label) ?? []), m]);
  }
  return (
    <StandardPage town={town}>
      <LargeTitle title="Events" as="h1" always />
      <p className="muted">
        Public meetings on the {town.name} city calendar for the next {DAYS} days. Each links to the
        city&apos;s page with the agenda.
      </p>
      {days.size === 0 ? (
        <p data-testid="events-empty">
          No public meetings are on the city calendar for the next {DAYS} days.
        </p>
      ) : (
        [...days].map(([day, list]) => (
          <Grouped
            key={day}
            title={day}
            rows={list.map((m) => ({
              key: m.id,
              href: m.url ?? undefined,
              external: true,
              label: m.title,
              detail: [clockTime(m.when, town.timezone), m.where].filter(Boolean).join(' · '),
            }))}
          />
        ))
      )}
    </StandardPage>
  );
}
