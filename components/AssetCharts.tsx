'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { ASSETS, generateOHLCData, generateTick } from '@/lib/mockData';
import { BarChart3 } from 'lucide-react';

// Only import lightweight-charts types; actual import happens dynamically
type IChartApi = import('lightweight-charts').IChartApi;
type ISeriesApi = import('lightweight-charts').ISeriesApi<'Candlestick'>;

const TRADEABLE_ASSETS = ASSETS; // BTC, BBCA, BBRI, GOTO, MTDL

export default function AssetCharts() {
  const [activeTab, setActiveTab] = useState(0);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPriceRef = useRef<number>(0);

  const asset = TRADEABLE_ASSETS[activeTab];

  const ohlcData = useMemo(() => {
    const startDate = new Date('2024-01-01');
    const endDate = new Date();
    return generateOHLCData(asset, startDate, endDate);
  }, [asset]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Dynamically import lightweight-charts
    let isMounted = true;

    import('lightweight-charts').then(({ createChart, ColorType, CandlestickSeries }) => {
      if (!isMounted || !chartContainerRef.current) return;

      // Clear existing chart
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#8892b0',
          fontFamily: 'Inter, sans-serif',
          fontSize: 11,
        },
        grid: {
          vertLines: { color: 'rgba(255,255,255,0.03)' },
          horzLines: { color: 'rgba(255,255,255,0.03)' },
        },
        width: chartContainerRef.current.clientWidth,
        height: 400,
        crosshair: {
          mode: 0,
          vertLine: {
            color: 'rgba(0, 229, 255, 0.3)',
            width: 1,
            style: 2,
            labelBackgroundColor: '#0f0f19',
          },
          horzLine: {
            color: 'rgba(0, 229, 255, 0.3)',
            width: 1,
            style: 2,
            labelBackgroundColor: '#0f0f19',
          },
        },
        timeScale: {
          borderColor: 'rgba(255,255,255,0.06)',
          timeVisible: true,
          secondsVisible: false,
        },
        rightPriceScale: {
          borderColor: 'rgba(255,255,255,0.06)',
        },
      });

      const candlestickSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#00e676',
        downColor: '#ff1744',
        borderDownColor: '#ff1744',
        borderUpColor: '#00e676',
        wickDownColor: '#ff1744',
        wickUpColor: '#00e676',
      });

      const formattedData = ohlcData.map((d) => ({
        time: (Math.floor(d.timestamp / 1000)) as import('lightweight-charts').UTCTimestamp,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }));

      candlestickSeries.setData(formattedData);
      chart.timeScale().fitContent();

      chartRef.current = chart;
      seriesRef.current = candlestickSeries;

      // Track last price
      if (ohlcData.length > 0) {
        lastPriceRef.current = ohlcData[ohlcData.length - 1].close;
      }

      // Real-time updates
      intervalRef.current = setInterval(() => {
        const newPrice = generateTick(lastPriceRef.current, asset.annualVolatility);
        lastPriceRef.current = newPrice;
        const now = Math.floor(Date.now() / 1000) as import('lightweight-charts').UTCTimestamp;

        candlestickSeries.update({
          time: now,
          open: newPrice * (1 + (Math.random() - 0.5) * 0.001),
          high: newPrice * (1 + Math.random() * 0.002),
          low: newPrice * (1 - Math.random() * 0.002),
          close: newPrice,
        });
      }, 1000);

      // Resize handler
      const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: chartContainerRef.current.clientWidth,
          });
        }
      };

      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
      };
    });

    return () => {
      isMounted = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [activeTab, ohlcData, asset.annualVolatility]);

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Asset Price Charts</h2>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-success">
          <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse-glow" />
          LIVE
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 p-1 bg-background/50 rounded-xl mb-6 overflow-x-auto">
        {TRADEABLE_ASSETS.map((a, index) => (
          <button
            key={a.ticker}
            onClick={() => setActiveTab(index)}
            className={`flex-1 min-w-[80px] px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-300 cursor-pointer whitespace-nowrap ${
              activeTab === index
                ? 'bg-primary/10 text-primary border border-primary/20'
                : 'text-text-secondary hover:text-foreground hover:bg-border'
            }`}
          >
            {a.ticker}
          </button>
        ))}
      </div>

      {/* Asset info */}
      <div className="flex items-center gap-4 mb-4">
        <span className="text-sm text-text-secondary">{asset.name}</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-primary-dim text-primary uppercase">
          {asset.type}
        </span>
        <span className="text-xs text-text-muted">{asset.currency}</span>
      </div>

      {/* Chart Container */}
      <div ref={chartContainerRef} className="w-full rounded-lg overflow-hidden" />
    </div>
  );
}
