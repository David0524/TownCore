import { Fetcher } from '@towncore/adapters';
import { loadEnv } from '@towncore/config';
import { claimWeatherRefresh } from '@towncore/db';
import { refreshTownWeather, weatherTargets } from '@towncore/pipeline';
import { after } from 'next/server';
import { db } from './db';

// Refresh-on-view for the Today weather tile. The worker refreshes every town's NWS snapshot
// every 15 minutes; where no worker runs (the Vercel demo, until the worker is deployed), a page
// view finds the snapshot more than 30 minutes old and refreshes that town after the response
// is sent. One request per town claims the refresh, at most every 10 minutes. On Vercel only:
// locally and in CI the worker (or the test's own data) is the source.

let fetcher: Fetcher | undefined;

export function refreshWeatherAfterView(townId: string): void {
  if (!loadEnv().VERCEL) return;
  try {
    after(refresh);
  } catch {
    // Outside a request (a build), there's no reader to refresh for.
  }

  async function refresh() {
    try {
      if (!(await claimWeatherRefresh(db(), townId))) return;
      const [target] = await weatherTargets(db(), townId);
      if (!target) return;
      fetcher ??= new Fetcher();
      const result = await refreshTownWeather(db(), fetcher, target);
      if (!result.ok) console.warn('weather refresh failed', townId, result.error);
    } catch (error) {
      console.error('weather refresh failed', townId, error);
    }
  }
}
