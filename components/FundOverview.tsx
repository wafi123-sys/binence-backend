'use client';

import { Target, Globe, Cpu, TrendingUp } from 'lucide-react';

const pillars = [
  {
    icon: <Cpu className="w-5 h-5" />,
    title: 'Quantitative Edge',
    description: 'Proprietary algorithms analyze 50,000+ data points per second across global markets, identifying alpha-generating opportunities with sub-millisecond latency.',
  },
  {
    icon: <Globe className="w-5 h-5" />,
    title: 'Global Macro',
    description: 'Our macro research desk synthesizes geopolitical trends, central bank policies, and cross-asset correlations to position the portfolio for regime changes.',
  },
  {
    icon: <TrendingUp className="w-5 h-5" />,
    title: 'Multi-Strategy',
    description: 'We deploy capital across equities, digital assets, and fixed income, dynamically rebalancing based on real-time risk metrics and volatility surfaces.',
  },
  {
    icon: <Target className="w-5 h-5" />,
    title: 'Risk Management',
    description: 'Institutional-grade risk framework with real-time VaR monitoring, stress testing, and automated drawdown protection across all portfolio exposures.',
  },
];

export default function FundOverview() {
  return (
    <div id="overview" className="glass-card p-6 sm:p-8">
      <div className="max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <p className="text-xs font-medium text-primary uppercase tracking-[0.2em] mb-3">
            Investment Philosophy
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4">
            Systematic Alpha Through
            <span className="text-glow-primary text-primary"> Quantitative Intelligence</span>
          </h2>
          <div className="section-divider mb-6" />
          <p className="text-text-secondary leading-relaxed">
            Starfall Capital is an institutional multi-strategy hedge fund specializing in quantitative
            and global macro investing. Founded in 2019 by a team of former Goldman Sachs and
            Citadel quantitative researchers, we leverage advanced machine learning models,
            alternative data, and proprietary execution infrastructure to deliver uncorrelated,
            risk-adjusted returns for our limited partners.
          </p>
        </div>

        {/* Key Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Founded', value: '2019' },
            { label: 'Employees', value: '47' },
            { label: 'Strategies', value: '12+' },
            { label: 'Data Points/s', value: '50K+' },
          ].map((stat) => (
            <div key={stat.label} className="text-center p-3 rounded-xl bg-background/50 border border-border">
              <p className="text-xl font-bold text-primary">{stat.value}</p>
              <p className="text-xs text-text-secondary mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Pillars */}
        <div className="grid sm:grid-cols-2 gap-4">
          {pillars.map((pillar) => (
            <div
              key={pillar.title}
              className="p-5 rounded-xl bg-background/30 border border-border hover:border-primary/20 transition-all duration-300 group"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-lg bg-primary-dim text-primary group-hover:scale-110 transition-transform duration-300">
                  {pillar.icon}
                </div>
                <h3 className="text-sm font-semibold text-foreground">{pillar.title}</h3>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">
                {pillar.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
