import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

test('text and photo analysis use Gemini 3.7 Flash with the existing JSON contract',()=>{
  const c={console,Date,JSON};
  vm.createContext(c); vm.runInContext(fs.readFileSync(new URL('../Code.gs',import.meta.url),'utf8'),c);
  c._getGeminiApiKey=()=> 'test-placeholder';
  const calls=[];
  c.UrlFetchApp={fetch:(url,options)=>{
    calls.push({url,body:JSON.parse(options.payload)});
    return {getContentText:()=>JSON.stringify({candidates:[{content:{parts:[{text:'{"analysis":"test result"}'}]}}]})};
  }};
  for(const options of [{schema:{type:'object'}},{imageBase64:'fixture',imageMimeType:'image/jpeg'}]) {
    assert.equal(c._callGemini('fixture prompt',options).analysis,'test result');
  }
  for(const call of calls) {
    assert.match(call.url,/\/models\/gemini-3\.7-flash:generateContent\?/);
    assert.equal(call.body.generationConfig.responseMimeType,'application/json');
  }
  assert.equal(calls[1].body.contents[0].parts[0].inlineData.mimeType,'image/jpeg');
});

function fixture() {
  const row = name => ['2026-09-17T05:00:00Z',name,'01000000000','경량랙',3,'창고 선반','미처리','','','','회사','주소','',5,6,3,'창고','박스',20,''];
  const data = [Array.from({length:20},(_,i)=>'column'+i),row('A'),row('B')];
  const sheet = {getDataRange:()=>({getValues:()=>data.map(r=>r.slice())}), getMaxColumns:()=>26,
    getRange:(r,c)=>({setValue:value=>{data[r-1][c-1]=value;}})};
  const c={console,Date,JSON,LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>[...createHash('sha256').update(s).digest()]}};
  vm.createContext(c); vm.runInContext(fs.readFileSync(new URL('../Code.gs',import.meta.url),'utf8'),c);
  c.getSheet=()=>sheet; c._getCache=()=>null; c._setCache=()=>{}; c._clearCache=()=>{};
  let calls=0;
  c._generateRequestAnalysis=()=>{calls++; return {analysis:'저장할 분석',reasoning:'통로 확인',recommendedType:'경량랙',recommendedQty:3};};
  return {c,data,key:c._requestAnalysisKey(data[2]),calls:()=>calls};
}

test('analysis persists on request, reload returns it and repeat call reuses it',()=>{
  const {c,data,key,calls}=fixture();
  const result=c.analyzeRequest({requestKey:key});
  assert.ok(result.savedAnalysis.savedAt);
  assert.equal(data[0][20],'AI분석JSON');
  assert.equal(c.getRequests().requests.find(r=>r.requestKey===key).aiAnalysis.result.analysis,'저장할 분석');
  c.analyzeRequest({requestKey:key}); assert.equal(calls(),1);
  c.analyzeRequest({requestKey:key,reanalyze:true}); assert.equal(calls(),2);
});

test('analysis follows the request when an earlier row is deleted during Gemini call',()=>{
  const {c,data,key}=fixture();
  c._generateRequestAnalysis=()=>{data.splice(1,1);return {analysis:'B 분석'};};
  c.analyzeRequest({requestKey:key});
  assert.equal(data[1][1],'B');
  assert.equal(JSON.parse(data[1][20]).result.analysis,'B 분석');
});

test('deleted or edited target cannot receive a stale analysis',()=>{
  for(const change of [data=>data.splice(2,1),data=>{data[2][5]='바뀐 메모';}]) {
    const {c,data,key}=fixture();
    c._generateRequestAnalysis=()=>{change(data);return {analysis:'이전 요청 분석'};};
    assert.throws(()=>c.analyzeRequest({requestKey:key}),/변경되었거나 삭제/);
    assert.equal(data[0].includes('AI분석JSON'),false);
  }
});

test('failed reanalysis preserves saved result, workflow changes do not invalidate it',()=>{
  const {c,data,key}=fixture(); const old=c.analyzeRequest({requestKey:key}).savedAnalysis;
  c._generateRequestAnalysis=()=>({error:'AI unavailable'});
  assert.ok(c.analyzeRequest({requestKey:key,reanalyze:true}).error);
  data[2][6]='완료'; data[2][12]='Q-1';
  assert.equal(c.getRequests().requests.find(r=>r.requestKey===key).aiAnalysis.savedAt,old.savedAt);
  data[2][5]='메모 수정';
  assert.equal(c.getRequests().requests[0].aiAnalysis,null);
});

test('malformed saved JSON is ignored and existing extra columns are preserved',()=>{
  const {c,data,key}=fixture(); data[0].push('운영메모'); data[2].push('보존');
  c.analyzeRequest({requestKey:key});
  assert.equal(data[2][20],'보존'); assert.equal(data[0][21],'AI분석JSON');
  data[2][21]='broken'; assert.equal(c.getRequests().requests[0].aiAnalysis,null);
});

test('anonymous analysis remains blocked before storage or AI calls',()=>{
  const {c,calls}=fixture(); c._verifyAuthToken=()=>false; c.jsonResponse=x=>x;
  assert.equal(c.doPost({postData:{contents:JSON.stringify({action:'analyzeRequest'})}}).code,'UNAUTHORIZED');
  assert.equal(calls(),0);
});
