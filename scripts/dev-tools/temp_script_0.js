


  console.log("HELLO FROM ANTIGRAVITY!");
  document.body.style.border = "10px solid green";


  window.onerror = function(msg, url, line, col, err) {
    const d = document.createElement('div');
    d.style.position = 'fixed';
    d.style.top = '10px';
    d.style.left = '10px';
    d.style.zIndex = '999999';
    d.style.background = 'red';
    d.style.color = 'white';
    d.style.padding = '20px';
    d.style.fontSize = '24px';
    d.style.border = '5px solid black';
    d.innerHTML = "<b>CRASH DETECTED:</b><br/>" + msg + "<br/>Line: " + line;
    document.body.appendChild(d);
  };
  window.onunhandledrejection = function(e) {
    const d = document.createElement('div');
    d.style.position = 'fixed';
    d.style.top = '100px';
    d.style.left = '10px';
    d.style.zIndex = '999999';
    d.style.background = 'orange';
    d.style.color = 'black';
    d.style.padding = '20px';
    d.style.fontSize = '24px';
    d.style.border = '5px solid black';
    d.innerHTML = "<b>UNHANDLED PROMISE:</b><br/>" + (e.reason ? e.reason.message : 'Unknown error');
    document.body.appendChild(d);
  };


// ==============================================
// STATE
// ==============================================
let currentSymbol = 'btcusdt';
let wsDepth = null, wsTrades = null, wsMiniAll = null;
let orderBook = { asks: [], bids: [] };
let trades = [];
let prevPrice = null;
let allCoins = {};   // symbol -> { symbol, price, change, vol, high, low }
let activeTab = 'all';

// --- Proxy Helpers for ISP Block Bypass ---
function getWsProxy(path) {
  const host = window.location.hostname;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Use cloudflare tunnel if on vercel, otherwise local port 3001
  const baseUrl = host.includes('vercel.app') 
    ? 'wss://essentially-receive-place-ebony.trycloudflare.com'
    : `${proto}//${host}:3001`;
  return baseUrl + '/binance-proxy' + path;
}
function getRestProxy(path) {
  return '/api/binance-rest' + path;
}

// --- Configurable settings ---
let DEPTH = 20;              // Order book levels (5, 10, 20)
let OB_SIDE = 'both';        // 'both' | 'bids' | 'asks'
let CHART_LEVELS = 20;       // Depth chart levels
let DEPTH_ZOOM = 100;        // Depth chart zoom % (trim extremes)
let BIG_COUNT = 10;          // Large orders count
let BIG_SIDE = 'all';        // 'all' | 'bid' | 'ask'
let TRADES_COUNT = 50;       // Trades to display
let TRADES_SIDE = 'all';     // 'all' | 'buy' | 'sell'
const MAX_TRADES = 1000;      // Max buffer

let currentKlinesInterval = '15m'; // Heatmap Timeframe
let currentHeatmapFilter = 0;      // Heatmap Filter (0-100)

// --- Order Book State ---
let orderBookMap = { asks: new Map(), bids: new Map() };
let obLastUpdateId = 0;
let isObSyncing = false;

// --- Trade Flow by Price ---
let globalTradeFlows = {};   // { symbol -> { flow: {}, start: timestamp } }
let tradeFlow = {};          // key: bucketedPrice -> {buy, sell, count}
let FLOW_BUCKET = 1;         // price bucket size
let FLOW_LEVELS = 15;        // rows to display
let FLOW_START = Date.now(); // timer start
let flowTimerInterval = null;

// --- Aggregation Filter ---
let AGG_LEVEL = 10;          // 1 (Ultra Macro) to 10 (Micro)
let BIG_AGG_LEVEL = 10;
let TRADES_AGG_LEVEL = 10;
let currentTickSizes = [];   // Array of 10 tick sizes for current coin

// --- Smart Money Tracker ---
let timelineEvents = [];
const MAX_EVENTS = 30;
let absVolBuy = 0, absVolSell = 0;
let absStartP = 0;
let activeWalls = new Map(); // price -> { qty, side, firstSeen }
const WALL_THRESHOLD_USD = 250000; // $250k USD for a wall
let use100ms = true; // For depth stream fallback

// --- Advanced AI Data Connections ---
let wsFutures = null;
let futuresCVD = 0;
let spotCVD = 0;
let futuresVol = 0;
let spotVol = 0;
let oiData = { oi: 0, oiHistory: [] };
let fundingRate = 0;
let smartMoneyScore = 0;
let oiPoller = null;
let flaggedWatchlist = false;
let scoreCalcInterval = null;

