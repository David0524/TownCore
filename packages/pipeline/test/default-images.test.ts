import {
  beats,
  cardLabel,
  illustrationShots,
  shotIdOf,
  storyKindOf,
  storyKinds,
  type LibraryIllustration,
  type StoryKind,
} from '@towncore/config';
import { describe, expect, it } from 'vitest';
import { chooseLibraryIllustration } from '../src/images';
import { pickLead } from '../src/ranking';

// Default images (docs/plans/default-images.md): with the whole catalogue made, no recurring kind
// of story and no beat but public safety ever falls through to the title card, and a weekly
// roundup gets a different picture each week for six weeks.

const fullLibrary: LibraryIllustration[] = illustrationShots.map((s) => ({
  id: s.id,
  width: 1536,
  height: 1024,
  alt: s.scene,
  approvedBy: 'owner@towncore.net',
  importedAt: '2026-10-17',
}));

/** Typical headlines, so the test runs the real keyword matching. */
const headlines: Record<StoryKind, string> = {
  'roundup:meetings': 'Five public meetings this week, starting with the planning board',
  'roundup:new-businesses': 'A brewery and 38 other businesses registered last week',
  'roundup:new-licenses': '12 new contractor licenses, most of them roofers',
  'roundup:new-places': 'Four new places to eat and drink, including a taqueria',
  'roundup:inspections': 'Restaurant inspections: 31 places met standards',
  'roundup:permits': '$4.1 million in permits, led by an addition on Elm Street',
  'roundup:roads': 'Six road projects this week; Main Street down to one lane',
  'roundup:sales': 'A $1.2 million waterfront home led 40 sales',
  'spotlight:permit': '$3 million permit for an apartment building on Oak Avenue',
  'spotlight:inspection': 'State orders a restaurant on Elm Street closed',
  alert: 'Flood Warning issued for the county until 8 p.m.',
};

const WEEKS = 6;

describe('the default image catalogue', () => {
  for (const state of ['ME', 'FL']) {
    for (const kind of storyKinds.filter((k) => k !== 'spotlight:inspection')) {
      it(`${kind} in ${state} gets a picture of its own kind, ${WEEKS} weeks running`, () => {
        const recent = new Set<string>();
        for (let week = 0; week < WEEKS; week++) {
          const pick = chooseLibraryIllustration({
            section:
              kind === 'alert' ? 'weather' : kind.includes('meetings') ? 'government' : 'business',
            state,
            text: headlines[kind],
            storyKind: kind,
            articleId: `${kind}-${week}`,
            current: null,
            recent,
            library: fullLibrary,
          });
          expect(pick, `week ${week + 1}`).not.toBeNull();
          expect(pick!.shot.kinds).toContain(kind);
          // A recurring roundup rotates; an alert keeps to scenes its words name.
          if (kind !== 'alert') expect(recent.has(pick!.shot.id)).toBe(false);
          recent.add(pick!.art.id);
        }
      });
    }

    for (const beat of beats.filter((b) => b.slug !== 'public-safety')) {
      it(`a ${beat.slug} story whose words match no tag gets a fallback picture in ${state}`, () => {
        const pick = chooseLibraryIllustration({
          section: beat.slug,
          state,
          text: 'Zyzzyva quarterly',
          articleId: `story-${beat.slug}`,
          current: null,
          recent: new Set(),
          library: fullLibrary,
        });
        expect(pick?.shot.fallback).toBe(true);
      });
    }
  }

  it('never illustrates public safety or one restaurant’s inspection', () => {
    const base = { state: 'FL', articleId: 'x', current: null, recent: new Set<string>() };
    expect(
      chooseLibraryIllustration({
        ...base,
        section: 'public-safety',
        text: 'Crash on I-95',
        library: fullLibrary,
      }),
    ).toBeNull();
    expect(
      chooseLibraryIllustration({
        ...base,
        section: 'business',
        storyKind: 'spotlight:inspection',
        text: headlines['spotlight:inspection'],
        library: fullLibrary,
      }),
    ).toBeNull();
  });

  it('matches an alert by its event, and an unknown one to storm clouds', () => {
    const base = {
      section: 'weather',
      state: 'ME',
      storyKind: 'alert' as const,
      articleId: 'a',
      current: null,
      recent: new Set<string>(),
      library: fullLibrary,
    };
    expect(chooseLibraryIllustration({ ...base, text: 'Freeze Warning tonight' })?.shot.id).toBe(
      'alrt-02',
    );
    expect(chooseLibraryIllustration({ ...base, text: 'Special Weather Statement' })?.shot.id).toBe(
      'alrt-05',
    );
  });

  it('keeps a picture drawn with palms to Florida, though its scene fits any town', () => {
    const base = {
      section: 'community',
      text: 'Bulk pickup and yard waste schedule',
      title: 'How bulk pickup works',
      articleId: 'g',
      current: null,
      recent: new Set<string>(),
    };
    const palms = { ...fullLibrary.find((a) => a.id === 'gd-12')!, region: 'FL' as const };
    const guide = { ...base, section: 'guide', library: [palms] };
    expect(chooseLibraryIllustration({ ...guide, state: 'FL' })?.art.id).toBe('gd-12');
    expect(chooseLibraryIllustration({ ...guide, state: 'ME' })).toBeNull();
  });

  it('counts a second take and a photo version as the same scene', () => {
    const library = [
      ...fullLibrary.filter((a) => a.id.startsWith('insp')),
      { ...fullLibrary.find((a) => a.id === 'insp-01')!, id: 'insp-01-p', photoreal: true },
    ];
    expect(shotIdOf('insp-01-p')).toBe('insp-01');
    expect(shotIdOf('insp-01-p2')).toBe('insp-01');
    expect(shotIdOf('insp-01-2')).toBe('insp-01');
    expect(shotIdOf('nope-01-p')).toBeNull();
    const seen = new Set<string>();
    for (let week = 0; week < 6; week++) {
      const pick = chooseLibraryIllustration({
        section: 'business',
        state: 'ME',
        text: headlines['roundup:inspections'],
        storyKind: 'roundup:inspections',
        articleId: `w${week}`,
        current: null,
        recent: seen,
        library,
      })!;
      expect(seen.has(pick.shot.id)).toBe(false);
      seen.add(pick.art.id);
    }
  });
});

