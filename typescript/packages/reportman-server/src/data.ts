// The data folder of the server, laid out as the one of Reportman.Server (ServerPaths) so a folder
// moves between the two: informes/ (the report folders of the aliases), server.json (the aliases),
// apikeys.json (the API keys), dbxconnections.ini (the connections, connections.ts) and ejemplos/
// (the database of the sample reports).

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerError } from './store.js';

/** An API key of apikeys.json (ApiKeyRecord of Reportman.Server, same file). */
export interface ApiKeyRecord {
  id: string;
  name: string;
  /** The key itself (rpsk_...); empty for the keys of old Reportman.Server versions, which kept only the hash. */
  key: string;
  /** SHA-256 of the key, hexadecimal. */
  hash: string;
  /** The aliases the key runs; ['*'] all of them. */
  aliases: string[];
  createdUtc: string;
  createdBy: string;
  lastUsedUtc: string | null;
  rotatedUtc: string | null;
  rotatedBy: string | null;
  disabled: boolean;
}

/** What installSamples did (SamplesInstallResult). */
export interface SamplesInstallResult {
  reports: number;
  database: boolean;
  connection: boolean;
  /** The local schema of the SAMPLES connection (dbxschemas/SAMPLES.json) was installed. */
  schema: boolean;
}

/** One sample report of samples.ini, in a language (SampleEntry). */
export interface SampleEntry {
  file: string;
  title: string;
  description: string;
  thumbnail: string | null;
  prompt: string | null;
}

/** The connection alias of the sample reports, and their folder under informes/. */
export const SAMPLE_CONNECTION_ALIAS = 'SAMPLES';
export const SAMPLE_REPORTS_FOLDER = 'Ejemplos';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const newSecret = (): string => 'rpsk_' + randomBytes(32).toString('hex');
const nowUtc = (): string => new Date().toISOString();

/** Writes a file through a temporary one, so a reader never sees half of it. */
export function writeAtomic(file: string, content: string): void {
  const temporary = file + '.tmp';
  writeFileSync(temporary, content, 'utf8');
  renameSync(temporary, file);
}

/** The aliases a key names, upper case, without repetitions; none is all of them ('*'). */
function normalizeAliases(aliases: readonly string[] | undefined | null): string[] {
  const list = [...new Set((aliases ?? []).map((a) => String(a).trim().toUpperCase()).filter((a) => a.length > 0))];
  return list.length === 0 ? ['*'] : list;
}

