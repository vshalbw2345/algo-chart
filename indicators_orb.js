// ═══════════════════════════════════════════════════════════════
// ORB INDICATOR — 5min Opening Range Breakout
// File: indicators_orb.js
// Load in chart.html: <script src="indicators_orb.js"></script>
// ═══════════════════════════════════════════════════════════════

window.INDICATORS = window.INDICATORS || {};

window.INDICATORS.ORB = {
  id: 'orb',
  name: '5min ORB — Opening Range Breakout',
  version: '1.0',
  type: 'orb',

  // Active trade state — enforces condition 1
  // No new signal until SL or TGT of active trade is hit
  _state: {
    orbHigh: null,
    orbLow: null,
    lastDate: null,
    activeTrade: null,  // {type:'buy'|'sell', entry, sl, tgt, time}
    lastSigTime: 0,
    priceLines: []
  },

  // Called by chart when indicator is added
  onLoad: function(chartRef, csRef, allCandles, curSym, rrCfg) {
    this._chart = chartRef;
    this._cs = csRef;
    this._sym = curSym;
    this._rr = rrCfg;
    this._computeORB(allCandles);
    this._drawLines(allCandles);
    return this;
  },

  // Called on every new closed candle
  onCandle: function(closedCandle, allCandles, rrCfg) {
    this._rr = rrCfg;
    this._sym = window.curSym;

    // Recompute ORB levels for today
    this._computeORB(allCandles);

    if (!this._state.orbHigh || !this._state.orbLow) return null;

    const H = this._state.orbHigh;
    const L = this._state.orbLow;
    const c = closedCandle;
    if (!c || !c.close) return null;

    // Check if active trade SL or TGT was hit — if so, clear active trade
    if (this._state.activeTrade) {
      const t = this._state.activeTrade;
      if (t.type === 'buy') {
        if (c.low <= t.sl) {
          console.log('[ORB] BUY SL hit @ ' + c.low);
          this._state.activeTrade = null; // trade closed, ready for next signal
          this._clearLines();
          return { type: 'buy_sl', price: t.sl, entry: t.entry, sl: t.sl, tgt: t.tgt };
        }
        if (c.high >= t.tgt) {
          console.log('[ORB] BUY TGT hit @ ' + c.high);
          this._state.activeTrade = null;
          this._clearLines();
          return { type: 'buy_tgt', price: t.tgt, entry: t.entry, sl: t.sl, tgt: t.tgt };
        }
      } else if (t.type === 'sell') {
        if (c.high >= t.sl) {
          console.log('[ORB] SELL SL hit @ ' + c.high);
          this._state.activeTrade = null;
          this._clearLines();
          return { type: 'sell_sl', price: t.sl, entry: t.entry, sl: t.sl, tgt: t.tgt };
        }
        if (c.low <= t.tgt) {
          console.log('[ORB] SELL TGT hit @ ' + c.low);
          this._state.activeTrade = null;
          this._clearLines();
          return { type: 'sell_tgt', price: t.tgt, entry: t.entry, sl: t.sl, tgt: t.tgt };
        }
      }
      // Active trade still running — BLOCK new signals
      console.log('[ORB] Active trade running — blocking new signal');
      return null;
    }

    // No active trade — check for new breakout signal
    // BUY: candle closes above ORB high AND low was below ORB high (touched/crossed)
    const isBuy  = c.close > H && c.low < H;
    // SELL: candle closes below ORB low AND high was above ORB low (touched/crossed)
    const isSell = c.close < L && c.high > L;

    if (!isBuy && !isSell) return null;

    // Prevent same-bar duplicate
    if (c.time === this._state.lastSigTime) return null;
    this._state.lastSigTime = c.time;

    const sigType = isBuy ? 'buy' : 'sell';
    const entry   = c.close;
    const isIndian = window.isI ? window.isI(this._sym) : this._sym.endsWith('.NS');
    const rp  = isIndian ? (rrCfg.riskPct || 1)       : (rrCfg.cryptoRiskPct || 0.5);
    const rr  = isIndian ? (rrCfg.rrRatio || 2)       : (rrCfg.cryptoRRRatio || 1.5);
    const slD = entry * rp / 100;
    const sl  = isBuy ? entry - slD : entry + slD;
    const tgt = isBuy ? entry + slD * rr : entry - slD * rr;

    // Set active trade — blocks next signal until SL/TGT hit
    this._state.activeTrade = { type: sigType, entry, sl, tgt, time: c.time };

    // Draw entry, SL, TGT lines
    this._clearLines();
    this._addLine(entry, '#ffffff', 2, 0, 'ORB ' + sigType.toUpperCase() + ' Entry');
    this._addLine(sl,    '#ff4560', 1, 2, 'SL (' + rp + '%)');
    this._addLine(tgt,   '#00d085', 1, 2, 'TGT (1:' + rr + ')');

    console.log('[ORB] ' + sigType.toUpperCase() + ' @ ' + entry + ' SL:' + sl.toFixed(2) + ' TGT:' + tgt.toFixed(2));
    return { type: sigType, price: entry, entry, sl, tgt, rp, rr };
  },

  // Compute ORB high/low from first 5min candle of today
  _computeORB: function(candles) {
    const today = new Date().toDateString();
    if (this._state.lastDate !== today) {
      this._state.orbHigh = null;
      this._state.orbLow  = null;
      this._state.lastDate = today;
    }
    for (var i = 0; i < candles.length; i++) {
      const d = new Date(candles[i].time * 1000);
      if (d.toDateString() !== today) continue;
      // IST = UTC+5:30 → first candle is 09:15 IST = 03:45 UTC
      const utcMins = d.getUTCHours() * 60 + d.getUTCMinutes();
      const istMins = (utcMins + 330) % (24 * 60);
      if (istMins >= 555 && istMins < 560) { // 9:15–9:20 IST
        this._state.orbHigh = candles[i].high;
        this._state.orbLow  = candles[i].low;
        break;
      }
    }
  },

  // Draw ORB high/low as horizontal lines
  _drawLines: function(candles) {
    this._clearLines();
    if (!this._cs || !this._state.orbHigh) return;
    this._addLine(this._state.orbHigh, '#00d085', 2, 2, 'ORB H');
    this._addLine(this._state.orbLow,  '#ff4560', 2, 2, 'ORB L');
  },

  _addLine: function(price, color, width, style, title) {
    try {
      if (!this._cs) return;
      var lw = LightweightCharts.LineStyle;
      var ls = style === 2 ? lw.Dashed : style === 1 ? lw.LargeDashed : lw.Solid;
      var pl = this._cs.createPriceLine({ price, color, lineWidth: width, lineStyle: ls, title });
      this._state.priceLines.push(pl);
    } catch(e) {}
  },

  _clearLines: function() {
    this._state.priceLines.forEach(function(pl) {
      try { if (window._csRef) window._csRef.removePriceLine(pl); } catch(e) {}
    });
    this._state.priceLines = [];
  },

  // Called when indicator is removed
  onRemove: function() {
    this._clearLines();
    this._state.activeTrade = null;
  },

  // Returns current ORB levels (used by chart)
  getLevels: function() {
    return { high: this._state.orbHigh, low: this._state.orbLow };
  },

  // Returns active trade info
  getActiveTrade: function() {
    return this._state.activeTrade;
  }
};

console.log('[INDICATORS] ORB loaded ✅');
