/**
 * AGNOIA V2 Algorithmic Trading Engine
 * 
 * This file contains the complete suite of institutional-grade order flow analysis engines,
 * fully decoupled from the UI layer to allow for pure mathematical evaluation and backtesting.
 */

class AgnoiaEngine {
    constructor() {
        this.reset();
        
        // Trackers for dynamic thresholds
        this.tradeSizes = []; // Last 5 mins of trade sizes
        this.medianTradeSize = 15000; // Default $15k
        this.priceHistory = []; // [ { price, time } ]
        
        // Active states
        this.lastPrice = 0;
        this.fundingRate = 0;
        this.volatility = 0; // Proxy for OI momentum
        
        // Sub-Engines
        this.wallEngine = new WallEngine(this);
        this.absorptionEngine = new AbsorptionEngine(this);
        this.spoofEngine = new SpoofEngine(this);
        this.icebergEngine = new IcebergEngine(this);
        this.whaleEngine = new WhaleEngine(this);
        this.migrationEngine = new MigrationEngine(this);
        this.trapEngine = new TrapEngine(this);
        
        // Master Engines
        this.evidenceEngine = new EvidenceEngine(this);
        this.executionEngine = new ExecutionEngine(this);
    }
    
    reset() {
        this.trades = [];
        this.depth = { bids: [], asks: [] };
    }

    feedDepth(bids, asks) {
        this.depth = { bids, asks };
        const now = Date.now();
        this.wallEngine.processDepth(bids, asks, now, this.lastPrice);
        this.migrationEngine.processDepth(bids, asks, now);
        this.spoofEngine.processDepth(bids, asks, now);
    }

    feedTrade(trade) {
        // trade: { price, qty, notional, isBuy, time }
        this.lastPrice = trade.price;
        this.priceHistory.push({ price: trade.price, time: trade.time });
        
        // Maintain 5-min history for price & trades
        const fiveMinsAgo = trade.time - (5 * 60 * 1000);
        while(this.priceHistory.length && this.priceHistory[0].time < fiveMinsAgo) this.priceHistory.shift();
        
        this.tradeSizes.push({ val: trade.notional, time: trade.time });
        while(this.tradeSizes.length && this.tradeSizes[0].time < fiveMinsAgo) this.tradeSizes.shift();
        this._updateMedianTradeSize();

        this.icebergEngine.processTrade(trade);
        this.whaleEngine.processTrade(trade, this.medianTradeSize);
        this.absorptionEngine.processTrade(trade, this.depth);
        this.trapEngine.processTrade(trade);
        
        // Finally evaluate overall evidence and gates
        this.evaluate();
    }
    
    feedFunding(rate) {
        this.fundingRate = rate;
    }

    _updateMedianTradeSize() {
        if(this.tradeSizes.length === 0) return;
        const vals = this.tradeSizes.map(t => t.val).sort((a,b) => a-b);
        this.medianTradeSize = vals[Math.floor(vals.length / 2)] || 15000;
    }

    evaluate() {
        this.evidenceEngine.evaluate();
        this.executionEngine.evaluate();
    }
}

// ==========================================
// 1. BUY / SELL WALL ENGINE
// ==========================================
class WallEngine {
    constructor(core) {
        this.core = core;
        this.trackedWalls = new Map(); // price -> { type, initialSize, currentSize, birth, refills, fills, cancels, lastPrice }
        this.activeBuyWall = null;
        this.activeSellWall = null;
    }
    
    processDepth(bids, asks, now, currentPrice) {
        this._processSide(bids, 'buy', now, currentPrice);
        this._processSide(asks, 'sell', now, currentPrice);
        
        // Evaluate currently active walls
        this.activeBuyWall = this._getBestWall('buy');
        this.activeSellWall = this._getBestWall('sell');
    }
    