/** A value of a JSON object by its name in any case (PropertyNameCaseInsensitive of .NET). */
function field(o: Record<string, unknown>, name: string): unknown {
  const k = Object.keys(o).find((key) => key.toLowerCase() === name.toLowerCase());
  return k === undefined ? undefined : o[k];
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const textOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** A record of the file, whatever the case of its names. */
function readRecord(o: Record<string, unknown>): ApiKeyRecord {
  const aliases = field(o, 'aliases');
  return {
    id: text(field(o, 'id')),
    name: text(field(o, 'name')),
    key: text(field(o, 'key')),
    hash: text(field(o, 'hash')),
    aliases: Array.isArray(aliases) ? normalizeAliases(aliases.map(String)) : ['*'],
    createdUtc: text(field(o, 'createdUtc')),
    createdBy: text(field(o, 'createdBy')),
    lastUsedUtc: textOrNull(field(o, 'lastUsedUtc')),
    rotatedUtc: textOrNull(field(o, 'rotatedUtc')),
    rotatedBy: textOrNull(field(o, 'rotatedBy')),
    disabled: field(o, 'disabled') === true,
  };
}

/** The record as Reportman.Server writes it: the property names of its class. */
function writeRecord(r: ApiKeyRecord): Record<string, unknown> {
  return {
    Id: r.id,
    Name: r.name,
    Key: r.key,
    Hash: r.hash,
    Aliases: r.aliases,
    CreatedUtc: r.createdUtc,
    CreatedBy: r.createdBy,
    LastUsedUtc: r.lastUsedUtc,
    RotatedUtc: r.rotatedUtc,
    RotatedBy: r.rotatedBy,
    Disabled: r.disabled,
  };
}

/** Whether a key may run the reports of an alias. */
export function keyAllows(record: ApiKeyRecord, alias: string): boolean {
  return !record.disabled && (record.aliases.includes('*') || record.aliases.some((a) => a.toUpperCase() === alias.toUpperCase()));
}

/** The folder of the sample reports this package carries (samples/), or the one of the repository. */
export function samplesSource(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/ or src/ of the package: the package's own copy, then the samples of the repository
  for (const candidate of [path.join(here, '..', 'samples'), path.join(here, '..', '..', '..', '..', 'samples')]) {
    if (existsSync(path.join(candidate, 'samples.db'))) return path.resolve(candidate);
  }
  return null;
}

/** The data folder of a server. */
export class ServerData {
  readonly dataPath: string;

  constructor(dataPath: string) {
    this.dataPath = path.resolve(dataPath);
    mkdirSync(this.reportsPath, { recursive: true });
  }

  get reportsPath(): string {
    return path.join(this.dataPath, 'informes');
  }
  get serverConfigFile(): string {
    return path.join(this.dataPath, 'server.json');
  }
  get apiKeysFile(): string {
    return path.join(this.dataPath, 'apikeys.json');
  }
  get connectionsFile(): string {
    return path.join(this.dataPath, 'dbxconnections.ini');
  }
  get sampleDatabaseFile(): string {
    return path.join(this.dataPath, 'ejemplos', 'samples.db');
  }
  /**
   * The local schema of the SAMPLES connection, for the SQL editor of the designer: dbxschemas/
   * SAMPLES.json next to dbxconnections.ini, as every designer keeps it (its subschemas and what
   * each table and column means).
   */
  get sampleSchemaFile(): string {
    return path.join(this.dataPath, 'dbxschemas', SAMPLE_CONNECTION_ALIAS + '.json');
  }

  // ---- aliases (server.json) ----

  /** Alias → folder; a relative folder hangs from informes/. A fresh folder gets INFORMES = '.'. */
  aliases(): Record<string, string> {
    let config: Record<string, unknown> = {};
    if (existsSync(this.serverConfigFile)) {
      try {
        config = JSON.parse(readFileSync(this.serverConfigFile, 'utf8')) as Record<string, unknown>;
      } catch {
        config = {};
      }
    }
    const raw = field(config, 'aliases');
    const result: Record<string, string> = {};
    if (raw !== null && typeof raw === 'object') for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'string') result[k] = v;
    if (Object.keys(result).length === 0) {
      // There is always somewhere to put reports
      result.INFORMES = '.';
      this.writeAliases(result);
    }
    return result;
  }

  private writeAliases(aliases: Record<string, string>): void {
    writeAtomic(this.serverConfigFile, JSON.stringify({ aliases }, null, 2));
  }

  /** The absolute folder of an alias (created when missing), or null for an unknown alias. */
  folderOf(alias: string): string | null {
    const aliases = this.aliases();
    const name = Object.keys(aliases).find((a) => a.toUpperCase() === alias.toUpperCase());
    if (name === undefined) return null;
    const folder = aliases[name]!;
    const full = path.isAbsolute(folder) ? folder : path.resolve(this.reportsPath, folder);
    mkdirSync(full, { recursive: true });
    return full;
  }

  /** Every alias with its absolute folder. */
  aliasFolders(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const alias of Object.keys(this.aliases())) result[alias] = this.folderOf(alias)!;
    return result;
  }

  /** Adds or changes an alias: letters, digits and underscores, upper case; its folder by default is its name. */
  saveAlias(alias: string, folder?: string | null): { alias: string; folder: string; path: string } {
    const name = alias.trim().toUpperCase();
    if (name.length === 0 || !/^[\p{L}\p{N}_]+$/u.test(name)) throw new ServerError(400, 'An alias is letters, digits and underscores.');
    const target = folder === undefined || folder === null || folder.trim().length === 0 ? name.toLowerCase() : folder.trim();
    const aliases = this.aliases();
    for (const k of Object.keys(aliases)) if (k.toUpperCase() === name) delete aliases[k];
    aliases[name] = target;
    this.writeAliases(aliases);
    return { alias: name, folder: target, path: this.folderOf(name)! };
  }

  /** Removes an alias (never the last one); false when there is no such alias. */
  deleteAlias(alias: string): boolean {
    const aliases = this.aliases();
    const name = Object.keys(aliases).find((a) => a.toUpperCase() === alias.toUpperCase());
    if (name === undefined) return false;
    if (Object.keys(aliases).length <= 1) throw new ServerError(400, 'The last alias cannot be removed.');
    delete aliases[name];
    this.writeAliases(aliases);
    return true;
  }

  // ---- API keys (apikeys.json) ----

  /** The keys of the file. */
  keys(): ApiKeyRecord[] {
    if (!existsSync(this.apiKeysFile)) return [];
    try {
      const list = JSON.parse(readFileSync(this.apiKeysFile, 'utf8')) as unknown;
      return Array.isArray(list) ? list.filter((o) => o !== null && typeof o === 'object').map((o) => readRecord(o as Record<string, unknown>)) : [];
    } catch {
      return [];
    }
  }

  private writeKeys(list: readonly ApiKeyRecord[]): void {
    writeAtomic(this.apiKeysFile, JSON.stringify(list.map(writeRecord), null, 2));
  }

  /** A new key: the record, whose key is the secret to give the program. */
  createKey(name: string, aliases: readonly string[] | undefined | null, createdBy: string): ApiKeyRecord {
    if (name.trim().length === 0) throw new ServerError(400, 'A name is required.');
    const key = newSecret();
    const record: ApiKeyRecord = {
      id: randomBytes(6).toString('hex'),
      name: name.trim(),
      key,
      hash: sha256(key),
      aliases: normalizeAliases(aliases),
      createdUtc: nowUtc(),
      createdBy,
      lastUsedUtc: null,
      rotatedUtc: null,
      rotatedBy: null,
      disabled: false,
    };
    this.writeKeys([...this.keys(), record]);
    return record;
  }

  /** A new secret for a key (the old one stops working at once), or null for an unknown id. */
  rotateKey(id: string, rotatedBy: string): ApiKeyRecord | null {
    const list = this.keys();
    const record = list.find((k) => k.id === id);
    if (record === undefined) return null;
    record.key = newSecret();
    record.hash = sha256(record.key);
    record.rotatedUtc = nowUtc();
    record.rotatedBy = rotatedBy;
    this.writeKeys(list);
    return record;
  }

  /** Changes the name, the aliases or the state of a key; false for an unknown id. */
  updateKey(id: string, changes: { name?: string | null; aliases?: readonly string[] | null; disabled?: boolean | null }): ApiKeyRecord | null {
    const list = this.keys();
    const record = list.find((k) => k.id === id);
    if (record === undefined) return null;
    if (typeof changes.name === 'string' && changes.name.trim().length > 0) record.name = changes.name.trim();
    if (Array.isArray(changes.aliases)) record.aliases = normalizeAliases(changes.aliases);
    if (typeof changes.disabled === 'boolean') record.disabled = changes.disabled;
    this.writeKeys(list);
    return record;
  }

  deleteKey(id: string): boolean {
    const list = this.keys();
    const rest = list.filter((k) => k.id !== id);
    if (rest.length === list.length) return false;
    this.writeKeys(rest);
    return true;
  }

  /** The enabled record of a presented key (by its hash, in constant time), or null. Notes its use once a minute. */
  authenticate(presented: string): ApiKeyRecord | null {
    const given = presented.trim();
    if (given.length === 0) return null;
    const hash = Buffer.from(sha256(given), 'ascii');
    const list = this.keys();
    const record = list.find((k) => k.hash.length === hash.length && timingSafeEqual(Buffer.from(k.hash.toLowerCase(), 'ascii'), hash));
    if (record === undefined || record.disabled) return null;
    const last = record.lastUsedUtc === null ? 0 : Date.parse(record.lastUsedUtc);
    if (!(Date.now() - last < 60000)) {
      record.lastUsedUtc = nowUtc();
      this.writeKeys(list);
    }
    return record;
  }

  // ---- sample reports ----

  /**
   * The sample reports that are missing (InstallSamples of Reportman.Server): the reports into
   * informes/Ejemplos, never over a file that is there; their database into ejemplos/, replaced
   * by a newer one; the local schema of their connection into dbxschemas/ when it is not there;
   * and the SAMPLES connection when dbxconnections.ini has none.
   */
  installSamples(source = samplesSource()): SamplesInstallResult {
    if (source === null) throw new ServerError(404, 'This server has no sample reports.');
    let reports = 0;
    const target = path.join(this.reportsPath, SAMPLE_REPORTS_FOLDER);
    for (const name of readdirSync(source).filter((f) => f.toLowerCase().endsWith('.rep'))) {
      const destination = path.join(target, name);
      if (existsSync(destination)) continue;
      mkdirSync(target, { recursive: true });
      copyFileSync(path.join(source, name), destination);
      reports++;
    }
    let database = false;
    const sourceDatabase = path.join(source, 'samples.db');
    if (existsSync(sourceDatabase) && (!existsSync(this.sampleDatabaseFile) || statSync(sourceDatabase).mtimeMs > statSync(this.sampleDatabaseFile).mtimeMs)) {
      mkdirSync(path.dirname(this.sampleDatabaseFile), { recursive: true });
      const temporary = this.sampleDatabaseFile + '.tmp';
      copyFileSync(sourceDatabase, temporary);
      renameSync(temporary, this.sampleDatabaseFile);
      database = true;
    }
    // The local schema of their connection, never over one (it may have been changed)
    let schema = false;
    const sourceSchema = path.join(source, 'dbxschemas', SAMPLE_CONNECTION_ALIAS + '.json');
    if (existsSync(sourceSchema) && !existsSync(this.sampleSchemaFile)) {
      mkdirSync(path.dirname(this.sampleSchemaFile), { recursive: true });
      copyFileSync(sourceSchema, this.sampleSchemaFile);
      schema = true;
    }
    let connection = false;
    const existing = existsSync(this.connectionsFile) ? readFileSync(this.connectionsFile, 'utf8') : '';
    if (!existing.split(/\r?\n/).some((l) => l.trim().toUpperCase() === '[' + SAMPLE_CONNECTION_ALIAS + ']')) {
      const section = [
        '; The sample reports of the Report Manager designers (informes/Ejemplos, the same in Delphi, Lazarus',
        '; and .NET): a SQLite database in the data folder, opened read only.',
        '[' + SAMPLE_CONNECTION_ALIAS + ']',
        'DriverName=ADO.NET',
        'ProviderFactory=SQLiteCore',
        'Param.DataSource=ejemplos/samples.db',
        'Param.Mode=ReadOnly',
      ].join('\n');
      const separator = existing.length === 0 ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
      writeAtomic(this.connectionsFile, existing + separator + section + '\n');
      connection = true;
    }
    return { reports, database, connection, schema };
  }
}

