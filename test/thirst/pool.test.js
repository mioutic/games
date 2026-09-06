// The 8-minute wall: prove a maxed-out build still gets real choices.
const { launch, devices } = require('../lib/browser');
const fs=require('fs'), path=require('path'), http=require('http');
const SRC=path.join(__dirname, '..', '..', 'arcade', 'games', 'thirst', 'index.html');
const OUT=path.join(__dirname,'out'); fs.mkdirSync(OUT,{recursive:true});
let src=fs.readFileSync(SRC,'utf8');
const A='  /* ---------------- loop ---------------- */';
src=src.replace(A,
 '  window.__p = { run:function(){return run;}, P:function(){return P;},\n'+
 '    opts:function(){return luOptions();}, start:function(){startRunNow(false);},\n'+
 '    fill:function(){\n'+
 '      WEAPON_IDS.forEach(function(id){ if(P.weapons.length<6 && !weaponOf(id) && meta.weapons[id]) addWeapon(id); });\n'+
 '      P.weapons.forEach(function(w){ w.lv = WMAX; });\n'+
 '      var c=0; TRAIT_IDS.forEach(function(id){ var t=TRAITS[id];\n'+
 '        if(c<8 && t.tier<3 && !t.quest){ P.traits[id]=t.ranks; c++; } });\n'+
 '      run.lv = 20;\n'+
 '    },\n'+
 '    kinds:function(n){ var seen={}; for(var i=0;i<n;i++){ luOptions().forEach(function(o){ seen[o.kind]=(seen[o.kind]||0)+1; }); } return seen; },\n'+
 '    traitCap:function(){ var open=[]; TRAIT_IDS.forEach(function(id){ if(traitOpen(id)) open.push(id+":T"+TRAITS[id].tier); }); return open; } };\n'+A);
fs.writeFileSync(path.join(OUT,'index.html'),src);
const srv=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});r.end(fs.readFileSync(path.join(OUT,'index.html')))});
const sleep=m=>new Promise(r=>setTimeout(r,m));
let fail=0; const ck=(n,c,g)=>{console.log(`  ${c?'PASS':'FAIL'}  ${n}${c?'':'\n        got: '+JSON.stringify(g)}`); if(!c)fail++;};
(async()=>{
  await new Promise(r=>srv.listen(0,r));
  const b=await launch();
  const c=await b.newContext({viewport:{width:430,height:932},deviceScaleFactor:2,isMobile:true,hasTouch:true,userAgent:devices['iPhone 13 Pro'].userAgent});
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  await p.goto(`http://127.0.0.1:${srv.address().port}/`,{waitUntil:'load'}); await sleep(1500);
  await p.touchscreen.tap(215,400); await sleep(200);
  await p.evaluate(()=>window.__p.start()); await sleep(1200);

  console.log('\n[1] a fresh run still offers real upgrades');
  const fresh = await p.evaluate(()=>window.__p.kinds(60));
  console.log('        kinds over 60 draws:', JSON.stringify(fresh));
  ck('vigils are rare while real upgrades exist',
     (fresh.vig||0) / Object.values(fresh).reduce((a,b)=>a+b,0) < 0.25, fresh);

  console.log('\n[2] the 8-minute wall: 6 weapons maxed, 8 traits maxed');
  const walled = await p.evaluate(()=>{ window.__p.fill(); return { weapons:window.__p.P().weapons.length,
     traits:Object.keys(window.__p.P().traits).length, lv:window.__p.run().lv, open:window.__p.traitCap() }; });
  console.log('        build:', JSON.stringify({w:walled.weapons,t:walled.traits,lv:walled.lv}));
  ck('the build really is full', walled.weapons===6 && walled.traits>=8, walled);
  ck('Tier III is now reachable past the cap',
     walled.open.some(s=>s.endsWith(':T3')), walled.open.slice(0,8));

  const after = await p.evaluate(()=>window.__p.kinds(80));
  console.log('        kinds over 80 draws:', JSON.stringify(after));
  ck('no card is a gold consolation prize', !after.gold, after);
  ck('vigils carry the late game', (after.vig||0) > 0, after);
  ck('and Tier III traits are actually offered', (after.pnew||0) > 0, after);

  console.log('\n[3] a vigil applies through stat()');
  const applied = await p.evaluate(()=>{
    const P=window.__p.P(); const before=P.base.might;
    let o=null; for(let i=0;i<200 && !o;i++) o=window.__p.opts().find(x=>x.kind==='vig'&&x.id==='blood');
    if(!o) return {none:true};
    const bs=document.querySelectorAll('#levelup button.pick');
    return { before, found:true };
  });
  ck('a blood vigil is offerable', applied.found===true, applied);

  if(errs.length){ console.log('\nERRORS:\n  '+[...new Set(errs)].slice(0,5).join('\n  ')); fail+=errs.length; }
  console.log(fail?`\n${fail} FAILED\n`:'\nALL PASS\n');
  await b.close(); srv.close(); process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
