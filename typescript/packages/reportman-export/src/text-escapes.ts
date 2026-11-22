// The printer drivers of PrintOutText (FillEscapes): the escape codes of each driver and the
// character steps it can print, transcribed byte for byte from the C# tables.

import { PrinterRawOperation as Op, PrintStepType } from '@reportman/metafile';

/** The escape codes of a driver and how it selects its character steps. */
export interface DriverEscapes {
  /** The codes the driver defines; a missing operation has no code (an empty array). */
  codes: Map<Op, Uint8Array>;
  /** The steps are selected with ESC ! n (master select), not with the cpi codes. */
  masterselect: boolean;
  /** Master select of the receipt printers: only some steps. */
  limitedmaster: boolean;
  /** Master select with the condensed font (font B) of the TM88 family. */
  condensedmaster: boolean;
  /** The code page the driver forces for its text (0: the OEMConvert setting decides). */
  driverCodePage: number;
  /** The step each step is printed at (allowedsteps, NearestFontStep). */
  allowedSteps: Map<PrintStepType, PrintStepType>;
}

/** Bytes from numbers and one-character strings ((byte)'x' in C#). */
function b(...items: (number | string)[]): Uint8Array {
  return Uint8Array.from(items.map((x) => (typeof x === 'string' ? x.charCodeAt(0) : x)));
}

/** The TM88 receipt drivers share everything but the init and the cut (FillTm88). */
function fillTm88(e: DriverEscapes, cut: boolean, init: Uint8Array, codepage: number): void {
  const c = e.codes;
  c.set(Op.InitPrinter, init);
  c.set(Op.LineSpace6, b(27, '2'));
  c.set(Op.Linespacen_60, b(27, 3));
  c.set(Op.LineFeed, b(10));
  c.set(Op.CR, b(13));
  e.masterselect = true;
  e.limitedmaster = true;
  e.condensedmaster = true;
  c.set(Op.EndPrint, cut ? b(27, 'm', 27, 64) : b(27, 64));
  c.set(Op.Pulse, b(27, 112, 0, 100, 100));
  e.driverCodePage = codepage;
}

/** The TM88 family of drivers (ESC/POS receipt printers), in all its variants. */
export function isTm88Driver(drivername: string): boolean {
  return (
    drivername === 'EPSONTM88II' ||
    drivername === 'EPSONTM88IICUT' ||
    drivername === 'EPSONTM88CP850' ||
    drivername === 'EPSONTM88CP850CUT' ||
    drivername === 'EPSONTM88CP858' ||
    drivername === 'EPSONTM88CP858CUT' ||
    drivername === 'EPSONTM88UTF8' ||
    drivername === 'EPSONTM88UTF8CUT'
  );
}

/** The receipt drivers, whose last page is cut where the text ends (no padding to the page length). */
export function isReceiptDriver(drivername: string): boolean {
  return isTm88Driver(drivername) || drivername === 'EPSONTMU210' || drivername === 'EPSONTMU210CUT';
}