// ==============================================
// FORMATTERS
// ==============================================
function fmtP(p) {
  const n = +p; if (isNaN(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(5);
  return n.toFixed(8);
}
function fmtQ(q) {
  const n = +q; if (isNaN(n)) return '—';
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(2)+'K';
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
function fmtVol(v) {
  const n = +v;
  if (n >= 1e9) return (n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(2)+'K';
  return n.toFixed(0);
}
function fmtTime(ts) { return new Date(ts).toTimeString().slice(0,8); }
function sym2label(s) { return s.replace('usdt','').toUpperCase()+'/USDT'; }

// ==============================================
// CONNECTION STATUS
// ==============================================
function setConn(s) {
  document.getElementById('connDot').className = 'conn-dot '+s;
  document.getElementById('connText').textContent = s==='connected'?'Live':s==='error'?'Reconnecting…':'Connecting…';
}

function safeClose(ws) { try { ws && ws.close(); } catch(e){} return null; }

// ==============================================
// FETCH ALL COINS (REST API - free, no key)
// ==============================================
async function fetchAllTickers() {
  try {
    const res = await fetch(getRestProxy('/api/v3/ticker/24hr'));
    const data = await res.json();
    // Filter USDT pairs only, exclude leveraged tokens
    const leveraged = /^(UP|DOWN|BULL|BEAR)\d*/;
    data.forEach(t => {
      if (!t.symbol.endsWith('USDT')) return;
      const base = t.symbol.replace('USDT','');
      if (leveraged.test(base)) return;
      allCoins[t.symbol.toLowerCase()] = {
        symbol: t.symbol.toLowerCase(),
        display: sym2label(t.symbol.toLowerCase()),
        price: +t.lastPrice,
        change: +t.priceChangePercent,
        vol: +t.quoteVolume,   // in USDT
        high: +t.highPrice,
        low: +t.lowPrice,
      };
    });
    renderAllList();
    renderMovers();
    renderLosers();
    connectMiniAll();
  } catch(e) {
    console.error('Failed to fetch tickers', e);
  }
}

// ==============================================
// MINI TICKER STREAM (all market, real-time)
// ==============================================
function connectMiniAll() {
  wsMiniAll = safeClose(wsMiniAll);
  wsMiniAll = new WebSocket(getWsProxy('/ws/!miniTicker@arr'));

  wsMiniAll.onmessage = (e) => {
    const arr = JSON.parse(e.data);
    arr.forEach(t => {
      const sym = t.s.toLowerCase();
      if (!allCoins[sym]) return;
      allCoins[sym].price = +t.c;
      allCoins[sym].change = ((+t.c - +t.o) / +t.o * 100);
      allCoins[sym].vol = +t.q;
      allCoins[sym].high = +t.h;
      allCoins[sym].low = +t.l;
    });
    // Throttle rendering: every 2s
    scheduleRender();

    // Update active pill if relevant
    const cs = currentSymbol;
    if (allCoins[cs]) updatePill(allCoins[cs]);
  };

  wsMiniAll.onclose = () => setTimeout(connectMiniAll, 5000);
}

let renderTimer = null;
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderAllList();
    renderMovers();
    renderLosers();
    const q = document.getElementById('globalSearch').value.trim();
    if (q.length >= 1) renderSearch(q);
    // Update stats
    const t = allCoins[currentSymbol];
    if (t) {



    }
  }, 2000);
}

// ==============================================
// RENDER COIN LIST
// ==============================================
function coinRowHTML(coin, query) {
  const up = coin.change > 0, dn = coin.change < 0;
  const cls = up ? 'up' : dn ? 'down' : 'flat';
  const chgStr = (up?'+':'')+coin.change.toFixed(2)+'%';
  const baseName = coin.display.split('/')[0];
  const displayName = query ? highlight(baseName, query) : baseName;
  return `<div class="coin-row${coin.symbol===currentSymbol?' active':''}" data-sym="${coin.symbol}">
    <div>
      <div class="coin-name">${displayName}</div>
      <div class="coin-vol">${fmtVol(coin.vol)} USDT</div>
    </div>
    <span class="coin-price ${cls}">${fmtP(coin.price)}</span>
    <span class="coin-chg ${cls}">${chgStr}</span>
  </div>`;
}

function highlight(text, query) {
  if (!query) return text;
  const re = new RegExp('('+query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')', 'gi');
  return text.replace(re, '<mark>$1</mark>');
}

function getSortedCoins() {
  return Object.values(allCoins).sort((a,b) => b.vol - a.vol);
}

function renderAllList() {
  const coins = getSortedCoins();
  const el = document.getElementById('allList');
  if (!coins.length) { el.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading all pairs…</span></div>'; return; }
  el.innerHTML = coins.map(c => coinRowHTML(c, '')).join('');
  attachRowClicks(el);
}

function renderMovers() {
  const top = getSortedCoins().filter(c => c.vol > 50000).sort((a,b) => b.change - a.change).slice(0, 30);
  const el = document.getElementById('moversList');
  el.innerHTML = top.map(c => coinRowHTML(c, '')).join('') || '<div class="no-result">No data</div>';
  attachRowClicks(el);
}

function renderLosers() {
  const top = getSortedCoins().filter(c => c.vol > 50000).sort((a,b) => a.change - b.change).slice(0, 30);
  const el = document.getElementById('losersList');
  el.innerHTML = top.map(c => coinRowHTML(c, '')).join('') || '<div class="no-result">No data</div>';
  attachRowClicks(el);
}

function renderSearch(q) {
  const upper = q.toUpperCase();
  const coins = getSortedCoins().filter(c =>
    c.display.includes(upper) || c.symbol.replace('usdt','').toUpperCase().startsWith(upper)
  );
  const el = document.getElementById('searchList');
  document.getElementById('searchCount').textContent = `(${coins.length})`;
  if (!coins.length) { el.innerHTML = '<div class="no-result">No coins found for "'+q+'"</div>'; return; }
  el.innerHTML = coins.slice(0, 100).map(c => coinRowHTML(c, upper)).join('');
  attachRowClicks(el);
}

function attachRowClicks(container) {
  container.querySelectorAll('.coin-row').forEach(row => {
    row.addEventListener('click', () => {
      switchSymbol(row.dataset.sym);
    });
  });
}

// ==============================================
// ACTIVE SYMBOL PILL
// ==============================================
function updatePill(coin) {
  const up = coin.change >= 0;
  document.getElementById('pillName').textContent = coin.display;
  const pEl = document.getElementById('pillPrice');
  pEl.textContent = fmtP(coin.price);
  pEl.className = 'active-symbol-price ' + (up ? 'up' : 'down');
  const cEl = document.getElementById('pillChg');
  cEl.textContent = (up?'+':'')+coin.change.toFixed(2)+'%';
  cEl.className = 'active-symbol-chg ' + (up ? 'up' : 'down');
}

// ==============================================
// SWITCH SYMBOL
// ==============================================
function switchSymbol(sym) {
  if (sym === currentSymbol) return;
  // Save current coin's SM state before switching
  if (currentSymbol) saveSmState(currentSymbol);
  
  currentSymbol = sym;

  // Reset
  orderBook = { asks: [], bids: [] };
  orderBookMap = { asks: new Map(), bids: new Map() };
  obLastUpdateId = 0;
  isObSyncing = false;
  trades = [];
  prevPrice = null;
  currentTickSizes = [];
  AGG_LEVEL = 10;
  BIG_AGG_LEVEL = 10;
  TRADES_AGG_LEVEL = 10;
  
  
  
  
  
  
  use100ms = true; // reset fallback on new coin
    heatmapHistory = [];
    heatmapBubbles = [];
    lastHmSnapshot = 0;
    hmTooltipData = null;

  
  
  
  

  
  
  
  
  
  
  
  
  

  // Clear depth canvas
  const c = document.getElementById('depthChart');
  c.getContext('2d').clearRect(0, 0, c.width, c.height);

  // Clear lwcSeries so it doesn't show old coin's data
  if (lwcSeries) {
    lwcSeries.setData([]);
    lastCandle = null;
  }

  // Update pill
  if (allCoins[sym]) updatePill(allCoins[sym]);

  // Highlight active in all lists
  document.querySelectorAll('.coin-row').forEach(r => {
    r.classList.toggle('active', r.dataset.sym === sym);
  });

  setConn('');
  resetTradeFlow();

  // Auto-set bucket size & tick sizes based on new symbol price
  const coinData = allCoins[sym];
  if (coinData && coinData.price > 0) {
    const suggested = autoFlowBucket(coinData.price);
    FLOW_BUCKET = suggested;
    console.log(`Auto set flow bucket for ${sym} to ${suggested}`);
    document.querySelectorAll('#flowBucketCtrl .ctrl-btn').forEach(b => {
      b.classList.toggle('active', +b.dataset.fb === suggested);
    });
    currentTickSizes = getTickIntervals(coinData.price);
  }
  
  timelineEvents = [];
  absVolBuy = 0; absVolSell = 0; absStartP = 0;
  activeWalls.clear();
  
  spotCVD = 0;
  futuresCVD = 0;
  spotVol = 0;
  futuresVol = 0;
  oiData = { oi: 0, oiHistory: [] };
  fundingRate = 0;
  smartMoneyScore = 0;
  flaggedWatchlist = false;

  // Load saved SM state for new coin (or fresh if first visit)
  loadSmState(sym);

  connectTradesWS(sym);
  connectDepth(sym);
  connectFuturesWS(sym);
  startOIPoller(sym);
  
  if (scoreCalcInterval) clearInterval(scoreCalcInterval);
  scoreCalcInterval = setInterval(calculateSmartMoneyScore, 5000);
  
  // Fetch new klines if in heatmap view
  if (currentView === 'heatmap') {
    fetchKlines();
  }
}

// ==============================================
// ORDER BOOK WEBSOCKET (Sync & Diff)
// ==============================================
function connectDepth(sym) {
  const symLower = sym.toLowerCase();
  wsDepth = safeClose(wsDepth);
  
  
  // Show syncing state
  

  isObSyncing = true;
  orderBookMap = { asks: new Map(), bids: new Map() };
  
  // Fetch snapshot for deep order book
  fetch(getRestProxy(`/api/v3/depth?symbol=${sym.toUpperCase()}&limit=1000`))
    .then(async r => {
      if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
      return r.json();
    })
    .then(data => {
      if (sym !== currentSymbol) return; // Ignore if switched
      obLastUpdateId = data.lastUpdateId;
      data.asks.forEach(([p,q]) => orderBookMap.asks.set(+p, +q));
      data.bids.forEach(([p,q]) => orderBookMap.bids.set(+p, +q));
      isObSyncing = false;
      
      processOrderBook();
    })
    .catch(e => {
      console.error('Failed to fetch depth snapshot', e);
      setConn('error');
      setTimeout(() => { if (currentSymbol===sym) connectDepth(sym); }, 3000);
    });

  // Connect to live diff stream (1000ms is universally stable)
  let connTimeout = setTimeout(() => {
    if (document.getElementById('connText').textContent === 'Connecting…') {
      document.getElementById('connText').textContent = 'Blocked by ISP (Gunakan VPN)';
      document.getElementById('connDot').className = 'conn-dot error';
    }
  }, 5000);
  wsDepth = new WebSocket(getWsProxy(`/ws/${symLower}@depth`));
  wsDepth.onopen = () => {
    clearTimeout(connTimeout);
    setConn('connected');
  };
  wsDepth.onerror = () => setConn('error');
  wsDepth.onclose = () => {
    setConn('error');
    setTimeout(() => { if (currentSymbol===sym) connectDepth(sym); }, 3000);
  };
  wsDepth.onmessage = (e) => {
    const d = JSON.parse(e.data);
    
    // Ignore events older than snapshot or invalid
    if (isObSyncing || d.u <= obLastUpdateId || !d.a || !d.b) return;
    
    // Apply updates
    d.a.forEach(([p,q]) => { if (+q===0) orderBookMap.asks.delete(+p); else orderBookMap.asks.set(+p, +q); });
    d.b.forEach(([p,q]) => { if (+q===0) orderBookMap.bids.delete(+p); else orderBookMap.bids.set(+p, +q); });
    
    processOrderBook();
  };
}

function getTickIntervals(price) {
  // Returns exactly 10 intervals matching user requested logic for BTC:
  // e.g. for ~60,000 -> 1000, 100, 50, 25, 10, 5, 2, 1, 0.5, 0.1
  const mag = Math.pow(10, Math.floor(Math.log10(price)));
  return [
    mag * 0.1,    // Lvl 1
    mag * 0.01,   // Lvl 2
    mag * 0.005,  // Lvl 3
    mag * 0.0025, // Lvl 4
    mag * 0.001,  // Lvl 5
    mag * 0.0005, // Lvl 6
    mag * 0.0002, // Lvl 7
    mag * 0.0001, // Lvl 8
    mag * 0.00005,// Lvl 9
    mag * 0.00001 // Lvl 10 (Micro)
  ];
}

function groupOrderBook(map, isAsks, tickSize) {
  const grouped = new Map();
  for (const [p, q] of map.entries()) {
    let rounded = isAsks 
      ? Math.ceil(p / tickSize) * tickSize 
      : Math.floor(p / tickSize) * tickSize;
    rounded = +rounded.toFixed(8); // fix JS float precision
    grouped.set(rounded, (grouped.get(rounded) || 0) + q);
  }
  return grouped;
}

let lastProcessTime = 0;
let processTimer = null;

function processOrderBook() {
  const now = Date.now();
  if (now - lastProcessTime < 300) {
    if (!processTimer) {
      processTimer = setTimeout(() => {
        processTimer = null;
        processOrderBook();
      }, 300 - (now - lastProcessTime));
    }
    return;
  }
  lastProcessTime = now;

  // --- SMART MONEY WALL TRACKER ---
  if (latestTradeP > 0) {
    const currentWalls = new Map();
    for (const [p, q] of orderBookMap.asks.entries()) {
      if (p * q > WALL_THRESHOLD_USD) currentWalls.set(p, { qty: q, side: 'ask', time: now });
    }
    for (const [p, q] of orderBookMap.bids.entries()) {
      if (p * q > WALL_THRESHOLD_USD) currentWalls.set(p, { qty: q, side: 'bid', time: now });
    }

    for (const [p, oldWall] of activeWalls.entries()) {
      if (!currentWalls.has(p)) {
        const livedFor = now - oldWall.firstSeen;
        const isSwept = Math.abs(latestTradeP - p) / p < 0.002; // within 0.2% of trade
        
        if (isSwept) {
          // ASK wall swept = bearish (price broke below ask wall = sellers won)
          // BID wall swept = bullish (price broke above bid wall = buyers won)
          const side = oldWall.side; // 'ask' or 'bid'
          classifyAndPush(side === 'bid' ? 'SWEEP_BID' : 'SWEEP_ASK', {
            desc: `${side.toUpperCase()} wall at ${fmtP(p)} swept`,
            usdtVal: p * oldWall.qty,
            side
          });
        } else {
          let migratedTo = null;
          for (const [np, newWall] of currentWalls.entries()) {
            if (!activeWalls.has(np) && newWall.side === oldWall.side) {
              if (Math.abs(np - p) / p < 0.02) { migratedTo = np; break; }
            }
          }
          if (migratedTo) {
            classifyAndPush('MIGRATION', {
              desc: `Wall moved ${fmtP(p)} ➔ ${fmtP(migratedTo)}`,
              usdtVal: p * oldWall.qty,
              side: oldWall.side
            });
          } else if (livedFor < 15000) {
            classifyAndPush('SPOOF', {
              desc: `Fake wall at ${fmtP(p)} vanished`,
              usdtVal: p * oldWall.qty,
              side: oldWall.side
            });
          }
        }
      }
    }
    for (const [p, w] of currentWalls.entries()) {
      if (!activeWalls.has(p)) activeWalls.set(p, { qty: w.qty, side: w.side, firstSeen: now });
      else activeWalls.get(p).qty = w.qty;
    }
    for (const p of activeWalls.keys()) {
      if (!currentWalls.has(p)) activeWalls.delete(p);
    }
  }
  // --------------------------------

  let asksMap = orderBookMap.asks;
  let bidsMap = orderBookMap.bids;
  
  // Auto-init tick sizes if empty (on first page load)
  if (currentTickSizes.length === 0 && (prevPrice || latestTradeP)) {
    currentTickSizes = getTickIntervals(prevPrice || latestTradeP);
  }
  
  if (AGG_LEVEL < 10 && currentTickSizes.length > 0) {
    const tickSize = currentTickSizes[AGG_LEVEL - 1];
    asksMap = groupOrderBook(asksMap, true, tickSize);
    bidsMap = groupOrderBook(bidsMap, false, tickSize);
  }

  const maxNeeded = Math.max(DEPTH, CHART_LEVELS, BIG_COUNT);
  
  orderBook.asks = Array.from(asksMap.entries())
    .map(([price,qty])=>({price,qty}))
    .sort((a,b)=>a.price-b.price).slice(0, maxNeeded);
    
  orderBook.bids = Array.from(bidsMap.entries())
    .map(([price,qty])=>({price,qty}))
    .sort((a,b)=>b.price-a.price).slice(0, maxNeeded);
    
  renderOB(); 
  renderBigOrders(); 
  renderDepthChart();
  renderLiquidityProfile();
}

// ==============================================
// TRADES WEBSOCKET
// ==============================================
let lastTradesRender = 0;
let tradesRenderTimer = null;
let latestTradeP = 0;
let latestTradeIsBuy = false;

function processTrades() {
  const now = Date.now();
  if (now - lastTradesRender < 300) {
    if (!tradesRenderTimer) {
      tradesRenderTimer = setTimeout(() => {
        tradesRenderTimer = null;
        processTrades();
      }, 300 - (now - lastTradesRender));
    }
    return;
  }
  lastTradesRender = now;
  
  if (latestTradeP > 0) updateHeroPrice(latestTradeP, latestTradeIsBuy);
  renderTrades();
  renderTradeFlow();
  renderTimeline();
}

function connectTradesWS(sym) {
  const symLower = sym.toLowerCase();
  wsTrades = safeClose(wsTrades);
  wsTrades = new WebSocket(getWsProxy(`/ws/${symLower}@trade`));
  wsTrades.onerror = () => { /* quiet fail */ };
  wsTrades.onclose = () => {
    setTimeout(() => { if (currentSymbol===sym) connectTradesWS(sym); }, 3000);
  };
  wsTrades.onmessage = (e) => {
    const d = JSON.parse(e.data);
    const price = +d.p, qty = +d.q, isBuy = !d.m;
    trades.unshift({ price, qty, isBuy, time: d.T });
    if (trades.length > MAX_TRADES) trades.pop();
    
    latestTradeP = price;
    latestTradeIsBuy = isBuy;
    if (absStartP === 0) absStartP = price;
    
    if (lwcSeries && lastCandle) {
      lastCandle.close = price;
      if (price > lastCandle.high) lastCandle.high = price;
      if (price < lastCandle.low) lastCandle.low = price;
      lwcSeries.update(lastCandle);
    }

    const usdtValue = price * qty;
    
    spotVol += usdtValue;
    if (isBuy) spotCVD += usdtValue;
    else       spotCVD -= usdtValue;

    // Whale Radar — feed directly into Intelligence Engine
    if (usdtValue > 100000) {
      classifyAndPush(isBuy ? 'WHALE_BUY' : 'WHALE_SELL', {
        desc: `${fmtQ(qty)} @ ${fmtP(price)}`,
        usdtVal: usdtValue
      });
    }

    // Absorption Tracking
    if (isBuy) absVolBuy += usdtValue; else absVolSell += usdtValue;

    // Accumulate into trade flow
    const bucket = Math.round(price / FLOW_BUCKET) * FLOW_BUCKET;
    if (!tradeFlow[bucket]) tradeFlow[bucket] = { buy: 0, sell: 0, countBuy: 0, countSell: 0 };
    if (isBuy) {
      tradeFlow[bucket].buy += qty;
      tradeFlow[bucket].countBuy += 1;
    } else {
      tradeFlow[bucket].sell += qty;
      tradeFlow[bucket].countSell += 1;
    }
    
    processTrades();
  };
}

function connectFuturesWS(sym) {
  const symLower = sym.toLowerCase();
  wsFutures = safeClose(wsFutures);
  wsFutures = new WebSocket(getWsProxy(`/fstream/ws/${symLower}@aggTrade/${symLower}@markPrice/${symLower}@forceOrder`));
  wsFutures.onerror = () => { /* quiet fail */ };
  wsFutures.onclose = () => {
    setTimeout(() => { if (currentSymbol===sym) connectFuturesWS(sym); }, 3000);
  };
  wsFutures.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.e === 'aggTrade') {
      const qty = +d.q;
      const price = +d.p;
      const isBuy = !d.m; // m=true means maker=buy, so market sell
      const usdt = qty * price;
      futuresVol += usdt;
      if (isBuy) futuresCVD += usdt;
      else       futuresCVD -= usdt;
    } else if (d.e === 'markPriceUpdate') {
      fundingRate = +d.r; // Funding rate
    } else if (d.e === 'forceOrder') {
      const o = d.o;
      const price = +o.p;
      const side = o.S; // "SELL" (Long liquidation) or "BUY" (Short liquidation)
      const qty = +o.q;
      spawnLiquidationBubble(price, side, qty);
    }
  };
}

