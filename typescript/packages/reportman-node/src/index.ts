// Report Manager for Node.js: open a .rep report, describe its parameters (step 1) and run it
// to PDF (step 2), with data from the connections and datasets the host gives.
export { openReport, NodeReport } from './report.js';
export type { OpenReportOptions, PdfOptions, RunOptions } from './report.js';
export { createDataHost } from './host.js';
export type { ConnectionFactory, DatasetSource, DataSources } from './host.js';
export { sqlite } from './sqlite.js';
export type { SqliteOptions } from './sqlite.js';
export { renderParametersForm } from './form.js';
export { fontLibrary, fontDirectories, fontFiles, diskFontFile, currentFontPlatform } from './fonts.js';
export type { FontOptions } from './fonts.js';
export type { ParametersFormOptions } from './form.js';

// What a host needs from the engine to handle the results and errors of a run
export {
  ParameterException,
  ParameterProblem,
  NoDataToPrintException,
  NotSupportedYetError,
  ReportException,
  SynchronousDataRequiredError,
  isSynchronousDataRequired,
} from '@reportman/engine';
export type { ParameterDescription, ParameterInput, ParameterOption } from '@reportman/engine';
