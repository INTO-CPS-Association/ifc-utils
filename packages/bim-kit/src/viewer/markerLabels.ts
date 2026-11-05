/**
 * The name and value printed beside each sensor marker.
 *
 * Labels are plain elements laid over the canvas and not textures in the
 * scene, so the browser draws the text at the screen's own resolution and a
 * page can read it, select it and test it. They never take a click, which
 * stays with the model under them.
 *
 * The colours are CSS custom properties that the canvas sets from the host's
 * theme, so a label is a light box with dark text in a light theme and a dark
 * box with light text in a dark one. Either way it is a filled box with its
 * own border, so it reads against the grey of the model behind it.
 */

/** How far above its marker a label sits, in pixels, so it does not cover the dot. */
export const LABEL_OFFSET_PX = 14;

const BASE_STYLE = [
  'position:absolute', 'left:0', 'top:0', 'pointer-events:none', 'white-space:nowrap',
  'font:12px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
  'padding:1px 6px', 'border-radius:4px',
  'background:var(--bim-label-bg,#ffffff)', 'color:var(--bim-label-fg,#1f2933)',
  'border:1px solid var(--bim-label-border,#5f6b76)',
].join(';');

/** A point on screen, in pixels from the top left of the canvas. */
export interface ScreenPoint {
  x: number;
  y: number;
  /** False when the point is behind the camera or beyond the far plane. */
  visible: boolean;
}

/**
 * Where a projected point lands on a canvas of `width` by `height` pixels.
 *
 * `ndc` is the point after `Vector3.project`, so each axis runs from -1 to 1
 * inside the view. A depth outside that range is behind the camera or past
 * the far plane and a label there would float over the wrong thing.
 */
export function toScreen(
  ndc: { x: number; y: number; z: number },
  width: number,
  height: number,
): ScreenPoint {
  return {
    x: ((ndc.x + 1) / 2) * width,
    y: ((1 - ndc.y) / 2) * height,
    visible: ndc.z >= -1 && ndc.z <= 1,
  };
}

/** A new, empty label element, ready to be placed in the overlay. */
export function createLabel(document: Document, title: string): HTMLElement {
  const label = document.createElement('div');
  label.setAttribute('style', BASE_STYLE);
  label.dataset.bimLabel = '';
  // The full label of the binding, for a person who hovers the short tag.
  label.title = title;
  return label;
}

/** How a label looks: selected is outlined in the accent colour and drawn on top. */
export function styleLabel(label: HTMLElement, selected: boolean, live: boolean): void {
  const { style } = label;
  style.borderWidth = selected ? '2px' : '1px';
  style.borderColor = selected ? 'var(--bim-label-accent,#1565c0)' : 'var(--bim-label-border,#5f6b76)';
  style.fontWeight = selected ? '600' : '400';
  style.zIndex = selected ? '2' : '1';
  // Faded the way the card of a reading that is not current is faded.
  style.opacity = live ? '1' : '0.7';
  label.dataset.selected = String(selected);
}

/** Put a label above a point on screen, or hide it. */
export function placeLabel(label: HTMLElement, at: ScreenPoint, shown: boolean): void {
  const { style } = label;
  style.display = shown && at.visible ? 'block' : 'none';
  style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) `
    + `translate(-50%, calc(-100% - ${LABEL_OFFSET_PX}px))`;
}
