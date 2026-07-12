import React from 'react';

export default function BinanceOrderBookPage() {
  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <iframe 
        src={`/orderbook.html?v=${Date.now()}`}
        style={{ width: '100%', height: '100%', border: 'none' }}
        title="Binance Live Order Book"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      />
    </div>
  );
}
