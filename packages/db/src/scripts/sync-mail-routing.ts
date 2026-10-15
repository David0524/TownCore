import { loadDotEnv } from '@towncore/config/dotenv';
import { getDb } from '../client';
import { syncMailRouting } from '../mail-routing';

loadDotEnv();
const db = getDb();
try {
  const { teamsAdded, addressesAdded } = await syncMailRouting(db);
  console.log(
    `Mail routing: ${teamsAdded.length} team(s) added${teamsAdded.length ? ` (${teamsAdded.join(', ')})` : ''}; ` +
      `${addressesAdded.length} address(es) added${addressesAdded.length ? ` (${addressesAdded.join(', ')})` : ''}.`,
  );
} finally {
  await db.$client.end();
}
