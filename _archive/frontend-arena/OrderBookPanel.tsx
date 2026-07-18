// ============================================================
// Order Book Panel — Full DOM Match
// ============================================================

'use client';

import React, { useMemo } from 'react';
import { useMarket } from '../../hooks/useMarket';
import { OrderSide, OrderType } from '../../engine/types';

interface OrderBookPanelProps {
  onPriceClick: (price: number, side: OrderSide) => void;
  onPriceDoubleClick?: (price: number, side: OrderSide) => void;
  oneClickTrading?: boolean;
  clickLot: number;
}

export default function OrderBookPanel({
  onPriceClick,
  clickLot,
}: OrderBookPanelProps) {
  const { asks, bids, lastPrice, submitOrder } = useMarket();

  // Render 35 levels above and below the last price to ensure the DOM fills the entire vertical screen space
  const displayLevels = 35;
  const maxAskPrice = asks.length > 0 ? asks[asks.length - 1].price : (lastPrice > 0 ? lastPrice + 10 : 310);
  const minBidPrice = bids.length > 0 ? bids[bids.length - 1].price : (lastPrice > 0 ? lastPrice - 10 : 290);
  const topPrice = Math.max(maxAskPrice, lastPrice > 0 ? lastPrice + displayLevels : 300 + displayLevels);
  const bottomPrice = Math.min(minBidPrice, lastPrice > 0 ? Math.max(1, lastPrice - displayLevels) : Math.max(1, 300 - displayLevels));

  const { domRows, maxCumAsk, maxCumBid } = useMemo(() => {
    let accAsk = 0;
    const askCum = new Map<number, number>();
    for (const a of asks) {
      accAsk += a.totalLot;
      askCum.set(a.price, accAsk);
    }

    let accBid = 0;
    const bidCum = new Map<number, number>();
    for (const b of bids) {
      accBid += b.totalLot;
      bidCum.set(b.price, accBid);
    }

    const rows = [];
    for (let p = topPrice; p >= bottomPrice; p--) {
      const ask = asks.find(a => a.price === p);
      const bid = bids.find(b => b.price === p);
      rows.push({
        price: p,
        ask,
        bid,
        cumAsk: ask ? askCum.get(p) || 0 : 0,
        cumBid: bid ? bidCum.get(p) || 0 : 0,
      });
    }
    return { domRows: rows, maxCumAsk: accAsk, maxCumBid: accBid };
  }, [asks, bids, topPrice, bottomPrice]);

  const handlePlusClick = (price: number, side: OrderSide) => {
    // One click instant order using lot from QuickOrderPanel
    submitOrder(side, OrderType.LIMIT, price, clickLot);
  };

  // 11 cols total: expand to fit 480px width
  const gridTemplate = "35px 30px 45px 25px 1fr 65px 1fr 25px 45px 30px 35px";

  return (
    <div className="flex flex-col flex-1 border-b border-[#2a2a2a] bg-[#121212] overflow-hidden select-none">
      {/* Header */}
      <div 
        className="grid items-center px-1 py-1.5 border-b border-[#2a2a2a] text-[10px] font-bold text-slate-300 text-right shrink-0 bg-[#1a1a1a]"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className="text-center">Trade</div>
        <div className="text-center">Buy</div>
        <div className="text-center text-[#7e85cc]">Freq</div>
        <div className="text-center">+/-</div>
        <div className="text-center">Lot</div>
        <div className="text-center">Price</div>
        <div className="text-center">Lot</div>
        <div className="text-center">+/-</div>
        <div className="text-center text-[#7e85cc]">Freq</div>
        <div className="text-center">Sell</div>
        <div className="text-center">Done</div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto relative" style={{ backgroundColor: '#121212' }}>
        {domRows.map((row) => {
          const isLastPrice = row.price === lastPrice;
          const pColor = row.price > 300 ? 'text-[#00e676]' : (row.price < 300 ? 'text-[#ff1744]' : 'text-slate-300');

          return (
            <div 
              key={row.price} 
              className={`relative grid items-center h-[22px] text-[11px] font-mono border-b border-[#2a2a2a] cursor-default hover:bg-white/5 ${isLastPrice ? 'bg-[#2a1b38] border-[#9c27b0]' : ''}`}
              style={{ gridTemplateColumns: gridTemplate }}
              onClick={() => onPriceClick(row.price, OrderSide.BUY)}
            >
              {/* Depth Bars */}
              {row.cumBid > 0 && maxCumBid > 0 && (
                <div 
                  className="absolute top-0 bottom-0 bg-[#00e676]/10 pointer-events-none transition-all duration-200" 
                  style={{ 
                    right: 'calc(50% + 32.5px)', 
                    width: `calc(${(row.cumBid / maxCumBid)} * (50% - 32.5px))` 
                  }} 
                />
              )}
              {row.cumAsk > 0 && maxCumAsk > 0 && (
                <div 
                  className="absolute top-0 bottom-0 bg-[#ff1744]/10 pointer-events-none transition-all duration-200" 
                  style={{ 
                    left: 'calc(50% + 32.5px)', 
                    width: `calc(${(row.cumAsk / maxCumAsk)} * (50% - 32.5px))` 
                  }} 
                />
              )}

              {/* Trade */}
              <div className="relative z-10"></div>

              {/* Buy Plus Button */}
              <div 
                className="relative z-10 flex items-center justify-center cursor-pointer group h-full w-full"
                onClick={(e) => { e.stopPropagation(); handlePlusClick(row.price, OrderSide.BUY); }}
              >
                 <span className="flex items-center justify-center w-[13px] h-[13px] rounded-full border border-[#00e676] text-[#00e676] text-[11px] font-sans group-hover:bg-[#00e676] group-hover:text-black leading-none pb-[1px]">+</span>
              </div>

              {/* Bids Freq & Lot */}
              <div className="relative z-10 text-right px-1 text-[#7e85cc]">{row.bid?.frequency || ''}</div>
              <div className="relative z-10 text-center"></div>
              <div className="relative z-10 text-right pr-2 text-white">{row.bid ? row.bid.totalLot.toLocaleString('id-ID') : ''}</div>
              
              {/* Price Center */}
              <div 
                className={`relative z-10 text-center font-bold text-[12px] ${pColor} ${isLastPrice ? 'border border-[#9c27b0] rounded-[3px] !text-[#d8b4e2]' : ''}`}
              >
                 {row.price.toLocaleString('id-ID')}
              </div>
              
              {/* Asks Lot & Freq */}
              <div className="relative z-10 text-left pl-2 text-white">{row.ask ? row.ask.totalLot.toLocaleString('id-ID') : ''}</div>
              <div className="relative z-10 text-center"></div>
              <div className="relative z-10 text-left px-1 text-[#7e85cc]">{row.ask?.frequency || ''}</div>

              {/* Sell Plus Button */}
              <div 
                className="relative z-10 flex items-center justify-center cursor-pointer group h-full w-full"
                onClick={(e) => { e.stopPropagation(); handlePlusClick(row.price, OrderSide.SELL); }}
              >
                 <span className="flex items-center justify-center w-[13px] h-[13px] rounded-full border border-[#ff1744] text-[#ff1744] text-[11px] font-sans group-hover:bg-[#ff1744] group-hover:text-white leading-none pb-[1px]">+</span>
              </div>

              {/* Done */}
              <div className="relative z-10"></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
