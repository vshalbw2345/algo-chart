// ═══════════════════════════════════════════════════════════════
// chart_engine.js — Chart rendering, drawing tools, live feed
// No alert logic. No indicator logic. Pure chart.
// ═══════════════════════════════════════════════════════════════

// ── Global state ─────────────────────────────────────────────
var chart=null, cs=null, vs=null;
var curSym='BTCUSDT', curTF='5m';
var allCandles=[], openPrice=0;
var liveWs=null, tickInt=null;
var liveData={};
var wsRetry=0, wsRetryTimer=null;
var isLiveUpdate=false;

var BN_IV={
  '1m':'1m','3m':'3m','5m':'5m','10m':'5m','15m':'15m',
  '30m':'30m','1h':'1h','4h':'4h','1d':'1d'
};
var YH_IV={'1m':'1m','3m':'2m','5m':'5m','10m':'5m','15m':'15m','30m':'30m','1h':'60m','4h':'60m','1d':'1d'};
var YH_RG={'1m':'1d','3m':'2d','5m':'5d','10m':'5d','15m':'5d','30m':'30d','1h':'60d','4h':'60d','1d':'1y'};

// ── Format helper ────────────────────────────────────────────
function f(n){if(n==null)return'—';return n>=10000?n.toFixed(2):n>=100?n.toFixed(2):n>=1?n.toFixed(4):n.toFixed(6);}
function isI(s){return window.SYMBOLS?window.SYMBOLS.isIndian(s):(s&&s.indexOf('.NS')>-1);}

// ── Toast ────────────────────────────────────────────────────
function toast(msg,type){
  var el=document.getElementById('toast');if(!el)return;
  var m={success:['#00d08515','#00d085','#00d085'],error:['#ff456015','#ff4560','#ff4560'],
         warn:['#f59e0b15','#f59e0b','#f59e0b'],info:['#4c8eff15','#4c8eff','#4c8eff']};
  var s=m[type]||m.info;
  el.style.background=s[0];el.style.borderColor=s[1];el.style.color=s[2];
  el.textContent=msg;el.style.opacity='1';
  clearTimeout(el._t);el._t=setTimeout(function(){el.style.opacity='0';},4500);
}

