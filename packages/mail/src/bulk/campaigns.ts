import {
  adminActions,
  and,
  emailCampaigns,
  emailCampaignTemplates,
  eq,
  inArray,
  mailDomains,
  staff,
  towns,
  type Db,
} from '@towncore/db';
import type { Actor } from '../outbound/send';
import {
  bulkFromAddress,
  buildBulkMime,
  markdownToHtml,
  renderVars,
  type BulkBrand,
} from './message';
import type { BulkDeps } from './subscribers';

// Campaigns (brief Phase 5; D-MAIL-11). Staff write in Markdown; a campaign needs an admin's
// "Approve send" before it is scheduled. Newsletter issues (M5) instead need the domain's
// standing approval. Templates fan out to one campaign per town.

export class CampaignError extends Error {}

type Campaign = typeof emailCampaigns.$inferSelect;

async function audit(db: Db, actor: Actor, action: string, campaignId: string, detail?: unknown) {
  await db.insert(adminActions).values({
    staffId: actor.id,
    action,
    targetType: 'email_campaign',
    targetId: campaignId,
    detail: detail ?? null,
  });
}

export async function domainBrand(
  db: Db,
  domainId: string,
  fallbackPostalAddress: string | null,
): Promise<BulkBrand & { domainId: string; townName: string; townId: string | null }> {
  const [row] = await db
    .select({ domain: mailDomains, siteName: towns.siteName, townName: towns.name })
    .from(mailDomains)
    .leftJoin(towns, eq(towns.id, mailDomains.townId))
    .where(eq(mailDomains.id, domainId));
  if (!row) throw new CampaignError('No such town domain.');
  return {
    domainId,
    townId: row.domain.townId,
    domain: row.domain.name,
    siteName: row.siteName ?? row.domain.displayName,
    townName: row.townName ?? row.domain.displayName,
    postalAddress: row.domain.postalAddress ?? fallbackPostalAddress ?? '',
  };
}

export function townVars(brand: { siteName: string; townName: string; domain: string }) {
  return { site_name: brand.siteName, town_name: brand.townName, domain: brand.domain };
}

/** Subject and Markdown body → what is stored and sent, with town variables filled in. */
export function renderCampaign(
  subject: string,
  body: string,
  vars: Record<string, string>,
): { subject: string; html: string; text: string } {
  const text = renderVars(body, vars).trim();
  return { subject: renderVars(subject, vars).trim(), html: markdownToHtml(text), text };
}

export async function createCampaign(
  db: Db,
  actor: Actor,
  input: { domainId: string; subject: string; body: string; templateId?: string | null },
): Promise<Campaign> {
  if (!input.subject.trim()) throw new CampaignError('Add a subject.');
  if (!input.body.trim()) throw new CampaignError('Write the message.');
  const brand = await domainBrand(db, input.domainId, null);
  if (!brand.townId) throw new CampaignError('Bulk mail goes only to town domains.');
  const content = renderCampaign(input.subject, input.body, townVars(brand));
  const [row] = await db
    .insert(emailCampaigns)
    .values({
      domainId: input.domainId,
      templateId: input.templateId ?? null,
      createdBy: actor.id,
      ...content,
    })
    .returning();
  await audit(db, actor, 'campaign_create', row!.id, { domain: brand.domain });
  return row!;
}

export async function createTemplate(
  db: Db,
  actor: Actor,
  input: { name: string; subject: string; body: string },
) {
  if (!input.name.trim() || !input.subject.trim() || !input.body.trim())
    throw new CampaignError('A template needs a name, a subject and a message.');
  const [row] = await db
    .insert(emailCampaignTemplates)
    .values({
      name: input.name.trim(),
      subjectTemplate: input.subject,
      bodyTemplate: input.body,
      createdBy: actor.id,
    })
    .returning();
  return row!;
}

/** One draft campaign per chosen town domain, each with its own variables filled in. */
export async function fanOutTemplate(
  db: Db,
  actor: Actor,
  templateId: string,
  domainIds: string[],
): Promise<Campaign[]> {
  const [t] = await db
    .select()
    .from(emailCampaignTemplates)
    .where(eq(emailCampaignTemplates.id, templateId));
  if (!t) throw new CampaignError('No such template.');
  const out: Campaign[] = [];
  for (const domainId of [...new Set(domainIds)])
    out.push(
      await createCampaign(db, actor, {
        domainId,
        subject: t.subjectTemplate,
        body: t.bodyTemplate,
        templateId,
      }),
    );
  return out;
}

async function load(db: Db, id: string): Promise<Campaign> {
  const [c] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id));
  if (!c) throw new CampaignError('No such campaign.');
  return c;
}