    _processSide(levels, type, now, currentPrice) {
        // Calculate median bid/ask size for dynamic threshold
        if(!levels.length) return;
        const sizes = levels.map(l => l[0]*l[1]).sort((a,b) => a-b);
        const medianSize = sizes[Math.floor(sizes.length/2)];
        
        for(let [p, q] of levels) {
            const size = p * q;
            // A wall must be >= 4x median size
            const isWallSized = size >= medianSize * 4;
            
            if (this.trackedWalls.has(p)) {
                let wall = this.trackedWalls.get(p);
                if (wall.type !== type) { this.trackedWalls.delete(p); continue; }
                
                // Refill check
                if (size > wall.currentSize * 1.05) wall.refills++;
                
                // Fill vs Cancel estimation (simplified since we don't have L3 data)
                if (size < wall.currentSize) {
                    const drop = wall.currentSize - size;
                    // If price is very close, assume filled, else cancelled
                    if (Math.abs(p - currentPrice) / currentPrice < 0.0005) {
                        wall.fills += drop;
                    } else {
                        wall.cancels += drop;
                    }
                }
                
                wall.currentSize = size;
                wall.lastSeen = now;
            } else if (isWallSized) {
                this.trackedWalls.set(p, {
                    type, initialSize: size, currentSize: size, birth: now, lastSeen: now,
                    refills: 0, fills: 0, cancels: 0, initialPrice: currentPrice
                });
            }
        }
        
        // Cleanup dead walls
        for (let [p, wall] of this.trackedWalls.entries()) {
            if (now - wall.lastSeen > 2000) this.trackedWalls.delete(p);
        }
    }
    
    _getBestWall(type) {
        let bestScore = 0;
        let bestWall = null;
        const now = Date.now();
        
        for (let wall of this.trackedWalls.values()) {
            if(wall.type !== type) continue;
            const lifetimeSec = (now - wall.birth) / 1000;
            const cancelRatio = wall.cancels / (wall.initialSize || 1);
            const fillRatio = wall.fills / (wall.initialSize || 1);
            const priceReaction = (this.core.lastPrice - wall.initialPrice) / (wall.initialPrice || 1);
            
            // Rules
            if (lifetimeSec < 30) continue;
            if (wall.refills < 3) continue;
            if (cancelRatio > 0.15) continue;
            if (fillRatio < 0.40) continue;
            
            // Price Reaction: Price must not drop > 0.15% (for Buy Wall)
            if (type === 'buy' && priceReaction < -0.0015) continue;
            if (type === 'sell' && priceReaction > 0.0015) continue;
            
            // Score Calculation
            let score = 25; // Size (assuming it passed 4x median)
            score += Math.min(20, (lifetimeSec/60)*20);
            score += Math.min(20, (wall.refills/10)*20);
            score += Math.max(0, 20 - (cancelRatio*100));
            score += 15; // Price reaction passed
            
            if (score > bestScore) {
                bestScore = score;
                bestWall = { ...wall, score };
            }
        }
        
        if(!bestWall) return { status: 'Rejected', confidence: 0 };
        return {
            status: bestWall.score >= 60 ? 'Valid' : 'Rejected',
            confidence: bestWall.score,
            detail: bestWall.score >= 90 ? 'Strong' : (bestWall.score >= 80 ? 'Medium' : 'Weak')
        };
    }
}

// ==========================================
// 2. ABSORPTION ENGINE
// ==========================================
class AbsorptionEngine {
    constructor(core) {
        this.core = core;
        this.deltaWindow = [];
        this.sumDelta = 0;
        this.marketBuy = 0;
        this.marketSell = 0;
        this.initialPrice = 0;
    }
    
    processTrade(trade, depth) {
        this.deltaWindow.push(trade);
        this.sumDelta += trade.isBuy ? trade.notional : -trade.notional;
        if(trade.isBuy) this.marketBuy += trade.notional;
        else this.marketSell += trade.notional;
        
        if(this.initialPrice === 0) this.initialPrice = trade.price;
        
        const now = Date.now();
        while(this.deltaWindow.length && now - this.deltaWindow[0].time > 60000) {
            const old = this.deltaWindow.shift();
            this.sumDelta -= old.isBuy ? old.notional : -old.notional;
            if(old.isBuy) this.marketBuy -= old.notional;
            else this.marketSell -= old.notional;
        }
    }
    
