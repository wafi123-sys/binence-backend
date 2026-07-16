'use client';

import React, { useState, useEffect } from 'react';

export default function OrderBookBinance2() {
  const [version, setVersion] = useState<'v1' | 'v2'>('v1');
  const [url, setUrl] = useState('');

  useEffect(() => {
    setUrl(version === 'v1' ? `/orderbook.html?v=${Date.now()}` : `/agnoia-v2.html?v=${Date.now()}`);
  }, [version]);

  return (
    <div className="relative w-full h-full min-h-[600px] rounded-xl overflow-hidden shadow-2xl border border-[#2a2a2a] bg-[#040608]">
      
      {/* Version Switcher */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex bg-[#111c2a] rounded-lg border border-[#213245] p-1 shadow-lg backdrop-blur-md">
        <button 
          onClick={() => setVersion('v1')}
          className={`px-4 py-1.5 text-xs font-mono rounded-md transition-all ${version === 'v1' ? 'bg-[#3d9bfc] text-white font-bold' : 'text-[#6a8aaa] hover:text-white'}`}
        >
          AGNOIA V1 (Legacy)
        </button>
        <button 
          onClick={() => setVersion('v2')}
          className={`px-4 py-1.5 text-xs font-mono rounded-md transition-all ${version === 'v2' ? 'bg-[#3d9bfc] text-white font-bold' : 'text-[#6a8aaa] hover:text-white'}`}
        >
          AGNOIA V2 (Canvas)
        </button>
      </div>

      {url && (
        <iframe 
          src={url}
          className="w-full h-full border-none"
          title="AGNOIA Terminal"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        />
      )}
    </div>
  );
}
