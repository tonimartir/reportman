// A SqlClient connection string ("Server=db,1433;Database=sales;User ID=reports;Password=...;
// TrustServerCertificate=True") read as Microsoft.Data.SqlClient 6.1 reads it (SqlConnectionString):
// the DbConnectionOptions syntax (key=value pairs, values in quotes), the keywords and synonyms of
// SqlClient (an unknown keyword fails as it fails there), its value conversions, checks and
// defaults (Encrypt=Mandatory since SqlClient 4).

import { NetException } from 'reportman-engine';
import { argumentException, notSupported } from './errors.js';

/** SqlConnectionEncryptOption. */
export type EncryptOption = 'Optional' | 'Mandatory' | 'Strict';

/** SqlAuthenticationMethod. */
export type AuthenticationMethod =
  | 'NotSpecified'
  | 'SqlPassword'
  | 'ActiveDirectoryPassword'
  | 'ActiveDirectoryIntegrated'
  | 'ActiveDirectoryInteractive'
  | 'ActiveDirectoryServicePrincipal'
  | 'ActiveDirectoryDeviceCodeFlow'
  | 'ActiveDirectoryManagedIdentity'
  | 'ActiveDirectoryDefault'
  | 'ActiveDirectoryWorkloadIdentity';

/** Type System Version. */
export type TypeSystemVersion = 'SQL Server 2000' | 'SQL Server 2005' | 'SQL Server 2008' | 'SQL Server 2012' | 'Latest';

/** The settings of a SqlClient connection string the driver uses (SqlConnectionString). */
export interface SqlSettings {
  /** Data Source as written. */
  dataSource: string;
  database: string;
  userId: string;
  password: string;
  integratedSecurity: boolean;
  authentication: AuthenticationMethod;
  encrypt: EncryptOption;
  trustServerCertificate: boolean;
  hostNameInCertificate: string;
  serverCertificate: string;
  /** Connect Timeout, seconds (15; 0 waits for ever). */
  connectTimeout: number;
  /** Command Timeout, seconds (30): the C# engine sets 0 (no limit) on every command. */
  commandTimeout: number;
  applicationName: string;
  /** Workstation ID ("" sends the name of the machine). */
  workstationId: string;
  currentLanguage: string;
  packetSize: number;
  applicationIntent: 'ReadWrite' | 'ReadOnly';
  multiSubnetFailover: boolean;
  multipleActiveResultSets: boolean;
  columnEncryption: boolean;
  typeSystemVersion: TypeSystemVersion;
  attachDbFilename: string;
  userInstance: boolean;
  failoverPartner: string;
}

/** The default Application Name of SqlClient (on .NET Core). */
export const DEFAULT_APPLICATION_NAME = 'Core Microsoft SqlClient Data Provider';

/** The defaults of SqlClient 6.1 (DbConnectionStringDefaults). */
export function defaultSettings(): SqlSettings {
  return {
    dataSource: '',
    database: '',
    userId: '',
    password: '',
    integratedSecurity: false,
    authentication: 'NotSpecified',
    encrypt: 'Mandatory',
    trustServerCertificate: false,
    hostNameInCertificate: '',
    serverCertificate: '',
    connectTimeout: 15,
    commandTimeout: 30,
    applicationName: DEFAULT_APPLICATION_NAME,
    workstationId: '',
    currentLanguage: '',
    packetSize: 8000,
    applicationIntent: 'ReadWrite',
    multiSubnetFailover: false,
    multipleActiveResultSets: false,
    columnEncryption: false,
    typeSystemVersion: 'Latest',
    attachDbFilename: '',
    userInstance: false,
    failoverPartner: '',
  };
}

type Kind = 'string' | 'int' | 'bool' | 'encrypt' | 'enum';

