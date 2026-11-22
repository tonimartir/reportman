#!/usr/bin/env node
// reportman-dfm2xml: Delphi DFM reports to XML, as reptotxt -xml does without Delphi.
//
//   reportman-dfm2xml <report.rep> [out.xml]      one report (to the standard output without out.xml)
//   reportman-dfm2xml <folder> <outfolder>         every .rep of a folder and its subfolders
//
// A report that is XML already (plain or compressed) is copied as it is; the source is never written.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dfmToXml } from './convert.js';
import { isDfm } from './reader.js';

function convertFile(source: string, destination: string | undefined): 'converted' | 'copied' {
  const bytes = new Uint8Array(readFileSync(source));
  if (!isDfm(bytes)) {
    if (destination === undefined) process.stdout.write(bytes);
    else copyFileSync(source, destination);
    return 'copied';
  }
  const xml = dfmToXml(bytes);
  if (destination === undefined) process.stdout.write(xml);
  else writeFileSync(destination, xml);
  return 'converted';
}

function reportsOf(folder: string, relative = ''): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(path.join(folder, relative), { withFileTypes: true })) {
    const name = relative.length === 0 ? entry.name : path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...reportsOf(folder, name));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.rep')) result.push(name);
  }
  return result.sort();
}

function main(args: readonly string[]): number {
  if (args.length === 0 || args.length > 2 || args[0] === '--help' || args[0] === '-h') {
    process.stderr.write('Usage: reportman-dfm2xml <report.rep> [out.xml] | reportman-dfm2xml <folder> <outfolder>\n');
    return 2;
  }
  const source = args[0]!;
  if (!existsSync(source)) throw new Error(source + ' does not exist');
  if (!statSync(source).isDirectory()) {
    convertFile(source, args[1]);
    return 0;
  }
  if (args[1] === undefined) throw new Error('A destination folder is needed to convert a folder');
  let converted = 0;
  let copied = 0;
  let failed = 0;
  for (const relative of reportsOf(source)) {
    const destination = path.join(args[1], relative);
    try {
      mkdirSync(path.dirname(destination), { recursive: true });
      const result = convertFile(path.join(source, relative), destination);
      if (result === 'converted') {
        converted++;
        process.stdout.write('converted: ' + relative + '\n');
      } else {
        copied++;
        process.stdout.write('copied (XML already): ' + relative + '\n');
      }
    } catch (e) {
      failed++;
      process.stderr.write('failed: ' + relative + ': ' + (e instanceof Error ? e.message : String(e)) + '\n');
    }
  }
  process.stdout.write(`${converted} converted, ${copied} copied (XML already), ${failed} failed\n`);
  return failed > 0 ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  process.stderr.write((e instanceof Error ? e.message : String(e)) + '\n');
  process.exitCode = 1;
}
