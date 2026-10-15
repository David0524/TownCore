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
