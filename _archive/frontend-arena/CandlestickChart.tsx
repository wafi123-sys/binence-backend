// ============================================================
// Candlestick Chart — TradingView Lightweight Charts v5
// Reads ONLY from execution-based OHLC data via market hook.
// v5 API: chart.addSeries(candlestickSeries, options) — NOT addCandlestickSeries()
// ============================================================

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useMarket } from '../../hooks/useMarket';
import { Timeframe, OHLCBar } from '../../engine/types';

const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: 'Tick', value: 'tick' },
  { label: '1s',   value: '1s' },
  { label: '5s',   value: '5s' },
  { label: '15s',  value: '15s' },
  { label: '30s',  value: '30s' },
  { label: '1m',   value: '1m' },
  { label: '5m',   value: '5m' },
  { label: '15m',  value: '15m' },
  { label: '30m',  value: '30m' },
  { label: '1h',   value: '1h' },
  { label: 'D',    value: '1d' },
  { label: 'W',    value: '1w' as Timeframe },
];

export default function CandlestickChart() {
  const { ohlcData, lastPrice } = useMarket();
  const [selectedTf, setSelectedTf] = useState<Timeframe>('1w' as Timeframe);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  // Store chart & series refs as `any` because LW Charts v5 types changed significantly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef     = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleRef    = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const volumeRef    = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trendlineRef = useRef<any>(null);
  const resizeObRef  = useRef<ResizeObserver | null>(null);
  const isReadyRef   = useRef(false);

  // ── Initialize chart once ─────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return;
    let destroyed = false;

    const init = async () => {
      const lw = await import('lightweight-charts');
      const {
        createChart,
        ColorType,
        CrosshairMode,
        CandlestickSeries,  // v5 aliased export (candlestickSeries as CandlestickSeries)
        HistogramSeries,    // v5 aliased export (histogramSeries as HistogramSeries)
        LineSeries,
      } = lw as any;

      if (destroyed || !chartContainerRef.current) return;

      const container = chartContainerRef.current;
      const { clientWidth: w, clientHeight: h } = container;

      const chart = createChart(container, {
        width:  w,
        height: h,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor:  '#64748b',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize:   11,
        },
        grid: {
          vertLines: { color: 'rgba(255,255,255,0.03)' },
          horzLines: { color: 'rgba(255,255,255,0.03)' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: 'rgba(0,229,255,0.4)', width: 1, style: 2, labelBackgroundColor: '#0d1117' },
          horzLine: { color: 'rgba(0,229,255,0.4)', width: 1, style: 2, labelBackgroundColor: '#0d1117' },
        },
        rightPriceScale: {
          borderColor: 'rgba(255,255,255,0.06)',
          scaleMargins: { top: 0.08, bottom: 0.24 },
        },
        timeScale: {
          borderColor: 'rgba(255,255,255,0.06)',
          timeVisible: true,
          secondsVisible: true,
          rightOffset: 5,
          barSpacing: 8,
        },
        handleScroll:  { vertTouchDrag: false },
        handleScale:   { axisPressedMouseMove: { time: true, price: true } },
      });

      // v5: chart.addSeries(SeriesDefinition, options)
      const cSeries = chart.addSeries(CandlestickSeries, {
        upColor:         '#00e676',
        downColor:       '#ff1744',
        borderUpColor:   '#00e676',
        borderDownColor: '#ff1744',
        wickUpColor:     '#00e676',
        wickDownColor:   '#ff1744',
      });

      const vSeries = chart.addSeries(HistogramSeries, {
        priceFormat:   { type: 'volume' },
        priceScaleId:  'vol',
      });

      chart.priceScale('vol').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });

      const tSeries = chart.addSeries(LineSeries, {
        color: '#ff1744',
        lineWidth: 2,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });

      chartRef.current  = chart;
      candleRef.current = cSeries;
      volumeRef.current = vSeries;
      trendlineRef.current = tSeries;
      isReadyRef.current = true;

      // Resize observer
      resizeObRef.current = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect;
        if (width > 0 && height > 0) chart.applyOptions({ width, height });
      });
      resizeObRef.current.observe(container);
    };

    init();

    return () => {
      destroyed = true;
      isReadyRef.current = false;
      resizeObRef.current?.disconnect();
      chartRef.current?.remove();
      chartRef.current  = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, []);

  // ── Push data whenever timeframe or ohlcData changes ─────
  useEffect(() => {
    if (!isReadyRef.current || !candleRef.current || !volumeRef.current) return;

    const bars: OHLCBar[] = ohlcData[selectedTf] ?? [];

    if (bars.length === 0) {
      candleRef.current.setData([]);
      volumeRef.current.setData([]);
      trendlineRef.current.setData([]);
      return;
    }

    // Deduplicate by time (latest wins) and sort ascending
    // Time must be strictly integer (UNIX timestamp in seconds)
    const byTime = new Map<number, OHLCBar>();
    for (const b of bars) {
      if (typeof b.time !== 'number' || isNaN(b.time)) continue;
      byTime.set(Math.floor(b.time), b);
    }
    const sorted = Array.from(byTime.values()).sort((a, b) => Math.floor(a.time) - Math.floor(b.time));

    try {
      candleRef.current.setData(
        sorted.map((b) => ({
          time:  Math.floor(b.time) as any,
          open:  b.open,
          high:  b.high,
          low:   b.low,
          close: b.close,
        }))
      );

      volumeRef.current.setData(
        sorted.map((b) => ({
          time:  Math.floor(b.time) as any,
          value: b.volume,
          color: b.close >= b.open
            ? 'rgba(0,230,118,0.3)'
            : 'rgba(255,23,68,0.3)',
        }))
      );

      if (sorted.length > 5 && selectedTf === '1w') {
        const firstPoint = sorted[0];
        const currentPoint = sorted[sorted.length - 1];
        if (Math.floor(firstPoint.time) < Math.floor(currentPoint.time)) {
          trendlineRef.current.setData([
            { time: Math.floor(firstPoint.time) as any, value: firstPoint.low * 0.95 },
            { time: Math.floor(currentPoint.time) as any, value: currentPoint.low * 0.95 },
          ]);
        } else {
          trendlineRef.current.setData([]);
        }
      } else {
        trendlineRef.current.setData([]);
      }

      // Scroll to latest
      chartRef.current?.timeScale().scrollToRealTime();
    } catch (e) {
      // Log error to console for debugging, instead of silently ignoring
      console.error('[CandlestickChart] Error setting data:', e);
    }
  }, [ohlcData, selectedTf]);

  return (
    <div className="chart-panel">
      <div className="chart-header">
        <div className="chart-title">
          <h3>ARENA</h3>
          <span className="chart-last-price">
            {lastPrice > 0 ? lastPrice.toLocaleString('id-ID') : '—'}
          </span>
        </div>
        <div className="chart-timeframes">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              className={`chart-tf-btn ${selectedTf === tf.value ? 'chart-tf-active' : ''}`}
              onClick={() => setSelectedTf(tf.value)}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-container" ref={chartContainerRef} />
    </div>
  );
}