describe('story kinds and title card labels', () => {
  it('reads the kind from the candidate key', () => {
    expect(storyKindOf('roundup:sales:2026-10-05')).toBe('roundup:sales');
    expect(storyKindOf('spotlight:inspection:2026-10-05:abc')).toBe('spotlight:inspection');
    expect(storyKindOf('alert:0193')).toBe('alert');
    expect(storyKindOf('story:abc')).toBeNull();
    expect(storyKindOf(null)).toBeNull();
  });

  const now = new Date('2026-10-17T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  it('labels by kind, then beat', () => {
    expect(cardLabel({ storyKind: 'roundup:sales', beat: 'development', headline: 'x' })).toBe(
      'Property Sales',
    );
    expect(cardLabel({ storyKind: null, beat: 'public-safety', headline: 'x' })).toBe(
      'Public Safety',
    );
    expect(cardLabel({ storyKind: null, beat: 'community', guide: true, headline: 'x' })).toBe(
      'Local Guide',
    );
  });

  it('says Breaking News only for a fresh warning or urgent official notice', () => {
    const alert = { storyKind: 'alert' as const, beat: 'community', now };
    expect(
      cardLabel({ ...alert, headline: 'Flood Warning issued', publishedAt: hoursAgo(2) }),
    ).toBe('Breaking News');
    expect(
      cardLabel({ ...alert, headline: 'Flood Warning issued', publishedAt: hoursAgo(30) }),
    ).toBe('Weather Alert');
    expect(cardLabel({ ...alert, headline: 'Heat Advisory', publishedAt: hoursAgo(1) })).toBe(
      'Weather Alert',
    );
    const notice = { storyKind: null, now, publishedAt: hoursAgo(3) };
    expect(
      cardLabel({ ...notice, beat: 'government', headline: 'Boil-water notice for Zone 4' }),
    ).toBe('Breaking News');
    expect(
      cardLabel({ ...notice, beat: 'business', headline: 'Bakery closed after road closures' }),
    ).toBe('Business News');
    expect(cardLabel({ ...notice, beat: 'government', headline: 'Council approves budget' })).toBe(
      'City Hall',
    );
  });
});

describe('the lead needs a picture', () => {
  const story = (id: string, tier: number, reviewed = false) => ({
    id,
    tier,
    reviewed,
    beat: 'government',
    kind: 'story',
    publishedAt: new Date(),
    newsworthiness: 50,
  });

  it('skips a story on its title card and takes the next eligible one, rank unchanged', () => {
    const ranked = [story('card', 1), story('t3', 3), story('pic', 2), story('pic2', 1)];
    const pictured = (a: { id: string }) => a.id.startsWith('pic');
    expect(pickLead(ranked, pictured)?.id).toBe('pic');
    expect(ranked.map((a) => a.id)).toEqual(['card', 't3', 'pic', 'pic2']);
  });

  it('has no lead when no eligible story has a picture', () => {
    expect(pickLead([story('card', 1), story('t3', 3)], () => false)).toBeUndefined();
    expect(pickLead([story('t3', 3)], () => true)).toBeUndefined();
  });
});
