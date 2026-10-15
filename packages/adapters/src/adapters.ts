// Registers every built adapter. Import this module once at startup (worker, scripts).
import { civicplusAdapter } from './civicplus';
import { flDbprAdapter } from './fl-dbpr';
import { nwsAdapter } from './nws';
import { registerAdapter, getAdapter } from './registry';

for (const adapter of [nwsAdapter, civicplusAdapter, flDbprAdapter]) {
  if (!getAdapter(adapter.platform)) registerAdapter(adapter);
}
