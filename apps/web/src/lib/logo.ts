import type { TownConfig } from '@towncore/config';
import type { Town } from '@towncore/db';

export type TownLogo = { src: string; width?: number; height?: number };

/** The town's logo image from its config (a path, or a path with its size), if it has one. */
export function townLogo(town: Pick<Town, 'config'>): TownLogo | undefined {
  const raw = (town.config as Pick<TownConfig, 'logo'>).logo;
  return typeof raw === 'string' ? { src: raw } : raw;
}
