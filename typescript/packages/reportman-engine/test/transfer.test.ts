// The plain data of a connection that answers from a worker thread: what crosses a structured clone
// (postMessage) comes back as the same values, commands, results and exceptions.
import { describe, expect, it } from 'vitest';
import {
  CsDecimal,
  DateTimeKind,
  NetException,
  RpDateTime,
  decodeDataValue,
  decodeError,
  decodeQueryCommand,
  decodeQueryResult,
  encodeDataValue,
  encodeError,
  encodeQueryCommand,
  encodeQueryResult,
  type DataValue,
  type QueryResult,
  type TransferError,
} from '@reportman/engine';

describe('transfer between threads', () => {
  it('gives back every kind of value after a structured clone', () => {
    const values: DataValue[] = [
      null,
      undefined,
      'text ñ',
      12.5,
      -0,
      123456789012345678901234567890n,
      true,
      new Uint8Array([1, 2, 3]),
      new Date(Date.UTC(2024, 1, 29, 12, 0, 0)),
      CsDecimal.fromParts(1230n, 2, true),
      RpDateTime.fromTicks(638450000000000000n, DateTimeKind.Utc),
    ];
    for (const v of values) {
      const back = decodeDataValue(structuredClone(encodeDataValue(v)));
      if (v instanceof CsDecimal) {
        expect(back).toBeInstanceOf(CsDecimal);
        expect([(back as CsDecimal).mag, (back as CsDecimal).scale, (back as CsDecimal).negative]).toEqual([v.mag, v.scale, v.negative]);
      } else if (v instanceof RpDateTime) {
        expect(back).toBeInstanceOf(RpDateTime);
        expect([(back as RpDateTime).ticks, (back as RpDateTime).kind]).toEqual([v.ticks, v.kind]);
      } else expect(back).toEqual(v);
    }
  });

  it('gives back a command and a result', () => {
    const command = {
      sql: 'SELECT * FROM T WHERE A = :A',
      parameters: [{ name: 'A', value: CsDecimal.fromParts(5n, 1, false), valueType: 'Decimal' as const, dbType: 'Decimal' as const }],
      dataset: 'T',
    };
    const c = decodeQueryCommand(structuredClone(encodeQueryCommand(command)));
    expect(c.sql).toBe(command.sql);
    expect(c.dataset).toBe('T');
    expect(c.parameters[0]!.value).toBeInstanceOf(CsDecimal);
    expect(c.parameters[0]!.valueType).toBe('Decimal');
    const result: QueryResult = {
      columns: [{ name: 'D', type: 'DateTime', size: 8, declaredType: 'TIMESTAMP' }],
      rows: [[RpDateTime.fromTicks(1n, DateTimeKind.Unspecified)], [null]],
    };
    const r = decodeQueryResult(structuredClone(encodeQueryResult(result)));
    expect(r.columns).toEqual(result.columns);
    expect(r.rows[0]![0]).toBeInstanceOf(RpDateTime);
    expect(r.rows[1]![0]).toBeNull();
  });

  it('gives back an exception with its .NET type, its own fields and its cause', () => {
    class DriverException extends NetException {
      readonly number: number;
      readonly entries: { code: number; params: string[] }[];
      constructor(message: string, number: number, entries: { code: number; params: string[] }[]) {
        super('DriverException', message);
        this.number = number;
        this.entries = entries;
      }
    }
    const inner = new NetException('FormatException', 'Bad format');
    const error = new DriverException('Server said no', 1146, [{ code: 7, params: ['T'] }]);
    (error as { cause?: unknown }).cause = inner;
    (error as unknown as { callback: () => void }).callback = () => undefined;
    const wire = structuredClone(encodeError(error));
    expect(wire.fields).toEqual({ number: 1146, entries: [{ code: 7, params: ['T'] }] });

    // A driver rebuilds its own class...
    const rebuilt = decodeError(wire, (w: TransferError) =>
      w.netType === 'DriverException' ? new DriverException(w.message, w.fields.number as number, w.fields.entries as never) : undefined,
    );
    expect(rebuilt).toBeInstanceOf(DriverException);
    expect((rebuilt as DriverException).number).toBe(1146);
    expect((rebuilt as { cause?: unknown }).cause).toBeInstanceOf(NetException);
    expect(((rebuilt as { cause?: NetException }).cause as NetException).netType).toBe('FormatException');

    // ...and without it a NetException keeps the type and the fields
    const generic = decodeError(wire) as NetException & { number?: number };
    expect(generic).toBeInstanceOf(NetException);
    expect(generic.netType).toBe('DriverException');
    expect(generic.number).toBe(1146);
    const plain = decodeError(structuredClone(encodeError(new TypeError('not a function'))));
    expect(plain.name).toBe('TypeError');
    expect(plain.message).toBe('not a function');
  });
});
