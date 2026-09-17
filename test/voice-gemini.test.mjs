import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
function server(){
 const c=vm.createContext({Utilities:{base64Decode:s=>Buffer.from(s,'base64')}});
 vm.runInContext(read('Code.gs'),c);
 c._getGeminiApiKey=()=> 'test-key';c._verifyAuthToken=()=>false;c.jsonResponse=v=>v;
 c.calls=[];c.status=200;c.reply={transcript:'경량랙 독립 1200 450 1800 3대',uncertain:false};
 c.UrlFetchApp={fetch:(url,options)=>{c.calls.push({url,options,body:JSON.parse(options.payload)});return {getResponseCode:()=>c.status,getContentText:()=>JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(c.reply)}]}}]})};}};
 return c;
}
const audio={audioBase64:Buffer.alloc(32).toString('base64'),mimeType:'audio/webm'};
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
