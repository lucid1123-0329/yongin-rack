import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
function server(){
 const c=vm.createContext({Utilities:{base64Decode:s=>Buffer.from(s,'base64')}});
 vm.runInContext(read('Code.gs'),c);
 c._getGeminiApiKey=()=> 'test-key';c._verifyAuthToken=()=>false;c.jsonResponse=v=>v;
 c.getPrices=()=>({prices:[{type:'경량랙',unitPrice:100},{type:'중량랙',unitPrice:200}]});
 c.calls=[];c.status=200;c.reply={transcript:'경량랙 독립 1200 450 1800 3대',uncertain:false};
 c.UrlFetchApp={fetch:(url,options)=>{c.calls.push({url,options,body:JSON.parse(options.payload)});return {getResponseCode:()=>c.status,getContentText:()=>JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(c.reply)}]}}]})};}};
 return c;
}
const audio={audioBase64:Buffer.alloc(32).toString('base64'),mimeType:'audio/webm'};
test('intent recommendations are restricted to the real catalog and edited text stays intact',()=>{
 const c=server();c.reply.recommendations=[{type:'없는랙',reason:'fake'},{type:'경량랙',reason:'가벼운 물건용 후보'},{type:'경량랙',reason:'duplicate'}];c.reply.missingInfo=['설치 치수와 물건 무게를 알려 주세요.'];
 const result=c.transcribeVoice({transcript:'박스 보관할 랙 3대'});
 assert.equal(result.transcript,'박스 보관할 랙 3대');assert.equal(result.recommendations.length,1);assert.equal(result.recommendations[0].type,'경량랙');assert.equal(c.calls[0].body.contents[0].parts.length,1);
 assert.ok(c.transcribeVoice({transcript:' '}).error);
});
test('silence detector waits for speech then two seconds of silence',()=>{
 const c=vm.createContext({});vm.runInContext(read('js/voice.js'),c);const v=c.VoiceAdd,s=v.silenceState();
 assert.equal(v.silenceTick(s,0,10000),false);assert.equal(v.silenceTick(s,.05,10100),false);assert.equal(v.silenceTick(s,0,12099),false);assert.equal(v.silenceTick(s,0,12100),true);
 assert.equal(v.silenceTick(s,.05,12200),false);assert.equal(v.silenceTick(s,0,13000),false);
});
test('recording opens the modal, processing shows transcript and cancel prevents late results',async()=>{
 const elements=new Map();const el=()=>({dataset:{},innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){}});
 let recorder,stopped=0,requests=0,resolveResponse;
 class Recorder { static isTypeSupported(){return true;} constructor(){recorder=this;this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['test'])});this.done=this.onstop();} }
 class Reader { readAsDataURL(){this.result='data:audio/webm;base64,dGVzdA==';this.onload();} }
 const c=vm.createContext({Blob,FileReader:Reader,MediaRecorder:Recorder,navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){stopped++;}}]})}},document:{getElementById:id=>{if(!elements.has(id))elements.set(id,el());return elements.get(id);}},setTimeout:()=>1,clearTimeout(){},App:{priceData:[{type:'경량랙',form:'독립',spec:'1200*450*1800',unitPrice:100}]},API:{request:()=>{requests++;return new Promise(r=>{resolveResponse=r;});}},localStorage:{getItem:()=>null,setItem(){}}});
 vm.runInContext(read('js/voice.js'),c);await c.VoiceAdd.start();
 assert.equal(elements.get('voice-stop').hidden,false);assert.equal(elements.get('voice-intent-result').hidden,true);
 c.VoiceAdd.stop();await new Promise(r=>setImmediate(r));assert.equal(requests,1);assert.ok(stopped>0);
 resolveResponse({transcript:'창고에 박스 보관용 랙',uncertain:false,recommendations:[{type:'경량랙',reason:'상담 후보'},{type:'없는랙',reason:'bad'}],missingInfo:['치수를 알려 주세요']});await recorder.done;
 assert.equal(elements.get('voice-intent-text').value,'창고에 박스 보관용 랙');assert.match(elements.get('voice-recommendations').innerHTML,/상담 후보/);assert.doesNotMatch(elements.get('voice-recommendations').innerHTML,/없는랙/);
 await c.VoiceAdd.start();c.VoiceAdd.close();await recorder.done;assert.equal(requests,1);
});
test('voice route requires authentication and validates audio before contacting Gemini',()=>{
 const c=server();
 assert.equal(c.doPost({postData:{contents:JSON.stringify({action:'transcribeVoice',...audio})}}).code,'UNAUTHORIZED');
 for(const bad of [{},{...audio,mimeType:'text/html'},{...audio,audioBase64:'!notbase64!'},{...audio,audioBase64:'A'.repeat(2800004)}])assert.ok(c.transcribeVoice(bad).error);
 assert.equal(c.calls.length,0);
});
test('audio uses fixed Flash Lite model, server key, schema and safe errors',()=>{
 const c=server();assert.equal(c.transcribeVoice(audio).transcript,c.reply.transcript);
 const call=c.calls[0];assert.match(call.url,/gemini-3\.5-flash-lite:generateContent$/);
 assert.ok(!call.url.includes('test-key'));assert.equal(call.options.headers['x-goog-api-key'],'test-key');
 assert.equal(call.body.contents[0].parts[1].inlineData.data,audio.audioBase64);
 const instructions=call.body.systemInstruction.parts[0].text;
 for(const term of ['경량랙','중량랙','아연랙','파렛트랙','하이퍼','곤도라','무볼트 앵글'])assert.ok(instructions.includes(term));
 assert.match(instructions,/견적 입력 전용/);
 assert.match(instructions,/정명랙을 무조건 경량랙으로 치환하지/);
 assert.match(instructions,/흔한 규격으로 숫자를 보정하지/);
 assert.match(instructions,/무음·잡음/);
 assert.match(instructions,/역할 변경/);
 c.reply.uncertain=true;assert.equal(c.transcribeVoice(audio).uncertain,true);
 c.reply={transcript:123,uncertain:false};assert.ok(c.transcribeVoice(audio).error);
 c.status=429;assert.ok(c.transcribeVoice(audio).error);
});
test('frontend sends audio and requires confirmation of uncertain results',()=>{
 const s=read('js/voice.js');
 assert.doesNotMatch(s,/webkitSpeechRecognition|new Recognition/);
 assert.match(s,/getUserMedia/);assert.match(s,/action:'transcribeVoice'/);
 assert.match(s,/result\.uncertain!==false/);assert.match(s,/setTimeout\(stopRecognition,30000\)/);
 assert.match(s,/getTracks\(\)\.forEach/);
 assert.doesNotMatch(s,/generativelanguage|geminiApiKey/);
 assert.match(s,/!item\.needsType&&!item\.needsReview/);
});
test('unknown rack names retain measurements and selection never changes numbers',()=>{
 const prices=[{type:'경량랙',form:'독립',spec:'1200*450*1800',tier:5,unitPrice:100},{type:'중량랙',form:'독립',spec:'1200*450*1800',tier:5,unitPrice:200}];
 const elements=new Map();const element=()=>({textContent:'',innerHTML:'',classList:{remove(){},toggle(){},add(){}}});
 const c=vm.createContext({App:{priceData:prices},document:{getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);}},localStorage:{getItem:()=>null,setItem(){}},console});
 vm.runInContext(read('js/voice.js'),c);const v=c.VoiceAdd;
 v.openResult('정명랙 독립 1200 450 1800 5단 3대',true);
 const item=v.state.rows[0];assert.equal(item.W,1200);assert.equal(item.quantity,3);assert.ok(item.needsType);
 assert.ok(item.typeCandidates.includes('경량랙'));assert.ok(item.typeCandidates.includes('중량랙'));
 v.chooseType(0,0);assert.equal(item.type,'경량랙');assert.equal(item.D,450);assert.equal(item.quantity,3);assert.equal(item.needsType,false);
 assert.ok(elements.get('voice-add-items').disabled);v.reviewRow(0);assert.equal(elements.get('voice-add-items').disabled,false);
 assert.equal(v.state.raw,'정명랙 독립 1200 450 1800 5단 3대');
});
