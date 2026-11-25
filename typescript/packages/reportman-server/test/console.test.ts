// The console of @reportman/server over a data folder: the administrator's key, the aliases, the
// sample reports, the connections of dbxconnections.ini (stored as Reportman.Server stores them,
// built into connection strings the JavaScript drivers read, tested), the API keys of apikeys.json
// (the file of Reportman.Server too) and the console page.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectionFactory } from '@reportman/node';
import { buildConnectionString, connectionStringParameters, createReportServer, nodeHandler, type ReportServer, type ReportServerOptions } from '@reportman/server';
import { connectionSettings } from '@reportman/driver-postgres';
import { parseConnectionString as parseMssql } from '../../reportman-driver-mssql/src/connectionstring.js';
import { parseConnectionString as parseMysql } from '../../reportman-driver-mysql/src/connectionstring.js';
import { parseConnectionString as parseFirebird } from '../../reportman-driver-firebird/src/connectionstring.js';

const ADMIN = 'admin-secret';
const clock = { now: () => new Date('2026-11-22T02:34:56Z'), offsetMinutes: () => 0 };

interface Listening {
  url: string;
  server: ReportServer;
  data: string;
  close: () => Promise<void>;
}

async function listen(options: Partial<ReportServerOptions> = {}): Promise<Listening> {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-console-'));
  const server = createReportServer({ dataPath: data, adminKey: ADMIN, fonts: false, clock, ...options });
  const listener = http.createServer(nodeHandler(server));
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const { port } = listener.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    data,
    close: async () => {
      await new Promise((resolve) => listener.close(() => resolve(undefined)));
      fs.rmSync(data, { recursive: true, force: true });
    },
  };
}

let s: Listening;
beforeAll(async () => {
  s = await listen();
});
afterAll(async () => {
  await s.close();
});

