import { gameLine } from '@towncore/config';
import type { EventCardData } from '@/components/events/EventCard';
import type { GameItem } from '@/modules/data';

const STATUS: Record<GameItem['status'], string | null> = {
  scheduled: null,
  final: 'Final',
  postponed: 'Postponed',
  cancelled: 'Canceled',
};

/** A game as an event card: the date tile, "Away at Home" or the final score, sport and status. */
export function gameCard(g: GameItem): EventCardData {
  return {
    id: g.id,
    title: gameLine(g),
    when: g.when,
    end: null,
    allDay: false,
    venue: g.venue,
    street: null,
    url: g.url,
    tag: [g.sport, STATUS[g.status], g.note].filter(Boolean).join(' · '),
  };
}
