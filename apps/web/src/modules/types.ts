import type { HomeModule, Theme } from '@towncore/config';
import type { Town } from '@towncore/db';
import type { ReactNode } from 'react';

export type ModuleProps = { town: Town; theme: Theme; modules: readonly HomeModule[] };

/**
 * A homepage module (CLAUDE.md §11a-2): self-contained, loads its own data, provides its own
 * slots, and returns null when it has nothing to show.
 */
export type HomeModuleComponent = (props: ModuleProps) => Promise<ReactNode | null>;