const admin = (method: string, url: string, body?: unknown) =>
  fetch(s.url + url, {
    method,
    headers: { 'X-ReportmanServer-AdminKey': ADMIN, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const adminJson = async (method: string, url: string, body?: unknown) => {
  const r = await admin(method, url, body);
  expect(r.status, `${method} ${url}`).toBe(200);
  return r.json();
};

describe('@reportman/server console: access', () => {
  it('says whether a key is needed, and refuses the console without the right one', async () => {
    expect(await (await fetch(s.url + '/api/console/status')).json()).toMatchObject({ auth: 'key', samples: true, providers: ['SQLiteCore'] });
    expect((await fetch(s.url + '/api/console/check')).status).toBe(401);
    expect((await fetch(s.url + '/api/connections', { headers: { 'X-ReportmanServer-AdminKey': 'wrong' } })).status).toBe(401);
    expect((await admin('GET', '/api/console/check')).status).toBe(204);
    const health = await (await fetch(s.url + '/api/health')).json();
    expect(health).toMatchObject({ status: 'ok', console: true, aliases: ['INFORMES'] });
  });

  it('serves the console page at / and /console, closed to framing', async () => {
    for (const p of ['/', '/console']) {
      const r = await fetch(s.url + p);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(await r.text()).toContain('<title>Report Manager Server</title>');
    }
  });

  it('has no console without a data folder', async () => {
    const plain = createReportServer({ aliases: { A: os.tmpdir() } });
    const page = await plain.handle({ method: 'GET', path: '/', query: new URLSearchParams(), headers: {} });
    expect(page.status).toBe(404);
    const api = await plain.handle({ method: 'GET', path: '/api/connections', query: new URLSearchParams(), headers: {} });
    expect([api.status, JSON.parse(new TextDecoder().decode(api.body)).error]).toEqual([404, 'The console needs a data folder (dataPath).']);
  });

  it('opens the console without a key on a trusted server', async () => {
    const t = await listen({ adminKey: undefined, trusted: true });
    try {
      expect(await (await fetch(t.url + '/api/console/status')).json()).toMatchObject({ auth: 'none' });
      expect((await fetch(t.url + '/api/console/check')).status).toBe(204);
    } finally {
      await t.close();
    }
  });
});

describe('@reportman/server console: aliases and samples', () => {
  it('starts with INFORMES on the reports folder, written as Reportman.Server writes server.json', async () => {
    const list = await adminJson('GET', '/api/console/aliases');
    expect(list).toEqual([{ alias: 'INFORMES', folder: '.', path: path.join(s.data, 'informes') }]);
    expect(JSON.parse(fs.readFileSync(path.join(s.data, 'server.json'), 'utf8'))).toEqual({ aliases: { INFORMES: '.' } });
  });

  it('adds, changes and removes aliases, never the last one', async () => {
    expect(await adminJson('PUT', '/api/console/aliases/sales', { folder: '' })).toEqual({ alias: 'SALES', folder: 'sales', path: path.join(s.data, 'informes', 'sales') });
    expect(fs.existsSync(path.join(s.data, 'informes', 'sales'))).toBe(true);
    expect((await admin('PUT', '/api/console/aliases/bad-name', { folder: 'x' })).status).toBe(400);
    expect((await admin('DELETE', '/api/console/aliases/SALES')).status).toBe(204);
    const last = await admin('DELETE', '/api/console/aliases/INFORMES');
    expect([last.status, (await last.json()).error]).toEqual([400, 'The last alias cannot be removed.']);
    expect((await admin('DELETE', '/api/console/aliases/NOPE')).status).toBe(404);
  });

  it('installs the sample reports, their database, their local schema and the SAMPLES connection once', async () => {
    const first = await adminJson('POST', '/api/console/samples');
    expect(first).toEqual({ reports: 11, database: true, connection: true, schema: true });
    expect(await adminJson('POST', '/api/console/samples')).toEqual({ reports: 0, database: false, connection: false, schema: false });
    const ini = fs.readFileSync(path.join(s.data, 'dbxconnections.ini'), 'utf8');
    expect(ini).toContain('[SAMPLES]\nDriverName=ADO.NET\nProviderFactory=SQLiteCore\nParam.DataSource=ejemplos/samples.db\nParam.Mode=ReadOnly');
    expect(fs.existsSync(path.join(s.data, 'informes', 'Ejemplos', 'customers.rep'))).toBe(true);
  });

  it('lists the samples in a language, with their thumbnails', async () => {
    const view = await adminJson('GET', '/api/reports/samples?lang=es');
    expect(view.alias).toBe('INFORMES');
    const customers = view.items.find((i: { file: string }) => i.file === 'customers.rep');
    expect(customers).toMatchObject({ title: 'Clientes por país', path: 'Ejemplos/customers.rep', installed: true, thumbnail: '/api/reports/samples/thumbnails/customers.png' });
    const png = await admin('GET', customers.thumbnail);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect([...new Uint8Array(await png.arrayBuffer()).subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });

  it('runs a sample through the reports API with the SAMPLES connection of the file', async () => {
    const r = await fetch(s.url + '/api/reports/INFORMES/execute?path=Ejemplos/customers.rep&format=csv');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('"Total customers"');
    const tree = await (await fetch(s.url + '/api/reports/INFORMES/tree')).json();
    expect(tree.folders.map((f: { name: string }) => f.name)).toContain('Ejemplos');
  });
});

describe('@reportman/server console: connections', () => {
  it('lists the SAMPLES connection and tests it', async () => {
    const list = await adminJson('GET', '/api/connections');
    const samples = list.find((c: { alias: string }) => c.alias === 'SAMPLES');
    const file = path.join(s.data, 'ejemplos', 'samples.db');
    expect(samples).toEqual({
      alias: 'SAMPLES',
      kind: 'direct',
      hubDatabaseId: null,
      hasApiKey: false,
      isExample: false,
      providerFactory: 'SQLiteCore',
      connectionString: `Data Source=${file};Mode=ReadOnly`,
      parameters: [
        { name: 'DataSource', value: file, hasSecret: false },
        { name: 'Mode', value: 'ReadOnly', hasSecret: false },
      ],
    });
    const test = await adminJson('POST', '/api/connections/SAMPLES/test');
    expect(test).toMatchObject({ ok: true, message: 'Connected' });
    expect(test.serverVersion).toMatch(/^3\.\d+/);
  });

  it('describes the providers it can open and their parameters', async () => {
    expect(await adminJson('GET', '/api/connections/providers')).toEqual([{ name: 'SQLiteCore', label: 'SQLite', sample: 'Data Source=/data/base.db' }]);
    const params = await adminJson('GET', '/api/connections/providers/PostgreSQL/parameters');
    expect(params.filter((p: { isMain: boolean }) => p.isMain).map((p: { name: string }) => p.name)).toEqual(['Host', 'Port', 'Database', 'Username', 'Password', 'SslMode']);
    expect(params.find((p: { name: string }) => p.name === 'SslMode')).toMatchObject({ type: 'enum', defaultValue: 'Prefer', enumValues: { Disable: 0, Require: 3 } });
    expect((await admin('GET', '/api/connections/providers/Oracle/parameters')).status).toBe(400);
  });

  it('stores a connection with portable paths, keeps its password and masks it', async () => {
    const saved = await adminJson('PUT', '/api/connections/local', {
      kind: 'direct',
      providerFactory: 'SQLiteCore',
      parameters: [
        { name: 'DataSource', value: 'ejemplos/samples.db' },
        { name: 'Mode', value: 'readonly' },
      ],
    });
    expect(saved.alias).toBe('LOCAL');
    expect(saved.connectionString).toBe(`Data Source=${path.join(s.data, 'ejemplos', 'samples.db')};Mode=ReadOnly`);
    const ini = fs.readFileSync(path.join(s.data, 'dbxconnections.ini'), 'utf8');
    // Inside the data folder the file is written relative to it, so the folder can move
    expect(ini).toContain('[LOCAL]\nDriverName=ADO.NET\nProviderFactory=SQLiteCore\nParam.DataSource=ejemplos/samples.db\nParam.Mode=readonly\nConnectionString=Data Source=');
    expect(await adminJson('POST', '/api/connections/LOCAL/test')).toMatchObject({ ok: true });

    const pg = await adminJson('PUT', '/api/connections/PG', {
      kind: 'direct',
      providerFactory: 'PostgreSQL',
      parameters: [
        { name: 'Host', value: 'db.local' },
        { name: 'Database', value: 'sales' },
        { name: 'Username', value: 'report' },
        { name: 'Password', value: 's;cret' },
        { name: 'SslMode', value: 'require' },
      ],
    });
    expect(pg.connectionString).toBe('Host=db.local;Database=sales;Username=report;Password=***;SSL Mode=Require');
    expect(pg.parameters.find((p: { name: string }) => p.name === 'Password')).toEqual({ name: 'Password', value: null, hasSecret: true });
    // Saved again without the password: the stored one stays
    await adminJson('PUT', '/api/connections/PG', { kind: 'direct', providerFactory: 'PostgreSQL', parameters: [{ name: 'Host', value: 'db2.local' }, { name: 'Password', value: '' }] });
    expect(fs.readFileSync(path.join(s.data, 'dbxconnections.ini'), 'utf8')).toContain('ConnectionString=Host=db2.local;Password="s;cret"');
    // No PostgreSQL driver on this server: the test says so
    expect(await adminJson('POST', '/api/connections/PG/test')).toMatchObject({ ok: false, message: 'There is no driver for PostgreSQL on this server: install @reportman/driver-postgres.' });
    expect((await admin('PUT', '/api/connections/BAD', { kind: 'direct', providerFactory: 'PostgreSQL', parameters: [{ name: 'Port', value: 'abc' }] })).status).toBe(400);
    expect((await admin('DELETE', '/api/connections/PG')).status).toBe(204);
    expect((await admin('GET', '/api/connections/PG')).status).toBe(404);
  });

  it('tests a definition before it is stored, and says when the SQLite file is missing', async () => {
    const r = await adminJson('POST', '/api/connections/NEW/test', { kind: 'direct', providerFactory: 'SQLiteCore', parameters: [{ name: 'DataSource', value: 'nope.db' }] });
    expect(r).toEqual({ ok: false, code: 'FileNotFound', message: 'The database file does not exist: ' + path.join(s.data, 'nope.db') });
    expect((await admin('GET', '/api/connections/NEW')).status).toBe(404);
  });

  it('opens a provider with the driver given, with the connection string built from the parameters', async () => {
    const seen: string[] = [];
    const fake = (cs: string): ConnectionFactory => {
      seen.push(cs);
      return () => ({ query: () => ({ columns: [], rows: [['16.4']] }), close: () => {} });
    };
    const d = await listen({ drivers: { postgresql: fake } });
    try {
      const put = await fetch(d.url + '/api/connections/PG', {
        method: 'PUT',
        headers: { 'X-ReportmanServer-AdminKey': ADMIN, 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'direct', providerFactory: 'PostgreSQL', parameters: [{ name: 'Host', value: 'h' }, { name: 'Port', value: '5433' }] }),
      });
      expect(put.status).toBe(200);
      const test = await (await fetch(d.url + '/api/connections/PG/test', { method: 'POST', headers: { 'X-ReportmanServer-AdminKey': ADMIN } })).json();
      expect(test).toEqual({ ok: true, message: 'Connected', serverVersion: '16.4' });
      expect(seen).toEqual(['Host=h;Port=5433']);
      const providers = await (await fetch(d.url + '/api/connections/providers', { headers: { 'X-ReportmanServer-AdminKey': ADMIN } })).json();
      expect(providers.map((p: { name: string }) => p.name)).toEqual(['SQLiteCore', 'PostgreSQL']);
    } finally {
      await d.close();
    }
  });

  it('tests an Agent connection with the Hub, as the designers do', async () => {
    let seen: { key: string | undefined; body: string } | undefined;
    const hub = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen = { key: req.headers['x-reportman-apikey'] as string | undefined, body };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ success: true, data: { message: 'Agent online', databaseConnectionSuccess: true } }));
      });
    });
    await new Promise<void>((resolve) => hub.listen(0, '127.0.0.1', resolve));
    const a = await listen({ agentApiUrl: `http://127.0.0.1:${(hub.address() as AddressInfo).port}` });
    try {
      const headers = { 'X-ReportmanServer-AdminKey': ADMIN, 'content-type': 'application/json' };
      const saved = await (await fetch(a.url + '/api/connections/sales', { method: 'PUT', headers, body: JSON.stringify({ kind: 'agent', hubDatabaseId: 42, apiKey: 'agent-key' }) })).json();
      expect(saved).toMatchObject({ alias: 'SALES', kind: 'agent', hubDatabaseId: 42, hasApiKey: true });
      expect(fs.readFileSync(path.join(a.data, 'dbxconnections.ini'), 'utf8')).toContain('[SALES]\nDriverName=Reportman AI Agent\nHubDatabaseId=42\nApiKey=agent-key\n');
      const test = await (await fetch(a.url + '/api/connections/SALES/test', { method: 'POST', headers })).json();
      expect(test).toEqual({ ok: true, status: 200, message: 'Agent online' });
      expect(seen).toEqual({ key: 'agent-key', body: '{"hubDatabaseId":42}' });
      const missing = await fetch(a.url + '/api/connections/X', { method: 'PUT', headers, body: JSON.stringify({ kind: 'agent' }) });
      expect([missing.status, (await missing.json()).code]).toEqual([400, 'HubDatabaseRequired']);
    } finally {
      await a.close();
      await new Promise((resolve) => hub.close(() => resolve(undefined)));
    }
  });

  it('reads a section written by hand with only its connection string', async () => {
    const file = path.join(s.data, 'dbxconnections.ini');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + '\n[HAND]\nDriverName=ADO.NET\nProviderFactory=MySQLConnector\nConnectionString=Server=m;Uid=u;Pwd=p;Database=d\n');
    const c = await adminJson('GET', '/api/connections/hand');
    expect(c.parameters).toEqual([
      { name: 'Server', value: 'm', hasSecret: false },
      { name: 'UserID', value: 'u', hasSecret: false },
      { name: 'Password', value: null, hasSecret: true },
      { name: 'Database', value: 'd', hasSecret: false },
    ]);
    expect(c.connectionString).toBe('Server=m;Database=d;User ID=u;Password=***');
  });
});

