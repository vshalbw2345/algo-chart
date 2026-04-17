// ═══════════════════════════════════════════════════════════════
// alerts.js — Standalone Alert Manager for ALGO_VISH Chart
// Load after chart.html script: <script src="alerts.js"></script>
// ═══════════════════════════════════════════════════════════════

window.AlertManager = (function(){
  'use strict';

  // ── Internal state ──────────────────────────────────────────
  var _als    = [];
  var _frd    = [];
  var _botUrl = '';
  var _sheetUrl = '';
  var _rrCfg  = {capital:50000,leverage:4,riskPct:1,rrRatio:2,
                 cryptoLeverage:10,cryptoRiskPct:0.5,cryptoRRRatio:1.5};
  var _brokers = []; // fetched from AlgoBot
  var _alSide = 'buy';
  var _pendingPrice = null;
  var _editId = null;
  var _massSymList = null;
  var _liveData = {}; // sym→price, updated by chart

  function _ls(k){try{return JSON.parse(localStorage.getItem(k));}catch(e){return null;}}
  function _ss(k,v){localStorage.setItem(k,JSON.stringify(v));}
  function _f(n){if(n==null)return'—';return n>=10000?n.toFixed(2):n>=100?n.toFixed(2):n>=1?n.toFixed(4):n.toFixed(6);}
  function _isI(s){return s&&(s.indexOf('.NS')>-1||s.indexOf('.BSE')>-1);}

  function _load(){
    _als  = _ls('av_al')    || [];
    _frd  = _ls('av_fired') || [];
    _botUrl   = localStorage.getItem('av_bot')   || '';
    _sheetUrl = localStorage.getItem('av_sheet') || '';
  }

  function _save(){_ss('av_al',_als);}

  // Qty from AlgoBot RR formula
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

  // Fetch RR config from AlgoBot
  function _fetchRR(){
    if(!_botUrl)return;
    fetch(_botUrl+'/api/risk/config')
      .then(function(r){return r.json();})
      .then(function(d){if(d.success&&d.config)_rrCfg=d.config;})
      .catch(function(){});
  }

  // Fetch brokers from AlgoBot
  function _fetchBrokers(cb){
    _brokers=[{value:'auto',label:'Auto (by symbol type)'},
              {value:'none',label:'Chart only — no order'}];
    if(!_botUrl){cb&&cb();return;}
    Promise.all([
      fetch(_botUrl+'/api/auth/status').then(function(r){return r.json();}).catch(function(){return{};}),
      fetch(_botUrl+'/api/delta/status').then(function(r){return r.json();}).catch(function(){return{apis:[]};})
    ]).then(function(res){
      var fd=res[0],dd=res[1];
      if(fd.isAuthenticated){
        _brokers.push({value:'fyers',label:'Fyers — '+(fd.profile&&(fd.profile.name||fd.profile.email)||'Connected')});
      }
      (dd.apis||[]).filter(function(a){return a.connected;}).forEach(function(a){
        _brokers.push({value:'delta_'+a.id,label:'Delta Exchange — '+a.name+' ($'+parseFloat(a.availableBalance||0).toFixed(2)+')'});
      });
      cb&&cb();
    });
  }

  // Build broker dropdown HTML
  function _buildBrokerDD(sym){
    var sel=document.getElementById('am-broker');
    if(!sel)return;
    sel.innerHTML='';
    _brokers.forEach(function(b){
      var o=document.createElement('option');
      o.value=b.value;o.textContent=b.label;
      sel.appendChild(o);
    });
    // Auto-select correct broker for symbol
    if(_isI(sym)){
      sel.value=_brokers.some(function(b){return b.value==='fyers';})?'fyers':'auto';
    } else {
      var delta=_brokers.find(function(b){return b.value.indexOf('delta')===0;});
      sel.value=delta?delta.value:'auto';
    }
  }

  // Create all 6 alerts for a symbol at a price
  function _create6(sym,price,broker,tf,ordType,condSrc){
    if(!sym||!price)return 0;
    var isInd=_isI(sym);
    var rp=isInd?(_rrCfg.riskPct||1):(_rrCfg.cryptoRiskPct||0.5);
    var rr=isInd?(_rrCfg.rrRatio||2):(_rrCfg.cryptoRRRatio||1.5);
    var qty=_calcQty(sym,price);
    var slD=price*rp/100;
    var buySL =parseFloat((price-slD).toFixed(4));
    var buyTGT=parseFloat((price+slD*rr).toFixed(4));
    var sellSL=parseFloat((price+slD).toFixed(4));
    var sellTGT=parseFloat((price-slD*rr).toFixed(4));
    var now=new Date().toISOString();
    var isIndAlert=condSrc&&condSrc.indexOf('ind_')===0;
    var toCreate=[
      {type:'buy',    side:'BUY', price:price,   cond:'above',note:sym+' BUY @ '+_f(price)},
      {type:'buy_sl', side:'SELL',price:buySL,   cond:'below',note:sym+' Buy SL @ '+_f(buySL)+' ('+rp+'%)'},
      {type:'buy_tgt',side:'SELL',price:buyTGT,  cond:'above',note:sym+' Buy TGT @ '+_f(buyTGT)+' (1:'+rr+')'},
      {type:'sell',   side:'SELL',price:price,   cond:'below',note:sym+' SELL @ '+_f(price)},
      {type:'sell_sl',side:'BUY', price:sellSL,  cond:'above',note:sym+' Sell SL @ '+_f(sellSL)+' ('+rp+'%)'},
      {type:'sell_tgt',side:'BUY',price:sellTGT, cond:'below',note:sym+' Sell TGT @ '+_f(sellTGT)+' (1:'+rr+')'},
    ];
    var added=0;
    toCreate.forEach(function(at,k){
      // Duplicate check
      var exists=_als.some(function(a){
        return a.sym===sym&&a.type===at.type&&Math.abs(a.price-at.price)<0.01;
      });
      if(exists)return;
      _als.push({
        id:Date.now()+added+k,sym:sym,tf:tf||'5m',price:at.price,
        type:at.type,side:at.side,qty:qty,ordType:ordType||'MARKET',
        condition:at.cond,trigger:isIndAlert?'every':'once',
        broker:broker||'auto',note:at.note,logSheet:!!_sheetUrl,
        sendBot:broker!=='none',enabled:true,
        condSrc:condSrc||'price',
        createdAt:now,
        meta:{sl:buySL,tgt:buyTGT,riskPct:rp,rrRatio:rr,entry:price}
      });
      added++;
    });
    return added;
  }

  // Check alerts on candle close
  function _check(candle,curSym){
    if(!candle||!candle.close)return;
    var prev=null;
    var changed=false;
    _als.filter(function(a){return a.enabled&&a.sym===curSym;}).forEach(function(a){
      if(!a.condSrc||a.condSrc==='price'){
        // Price crossover check
        var op=a.condition||'above';
        var px=candle.close;
        var trig=op==='above'?px>=a.price:op==='below'?px<=a.price:(px>=a.price||px<=a.price);
        if(!trig)return;
        var age=(Date.now()-new Date(a.createdAt).getTime())/1000;
        if(age<15)return;
        _fireAlert(a,px);
        changed=true;
      }
    });
    if(changed){_save();}
  }

  // Fire alert from indicator signal
  function _fireFromIndicator(sym,signalType,price,candleTime){
    var key=sym+'_'+signalType+'_'+candleTime;
    if(_isFired[key])return;
    _isFired[key]=true;
    var matched=_als.filter(function(a){
      if(!a.enabled||a.sym!==sym)return false;
      if(!a.condSrc||a.condSrc==='price')return false;
      var indId=a.condSrc.replace('ind_','');
      var indOk=window.inds&&window.inds.some(function(i){return String(i.id)===String(indId)&&i.visible;});
      return indOk;
    });
    matched.forEach(function(a){
      var match=false;
      if(signalType==='buy'&&a.type==='buy')match=true;
      if(signalType==='sell'&&a.type==='sell')match=true;
      if(signalType==='sell'&&(a.type==='buy_sl'||a.type==='buy_tgt'))match=true;
      if(signalType==='buy'&&(a.type==='sell_sl'||a.type==='sell_tgt'))match=true;
      if(!match)return;
      var age=(Date.now()-new Date(a.createdAt).getTime())/1000;
      if(age<30)return;
      _fireAlert(a,price);
    });
    _save();
  }
  var _isFired={};

  function _fireAlert(a,price){
    a.firedAt=new Date().toISOString();
    _frd.unshift(Object.assign({},a,{firedPrice:price}));
    _frd=_frd.slice(0,50);
    _ss('av_fired',_frd);
    _toast('🔔 '+a.note,'info');
    if(a.sendBot&&_botUrl)_sendToBot(a,price);
    if(a.logSheet&&_sheetUrl)_logSheet(a,price);
  }

  function _sendToBot(a,price){
    var side=(a.type==='buy'||a.type==='buy_tgt')?'BUY':(a.type==='sell'||a.type==='sell_tgt')?'SELL':(a.type==='buy_sl')?'SELL':'BUY';
    fetch(_botUrl+'/api/alerts/webhook',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({symbol:a.sym,side:side,price:price||a.price,type:a.type,
        tf:a.tf,qty:a.qty||1,orderType:a.ordType||'MARKET',broker:a.broker||'auto',
        note:a.note||'',source:'chart',sl:a.meta&&a.meta.sl,tgt:a.meta&&a.meta.tgt,
        riskPct:a.meta&&a.meta.riskPct,rrRatio:a.meta&&a.meta.rrRatio,
        timestamp:new Date().toISOString()})
    }).then(function(r){return r.json();})
      .then(function(d){if(d.success)_toast('✅ '+side+' '+a.sym+' → '+(d.broker||'BOT').toUpperCase(),'success');
                        else _toast('❌ '+(d.error||'Order failed'),'error');})
      .catch(function(e){_toast('❌ Bot: '+e.message,'error');});
  }

  function _logSheet(a,price){
    if(!_sheetUrl)return;
    fetch(_sheetUrl,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({date:new Date().toLocaleString('en-IN'),symbol:a.sym,side:a.side,
        price:_f(price),qty:a.qty||1,broker:a.broker||'auto',tf:a.tf,type:a.type,note:a.note||'',source:'ALGO_VISH'})})
      .catch(function(){});
  }

  function _toast(msg,type){
    if(window.toast)window.toast(msg,type);
    else console.log('[ALERT]',type,msg);
  }

  // ── PUBLIC API ───────────────────────────────────────────────
  return {
    init:function(config){
      _botUrl=config.botUrl||'';
      _sheetUrl=config.sheetUrl||'';
      _load();
      _fetchRR();
      setInterval(_fetchRR,120000);
    },
    setLivePrice:function(sym,price){_liveData[sym]=price;},
    getLivePrice:function(sym){return _liveData[sym]||0;},
    getAlerts:function(){return _als;},
    getFired:function(){return _frd;},
    getRR:function(){return _rrCfg;},
    calcQty:function(sym,price){return _calcQty(sym,price);},
    check:function(candle,curSym){_check(candle,curSym);},
    fireFromIndicator:function(sym,sig,price,time){_fireFromIndicator(sym,sig,price,time);},
    create6:function(sym,price,broker,tf,ordType,condSrc){return _create6(sym,price,broker,tf,ordType,condSrc);},
    delete:function(id){_als=_als.filter(function(a){return a.id!==id;});_save();},
    toggle:function(id){var a=_als.find(function(x){return x.id===id;});if(a){a.enabled=!a.enabled;_save();}},
    clearAll:function(){_als=[];_save();},
    save:function(){_save();},
    fetchBrokers:function(sym,cb){_fetchBrokers(function(){_buildBrokerDD(sym);cb&&cb();});},
    isIndian:function(s){return _isI(s);},
    format:function(n){return _f(n);},
  };
})();

console.log('[AlertManager] ✅ Loaded');
