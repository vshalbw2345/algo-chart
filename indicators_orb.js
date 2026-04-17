// ═══════════════════════════════════════════════════════════════
// indicators_orb.js — ORB Opening Range Breakout
// Self-contained. No chart.html changes needed.
// ═══════════════════════════════════════════════════════════════
window.INDICATORS = window.INDICATORS || {};

window.INDICATORS.ORB = {
  _state: { activeTrade:null, lastSigTime:0, priceLines:[] },
  _cs: null, _chart: null,

  onLoad: function(chartRef, csRef, candles, sym, rr) {
    this._chart=chartRef; this._cs=csRef;
    this._drawLevels(candles, sym);
    this._drawHistory(candles, sym, rr);
  },

  onCandle: function(closed, allCandles, rr) {
    var sym = window.curSym;
    // Check active trade exit first
    if (this._state.activeTrade) {
      var t = this._state.activeTrade;
      var c = closed;
      if (t.type==='buy') {
        if (c.low<=t.sl)  { this._state.activeTrade=null; this._clearPL(); return {type:'buy_sl', price:t.sl, entry:t.entry, sl:t.sl, tgt:t.tgt, rp:t.rp, rr:t.rr}; }
        if (c.high>=t.tgt){ this._state.activeTrade=null; this._clearPL(); return {type:'buy_tgt',price:t.tgt,entry:t.entry, sl:t.sl, tgt:t.tgt, rp:t.rp, rr:t.rr}; }
      } else {
        if (c.high>=t.sl) { this._state.activeTrade=null; this._clearPL(); return {type:'sell_sl', price:t.sl, entry:t.entry, sl:t.sl, tgt:t.tgt, rp:t.rp, rr:t.rr}; }
        if (c.low<=t.tgt) { this._state.activeTrade=null; this._clearPL(); return {type:'sell_tgt',price:t.tgt,entry:t.entry, sl:t.sl, tgt:t.tgt, rp:t.rp, rr:t.rr}; }
      }
      return null; // active trade — block
    }

    var orb = this._getToday(allCandles);
    if (!orb) return null;
    var c = closed;
    var isBuy  = c.close>orb.high && c.low<orb.high;
    var isSell = c.close<orb.low  && c.high>orb.low;
    if (!isBuy && !isSell) return null;
    if (c.time === this._state.lastSigTime) return null;
    this._state.lastSigTime = c.time;

    var sigType = isBuy ? 'buy' : 'sell';
    var entry = c.close;
    var isInd = window.isI ? window.isI(sym) : sym.endsWith('.NS');
    var rp = isInd ? (rr.riskPct||1) : (rr.cryptoRiskPct||0.5);
    var rrR= isInd ? (rr.rrRatio||2) : (rr.cryptoRRRatio||1.5);
    var slD = entry*rp/100;
    var sl  = isBuy ? entry-slD : entry+slD;
    var tgt = isBuy ? entry+slD*rrR : entry-slD*rrR;

    this._state.activeTrade = {type:sigType,entry:entry,sl:sl,tgt:tgt,rp:rp,rr:rrR};
    this._clearPL();
    this._addPL(entry,'#ffffff',2,0,'ORB '+sigType.toUpperCase());
    this._addPL(sl,'#ff4560',1,2,'SL('+rp+'%)');
    this._addPL(tgt,'#00d085',1,2,'TGT(1:'+rrR+')');

    console.log('[ORB] Signal: '+sigType+' @ '+entry);
    return {type:sigType, price:entry, entry:entry, sl:sl, tgt:tgt, rp:rp, rr:rrR};
  },

  _getToday: function(candles) {
    var today = new Date().toDateString();
    for (var i=0; i<candles.length; i++) {
      var d = new Date(candles[i].time*1000);
      if (d.toDateString() !== today) continue;
      var utcM = d.getUTCHours()*60+d.getUTCMinutes();
      var istM = (utcM+330)%(24*60);
      var istH = Math.floor(istM/60), istMn = istM%60;
      if (istH===9 && istMn>=15 && istMn<=25) {
        return {high:candles[i].high, low:candles[i].low};
      }
    }
    return null;
  },

  _drawLevels: function(candles, sym) {
    // Draw ONLY TODAY's ORB levels
    var orb = this._getToday(candles);
    if (!orb) { console.warn('[ORB] No 9:15 candle found. Use 5M TF on Indian stock after 9:15 IST.'); return; }
    this._clearPL();
    this._addPL(orb.high, '#00d085', 2, 0, 'ORB H');
    this._addPL(orb.low,  '#ff4560', 2, 0, 'ORB L');
    console.log('[ORB] Levels H:'+orb.high+' L:'+orb.low);
  },

  _drawHistory: function(candles, sym, rr) {
    // Build day map for historical signals
    var dayMap = {};
    candles.forEach(function(c) {
      var d = new Date(c.time*1000);
      var utcM = d.getUTCHours()*60+d.getUTCMinutes();
      var istM = (utcM+330)%(24*60);
      var istH = Math.floor(istM/60), istMn = istM%60;
      var dateStr = d.toDateString();
      if (istH===9 && istMn>=15 && istMn<=25 && !dayMap[dateStr]) {
        dayMap[dateStr] = {high:c.high, low:c.low};
      }
    });

    var markers = [], firedDays = {buy:{}, sell:{}};
    candles.forEach(function(c) {
      var d = new Date(c.time*1000).toDateString();
      var orb = dayMap[d]; if (!orb) return;
      var isBuy  = c.close>orb.high && c.low<orb.high;
      var isSell = c.close<orb.low  && c.high>orb.low;
      if (isBuy && !firedDays.buy[d])  { firedDays.buy[d]=true;  markers.push({time:c.time,position:'belowBar',color:'#00d085',shape:'arrowUp',text:'ORB BUY'}); }
      if (isSell && !firedDays.sell[d]){ firedDays.sell[d]=true; markers.push({time:c.time,position:'aboveBar',color:'#ff4560',shape:'arrowDown',text:'ORB SELL'}); }
    });
    if (markers.length && this._cs) {
      try { this._cs.setMarkers(markers); } catch(e) {}
      console.log('[ORB] '+markers.length+' historical signals plotted');
    }
  },

  _addPL: function(price, color, width, style, title) {
    if (!this._cs) return;
    try {
      var lw = LightweightCharts.LineStyle;
      var ls = style===2?lw.Dashed:style===1?lw.LargeDashed:lw.Solid;
      var pl = this._cs.createPriceLine({price:price, color:color, lineWidth:width, lineStyle:ls, title:title});
      this._state.priceLines.push(pl);
    } catch(e) {}
  },

  _clearPL: function() {
    var cs = this._cs;
    this._state.priceLines.forEach(function(pl){try{cs.removePriceLine(pl);}catch(e){}});
    this._state.priceLines = [];
  },

  onRemove: function() { this._clearPL(); this._state.activeTrade=null; }
};

console.log('[INDICATORS] ORB ✅');
