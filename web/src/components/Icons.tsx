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
