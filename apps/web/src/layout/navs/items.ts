import { beats } from '@towncore/config';

export const beatItems = [
  { href: '/', label: 'Latest' },
  ...beats.map((beat) => ({ href: `/beat/${beat.slug}`, label: beat.label })),
];

export const aboutItems = [
  { href: '/about', label: 'About' },
  { href: '/methods', label: 'How we report' },
  { href: '/corrections', label: 'Corrections' },
];
