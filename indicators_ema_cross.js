// ═══════════════════════════════════════════════════════════════
// indicators_ema_cross.js — EMA 9×15 Crossover
// ═══════════════════════════════════════════════════════════════
window.INDICATORS = window.INDICATORS || {};

window.INDICATORS.EMA_CROSS = {
  _state: { lastSigType:null, lastSigTime:0, activeTrade:null, series:[], priceLines:[] },
  _cs:null, _chart:null,

  onLoad: function(chartRef, csRef, candles, sym, rr) {
    this._chart=chartRef; this._cs=csRef;
    window._chartRef=chartRef; window._csRef=csRef;
    this._drawLines(candles, rr);
  },

  onCandle: function(closed, allCandles, rr) {
    var sym = window.curSym;
    // Check exit first
    if (this._state.activeTrade) {
      var t=this._state.activeTrade, c=closed;
      if(t.type==='buy'){
        if(c.low<=t.sl){this._state.activeTrade=null;this._clearPL();return{type:'buy_sl',price:t.sl,entry:t.entry,sl:t.sl,tgt:t.tgt,rp:t.rp,rr:t.rr};}
        if(c.high>=t.tgt){this._state.activeTrade=null;this._clearPL();return{type:'buy_tgt',price:t.tgt,entry:t.entry,sl:t.sl,tgt:t.tgt,rp:t.rp,rr:t.rr};}
      } else {
        if(c.high>=t.sl){this._state.activeTrade=null;this._clearPL();return{type:'sell_sl',price:t.sl,entry:t.entry,sl:t.sl,tgt:t.tgt,rp:t.rp,rr:t.rr};}
        if(c.low<=t.tgt){this._state.activeTrade=null;this._clearPL();return{type:'sell_tgt',price:t.tgt,entry:t.entry,sl:t.sl,tgt:t.tgt,rp:t.rp,rr:t.rr};}
      }
      return null;
    }

    if (allCandles.length<20) return null;
    var closed_candles = allCandles.slice(0,-1);
    if (closed_candles.length<16) return null;

    var fast=this._ema(closed_candles,9), slow=this._ema(closed_candles,15);
    var n=fast.length;
    var fC=fast[n-1].value, sC=slow[n-1].value, fP=fast[n-2]&&fast[n-2].value, sP=slow[n-2]&&slow[n-2].value;
    if(!fC||!sC||!fP||!sP) return null;

    var sig=null;
    if(fP<=sP&&fC>sC)sig='buy';
    else if(fP>=sP&&fC<sC)sig='sell';
    if(!sig) return null;
    if(sig===this._state.lastSigType) return null;
    if(closed.time===this._state.lastSigTime) return null;

    this._state.lastSigType=sig; this._state.lastSigTime=closed.time;
    var entry=closed.close;
    var isInd=window.isI?window.isI(sym):sym.endsWith('.NS');
    var rp=isInd?(rr.riskPct||1):(rr.cryptoRiskPct||0.5);
    var rrR=isInd?(rr.rrRatio||2):(rr.cryptoRRRatio||1.5);
    var slD=entry*rp/100;
    var sl=sig==='buy'?entry-slD:entry+slD;
    var tgt=sig==='buy'?entry+slD*rrR:entry-slD*rrR;

    this._state.activeTrade={type:sig,entry:entry,sl:sl,tgt:tgt,rp:rp,rr:rrR};
    this._clearPL();
    this._addPL(entry,'#ffffff',2,0,'EMA '+sig.toUpperCase());
    this._addPL(sl,'#ff4560',1,2,'SL('+rp+'%)');
    this._addPL(tgt,'#00d085',1,2,'TGT(1:'+rrR+')');

    return {type:sig, price:entry, entry:entry, sl:sl, tgt:tgt, rp:rp, rr:rrR};
  },

  _ema: function(candles, period) {
    var r=[],ema=null,k=2/(period+1);
    for(var i=0;i<candles.length;i++){
      if(i<period-1){r.push({time:candles[i].time,value:null});continue;}
      if(ema===null)ema=candles.slice(0,period).reduce(function(s,x){return s+x.close;},0)/period;
      else ema=candles[i].close*k+ema*(1-k);
      r.push({time:candles[i].time,value:ema});
    }
    return r;
  },

  _drawLines: function(candles, rr) {
    this._state.series.forEach(function(s){try{window._chartRef&&window._chartRef.removeSeries(s);}catch(e){}});
    this._state.series=[];
    if(!this._chart||!candles.length)return;
    var fast=this._ema(candles,9), slow=this._ema(candles,15);
    var sf=this._chart.addLineSeries({color:'#4c8eff',lineWidth:1,title:'EMA9',lastValueVisible:true,priceLineVisible:false});
    var ss=this._chart.addLineSeries({color:'#f59e0b',lineWidth:1,title:'EMA15',lastValueVisible:true,priceLineVisible:false});
    sf.setData(fast.filter(function(v){return v.value!=null;}));
    ss.setData(slow.filter(function(v){return v.value!=null;}));
    var markers=[];
    for(var i=1;i<fast.length;i++){
      if(!fast[i].value||!slow[i].value||!fast[i-1].value||!slow[i-1].value)continue;
      if(fast[i-1].value<=slow[i-1].value&&fast[i].value>slow[i].value)
        markers.push({time:candles[i].time,position:'belowBar',color:'#00d085',shape:'arrowUp',text:'BUY'});
      else if(fast[i-1].value>=slow[i-1].value&&fast[i].value<slow[i].value)
        markers.push({time:candles[i].time,position:'aboveBar',color:'#ff4560',shape:'arrowDown',text:'SELL'});
    }
    if(markers.length)sf.setMarkers(markers);
    this._state.series=[sf,ss];
  },

  _addPL:function(price,color,width,style,title){
    if(!this._cs)return;
    try{var lw=LightweightCharts.LineStyle;var ls=style===2?lw.Dashed:style===1?lw.LargeDashed:lw.Solid;var pl=this._cs.createPriceLine({price:price,color:color,lineWidth:width,lineStyle:ls,title:title});this._state.priceLines.push(pl);}catch(e){}
  },
  _clearPL:function(){var cs=this._cs;this._state.priceLines.forEach(function(pl){try{cs.removePriceLine(pl);}catch(e){}});this._state.priceLines=[];},
  onRemove:function(){this._state.series.forEach(function(s){try{window._chartRef&&window._chartRef.removeSeries(s);}catch(e){}});this._clearPL();this._state.activeTrade=null;}
};

console.log('[INDICATORS] EMA Cross ✅');
