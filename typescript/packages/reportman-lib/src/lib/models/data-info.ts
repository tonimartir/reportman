import { ReportItem } from "./report-item.js";

/** C# DataInfo: the defaults are the ones of its constructor. */
export class DataInfo extends ReportItem {
  public alias = "";
  public databaseAlias = "";
  public sql = "";
  public sqlExplanation = "";
  public sqlExplanationError = "";
  /** The Hub schema the dataset was made with (0 or absent: none). */
  public hubSchemaId = 0;
  /** The local subschema or host zone it was made with, by name (D3); absent or empty: all the tables. */
  public schemaName = "";
  public dataSource = "";
  public myBaseFilename = "";
  public myBaseFields = "";
  public myBaseIndexFields = "";
  public myBaseMasterFields = "";
  public bdeIndexFields = "";
  public bdeTable = "";
  public bdeIndexName = "";
  public bdeType = DatasetType.Query;
  public bdeFilter = "";
  public bdeMasterFields = "";
  public bdeFirstRange = "";
  public bdeLastRange = "";
  public dataUnions: string[] = [];
  public groupUnion = false;
  public parallelUnion = false;
  public openOnStart = true;
  constructor() {
    super();
    this.className = "TRPDATAINFOITEM";
  }
  public clone(): DataInfo {
    const result = new DataInfo();
    Object.assign(result, this);
    return result;
  }
}

/// <summary>
/// A dataset definition could represent a table inside a database or
/// a sql query, in .Net version, it's always a Query. <see cref="Variant">DataInfo</see>
/// </summary>
export enum DatasetType {
  /// <summary>The DataInfo will open (execute) a query</summary>
  Query,
  /// <summary>The DataInfo will open a table inside a database</summary>
  Table,
}
