'use server';

import { CandidateDecisionError, decideCandidate } from '@towncore/launcher/candidates';
import {
  approveCohortGoLive,
  approveCohortPurchase,
  CohortRefused,
  createCohort,
  retryCohortTown,
  setCohortPicks,
  setCohortTodo,
} from '@towncore/launcher/cohorts';
import { approveLaunch, GoLiveRefused, setTownPaused } from '@towncore/launcher/golive';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/admin/session';
import { db } from '@/lib/db';

// Admin → Launches (M7): approve or reject a ranked town (CLAUDE.md §10a). Admins only; audited.

const str = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export async function decideCandidateAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const decision = str(form, 'decision');
  if (decision !== 'approve' && decision !== 'reject' && decision !== 'reopen')
    throw new Error('bad decision');
  const state = str(form, 'state');
  const back = (params: Record<string, string>) =>
    redirect(`/admin/launches?${new URLSearchParams({ ...(state ? { state } : {}), ...params })}`);
  let name: string;
  try {
    ({ name } = await decideCandidate(db(), {
      candidateId: str(form, 'candidateId'),
      staff: me,
      decision,
      note: str(form, 'note'),
    }));
  } catch (error) {
    if (error instanceof CandidateDecisionError) back({ error: error.message });
    throw error;
  }
  revalidatePath('/admin/launches');
  back({
    done:
      decision === 'approve'
        ? `${name!} approved for launch`
        : decision === 'reject'
          ? `${name!} rejected`
          : `${name!} back to proposed`,
  });
}

/** Approve launch: the town goes live (admin only; every check re-run; audited). */
export async function approveLaunchAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  let siteName: string;
  try {
    ({ siteName } = await approveLaunch(db(), { launchId: str(form, 'launchId'), staff: me }));
  } catch (error) {
    if (error instanceof GoLiveRefused)
      redirect(`/admin/launches?${new URLSearchParams({ error: error.message })}`);
    throw error;
  }
  revalidatePath('/admin/launches');
  redirect(`/admin/launches?${new URLSearchParams({ done: `${siteName!} is live` })}`);
}

/** Pause a live town, or resume a paused one (admin only; audited). */
export async function pauseTownAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const paused = str(form, 'paused') === 'true';
  let siteName: string;
  try {
    ({ siteName } = await setTownPaused(db(), { townId: str(form, 'townId'), staff: me, paused }));
  } catch (error) {
    if (error instanceof GoLiveRefused)
      redirect(`/admin/launches?${new URLSearchParams({ error: error.message })}`);
    throw error;
  }
  revalidatePath('/admin/launches');
  redirect(
    `/admin/launches?${new URLSearchParams({ done: `${siteName!} ${paused ? 'paused' : 'resumed'}` })}`,
  );
}

// Launch cohorts (owner, 2026-10-17; docs/plans/agentic-ops.md): one approval buys a cohort's
// domains at the stated total (Rule 10), one more takes its reviewed towns live. Admins only;
// every action audited. The orchestrator does everything in between.

const back = (params: Record<string, string>) =>
  redirect(`/admin/launches?${new URLSearchParams(params)}#cohorts`);

async function cohortStep(run: () => Promise<string>): Promise<void> {
  let done: string;
  try {
    done = await run();
  } catch (error) {
    if (error instanceof CohortRefused) back({ error: error.message });
    throw error;
  }
  revalidatePath('/admin/launches');
  back({ done: done! });
}

export async function createCohortAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  await cohortStep(async () => {
    const cohort = await createCohort(db(), {
      name: str(form, 'name'),
      candidateIds: form.getAll('candidateId').map(String),
      staff: me,
      dryRun: str(form, 'spend') !== 'yes',
    });
    return `Cohort ${cohort.name} started${cohort.dryRun ? ' (dry run)' : ''}: names and prices come next`;
  });
}

export async function cohortPicksAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  const picks: Record<string, number> = {};
  for (const [key, value] of form.entries())
    if (key.startsWith('pick:')) picks[key.slice(5)] = Number(value);
  await cohortStep(async () => {
    await setCohortPicks(db(), { cohortId: str(form, 'cohortId'), staff: me, picks });
    return 'Names updated; the total below changed with them';
  });
}

export async function approveCohortPurchaseAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  await cohortStep(async () => {
    const approval = await approveCohortPurchase(db(), {
      cohortId: str(form, 'cohortId'),
      staff: me,
      typedTotal: str(form, 'total'),
    });
    return approval.dryRun
      ? `Names approved for ${approval.domains.length} towns (dry run: nothing is bought)`
      : `Approved: ${approval.domains.length} domains for $${approval.totalUsd.toFixed(2)}`;
  });
}

export async function approveCohortGoLiveAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  await cohortStep(async () => {
    const { live, held } = await approveCohortGoLive(db(), {
      cohortId: str(form, 'cohortId'),
      staff: me,
    });
    return `${live.length ? `Live: ${live.join(', ')}.` : 'No town went live.'}${held.length ? ` Held: ${held.map((h) => h.name).join(', ')}.` : ''}`;
  });
}

export async function retryCohortTownAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  await cohortStep(async () => {
    const row = await retryCohortTown(db(), { cohortTownId: str(form, 'cohortTownId'), staff: me });
    return `Retrying ${row.stage}; the orchestrator picks it up on its next pass`;
  });
}

export async function cohortTodoAction(form: FormData): Promise<void> {
  const me = await requireStaff();
  await cohortStep(async () => {
    await setCohortTodo(db(), {
      cohortTownId: str(form, 'cohortTownId'),
      key: str(form, 'key'),
      done: str(form, 'done') === 'true',
      staff: me,
    });
    return 'To-do updated';
  });
}