describe('@reportman/server console: the connection strings the drivers read', () => {
  it('builds strings every JavaScript driver reads as the .NET provider would', () => {
    const pg = connectionSettings(
      buildConnectionString('PostgreSQL', { Host: 'h', Port: '5433', Database: 'd', Username: 'u', Password: 'p;w', SslMode: 'disable', CommandTimeout: '45' }),
    ).config;
    expect(pg).toMatchObject({ host: 'h', port: 5433, database: 'd', user: 'u', password: 'p;w', statement_timeout: 45000 });
    const fb = parseFirebird(buildConnectionString('FirebirdSql.Data.FirebirdClient', { DataSource: 'h', Port: '3051', Database: '/db/x.fdb', UserID: 'SYSDBA', Password: 'masterkey', Charset: 'WIN1252', Role: 'R', Dialect: '1' }));
    expect(fb).toMatchObject({ dataSource: 'h', port: 3051, database: '/db/x.fdb', user: 'SYSDBA', password: 'masterkey', charset: 'WIN1252', role: 'R', dialect: 1 });
    const my = parseMysql(buildConnectionString('MySQLConnector', { Server: 'h', Port: '3307', Database: 'd', UserID: 'u', Password: 'p', SslMode: 'none', ConnectionTimeout: '5' }));
    expect(my).toMatchObject({ hosts: ['h'], port: 3307, database: 'd', user: 'u', password: 'p', sslMode: 'None', connectionTimeout: 5 });
    const ms = parseMssql(buildConnectionString('SQLServer', { DataSource: 'h,1434', InitialCatalog: 'd', UserID: 'sa', Password: 'p', TrustServerCertificate: 'yes', Encrypt: 'optional' }));
    expect(ms).toMatchObject({ dataSource: 'h,1434', database: 'd', userId: 'sa', password: 'p', trustServerCertificate: true });
  });

  it('reads a legacy string back into the parameters of the builder', () => {
    expect(connectionStringParameters('SQLServer', 'Server=h;Database=d;User Id=sa;Pwd=x;Trusted_Connection=no')).toEqual({
      DataSource: 'h',
      InitialCatalog: 'd',
      UserID: 'sa',
      Password: 'x',
      IntegratedSecurity: 'no',
    });
  });
});

