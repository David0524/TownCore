'use client';

// The listing's call button (D-M6-8): no paid call tracking; a tap is logged as a lead with a
// beacon, and the phone opens the real number as usual.
export function CallButton({
  slug,
  phone,
  name,
  label,
  className = 'button',
  children,
}: {
  slug: string;
  phone: string;
  name: string;
  /** Shorter text for cards ("Call"); the full name stays in the accessible name. */
  label?: string;
  className?: string;
  /** Replaces the text, e.g. an icon (the accessible name stays "Call {name}"). */
  children?: React.ReactNode;
}) {
  const onClick = () => {
    const body = JSON.stringify({ slug });
    if (!navigator.sendBeacon?.('/lead/call', new Blob([body], { type: 'application/json' }))) {
      void fetch('/lead/call', { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  };
  return (
    <a
      className={className}
      href={`tel:${phone.replace(/[^\d+]/g, '')}`}
      onClick={onClick}
      aria-label={`Call ${name}`}
    >
      {children ?? label ?? `Call ${name}`}
    </a>
  );
}
