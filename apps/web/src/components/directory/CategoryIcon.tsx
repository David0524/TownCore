import type { DirectoryCategory } from '@towncore/config';

// Small line icons for directory categories, drawn here (SF Symbols look-alikes, §11a): one per
// group, a few per category. 24×24, stroke only, current color.
const PATHS: Record<string, string> = {
  home: 'M4 11l8-6 8 6M6 10v9h12v-9M10 19v-5h4v5',
  food: 'M7 3v7a2 2 0 0 0 4 0V3M9 10v11M16 21V3c-2 1-3 4-3 7h3',
  coffee: 'M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9ZM16 11h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M11 3v3',
  bar: 'M6 4h12l-6 8-6-8ZM12 12v8M8 20h8',
  grocery: 'M3 4h2l2.5 11h10L20 7H6.5M9 19.5a1 1 0 1 0 0 .01M17 19.5a1 1 0 1 0 0 .01',
  shops: 'M5 8h14l-1 12H6L5 8ZM9 8V6a3 3 0 0 1 6 0v2',
  health: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z',
  beauty:
    'M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4L12 3ZM18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z',
  fitness: 'M3 10v4M6 8v8M18 8v8M21 10v4M6 12h12',
  services: 'M4 8h16v11H4V8ZM9 8V5h6v3M4 13h16',
  car: 'M5 16h14v-4l-2-5H7l-2 5v4ZM5 16v2M19 16v2M8 13.5h.01M16 13.5h.01',
  pets: 'M8.5 7a1.5 1.5 0 1 0 0 .01M15.5 7a1.5 1.5 0 1 0 0 .01M5 11.5a1.5 1.5 0 1 0 0 .01M19 11.5a1.5 1.5 0 1 0 0 .01M12 12c-3 0-5 3-5 5a2 2 0 0 0 2 2c1 0 2-.7 3-.7s2 .7 3 .7a2 2 0 0 0 2-2c0-2-2-5-5-5Z',
  school: 'M3 9l9-4 9 4-9 4-9-4ZM7 11v4c0 1.5 2.5 3 5 3s5-1.5 5-3v-4',
  hotel: 'M3 18V8M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 11.5a1.5 1.5 0 1 0 0 .01',
  fun: 'M4 7h16v10H4V7ZM9 7v10M15 7v10M4 12h5M15 12h5',
  bank: 'M3 9l9-5 9 5M5 9v8M9.5 9v8M14.5 9v8M19 9v8M3 20h18',
};

const BY_CATEGORY: Record<string, string> = {
  'coffee-and-bakeries': 'coffee',
  'bars-and-nightlife': 'bar',
  'grocery-and-markets': 'grocery',
  'beauty-and-wellness': 'beauty',
  fitness: 'fitness',
  automotive: 'car',
  pets: 'pets',
  'childcare-and-education': 'school',
  hotels: 'hotel',
  'banks-and-finance': 'bank',
};

export function CategoryIcon({ category }: { category: DirectoryCategory }) {
  const d = PATHS[BY_CATEGORY[category.slug] ?? category.group] ?? PATHS.services!;
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}
