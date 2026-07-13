'use client';

import React, { useState, useEffect } from 'react';

const DEFAULT_STRATEGY = `// Tulis strategi Anda di sini!
// Parameter yang tersedia:
// - bar: lilin saat ini { open, high, low, close, volume, time }
// - position: posisi Anda saat ini ('NONE', 'LONG')
// - history: array dari lilin-lilin sebelumnya
// 
// Return: 'BUY', 'SELL', atau 'HOLD'

function strategy(bar, position, history) {
  // Contoh: Simple Momentum
  if (position === 'NONE' && bar.close > bar.open) {
    return 'BUY'; // Beli jika lilin hijau
  } else if (position === 'LONG' && bar.close < bar.open) {
    return 'SELL'; // Jual jika lilin merah
  }
  return 'HOLD';
}

return strategy(bar, position, history);
`;

interface OHLCBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export default function BacktestPage() {
  const [code, setCode] = useState(DEFAULT_STRATEGY);
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [availableData, setAvailableData] = useState<{ [key: string]: number }>({});
  const [selectedTf, setSelectedTf] = useState('1s');

  useEffect(() => {
    // Cek ketersediaan data saat mount
    fetch('/api/market-data')
      .then(res => res.json())
      .then(data => {
        if (!data.error) {
          const counts: any = {};
          Object.keys(data).forEach(tf => {
            counts[tf] = data[tf].length;
          });
          setAvailableData(counts);
        }
      })
      .catch(err => console.error("Failed to fetch market data:", err));
  }, []);

