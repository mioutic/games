// Pathing: the player stands in an alley on the far side of a building; a foe
// is placed on the other side. With straight-line pursuit it scrapes along
// the wall forever. With the field it arrives.
const { launch, devices } = require('../lib/browser');
const fs=require('fs'), path=require('path'), http=require('http');
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
const sleep=m=>new Promise(r=>setTimeout(r,m));
let src=fs.readFileSync(path.join(__dirname, '..', '..', 'arcade', 'games', 'thirst', 'index.html'),'utf8');
const anchor='  /* ---------------- loop ---------------- */';
src=src.replace(anchor, `  window.__p = { go: function (m) { meta.maps[m] = 1; paintHub(); },
    setup: function (px, py, fx, fy, kind) { P.x = px; P.y = py; camX = px; camY = py; foes.length = 0; run.spawnT = 1e9; run.sched = []; run.map.timeline = []; P.weapons.length = 0; shots.length = 0;
      var f = spawnFoe(kind || 'thrall', { x: fx, y: fy, plain: 1 }); f.spd = 90; f.dmg = 0; f.hp = 1e9; f.maxHp = 1e9; navFlood(P.x, P.y); return f.id; },
    foe: function () { var f = foes[0]; return f ? { x: Math.round(f.x), y: Math.round(f.y), d: Math.round(Math.hypot(f.x - P.x, f.y - P.y)), dead: f.dead } : null; },
    hold: function () { run.spawnT = 1e9; P.hp = P.maxHp; } };
` + anchor);
fs.writeFileSync(path.join(__dirname, 'out', 'thirst-path.html'), src);
let fail=0; const check=(n,c,g)=>{ console.log(`  ${c?'PASS':'FAIL'}  ${n}${c?'':'\n        got: '+JSON.stringify(g)}`); if(!c) fail++; };
(async()=>{
  const srv=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});r.end(fs.readFileSync(path.join(__dirname, 'out', 'thirst-path.html')))});
  await new Promise(r=>srv.listen(0,r));
  const b=await launch();
  const c=await b.newContext({viewport:{width:430,height:932},deviceScaleFactor:2,isMobile:true,hasTouch:true,userAgent:devices['iPhone 13 Pro'].userAgent});
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(`http://127.0.0.1:${srv.address().port}/`,{waitUntil:'load'}); await sleep(1200); await p.touchscreen.tap(215,400); await sleep(200);
  // Street: building block at (265.., 265..). Player in the alley between the
  // top-left pair of buildings; foe out on the ring road above them.
  const CASES = [
    { map:'street', name:'round a city block', P:[412, 430], F:[412, 160] },        // alley between the two buildings vs the road above: wall in between
    { map:'street', name:'round the plaza fountain', P:[1625, 1180], F:[1625, 1420] },
    { map:'nave',   name:'round a cathedral pillar', P:[600, 1000], F:[600, 1300] },
    { map:'nave',   name:'from the transept into the nave', P:[1000, 1200], F:[380, 1900] },
    { map:'undercity', name:'between tunnels through the rock', P:[600, 800], F:[1000, 500] },
  ];
  for (const cs of CASES) {
    await p.evaluate(m=>window.__p.go(m), cs.map); await sleep(200);
    await p.click('.map[data-id="'+cs.map+'"]'); await sleep(150); await p.click('#bHunt'); await sleep(900);
    await p.evaluate(([px,py,fx,fy])=>window.__p.setup(px,py,fx,fy), [...cs.P, ...cs.F]);
    const d0 = (await p.evaluate(()=>window.__p.foe())).d; let d=d0, tries=0, trail=[];
    while (tries++ < 40) { await sleep(500); await p.evaluate(()=>window.__p.hold()); const f=await p.evaluate(()=>window.__p.foe()); if(!f){trail.push('gone');break;} d=f.d; trail.push(d); if (d < 40) break; }
    check(`${cs.map}: ${cs.name}  (${d0} -> ${d} in ${(tries*0.5).toFixed(1)}s)`, d < 40, trail);
    await p.evaluate(()=>{ const e=document.getElementById('bPause')||document.querySelector('#hud .pause'); });
    await p.reload({waitUntil:'load'}); await sleep(1000); await p.touchscreen.tap(215,400); await sleep(200);
  }
  if (errs.length) { console.log('ERRORS', [...new Set(errs)].slice(0,3)); fail++; }
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS'); await b.close(); srv.close(); process.exit(fail?1:0);
})();
