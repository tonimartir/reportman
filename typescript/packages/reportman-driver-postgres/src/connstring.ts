// Npgsql connection strings ("Host=...;Port=...;Database=...;Username=...;Password=..."), the
// form Reportman.Server and the .NET designer keep, as a pg configuration. Keywords are those of
// NpgsqlConnectionStringBuilder (case insensitive, with their synonyms); the ones about pooling,
// multiplexing or the .NET runtime have no meaning here and are ignored.

import fs from 'node:fs';
import type { ConnectionOptions } from 'node:tls';
import type pg from 'pg';

/** What a connection string sets: the pg configuration and the Npgsql behaviours it chose. */
export interface ParsedConnectionString {
  config: pg.ClientConfig;
  /** Command Timeout (seconds; 0: none). Npgsql's default is 30. */
  commandTimeout?: number;
  /** Include Error Detail: the DETAIL of server errors in their message. */
  includeErrorDetail?: boolean;
}

/** DbConnectionStringBuilder: key=value pairs separated by ';', values optionally quoted. */
export function connectionStringPairs(text: string): [string, string][] {
  const pairs: [string, string][] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    while (i < n && (text.charAt(i) === ';' || /\s/.test(text.charAt(i)))) i++;
    if (i >= n) break;
    let key = '';
    while (i < n && text.charAt(i) !== '=') {
      // "==" inside a key is a literal "="
      key += text.charAt(i++);
    }
    i++; // '='
    while (i < n && text.charAt(i) === ' ') i++;
    let value = '';
    const q = text.charAt(i);
    if (q === '"' || q === "'") {
      i++;
      while (i < n) {
        const c = text.charAt(i);
        if (c === q) {
          if (text.charAt(i + 1) === q) {
            value += q;
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += c;
        i++;
      }
      while (i < n && text.charAt(i) !== ';') i++;
    } else {
      while (i < n && text.charAt(i) !== ';') value += text.charAt(i++);
      value = value.trim();
    }
    pairs.push([key.trim(), value]);
  }
  return pairs;
}

const KEYWORDS: Record<string, string> = {
  host: 'host',
  server: 'host',
  port: 'port',
  database: 'database',
  db: 'database',
  username: 'user',
  'user name': 'user',
  userid: 'user',
  'user id': 'user',
  uid: 'user',
  password: 'password',
  psw: 'password',
  pwd: 'password',
  'ssl mode': 'sslmode',
  sslmode: 'sslmode',
  'trust server certificate': 'trustservercertificate',
  trustservercertificate: 'trustservercertificate',
  'root certificate': 'rootcertificate',
  rootcertificate: 'rootcertificate',
  'ssl certificate': 'sslcertificate',
  sslcertificate: 'sslcertificate',
  'ssl key': 'sslkey',
  sslkey: 'sslkey',
  'ssl password': 'sslpassword',
  sslpassword: 'sslpassword',
  timeout: 'timeout',
  'command timeout': 'commandtimeout',
  commandtimeout: 'commandtimeout',
  'application name': 'applicationname',
  applicationname: 'applicationname',
  'search path': 'searchpath',
  searchpath: 'searchpath',
  timezone: 'timezone',
  options: 'options',
  'include error detail': 'includeerrordetail',
  includeerrordetail: 'includeerrordetail',
  'client encoding': 'clientencoding',
  clientencoding: 'clientencoding',
  encoding: 'clientencoding',
  keepalive: 'keepalive',
  'tcp keepalive': 'tcpkeepalive',
  tcpkeepalive: 'tcpkeepalive',
  'integrated security': 'integratedsecurity',
  integratedsecurity: 'integratedsecurity',
};

function bool(value: string): boolean {
  return /^(true|yes|1)$/i.test(value);
}

/** The libpq form of a startup option (-c name=value, spaces escaped). */
function startupOption(name: string, value: string): string {
  return '-c ' + name + '=' + value.replace(/\\/g, '\\\\').replace(/ /g, '\\ ');
}

/** An Npgsql connection string as a pg configuration. */
export function parseNpgsqlConnectionString(text: string): ParsedConnectionString {
  const config: pg.ClientConfig = {};
  const out: ParsedConnectionString = { config };
  const options: string[] = [];
  let sslMode = 'prefer';
  let trust = false;
  const ssl: ConnectionOptions = {};
  for (const [rawKey, value] of connectionStringPairs(text)) {
    const key = KEYWORDS[rawKey.toLowerCase()] ?? KEYWORDS[rawKey.toLowerCase().replace(/[\s_]/g, '')];
    switch (key) {
      case 'host': {
        // The first host of a list; "host:port" carries its port
        const first = value.split(',')[0]!.trim();
        const m = /^(.*):(\d+)$/.exec(first);
        if (m !== null && !first.startsWith('[')) {
          config.host = m[1];
          config.port = Number(m[2]);
        } else config.host = first.replace(/^\[(.*)\]$/, '$1');
        break;
      }
      case 'port':
        config.port = Number(value);
        break;
      case 'database':
        config.database = value;
        break;
      case 'user':
        config.user = value;
        break;
      case 'password':
        config.password = value;
        break;
      case 'sslmode':
        sslMode = value.toLowerCase().replace(/[-_]/g, '');
        break;
      case 'trustservercertificate':
        trust = bool(value);
        break;
      case 'rootcertificate':
        ssl.ca = fs.readFileSync(value);
        break;
      case 'sslcertificate':
        ssl.cert = fs.readFileSync(value);
        break;
      case 'sslkey':
        ssl.key = fs.readFileSync(value);
        break;
      case 'sslpassword':
        ssl.passphrase = value;
        break;
      case 'timeout':
        config.connectionTimeoutMillis = Number(value) * 1000;
        break;
      case 'commandtimeout':
        out.commandTimeout = Number(value);
        break;
      case 'applicationname':
        config.application_name = value;
        break;
      case 'searchpath':
        options.push(startupOption('search_path', value));
        break;
      case 'timezone':
        options.push(startupOption('TimeZone', value));
        break;
      case 'options':
        options.push(value);
        break;
      case 'includeerrordetail':
        out.includeErrorDetail = bool(value);
        break;
      case 'clientencoding':
        if (!/^utf-?8$/i.test(value)) throw new Error('Client Encoding=' + value + ' is not supported: the driver talks UTF8 to PostgreSQL');
        break;
      case 'keepalive':
      case 'tcpkeepalive':
        if (Number(value) > 0 || bool(value)) config.keepAlive = true;
        break;
      case 'integratedsecurity':
        if (bool(value)) throw new Error('Integrated Security (Kerberos / GSS) is not supported by the PostgreSQL driver');
        break;
      default:
        // Pooling, Multiplexing, Max Auto Prepare... have no meaning for one connection per report
        break;
    }
  }
  // SSL Mode: Disable, Allow and Prefer connect in clear (pg cannot fall back from TLS, as Prefer
  // does); Require encrypts, VerifyCA / VerifyFull verify the certificate too.
  if (sslMode === 'require') config.ssl = { ...ssl, rejectUnauthorized: !trust && ssl.ca !== undefined };
  else if (sslMode === 'verifyca' || sslMode === 'verifyfull') {
    config.ssl = { ...ssl, rejectUnauthorized: !trust };
    if (sslMode === 'verifyca') (config.ssl as ConnectionOptions).checkServerIdentity = () => undefined;
  }
  if (options.length > 0) config.options = options.join(' ');
  return out;
}