  const runBacktest = async () => {
    setLoading(true);
    setError('');
    setResults(null);

    try {
      const res = await fetch('/api/market-data');
      const data = await res.json();
      
      if (data.error) throw new Error(data.error);

      const bars: OHLCBar[] = data[selectedTf] || [];
      if (bars.length === 0) throw new Error(`Tidak ada data untuk timeframe ${selectedTf}`);

      let position = 'NONE';
      let buyPrice = 0;
      let totalTrades = 0;
      let winTrades = 0;
      let lossTrades = 0;
      let realizedPnL = 0;
      let initialCapital = 10000;
      let balance = initialCapital;
      let history: OHLCBar[] = [];

      // Validasi dan kompilasi strategi
      // Kita gunakan new Function secara client-side, yang aman selama kita yang memasukkan scriptnya
      // eslint-disable-next-line no-new-func
      const strategyFunc = new Function('bar', 'position', 'history', code);

      for (const bar of bars) {
        let action = 'HOLD';
        try {
          action = strategyFunc(bar, position, history);
        } catch (e: any) {
          throw new Error(`Error pada script strategi: ${e.message}`);
        }

        if (action === 'BUY' && position === 'NONE') {
          position = 'LONG';
          buyPrice = bar.close;
        } else if (action === 'SELL' && position === 'LONG') {
          position = 'NONE';
          const pnl = (bar.close - buyPrice) / buyPrice * balance;
          balance += pnl;
          realizedPnL += pnl;
          totalTrades++;
          
          if (pnl > 0) winTrades++;
          else if (pnl < 0) lossTrades++;
        }

        history.push(bar);
        if (history.length > 100) history.shift();
      }

      setResults({
        totalTrades,
        winTrades,
        lossTrades,
        winRate: totalTrades > 0 ? ((winTrades / totalTrades) * 100).toFixed(2) : '0.00',
        realizedPnL: realizedPnL.toFixed(2),
        finalBalance: balance.toFixed(2),
        returnPct: (((balance - initialCapital) / initialCapital) * 100).toFixed(2)
      });

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080b10] text-[#e2e8f0] p-6 font-sans">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#00e5ff] tracking-wider">AI BACKTESTER ARENA</h1>
            <p className="text-sm text-[#64748b] mt-1">
              Uji strategi trading buatan Anda atau ChatGPT menggunakan data OHLC riwayat.
            </p>
          </div>
          <div className="text-xs text-[#64748b] bg-[#111827] px-4 py-2 rounded-lg border border-[#2a2a2a]">
            {Object.keys(availableData).length > 0 ? (
              <div className="flex gap-4">
                {['1s', '5s', '1m', '15m'].map(tf => (
                  <span key={tf}>
                    <strong className="text-white">{tf}</strong>: {availableData[tf] || 0} bars
                  </span>
                ))}
              </div>
            ) : (
              <span>Memuat data tersedia...</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 flex flex-col gap-4">
            <div className="bg-[#0d1117] rounded-xl border border-[#2a2a2a] p-4 flex flex-col shadow-2xl">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-semibold text-[#64748b] uppercase tracking-widest">Strategy Script (JavaScript)</h3>
                <select 
                  className="bg-[#111827] text-white text-xs border border-[#2a2a2a] rounded px-2 py-1"
                  value={selectedTf}
                  onChange={(e) => setSelectedTf(e.target.value)}
                >
                  <option value="tick">Tick</option>
                  <option value="1s">1s</option>
                  <option value="5s">5s</option>
                  <option value="15s">15s</option>
                  <option value="1m">1m</option>
                  <option value="15m">15m</option>
                </select>
              </div>
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full h-[400px] bg-[#111827] text-[#00e676] font-mono text-sm p-4 rounded-lg border border-[#2a2a2a] focus:outline-none focus:border-[#00e5ff] transition-colors"
                spellCheck={false}
              />
            </div>
            <button
              onClick={runBacktest}
              disabled={loading}
              className="w-full py-3 bg-[#00e5ff]/10 text-[#00e5ff] font-bold tracking-widest rounded-xl border border-[#00e5ff]/30 hover:bg-[#00e5ff]/20 hover:border-[#00e5ff] transition-all disabled:opacity-50"
            >
              {loading ? 'MENJALANKAN BACKTEST...' : 'RUN BACKTEST'}
            </button>
          </div>

          <div className="col-span-1">
            <div className="bg-[#0d1117] rounded-xl border border-[#2a2a2a] p-6 h-full flex flex-col">
              <h3 className="text-sm font-semibold text-[#64748b] uppercase tracking-widest mb-6">Hasil Backtest</h3>
              
              {error && (
                <div className="bg-[#ff1744]/10 border border-[#ff1744]/30 text-[#ff1744] p-3 rounded-lg text-xs mb-4">
                  {error}
                </div>
              )}

              {results ? (
                <div className="flex flex-col gap-4">
                  <StatRow label="Initial Capital" value="$10,000.00" />
                  <StatRow 
                    label="Final Balance" 
                    value={`$${results.finalBalance}`} 
                    color={Number(results.realizedPnL) >= 0 ? 'text-[#00e676]' : 'text-[#ff1744]'} 
                  />
                  <div className="h-[1px] bg-[#2a2a2a] my-2" />
                  <StatRow 
                    label="Total Return" 
                    value={`${results.returnPct}%`} 
                    color={Number(results.returnPct) >= 0 ? 'text-[#00e676]' : 'text-[#ff1744]'} 
                  />
                  <StatRow 
                    label="Realized PnL" 
                    value={`$${results.realizedPnL}`} 
                    color={Number(results.realizedPnL) >= 0 ? 'text-[#00e676]' : 'text-[#ff1744]'} 
                  />
                  <div className="h-[1px] bg-[#2a2a2a] my-2" />
                  <StatRow label="Total Trades" value={results.totalTrades} />
                  <StatRow label="Win Trades" value={results.winTrades} color="text-[#00e676]" />
                  <StatRow label="Loss Trades" value={results.lossTrades} color="text-[#ff1744]" />
                  <StatRow label="Win Rate" value={`${results.winRate}%`} />
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-[#64748b] text-xs text-center px-4">
                  Tekan "RUN BACKTEST" untuk melihat simulasi hasil performa strategi Anda berdasarkan histori data yang tersedia.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value, color = 'text-white' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-[#64748b]">{label}</span>
      <span className={`text-sm font-mono font-bold ${color}`}>{value}</span>
    </div>
  );
}
