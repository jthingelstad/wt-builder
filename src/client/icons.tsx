/** Lucide glyphs, inlined as SVG (github.md: icon set of record). */

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

export const X = ({ size = 13, ...p }: IconProps) =>
  svg(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>, size, p.class);

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

export const Spinner = ({ size = 14, ...p }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" style="flex:none;display:block;animation:spin 1s linear infinite" class={p.class}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);