describe('@reportman/server console: API keys', () => {
  it('creates keys in apikeys.json (Reportman.Server format), and then the API needs one', async () => {
    const created = await adminJson('POST', '/api/console/keys', { name: 'ERP', aliases: [] });
    expect(created.key).toMatch(/^rpsk_[0-9a-f]{64}$/);
    expect(created.record).toMatchObject({ name: 'ERP', key: created.key, aliases: ['*'], disabled: false, lastUsedUtc: null });
    const file = JSON.parse(fs.readFileSync(path.join(s.data, 'apikeys.json'), 'utf8'));
    expect(file[0]).toMatchObject({ Id: created.record.id, Name: 'ERP', Key: created.key, Hash: createHash('sha256').update(created.key).digest('hex'), Aliases: ['*'], Disabled: false });

    const run = (key?: string) => fetch(s.url + '/api/reports/INFORMES/execute?path=Ejemplos/customers.rep&format=csv', { headers: key === undefined ? {} : { 'X-ReportmanServer-ApiKey': key } });
    expect((await run()).status).toBe(401);
    expect((await run(created.key)).status).toBe(200);
    expect((await fetch(s.url + '/api/reports/INFORMES/tree?apikey=' + created.key)).status).toBe(200);
    expect((await adminJson('GET', '/api/console/keys'))[0].lastUsedUtc).not.toBeNull();

    // A key of another alias
    const other = await adminJson('POST', '/api/console/keys', { name: 'Other', aliases: ['sales'] });
    expect(other.record.aliases).toEqual(['SALES']);
    expect((await run(other.key)).status).toBe(403);

    // Rotated: the old secret stops at once
    const rotated = await adminJson('POST', `/api/console/keys/${created.record.id}/rotate`);
    expect(rotated.key).not.toBe(created.key);
    expect((await run(created.key)).status).toBe(401);
    expect((await run(rotated.key)).status).toBe(200);
    // Disabled, then removed
    expect((await adminJson('PUT', `/api/console/keys/${created.record.id}`, { disabled: true })).disabled).toBe(true);
    expect((await run(rotated.key)).status).toBe(401);
    expect((await admin('DELETE', `/api/console/keys/${created.record.id}`)).status).toBe(204);
    expect((await admin('DELETE', `/api/console/keys/${other.record.id}`)).status).toBe(204);
    expect((await run()).status).toBe(200);
  });

  it('accepts the keys Reportman.Server wrote, also the old ones that kept only the hash', async () => {
    const k = await listen();
    try {
      const old = 'rpsk_old-key-only-hashed';
      fs.writeFileSync(
        path.join(k.data, 'apikeys.json'),
        JSON.stringify([
          { Id: 'abc123', Name: 'Legacy', Key: '', Hash: createHash('sha256').update(old).digest('hex').toUpperCase(), Aliases: ['*'], CreatedUtc: '2026-10-01T10:00:00.1234567Z', CreatedBy: 'admin', LastUsedUtc: null, RotatedUtc: null, RotatedBy: null, Disabled: false },
        ]),
      );
      expect((await fetch(k.url + '/api/reports/INFORMES/tree', { headers: { 'X-ReportmanServer-ApiKey': old } })).status).toBe(200);
      expect((await fetch(k.url + '/api/reports/INFORMES/tree', { headers: { 'X-ReportmanServer-ApiKey': 'rpsk_other' } })).status).toBe(401);
    } finally {
      await k.close();
    }
  });
});