/** The language of an Accept-Language header or a code (es-ES → es), lower case, or null. */
export function normalizeLanguage(language: string | null | undefined): string | null {
  if (language === null || language === undefined) return null;
  const first = language.split(',')[0]!.split(';')[0]!.trim();
  if (first.length === 0 || first === '*') return null;
  return first.split(/[-_]/)[0]!.toLowerCase();
}

/** The samples of samples.ini in a language (SampleCatalog.Load): English without a translation. */
export function loadSamples(folder: string, language: string | null): SampleEntry[] {
  const index = path.join(folder, 'samples.ini');
  if (!existsSync(index)) return [];
  const sections: { name: string; keys: Map<string, string> }[] = [];
  let current: Map<string, string> | null = null;
  for (const raw of readFileSync(index, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith(';') || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      current = new Map();
      sections.push({ name: line.substring(1, line.length - 1).trim(), keys: current });
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0 || current === null) continue;
    current.set(line.substring(0, eq).trim().toLowerCase(), line.substring(eq + 1).trim());
  }
  const localized = (keys: Map<string, string>, name: string): string | undefined =>
    (language !== null ? keys.get(name + '.' + language) : undefined) ?? keys.get(name);
  const result: SampleEntry[] = [];
  for (const { name, keys } of sections) {
    // Only report files that are there, and never a path out of the folder
    if (/[\\/]/.test(name) || !name.toLowerCase().endsWith('.rep') || !existsSync(path.join(folder, name))) continue;
    let thumbnail = keys.get('thumbnail') ?? null;
    if (thumbnail !== null && (thumbnail.length === 0 || !existsSync(path.join(folder, thumbnail)))) thumbnail = null;
    const prompt = keys.get('prompt');
    result.push({
      file: name,
      title: localized(keys, 'title') ?? name.replace(/\.rep$/i, ''),
      description: localized(keys, 'description') ?? '',
      thumbnail: thumbnail === null ? null : thumbnail.replace(/\\/g, '/'),
      prompt: prompt === undefined || prompt.trim().length === 0 ? null : prompt,
    });
  }
  return result;
}
