// Registers every built adapter. Import this module once at startup (worker, scripts).
import { civicplusAdapter } from './civicplus';
import { flDbprAdapter } from './fl-dbpr';
import { flSunbizAdapter } from './fl-sunbiz';
import { nwsAdapter } from './nws';
import { pageAdapter } from './page';
import { registerAdapter, getAdapter } from './registry';

for (const adapter of [nwsAdapter, civicplusAdapter, flDbprAdapter, flSunbizAdapter, pageAdapter]) {
  if (!getAdapter(adapter.platform)) registerAdapter(adapter);
}
