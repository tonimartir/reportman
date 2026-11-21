// DataInfo.SqlParameterName: a parameter takes the spelling its SQL writes it with (the Delphi engine matches
// the parameters of a SQL without letter case; Microsoft.Data.Sqlite only by the exact name).
import { describe, expect, it } from 'vitest';
import { sqlParameterName } from '../src/data/datainfo.js';

describe('the name of a parameter as its SQL writes it', () => {
  it('keeps the alias when the SQL writes it so or does not name it', () => {
    expect(sqlParameterName('SELECT * FROM T WHERE A = :FIRST_YEAR', 'FIRST_YEAR')).toBe('FIRST_YEAR');
    expect(sqlParameterName('SELECT * FROM T', 'FIRST_YEAR')).toBe('FIRST_YEAR');
    expect(sqlParameterName('', 'FIRST_YEAR')).toBe('FIRST_YEAR');
  });

  it('takes the spelling of a placeholder written with other letter case', () => {
    expect(sqlParameterName('SELECT * FROM O WHERE D >= :startDate AND D < :endDate', 'STARTDATE')).toBe('startDate');
    expect(sqlParameterName('EXEC P @MaxOrder', 'MAXORDER')).toBe('MaxOrder');
  });

  it('only matches whole placeholders, and prefers the exact spelling', () => {
    expect(sqlParameterName('SELECT :startDate2 FROM T', 'STARTDATE')).toBe('STARTDATE');
    expect(sqlParameterName('SELECT startDate FROM T', 'STARTDATE')).toBe('STARTDATE');
    expect(sqlParameterName('SELECT :startdate, :STARTDATE FROM T', 'STARTDATE')).toBe('STARTDATE');
  });
});
