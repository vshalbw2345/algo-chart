// ═══════════════════════════════════════════════════════════════
// EMA CROSS INDICATOR — 9 × 15 EMA Crossover
// File: indicators_ema_cross.js
// ═══════════════════════════════════════════════════════════════

window.INDICATORS = window.INDICATORS || {};

window.INDICATORS.EMA_CROSS = {
  id: 'ema_cross',
  name: 'EMA Crossover (9 × 15)',
  type: 'ema_cross',

  _state: {
    lastSigType: null,  // last signal direction
    lastSigTime: 0,
    activeTrade: null,  // {type, entry, sl, tgt}
    series: [],
    priceLines: []
  },

  onLoad: function(chartRef, csRef, allCandles, curSym, rrCfg) {
    this._chart = chartRef;
    this._cs = csRef;
    this._sym = curSym;
    window._csRef = csRef;
    this._drawEMALines(allCandles, rrCfg);
    return this;
  },

  onCandle: function(closedCandle, allCandles, rrCfg) {
    this._sym = window.curSym;

    // Check active trade SL/TGT hit first
    if (this._state.activeTrade) {
      const t = this._state.activeTrade;
      const c = closedCandle;
      if (t.type === 'buy') {
        if (c.low <= t.sl)  { this._state.activeTrade = null; this._clearPriceLines(); return { type:'buy_sl',  price:t.sl,  entry:t.entry, sl:t.sl, tgt:t.tgt }; }
        if (c.high >= t.tgt){ this._state.activeTrade = null; this._clearPriceLines(); return { type:'buy_tgt', price:t.tgt, entry:t.entry, sl:t.sl, tgt:t.tgt }; }
      } else {
        if (c.high >= t.sl) { this._state.activeTrade = null; this._clearPriceLines(); return { type:'sell_sl',  price:t.sl,  entry:t.entry, sl:t.sl, tgt:t.tgt }; }
        if (c.low <= t.tgt) { this._state.activeTrade = null; this._clearPriceLines(); return { type:'sell_tgt', price:t.tgt, entry:t.entry, sl:t.sl, tgt:t.tgt }; }
      }
      return null; // active trade — block new signal
    }

    // Check for EMA crossover on closed candles
    if (allCandles.length < 20) return null;
    const closed = allCandles.slice(0, -1);
    if (closed.length < 16) return null;

    const fast = this._calcEMA(closed, 9);
    const slow = this._calcEMA(closed, 15);
    const len  = fast.length;
    const fCur = fast[len-1].value, sCur = slow[len-1].value;
    const fPrv = fast[len-2] && fast[len-2].value;
    const sPrv = slow[len-2] && slow[len-2].value;
    if (!fCur || !sCur || !fPrv || !sPrv) return null;

    let sigType = null;
    if (fPrv <= sPrv && fCur > sCur) sigType = 'buy';
    else if (fPrv >= sPrv && fCur < sCur) sigType = 'sell';
    if (!sigType) return null;

    // Block same direction repeat
    if (sigType === this._state.lastSigType) return null;
    if (closedCandle.time === this._state.lastSigTime) return null;

    this._state.lastSigType = sigType;
    this._state.lastSigTime = closedCandle.time;

    const entry = closedCandle.close;
    const isIndian = window.isI ? window.isI(this._sym) : this._sym.endsWith('.NS');
    const rp  = isIndian ? (rrCfg.riskPct || 1)   : (rrCfg.cryptoRiskPct || 0.5);
    const rr  = isIndian ? (rrCfg.rrRatio || 2)   : (rrCfg.cryptoRRRatio || 1.5);
    const slD = entry * rp / 100;
    const sl  = sigType === 'buy' ? entry - slD : entry + slD;
    const tgt = sigType === 'buy' ? entry + slD * rr : entry - slD * rr;

    this._state.activeTrade = { type: sigType, entry, sl, tgt };
    this._clearPriceLines();
    this._addPriceLine(entry, '#ffffff', 2, 0, 'EMA ' + sigType.toUpperCase());
    this._addPriceLine(sl,    '#ff4560', 1, 2, 'SL (' + rp + '%)');
    this._addPriceLine(tgt,   '#00d085', 1, 2, 'TGT (1:' + rr + ')');

    console.log('[EMA] ' + sigType.toUpperCase() + ' @ ' + entry);
    return { type: sigType, price: entry, entry, sl, tgt, rp, rr };
  },

  _drawEMALines: function(candles, rrCfg) {
    this._state.series.forEach(function(s) { try { window._chartRef && window._chartRef.removeSeries(s); } catch(e) {} });
    this._state.series = [];
    if (!this._chart || !candles.length) return;
    const fast = this._calcEMA(candles, 9);
    const slow = this._calcEMA(candles, 15);
    const sf = this._chart.addLineSeries({ color:'#4c8eff', lineWidth:1, title:'EMA9',  lastValueVisible:true,  priceLineVisible:false });
    const ss = this._chart.addLineSeries({ color:'#f59e0b', lineWidth:1, title:'EMA15', lastValueVisible:true,  priceLineVisible:false });
    sf.setData(fast.filter(function(v){ return v.value != null; }));
    ss.setData(slow.filter(function(v){ return v.value != null; }));
    // Markers for historical signals
    const markers = [];
    for (var i = 1; i < fast.length; i++) {
      if (!fast[i].value || !slow[i].value || !fast[i-1].value || !slow[i-1].value) continue;
      if (fast[i-1].value <= slow[i-1].value && fast[i].value > slow[i].value)
        markers.push({ time: candles[i].time, position:'belowBar', color:'#00d085', shape:'arrowUp',   text:'BUY' });
      else if (fast[i-1].value >= slow[i-1].value && fast[i].value < slow[i].value)
        markers.push({ time: candles[i].time, position:'aboveBar', color:'#ff4560', shape:'arrowDown', text:'SELL' });
    }
    if (markers.length) sf.setMarkers(markers);
    this._state.series = [sf, ss];
    window._chartRef = this._chart;
  },

  _calcEMA: function(candles, period) {
    var r = [], ema = null, k = 2 / (period + 1);
    for (var i = 0; i < candles.length; i++) {
      if (i < period - 1) { r.push({ time: candles[i].time, value: null }); continue; }
      if (ema === null) ema = candles.slice(0, period).reduce(function(s,x){ return s+x.close; }, 0) / period;
      else ema = candles[i].close * k + ema * (1 - k);
      r.push({ time: candles[i].time, value: ema });
    }
    return r;
  },

  _addPriceLine: function(price, color, width, style, title) {
    try {
      var lw = LightweightCharts.LineStyle;
      var ls = style===2?lw.Dashed:style===1?lw.LargeDashed:lw.Solid;
      var pl = this._cs.createPriceLine({ price, color, lineWidth: width, lineStyle: ls, title });
      this._state.priceLines.push(pl);
    } catch(e) {}
  },

  _clearPriceLines: function() {
    var cs = this._cs;
    this._state.priceLines.forEach(function(pl) { try { cs.removePriceLine(pl); } catch(e) {} });
    this._state.priceLines = [];
  },

  onRemove: function() {
    this._state.series.forEach(function(s) { try { window._chartRef && window._chartRef.removeSeries(s); } catch(e) {} });
    this._clearPriceLines();
    this._state.activeTrade = null;
  }
};

console.log('[INDICATORS] EMA Cross loaded ✅');
