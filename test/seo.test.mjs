import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const publicPages=['index.html','request.html','portfolio-public.html'];
test('public pages have unique titles, descriptions, canonical URLs and absolute social images',()=>{
 const titles=new Set(),descs=new Set();
 for(const p of publicPages){const html=read(p),url='https://yongin-rack.com/'+(p==='index.html'?'':p);
 assert.match(html,/<html lang="ko">/);
 const title=html.match(/<title>([^<]+)<\/title>/)[1],desc=html.match(/name="description" content="([^"]+)"/)[1];
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
 assert.equal(business.name,'중용랙');assert.equal(business.telephone,'+82-10-3776-1230');assert.equal(business.address.streetAddress,'백옥대로 1117');
 assert.equal(business.hasOfferCatalog.itemListElement.length,5);
 assert.ok(graph.find(n=>n['@type']==='WebSite'));assert.ok(graph.find(n=>n['@type']==='WebPage'));
 assert.doesNotMatch(JSON.stringify(json),/aggregateRating|reviewCount|openingHours|priceRange/);
 const body=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
 assert.match(body,/id="service-guide"/);assert.match(body,/용인 랙 시공 전문/);assert.match(body,/창고 선반·중량랙·파렛트랙/);
 assert.doesNotMatch(html,/\.reveal\{opacity:0/);
});
