import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root = path.resolve(import.meta.dirname, '..');
test('production JavaScript, GAS, and inline HTML scripts parse', () => {
  for (const file of fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js'))) new vm.Script(fs.readFileSync(path.join(root,'js',file),'utf8'),{filename:file});
  new vm.Script(fs.readFileSync(path.join(root,'Code.gs'),'utf8'),{filename:'Code.gs'});
  for (const dir of ['', 'app']) {
    for (const file of fs.readdirSync(path.join(root,dir)).filter(f=>f.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(root,dir,file),'utf8');
      let index = 0;
      for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        if (/\bsrc\s*=|application\/(?:ld\+)?json/.test(match[1]) || !match[2].trim()) continue;
        new vm.Script(match[2],{filename:dir+'/'+file+':script'+(++index)});
      }
    }
  }
});
