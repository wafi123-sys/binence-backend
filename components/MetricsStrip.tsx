'use client';

import { useEffect, useState } from 'react';
import {
  DollarSign,
  TrendingUp,
  BarChart3,
  TrendingDown,
  Zap,
} from 'lucide-react';

interface Metric {
  label: string;
  value: string;
  change?: string;
  icon: React.ReactNode;
  color: string;
  glowClass: string;
}

const metrics: Metric[] = [
  {
    label: 'Total AUM',
    value: '$2.4B',
    change: '+12.3% QoQ',
    icon: <DollarSign className="w-5 h-5" />,
    color: 'text-primary',
    glowClass: 'bg-primary-dim',
  },
  {
    label: 'YTD Return',
    value: '+18.7%',
    change: 'vs benchmark +11.2%',
    icon: <TrendingUp className="w-5 h-5" />,
    color: 'text-success',
    glowClass: 'bg-success-dim',
  },
  {
    label: 'Sharpe Ratio',
    value: '2.14',
    change: 'Risk-adjusted',
    icon: <BarChart3 className="w-5 h-5" />,
    color: 'text-secondary',
    glowClass: 'bg-secondary-dim',
  },
  {
    label: 'Max Drawdown',
    value: '-8.3%',
    change: 'Peak to trough',
    icon: <TrendingDown className="w-5 h-5" />,
    color: 'text-danger',
    glowClass: 'bg-danger-dim',
  },
  {
    label: 'Alpha',
    value: '+4.2%',
    change: 'Above benchmark',
    icon: <Zap className="w-5 h-5" />,
    color: 'text-warning',
    glowClass: 'bg-[rgba(255,171,0,0.15)]',
  },
];

export default function MetricsStrip() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
      {metrics.map((metric, index) => (
        <div
          key={metric.label}
          className={`glass-card p-4 sm:p-5 transition-all duration-500 hover:border-border-light group ${
            isVisible ? 'animate-fade-in-up' : 'opacity-0'
          }`}
          style={{ animationDelay: `${index * 100}ms` }}
        >
          <div className="flex items-start justify-between mb-3">
            <div className={`p-2 rounded-lg ${metric.glowClass} transition-transform duration-300 group-hover:scale-110`}>
              <div className={metric.color}>{metric.icon}</div>
            </div>
          </div>
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-1">
            {metric.label}
          </p>
          <p className={`text-2xl font-bold ${metric.color} tracking-tight`}>
            {metric.value}
          </p>
          {metric.change && (
            <p className="text-xs text-text-muted mt-1">{metric.change}</p>
          )}
        </div>
      ))}
    </div>
  );
}
