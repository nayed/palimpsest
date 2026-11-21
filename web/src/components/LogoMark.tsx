// The mark: a P built from three author tracks and the playhead, on its own
// dark tile (docs/logo). Drawn inline so it stays sharp at any size.

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="#201c26" />
      <g transform="translate(-1.25 1.5)">
        <rect x="13" y="13" width="10" height="41" rx="3" fill="#6dabdf" />
        <rect x="25" y="13" width="18" height="10" rx="3" fill="#9df3cc" />
        <rect x="25" y="32" width="18" height="10" rx="3" fill="#dfc1ff" />
        <rect x="45" y="11" width="5" height="31" rx="1.5" fill="#e4f26b" />
        <rect x="41.5" y="7" width="12" height="8" rx="2.5" fill="#e4f26b" />
      </g>
    </svg>
  );
}
