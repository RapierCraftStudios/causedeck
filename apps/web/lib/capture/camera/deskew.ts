// Client-side perspective correction (#52): a homography from the four corners the person placed
// (or the suggested ones) to an upright rectangle, applied with bilinear sampling. Pure math on
// pixel arrays so it runs in a Web Worker or in tests; nothing here touches the DOM.

export interface Point {
  x: number;
  y: number;
}

/** Top-left, top-right, bottom-right, bottom-left. */
export type Quad = readonly [Point, Point, Point, Point];

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** The suggested corners when nothing better is known: the whole frame, a hair inside. */
export function defaultCorners(width: number, height: number, inset = 0.04): Quad {
  const dx = width * inset;
  const dy = height * inset;
  return [
    { x: dx, y: dy },
    { x: width - dx, y: dy },
    { x: width - dx, y: height - dy },
    { x: dx, y: height - dy },
  ];
}

/**
 * Suggested corners from the bright page: the bounding box of pixels above the mean brightness
 * plus a margin. Never mandatory: when it finds nothing sensible it returns the frame corners.
 */
export function suggestCorners(gray: Uint8ClampedArray, width: number, height: number): Quad {
  let sum = 0;
  for (const value of gray) sum += value;
  const threshold = Math.min(235, sum / Math.max(1, gray.length) + 20);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if ((gray[y * width + x] ?? 0) >= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const coversEnough = maxX - minX > width * 0.3 && maxY - minY > height * 0.3;
  if (!coversEnough) return defaultCorners(width, height);
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

/** Solve `A x = b` (n x n) by Gaussian elimination with partial pivoting; null when singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] ?? 0]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(m[row]?.[col] ?? 0) > Math.abs(m[pivot]?.[col] ?? 0)) pivot = row;
    }
    const pivotRow = m[pivot];
    if (pivotRow === undefined || Math.abs(pivotRow[col] ?? 0) < 1e-12) return null;
    [m[col], m[pivot]] = [pivotRow, m[col] as number[]];
    for (let row = col + 1; row < n; row += 1) {
      const current = m[row] as number[];
      const factor = (current[col] ?? 0) / ((m[col] as number[])[col] ?? 1);
      for (let k = col; k <= n; k += 1)
        current[k] = (current[k] ?? 0) - factor * ((m[col] as number[])[k] ?? 0);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    const current = m[row] as number[];
    let value = current[n] ?? 0;
    for (let k = row + 1; k < n; k += 1) value -= (current[k] ?? 0) * (x[k] ?? 0);
    x[row] = value / (current[row] ?? 1);
  }
  return x;
}

/** The 3x3 homography (row-major, h22 = 1) taking each `from` point to its `to` point. */
export function solveHomography(from: Quad, to: Quad): number[] | null {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = from[i] as Point;
    const { x: u, y: v } = to[i] as Point;
    a.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  const h = solve(a, b);
  return h === null ? null : [...h, 1];
}

export function applyHomography(h: readonly number[], x: number, y: number): Point {
  const w = (h[6] ?? 0) * x + (h[7] ?? 0) * y + (h[8] ?? 1);
  return {
    x: ((h[0] ?? 0) * x + (h[1] ?? 0) * y + (h[2] ?? 0)) / w,
    y: ((h[3] ?? 0) * x + (h[4] ?? 0) * y + (h[5] ?? 0)) / w,
  };
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The size of the upright page: the longer of each pair of opposite edges. */
export function outputSize(quad: Quad): { width: number; height: number } {
  return {
    width: Math.max(
      1,
      Math.round(Math.max(distance(quad[0], quad[1]), distance(quad[3], quad[2]))),
    ),
    height: Math.max(
      1,
      Math.round(Math.max(distance(quad[0], quad[3]), distance(quad[1], quad[2]))),
    ),
  };
}

function sample(src: Pixels, x: number, y: number, channel: number): number {
  const x0 = Math.min(src.width - 1, Math.max(0, Math.floor(x)));
  const y0 = Math.min(src.height - 1, Math.max(0, Math.floor(y)));
  const x1 = Math.min(src.width - 1, x0 + 1);
  const y1 = Math.min(src.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const at = (px: number, py: number) => src.data[(py * src.width + px) * 4 + channel] ?? 0;
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Warp the quad of `src` onto an upright `width` x `height` rectangle (bilinear). */
export function warpPerspective(src: Pixels, quad: Quad, size = outputSize(quad)): Pixels {
  const { width, height } = size;
  const rect: Quad = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  // Map each output pixel back into the source.
  const h = solveHomography(rect, quad);
  const data = new Uint8ClampedArray(width * height * 4);
  if (h === null) return { data, width, height };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = applyHomography(h, x + 0.5, y + 0.5);
      const at = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1)
        data[at + channel] = sample(src, p.x, p.y, channel);
      data[at + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Whether the corners form a usable quadrilateral (not collapsed, not self-crossing). */
export function validQuad(quad: Quad): boolean {
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  const signs = [
    cross(quad[0], quad[1], quad[2]),
    cross(quad[1], quad[2], quad[3]),
    cross(quad[2], quad[3], quad[0]),
    cross(quad[3], quad[0], quad[1]),
  ];
  return signs.every((s) => s > 1) || signs.every((s) => s < -1);
}
