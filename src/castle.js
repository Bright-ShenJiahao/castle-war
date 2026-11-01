// 城堡战争（试做）：上下两条路、中间是海；造兵营自动出兵，推倒对面主堡获胜
(async () => {
const W = 1200, H = 600, ROAD = [110, 490], DEBUG = location.search.includes('debug');
const cv = document.getElementById('cv'), c = cv.getContext('2d');
const $ = id => document.getElementById(id);

// ---------- 数据 ----------
const EN = await (await fetch('data/enemies.json')).json();
// 兵种（数值为本模式专用，与幸存者模式无关）
const UNITS = {
  gob_blade:  {name: '刀手', hp: 120, dmg: 14, reach: 18, speed: 34, cd: 1.1},
  gob_archer: {name: '弓手', hp: 70,  dmg: 12, reach: 100, speed: 28, cd: 1.4, shot: 'arrow'},
  gob_shield: {name: '盾兵', hp: 240, dmg: 9,  reach: 18, speed: 24, cd: 1.2},
  gob_wolf:   {name: '狼骑', hp: 160, dmg: 16, reach: 20, speed: 52, cd: 1.0},
  gob_shaman: {name: '萨满', hp: 90,  dmg: 22, reach: 90, speed: 26, cd: 1.8, shot: 'fire'},
  gob_troll:  {name: '巨魔', hp: 750, dmg: 45, reach: 30, speed: 16, cd: 2.0},
};
// 建筑：spr=地图素材，s=缩放；unit=出的兵，every=出兵间隔（秒）
const BUILD = {
  blade:  {name: '刀手营', cost: 60,  spr: 'camp_tent_b', s: .5,  unit: 'gob_blade',  every: 10},
  archer: {name: '弓箭架', cost: 80,  spr: 'camp_rack',   s: .62, unit: 'gob_archer', every: 12},
  shield: {name: '战鼓台', cost: 90,  spr: 'camp_drum',   s: .5,  unit: 'gob_shield', every: 12},
  wolf:   {name: '狼窝',   cost: 110, spr: 'camp_bones',  s: .7,  unit: 'gob_wolf',   every: 14},
  shaman: {name: '图腾',   cost: 130, spr: 'camp_totem',  s: .55, unit: 'gob_shaman', every: 16},
  troll:  {name: '巨魔帐', cost: 220, spr: 'camp_tent_a', s: .62, unit: 'gob_troll',  every: 25},
  mine:   {name: '金库',   cost: 100, spr: 'camp_crates', s: .72, mine: 1},
};

// ---------- 素材 ----------
const IM = {};
const load = (k, src) => new Promise(r => { const i = new Image(); i.onload = () => { IM[k] = i; r(); }; i.onerror = r; i.src = src; });
const jobs = [load('ground', 'assets/castle/ground.jpg')];
for (const b of Object.values(BUILD)) jobs.push(load(b.spr, `assets/map/sprites/${b.spr}.png`));
for (const k of ['camp_gate_l', 'camp_gate_r', 'camp_fence_h', 'camp_fire', 'camp_cpost']) jobs.push(load(k, `assets/map/sprites/${k}.png`));
for (const k in UNITS) for (const [f, v] of Object.entries(EN[k].frames)) jobs.push(load(k + '/' + f, v.src));
jobs.push(load('fire', 'assets/characters/enemies/fx/lob_fire.png'));
await Promise.all(jobs);

// ---------- 场地 ----------
// 每方的建筑格：主堡旁两列 + 竖路内侧两列；格子 y<300 的兵走上路，其余走下路
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

let ents = [], shots = [], fx = [], t = 0;
const sides = [
  {gold: 200, mines: 0, color: '#4aa8ff'},
  {gold: 200, mines: 0, color: '#ff5a4a'},
];
function addStatic(kind, side, x, y, hp, extra = {}) {
  const e = Object.assign({kind, side, x, y, hp, max: hp, r: 16, dead: 0}, extra);
  ents.push(e); return e;
}
const CASTLE = [0, 1].map(s => addStatic('castle', s, castleX[s], 300, 3000, {r: 34}));
for (const s of [0, 1]) for (const ry of ROAD) {
  addStatic('tower', s, s ? W - 340 : 340, ry - 30, 1200, {r: 14, cd: 0, reach: 115, dmg: 18});
}

// ---------- 经济 ----------
const income = s => Math.round(30 + Array.from({length: sides[s].mines}, (_, i) => 14 * Math.pow(.82, i)).reduce((a, b) => a + b, 0));
let payTimer = 10;

function build(s, cell, key) {
  const b = BUILD[key];
  if (cell.b || sides[s].gold < b.cost) return false;
  sides[s].gold -= b.cost;
  cell.b = addStatic('bld', s, cell.x, cell.y, 400, {key, timer: 2 + Math.random() * 2, cell, r: 13});
  if (b.mine) sides[s].mines++;
  return true;
}

// ---------- 单位 ----------
function spawn(bld) {
  const k = BUILD[bld.key].unit, u = UNITS[k], s = bld.side;
  const lane = bld.y < 300 ? 0 : 1, ly = ROAD[lane];
  const dir = s ? -1 : 1, vx = s ? W - 130 : 130;
  ents.push({kind: 'unit', k, side: s, x: bld.x + dir * 10, y: bld.y + 6, hp: u.hp, max: u.hp, r: 6,
    path: [[vx, ly], [s ? 130 : W - 130, ly], [castleX[1 - s] + dir * -30, 300]], pi: 0,
    state: 'move', st: 0, face: dir, ph: Math.random() * 6, target: null, dead: 0});
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
function hurt(o, dmg, by) {
  if (o.hp <= 0) return;
  o.hp -= dmg;
  fx.push({x: o.x + (Math.random() - .5) * 6, y: o.y - 18, txt: Math.round(dmg), life: .6});
  if (o.hp <= 0) {
    o.dead = 1; o.st = 0;
    if (o.kind === 'unit') sides[by].gold += Math.round(UNITS[o.k].hp / 8); // 击杀赏金
    if (o.kind === 'bld') { if (BUILD[o.key].mine) sides[o.side].mines--; o.cell.b = null; }
    if (o.kind === 'tower') sides[by].gold += 80;
    if (o.kind === 'castle') end(o.side === 1);
  }
}

function updUnit(e, dt) {
  const u = UNITS[e.k];
  if (e.dead) { e.st += dt; return; }
  e.st += dt;
  if (e.state === 'move') {
    const foe = nearestFoe(e, Math.max(u.reach + 40, 80));
    if (foe && dist(e, foe) - foe.r <= u.reach) { e.target = foe; e.state = 'windup'; e.st = 0; e.face = foe.x < e.x ? -1 : 1; return; }
    let tx, ty;
    if (foe) { tx = foe.x; ty = foe.y; }
    else { const p = e.path[e.pi]; tx = p[0]; ty = p[1]; if (Math.hypot(tx - e.x, ty - e.y) < 6 && e.pi < e.path.length - 1) e.pi++; }
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy) || 1;
    e.x += dx / d * u.speed * dt; e.y += dy / d * u.speed * dt;
    if (Math.abs(dx) > 2) e.face = dx < 0 ? -1 : 1;
    // 轻微互相推开，免得叠成一个点
    for (const o of ents) if (o !== e && o.kind === 'unit' && !o.dead) {
      const ox = e.x - o.x, oy = e.y - o.y, od = Math.hypot(ox, oy);
      if (od > 0 && od < 9) { e.x += ox / od * .4; e.y += oy / od * .4; }
    }
  } else if (e.state === 'windup' && e.st > .35) {
    const tg = e.target;
    if (tg && !tg.dead) {
      if (u.shot) shots.push({x: e.x, y: e.y - 12, tg, side: e.side, dmg: u.dmg, spd: 220, k: u.shot, owner: e.k});
      else hurt(tg, u.dmg, e.side);
    }
    e.state = 'recover'; e.st = 0;
  } else if (e.state === 'recover' && e.st > u.cd - .35) { e.state = 'move'; e.st = 0; }
}

function updStatic(e, dt) {
  if (e.dead) return;
  if (e.kind === 'bld' && BUILD[e.key].unit) { e.timer -= dt; if (e.timer <= 0) { spawn(e); e.timer = BUILD[e.key].every; } }
  if (e.kind === 'tower') {
    e.cd -= dt;
    if (e.cd <= 0) { const f = nearestFoe(e, e.reach); if (f && f.kind === 'unit') { shots.push({x: e.x, y: e.y - 30, tg: f, side: e.side, dmg: e.dmg, spd: 260, k: 'arrow', owner: 'gob_archer'}); e.cd = 1; } }
  }
}

// ---------- 电脑对手 ----------
let aiT = 3;
function ai(dt) {
  aiT -= dt; if (aiT > 0) return; aiT = 2 + Math.random() * 2;
  const s = sides[1], free = CELLS[1].filter(c => !c.b);
  if (!free.length) return;
  const n = CELLS[1].length - free.length;
  let key;
  if (s.mines < 1 + n / 6 && Math.random() < .35) key = 'mine';
  else { const pool = ['blade', 'blade', 'archer', 'shield', 'wolf', 'shaman', 'troll']; key = pool[Math.floor(Math.random() * pool.length)]; }
  if (s.gold >= BUILD[key].cost) build(1, free[Math.floor(Math.random() * free.length)], key);
}

// ---------- 结束 ----------
let over = false;
function end(win) { over = true; $('msgt').textContent = win ? '胜利！' : '主堡被攻破'; $('msg').style.display = 'flex'; }

// ---------- 画面 ----------
let sc = 1, ox = 0, oy = 0;
function resize() {
  const top = 34, bot = 64, w = innerWidth, h = innerHeight - top - bot;
  sc = Math.min(w / W, h / H); const dpr = devicePixelRatio || 1;
  cv.width = Math.round(W * sc * dpr); cv.height = Math.round(H * sc * dpr);
  cv.style.width = W * sc + 'px'; cv.style.height = H * sc + 'px';
  ox = (w - W * sc) / 2; oy = top + (h - H * sc) / 2;
  cv.style.left = ox + 'px'; cv.style.top = oy + 'px';
  c.setTransform(sc * dpr, 0, 0, sc * dpr, 0, 0);
}
addEventListener('resize', resize); resize();

function unitFrame(e) {
  const fr = EN[e.k].frames, nw = EN[e.k].nw || 6;
  let n;
  if (e.dead) n = e.st < .25 ? 'fall' : 'down';
  else if (e.state === 'move') n = 'walk' + (Math.floor(t * 9 + e.ph) % nw);
  else if (e.state === 'windup') n = fr.draw && e.st > .2 ? 'draw' : 'windup';
  else n = e.st < .15 ? 'strike' : (fr.recover ? 'recover' : 'idle0');
  if (!fr[n]) n = 'idle0';
  return [n, fr[n]];
}
function drawSprite(key, x, y, s, face = 1) {
  const im = IM[key]; if (!im) return;
  const w = im.width / 2 * s, h = im.height / 2 * s;
  c.save(); c.translate(x, y); c.scale(face, 1); c.drawImage(im, -w / 2, -h, w, h); c.restore();
}
function bar(x, y, w, p, col) { c.fillStyle = '#0009'; c.fillRect(x - w / 2, y, w, 3); c.fillStyle = col; c.fillRect(x - w / 2, y, w * Math.max(0, p), 3); }

let pick = null, hover = null;
function draw() {
  c.drawImage(IM.ground, 0, 0, W, H);
  // 建筑格
  if (pick) for (const cl of CELLS[0]) if (!cl.b) {
    c.strokeStyle = cl === hover ? '#fff' : '#ffffff66'; c.lineWidth = 1;
    c.strokeRect(cl.x - 17, cl.y - 17, 34, 34);
  }
  const list = ents.filter(e => !(e.dead && e.kind !== 'unit') && !(e.dead && e.st > 3)).sort((a, b) => a.y - b.y);
  for (const e of list) {
    const col = sides[e.side].color;
    if (e.kind === 'castle') {
      drawSprite('camp_fence_h', e.x, e.y + 26, .45);
      drawSprite('camp_tent_a', e.x, e.y + 16, 1.05, e.side ? -1 : 1);
      drawSprite('camp_gate_l', e.x - 30, e.y + 22, .4); drawSprite('camp_gate_r', e.x + 30, e.y + 22, .4);
      c.fillStyle = col; c.fillRect(e.x - 3, e.y - 62, 14, 8); c.fillRect(e.x - 3, e.y - 62, 2, 22);
      bar(e.x, e.y - 72, 70, e.hp / e.max, col);
    } else if (e.kind === 'tower') {
      drawSprite('camp_totem', e.x, e.y + 8, .75);
      c.fillStyle = col; c.beginPath(); c.ellipse(e.x, e.y + 9, 10, 3, 0, 0, 7); c.fill();
      bar(e.x, e.y - 50, 34, e.hp / e.max, col);
    } else if (e.kind === 'bld') {
      const b = BUILD[e.key];
      c.fillStyle = col + '55'; c.beginPath(); c.ellipse(e.x, e.y + 8, 16, 5, 0, 0, 7); c.fill();
      drawSprite(b.spr, e.x, e.y + 10, b.s * .72, e.side ? -1 : 1);
      if (e.hp < e.max) bar(e.x, e.y - 26, 26, e.hp / e.max, col);
    } else {
      const [n, f] = unitFrame(e), im = IM[e.k + '/' + n];
      c.globalAlpha = e.dead ? Math.max(0, 1 - (e.st - 1.5) / 1.5) : 1;
      c.fillStyle = col; c.beginPath(); c.ellipse(e.x, e.y, 7, 2.5, 0, 0, 7); c.fill();
      if (im) { c.save(); c.translate(e.x, e.y); c.scale(e.face, 1); c.drawImage(im, -f.anchor[0], -f.anchor[1], f.size[0], f.size[1]); c.restore(); }
      c.globalAlpha = 1;
      if (!e.dead && e.hp < e.max) bar(e.x, e.y - f.anchor[1] - 5, 16, e.hp / e.max, col);
    }
  }
  for (const p of shots) {
    if (p.k === 'fire') { const im = IM.fire; if (im) c.drawImage(im, p.x - 6, p.y - 6, 12, 12); }
    else { const f = EN.gob_archer.frames.arrow, im = IM['gob_archer/arrow']; c.save(); c.translate(p.x, p.y); c.rotate(p.a || 0); if (im) c.drawImage(im, -f.size[0] / 2, -f.size[1] / 2, f.size[0], f.size[1]); c.restore(); }
  }
  c.font = 'bold 9px sans-serif'; c.textAlign = 'center';
  for (const f of fx) { c.globalAlpha = Math.min(1, f.life * 2); c.fillStyle = '#fff'; c.fillText(f.txt, f.x, f.y); }
  c.globalAlpha = 1;
}

// ---------- 主循环 ----------
let last = performance.now();
function loop(now) {
  let dt = Math.min(.05, (now - last) / 1000); last = now;
  if (!over) {
    t += dt;
    payTimer -= dt;
    if (payTimer <= 0) { payTimer = 10; for (const s of [0, 1]) sides[s].gold += income(s); }
    ai(dt);
    for (const e of ents) e.kind === 'unit' ? updUnit(e, dt) : updStatic(e, dt);
    for (const p of shots) {
      const dx = p.tg.x - p.x, dy = p.tg.y - 10 - p.y, d = Math.hypot(dx, dy);
      p.a = Math.atan2(dy, dx);
      if (d < 6 || p.tg.dead) { if (!p.tg.dead) hurt(p.tg, p.dmg, p.side); p.done = 1; }
      else { p.x += dx / d * p.spd * dt; p.y += dy / d * p.spd * dt; }
    }
    shots = shots.filter(p => !p.done);
    for (const f of fx) { f.life -= dt; f.y -= 14 * dt; }
    fx = fx.filter(f => f.life > 0);
    ents = ents.filter(e => !(e.kind === 'unit' && e.dead && e.st > 3));
  }
  draw(); ui();
  requestAnimationFrame(loop);
}

// ---------- 界面 ----------
const barEl = $('bar');
for (const [k, b] of Object.entries(BUILD)) {
  const bt = document.createElement('button'); bt.dataset.k = k;
  const icon = b.unit ? EN[b.unit].frames.idle0.src : `assets/map/sprites/${b.spr}.png`;
  bt.innerHTML = `<img src="${icon}">${b.name}<br><small>${b.cost} 金</small>`;
  bt.title = b.unit ? `每 ${b.every} 秒出一个${UNITS[b.unit].name}` : '每 10 秒多发金币（越多越少）';
  bt.onclick = () => { pick = pick === k ? null : k; };
  barEl.appendChild(bt);
}
if (DEBUG) { const bt = document.createElement('button'); bt.textContent = '调试 +1000 金'; bt.onclick = () => sides[0].gold += 1000; barEl.appendChild(bt); }
function ui() {
  $('gold').textContent = sides[0].gold; $('inc').textContent = income(0);
  $('ehp').textContent = `我方主堡 ${Math.max(0, CASTLE[0].hp)} · 敌方主堡 ${Math.max(0, CASTLE[1].hp)}`;
  for (const bt of barEl.querySelectorAll('button[data-k]')) {
    bt.classList.toggle('on', bt.dataset.k === pick);
    bt.disabled = sides[0].gold < BUILD[bt.dataset.k].cost;
  }
  $('tip').textContent = pick ? `点左边空格子放「${BUILD[pick].name}」（上半区走上路，下半区走下路）` : '选建筑，再点左边的空格子';
}
function cellAt(ev) {
  const x = (ev.clientX - ox) / sc, y = (ev.clientY - oy) / sc;
  return CELLS[0].find(cl => Math.abs(cl.x - x) < 18 && Math.abs(cl.y - y) < 18);
}
cv.addEventListener('pointermove', ev => hover = cellAt(ev));
cv.addEventListener('pointerdown', ev => {
  const cl = cellAt(ev);
  if (pick && cl && build(0, cl, pick)) { if (sides[0].gold < BUILD[pick].cost) pick = null; }
});

requestAnimationFrame(loop);
})();
