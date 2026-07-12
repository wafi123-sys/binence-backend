'use client';

import React, { useState, useEffect } from 'react';

export default function OrderBookBinance2() {
  const [url, setUrl] = useState('/orderbook.html');

  useEffect(() => {
    setUrl(`/orderbook.html?v=${Date.now()}`);
  }, []);

  return (
    <div className="w-full h-full min-h-[600px] rounded-xl overflow-hidden shadow-2xl border border-[#2a2a2a]">
      <iframe 
        src={url}
        className="w-full h-full border-none"
        title="Binance Live Order Book"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      />
    </div>
  );
}
