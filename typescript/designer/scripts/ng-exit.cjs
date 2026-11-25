// `node -r ./scripts/ng-exit.cjs node_modules/@angular/cli/bin/ng.js build …`
//
// Angular CLI 21.2 leaves esbuild's service process running when `ng build` ends: the CLI sets
// `process.exitCode` and does not call `process.exit()`, so Node waits for that child forever and a
// deploy or an image build that runs `ng build` never goes on. Preloaded, this ends the process as
// soon as the CLI has set its exit code, with that code. When Node would exit on its own, the timer
// (unref'd) keeps nothing alive and changes nothing.
const timer = setInterval(() => {
  if (process.exitCode !== undefined) process.exit(process.exitCode);
}, 250);
timer.unref();
