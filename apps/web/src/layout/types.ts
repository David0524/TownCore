import type { Theme } from '@towncore/config';
import type { Town } from '@towncore/db';
import type { ReactNode } from 'react';

export type PartProps = { town: Town; theme: Theme };
export type HeaderProps = PartProps & { nav: ReactNode };
