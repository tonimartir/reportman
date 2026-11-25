import { Report } from "../models/report.js";
import { DatabaseInfo, DriverType } from "../models/database-info.js";
import { DataInfo, DatasetType } from "../models/data-info.js";
import { Param, ParamType } from "../models/param.js";
import { ExpressionItem } from "../models/expression-item.js";
import { VariantType } from "../models/variant.js";
import { csToUpper, csTrim } from "../../util/cs.js";

/*
 * The port of BaseReport.ConvertToDotNet and ReportReader.ConvertToDotNet on this model: what the
 * C# engine does to a report of the Delphi engine when BaseReport.LoadFromStream reads it (so the
 * designer's server, and ExternalReport.ExportSubReport when it reads its copy): the SQL
 * parameters :NAME become @NAME with a report parameter bound to the dataset, the connections
 * become .Net connections, and the Delphi date formats of the expressions become .Net ones.
 * (@reportman/engine has its own port, on its runtime model.)
 */

const FIREBIRD_PROVIDER2 = "FirebirdSql.Data.FirebirdClient";

/** Params.IndexOf / DatabaseInfos.IndexOf: the alias as it is written. */
function indexOfAlias(list: { alias: string }[], alias: string): number {
  for (let i = 0; i < list.length; i++) if (list[i].alias === alias) return i;
  return -1;
}

/** DatabaseInfo.ReportDbParam: the value of the report parameter ALIAS_DBPARAM_NAME or DBPARAM_NAME. */
function reportDbParam(report: Report, db: DatabaseInfo, name: string): string {
  let index = indexOfAlias(report.params, db.alias + "_DBPARAM_" + name);
  if (index < 0) index = indexOfAlias(report.params, "DBPARAM_" + name);
  if (index < 0) return "";
  const value = report.params[index].value;
  if (!value || value.type === VariantType.Null || value.value === null || value.value === undefined) return "";
  return csTrim(String(value.value));
}

/**
 * DatabaseInfo.IsEngineSqlite: a SQLite connection of the Delphi engine (FireDAC, Zeos or
 * dbExpress) whose parameters are report parameters (DBPARAM_DRIVERID=SQLite and DBPARAM_DATABASE).
 */
function isEngineSqlite(report: Report, db: DatabaseInfo): boolean {
  if (
    db.driver !== DriverType.Firedac &&
    db.driver !== DriverType.ZEOS &&
    db.driver !== DriverType.DBExpress &&
    !(db.driver === DriverType.DotNet2 && (db.providerFactory ?? "").length === 0)
  )
    return false;
  let driverId = reportDbParam(report, db, "DRIVERID");
  if (driverId.length === 0) driverId = reportDbParam(report, db, "DRIVERNAME");
  if (driverId.length === 0) driverId = reportDbParam(report, db, "DATABASE PROTOCOL");
  return driverId.toUpperCase().startsWith("SQLITE") && reportDbParam(report, db, "DATABASE").length > 0;
}

/** Strings.FromSemiColon. */
function fromSemiColon(text: string): string[] {
  return text.split(";");
}

/** The report parameter of an alias, created as C# does (no name, an empty text value) when there is none. */
function ensureParam(report: Report, alias: string): Param {
  const index = indexOfAlias(report.params, alias);
  if (index >= 0) return report.params[index];
  const nparam = new Param();
  nparam.value = { type: VariantType.String, value: "" };
  nparam.alias = alias;
  report.params.push(nparam);
  return nparam;
}

/** The DataInfo.SQL setter: a different SQL clears its explanation (and the explanation's error). */
function setSql(dinfo: DataInfo, value: string): void {
  if (dinfo.sql === value) return;
  dinfo.sql = value;
  dinfo.sqlExplanation = "";
  dinfo.sqlExplanationError = "";
}

