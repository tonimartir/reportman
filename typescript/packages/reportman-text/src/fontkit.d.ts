// The part of fontkit 3 this package uses. fontkit has no types of its own: the modules are
// declared here with opaque exports, and fonts/fontkitfont.ts describes the objects it reads.

declare module 'fontkit/core' {
  export function create(buffer: Uint8Array, postscriptName?: string): unknown;
  export function registerFormat(format: unknown): void;
  export function registerShaper(shaper: unknown, scripts?: string[]): void;
}

declare module 'fontkit/formats/TTFFont' {
  export const TTFFont: unknown;
  export const TTFGlyph: unknown;
}

declare module 'fontkit/formats/TrueTypeCollection' {
  export const TrueTypeCollection: unknown;
}

declare module 'fontkit/shapers/DefaultShaper' {
  export const DefaultShaper: unknown;
}
declare module 'fontkit/shapers/ArabicShaper' {
  export const ArabicShaper: unknown;
}
declare module 'fontkit/shapers/HangulShaper' {
  export const HangulShaper: unknown;
}
declare module 'fontkit/shapers/HebrewShaper' {
  export const HebrewShaper: unknown;
}
declare module 'fontkit/shapers/IndicShaper' {
  export const IndicShaper: unknown;
}
declare module 'fontkit/shapers/MyanmarShaper' {
  export const MyanmarShaper: unknown;
}
declare module 'fontkit/shapers/ThaiShaper' {
  export const ThaiShaper: unknown;
}
declare module 'fontkit/shapers/UniversalShaper' {
  export const UniversalShaper: unknown;
}
