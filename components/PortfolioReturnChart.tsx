'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { generatePortfolioReturns, generateTick } from '@/lib/mockData';
import { TrendingUp } from 'lucide-react';

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false });

export default function PortfolioReturnChart() {
  const [mounted, setMounted] = useState(false);
  const [seriesData, setSeriesData] = useState<{ x: number; y: number }[]>([]);
  const lastValueRef = useRef(100);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Generate historical data on mount
  useEffect(() => {
    setMounted(true);
    const startDate = new Date('2024-01-01');
    const endDate = new Date();
    const history = generatePortfolioReturns(startDate, endDate);

    const data = history.map((p) => ({
      x: p.timestamp,
      y: parseFloat(p.price.toFixed(2)),
    }));

    setSeriesData(data);
    if (data.length > 0) {
      lastValueRef.current = data[data.length - 1].y;
    }
  }, []);

  // Real-time ticking
  useEffect(() => {
    if (seriesData.length === 0) return;

    intervalRef.current = setInterval(() => {
      const newValue = generateTick(lastValueRef.current, 0.35);
      lastValueRef.current = newValue;
      const now = Date.now();

      setSeriesData((prev) => {
        const newData = [...prev, { x: now, y: parseFloat(newValue.toFixed(2)) }];
        // Keep last 1000 points for performance
        if (newData.length > 1000) {
          return newData.slice(newData.length - 1000);
        }
        return newData;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [seriesData.length > 0]);

  const currentReturn = useMemo(() => {
    if (seriesData.length === 0) return 0;
    return seriesData[seriesData.length - 1].y - 100;
  }, [seriesData]);

  const chartOptions = useMemo(
    () => ({
      chart: {
        type: 'area' as const,
        background: 'transparent',
        toolbar: { show: false },
        zoom: { enabled: false },
        animations: {
          enabled: true,
          easing: 'linear' as const,
          dynamicAnimation: { speed: 800 },
        },
        sparkline: { enabled: false },
      },
      grid: {
        show: true,
        borderColor: 'rgba(255,255,255,0.04)',
        strokeDashArray: 3,
        padding: { left: 10, right: 10 },
      },
      xaxis: {
        type: 'datetime' as const,
        labels: {
          style: {
            colors: '#8892b0',
            fontSize: '11px',
            fontFamily: 'Inter, sans-serif',
          },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: {
          style: {
            colors: '#8892b0',
            fontSize: '11px',
            fontFamily: 'Inter, sans-serif',
          },
          formatter: (val: number) => val.toFixed(1),
        },
      },
      stroke: {
        curve: 'smooth' as const,
        width: 2,
        colors: ['#00e5ff'],
      },
      fill: {
        type: 'gradient',
        gradient: {
          shadeIntensity: 1,
          opacityFrom: 0.4,
          opacityTo: 0.0,
          stops: [0, 100],
          colorStops: [
            { offset: 0, color: '#00e5ff', opacity: 0.3 },
            { offset: 100, color: '#00e5ff', opacity: 0 },
          ],
        },
      },
      tooltip: {
        theme: 'dark' as const,
        x: {
          format: 'MMM dd, yyyy HH:mm',
        },
        y: {
          formatter: (val: number) => `${val.toFixed(2)} (${(val - 100).toFixed(2)}%)`,
        },
      },
      dataLabels: { enabled: false },
    }),
    []
  );

  const getReturnColor = useCallback(() => {
    return currentReturn >= 0 ? 'text-success' : 'text-danger';
  }, [currentReturn]);

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Portfolio Performance</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-success">
            <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse-glow" />
            REAL-TIME
          </div>
          <div className={`text-xl font-bold ${getReturnColor()}`}>
            {currentReturn >= 0 ? '+' : ''}{currentReturn.toFixed(2)}%
          </div>
        </div>
      </div>
      <p className="text-xs text-text-secondary mb-4">
        Composite return index (base 100) — Jan 2024 to present
      </p>

      <div className="w-full" style={{ minHeight: 350 }}>
        {mounted && seriesData.length > 0 && (
          <Chart
            options={chartOptions}
            series={[{ name: 'Portfolio Index', data: seriesData }]}
            type="area"
            height={350}
            width="100%"
          />
        )}
      </div>
    </div>
  );
}
