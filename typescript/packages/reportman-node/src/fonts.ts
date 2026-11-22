// The font files of the TrueType provider, the way FontInfoFt finds them where there is no
// fontconfig (GetFontDirectories and FicherosDeFuentes): the application's own folders first, then
// the folders of the system; in each folder, recursively, the TrueType files, then Type 1, then the
// collections, then OpenType.

import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { FontLibrary, type FontFileSource, type FontPlatform } from '@reportman/text';

/** Which fonts the PDF of a report embeds (the FreeType driver of the C# engine). */
export interface FontOptions {
  /** Scan the font folders of the system (true by default). */
  systemFolders?: boolean;
  /** More folders, scanned before the system ones (FontInfoFt.ExtraFontDirectories). */
  folders?: readonly string[];
  /**
   * Whose family names the fonts are chosen by: the platform of the process by default ('windows'
   * takes the WFontName of a report, 'unix' and 'macos' its LFontName).
   */
  platform?: FontPlatform;
}

/** The platform of the process, as the C# engine sees it. */
export function currentFontPlatform(): FontPlatform {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'unix';
}

/** A font file read on demand from the disk. */
export function diskFontFile(file: string): FontFileSource {
  return {
    path: file,
    read(offset: number, length: number): Uint8Array {
      const fd = openSync(file, 'r');
      try {
        const buf = new Uint8Array(length);
        const n = readSync(fd, buf, 0, length, offset);
        return n === length ? buf : buf.subarray(0, n);
      } finally {
        closeSync(fd);
      }
    },
    readAll(): Uint8Array {
      return new Uint8Array(readFileSync(file));
    },
  };
}

/** The font folders of a platform without fontconfig (GetFontDirectories), extra folders first. */
export function fontDirectories(platform: FontPlatform, extra: readonly string[] = [], system = true): string[] {
  const dirs: string[] = [...extra];
  if (system) {
    if (platform === 'macos') {
      dirs.push('/Library/Fonts');
      const home = homedir();
      if (home !== '') dirs.push(path.join(home, 'Library', 'Fonts'));
      dirs.push('/System/Library/Fonts');
    } else if (platform === 'unix') {
      const add = (d: string): void => {
        if (!dirs.includes(d)) dirs.push(d);
      };
      let conf: string | null = null;
      if (existsSync('/etc/fonts/fonts.conf')) {
        try {
          conf = readFileSync('/etc/fonts/fonts.conf', 'utf8');
        } catch {
          conf = null;
        }
      }
      if (conf === null) {
        add('/usr/share/fonts');
        add('/usr/local/share/fonts');
        add('/system/fonts');
        add('/system/font');
        add('/data/fonts');
        const home = homedir();
        if (home !== '') {
          add(path.join(home, '.fonts'));
          add(path.join(home, '.local', 'share', 'fonts'));
        }
      } else {
        // The <dir> entries of fonts.conf, read as the C# engine reads them
        const lines = conf.replaceAll('\r\n', '\n').split('\n');
        let nstring = lines.join(';') + ';';
        let index = nstring.indexOf('<dir');
        if (index >= 0) nstring = nstring.substring(index + 4);
        index = nstring.indexOf('>');
        if (index >= 0) nstring = nstring.substring(index + 1);
        index = nstring.indexOf('</dir');
        while (index >= 0) {
          dirs.push(nstring.substring(0, index));
          nstring = nstring.substring(index + 4);
          index = nstring.indexOf('<dir');
          if (index >= 0) nstring = nstring.substring(index + 4);
          index = nstring.indexOf('>');
          if (index >= 0) nstring = nstring.substring(index + 1);
          index = nstring.indexOf('</dir');
        }
        add('/usr/share/fonts');
        add('/usr/local/share/fonts');
      }
    } else {
      const windir = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
      dirs.push(path.join(windir, 'FONTS') + path.sep);
      const local = process.env.LOCALAPPDATA;
      if (local !== undefined && local !== '') {
        const userFonts = path.join(local, 'Microsoft', 'Windows', 'Fonts');
        if (existsSync(userFonts)) dirs.push(userFonts);
      }
    }
  }
  const result: string[] = [];
  for (const d of dirs) if (d !== '' && !result.includes(d)) result.push(d);
  return result;
}

/** The files of a folder matching a pattern, recursively (subfolders after the files), unreadable ones skipped. */
function filesMatching(root: string, test: (name: string) => boolean): string[] {
  const out: string[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.shift() as string;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) queue.push(full);
      else if (test(e.name.toLowerCase())) out.push(full);
    }
  }
  return out;
}

/** The font files of the folders, in the order of the C# scan (FicherosDeFuentes per folder). */
export function fontFiles(dirs: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const patterns: ((n: string) => boolean)[] = [
    (n) => n.endsWith('.ttf'),
    (n) => n.includes('.pf'),
    (n) => n.endsWith('.ttc'),
    (n) => n.endsWith('.otf'),
    // WOFF and WOFF2 web fonts last, after the order of the C# scan
    (n) => n.endsWith('.woff'),
    (n) => n.endsWith('.woff2'),
  ];
  for (const dir of dirs) {
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const p of patterns)
      for (const f of filesMatching(dir, p)) {
        if (seen.has(f)) continue;
        seen.add(f);
        result.push(f);
      }
  }
  return result;
}

const libraries = new Map<string, FontLibrary>();

/**
 * The font library of a set of font folders, scanned once per process; each call gives a clone,
 * with the faces scanned and none of the state other reports left.
 */
export function fontLibrary(options: FontOptions = {}): FontLibrary {
  const platform = options.platform ?? currentFontPlatform();
  const dirs = fontDirectories(platform, (options.folders ?? []).map((d) => path.resolve(d)), options.systemFolders ?? true);
  const key = platform + '\n' + dirs.join('\n');
  let lib = libraries.get(key);
  if (lib === undefined) {
    lib = new FontLibrary(
      fontFiles(dirs).map((f) => diskFontFile(f)),
      { platform },
    );
    lib.ensureScanned();
    libraries.set(key, lib);
  }
  return lib.clone();
}
