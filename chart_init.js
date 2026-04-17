// ═══════════════════════════════════════════════════════════════
// chart_init.js — UI controllers, watchlist, alert panel, boot
// Connects all modules together. No chart logic. No alert logic.
// ═══════════════════════════════════════════════════════════════

// ── Symbol search ─────────────────────────────────────────────
var SYM={
  filter:function(q){
    var dd=document.getElementById('sdd');
    var hits=window.SYMBOLS.search(q);
    dd.innerHTML=hits.map(function(s){
      return '<div class="sr" onclick="SYM.select(\''+s.s+'\')">'
        +'<div><div class="sn">'+s.l+'</div><div class="sd">'+s.n+'</div></div>'
        +'<span class="sbg">'+s.e+'</span></div>';
    }).join('');
    dd.classList.toggle('open',hits.length>0);
  },
  select:function(s){
    document.getElementById('sdd').classList.remove('open');
    document.getElementById('si').value=s;
    WL.loadSym(s,true);
  }
};
document.addEventListener('click',function(e){
  if(!e.target.closest('#sw'))document.getElementById('sdd').classList.remove('open');
});

// ── Watchlist ─────────────────────────────────────────────────
var WL=(function(){
  var _lists=[null,[],[],[]]; // index 1,2,3
  var _active=1;
  var _botSyncInterval=null;

  function _ls(k){try{return JSON.parse(localStorage.getItem(k));}catch(e){return null;}}
  function _ss(k,v){localStorage.setItem(k,JSON.stringify(v));}
  function _load(){
    _lists[1]=_ls('av_wl1')||['BTCUSDT','ETHUSDT','SOLUSDT'];
    _lists[2]=_ls('av_wl2')||[];
    _lists[3]=_ls('av_wl3')||[];
  }
  function _save(){_ss('av_wl'+_active,_lists[_active]);}
  function _cur(){return _lists[_active]||[];}

  function _render(){
    var el=document.getElementById('wlEl');if(!el)return;
    var list=_cur();
    // WL1 add row hidden (bot managed)
    document.getElementById('wlAddRow').style.display=_active===1?'none':'flex';
    document.getElementById('wl1info').style.display=_active===1?'block':'none';
    el.innerHTML=list.map(function(s){
      var info=window.SYMBOLS.find(s);
      var px=liveData[s]?f(liveData[s]):'—';
      return '<div class="wr'+(s===curSym?' on':'')+'" data-s="'+s+'" onclick="WL.loadSym(\''+s+'\')">'
        +'<div><span class="wsym">'+(info?info.l:s)+'</span><span class="wex">'+(info?info.e:'NSE')+'</span></div>'
        +'<div style="text-align:right"><div style="font-size:11px">'+px+'</div>'
        +(_active!==1?'<div style="font-size:9px;color:var(--t3);cursor:pointer" onclick="event.stopPropagation();WL.remove(\''+s+'\')">✕</div>':'')
        +'</div></div>';
    }).join('');
  }

  function _syncFromBot(){
    var botUrl=AlertManager.getBotUrl();
    if(!botUrl)return;
    fetch(botUrl+'/api/stocks/list',{signal:AbortSignal.timeout(4000)})
      .then(function(r){return r.json();})
      .then(function(d){
        if(!d.success||!d.stocks||!d.stocks.length)return;
        var converted=d.stocks.map(function(s){return s.replace('NSE:','').replace('-EQ','.NS');});
        var changed=JSON.stringify(converted)!==JSON.stringify(_lists[1]);
        if(changed){_lists[1]=converted;_ss('av_wl1',_lists[1]);if(_active===1)_render();}
      }).catch(function(){});
  }

  function _startWlStream(){
    var crypto=(_lists[1]||[]).concat(_lists[2]||[]).concat(_lists[3]||[]).filter(function(s){return!window.SYMBOLS.isIndian(s);});
    if(!crypto.length)return;
    var ws=new WebSocket('wss://stream.binance.com:9443/stream?streams='+crypto.map(function(s){return s.toLowerCase()+'@miniTicker';}).join('/'));
    ws.onmessage=function(e){var d=JSON.parse(e.data).data;if(!d)return;liveData[d.s]=parseFloat(d.c);_render();};
    ws.onerror=function(){setTimeout(_startWlStream,5000);};
  }

  return{
    init:function(){
      _load();
      _render();
      _startWlStream();
      // Sync WL1 from AlgoBot every 5s
      _botSyncInterval=setInterval(_syncFromBot,5000);
      _syncFromBot();
    },
    setActive:function(n){
      _active=n;
      [1,2,3].forEach(function(i){
        var el=document.getElementById('wl'+i+'btn');
        if(el)el.classList.toggle('on',i===n);
      });
      _render();
    },
    add:function(){
      var s=document.getElementById('addIn').value.trim().toUpperCase();if(!s)return;
      if(s.indexOf('.')<0&&s.indexOf('USDT')<0&&s.indexOf('BTC')<0&&s.length<=10)s+='.NS';
      if(_cur().indexOf(s)<0)_lists[_active].push(s);
      _save();document.getElementById('addIn').value='';
      _render();this.loadSym(s);
    },
    remove:function(s){
      var idx=_lists[_active].indexOf(s);
      if(idx>-1)_lists[_active].splice(idx,1);
      _save();_render();
    },
    loadSym:function(s,addToWL){
      curSym=s;
      document.getElementById('si').value=s;
      if(addToWL&&_cur().indexOf(s)<0&&_active!==1){_lists[_active].push(s);_save();}
      _render();
      Chart.load(s,curTF);
      AlertPanel._updateSym(s);
    },
    updatePrices:function(){_render();},
    getActive:function(){return _active;},
    getCurrent:function(){return _cur();},
  };
})();

