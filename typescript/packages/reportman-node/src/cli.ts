#!/usr/bin/env node
// reportman-pdf: runs a .rep report to PDF from the command line, the way printreptopdf does.
//
//   reportman-pdf <report.rep> [-o out.pdf] [-paramNAME=value]... [--sqlite ALIAS=file]...
//                 [--culture xx-XX] [--fonts] [--font-folder DIR]... [--describe] [--uncompressed]
//
// --describe prints the parameters of step 1 as JSON instead of running the report.
// --fonts embeds the TrueType fonts of the system (HTML text, right to left and complex scripts);
// --font-folder adds a folder of fonts, scanned before the system ones, and implies --fonts.
// Without them the PDF has only the standard 14 PDF fonts.
import { writeFileSync } from 'node:fs';
import { openReport } from './report.js';
import { sqlite } from './sqlite.js';
import type { ConnectionFactory } from './host.js';
import type { FontOptions } from './fonts.js';

function usage(): never {
  process.stderr.write(
    'usage: reportman-pdf <report.rep> [-o out.pdf] [-paramNAME=value]... [--sqlite ALIAS=file]...\n' +
      '                     [--culture xx-XX] [--fonts] [--font-folder DIR]... [--describe] [--uncompressed]\n',
  );
  process.exit(2);
}

async function main(argv: string[]): Promise<number> {
  let reportFile: string | undefined;
  let output: string | undefined;
  let culture: string | undefined;
  let describe = false;
  let compressed: boolean | undefined;
  let fonts: FontOptions | undefined;
  const params: Record<string, string> = {};
  const connections: Record<string, ConnectionFactory> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '-o') output = argv[++i] ?? usage();
    else if (arg === '--culture') culture = argv[++i] ?? usage();
    else if (arg === '--describe') describe = true;
    else if (arg === '--uncompressed') compressed = false;
    else if (arg === '--fonts') fonts = { folders: fonts?.folders ?? [] };
    else if (arg === '--font-folder') fonts = { folders: [...(fonts?.folders ?? []), argv[++i] ?? usage()] };
    else if (arg === '--sqlite') {
      const spec = argv[++i] ?? usage();
      const k = spec.indexOf('=');
      if (k <= 0) usage();
      connections[spec.substring(0, k)] = sqlite(spec.substring(k + 1));
    } else if (arg.startsWith('-param')) {
      const spec = arg.substring(6);
      const k = spec.indexOf('=');
      if (k <= 0) usage();
      params[spec.substring(0, k)] = spec.substring(k + 1);
    } else if (arg.startsWith('-')) usage();
    else if (reportFile === undefined) reportFile = arg;
    else usage();
  }
  if (reportFile === undefined) usage();
  const report = await openReport(reportFile, { connections, culture, fonts });
  if (describe) {
    process.stdout.write((await report.describeParametersJson()) + '\n');
    return 0;
  }
  const pdf = await report.executeToPdf(params, { compressed });
  if (output === undefined) process.stdout.write(pdf);
  else writeFileSync(output, pdf);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write((e instanceof Error ? e.message : String(e)) + '\n');
    process.exit(1);
  },
);
