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
  const [timeframe, setTimeframe] = useState('1W');
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPriceRef = useRef<number>(0);

  const asset = TRADEABLE_ASSETS[activeTab];

  const ohlcData = useMemo(() => {
    const startDate = new Date('2020-01-01');
    const endDate = new Date();
    const dailyData = generateOHLCData(asset, startDate, endDate);

    if (timeframe === '1D') return dailyData;

    const groupedData: typeof dailyData = [];
    let currentGroup: any = null;

    for (const d of dailyData) {
      const date = new Date(d.timestamp);
      let groupTime = d.timestamp;

      if (timeframe === '1W') {
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        groupTime = new Date(new Date(date).setDate(diff)).setHours(0,0,0,0);
      } else if (timeframe === '1M') {
        groupTime = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
      }

      if (!currentGroup || currentGroup.timestamp !== groupTime) {
        if (currentGroup) groupedData.push(currentGroup);
        currentGroup = { ...d, timestamp: groupTime };
      } else {
        currentGroup.high = Math.max(currentGroup.high, d.high);
        currentGroup.low = Math.min(currentGroup.low, d.low);
        currentGroup.close = d.close;
        currentGroup.volume += d.volume;
      }
    }
    if (currentGroup) groupedData.push(currentGroup);
    return groupedData;
  }, [asset, timeframe]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Dynamically import lightweight-charts
    let isMounted = true;

    import('lightweight-charts').then(({ createChart, ColorType, CandlestickSeries, LineSeries }) => {
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
      
      const trendlineSeries = chart.addSeries(LineSeries, {
        color: '#ff1744',
        lineWidth: 2,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });

      if (formattedData.length > 10) {
        const firstPoint = formattedData[Math.floor(formattedData.length * 0.1)];
        const lastPoint = formattedData[formattedData.length - 1];
        trendlineSeries.setData([
          { time: firstPoint.time, value: firstPoint.low * 0.85 },
          { time: lastPoint.time, value: lastPoint.low * 0.95 },
        ]);
      }

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
  }, [activeTab, ohlcData, asset.annualVolatility, timeframe]);

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

      {/* Asset info and Timeframe */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <span className="text-sm text-text-secondary">{asset.name}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary-dim text-primary uppercase">
            {asset.type}
          </span>
          <span className="text-xs text-text-muted">{asset.currency}</span>
        </div>
        <div className="flex gap-2">
          {['1D', '1W', '1M'].map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                timeframe === tf
                  ? 'bg-primary/20 text-primary'
                  : 'text-text-secondary hover:text-foreground hover:bg-border'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Chart Container */}
      <div ref={chartContainerRef} className="w-full rounded-lg overflow-hidden" />
    </div>
  );
}
