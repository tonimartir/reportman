// The device hook of the charts (PrintOut.drawChart and the report's charting driver) and the
// vector chart called directly. The drawing itself is checked against the C# engine in
// chart-parity.test.ts.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChartType, readReportXml } from '@reportman/lib';
import { MetaFile, MetaObjectDraw, MetaObjectText, MetaPage, PenType, ShapeType } from '@reportman/metafile';
import { PdfDevice } from '@reportman/pdf';
import { CultureInfo, drawVectorChart, prepareReport, RpDateTime, Series, SeriesItem } from '@reportman/engine';
import { sqliteHost } from './sqlite-host.js';
import { here, samplesDb } from './golden-run.js';

interface ChartCall {
  series: Series;
  posx: number;
  posy: number;
  chart: unknown;
}

/** A device that draws the charts by itself: it only records what it receives. */
class ChartDevice extends PdfDevice {
  readonly calls: ChartCall[] = [];

  override drawChart(series: unknown, _metafile: MetaFile, posx: number, posy: number, chart: unknown): void {
    this.calls.push({ series: series as Series, posx, posy, chart });
  }
}

const monthlySales = path.resolve(here, '../../../../samples/monthly-sales.rep');

async function runMonthlySales(device: PdfDevice, chartingDriver?: PdfDevice): Promise<MetaFile> {
  const model = readReportXml(new Uint8Array(fs.readFileSync(monthlySales)));
  const run = await prepareReport(model, {
    device,
    data: sqliteHost(samplesDb),
    host: { now: () => RpDateTime.create(2026, 1, 1), fileExists: () => false },
  });
  if (chartingDriver !== undefined) run.runtime.chartingDriver = chartingDriver;
  return run.execute();
}

/** The dotted grid lines the vector chart draws. */
function gridLines(meta: MetaFile): number {
  let n = 0;
  for (const page of meta.pages) for (const o of page.objects) if (o instanceof MetaObjectDraw && o.penStyle === PenType.Dot) n++;
  return n;
}

describe('the chart device hook', () => {
  it('gives the series to a device with a chart support of its own', async () => {
    const device = new ChartDevice();
    const meta = await runMonthlySales(device);
    expect(device.calls.length).toBe(1);
    const { series, posx, posy, chart } = device.calls[0]!;
    expect(series.seriesItems.length).toBe(1);
    const item = series.seriesItems[0]!;
    expect(item.chartStyle).toBe(ChartType.Bar);
    expect(item.values.length).toBe(12);
    expect(item.valueCaptions[0]).toBe('Jan 2025');
    // COLOREXPRESSION 11957550: every value has the colour, the series keeps none
    expect(item.colors.every((c) => c === 11957550)).toBe(true);
    expect(item.color).toBe(-1);
    expect(series.printWidth).toBe(10758);
    expect(series.printHeight).toBe(5500);
    expect(series.fontSize).toBe(9);
    expect((chart as { valueExpression: string }).valueExpression).toBe('MON.SALES');
    expect(posx).toBe(574);
    expect(posy).toBeGreaterThan(574);
    expect(gridLines(meta)).toBe(0);
  });

  it('draws with the charting driver of the report instead of the device', async () => {
    const device = new ChartDevice();
    const charting = new ChartDevice();
    await runMonthlySales(device, charting);
    expect(device.calls.length).toBe(0);
    expect(charting.calls.length).toBe(1);
  });

  it('draws the vector chart when the device has no chart support', async () => {
    const plain = await runMonthlySales(new PdfDevice());
    const viaDriver = await runMonthlySales(new ChartDevice(), new PdfDevice());
    expect(gridLines(plain)).toBeGreaterThan(0);
    expect(viaDriver.pages.get(0).objects.length).toBe(plain.pages.get(0).objects.length);
  });
});

describe('drawVectorChart', () => {
  function seriesOf(values: number[], captions: string[]): Series {
    const series = new Series();
    const item = new SeriesItem();
    item.chartStyle = ChartType.Line;
    item.values.push(...values);
    item.valueCaptions.push(...captions);
    item.colors.push(...values.map(() => -1));
    series.seriesItems.push(item);
    series.printWidth = 4000;
    series.printHeight = 2500;
    return series;
  }

  function page(): { meta: MetaFile; page: MetaPage } {
    const meta = new MetaFile();
    const p = new MetaPage(meta);
    meta.pages.add(p);
    meta.currentPage = 0;
    return { meta, page: p };
  }

  it('draws the grid, the axes, the lines, the marks and the captions', () => {
    const { meta, page: p } = page();
    drawVectorChart(seriesOf([1, 3, 2], ['a', 'b', 'c']), meta, 100, 200, { fontSize: 10 }, CultureInfo.get('en-US'));
    const texts = p.objects.filter((o) => o instanceof MetaObjectText).map((o) => p.getText(o as MetaObjectText));
    expect(texts).toEqual(['0', '1', '2', '3', 'a', 'b', 'c']);
    const draws = p.objects.filter((o) => o instanceof MetaObjectDraw) as MetaObjectDraw[];
    expect(draws.filter((d) => d.drawStyle === ShapeType.Circle).length).toBe(3);
    expect(draws.filter((d) => d.drawStyle === ShapeType.Oblique1 || d.drawStyle === ShapeType.Oblique2).length).toBe(2);
  });

  it('formats the axis with the culture given', () => {
    const { meta, page: p } = page();
    drawVectorChart(seriesOf([1500, 3000], ['', '']), meta, 0, 0, null, CultureInfo.get('es-ES'));
    const texts = p.objects.filter((o) => o instanceof MetaObjectText).map((o) => p.getText(o as MetaObjectText));
    expect(texts).toContain('3.000');
  });

  it('draws nothing without values or without a size', () => {
    const { meta, page: p } = page();
    const empty = seriesOf([], []);
    drawVectorChart(empty, meta, 0, 0, null, CultureInfo.invariant);
    const noSize = seriesOf([1], ['']);
    noSize.printWidth = 0;
    drawVectorChart(noSize, meta, 0, 0, null, CultureInfo.invariant);
    drawVectorChart(null, meta, 0, 0, null, CultureInfo.invariant);
    expect(p.objects.length).toBe(0);
  });
});
