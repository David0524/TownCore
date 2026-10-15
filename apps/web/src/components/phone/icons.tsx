// Our own line icons in the SF Symbols manner (docs/plans/M4b.md revision 5): drawn here, never
// Apple's symbol files. 24px grid, currentColor, so the tint and inactive gray come from CSS.

type IconProps = { size?: number; filled?: boolean };

const svg = (size: number, children: React.ReactNode) => (
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
  >
    {children}
  </svg>
);

/** Today: a folded newspaper. */
export const TodayIcon = ({ size = 26, filled }: IconProps) =>
  svg(
    size,
    <>
      <rect x="3.5" y="4" width="14" height="16" rx="2" fill={filled ? 'currentColor' : 'none'} />
      <path d="M17.5 8h3v10a2 2 0 0 1-2 2h-1" />
      <path
        d="M6.5 8h8M6.5 11.5h8M6.5 15h5"
        stroke={filled ? 'var(--ios-chrome)' : 'currentColor'}
      />
    </>,
  );

/** Sections: four rounded squares. */
export const SectionsIcon = ({ size = 26, filled }: IconProps) =>
  svg(
    size,
    <>
      {[
        [3.5, 3.5],
        [13.5, 3.5],
        [3.5, 13.5],
        [13.5, 13.5],
      ].map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="7"
          height="7"
          rx="1.8"
          fill={filled ? 'currentColor' : 'none'}
        />
      ))}
    </>,
  );

/** Events: a calendar page. */
export const EventsIcon = ({ size = 26, filled }: IconProps) =>
  svg(
    size,
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17" />
      {filled ? (
        <path
          d="M3.5 7.5a2.5 2.5 0 0 1 2.5-2.5h12a2.5 2.5 0 0 1 2.5 2.5V10h-17Z"
          fill="currentColor"
        />
      ) : null}
      <path d="M8 3v4M16 3v4" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01" strokeWidth="2.4" />
    </>,
  );

/** Search: a magnifying glass. */
export const SearchIcon = ({ size = 26 }: IconProps) =>
  svg(
    size,
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </>,
  );

/** The back chevron in a navigation bar. */
export const BackChevron = ({ size = 22 }: IconProps) =>
  svg(size, <path d="M15 4.5 7.5 12l7.5 7.5" strokeWidth="2.4" />);

/** The disclosure chevron at the end of a grouped-list row. */
export const RowChevron = ({ size = 14 }: IconProps) =>
  svg(size, <path d="m9 5 7 7-7 7" strokeWidth="2.6" />);

/** A warning triangle (alerts). */
export const WarningIcon = ({ size = 22 }: IconProps) =>
  svg(
    size,
    <>
      <path
        d="M10.3 4.2a2 2 0 0 1 3.4 0l7.6 13.2A2 2 0 0 1 19.6 20H4.4a2 2 0 0 1-1.7-2.6Z"
        fill="currentColor"
      />
      <path d="M12 9.5v4.5M12 17h.01" stroke="var(--alert-text)" strokeWidth="2.2" />
    </>,
  );