// Every keyword of SqlConnectionStringBuilder 6.1: its canonical name (what an error names), its
// synonyms and its type. The pool, retry, failover and enclave options are accepted and change
// nothing for a report run.
const KEYWORDS: [string, string[], Kind, Readonly<Record<string, string>>?][] = [
  ['Application Intent', ['ApplicationIntent'], 'enum', { readwrite: 'ReadWrite', readonly: 'ReadOnly' }],
  ['Application Name', ['App'], 'string'],
  ['AttachDbFilename', ['Extended Properties', 'Initial File Name'], 'string'],
  ['Attestation Protocol', [], 'enum', { notspecified: 'NotSpecified', aas: 'AAS', hgs: 'HGS', none: 'None' }],
  [
    'Authentication',
    [],
    'enum',
    {
      sqlpassword: 'SqlPassword',
      activedirectorypassword: 'ActiveDirectoryPassword',
      activedirectoryintegrated: 'ActiveDirectoryIntegrated',
      activedirectoryinteractive: 'ActiveDirectoryInteractive',
      activedirectoryserviceprincipal: 'ActiveDirectoryServicePrincipal',
      activedirectorydevicecodeflow: 'ActiveDirectoryDeviceCodeFlow',
      activedirectorymanagedidentity: 'ActiveDirectoryManagedIdentity',
      activedirectorymsi: 'ActiveDirectoryManagedIdentity',
      activedirectorydefault: 'ActiveDirectoryDefault',
      activedirectoryworkloadidentity: 'ActiveDirectoryWorkloadIdentity',
    },
  ],
  ['Column Encryption Setting', [], 'enum', { enabled: 'Enabled', disabled: 'Disabled' }],
  ['Command Timeout', [], 'int'],
  ['Connect Retry Count', ['ConnectRetryCount'], 'int'],
  ['Connect Retry Interval', ['ConnectRetryInterval'], 'int'],
  ['Connect Timeout', ['Connection Timeout', 'Timeout'], 'int'],
  ['Context Connection', [], 'bool'],
  ['Current Language', ['Language'], 'string'],
  ['Data Source', ['Server', 'Address', 'Addr', 'Network Address'], 'string'],
  ['Enclave Attestation Url', [], 'string'],
  ['Encrypt', [], 'encrypt'],
  ['Enlist', [], 'bool'],
  ['Failover Partner', [], 'string'],
  ['Failover Partner SPN', ['FailoverPartnerSPN'], 'string'],
  ['Host Name In Certificate', ['HostNameInCertificate'], 'string'],
  ['Initial Catalog', ['Database'], 'string'],
  ['Integrated Security', ['Trusted_Connection'], 'bool'],
  ['IP Address Preference', ['IPAddressPreference'], 'enum', { ipv4first: 'IPv4First', ipv6first: 'IPv6First', useplatformdefault: 'UsePlatformDefault' }],
  ['Load Balance Timeout', ['Connection Lifetime'], 'int'],
  ['Max Pool Size', [], 'int'],
  ['Min Pool Size', [], 'int'],
  ['Multiple Active Result Sets', ['MultipleActiveResultSets'], 'bool'],
  ['Multi Subnet Failover', ['MultiSubnetFailover'], 'bool'],
  ['Packet Size', [], 'int'],
  ['Password', ['Pwd'], 'string'],
  ['Persist Security Info', ['PersistSecurityInfo'], 'bool'],
  ['Pool Blocking Period', ['PoolBlockingPeriod'], 'enum', { auto: 'Auto', alwaysblock: 'AlwaysBlock', neverblock: 'NeverBlock' }],
  ['Pooling', [], 'bool'],
  ['Replication', [], 'bool'],
  ['Server Certificate', ['ServerCertificate'], 'string'],
  ['Server SPN', ['ServerSPN'], 'string'],
  ['Transaction Binding', [], 'enum', { 'implicit unbind': 'Implicit Unbind', 'explicit unbind': 'Explicit Unbind' }],
  ['Trust Server Certificate', ['TrustServerCertificate'], 'bool'],
  [
    'Type System Version',
    [],
    'enum',
    {
      'sql server 2000': 'SQL Server 2000',
      'sql server 2005': 'SQL Server 2005',
      'sql server 2008': 'SQL Server 2008',
      'sql server 2012': 'SQL Server 2012',
      latest: 'Latest',
    },
  ],
  ['User ID', ['UID', 'User'], 'string'],
  ['User Instance', [], 'bool'],
  ['Workstation ID', ['WSID'], 'string'],
];

interface KeywordDef {
  readonly key: string;
  readonly kind: Kind;
  readonly values?: Readonly<Record<string, string>>;
}

const BY_KEY = new Map<string, KeywordDef>();
for (const [key, synonyms, kind, values] of KEYWORDS) {
  const def: KeywordDef = { key, kind, values };
  BY_KEY.set(key.toLowerCase(), def);
  for (const s of synonyms) BY_KEY.set(s.toLowerCase(), def);
}

function formatError(start: number): NetException {
  return argumentException(`Format of the initialization string does not conform to specification starting at index ${start}.`);
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
      if (i >= n) throw formatError(start);
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
      if (c === ';') throw formatError(start);
      key += c;
      i++;
    }
    key = key.trim();
    if (key.length === 0) throw formatError(start);
    while (i < n && isSpace(s.charAt(i))) i++;
    let value = '';
    const q = s.charAt(i);
    if (q === '"' || q === "'") {
      i++;
      for (;;) {
        if (i >= n) throw formatError(start);
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
      if (i < n && s.charAt(i) !== ';') throw formatError(start);
    } else {
      const end = s.indexOf(';', i);
      value = (end < 0 ? s.substring(i) : s.substring(i, end)).trim();
      i = end < 0 ? n : end;
    }
    pairs.push([key, value]);
  }
  return pairs;
}

