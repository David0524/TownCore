import { ACTIVATE, LEASE_MS, newsIdentityName, STEPS, type OnboardingStore } from './onboarding';
import { identityFailed, identityVerified, type IdentityProvider } from './ses';

// The worker's half of onboarding: re-read SES verification status and, once both identities
// pass, take the domain live. It only reads SES and writes our own rows, so it runs on the
// app's least-privilege credentials. Writing DNS or creating identities stays with the CLI.

export type VerificationResult =
  | { outcome: 'live' | 'waiting' | 'failed' | 'refreshed'; detail?: string }
  | { outcome: 'skipped'; detail: string };

export async function checkVerification(
  name: string,
  deps: { store: OnboardingStore; ses: IdentityProvider },
): Promise<VerificationResult> {
  const { store, ses } = deps;
  const domain = await store.getDomain(name);
  if (!domain) return { outcome: 'skipped', detail: 'not onboarded' };
  if (!(await store.acquireLease(domain.id, LEASE_MS)))
    return { outcome: 'skipped', detail: 'an onboarding run holds it' };
  try {
    const root = await ses.getIdentity(name);
    const news = await ses.getIdentity(newsIdentityName(name));
    if (root) await store.saveIdentity(domain.id, 'root', root);
    if (news) await store.saveIdentity(domain.id, 'news', news);
    if (domain.status !== 'onboarding') return { outcome: 'refreshed' };

    const steps = await store.getSteps(domain.id);
    const before = STEPS.slice(0, STEPS.indexOf('verify'));
    if (!root || !news || before.some((s) => steps[s]?.status !== 'done'))
      return { outcome: 'skipped', detail: 'onboarding is unfinished; run the onboarding CLI' };

    const attempts = (steps.verify?.attempts ?? 0) + 1;
    const failed = [root, news].find(identityFailed);
    if (failed) {
      const message = `SES verification failed for ${failed.name} (DKIM ${failed.dkimStatus}, MAIL FROM ${failed.mailFromStatus}). Check the DNS records, then retry.`;
      await store.setStep(domain.id, 'verify', { status: 'failed', attempts, lastError: message });
      await store.updateDomain(domain.id, {
        status: 'failed',
        failureReason: `verify: ${message}`,
      });
      return { outcome: 'failed', detail: message };
    }
    if (!identityVerified(root) || !identityVerified(news)) {
      await store.setStep(domain.id, 'verify', { status: 'waiting', attempts, lastError: null });
      return { outcome: 'waiting' };
    }
    await store.setStep(domain.id, 'verify', { status: 'done', attempts, lastError: null });
    await store.updateDomain(domain.id, ACTIVATE);
    await store.setStep(domain.id, 'activate', {
      status: 'done',
      attempts: (steps.activate?.attempts ?? 0) + 1,
      lastError: null,
    });
    return { outcome: 'live' };
  } finally {
    await store.releaseLease(domain.id);
  }
}
