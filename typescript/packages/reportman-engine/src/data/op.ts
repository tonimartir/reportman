// How the engine reaches the host's data without making the evaluator asynchronous.
//
// The C# engine opens datasets, moves records and re-executes details synchronously, sometimes from
// inside an expression (a field of a dataset that is not open yet opens it; REOPEN; GETVALUEFROMSQL).
// Here every operation that may reach the host is written once as a generator (an Op): it yields the
// value the host returned (a plain value or a promise) and is resumed with the resolved value.
//
// - runAsync drives an Op awaiting what it yields: the asynchronous API (opening, next record, pages).
// - runSync drives an Op inside a synchronous evaluation: it works when the host answers with plain
//   values (node:sqlite does) and fails with a clear error when the host returns a promise.

/** An operation that may wait for the host: a generator that yields host results. */
export type Op<T> = Generator<unknown, T, unknown>;

/** A value or a promise of it: what a host method may return. */
export type MaybePromise<T> = T | PromiseLike<T>;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/** Waits for a host result inside an Op: `const r = yield* wait(host.query(...))`. */
export function* wait<T>(value: MaybePromise<T>): Op<T> {
  return (yield value) as T;
}

/** Runs an Op, awaiting the promises it yields. */
export async function runAsync<T>(op: Op<T>): Promise<T> {
  let input: unknown = undefined;
  let error: unknown = undefined;
  let failed = false;
  for (;;) {
    let step: IteratorResult<unknown, T>;
    if (failed) {
      failed = false;
      step = op.throw(error);
    } else step = op.next(input);
    if (step.done) return step.value;
    const value = step.value;
    if (isThenable(value)) {
      try {
        input = await value;
      } catch (e) {
        error = e;
        failed = true;
      }
    } else input = value;
  }
}

const SYNCHRONOUS_DATA_REQUIRED =
  ' needs the data while an expression is being evaluated, and the data host answered asynchronously (it ' +
  'returned a promise).';

/** The error of an operation that needs a synchronous host and got a promise. */
export class SynchronousDataRequiredError extends Error {
  constructor(what: string) {
    super(
      what +
        SYNCHRONOUS_DATA_REQUIRED +
        ' Open the dataset before printing (OpenOnStart), or give a data host whose connect and query return ' +
        'their results directly.',
    );
    this.name = 'SynchronousDataRequiredError';
  }
}

/**
 * Whether a run failed because the report needs a synchronous data host: the error itself, or the
 * error of the report item that was evaluating (a ReportException keeps only its message, as in C#).
 * A host can then run the report again with a synchronous driver.
 */
export function isSynchronousDataRequired(error: unknown): boolean {
  if (error instanceof SynchronousDataRequiredError) return true;
  return error instanceof Error && error.message.includes(SYNCHRONOUS_DATA_REQUIRED);
}

/** Runs an Op synchronously; a promise from the host fails with SynchronousDataRequiredError. */
export function runSync<T>(op: Op<T>, what: string): T {
  let input: unknown = undefined;
  let error: unknown = undefined;
  let failed = false;
  for (;;) {
    let step: IteratorResult<unknown, T>;
    if (failed) {
      failed = false;
      step = op.throw(error);
    } else step = op.next(input);
    if (step.done) return step.value;
    const value = step.value;
    if (isThenable(value)) {
      // The pending host call is abandoned: its rejection must not be reported as unhandled.
      value.then(undefined, () => undefined);
      error = new SynchronousDataRequiredError(what);
      failed = true;
    } else input = value;
  }
}
