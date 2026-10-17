// Registers every built adapter. Import this module once at startup (worker, scripts).
import { arcgisAdapter } from './arcgis';
import { civicclerkAdapter } from './civicclerk';
import { civicplusAdapter } from './civicplus';
import { escribeAdapter } from './escribe';
import { feedAdapter } from './feed';
import { flDbprAdapter } from './fl-dbpr';
import { flSunbizAdapter } from './fl-sunbiz';
import { legistarAdapter } from './legistar';
import { nwsAdapter } from './nws';
import { pageAdapter } from './page';
import { pdfListAdapter } from './pdf-list';
import { readerAdapter } from './reader';
import { registerAdapter, getAdapter } from './registry';
import { socrataAdapter } from './socrata';
import { usaspendingAdapter } from './usaspending';
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
  socrataAdapter,
  escribeAdapter,
  arcgisAdapter,
  readerAdapter,
  pdfListAdapter,
  usaspendingAdapter,
  // Last: the generic fallback for any RSS, Atom or iCalendar feed.
  feedAdapter,
]) {
  if (!getAdapter(adapter.platform)) registerAdapter(adapter);
}