// ── Chart module ─────────────────────────────────────────────
var Chart={
  _isLight:false,
  init:function(){
    var el=document.getElementById('chart');
    var ca=document.getElementById('carea');
    var w=ca.offsetWidth||800;
    var h=Math.max(200,ca.offsetHeight-36);
    chart=LightweightCharts.createChart(el,{
      width:w,height:h,
      layout:{background:{color:'#0d0f14'},textColor:'#8892aa'},
      grid:{vertLines:{color:'#1a1d2780'},horzLines:{color:'#1a1d2780'}},
      crosshair:{mode:LightweightCharts.CrosshairMode.Normal},
      rightPriceScale:{borderColor:'#2a2f45'},
      timeScale:{borderColor:'#2a2f45',timeVisible:true,secondsVisible:false},
    });
    cs=chart.addCandlestickSeries({
      upColor:'#00d085',downColor:'#ff4560',
      borderUpColor:'#00d085',borderDownColor:'#ff4560',
      wickUpColor:'#00d085',wickDownColor:'#ff4560',
    });
    vs=chart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'vol',scaleMargins:{top:.85,bottom:0}});
    chart.subscribeCrosshairMove(function(p){
      if(!p||!p.time)return;
      var d=p.seriesData&&p.seriesData.get(cs);if(!d)return;
      var ohlc=document.getElementById('ohlc');
      ohlc.classList.add('show');
      document.getElementById('xO').textContent=f(d.open);
      document.getElementById('xH').textContent=f(d.high);
      document.getElementById('xL').textContent=f(d.low);
      document.getElementById('xC').textContent=f(d.close);
    });
    chart.timeScale().subscribeVisibleTimeRangeChange(function(){Draw.render();});
    window.addEventListener('resize',function(){
      var w2=ca.offsetWidth;
      var h2=Math.max(200,ca.offsetHeight-36);
      if(w2>10&&h2>50){chart.applyOptions({width:w2,height:h2});Draw.resize();}
    });
    Draw.init();
  },
  setTF:function(tf){
    curTF=tf;
    document.querySelectorAll('.tf').forEach(function(b){
      b.classList.toggle('on',b.getAttribute('onclick')&&b.getAttribute('onclick').indexOf("'"+tf+"'")>-1);
    });
    Chart.load(curSym,tf);
  },
  fit:function(){chart&&chart.timeScale().fitContent();},
  toggleTheme:function(){
    this._isLight=!this._isLight;
    document.body.classList.toggle('light',this._isLight);
    document.getElementById('thb').textContent=this._isLight?'🌙':'☀️';
    if(chart){
      chart.applyOptions({
        layout:{background:{color:this._isLight?'#f5f6fa':'#0d0f14'},textColor:this._isLight?'#5a6080':'#8892aa'},
        grid:{vertLines:{color:this._isLight?'#e4e6ef':'#1a1d2780'},horzLines:{color:this._isLight?'#e4e6ef':'#1a1d2780'}},
      });
    }
  },
  load:function(sym,tf){
    setLoad(true);
    Live.stop();
    allCandles=[];
    var p=isI(sym)?this._loadIndian(sym,tf):this._loadCrypto(sym,tf);
    p.then(function(data){
      if(!data||!data.length){setLoad(false);toast('No data for '+sym,'warn');return;}
      allCandles=data;
      openPrice=data[0].close||0;
      cs.setData(data);
      vs.setData(data.map(function(c){return{time:c.time,value:c.volume||0,color:c.close>=c.open?'#00d08520':'#ff456020'};}));
      IndMgr.renderAll();
      chart.timeScale().fitContent();
      Chart._updatePBar(data[data.length-1],data[data.length-2]);
      Draw.render();
      setLoad(false);
      Live.start(sym,tf);
    }).catch(function(e){
      setLoad(false);
      toast('Error loading '+sym+': '+e.message,'error');
    });
  },
  _loadCrypto:function(sym,tf){
    return fetch('https://api.binance.com/api/v3/klines?symbol='+sym+'&interval='+(BN_IV[tf]||tf)+'&limit=500')
      .then(function(r){return r.json();})
      .then(function(d){
        if(!Array.isArray(d))throw new Error('Invalid Binance response');
        return d.map(function(k){return{time:Math.floor(k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]};});
      });
  },
  _loadIndian:function(sym,tf){
    var botUrl=AlertManager.getBotUrl();
    if(!botUrl){
      toast('Connect AlgoBot for Indian stock data','warn');
      return Promise.reject(new Error('AlgoBot not connected'));
    }
    return fetch(botUrl+'/api/chart/history?symbol='+encodeURIComponent(sym)+'&tf='+tf)
      .then(function(r){return r.json();})
      .then(function(d){
        if(d.success&&d.candles&&d.candles.length)return d.candles;
        throw new Error(d.error||'No data');
      });
  },
  _updatePBar:function(last,prev){
    if(!last||!last.close)return;
    document.getElementById('cp').textContent=f(last.close);
    var ref=openPrice||prev&&prev.close||last.open;
    if(ref){
      var d=last.close-ref,p=(d/ref*100).toFixed(2);
      var el=document.getElementById('chg');
      el.textContent=(d>=0?'+':'')+f(d)+' ('+(d>=0?'+':'')+p+'%)';
      el.className=d>=0?'up':'dn';
    }
  },
};