/** Rule 10: an admin approves the send, for now or a set time. */
export async function approveCampaign(
  db: Db,
  actor: Actor,
  id: string,
  scheduledAt: Date | null = null,
): Promise<Campaign> {
  const [who] = await db.select().from(staff).where(eq(staff.id, actor.id));
  if (who?.role !== 'admin' || !who.active)
    throw new CampaignError('Only an admin can approve a send.');
  const c = await load(db, id);
  if (c.status !== 'draft') throw new CampaignError(`This campaign is ${c.status}, not a draft.`);
  const [row] = await db
    .update(emailCampaigns)
    .set({
      status: 'scheduled',
      approvedBy: actor.id,
      approvedAt: new Date(),
      scheduledAt: scheduledAt ?? new Date(),
    })
    .where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.status, 'draft')))
    .returning();
  if (!row) throw new CampaignError('This campaign changed; reload and try again.');
  await audit(db, actor, 'campaign_approve', id, {
    scheduledAt: row.scheduledAt?.toISOString(),
    selfApproved: c.createdBy === actor.id,
  });
  return row;
}

export async function pauseCampaign(db: Db, actor: Actor, id: string): Promise<void> {
  const [row] = await db
    .update(emailCampaigns)
    .set({ status: 'paused', pausedReason: `Paused by ${actor.name}` })
    .where(and(eq(emailCampaigns.id, id), inArray(emailCampaigns.status, ['scheduled', 'sending'])))
    .returning();
  if (!row) throw new CampaignError('Only a scheduled or sending campaign can be paused.');
  await audit(db, actor, 'campaign_pause', id);
}

/** Resumes where it stopped: already-sent rows are never sent again. */
export async function resumeCampaign(db: Db, actor: Actor, id: string): Promise<void> {
  const c = await load(db, id);
  if (c.status !== 'paused') throw new CampaignError('Only a paused campaign can be resumed.');
  await db
    .update(emailCampaigns)
    .set({ status: c.expandedAt ? 'sending' : 'scheduled', pausedReason: null })
    .where(eq(emailCampaigns.id, id));
  await audit(db, actor, 'campaign_resume', id);
}

export async function cancelCampaign(db: Db, actor: Actor, id: string): Promise<void> {
  const [row] = await db
    .update(emailCampaigns)
    .set({ status: 'cancelled', finishedAt: new Date() })
    .where(
      and(
        eq(emailCampaigns.id, id),
        inArray(emailCampaigns.status, ['draft', 'scheduled', 'sending', 'paused']),
      ),
    )
    .returning();
  if (!row) throw new CampaignError('This campaign can’t be cancelled.');
  await audit(db, actor, 'campaign_cancel', id);
}

/** Sends one copy to the staff member themself, marked as a test (never to subscribers). */
export async function testSendCampaign(
  deps: BulkDeps,
  actor: Actor & { email: string },
  id: string,
) {
  const c = await load(deps.db, id);
  const brand = await domainBrand(deps.db, c.domainId, deps.postalAddress);
  if (!brand.postalAddress)
    throw new CampaignError('Set a postal address before sending (MAIL_POSTAL_ADDRESS).');
  const raw = await buildBulkMime({
    brand,
    to: actor.email,
    subject: `[Test] ${c.subject}`,
    html: c.html,
    text: c.text,
    unsubscribeToken: 'test',
    campaignId: c.id,
    kind: c.kind,
  });
  const { sesMessageId } = await deps.transport.send({
    raw,
    from: bulkFromAddress(brand.domain),
    to: [actor.email],
    cc: [],
    configurationSet: deps.configurationSet,
    tags: { domain: brand.domain, domain_id: brand.domainId, stream: 'bulk', kind: 'test' },
  });
  await audit(deps.db, actor, 'campaign_test_send', id, { to: actor.email, sesMessageId });
}

/** M5's entry point: a daily issue goes out under the domain's standing approval only. */
export async function scheduleNewsletterIssue(
  db: Db,
  input: {
    domainId: string;
    issueId: string;
    subject: string;
    html: string;
    text: string;
    at: Date;
  },
): Promise<Campaign> {
  const [d] = await db.select().from(mailDomains).where(eq(mailDomains.id, input.domainId));
  if (!d?.newsletterApprovedAt)
    throw new CampaignError('The daily newsletter isn’t approved for this domain (D-MAIL-11).');
  const [row] = await db
    .insert(emailCampaigns)
    .values({
      domainId: input.domainId,
      kind: 'newsletter',
      newsletterIssueId: input.issueId,
      subject: input.subject,
      html: input.html,
      text: input.text,
      scheduledAt: input.at,
      status: 'scheduled',
    })
    .returning();
  return row!;
}

/** D-MAIL-11: an admin turns the daily newsletter's standing approval on or off. */
export async function setNewsletterApproval(db: Db, actor: Actor, domainId: string, on: boolean) {
  const [who] = await db.select().from(staff).where(eq(staff.id, actor.id));
  if (who?.role !== 'admin' || !who.active)
    throw new CampaignError('Only an admin can change this.');
  await db
    .update(mailDomains)
    .set(
      on
        ? { newsletterApprovedAt: new Date(), newsletterApprovedBy: actor.id }
        : { newsletterApprovedAt: null, newsletterApprovedBy: null },
    )
    .where(eq(mailDomains.id, domainId));
  await db.insert(adminActions).values({
    staffId: actor.id,
    action: on ? 'newsletter_approve' : 'newsletter_unapprove',
    targetType: 'mail_domain',
    targetId: domainId,
  });
}
