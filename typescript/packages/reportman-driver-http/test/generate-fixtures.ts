// Reference outputs of the C# engine (golden-cs, the HttpAgent driver) over the mock Hub:
//
//   1. the reports of the tests (fixtures/reports/, see reports.ts);
//   2. for each report case of cases.json, the metafile JSON and the uncompressed PDF golden-cs writes
//      (fixtures/run/NAME.meta.json, NAME.cs.pdf), or its error (NAME.error.json), and every request the
//      mock Hub received from it (NAME.requests.json);
//   3. fixtures/zone.json: the time zone of the computer (a DateTime with an offset is read as local
//      time, so the cases marked "zone" only compare in that time zone).
//
//   node test/generate-fixtures.ts [name...]       (from packages/reportman-driver-http, golden-cs built)
//
// golden-cs runs in a temporary folder that holds the connections file of the run (its Url points at the
// mock Hub): the reports name it relative. The case "slow" waits for the 100 s timeout of HttpClient; it
// runs only when named or with --slow.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectionsIni } from './connections.ts';
import { MockHub } from './hub.ts';
import { CONFIG_FILE, reportsDir, writeReports } from './reports.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const exe = path.resolve(here, '../../../tools/golden-cs/bin/Release/net10.0/golden-cs.exe');
const runDir = path.join(here, 'fixtures/run');

interface ReportCase {
  name: string;
  report: string;
  params?: Record<string, string>;
  culture?: string;
  zone?: boolean;
  slow?: boolean;
}

function goldenError(output: string): { error: string; message: string } {
  const text = output.replace(/\r\n/g, '\n');
  const m = /^ERROR ([\w.`]+): ([\s\S]*?)(?=\n {3}at |\s*$)/.exec(text);
  if (m === null) return { error: 'unknown', message: text.trim() };
  return { error: m[1]!.split('.').pop()!, message: m[2]! };
}

function run(args: string[], cwd: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // detached: without a console .NET writes stderr in the ANSI code page (not the OEM one of the console)
    const child = spawn(exe, args, { cwd, detached: true, windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    const ansi = new TextDecoder('windows-1252');
    child.on('close', (status) => resolve({ status, stdout: ansi.decode(Buffer.concat(out)), stderr: ansi.decode(Buffer.concat(err)) }));
  });
}

/** An address nobody listens on: a port that was free a moment ago. */
async function refusedUrl(): Promise<string> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return 'http://127.0.0.1:' + port;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slow = args.includes('--slow');
  const only = args.filter((a) => !a.startsWith('--'));
  writeReports();
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(here, 'fixtures/zone.json'), JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) + '\n');
  const cases = (JSON.parse(fs.readFileSync(path.join(here, 'cases.json'), 'utf8')) as { reports: ReportCase[] }).reports;
  const hub = await MockHub.start();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-agent-'));
  try {
    fs.writeFileSync(path.join(work, CONFIG_FILE), connectionsIni(hub.url, await refusedUrl()));
    for (const c of cases) {
      if (only.length > 0 ? !only.includes(c.name) : c.slow === true && !slow) continue;
      const meta = path.join(runDir, c.name + '.meta.json');
      const pdf = path.join(runDir, c.name + '.cs.pdf');
      const errFile = path.join(runDir, c.name + '.error.json');
      const requestsFile = path.join(runDir, c.name + '.requests.json');
      for (const f of [meta, pdf, errFile, requestsFile]) if (fs.existsSync(f)) fs.unlinkSync(f);
      const argv = ['run', path.join(reportsDir, c.report + '.rep'), meta, '--pdf', pdf];
      for (const [k, v] of Object.entries(c.params ?? {})) argv.push('--param', k + '=' + v);
      if (c.culture !== undefined) argv.push('--culture', c.culture);
      hub.clear();
      const r = await run(argv, work);
      fs.writeFileSync(requestsFile, JSON.stringify(hub.requests, null, 2) + '\n');
      if (r.status !== 0) {
        for (const f of [meta, pdf]) if (fs.existsSync(f)) fs.unlinkSync(f);
        const e = goldenError(r.stderr || r.stdout);
        fs.writeFileSync(errFile, JSON.stringify(e, null, 2) + '\n');
        console.log(c.name + ': ' + e.error + ': ' + e.message.split('\n')[0]);
      } else {
        fs.writeFileSync(meta, JSON.stringify(JSON.parse(fs.readFileSync(meta, 'utf8'))));
        console.log(c.name + ': ' + r.stdout.trim());
      }
    }
  } finally {
    await hub.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
