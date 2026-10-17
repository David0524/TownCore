'use client';

import { useState } from 'react';

/** Copies a post's text and link, ready to paste into the town's Facebook page. */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? 'Copied' : 'Copy post'}
    </button>
  );
}
