import { asc, eq, getTownBySlug, logAdminAction, subscribers } from '@towncore/db';
import { currentStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';

// CSV export of one town's subscribers with their consent evidence (Mail-5). Audited.
const cell = (v: unknown) => {
  const s = v instanceof Date ? v.toISOString() : v == null ? '' : String(v);
  // Quote everything; neutralize spreadsheet formulas.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

export async function GET(request: Request) {
  const me = await currentStaff();
  if (!me) return new Response('Sign in first.', { status: 401 });
  const slug = new URL(request.url).searchParams.get('town') ?? '';
  const town = await getTownBySlug(db(), slug);
  if (!town) return new Response('No such town.', { status: 404 });
  const rows = await db()
    .select()
    .from(subscribers)
    .where(eq(subscribers.townId, town.id))
    .orderBy(asc(subscribers.createdAt));
  await logAdminAction(db(), {
    staffId: me.id,
    action: 'subscriber_export',
    target: { type: 'town', id: town.id },
    detail: { rows: rows.length },
  });
  const header = [
    'email',
    'status',
    'source',
    'consent_source',
    'consent_ip',
    'consent_at',
    'confirmed_at',
    'unsubscribed_at',
  ];
  const lines = rows.map((r) =>
    [
      r.email,
      r.status,
      r.source,
      r.consentSource,
      r.consentIp,
      r.consentAt,
      r.confirmedAt,
      r.unsubscribedAt,
    ]
      .map(cell)
      .join(','),
  );
  return new Response([header.join(','), ...lines].join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${town.slug}-subscribers.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
