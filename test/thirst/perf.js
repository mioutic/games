// Same harness, same machine, before vs after: the only fair comparison
// SwiftShader can give (PLATFORM.md — absolute fps here is meaningless).
const { launch, devices } = require('../lib/browser');
const fs=require('fs'), path=require('path'), http=require('http');
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
const sleep=m=>new Promise(r=>setTimeout(r,m));
async function measure(file, label){
  const srv=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});r.end(fs.readFileSync(file))});
  await new Promise(r=>srv.listen(0,r));
  const b=await launch();
  const c=await b.newContext({viewport:{width:430,height:932},deviceScaleFactor:2,isMobile:true,hasTouch:true,userAgent:devices['iPhone 13 Pro'].userAgent});
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(`http://127.0.0.1:${srv.address().port}/`,{waitUntil:'load'}); await sleep(1500);
  await p.touchscreen.tap(215,400); await sleep(200);
  await p.click('#bHunt'); await sleep(4000);
  const r=await p.evaluate(async()=>{
    const ts=[]; await new Promise(res=>{ let last=performance.now(), n=0;
      const tick=()=>{ const now=performance.now(); ts.push(now-last); last=now;
        if(++n>=140) return res(); requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    ts.sort((a,b)=>a-b);
    return { p50:+ts[70].toFixed(2), p90:+ts[126].toFixed(2), p99:+ts[138].toFixed(2),
             heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : null };
  });
  console.log(`  ${label.padEnd(7)} frame p50 ${String(r.p50).padStart(5)}  p90 ${String(r.p90).padStart(5)}  p99 ${String(r.p99).padStart(5)} ms   heap ${r.heap}MB   errors ${errs.length}`);
  await b.close(); srv.close();
  return r;
}
(async()=>{
  const A=[], B=[];
  for (let i=0;i<3;i++){
    A.push(await measure(path.join(__dirname, 'out', 'before.html'), 'before'));
    B.push(await measure(path.join(__dirname, '..', '..', 'arcade', 'games', 'thirst', 'index.html'), 'after'));
  }
  const med = (xs,k)=>xs.map(x=>x[k]).sort((p,q)=>p-q)[1];
  const a={p50:med(A,'p50'),p90:med(A,'p90'),p99:med(A,'p99')};
  const b={p50:med(B,'p50'),p90:med(B,'p90'),p99:med(B,'p99')};
  console.log(`
  median of 3 - before p50 ${a.p50} p90 ${a.p90} p99 ${a.p99}`);
  console.log(`  median of 3 - after  p50 ${b.p50} p90 ${b.p90} p99 ${b.p99}`);
  const d = ((b.p50 - a.p50)/a.p50*100);
  console.log('\n  p50 change: %s%.1f%%  (same harness, same machine — relative only)',
    d>=0?'+':'', d);
})();