// ── Indicator manager ─────────────────────────────────────────
var IndMgr=(function(){
  var _inds=[];
  var _series={};
  var _priceLines=[];

  function _ls(k){try{return JSON.parse(localStorage.getItem(k));}catch(e){return null;}}
  function _ss(k,v){localStorage.setItem(k,JSON.stringify(v));}
  function _load(){_inds=_ls('av_ind')||[];}
  function _save(){_ss('av_ind',_inds);}

  function _calcMA(candles,period,type){
    var r=[],ema=null,k=2/(period+1);
    for(var i=0;i<candles.length;i++){
      if(i<period-1){r.push({time:candles[i].time,value:null});continue;}
      if(type==='sma'){r.push({time:candles[i].time,value:candles.slice(i-period+1,i+1).reduce(function(s,x){return s+x.close;},0)/period});}
      else{if(ema===null)ema=candles.slice(0,period).reduce(function(s,x){return s+x.close;},0)/period;else ema=candles[i].close*k+ema*(1-k);r.push({time:candles[i].time,value:ema});}
    }
    return r;
  }
  function _calcBB(c,p,m){
    var u=[],mi=[],lo=[];
    for(var i=0;i<c.length;i++){
      if(i<p-1){[u,mi,lo].forEach(function(a){a.push({time:c[i].time,value:null});});continue;}
      var sl=c.slice(i-p+1,i+1).map(function(x){return x.close;});
      var mean=sl.reduce(function(s,v){return s+v;},0)/p;
      var sd=Math.sqrt(sl.reduce(function(s,v){return s+(v-mean)*(v-mean);},0)/p);
      u.push({time:c[i].time,value:mean+m*sd});mi.push({time:c[i].time,value:mean});lo.push({time:c[i].time,value:mean-m*sd});
    }
    return{upper:u,mid:mi,lower:lo};
  }
  function _calcVWAP(c){var ct=0,cv=0;return c.map(function(x){var tp=(x.high+x.low+x.close)/3;ct+=tp*(x.volume||1);cv+=(x.volume||1);return{time:x.time,value:cv?ct/cv:null};});}

  function _clearSeries(){
    Object.keys(_series).forEach(function(k){try{chart.removeSeries(_series[k]);}catch(e){}});
    _series={};
    _priceLines.forEach(function(pl){try{cs.removePriceLine(pl);}catch(e){}});
    _priceLines=[];
  }
  function _addPL(opts){try{var pl=cs.createPriceLine(opts);_priceLines.push(pl);}catch(e){}}

  function _renderOne(ind){
    if(!allCandles.length)return;
    var type=ind.type;
    // Use plugin if available
    if(window.INDICATORS&&window.INDICATORS[type.toUpperCase()]){
      var plugin=window.INDICATORS[type.toUpperCase()];
      plugin._cs=cs;plugin._chart=chart;
      plugin.onLoad(chart,cs,allCandles,curSym,AlertManager.getRR());
      return;
    }
    // Built-in renderers
    if(type==='sma'||type==='ema'){
      var s=chart.addLineSeries({color:ind.color,lineWidth:1,title:ind.name,lastValueVisible:true,priceLineVisible:false});
      s.setData(_calcMA(allCandles,ind.period,type).filter(function(v){return v.value!=null;}));
      _series[ind.id]=s;
    } else if(type==='bb'){
      var r=_calcBB(allCandles,20,2);
      ['u','m','l'].forEach(function(sfx,i){
        var s=chart.addLineSeries({color:i===1?ind.color+'80':ind.color,lineWidth:1,lastValueVisible:false,priceLineVisible:false});
        s.setData([r.upper,r.mid,r.lower][i].filter(function(v){return v.value!=null;}));
        _series[ind.id+'_'+sfx]=s;
      });
    } else if(type==='vwap'){
      var s=chart.addLineSeries({color:ind.color,lineWidth:2,title:'VWAP',lastValueVisible:true,priceLineVisible:false});
      s.setData(_calcVWAP(allCandles).filter(function(v){return v.value!=null;}));
      _series[ind.id]=s;
    }
  }

  return{
    init:function(){_load();},
    renderAll:function(){
      _clearSeries();
      _inds.filter(function(i){return i.visible&&i.type!=='pine';}).forEach(_renderOne);
    },
    openModal:function(id){
      var editId=id||null;
      if(id){
        var i=_inds.find(function(x){return x.id===id;});if(!i)return;
        document.getElementById('iname').value=i.name;
        document.getElementById('itype').value=i.type;
        document.getElementById('iperiod').value=i.period||20;
        document.getElementById('icolor').value=i.color||'#a78bfa';
        document.getElementById('iscript').value=i.script||'';
        document.getElementById('indSaveBtn').textContent='Update';
        document.getElementById('indMT').textContent='Edit Indicator';
      } else {
        ['iname','iscript'].forEach(function(k){document.getElementById(k).value='';});
        document.getElementById('indSaveBtn').textContent='Save';
        document.getElementById('indMT').textContent='Add Indicator';
      }
      document.getElementById('indModal').classList.add('open');
      document.getElementById('indModal')._editId=editId;
    },
    closeModal:function(){document.getElementById('indModal').classList.remove('open');},
    save:function(){
      var nm=document.getElementById('iname').value.trim();if(!nm){toast('Enter name','warn');return;}
      var editId=document.getElementById('indModal')._editId;
      var ind={id:editId||Date.now(),name:nm,type:document.getElementById('itype').value,
        period:parseInt(document.getElementById('iperiod').value)||20,
        color:document.getElementById('icolor').value,
        script:document.getElementById('iscript').value,visible:true};
      if(editId)_inds=_inds.map(function(i){return i.id===editId?ind:i;});
      else _inds.push(ind);
      _save();this.closeModal();this.renderAll();this.renderList();
      AlertPanel.updateCondDD();
      toast('✅ Indicator '+nm+' saved','success');
    },
    toggle:function(id){var i=_inds.find(function(x){return x.id===id;});if(i){i.visible=!i.visible;_save();this.renderAll();this.renderList();}},
    delete:function(id){
      Object.keys(_series).forEach(function(k){if(k.indexOf(String(id))===0){try{chart.removeSeries(_series[k]);}catch(e){}delete _series[k];}});
      _inds=_inds.filter(function(i){return i.id!==id;});
      _save();this.renderList();AlertPanel.updateCondDD();
    },
    exists:function(id){return _inds.some(function(i){return String(i.id)===String(id)&&i.visible;});},
    getAll:function(){return _inds;},
    renderList:function(){
      var el=document.getElementById('indEl');if(!el)return;
      el.innerHTML=!_inds.length?'<div class="note">No indicators</div>':
      _inds.map(function(i){
        return '<div class="ir"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">'
          +'<span style="font-size:11px;font-weight:700;color:'+i.color+'">'+i.name+'</span>'
          +'<div style="display:flex;gap:3px">'
          +'<button class="ib" onclick="IndMgr.toggle('+i.id+')">'+(i.visible?'Hide':'Show')+'</button>'
          +'<button class="ib" onclick="IndMgr.openModal('+i.id+')">✏</button>'
          +'<button class="ib del" onclick="IndMgr.delete('+i.id+')">✕</button>'
          +'</div></div>'
          +'<div style="font-size:9px;color:var(--t3)">'+i.type.toUpperCase()+(i.period?' ('+i.period+')':'')+'</div>'
          +'</div>';
      }).join('');
    },
  };
})();
// Expose for chart_engine
window.IndMgr=IndMgr;

