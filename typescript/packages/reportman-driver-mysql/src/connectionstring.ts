// A MySqlConnector connection string ("Server=db;Port=3306;Database=sales;User ID=reports;Password=...")
// read as MySqlConnectionStringBuilder reads it: the DbConnectionStringBuilder syntax (key=value pairs,
// values in quotes), the keys and synonyms of MySqlConnector 2.5 (an unknown key fails as it fails
// there), its value conversions and its defaults.

import { NetException } from 'reportman-engine';
import { MySqlException } from './errors.js';

/** MySqlSslMode. */
export type SslMode = 'None' | 'Preferred' | 'Required' | 'VerifyCA' | 'VerifyFull';
/** MySqlGuidFormat, resolved (Default is Char36, or LittleEndianBinary16 with OldGuids). */
export type GuidFormat = 'None' | 'Char36' | 'Char32' | 'Binary16' | 'TimeSwapBinary16' | 'LittleEndianBinary16';
/** MySqlDateTimeKind. */
export type DateTimeKindName = 'Unspecified' | 'Utc' | 'Local';
/** MySqlConnectionProtocol. */
export type ConnectionProtocol = 'Socket' | 'Pipe' | 'Unix' | 'Memory';

/** The settings of a connection string the driver uses (MySqlConnector's ConnectionSettings). */
export interface ConnectionSettings {
  /** The hosts of Server, in order (a comma-separated list there). */
  hosts: string[];
  port: number;
  user: string;
  password: string;
  database: string;
  protocol: ConnectionProtocol;
  sslMode: SslMode;
  sslCa: string;
  sslCert: string;
  sslKey: string;
  certificateFile: string;
  certificatePassword: string;
  /** Connection Timeout, in seconds (15). */
  connectionTimeout: number;
  allowUserVariables: boolean;
  allowZeroDateTime: boolean;
  convertZeroDateTime: boolean;
  dateTimeKind: DateTimeKindName;
  guidFormat: GuidFormat;
  ignoreCommandTransaction: boolean;
  noBackslashEscapes: boolean;
  treatTinyAsBoolean: boolean;
  useCompression: boolean;
  applicationName: string;
  allowPublicKeyRetrieval: boolean;
  serverRsaPublicKeyFile: string;
}

/** The defaults of MySqlConnector 2.5 (MySqlConnectionStringOption). */
export function defaultSettings(): ConnectionSettings {
  return {
    hosts: [],
    port: 3306,
    user: '',
    password: '',
    database: '',
    protocol: 'Socket',
    sslMode: 'Preferred',
    sslCa: '',
    sslCert: '',
    sslKey: '',
    certificateFile: '',
    certificatePassword: '',
    connectionTimeout: 15,
    allowUserVariables: false,
    allowZeroDateTime: false,
    convertZeroDateTime: false,
    dateTimeKind: 'Unspecified',
    guidFormat: 'Char36',
    ignoreCommandTransaction: false,
    noBackslashEscapes: false,
    treatTinyAsBoolean: true,
    useCompression: false,
    applicationName: '',
    allowPublicKeyRetrieval: false,
    serverRsaPublicKeyFile: '',
  };
}

type Kind = 'string' | 'uint' | 'int' | 'bool' | 'enum';

interface OptionDef {
  /** The first key: what an error names. */
  key: string;
  kind: Kind;
  /** The enum type name (for its error) and its names → value. */
  enumName?: string;
  enumValues?: Readonly<Record<string, string>>;
}

const SSL_MODES = { none: 'None', disabled: 'None', preferred: 'Preferred', required: 'Required', verifyca: 'VerifyCA', verifyfull: 'VerifyFull' };
const GUID_FORMATS = {
  default: 'Default',
  none: 'None',
  char36: 'Char36',
  char32: 'Char32',
  binary16: 'Binary16',
  timeswapbinary16: 'TimeSwapBinary16',
  littleendianbinary16: 'LittleEndianBinary16',
};
const DATETIME_KINDS = { unspecified: 'Unspecified', utc: 'Utc', local: 'Local' };
const PROTOCOLS = {
  sockets: 'Socket',
  socket: 'Socket',
  tcp: 'Socket',
  pipe: 'Pipe',
  namedpipe: 'Pipe',
  unixsocket: 'Unix',
  unix: 'Unix',
  sharedmemory: 'Memory',
  memory: 'Memory',
};
const LOAD_BALANCE = { roundrobin: 'RoundRobin', failover: 'FailOver', random: 'Random', leastconnections: 'LeastConnections' };
const REDIRECTION = { disabled: 'Disabled', preferred: 'Preferred', required: 'Required' };
const STORE_LOCATIONS = { none: 'None', currentuser: 'CurrentUser', localmachine: 'LocalMachine' };

