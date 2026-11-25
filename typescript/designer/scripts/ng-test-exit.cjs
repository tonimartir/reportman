// `node -r ./scripts/ng-test-exit.cjs node_modules/@angular/cli/bin/ng.js test …`
//
// Like ng-exit.cjs, for `ng test`: Angular CLI 21.2 leaves esbuild's service process running when
// the unit tests end, so the command never returns (a CI step waits forever). The CLI sets its
// exit code before the tests run, so that cannot tell the end; vitest's summary can. Preloaded,
// this watches the output and ends the process once vitest has printed its summary (the "Tests"
// and "Duration" lines), with 1 when a test failed.
const ansi = /\x1b\[[0-9;]*m/g;
let summary = null;
function watch(chunk) {
  const text = String(chunk).replace(ansi, '');
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*Tests\s+.*\(\d+\)/.test(line)) summary = line;
    if (summary !== null && /^\s*Duration\s/.test(line)) {
      const failed = /failed/.test(summary);
      setTimeout(() => process.exit(failed ? 1 : process.exitCode ?? 0), 200);
    }
  }
}
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => {
    watch(chunk);
    return write(chunk, ...rest);
  };
}