// ── Alert panel ───────────────────────────────────────────────
var AlertPanel=(function(){
  var _panel=null, _side='buy', _px=null;

  function _getEl(id){return document.getElementById(id);}
  function _f(n){return AlertManager.format(n);}

  function _render(){
    var als=AlertManager.getAll().filter(function(a){return a.sym===curSym;});
    var el=_getEl('alEl'),no=_getEl('noAl');
    if(!el)return;
    no.style.display=als.length?'none':'block';
    var AC={buy:'#00d085',sell:'#ff4560',buy_sl:'#ff4560',buy_tgt:'#00d085',sell_sl:'#00d085',sell_tgt:'#ff4560'};
    el.innerHTML=als.map(function(a){
      var c=AC[a.type]||'#f59e0b';
      return '<div style="padding:6px 7px;border-radius:5px;margin-bottom:3px;border-left:3px solid '+c+';background:'+c+'08">'
        +'<div style="display:flex;justify-content:space-between;align-items:center">'
        +'<span style="font-size:11px;font-weight:700;color:'+c+';overflow:hidden;max-width:115px;text-overflow:ellipsis;white-space:nowrap" title="'+a.note+'">'+a.note+'</span>'
        +'<div style="display:flex;gap:2px;align-items:center;flex-shrink:0">'
        +'<button style="width:26px;height:15px;'+(a.enabled?'background:var(--G)':'background:var(--bd2)')+';border-radius:8px;cursor:pointer;position:relative;border:none" onclick="AlertPanel.toggle('+a.id+')"></button>'
        +'<button class="ib" onclick="AlertPanel.edit('+a.id+')" style="padding:1px 4px">✏</button>'
        +'<button class="ib del" onclick="AlertPanel.del('+a.id+')">✕</button>'
        +'</div></div>'
        +'<div style="font-size:9px;color:var(--t2);margin-top:2px">'+_f(a.price)+' x'+(a.qty||1)+' · '+(a.tf||curTF).toUpperCase()+' '+(a.sendBot?'🤖':'')+' '+(a.firedAt?'<span style=\'color:var(--G)\'>✅</span>':'')+'</div>'
        +'</div>';
    }).join('');
  }

  return{
    init:function(){
      _panel=document.createElement('div');
      _panel.id='alpanel';
      _panel.style.cssText='position:absolute;bottom:36px;left:0;right:0;background:var(--bg2);border-top:1px solid var(--bd2);z-index:100;display:none;padding:14px 16px;max-height:500px;overflow-y:auto;box-shadow:0 -8px 24px #00000080';
      document.getElementById('carea').appendChild(_panel);
      this._buildHTML();
    },
    _buildHTML:function(){
      _panel.innerHTML=
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'
        +'<div><div style="font-size:9px;color:var(--t2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Create Alert on</div>'
        +'<span id="apSym" style="font-size:16px;font-weight:800;color:var(--B)">—</span></div>'
        +'<button onclick="AlertPanel.close()" style="background:none;border:none;color:var(--t2);font-size:20px;cursor:pointer">✕</button></div>'

        +'<div style="height:1px;background:var(--bd);margin:8px 0"></div>'

        +'<label style="display:block;font-size:10px;color:var(--t2);margin-bottom:3px;font-weight:600;text-transform:uppercase">Condition</label>'
        +'<select id="apCond" onchange="AlertPanel.onCondChange()" style="width:100%;background:var(--bg3);border:1px solid var(--bd);color:var(--t);padding:6px 8px;border-radius:5px;font-family:var(--fn);font-size:11px;margin-bottom:6px"><option value="price">Price</option></select>'

        +'<div id="apIndSec" style="display:none;margin-bottom:6px">'
        +'<label style="display:block;font-size:10px;color:var(--t2);margin-bottom:3px;font-weight:600;text-transform:uppercase">Signal Type</label>'
        +'<select id="apIT" style="width:100%;background:var(--bg3);border:1px solid var(--bd);color:var(--t);padding:6px 8px;border-radius:5px;font-family:var(--fn);font-size:11px">'
        +'<option value="all">⚡ All 6 Alerts</option>'
        +'<option value="buy">Buy</option><option value="sell">Sell</option>'
        +'<option value="buy_sl">Buy Stoploss</option><option value="buy_tgt">Buy Target</option>'
        +'<option value="sell_sl">Sell Stoploss</option><option value="sell_tgt">Sell Target</option>'
        +'</select></div>'

        +'<div id="apPxSec" style="margin-bottom:6px">'
        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px">'
        +'<div><label style="display:block;font-size:10px;color:var(--t2);margin-bottom:3px;font-weight:600;text-transform:uppercase">Crosses</label>'
        +'<select id="apOp" style="width:100%;background:var(--bg3);border:1px solid var(--bd);color:var(--t);padding:6px 8px;border-radius:5px;font-family:var(--fn);font-size:11px">'
        +'<option value="all">⚡ All 6 Alerts</option>'
        +'<option value="above">Above</option><option value="below">Below</option><option value="cross">Cross</option>'
        +'</select></div>'
        +'<div><label style="display:block;font-size:10px;color:var(--t2);margin-bottom:3px;font-weight:600;text-transform:uppercase">Price Level</label>'
        +'<input id="apPx" type="number" step="any" placeholder="0.00" style="width:100%;background:var(--bg3);border:1px solid var(--bd);color:var(--t);padding:6px 8px;border-radius:5px;font-family:var(--fn);font-size:11px"></div>'
        +'</div></div>'

        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:6px">'
        +'<div><label style="display:block;font-size:10px;color:var(--t2);margin-bottom:3px;font-weight:600;text-transform:uppercase">Interval</label>'
        +'<select id="apTF" style="width:100%;background:var(--bg3);border:1px solid var(--bd);color:var(--t);padding:6px 8px;border-radius:5px;font-family:var(--fn);font-size:11px">'
        +'<option value="same">Same as chart</option><option value="1m">1M</option><option value="5m">5M</option><option value="15m">15M</option><option value="1h">1H</option>'
        +'</select></div>'
        +'<div><label style="display:block;font-size:10px;color:var(--t2);margin-bottom:3px;font-weight:600;text-transform:uppercase">Trigger</label>'
        +'<select id="apTr" style="width:100%;background:var(--bg3);border:1px solid var(--bd);color:var(--t);padding:6px 8px;border-radius:5px;font-family:var(--fn);font-size:11px">'
        +'<option value="once">Only once</option><option value="bar">Once per bar</option><option value="barclose">Per bar close</option><option value="minute">Per minute</option>'
        +'</select></div></div>'

        +'<div style="height:1px;background:var(--bd);margin:8px 0"></div>'

        +'<label style="display:block;font-size:10px;color:var(--t2);margin-bottom:3px;font-weight:600;text-transform:uppercase">Broker & Account <span id="brkL" style="color:var(--t3);font-weight:400;text-transform:none"></span></label>'
        +'<select id="apBrk" style="width:100%;background:var(--bg3);border:1px solid var(--bd);color:var(--t);padding:6px 8px;border-radius:5px;font-family:var(--fn);font-size:11px;margin-bottom:6px">'
        +'<option value="auto">Auto</option><option value="none">Chart only</option></select>'

        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:6px">'
        +'<div><label style="display:block;font-size:10px;color:var(--t2);margin-bottom:3px;font-weight:600;text-transform:uppercase">Quantity</label>'
        +'<input id="apQty" type="number" value="1" min="1" style="width:100%;background:var(--bg3);border:1px solid var(--bd);color:var(--t);padding:6px 8px;border-radius:5px;font-family:var(--fn);font-size:11px"></div>'
        +'<div><label style="display:block;font-size:10px;color:var(--t2);margin-bottom:3px;font-weight:600;text-transform:uppercase">Order Type</label>'
        +'<select id="apOT" style="width:100%;background:var(--bg3);border:1px solid var(--bd);color:var(--t);padding:6px 8px;border-radius:5px;font-family:var(--fn);font-size:11px">'
        +'<option value="MARKET">Market</option><option value="LIMIT">Limit</option>'
        +'</select></div></div>'

        +'<label style="display:block;font-size:10px;color:var(--t2);margin-bottom:3px;font-weight:600;text-transform:uppercase">Message / Alert Name</label>'
        +'<input id="apNote" placeholder="e.g. Fyers SBIN BUY — ORB Breakout" style="width:100%;background:var(--bg3);border:1px solid var(--bd);color:var(--t);padding:6px 8px;border-radius:5px;font-family:var(--fn);font-size:11px;margin-bottom:4px">'
        +'<div style="font-size:10px;color:var(--t3);margin-bottom:8px">This name appears as heading in Alerts list</div>'

        +'<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t2);cursor:pointer;margin-bottom:8px">'
        +'<input type="checkbox" id="apSh" style="width:14px;height:14px"> Log to Google Sheet</label>'

        +'<div style="padding:6px 8px;border-radius:5px;background:var(--B)08;border:1px solid var(--B)20;font-size:10px;color:var(--B);margin-bottom:10px">'
        +'🤖 When price hits → AlgoBot places order automatically</div>'

        +'<div style="display:flex;gap:7px">'
        +'<button onclick="AlertPanel.close()" style="background:transparent;border:1px solid var(--bd);color:var(--t2);padding:9px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-family:var(--fn)">Cancel</button>'
        +'<button id="apOk" onclick="AlertPanel.confirm()" style="flex:1;border:none;color:#fff;padding:9px;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px;font-family:var(--fn);background:var(--G)">Create Alert</button>'
        +'</div>';
    },
    _updateSym:function(s){
      var el=document.getElementById('apSym');
      if(el)el.textContent=s;
    },
    updateCondDD:function(){
      var sel=document.getElementById('apCond');if(!sel)return;
      sel.innerHTML='<option value="price">Price</option>';
      IndMgr.getAll().forEach(function(i){
        var o=document.createElement('option');o.value='ind_'+i.id;o.textContent=i.name;sel.appendChild(o);
      });
    },
    onCondChange:function(){
      var v=document.getElementById('apCond').value;
      var isInd=v.indexOf('ind_')===0;
      document.getElementById('apIndSec').style.display=isInd?'block':'none';
      document.getElementById('apPxSec').style.display=isInd?'none':'block';
      if(isInd&&allCandles.length){
        document.getElementById('apPx').value=f(allCandles[allCandles.length-1].close);
      }
    },
    open:function(px){
      _px=px||null;
      document.getElementById('apSym').textContent=curSym;
      if(px)document.getElementById('apPx').value=f(px);
      else if(allCandles.length)document.getElementById('apPx').value=f(allCandles[allCandles.length-1].close);
      document.getElementById('apQty').value=1;
      document.getElementById('apOT').value='MARKET';
      document.getElementById('apTF').value='same';
      document.getElementById('apTr').value='once';
      document.getElementById('apNote').value='';
      document.getElementById('apSh').checked=!!AlertManager.getSheetUrl();
      document.getElementById('apOk').textContent='Create Alert';
      document.getElementById('apOk').style.background='var(--G)';
      delete document.getElementById('apOk')._editId;
      this.updateCondDD();
      this.onCondChange();
      // Fetch brokers and auto-select correct one
      AlertManager.fetchBrokers(function(){
        var sel=document.getElementById('apBrk');if(!sel)return;
        sel.innerHTML='';
        AlertManager.getBrokers().forEach(function(b){
          var o=document.createElement('option');o.value=b.v;o.textContent=b.t;sel.appendChild(o);
        });
        // Auto-select: Fyers for Indian, Delta for crypto
        if(isI(curSym)){
          var fyersOpt=AlertManager.getBrokers().find(function(b){return b.v==='fyers';});
          if(fyersOpt)sel.value='fyers';
        } else {
          var deltaOpt=AlertManager.getBrokers().find(function(b){return b.v.indexOf('delta')===0;});
          if(deltaOpt)sel.value=deltaOpt.v;
        }
        var lbl=document.getElementById('brkL');
        if(lbl)lbl.textContent='('+(sel.options.length-2)+' broker'+(sel.options.length-2!==1?'s':'')+' found)';
      });
      _panel.style.display='block';
    },
    close:function(){_panel.style.display='none';_px=null;},
    openMass:function(){
      var list=WL.getCurrent();
      if(!list.length){toast('Watchlist is empty','warn');return;}
      var n=list.length;
      var ok=confirm('Create alerts for ALL '+n+' stocks in Watchlist '+WL.getActive()+'?');
      if(!ok)return;
      // Open panel to get settings, then apply to all
      this.open();
      var btn=document.getElementById('apOk');
      if(btn){btn.textContent='⚡ Apply to All '+n+' Stocks';btn.style.background='#a78bfa';}
      btn._massMode=true;
    },
    confirm:function(){
      var btn=document.getElementById('apOk');
      if(btn&&btn._massMode){this._confirmMass();return;}
      var condSrc=document.getElementById('apCond').value;
      var isInd=condSrc.indexOf('ind_')===0;
      var sigType=isInd?document.getElementById('apIT').value:document.getElementById('apOp').value;
      var price=parseFloat(document.getElementById('apPx').value)||_px;
      if(!price&&allCandles.length)price=allCandles[allCandles.length-1].close;
      if(!price){toast('Enter a price','warn');return;}

      // All 6 alerts
      if(sigType==='all'){
        var brk=document.getElementById('apBrk').value;
        var tf=document.getElementById('apTF').value;if(tf==='same')tf=curTF;
        var n=AlertManager.create6(curSym,price,brk,tf,document.getElementById('apOT').value,condSrc);
        IndMgr.renderList();
        Draw.render();this.close();
        UI.refreshAlerts();
        toast('✅ '+n+' alerts created for '+curSym,'success');
        return;
      }

      // Single alert
      var editId=btn&&btn._editId;
      if(editId)AlertManager.delete(editId);
      var side=(sigType==='buy'||sigType==='buy_tgt')?'BUY':'SELL';
      var a={
        id:Date.now(),sym:curSym,
        tf:document.getElementById('apTF').value==='same'?curTF:document.getElementById('apTF').value,
        price:price,type:isInd?sigType:_side||'buy',side:side,
        qty:parseInt(document.getElementById('apQty').value)||1,
        ordType:document.getElementById('apOT').value,
        condition:document.getElementById('apOp').value,
        condSrc:condSrc||'price',
        trigger:document.getElementById('apTr').value,
        broker:document.getElementById('apBrk').value,
        note:document.getElementById('apNote').value||(side+' '+curSym+' @ '+f(price)),
        logSheet:document.getElementById('apSh').checked,
        sendBot:document.getElementById('apBrk').value!=='none',
        enabled:true,createdAt:new Date().toISOString(),
      };
      AlertManager.createOne(a);
      UI.refreshAlerts();Draw.render();this.close();
      toast('🔔 Alert: '+a.note,'success');
    },
    _confirmMass:function(){
      var condSrc=document.getElementById('apCond').value;
      var isInd=condSrc.indexOf('ind_')===0;
      var brkBase=document.getElementById('apBrk').value;
      var tf=document.getElementById('apTF').value;if(tf==='same')tf=curTF;
      var ordType=document.getElementById('apOT').value;
      var list=WL.getCurrent();
      var total=0;
      list.forEach(function(sym){
        // Get price: live data or current chart if same sym
        var price=liveData[sym]||0;
        if(!price&&sym===curSym&&allCandles.length)price=allCandles[allCandles.length-1].close;
        if(!price){console.warn('[MASS] No price for '+sym+' — skip');return;}
        // Broker: Fyers for Indian, Delta for crypto
        var brk=isI(sym)?'fyers':brkBase;
        // Auto-select correct broker
        var brokers=AlertManager.getBrokers();
        if(isI(sym)){var fb=brokers.find(function(b){return b.v==='fyers';});if(!fb)brk='auto';}
        else{var db=brokers.find(function(b){return b.v.indexOf('delta')===0;});if(db)brk=db.v;}
        var n=AlertManager.create6(sym,price,brk,tf,ordType,condSrc);
        total+=n;
      });
      UI.refreshAlerts();Draw.render();this.close();
      toast('✅ '+total+' alerts created for '+list.length+' stocks','success');
    },
    toggle:function(id){AlertManager.toggle(id);_render();Draw.render();},
    del:function(id){AlertManager.delete(id);_render();Draw.render();},
    edit:function(id){
      var a=AlertManager.getAll().find(function(x){return x.id===id;});if(!a)return;
      this.open(a.price);
      document.getElementById('apPx').value=a.price;
      document.getElementById('apQty').value=a.qty||1;
      document.getElementById('apNote').value=a.note||'';
      document.getElementById('apOT').value=a.ordType||'MARKET';
      document.getElementById('apTr').value=a.trigger||'once';
      var btn=document.getElementById('apOk');
      if(btn){btn.textContent='Update Alert';btn._editId=id;}
    },
    refresh:function(){_render();},
  };
})();