function startOIPoller(sym) {
  if (oiPoller) clearInterval(oiPoller);
  
  const fetchOI = async () => {
    try {
      const res = await fetch(`/api/binance-fapi/fapi/v1/openInterest?symbol=${sym.toUpperCase()}`);
      if (!res.ok) return;
      const data = await res.json();
      const oi = +data.openInterest;
      oiData.oi = oi;
      oiData.oiHistory.push({ ts: Date.now(), oi });
      if (oiData.oiHistory.length > 360) oiData.oiHistory.shift(); // keep 1 hour (10s intervals)
    } catch (e) {
      console.error('Failed to fetch OI', e);
    }
  };
  
  fetchOI();
  oiPoller = setInterval(fetchOI, 10000); // 10 seconds to avoid strict rate limits
}

// ==============================================
// HERO / PRICE UPDATE
// ==============================================
function updateHeroPrice(price, isBuy) {
  const dir = prevPrice===null ? 'up' : price>=prevPrice ? 'up' : 'down';
  const pEl = document.getElementById('pillPrice');
  pEl.textContent = fmtP(price);
  pEl.className = 'active-symbol-price ' + dir;
  pEl.classList.remove('flash-g','flash-r'); void pEl.offsetWidth;
  pEl.classList.add(dir==='up'?'flash-g':'flash-r');
  prevPrice = price;
}

// ==============================================
// RENDER ORDER BOOK
// ==============================================
function renderOB() { return; }

// ==============================================
// RENDER TRADES
// ==============================================
function renderTrades() {
  const el = document.getElementById('tradesList');
  if (!el) return;
  let h = '';
  for (let i = trades.length - 1; i >= Math.max(0, trades.length - 50); i--) {
    const t = trades[i];
    const color = t.isBuy ? 'var(--green)' : 'var(--red)';
    const volStr = t.qty >= 1e6 ? (t.qty/1e6).toFixed(1)+'M' : t.qty >= 1e3 ? (t.qty/1e3).toFixed(1)+'K' : t.qty.toFixed(2);
    const timeStr = new Date(t.time).toLocaleTimeString([], {hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit'});
    h += `<div style="display:flex; padding:4px 10px;">
      <div style="flex:1; color:${color}">${fmtP(t.price)}</div>
      <div style="flex:1; text-align:right;">${volStr}</div>
      <div style="flex:1; text-align:right; color:var(--txt3);">${timeStr}</div>
    </div>`;
  }
  el.innerHTML = h;
}

// ==============================================
// RENDER BIG ORDERS
// ==============================================
function renderBigOrders() {
  const el = document.getElementById('bigList');
  if (!el) return;
  const now = Date.now();
  let h = '';
  const walls = Array.from(activeWalls.values()).sort((a, b) => b.firstSeen - a.firstSeen).slice(0, 50);
  for (const w of walls) {
    const age = Math.floor((now - w.firstSeen)/1000);
    const color = w.side === 'ask' ? 'var(--red)' : 'var(--green)';
    const volStr = w.qty >= 1e6 ? (w.qty/1e6).toFixed(1)+'M' : w.qty >= 1e3 ? (w.qty/1e3).toFixed(1)+'K' : w.qty.toFixed(0);
    h += `<div style="display:flex; padding:4px 10px; cursor:pointer;" onmouseenter="this.style.background='var(--bg2)'" onmouseleave="this.style.background='transparent'">
      <div style="flex:1; color:${color}">${fmtP(w.p || 0)}</div>
      <div style="flex:1; text-align:right;">${volStr}</div>
      <div style="flex:1; text-align:right; color:var(--txt3);">${age}s</div>
    </div>`;
  }
  el.innerHTML = h;
}

// ==============================================
// TRADE FLOW BY PRICE
// ==============================================
function renderTradeFlow() { return; }

function resetTradeFlow() { return; }

function autoFlowBucket(price) {
  // Auto-suggest bucket based on price magnitude
  if (price >= 10000) return 10;
  if (price >= 1000)  return 1;
  if (price >= 100)   return 0.1;
  if (price >= 10)    return 0.01;
  return 0.001;
}

function startFlowTimer() { return; }

// ==============================================
// DEPTH CHART
// ==============================================
function renderDepthChart() { return; }

// ==============================================
// SEARCH
// ==============================================
const searchInput = document.getElementById('globalSearch');
const searchPanel = document.getElementById('searchPanel');
const panelAll    = document.getElementById('panelAll');
const panelMovers = document.getElementById('panelMovers');
const panelLosers = document.getElementById('panelLosers');

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  if (q.length >= 1) {
    searchPanel.classList.add('visible');
    panelAll.style.display = 'none';
    panelMovers.style.display = 'none';
    panelLosers.style.display = 'none';
    renderSearch(q);
  } else {
    searchPanel.classList.remove('visible');
    showActiveTab();
  }
});

