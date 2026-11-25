import { Report, DatabaseInfo, SortedList, DriverType, IsolationLevel } from "@reportman/lib";
import { DesignerInterface } from "./designer-interface";
import { IObjectInspector } from "../interfaces/object-inspector.interface";
import { TranslationService } from "../services/translator.service";

export class DesignerInterfaceDbInfo extends DesignerInterface {
  private FDbInfo!: DatabaseInfo;
  private static Isolations: SortedList<IsolationLevel, string>;

  constructor(
    nreport: Report,
    nrepitem: Map<number, any>,
    nobjinsp: IObjectInspector,
    ntranslator: TranslationService
  ) {
    super(nreport, nrepitem, nobjinsp, ntranslator);
    if (nrepitem.size === 1) {
      this.FDbInfo = nrepitem.values().next().value as DatabaseInfo;
    }
  }

  static {
    this.Isolations = new SortedList<IsolationLevel, string>([
      [IsolationLevel.Chaos, "Chaos"],
      [IsolationLevel.ReadCommitted, "Read Committed"],
      [IsolationLevel.ReadUncommitted, "Read Uncommited"],
      [IsolationLevel.RepeatableRead, "Repeatable Read"],
      [IsolationLevel.Serializable, "Serializable"],
      [IsolationLevel.Snapshot, "Snapshot"],
      [IsolationLevel.Unspecified, "Unspecified"],
    ]);
  }

  public get DbInfo(): DatabaseInfo {
    return this.FDbInfo;
  }

  public static DriverTypeToString(driver: DriverType): string {
    switch (driver) {
      case DriverType.DBExpress:
        return "Borland DBExpress";
      case DriverType.BDE:
        return "Borland Database Engine";
      case DriverType.IBX:
        return "Interbase Express";
      case DriverType.ADO:
        return "Microsoft DAO";
      case DriverType.IBO:
        return "Interbase Objects";
      case DriverType.Mybase:
        return "B.MyBase and text files";
      case DriverType.ZEOS:
        return "Zeos Database Objects";
      case DriverType.DotNet:
        return "Dot Net Connection";
      case DriverType.DotNet2:
        return "Dot Net 2 Connection";
      default:
        return "";
    }
  }

  public static StringToDriverType(astring: string): DriverType {
    switch (astring) {
      case "Borland DBExpress":
        return DriverType.DBExpress;
      case "Borland Database Engine":
        return DriverType.BDE;
      case "Interbase Express":
        return DriverType.IBX;
      case "Microsoft DAO":
        return DriverType.ADO;
      case "Interbase Objects":
        return DriverType.IBO;
      case "B.MyBase and text files":
        return DriverType.Mybase;
      case "Zeos Database Objects":
        return DriverType.ZEOS;
      case "Dot Net Connection":
        return DriverType.DotNet;
      case "Dot Net 2 Connection":
        return DriverType.DotNet2;
      default:
        return DriverType.DotNet2;
    }
  }

  public static GetDriverStrings(): string[] {
    return [
      "Borland DBExpress",
      "B.MyBase and text files",
      "Interbase Express",
      "Borland Database Engine",
      "Microsoft DAO",
      "Interbase Objects",
      "Zeos Database Objects",
      "Dot Net Connection",
      "Dot Net 2 Connection",
    ];
  }

  public GetIsolations(lpossiblevalues: string[]): void {
    for (const nstring of DesignerInterfaceDbInfo.Isolations.Values()) {
      lpossiblevalues.push(nstring);
    }
  }

  public override GetPropertyValues(pname: string, lpossiblevalues: string[]): void {
    if (pname === "driver") {
      const texts = DesignerInterfaceDbInfo.GetDriverStrings();
      for (const ns of texts) {
        lpossiblevalues.push(ns);
      }
      return;
    }

    if (pname === "providerFactory") {
      // There is no TS equivalent of DataTable and DbProviderFactories.GetFactoryClasses here
      // Implement it according to the environment, or use a stub like this:
      const ntable = this.getProviderFactories();
      let firebird2found = false;
      for (const newvalue of ntable) {
        lpossiblevalues.push(newvalue);
        if (newvalue === DatabaseInfo.FIREBIRD_PROVIDER2) {
          firebird2found = true;
        }
      }
      if (!firebird2found) {
        lpossiblevalues.push(DatabaseInfo.FIREBIRD_PROVIDER2);
      }
      return;
    }

    if (pname === "transIsolation") {
      this.GetIsolations(lpossiblevalues);
      return;
    }

    super.GetPropertyValues(pname, lpossiblevalues);
  }

