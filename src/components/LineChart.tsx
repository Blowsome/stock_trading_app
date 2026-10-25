"use client";

import { useEffect, useRef } from "react";
import {
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
  type WhitespaceData,
} from "lightweight-charts";

export type Point = { time: number; value: number };

type Props = {
  points: Point[];
  color: string;
  /** Dotted reference line, e.g. the previous close on the 1D view. */
  baseline?: number | null;
  /** Pads the time axis to this unix time so a partial trading day fills only part of the width. */
  padUntil?: number | null;
  padStep?: number;
  /** Re-fits the view when this changes (e.g. the selected range). */
  fitKey?: string;
  onHover?: (p: Point | null) => void;
  height?: number;
};

const MUTED = "#5f6368";
const MIN_SPAN = 0.004;

/** Minimal Robinhood-style line chart: no axes or grid, crosshair drives the header value. */
export function LineChart({ points, color, baseline, padUntil, padStep = 300, fitKey, onHover, height = 320 }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLine = useRef<IPriceLine | null>(null);
  const hover = useRef(onHover);
  hover.current = onHover;

  useEffect(() => {
    const c = createChart(el.current!, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: MUTED },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
      leftPriceScale: { visible: false },
      timeScale: { visible: false, borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: MUTED, width: 1, style: LineStyle.Solid, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      handleScroll: false,
      handleScale: false,
    });
    const s = c.addSeries(LineSeries, {
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerRadius: 5,
      crosshairMarkerBorderColor: "#000",
      crosshairMarkerBorderWidth: 2,
      // Don't blow cent-level wiggles up to full height: show at least 0.4% of the value.
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const info = original();
        if (!info?.priceRange) return info;
        const { minValue, maxValue } = info.priceRange;
        const mid = (minValue + maxValue) / 2;
        const minSpan = Math.abs(mid) * MIN_SPAN;
        if (maxValue - minValue >= minSpan) return info;
        return { ...info, priceRange: { minValue: mid - minSpan / 2, maxValue: mid + minSpan / 2 } };
      },
    });
    c.subscribeCrosshairMove((param) => {
      const d = param.seriesData.get(s) as LineData | undefined;
      if (!param.point || !param.time || !d || d.value === undefined) hover.current?.(null);
      else hover.current?.({ time: param.time as number, value: d.value });
    });
    chart.current = c;
    series.current = s;
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
      priceLine.current = null;
    };
  }, []);

  useEffect(() => {
    series.current?.applyOptions({ color, crosshairMarkerBackgroundColor: color });
  }, [color]);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    // The chart requires strictly increasing times; keep the latest value for any repeated second.
    const data: (LineData | WhitespaceData)[] = [];
    for (const p of [...points].sort((a, b) => a.time - b.time)) {
      const point = { time: Math.floor(p.time) as UTCTimestamp, value: p.value };
      if (data.length && data[data.length - 1].time === point.time) data[data.length - 1] = point;
      else data.push(point);
    }
    const last = data[data.length - 1]?.time as number | undefined;
    if (padUntil && last) {
      for (let t = last + padStep; t <= padUntil; t += padStep) data.push({ time: t as UTCTimestamp });
    }
    s.setData(data);
  }, [points, padUntil, padStep]);

  useEffect(() => {
    chart.current?.timeScale().fitContent();
  }, [fitKey, points.length > 0]);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    if (priceLine.current) s.removePriceLine(priceLine.current);
    priceLine.current =
      baseline != null
        ? s.createPriceLine({ price: baseline, color: MUTED, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false })
        : null;
  }, [baseline]);

  return <div ref={el} style={{ height }} className="w-full" onMouseLeave={() => hover.current?.(null)} />;
}
