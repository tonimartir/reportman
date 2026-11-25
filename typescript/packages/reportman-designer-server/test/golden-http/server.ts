// The Node side of golden-http: the servers that answer the requests of cases.json, on a data
// folder laid out as the one of Reportman.Server, in trusted mode (no keys: the open API, and a
// designer that lets everybody design, as Reportman.Server without users).

import type { ServerRequest, ServerResponse } from '@reportman/server';
import { createDesignerServer } from '@reportman/designer-server';

export type GoldenHandler = (request: ServerRequest) => Promise<ServerResponse>;

/** The handler of the golden requests over a data folder, with the clock on the given day. */
export function goldenServer(dataPath: string, day: Date): GoldenHandler {
  const designer = createDesignerServer({
    dataPath,
    trusted: true,
    clock: { now: () => day, offsetMinutes: () => -day.getTimezoneOffset() },
    authorize: () => true,
  });
  // The designer's routes, then the reports API and the console of its report server
  return (request) => (designer.owns(request.path) ? designer.handle(request) : designer.reports.handle(request));
}
