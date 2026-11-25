import { SubReport } from "@reportman/lib";

export interface IObjectInspector {
  refreshSubReport(subreport: SubReport): void;
}
