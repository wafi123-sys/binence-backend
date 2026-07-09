'use client';

import { useEffect, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { PORTFOLIO_WEIGHTS } from '@/lib/mockData';
import { PieChart } from 'lucide-react';

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false });

interface AllocationItem {
  asset: string;
  label: string;
  weight: number;
  color: string;
}

const allocations: AllocationItem[] = [
  { asset: 'CASH', label: 'Cash (Rupiah)', weight: PORTFOLIO_WEIGHTS.CASH, color: '#8892b0' },
  { asset: 'BTC', label: 'Bitcoin (BTC)', weight: PORTFOLIO_WEIGHTS.BTC, color: '#f7931a' },
  { asset: 'BBCA', label: 'BBCA (Saham)', weight: PORTFOLIO_WEIGHTS.BBCA, color: '#00e5ff' },
  { asset: 'BBRI', label: 'BBRI (Saham)', weight: PORTFOLIO_WEIGHTS.BBRI, color: '#7c4dff' },
  { asset: 'GOTO', label: 'GOTO (Saham)', weight: PORTFOLIO_WEIGHTS.GOTO, color: '#00e676' },
  { asset: 'MTDL', label: 'MTDL (Saham)', weight: PORTFOLIO_WEIGHTS.MTDL, color: '#ff6d00' },
];

export default function PortfolioDonut() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const chartOptions = useMemo(
    () => ({
      chart: {
        type: 'donut' as const,
        background: 'transparent',
        animations: {
          enabled: true,
          easing: 'easeinout' as const,
          speed: 1200,
          animateGradually: { enabled: true, delay: 150 },
        },
      },
      labels: allocations.map((a) => a.label),
      colors: allocations.map((a) => a.color),
      stroke: {
        width: 2,
        colors: ['#0a0a0f'],
      },
      dataLabels: {
        enabled: false,
      },
      plotOptions: {
        pie: {
          donut: {
            size: '72%',
            labels: {
              show: true,
              name: {
                show: true,
                fontSize: '14px',
                fontFamily: 'Inter, sans-serif',
                color: '#8892b0',
                offsetY: -8,
              },
              value: {
                show: true,
                fontSize: '24px',
                fontFamily: 'Inter, sans-serif',
                fontWeight: 700,
                color: '#e0e0e0',
                offsetY: 4,
                formatter: (val: string) => `${parseFloat(val).toFixed(1)}%`,
              },
              total: {
                show: true,
                label: 'Total AUM',
                fontSize: '12px',
                fontFamily: 'Inter, sans-serif',
                color: '#8892b0',
                formatter: () => '$2.4B',
              },
            },
          },
          expandOnClick: false,
        },
      },
      legend: {
        show: false,
      },
      tooltip: {
        enabled: true,
        theme: 'dark' as const,
        y: {
          formatter: (val: number) => `${val.toFixed(2)}%`,
        },
      },
      states: {
        hover: {
          filter: {
            type: 'lighten' as const,
            value: 0.1,
          },
        },
        active: {
          filter: {
            type: 'none' as const,
          },
        },
      },
    }),
    []
  );

  const series = useMemo(
    () => allocations.map((a) => a.weight * 100),
    []
  );

  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-2 mb-6">
        <PieChart className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">Portfolio Allocation</h2>
      </div>

      <div className="flex flex-col lg:flex-row items-center gap-8">
        {/* Donut Chart */}
        <div className="w-full lg:w-1/2 flex justify-center">
          {mounted && (
            <Chart
              options={chartOptions}
              series={series}
              type="donut"
              width="320"
              height="320"
            />
          )}
        </div>

        {/* Allocation Table */}
        <div className="w-full lg:w-1/2">
          <div className="space-y-3">
            {allocations.map((item) => (
              <div key={item.asset} className="flex items-center gap-3 group">
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-foreground truncate">{item.label}</span>
                    <span className="text-sm font-semibold text-foreground ml-2">
                      {(item.weight * 100).toFixed(2)}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 bg-border rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-1000 ease-out"
                      style={{
                        width: `${item.weight * 100}%`,
                        backgroundColor: item.color,
                        opacity: 0.7,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
