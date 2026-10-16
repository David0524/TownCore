// Registers every built adapter. Import this module once at startup (worker, scripts).
import { civicclerkAdapter } from './civicclerk';
import { civicplusAdapter } from './civicplus';
import { feedAdapter } from './feed';
import { flDbprAdapter } from './fl-dbpr';
import { flSunbizAdapter } from './fl-sunbiz';
import { legistarAdapter } from './legistar';
import { nwsAdapter } from './nws';
import { pageAdapter } from './page';
import { registerAdapter, getAdapter } from './registry';
import { youtubeAdapter } from './youtube';

for (const adapter of [
  nwsAdapter,
  civicplusAdapter,
  legistarAdapter,
  civicclerkAdapter,
  flDbprAdapter,
  flSunbizAdapter,
  pageAdapter,
  youtubeAdapter,
  // Last: the generic fallback for any RSS, Atom or iCalendar feed.
  feedAdapter,
]) {
  if (!getAdapter(adapter.platform)) registerAdapter(adapter);
}
