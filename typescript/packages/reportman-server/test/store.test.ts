// The folder store as FolderReportStore of Reportman.Server: the times of the files as .NET writes
// them, the ETag, saving with it (the replaced version kept in .versions) and the paths it refuses.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FolderReportStore, ServerError, eTagOf, modifiedUtcOf } from '@reportman/server';

let folder: string;
let store: FolderReportStore;
const bytes = (s: string) => new TextEncoder().encode(s);

beforeAll(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-store-'));
  store = new FolderReportStore({ REPORTS: folder }, { versionsToKeep: 2 });
});
afterAll(() => fs.rmSync(folder, { recursive: true, force: true }));

describe('@reportman/server: the folder store', () => {
  it('writes the time of a file as System.Text.Json writes a UTC DateTime', () => {
    const file = path.join(folder, 'time.txt');
    fs.writeFileSync(file, 'x');
    fs.utimesSync(file, new Date('2026-01-02T03:04:05.120Z'), new Date('2026-01-02T03:04:05.120Z'));
    expect(modifiedUtcOf(file)).toBe('2026-01-02T03:04:05.12Z');
    fs.utimesSync(file, new Date('2026-01-02T03:04:05Z'), new Date('2026-01-02T03:04:05Z'));
    expect(modifiedUtcOf(file)).toBe('2026-01-02T03:04:05Z');
  });

  it('tags a report with the first 24 hex digits of its SHA-256', () => {
    expect(eTagOf(bytes('abc'))).toBe('ba7816bf8f01cfea414140de');
  });

  it('saves a new report, refuses to overwrite it without its tag and keeps the versions it replaces', () => {
    const first = store.save('REPORTS', 'Sales/month', bytes('<v1/>'), null);
    expect(first.path).toBe('Sales/month.rep');
    expect(() => store.save('REPORTS', 'Sales/month.rep', bytes('<v2/>'), null)).toThrow(/modified by someone else/);
    expect(() => store.save('REPORTS', 'Sales/month.rep', bytes('<v2/>'), 'stale')).toThrow(ServerError);
    const second = store.save('REPORTS', 'Sales/month.rep', bytes('<v2/>'), first.eTag);
    expect(store.open('REPORTS', 'Sales/month.rep').eTag).toBe(second.eTag);
    const versions = fs.readdirSync(path.join(folder, 'Sales', '.versions'));
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatch(/^month\.\d{17}\.rep$/);
    // .versions is never listed nor opened
    expect(store.getTree('REPORTS').folders[0]!.folders).toEqual([]);
    expect(() => store.open('REPORTS', 'Sales/.versions/' + versions[0])).toThrow('Invalid report path.');
  });

  it('never leaves the folder of the alias', () => {
    for (const p of ['../x.rep', 'a/../../x.rep', './x.rep', '', 'a//b.rep'])
      expect(() => store.save('REPORTS', p, bytes('x'), null)).toThrow(ServerError);
  });
});
