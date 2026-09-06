// The Haptics switch must vanish where the platform cannot vibrate (iOS), and
// stay where it can (Android). Chromium defines navigator.vibrate, so the iOS
// case is simulated by removing it before the page runs.
const { launch, devices } = require('./lib/browser');
const fs=require('fs'), path=require('path'), http=require('http');
const GAMES=path.join(__dirname, '..', 'arcade', 'games');
const srv=http.createServer((q,r)=>{const s=decodeURIComponent(q.url).replace(/^\/|\/$/g,'').split('/')[0];
  const f=path.join(GAMES,s,'index.html'); if(!fs.existsSync(f)){ r.writeHead(204); return r.end(); }   // Edge asks for /favicon.ico; answer with nothing, quietly
  r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); r.end(fs.readFileSync(f));});
const sleep=(m)=>new Promise(r=>setTimeout(r,m));
const SETTINGS = { barrow:'#btnGear', covenant:'#bGear', curveball:'#btnGear',
                   ossuary:null, reliquary:null, 'set-piece':'#btnGear', snake:'#btnGear', reflex:'#btnGear', thirst:'#btnGear' };
let fail=0;
const check=(n,c,g)=>{console.log(`  ${c?'PASS':'FAIL'}  ${n}${c?'':'\n        got: '+JSON.stringify(g)}`); if(!c)fail++;};
(async()=>{
 await new Promise(r=>srv.listen(0,r));
 const base=`http://127.0.0.1:${srv.address().port}/`;
 const b=await launch();
 for (const noVibrate of [true,false]) {
  console.log(`\n[${noVibrate?'iOS: no navigator.vibrate':'Android: vibrate present'}]`);
  for (const g of Object.keys(SETTINGS)) {
   const c=await b.newContext({viewport:{width:430,height:932},deviceScaleFactor:2,isMobile:true,hasTouch:true,userAgent:devices['iPhone 13 Pro'].userAgent});
   if (noVibrate) await c.addInitScript(()=>{ try{Object.defineProperty(navigator,'vibrate',{get:()=>undefined});}catch(e){} });
   else await c.addInitScript(()=>{ try{Object.defineProperty(navigator,'vibrate',{value:()=>true});}catch(e){} });
   const p=await c.newPage();
   await p.goto(base+g+'/',{waitUntil:'load'}); await sleep(1200);
   const res=await p.evaluate(()=>{
     const sw=document.getElementById('swHaptic');
     if(!sw) return {sw:false};
     const row=sw.closest('.row, .opt');
     return {sw:true, hasVibrate: !!navigator.vibrate,
             rowFound: !!row, hidden: row ? getComputedStyle(row).display==='none' : null};
   });
   const want = noVibrate;
   check(`${g}: switch ${want?'hidden':'shown'}`, res.sw && res.rowFound && res.hidden===want, res);
   await c.close();
  }
 }
 console.log(fail?`\n${fail} FAILED\n`:'\nALL PASS\n');
 await b.close(); srv.close(); process.exit(fail?1:0);
})();
