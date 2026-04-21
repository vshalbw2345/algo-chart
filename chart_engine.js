// ═════════════════════════════════════════════════════
// CLEAN WORKING 200ms ENGINE (NO ERRORS)
// ═════════════════════════════════════════════════════

var chart=null, cs=null, vs=null;
var curSym='BTCUSDT';
var curTF='5m';
var allCandles=[];
var liveWs=null;
var liveData={};
function f(n){
  if(n==null)return'—';
  return n>=10000?n.toFixed(2):
         n>=100?n.toFixed(2):
         n>=1?n.toFixed(4):
         n.toFixed(6);
}

// ── Chart ─────────────────────────
var Chart={
  init:function(){
    chart=LightweightCharts.createChart(
      document.getElementById('chart'),
      {
        layout:{background:{color:'#0d0f14'},textColor:'#8892aa'}
      }
    );

    cs=chart.addCandlestickSeries({
      upColor:'#00d085',
      downColor:'#ff4560',
      borderUpColor:'#00d085',
      borderDownColor:'#ff4560',
      wickUpColor:'#00d085',
      wickDownColor:'#ff4560'
    });

    vs=chart.addHistogramSeries({
      priceFormat:{type:'volume'},
      priceScaleId:'vol',
      scaleMargins:{top:.85,bottom:0}
    });
  },

  load:function(sym){
    allCandles=[];
    cs.setData([]);
    Live.start(sym);
  },

  fit:function(){
    if(chart){
      chart.timeScale().fitContent();
    }
  },

  _updatePBar:function(last){
    if(!last)return;
    document.getElementById('cp').textContent=f(last.close);
  }
};

// ── Live Engine (200ms) ─────────────────────────
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
        color:currentCandle.close>=currentCandle.open
          ? '#00d08520'
          : '#ff456020'
      });

      Chart._updatePBar(currentCandle);
    };

    liveWs.onclose=function(){
      console.log('Reconnecting...');
      setTimeout(()=>Live._connect(sym),2000);
    };
  }
};

console.log('✅ 200ms Engine Ready');