// ── Bot config ────────────────────────────────────────────────
var BotCfg={
  open:function(){
    document.getElementById('botUrlM').value=AlertManager.getBotUrl();
    document.getElementById('sheetUrlM').value=AlertManager.getSheetUrl();
    document.getElementById('botModal').classList.add('open');
  },
  close:function(){document.getElementById('botModal').classList.remove('open');},
  save:function(){
    var url=document.getElementById('botUrlM').value.trim().replace(/\/$/,'');
    var sheet=document.getElementById('sheetUrlM').value.trim();
    AlertManager.setBotUrl(url);
    AlertManager.setSheetUrl(sheet);
    this.close();
    this._test(url);
  },
  _test:function(url){
    AlertManager.testBot(url,function(ok,d){
      var bst=document.getElementById('bst');
      if(ok){
        bst.style.cssText='border-color:var(--G)50;color:var(--G);background:var(--G)10';
        bst.textContent='⚡Bot ✅';
        document.getElementById('botInfo').textContent='Auth:'+(d.auth?'✓':'✗')+' Feed:'+(d.dataFeed?'✓':'✗');
        toast('✅ AlgoBot connected!','success');
        // Fetch broker info for display
        AlertManager.fetchBrokers(function(){
          var b=AlertManager.getBrokers().slice(2).map(function(x){return x.t.split('—')[0].trim();}).join(' | ');
          if(b){var tag=document.getElementById('brokerTag');if(tag){tag.textContent='🏦 '+b;tag.style.display='block';}}
        });
      } else {
        bst.style.cssText='border-color:var(--R)50;color:var(--R);background:var(--R)10';
        bst.textContent='⚡Bot ✗';
      }
    });
  }
};

