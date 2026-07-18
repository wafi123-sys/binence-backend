function renderLiquidityProfile() {
  if (currentView !== 'heatmap' || !lwcChart || !lwcSeries) return;
  try {
    const canvas = document.getElementById('heatmapChart');
    const ctx = canvas.getContext('2d');
    
    const container = document.getElementById('lwcContainer');
    if (canvas.width !== container.offsetWidth || canvas.height !== container.offsetHeight) {
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
      lwcChart.resize(canvas.width, canvas.height);
    }
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (!lwcSeries || !lastCandle) {
      ctx.fillStyle = '#8892a4';
      ctx.font = '12px Inter';
      ctx.fillText('Memuat Grafik & Data Likuiditas...', 10, 20);
      return;
    }
    
    const { asks, bids } = orderBook;
    if (!asks.length || !bids.length) return;
    
    // In LightweightCharts v4+, priceScale methods are on the series for data coordinates
    const maxPriceVisible = lwcSeries.coordinateToPrice(0);
    const minPriceVisible = lwcSeries.coordinateToPrice(canvas.height);
    
    if (maxPriceVisible === null || minPriceVisible === null) return;
    
    let maxVol = 0;
    for(const a of asks) if(a.price <= maxPriceVisible && a.qty > maxVol) maxVol = a.qty;
    for(const b of bids) if(b.price >= minPriceVisible && b.qty > maxVol) maxVol = b.qty;
    
    if (maxVol === 0) return;
    
    const filterThreshold = maxVol * (currentHeatmapFilter / 100);
    
    // LightweightCharts Right Price Scale is ~60px wide. We offset bars so they end before the axis text.
    const priceScaleWidth = 60;
    const chartAreaWidth = canvas.width - priceScaleWidth;
    const maxBarWidth = chartAreaWidth * 0.45; // 45% of the visible chart area
    
    const drawBars = (list, colorFn) => {
      for (const item of list) {
        if (item.price > maxPriceVisible || item.price < minPriceVisible) continue;
        if (item.qty < filterThreshold) continue; // Whale Filter logic
        
        const y = lwcSeries.priceToCoordinate(item.price);
        if (y !== null && y !== undefined) {
          // Boost visibility of smaller orders using Math.pow
          const ratio = Math.pow(item.qty / maxVol, 0.4); 
          const width = ratio * maxBarWidth;
          if (width < 1) continue;
          
          ctx.fillStyle = colorFn(item.qty, maxVol);
          // Draw rectangle centered on Y
          ctx.fillRect(chartAreaWidth - width, Math.floor(y) - 3, width, 6);
        }
      }
    };
    
    // Ask colors (Sells) -> Red
    drawBars(asks, (q, m) => {
      const ratio = Math.pow(q / m, 0.5);
      return `rgba(255, 50, 80, ${0.1 + (0.8 * ratio)})`;
    });
    
    // Bid colors (Buys) -> Green
    drawBars(bids, (q, m) => {
      const ratio = Math.pow(q / m, 0.5);
      return `rgba(0, 212, 168, ${0.1 + (0.8 * ratio)})`;
    });
  } catch (e) {
    console.error('Liquidity Profile error:', e);
  }
}

// ==============================================
// AI SMART MONEY SCORING ENGINE
// ==============================================
