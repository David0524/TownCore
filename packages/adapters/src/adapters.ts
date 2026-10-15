// Registers every built adapter. Import this module once at startup (worker, scripts).
import { nwsAdapter } from './nws';
import { registerAdapter, getAdapter } from './registry';

for (const adapter of [nwsAdapter]) {
  if (!getAdapter(adapter.platform)) registerAdapter(adapter);
}