/** The escape codes and steps of a driver (UpdatePrinterConfig and FillEscapes). */
export function fillEscapes(driver: string): DriverEscapes {
  const e: DriverEscapes = {
    codes: new Map(),
    masterselect: false,
    limitedmaster: false,
    condensedmaster: false,
    driverCodePage: 0,
    allowedSteps: new Map([
      [PrintStepType.cpi5, PrintStepType.cpi10],
      [PrintStepType.cpi6, PrintStepType.cpi10],
      [PrintStepType.cpi10, PrintStepType.cpi10],
      [PrintStepType.cpi12, PrintStepType.cpi10],
      [PrintStepType.cpi15, PrintStepType.cpi10],
      [PrintStepType.cpi17, PrintStepType.cpi10],
      [PrintStepType.cpi20, PrintStepType.cpi10],
    ]),
  };
  const c = e.codes;
  switch (driver) {
    case 'EPSON':
      // Init printer - line spacing to 1/6
      c.set(Op.InitPrinter, b(27, 64));
      c.set(Op.LineFeed, b(10));
      c.set(Op.LineSpace6, b(27, '2'));
      c.set(Op.LineSpace8, b(27, '0'));
      c.set(Op.LineSpace7_72, b(27, '1'));
      c.set(Op.LineSpacen_216, b(27, '3'));
      c.set(Op.CR, b(13));
      c.set(Op.FF, b(12));
      c.set(Op.Underline, b(27, 45, 1));
      // Underline off - bold off - italic off
      c.set(Op.Normal, b(27, 45, 0));
      // 10 or 12 cpi, double wide on or off, condensed on or off
      c.set(Op.cpi5, b(18, 14));
      c.set(Op.cpi10, b(20, 18));
      c.set(Op.cpi17, b(20, 15));
      c.set(Op.EndPrint, b(27, 64));
      // Open drawer
      c.set(Op.Pulse, b(27, 112, 0, 100, 100));
      break;
    case 'EPSON-MASTER':
      // Init printer - line spacing to 1/6 - draft mode
      c.set(Op.InitPrinter, b(27, 64, 27, 'x', '0'));
      c.set(Op.LineFeed, b(10));
      c.set(Op.LineSpace6, b(27, '2'));
      c.set(Op.LineSpace8, b(27, '0'));
      c.set(Op.CR, b(13));
      c.set(Op.FF, b(12));
      e.masterselect = true;
      e.limitedmaster = false;
      e.condensedmaster = false;
      c.set(Op.Pulse, b(27, 112, 0, 100, 100));
      c.set(Op.EndPrint, b(27, 64));
      break;
    case 'EPSON-ESCP':
      // Init printer - line spacing to 1/6 - draft mode - bidirectional print
      c.set(Op.InitPrinter, b(27, 64, 27, 'x', '1', 27, 'U', 0));
      c.set(Op.LineSpace6, b(27, '2'));
      c.set(Op.LineSpace7_72, b(27, '1'));
      c.set(Op.LineSpace8, b(27, '0'));
      c.set(Op.LineSpacen_216, b(27, '3'));
      c.set(Op.LineFeed, b(10));
      c.set(Op.CR, b(13));
      c.set(Op.FF, b(12));
      c.set(Op.Bold, b(27, 'E'));
      c.set(Op.Underline, b(27, 45, 1));
      c.set(Op.Italic, b(27, '4'));
      c.set(Op.Normal, b(27, 45, 0, 27, 'F', 27, '5'));
      c.set(Op.cpi5, b(27, 'P', 14, 18));
      c.set(Op.cpi6, b(27, 'M', 14, 18));
      c.set(Op.cpi10, b(27, 'P', 20, 18));
      c.set(Op.cpi12, b(27, 'M', 20, 18));
      // 15 cpi is not supported by the LX models
      c.set(Op.cpi17, b(27, 'P', 20, 15));
      c.set(Op.cpi20, b(27, 'M', 20, 15));
      c.set(Op.EndPrint, b(27, 64));
      c.set(Op.Pulse, b(27, 112, 0, 100, 100));
      break;
    case 'EPSON-ESCPQ':
      // Init printer - line spacing to 1/6 - draft mode - bidirectional print
      c.set(Op.InitPrinter, b(27, 64, 27, 'x', '1', 27, 'U', 0));
      c.set(Op.LineSpace6, b(27, '2'));
      c.set(Op.LineSpace8, b(27, '0'));
      c.set(Op.LineSpacen_180, b(27, '3'));
      c.set(Op.LineFeed, b(10));
      c.set(Op.CR, b(13));
      c.set(Op.FF, b(12));
      c.set(Op.Bold, b(27, 'E'));
      c.set(Op.Underline, b(27, 45, 1));
      c.set(Op.Italic, b(27, '4'));
      c.set(Op.Normal, b(27, 45, 0, 27, 'F', 27, '5'));
      c.set(Op.cpi5, b(27, 'P', 14, 18));
      c.set(Op.cpi6, b(27, 'M', 14, 18));
      c.set(Op.cpi10, b(27, 'P', 20, 18));
      c.set(Op.cpi12, b(27, 'M', 20, 18));
      c.set(Op.cpi17, b(27, 'P', 20, 15));
      c.set(Op.cpi20, b(27, 'M', 20, 15));
      c.set(Op.EndPrint, b(27, 64));
      c.set(Op.Pulse, b(27, 112, 0, 100, 100));
      break;
    case 'IBMPROPRINTER':
      // Init printer - line spacing to 1/6 - draft mode
      c.set(Op.InitPrinter, b(20, 20, 27, 64));
      c.set(Op.LineSpace6, b(27, '2'));
      c.set(Op.LineSpace8, b(27, '0'));
      c.set(Op.LineSpace7_72, b(27, '1'));
      c.set(Op.LineSpacen_216, b(27, '3'));
      c.set(Op.LineFeed, b(10));
      c.set(Op.CR, b(13));
      c.set(Op.FF, b(12));
      c.set(Op.Bold, b(27, 'E'));
      c.set(Op.Underline, b(27, 45, 1));
      c.set(Op.Italic, b(27, '4'));
      c.set(Op.Normal, b(27, 45, 0, 27, 'F', 27, '5'));
      c.set(Op.cpi5, b(27, 18, 14, 18));
      c.set(Op.cpi6, b(27, ':', 14, 18));
      c.set(Op.cpi10, b(27, 18, 20, 18));
      c.set(Op.cpi12, b(20, 18, 27, ':'));
      c.set(Op.cpi17, b(20, 27, 18, 15));
      c.set(Op.cpi20, b(20, 27, ':', 15));
      c.set(Op.EndPrint, b(20, 20, 27, 64));
      break;
    case 'EPSONTMU210':
    case 'EPSONTMU210CUT':
      c.set(Op.InitPrinter, b(27, 64));
      c.set(Op.LineSpace6, b(27, '2'));
      c.set(Op.Linespacen_60, b(27, '3'));
      c.set(Op.LineFeed, b(10));
      c.set(Op.CR, b(13));
      e.masterselect = true;
      e.limitedmaster = true;
      e.condensedmaster = false;
      // It can print in red
      c.set(Op.RedFont, b(27, 'r', 1));
      c.set(Op.BlackFont, b(27, 'r', 0));
      // The CUT variant cuts the paper
      c.set(Op.EndPrint, driver === 'EPSONTMU210CUT' ? b(27, 'm', 27, 64) : b(27, 64));
      c.set(Op.Pulse, b(27, 112, 0, 100, 100));
      break;
    case 'EPSONTM88II':
      c.set(Op.InitPrinter, b(27, 64));
      c.set(Op.LineSpace6, b(27, '2'));
      // C# parity: '3' here, the byte 3 in the CUT variant
      c.set(Op.Linespacen_60, b(27, '3'));
      c.set(Op.LineFeed, b(10));
      c.set(Op.CR, b(13));
      e.masterselect = true;
      e.limitedmaster = true;
      e.condensedmaster = true;
      c.set(Op.EndPrint, b(27, 64));
      c.set(Op.Pulse, b(27, 112, 0, 100, 100));
      break;
    case 'EPSONTM88IICUT':
      c.set(Op.InitPrinter, b(27, 64));
      c.set(Op.LineSpace6, b(27, '2'));
      c.set(Op.Linespacen_60, b(27, 3));
      c.set(Op.LineFeed, b(10));
      c.set(Op.CR, b(13));
      e.masterselect = true;
      e.limitedmaster = true;
      e.condensedmaster = true;
      // Cut paper
      c.set(Op.EndPrint, b(27, 'm', 27, 64));
      c.set(Op.Pulse, b(27, 112, 0, 100, 100));
      break;
    // The TM88 family with its character set declared to the printer: ESC t 2 (PC850),
    // ESC t 19 (PC858) or FS ( C fn 48 m 2 (UTF-8), and the text forced to that encoding
    case 'EPSONTM88CP850':
      fillTm88(e, false, b(27, 64, 27, 't', 2), 850);
      break;
    case 'EPSONTM88CP850CUT':
      fillTm88(e, true, b(27, 64, 27, 't', 2), 850);
      break;
    case 'EPSONTM88CP858':
      fillTm88(e, false, b(27, 64, 27, 't', 19), 858);
      break;
    case 'EPSONTM88CP858CUT':
      fillTm88(e, true, b(27, 64, 27, 't', 19), 858);
      break;
    case 'EPSONTM88UTF8':
      fillTm88(e, false, b(27, 64, 28, '(', 'C', 2, 0, 48, 2), 65001);
      break;
    case 'EPSONTM88UTF8CUT':
      fillTm88(e, true, b(27, 64, 28, '(', 'C', 2, 0, 48, 2), 65001);
      break;
    case 'HP-PCL':
      // Init printer + 6 lines per inch
      c.set(Op.InitPrinter, b(27, 64));
      c.set(Op.LineSpace6, b(27, 38, 108, 54, 68));
      c.set(Op.LineSpace8, b(27, 38, 108, 56, 68));
      c.set(Op.LineFeed, b(10));
      c.set(Op.CR, b(13));
      // Form feed and eject page
      c.set(Op.FF, b(27, 38, 108, 48, 72));
      c.set(Op.Bold, b(27, 40, 115, 51, 66));
      c.set(Op.Underline, b(27, 38, 100, 48, 68));
      c.set(Op.Italic, b(27, 40, 115, 49, 83));
      c.set(Op.Normal, b(27, 38, 100, 64, 27, 40, 115, 48, 66, 27, 40, 115, 48, 83));
      c.set(Op.cpi5, b(27, 40, 115, 5, 72));
      c.set(Op.cpi6, b(27, 40, 115, 6, 72));
      c.set(Op.cpi10, b(27, 38, 107, 48, 83));
      c.set(Op.cpi15, b(27, 38, 107, 52, 83));
      c.set(Op.cpi17, b(27, 40, 115, 17, 72));
      c.set(Op.cpi20, b(27, 40, 115, 20, 72));
      break;
    case 'PLAIN':
    case 'PLAINFULL':
      // PLAINFULL is PLAIN: the C# driver left its full plain switch commented out
      c.set(Op.LineFeed, b(10));
      c.set(Op.CR, b(13));
      break;
    case 'VT100':
      c.set(Op.LineFeed, b(10));
      c.set(Op.cpi15, b(27, '(', 'c', 'h', 'a', 'r', ')', '6'));
      c.set(Op.cpi10, b(27, '(', 'c', 'h', 'a', 'r', ')', '5'));
      break;
  }
  const has = (op: Op): boolean => (c.get(op)?.length ?? 0) > 0;
  const a = e.allowedSteps;
  if (has(Op.cpi5)) a.set(PrintStepType.cpi5, PrintStepType.cpi5);
  if (has(Op.cpi6)) a.set(PrintStepType.cpi6, PrintStepType.cpi6);
  if (has(Op.cpi12)) a.set(PrintStepType.cpi12, PrintStepType.cpi12);
  if (has(Op.cpi15)) a.set(PrintStepType.cpi15, PrintStepType.cpi15);
  if (has(Op.cpi17)) a.set(PrintStepType.cpi17, PrintStepType.cpi17);
  if (has(Op.cpi20)) a.set(PrintStepType.cpi20, PrintStepType.cpi20);
  if (e.masterselect) {
    a.set(PrintStepType.cpi15, PrintStepType.cpi17);
    if (e.limitedmaster) {
      if (e.condensedmaster) {
        a.set(PrintStepType.cpi10, PrintStepType.cpi12);
        a.set(PrintStepType.cpi12, PrintStepType.cpi12);
        a.set(PrintStepType.cpi5, PrintStepType.cpi6);
        a.set(PrintStepType.cpi6, PrintStepType.cpi6);
        a.set(PrintStepType.cpi20, PrintStepType.cpi17);
        a.set(PrintStepType.cpi17, PrintStepType.cpi17);
      } else {
        a.set(PrintStepType.cpi15, PrintStepType.cpi12);
        a.set(PrintStepType.cpi17, PrintStepType.cpi12);
        a.set(PrintStepType.cpi20, PrintStepType.cpi12);
        a.set(PrintStepType.cpi12, PrintStepType.cpi12);
      }
    }
  } else {
    if (!has(Op.cpi5)) a.set(PrintStepType.cpi5, has(Op.cpi6) ? PrintStepType.cpi6 : PrintStepType.cpi10);
    if (!has(Op.cpi6)) a.set(PrintStepType.cpi6, PrintStepType.cpi10);
    if (!has(Op.cpi12)) {
      if (has(Op.cpi15)) a.set(PrintStepType.cpi12, PrintStepType.cpi15);
      else if (has(Op.cpi17)) a.set(PrintStepType.cpi12, PrintStepType.cpi17);
      else if (has(Op.cpi20)) a.set(PrintStepType.cpi12, PrintStepType.cpi20);
      else a.set(PrintStepType.cpi12, PrintStepType.cpi10);
    }
    if (!has(Op.cpi15)) {
      if (has(Op.cpi17)) a.set(PrintStepType.cpi15, PrintStepType.cpi17);
      else if (has(Op.cpi20)) a.set(PrintStepType.cpi15, PrintStepType.cpi20);
      else a.set(PrintStepType.cpi15, PrintStepType.cpi10);
    }
    if (!has(Op.cpi17)) {
      if (has(Op.cpi20)) a.set(PrintStepType.cpi17, PrintStepType.cpi20);
      else if (has(Op.cpi15)) a.set(PrintStepType.cpi17, PrintStepType.cpi15);
      else if (has(Op.cpi12)) a.set(PrintStepType.cpi17, PrintStepType.cpi12);
      else a.set(PrintStepType.cpi17, PrintStepType.cpi10);
    }
    if (!has(Op.cpi20)) {
      if (has(Op.cpi17)) a.set(PrintStepType.cpi20, PrintStepType.cpi17);
      else if (has(Op.cpi15)) a.set(PrintStepType.cpi20, PrintStepType.cpi15);
      else if (has(Op.cpi12)) a.set(PrintStepType.cpi20, PrintStepType.cpi12);
      else a.set(PrintStepType.cpi20, PrintStepType.cpi10);
    }
  }
  return e;
}
