export type LightboxView = { scale: number; x: number; y: number };
export const INITIAL_LIGHTBOX_VIEW: LightboxView = { scale: 1, x: 0, y: 0 };

/** Scale around the image center without changing its drag offset. */
export function zoomLightbox(view: LightboxView, delta: number): LightboxView {
  if (!Number.isFinite(delta)) return view;
  const scale = Math.min(8, Math.max(0.25, view.scale * Math.exp(-delta * 0.0015)));
  if (scale === view.scale) return view;
  return { ...view, scale };
}
