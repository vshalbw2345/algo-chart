// ═══════════════════════════════════════════════════════════════
// chart_engine.js — UPDATED FOR 200ms TICK-BASED CANDLES
// ═══════════════════════════════════════════════════════════════
var liveData = {};	
// ── Global state ─────────────────────────────────────────────
var chart=null, cs=null, vs=null;
var curSym='BTCUSDT', curTF='5m';
var allCandles=[], openPrice=0;

var liveWs=null;
var wsRetry=0, wsRetryTimer=null;

var BN_IV={'1m':'1m','3m':'3m','5m':'5m','10m':'5m','15m':'15m','30m':'30m','1h':'1h','4h':'1h','1d':'1d'};

// ── Helpers ──────────────────────────────────────────────────
function f(n){if(n==null)return'—';return n>=10000?n.toFixed(2):n>=100?n.toFixed(2):n>=1?n.toFixed(4):n.toFixed(6);}

// ── Chart ────────────────────────────────────────────────────
var Chart={
  init:function(){
   // real code only
  },

  load:function(sym){
    ...
  },

  fit:function(){
    if(chart){
      chart.timeScale().fitContent();
    }
  },

  _updatePBar:function(last){
    ...
  }
};
// ── Live (200ms ENGINE) ───────────────────────────────────────
var Live={
  start:function(sym){
    if(liveWs){liveWs.close();}
    this._connect(sym);
  },

  _connect:function(sym){
    var url='wss://stream.binance.com:9443/ws/'+sym.toLowerCase()+'@trade';
    liveWs=new WebSocket(url);

    const INTERVAL=200;
    let currentCandle=null;

    liveWs.onopen=function(){
      console.log('WS Connected');
    };

    liveWs.onmessage=function(e){
      const t=JSON.parse(e.data);

      const price=parseFloat(t.p);
      const time=t.T;

      const bucket=Math.floor(time/INTERVAL);
      const candleTime=Math.floor((bucket*INTERVAL)/1000);

      if(!currentCandle || currentCandle.bucket!==bucket){

        currentCandle={
          time:candleTime,
          bucket:bucket,
          open:price,
          high:price,
          low:price,
          close:price,
          volume:1
        };

        allCandles.push(currentCandle);

        if(allCandles.length>2000){
          allCandles.shift();
        }

      }else{
        currentCandle.high=Math.max(currentCandle.high,price);
        currentCandle.low=Math.min(currentCandle.low,price);
        currentCandle.close=price;
        currentCandle.volume+=1;
      }

      cs.update(currentCandle);

      vs.update({
        time:currentCandle.time,
        value:currentCandle.volume,
        color:currentCandle.close>=currentCandle.open?'#00d08520':'#ff456020'
      });

      Chart._updatePBar(currentCandle);
    };

    liveWs.onclose=function(){
      console.log('WS reconnecting...');
      setTimeout(()=>Live._connect(sym),2000);
    };
  }
};

console.log('✅ 200ms Candle Engine Loaded');