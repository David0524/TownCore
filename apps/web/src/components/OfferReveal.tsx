'use client';

import { useLayoutEffect } from 'react';

declare global {
  interface Window {
    __tcOffer?: (el: Element | null) => void;
  }
}

// In-app navigation doesn't run inline scripts, so this repeats the layout's offer check before
// paint. The check skips a panel it already counted, so a full load counts each story once.
export function OfferReveal({ id }: { id: string }) {
  useLayoutEffect(() => {
    window.__tcOffer?.(document.getElementById(id));
  });
  return null;
}