// Keyboard: ESC to clear search
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { searchInput.value = ''; searchInput.dispatchEvent(new Event('input')); searchInput.blur(); }
});

// ==============================================
// SIDEBAR TABS
// ==============================================
document.querySelectorAll('.sidebar-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    searchInput.value = '';
    searchPanel.classList.remove('visible');
    showActiveTab();
  });
});

function showActiveTab() {
  panelAll.classList.toggle('active', activeTab==='all');
  panelMovers.classList.toggle('active', activeTab==='movers');
  panelLosers.classList.toggle('active', activeTab==='losers');
  panelAll.style.display = activeTab==='all' ? 'flex' : 'none';
  panelMovers.style.display = activeTab==='movers' ? 'flex' : 'none';
  panelLosers.style.display = activeTab==='losers' ? 'flex' : 'none';
}

// Fix: ensure correct initial display
panelAll.style.display = 'flex';
panelMovers.style.display = 'none';
panelLosers.style.display = 'none';

// ==============================================
// CONTROLS — generic helper
// ==============================================
function wireCtrl(groupId, dataAttr, onSelect) {
  const grp = document.getElementById(groupId);
  if (!grp) return;
  grp.addEventListener('click', e => {
    const btn = e.target.closest('.ctrl-btn');
    if (!btn || btn.dataset[dataAttr] === undefined) return;
    grp.querySelectorAll('.ctrl-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    onSelect(btn.dataset[dataAttr]);
  });
}

// ORDER BOOK — Depth
wireCtrl('depthCtrl', 'depth', val => {
  DEPTH = +val;
  
  processOrderBook();
});

// ORDER BOOK — Side
wireCtrl('sideCtrl', 'side', val => {
  OB_SIDE = val;
  renderOB();
});

// DEPTH CHART — Levels
wireCtrl('depthChartCtrl', 'dlvl', val => {
  CHART_LEVELS = +val;
  renderDepthChart();
});

// DEPTH CHART — Zoom slider
document.getElementById('depthZoom').addEventListener('input', e => {
  DEPTH_ZOOM = +e.target.value;
  document.getElementById('depthZoomVal').textContent = DEPTH_ZOOM + '%';
  renderDepthChart();
});

// LARGE ORDERS — Count
wireCtrl('bigCountCtrl', 'bigcount', val => {
  BIG_COUNT = +val;
  renderBigOrders();
});

// LARGE ORDERS — Side filter
wireCtrl('bigSideCtrl', 'bigside', val => {
  BIG_SIDE = val;
  renderBigOrders();
});

// TRADES — Count
wireCtrl('tradesCountCtrl', 'tc', val => {
  TRADES_COUNT = +val;
  renderTrades();
});

// TRADES — Side filter
wireCtrl('tradesSideCtrl', 'ts', val => {
  TRADES_SIDE = val;
  renderTrades();
});

// TRADE FLOW — Bucket size
wireCtrl('flowBucketCtrl', 'fb', val => {
  FLOW_BUCKET = +val;
  resetTradeFlow();
});

// TRADE FLOW — Levels / rows
wireCtrl('flowLevelsCtrl', 'fl', val => {
  FLOW_LEVELS = +val;
  renderTradeFlow();
});

// TRADE FLOW — Reset button

// ==============================================
// SMART MONEY INTELLIGENCE ENGINE (15 Layers)
// ==============================================
const CLASSIFIED_EVENTS = [];
const STORY_WINDOW_MS = 90000;
let smBuy = 0, smSell = 0, smNeutral = 0;
let currentPhase = 'OBSERVING';
const marketMemory = new Map();

// Per-symbol state cache (Layer 9+ : Market Memory across coins)
const smStateCache = new Map();

function saveSmState(sym) {
  smStateCache.set(sym, {
    timelineEvents: [...timelineEvents],
    classifiedEvents: [...CLASSIFIED_EVENTS],
    smBuy, smSell, smNeutral,
    currentPhase,
    marketMemory: new Map(marketMemory),
    absVolBuy, absVolSell, absStartP
  });
}

function loadSmState(sym) {
  const saved = smStateCache.get(sym);
  if (saved) {
    timelineEvents = saved.timelineEvents;
    CLASSIFIED_EVENTS.length = 0;
    CLASSIFIED_EVENTS.push(...saved.classifiedEvents);
    smBuy = saved.smBuy;
    smSell = saved.smSell;
    smNeutral = saved.smNeutral;
    currentPhase = saved.currentPhase;
    marketMemory.clear();
    for (const [k,v] of saved.marketMemory) marketMemory.set(k,v);
    absVolBuy = saved.absVolBuy;
    absVolSell = saved.absVolSell;
    absStartP = saved.absStartP;
  } else {
    // Fresh state for new coin
    timelineEvents = [];
    CLASSIFIED_EVENTS.length = 0;
    smBuy = 0; smSell = 0; smNeutral = 0;
    currentPhase = 'OBSERVING';
    marketMemory.clear();
    absVolBuy = 0; absVolSell = 0; absStartP = 0;
  }
  renderSmartMoneyScores();
  renderTimeline();
  buildNarrative(CLASSIFIED_EVENTS.slice(0,10).map(e => e.rawType));
}

const PRIORITY_MAP = {
  'WHALE_BUY':5,'WHALE_SELL':5,'SWEEP_BID':5,'SWEEP_ASK':5,'SPOOF':4,'ABSORPTION':4,
  'MIGRATION':3,'ACCUMULATION':5,'DISTRIBUTION':5,'STOP_HUNT':4,
  'LIQUIDITY_SHIFT':3,'OI_SURGE':3,'FUNDING_FLIP':3
};
const PHASE_COLORS = {
  'ACCUMULATION':'#00d4a8','MARKUP':'#00d4a8','DISTRIBUTION':'#ff4d6d',
  'MARKDOWN':'#ff4d6d','STOP HUNT':'#f59e0b','LIQUIDITY GRAB':'#f59e0b',
  'OBSERVING':'#64748b'
};

function stars(rawType) {
  const stripped = rawType ? rawType.replace(/_BID|_ASK/g,'') : '';
  const n = PRIORITY_MAP[rawType] || PRIORITY_MAP[stripped] || 2;
  return '★'.repeat(n) + '☆'.repeat(5-n);
}

// Layer 4: Confidence Engine
function calcConfidence(rawType) {
  const base = {
    WHALE_BUY:88,WHALE_SELL:88,SWEEP_BID:84,SWEEP_ASK:84,ABSORPTION:84,
    ACCUMULATION:80,DISTRIBUTION:80,SPOOF:38,MIGRATION:66,
    STOP_HUNT:72,LIQUIDITY_SHIFT:64
  };
  return (base[rawType] || 65) + Math.floor(Math.random()*9);
}

// Layer 10: Pattern Library
const PATTERNS = [
  { name:'ACCUMULATION', requires:['WHALE_BUY','ABSORPTION','SWEEP'], conf:91, desc:'Institutional Accumulation Sequence' },
  { name:'DISTRIBUTION', requires:['WHALE_SELL','MIGRATION'], conf:84, desc:'Smart Money Distribution' },
  { name:'STOP_HUNT',   requires:['SPOOF','WHALE_BUY'],      conf:72, desc:'Stop Hunt → Position Entry' },
  { name:'ACCUMULATION',requires:['ABSORPTION','ABSORPTION'], conf:85, desc:'Repeated Absorption = Accumulation' },
  { name:'DISTRIBUTION',requires:['WHALE_SELL','WHALE_SELL'], conf:82, desc:'Repeated Whale Sells = Distribution' },
];

function detectPattern(recentTypes) {
  for (const p of PATTERNS) {
    if (p.requires.every(r => recentTypes.includes(r))) return p;
  }
  return null;
}

// Layer 5 + 13: Story Builder + AI Narrator
function buildNarrative(types) {
  const price = latestTradeP > 0 ? fmtP(latestTradeP) : '—';
  let story = '';
  if (types.includes('ACCUMULATION')) story = `Pola akumulasi institusional terdeteksi di ${price}. Terdapat penyerapan volume tinggi dan tekanan beli yang sistematis. Likuiditas beli sedang dibangun secara terstruktur.`;
  else if (types.includes('DISTRIBUTION')) story = `Pola distribusi terdeteksi di ${price}. Pelaku besar tampak melepas posisi ke pembeli ritel. Waspadai potensi pembalikan ke bawah.`;
  else if (types.includes('STOP_HUNT')) story = `Pola stop hunt terdeteksi. Harga bergerak melampaui level kritis, menyapu stop order sebelum berbalik. Cermati arah selanjutnya.`;
  else if (types.includes('ABSORPTION') && types.includes('WHALE_BUY')) story = `Penyerapan kuat di ${price}. Tekanan jual besar diserap oleh buyer besar. Open Interest kemungkinan meningkat. Peluang breakout ke atas meningkat.`;
  else if (types.includes('SPOOF')) story = `Order besar muncul dan hilang sebelum tereksekusi di ${price}. Kemungkinan spoofing untuk menggerakkan sentimen. Hati-hati dengan sinyal semu.`;
  else if (types.includes('SWEEP')) story = `Tembok likuiditas disapu di ${price}. Smart money mengeksekusi order besar melawan dinding, membersihkan area untuk pergerakan berikutnya.`;
  else if (types.includes('WHALE_BUY')) story = `Pembelian besar terdeteksi di ${price}. Smart money mengambil posisi long dengan volume signifikan. Keyakinan tinggi pada level ini.`;
  else if (types.includes('WHALE_SELL')) story = `Penjualan besar terdeteksi di ${price}. Smart money melepas posisi. Perhatikan tekanan jual lanjutan.`;
  else if (types.includes('MIGRATION')) story = `Likuiditas bermigrasi ke level baru. Pelaku besar memindahkan dinding order — kemungkinan mempersiapkan pergerakan besar.`;
  else story = `Pasar dalam mode observasi di ${price}. Belum ada sinyal dominan dari smart money. Memantau akumulasi data...`;

  const el = document.getElementById('aiNarratorBox');
  if (el) { el.style.fontStyle = 'normal'; el.textContent = story; }
}

// Layer 7+8 Render Scores
function renderSmartMoneyScores() {
  const b = document.getElementById('smBuyScore');
  const s = document.getElementById('smSellScore');
  const n = document.getElementById('smNeutralScore');
  const badge = document.getElementById('smPhaseBadge');
  if (b) b.textContent = smBuy;
  if (s) s.textContent = smSell;
  if (n) n.textContent = smNeutral;
  if (badge) {
    badge.textContent = currentPhase;
    const c = PHASE_COLORS[currentPhase] || '#64748b';
    badge.style.background = c + '33';
    badge.style.color = c;
    badge.style.border = '1px solid ' + c + '55';
  }
}

// Main pipeline: classifyAndPush
function classifyAndPush(rawType, data) {
  const ts = Date.now();
  const timeStr = new Date().toTimeString().slice(0, 8);
  const confidence = calcConfidence(rawType);

  const ev = { rawType, data, ts, timeStr, confidence, price: latestTradeP };
  CLASSIFIED_EVENTS.unshift(ev);
  if (CLASSIFIED_EVENTS.length > 150) CLASSIFIED_EVENTS.length = 150;

  // Layer 9: Market Memory
  if (latestTradeP > 0) {
    const zone = Math.round(latestTradeP / Math.max(1, latestTradeP * 0.001)) * Math.max(1, latestTradeP * 0.001);
    const rounded = Math.round(zone);
    const mem = marketMemory.get(rounded) || { type:rawType, vol:0, count:0, lastSeen:0, peakVol:0, peakType:rawType };
    mem.vol += data.usdtVal || 0; mem.count++; mem.lastSeen = ts;
    if ((data.usdtVal||0) > mem.peakVol) { mem.peakVol = data.usdtVal||0; mem.peakType = rawType; }
    marketMemory.set(rounded, mem);
  }

  // Layer 3: Correlation
  const windowStart = ts - STORY_WINDOW_MS;
  const recent = CLASSIFIED_EVENTS.filter(e => e.ts > windowStart);
  const recentTypes = recent.map(e => e.rawType);
  const pattern = detectPattern(recentTypes);

  // Layer 7: Score Update — side-aware!
  // SWEEP_BID = bid wall swept by sellers → bearish
  // SWEEP_ASK = ask wall swept by buyers → bullish
  // MIGRATION & SPOOF = neutral
  const buyTypes  = ['WHALE_BUY','ABSORPTION','ACCUMULATION','SWEEP_ASK'];
  const sellTypes = ['WHALE_SELL','DISTRIBUTION','SWEEP_BID'];
  const neutralTypes = ['MIGRATION','SPOOF','LIQUIDITY_SHIFT'];
  if (buyTypes.includes(rawType))      smBuy     = Math.min(99, smBuy + 7 + Math.floor(confidence/18));
  else if (sellTypes.includes(rawType)) smSell    = Math.min(99, smSell + 7 + Math.floor(confidence/18));
  else                                  smNeutral = Math.min(99, smNeutral + 5);

  // Layer 8: Phase Detection
  const tot = smBuy + smSell + smNeutral || 1;
  const br = smBuy / tot, sr = smSell / tot;
  if (pattern && pattern.name === 'ACCUMULATION') currentPhase = 'ACCUMULATION';
  else if (pattern && pattern.name === 'DISTRIBUTION') currentPhase = 'DISTRIBUTION';
  else if (pattern && pattern.name === 'STOP_HUNT') currentPhase = 'STOP HUNT';
  else if (smBuy > 70) currentPhase = 'MARKUP';
  else if (smSell > 70) currentPhase = 'MARKDOWN';
  else if (br > 0.55) currentPhase = 'ACCUMULATION';
  else if (sr > 0.55) currentPhase = 'DISTRIBUTION';
  else if (smBuy > 40 && smSell > 40) currentPhase = 'LIQUIDITY GRAB';
  else currentPhase = 'OBSERVING';

  renderSmartMoneyScores();

  // Build display event
  const displayEv = {
    type: rawType === 'SWEEP_BID' ? 'sweep-bid' : rawType === 'SWEEP_ASK' ? 'sweep-ask' : rawType.toLowerCase().replace(/_/g,'-'),
    rawType, timeStr, price: latestTradeP, confidence,
    priority: PRIORITY_MAP[rawType] || 2,
    desc: data.desc || '',
    usdtVal: data.usdtVal || null,
    side: data.side || null
  };

  // Pattern composite event
  if (pattern) {
    timelineEvents.unshift({
      type: 'pattern', rawType: pattern.name, timeStr, price: latestTradeP,
      confidence: pattern.conf, priority: 5,
      desc: pattern.desc + ' • ' + recentTypes.slice(0,4).join(' → '),
      usdtVal: null, isPattern: true
    });
  }

  timelineEvents.unshift(displayEv);
  if (timelineEvents.length > MAX_EVENTS) timelineEvents.length = MAX_EVENTS;

  buildNarrative(recentTypes);
  renderTimeline();
}

function pushEvent(typeSlug, title, desc, val, price = latestTradeP) {
  const typeMap = {
    'whale-buy':'WHALE_BUY','whale-sell':'WHALE_SELL','sweep':'SWEEP',
    'spoof':'SPOOF','absorption':'ABSORPTION','migration':'MIGRATION'
  };
  const rawType = typeMap[typeSlug] || typeSlug.toUpperCase().replace(/-/g,'_');
  classifyAndPush(rawType, { desc:`${title} — ${desc}`, usdtVal: null });
}

function renderTimeline() {
  const el = document.getElementById('timelineList');
  if (!el) return;
  if (!timelineEvents.length) {
    el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--txt3);font-size:11px;font-style:italic;">Listening for anomalies...</div>';
    return;
  }
  const TC = {
    'whale-buy':   ['#00d4a8','rgba(0,212,168,0.08)'],
    'whale-sell':  ['#ff4d6d','rgba(255,77,109,0.08)'],
    'sweep-ask':   ['#00d4a8','rgba(0,212,168,0.06)'],  // ASK swept = bullish
    'sweep-bid':   ['#ff4d6d','rgba(255,77,109,0.06)'],  // BID swept = bearish
    'sweep':       ['#f59e0b','rgba(245,158,11,0.08)'],
    'spoof':       ['#8b5cf6','rgba(139,92,246,0.08)'],
    'absorption':  ['#06b6d4','rgba(6,182,212,0.08)'],
    'migration':   ['#a78bfa','rgba(167,139,250,0.08)'],
    'stop-hunt':   ['#f97316','rgba(249,115,22,0.08)'],
    'accumulation':['#00d4a8','rgba(0,212,168,0.1)'],
    'distribution':['#ff4d6d','rgba(255,77,109,0.1)'],
    'pattern':     ['#4f6ef7','rgba(79,110,247,0.12)']
  };
  el.innerHTML = timelineEvents.map(ev => {
    const [color, bg] = TC[ev.type] || TC[(ev.rawType||'').toLowerCase()] || ['var(--txt2)','var(--bg3)'];
    const starsStr = stars(ev.rawType||'');
    const label = ev.isPattern
      ? '🔗 PATTERN: ' + (ev.rawType||'').replace(/_/g,' ')
      : (ev.rawType||'').replace(/_/g,' ');
    const priceStr = ev.price > 0 ? fmtP(ev.price) : '';
    const valStr = ev.usdtVal ? `$${fmtVol(ev.usdtVal)}` : '';
    const conf = ev.confidence || 0;
    return `
    <div style="padding:7px 10px;border-bottom:1px solid var(--border);background:${bg};${ev.isPattern?'border-left:3px solid #4f6ef7;':``}">
      <div style="display:flex;align-items:flex-start;gap:6px;">
        <div style="flex-shrink:0;min-width:44px;text-align:center;">
          <div style="font-size:9px;color:var(--txt3);font-family:'JetBrains Mono',monospace;">${ev.timeStr||''}</div>
          <div style="font-size:9px;color:${color};margin-top:1px;">${priceStr}</div>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:4px;margin-bottom:1px;">
            <span style="font-size:10px;font-weight:700;color:${color};">${label}</span>
            ${ev.isPattern ? '<span style="font-size:8px;padding:1px 4px;background:#4f6ef7;color:#fff;border-radius:3px;font-weight:700;">PATTERN</span>' : ''}
            ${valStr ? `<span style="font-size:9px;color:var(--txt3);">${valStr}</span>` : ''}
          </div>
          ${ev.desc ? `<div style="font-size:10px;color:var(--txt3);margin-bottom:2px;">${ev.desc}</div>` : ''}
          ${conf > 0 ? `<div style="height:2px;border-radius:1px;background:var(--bg4);"><div style="height:100%;width:${conf}%;background:${color};border-radius:1px;"></div></div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:9px;color:#f59e0b;letter-spacing:-1px;">${starsStr}</div>
          ${conf ? `<div style="font-size:9px;color:${color};">${conf}%</div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

// Absorption Interval (5s)
setInterval(() => {
  const totalVol = absVolBuy + absVolSell;
  if (totalVol > 200000 && absStartP > 0) {
    const priceChange = Math.abs(latestTradeP - absStartP) / absStartP * 100;
    if (priceChange < 0.05) {
      const side = absVolBuy > absVolSell ? 'buy' : 'sell';
      classifyAndPush('ABSORPTION', { desc:`High ${side} volume absorbed at ${fmtP(absStartP)}`, usdtVal: totalVol });
    }
  }
  absVolBuy = 0; absVolSell = 0; absStartP = latestTradeP;
}, 5000);

// Decay SM scores every 12s
setInterval(() => {
  smBuy = Math.max(0, smBuy - 3);
  smSell = Math.max(0, smSell - 3);
  smNeutral = Math.max(0, smNeutral - 5);
  renderSmartMoneyScores();
}, 12000);





  

// ==============================================
// HEATMAP & LIQUIDATIONS
// ==============================================
let currentView = 'depth';

document.querySelectorAll('.view-tab').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    currentView = e.target.dataset.view;
    if (currentView === 'depth') {
      document.getElementById('depthChart').style.display = 'block';
      document.getElementById('heatmapChart').style.display = 'none';
      document.getElementById('heatmapOverlay').style.display = 'none';
      document.getElementById('depthChartCtrlBar').style.display = 'flex';
      document.getElementById('heatmapControls').style.display = 'none';
      renderDepthChart();
    } else {
      document.getElementById('depthChart').style.display = 'none';
      document.getElementById('lwcContainer').style.display = 'block';
      document.getElementById('heatmapChart').style.display = 'block';
      document.getElementById('heatmapOverlay').style.display = 'block';
      document.getElementById('depthChartCtrlBar').style.display = 'none';
      document.getElementById('heatmapControls').style.display = 'flex';
      initLwc();
      if (!lastCandle) fetchKlines();
      renderLiquidityProfile();
    }
  });
});

// Timeframe Controls
document.querySelectorAll('#tfCtrl .ctrl-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('#tfCtrl .ctrl-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    currentKlinesInterval = e.target.dataset.tf;
    if (lwcSeries) {
      lwcSeries.setData([]); // Clear chart
      lastCandle = null;
    }
    fetchKlines();
  });
});

// Heatmap Filter Slider
const hmFilterEl = document.getElementById('heatmapFilter');
const hmFilterValEl = document.getElementById('heatmapFilterVal');
hmFilterEl.addEventListener('input', (e) => {
  currentHeatmapFilter = parseInt(e.target.value, 10);
  hmFilterValEl.textContent = currentHeatmapFilter + '%';
  renderLiquidityProfile();
});

// connectFuturesWS is defined above with unified streams

function spawnLiquidationBubble(price, side, qty) {
  if (currentView !== 'heatmap') return;
  const overlay = document.getElementById('heatmapOverlay');
  const h = overlay.clientHeight;
  const mid = latestTradeP;
  if (!mid) return;
  
  const range = (DEPTH_ZOOM/100)*0.05;
  const maxP = mid * (1 + range);
  const minP = mid * (1 - range);
  
  let y = h - ((price - minP) / (maxP - minP) * h);
  if (y < 0) y = 0;
  if (y > h) y = h;
  
  const div = document.createElement('div');
  div.className = 'pulse-liq';
  div.style.top = y + 'px';
  div.style.left = '98%'; // close to the right edge
  div.style.background = side === 'SELL' ? 'rgba(255, 50, 50, 0.8)' : 'rgba(50, 255, 50, 0.8)';
  div.style.boxShadow = `0 0 15px ${div.style.background}`;
  
  overlay.appendChild(div);
  setTimeout(() => div.remove(), 2000);
}

let lwcChart = null;
let lwcSeries = null;
let lastCandle = null;

function initLwc() {
  if (lwcChart) return;
  try {
    const container = document.getElementById('lwcContainer');
    const w = container.clientWidth || 400;
    const h = container.clientHeight || 240;
    lwcChart = LightweightCharts.createChart(container, {
      width: w,
      height: h,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8892a4' },
      grid: { vertLines: { color: '#1e2a45' }, horzLines: { color: '#1e2a45' } },
      rightPriceScale: { borderColor: '#1e2a45' },
      timeScale: { borderColor: '#1e2a45', timeVisible: true }
    });
    lwcSeries = lwcChart.addCandlestickSeries({
      upColor: '#00d4a8', downColor: '#ff4d6d', borderVisible: false, wickUpColor: '#00d4a8', wickDownColor: '#ff4d6d'
    });
    
    // Resize overlay canvas to match container
    const c = document.getElementById('heatmapChart');
    c.width = w;
    c.height = h;
    console.log('LWC Initialized', w, h);
  } catch (e) {
    console.error('Failed to init LWC', e);
  }
}

async function fetchKlines() {
  if (!lwcSeries && currentView !== 'heatmap') return;
  if (!lwcSeries) initLwc();
  if (!lwcSeries) {
    console.error('fetchKlines aborted: lwcSeries is null after initLwc');
    return;
  }
  
  const applyFallback = () => {
    if (latestTradeP > 0 && lwcSeries) {
      const now = Math.floor(Date.now() / 1000);
      lastCandle = { time: now, open: latestTradeP, high: latestTradeP, low: latestTradeP, close: latestTradeP };
      lwcSeries.setData([lastCandle]);
      console.log('Fallback dummy candle created! API was blocked.');
    } else {
      console.error('Cannot create fallback: latestTradeP is 0');
    }
  };
  
  try {
    const url = getRestProxy(`/api/v3/klines?symbol=${currentSymbol.toUpperCase()}&interval=${currentKlinesInterval}&limit=100`);
    console.log('Fetching klines:', url);
    
    // Add timeout to fetch to not hang forever
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if(!res.ok) {
      console.error('Klines fetch failed HTTP', res.status);
      applyFallback();
      return;
    }
    const data = await res.json();
    console.log('Klines API returned arrays:', data.length);
    const cdata = data.map(d => ({
      time: Math.floor(d[0] / 1000), // ensure strictly integer
      open: +d[1],
      high: +d[2],
      low: +d[3],
      close: +d[4]
    }));
    // Remove duplicates if any (binance shouldn't have them but just in case)
    const uniqueData = [];
    const seen = new Set();
    for(const d of cdata) {
      if(!seen.has(d.time)) { seen.add(d.time); uniqueData.push(d); }
    }
    console.log('Setting data to lwcSeries, count:', uniqueData.length);
    lwcSeries.setData(uniqueData);
    lastCandle = uniqueData[uniqueData.length - 1];
    console.log('Klines successfully loaded!', uniqueData.length);
  } catch (e) { 
    console.error('Failed to fetch klines (Exception):', e.message || e);
    applyFallback();
  }
}

  // ==============================================
  // SMART LIQUIDITY ENGINE & HISTORICAL HEATMAP
  // ==============================================
  const HM_MAX_HISTORY_MS = 30 * 60 * 1000;
  const HM_SNAPSHOT_INTERVAL = 1500;
  let heatmapHistory = [];
  let heatmapBubbles = [];
  let lastHmSnapshot = 0;
  let hmTooltipData = null;
  
  function getHeatmapColor(ratio) {
    if (ratio <= 0.01) return '#0b0f14';
    const stops = [
      { r: 11,  g: 15,  b: 20,  v: 0.00 },
      { r: 0,   g: 0,   b: 139, v: 0.10 },
      { r: 0,   g: 120, b: 255, v: 0.25 },
      { r: 0,   g: 255, b: 0,   v: 0.40 },
      { r: 255, g: 255, b: 0,   v: 0.60 },
      { r: 255, g: 165, b: 0,   v: 0.80 },
      { r: 255, g: 0,   b: 0,   v: 0.95 },
      { r: 255, g: 255, b: 255, v: 1.00 }
    ];
    let c1 = stops[0], c2 = stops[1];
    for (let i = 1; i < stops.length; i++) {
      if (ratio <= stops[i].v) { c1 = stops[i-1]; c2 = stops[i]; break; }
    }
    if (ratio >= 1.0) c1 = c2 = stops[stops.length - 1];
    const range = c2.v - c1.v;
    const p = range === 0 ? 0 : (ratio - c1.v) / range;
    const R = Math.floor(c1.r + (c2.r - c1.r) * p);
    const G = Math.floor(c1.g + (c2.g - c1.g) * p);
    const B = Math.floor(c1.b + (c2.b - c1.b) * p);
    return `rgba(${R}, ${G}, ${B}, 1.0)`;
  }
  
  function captureHeatmapData() {
    const now = Date.now();
    if (now - lastHmSnapshot < HM_SNAPSHOT_INTERVAL) return;
    lastHmSnapshot = now;
    const askSnaps = orderBook.asks.slice(0, 80).map(a => ({ p: a.price, q: a.qty }));
    const bidSnaps = orderBook.bids.slice(0, 80).map(b => ({ p: b.price, q: b.qty }));
    const cutoff = now - HM_MAX_HISTORY_MS;
    while(heatmapHistory.length > 0 && heatmapHistory[0].time * 1000 < cutoff) heatmapHistory.shift();
    while(heatmapBubbles.length > 0 && heatmapBubbles[0].time < cutoff) heatmapBubbles.shift();
    heatmapHistory.push({ time: Math.floor(now / 1000), asks: askSnaps, bids: bidSnaps });
  }

  function renderLiquidityProfile() {
    if (currentView !== 'heatmap' || !lwcChart || !lwcSeries) return;
    captureHeatmapData();
    try {
      const canvas = document.getElementById('heatmapChart');
      const ctx = canvas.getContext('2d');
      const container = document.getElementById('lwcContainer');
      if (canvas.width !== container.offsetWidth || canvas.height !== container.offsetHeight) {
        canvas.width = container.offsetWidth; canvas.height = container.offsetHeight;
        lwcChart.resize(canvas.width, canvas.height);
      }
      ctx.fillStyle='#0b0f14'; ctx.fillRect(0,0,canvas.width,canvas.height);
      if (!lastCandle || heatmapHistory.length === 0) {
        ctx.fillStyle = '#8892a4'; ctx.fillText('Building Smart Engine History...', 10, 20); return;
      }
      const timeScale = lwcChart.timeScale();
      const logicalRange = timeScale.getVisibleLogicalRange();
      if (!logicalRange) return;
      
      let maxVol = 1;
      const visibleHistory = heatmapHistory.slice(-150);
      for (const snap of visibleHistory) {
        for (const a of snap.asks) if (a.q > maxVol) maxVol = a.q;
        for (const b of snap.bids) if (b.q > maxVol) maxVol = b.q;
      }
      const filterThreshold = maxVol * (currentHeatmapFilter / 100);
      const chartAreaWidth = canvas.width - 60;
      
      const barSpacing = timeScale.width() / (logicalRange.to - logicalRange.from);
      let intervalSec = 900;
      if (currentKlinesInterval === '1m') intervalSec = 60;
      else if (currentKlinesInterval === '5m') intervalSec = 300;
      else if (currentKlinesInterval === '15m') intervalSec = 900;
      else if (currentKlinesInterval === '1h') intervalSec = 3600;
      else if (currentKlinesInterval === '4h') intervalSec = 14400;
      else if (currentKlinesInterval === '1d') intervalSec = 86400;
      
      const pxPerSecDyn = barSpacing / intervalSec;
      const lastCandleX = timeScale.timeToCoordinate(lastCandle.time);
      if (lastCandleX === null) return;
      
      ctx.globalCompositeOperation = 'lighter';
      for (const snap of heatmapHistory) {
        const diffSec = snap.time - lastCandle.time;
        const x = lastCandleX + (diffSec * pxPerSecDyn);
        if (x < -10 || x > chartAreaWidth + 10) continue;
        const blockW = Math.max(1.5, (HM_SNAPSHOT_INTERVAL / 1000) * pxPerSecDyn);
        
        ctx.fillStyle = getHeatmapColor(1.0); // Dummy, we will set real per-bar
        for (const a of snap.asks) {
          if (a.q < filterThreshold) continue;
          const y = lwcSeries.priceToCoordinate(a.p);
          if (y !== null) { ctx.fillStyle = getHeatmapColor(a.q / maxVol); ctx.fillRect(Math.floor(x), Math.floor(y)-1, Math.ceil(blockW)+1, 3); }
        }
        for (const b of snap.bids) {
          if (b.q < filterThreshold) continue;
          const y = lwcSeries.priceToCoordinate(b.p);
          if (y !== null) { ctx.fillStyle = getHeatmapColor(b.q / maxVol); ctx.fillRect(Math.floor(x), Math.floor(y)-1, Math.ceil(blockW)+1, 3); }
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      
      for (const b of heatmapBubbles) {
        const diffSec = (b.time / 1000) - lastCandle.time;
        const x = lastCandleX + (diffSec * pxPerSecDyn);
        if (x < -20 || x > chartAreaWidth + 20) continue;
        const y = lwcSeries.priceToCoordinate(b.p);
        if (y !== null) {
          const r = Math.min(15, Math.max(3, Math.pow(b.q / maxVol, 0.5) * 20));
          ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
          ctx.fillStyle = b.isBuy ? 'rgba(0,255,0,0.5)' : 'rgba(255,0,0,0.5)'; ctx.fill();
          ctx.strokeStyle = b.isBuy ? '#00ff00' : '#ff0000'; ctx.stroke();
        }
      }
      
      if (hmTooltipData && hmTooltipData.x < chartAreaWidth) {
        const diffSec = (hmTooltipData.x - lastCandleX) / pxPerSecDyn;
        const targetTime = lastCandle.time + diffSec;
        let bestSnap = null, minDiff = Infinity;
        for (const snap of heatmapHistory) {
          const diff = Math.abs(snap.time - targetTime);
          if (diff < minDiff) { minDiff = diff; bestSnap = snap; }
        }
        if (bestSnap && minDiff < (intervalSec * 2)) {
          const targetPrice = lwcSeries.coordinateToPrice(hmTooltipData.y);
          if (targetPrice) {
            let totalQ = 0, type = '';
            for (const a of bestSnap.asks) { if (Math.abs(a.p - targetPrice) / targetPrice < 0.003) { totalQ += a.q; type = 'Ask Wall'; } }
            for (const b of bestSnap.bids) { if (Math.abs(b.p - targetPrice) / targetPrice < 0.003) { totalQ += b.q; type = 'Bid Wall'; } }
            if (totalQ > 0) {
              const tx = hmTooltipData.x > chartAreaWidth - 160 ? hmTooltipData.x - 170 : hmTooltipData.x + 15;
              ctx.fillStyle = 'rgba(10,15,20,0.95)'; ctx.strokeStyle = '#2b3345';
              ctx.fillRect(tx, hmTooltipData.y - 45, 160, 65); ctx.strokeRect(tx, hmTooltipData.y - 45, 160, 65);
              ctx.fillStyle = '#fff'; ctx.font = '11px Inter';
              ctx.fillText(`Type: ${type}`, tx + 10, hmTooltipData.y - 25);
              ctx.fillText(`Price: ${targetPrice.toFixed(5)}`, tx + 10, hmTooltipData.y - 10);
              ctx.fillText(`Volume: ${totalQ.toFixed(2)}`, tx + 10, hmTooltipData.y + 5);
            }
          }
        }
      }
    } catch (e) { console.error('Liquidity Profile error:', e); }
    
    // --- SMART LIQUIDITY DOM BAR ---
    try {
      const domCanvas = document.getElementById('domChart');
      if (domCanvas) {
        domCanvas.width = canvas.width;
        domCanvas.height = canvas.height;
        const domCtx = domCanvas.getContext('2d');
        domCtx.clearRect(0, 0, domCanvas.width, domCanvas.height);
        if (lwcSeries && orderBook.asks.length > 0) {
          const maxDomVol = Math.max(
            ...orderBook.asks.map(a => a.qty),
            ...orderBook.bids.map(b => b.qty)
          );
          
          const drawDom = (list, isAsk) => {
            for (let i = 0; i < list.length; i++) {
              const item = list[i];
              const y = lwcSeries.priceToCoordinate(+item.price);
              if (y === null || y < 0 || y > domCanvas.height) continue;
              
              const ratio = item.qty / maxDomVol;
              const barWidth = Math.max(2, ratio * 200); // Max 200px wide
              const x = domCanvas.width - barWidth;
              
              // Smart Color Logic
              let color = '#555'; // Grey (New)
              let label = '';
              const wallInfo = activeWalls.get(item.price);
              if (wallInfo) {
                 const ageMs = Date.now() - wallInfo.firstSeen;
                 if (ratio > 0.8) {
                    color = '#ffaa00'; // Yellow Whale
                    label = 'Whale';
                 } else if (ageMs > 30000) {
                    color = '#0088ff'; // Blue Resting
                 } else {
                    color = '#00ff00'; // Green Strong
                 }
              }
              
              domCtx.fillStyle = color;
              domCtx.globalAlpha = 0.8;
              domCtx.fillRect(x, Math.floor(y)-4, barWidth, 9);
              domCtx.globalAlpha = 1.0;
              
              // Text
              if (ratio > 0.1) {
                domCtx.fillStyle = '#fff';
                domCtx.font = '10px "JetBrains Mono"';
                domCtx.textAlign = 'right';
                domCtx.textBaseline = 'middle';
                const volStr = item.qty >= 1e6 ? (item.qty/1e6).toFixed(1)+'M' : item.qty >= 1e3 ? (item.qty/1e3).toFixed(1)+'K' : item.qty.toFixed(0);
                domCtx.fillText(volStr + (label ? ' ' + label : ''), x - 5, Math.floor(y));
              }
            }
          };
          
          drawDom(orderBook.asks, true);
          drawDom(orderBook.bids, false);
        }
      }
    } catch (e) {
      console.error('DOM Render Error:', e);
    }
    
    
    // --- SMART LIQUIDITY DOM BAR ---
    try {
      const domCanvas = document.getElementById('domChart');
      if (domCanvas) {
        domCanvas.width = canvas.width;
        domCanvas.height = canvas.height;
        const domCtx = domCanvas.getContext('2d');
        domCtx.clearRect(0, 0, domCanvas.width, domCanvas.height);
        
        if (lwcSeries && orderBook.asks.length > 0) {
          const maxDomVol = Math.max(
            ...orderBook.asks.map(a => a.qty),
            ...orderBook.bids.map(b => b.qty)
          );
          
          const drawDom = (list, isAsk) => {
            for (let i = 0; i < list.length; i++) {
              const item = list[i];
              const y = lwcSeries.priceToCoordinate(+item.price);
              if (y === null || y < 0 || y > domCanvas.height) continue;
              
              const ratio = item.qty / maxDomVol;
              const barWidth = Math.max(2, ratio * 200); // Max 200px wide
              const x = domCanvas.width - barWidth;
              
              // Smart Color Logic
              let color = '#555555'; // Grey (New)
              let label = '';
              const wallInfo = activeWalls.get(item.price);
              if (wallInfo) {
                 const ageMs = Date.now() - wallInfo.firstSeen;
                 if (ratio > 0.8) {
                    color = '#ffaa00'; // Yellow Whale
                    label = 'Whale ' + Math.floor(ratio*100) + '%';
                 } else if (ageMs > 30000) {
                    color = '#0088ff'; // Blue Resting
                    label = 'Resting';
                 } else {
                    color = '#00ff00'; // Green Strong
                 }
              }
              
              domCtx.fillStyle = color;
              domCtx.globalAlpha = 0.8;
              domCtx.fillRect(x, Math.floor(y)-4, barWidth, 9);
              domCtx.globalAlpha = 1.0;
              
              // Text
              if (ratio > 0.1) {
                domCtx.fillStyle = '#fff';
                domCtx.font = '10px "JetBrains Mono"';
                domCtx.textAlign = 'right';
                domCtx.textBaseline = 'middle';
                const volStr = item.qty >= 1e6 ? (item.qty/1e6).toFixed(1)+'M' : item.qty >= 1e3 ? (item.qty/1e3).toFixed(1)+'K' : item.qty.toFixed(0);
                domCtx.fillText(volStr + (label ? ' ' + label : ''), x - 5, Math.floor(y));
              }
            }
          };
          
          drawDom(orderBook.asks, true);
          drawDom(orderBook.bids, false);
        }
      }
    } catch (e) {
      console.error('DOM Render Error:', e);
    }
    
  }
  
  // Attach tooltip events
  setTimeout(() => {
    const lwcCont = document.getElementById('lwcContainer');
    if(lwcCont && !lwcCont.hasMouseListeners) {
      lwcCont.hasMouseListeners = true;
      lwcCont.addEventListener('mousemove', (e) => {
        if (currentView !== 'heatmap') return;
        const rect = e.target.getBoundingClientRect();
        hmTooltipData = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        renderLiquidityProfile();
      });
      lwcCont.addEventListener('mouseleave', () => { hmTooltipData = null; renderLiquidityProfile(); });
    }
  }, 1000);

function calculateSmartMoneyScore() {
  let score = 0;
  let reasons = [];
  
  // 1. OI Naik (sementara harga stagnan/naik pelan)
  if (oiData.oiHistory.length > 5) {
    const oldestOI = oiData.oiHistory[0].oi;
    const currentOI = oiData.oi;
    if (oldestOI > 0) {
      const oiChange = (currentOI - oldestOI) / oldestOI;
      if (oiChange > 0.01) { // 1% increase
         score += 15; reasons.push("OI Naik signifikan (+15)");
      } else if (oiChange > 0.002) { // 0.2% increase
         score += 5; reasons.push("OI Naik perlahan (+5)");
      }
    }
  }
  
  // 2. Spot Volume vs Futures Volume (Momentum)
  if (spotVol > 0 && spotVol > futuresVol * 0.8) {
    score += 15; reasons.push("Spot Volume mendominasi (+15)");
  } else if (futuresVol > 0 && futuresVol > spotVol * 2) {
    score += 10; reasons.push("Futures Volume tinggi (+10)");
  }
  
  // 3. Order Book Profiling (Bid/Ask Walls)
  let bidWallVol = 0; let askWallVol = 0;
  for (const w of activeWalls.values()) {
    if (w.side === 'bid') bidWallVol += w.qty;
    else askWallVol += w.qty;
  }
  if (bidWallVol > 0 || askWallVol > 0) {
    if (bidWallVol > askWallVol * 1.5) {
       score += 20; reasons.push("Bid Wall kuat (Layering) (+20)");
    } else if (bidWallVol > askWallVol) {
       score += 10; reasons.push("Bid Wall lebih besar (+10)");
    }
  }
  
  // 4. Whale Buy (Spot menyerap Market Sell)
  if (absVolBuy > 0 && absVolBuy > absVolSell * 2 && absVolBuy > 500000) {
     score += 10; reasons.push("Whale Accumulation (Absorbing Sell) (+10)");
  }
  
  // 5. Funding Rendah/Netral
  if (fundingRate < 0.0001 && fundingRate > -0.0005) {
     score += 10; reasons.push("Funding Rate Netral (+10)");
  } else if (fundingRate <= -0.0005) {
     score += 15; reasons.push("Funding Rate Negatif (Shorts trapped) (+15)");
  }
  
  // 6. CVD Positif (Spot CVD > Futures CVD)
  if (spotCVD > 0 && spotCVD > futuresCVD) {
     score += 10; reasons.push("Spot CVD memimpin Futures CVD (+10)");
  }
  
  // Ensure score is between 0 and 100
  smartMoneyScore = Math.min(100, Math.max(0, score));
  
  // Watchlist A classification
  if (smartMoneyScore >= 80 && !flaggedWatchlist) {
     flaggedWatchlist = true;
     classifyAndPush('ACCUMULATION', { desc: `[WATCHLIST A] Skor mencapai ${smartMoneyScore}! Alasan: ` + reasons.join(', '), usdtVal: null });
  }
  
  renderAdvancedScoreUI();
}

function renderAdvancedScoreUI() {
  document.getElementById('smScoreVal').textContent = smartMoneyScore;
  const circle = document.getElementById('scoreCircle');
  if (circle) {
    const dash = (smartMoneyScore / 100) * 100;
    circle.style.strokeDasharray = `${dash}, 100`;
    circle.style.stroke = smartMoneyScore >= 80 ? 'var(--accent)' : smartMoneyScore >= 50 ? 'var(--green)' : 'var(--red)';
  }
  
  let phase = 'OBSERVING';
  let phaseColor = 'var(--txt2)';
  if (smartMoneyScore >= 80) { phase = 'STRONG ACCUMULATION'; phaseColor = 'var(--accent)'; }
  else if (smartMoneyScore >= 50) { phase = 'MILD ACCUMULATION'; phaseColor = 'var(--green)'; }
  else if (smartMoneyScore <= 20) { phase = 'DISTRIBUTION'; phaseColor = 'var(--red)'; }
  
  const badge = document.getElementById('smPhaseBadge');
  if (badge) {
    badge.textContent = phase;
    badge.style.color = phaseColor;
  }
  
  const fmtCVD = (c) => {
     let v = Math.abs(c);
     let s = c >= 0 ? '+' : '-';
     if (v >= 1e9) return s + (v/1e9).toFixed(2)+'B';
     if (v >= 1e6) return s + (v/1e6).toFixed(2)+'M';
     if (v >= 1e3) return s + (v/1e3).toFixed(2)+'K';
     return s + v.toFixed(0);
  };
  
  document.getElementById('spotCvdVal').textContent = fmtCVD(spotCVD);
  document.getElementById('futCvdVal').textContent = fmtCVD(futuresCVD);
  document.getElementById('spotCvdVal').style.color = spotCVD > 0 ? 'var(--green)' : 'var(--red)';
  document.getElementById('futCvdVal').style.color = futuresCVD > 0 ? 'var(--green)' : 'var(--red)';
  
  document.getElementById('oiVal').textContent = oiData.oi > 0 ? fmtVol(oiData.oi) : '--';
  document.getElementById('fundVal').textContent = fundingRate ? (fundingRate * 100).toFixed(4) + '%' : '--';
  document.getElementById('fundVal').style.color = fundingRate > 0 ? 'var(--red)' : 'var(--green)'; // Red is high funding (overheated), green is negative
  
  const aiNarrator = document.getElementById('aiNarratorBox');
  if (aiNarrator) {
    if (smartMoneyScore >= 80) {
      aiNarrator.innerHTML = '🚨 <b>WATCHLIST A</b>: Smart Money is actively accumulating. Spot CVD leads Futures, and heavy Bid Walls detected. High probability setup.';
      aiNarrator.style.borderColor = 'var(--accent)';
    } else if (smartMoneyScore >= 50) {
      aiNarrator.innerHTML = '🔍 <b>Building Phase</b>: Moderate buying pressure. Watch for Open Interest to spike alongside Spot Volume.';
      aiNarrator.style.borderColor = 'var(--border)';
    } else {
      aiNarrator.innerHTML = '⚖️ <b>Neutral / Bearish</b>: No clear accumulation signals. Market is drifting or distributing.';
      aiNarrator.style.borderColor = 'var(--border)';
    }
  }
}

// ==============================================
// INIT
// ==============================================
updatePill({ display:'BTC/USDT', price:0, change:0 });
fetchAllTickers();
connectDepth(currentSymbol);
connectTradesWS(currentSymbol);
connectFuturesWS(currentSymbol);
startOIPoller(currentSymbol);
if (scoreCalcInterval) clearInterval(scoreCalcInterval);
scoreCalcInterval = setInterval(calculateSmartMoneyScore, 5000);
startFlowTimer();
window.addEventListener('resize', () => { renderDepthChart(); renderLiquidityProfile(); });

