import { EnvironmentProviders, makeEnvironmentProviders } from "@angular/core";
import { IReportServiceParams } from "@reportman/lib";
import { REPORT_SERVICE_PARAMS } from "../services/ngx-reportman-lib.service";
import { DESIGNER_AI } from "../shell/designer-ai";
import { DESIGNER_HOST, DesignerHost } from "./designer-host";
import { DesignerAiBridgeService } from "./designer-ai-bridge.service";

/**
 * The designer against Reportman.Designer.Server: where its server is, what the host answers
 * (`host` runs in an injection context, so it may `inject()` the host's services), and the
 * designer's AI through the server's bridge (`DESIGNER_AI`).
 */
export function provideReportmanDesigner(options: {
  /** Where `/api/designer` is (a function when it is only known later); default `/api/designer`. */
  designerUrl?: string | (() => string);
  /** Properties every designer call carries (the host's contract); default none. */
  properties?: IReportServiceParams["getProperties"];
  host: () => DesignerHost;
}): EnvironmentProviders {
  const designerUrl = options.designerUrl ?? "/api/designer";
  return makeEnvironmentProviders([
    {
      provide: REPORT_SERVICE_PARAMS,
      useValue: {
        getApiUrl: () => (typeof designerUrl === "function" ? designerUrl() : designerUrl),
        getProperties: options.properties ?? (() => []),
      },
    },
    { provide: DESIGNER_HOST, useFactory: options.host },
    { provide: DESIGNER_AI, useExisting: DesignerAiBridgeService },
  ]);
}