// Every option of MySqlConnectionStringBuilder 2.5, its keys (synonyms) and its type. The driver
// uses some; the others (pooling, timeouts of the pool, Kerberos...) are accepted and have no effect
// on a report run.
const OPTIONS: [string, string[], Kind, string?, Readonly<Record<string, string>>?][] = [
  ['Server', ['Server', 'Host', 'Data Source', 'DataSource', 'Address', 'Addr', 'Network Address'], 'string'],
  ['Port', ['Port'], 'uint'],
  ['User ID', ['User ID', 'UserID', 'Username', 'Uid', 'User name', 'User'], 'string'],
  ['Password', ['Password', 'pwd'], 'string'],
  ['Database', ['Database', 'Initial Catalog'], 'string'],
  ['Load Balance', ['Load Balance', 'LoadBalance'], 'enum', 'MySqlLoadBalance', LOAD_BALANCE],
  ['Connection Protocol', ['Connection Protocol', 'ConnectionProtocol', 'Protocol'], 'enum', 'MySqlConnectionProtocol', PROTOCOLS],
  ['Pipe Name', ['Pipe Name', 'PipeName', 'Pipe'], 'string'],
  ['SSL Mode', ['SSL Mode', 'SslMode'], 'enum', 'MySqlSslMode', SSL_MODES],
  ['Certificate File', ['Certificate File', 'CertificateFile'], 'string'],
  ['Certificate Password', ['Certificate Password', 'CertificatePassword'], 'string'],
  ['Certificate Store Location', ['Certificate Store Location', 'CertificateStoreLocation'], 'enum', 'MySqlCertificateStoreLocation', STORE_LOCATIONS],
  ['Certificate Thumbprint', ['Certificate Thumbprint', 'CertificateThumbprint', 'Certificate Thumb Print'], 'string'],
  ['SSL Cert', ['SSL Cert', 'SslCert', 'Ssl-Cert'], 'string'],
  ['SSL Key', ['SSL Key', 'SslKey', 'Ssl-Key'], 'string'],
  ['SSL CA', ['SSL CA', 'CACertificateFile', 'CA Certificate File', 'SslCa', 'Ssl-Ca'], 'string'],
  ['TLS Version', ['TLS Version', 'TlsVersion', 'Tls-Version'], 'string'],
  ['TLS Cipher Suites', ['TLS Cipher Suites', 'TlsCipherSuites'], 'string'],
  ['Pooling', ['Pooling'], 'bool'],
  ['Connection Lifetime', ['Connection Lifetime', 'ConnectionLifeTime'], 'uint'],
  ['Connection Reset', ['Connection Reset', 'ConnectionReset'], 'bool'],
  ['Defer Connection Reset', ['Defer Connection Reset', 'DeferConnectionReset'], 'bool'],
  ['Connection Idle Ping Time', ['Connection Idle Ping Time', 'ConnectionIdlePingTime'], 'uint'],
  ['Connection Idle Timeout', ['Connection Idle Timeout', 'ConnectionIdleTimeout'], 'uint'],
  ['Minimum Pool Size', ['Minimum Pool Size', 'Min Pool Size', 'MinimumPoolSize', 'minpoolsize'], 'uint'],
  ['Maximum Pool Size', ['Maximum Pool Size', 'Max Pool Size', 'MaximumPoolSize', 'maxpoolsize'], 'uint'],
  ['DNS Check Interval', ['DNS Check Interval', 'DnsCheckInterval'], 'uint'],
  ['Allow Load Local Infile', ['Allow Load Local Infile', 'AllowLoadLocalInfile'], 'bool'],
  ['Allow Public Key Retrieval', ['Allow Public Key Retrieval', 'AllowPublicKeyRetrieval'], 'bool'],
  ['Allow User Variables', ['Allow User Variables', 'AllowUserVariables'], 'bool'],
  ['Allow Zero DateTime', ['Allow Zero DateTime', 'AllowZeroDateTime'], 'bool'],
  ['Application Name', ['Application Name', 'ApplicationName'], 'string'],
  ['Auto Enlist', ['Auto Enlist', 'AutoEnlist'], 'bool'],
  ['Cancellation Timeout', ['Cancellation Timeout', 'CancellationTimeout'], 'int'],
  ['Character Set', ['Character Set', 'CharSet', 'CharacterSet'], 'string'],
  ['Connection Timeout', ['Connection Timeout', 'ConnectionTimeout', 'Connect Timeout'], 'uint'],
  ['Convert Zero DateTime', ['Convert Zero DateTime', 'ConvertZeroDateTime'], 'bool'],
  ['DateTime Kind', ['DateTime Kind', 'DateTimeKind'], 'enum', 'MySqlDateTimeKind', DATETIME_KINDS],
  ['Default Command Timeout', ['Default Command Timeout', 'DefaultCommandTimeout', 'Command Timeout'], 'uint'],
  ['Force Synchronous', ['Force Synchronous', 'ForceSynchronous'], 'bool'],
  ['GUID Format', ['GUID Format', 'GuidFormat'], 'enum', 'MySqlGuidFormat', GUID_FORMATS],
  ['Ignore Command Transaction', ['Ignore Command Transaction', 'IgnoreCommandTransaction'], 'bool'],
  ['Ignore Prepare', ['Ignore Prepare', 'IgnorePrepare'], 'bool'],
  ['Interactive Session', ['Interactive Session', 'InteractiveSession', 'Interactive'], 'bool'],
  ['Keep Alive', ['Keep Alive', 'Keepalive'], 'uint'],
  ['No Backslash Escapes', ['No Backslash Escapes', 'NoBackslashEscapes'], 'bool'],
  ['Old Guids', ['Old Guids', 'OldGuids'], 'bool'],
  ['Persist Security Info', ['Persist Security Info', 'PersistSecurityInfo'], 'bool'],
  ['Pipelining', ['Pipelining'], 'bool'],
  ['Server Redirection Mode', ['Server Redirection Mode', 'ServerRedirectionMode'], 'enum', 'MySqlServerRedirectionMode', REDIRECTION],
  ['Server RSA Public Key File', ['Server RSA Public Key File', 'ServerRsaPublicKeyFile'], 'string'],
  ['Server SPN', ['Server SPN', 'ServerSPN'], 'string'],
  ['Treat Tiny As Boolean', ['Treat Tiny As Boolean', 'TreatTinyAsBoolean'], 'bool'],
  ['Use Affected Rows', ['Use Affected Rows', 'UseAffectedRows'], 'bool'],
  ['Use Compression', ['Use Compression', 'Compress', 'UseCompression'], 'bool'],
  ['Use XA Transactions', ['Use XA Transactions', 'UseXaTransactions'], 'bool'],
];

