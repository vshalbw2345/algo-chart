// ═══════════════════════════════════════════════════════════════
// chart_engine.js — ORIGINAL + 200ms FAST MODE (SAFE VERSION)
// ═══════════════════════════════════════════════════════════════

// ── Global state ─────────────────────────────────────────────
var chart=null, cs=null, vs=null;
var curSym='BTCUSDT', curTF='5m';
var allCandles=[], openPrice=0;
var liveWs=null, tickInt=null;
var liveData={};
var wsRetry=0, wsRetryTimer=null;
var isLiveUpdate=false;

// 🔥 FAST MODE SWITCH
var useFastMode = true; // true = 200ms, false = normal

// ── Helpers ──────────────────────────────────────────────────
function f(n){if(n==null)return'—';return n>=10000?n.toFixed(2):n>=100?n.toFixed(2):n>=1?n.toFixed(4):n.toFixed(6);}

// ── Chart ────────────────────────────────────────────────────
var Chart={
  init:function(){
    chart=LightweightCharts.createChart(document.getElementById('chart'),{
      layout:{background:{color:'#0d0f14'},textColor:'#8892aa'}
    });

    cs=chart.addCandlestickSeries({
      upColor:'#00d085',downColor:'#ff4560',
      borderUpColor:'#00d085',borderDownColor:'#ff4560',
      wickUpColor:'#00d085',wickDownColor:'#ff4560',
    });

    vs=chart.addHistogramSeries({
      priceFormat:{type:'volume'},
      priceScaleId:'vol',
      scaleMargins:{top:.85,bottom:0}
    });
  },

  load:function(sym,tf){
    curSym=sym;
    curTF=tf;
    allCandles=[];
    cs.setData([]);
    Live.start(sym,tf);
  },

  fit:function(){
    if(chart) chart.timeScale().fitContent();
  },

  _updatePBar:function(last){
    if(!last)return;
    document.getElementById('cp').textContent=f(last.close);
  }
};

// ── Live Feed ────────────────────────────────────────────────
var Live={
  start:function(sym,tf){
    this.stop();

    // ❗ Indian stocks → always normal mode
    if(sym.includes('.NS')){
      useFastMode=false;
    }

    if(useFastMode){
      this._connectFast(sym);
    }else{
      this._connectNormal(sym,tf);
    }
  },

  stop:function(){
    if(wsRetryTimer){clearTimeout(wsRetryTimer);wsRetryTimer=null;}
    if(tickInt){clearInterval(tickInt);tickInt=null;}
    if(liveWs){try{liveWs.close();}catch(e){}liveWs=null;}
  },

  // ── FAST MODE (200ms candles) ─────────────────────────────
  _connectFast:function(sym){

    var url='wss://stream.binance.com:9443/ws/'+sym.toLowerCase()+'@trade';
    liveWs=new WebSocket(url);

    const INTERVAL=200;
    let currentCandle=null;

    liveWs.onopen=function(){
      wsRetry=0;
      console.log('⚡ FAST WS Connected');
    };

    liveWs.onmessage=function(e){

      const trade=JSON.parse(e.data);

      const price=parseFloat(trade.p);
      const time=trade.T;

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

        if(allCandles.length>2000) allCandles.shift();

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
      console.log('Reconnecting FAST...');
      setTimeout(()=>Live._connectFast(sym),2000);
    };
  },

  // ── NORMAL MODE (original) ─────────────────────────────
  _connectNormal:function(sym,tf){

    var url='wss://stream.binance.com:9443/ws/'+sym.toLowerCase()+'@kline_'+tf;
    liveWs=new WebSocket(url);

    liveWs.onmessage=function(e){
      var k=JSON.parse(e.data).k;
      if(!k)return;

      var c={
        time:Math.floor(k.t/1000),
        open:+k.o,
        high:+k.h,
        low:+k.l,
        close:+k.c,
        volume:+k.v
      };

      tickUpdate(c);
    };
  }
};

// ── Original Tick Update (unchanged) ─────────────────────────
function tickUpdate(c){
  if(!allCandles.length){
    allCandles.push(c);
  }else{
    var last=allCandles[allCandles.length-1];

    if(c.time>last.time){
      allCandles.push(c);
    }else{
      allCandles[allCandles.length-1]=c;
    }
  }

  cs.update(allCandles[allCandles.length-1]);

  vs.update({
    time:c.time,
    value:c.volume||0,
    color:c.close>=c.open?'#00d08520':'#ff456020'
  });

  Chart._updatePBar(c);
}

console.log('✅ Engine Loaded (Fast + Normal)');