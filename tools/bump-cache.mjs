import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const next = String(process.argv[2] || '');
if (!/^\d+$/.test(next)) throw new Error('Usage: node tools/bump-cache.mjs <version>');
const versionFile = path.join(root, 'version.json');
const old = String(JSON.parse(fs.readFileSync(versionFile, 'utf8')).version);
const files = fs.readdirSync(root).filter(f => f.endsWith('.html')).map(f => path.join(root, f));
for (const dir of ['app', 'js', 'css']) {
  files.push(...fs.readdirSync(path.join(root, dir)).filter(f => /\.(html|js|css)$/.test(f)).map(f => path.join(root, dir, f)));
}
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const updated = source.replace(new RegExp('\\?v=' + old + '\\b', 'g'), '?v=' + next);
  if (source !== updated) fs.writeFileSync(file, updated);
}
for (const relative of ['sw.js', 'tools/verify-reskin.mjs', 'version.json']) {
  const file = path.join(root, relative);
  const source = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, source.replace(new RegExp('(?<=v)' + old + '\\b|\\b' + old + '\\b', 'g'), next));
}
console.log(`Cache version ${old} -> ${next}`);