// ── UI helpers ────────────────────────────────────────────────
var UI={
  showTab:function(id,el){
    ['wl','ind','al'].forEach(function(t){
      var tab=document.getElementById('st-'+t);
      if(tab)tab.style.display=t===id?'block':'none';
    });
    document.querySelectorAll('.stab').forEach(function(s){s.classList.remove('on');});
    el.classList.add('on');
    if(id==='al'){AlertPanel.refresh();IndMgr.renderList();}
    if(id==='ind')IndMgr.renderList();
  },
  refreshAlerts:function(){AlertPanel.refresh();},
};

// ── Boot ──────────────────────────────────────────────────────
window.onload=function(){
  // Wait for LightweightCharts CDN
  var tries=0;
  function boot(){
    if(typeof LightweightCharts==='undefined'){
      if(++tries<50){setTimeout(boot,100);return;}
      document.getElementById('chart').innerHTML='<div style="color:var(--R);padding:40px;font-size:14px">❌ Chart library failed. Refresh page.</div>';
      return;
    }
    // Init all modules
    AlertManager.init();
    Chart.init();
    IndMgr.init();
    AlertPanel.init();
    WL.init();

    // Restore bot URL
    var botUrl=AlertManager.getBotUrl();
    if(botUrl){
      BotCfg._test(botUrl);
      AlertManager.fetchBrokers(function(){});
    }

    // Load initial symbol
    WL.loadSym(curSym);

    // Periodic canvas render
    setInterval(function(){Draw.render();},500);
  }
  boot();
};
