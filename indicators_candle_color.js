// ═══════════════════════════════════════════════════════════════
// indicators_candle_color.js — Green=BUY / Red=SELL
// ═══════════════════════════════════════════════════════════════
window.INDICATORS = window.INDICATORS || {};

window.INDICATORS.CANDLE_COLOR = {
  _state: { lastSigTime:0, activeTrade:null, priceLines:[] },
  _cs:null, _chart:null,

  onLoad: function(chartRef, csRef, candles, sym, rr) {
    this._chart=chartRef; this._cs=csRef;
    this._drawHistory(candles);
  },

  onCandle: function(closed, allCandles, rr) {
    var sym=window.curSym;
    if(this._state.activeTrade){
      var t=this._state.activeTrade,c=closed;
      if(t.type==='buy'){
        if(c.low<=t.sl){this._state.activeTrade=null;this._clearPL();return{type:'buy_sl',price:t.sl,entry:t.entry,sl:t.sl,tgt:t.tgt,rp:t.rp,rr:t.rr};}
        if(c.high>=t.tgt){this._state.activeTrade=null;this._clearPL();return{type:'buy_tgt',price:t.tgt,entry:t.entry,sl:t.sl,tgt:t.tgt,rp:t.rp,rr:t.rr};}
      } else {
        if(c.high>=t.sl){this._state.activeTrade=null;this._clearPL();return{type:'sell_sl',price:t.sl,entry:t.entry,sl:t.sl,tgt:t.tgt,rp:t.rp,rr:t.rr};}
        if(c.low<=t.tgt){this._state.activeTrade=null;this._clearPL();return{type:'sell_tgt',price:t.tgt,entry:t.entry,sl:t.sl,tgt:t.tgt,rp:t.rp,rr:t.rr};}
      }
      return null;
    }
    if(!allCandles||allCandles.length<3)return null;
    var prev=allCandles[allCandles.length-3];
    if(!prev||closed.time===this._state.lastSigTime)return null;
    var curGreen=closed.close>closed.open, prvGreen=prev.close>prev.open;
    if(curGreen===prvGreen)return null;
    this._state.lastSigTime=closed.time;
    var sig=curGreen?'buy':'sell';
    var entry=closed.close;
    var isInd=window.isI?window.isI(sym):sym.endsWith('.NS');
    var rp=isInd?(rr.riskPct||1):(rr.cryptoRiskPct||0.5);
    var rrR=isInd?(rr.rrRatio||2):(rr.cryptoRRRatio||1.5);
    var slD=entry*rp/100;
    var sl=curGreen?entry-slD:entry+slD;
    var tgt=curGreen?entry+slD*rrR:entry-slD*rrR;
    this._state.activeTrade={type:sig,entry:entry,sl:sl,tgt:tgt,rp:rp,rr:rrR};
    this._clearPL();
    this._addPL(entry,'#ffffff',2,0,sig.toUpperCase()+' Entry');
    this._addPL(sl,'#ff4560',1,2,'SL('+rp+'%)');
    this._addPL(tgt,'#00d085',1,2,'TGT(1:'+rrR+')');
    return {type:sig,price:entry,entry:entry,sl:sl,tgt:tgt,rp:rp,rr:rrR};
  },

  _drawHistory:function(candles){
    if(!this._cs||!candles.length)return;
    var markers=[];
    for(var i=1;i<candles.length;i++){
      var cur=candles[i],prv=candles[i-1];
      if((cur.close>cur.open)&&!(prv.close>prv.open))markers.push({time:cur.time,position:'belowBar',color:'#00d085',shape:'arrowUp',text:'BUY'});
      else if(!(cur.close>cur.open)&&(prv.close>prv.open))markers.push({time:cur.time,position:'aboveBar',color:'#ff4560',shape:'arrowDown',text:'SELL'});
    }
    try{this._cs.setMarkers(markers);}catch(e){}
  },

  _addPL:function(price,color,width,style,title){
    if(!this._cs)return;
    try{var lw=LightweightCharts.LineStyle;var ls=style===2?lw.Dashed:style===1?lw.LargeDashed:lw.Solid;var pl=this._cs.createPriceLine({price:price,color:color,lineWidth:width,lineStyle:ls,title:title});this._state.priceLines.push(pl);}catch(e){}
  },
  _clearPL:function(){var cs=this._cs;this._state.priceLines.forEach(function(pl){try{cs.removePriceLine(pl);}catch(e){}});this._state.priceLines=[];},
  onRemove:function(){this._clearPL();try{this._cs.setMarkers([]);}catch(e){}this._state.activeTrade=null;}
};

console.log('[INDICATORS] Candle Color ✅');
