// Port of BaseReport.ConvertToDotNet and ReportReader.ConvertToDotNet: what the C# engine does to
// a report of the Delphi engine when it loads it (and golden-cs before running it): the SQL
// parameters `:NAME` become `@NAME` with a report parameter bound to the dataset, the connections
// become .Net connections, and the Delphi date formats of the expressions become .Net ones.
// A connection already .Net, Mybase, or a SQLite connection of the Delphi engine leaves the report
// as it is.

import { DatasetType, DriverType } from 'reportman-lib';
import { toUpperNet } from '../util/chars.js';
import { ReportParam } from '../params/param.js';
import { ParamType, Variant } from '../variant/variant.js';
import { ExpressionItem } from './items.js';
import type { ReportRuntime } from './report.js';

const FIREBIRD_PROVIDER2 = 'FirebirdSql.Data.FirebirdClient';

/** Strings.FromSemiColon. */
function fromSemiColon(text: string): string[] {
  return text.split(';');
}

/** StringUtil.IsAlpha without the punctuation the parameter scan excludes: [0-9A-Za-z_]. */
function isParamChar(c: string): boolean {
  return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_';
}

/** The report parameter of an alias, created (empty string value) when the report has none. */
function ensureParam(rp: ReportRuntime, alias: string): ReportParam {
  const index = rp.paramIndexOf(alias);
  if (index >= 0) return rp.params[index]!;
  const nparam = ReportParam.create(rp, alias);
  nparam.value = Variant.fromString('');
  rp.params.push(nparam);
  return nparam;
}

/**
 * The search texts (upper case) of the parameters that substitute text in the SQL of a dataset:
 * Subst, SubstExpre, SubsExpreList and Multiple, the types Delphi replaces before it runs the SQL.
 */
function substitutionSearches(rp: ReportRuntime, alias: string): Set<string> {
  const searches = new Set<string>();
  for (const p of rp.params) {
    const pt = p.paramType;
    if (
      (pt === ParamType.Subst || pt === ParamType.SubstExpre || pt === ParamType.SubsExpreList || pt === ParamType.Multiple) &&
      p.datasets.indexOf(alias) >= 0 &&
      p.search.length > 0
    )
      searches.add(toUpperNet(p.search));
  }
  return searches;
}

/** BaseReport.ConvertToDotNet: converts only when a connection is not .Net, Mybase nor engine SQLite. */
export function convertToDotNet(rp: ReportRuntime): boolean {
  let doconvert = false;
  for (const db of rp.databases) {
    if (db.driver !== DriverType.DotNet2 && db.driver !== DriverType.Mybase && !db.isEngineSqlite()) {
      doconvert = true;
      break;
    }
  }
  if (!doconvert) return false;
  // Before the conversion changes the drivers: a connection of a driver only the Delphi engine has.
  // The Reportman Agent (HttpAgent) is in both engines, keeps its driver and is converted each time
  // the report is loaded, so it does not tell where the report was designed
  const fromDelphi = rp.databases.some(
    (db) => db.driver !== DriverType.DotNet2 && db.driver !== DriverType.Mybase && db.driver !== DriverType.HttpAgent && !db.isEngineSqlite(),
  );
  readerConvertToDotNet(rp, DriverType.DotNet2, '');
  if (fromDelphi) rp.convertedFromDelphi = true;
  return true;
}

/** ReportReader.ConvertToDotNet. */
function readerConvertToDotNet(rp: ReportRuntime, driver: DriverType, providerFactory: string): void {
  for (const dinfo of rp.dataInfos) {
    const baseinfo = rp.databases.find((d) => d.alias === dinfo.databaseAlias);
    if (baseinfo !== undefined && baseinfo.driver === DriverType.BDE && dinfo.model.bdeType === DatasetType.Table) {
      dinfo.sql = 'SELECT * FROM ' + dinfo.model.bdeTable;
      let sqlwhere = '';
      if (dinfo.dataSource.length > 0) {
        const masterfields = fromSemiColon(toUpperNet(dinfo.model.bdeMasterFields));
        const indexfieldnames = fromSemiColon(toUpperNet(dinfo.model.bdeIndexFields));
        let i = 0;
        for (const nombre of masterfields) {
          if (sqlwhere.length === 0) sqlwhere = ' WHERE ';
          else sqlwhere = sqlwhere + ' AND ';
          const indexfield = indexfieldnames[i];
          if (indexfield === undefined) throw new RangeError('Index was out of range. Must be non-negative and less than the size of the collection.');
          sqlwhere = sqlwhere + indexfield + '=@' + nombre;
          i++;
          const nparam = ensureParam(rp, nombre);
          if (nparam.datasets.indexOf(dinfo.alias) < 0) nparam.datasets.push(dinfo.alias);
        }
      }
      dinfo.sql = dinfo.sql + sqlwhere;
      if (dinfo.model.bdeIndexFields.length > 0) {
        const sortlist = fromSemiColon(dinfo.model.bdeIndexFields);
        if (sortlist.length > 0) {
          let orderby = ' ORDER BY ' + sortlist[0]!;
          for (let i = 1; i < sortlist.length; i++) orderby = orderby + ',' + sortlist[i]!;
          dinfo.sql = dinfo.sql + orderby;
        }
      }
    }
    // The search texts of the substitution parameters of the dataset (":ORDEM"): the engine replaces
    // them in the SQL before it runs (as Delphi, ignoring the case), they are not SQL parameters
    const substitutions = substitutionSearches(rp, dinfo.alias);
    let sql = dinfo.sql;
    let index = sql.indexOf(':');
    while (index >= 0) {
      // Obtain parameter name
      let paramname = '';
      let index2 = index + 1;
      while (index2 < sql.length) {
        const caracter = sql.charAt(index2);
        if (!isParamChar(caracter)) break;
        paramname += caracter;
        index2++;
      }
      const aparam = toUpperNet(paramname);
      if (substitutions.has(':' + aparam)) {
        index = sql.indexOf(':', index + 1);
        continue;
      }
      const nparam = ensureParam(rp, aparam);
      if (nparam.datasets.indexOf(dinfo.alias) < 0) nparam.datasets.push(dinfo.alias);
      // Replace ':' with '@'
      sql = sql.substring(0, index) + '@' + aparam + sql.substring(index + 1 + aparam.length);
      index = sql.indexOf(':');
    }
    dinfo.sql = sql;
  }
  for (const dbinfo of rp.databases) {
    if (dbinfo.driver !== DriverType.Mybase && dbinfo.driver !== DriverType.HttpAgent) {
      // C# parity: the Firebird provider of an IBX connection stays for the connections after it
      if (dbinfo.driver === DriverType.IBX && providerFactory.length === 0) providerFactory = FIREBIRD_PROVIDER2;
      dbinfo.driver = driver;
      dbinfo.providerFactory = providerFactory;
    }
  }
  // All expression components, search for display format
  for (const sub of rp.subReports) {
    for (const sec of sub.sections) {
      for (const item of sec.components) {
        if (item instanceof ExpressionItem) {
          let dformat = item.displayFormat;
          if (dformat.length > 0) {
            dformat = dformat.split('mmmm').join('MMMM');
            dformat = dformat.split('mmm').join('MMM');
            dformat = dformat.split('/mm').join('/MM');
            dformat = dformat.split(':nn').join(':mm');
            dformat = dformat.split('hh:').join('HH:');
            dformat = dformat.split('0,.00').join(',0.00');
            item.displayFormat = dformat;
          }
        }
      }
    }
  }
}