    evaluate() {
        // Condition: Negative Delta minimum -250 BTC (approx -$16M at 64k)
        if (this.sumDelta > -16000000) return { status: 'Rejected', confidence: 0 };
        
        // Price validation: must not drop > 0.20%
        const priceDrop = (this.core.lastPrice - this.initialPrice) / (this.initialPrice || 1);
        if (priceDrop < -0.0020) return { status: 'Rejected', confidence: 0 };
        
        // Buy Wall Validation
        const bw = this.core.wallEngine.activeBuyWall;
        if (!bw || bw.confidence < 90) return { status: 'Rejected', confidence: 0 };
        
        // Funding Validation
        if (Math.abs(this.core.fundingRate) > 0.0001) return { status: 'Rejected', confidence: 0 };
        
        // Market Sell > Market Buy * 2
        if (this.marketSell < this.marketBuy * 2) return { status: 'Rejected', confidence: 0 };
        
        // Calculate Confidence
        let conf = 25; // Delta
        conf += 20; // Buy Wall
        conf += 20; // Refill
        conf += 15; // OI Proxy
        conf += 10; // Price 
        conf += 10; // Funding
        
        return { status: 'Valid', confidence: conf };
    }
}

// ==========================================
// 3. SPOOF ENGINE
// ==========================================
class SpoofEngine {
    constructor(core) {
        this.core = core;
        this.lastSpoof = null;
    }
    processDepth(bids, asks, now) {
        for (let [price, wall] of this.core.wallEngine.trackedWalls.entries()) {
            if (wall.cancels > 5 && wall.initialSize > 300000 && (now - wall.birth < 60000)) {
                this.lastSpoof = { time: now, confidence: Math.min(95, 60 + wall.cancels * 5), side: wall.type === 'buy' ? 'LONG' : 'SHORT' };
            }
        }
    }
    evaluate() {
        if (!this.lastSpoof || Date.now() - this.lastSpoof.time > 60000) {
            return { status: 'Rejected', confidence: 0 };
        }
        return { status: 'Valid', confidence: this.lastSpoof.confidence, side: this.lastSpoof.side };
    }
}

// ==========================================
// 4. ICEBERG ENGINE
// ==========================================
class IcebergEngine {
    constructor(core) {
        this.core = core;
        this.hits = new Map();
        this.lastIceberg = null;
    }
    processTrade(trade) {
        const p = trade.price;
        const now = trade.time;
        if(!this.hits.has(p)) this.hits.set(p, { count: 0, volume: 0, firstTrade: now });
        const h = this.hits.get(p);
        h.count++;
        h.volume += trade.notional;
        h.lastTrade = now;
        
        for (let [price, data] of this.hits.entries()) {
            if (now - data.lastTrade > 120000) this.hits.delete(price);
        }
        
        if (h.count >= 8 && h.volume > 200000 && (now - h.firstTrade < 60000)) {
            this.lastIceberg = { time: now, confidence: Math.min(95, 70 + (h.volume / 20000)), side: trade.isBuy ? 'LONG' : 'SHORT' };
        }
    }
    evaluate() {
        if (!this.lastIceberg || Date.now() - this.lastIceberg.time > 60000) {
            return { status: 'Rejected', confidence: 0 };
        }
        return { status: 'Valid', confidence: this.lastIceberg.confidence, side: this.lastIceberg.side };
    }
}

// ==========================================
// 5. WHALE ENGINE
// ==========================================
class WhaleEngine {
    constructor(core) {
        this.core = core;
        this.lastWhale = null;
    }
    
    processTrade(trade, medianTradeSize) {
        const threshold = medianTradeSize * 20;
        if (trade.notional >= threshold) {
            this.lastWhale = { type: 'Aggressive', side: trade.isBuy ? 'LONG' : 'SHORT', confidence: 85, time: trade.time };
        }
    }
    
    evaluate() {
        if (!this.lastWhale || Date.now() - this.lastWhale.time > 60000) {
            return { status: 'Rejected', confidence: 0 };
        }
        return { status: 'Valid', confidence: this.lastWhale.confidence, side: this.lastWhale.side };
    }
}

