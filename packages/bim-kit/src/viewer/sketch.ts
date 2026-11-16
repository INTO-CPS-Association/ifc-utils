/**
 * Drawing on the view: a pen, an arrow and a box, to point something out
 * in a screenshot or while sharing the screen.
 *
 * The drawing lies on a transparent canvas over the model, in screen pixels,
 * so it marks what is on screen now and does not follow the model when the
 * camera moves. While a tool is on, the canvas takes the mouse and the model
 * does not turn under the pen. Putting the tools away wipes the drawing.
 */

export type SketchTool = 'pen' | 'arrow' | 'box';

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  tool: SketchTool;
  points: Point[];
}

/** The colour of the drawing: the accent the labels use, so it reads on any background. */
export const SKETCH_COLOUR = '#d6336c';

/** The width of a line, in pixels. */
export const SKETCH_WIDTH_PX = 3;

/** The length of each side of an arrow head, in pixels. */
export const ARROW_HEAD_PX = 14;

/** The two ends of the head of an arrow from `from` to `to`. */
export function arrowHead(from: Point, to: Point, size = ARROW_HEAD_PX): [Point, Point] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const side = (turn: number) => ({
    x: to.x - size * Math.cos(angle + turn),
    y: to.y - size * Math.sin(angle + turn),
  });
  return [side(Math.PI / 6), side(-Math.PI / 6)];
}

/** The part of a 2D context drawing uses, so a test can record the calls. */
export interface Pen {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  stroke(): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  setTransform?(a: number, b: number, c: number, d: number, e: number, f: number): void;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
}

/** Draw one stroke. A pen line follows its points, an arrow and a box use the first and the last. */
export function drawStroke(pen: Pen, stroke: Stroke): void {
  const { points } = stroke;
  if (points.length < 2) return;
  const first = points[0];
  const last = points[points.length - 1];
  pen.beginPath();
  if (stroke.tool === 'box') {
    pen.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
    return;
  }
  if (stroke.tool === 'arrow') {
    pen.moveTo(first.x, first.y);
    pen.lineTo(last.x, last.y);
    const [one, two] = arrowHead(first, last);
    pen.moveTo(one.x, one.y);
    pen.lineTo(last.x, last.y);
    pen.lineTo(two.x, two.y);
  } else {
    pen.moveTo(first.x, first.y);
    for (const point of points.slice(1)) pen.lineTo(point.x, point.y);
  }
  pen.stroke();
}

export interface Sketch {
  /** Take up a tool, or put the tools away with null, which wipes the drawing. */
  setTool(tool: SketchTool | null): void;
  readonly strokes: readonly Stroke[];
  dispose(): void;
}

/** A drawing surface over `overlay`, the layer the marker labels live in. */
export function createSketch(overlay: HTMLElement): Sketch {
  const canvas = overlay.ownerDocument.createElement('canvas');
  canvas.dataset.bimSketch = '';
  canvas.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4');
  overlay.appendChild(canvas);
  const pen = canvas.getContext('2d') as Pen | null;
  const strokes: Stroke[] = [];
  let tool: SketchTool | null = null;
  let current: Stroke | null = null;

  const redraw = () => {
    if (!pen) return;
    // Sized to the device pixels, so a line is sharp on a retina screen, and
    // only when the box changed, since resizing a canvas reallocates it.
    const ratio = globalThis.devicePixelRatio || 1;
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    pen.setTransform?.(ratio, 0, 0, ratio, 0, 0);
    pen.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    pen.strokeStyle = SKETCH_COLOUR;
    pen.lineWidth = SKETCH_WIDTH_PX;
    pen.lineCap = 'round';
    pen.lineJoin = 'round';
    for (const stroke of strokes) drawStroke(pen, stroke);
  };

  const at = (event: PointerEvent): Point => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const down = (event: PointerEvent) => {
    if (!tool) return;
    current = { tool, points: [at(event)] };
    strokes.push(current);
    canvas.setPointerCapture?.(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!current) return;
    const point = at(event);
    // A pen keeps every point, while an arrow and a box only need where they end.
    if (current.tool === 'pen') current.points.push(point);
    else current.points[1] = point;
    redraw();
  };
  const up = () => { current = null; };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  return {
    setTool(next) {
      tool = next;
      // The canvas takes the mouse only while drawing, so the model can be
      // turned and clicked the rest of the time.
      canvas.style.pointerEvents = next ? 'auto' : 'none';
      canvas.style.cursor = next ? 'crosshair' : '';
      if (next === null) {
        strokes.length = 0;
        current = null;
        redraw();
      }
    },
    get strokes() {
      return strokes;
    },
    dispose() {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.remove();
    },
  };
}