function invalidValue(def: KeywordDef): NetException {
  return argumentException(`Invalid value for key '${def.key}'.`);
}

/** DbConnectionStringUtilities.ConvertToBoolean: true/yes, false/no (and sspi for Integrated Security). */
function toBool(def: KeywordDef, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === 'yes' || (v === 'sspi' && def.key === 'Integrated Security')) return true;
  if (v === 'false' || v === 'no') return false;
  throw invalidValue(def);
}

/** Int32.Parse of the value (invariant, leading and trailing white space). */
function toInt(def: KeywordDef, value: string): number {
  const t = value.trim();
  if (!/^[+-]?\d+$/.test(t)) throw invalidValue(def);
  const n = Number(t);
  if (n < -2147483648 || n > 2147483647) throw invalidValue(def);
  return n;
}

/** SqlConnectionEncryptOption.Parse. */
function toEncrypt(def: KeywordDef, value: string): EncryptOption {
  switch (value.trim().toLowerCase()) {
    case 'true':
    case 'yes':
    case 'mandatory':
      return 'Mandatory';
    case 'false':
    case 'no':
    case 'optional':
      return 'Optional';
    case 'strict':
      return 'Strict';
    default:
      throw invalidValue(def);
  }
}

/** An enum value: its name without spaces, ignoring case (Authentication accepts "Active Directory Password"). */
function toEnum(def: KeywordDef, value: string): string {
  const v = value.trim().toLowerCase();
  const found = def.values![v] ?? def.values![v.replace(/\s+/g, '')];
  if (found === undefined) throw invalidValue(def);
  return found;
}

/** Reads a SqlClient connection string over the defaults, with the checks of SqlConnectionString. */
export function parseConnectionString(connectionString: string): SqlSettings {
  const values = new Map<KeywordDef, string>();
  for (const [key, value] of parsePairs(connectionString)) {
    const def = BY_KEY.get(key.toLowerCase());
    // DbConnectionOptions keeps the keys in lower case: the error names it so
    if (def === undefined) throw argumentException(`Keyword not supported: '${key.toLowerCase()}'.`);
    values.set(def, value);
  }
  const s = defaultSettings();
  const ints = new Map<string, number>();
  let authenticationGiven = false;
  for (const [def, value] of values) {
    switch (def.kind) {
      case 'bool': {
        const b = toBool(def, value);
        if (def.key === 'Integrated Security') s.integratedSecurity = b;
        else if (def.key === 'Trust Server Certificate') s.trustServerCertificate = b;
        else if (def.key === 'Multiple Active Result Sets') s.multipleActiveResultSets = b;
        else if (def.key === 'Multi Subnet Failover') s.multiSubnetFailover = b;
        else if (def.key === 'User Instance') s.userInstance = b;
        break;
      }
      case 'int':
        ints.set(def.key, toInt(def, value));
        break;
      case 'encrypt':
        s.encrypt = toEncrypt(def, value);
        break;
      case 'enum': {
        const e = toEnum(def, value);
        if (def.key === 'Application Intent') s.applicationIntent = e as SqlSettings['applicationIntent'];
        else if (def.key === 'Authentication') {
          s.authentication = e as AuthenticationMethod;
          authenticationGiven = true;
        } else if (def.key === 'Column Encryption Setting') s.columnEncryption = e === 'Enabled';
        else if (def.key === 'Type System Version') s.typeSystemVersion = e as TypeSystemVersion;
        break;
      }
      case 'string':
        switch (def.key) {
          case 'Data Source':
            s.dataSource = value;
            break;
          case 'Initial Catalog':
            s.database = value;
            break;
          case 'User ID':
            s.userId = value;
            break;
          case 'Password':
            s.password = value;
            break;
          case 'Application Name':
            s.applicationName = value;
            break;
          case 'Workstation ID':
            s.workstationId = value;
            break;
          case 'Current Language':
            s.currentLanguage = value;
            break;
          case 'Host Name In Certificate':
            s.hostNameInCertificate = value;
            break;
          case 'Server Certificate':
            s.serverCertificate = value;
            break;
          case 'AttachDbFilename':
            s.attachDbFilename = value;
            break;
          case 'Failover Partner':
            s.failoverPartner = value;
            break;
        }
        break;
    }
  }
  // The checks of the SqlConnectionString constructor
  const int = (key: string): number | undefined => ints.get(key);
  const connectTimeout = int('Connect Timeout');
  if (connectTimeout !== undefined) {
    if (connectTimeout < 0) throw argumentException("Invalid value for key 'Connect Timeout'.");
    s.connectTimeout = connectTimeout;
  }
  const commandTimeout = int('Command Timeout');
  if (commandTimeout !== undefined) {
    if (commandTimeout < 0) throw argumentException("Invalid value for key 'Command Timeout'.");
    s.commandTimeout = commandTimeout;
  }
  const loadBalance = int('Load Balance Timeout');
  if (loadBalance !== undefined && loadBalance < 0) throw argumentException("Invalid value for key 'Load Balance Timeout'.");
  const maxPool = int('Max Pool Size') ?? 100;
  const minPool = int('Min Pool Size') ?? 0;
  if (maxPool < 1) throw argumentException("Invalid value for key 'Max Pool Size'.");
  if (minPool < 0) throw argumentException("Invalid value for key 'Min Pool Size'.");
  if (maxPool < minPool) throw argumentException('Invalid min or max pool size values, min pool size cannot be greater than the max pool size.');
  const packetSize = int('Packet Size');
  if (packetSize !== undefined) {
    if (packetSize < 512 || packetSize > 32768) throw argumentException("Invalid 'Packet Size'.  The value must be an integer >= 512 and <= 32768.");
    s.packetSize = packetSize;
  }
  const retryCount = int('Connect Retry Count');
  if (retryCount !== undefined && (retryCount < 0 || retryCount > 255)) throw argumentException("Invalid value for key 'Connect Retry Count'.");
  const retryInterval = int('Connect Retry Interval');
  if (retryInterval !== undefined && (retryInterval < 1 || retryInterval > 60)) throw argumentException("Invalid value for key 'Connect Retry Interval'.");
  if (s.failoverPartner.length > 0 && s.database.length === 0) {
    throw argumentException("Use of key 'Failover Partner' requires the key 'Initial Catalog' to be present.");
  }
  if (authenticationGiven && s.integratedSecurity) throw argumentException("Cannot use 'Authentication' with 'Integrated Security'.");
  return s;
}

