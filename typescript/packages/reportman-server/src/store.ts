// The reports of each alias as .rep files under its folder (FolderReportStore of Reportman.Server,
// the way repwebexe serves them and the Delphi designer has always saved them): the tree of an
// alias and a report by its path, which can never leave the folder; saving with an ETag so two
// people cannot silently overwrite each other, atomic writes, and the last versions of every report
// kept in a .versions subfolder.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

/** A folder in the tree of an alias (ReportFolderNode). */
export interface ReportFolderNode {
  name: string;
  /** Relative to the alias folder, forward slashes, empty for the root. */
  path: string;
  folders: ReportFolderNode[];
  reports: ReportEntry[];
}

/** A .rep file as listed (ReportEntry). */
export interface ReportEntry {
  name: string;
  /** Relative to the alias folder, forward slashes, with the .rep extension. */
  path: string;
  size: number;
  /** ISO 8601 in UTC, to the 100 ns of .NET. */
  modifiedUtc: string;
}

/** A report as stored (StoredReport). */
export interface StoredReport {
  alias: string;
  /** Relative to the alias folder, forward slashes, with the .rep extension. */
  path: string;
  content: Uint8Array;
  /** The version tag of the content (StoredReport.ETagOf). */
  eTag: string;
  /** ISO 8601 in UTC, to the 100 ns of .NET. */
  modifiedUtc: string;
}

/** Options of a FolderReportStore. */
export interface FolderReportStoreOptions {
  /** How many previous versions of a report the store keeps next to it in .versions (10; 0 none). */
  versionsToKeep?: number;
}

/** What failed in the store, for a caller that answers in its own way (the designer's errorMessage). */
export type ServerErrorKind = 'notFound' | 'conflict' | 'unknownAlias' | 'invalid' | 'other';

/** The error of a request: its HTTP status and the message Reportman.Server gives. */
export class ServerError extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown>;
  readonly kind: ServerErrorKind;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}, kind: ServerErrorKind = 'other') {
    super(message);
    this.name = 'ServerError';
    this.status = status;
    this.extra = extra;
    this.kind = kind;
  }
}

const EXTENSION = '.rep';
// Kept versions of a saved report (Reportman.Server): never listed nor opened
const VERSIONS = '.versions';
const byName = (a: string, b: string): number => (a.toUpperCase() < b.toUpperCase() ? -1 : a.toUpperCase() > b.toUpperCase() ? 1 : 0);

/** The version tag of a report's bytes: the first 24 hex digits of their SHA-256, as Reportman.Server. */
export function eTagOf(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 24);
}

/**
 * The last write time of a file as System.Text.Json writes a UTC DateTime: to the 100 ns of a
 * .NET tick, the trailing zeros of the fraction left out ("2026-11-21T11:53:39.6476223Z").
 */
export function modifiedUtcOf(file: string): string {
  const ns = statSync(file, { bigint: true }).mtimeNs;
  const seconds = ns / 1_000_000_000n;
  const ticks = (ns % 1_000_000_000n) / 100n;
  const whole = new Date(Number(seconds) * 1000).toISOString().substring(0, 19);
  const fraction = ticks.toString().padStart(7, '0').replace(/0+$/, '');
  return whole + (fraction.length === 0 ? '' : '.' + fraction) + 'Z';
}

/** ReportNotFoundException. */
function notFound(relative: string): ServerError {
  return new ServerError(404, `'${relative}' does not exist.`, {}, 'notFound');
}

/** ReportStoreConflictException. */
function conflict(relative: string): ServerError {
  return new ServerError(409, `'${relative}' was modified by someone else; reload it before saving.`, {}, 'conflict');
}

/** Folders of .rep files by alias. */
export class FolderReportStore {
  private readonly source: () => Readonly<Record<string, string>>;
  private readonly versionsToKeep: number;

  /** The aliases and their folders, or a function that gives them as they are now. */
  constructor(aliases: Readonly<Record<string, string>> | (() => Readonly<Record<string, string>>), options: FolderReportStoreOptions = {}) {
    this.source = typeof aliases === 'function' ? aliases : () => aliases;
    this.versionsToKeep = Math.max(0, options.versionsToKeep ?? 10);
  }

  private folders(): Map<string, string> {
    return new Map(Object.entries(this.source()).map(([alias, folder]) => [alias.toUpperCase(), path.resolve(folder)]));
  }

  /** The aliases, in name order (ignoring the case). */
  listAliases(): string[] {
    return Object.keys(this.source()).sort(byName);
  }

  /** The configured name of an alias (as written in the options), or null. */
  aliasName(alias: string): string | null {
    return this.listAliases().find((n) => n.toUpperCase() === alias.toUpperCase()) ?? null;
  }

  private root(alias: string): string {
    const folder = alias.trim().length === 0 ? undefined : this.folders().get(alias.toUpperCase());
    if (folder === undefined) throw new ServerError(404, `Alias '${alias}' is not configured.`, {}, 'unknownAlias');
    return folder;
  }

