// The reports of each alias as .rep files under its folder (FolderReportStore of Reportman.Server,
// the way repwebexe serves them): the tree of an alias and a report by its path, which can never
// leave the folder.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
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
  /** ISO 8601 in UTC. */
  modifiedUtc: string;
}

/** The error of a request: its HTTP status and the message Reportman.Server gives. */
export class ServerError extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ServerError';
    this.status = status;
    this.extra = extra;
  }
}

const EXTENSION = '.rep';
// Kept versions of a saved report (Reportman.Server): never listed nor opened
const VERSIONS = '.versions';
const byName = (a: string, b: string): number => (a.toUpperCase() < b.toUpperCase() ? -1 : a.toUpperCase() > b.toUpperCase() ? 1 : 0);

/** Folders of .rep files by alias. */
export class FolderReportStore {
  private readonly folders: Map<string, string>;

  constructor(aliases: Readonly<Record<string, string>>) {
    this.folders = new Map(Object.entries(aliases).map(([alias, folder]) => [alias.toUpperCase(), path.resolve(folder)]));
    this.names = Object.keys(aliases).sort(byName);
  }

  private readonly names: string[];

  /** The aliases, in name order (ignoring the case). */
  listAliases(): string[] {
    return [...this.names];
  }

  /** The configured name of an alias (as written in the options), or null. */
  aliasName(alias: string): string | null {
    return this.names.find((n) => n.toUpperCase() === alias.toUpperCase()) ?? null;
  }

  private root(alias: string): string {
    const folder = alias.trim().length === 0 ? undefined : this.folders.get(alias.toUpperCase());
    if (folder === undefined) throw new ServerError(404, `Alias '${alias}' is not configured.`);
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
        const info = statSync(path.join(folder, f));
        node.reports.push({
          name: f.substring(0, f.length - EXTENSION.length),
          path: relative.length === 0 ? f : relative + '/' + f,
          size: info.size,
          modifiedUtc: info.mtime.toISOString(),
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
    if (cleaned.length === 0) throw new ServerError(400, 'A report path is required.');
    if (!cleaned.toLowerCase().endsWith(EXTENSION)) cleaned += EXTENSION;
    if (cleaned.split('/').some((part) => part === '..' || part === '.' || part.length === 0 || part.toLowerCase() === VERSIONS))
      throw new ServerError(400, 'Invalid report path.');
    const file = path.resolve(root, cleaned);
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (!file.toUpperCase().startsWith(rootWithSep.toUpperCase())) throw new ServerError(400, 'Invalid report path.');
    return { file, relative: cleaned };
  }

  /** Open: the bytes of a report and its relative path. */
  open(alias: string, reportPath: string): { path: string; content: Uint8Array } {
    const { file, relative } = this.resolve(alias, reportPath);
    if (!existsSync(file) || !statSync(file).isFile()) throw new ServerError(404, `'${relative}' does not exist.`);
    return { path: relative, content: new Uint8Array(readFileSync(file)) };
  }
}
