import type { AdminPillTone } from '@towncore/config';
import styles from './admin.module.css';

// Status pills and initials avatars for the admin (owner, 2026-10-18: Resend-like). A pill
// always shows its word; the tone only reinforces it.

const TONES: Record<string, AdminPillTone> = {
  // Good
  live: 'green',
  active: 'green',
  verified: 'green',
  success: 'green',
  delivered: 'green',
  sent: 'green',
  ok: 'green',
  up: 'green',
  approved: 'green',
  created: 'green',
  existing: 'green',
  done: 'green',
  completed: 'green',
  on: 'green',
  published: 'green',
  // Moving
  open: 'blue',
  warming: 'blue',
  onboarding: 'blue',
  scheduled: 'blue',
  sending: 'blue',
  running: 'green',
  test: 'blue',
  logged: 'blue',
  // Waiting
  pending: 'amber',
  waiting: 'amber',
  paused: 'amber',
  draft: 'amber',
  slow: 'amber',
  deferred: 'amber',
  delayed: 'amber',
  temporary_failure: 'amber',
  // Bad
  failed: 'red',
  failure: 'red',
  bounced: 'red',
  complained: 'red',
  rejected: 'red',
  down: 'red',
  spam: 'red',
  quarantined: 'red',
  error: 'red',
};

export function toneOf(status: string | null | undefined): AdminPillTone {
  return TONES[(status ?? '').toLowerCase().trim()] ?? 'gray';
}

export function Pill({
  status,
  children,
  tone,
  testId,
}: {
  status?: string | null;
  children?: React.ReactNode;
  tone?: AdminPillTone;
  testId?: string;
}) {
  const raw = status ?? 'unknown';
  // SES reports SUCCESS, PENDING …; show them like every other status.
  const label = children ?? (/^[A-Z_]+$/.test(raw) ? raw.toLowerCase() : raw).replace(/_/g, ' ');
  return (
    <span className={styles.pill} data-tone={tone ?? toneOf(status)} data-testid={testId}>
      <span>{label}</span>
    </span>
  );
}

const AVATAR_TONES: AdminPillTone[] = ['blue', 'green', 'amber', 'red', 'gray'];

/** Initials in a colored circle; the color is stable for the same person. */
export function Avatar({ name }: { name: string }) {
  const clean = name.replace(/<.*>/, '').trim() || '?';
  const words = clean.split(/[\s@._-]+/).filter(Boolean);
  const initials = ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
  let h = 0;
  for (const c of clean.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      className={styles.avatar}
      data-tone={AVATAR_TONES[h % AVATAR_TONES.length]}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
