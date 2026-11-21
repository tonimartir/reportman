// A FirebirdClient connection string ("DataSource=localhost;Port=3050;Database=/data/x.fdb;User=SYSDBA;
// Password=...;Charset=UTF8"), read as FirebirdClient reads it (ConnectionString.Load): the same keys
// and synonyms, values in quotes, and the server and port written in the database ("host/port:path",
// "//host:port/path", "inet://host/path"...).

/** The settings of a connection string the driver uses. */
export interface ConnectionSettings {
  dataSource: string;
  port: number;
  database: string;
  user: string;
  password: string;
  role: string;
  charset: string;
  dialect: number;
  /** Connection Timeout, in seconds. */
  connectionTimeout: number;
  wireCrypt: 'Disabled' | 'Enabled' | 'Required';
  compression: boolean;
}

const SYNONYMS: Readonly<Record<string, string>> = {
  'data source': 'data source',
  datasource: 'data source',
  server: 'data source',
  host: 'data source',
  port: 'port number',
  'port number': 'port number',
  database: 'initial catalog',
  'initial catalog': 'initial catalog',
  'user id': 'user id',
  userid: 'user id',
  uid: 'user id',
  user: 'user id',
  'user name': 'user id',
  username: 'user id',
  password: 'password',
  'user password': 'password',
  userpassword: 'password',
  dialect: 'dialect',
  'character set': 'character set',
  charset: 'character set',
  timeout: 'connection timeout',
  'connection timeout': 'connection timeout',
  connectiontimeout: 'connection timeout',
  role: 'role name',
  'role name': 'role name',
  compression: 'compression',
  'wire compression': 'compression',
  'wire crypt': 'wire crypt',
  wirecrypt: 'wire crypt',
};

/** The defaults of FirebirdClient (ConnectionString.DefaultValues). */
export function defaultSettings(): ConnectionSettings {
  return {
    dataSource: '',
    port: 3050,
    database: '',
    user: '',
    password: '',
    role: '',
    charset: 'UTF8',
    dialect: 3,
    connectionTimeout: 15,
    wireCrypt: 'Enabled',
    compression: false,
  };
}

const KEY_PAIRS = /(([\w\s\d]*)\s*?=\s*?"([^"]*)"|([\w\s\d]*)\s*?=\s*?'([^']*)'|([\w\s\d]*)\s*?=\s*?([^"';][^;]*))/g;

function invalidValue(key: string): Error {
  const e = new Error(`Invalid value for key '${key}'.`);
  e.name = 'ArgumentException';
  return e;
}

/** Reads a FirebirdClient connection string over the defaults. */
export function parseConnectionString(connectionString: string): ConnectionSettings {
  const s = defaultSettings();
  for (const m of connectionString.matchAll(KEY_PAIRS)) {
    const key = (m[2] ?? m[4] ?? m[6] ?? '').trim().toLowerCase();
    const value = (m[3] ?? m[5] ?? m[7] ?? '').trim();
    if (key.length === 0 || value.length === 0) continue;
    const name = SYNONYMS[key];
    if (name === undefined) continue;
    switch (name) {
      case 'data source':
        s.dataSource = value;
        break;
      case 'port number': {
        const n = Number(value);
        if (!Number.isInteger(n)) throw invalidValue('port number');
        s.port = n;
        break;
      }
      case 'initial catalog':
        s.database = value;
        break;
      case 'user id':
        s.user = value;
        break;
      case 'password':
        s.password = value;
        break;
      case 'role name':
        s.role = value;
        break;
      case 'character set':
        s.charset = value;
        break;
      case 'dialect':
        s.dialect = Number(value);
        break;
      case 'connection timeout':
        s.connectionTimeout = Number(value);
        break;
      case 'compression':
        s.compression = value.toLowerCase() === 'true';
        break;
      case 'wire crypt': {
        const v = ['Disabled', 'Enabled', 'Required'].find((x) => x.toLowerCase() === value.toLowerCase());
        if (v === undefined) throw invalidValue('wire crypt');
        s.wireCrypt = v as ConnectionSettings['wireCrypt'];
        break;
      }
    }
  }
  if (s.database.length > 0) parseConnectionInfo(s);
  return s;
}

/** ConnectionString.ParseConnectionInfo: a server and port written in the database. */
function parseConnectionInfo(s: ConnectionSettings): void {
  const info = s.database.trim();
  const forms: [RegExp, boolean][] = [
    [/^inet:\/\/\[(?<host>[A-Za-z0-9:]{2,})\]:(?<port>\d+)\/(?<database>.+)$/, true],
    [/^inet:\/\/(?<host>[A-Za-z0-9.-]{2,}):(?<port>\d+)\/(?<database>.+)$/, true],
    [/^inet:\/\/(?<host>[A-Za-z0-9.:-]{2,})\/(?<database>.+)$/, false],
    [/^\/\/\[(?<host>[A-Za-z0-9:]{2,})\]:(?<port>\d+)\/(?<database>.+)$/, true],
    [/^\/\/(?<host>[A-Za-z0-9.-]{2,}):(?<port>\d+)\/(?<database>.+)$/, true],
    [/^\/\/(?<host>[A-Za-z0-9.:-]{2,})\/(?<database>.+)$/, false],
    [/^(?<host>[A-Za-z0-9.:-]{2,}):(?<database>[A-Za-z]:\\.+)$/, false],
    [/^(?<host>[A-Za-z0-9.:-]{2,})\/(?<port>\d+):(?<database>.+)$/, true],
    [/^(?<host>[A-Za-z0-9.:-]{2,}):(?<database>.+)$/, false],
  ];
  const localDatabase = /^inet:\/\/\/(?<database>.+)$/.exec(info);
  for (const [regex, hasPort] of forms.slice(0, 3)) {
    const m = regex.exec(info);
    if (m?.groups !== undefined) return apply(s, m.groups, hasPort);
  }
  if (localDatabase?.groups !== undefined) {
    s.database = localDatabase.groups.database!;
    s.dataSource = 'localhost';
    return;
  }
  for (const [regex, hasPort] of forms.slice(3)) {
    const m = regex.exec(info);
    if (m?.groups !== undefined) return apply(s, m.groups, hasPort);
  }
}

function apply(s: ConnectionSettings, groups: Record<string, string>, hasPort: boolean): void {
  s.database = groups.database!;
  s.dataSource = groups.host!;
  if (hasPort) s.port = Number(groups.port);
}
