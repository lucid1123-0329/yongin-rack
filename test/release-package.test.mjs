import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { publicFiles } from '../tools/prepare-release.mjs';
const root=path.resolve(import.meta.dirname,'..');
test('public artifact excludes backend, credentials, mockups, reports and tests',()=>{
  const files=publicFiles();
  for(const file of ['index.html','app/index.html','request.html','view.html','js/api.js','sw.js']) assert.ok(files.includes(file));
  for(const file of files) assert.doesNotMatch(file,/(^|\/)(Code\.gs|appsscript\.json|mockup|test|tools|docs|\.git|\.clasp)|\.md$|token|secret|\.env/);
  for(const file of files.filter(f=>f.endsWith('.html'))) {
    const html=fs.readFileSync(path.join(root,file),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, match => match.replace(/>[\s\S]*<\/script>/i,'></script>'));
    for(const match of html.matchAll(/\b(?:src|href)=["']([^"'<>]+)["']/g)) {
      let value=match[1];
      if(/^(#|https?:|data:|blob:|tel:|mailto:|javascript:)/.test(value)||value.includes('${')) continue;
      value=value.split(/[?#]/)[0]; if(!value) continue;
      const target=value.startsWith('/')?value.slice(1):path.posix.normalize(path.posix.join(path.posix.dirname(file),value));
      if(target&&target!=='.') assert.ok(files.includes(target),file+' missing release asset: '+target);
    }
  }
});
test('GAS upload explicitly includes only Code.gs and manifest',()=>{
  const lines=fs.readFileSync(path.join(root,'.claspignore'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#'));
  assert.deepEqual(lines,['**/**','!Code.gs','!appsscript.json']);
});
