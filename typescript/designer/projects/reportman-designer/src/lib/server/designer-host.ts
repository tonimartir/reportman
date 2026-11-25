import { InjectionToken } from "@angular/core";
import { Report } from "@reportman/lib";

/**
 * What the designer asks the page that hosts it, besides where its server is
 * (`REPORT_SERVICE_PARAMS`). The server is Reportman.Designer.Server, with its AI package
 * (Reportman.Designer.Server.Ai) for the copilot: `/api/designer/*`, `/api/ai/*` and
 * `/api/ai-login/*`. Only `aiInstallId` is required; the rest has the defaults of that server.
 */
export interface DesignerHost {
  /** This installation for Reportman AI (the server's IAiInstallation): the AI login is bound to it. */
  aiInstallId: () => string;
  /** Where the AI bridge answers; default `/api/ai/`. */
  aiBridgeUrl?: string;
  /** Where the AI's login is relayed; default `/api/ai-login`. */
  aiLoginUrl?: string;
  /**
   * Whether the person may use the AI (Reportman.Server: whoever designs). It may read signals:
   * the designer re-evaluates it. Default: yes.
   */
  aiAvailable?: () => boolean;
  /**
   * Whether the AI is part of this designer at all: false shows no AI control (the element's
   * no-ai, a server without the AI such as @reportman/designer-server). Default: yes.
   */
  aiEnabled?: () => boolean;
  /** The host's own session ended (the bridge answered LoginRequired): back to its login. */
  sessionLost?: () => void;
  /**
   * After the copilot changed the report, make sure its connections run here (Reportman.Server
   * offers its connection wizard): the AI only names aliases. Optional.
   */
  checkReportConnections?: (report: Report, hubDatabaseId?: number) => Promise<unknown>;
  /**
   * Where Google and Microsoft come back to after the AI's login: a page of the host's origin that
   * shows `AiLoginCallbackComponent` (or the web component's ai-callback.html). Default `/ai/callback`.
   */
  aiCallbackPath?: string;
  /** Where Monaco (the SQL and expression editors) is served; default `assets/monaco-editor/min/vs`. */
  monacoUrl?: string;
  /**
   * Whose Reportman AI account the AI goes as. `login` (default, Reportman.Server): the person logs
   * into the AI from the chat and the page keeps that session. `host`: the host already knows the
   * person's account and its server puts it on every AI call (the server's IAiCredentials), so the
   * chat neither logs in nor out, and the account card and gauge show what the host's server answers
   * (IAiAccountStatus: who pays, and their credits).
   */
  aiAccount?: "login" | "host";
  /**
   * The host's session as a Bearer token, for a server that takes one (an embedding application):
   * the AI calls carry it (the designer calls go through HttpClient, the host's interceptors).
   * Without it the session is the cookie of the server's origin.
   */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /**
   * The screen of a connection's local schema (its file: the dictionary and the subschemas), `create` to start a
   * new subschema, `subschema` the one to open: Reportman.Server's own page. Without it the copilot offers no
   * «New local schema» nor «Local schemas».
   */
  openLocalSchemas?: (alias: string, create: boolean, subschema?: string) => void;
  /** Whether this person may edit them (Reportman.Server: whoever designs). Default: yes. */
  canEditLocalSchemas?: () => boolean;
  /** Reportman.Web, where the cloud schemas are edited; default `https://app.reportman.es`. */
  webAppUrl?: string;
}

export const DESIGNER_HOST = new InjectionToken<DesignerHost>("DESIGNER_HOST");

/**
 * The defaults, merged with what the host gives. The host's getters stay getters (a spread would read
 * them once): a host whose routes change while the page lives — the web component, its company in
 * the route — gives `aiBridgeUrl` and `aiLoginUrl` as getters and every call reads the current one.
 */
export function resolveDesignerHost(host: DesignerHost | null): Required<Omit<DesignerHost, "sessionLost" | "checkReportConnections" | "getToken" | "openLocalSchemas">> & DesignerHost {
  const resolved = {
    aiBridgeUrl: "/api/ai/",
    aiLoginUrl: "/api/ai-login",
    aiAvailable: () => true,
    aiCallbackPath: "/ai/callback",
    monacoUrl: "assets/monaco-editor/min/vs",
    aiAccount: "login",
    canEditLocalSchemas: () => true,
    webAppUrl: "https://app.reportman.es",
  } as Required<Omit<DesignerHost, "sessionLost" | "checkReportConnections" | "getToken" | "openLocalSchemas">> & DesignerHost;
  return Object.defineProperties(resolved, Object.getOwnPropertyDescriptors(host ?? { aiInstallId: () => "" }));
}

/** The host's Authorization header, when it gives a token. */
export async function designerHostHeaders(host: DesignerHost): Promise<Record<string, string>> {
  const token = host.getToken ? await host.getToken() : null;
  return token ? { Authorization: "Bearer " + token } : {};
}
