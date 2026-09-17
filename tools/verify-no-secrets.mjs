import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const patterns=[/gh[pousr]_[A-Za-z0-9]{20,}/,/github_pat_[A-Za-z0-9_]{30,}/,/AIza[A-Za-z0-9_-]{35}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/https:\/\/[^\s/@:]+:[^\s/@]+@github\.com/];
const hits=[];
for(const file of new Set(files)) {
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())continue;
  if(/(^|\/)(\.env(?:\..*)?|\.clasprc\.json|credentials\.json)$|\.(token|secret|key)$|_token$/.test(file)){hits.push(file+' (credential filename)');continue;}
  if(!/\.(md|json|ya?ml|js|mjs|gs|html|css|txt|xml)$/.test(file))continue;
  const lines=fs.readFileSync(file,'utf8').split(/\r?\n/);
  lines.forEach((line,index)=>{if(patterns.some(pattern=>pattern.test(line)))hits.push(file+':'+(index+1));});
}
if(hits.length){console.error('Potential secrets (values suppressed):\n'+hits.join('\n'));process.exit(1);}
console.log('No recognized secret patterns in '+new Set(files).size+' candidate files.');
