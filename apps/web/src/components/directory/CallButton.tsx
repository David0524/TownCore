'use client';

// The listing's call button (D-M6-8): no paid call tracking; a tap is logged as a lead with a
// beacon, and the phone opens the real number as usual.
export function CallButton({ slug, phone, name }: { slug: string; phone: string; name: string }) {
  const onClick = () => {
    const body = JSON.stringify({ slug });
    if (!navigator.sendBeacon?.('/lead/call', new Blob([body], { type: 'application/json' }))) {
      void fetch('/lead/call', { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  };
  return (
    <a className="button" href={`tel:${phone.replace(/[^\d+]/g, '')}`} onClick={onClick}>
      Call {name}
    </a>
  );
}
