import { loadEnv } from '@towncore/config';
import {
  s3AttachmentFiles,
  signAttachment,
  threadStatuses,
  type AttachmentFiles,
  type InboxFilter,
  type StatusFilter,
} from '@towncore/mail';
import { adminBaseUrl } from './session';

// Glue between the inbox pages and packages/mail (Mail-3).

export type InboxSearchParams = {
  team?: string;
  domain?: string;
  assignee?: string;
  status?: string;
  q?: string;
  unread?: string;
  page?: string;
};

const UUID = /^[0-9a-f-]{36}$/i;
const statusFilters: readonly string[] = ['active', 'all', ...threadStatuses];

export function parseInboxFilter(params: InboxSearchParams): InboxFilter {
  const assignee = params.assignee;
  return {
    teamId: params.team && UUID.test(params.team) ? params.team : undefined,
    domainId: params.domain && UUID.test(params.domain) ? params.domain : undefined,
    assignee:
      assignee === 'me' || assignee === 'none' || (assignee && UUID.test(assignee))
        ? assignee
        : undefined,
    status: statusFilters.includes(params.status ?? '')
      ? (params.status as StatusFilter)
      : 'active',
    q: params.q?.slice(0, 200) || undefined,
    unreadOnly: params.unread === '1',
    page: Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1),
  };
}

/** The list URL with some params changed (empty values removed). */
export function inboxHref(
  params: InboxSearchParams,
  change: Partial<InboxSearchParams> = {},
): string {
  const merged = { ...params, ...change };
  const query = new URLSearchParams(
    Object.entries(merged).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  return `/admin/mail/inbox${query ? `?${query}` : ''}`;
}

/** S3 access for attachments, or null when the app has no AWS credentials or bucket. */
export function attachmentFiles(): AttachmentFiles | null {
  const env = loadEnv();
  if (!env.AWS_ACCESS_KEY_ID || !env.MAIL_S3_BUCKET) return null;
  return s3AttachmentFiles({ region: env.AWS_REGION ?? 'us-east-1', bucket: env.MAIL_S3_BUCKET });
}

/** Signed URL for an inline image, or null without MAIL_TOKEN_SECRET (the image then won't show). */
export function inlineImageUrl(attachmentId: string): string | null {
  const secret = loadEnv().MAIL_TOKEN_SECRET;
  if (!secret) return null;
  const { exp, sig } = signAttachment(secret, attachmentId);
  return `${adminBaseUrl()}/admin/mail/attachments/${attachmentId}/inline?exp=${exp}&sig=${sig}`;
}
