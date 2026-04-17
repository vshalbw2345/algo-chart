// ═══════════════════════════════════════════════════════════════
// alerts.js — Complete Alert Manager
// No chart logic here. Only: create, check, fire, send to broker
// ═══════════════════════════════════════════════════════════════
window.AlertManager = (function(){
  'use strict';

  var _als=[], _frd=[], _botUrl='', _sheetUrl='';
  var _rrCfg={capital:50000,leverage:4,riskPct:1,rrRatio:2,
               cryptoLeverage:10,cryptoRiskPct:0.5,cryptoRRRatio:1.5};
  var _brokers=[];
  var _fired={}; // key→true, prevents double fire per candle

  function _ls(k){try{return JSON.parse(localStorage.getItem(k));}catch(e){return null;}}
  function _ss(k,v){localStorage.setItem(k,JSON.stringify(v));}
  function _f(n){if(n==null)return'—';return n>=10000?n.toFixed(2):n>=100?n.toFixed(2):n>=1?n.toFixed(4):n.toFixed(6);}
  function _isI(s){return window.SYMBOLS?window.SYMBOLS.isIndian(s):(s&&s.indexOf('.NS')>-1);}

  function _load(){
    _als=_ls('av_al')||[];
    _frd=_ls('av_fired')||[];
    _botUrl=localStorage.getItem('av_bot')||'';
    _sheetUrl=localStorage.getItem('av_sheet')||'';
  }
  function _save(){_ss('av_al',_als);}

  function _calcQty(sym,price){
    if(!price||price<=0)return 1;
    var isInd=_isI(sym);
    var cap=_rrCfg.capital||50000;
    var lev=isInd?(_rrCfg.leverage||4):(_rrCfg.cryptoLeverage||10);
    var rp=isInd?(_rrCfg.riskPct||1):(_rrCfg.cryptoRiskPct||0.5);
    var effCap=cap*lev;
    var riskAmt=effCap*rp/100;
    var slPts=price*rp/100;
    return Math.max(1,slPts>0?Math.floor(riskAmt/slPts):1);
  }

  function _fetchRR(){
    if(!_botUrl)return;
    fetch(_botUrl+'/api/risk/config')
      .then(function(r){return r.json();})
      .then(function(d){if(d.success&&d.config)_rrCfg=Object.assign(_rrCfg,d.config);})
      .catch(function(){});
  }

  function _fetchBrokers(cb){
    _brokers=[{v:'auto',t:'Auto (by symbol type)'},{v:'none',t:'Chart only — no order'}];
    if(!_botUrl){cb&&cb();return;}
    Promise.all([
      fetch(_botUrl+'/api/auth/status',{signal:AbortSignal.timeout(5000)}).then(function(r){return r.json();}).catch(function(){return{};}),
      fetch(_botUrl+'/api/delta/status',{signal:AbortSignal.timeout(5000)}).then(function(r){return r.json();}).catch(function(){return{apis:[]};})
    ]).then(function(res){
      var fd=res[0],dd=res[1];
      if(fd.isAuthenticated){
        var nm=(fd.profile&&(fd.profile.name||fd.profile.email))||'Connected';
        _brokers.push({v:'fyers',t:'Fyers — '+nm});
      }
      (dd.apis||[]).filter(function(a){return a.connected;}).forEach(function(a){
        _brokers.push({v:'delta_'+a.id,t:'Delta Exchange — '+a.name+' ($'+parseFloat(a.availableBalance||0).toFixed(2)+')'});
      });
      cb&&cb();
    });
  }

  // Create 6 alerts for one symbol
  function _create6(sym,price,broker,tf,ordType,condSrc){
    if(!sym||!price)return 0;
    var isInd=_isI(sym);
    var rp=isInd?(_rrCfg.riskPct||1):(_rrCfg.cryptoRiskPct||0.5);
    var rr=isInd?(_rrCfg.rrRatio||2):(_rrCfg.cryptoRRRatio||1.5);
    var qty=_calcQty(sym,price);
    var slD=price*rp/100;
    var bSL=parseFloat((price-slD).toFixed(4));
    var bTG=parseFloat((price+slD*rr).toFixed(4));
    var sSL=parseFloat((price+slD).toFixed(4));
    var sTG=parseFloat((price-slD*rr).toFixed(4));
    var now=new Date().toISOString();
    var isInd2=condSrc&&condSrc.indexOf('ind_')===0;
    var meta={sl:bSL,tgt:bTG,riskPct:rp,rrRatio:rr,entry:price};
    var rows=[
      {type:'buy',    side:'BUY', price:price,cond:'above',note:sym+' BUY @ '+_f(price)},
      {type:'buy_sl', side:'SELL',price:bSL,  cond:'below',note:sym+' Buy SL @ '+_f(bSL)+'('+rp+'%)'},
      {type:'buy_tgt',side:'SELL',price:bTG,  cond:'above',note:sym+' Buy TGT @ '+_f(bTG)+' (1:'+rr+')'},
      {type:'sell',   side:'SELL',price:price,cond:'below',note:sym+' SELL @ '+_f(price)},
      {type:'sell_sl',side:'BUY', price:sSL,  cond:'above',note:sym+' Sell SL @ '+_f(sSL)+'('+rp+'%)'},
      {type:'sell_tgt',side:'BUY',price:sTG,  cond:'below',note:sym+' Sell TGT @ '+_f(sTG)+' (1:'+rr+')'},
    ];
    var added=0;
    rows.forEach(function(row,k){
      var dup=_als.some(function(a){return a.sym===sym&&a.type===row.type&&Math.abs(a.price-row.price)<0.01;});
      if(dup)return;
      _als.push({id:Date.now()+added+k,sym:sym,tf:tf||'5m',price:row.price,
        type:row.type,side:row.side,qty:qty,ordType:ordType||'MARKET',
        condition:row.cond,trigger:isInd2?'every':'once',broker:broker||'auto',
        note:row.note,logSheet:!!_sheetUrl,sendBot:broker!=='none',enabled:true,
        condSrc:condSrc||'price',createdAt:now,meta:meta});
      added++;
    });
    return added;
  }

  // Single alert create
  function _createOne(a){
    var dup=_als.some(function(x){return x.sym===a.sym&&x.type===a.type&&Math.abs(x.price-a.price)<0.01;});
    if(dup)return false;
    _als.push(a);
    return true;
  }

  // Check price-based alerts on candle tick
  function _checkPrice(candle,prevCandle,curSym){
    if(!candle||!candle.close)return;
    var changed=false;
    _als.filter(function(a){
      return a.enabled&&a.sym===curSym&&(!a.condSrc||a.condSrc==='price');
    }).forEach(function(a){
      var px=candle.close;
      var prev=prevCandle?prevCandle.close:px;
      var op=a.condition||'above';
      var trig=false;
      if(op==='above')trig=(prev<a.price&&px>=a.price);
      else if(op==='below')trig=(prev>a.price&&px<=a.price);
      else if(op==='cross')trig=(prev<a.price&&px>=a.price)||(prev>a.price&&px<=a.price);
      if(!trig)return;
      var age=(Date.now()-new Date(a.createdAt).getTime())/1000;
      if(age<15)return;
      _fire(a,px);changed=true;
    });
    if(changed)_save();
  }

  // Fire from indicator signal
  function _checkIndicator(sym,sigType,price,candleTime,firedIndId){
    // GUARD 1: Only fire on live ticks
    if(!window.isLiveUpdate)return;
    // GUARD 2: Deduplicate
    var key=sym+'_'+sigType+'_'+candleTime+'_'+(firedIndId||'x');
    if(_fired[key])return;
    _fired[key]=true;
    var keys=Object.keys(_fired);
    if(keys.length>200)delete _fired[keys[0]];
    console.log('[ALERT] Firing: '+sym+' '+sigType+' @ '+price+' indId:'+firedIndId);

    _als.filter(function(a){
      if(!a.enabled||a.sym!==sym)return false;
      if(!a.condSrc||a.condSrc==='price')return false;
      var indId=a.condSrc.replace('ind_','');
      // GUARD 3: Only match alerts for the EXACT indicator that fired the signal
      if(firedIndId&&String(indId)!==String(firedIndId))return false;
      if(!window.IndMgr)return false;
      return window.IndMgr.exists(indId);
    }).forEach(function(a){
      var match=false;
      if(sigType==='buy'&&a.type==='buy')match=true;
      if(sigType==='sell'&&a.type==='sell')match=true;
      if(sigType==='sell'&&(a.type==='buy_sl'||a.type==='buy_tgt'))match=true;
      if(sigType==='buy'&&(a.type==='sell_sl'||a.type==='sell_tgt'))match=true;
      if(!match)return;
      var age=(Date.now()-new Date(a.createdAt).getTime())/1000;
      if(age<30)return;
      _fire(a,price);
    });
    _save();
  }

  
  function _fire(a,price){
    a.firedAt=new Date().toISOString();
    _frd.unshift(Object.assign({},a,{firedPrice:price}));
    _frd=_frd.slice(0,50);
    _ss('av_fired',_frd);
    _toast('🔔 '+a.note,'info');
    if(a.sendBot&&_botUrl)_send(a,price);
    if(a.logSheet&&_sheetUrl)_log(a,price);
  }

  function _send(a,price){
    var side=(a.type==='buy'||a.type==='buy_tgt')?'BUY':(a.type==='sell'||a.type==='sell_tgt')?'SELL':(a.type==='buy_sl')?'SELL':'BUY';
    fetch(_botUrl+'/api/alerts/webhook',{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({symbol:a.sym,side:side,price:price||a.price,type:a.type,
        tf:a.tf,qty:a.qty||1,orderType:a.ordType||'MARKET',broker:a.broker||'auto',
        note:a.note||'',source:'chart',sl:a.meta&&a.meta.sl,tgt:a.meta&&a.meta.tgt,
        riskPct:a.meta&&a.meta.riskPct,rrRatio:a.meta&&a.meta.rrRatio,
        timestamp:new Date().toISOString()})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.success)_toast('✅ '+side+' '+a.sym+' → '+(d.broker||'BOT').toUpperCase(),'success');
      else _toast('❌ '+(d.error||'Failed'),'error');
    }).catch(function(e){_toast('❌ Bot: '+e.message,'error');});
  }

  function _log(a,price){
    if(!_sheetUrl)return;
    fetch(_sheetUrl,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({date:new Date().toLocaleString('en-IN'),symbol:a.sym,side:a.side,
        price:_f(price),qty:a.qty||1,broker:a.broker||'auto',tf:a.tf,type:a.type,note:a.note||'',source:'ALGO_VISH'})})
    .then(function(){_toast('📊 Logged to Sheet','success');}).catch(function(){});
  }

  function _toast(msg,type){if(window.toast)window.toast(msg,type);else console.log('[ALERT]',type,msg);}

  return {
    init:function(){
      _load();_fetchRR();
      setInterval(_fetchRR,120000);
    },
    getAll:function(){return _als;},
    getFired:function(){return _frd;},
    getRR:function(){return _rrCfg;},
    getBotUrl:function(){return _botUrl;},
    getSheetUrl:function(){return _sheetUrl;},
    setBotUrl:function(u){_botUrl=u;localStorage.setItem('av_bot',u);},
    setSheetUrl:function(u){_sheetUrl=u;localStorage.setItem('av_sheet',u);},
    calcQty:function(sym,price){return _calcQty(sym,price);},
    fetchBrokers:function(cb){return _fetchBrokers(cb);},
    getBrokers:function(){return _brokers;},
    create6:function(sym,price,broker,tf,ordType,condSrc){
      var n=_create6(sym,price,broker,tf,ordType,condSrc);
      if(n>0)_save();
      return n;
    },
    createOne:function(a){var ok=_createOne(a);if(ok)_save();return ok;},
    checkPrice:function(candle,prev,sym){_checkPrice(candle,prev,sym);},
    checkIndicator:function(sym,sig,price,time,indId){_checkIndicator(sym,sig,price,time,indId);},
    toggle:function(id){var a=_als.find(function(x){return x.id===id;});if(a){a.enabled=!a.enabled;_save();}},
    delete:function(id){_als=_als.filter(function(a){return a.id!==id;});_save();},
    clearAll:function(){_als=[];_save();},
    isIndian:function(s){return _isI(s);},
    format:function(n){return _f(n);},
    testBot:function(url,cb){
      _botUrl=url||_botUrl;
      if(!_botUrl){cb&&cb(false,'No URL');return;}
      fetch(_botUrl+'/api/health',{signal:AbortSignal.timeout(8000)})
        .then(function(r){return r.json();})
        .then(function(d){cb&&cb(d.status==='ok',d);})
        .catch(function(e){cb&&cb(false,e.message);});
    },
  };
})();
console.log('[AlertManager] ✅ Loaded');
