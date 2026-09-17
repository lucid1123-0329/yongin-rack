import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const roots = ['index.html','request.html','view.html','portfolio-public.html','admin.html','admin-push.html',
  'dashboard.html','estimate-preview.html','history.html','more.html','portfolio.html','requests.html','settings.html','cases.html',
  'sw.js','OneSignalSDKWorker.js','manifest.json','version.json','CNAME','robots.txt','sitemap.xml','favicon.ico'];
const folders = {app:/\.html$/,js:/\.js$/,css:/\.css$/,assets:/\.(png|jpe?g|webp|svg|gif|ico|woff2?|ttf|pdf)$/i};

export function publicFiles() {
  const files = [...roots];
  function walk(dir, pattern) {
    for (const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})) {
      const file = dir + '/' + entry.name;
      if (entry.isSymbolicLink()) throw new Error('배포에 심볼릭 링크를 포함할 수 없습니다: '+file);
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) walk(file,pattern);
      else if (pattern.test(entry.name)) files.push(file);
    }
  }
  for (const [dir,pattern] of Object.entries(folders)) walk(dir,pattern);
  return files.sort();
}

export function prepareRelease() {
  const files = publicFiles();
  const secretPattern = /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|AIza[A-Za-z0-9_-]{35}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
  for (const file of files) {
    if (fs.lstatSync(path.join(root,file)).isSymbolicLink()) throw new Error('심볼릭 링크: '+file);
    if (/\.(js|css|html|json|xml|txt|svg)$/.test(file) && secretPattern.test(fs.readFileSync(path.join(root,file),'utf8'))) throw new Error('비밀 값 패턴 발견 (값은 출력하지 않음): '+file);
  }
  const version = String(JSON.parse(fs.readFileSync(path.join(root,'version.json'),'utf8')).version);
  const parent = path.join(root,'.release');
  fs.mkdirSync(parent,{recursive:true});
  const directory = fs.mkdtempSync(path.join(parent,'v'+version+'-'));
  const manifest=[];
  for (const [group, paths] of [['site',files],['gas',['Code.gs','appsscript.json']]]) {
    for (const file of paths) {
      const bytes=fs.readFileSync(path.join(root,file));
      const destination=path.join(directory,group,file);
      fs.mkdirSync(path.dirname(destination),{recursive:true});
      fs.writeFileSync(destination,bytes,{flag:'wx'});
      manifest.push({path:group+'/'+file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
    }
  }
  fs.writeFileSync(path.join(directory,'site','.nojekyll'),'');
  fs.writeFileSync(path.join(directory,'release-manifest.json'),JSON.stringify({version,deployed:false,createdAt:new Date().toISOString(),files:manifest},null,2));
  return {directory,version,publicFiles:files.length,serverFiles:2};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const args of [['tools/verify-no-secrets.mjs'],['tools/verify-reskin.mjs'],['--test','test/security-regression.test.mjs','test/quote-integrity.test.mjs','test/script-syntax.test.mjs','test/release-package.test.mjs']]) {
    const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});
    if(result.status!==0) process.exit(result.status || 1);
  }
  const release=prepareRelease();
  console.log(JSON.stringify(release,null,2));
  if(process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,'site='+path.join(release.directory,'site')+'\n');
}