// ── Live feed ────────────────────────────────────────────────
var Live={
  start:function(sym,tf){
    if(isI(sym)){
      var botUrl=AlertManager.getBotUrl();
      if(!botUrl)return;
      tickInt=setInterval(function(){
        fetch(botUrl+'/api/chart/history?symbol='+encodeURIComponent(sym)+'&tf=1m')
          .then(function(r){return r.json();})
          .then(function(d){
            if(d.success&&d.candles&&d.candles.length){
              var last=d.candles[d.candles.length-1];
              liveData[sym]=last.close;
              tickUpdate(last);setDot('green');
            }
          }).catch(function(){setDot('red');});
      },5000);
      setDot('green');
    } else {
      this._connectWS(sym,tf);
    }
  },
  stop:function(){
    if(wsRetryTimer){clearTimeout(wsRetryTimer);wsRetryTimer=null;}
    if(tickInt){clearInterval(tickInt);tickInt=null;}
    if(liveWs){liveWs.onclose=null;try{liveWs.close();}catch(e){}liveWs=null;}
  },
  _connectWS:function(sym,tf){
    if(wsRetryTimer){clearTimeout(wsRetryTimer);wsRetryTimer=null;}
    if(liveWs){liveWs.onclose=null;try{liveWs.close();}catch(e){}}
    var url='wss://stream.binance.com:9443/ws/'+sym.toLowerCase()+'@kline_'+(BN_IV[tf]||tf);
    liveWs=new WebSocket(url);
    liveWs.onopen=function(){wsRetry=0;setDot('green');};
    liveWs.onmessage=function(e){
      var k=JSON.parse(e.data).k;if(!k)return;
      var c={time:Math.floor(k.t/1000),open:+k.o,high:+k.h,low:+k.l,close:+k.c,volume:+k.v};
      liveData[sym]=c.close;
      tickUpdate(c);WL.updatePrices();
    };
    liveWs.onerror=function(){setDot('red');};
    liveWs.onclose=function(){
      if(curSym!==sym)return;
      setDot('orange');wsRetry++;
      var delay=Math.min(2000*Math.pow(2,wsRetry-1),30000);
      wsRetryTimer=setTimeout(function(){if(curSym===sym)Live._connectWS(sym,tf);},delay);
    };
  },
};

function tickUpdate(c){
  if(!allCandles.length||!cs)return;
  isLiveUpdate=true;
  var last=allCandles[allCandles.length-1];
  var isNew=c.time>last.time;
  if(isNew){
    var closed=last;
    var prev=allCandles.length>=2?allCandles[allCandles.length-2]:null;
    allCandles.push(c);
    if(allCandles.length>2000)allCandles.shift();
   Fire indicator checks on CLOSED candle
    // CRITICAL: Only call onCandle for indicators user ADDED in IndMgr
    // Never fire signals for indicators not explicitly added by user
    if(prev&&window.IndMgr){
      var userInds=window.IndMgr.getAll().filter(function(i){return i.visible;});
      userInds.forEach(function(indCfg){
        // Match user indicator type to plugin
        var plugin=null;
        if(indCfg.type==='orb')plugin=window.INDICATORS&&window.INDICATORS.ORB;
        else if(indCfg.type==='ema_cross')plugin=window.INDICATORS&&window.INDICATORS.EMA_CROSS;
        else if(indCfg.type==='candle_color')plugin=window.INDICATORS&&window.INDICATORS.CANDLE_COLOR;
        if(!plugin||!plugin.onCandle)return;
        var sig=plugin.onCandle(closed,allCandles,AlertManager.getRR());
        if(sig){
          // Pass the specific indicator ID so only its alerts fire
          AlertManager.checkIndicator(curSym,sig.type,sig.price,closed.time,indCfg.id);
          window._lastIndSig=sig;
          console.log('[SIGNAL] '+indCfg.name+' '+sig.type+' @ '+sig.price);
        }
      });
    }
      } else {
    allCandles[allCandles.length-1]=Object.assign({},last,c);
  }
  cs.update(allCandles[allCandles.length-1]);
  vs.update({time:c.time,value:c.volume||0,color:c.close>=c.open?'#00d08520':'#ff456020'});
  Chart._updatePBar(c,allCandles[allCandles.length-2]||c);
  AlertManager.checkPrice(c,allCandles[allCandles.length-2],curSym);
  Draw.render();
  isLiveUpdate=false;
}

