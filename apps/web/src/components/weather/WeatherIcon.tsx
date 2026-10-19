import { useId } from 'react';
import type { ConditionKind } from '@towncore/config';

// Our own weather glyphs, drawn like the phone icons (components/phone/icons.tsx): a 24px grid,
// round 1.8px strokes in currentColor, so the color comes from CSS. Never NWS's icon images
// (Rule 9). One glyph per kind (config conditionKind); clear and partly cloudy have night versions.

/** A cloud, its base at y 19, spanning x 3–22. */
const CLOUD = 'M7 19h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.5 12.1 3.5 3.5 0 0 0 7 19Z';
/** The cloud raised and smaller, leaving room below for rain, snow, a bolt or fog. */
const HIGH = 'translate(1.2 -2.6) scale(0.9)';
/** The cloud lower right, in front of a small sun or moon. */
const FRONT = 'translate(4.6 3.4) scale(0.76)';
const MOON = 'M19.5 14.6A8 8 0 1 1 9.4 4.5a6.4 6.4 0 0 0 10.1 10.1Z';

function Sun({ cx, cy, r, ray }: { cx: number; cy: number; r: number; ray: [number, number] }) {
  const [from, to] = ray;
  return (
    <>
      <circle cx={cx} cy={cy} r={r} />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        const p = (d: number) =>
          [cx + Math.cos(a) * d, cy + Math.sin(a) * d].map((n) => +n.toFixed(2));
        const [x1, y1] = p(from);
        const [x2, y2] = p(to);
        return <path key={i} d={`M${x1} ${y1}L${x2} ${y2}`} />;
      })}
    </>
  );
}

function Glyph({ kind, night, maskId }: { kind: ConditionKind; night: boolean; maskId: string }) {
  switch (kind) {
    case 'clear':
      return night ? <path d={MOON} /> : <Sun cx={12} cy={12} r={4.2} ray={[7, 9.5]} />;
    case 'partly-cloudy':
      return (
        <>
          <mask id={maskId}>
            <rect width="24" height="24" fill="white" />
            <path d={CLOUD} transform={FRONT} fill="black" stroke="black" strokeWidth="5" />
          </mask>
          <g mask={`url(#${maskId})`}>
            {night ? (
              <path d={MOON} transform="translate(-1.5 -1.5) scale(0.72)" />
            ) : (
              <Sun cx={8.5} cy={8.5} r={3} ray={[5, 6.8]} />
            )}
          </g>
          <path d={CLOUD} transform={FRONT} />
        </>
      );
    case 'cloudy':
      return <path d={CLOUD} />;
    case 'fog':
      return (
        <>
          <path d={CLOUD} transform={HIGH} />
          <path d="M5 18.5h14M7.5 21.5h9" />
        </>
      );
    case 'wind':
      return <path d="M3 8.5h10.5a2.75 2.75 0 1 0-2.6-3.6M3 12.5h15a3 3 0 1 1-2.9 3.75M3 16.5h7" />;
    case 'rain':
      return (
        <>
          <path d={CLOUD} transform={HIGH} />
          <path d="M8.5 17.5 7.3 21M12.5 17.5 11.3 21M16.5 17.5 15.3 21" />
        </>
      );
    case 'showers':
      return (
        <>
          <path d={CLOUD} transform={HIGH} />
          <path d="M8.5 18v.01M12.5 18v.01M16.5 18v.01M10.5 21v.01M14.5 21v.01" strokeWidth="2.4" />
        </>
      );
    case 'thunder':
      return (
        <>
          <path d={CLOUD} transform={HIGH} />
          <path d="M12.8 15.5 10.6 19h3l-2.2 3.5" />
        </>
      );
    case 'snow':
      return (
        <>
          <path d={CLOUD} transform={HIGH} />
          <path
            d="M8.5 18v.01M12.5 18v.01M16.5 18v.01M10.5 21.2v.01M14.5 21.2v.01"
            strokeWidth="2.6"
          />
        </>
      );
  }
}

/** A weather glyph for one kind, by day or night. Decorative: the text beside it says the weather. */
export function WeatherIcon({
  kind,
  night = false,
  size = 28,
  className,
}: {
  kind: ConditionKind;
  night?: boolean;
  size?: number;
  className?: string;
}) {
  const maskId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      data-kind={kind}
    >
      <Glyph kind={kind} night={night} maskId={maskId} />
    </svg>
  );
}
