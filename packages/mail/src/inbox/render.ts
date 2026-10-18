// Message display (brief Phase 3): sanitized HTML (Mail-2) is shown only inside an iframe with
// an empty sandbox (no scripts, no same-origin, no forms) and its own Content-Security-Policy.
// Remote images are blocked until someone clicks "Load remote images" for that message; inline
// images (cid:) are rewritten to short-lived signed URLs on the admin host.

export type RenderOptions = {
  /** The admin origin, e.g. https://admin.towncore.net: the only place inline images load from. */
  adminOrigin: string;
  allowRemoteImages: boolean;
  /** Signed URL for an inline image by its Content-ID, or null if there isn't one. */
  inlineUrl: (contentId: string) => string | null;
};

const REMOTE_IMG = /<img\b[^>]*\bsrc\s*=\s*["']?\s*https?:/i;

export function hasRemoteImages(html: string): boolean {
  return REMOTE_IMG.test(html);
}

export function rewriteCidImages(html: string, inlineUrl: RenderOptions['inlineUrl']): string {
  return html.replace(
    /(\bsrc\s*=\s*)(["'])cid:([^"']+)\2/gi,
    (whole, prefix: string, quote: string, cid: string) => {
      const url = inlineUrl(decodeURIComponent(cid).trim());
      return url
        ? `${prefix}${quote}${url.replace(/"/g, '&quot;')}${quote}`
        : `${prefix}${quote}${quote}`;
    },
  );
}

export function cspFor(options: Pick<RenderOptions, 'adminOrigin' | 'allowRemoteImages'>): string {
  const img = [
    'data:',
    options.adminOrigin,
    ...(options.allowRemoteImages ? ['https:', 'http:'] : []),
  ].join(' ');
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `img-src ${img}`,
    "font-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

const escapeAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The full document for the iframe's srcdoc. */
export function messageDocument(sanitizedHtml: string, options: RenderOptions): string {
  const body = rewriteCidImages(sanitizedHtml, options.inlineUrl);
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(cspFor(options))}">`,
    '<meta name="referrer" content="no-referrer">',
    '<base target="_blank">',
    '<style>body{font:15px/1.5 system-ui,sans-serif;margin:12px;color:#16233A;word-wrap:break-word}img{max-width:100%;height:auto}</style>',
    `</head><body>${body}</body></html>`,
  ].join('');
}

const LINE_PX = 23; // 15px type at 1.5
const CHARS_PER_LINE = 80;
const MIN_FRAME_PX = 96;
const MAX_FRAME_PX = 720;

/**
 * A height for a message's frame, so a two-line note isn't a tall empty box. The frame's sandbox
 * has no scripts and no same-origin access, so nothing can measure it; this estimates from the
 * sanitized HTML instead (paragraphs, line breaks, wrapped lines, images, tables). Long or
 * image-heavy mail gets the maximum and scrolls; staff can still drag the frame taller.
 */
export function messageFrameHeight(sanitizedHtml: string): number {
  if (/<table\b/i.test(sanitizedHtml)) return MAX_FRAME_PX;
  const images = (sanitizedHtml.match(/<img\b/gi) ?? []).length;
  const blocks = (sanitizedHtml.match(/<(p|div|li|h[1-6]|blockquote|pre)\b/gi) ?? []).length;
  const text = sanitizedHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z#0-9]+;/gi, ' ');
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .reduce((n, l) => n + Math.ceil(l.length / CHARS_PER_LINE), 0);
  const px = 24 + lines * LINE_PX + blocks * 15 + images * 240;
  return Math.min(MAX_FRAME_PX, Math.max(MIN_FRAME_PX, Math.round(px)));
}
