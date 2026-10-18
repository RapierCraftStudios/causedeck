// Minimal types for the parts of apca-w3 (no bundled types) that check-contrast.ts uses.
declare module 'apca-w3' {
  export function APCAcontrast(txtY: number, bgY: number, places?: number): number | string;
  export function sRGBtoY(rgb: readonly number[]): number;
}