  public override GetProperties(
    lnames: string[],
    llabels: string[],
    ltypes: string[],
    lvalues: any[] | null,
    lhints: string[],
    lcat: string[],
    lorder?: (number | null)[] | null
  ): void {
    llabels.length = 0;
    lnames.length = 0;
    ltypes.length = 0;
    lhints.length = 0;
    lcat.length = 0;
    if (lvalues) {
      lvalues.length = 0;
    }
    if (lorder) {
      lorder.length = 0;
    }

    // Connection Name
    lnames.push("alias");
    llabels.push(this.translator.TranslateStr(400));
    ltypes.push(this.translator.TranslateStr(557));
    lhints.push("refdatabaseinfo.html");
    lcat.push(this.translator.TranslateStr(1201));
    if (lvalues) {
      lvalues.push(this.FDbInfo.alias);
    }
    lorder?.push(null);

    // Driver
    lnames.push("driver");
    llabels.push(this.translator.TranslateStr(67));
    ltypes.push(this.translator.TranslateStr(961));
    lhints.push("refdatabaseinfo.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(DesignerInterfaceDbInfo.DriverTypeToString(this.FDbInfo.driver));

    // Provider Factory
    lnames.push("providerFactory");
    llabels.push(this.translator.TranslateStr(1394));
    ltypes.push(this.translator.TranslateStr(961));
    lhints.push("refdatabaseinfo.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.FDbInfo.providerFactory);

    // Connection String
    lnames.push("connectionString");
    llabels.push(this.translator.TranslateStr(1099));
    ltypes.push(this.translator.TranslateStr(1099));
    lhints.push("refdatabaseinfo.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(this.FDbInfo.connectionString);

    // Transaction isolation
    lnames.push("transIsolation");
    llabels.push("Transaction Isolation");
    ltypes.push(this.translator.TranslateStr(961));
    lhints.push("refdatabaseinfo.html");
    lcat.push(this.translator.TranslateStr(1201));
    lvalues?.push(
      DesignerInterfaceDbInfo.Isolations.get(
        this.FDbInfo.transIsolation ?? IsolationLevel.ReadCommitted
      )
    );
  }
  public override GetProperty(pname: string): any {
    switch (pname) {
      case "alias":
        return this.FDbInfo.alias;

      case "driver":
        return this.FDbInfo.driver;

      case "providerFactory":
        return this.FDbInfo.providerFactory;

      case "connectionString":
        return this.FDbInfo.connectionString;

      case "transIsolation":
        return DesignerInterfaceDbInfo.Isolations.get(
          this.FDbInfo.transIsolation ?? IsolationLevel.ReadCommitted
        );

      default:
        return super.GetProperty(pname);
    }
  }

  public override SetProperty(pname: string, newvalue: any): void {
    if (pname === "alias") {
      this.FDbInfo.alias = newvalue.toString().toUpperCase();
      return;
    }
    if (pname === "driver") {
      if (newvalue.IsInteger()) {
        this.FDbInfo.driver = newvalue.AsInteger;
      } else {
        const texts = DesignerInterfaceDbInfo.GetDriverStrings();
        const nindx = texts.indexOf(newvalue.toString());
        if (nindx >= 0) {
          this.FDbInfo.driver = nindx;
        }
      }
      return;
    }
    if (pname === "providerFactory") {
      if (newvalue && newvalue.IsInteger()) {
        const index = newvalue.AsInteger;
        const values: string[] = [];
        this.GetPropertyValues(pname, values);
        if (index < values.length) {
          this.FDbInfo.providerFactory = values[index];
        }
      } else {
        this.FDbInfo.providerFactory = newvalue?.toString();
      }
      return;
    }
    if (pname === "connectionString") {
      this.FDbInfo.connectionString = newvalue;
      return;
    }
    if (pname === "transIsolation") {
      const ix = DesignerInterfaceDbInfo.Isolations.IndexOfValue(newvalue.toString());
      if (ix >= 0) {
        const keys = DesignerInterfaceDbInfo.Isolations.Keys();
        this.FDbInfo.transIsolation = keys[ix];
      }
      return;
    }
    super.SetProperty(pname, newvalue);
  }

  // Stub for DbProviderFactories.GetFactoryClasses()
  private getProviderFactories(): string[] {
    // The logic to obtain the providers would go here;
    // in TS/JS most likely a static list or a call to some API
    return [
      // example:
      "System.Data.SqlClient",
      "FirebirdSql.Data.Firebird",
      // ...
    ];
  }
}
