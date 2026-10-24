import { describe, expect, it, vi } from 'vitest';

import { cameraSupported, startCamera, stopCamera } from '../lib/capture/camera/capture.ts';
import {
  CAMERA_COMMAND_ID,
  cameraHref,
  registerCameraCommand,
  wantsCamera,
} from '../lib/capture/camera/command-registration.ts';
import {
  applyHomography,
  defaultCorners,
  outputSize,
  solveHomography,
  suggestCorners,
  validQuad,
  warpPerspective,
  type Quad,
} from '../lib/capture/camera/deskew.ts';
import {
  assessQuality,
  fitWithin,
  glareFraction,
  hintFor,
  laplacianVariance,
  MAX_LONG_EDGE,
  JPEG_QUALITY,
} from '../lib/capture/camera/process-image.ts';
import { commandsSnapshot } from '../lib/commands/registry.ts';

function checkerboard(width: number, height: number, cell: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      gray[y * width + x] = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? 255 : 0;
    }
  }
  return gray;
}

describe('downscale', () => {
  it('fits the long edge to 2000 px at JPEG 0.85 and never enlarges', () => {
    expect(MAX_LONG_EDGE).toBe(2000);
    expect(JPEG_QUALITY).toBe(0.85);
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1500, height: 2000 });
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 });
  });
});

describe('sharpness and glare checks', () => {
  it('rates a sharp page above a blurred one by the variance of the Laplacian', () => {
    const sharp = checkerboard(64, 64, 4);
    const blurred = new Uint8ClampedArray(64 * 64).fill(128);
    expect(laplacianVariance(sharp, 64, 64)).toBeGreaterThan(laplacianVariance(blurred, 64, 64));
    expect(laplacianVariance(blurred, 64, 64)).toBe(0);
  });

  it('hints before upload: blur first, then glare, else nothing', () => {
    const rgba = (gray: Uint8ClampedArray) => {
      const out = new Uint8ClampedArray(gray.length * 4);
      gray.forEach((v, i) => out.fill(v, i * 4, i * 4 + 3));
      for (let i = 3; i < out.length; i += 4) out[i] = 255;
      return out;
    };
    const flat = new Uint8ClampedArray(64 * 64).fill(128);
    expect(hintFor(assessQuality(rgba(flat), 64, 64))).toBe('blurry');
    expect(hintFor(assessQuality(rgba(checkerboard(64, 64, 4)), 64, 64))).toBe('glare');
    const mixed = checkerboard(64, 64, 4).map((v, i) =>
      i % 17 === 0 ? 128 : v === 255 ? 200 : 40,
    );
    expect(hintFor(assessQuality(rgba(mixed), 64, 64))).toBeNull();
    expect(glareFraction(new Uint8ClampedArray([255, 255, 0, 0]))).toBe(0.5);
  });
});

describe('perspective correction', () => {
  const quad: Quad = [
    { x: 10, y: 20 },
    { x: 110, y: 10 },
    { x: 120, y: 160 },
    { x: 0, y: 150 },
  ];

  it('maps the four corners onto an upright rectangle', () => {
    const { width, height } = outputSize(quad);
    const rect: Quad = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ];
    const h = solveHomography(quad, rect);
    expect(h).not.toBeNull();
    quad.forEach((corner, i) => {
      const p = applyHomography(h as number[], corner.x, corner.y);
      expect(p.x).toBeCloseTo(rect[i]?.x ?? NaN, 4);
      expect(p.y).toBeCloseTo(rect[i]?.y ?? NaN, 4);
    });
  });

  it('warps a quad of the source into the requested size', () => {
    const src = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(200) };
    const out = warpPerspective(src, defaultCorners(8, 8, 0), { width: 4, height: 4 });
    expect(out.width).toBe(4);
    expect(out.data[0]).toBe(200);
    expect(out.data[3]).toBe(255);
  });

  it('suggests the frame when no page is found, and rejects collapsed or crossed corners', () => {
    const flat = new Uint8ClampedArray(100 * 100).fill(100);
    expect(suggestCorners(flat, 100, 100)).toEqual(defaultCorners(100, 100));
    expect(validQuad(quad)).toBe(true);
    expect(validQuad([quad[0], quad[2], quad[1], quad[3]] as unknown as Quad)).toBe(false);
  });
});

describe('camera access', () => {
  const nav = (getUserMedia?: () => Promise<MediaStream>) =>
    ({
      mediaDevices: getUserMedia === undefined ? undefined : { getUserMedia },
    }) as unknown as Navigator;

  it('asks for the rear camera and falls back where it is missing or denied', async () => {
    const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
    const ask = vi.fn(() => Promise.resolve(stream));
    expect(cameraSupported(nav(ask))).toBe(true);
    expect(await startCamera(nav(ask))).toEqual({ kind: 'stream', stream });
    expect(ask).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    expect(await startCamera(nav())).toEqual({ kind: 'unavailable' });
    const denied = () => Promise.reject(new DOMException('no', 'NotAllowedError'));
    expect(await startCamera(nav(denied))).toEqual({ kind: 'denied' });
    const broken = () => Promise.reject(new Error('boom'));
    expect(await startCamera(nav(broken))).toEqual({ kind: 'error' });
  });

  it('stops every track on close', () => {
    const stop = vi.fn();
    stopCamera({ getTracks: () => [{ stop }, { stop }] } as unknown as MediaStream);
    expect(stop).toHaveBeenCalledTimes(2);
  });
});

describe('command', () => {
  it('registers "Photograph a diary page" once and navigates to ?capture=camera', () => {
    const remove = registerCameraCommand(() => '/w/acme/today?x=1');
    registerCameraCommand(() => '/w/acme/today?x=1');
    const found = commandsSnapshot().filter((c) => c.id === CAMERA_COMMAND_ID);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ labelKey: 'camera.command', group: 'create' });
    const navigate = vi.fn();
    void found[0]?.perform({ slug: 'acme', workspaceId: 'w', navigate, close: vi.fn() });
    expect(navigate).toHaveBeenCalledWith('/w/acme/today?x=1&capture=camera');
    remove();
    expect(commandsSnapshot().some((c) => c.id === CAMERA_COMMAND_ID)).toBe(false);
  });

  it('reads the query parameter', () => {
    expect(cameraHref('/a')).toBe('/a?capture=camera');
    expect(wantsCamera('?capture=camera')).toBe(true);
    expect(wantsCamera('?capture=other')).toBe(false);
  });
});
