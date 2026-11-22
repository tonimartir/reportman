// @reportman/dfm: the Delphi DFM forms of a Report Manager report (text, binary, compressed) to
// the XML the Delphi engine writes for it (WriteReportXML), which @reportman/lib reads. Optional:
// the engine reads XML only, and @reportman/node uses this package when it is installed.
export { dfmToXml, dfmTreeToXml } from './convert.js';
export { readDfm, reportForm, isDfm, DfmError } from './reader.js';
export type { DfmObject, DfmProperty, DfmItem, DfmValue, ReportForm } from './reader.js';
export { delphiFloatToStr } from './xmlout.js';