// ==========================================
// 6. LIQUIDITY MIGRATION
// ==========================================
class MigrationEngine {
    constructor(core) { 
        this.core = core; 
        this.lastMigration = null;
        this.history = [];
    }
    processDepth(bids, asks, now) {
        if (!bids.length || !asks.length) return;
        this.history.push({ time: now, bestBid: bids[0][0], bestAsk: asks[0][0] });
        if (this.history.length > 50) this.history.shift();
        
        let bidMovesUp = 0;
        let askMovesDown = 0;
        for (let i = 1; i < this.history.length; i++) {
            if (this.history[i].bestBid > this.history[i-1].bestBid) bidMovesUp++;
            if (this.history[i].bestAsk < this.history[i-1].bestAsk) askMovesDown++;
        }
        
        if (bidMovesUp > 5 && askMovesDown < 2) {
            this.lastMigration = { time: now, confidence: Math.min(95, 60 + bidMovesUp * 5), side: 'LONG' };
        } else if (askMovesDown > 5 && bidMovesUp < 2) {
            this.lastMigration = { time: now, confidence: Math.min(95, 60 + askMovesDown * 5), side: 'SHORT' };
        }
    }
    evaluate() {
        if (!this.lastMigration || Date.now() - this.lastMigration.time > 60000) {
            return { status: 'Rejected', confidence: 0 };
        }
        return { status: 'Valid', confidence: this.lastMigration.confidence, side: this.lastMigration.side };
    }
}

// ==========================================
// 7. TRAP ENGINE
// ==========================================
class TrapEngine {
    constructor(core) { 
        this.core = core; 
        this.lastTrap = null;
        this.localHigh = { price: 0, time: 0 };
        this.localLow = { price: Infinity, time: 0 };
    }
    processTrade(trade) {
        const now = trade.time;
        if (trade.price > this.localHigh.price) this.localHigh = { price: trade.price, time: now };
        if (trade.price < this.localLow.price) this.localLow = { price: trade.price, time: now };
        
        if (this.localHigh.price > 0 && (this.localHigh.price - trade.price)/this.localHigh.price > 0.0015 && (now - this.localHigh.time < 30000)) {
            this.lastTrap = { time: now, confidence: 85, side: 'SHORT' };
            this.localHigh = { price: trade.price, time: now };
        }
        if (this.localLow.price < Infinity && (trade.price - this.localLow.price)/this.localLow.price > 0.0015 && (now - this.localLow.time < 30000)) {
            this.lastTrap = { time: now, confidence: 85, side: 'LONG' };
            this.localLow = { price: trade.price, time: now };
        }
    }
    evaluate() {
        if (!this.lastTrap || Date.now() - this.lastTrap.time > 60000) {
            return { status: 'Rejected', confidence: 0 };
        }
        return { status: 'Valid', confidence: this.lastTrap.confidence, side: this.lastTrap.side };
    }
}

// ==========================================
// 8. EVIDENCE ENGINE
// ==========================================
class EvidenceEngine {
    constructor(core) {
        this.core = core;
        this.score = 0;
        this.results = [];
    }
    
    evaluate() {
        const weights = {
            'Buy Wall': { fn: () => this.core.wallEngine.activeBuyWall || { status: 'Rejected', confidence: 0 }, max: 22 },
            'Sell Wall': { fn: () => this.core.wallEngine.activeSellWall || { status: 'Rejected', confidence: 0 }, max: 22 },
            'Whale': { fn: () => this.core.whaleEngine.evaluate(), max: 15 },
            'Absorption': { fn: () => this.core.absorptionEngine.evaluate(), max: 30 },
            'Iceberg': { fn: () => this.core.icebergEngine.evaluate(), max: 5 },
            'Spoof': { fn: () => this.core.spoofEngine.evaluate(), max: 10 },
            'Liquidity Migration': { fn: () => this.core.migrationEngine.evaluate(), max: 18 },
            'Trap': { fn: () => this.core.trapEngine.evaluate(), max: 20 },
            'Delta': { fn: () => {
                const sumDelta = this.core.absorptionEngine.sumDelta;
                if (Math.abs(sumDelta) > 50000) return { status: 'Valid', confidence: Math.min(95, 60 + Math.abs(sumDelta)/50000), side: sumDelta > 0 ? 'LONG' : 'SHORT' };
                return { status: 'Rejected', confidence: 0 };
            }, max: 8 },
            'OI': { fn: () => {
                const vol = this.core.volatility;
                if (vol > 0.0005) return { status: 'Valid', confidence: Math.min(95, 60 + vol*100000), side: 'LONG' };
                return { status: 'Rejected', confidence: 0 };
            }, max: 7 },
            'Funding': { fn: () => {
                const f = this.core.fundingRate;
                if (Math.abs(f) > 0.0001) return { status: 'Valid', confidence: Math.min(95, 60 + Math.abs(f)*100000), side: f < 0 ? 'LONG' : 'SHORT' };
                return { status: 'Rejected', confidence: 0 };
            }, max: 3 }
        };
        
        let total = 0;
        this.results = [];
        
        for(let [name, eng] of Object.entries(weights)) {
            const res = eng.fn();
            let awarded = 0;
            if (res.status === 'Valid') awarded = eng.max;
            else if (res.status === 'Candidate') awarded = Math.floor(eng.max / 2);
            
            if (name === 'Sell Wall' && awarded > 0) awarded = -awarded; // Negative logic
            if (name === 'Whale' && res.side === 'SHORT' && awarded > 0) awarded = -awarded; // Whale Short is negative
            
            total += awarded;
            
            this.results.push({ name, status: res.status, confidence: res.confidence, weight: awarded, side: res.side });
        }
        
        this.score = total;
    }
}

