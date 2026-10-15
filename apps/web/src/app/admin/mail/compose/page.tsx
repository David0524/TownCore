import { asc, mailDomains, or, roleAddresses, eq } from '@towncore/db';
import Link from 'next/link';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';
import { sendNewAction } from './actions';
import { Composer } from './Composer';

export const metadata = { title: 'New message' };

// A new outbound conversation from a town role address (Mail-4).
export default async function NewMessage() {
  const me = await requireStaff();
  const [domains, roles] = await Promise.all([
    db()
      .select({ id: mailDomains.id, name: mailDomains.name, displayName: mailDomains.displayName })
      .from(mailDomains)
      .where(or(eq(mailDomains.status, 'live'), eq(mailDomains.status, 'paused')))
      .orderBy(asc(mailDomains.name)),
    db()
      .select({ localPart: roleAddresses.localPart })
      .from(roleAddresses)
      .orderBy(asc(roleAddresses.localPart)),
  ]);
  return (
    <main>
      <p>
        <Link href="/admin/mail/inbox">← Inbox</Link>
      </p>
      <h1>New message</h1>
      {domains.length === 0 ? (
        <p>No town domain is live for mail yet.</p>
      ) : (
        <Composer
          action={sendNewAction}
          hidden={{}}
          extra={
            <>
              <label htmlFor="compose-domain">Town</label>
              <select id="compose-domain" name="domainId" required>
                {domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.displayName} ({d.name})
                  </option>
                ))}
              </select>
              <label htmlFor="compose-from">From address</label>
              <select id="compose-from" name="localPart" defaultValue="news">
                {roles
                  .filter((r) => r.localPart)
                  .map((r) => (
                    <option key={r.localPart} value={r.localPart!}>
                      {r.localPart}@
                    </option>
                  ))}
              </select>
            </>
          }
          defaults={{ to: '', cc: '', subject: '' }}
          signature={`(signature for ${me.name}, rendered when sent)`}
          submitLabel="Send"
        />
      )}
    </main>
  );
}
