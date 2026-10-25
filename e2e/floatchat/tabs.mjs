import { chromium } from 'playwright';
import { session } from './fc.mjs';
const CH='/Users/vaibav/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const W='http://localhost:5321';
const sess=await session('real');
const b=await chromium.launch({executablePath:CH});
const ctx=await b.newContext({viewport:{width:1280,height:800}});
await ctx.addInitScript(x=>{localStorage.setItem('squad.session',JSON.stringify(x));localStorage.setItem('squad.token',x.token)},sess);
const N=+process.argv[2]||4;
for(let i=0;i<N;i++){
  const p=await ctx.newPage(); const streams=[];
  p.on('request',r=>{if(/stream|events/.test(r.url())&&r.url().includes(':8921'))streams.push(r.url().replace('http://localhost:8921','').slice(0,30))});
  await p.goto(W+'/squad/village'); await p.waitForTimeout(3500);
  await p.getByTestId('chat-dock-open').click(); 
  const t0=Date.now(); let ok=true;
  await p.waitForFunction(()=>!/Loading (messages|chat)/.test(document.querySelector('[data-testid=chat-dock]').innerText),null,{timeout:12000}).catch(()=>ok=false);
  console.log('tab',i+1,'resolved',ok,Date.now()-t0,'ms; streams opened:',streams.join(' '));
}
await b.close();
