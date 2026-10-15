'use server';

import type { TownConfig } from '@towncore/config';
import {
  articles,
  eq,
  getSourceRecords,
  logAdminAction,
  towns,
  storyCandidates,
  skippedCandidates,
} from '@towncore/db';
import { publishArticle, PublishBlocked } from '@towncore/pipeline';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { minorOverridable, recheckEdit } from '@/lib/admin/review';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';

async function load(id: string) {
  const [row] = await db()
    .select({ article: articles, town: towns })
    .from(articles)
    .innerJoin(towns, eq(articles.townId, towns.id))
    .where(eq(articles.id, id));
  return row ?? null;
}

const back = (id: string, query = '') => redirect(`/admin/review/${id}${query}`);

export async function approveArticle(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const id = String(form.get('id'));
  const row = await load(id);
  if (!row || row.article.status !== 'in_review') back(id, '?error=state');
  try {
    await publishArticle(db(), id, {
      reviewer: { id: staff.id, name: staff.name, placeholder: staff.placeholder },
    });
  } catch (error) {
    if (error instanceof PublishBlocked) back(id, `?error=${encodeURIComponent(error.message)}`);
    throw error;
  }
  await logAdminAction(db(), {
    staffId: staff.id,
    action: 'approve',
    articleId: id,
    detail: { tier: row!.article.tier, reviewReason: row!.article.reviewReason },
  });
  revalidatePath('/admin/review');
  redirect('/admin/review?done=approved');
}

export async function rejectArticle(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const id = String(form.get('id'));
  const reason = String(form.get('reason') ?? '').trim();
  if (!reason) back(id, '?error=reason');
  const row = await load(id);
  if (!row || row.article.status !== 'in_review') back(id, '?error=state');
  await db()
    .update(articles)
    .set({ status: 'rejected', rejectionReason: reason })
    .where(eq(articles.id, id));
  await logAdminAction(db(), {
    staffId: staff.id,
    action: 'reject',
    articleId: id,
    detail: { reason },
  });
  revalidatePath('/admin/review');
  redirect('/admin/review?done=rejected');
}

export async function saveEdits(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const id = String(form.get('id'));
  const row = await load(id);
  if (!row || row.article.status !== 'in_review') back(id, '?error=state');
  const { article, town } = row!;
  const draft = {
    headline: String(form.get('headline') ?? '').trim(),
    dek: String(form.get('dek') ?? '').trim(),
    bodyMd: String(form.get('bodyMd') ?? '')
      .replace(/\r\n/g, '\n')
      .trim(),
  };
  if (!draft.headline || !draft.bodyMd) back(id, '?error=empty');
  const sources = await getSourceRecords(db(), article.sourceRecordIds);
  const recheck = recheckEdit({
    draft,
    sources: sources.map((s) => ({ id: s.id, title: s.title, text: s.text })),
    town,
    config: town.config as TownConfig,
  });
  await db()
    .update(articles)
    .set({
      headline: draft.headline,
      dek: draft.dek || null,
      bodyMd: draft.bodyMd,
      factcheck: {
        ...((article.factcheck as object | null) ?? {}),
        recheck: { ...recheck, by: staff.id, at: new Date().toISOString() },
      },
    })
    .where(eq(articles.id, id));
  await logAdminAction(db(), {
    staffId: staff.id,
    action: 'edit',
    articleId: id,
    detail: {
      before: { headline: article.headline, dek: article.dek, bodyMd: article.bodyMd },
      after: draft,
      recheck,
    },
  });
  back(id, '?done=saved');
}

export async function overrideMinorFlag(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const id = String(form.get('id'));
  if (staff.role !== 'admin') back(id, '?error=role');
  const row = await load(id);
  if (!row || row.article.status !== 'blocked' || !minorOverridable(row.article)) {
    back(id, '?error=state');
  }
  await db()
    .update(articles)
    .set({ tier: 3, status: 'in_review', reviewReason: 'minor_override' })
    .where(eq(articles.id, id));
  await logAdminAction(db(), {
    staffId: staff.id,
    action: 'override_minor',
    articleId: id,
    detail: { tierReasons: row!.article.tierReasons },
  });
  back(id, '?done=overridden');
}

/** Queues a skipped candidate for the writer anyway (picked up within 30 minutes). */
export async function writeAnyway(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const candidateId = String(form.get('candidateId'));
  const [skip] = await db()
    .select()
    .from(skippedCandidates)
    .where(eq(skippedCandidates.candidateId, candidateId));
  if (!skip || ['tier4', 'other_outlet'].includes(skip.reason)) {
    redirect('/admin/skipped?error=state');
  }
  await db()
    .update(storyCandidates)
    .set({ status: 'accepted', acceptedAt: new Date() })
    .where(eq(storyCandidates.id, candidateId));
  await db().delete(skippedCandidates).where(eq(skippedCandidates.candidateId, candidateId));
  await logAdminAction(db(), {
    staffId: staff.id,
    action: 'write_anyway',
    candidateId,
    detail: { skipped: skip!.reason, detail: skip!.detail },
  });
  revalidatePath('/admin/skipped');
  redirect('/admin/skipped?done=queued');
}
