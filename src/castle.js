// 城堡战争：引擎。数值与卡牌都在 data.js。
(async () => {
const {W, H, ROAD, TUNE, UNITS, BUILD, FACTIONS, ENH, SKILLS} = DATA;
const Q = new URLSearchParams(location.search), DEBUG = Q.has('debug'), AUTO = Q.has('auto');
const cv = document.getElementById('cv'), c = cv.getContext('2d');
const $ = id => document.getElementById(id);
const rnd = a => a[Math.floor(Math.random() * a.length)];

// ---------- 素材 ----------
const EN = await (await fetch('data/enemies.json')).json();
const IM = {};
const load = (k, src) => new Promise(r => { const i = new Image(); i.onload = () => { IM[k] = i; r(); }; i.onerror = r; i.src = src; });
const jobs = [load('ground', 'assets/castle/ground.jpg')];
for (const k of new Set(Object.values(BUILD).map(b => b.spr).concat(['camp_gate_l', 'camp_gate_r', 'camp_fence_h', 'camp_tent_a', 'camp_totem']))) jobs.push(load(k, `assets/map/sprites/${k}.png`));
for (const k of new Set(Object.values(UNITS).map(u => u.spr))) for (const [f, v] of Object.entries(EN[k].frames)) jobs.push(load(k + '/' + f, v.src));
jobs.push(load('fire', 'assets/characters/enemies/fx/lob_fire.png'), load('rock', 'assets/characters/enemies/fx/lob_rock.png'));
await Promise.all(jobs);

// 黑气阵营：把贴图压暗染紫（代码染色，缓存）
const TINT = {};
function tinted(key, col) {
  const k = key + col; if (TINT[k]) return TINT[k];
  const im = IM[key]; if (!im) return null;
  const cc = document.createElement('canvas'); cc.width = im.width; cc.height = im.height;
  const x = cc.getContext('2d'); x.drawImage(im, 0, 0); x.globalCompositeOperation = 'source-atop';
  x.fillStyle = col; x.fillRect(0, 0, cc.width, cc.height);
  return TINT[k] = cc;
}

// ---------- 场地 ----------
function makeCells(side) {
  const cols = [34, 74, 186, 224], cells = [];
  for (const x of cols) for (let y = 150; y <= 450; y += 37) {
    if (x < 100 && y > 250 && y < 350) continue; // 主堡位置
    cells.push({x: side ? W - x : x, y, side, b: null});
  }
  return cells;
}
const CELLS = [makeCells(0), makeCells(1)];
const castleX = [62, W - 62];

// ---------- 状态 ----------
let ents = [], shots = [], fx = [], clouds = [], puffs = [], t = 0, over = false, paused = false, started = false;
let pick = null, hover = null, targeting = null;
const SS = [0, 1].map(s => newSide(s));
function newSide(s) {
  return {s, gold: TUNE.startGold, faction: 'tribe', owned: new Set(), skills: [], rerolls: 1, drawn: 0, aiT: 3, auto: false,
    hasteT: 0, roarT: 0, castle: null, taken: new Set(), color: s ? '#ff5a4a' : '#4aa8ff',
    mod: {income: 0, haste: 1, hp: 1, dmg: 1, range: 1, bounty: 1, extra: 0, mistDot: 1, cloudT: 1, mistCap: 0, unitHp: {}, unitDmg: {}, unitSpd: {}}};
}
function addStatic(kind, side, x, y, hp, extra = {}) {
  const e = Object.assign({kind, side, x, y, hp, max: hp, r: 16, dead: 0}, extra);
  ents.push(e); return e;
}
function setupBase() {
  for (const s of [0, 1]) {
    SS[s].castle = addStatic('castle', s, castleX[s], 300, TUNE.castleHp, {r: 34, cd: 0, reach: TUNE.castleReach, dmg: TUNE.castleDmg});
    for (const ry of ROAD) addStatic('tower', s, s ? W - 340 : 340, ry - 30, TUNE.towerHp, {r: 14, cd: 0, reach: TUNE.towerReach, dmg: TUNE.towerDmg});
  }
}

// ---------- 经济 ----------
const dim = x => { let o = 0, f = 1; while (x > 0) { o += Math.min(x, 25) * f; x -= 25; f = Math.max(.2, f - .1); } return o; };
function income(s) {
  const S = SS[s]; let sum = 0, mines = 0;
  for (const cl of CELLS[s]) if (cl.b && !cl.b.dead) { const bd = BUILD[cl.b.key]; if (bd.mine) mines++; else sum += bd.cost * TUNE.costRatio; }
  let a = TUNE.baseIncome + dim(sum) + S.mod.income;
  for (let i = 0; i < mines; i++) a += TUNE.mineBase * Math.pow(TUNE.mineDecay, i);
  return a * (s === 1 && !SS[0].auto ? TUNE.aiIncome : 1);
}
function build(s, cell, key) {
  const bd = BUILD[key], S = SS[s];
  if (cell.b || S.gold < bd.cost || !S.owned.has(key)) return false;
  S.gold -= bd.cost;
  cell.b = addStatic('bld', s, cell.x, cell.y, 400, {key, timer: 2 + Math.random() * 2, cell, r: 13});
  return true;
}

// ---------- 单位 ----------
const count = s => ents.reduce((n, e) => n + (e.kind === 'unit' && e.side === s && !e.dead ? 1 : 0), 0);
function spawn(bld) {
  const bd = BUILD[bld.key], u = UNITS[bd.unit], s = bld.side, S = SS[s], M = S.mod;
  if (count(s) >= TUNE.cap) return false;
  let n = u.count || 1; if (n > 1) n += M.extra;
  const lane = bld.y < 300 ? 0 : 1, ly = ROAD[lane], dir = s ? -1 : 1;
  const goal = [castleX[1 - s] - dir * 30, 300];
  const path = u.fly ? [goal] : [[s ? W - 130 : 130, ly], [s ? 130 : W - 130, ly], goal];
  for (let i = 0; i < n; i++) {
    const hp = u.hp * M.hp * (M.unitHp[bd.unit] || 1);
    ents.push({kind: 'unit', k: bd.unit, side: s, x: bld.x + dir * 10 + (i - n / 2) * 4, y: bld.y + 6 + i * 3, hp, max: hp, r: 6, path: path.map(p => p.slice()), pi: 0,
      state: 'move', st: 0, face: dir, ph: Math.random() * 6, target: null, dead: 0, mist: 0, mistT: 0, mistBy: 0, dot: 0, auraT: Math.random()});
  }
  return true;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function nearestFoe(e, range) {
  let best = null, bd = range;
  for (const o of ents) {
    if (o.side === e.side || o.dead || o.hp <= 0) continue;
    const d = dist(e, o) - o.r;
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}
const ring = (x, y, r, col) => fx.push({ring: 1, x, y, r, col, life: .5, max: .5});
function hurt(o, dmg, by, mist = 0) {
  if (o.hp <= 0 || o.dead) return;
  o.hp -= dmg;
  if (dmg >= 3) fx.push({x: o.x + (Math.random() - .5) * 6, y: o.y - 18, txt: Math.round(dmg), life: .6});
  if (mist && o.kind === 'unit') { o.mist = Math.min(TUNE.mistCap + SS[by].mod.mistCap, o.mist + mist); o.mistT = TUNE.mistTime; o.mistBy = by; }
  if (o.hp <= 0) die(o, by);
}
function die(o, by) {
  o.hp = 0; o.dead = 1; o.st = 0;
  const S = SS[o.side];
  if (o.kind === 'unit') {
    SS[by].gold += Math.round(UNITS[o.k].hp / 8 * SS[by].mod.bounty);
    if (UNITS[o.k].dark) clouds.push({x: o.x, y: o.y, side: o.side, life: TUNE.cloudLife * S.mod.cloudT, acc: 0});
  } else if (o.kind === 'bld') o.cell.b = null;
  else if (o.kind === 'tower') { SS[by].gold += 80; SS[by].rerolls++; }
  else if (o.kind === 'castle') finish(o.side === 1);
}
function dmgOf(e, tg) {
  const u = UNITS[e.k], S = SS[e.side], M = S.mod;
  let d = u.dmg * M.dmg * (M.unitDmg[e.k] || 1) * (S.roarT > 0 ? 1.3 : 1) * (e.cloud ? 1.25 : 1);
  if (t > TUNE.overtime) d *= 1 + (t - TUNE.overtime) / 90;
  if (tg.kind !== 'unit' && u.siege) d *= u.siege;
  return d;
}
function updUnit(e, dt) {
  const u = UNITS[e.k], S = SS[e.side], M = S.mod;
  e.st += dt;
  if (e.dead) return;
  // 黑气：持续掉血 + 减速
  if (e.mist > 0) {
    e.mistT -= dt; if (e.mistT <= 0) e.mist = 0;
    else { e.dot += e.mist * TUNE.mistRate * SS[e.mistBy].mod.mistDot * dt; if (e.dot >= 3) { hurt(e, e.dot, e.mistBy); e.dot = 0; } }
  }
  if (e.dead) return;
  // 光环：附近敌兵加黑气
  if (u.aura) { e.auraT -= dt; if (e.auraT <= 0) { e.auraT = 1; for (const o of ents) if (o.kind === 'unit' && o.side !== e.side && !o.dead && dist(o, e) < u.aura) hurt(o, 0, e.side, 1); } }
  if (e.state === 'move') {
    const foe = nearestFoe(e, Math.max(u.reach * (u.ranged ? M.range : 1) + 40, 80));
    const reach = u.reach * (u.ranged ? M.range : 1);
    if (foe && dist(e, foe) - foe.r <= reach) { e.target = foe; e.state = 'windup'; e.st = 0; e.face = foe.x < e.x ? -1 : 1; return; }
    let tx, ty;
    if (foe) { tx = foe.x; ty = foe.y; }
    else { const p = e.path[e.pi]; tx = p[0]; ty = p[1]; if (Math.hypot(tx - e.x, ty - e.y) < 6 && e.pi < e.path.length - 1) e.pi++; }
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 1;
    const sp = u.speed * (M.unitSpd[e.k] || 1) * (S.roarT > 0 ? 1.3 : 1) * Math.max(.6, 1 - TUNE.mistSlow * e.mist);
    e.x += dx / d * sp * dt; e.y += dy / d * sp * dt;
    if (Math.abs(dx) > 2) e.face = dx < 0 ? -1 : 1;
    for (const o of ents) if (o !== e && o.kind === 'unit' && !o.dead) {
      const ox = e.x - o.x, oy = e.y - o.y, od = Math.hypot(ox, oy);
      if (od > 0 && od < 9) { e.x += ox / od * .4; e.y += oy / od * .4; }
    }
  } else if (e.state === 'windup' && e.st > .35) {
    const tg = e.target;
    if (tg && !tg.dead) {
      const d = dmgOf(e, tg);
      if (u.shot) shots.push({x: e.x, y: e.y - 12, tg, side: e.side, dmg: d, spd: 220, k: u.shot, mist: u.mist || 0});
      else if (u.boom) {
        ring(e.x, e.y, u.boom, '#a060ff');
        for (const o of ents) if (o.side !== e.side && !o.dead && dist(o, e) - o.r < u.boom) hurt(o, d, e.side, u.mist);
        e.hp = 0; e.dead = 1; e.st = 0; return;
      } else hurt(tg, d, e.side, u.mist);
    }
    e.state = 'recover'; e.st = 0;
  } else if (e.state === 'recover' && e.st > u.cd - .35) { e.state = 'move'; e.st = 0; }
}
function updStatic(e, dt) {
  if (e.dead) return;
  const S = SS[e.side];
  if (e.kind === 'bld' && BUILD[e.key].unit) {
    e.timer -= dt * (S.hasteT > 0 ? 2 : 1);
    if (e.timer <= 0) { if (spawn(e)) e.timer = BUILD[e.key].every * S.mod.haste; else e.timer = 1; }
  }
  if (e.kind === 'tower' || e.kind === 'castle') {
    e.cd -= dt;
    if (e.cd <= 0) { const f = nearestFoe(e, e.reach); if (f && f.kind === 'unit') { shots.push({x: e.x, y: e.y - 30, tg: f, side: e.side, dmg: e.dmg, spd: 260, k: 'arrow', mist: 0}); e.cd = e.kind === 'castle' ? .8 : 1; } }
  }
}

// ---------- 技能 ----------
function useSkill(s, i, x, y) {
  const S = SS[s], sk = S.skills[i]; if (!sk || sk.cdT > 0 || sk.uses <= 0) return false;
  const id = sk.id, M = S.mod;
  if (id === 's_fire') { ring(x, y, 70, '#ffb040'); for (const o of ents) if (o.side !== s && !o.dead && dist(o, {x, y}) - o.r < 70) hurt(o, 350, s); }
  else if (id === 's_sync') { for (const o of ents) if (o.kind === 'bld' && o.side === s && !o.dead) o.timer = 0; }
  else if (id === 's_reinf') {
    const ly = ROAD[y < 300 ? 0 : 1], dir = s ? -1 : 1, key = FACTIONS[S.faction].cheap;
    for (let k = 0; k < 5; k++) spawnFake({x: (s ? W - 130 : 130) + dir * 8 * k, y: ly - 16 + k * 8, side: s}, key);
  }
  else if (id === 's_haste') S.hasteT = 15;
  else if (id === 's_roar') S.roarT = 10;
  else if (id === 's_burst') for (const o of ents) if (o.kind === 'unit' && o.side !== s && !o.dead && o.mist > 0) { const n = o.mist; o.mist = 0; ring(o.x, o.y, 14, '#a060ff'); hurt(o, n * 45, s); }
  sk.uses--; sk.cdT = SKILLS[id].cd;
  return true;
}
function spawnFake(b, ukey) {
  const u = UNITS[ukey], s = b.side, S = SS[s], M = S.mod, lane = b.y < 300 ? 0 : 1, dir = s ? -1 : 1;
  const goal = [castleX[1 - s] - dir * 30, 300], hp = u.hp * M.hp * (M.unitHp[ukey] || 1);
  ents.push({kind: 'unit', k: ukey, side: s, x: b.x, y: b.y, hp, max: hp, r: 6, path: [[s ? 130 : W - 130, ROAD[lane]], goal], pi: 0,
    state: 'move', st: 0, face: dir, ph: Math.random() * 6, target: null, dead: 0, mist: 0, mistT: 0, mistBy: 0, dot: 0, auraT: 0});
}

// ---------- 卡牌 ----------
function buildDesc(k) { const bd = BUILD[k]; if (bd.mine) return '提高收入（造得越多，每座越少）'; const u = UNITS[bd.unit]; return `每 ${bd.every} 秒出${u.count ? u.count + '个' : '1个'}${u.name}，生命 ${u.hp}，伤害 ${u.dmg}${u.fly ? '，能飞过大海' : ''}${u.mist ? '，附带黑气' : ''}`; }
function poolFor(s, opening) {
  const S = SS[s], F = FACTIONS[S.faction], out = [];
  for (const k of F.build) if (!S.owned.has(k) && (!opening || BUILD[k].tier <= 2))
    out.push({id: 'b:' + k, type: 'build', tag: `建筑 · ${BUILD[k].tier} 阶`, name: BUILD[k].name, desc: buildDesc(k), w: BUILD[k].tier === 3 ? 2 : 3, key: k});
  if (opening) return out;
  for (const [k, e] of Object.entries(ENH)) if ((!e.f || e.f === S.faction) && !S.taken?.has(k))
    out.push({id: 'e:' + k, type: 'enh', tag: '强化', name: e.name, desc: e.desc, w: 3, key: k});
  if (S.skills.length < 2) for (const [k, e] of Object.entries(SKILLS)) if ((!e.f || e.f === S.faction) && !S.skills.some(x => x.id === k))
    out.push({id: 's:' + k, type: 'skill', tag: '主动技能', name: e.name, desc: e.desc, w: 2, key: k});
  return out;
}
function draw3(s, opening) {
  const pool = poolFor(s, opening), out = [];
  while (out.length < 3 && pool.length) {
    let tot = pool.reduce((a, b) => a + b.w, 0), r = Math.random() * tot, i = 0;
    for (; i < pool.length - 1; i++) { r -= pool[i].w; if (r <= 0) break; }
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
function takeCard(s, card) {
  const S = SS[s]; S.taken = S.taken || new Set();
  if (card.type === 'build') S.owned.add(card.key);
  else if (card.type === 'enh') { S.taken.add(card.key); ENH[card.key].ap(S.mod, S); }
  else S.skills.push({id: card.key, uses: SKILLS[card.key].uses, cdT: 0});
  if (s === 0 && !S.auto) rebuildBar();
}
function openPick(title, opening) {
  const S = SS[0];
  const show = () => {
    const cs = draw3(0, opening);
    $('pickt').textContent = title; $('picks').innerHTML = '';
    for (const cd of cs) {
      const d = document.createElement('div'); d.className = 'card ' + cd.type;
      d.innerHTML = `<div class="tag">${cd.tag}</div><b>${cd.name}</b><span>${cd.desc}</span>`;
      d.onclick = () => { takeCard(0, cd); $('pick').style.display = 'none'; paused = false; };
      $('picks').appendChild(d);
    }
    $('reroll').textContent = `刷新（剩 ${S.rerolls} 次）`; $('reroll').disabled = S.rerolls <= 0 || !cs.length;
    $('reroll').onclick = () => { S.rerolls--; show(); };
    if (!cs.length) { $('pick').style.display = 'none'; paused = false; }
  };
  paused = true; $('pick').style.display = 'flex'; show();
}
function autoDraw(s, opening) { const cs = draw3(s, opening); if (cs.length) takeCard(s, rnd(cs)); }

// ---------- 电脑 ----------
const tierAt = () => TUNE.aiGate.filter(g => t >= g).length;
function ai(s, dt) {
  const S = SS[s]; S.aiT -= dt; if (S.aiT > 0) return; S.aiT = 2 + Math.random() * 2;
  const F = FACTIONS[S.faction], free = CELLS[s].filter(cl => !cl.b); if (!free.length) return;
  const n = CELLS[s].length - free.length, mines = CELLS[s].filter(cl => cl.b && BUILD[cl.b.key].mine).length;
  const av = F.build.filter(k => !BUILD[k].mine && BUILD[k].tier <= tierAt() && BUILD[k].cost <= S.gold);
  let key;
  if (mines < 1 + n / 6 && S.gold >= BUILD[F.mine].cost && Math.random() < .35) key = F.mine;
  else if (av.length) { const bag = []; for (const k of av) for (let i = 0; i < 4 - BUILD[k].tier; i++) bag.push(k); key = rnd(bag); }
  if (key) { S.owned.add(key); build(s, rnd(free), key); S.aiT = .6 + Math.random(); }
  // 电脑偶尔用技能
  if (s === 1 || S.auto) { S.skills.forEach((sk, i) => { if (Math.random() < .05) useSkill(s, i, W / 2 + (s ? -250 : 250), rnd(ROAD)); }); }
}

// ---------- 流程 ----------
function finish(win) { over = true; $('msgt').textContent = win ? `胜利！用时 ${fmt(t)}` : `主堡被攻破（${fmt(t)}）`; $('msg').style.display = 'flex'; }
const fmt = x => Math.floor(x / 60) + ':' + String(Math.floor(x % 60)).padStart(2, '0');
function start(fac0, auto) {
  started = true; SS[0].faction = fac0; SS[1].faction = fac0 === 'tribe' ? 'dark' : 'tribe'; SS[0].auto = !!auto;
  setupBase();
  for (const s of [0, 1]) if (s === 1 || auto) { SS[s].owned = new Set(FACTIONS[SS[s].faction].build); }
  if (!auto) { for (const k of FACTIONS[fac0].starters) SS[0].owned.add(k); }
  $('menu').style.display = 'none';
  if (!auto) { rebuildBar(); openPick('开局选一张建筑卡', true); }
}
function step(dt) {
  if (paused || over || !started) return;
  t += dt;
  for (const s of [0, 1]) {
    const S = SS[s]; S.gold += income(s) / 10 * dt;
    S.hasteT = Math.max(0, S.hasteT - dt); S.roarT = Math.max(0, S.roarT - dt);
    for (const sk of S.skills) sk.cdT = Math.max(0, sk.cdT - dt);
  }
  // 定时抽卡
  for (const s of [1, 0]) {
    const S = SS[s];
    if (S.drawn < TUNE.draws.length && t >= TUNE.draws[S.drawn]) {
      S.drawn++;
      if (s === 0 && !S.auto) { openPick(`第 ${S.drawn} 次抽卡`, false); return; }
      autoDraw(s, false);   // 电脑（和自动模式）同样每次抽一张强化/技能
    }
  }
  ai(1, dt); if (SS[0].auto) ai(0, dt);
  // 加时
  if (t > TUNE.overtime) { // 加时：主堡血量较低的一方持续崩塌（血量相同则敌方先倒）
    const w = SS[0].castle.hp < SS[1].castle.hp ? 0 : 1; hurt(SS[w].castle, TUNE.drain * dt, 1 - w);
  }
  for (const e of ents) e.kind === 'unit' ? updUnit(e, dt) : updStatic(e, dt);
  // 黑气云：己方黑气兵 +25% 伤害，敌兵每秒 +1 层
  for (const e of ents) if (e.kind === 'unit') e.cloud = false;
  for (const cl of clouds) {
    cl.life -= dt; cl.acc += dt;
    const tick = cl.acc >= 1; if (tick) cl.acc = 0;
    for (const o of ents) if (o.kind === 'unit' && !o.dead && Math.hypot(o.x - cl.x, o.y - cl.y) < TUNE.cloudR) {
      if (o.side === cl.side) { if (UNITS[o.k].dark) o.cloud = true; } else if (tick) hurt(o, 0, cl.side, 1);
    }
  }
  clouds = clouds.filter(x => x.life > 0);
  for (const p of shots) {
    const dx = p.tg.x - p.x, dy = p.tg.y - 10 - p.y, d = Math.hypot(dx, dy);
    p.a = Math.atan2(dy, dx);
    if (d < 6 || p.tg.dead) { if (!p.tg.dead) hurt(p.tg, p.dmg, p.side, p.mist); p.done = 1; }
    else { p.x += dx / d * p.spd * dt; p.y += dy / d * p.spd * dt; }
  }
  shots = shots.filter(p => !p.done);
  for (const f of fx) { f.life -= dt; if (!f.ring) f.y -= 14 * dt; }
  fx = fx.filter(f => f.life > 0);
  // 黑气粒子
  for (const e of ents) if (e.kind === 'unit' && !e.dead && UNITS[e.k].dark && puffs.length < 260 && Math.random() < dt * 2.5)
    puffs.push({x: e.x + (Math.random() - .5) * 8, y: e.y - 6, vx: (Math.random() - .5) * 6, vy: -8 - Math.random() * 8, life: 1.1, max: 1.1});
  for (const p of puffs) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  puffs = puffs.filter(p => p.life > 0);
  ents = ents.filter(e => !(e.kind === 'unit' && e.dead && e.st > 3));
}

// ---------- 画面 ----------
let sc = 1, ox = 0, oy = 0;
function resize() {
  const top = 34, bot = 66, w = innerWidth, h = innerHeight - top - bot;
  sc = Math.min(w / W, h / H); const dpr = devicePixelRatio || 1;
  cv.width = Math.round(W * sc * dpr); cv.height = Math.round(H * sc * dpr);
  cv.style.width = W * sc + 'px'; cv.style.height = H * sc + 'px';
  ox = (w - W * sc) / 2; oy = top + (h - H * sc) / 2;
  cv.style.left = ox + 'px'; cv.style.top = oy + 'px';
  c.setTransform(sc * dpr, 0, 0, sc * dpr, 0, 0);
}
addEventListener('resize', resize); resize();

function unitFrame(e) {
  const fr = EN[UNITS[e.k].spr].frames, nw = EN[UNITS[e.k].spr].nw || 6;
  let n;
  if (e.dead) n = e.st < .25 ? 'fall' : 'down';
  else if (e.state === 'move') n = 'walk' + (Math.floor(t * 9 + e.ph) % nw);
  else if (e.state === 'windup') n = fr.draw && e.st > .2 ? 'draw' : 'windup';
  else n = e.st < .15 ? 'strike' : (fr.recover ? 'recover' : 'idle0');
  if (!fr[n]) n = 'idle0';
  return [n, fr[n]];
}
function drawSprite(key, x, y, s, face = 1, tint) {
  const im = tint ? tinted(key, tint) : IM[key]; if (!im) return;
  const w = im.width / 2 * s, h = im.height / 2 * s;
  c.save(); c.translate(x, y); c.scale(face, 1); c.drawImage(im, -w / 2, -h, w, h); c.restore();
}
function bar(x, y, w, p, col) { c.fillStyle = '#0009'; c.fillRect(x - w / 2, y, w, 3); c.fillStyle = col; c.fillRect(x - w / 2, y, w * Math.max(0, p), 3); }
const DARK = 'rgba(50,15,85,.55)';
function draw() {
  c.drawImage(IM.ground, 0, 0, W, H);
  if (pick) for (const cl of CELLS[0]) if (!cl.b) {
    c.strokeStyle = cl === hover ? '#fff' : '#ffffff66'; c.lineWidth = 1; c.strokeRect(cl.x - 17, cl.y - 17, 34, 34);
  }
  // 黑气云（地面层）
  for (const cl of clouds) {
    const a = Math.min(1, cl.life / 2) * .5, g = c.createRadialGradient(cl.x, cl.y, 2, cl.x, cl.y, TUNE.cloudR);
    g.addColorStop(0, `rgba(20,5,40,${a})`); g.addColorStop(1, 'rgba(20,5,40,0)');
    c.fillStyle = g; c.beginPath(); c.arc(cl.x, cl.y, TUNE.cloudR, 0, 7); c.fill();
  }
  const list = ents.filter(e => !(e.dead && e.kind !== 'unit')).sort((a, b) => a.y - b.y);
  for (const e of list) {
    const S = SS[e.side], col = S.color, dark = S.faction === 'dark';
    if (e.kind === 'castle') {
      drawSprite('camp_fence_h', e.x, e.y + 26, .45, 1, dark ? DARK : null);
      drawSprite('camp_tent_a', e.x, e.y + 16, 1.05, e.side ? -1 : 1, dark ? DARK : null);
      drawSprite('camp_gate_l', e.x - 30, e.y + 22, .4, 1, dark ? DARK : null); drawSprite('camp_gate_r', e.x + 30, e.y + 22, .4, 1, dark ? DARK : null);
      c.fillStyle = col; c.fillRect(e.x - 3, e.y - 62, 14, 8); c.fillRect(e.x - 3, e.y - 62, 2, 22);
      bar(e.x, e.y - 72, 70, e.hp / e.max, col);
    } else if (e.kind === 'tower') {
      drawSprite('camp_totem', e.x, e.y + 8, .75, 1, dark ? DARK : null);
      c.fillStyle = col; c.beginPath(); c.ellipse(e.x, e.y + 9, 10, 3, 0, 0, 7); c.fill();
      bar(e.x, e.y - 50, 34, e.hp / e.max, col);
    } else if (e.kind === 'bld') {
      const b = BUILD[e.key];
      c.fillStyle = col + '55'; c.beginPath(); c.ellipse(e.x, e.y + 8, 16, 5, 0, 0, 7); c.fill();
      drawSprite(b.spr, e.x, e.y + 10, b.s * .72, e.side ? -1 : 1, dark ? DARK : null);
      if (e.hp < e.max) bar(e.x, e.y - 26, 26, e.hp / e.max, col);
    } else {
      const u = UNITS[e.k], [n, f] = unitFrame(e), key = u.spr + '/' + n, im = u.dark ? tinted(key, DARK) : IM[key];
      c.globalAlpha = e.dead ? Math.max(0, 1 - (e.st - 1.5) / 1.5) : 1;
      if (u.dark && !e.dead) { const g = c.createRadialGradient(e.x, e.y - 4, 1, e.x, e.y - 4, 13); g.addColorStop(0, 'rgba(15,0,30,.5)'); g.addColorStop(1, 'rgba(15,0,30,0)'); c.fillStyle = g; c.beginPath(); c.arc(e.x, e.y - 4, 13, 0, 7); c.fill(); }
      c.fillStyle = col; c.beginPath(); c.ellipse(e.x, e.y, 7, 2.5, 0, 0, 7); c.fill();
      const lift = u.fly ? -10 : 0;
      if (im) { c.save(); c.translate(e.x, e.y + lift); c.scale(e.face, 1); c.drawImage(im, -f.anchor[0], -f.anchor[1], f.size[0], f.size[1]); c.restore(); }
      c.globalAlpha = 1;
      if (!e.dead && (e.hp < e.max || e.mist)) { bar(e.x, e.y + lift - f.anchor[1] - 5, 16, e.hp / e.max, col); if (e.mist) { c.fillStyle = '#c090ff'; c.font = 'bold 8px sans-serif'; c.textAlign = 'center'; c.fillText('黑' + e.mist, e.x, e.y + lift - f.anchor[1] - 8); } }
    }
  }
  for (const p of puffs) { c.globalAlpha = p.life / p.max * .55; c.fillStyle = '#1a0830'; c.beginPath(); c.arc(p.x, p.y, 2.4 * (1.4 - p.life / p.max * .6), 0, 7); c.fill(); }
  c.globalAlpha = 1;
  for (const p of shots) {
    if (p.k === 'fire' && IM.fire) c.drawImage(IM.fire, p.x - 6, p.y - 6, 12, 12);
    else if (p.k === 'rock' && IM.rock) c.drawImage(IM.rock, p.x - 5, p.y - 5, 10, 10);
    else if (p.k === 'dark') { const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, 7); g.addColorStop(0, '#d8a0ff'); g.addColorStop(.4, '#6a30b0'); g.addColorStop(1, 'rgba(20,5,40,0)'); c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, 7, 0, 7); c.fill(); }
    else { const f = EN.gob_archer.frames.arrow, im = IM['gob_archer/arrow']; c.save(); c.translate(p.x, p.y); c.rotate(p.a || 0); if (im) c.drawImage(im, -f.size[0] / 2, -f.size[1] / 2, f.size[0], f.size[1]); c.restore(); }
  }
  c.font = 'bold 9px sans-serif'; c.textAlign = 'center';
  for (const f of fx) {
    if (f.ring) { c.globalAlpha = f.life / f.max; c.strokeStyle = f.col; c.lineWidth = 3; c.beginPath(); c.arc(f.x, f.y, f.r * (1.1 - f.life / f.max * .4), 0, 7); c.stroke(); }
    else { c.globalAlpha = Math.min(1, f.life * 2); c.fillStyle = '#fff'; c.fillText(f.txt, f.x, f.y); }
  }
  c.globalAlpha = 1;
}

// ---------- 界面 ----------
const barEl = $('bar');
function rebuildBar() {
  barEl.innerHTML = ''; const S = SS[0];
  for (const k of FACTIONS[S.faction].build) if (S.owned.has(k)) {
    const b = BUILD[k], bt = document.createElement('button'); bt.dataset.k = k;
    const icon = b.unit ? EN[UNITS[b.unit].spr].frames.idle0.src : `assets/map/sprites/${b.spr}.png`;
    bt.innerHTML = `<img src="${icon}">${b.name}<br><small>${b.cost} 金</small>`; bt.title = buildDesc(k);
    bt.onclick = () => { pick = pick === k ? null : k; targeting = null; };
    barEl.appendChild(bt);
  }
  if (S.skills.length) { const sp = document.createElement('div'); sp.className = 'sep'; barEl.appendChild(sp); }
  S.skills.forEach((sk, i) => {
    const d = SKILLS[sk.id], bt = document.createElement('button'); bt.className = 'sk'; bt.dataset.i = i; bt.title = d.desc;
    bt.onclick = () => {
      if (sk.cdT > 0 || sk.uses <= 0) return;
      if (d.target) { targeting = i; pick = null; } else useSkill(0, i);
    };
    barEl.appendChild(bt);
  });
  if (DEBUG) { const bt = document.createElement('button'); bt.textContent = '+1000 金'; bt.onclick = () => SS[0].gold += 1000; barEl.appendChild(bt); }
}
function ui() {
  const S = SS[0];
  $('gold').textContent = Math.floor(S.gold); $('inc').textContent = Math.round(income(0));
  $('clock').textContent = fmt(t); $('clock').className = t > TUNE.overtime ? 'ot' : '';
  $('ehp').textContent = started ? `我方主堡 ${Math.max(0, Math.round(SS[0].castle.hp))} · 敌方主堡 ${Math.max(0, Math.round(SS[1].castle.hp))}` : '';
  for (const bt of barEl.querySelectorAll('button[data-k]')) { bt.classList.toggle('on', bt.dataset.k === pick); bt.disabled = S.gold < BUILD[bt.dataset.k].cost; }
  for (const bt of barEl.querySelectorAll('button.sk')) {
    const sk = S.skills[bt.dataset.i], d = SKILLS[sk.id];
    bt.innerHTML = `${d.name}<br><small>${sk.cdT > 0 ? Math.ceil(sk.cdT) + ' 秒' : sk.uses < 90 ? '剩 ' + sk.uses + ' 次' : '可用'}</small>`;
    bt.disabled = sk.cdT > 0 || sk.uses <= 0; bt.classList.toggle('on', targeting === +bt.dataset.i);
  }
  const next = TUNE.draws[S.drawn];
  $('tip').textContent = targeting != null ? (SKILLS[S.skills[targeting].id].target === 'lane' ? '点上半区或下半区，选一条路' : '点地图选择目标位置')
    : pick ? `点左边空格子放「${BUILD[pick].name}」（上半区走上路，下半区走下路）` : (next != null && started ? `下次抽卡 ${fmt(next)}` : '');
}
function cellAt(ev) {
  const x = (ev.clientX - ox) / sc, y = (ev.clientY - oy) / sc;
  return CELLS[0].find(cl => Math.abs(cl.x - x) < 18 && Math.abs(cl.y - y) < 18);
}
cv.addEventListener('pointermove', ev => hover = cellAt(ev));
cv.addEventListener('pointerdown', ev => {
  if (paused || over) return;
  const x = (ev.clientX - ox) / sc, y = (ev.clientY - oy) / sc;
  if (targeting != null) { if (useSkill(0, targeting, x, y)) targeting = null; return; }
  const cl = cellAt(ev);
  if (pick && cl && build(0, cl, pick)) { if (SS[0].gold < BUILD[pick].cost) pick = null; }
});

// 选阵营
for (const [k, F] of Object.entries(FACTIONS)) {
  const d = document.createElement('div'); d.className = `card fac ${k}`;
  d.innerHTML = `<div class="tag">阵营</div><b>${F.name}</b><span>${F.desc}</span>`;
  d.onclick = () => start(k, false); $('facs').appendChild(d);
}
if (AUTO) start(Q.get('f') === 'dark' ? 'dark' : 'tribe', true);

// 主循环
let last = performance.now(), speed = +(Q.get('speed') || 1);
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  for (let i = 0; i < speed; i++) step(dt);
  draw(); ui(); requestAnimationFrame(loop);
}
window.__game = {step, SS, get t() { return t; }, get over() { return over; }, count, ents: () => ents, start};
requestAnimationFrame(loop);
})();
