// The Node side of golden-http: the servers that answer the requests of cases.json, on a data
// folder laid out as the one of Reportman.Server, in trusted mode (no keys: the open API).

import { createReportServer, type ServerRequest, type ServerResponse } from '@reportman/server';

export type GoldenHandler = (request: ServerRequest) => Promise<ServerResponse>;

/** The handler of the golden requests over a data folder, with the clock on the given day. */
export function goldenServer(dataPath: string, day: Date): GoldenHandler {
  const reports = createReportServer({
    dataPath,
    trusted: true,
    clock: { now: () => day, offsetMinutes: () => -day.getTimezoneOffset() },
  });
  return (request) => reports.handle(request);
}
