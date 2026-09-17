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
 c.reply.uncertain=true;assert.equal(c.transcribeVoice(audio).uncertain,true);
 c.reply={transcript:123,uncertain:false};assert.ok(c.transcribeVoice(audio).error);
 c.status=429;assert.ok(c.transcribeVoice(audio).error);
});
test('frontend sends original audio and blocks uncertain results',()=>{
 const s=read('js/voice.js');
 assert.doesNotMatch(s,/webkitSpeechRecognition|new Recognition/);
 assert.match(s,/getUserMedia/);assert.match(s,/action:'transcribeVoice'/);
 assert.match(s,/result\.uncertain!==false/);assert.match(s,/setTimeout\(stopRecognition,30000\)/);
 assert.match(s,/getTracks\(\)\.forEach/);
 assert.doesNotMatch(s,/generativelanguage|geminiApiKey/);
});