  /** GetTree: the folders (not the hidden ones) and the reports, each in name order. */
  getTree(alias: string): ReportFolderNode {
    const root = this.root(alias);
    const build = (folder: string, relative: string): ReportFolderNode => {
      const node: ReportFolderNode = { name: relative.length === 0 ? '' : path.basename(folder), path: relative, folders: [], reports: [] };
      const entries = readdirSync(folder, { withFileTypes: true });
      for (const d of entries.filter((e) => e.isDirectory()).map((e) => e.name).sort(byName)) {
        if (d.startsWith('.')) continue;
        node.folders.push(build(path.join(folder, d), relative.length === 0 ? d : relative + '/' + d));
      }
      for (const f of entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(EXTENSION)).map((e) => e.name).sort(byName)) {
        const file = path.join(folder, f);
        node.reports.push({
          name: f.substring(0, f.length - EXTENSION.length),
          path: relative.length === 0 ? f : relative + '/' + f,
          size: statSync(file).size,
          modifiedUtc: modifiedUtcOf(file),
        });
      }
      return node;
    };
    return build(root, '');
  }

  /** ResolveFile: the file of a report path ('.rep' added when missing) inside the alias folder. */
  private resolve(alias: string, reportPath: string): { file: string; relative: string } {
    const root = this.root(alias);
    let cleaned = (reportPath ?? '').replace(/\\/g, '/').trim().replace(/^\/+/, '');
    if (cleaned.length === 0) throw new ServerError(400, 'A report path is required.', {}, 'invalid');
    if (!cleaned.toLowerCase().endsWith(EXTENSION)) cleaned += EXTENSION;
    if (cleaned.split('/').some((part) => part === '..' || part === '.' || part.length === 0 || part.toLowerCase() === VERSIONS))
      throw new ServerError(400, 'Invalid report path.', {}, 'invalid');
    const file = path.resolve(root, cleaned);
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (!file.toUpperCase().startsWith(rootWithSep.toUpperCase())) throw new ServerError(400, 'Invalid report path.', {}, 'invalid');
    return { file, relative: cleaned };
  }

  /** Open: the bytes of a report, its relative path and its version tag. */
  open(alias: string, reportPath: string): StoredReport {
    const { file, relative } = this.resolve(alias, reportPath);
    if (!existsSync(file) || !statSync(file).isFile()) throw notFound(relative);
    const content = new Uint8Array(readFileSync(file));
    return { alias, path: relative, content, eTag: eTagOf(content), modifiedUtc: modifiedUtcOf(file) };
  }

  /**
   * Save: writes a report. Without an expected tag the report must not exist (409 when it does);
   * with one it must exist (404) and still have that tag (409 when someone else saved it), and the
   * version it replaces is kept in .versions.
   */
  save(alias: string, reportPath: string, content: Uint8Array, expectedETag: string | null): StoredReport {
    const { file, relative } = this.resolve(alias, reportPath);
    mkdirSync(path.dirname(file), { recursive: true });
    const exists = existsSync(file);
    if (expectedETag === null) {
      if (exists) throw conflict(relative);
    } else {
      if (!exists) throw notFound(relative);
      if (eTagOf(new Uint8Array(readFileSync(file))) !== expectedETag) throw conflict(relative);
      this.keepVersion(file);
    }
    // Atomic: readers see the old file or the new one, never half of it
    const temp = file + '.tmp-' + randomUUID().replaceAll('-', '');
    writeFileSync(temp, content);
    renameSync(temp, file);
    return { alias, path: relative, content, eTag: eTagOf(content), modifiedUtc: modifiedUtcOf(file) };
  }

  /** Delete: removes a report, its last version kept in .versions. */
  delete(alias: string, reportPath: string): void {
    const { file, relative } = this.resolve(alias, reportPath);
    if (!existsSync(file)) throw notFound(relative);
    this.keepVersion(file);
    rmSync(file);
  }

  /** Rename: moves a report to another path of its alias (409 when that one exists). */
  rename(alias: string, reportPath: string, newPath: string): void {
    const from = this.resolve(alias, reportPath);
    const to = this.resolve(alias, newPath);
    if (!existsSync(from.file)) throw notFound(from.relative);
    if (existsSync(to.file)) throw conflict(to.relative);
    mkdirSync(path.dirname(to.file), { recursive: true });
    renameSync(from.file, to.file);
  }

  /** KeepVersion: copies the current file into .versions and prunes to the configured count. */
  private keepVersion(file: string): void {
    if (this.versionsToKeep === 0) return;
    try {
      const dir = path.join(path.dirname(file), VERSIONS);
      mkdirSync(dir, { recursive: true });
      // yyyyMMddHHmmssfff in UTC
      const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').substring(0, 17);
      const base = path.basename(file).replace(/\.rep$/i, '');
      copyFileSync(file, path.join(dir, `${base}.${stamp}${EXTENSION}`));
      const prefix = (base + '.').toUpperCase();
      const old = readdirSync(dir)
        .filter((f) => f.toUpperCase().startsWith(prefix) && f.toLowerCase().endsWith(EXTENSION))
        .sort()
        .reverse()
        .slice(this.versionsToKeep);
      for (const f of old) rmSync(path.join(dir, f));
    } catch {
      // A version that cannot be kept does not stop the save (Reportman.Server logs it)
    }
  }
}