const BY_KEY = new Map<string, OptionDef>();
for (const [key, keys, kind, enumName, enumValues] of OPTIONS) {
  const def: OptionDef = { key, kind, enumName, enumValues };
  for (const k of keys) BY_KEY.set(k.toLowerCase(), def);
}

function argumentException(message: string): NetException {
  return new NetException('ArgumentException', message);
}

/** The pairs of a connection string (DbConnectionOptions.ParseInternal), in order. */
export function parsePairs(connectionString: string): [string, string][] {
  const pairs: [string, string][] = [];
  const s = connectionString;
  const n = s.length;
  let i = 0;
  const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\r' || c === '\n';
  while (i < n) {
    while (i < n && (isSpace(s.charAt(i)) || s.charAt(i) === ';')) i++;
    if (i >= n) break;
    const start = i;
    // the key: up to '=' ("==" is a '=' of the key)
    let key = '';
    for (;;) {
      if (i >= n) throw argumentException(`Format of the initialization string does not conform to specification starting at index ${start}.`);
      const c = s.charAt(i);
      if (c === '=') {
        if (s.charAt(i + 1) === '=') {
          key += '=';
          i += 2;
          continue;
        }
        i++;
        break;
      }
      if (c === ';') throw argumentException(`Format of the initialization string does not conform to specification starting at index ${start}.`);
      key += c;
      i++;
    }
    key = key.trim();
    if (key.length === 0) throw argumentException(`Format of the initialization string does not conform to specification starting at index ${start}.`);
    while (i < n && isSpace(s.charAt(i))) i++;
    let value = '';
    const q = s.charAt(i);
    if (q === '"' || q === "'") {
      i++;
      for (;;) {
        if (i >= n) throw argumentException(`Format of the initialization string does not conform to specification starting at index ${start}.`);
        const c = s.charAt(i);
        if (c === q) {
          if (s.charAt(i + 1) === q) {
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
      while (i < n && isSpace(s.charAt(i))) i++;
      if (i < n && s.charAt(i) !== ';') throw argumentException(`Format of the initialization string does not conform to specification starting at index ${start}.`);
    } else {
      const end = s.indexOf(';', i);
      value = (end < 0 ? s.substring(i) : s.substring(i, end)).trim();
      i = end < 0 ? n : end;
    }
    pairs.push([key, value]);
  }
  return pairs;
}

/** Convert.ChangeType(string, bool) with MySqlConnector's "yes"/"no". */
function toBool(def: OptionDef, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === 'yes' || v === 'true') return true;
  if (v === 'no' || v === 'false') return false;
  throw argumentException(`Invalid value '${value}' for '${def.key}' connection string option.`);
}

function toInteger(def: OptionDef, value: string, unsigned: boolean): number {
  const t = value.trim();
  const ok = unsigned ? /^\+?\d+$/.test(t) : /^[+-]?\d+$/.test(t);
  const n = Number(t);
  if (!ok || (unsigned ? n > 4294967295 : n < -2147483648 || n > 2147483647)) {
    throw argumentException(`Invalid value '${value}' for '${def.key}' connection string option.`);
  }
  return n;
}

function toEnum(def: OptionDef, value: string): string {
  const v = def.enumValues![value.trim().toLowerCase()];
  if (v === undefined) {
    // Enum.Parse: a name it does not know is an ArgumentException of its own
    throw argumentException(`Requested value '${value}' was not found.`);
  }
  return v;
}

/** Reads a MySqlConnector connection string over the defaults. */
export function parseConnectionString(connectionString: string): ConnectionSettings {
  const values = new Map<OptionDef, string>();
  for (const [key, value] of parsePairs(connectionString)) {
    const def = BY_KEY.get(key.toLowerCase());
    // DbConnectionOptions keeps the keys in lower case: the error names it so
    if (def === undefined) throw argumentException(`Option '${key.toLowerCase()}' not supported.`);
    // an empty value resets the option to its default (DbConnectionStringBuilder removes it)
    if (value.length === 0) values.delete(def);
    else values.set(def, value);
  }
  const s = defaultSettings();
  let guidFormat = 'Default';
  let oldGuids = false;
  for (const [def, value] of values) {
    switch (def.kind) {
      case 'bool': {
        const b = toBool(def, value);
        switch (def.key) {
          case 'Allow User Variables':
            s.allowUserVariables = b;
            break;
          case 'Allow Zero DateTime':
            s.allowZeroDateTime = b;
            break;
          case 'Allow Public Key Retrieval':
            s.allowPublicKeyRetrieval = b;
            break;
          case 'Convert Zero DateTime':
            s.convertZeroDateTime = b;
            break;
          case 'Ignore Command Transaction':
            s.ignoreCommandTransaction = b;
            break;
          case 'No Backslash Escapes':
            s.noBackslashEscapes = b;
            break;
          case 'Treat Tiny As Boolean':
            s.treatTinyAsBoolean = b;
            break;
          case 'Use Compression':
            s.useCompression = b;
            break;
          case 'Old Guids':
            oldGuids = b;
            break;
        }
        break;
      }
      case 'uint':
      case 'int': {
        const n = toInteger(def, value, def.kind === 'uint');
        if (def.key === 'Port') s.port = n;
        else if (def.key === 'Connection Timeout') s.connectionTimeout = n;
        break;
      }
      case 'enum': {
        const e = toEnum(def, value);
        if (def.key === 'SSL Mode') s.sslMode = e as SslMode;
        else if (def.key === 'GUID Format') guidFormat = e;
        else if (def.key === 'DateTime Kind') s.dateTimeKind = e as DateTimeKindName;
        else if (def.key === 'Connection Protocol') s.protocol = e as ConnectionProtocol;
        break;
      }
      case 'string':
        switch (def.key) {
          case 'Server':
            s.hosts = value.split(',').map((h) => h.trim()).filter((h) => h.length > 0);
            break;
          case 'User ID':
            s.user = value;
            break;
          case 'Password':
            s.password = value;
            break;
          case 'Database':
            s.database = value;
            break;
          case 'SSL CA':
            s.sslCa = value;
            break;
          case 'SSL Cert':
            s.sslCert = value;
            break;
          case 'SSL Key':
            s.sslKey = value;
            break;
          case 'Certificate File':
            s.certificateFile = value;
            break;
          case 'Certificate Password':
            s.certificatePassword = value;
            break;
          case 'Application Name':
            s.applicationName = value;
            break;
          case 'Server RSA Public Key File':
            s.serverRsaPublicKeyFile = value;
            break;
        }
        break;
    }
  }
  s.guidFormat = effectiveGuidFormat(guidFormat, oldGuids);
  return s;
}

/** ConnectionSettings.GetEffectiveGuidFormat. */
export function effectiveGuidFormat(guidFormat: string, oldGuids: boolean): GuidFormat {
  if (guidFormat === 'Default') return oldGuids ? 'LittleEndianBinary16' : 'Char36';
  if (oldGuids) throw new MySqlException('OldGuids cannot be used with GuidFormat');
  return guidFormat as GuidFormat;
}