// ==========================================
// 9 & 10. ENTRY & EXIT ENGINE
// ==========================================
class ExecutionEngine {
    constructor(core) {
        this.core = core;
        this.activePosition = null;
    }
    
    evaluate() {
        if (this.activePosition) {
            this._evaluateExit();
        } else {
            this._evaluateEntry();
        }
    }
    
    _evaluateEntry() {
        // Gate 3: Math.abs(Evidence Score) >= 100
        if (Math.abs(this.core.evidenceEngine.score) < 100) return;
        
        const p = this.core.lastPrice;
        if (p <= 0) return;
        
        let isLong = false;
        let isShort = false;
        const ev = this.core.evidenceEngine.results;
        
        const whale = ev.find(e => e.name === 'Whale');
        const buyW = ev.find(e => e.name === 'Buy Wall');
        const sellW = ev.find(e => e.name === 'Sell Wall');
        
        if (buyW && buyW.status === 'Valid' && whale && whale.status === 'Valid' && this.core.whaleEngine.lastWhale.side === 'LONG') {
            isLong = true;
        } else if (sellW && sellW.status === 'Valid' && whale && whale.status === 'Valid' && this.core.whaleEngine.lastWhale.side === 'SHORT') {
            isShort = true;
        }
        
        if (isLong) {
            this.activePosition = { type: 'LONG', entryPrice: p, sl: p * 0.99, tp: p * 1.02, reason: 'Evidence Score > 100 & Gated Passed' };
        } else if (isShort) {
            this.activePosition = { type: 'SHORT', entryPrice: p, sl: p * 1.01, tp: p * 0.98, reason: 'Evidence Score > 100 & Gated Passed' };
        }
    }
    
    _evaluateExit() {
        const p = this.core.lastPrice;
        const pos = this.activePosition;
        
        if (pos.type === 'LONG') {
            if (p <= pos.sl || p >= pos.tp) this.activePosition = null;
        } else {
            if (p >= pos.sl || p <= pos.tp) this.activePosition = null;
        }
        
        if (Math.abs(this.core.evidenceEngine.score) < 40) {
            this.activePosition = null;
        }
    }
}

// Export for browser
if (typeof window !== 'undefined') {
    window.AgnoiaEngine = AgnoiaEngine;
}


window.updateAdaptiveSettings = function() {
    console.log('Settings changed, pending apply...');
};

window.applyAdaptiveSettings = function() {
    const capSize = document.getElementById('capSizeSelect')?.value || 'ALL';
    const timeframe = document.getElementById('timeframeSelect')?.value || '1m';
    
    console.log('[Adaptive Engine] Applying settings:', { capSize, timeframe });
    
    // Send to backend via WebSocket if connected
    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({ type: 'UPDATE_SETTINGS', payload: { capSize, timeframe } }));
    }
    
    // Provide visual feedback
    const btn = document.querySelector('.run-btn');
    if (btn) {
        const originalText = btn.innerText;
        btn.innerText = 'APPLIED TO ENGINE ?';
        btn.style.background = 'var(--green)';
        setTimeout(() => {
            btn.innerText = originalText;
            btn.style.background = 'linear-gradient(135deg,var(--cyan),var(--cyan))';
        }, 2000);
    }
};

