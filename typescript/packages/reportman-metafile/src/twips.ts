// Twips (Twips.cs): one inch is 1440 twips. The conversions that depend on the region of the
// computer and the translations (DefaultUnit, TranslateUnit, TextFromTwips...) belong to the
// host, which owns the locale, and are not here.

import type { Point } from './geometry.js';
import { roundHalfEven } from './numeric.js';

/** Twips per inch. */
export const TWIPS_PER_INCH = 1440;
/** Centimeters per inch. */
export const CMS_PER_INCH = 2.54;
/**
 * Twips per centimeter.
 * C# parity: C# computes in decimal (566.92913385826771653543307087); this is the double.
 */
export const TWIPS_PER_CM = TWIPS_PER_INCH / CMS_PER_INCH;

/** Measurement units (Units.cs). */
export enum Units {
  Inch = 0,
  Cms = 1,
}

function snap(n: number, grid: number): number {
  return (Math.trunc((n + Math.trunc(grid / 2)) / grid) * grid) | 0;
}

/** Snaps a coordinate to the nearest grid step (C# integer arithmetic; gridy is not used). */
export function alignToGridTwips(nx: number, gridx: number, _gridy?: number): number {
  return snap(nx, gridx);
}

/** Snaps a point to the nearest grid steps. */
export function alignPointToGridTwips(p: Point, gridx: number, gridy: number): Point {
  return { x: snap(p.x, gridx), y: snap(p.y, gridy) };
}

/** Twips to centimeters. */
export function twipsToCms(twips: number): number {
  return twips / TWIPS_PER_CM;
}

/** Twips to inches. */
export function twipsToInch(twips: number): number {
  return twips / TWIPS_PER_INCH;
}

/** Centimeters to twips, rounded to the nearest, ties to even (decimal Math.Round). */
export function cmsToTwips(cms: number): number {
  return roundHalfEven(TWIPS_PER_CM * cms) | 0;
}

/** Inches to twips, rounded to the nearest, ties to even (decimal Math.Round). */
export function inchToTwips(inch: number): number {
  return roundHalfEven(TWIPS_PER_INCH * inch) | 0;
}

/** Twips to a unit. */
export function unitsFromTwips(twips: number, unit: Units): number {
  return unit === Units.Cms ? twipsToCms(twips) : twipsToInch(twips);
}

/** A unit to twips. */
export function twipsFromUnits(measure: number, unit: Units): number {
  return unit === Units.Cms ? cmsToTwips(measure) : inchToTwips(measure);
}
