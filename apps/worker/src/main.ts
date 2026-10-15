import { requireEnv } from '@towncore/config';
import { loadDotEnv } from '@towncore/config/dotenv';
import { pino } from 'pino';
import { startWorker } from './worker';

loadDotEnv();
const logger = pino({ name: 'worker' });

try {
  const worker = await startWorker({ databaseUrl: requireEnv('DATABASE_URL'), logger });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      logger.info({ signal }, 'shutdown signal');
      worker.stop().then(
        () => process.exit(0),
        (error: unknown) => {
          logger.error({ err: error }, 'shutdown failed');
          process.exit(1);
        },
      );
    });
  }
} catch (error) {
  logger.fatal({ err: error }, 'worker failed to start');
  process.exit(1);
}
