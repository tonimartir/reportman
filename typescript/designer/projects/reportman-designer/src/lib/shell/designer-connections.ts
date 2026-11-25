import { InjectionToken } from "@angular/core";

/**
 * The connection aliases the host can resolve (Reportman.Server: its dbxconnections.ini; a host application:
 * its database list). When the host provides it, "add connection" offers them in a list instead of
 * asking the alias blind; the person can still type an alias the host does not know yet.
 */
export interface DesignerConnections {
  listAliases(): Promise<string[]>;
}

export const DESIGNER_CONNECTIONS = new InjectionToken<DesignerConnections>("DESIGNER_CONNECTIONS");
