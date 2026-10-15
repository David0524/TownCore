import type { Theme } from '@towncore/config';
import type { Town } from '@towncore/db';
import type { ReactNode } from 'react';
import type { TownWeather } from '@/modules/data';

export type PartProps = { town: Town; theme: Theme };
/** Headers that carry the weather themselves (slim-left) read `weather`; others ignore it. */
export type HeaderProps = PartProps & { nav: ReactNode; weather?: TownWeather | null };