/** Where to connect: Data Source read as SqlClient's DataSource does (tcp:host\instance,port). */
export interface ServerAddress {
  host: string;
  /** An explicit port (it wins over the instance name, as in SqlClient). */
  port: number | undefined;
  /** The instance name, looked up with the SQL Server Browser when there is no port. */
  instanceName: string | undefined;
}

/** The host, port and instance of Data Source; the protocols this driver cannot use fail with NotSupportedException. */
export function parseDataSource(dataSource: string): ServerAddress {
  let ds = dataSource.trim();
  const protocol = /^(tcp|np|lpc|admin):/i.exec(ds);
  if (protocol !== null) {
    const p = protocol[1]!.toLowerCase();
    if (p === 'np') throw notSupported('The SQL Server driver of Report Manager connects through TCP: named pipes (np:) are not supported.');
    if (p === 'lpc') throw notSupported('The SQL Server driver of Report Manager connects through TCP: shared memory (lpc:) is not supported.');
    if (p === 'admin') throw notSupported('The SQL Server driver of Report Manager does not open the dedicated administrator connection (admin:).');
    ds = ds.substring(protocol[0].length).trim();
  }
  if (/^\(localdb\)/i.test(ds)) {
    throw notSupported('The SQL Server driver of Report Manager connects through TCP: LocalDB ((localdb)\\...) is not supported. Use a SQL Server that listens on TCP.');
  }
  let port: number | undefined;
  const comma = ds.lastIndexOf(',');
  let hostPart = ds;
  if (comma >= 0) {
    const p = ds.substring(comma + 1).trim();
    hostPart = ds.substring(0, comma).trim();
    if (!/^\d+$/.test(p) || Number(p) > 65535) {
      throw argumentException(`The port of Data Source '${dataSource}' is not a number.`);
    }
    port = Number(p);
  }
  let instanceName: string | undefined;
  const slash = hostPart.indexOf('\\');
  if (slash >= 0) {
    instanceName = hostPart.substring(slash + 1).trim();
    hostPart = hostPart.substring(0, slash).trim();
    if (instanceName.length === 0) instanceName = undefined;
  }
  // "[::1]" is an IPv6 address
  if (hostPart.startsWith('[') && hostPart.endsWith(']')) hostPart = hostPart.substring(1, hostPart.length - 1);
  if (hostPart.length === 0 || hostPart === '.' || hostPart.toLowerCase() === '(local)') hostPart = 'localhost';
  return { host: hostPart, port, instanceName: port === undefined ? instanceName : undefined };
}
