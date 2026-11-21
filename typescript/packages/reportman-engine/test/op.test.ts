// The synchronous run of an Op and the error a host gets when the report needs synchronous data.
import { describe, expect, it } from 'vitest';
import { isSynchronousDataRequired, ReportException, runSync, SynchronousDataRequiredError, type Op } from '@reportman/engine';

function* readsData(answer: unknown): Op<unknown> {
  return yield answer;
}

describe('runSync and SynchronousDataRequiredError', () => {
  it('runs an Op whose host answers directly', () => {
    expect(runSync(readsData(42), 'GETVALUEFROMSQL')).toBe(42);
  });

  it('fails with SynchronousDataRequiredError when the host answers with a promise', () => {
    const promise = Promise.resolve(42);
    expect(() => runSync(readsData(promise), 'GETVALUEFROMSQL')).toThrow(SynchronousDataRequiredError);
  });

  it('tells the error apart also inside the ReportException of the item that was evaluating', () => {
    const e = new SynchronousDataRequiredError('GETVALUEFROMSQL');
    expect(isSynchronousDataRequired(e)).toBe(true);
    expect(isSynchronousDataRequired(new ReportException(e.message + '\nTRpExpression83 Prop:Expression', 'TRpExpression83', 'Expression'))).toBe(true);
    expect(isSynchronousDataRequired(new ReportException('Unknown identifier: X', 'TRpExpression1', 'Expression'))).toBe(false);
    expect(isSynchronousDataRequired('GETVALUEFROMSQL')).toBe(false);
    expect(isSynchronousDataRequired(undefined)).toBe(false);
  });
});
