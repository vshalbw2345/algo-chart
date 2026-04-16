// ═══════════════════════════════════════════════════════════════
// CANDLE COLOR INDICATOR — Green=BUY / Red=SELL
// File: indicators_candle_color.js
// ═══════════════════════════════════════════════════════════════

window.INDICATORS = window.INDICATORS || {};

window.INDICATORS.CANDLE_COLOR = {
  id: 'candle_color',
  name: 'Candle Color (Green=BUY / Red=SELL)',
  type: 'candle_color',

  _state: {
    lastSigTime: 0,
    activeTrade: null,
    priceLines: []
  },

  onLoad: function(chartRef, csRef, allCandles, curSym, rrCfg) {
    this._chart = chartRef; this._cs = csRef;
    this._sym = curSym;
    window._csRef = csRef; window._chartRef = chartRef;
    this._drawMarkers(allCandles);
    return this;
  },

  onCandle: function(closedCandle, allCandles, rrCfg) {
    this._sym = window.curSym;

    // Check active trade exit
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
      return null; // block new signal
    }

    if (!allCandles || allCandles.length < 2) return null;
    const prev = allCandles[allCandles.length - 3]; // candle before closed
    const cur  = closedCandle;
    if (!prev) return null;
    if (cur.time === this._state.lastSigTime) return null;

    const curGreen = cur.close > cur.open;
    const prvGreen = prev.close > prev.open;
    if (curGreen === prvGreen) return null; // no color change

    this._state.lastSigTime = cur.time;
    const sigType = curGreen ? 'buy' : 'sell';
    const entry = cur.close;
    const isIndian = window.isI ? window.isI(this._sym) : this._sym.endsWith('.NS');
    const rp  = isIndian ? (rrCfg.riskPct || 1)   : (rrCfg.cryptoRiskPct || 0.5);
    const rr  = isIndian ? (rrCfg.rrRatio || 2)   : (rrCfg.cryptoRRRatio || 1.5);
    const slD = entry * rp / 100;
    const sl  = curGreen ? entry - slD : entry + slD;
    const tgt = curGreen ? entry + slD * rr : entry - slD * rr;

    this._state.activeTrade = { type: sigType, entry, sl, tgt };
    this._clearPriceLines();
    this._addPriceLine(entry, '#ffffff', 2, 0, sigType.toUpperCase() + ' Entry');
    this._addPriceLine(sl,    '#ff4560', 1, 2, 'SL (' + rp + '%)');
    this._addPriceLine(tgt,   '#00d085', 1, 2, 'TGT (1:' + rr + ')');

    return { type: sigType, price: entry, entry, sl, tgt, rp, rr };
  },

  _drawMarkers: function(candles) {
    if (!this._cs || !candles.length) return;
    const markers = [];
    for (var i = 1; i < candles.length; i++) {
      const cur = candles[i], prv = candles[i-1];
      if ((cur.close > cur.open) && !(prv.close > prv.open))
        markers.push({ time:cur.time, position:'belowBar', color:'#00d085', shape:'arrowUp',   text:'BUY' });
      else if (!(cur.close > cur.open) && (prv.close > prv.open))
        markers.push({ time:cur.time, position:'aboveBar', color:'#ff4560', shape:'arrowDown', text:'SELL' });
    }
    try { this._cs.setMarkers(markers); } catch(e) {}
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
    this._clearPriceLines();
    try { this._cs.setMarkers([]); } catch(e) {}
    this._state.activeTrade = null;
  }
};

console.log('[INDICATORS] Candle Color loaded ✅');
