// Collision and placement, checked directly: a point inside a building is
// ejected, a point against a pillar is held off, the bounds hold, and every
// spawn lands in the world and out of the walls.
const { launch, devices } = require('../lib/browser');
const fs=require('fs'), path=require('path'), http=require('http');
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
const sleep=m=>new Promise(r=>setTimeout(r,m));
let src=fs.readFileSync(path.join(__dirname, '..', '..', 'arcade', 'games', 'thirst', 'index.html'),'utf8');
const anchor='  /* ---------------- loop ---------------- */';
src=src.replace(anchor, `  window.__w = { go: function (m) { selMap = m; meta.maps[m] = 1; startRunNow(false); }, world: function () { return world; }, push: function (x, y, r, ro) { var p = { x: x, y: y }; pushOut(p, r, ro); return p; },
    spawnMany: function (n) { var bad = 0, out = 0; for (var i = 0; i < n; i++) { var s = spawnPoint(); if (!inWorld(s.x, s.y, 0)) out++; if (inSolid(s.x, s.y, 8)) bad++; } return { out: out, inSolid: bad }; },
    teleport: function (x, y) { P.x = x; P.y = y; }, P: function () { return { x: P.x, y: P.y }; } };
` + anchor);
fs.writeFileSync(path.join(__dirname, 'out', 'thirst-world.html'), src);
let fail=0; const check=(n,c,g)=>{ console.log(`  ${c?'PASS':'FAIL'}  ${n}${c?'':'\n        got: '+JSON.stringify(g)}`); if(!c) fail++; };
(async()=>{
  const srv=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});r.end(fs.readFileSync(path.join(__dirname, 'out', 'thirst-world.html')))});
  await new Promise(r=>srv.listen(0,r));
  const b=await launch();
  const c=await b.newContext({viewport:{width:430,height:932},deviceScaleFactor:2,isMobile:true,hasTouch:true,userAgent:devices['iPhone 13 Pro'].userAgent});
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto(`http://127.0.0.1:${srv.address().port}/`,{waitUntil:'load'}); await sleep(1200); await p.touchscreen.tap(215,400); await sleep(200);
  for (const id of ['street','nave','undercity']) {
    console.log(`\n=== ${id} ===`);
    await p.evaluate(id=>window.__w.go(id), id); await sleep(500);
    const w = await p.evaluate(()=>{ const w=window.__w.world(); return { w:w.w, h:w.h, blocks:w.blocks.map(b=>[b.x,b.y,b.w,b.h]).slice(0,3), circ:w.solids.filter(s=>!s.rect)[0] }; });
    // Inside the first block -> ejected.
    const bl = w.blocks[0]; const inside = await p.evaluate(([x,y])=>window.__w.push(x,y,11,false), [bl[0]+bl[2]/2, bl[1]+bl[3]/2]);
    const outside = !(inside.x > bl[0] && inside.x < bl[0]+bl[2] && inside.y > bl[1] && inside.y < bl[1]+bl[3]);
    check('a point inside a block is ejected', outside, {bl, inside});
    // Against the first circular solid -> held off by r + s.r.
    if (w.circ) { const held = await p.evaluate(s=>window.__w.push(s.x + 3, s.y + 1, 11, false), w.circ); const d = Math.hypot(held.x - w.circ.x, held.y - w.circ.y);
      check('a point in a pillar is held off at r + R', Math.abs(d - (11 + w.circ.r)) < 0.5, {d, want: 11 + w.circ.r});
      const boss = await p.evaluate(s=>window.__w.push(s.x + 3, s.y + 1, 11, true), w.circ);
      check('a lord walks through the furniture', Math.abs(boss.x - (w.circ.x+3)) < 0.01, boss); }
    // Corners of the world, and the middle of each perimeter wall: every one
    // must resolve to a spot inside the world and outside every solid.
    const W = await p.evaluate(()=>{ const w=window.__w.world(); return {w:w.w,h:w.h}; });
    const pts = [[-50,-50],[W.w+50,-50],[-50,W.h+50],[W.w+50,W.h+50],[W.w/2,-50],[W.w/2,W.h+50],[-50,W.h/2],[W.w+50,W.h/2],[-50,99999]];
    const res = await p.evaluate((pts)=>pts.map(q=>{ const e=window.__w.push(q[0],q[1],11,false); const again=window.__w.push(e.x,e.y,11,false);
      return { x:Math.round(e.x), y:Math.round(e.y), settled: Math.abs(again.x-e.x)<0.01 && Math.abs(again.y-e.y)<0.01, inW: e.x>=11&&e.y>=11&&e.x<=window.__w.world().w-11&&e.y<=window.__w.world().h-11 }; }), pts);
    check('the bounds hold and every corner settles', res.every(r=>r.inW && r.settled), res);
    const sp = await p.evaluate(()=>window.__w.spawnMany(300));
    check('300 spawns all land in the world', sp.out === 0, sp);
    check('and none inside a wall', sp.inSolid === 0, sp);
  }
  if (errs.length) { console.log('ERRORS', errs.slice(0,3)); fail++; }
  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  await b.close(); srv.close(); process.exit(fail?1:0);
})();
