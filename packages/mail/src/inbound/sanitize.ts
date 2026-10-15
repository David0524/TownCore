import sanitizeHtml from 'sanitize-html';

// Inbound HTML is sanitized at ingest (brief §10): no scripts, no event handlers, no forms or
// embeds, no javascript: links. It is still only ever rendered inside a sandboxed iframe with
// remote images blocked until a person asks for them (Mail-3).

const ALLOWED_TAGS = [
  ...sanitizeHtml.defaults.allowedTags,
  'img',
  'font',
  'center',
  'span',
  'u',
  's',
  'strike',
  'small',
  'big',
];

export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    disallowedTagsMode: 'discard',
    allowedAttributes: {
      '*': [
        'style',
        'align',
        'valign',
        'width',
        'height',
        'bgcolor',
        'color',
        'dir',
        'lang',
        'title',
      ],
      // target and rel are always overwritten by the transform below.
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      font: ['face', 'size', 'color'],
      table: ['border', 'cellpadding', 'cellspacing'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'cid', 'data'] },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      }),
    },
    exclusiveFilter: (frame) =>
      // Only image data: URIs; anything else (e.g. data:text/html) is dropped with its tag.
      frame.tag === 'img' &&
      /^data:/i.test(frame.attribs.src ?? '') &&
      !/^data:image\//i.test(frame.attribs.src ?? ''),
  });
}
