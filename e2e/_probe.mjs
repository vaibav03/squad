import { chromium } from '@playwright/test';
const HUB='http://localhost:8920', WEB='http://localhost:5320';
const [path, cond] = process.argv.slice(2);
const j = async (p, i) => { const r = await fetch(HUB+p, i); return r.json().catch(()=>({})); };
const st = Date.now().toString(36);
const s = await j('/v1/auth/start',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'P '+st,email:`p.${st}@example.com`})});
const v = await j('/v1/auth/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({challengeId:s.challengeId,code:s.devCode})});
await j('/v1/squads',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+v.token},body:JSON.stringify({name:'PS '+st,course:'CS 101'})});
const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1280,height:800}});
await ctx.addInitScript((t)=>{try{localStorage.setItem('squad.token',t)}catch{}}, v.token);
const ok = (u)=>u==='/health'||u==='/v1/status'||u.startsWith('/v1/auth/')||u==='/v1/me'||u==='/v1/squads';
if (cond==='dataslow') await ctx.route(/^http:\/\/localhost:8920/, async r=>{ if (ok(new URL(r.request().url()).pathname)) return r.continue(); await new Promise(x=>setTimeout(x,40000)); r.abort().catch(()=>{});});
const p = await ctx.newPage(); const logs=[]; p.on('console',m=>m.type()==='error'&&logs.push(m.text().slice(0,120)));
await p.goto(WEB+path,{waitUntil:'commit'}).catch(()=>{});
for (const t of [1,4,8,12]) { await new Promise(x=>setTimeout(x,t===1?1000:(t===4?3000:4000)));
 console.log(t+'s', JSON.stringify(await p.evaluate(()=>({title:document.title,main:document.querySelector('main')?.innerText.replace(/\s+/g,' ').slice(0,260)}))));}
await p.screenshot({path:'/private/tmp/claude-501/-Users-vaibav/8031809f-fd1a-4764-881f-1dbd71387b9d/scratchpad/probe-'+path.replace(/\//g,'_')+'.png'});
console.log(logs.join('\n'));
await b.close();
