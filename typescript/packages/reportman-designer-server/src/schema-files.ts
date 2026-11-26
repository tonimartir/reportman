// The local schema files of the Node server: dbxschemas/<ALIAS>.json in its data folder (the files
// the Delphi and C# designers keep, LocalSchemaStore of the engine).

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CURRENT_VERSION, parseSchemaFile, type LocalSchemaFile, type SchemaFiles } from './schema.js';

/** The path of the file of an alias: the alias in upper case, the characters a file name cannot have as '_'. */
export function schemaFilePath(folder: string, alias: string): string {
  const name = alias.trim().toUpperCase();
  if (name.length === 0) throw new Error('No connection alias');
  return path.join(folder, name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') + '.json');
}

/** LocalSchemaStore.Load: the file, or null when there is none. */
export function loadSchemaFile(file: string): LocalSchemaFile | null {
  if (!existsSync(file)) return null;
  return parseSchemaFile(readFileSync(file, 'utf8'));
}

/** LocalSchemaStore.Save: indented, UTF-8 without BOM, written next to the old one and moved over it. */
export function saveSchemaFile(schema: LocalSchemaFile, file: string): void {
  if (schema.version < CURRENT_VERSION) schema.version = CURRENT_VERSION;
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  writeFileSync(temp, JSON.stringify(schema, null, 2), 'utf8');
  if (existsSync(file)) rmSync(file);
  renameSync(temp, file);
}

/** The schema files of a folder (dataPath/dbxschemas). */
export function folderSchemaFiles(folder: string): SchemaFiles {
  return {
    load: (alias) => loadSchemaFile(schemaFilePath(folder, alias)),
    save: (alias, schema) => saveSchemaFile(schema, schemaFilePath(folder, alias)),
  };
}
