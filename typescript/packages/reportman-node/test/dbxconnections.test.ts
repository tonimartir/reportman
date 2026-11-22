// The connections of this computer in dbxconnections.ini (DbxDirectConnections of the C# engine):
// the ADO.NET sections, the string that opens one and the connections a host passes to openReport.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { dbxConnections, dbxConnectionString, openReport, readDbxDirectConnections, sqlite, type DbxDirectConnection } from '@reportman/node';
import { pdfCreation } from '../../reportman-engine/test/golden-run.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.resolve(here, '../../../../samples');
const samplesDb = path.join(samples, 'samples.db');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-dbx-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function ini(name: string, text: string, bom = false): string {
  const file = path.join(dir, name);
  const body = Buffer.from(text, 'utf8');
  fs.writeFileSync(file, bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body);
  return file;
}

const connection = (extra: Partial<DbxDirectConnection>): DbxDirectConnection => ({
  alias: 'A',
  providerFactory: 'PostgreSQL',
  connectionString: '',
  parameters: {},
  secrets: {},
  fileName: '',
  ...extra,
});

describe('readDbxDirectConnections', () => {
  it('reads the ADO.NET sections in their order, and only those', () => {
    const file = ini(
      'a.ini',
      [
        '; the Delphi connections live in the same file',
        '[DELPHI]',
        'DriverName=Interbase',
        'Database=c:\\data\\x.fdb',
        '[SALES]',
        'DriverName=ADO.NET',
        'ProviderFactory=PostgreSQL',
        'ConnectionString=Host=db;Database=sales;Username=report',
        'Secret.Password=dpapi:AQAAAA==',
        'Delphi.Something=kept apart',
        '[ local ]',
        'drivername = ado.net',
        'ProviderFactory = SQLiteCore',
        'Param.DataSource = c:\\data\\local.db',
        '',
      ].join('\r\n'),
      true,
    );
    const list = readDbxDirectConnections(file);
    expect(list.map((c) => c.alias)).toEqual(['SALES', 'local']);
    expect(list[0]!.connectionString).toBe('Host=db;Database=sales;Username=report');
    expect(list[0]!.secrets).toEqual({ Password: 'dpapi:AQAAAA==' });
    expect(list[1]!.parameters).toEqual({ DataSource: 'c:\\data\\local.db' });
    expect(readDbxDirectConnections(path.join(dir, 'missing.ini'))).toEqual([]);
  });
});

describe('dbxConnectionString', () => {
  it('gives the connection string, or the Param.* as keywords', () => {
    expect(dbxConnectionString(connection({ connectionString: 'Host=db;Database=x' }))).toBe('Host=db;Database=x');
    expect(dbxConnectionString(connection({ parameters: { DataSource: 'srv', UserID: 'sa', InitialCatalog: 'sales' } }))).toBe(
      'Data Source=srv;User ID=sa;Initial Catalog=sales',
    );
  });

  it('adds a password written in clear only when the string has none', () => {
    expect(dbxConnectionString(connection({ connectionString: 'Host=db', parameters: { Password: 'p;1' } }))).toBe('Host=db;Password="p;1"');
    expect(dbxConnectionString(connection({ connectionString: 'Host=db;pwd=own', parameters: { Password: 'other' } }))).toBe('Host=db;pwd=own');
  });

  it('asks the host for a ciphered password, and leaves it out without an answer', () => {
    const c = connection({ alias: 'SALES', connectionString: 'Host=db;Password=old', secrets: { Password: 'dpapi:x' } });
    const asked: string[] = [];
    expect(
      dbxConnectionString(c, (alias, name) => {
        asked.push(alias + '.' + name);
        return 'secret';
      }),
    ).toBe('Host=db;Password=secret');
    expect(asked).toEqual(['SALES.Password']);
    expect(dbxConnectionString(c, () => undefined)).toBe('Host=db;Password=old');
  });
});

describe('dbxConnections', () => {
  it('opens a SQLite section by its alias, as the report connection SAMPLES', async () => {
    const file = ini('s.ini', `[SAMPLES]\nDriverName=ADO.NET\nProviderFactory=SQLiteCore\nConnectionString=Data Source=${samplesDb}\n`);
    const clock = pdfCreation(fs.readFileSync(path.resolve(here, '../../reportman-engine/test/fixtures/run/customers.cs.pdf'))).clock;
    const fromIni = await openReport(path.join(samples, 'customers.rep'), { connections: dbxConnections({ path: file }), clock });
    const direct = await openReport(path.join(samples, 'customers.rep'), { connections: { SAMPLES: sqlite(samplesDb) }, clock });
    expect(Buffer.from(await fromIni.executeToPdf({}, { compressed: false })).equals(Buffer.from(await direct.executeToPdf({}, { compressed: false })))).toBe(true);
  });

  it('gives the connection string to the driver of the provider, and skips a provider without one', () => {
    const file = ini(
      'd.ini',
      [
        '[PG]',
        'DriverName=ADO.NET',
        'ProviderFactory=PostgreSQL',
        'ConnectionString=Host=db;Database=sales',
        '[FB]',
        'DriverName=ADO.NET',
        'ProviderFactory=FirebirdSql.Data.FirebirdClient',
        'ConnectionString=DataSource=fb;Database=/x.fdb',
        '[ORA]',
        'DriverName=ADO.NET',
        'ProviderFactory=Oracle.ManagedDataAccess.Client',
        'ConnectionString=Data Source=ora',
      ].join('\n'),
    );
    const seen: string[] = [];
    const fake = (kind: string) => (s: string) => {
      seen.push(kind + ':' + s);
      return () => {
        throw new Error('not opened in this test');
      };
    };
    const connections = dbxConnections({ path: file, drivers: { postgresql: fake('pg') } });
    expect(Object.keys(connections)).toEqual(['PG']);
    expect(seen).toEqual(['pg:Host=db;Database=sales']);
  });
});
