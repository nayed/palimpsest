// The design's icons (docs/design/icons), drawn with currentColor.

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
      <path d="M6 3.5v11l8.5-5.5z" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
      <path d="M5 3.5h3v11H5zM10 3.5h3v11h-3z" />
    </svg>
  );
}

export function PreviousCommitIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" {...stroke} aria-hidden="true">
      <path d="M12 4 6.5 9 12 14" />
      <path d="M5 4v10" />
    </svg>
  );
}

export function NextCommitIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" {...stroke} aria-hidden="true">
      <path d="M6 4l5.5 5L6 14" />
      <path d="M13 4v10" />
    </svg>
  );
}

export function ChevronLeftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" {...stroke} aria-hidden="true">
      <path d="M11 4 6 9l5 5" />
    </svg>
  );
}

export function ChevronRightIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" {...stroke} aria-hidden="true">
      <path d="M7 4l5 5-5 5" />
    </svg>
  );
}

export function ChevronDownIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" {...stroke} aria-hidden="true">
      <path d="M4 7l5 5 5-5" />
    </svg>
  );
}

/** A pushpin, for pinned files. */
export function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" {...stroke} strokeWidth={1.4} aria-hidden="true">
      <path d="M5 1.5h4M5.6 1.5 5 6 3 8h8L9 6l-.6-4.5M7 8v4.5" />
    </svg>
  );
}

/** A circled "i", for the About button on phones. */
export function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" {...stroke} aria-hidden="true">
      <circle cx="9" cy="9" r="7" />
      <path d="M9 8.2v4.3M9 5.6v.1" />
    </svg>
  );
}
