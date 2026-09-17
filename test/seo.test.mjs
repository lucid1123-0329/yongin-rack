import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const publicPages=['index.html','request.html','portfolio-public.html'];
test('public pages show call labels instead of phone digits while preserving dial links',()=>{
 for(const p of publicPages){
  const html=read(p),visible=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<[^>]*>/g,'');
  assert.doesNotMatch(visible,/010[-\s]?3776[-\s]?1230|0507[-\s]?1482[-\s]?1708/);
  assert.match(html,/href="tel:0507-1482-1708"/);
  assert.doesNotMatch(html,/010-?3776-?1230|82-10-3776-1230/);
 }
});
test('public pages have unique titles, descriptions, canonical URLs and absolute social images',()=>{
 const titles=new Set(),descs=new Set();
 for(const p of publicPages){const html=read(p),url='https://yongin-rack.com/'+(p==='index.html'?'':p);
 assert.match(html,/<html lang="ko">/);
 const title=html.match(/<title>([^<]+)<\/title>/)[1],desc=html.match(/name="description" content="([^"]+)"/)[1];
 assert.ok([...desc].length<=80,p+' description must be within 80 characters');
 assert.ok(!titles.has(title));titles.add(title);assert.ok(!descs.has(desc));descs.add(desc);
 assert.equal((html.match(/rel="canonical"/g)||[]).length,1);assert.ok(html.includes('rel="canonical" href="'+url+'"'));
 assert.ok(html.includes('property="og:url" content="'+url+'"'));
 assert.match(html,/name="robots" content="index, follow/);
 const img=html.match(/property="og:image" content="https:\/\/yongin-rack.com\/([^"]+)"/)[1];assert.ok(fs.existsSync(new URL('../'+img,import.meta.url)));
 }
});
test('sitemap contains canonical public pages only and crawler can load rendering assets',()=>{
 const xml=read('sitemap.xml'),robots=read('robots.txt');
 const urls=[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
 assert.deepEqual(urls,publicPages.map(p=>'https://yongin-rack.com/'+(p==='index.html'?'':p)));
 assert.equal(new Set(urls).size,urls.length);
 assert.doesNotMatch(robots,/Disallow:\s*\/(js|css|assets)\//);
 assert.match(robots,/Sitemap: https:\/\/yongin-rack.com\/sitemap.xml/);
 for(const p of fs.readdirSync(new URL('../app/',import.meta.url)).filter(p=>p.endsWith('.html')).map(p=>'app/'+p).concat('view.html'))assert.match(read(p),/name="robots" content="noindex, nofollow"/);
});
test('structured data is linked, factual and services remain readable without JavaScript',()=>{
 const html=read('index.html'),json=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
 const graph=json['@graph'],business=graph.find(n=>n['@type']==='LocalBusiness');
 assert.equal(business.name,'중용랙');assert.equal(business.telephone,'0507-1482-1708');assert.equal(business.address.streetAddress,'백옥대로 1117');
 assert.equal(business.hasOfferCatalog.itemListElement.length,5);
 assert.ok(graph.find(n=>n['@type']==='WebSite'));assert.ok(graph.find(n=>n['@type']==='WebPage'));
 assert.doesNotMatch(JSON.stringify(json),/aggregateRating|reviewCount|openingHours|priceRange/);
 const body=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
 assert.match(body,/id="service-guide"/);assert.match(body,/전국 랙 시공 전문/);assert.match(body,/창고 선반·중량랙·파렛트랙/);
 assert.doesNotMatch(html,/\.reveal\{opacity:0/);
});
test('consultation guide focuses on online enquiries and nationwide installation',()=>{
 const guide=read('index.html').match(/<section id="service-guide"[\s\S]*?<\/section>/)[0];
 assert.match(guide,/카카오톡이나 견적 문의/);
 assert.match(guide,/전국 시공/);
 assert.doesNotMatch(guide,/용인|백옥대로|1117/);
});
test('measurement copy requires accurate dimensions and offers phone guidance',()=>{
 const html=read('index.html');
 assert.doesNotMatch(html,/대략만 알려|사진 두세 장이면 충분|방문 실측 때 저희가|대략적인 가로/);
 assert.match(html,/정확한 견적에는 정확한 치수가 필요/);
 assert.match(html,/필요한 치수와 재는 방법/);
 assert.match(read('request.html'),/치수 없이도 상담을 요청할 수 있지만, 정확한 견적은 치수 확인 후 안내/);
});
test('admin, legacy redirect and quote URLs expose noindex without robots crawl blocking',()=>{
 const app=fs.readdirSync(new URL('../app/',import.meta.url)).filter(p=>p.endsWith('.html'));
 const legacy=app.filter(p=>p!=='index.html');
 const privatePages=[...app.map(p=>'app/'+p),...legacy,'view.html'];
 const robots=read('robots.txt'),sitemap=read('sitemap.xml');
 const blocked=[...robots.matchAll(/^Disallow:\s*(\S+)/gm)].map(m=>m[1]);
 for(const p of privatePages){
   assert.match(read(p),/<meta name="robots" content="noindex, nofollow">/);
   assert.ok(!blocked.some(prefix=>('/'+p).startsWith(prefix)),p+' must allow noindex discovery');
   assert.ok(!sitemap.includes('https://yongin-rack.com/'+p),p+' excluded from sitemap');
 }
 assert.match(read('index.html'),/href="\/app\/index.html" rel="nofollow"/);
});