/** StringUtil.IsAlpha without the punctuation the parameter scan excludes: [0-9A-Za-z_]. */
function isParamChar(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

/**
 * BaseReport.ConvertToDotNet: converts the report when a connection is not .Net, Mybase nor a
 * SQLite connection of the Delphi engine. Returns whether it converted it.
 */
export function convertToDotNet(report: Report): boolean {
  let doconvert = false;
  for (const db of report.databaseInfo) {
    if (db.driver !== DriverType.DotNet2 && db.driver !== DriverType.Mybase && !isEngineSqlite(report, db)) {
      doconvert = true;
      break;
    }
  }
  if (!doconvert) return false;
  readerConvertToDotNet(report, DriverType.DotNet2, "");
  return true;
}

/** ReportReader.ConvertToDotNet. */
function readerConvertToDotNet(rp: Report, driver: DriverType, providerFactory: string): void {
  for (const dinfo of rp.dataInfo) {
    const baseIndex = indexOfAlias(rp.databaseInfo, dinfo.databaseAlias);
    const baseinfo = baseIndex >= 0 ? rp.databaseInfo[baseIndex] : undefined;
    if (baseinfo !== undefined && baseinfo.driver === DriverType.BDE && dinfo.bdeType === DatasetType.Table) {
      setSql(dinfo, "SELECT * FROM " + dinfo.bdeTable);
      let sqlwhere = "";
      if (dinfo.dataSource.length > 0) {
        const masterfields = fromSemiColon(csToUpper(dinfo.bdeMasterFields));
        const indexfieldnames = fromSemiColon(csToUpper(dinfo.bdeIndexFields));
        let i = 0;
        for (const nombre of masterfields) {
          sqlwhere = sqlwhere.length === 0 ? " WHERE " : sqlwhere + " AND ";
          const indexfield = indexfieldnames[i];
          if (indexfield === undefined)
            throw new RangeError("Index was out of range. Must be non-negative and less than the size of the collection. (Parameter 'index')");
          sqlwhere = sqlwhere + indexfield + "=@" + nombre;
          i++;
          const nparam = ensureParam(rp, nombre);
          if (nparam.datasets.indexOf(dinfo.alias) < 0) nparam.datasets.push(dinfo.alias);
        }
      }
      setSql(dinfo, dinfo.sql + sqlwhere);
      if (dinfo.bdeIndexFields.length > 0) {
        const sortlist = fromSemiColon(dinfo.bdeIndexFields);
        setSql(dinfo, dinfo.sql + " ORDER BY " + sortlist.join(","));
      }
    }
    // The search texts of the substitution parameters of the dataset (":ORDEM"): the engine replaces
    // them in the SQL before it runs (ignoring the case), they are not SQL parameters.
    const substitutions = new Set<string>();
    for (const sparam of rp.params) {
      const pt = sparam.paramType;
      if (
        (pt === ParamType.Subst || pt === ParamType.SubstExpre || pt === ParamType.SubsExpreList || pt === ParamType.Multiple) &&
        sparam.datasets.indexOf(dinfo.alias) >= 0 &&
        sparam.search.length > 0
      )
        substitutions.add(csToUpper(sparam.search));
    }
    let sql = dinfo.sql;
    let index = sql.indexOf(":");
    while (index >= 0) {
      let index2 = index + 1;
      while (index2 < sql.length && isParamChar(sql.charCodeAt(index2))) index2++;
      const aparam = csToUpper(sql.substring(index + 1, index2));
      if (substitutions.has(":" + aparam)) {
        index = sql.indexOf(":", index + 1);
        continue;
      }
      const nparam = ensureParam(rp, aparam);
      if (nparam.datasets.indexOf(dinfo.alias) < 0) nparam.datasets.push(dinfo.alias);
      // ':' becomes '@' (and the name its upper case)
      sql = sql.substring(0, index) + "@" + aparam + sql.substring(index + 1 + aparam.length);
      index = sql.indexOf(":");
    }
    setSql(dinfo, sql);
  }
  for (const dbinfo of rp.databaseInfo) {
    if (dbinfo.driver !== DriverType.Mybase && dbinfo.driver !== DriverType.HttpAgent) {
      // C# parity: the Firebird provider of an IBX connection stays for the connections after it.
      if (dbinfo.driver === DriverType.IBX && providerFactory.length === 0) providerFactory = FIREBIRD_PROVIDER2;
      dbinfo.driver = driver;
      dbinfo.providerFactory = providerFactory;
    }
  }
  // The display formats of the expressions of the component list (C# parity: only the items it has).
  for (const item of new Set(rp.components.values())) {
    if (item instanceof ExpressionItem && item.displayFormat.length > 0) {
      item.displayFormat = item.displayFormat
        .split("mmmm")
        .join("MMMM")
        .split("mmm")
        .join("MMM")
        .split("/mm")
        .join("/MM")
        .split(":nn")
        .join(":mm")
        .split("hh:")
        .join("HH:")
        .split("0,.00")
        .join(",0.00");
    }
  }
}