function setDot(col){
  var d=document.getElementById('ldot');
  var m={green:'#00d085',red:'#ff4560',orange:'#f59e0b'};
  if(d){d.style.background=m[col]||m.green;d.style.boxShadow='0 0 5px '+(m[col]||m.green);}
}
function setLoad(on){
  var el=document.getElementById('ldr');
  if(el)el.style.display=on?'flex':'none';
}

// ── Drawing system ────────────────────────────────────────────
var DS={color:'#4c8eff',width:1,style:'solid',opacity:20};
var Draw=(function(){
  var _drws=[], _sel=null, _start=null, _brush=null;
  var _canvas, _ctx, _ov;
  var FIB=[0,.236,.382,.5,.618,.786,1,1.272,1.618];
  var FIBC=['#888','#f59e0b','#00d085','#4c8eff','#a78bfa','#ff4560','#888','#f59e0b','#00d085'];
  function _h2r(hex,a){var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return'rgba('+r+','+g+','+b+','+a+')';}
  function _px2pr(x,y){return{time:chart.timeScale().coordinateToTime(x),price:cs.coordinateToPrice(y)};}
  function _pr2px(t,p){return{x:chart.timeScale().timeToCoordinate(t),y:cs.priceToCoordinate(p)};}

  function _drawOne(d,ctx){
    ctx.save();
    ctx.strokeStyle=d.color||'#4c8eff';ctx.lineWidth=d.width||1;
    ctx.setLineDash(d.style==='dashed'?[6,3]:d.style==='dotted'?[2,3]:[]);
    if(d.type==='hline'){
      var y=cs.priceToCoordinate(d.price);if(y==null){ctx.restore();return;}
      ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(_canvas.width,y);ctx.stroke();
      ctx.setLineDash([]);ctx.fillStyle=d.color;ctx.font='bold 10px monospace';
      ctx.fillText(f(d.price),_canvas.width-60,y-3);
    } else if(d.type==='tline'){
      var s=_pr2px(d.t1,d.p1),e2=_pr2px(d.t2,d.p2);
      if(s.x==null||e2.x==null){ctx.restore();return;}
      var dx=e2.x-s.x,dy=e2.y-s.y,len=Math.sqrt(dx*dx+dy*dy)||1,sc=3000/len;
      ctx.beginPath();ctx.moveTo(s.x-dx*sc,s.y-dy*sc);ctx.lineTo(s.x+dx*sc,s.y+dy*sc);ctx.stroke();
    } else if(d.type==='rect'){
      var s=_pr2px(d.t1,d.p1),e2=_pr2px(d.t2,d.p2);
      if(s.x==null||e2.x==null){ctx.restore();return;}
      ctx.setLineDash([]);ctx.fillStyle=_h2r(d.color,(d.opacity||20)/100);
      ctx.fillRect(s.x,s.y,e2.x-s.x,e2.y-s.y);ctx.strokeRect(s.x,s.y,e2.x-s.x,e2.y-s.y);
    } else if(d.type==='fib'){
      var rng=d.high-d.low;
      for(var i=0;i<FIB.length;i++){
        var p=d.low+rng*(1-FIB[i]),fy=cs.priceToCoordinate(p);if(fy==null)continue;
        var fx1=chart.timeScale().timeToCoordinate(d.t1),fx2=chart.timeScale().timeToCoordinate(d.t2);
        if(fx1==null||fx2==null)continue;
        ctx.strokeStyle=FIBC[i];ctx.lineWidth=1;ctx.setLineDash([4,3]);
        ctx.beginPath();ctx.moveTo(Math.min(fx1,fx2),fy);ctx.lineTo(Math.max(fx1,fx2),fy);ctx.stroke();
        ctx.fillStyle=FIBC[i];ctx.font='bold 10px monospace';ctx.setLineDash([]);
        ctx.fillText((FIB[i]*100).toFixed(1)+'%  '+f(p),Math.min(fx1,fx2)+3,fy-3);
      }
    } else if(d.type==='ls'){
      var ey=cs.priceToCoordinate(d.entry);if(ey==null){ctx.restore();return;}
      var isL=d.side==='long';
      if(d.sl){var sy=cs.priceToCoordinate(d.sl);if(sy!=null){ctx.setLineDash([]);ctx.fillStyle=_h2r(isL?'#ff4560':'#00d085',.15);ctx.fillRect(0,Math.min(ey,sy),_canvas.width,Math.abs(sy-ey));ctx.strokeStyle=isL?'#ff4560':'#00d085';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,sy);ctx.lineTo(_canvas.width,sy);ctx.stroke();ctx.fillStyle=isL?'#ff4560':'#00d085';ctx.font='bold 10px monospace';ctx.fillText('SL '+f(d.sl),4,sy+12);}}
      if(d.tgt){var ty=cs.priceToCoordinate(d.tgt);if(ty!=null){ctx.setLineDash([]);ctx.fillStyle=_h2r(isL?'#00d085':'#ff4560',.15);ctx.fillRect(0,Math.min(ey,ty),_canvas.width,Math.abs(ty-ey));ctx.strokeStyle=isL?'#00d085':'#ff4560';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,ty);ctx.lineTo(_canvas.width,ty);ctx.stroke();ctx.fillStyle=isL?'#00d085':'#ff4560';ctx.font='bold 10px monospace';ctx.fillText('TGT '+f(d.tgt),4,ty-4);}}
      ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.setLineDash([]);
      ctx.beginPath();ctx.moveTo(0,ey);ctx.lineTo(_canvas.width,ey);ctx.stroke();
      ctx.fillStyle='#fff';ctx.font='bold 10px monospace';
      ctx.fillText((isL?'LONG':'SHORT')+' @ '+f(d.entry)+' x'+(d.qty||1),4,ey-4);
      if(d.sl&&d.tgt)ctx.fillText('R:R=1:'+(Math.abs(d.tgt-d.entry)/Math.abs(d.entry-d.sl)).toFixed(2),_canvas.width-90,ey-4);
    } else if(d.type==='brush'&&d.points&&d.points.length>1){
      ctx.beginPath();ctx.moveTo(d.points[0].x,d.points[0].y);
      for(var j=1;j<d.points.length;j++)ctx.lineTo(d.points[j].x,d.points[j].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  return{
    _curTool:null,
    init:function(){
      _canvas=document.getElementById('cv');_ctx=_canvas.getContext('2d');
      _ov=document.getElementById('ov');
      this.resize();
      _ov.addEventListener('mousedown',this._onDS.bind(this));
      _ov.addEventListener('mousemove',this._onDM.bind(this));
      _ov.addEventListener('mouseup',this._onDE.bind(this));
      _ov.addEventListener('mouseleave',this._onDE.bind(this));
      // Load saved drawings
      var saved=localStorage.getItem('av_drw');
      if(saved)try{_drws=JSON.parse(saved);}catch(e){}
    },
    resize:function(){
      var el=document.getElementById('chart');
      _canvas.width=el.offsetWidth;_canvas.height=el.offsetHeight;
      _ov.style.width=el.offsetWidth+'px';_ov.style.height=el.offsetHeight+'px';
      this.render();
    },
    render:function(preview){
      if(!_ctx||!cs)return;
      _ctx.clearRect(0,0,_canvas.width,_canvas.height);
      _drws.forEach(function(d){_drawOne(d,_ctx);});
      // Draw alert lines
      AlertManager.getAll().filter(function(a){return a.sym===curSym&&a.enabled;}).forEach(function(a){
        var ay=cs.priceToCoordinate(a.price);if(ay==null)return;
        _ctx.save();var ac={buy:'#00d085',sell:'#ff4560',buy_sl:'#ff4560',buy_tgt:'#00d085',sell_sl:'#00d085',sell_tgt:'#ff4560'}[a.type]||'#f59e0b';
        _ctx.strokeStyle=ac;_ctx.lineWidth=1;_ctx.setLineDash([3,3]);
        _ctx.beginPath();_ctx.moveTo(0,ay);_ctx.lineTo(_canvas.width,ay);_ctx.stroke();
        _ctx.fillStyle=ac;_ctx.font='10px monospace';_ctx.setLineDash([]);
        _ctx.fillText('🔔'+f(a.price),4,ay-3);_ctx.restore();
      });
      if(preview){
        _ctx.save();_ctx.strokeStyle=DS.color;_ctx.lineWidth=DS.width;
        _ctx.setLineDash(DS.style==='dashed'?[6,3]:DS.style==='dotted'?[2,3]:[]);
        if(preview.type==='tline'){_ctx.beginPath();_ctx.moveTo(preview.x1,preview.y1);_ctx.lineTo(preview.x2,preview.y2);_ctx.stroke();}
        else if(preview.type==='rect'){_ctx.setLineDash([]);_ctx.fillStyle=this._h2r(DS.color,DS.opacity/100);_ctx.fillRect(preview.x1,preview.y1,preview.x2-preview.x1,preview.y2-preview.y1);_ctx.strokeRect(preview.x1,preview.y1,preview.x2-preview.x1,preview.y2-preview.y1);}
        else if(preview.type==='brush'&&preview.points){_ctx.beginPath();_ctx.moveTo(preview.points[0].x,preview.points[0].y);preview.points.forEach(function(p){_ctx.lineTo(p.x,p.y);});_ctx.stroke();}
        _ctx.restore();
      }
    },
    _h2r:function(hex,a){var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return'rgba('+r+','+g+','+b+','+a+')';},
    setTool:function(t){
      this._curTool=this._curTool===t?null:t;
      var ids={hline:'dHL',aline:'dAL',tline:'dTL',rect:'dRE',fib:'dFI',ls:'dLS',brush:'dBR'};
      Object.keys(ids).forEach(function(k){var el=document.getElementById(ids[k]);if(el)el.classList.remove('on');});
      if(this._curTool){var el=document.getElementById(ids[this._curTool]);if(el)el.classList.add('on');}
      document.getElementById('fillWrap').style.display=this._curTool==='rect'?'inline-flex':'none';
      var ov=document.getElementById('ov');
      if(this._curTool){ov.style.display='block';document.getElementById('cbar').classList.add('show');}
      else{ov.style.display='none';if(!_sel)document.getElementById('cbar').classList.remove('show');}
    },
    update:function(){// DS style changed
      DS.color=document.getElementById('dCol').value;
      DS.width=parseInt(document.getElementById('dWid').value);
      DS.style=document.getElementById('dSty').value;
      DS.opacity=parseInt(document.getElementById('dOpa').value);
      if(_sel){var d=_drws.find(function(x){return x.id===_sel;});if(d){Object.assign(d,DS);this._save();this.render();}}
    },
    deleteSel:function(){if(!_sel)return;_drws=_drws.filter(function(d){return d.id!==_sel;});_sel=null;document.getElementById('cbar').classList.remove('show');this._save();this.render();},
    deselect:function(){_sel=null;document.getElementById('cbar').classList.remove('show');},
    clearAll:function(){_drws=[];this._save();this.render();this.setTool(null);},
    _save:function(){localStorage.setItem('av_drw',JSON.stringify(_drws));},
    _onDS:function(e){
      if(!this._curTool)return;
      var r=_canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
      var pt=_px2pr(x,y);_start={x:x,y:y,time:pt.time,price:pt.price};
      if(this._curTool==='hline'){
        _drws.push({id:Date.now(),type:'hline',price:pt.price,color:DS.color,width:DS.width,style:DS.style});
        this._save();this.render();this.setTool(null);
      } else if(this._curTool==='aline'){
        AlertPanel.open(pt.price);this.setTool(null);
      } else if(this._curTool==='ls'){
        document.getElementById('lsE').value=f(pt.price);
        document.getElementById('lsModal').classList.add('open');this.setTool(null);
      } else if(this._curTool==='brush'){
        _brush={type:'brush',points:[{x:x,y:y}],color:DS.color,width:DS.width,style:DS.style};
      }
    },
    _onDM:function(e){
      if(!_start||!this._curTool)return;
      var r=_canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
      if(this._curTool==='brush'&&_brush){_brush.points.push({x:x,y:y});this.render(_brush);return;}
      var pt=_px2pr(x,y);
      this.render({type:this._curTool,x1:_start.x,y1:_start.y,x2:x,y2:y,p2:pt.price,t2:pt.time,points:_brush&&_brush.points});
    },
    _onDE:function(e){
      if(!_start||!this._curTool)return;
      var r=_canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
      var pt=_px2pr(x,y);
      if(this._curTool==='tline')_drws.push({id:Date.now(),type:'tline',t1:_start.time,p1:_start.price,t2:pt.time,p2:pt.price,color:DS.color,width:DS.width,style:DS.style});
      else if(this._curTool==='rect')_drws.push({id:Date.now(),type:'rect',t1:_start.time,p1:_start.price,t2:pt.time,p2:pt.price,color:DS.color,width:DS.width,opacity:DS.opacity});
      else if(this._curTool==='fib')_drws.push({id:Date.now(),type:'fib',t1:_start.time,t2:pt.time,high:Math.max(_start.price,pt.price),low:Math.min(_start.price,pt.price),color:DS.color,width:DS.width});
      else if(this._curTool==='brush'&&_brush){_drws.push(Object.assign({id:Date.now()},_brush));_brush=null;}
      if(this._curTool!=='hline'&&this._curTool!=='aline'&&this._curTool!=='ls')this._save();
      _start=null;this.setTool(null);this.render();
    },
  };
})();

// Expose DS.update for HTML
DS.update=function(){Draw.update();};

// ── L/S modal ────────────────────────────────────────────────
var LS={
  calc:function(){
    var e=parseFloat(document.getElementById('lsE').value);
    var sl=parseFloat(document.getElementById('lsSL').value);
    var tgt=parseFloat(document.getElementById('lsT').value);
    var q=parseInt(document.getElementById('lsQ').value)||1;
    var h='';
    if(e&&sl)h+='<span style="color:var(--R)">Risk: '+f(Math.abs(e-sl)*q)+'</span><br>';
    if(e&&tgt)h+='<span style="color:var(--G)">Reward: '+f(Math.abs(tgt-e)*q)+'</span><br>';
    if(e&&sl&&tgt)h+='<b style="color:var(--B)">R:R=1:'+(Math.abs(tgt-e)/Math.abs(e-sl)).toFixed(2)+'</b>';
    document.getElementById('lsCalc').innerHTML=h||'Enter SL and Target';
  },
  confirm:function(){
    var e=parseFloat(document.getElementById('lsE').value);if(!e){toast('Enter entry','warn');return;}
    var sl=parseFloat(document.getElementById('lsSL').value)||0;
    var tgt=parseFloat(document.getElementById('lsT').value)||0;
    var qty=parseInt(document.getElementById('lsQ').value)||1;
    var isL=!sl||e>sl;
    Draw._drws.push({id:Date.now(),type:'ls',side:isL?'long':'short',entry:e,sl:sl,tgt:tgt,qty:qty,color:isL?'#00d085':'#ff4560',width:1,style:'solid'});
    Draw._save();document.getElementById('lsModal').classList.remove('open');Draw.render();
  }
};

console.log('[ChartEngine] ✅ Loaded');
