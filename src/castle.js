// 城堡战争：引擎。数值、兵种、卡牌都在 data.js。
(async () => {
const {W, H, ROAD, CASTLE, CELLS_UP, TUNE, UNITS, BUILD, FACTIONS, ENH, SKILLS} = DATA;
const Q = new URLSearchParams(location.search), DEBUG = Q.has('debug'), AUTO = Q.has('auto');
const cv = document.getElementById('cv'), c = cv.getContext('2d');
const $ = id => document.getElementById(id);
const rnd = a => a[Math.floor(Math.random() * a.length)];
const U = 1.4;   // 兵的画面放大倍数

// ---------- 素材 ----------
const EN = await (await fetch('data/enemies.json')).json();
const IM = {};
const load = (k, src) => new Promise(r => { const i = new Image(); i.onload = () => { IM[k] = i; r(); }; i.onerror = r; i.src = src; });
const jobs = [load('ground', 'assets/castle/ground.jpg')];
for (const k of new Set(Object.values(BUILD).map(b => b.spr).concat(['camp_gate_l', 'camp_gate_r', 'camp_fence_h', 'camp_tent_a', 'camp_totem']))) jobs.push(load(k, `assets/map/sprites/${k}.png`));
for (const k of new Set(Object.values(UNITS).map(u => u.spr))) for (const [f, v] of Object.entries(EN[k].frames)) jobs.push(load(k + '/' + f, v.src));
jobs.push(load('fire', 'assets/characters/enemies/fx/lob_fire.png'), load('rock', 'assets/characters/enemies/fx/lob_rock.png'));
await Promise.all(jobs);

const TINT = {};   // 黑气阵营：贴图压暗染紫（代码染色，缓存）
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
  const out = [];
  for (const [x, y] of CELLS_UP) for (const yy of [y, H - y]) out.push({x: side ? W - x : x, y: yy, side, b: null});
  return out;
}
const CELLS = [makeCells(0), makeCells(1)];

// ---------- 状态 ----------
let ents = [], shots = [], fx = [], clouds = [], puffs = [], t = 0, over = false, paused = false, started = false;
let pick = null, hover = null, targeting = null, sel = null, userPause = false;
const SS = [0, 1].map(newSide);
function newSide(s) {
  return {s, gold: TUNE.startGold, faction: 'tribe', level: 1, picks: {}, dual: 0, respec: 1, skills: [], rerolls: 1, drawn: 0, aiT: 3, auto: false,
    hasteT: 0, roarT: 0, castle: null, taken: new Set(), color: s ? '#ff5a4a' : '#4aa8ff',
    mod: {income: 0, haste: 1, hp: 1, dmg: 1, range: 1, bounty: 1, extra: 0, mistDot: 1, cloudT: 1, mistCap: 0, capAdd: 0, bigAdd: 0, unitHp: {}, unitDmg: {}, unitSpd: {}}};
}
function addStatic(kind, side, x, y, hp, extra = {}) {
  const e = Object.assign({kind, side, x, y, hp, max: hp, r: 16, dead: 0}, extra);
  ents.push(e); return e;
}
function setupBase() {
  for (const s of [0, 1]) {
    SS[s].castle = addStatic('castle', s, CASTLE[s].x, CASTLE[s].y, TUNE.castleHp, {r: 38, cd: 0, reach: TUNE.castleReach, dmg: TUNE.castleDmg});
    for (const ry of ROAD) addStatic('tower', s, s ? W - 290 : 290, ry - 26, TUNE.towerHp, {r: 16, cd: 0, reach: TUNE.towerReach, dmg: TUNE.towerDmg});
  }
}

// ---------- 建筑规则：解锁、座数上限、涨价、人口 ----------
function ownedKeys(s) {
  const S = SS[s], F = FACTIONS[S.faction], out = new Set(F.tiers[0]); out.add(F.mine);
  for (const lv in S.picks) for (const k of S.picks[lv]) out.add(k);
  return out;
}
const orderedKeys = s => { const F = FACTIONS[SS[s].faction], o = ownedKeys(s); return [...F.tiers.flat(), F.mine].filter(k => o.has(k)); };
const countB = (s, key) => ents.reduce((n, e) => n + (e.kind === 'bld' && e.side === s && e.key === key && !e.dead ? 1 : 0), 0);
function capOf(s, key) { const b = BUILD[key], M = SS[s].mod; return (b.cap || 3) + (b.mine ? 0 : b.big ? M.bigAdd : M.capAdd); }
const costOf = (s, key) => Math.round(BUILD[key].cost * (1 + TUNE.priceStep * countB(s, key)));
const popCap = s => TUNE.popBase + TUNE.popPerLv * (SS[s].level - 1);
const popUsed = s => ents.reduce((n, e) => n + (e.kind === 'unit' && e.side === s && !e.dead ? (UNITS[e.k].pop || 1) : 0), 0);
const count = s => ents.reduce((n, e) => n + (e.kind === 'unit' && e.side === s && !e.dead ? 1 : 0), 0);

// ---------- 经济 ----------
const dim = x => { let o = 0, f = 1; while (x > 0) { o += Math.min(x, 25) * f; x -= 25; f = Math.max(.2, f - .1); } return o; };
function income(s) {
  const S = SS[s]; let sum = 0, mines = 0;
  for (const cl of CELLS[s]) if (cl.b && !cl.b.dead) { const bd = BUILD[cl.b.key]; if (bd.mine) mines++; else sum += bd.cost * TUNE.costRatio; }
  let a = TUNE.baseIncome + dim(sum) + S.mod.income + TUNE.incomePerLv * (S.level - 1);
  for (let i = 0; i < mines; i++) a += TUNE.mineBase * Math.pow(TUNE.mineDecay, i);
  return a * (s === 1 && !SS[0].auto ? TUNE.aiIncome : 1);
}
function build(s, cell, key) {
  const S = SS[s]; if (cell.b || !ownedKeys(s).has(key) || countB(s, key) >= capOf(s, key)) return false;
  const cost = costOf(s, key); if (S.gold < cost) return false;
  S.gold -= cost;
  cell.b = addStatic('bld', s, cell.x, cell.y, 400, {key, timer: 2, cell, r: 16, bt: TUNE.buildTime, lv: 1, off: false, full: false, paid: cost});
  return true;
}
function upgradeBld(s, e) {
  const bd = BUILD[e.key], S = SS[s]; if (!bd.unit || e.lv >= 3 || e.bt > 0) return false;
  const cost = Math.round(bd.cost * TUNE.upgradeCost[e.lv - 1]); if (S.gold < cost) return false;
  S.gold -= cost; e.lv++; e.paid += cost; ring(e.x, e.y, 22, '#ffd860'); return true;
}
function demolish(s, e) { SS[s].gold += Math.round(e.paid * .5); e.dead = 1; e.cell.b = null; }
function levelUp(s) {
  const S = SS[s]; if (S.level >= 4) return false;
  const cost = TUNE.castleUp[S.level - 1]; if (S.gold < cost) return false;
  S.gold -= cost; S.level++; S.castle.max += TUNE.castleHpPerLv; S.castle.hp += TUNE.castleHpPerLv;
  ring(S.castle.x, S.castle.y, 60, '#ffd860');
  const opts = FACTIONS[S.faction].tiers[S.level - 1];
  if (S.dual > 0) { S.dual--; S.picks[S.level] = opts.slice(); }
  else if (s === 0 && !S.auto) openTier(S.level);
  else S.picks[S.level] = [rnd(opts)];
  return true;
}

// ---------- 单位 ----------
function spawn(bld) {
  const bd = BUILD[bld.key], u = UNITS[bd.unit], s = bld.side, S = SS[s], M = S.mod;
  let n = u.count || 1; if (n > 1) n += M.extra;
  if (popUsed(s) + n * (u.pop || 1) > popCap(s)) { bld.full = true; return false; }
  bld.full = false;
  const lane = bld.y < H / 2 ? 0 : 1, ly = ROAD[lane], dir = s ? -1 : 1, boost = TUNE.upgradeBoost[bld.lv - 1];
  const goal = [CASTLE[1 - s].x - dir * 40, CASTLE[1 - s].y];
  const path = u.fly ? [goal] : [[s ? W - 150 : 150, ly], [s ? 150 : W - 150, ly], goal];
  for (let i = 0; i < n; i++) {
    const hp = u.hp * M.hp * (M.unitHp[bd.unit] || 1) * boost;
    ents.push({kind: 'unit', k: bd.unit, side: s, x: bld.x + dir * 14 + (i - n / 2) * 5, y: bld.y + 8 + i * 4, hp, max: hp, r: 8, boost, path: path.map(p => p.slice()), pi: 0,
      state: 'move', st: 0, face: dir, ph: Math.random() * 6, target: null, dead: 0, mist: 0, mistT: 0, mistBy: 0, dot: 0, auraT: Math.random()});
  }
  return true;
}
function spawnFake(b, ukey) {
  const u = UNITS[ukey], s = b.side, M = SS[s].mod, lane = b.y < H / 2 ? 0 : 1, dir = s ? -1 : 1;
  const goal = [CASTLE[1 - s].x - dir * 40, CASTLE[1 - s].y], hp = u.hp * M.hp * (M.unitHp[ukey] || 1);
  ents.push({kind: 'unit', k: ukey, side: s, x: b.x, y: b.y, hp, max: hp, r: 8, boost: 1, path: [[s ? 150 : W - 150, ROAD[lane]], goal], pi: 0,
    state: 'move', st: 0, face: dir, ph: Math.random() * 6, target: null, dead: 0, mist: 0, mistT: 0, mistBy: 0, dot: 0, auraT: 0});
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
  if (o.kind === 'castle' && !(t > TUNE.overtime)) dmg *= TUNE.castleShield[ents.reduce((n, e) => n + (e.kind === 'tower' && e.side === o.side && e.dead ? 1 : 0), 0)];
  o.hp -= dmg;
  if (dmg >= 3) fx.push({x: o.x + (Math.random() - .5) * 6, y: o.y - 22, txt: Math.round(dmg), life: .6});
  if (mist && o.kind === 'unit') { o.mist = Math.min(TUNE.mistCap + SS[by].mod.mistCap, o.mist + mist); o.mistT = TUNE.mistTime; o.mistBy = by; }
  if (o.hp <= 0) die(o, by);
}
function die(o, by) {
  o.hp = 0; o.dead = 1; o.st = 0;
  const S = SS[o.side];
  if (o.kind === 'unit') {
    SS[by].gold += Math.round(UNITS[o.k].hp / 8 * SS[by].mod.bounty);
    if (UNITS[o.k].dark) clouds.push({x: o.x, y: o.y, side: o.side, life: TUNE.cloudLife * S.mod.cloudT, acc: 0});
  } else if (o.kind === 'bld') { o.cell.b = null; if (sel === o.cell) sel = null; }
  else if (o.kind === 'tower') { SS[by].gold += 80; SS[by].rerolls++; }
  else if (o.kind === 'castle') finish(o.side === 1);
}
const reachOf = e => { const u = UNITS[e.k]; return u.ranged ? u.reach * SS[e.side].mod.range : u.reach * TUNE.reachMul; };
function dmgOf(e, tg) {
  const u = UNITS[e.k], S = SS[e.side], M = S.mod;
  let d = u.dmg * e.boost * M.dmg * (M.unitDmg[e.k] || 1) * (S.roarT > 0 ? 1.3 : 1) * (e.cloud ? 1.15 : 1);
  if (t > TUNE.overtime) d *= 1 + (t - TUNE.overtime) / 90;
  if (tg.kind !== 'unit' && u.siege) d *= u.siege;
  return d;
}
function updUnit(e, dt) {
  const u = UNITS[e.k], S = SS[e.side], M = S.mod;
  e.st += dt;
  if (e.dead) return;
  if (e.mist > 0) {   // 黑气：持续掉血 + 减速
    e.mistT -= dt; if (e.mistT <= 0) e.mist = 0;
    else { e.dot += e.mist * TUNE.mistRate * SS[e.mistBy].mod.mistDot * dt; if (e.dot >= 3) { hurt(e, e.dot, e.mistBy); e.dot = 0; } }
  }
  if (e.dead) return;
  if (u.aura) { e.auraT -= dt; if (e.auraT <= 0) { e.auraT = 1; for (const o of ents) if (o.kind === 'unit' && o.side !== e.side && !o.dead && dist(o, e) < u.aura) hurt(o, 0, e.side, 1); } }
  if (e.state === 'move') {
    const reach = reachOf(e), foe = nearestFoe(e, Math.max(reach + 40, 80));
    if (foe && dist(e, foe) - foe.r <= reach) { e.target = foe; e.state = 'windup'; e.st = 0; e.face = foe.x < e.x ? -1 : 1; return; }
    let tx, ty;
    if (foe) { tx = foe.x; ty = foe.y; }
    else { const p = e.path[e.pi]; tx = p[0]; ty = p[1]; if (Math.hypot(tx - e.x, ty - e.y) < 6 && e.pi < e.path.length - 1) e.pi++; }
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 1;
    const sp = u.speed * TUNE.speedMul * (M.unitSpd[e.k] || 1) * (S.roarT > 0 ? 1.3 : 1) * Math.max(.6, 1 - TUNE.mistSlow * e.mist);
    e.x += dx / d * sp * dt; e.y += dy / d * sp * dt;
    if (Math.abs(dx) > 2) e.face = dx < 0 ? -1 : 1;
    for (const o of ents) if (o !== e && o.kind === 'unit' && !o.dead) {
      const ox = e.x - o.x, oy = e.y - o.y, od = Math.hypot(ox, oy);
      if (od > 0 && od < 12) { e.x += ox / od * .5; e.y += oy / od * .5; }
    }
  } else if (e.state === 'windup' && e.st > .35) {
    const tg = e.target;
    if (tg && !tg.dead) {
      const d = dmgOf(e, tg);
      if (u.shot) shots.push({x: e.x, y: e.y - 14, tg, side: e.side, dmg: d, spd: 220, k: u.shot, mist: u.mist || 0});
      else if (u.boom) {
        ring(e.x, e.y, u.boom, '#a060ff');
        for (const o of ents) if (o.side !== e.side && !o.dead && dist(o, e) - o.r < u.boom) hurt(o, o.kind === 'unit' ? d : d * .6, e.side, u.mist);
        e.hp = 0; e.dead = 1; e.st = 0; return;
      } else hurt(tg, d, e.side, u.mist);
    }
    e.state = 'recover'; e.st = 0;
  } else if (e.state === 'recover' && e.st > u.cd - .35) { e.state = 'move'; e.st = 0; }
}
function updStatic(e, dt) {
  if (e.dead) return;
  const S = SS[e.side];
  if (e.kind === 'bld') {
    if (e.bt > 0) { e.bt -= dt; return; }
    if (e.off || !BUILD[e.key].unit) return;
    e.timer -= dt * (S.hasteT > 0 ? 2 : 1);
    if (e.timer <= 0) e.timer = spawn(e) ? BUILD[e.key].every * S.mod.haste : .5;
  } else {   // 路塔、主堡放箭
    e.cd -= dt;
    if (e.cd <= 0) {
      const f = nearestFoe(e, e.reach);
      if (f && f.kind === 'unit') {
        const m = e.kind === 'castle' ? 1 + TUNE.castleArrowPerLv * (S.level - 1) : 1;
        shots.push({x: e.x, y: e.y - 36, tg: f, side: e.side, dmg: e.dmg * m, spd: 260, k: 'arrow', mist: 0}); e.cd = e.kind === 'castle' ? .8 : 1;
      }
    }
  }
}

// ---------- 技能 ----------
function useSkill(s, i, x, y) {
  const S = SS[s], sk = S.skills[i]; if (!sk || sk.cdT > 0 || sk.uses <= 0) return false;
  const id = sk.id;
  if (id === 's_fire') { ring(x, y, 70, '#ffb040'); for (const o of ents) if (o.side !== s && !o.dead && dist(o, {x, y}) - o.r < 70) hurt(o, 350, s); }
  else if (id === 's_sync') { for (const o of ents) if (o.kind === 'bld' && o.side === s && !o.dead && o.bt <= 0 && !o.off) o.timer = 0; }
  else if (id === 's_reinf') {
    const ly = ROAD[y < H / 2 ? 0 : 1], dir = s ? -1 : 1, key = FACTIONS[S.faction].cheap;
    for (let k = 0; k < 5; k++) spawnFake({x: (s ? W - 150 : 150) + dir * 8 * k, y: ly - 16 + k * 8, side: s}, key);
  }
  else if (id === 's_haste') S.hasteT = 15;
  else if (id === 's_roar') S.roarT = 10;
  else if (id === 's_burst') for (const o of ents) if (o.kind === 'unit' && o.side !== s && !o.dead && o.mist > 0) { const n = o.mist; o.mist = 0; ring(o.x, o.y, 14, '#a060ff'); hurt(o, n * 45, s); }
  sk.uses--; sk.cdT = SKILLS[id].cd;
  return true;
}

// ---------- 卡牌（建筑不再抽，由主堡等级二选一决定；抽卡只出强化 / 技能 / 稀有） ----------
function buildDesc(k) {
  const bd = BUILD[k]; if (bd.mine) return '提高收入（造得越多，每座越少）';
  const u = UNITS[bd.unit];
  return `每 ${bd.every} 秒出${u.count ? u.count + '个' : '1个'}${u.name}，生命 ${u.hp}，伤害 ${u.dmg}，占人口 ${(u.pop || 1) * (u.count || 1)}${u.fly ? '，能飞过大海' : ''}${u.mist ? '，附带黑气' : ''}${u.siege > 1 ? '，对建筑伤害翻倍' : ''}`;
}
function poolFor(s) {
  const S = SS[s], out = [];
  for (const [k, e] of Object.entries(ENH)) if ((!e.f || e.f === S.faction) && !S.taken.has(k))
    out.push({id: 'e:' + k, type: 'enh', tag: e.rare ? '稀有强化' : '强化', name: e.name, desc: e.desc, w: e.rare ? 1 : 3, key: k});
  if (S.skills.length < 2) for (const [k, e] of Object.entries(SKILLS)) if ((!e.f || e.f === S.faction) && !S.skills.some(x => x.id === k))
    out.push({id: 's:' + k, type: 'skill', tag: '主动技能', name: e.name, desc: e.desc, w: 2, key: k});
  return out;
}
function draw3(s) {
  const pool = poolFor(s), out = [];
  while (out.length < 3 && pool.length) {
    let tot = pool.reduce((a, b) => a + b.w, 0), r = Math.random() * tot, i = 0;
    for (; i < pool.length - 1; i++) { r -= pool[i].w; if (r <= 0) break; }
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
function takeCard(s, card) {
  const S = SS[s];
  if (card.type === 'enh') { S.taken.add(card.key); ENH[card.key].ap(S.mod, S); }
  else S.skills.push({id: card.key, uses: SKILLS[card.key].uses, cdT: 0});
}
function showCards(title, cards, onPick, reroll) {
  paused = true; $('pick').style.display = 'flex'; $('pickt').textContent = title; $('picks').innerHTML = '';
  for (const cd of cards) {
    const d = document.createElement('div'); d.className = 'card ' + cd.type;
    d.innerHTML = `<div class="tag">${cd.tag}</div><b>${cd.name}</b><span>${cd.desc}</span>`;
    d.onclick = () => { $('pick').style.display = 'none'; paused = false; onPick(cd); };
    $('picks').appendChild(d);
  }
  const rb = $('reroll');
  if (reroll) { rb.style.display = ''; rb.textContent = `刷新（剩 ${SS[0].rerolls} 次）`; rb.disabled = SS[0].rerolls <= 0; rb.onclick = reroll; } else rb.style.display = 'none';
}
function openDraw(title) {
  const S = SS[0], show = () => {
    const cs = draw3(0);
    if (!cs.length) { paused = false; $('pick').style.display = 'none'; return; }
    showCards(title, cs, cd => { takeCard(0, cd); rebuildBar(); }, () => { S.rerolls--; show(); });
  };
  show();
}
function openTier(lv) {
  const S = SS[0], cards = FACTIONS[S.faction].tiers[lv - 1].map(k => ({type: 'build', tag: `主堡 ${lv} 级 · 二选一`, name: BUILD[k].name, desc: buildDesc(k), key: k}));
  showCards(`主堡升到 ${lv} 级：选一个新兵营（选定后不能再选另一个）`, cards, cd => { S.picks[lv] = [cd.key]; rebuildBar(); });
}
function openRespec() {
  const S = SS[0]; if (S.respec <= 0 || S.gold < TUNE.respecCost) return;
  const cards = [];
  for (let lv = 2; lv <= S.level; lv++) if (S.picks[lv] && S.picks[lv].length === 1) {
    const cur = S.picks[lv][0], other = FACTIONS[S.faction].tiers[lv - 1].find(k => k !== cur);
    cards.push({type: 'enh', tag: `第 ${lv} 级`, name: `${BUILD[cur].name} → ${BUILD[other].name}`, desc: buildDesc(other), lv, other});
  }
  if (!cards.length) return;
  showCards(`换选择（${TUNE.respecCost} 金，每局 1 次）`, cards, cd => { S.gold -= TUNE.respecCost; S.respec--; S.picks[cd.lv] = [cd.other]; rebuildBar(); });
  $('reroll').style.display = '';
  $('reroll').textContent = '取消'; $('reroll').disabled = false; $('reroll').onclick = () => { $('pick').style.display = 'none'; paused = false; };
}

// ---------- 电脑（遵守同样的规则：二选一、座数上限、涨价、人口） ----------
function ai(s, dt) {
  const S = SS[s]; S.aiT -= dt; if (S.aiT > 0) return; S.aiT = 1.2 + Math.random() * 1.5;
  const wantLv = S.level < 4 && t >= TUNE.aiLevelAt[S.level - 1], lvCost = TUNE.castleUp[S.level - 1] || 0;
  if (wantLv && S.gold >= lvCost) { levelUp(s); return; }
  const reserve = wantLv ? lvCost : 0, F = FACTIONS[S.faction];
  const free = CELLS[s].filter(cl => !cl.b), n = CELLS[s].length - free.length;
  const mines = countB(s, F.mine);
  const keys = orderedKeys(s).filter(k => countB(s, k) < capOf(s, k) && costOf(s, k) <= S.gold - reserve && (!BUILD[k].mine || mines < 1 + n / 5));
  if (free.length && keys.length) {
    const bag = []; for (const k of keys) for (let i = 0; i < Math.round(300 / BUILD[k].cost) + 1; i++) bag.push(k);
    build(s, rnd(free), rnd(bag)); S.aiT = .6 + Math.random();
  } else if (S.gold - reserve > 200) {   // 没处造了：升级一座兵营
    const cand = ents.filter(e => e.kind === 'bld' && e.side === s && !e.dead && e.lv < 3 && e.bt <= 0 && BUILD[e.key].unit);
    if (cand.length) upgradeBld(s, rnd(cand));
  }
  S.skills.forEach((sk, i) => { if (Math.random() < .05) useSkill(s, i, W / 2 + (s ? -200 : 200), rnd(ROAD)); });
}

// ---------- 流程 ----------
function finish(win) { over = true; $('msgt').textContent = win ? `胜利！用时 ${fmt(t)}` : `主堡被攻破（${fmt(t)}）`; $('msg').style.display = 'flex'; }
const fmt = x => Math.floor(x / 60) + ':' + String(Math.floor(x % 60)).padStart(2, '0');
function start(fac0, auto) {
  started = true; SS[0].faction = fac0; SS[1].faction = fac0 === 'tribe' ? 'dark' : 'tribe'; SS[0].auto = !!auto;
  setupBase(); $('menu').style.display = 'none'; rebuildBar();
}
function step(dt) {
  if (paused || userPause || over || !started) return;
  t += dt;
  for (const s of [0, 1]) {
    const S = SS[s]; S.gold += income(s) / 10 * dt;
    S.hasteT = Math.max(0, S.hasteT - dt); S.roarT = Math.max(0, S.roarT - dt);
    for (const sk of S.skills) sk.cdT = Math.max(0, sk.cdT - dt);
  }
  for (const s of [1, 0]) {   // 定时抽卡；电脑和自动模式同样每次抽一张
    const S = SS[s];
    if (S.drawn < TUNE.draws.length && t >= TUNE.draws[S.drawn]) {
      S.drawn++;
      if (s === 0 && !S.auto) { openDraw(`第 ${S.drawn} 次抽卡`); return; }
      const cs = draw3(s); if (cs.length) takeCard(s, rnd(cs));
    }
  }
  ai(1, dt); if (SS[0].auto) ai(0, dt);
  if (t > TUNE.overtime) {   // 加时：血量较低的主堡持续崩塌（相同则敌方先倒）
    const w = SS[0].castle.hp < SS[1].castle.hp ? 0 : 1; hurt(SS[w].castle, TUNE.drain * dt, 1 - w);
  }
  for (const e of ents) e.kind === 'unit' ? updUnit(e, dt) : updStatic(e, dt);
  for (const e of ents) if (e.kind === 'unit') e.cloud = false;   // 黑气云
  for (const cl of clouds) {
    cl.life -= dt; cl.acc += dt;
    const tick = cl.acc >= 1; if (tick) cl.acc = 0;
    for (const o of ents) if (o.kind === 'unit' && !o.dead && Math.hypot(o.x - cl.x, o.y - cl.y) < TUNE.cloudR) {
      if (o.side === cl.side) { if (UNITS[o.k].dark) o.cloud = true; } else if (tick) hurt(o, 0, cl.side, 1);
    }
  }
  clouds = clouds.filter(x => x.life > 0);
  for (const p of shots) {
    const dx = p.tg.x - p.x, dy = p.tg.y - 12 - p.y, d = Math.hypot(dx, dy);
    p.a = Math.atan2(dy, dx);
    if (d < 7 || p.tg.dead) { if (!p.tg.dead) hurt(p.tg, p.dmg, p.side, p.mist); p.done = 1; }
    else { p.x += dx / d * p.spd * dt; p.y += dy / d * p.spd * dt; }
  }
  shots = shots.filter(p => !p.done);
  for (const f of fx) { f.life -= dt; if (!f.ring) f.y -= 14 * dt; }
  fx = fx.filter(f => f.life > 0);
  for (const e of ents) if (e.kind === 'unit' && !e.dead && UNITS[e.k].dark && puffs.length < 260 && Math.random() < dt * 2.5)
    puffs.push({x: e.x + (Math.random() - .5) * 10, y: e.y - 8, vx: (Math.random() - .5) * 6, vy: -9 - Math.random() * 9, life: 1.1, max: 1.1});
  for (const p of puffs) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  puffs = puffs.filter(p => p.life > 0);
  ents = ents.filter(e => !(e.kind === 'unit' && e.dead && e.st > 3));
}

// ---------- 画面 ----------
let sc = 1, ox = 0, oy = 0;
function resize() {
  const top = 34, bot = 76, w = innerWidth, h = innerHeight - top - bot;
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
// 按最大宽高等比缩放后，底边中点落在 (x, y)
function drawFit(key, x, y, maxW, maxH, face = 1, tint, alpha = 1) {
  const im = tint ? tinted(key, tint) : IM[key]; if (!im) return;
  const k = Math.min(maxW / im.width, maxH / im.height), w = im.width * k, h = im.height * k;
  c.save(); c.globalAlpha = alpha; c.translate(x, y); c.scale(face, 1); c.drawImage(im, -w / 2, -h, w, h); c.restore();
}
function bar(x, y, w, p, col) { c.fillStyle = '#0009'; c.fillRect(x - w / 2, y, w, 3); c.fillStyle = col; c.fillRect(x - w / 2, y, w * Math.max(0, p), 3); }
function label(txt, x, y, col = '#fff', size = 9) { c.font = `bold ${size}px sans-serif`; c.textAlign = 'center'; c.fillStyle = '#000a'; c.fillText(txt, x + .6, y + .6); c.fillStyle = col; c.fillText(txt, x, y); }
const DARK = 'rgba(50,15,85,.55)';
function draw() {
  c.drawImage(IM.ground, 0, 0, W, H);
  for (const cl of CELLS[0]) {   // 我方建筑格：平时淡淡显示，选了建筑后高亮
    if (cl.b) continue;
    c.strokeStyle = pick ? (cl === hover ? '#fff' : '#ffffffaa') : '#ffffff30'; c.lineWidth = pick ? 1.5 : 1; c.strokeRect(cl.x - 20, cl.y - 20, 40, 40);
  }
  if (sel && sel.b) { c.strokeStyle = '#ffd860'; c.lineWidth = 2; c.strokeRect(sel.x - 22, sel.y - 22, 44, 44); }
  for (const cl of clouds) {
    const a = Math.min(1, cl.life / 2) * .5, g = c.createRadialGradient(cl.x, cl.y, 2, cl.x, cl.y, TUNE.cloudR);
    g.addColorStop(0, `rgba(20,5,40,${a})`); g.addColorStop(1, 'rgba(20,5,40,0)');
    c.fillStyle = g; c.beginPath(); c.arc(cl.x, cl.y, TUNE.cloudR, 0, 7); c.fill();
  }
  const list = ents.filter(e => !(e.dead && e.kind !== 'unit')).sort((a, b) => a.y - b.y);
  for (const e of list) {
    const S = SS[e.side], col = S.color, dark = S.faction === 'dark', tn = dark ? DARK : null;
    if (e.kind === 'castle') {
      drawFit('camp_fence_h', e.x, e.y + 38, 150, 40, 1, tn);
      drawFit('camp_tent_a', e.x, e.y + 18, 140, 112, e.side ? -1 : 1, tn);
      c.fillStyle = col; c.fillRect(e.x - 3, e.y - 64, 18, 10); c.fillRect(e.x - 3, e.y - 64, 2.5, 26);
      label('Lv' + S.level, e.x, e.y + 52, '#ffd860', 11);
      bar(e.x, e.y - 76, 84, e.hp / e.max, col);
    } else if (e.kind === 'tower') {
      drawFit('camp_totem', e.x, e.y + 10, 40, 80, 1, tn);
      c.fillStyle = col; c.beginPath(); c.ellipse(e.x, e.y + 11, 12, 4, 0, 0, 7); c.fill();
      bar(e.x, e.y - 74, 40, e.hp / e.max, col);
    } else if (e.kind === 'bld') {
      const b = BUILD[e.key], building = e.bt > 0;
      c.fillStyle = col + '66'; c.beginPath(); c.ellipse(e.x, e.y + 12, 20, 6, 0, 0, 7); c.fill();
      drawFit(b.spr, e.x, e.y + 14, 50, 62, e.side ? -1 : 1, tn, building ? .45 : 1);
      if (building) { bar(e.x, e.y - 12, 30, 1 - e.bt / TUNE.buildTime, '#ffd860'); label('建造中', e.x, e.y - 16, '#ffd860', 8); }
      else {
        if (e.lv > 1) label('★'.repeat(e.lv - 1), e.x + 14, e.y - 18, '#ffd860', 11);
        if (e.off) label('停产', e.x, e.y - 18, '#ff8a70', 9); else if (e.full) label('满员', e.x, e.y - 18, '#ffb050', 9);
      }
      if (e.hp < e.max) bar(e.x, e.y - 30, 30, e.hp / e.max, col);
    } else {
      const u = UNITS[e.k], [n, f] = unitFrame(e), key = u.spr + '/' + n, im = u.dark ? tinted(key, DARK) : IM[key];
      c.globalAlpha = e.dead ? Math.max(0, 1 - (e.st - 1.5) / 1.5) : 1;
      if (u.dark && !e.dead) { const g = c.createRadialGradient(e.x, e.y - 6, 1, e.x, e.y - 6, 18); g.addColorStop(0, 'rgba(15,0,30,.5)'); g.addColorStop(1, 'rgba(15,0,30,0)'); c.fillStyle = g; c.beginPath(); c.arc(e.x, e.y - 6, 18, 0, 7); c.fill(); }
      c.fillStyle = col; c.beginPath(); c.ellipse(e.x, e.y, 10, 3.5, 0, 0, 7); c.fill();
      const lift = u.fly ? -14 : 0;
      if (im) { c.save(); c.translate(e.x, e.y + lift); c.scale(e.face * U, U); c.drawImage(im, -f.anchor[0], -f.anchor[1], f.size[0], f.size[1]); c.restore(); }
      c.globalAlpha = 1;
      if (!e.dead && (e.hp < e.max || e.mist)) {
        const top = e.y + lift - f.anchor[1] * U - 5; bar(e.x, top, 20, e.hp / e.max, col);
        if (e.mist) label('黑' + e.mist, e.x, top - 3, '#c090ff', 9);
      }
      if (e.boost > 1 && !e.dead) label(e.boost > 1.5 ? '★★' : '★', e.x, e.y + lift - f.anchor[1] * U - 12, '#ffd860', 9);
    }
  }
  for (const p of puffs) { c.globalAlpha = p.life / p.max * .55; c.fillStyle = '#1a0830'; c.beginPath(); c.arc(p.x, p.y, 3.2 * (1.4 - p.life / p.max * .6), 0, 7); c.fill(); }
  c.globalAlpha = 1;
  for (const p of shots) {
    if (p.k === 'fire' && IM.fire) c.drawImage(IM.fire, p.x - 8, p.y - 8, 16, 16);
    else if (p.k === 'rock' && IM.rock) c.drawImage(IM.rock, p.x - 6, p.y - 6, 12, 12);
    else if (p.k === 'dark') { const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, 9); g.addColorStop(0, '#d8a0ff'); g.addColorStop(.4, '#6a30b0'); g.addColorStop(1, 'rgba(20,5,40,0)'); c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, 9, 0, 7); c.fill(); }
    else { const f = EN.gob_archer.frames.arrow, im = IM['gob_archer/arrow']; c.save(); c.translate(p.x, p.y); c.rotate(p.a || 0); if (im) c.drawImage(im, -f.size[0] * .65, -f.size[1] * .65, f.size[0] * 1.3, f.size[1] * 1.3); c.restore(); }
  }
  for (const f of fx) {
    if (f.ring) { c.globalAlpha = f.life / f.max; c.strokeStyle = f.col; c.lineWidth = 3; c.beginPath(); c.arc(f.x, f.y, f.r * (1.1 - f.life / f.max * .4), 0, 7); c.stroke(); c.globalAlpha = 1; }
    else { c.globalAlpha = Math.min(1, f.life * 2); label(f.txt, f.x, f.y, '#fff', 11); c.globalAlpha = 1; }
  }
}

// ---------- 界面 ----------
const barEl = $('bar');
let barSig = '';
const sigNow = () => { const S = SS[0]; return [S.level, [...ownedKeys(0)].join(), S.skills.map(k => k.id).join(), S.respec, sel && sel.b ? sel.b.key + sel.b.lv + sel.b.off : ''].join('|'); };
function mkBtn(cls, onclick, title) { const bt = document.createElement('button'); if (cls) bt.className = cls; bt.onclick = onclick; if (title) bt.title = title; barEl.appendChild(bt); return bt; }
function sepEl() { const sp = document.createElement('div'); sp.className = 'sep'; barEl.appendChild(sp); }
function rebuildBar() {
  barSig = sigNow(); barEl.innerHTML = ''; const S = SS[0];
  const cb = mkBtn('lv', () => { levelUp(0); rebuildBar(); }, '升级主堡：解锁新兵营（二选一），主堡生命 +1000、箭塔伤害 +20%、收入 +5、人口上限 +5'); cb.dataset.act = 'lv';
  if (S.level > 1 && S.respec > 0) { const rb = mkBtn('lv', openRespec, `把某一层的选择换成另一个（${TUNE.respecCost} 金，每局 1 次）`); rb.dataset.act = 'respec'; }
  sepEl();
  for (const k of orderedKeys(0)) {
    const bt = mkBtn('', () => { pick = pick === k ? null : k; targeting = null; sel = null; }, buildDesc(k)); bt.dataset.k = k;
    const b = BUILD[k]; bt.dataset.icon = b.unit ? EN[UNITS[b.unit].spr].frames.idle0.src : `assets/map/sprites/${b.spr}.png`;
  }
  if (S.skills.length) sepEl();
  S.skills.forEach((sk, i) => {
    const d = SKILLS[sk.id], bt = mkBtn('sk', () => { if (sk.cdT > 0 || sk.uses <= 0) return; if (d.target) { targeting = i; pick = null; sel = null; } else useSkill(0, i); }, d.desc); bt.dataset.i = i;
  });
  if (sel && sel.b) {
    sepEl(); const e = sel.b, bd = BUILD[e.key];
    if (bd.unit) { const ub = mkBtn('sel', () => { upgradeBld(0, e); rebuildBar(); }, '升级：这座建筑出的兵生命、伤害 ×1.5（再升一次 ×2）'); ub.dataset.act = 'up'; const tb = mkBtn('sel', () => { e.off = !e.off; rebuildBar(); }, '停产 / 恢复（用来控制兵的组成）'); tb.dataset.act = 'off'; }
    const db = mkBtn('sel', () => { demolish(0, e); sel = null; rebuildBar(); }, '拆除，返还一半花费'); db.dataset.act = 'del';
  }
  if (DEBUG) { const bt = mkBtn('', () => SS[0].gold += 1000); bt.textContent = '+1000 金'; }
}
function setHtml(bt, h) { if (bt._h !== h) { bt._h = h; bt.innerHTML = h; } }
function ui() {
  const S = SS[0]; if (sel && !sel.b) sel = null;
  if (started && barSig !== sigNow()) rebuildBar();
  $('gold').textContent = Math.floor(S.gold); $('inc').textContent = Math.round(income(0));
  $('clock').textContent = fmt(t); $('clock').className = t > TUNE.overtime ? 'ot' : '';
  $('pop').textContent = started ? `${Math.ceil(popUsed(0))}/${popCap(0)}` : '0/30';
  $('ehp').textContent = started ? `我方主堡 ${Math.max(0, Math.round(SS[0].castle.hp))} · 敌方主堡 ${Math.max(0, Math.round(SS[1].castle.hp))}` : '';
  if (!started) return;
  for (const bt of barEl.children) {
    if (bt.dataset.k) {
      const k = bt.dataset.k, b = BUILD[k], n = countB(0, k), cap = capOf(0, k), cost = costOf(0, k);
      setHtml(bt, `<img src="${bt.dataset.icon}">${b.name}<br><small>${n >= cap ? '已满' : cost + ' 金'} · ${n}/${cap}</small>`);
      bt.disabled = n >= cap || S.gold < cost; bt.classList.toggle('on', bt.dataset.k === pick);
    } else if (bt.dataset.act === 'lv') {
      const cost = TUNE.castleUp[S.level - 1];
      setHtml(bt, S.level >= 4 ? `主堡 Lv4<br><small>已满级</small>` : `升级主堡 Lv${S.level}→${S.level + 1}<br><small>${cost} 金</small>`);
      bt.disabled = S.level >= 4 || S.gold < cost;
    } else if (bt.dataset.act === 'respec') { setHtml(bt, `换选择<br><small>${TUNE.respecCost} 金</small>`); bt.disabled = S.gold < TUNE.respecCost; }
    else if (bt.dataset.act === 'up') { const e = sel.b, cost = Math.round(BUILD[e.key].cost * (TUNE.upgradeCost[e.lv - 1] || 0)); setHtml(bt, `升级 ${'★'.repeat(e.lv)}<br><small>${e.lv >= 3 ? '已满级' : cost + ' 金'}</small>`); bt.disabled = e.lv >= 3 || e.bt > 0 || S.gold < cost; }
    else if (bt.dataset.act === 'off') setHtml(bt, `${sel.b.off ? '恢复出兵' : '停产'}<br><small>&nbsp;</small>`);
    else if (bt.dataset.act === 'del') setHtml(bt, `拆除<br><small>返还 ${Math.round(sel.b.paid * .5)} 金</small>`);
    else if (bt.dataset.i != null) {
      const sk = S.skills[bt.dataset.i], d = SKILLS[sk.id];
      setHtml(bt, `${d.name}<br><small>${sk.cdT > 0 ? Math.ceil(sk.cdT) + ' 秒' : sk.uses < 90 ? '剩 ' + sk.uses + ' 次' : '可用'}</small>`);
      bt.disabled = sk.cdT > 0 || sk.uses <= 0; bt.classList.toggle('on', targeting === +bt.dataset.i);
    }
  }
  const next = TUNE.draws[S.drawn];
  $('tip').textContent = targeting != null ? (SKILLS[S.skills[targeting].id].target === 'lane' ? '点上半区或下半区，选一条路' : '点地图选择目标位置')
    : pick ? `点左边空格子放「${BUILD[pick].name}」（上半区走上路，下半区走下路）` : sel ? '已选中一座建筑：可升级、停产、拆除' : (next != null ? `下次抽卡 ${fmt(next)}` : '');
}
function cellAt(ev) {
  const x = (ev.clientX - ox) / sc, y = (ev.clientY - oy) / sc;
  return CELLS[0].find(cl => Math.abs(cl.x - x) < 22 && Math.abs(cl.y - y) < 22);
}
cv.addEventListener('pointermove', ev => hover = cellAt(ev));
cv.addEventListener('pointerdown', ev => {
  if (paused || over || !started) return;
  const x = (ev.clientX - ox) / sc, y = (ev.clientY - oy) / sc;
  if (targeting != null) { if (useSkill(0, targeting, x, y)) targeting = null; return; }
  const cl = cellAt(ev);
  if (pick) { if (cl && !cl.b) build(0, cl, pick); return; }
  sel = cl && cl.b ? cl : null; rebuildBar();
});
addEventListener('keydown', ev => { if (ev.code === 'Space' && started && !over && !paused) { userPause = !userPause; ev.preventDefault(); } });

for (const [k, F] of Object.entries(FACTIONS)) {   // 选阵营
  const d = document.createElement('div'); d.className = `card fac ${k}`;
  d.innerHTML = `<div class="tag">阵营</div><b>${F.name}</b><span>${F.desc}</span>`;
  d.onclick = () => start(k, false); $('facs').appendChild(d);
}
if (AUTO) start(Q.get('f') === 'dark' ? 'dark' : 'tribe', true);

let last = performance.now(), speed = +(Q.get('speed') || 1);
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  for (let i = 0; i < speed; i++) step(dt);
  draw(); ui(); requestAnimationFrame(loop);
}
window.__game = {step, SS, get t() { return t; }, get over() { return over; }, count, popUsed, popCap, ents: () => ents, CELLS, start, levelUp, build, ownedKeys, countB, capOf, costOf};
requestAnimationFrame(loop);
})();
