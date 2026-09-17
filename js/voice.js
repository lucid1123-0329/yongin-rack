/** voice.js — 녹음 오디오를 서버의 Gemini로 전사한 뒤 확인하여 품목 담기 */
(function (root) {
  function appRef() { try { if (typeof App!=='undefined' && App) return App; } catch (_) {} return null; }
  function wizardRef() { try { if (typeof EstimateWizard!=='undefined' && EstimateWizard) return EstimateWizard; } catch (_) {} return null; }
  function uiRef() { try { if (typeof UI!=='undefined' && UI) return UI; } catch (_) {} return null; }
  'use strict';

  var LOG_KEY = 'yr_voice_log';
  var state = { raw:'', normalized:'', rows:[], modified:false, recognition:null, timer:null, logTimestamp:'' };
  var nativeNumbers = { 하나:1, 한:1, 둘:2, 두:2, 셋:3, 세:3, 넷:4, 네:4, 다섯:5, 여섯:6, 일곱:7, 여덟:8, 아홉:9 };
  var sinoDigits = { 영:0, 공:0, 일:1, 이:2, 삼:3, 사:4, 오:5, 육:6, 칠:7, 팔:8, 구:9 };
  var aliases = {
    경량랙:['경량랙','경량'], 중량랙:['중량랙','중량'], 아연랙:['아연랙','아연'],
    파렛트랙:['파렛트랙','파레트랙','팔레트랙','파렛트','파레트','팔레트'],
    하이퍼:['하이퍼 진열대','하이퍼'], 곤도라:['곤도라 진열대','곤도라'],
    앵글:['무볼트앵글','무볼트 앵글','무볼트','앵글']
  };

  function koreanNumber(value) {
    var word = String(value || '').replace(/\s/g, '');
    if (Object.prototype.hasOwnProperty.call(nativeNumbers, word)) return nativeNumbers[word];
    if (/^\d+$/.test(word)) return Number(word);
    var total = 0, section = 0, digit = 0;
    for (var i = 0; i < word.length; i += 1) {
      var char = word[i];
      if (Object.prototype.hasOwnProperty.call(sinoDigits, char)) digit = sinoDigits[char];
      else if (char === '십' || char === '백' || char === '천') {
        var unit = char === '십' ? 10 : (char === '백' ? 100 : 1000);
        section += (digit || 1) * unit; digit = 0;
      } else if (char === '만') {
        total += (section + digit || 1) * 10000; section = 0; digit = 0;
      } else return NaN;
    }
    return total + section + digit;
  }

  function normalize(text) {
    var result = String(text || '').toLowerCase()
      .replace(/[，、]/g, ',').replace(/그리고|하고/g, ',')
      .replace(/미리미터|밀리미터|미리|밀리|mm/gi, ' ');
    result = result.replace(/(^|[\s,])([영공일이삼사오육칠팔구십백천만하나둘셋넷다섯여섯일곱여덟아홉두세네]+)(?=$|[\s,]|대|단)/g, function (_, prefix, word) {
      var number = koreanNumber(word);
      return prefix + (Number.isFinite(number) ? String(number) : word);
    });
    return result.replace(/(\d+)\s*(대|개)/g, '$1대').replace(/(\d+)\s*단/g, '$1단')
      .replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim();
  }

  function unique(values) {
    return values.filter(function (value, index) { return value && values.indexOf(value) === index; });
  }

  function typeEntries(priceData) {
    var types = unique((priceData || []).map(function (row) { return String(row.type || '').trim(); }));
    var entries = [];
    types.forEach(function (type) { entries.push({ alias:type.toLowerCase(), type:type }); });
    Object.keys(aliases).forEach(function (key) {
      var type = types.find(function (candidate) {
        if (key === '하이퍼' || key === '곤도라') return candidate.indexOf(key) >= 0;
        if (key === '앵글') return candidate.indexOf('앵글') >= 0 || candidate.indexOf('무볼트') >= 0;
        return candidate === key || candidate.replace(/\s/g, '').indexOf(key) >= 0;
      });
      if (type) aliases[key].forEach(function (alias) { entries.push({ alias:alias.toLowerCase(), type:type }); });
    });
    return entries.sort(function (a, b) { return b.alias.length - a.alias.length; });
  }

  function findType(segment, priceData) {
    var compact = segment.toLowerCase().replace(/\s/g, '');
    return typeEntries(priceData).find(function (entry) { return compact.indexOf(entry.alias.replace(/\s/g, '')) >= 0; }) || null;
  }

  function logicalForm(text) {
    if (/(연결형|연결)/.test(text)) return 'linked';
    if (/(독립형|독립|스탠드)/.test(text)) return 'independent';
    if (/벽면/.test(text)) return 'wall';
    return '';
  }

  function resolveForm(type, logical, priceData) {
    var forms = unique((priceData || []).filter(function (row) { return row.type === type; })
      .map(function (row) { return String(row.form || '').trim(); }));
    var target = logical || 'independent';
    var match = forms.find(function (form) {
      if (target === 'linked') return form.indexOf('연결') >= 0;
      if (target === 'wall') return form.indexOf('벽면') >= 0;
      return form.indexOf('독립') >= 0 || form.indexOf('스탠드') >= 0;
    });
    if (match) return match;
    if (target === 'independent') return forms.indexOf('독립형') >= 0 ? '독립형' : (forms.indexOf('독립') >= 0 ? '독립' : (forms[0] || '독립'));
    return forms[0] || (target === 'linked' ? '연결' : (target === 'wall' ? '벽면' : '독립'));
  }

  function parse(text, priceData) {
    var normalized = normalize(text), inherited = '', rows = [];
    normalized.split(',').map(function (part) { return part.trim(); }).filter(Boolean).forEach(function (segment) {
      var typeEntry = findType(segment, priceData);
      if (!typeEntry) { rows.push({ source:segment, error:'종류를 찾지 못했습니다', status:'none', quantity:1, defaultQty:true }); return; }
      var explicitForm = logicalForm(segment);
      var inheritedForm = inherited;
      var formKind = explicitForm || inheritedForm || 'independent';
      var tierMatch = segment.match(/(\d+)단/), quantityMatch = segment.match(/(\d+)대/);
      var nums = (segment.replace(/\d+단/g, ' ').replace(/\d+대/g, ' ').match(/\d+/g) || []).map(Number);
      rows.push({ source:segment, type:typeEntry.type, form:resolveForm(typeEntry.type, formKind, priceData), formKind:formKind,
        W:nums[0] || 0, D:nums[1] || 0, H:nums[2] || 0, tier:tierMatch ? Number(tierMatch[1]) : null,
        quantity:quantityMatch ? Math.max(1, Number(quantityMatch[1])) : 1,
        defaultForm:!explicitForm && !inheritedForm, defaultQty:!quantityMatch,
        confirmedDefaults:Boolean(explicitForm && quantityMatch) });
      inherited = formKind;
    });
    return { original:String(text || ''), normalized:normalized, items:rows };
  }

  function numbers(value) {
    return (String(value || '').match(/\d[\d,]*/g) || []).map(function (part) { return Number(part.replace(/,/g, '')); }).filter(Number.isFinite);
  }

  function dimensions(row) {
    var type=String(row.type||''), spec=String(row.spec||'');
    var specNums=numbers(spec), tierNums=numbers(row.tier), W=0, D=0, H=0;
    if (type.indexOf('하이퍼')>=0) {
      W=specNums[0]||0; D=specNums[1]||(String(row.layoutType||'').indexOf('중앙')>=0?1000:500); H=tierNums[0]||specNums[2]||0;
    } else if (['고급경량랙','MD경량랙','MD중량랙','KD중량랙'].indexOf(type)>=0) {
      D=specNums[0]||0; W=specNums[1]||0; H=specNums[2]||tierNums[0]||0;
    } else if (specNums.length>=3) {
      W=specNums[0]; D=specNums[1]; H=specNums[2];
    } else if (specNums.length>=2 && tierNums.length) {
      D=specNums[0]; W=specNums[1]; H=tierNums[0];
    }
    return { W:W, D:D, H:H };
  }

  function tierNumber(row) {
    var direct=String(row.tier||'').match(/^(\d+)(?:\s*단)?$/);
    if (direct) return Number(direct[1]);
    var paren=String(row.tier||'').match(/\((\d+)\s*단\)/);
    return paren?Number(paren[1]):null;
  }

  function matchItem(item, priceData) {
    if (!item || item.error || !item.W || !item.D || !item.H) {
      return Object.assign(item||{}, { status:'none', candidates:[], error:item&&item.error?item.error:'치수를 찾지 못했습니다' });
    }
    var pool=(priceData||[]).filter(function (row) {
      return row.type===item.type && String(row.form||'')===String(item.form||'') && Number(row.unitPrice)>0 && !row.isAccessory;
    });
    var exact=pool.find(function (row) {
      var dim=dimensions(row);
      return dim.W===item.W && dim.D===item.D && dim.H===item.H && (item.tier==null || tierNumber(row)===item.tier);
    });
    if (exact) {
      item.row=exact; item.status=item.defaultForm||item.defaultQty?'default':'exact'; item.candidates=[]; return item;
    }
    item.candidates=pool.map(function (row) {
      var dim=dimensions(row);
      var different=['W','D','H'].filter(function (axis) { return dim[axis]!==item[axis]; });
      return { row:row, dimensions:dim, different:different, distance:Math.abs(dim.W-item.W)+Math.abs(dim.D-item.D)+Math.abs(dim.H-item.H) };
    }).filter(function (candidate) {
      return candidate.different.length===1 && (item.tier==null || tierNumber(candidate.row)===item.tier);
    }).sort(function (a,b) { return a.distance-b.distance; }).slice(0,3);
    item.row=null; item.status='none'; item.error='정확히 일치하는 규격이 없습니다';
    return item;
  }

  function matchAll(parsed, priceData) {
    parsed.items=parsed.items.map(function (item) { return matchItem(item,priceData); });
    return parsed;
  }

  function escapeHtml(value) {
    return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;');
  }
  function rowTitle(item) {
    return [item.type||'종류 미확인',item.form||'-',[item.W||'?',item.D||'?',item.H||'?'].join('×'),(item.quantity||1)+'대'].join(' / ');
  }
  function canAdd() {
    return state.rows.length>0&&state.rows.every(function (item) {
      return item.row&&item.status!=='none'&&(!(item.defaultForm||item.defaultQty)||item.confirmedDefaults);
    });
  }

  function render() {
    var list=root.document&&root.document.getElementById('voice-result-list');
    if (!list) return;
    list.innerHTML=state.rows.map(function (item,index) {
      var label=item.status==='exact'?'정확히 찾음':(item.status==='default'?'기본값 확인 필요':'미매칭');
      var candidates='';
      if (item.status==='none'&&item.candidates&&item.candidates.length) {
        candidates='<div class=voice-candidates>'+item.candidates.map(function (candidate,candidateIndex) {
          var dim=candidate.dimensions;
          return `<button type=button onclick=VoiceAdd.chooseCandidate(${index},${candidateIndex})>${escapeHtml(dim.W+'×'+dim.D+'×'+dim.H)}</button>`;
        }).join('')+'</div>';
      } else if (item.status==='none') candidates=`<button type=button class=voice-direct onclick=VoiceAdd.chooseDirect(${index})>직접 고르기</button>`;
      var confirm=item.status==='default'&&!item.confirmedDefaults?`<button type=button class=voice-confirm-default onclick=VoiceAdd.confirmDefault(${index})>기본값 확인</button>`:'';
      return `<article class='voice-result-row is-${item.status}'><p class=voice-result-title>${escapeHtml(rowTitle(item))}</p><p class=voice-result-status>${label}</p><div class=voice-row-controls><button type=button onclick=VoiceAdd.toggleForm(${index})>독립↔연결</button><div class=voice-quantity><button type=button onclick=VoiceAdd.changeQty(${index},-1)>−</button><span>${item.quantity}</span><button type=button onclick=VoiceAdd.changeQty(${index},1)>+</button></div></div>${confirm}${candidates}</article>`;
    }).join('');
    var addButton=root.document.getElementById('voice-add-items');
    if (addButton) { addButton.textContent=state.rows.length+'개 담기'; addButton.disabled=!canAdd(); }
    var failure=root.document.getElementById('voice-failure');
    if (failure) failure.classList.toggle('hidden',state.rows.length>0&&state.rows.some(function (row) { return row.type; }));
  }

  function logResult() {
    try {
      var logs=JSON.parse(root.localStorage.getItem(LOG_KEY)||'[]');
      var timestamp=state.logTimestamp||new Date().toISOString();
      logs=logs.filter(function (entry) { return entry['시각']!==timestamp; });
      logs.unshift({ '원문':state.raw, '정규화문':state.normalized,
        '파싱 결과':state.rows.map(function (item) { return { type:item.type||'',form:item.form||'',W:item.W||0,D:item.D||0,H:item.H||0,tier:item.tier,quantity:item.quantity,status:item.status }; }),
        '사용자 수정 여부':Boolean(state.modified), '시각':timestamp });
      root.localStorage.setItem(LOG_KEY,JSON.stringify(logs.slice(0,50)));
    } catch (_) {}
  }
  function openResult(text) {
    state.raw=String(text||'');
    state.logTimestamp=new Date().toISOString();
    var data=appRef()?appRef().priceData:[];
    var parsed=matchAll(parse(state.raw,data),data);
    state.normalized=parsed.normalized; state.rows=parsed.items; state.modified=false;
    var transcript=root.document.getElementById('voice-transcript');
    if (transcript) transcript.textContent='“'+state.raw+'”';
    root.document.getElementById('voice-result-sheet').classList.remove('hidden');
    render(); logResult();
  }
  function close() {
    if (root.document) root.document.getElementById('voice-result-sheet').classList.add('hidden');
  }
  function setCardMessage(message,isError) {
    var element=root.document&&root.document.getElementById('voice-support-message');
    if (element) { element.textContent=message; element.classList.toggle('is-error',Boolean(isError)); }
  }
  var recorder=null, audioStream=null, voicePhase='idle', cancelled=false;
  function releaseMicrophone() {
    if (audioStream) audioStream.getTracks().forEach(function(t){t.stop();});
    audioStream=null;
    if(state.timer) root.clearTimeout(state.timer);
    state.timer=null;
  }
  function voiceButton(phase) {
    voicePhase=phase;
    var button=root.document&&root.document.getElementById('voice-start');
    if(button) {
      if(!button.dataset.idleHtml) button.dataset.idleHtml=button.innerHTML;
      button.innerHTML=phase==='idle'?button.dataset.idleHtml:(phase==='recording'?'종료':'처리 중');
      button.disabled=phase==='starting'||phase==='processing';
      button.setAttribute('aria-label',phase==='recording'?'녹음 종료 후 변환':'말로 품목 담기 시작');
    }
  }
  function stopRecognition() {
    if(state.timer) root.clearTimeout(state.timer);
    state.timer=null;
    if(recorder&&recorder.state==='recording') recorder.stop();
    releaseMicrophone();
  }
  async function start() {
    if(voicePhase==='recording'){stopRecognition();return;}
    if(voicePhase!=='idle')return;
    if(!root.MediaRecorder||!root.navigator?.mediaDevices?.getUserMedia){setCardMessage('이 브라우저에서는 녹음할 수 없습니다. HTTPS와 마이크 권한을 확인해 주세요.',true);return;}
    voiceButton('starting');cancelled=false;
    var chunks=[], bytes=0;
    try {
      audioStream=await root.navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(cancelled){releaseMicrophone();voiceButton('idle');return;}
      var mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(function(m){return root.MediaRecorder.isTypeSupported(m);});
      if(!mime)throw Error('이 기기의 녹음 형식을 지원하지 않습니다.');
      recorder=new root.MediaRecorder(audioStream,{mimeType:mime,audioBitsPerSecond:64000});
      recorder.ondataavailable=function(e){if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>2000000){cancelled=true;stopRecognition();setCardMessage('녹음 용량을 초과했습니다. 짧게 나눠 말씀해 주세요.',true);}}};
      recorder.onerror=function(){cancelled=true;stopRecognition();voiceButton('idle');setCardMessage('녹음 중 오류가 발생했습니다. 다시 시도해 주세요.',true);};
      recorder.onstop=async function(){
        releaseMicrophone();
        if(cancelled){voiceButton('idle');return;}
        voiceButton('processing');setCardMessage('Gemini로 음성을 변환하는 중입니다...',false);
        try {
          var blob=new root.Blob(chunks,{type:mime});
          if(!blob.size||blob.size>2000000)throw Error('녹음된 음성이 없거나 용량을 초과했습니다.');
          var base64=await new Promise(function(resolve,reject){var reader=new root.FileReader();reader.onload=function(){resolve(String(reader.result).split(',')[1]);};reader.onerror=function(){reject(Error('녹음 파일을 읽지 못했습니다.'));};reader.readAsDataURL(blob);});
          if(cancelled)return;
          var result=await API.request('POST',{action:'transcribeVoice',audioBase64:base64,mimeType:mime.split(';')[0]},{timeout:60000});
          if(cancelled)return;
          if(!result||typeof result.transcript!=='string'||!result.transcript.trim())throw Error('음성을 인식하지 못했습니다. 다시 말씀해 주세요.');
          if(result.uncertain!==false)throw Error('치수 또는 품목이 불명확합니다. 숫자를 나눠 또렷하게 다시 말씀해 주세요.');
          openResult(result.transcript);
          setCardMessage('변환 완료. 규격과 수량을 확인한 뒤 담아 주세요.',false);
        }catch(error){if(!cancelled)setCardMessage(error.message||'음성 변환에 실패했습니다. 다시 시도해 주세요.',true);}
        finally{chunks=[];voiceButton('idle');}
      };
      recorder.start(500);voiceButton('recording');
      setCardMessage('녹음 중 · 말을 마치면 녹음 종료를 누르세요. 최대 30초',false);
      state.timer=root.setTimeout(stopRecognition,30000);
    }catch(error){releaseMicrophone();voiceButton('idle');setCardMessage(error.name==='NotAllowedError'?'마이크 권한을 허용해 주세요.':error.message||'녹음을 시작하지 못했습니다.',true);}
  }

  function toggleForm(index) {
    var item=state.rows[index];
    if (!item||!item.type) return;
    var next=item.formKind==='linked'?'independent':'linked';
    item.formKind=next; item.form=resolveForm(item.type,next,appRef().priceData);
    item.defaultForm=false; item.confirmedDefaults=!item.defaultQty;
    matchItem(item,appRef().priceData); state.modified=true; render(); logResult();
  }
  function changeQty(index,delta) {
    var item=state.rows[index];
    if (!item) return;
    item.quantity=Math.max(1,Math.min(9999,Number(item.quantity||1)+Number(delta||0)));
    item.defaultQty=false; item.confirmedDefaults=!item.defaultForm;
    state.modified=true; render(); logResult();
  }
  function confirmDefault(index) {
    if (!state.rows[index]) return;
    state.rows[index].confirmedDefaults=true; state.modified=true; render(); logResult();
  }

  function chooseCandidate(index,candidateIndex) {
    var item=state.rows[index];
    var candidate=item&&item.candidates?item.candidates[candidateIndex]:null;
    if (!candidate) return;
    item.row=candidate.row; item.W=candidate.dimensions.W; item.D=candidate.dimensions.D; item.H=candidate.dimensions.H;
    item.status=item.defaultForm||item.defaultQty?'default':'exact'; item.error=''; item.candidates=[];
    state.modified=true; render(); logResult();
  }
  function chooseDirect(index) {
    var item=state.rows[index]||{};
    close();
    if (wizardRef()) wizardRef().go(1);
    if (item.type&&appRef()&&typeof appRef().onTypeChip==='function') appRef().onTypeChip(item.type);
  }
  function addItems() {
    if (!canAdd()||!appRef()||typeof appRef().addItemFromPrice!=='function') return;
    state.rows.forEach(function (item) { appRef().addItemFromPrice(item.row,item.quantity); });
    logResult(); close();
    if (wizardRef()) wizardRef().go(6);
  }
  function init() {
    if (!root.document) return;
    if (!(root.MediaRecorder&&root.navigator?.mediaDevices?.getUserMedia)) {
      setCardMessage('이 브라우저는 음성 입력을 지원하지 않습니다',true);
      var button=root.document.getElementById('voice-start');
      if (button) button.disabled=true;
    }
    root.addEventListener('pagehide',function(){cancelled=true;stopRecognition();});
  }

  root.VoiceAdd={
    init:init,start:start,openResult:openResult,stop:stopRecognition,close:close,retry:function () { close(); start(); },
    normalize:normalize,koreanNumber:koreanNumber,parse:parse,matchItem:matchItem,matchAll:matchAll,dimensions:dimensions,
    toggleForm:toggleForm,changeQty:changeQty,confirmDefault:confirmDefault,
    chooseCandidate:chooseCandidate,chooseDirect:chooseDirect,addItems:addItems,
    get state() { return state; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
