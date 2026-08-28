/**
 * Lucide glyphs, inlined as SVG (github.md: icon set of record).
 *
 * Inlined rather than pulled from a package because the whole client is served
 * off the tailnet and an icon font or CDN would be the one thing on the page
 * that needs the open internet.
 *
 * Default sizes match the spec's call sites: 12px in the structural rail,
 * 13–14px in chrome, 24px in the photo drop zone.
 */

interface IconProps { size?: number; class?: string }

function svg(paths: preact.JSX.Element, size: number, cls?: string) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      style="flex:none;display:block" class={cls}
    >{paths}</svg>
  );
}

// ── chrome ────────────────────────────────────────────────────────────────

export const ArrowLeft = ({ size = 12, ...p }: IconProps) =>
  svg(<><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>, size, p.class);

export const ChevronUp = ({ size = 12, ...p }: IconProps) =>
  svg(<path d="m18 15-6-6-6 6" />, size, p.class);

export const ChevronDown = ({ size = 12, ...p }: IconProps) =>
  svg(<path d="m6 9 6 6 6-6" />, size, p.class);

export const Check = ({ size = 14, ...p }: IconProps) =>
  svg(<path d="M20 6 9 17l-5-5" />, size, p.class);

export const Circle = ({ size = 14, ...p }: IconProps) =>
  svg(<circle cx="12" cy="12" r="9" />, size, p.class);

export const CircleCheck = ({ size = 13, ...p }: IconProps) =>
  svg(<><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>, size, p.class);

export const X = ({ size = 13, ...p }: IconProps) =>
  svg(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>, size, p.class);

export const Plus = ({ size = 12, ...p }: IconProps) =>
  svg(<><path d="M5 12h14" /><path d="M12 5v14" /></>, size, p.class);

export const Trash = ({ size = 12, ...p }: IconProps) =>
  svg(<><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>, size, p.class);

export const Star = ({ size = 12, ...p }: IconProps) =>
  svg(<path d="M11.5 3.2a.6.6 0 0 1 1 0l2.3 4.7 5.2.7a.6.6 0 0 1 .3 1l-3.7 3.6.9 5.2a.6.6 0 0 1-.9.6L12 16.5l-4.6 2.5a.6.6 0 0 1-.9-.6l.9-5.2-3.7-3.6a.6.6 0 0 1 .3-1l5.2-.7Z" />, size, p.class);

export const Download = ({ size = 12, ...p }: IconProps) =>
  svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></>, size, p.class);

export const Mail = ({ size = 14, ...p }: IconProps) =>
  svg(<><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></>, size, p.class);

export const Globe = ({ size = 14, ...p }: IconProps) =>
  svg(<><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></>, size, p.class);

export const Mic = ({ size = 14, ...p }: IconProps) =>
  svg(<><path d="M16.85 18.58a9 9 0 1 0-9.7 0" /><path d="M8 14a5 5 0 1 1 8 0" /><circle cx="12" cy="11" r="1" /><path d="M13 17a1 1 0 1 0-2 0l.5 4.5a.5.5 0 1 0 1 0Z" /></>, size, p.class);

// ── the structural rail ───────────────────────────────────────────────────

export const CornerUpRight = ({ size = 12, ...p }: IconProps) =>
  svg(<><path d="m15 14 5-5-5-5" /><path d="M4 20v-7a4 4 0 0 1 4-4h12" /></>, size, p.class);

export const CornerDownRight = ({ size = 12, ...p }: IconProps) =>
  svg(<><path d="m15 10 5 5-5 5" /><path d="M4 4v7a4 4 0 0 0 4 4h12" /></>, size, p.class);

export const ArrowUp = ({ size = 12, ...p }: IconProps) =>
  svg(<><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></>, size, p.class);

export const ArrowDown = ({ size = 12, ...p }: IconProps) =>
  svg(<><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>, size, p.class);

export const Info = ({ size = 12, ...p }: IconProps) =>
  svg(<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>, size, p.class);

// ── sync state ────────────────────────────────────────────────────────────

export const CloudCheck = ({ size = 13, ...p }: IconProps) =>
  svg(<><path d="m17 15-5.5 5.5L9 18" /><path d="M5 17.743A7 7 0 1 1 15.71 10h1.79a4.5 4.5 0 0 1 1.5 8.742" /></>, size, p.class);

export const CircleAlert = ({ size = 13, ...p }: IconProps) =>
  svg(<><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></>, size, p.class);

export const PencilLine = ({ size = 13, ...p }: IconProps) =>
  svg(<><path d="M12 20h9" /><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" /></>, size, p.class);

/** `loader-circle` — the spinning saving state, and the generic busy glyph. */
export const Spinner = ({ size = 14, ...p }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" style="flex:none;display:block;animation:spin 1s linear infinite" class={p.class}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

// ── editorial + outline ───────────────────────────────────────────────────

export const WandSparkles = ({ size = 12, ...p }: IconProps) =>
  svg(<>
    <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72" />
    <path d="m14 7 3 3" /><path d="M5 6v4" /><path d="M19 14v4" />
    <path d="M10 2v2" /><path d="M7 8H3" /><path d="M21 16h-4" />
  </>, size, p.class);

export const GripVertical = ({ size = 13, ...p }: IconProps) =>
  svg(<>
    <circle cx="9" cy="12" r="1" /><circle cx="9" cy="5" r="1" /><circle cx="9" cy="19" r="1" />
    <circle cx="15" cy="12" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="15" cy="19" r="1" />
  </>, size, p.class);

export const EyeOff = ({ size = 12, ...p }: IconProps) =>
  svg(<>
    <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
    <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
    <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
    <path d="m2 2 20 20" />
  </>, size, p.class);

export const ImagePlus = ({ size = 24, ...p }: IconProps) =>
  svg(<>
    <path d="M16 5h6" /><path d="M19 2v6" />
    <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    <circle cx="9" cy="9" r="2" />
  </>, size, p.class);

export const Ban = ({ size = 12, ...p }: IconProps) =>
  svg(<><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></>, size, p.class);
