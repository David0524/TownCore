import type { Theme } from '@towncore/config';
import type { ComponentType } from 'react';
import { Minimal } from './footers/Minimal';
import { ThreeColumn } from './footers/ThreeColumn';
import { CenteredMasthead } from './headers/CenteredMasthead';
import { LeftLogoInlineNav } from './headers/LeftLogoInlineNav';
import { StackedDateline } from './headers/StackedDateline';
import { BeatTabs } from './navs/BeatTabs';
import { HamburgerOnly } from './navs/HamburgerOnly';
import type { HeaderProps, PartProps } from './types';

// One component per layout option (CLAUDE.md §11a-2). The Record types make the build fail if
// the theme schema allows an option that has no component.
type Layout = Theme['layout'];

export const headers: Record<Layout['header'], ComponentType<HeaderProps>> = {
  'centered-masthead': CenteredMasthead,
  'left-logo-inline-nav': LeftLogoInlineNav,
  'stacked-dateline': StackedDateline,
};

export const navs: Record<Layout['nav'], ComponentType> = {
  'beat-tabs': BeatTabs,
  'hamburger-only': HamburgerOnly,
};

export const footers: Record<Layout['footer'], ComponentType<PartProps>> = {
  'three-column': ThreeColumn,
  minimal: Minimal,
};
