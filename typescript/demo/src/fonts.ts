// The fonts of the demo: open fonts in WOFF2 (public/fonts, with their licences), chosen by the
// Linux family names the reports carry (LFontName), as Report Manager chooses them on Linux.
// Arial and Helvetica are Liberation Sans, Courier New is Liberation Mono; the sample of
// international text names DejaVu Sans and the Noto fonts of its scripts. A report only downloads
// the fonts it needs.
import { FontLibrary, memoryFontFile } from '@reportman/text';
import type { Report } from '@reportman/lib';

/** The fonts every report gets: the sans serif and monospaced faces of the standard fonts. */
const BASE = [
  'LiberationSans-Regular',
  'LiberationSans-Bold',
  'LiberationSans-Italic',
  'LiberationSans-BoldItalic',
  'LiberationMono-Regular',
  'LiberationMono-Bold',
];

/** The fonts of other scripts, by the family a report names. */
const FAMILIES: Record<string, string[]> = {
  'DEJAVU SANS': ['DejaVuSans', 'DejaVuSans-Bold'],
  'NOTO SANS ARABIC': ['NotoSansArabic-Regular', 'NotoSansArabic-Bold'],
  'NOTO SANS HEBREW': ['NotoSansHebrew-Regular', 'NotoSansHebrew-Bold'],
  'NOTO SANS DEVANAGARI': ['NotoSansDevanagari-Regular', 'NotoSansDevanagari-Bold'],
  'NOTO SANS THAI': ['NotoSansThai-Regular', 'NotoSansThai-Bold'],
  // Subset to the characters of the samples: the whole font is 16 MB
  'NOTO SANS CJK JP': ['NotoSansCJKjp-Regular-subset', 'NotoSansCJKjp-Bold-subset'],
};

/** Every font file of the demo (for the check, which compares with Node on the same files). */
export const ALL_FONTS = [...BASE, ...Object.values(FAMILIES).flat()];

/** The font files a report needs: the base ones and those of the families it names. */
export function fontsOf(model: Report): string[] {
  const names = new Set<string>();
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) value.forEach(visit);
    else
      for (const [k, v] of Object.entries(value)) {
        if (k === 'lFontName' && typeof v === 'string') names.add(v.trim().toUpperCase());
        else visit(v);
      }
  };
  visit(model);
  const files = [...BASE];
  for (const name of names) for (const f of FAMILIES[name] ?? []) if (!files.includes(f)) files.push(f);
  return files;
}

const cache = new Map<string, Promise<Uint8Array>>();

/** The bytes of a font file of the demo, downloaded once. */
function fontBytes(base: string, name: string): Promise<Uint8Array> {
  let p = cache.get(name);
  if (p === undefined) {
    p = fetch(`${base}fonts/${name}.woff2`).then(async (r) => {
      if (!r.ok) throw new Error(`fonts/${name}.woff2: ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    });
    cache.set(name, p);
    p.catch(() => cache.delete(name));
  }
  return p;
}

const libraries = new Map<string, Promise<FontLibrary>>();

/**
 * The font library of the files given, with the Linux family names (LFontName) of the reports,
 * scanned once per set of files (the runs take clones, as fontLibrary of @reportman/node gives).
 */
export function fontLibraryOf(base: string, files: readonly string[]): Promise<FontLibrary> {
  const sorted = [...files].sort();
  const key = sorted.join('\n');
  let lib = libraries.get(key);
  if (lib === undefined) {
    lib = Promise.all(sorted.map(async (f) => memoryFontFile(f + '.woff2', await fontBytes(base, f)))).then((sources) => {
      const library = new FontLibrary(sources, { platform: 'unix' });
      library.ensureScanned();
      return library;
    });
    libraries.set(key, lib);
    lib.catch(() => libraries.delete(key));
  }
  return lib;
}
