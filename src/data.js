// 城堡战争数据表：兵种、建筑、卡牌、技能、数值。想调平衡只改这个文件。
const DATA = (() => {
const W = 1200, H = 600, ROAD = [110, 490];

const TUNE = {
  castleHp: 7000, towerHp: 2200, towerDmg: 18, towerReach: 115,
  cap: 70,                       // 每方场上兵力上限
  draws: [120, 270, 420],        // 定时抽卡时间（秒）
  overtime: 510,                 // 加时起点：主堡持续掉血、兵越来越疼
  drain: 70,                     // 加时每秒主堡掉血
  startGold: 200, baseIncome: 25, costRatio: 0.05, mineBase: 14, mineDecay: 0.82,
  aiGate: [0, 120, 300],         // 电脑解锁 1/2/3 阶建筑的时间
  aiIncome: 1.0,                 // 电脑收入倍率（难度）
  mistRate: 1.2, mistSlow: 0.03, mistTime: 4, mistCap: 8,
  cloudR: 28, cloudLife: 6,
  castleDmg: 28, castleReach: 150,   // 主堡自己也会放箭
};

// 兵种。spr = enemies.json 里的素材名；dark = 黑气阵营（贴图加暗紫、带黑气粒子）
const UNITS = {
  // —— 绿皮部落 ——
  kid:      {spr: 'gob_kid',     name: '小哥布林', hp: 45,  dmg: 7,  reach: 14, speed: 40, cd: 0.9, count: 2},
  blade:    {spr: 'gob_blade',   name: '刀手',     hp: 120, dmg: 14, reach: 18, speed: 34, cd: 1.1},
  archer:   {spr: 'gob_archer',  name: '弓手',     hp: 70,  dmg: 12, reach: 100, speed: 28, cd: 1.4, shot: 'arrow', ranged: 1},
  shield:   {spr: 'gob_shield',  name: '盾兵',     hp: 240, dmg: 9,  reach: 18, speed: 24, cd: 1.2},
  wolf:     {spr: 'gob_wolf',    name: '狼骑',     hp: 160, dmg: 16, reach: 20, speed: 52, cd: 1.0},
  thrower:  {spr: 'gob_thrower', name: '投石手',   hp: 90,  dmg: 22, reach: 115, speed: 24, cd: 2.0, shot: 'rock', ranged: 1, siege: 2},
  shaman:   {spr: 'gob_shaman',  name: '萨满',     hp: 90,  dmg: 22, reach: 90, speed: 26, cd: 1.8, shot: 'fire', ranged: 1},
  troll:    {spr: 'gob_troll',   name: '巨魔',     hp: 750, dmg: 45, reach: 30, speed: 16, cd: 2.0},
  // —— 黑气教团（哥布林素材 + 代码黑气） ——
  skeleton: {spr: 'skeleton',    name: '骷髅',     hp: 55,  dmg: 8,  reach: 16, speed: 32, cd: 0.9, count: 2, dark: 1, mist: 1},
  shade:    {spr: 'gob_blade',   name: '影刃',     hp: 110, dmg: 13, reach: 18, speed: 36, cd: 1.0, dark: 1, mist: 1},
  ghost:    {spr: 'gob_ghost',   name: '怨灵',     hp: 80,  dmg: 11, reach: 18, speed: 34, cd: 1.0, dark: 1, mist: 2, fly: 1, siege: .5},
  bomb:     {spr: 'gob_bomb',    name: '黑雾炸弹', hp: 40,  dmg: 55, reach: 22, speed: 42, cd: 1.0, dark: 1, mist: 3, boom: 28},
  mage:     {spr: 'gob_mage',    name: '黑魔导',   hp: 75,  dmg: 18, reach: 110, speed: 24, cd: 1.7, dark: 1, mist: 2, shot: 'dark', ranged: 1},
  necro:    {spr: 'gob_necro',   name: '死灵师',   hp: 160, dmg: 16, reach: 90, speed: 21, cd: 1.8, dark: 1, mist: 2, shot: 'dark', ranged: 1, aura: 40},
  giant:    {spr: 'gob_giant',   name: '黑雾巨人', hp: 700, dmg: 42, reach: 30, speed: 17, cd: 2.0, dark: 1, mist: 3, aura: 38},
};

// 建筑：spr=营地素材，s=缩放，tier=阶（影响抽卡/电脑解锁），unit=出的兵，every=出兵间隔
const BUILD = {
  t_kid:     {name: '崽窝',     cost: 50,  tier: 1, unit: 'kid',      every: 9,  spr: 'camp_tent_b', s: .36},
  t_blade:   {name: '刀手营',   cost: 60,  tier: 1, unit: 'blade',    every: 10, spr: 'camp_tent_b', s: .5},
  t_archer:  {name: '弓箭架',   cost: 80,  tier: 1, unit: 'archer',   every: 12, spr: 'camp_rack',   s: .62},
  t_shield:  {name: '战鼓台',   cost: 90,  tier: 2, unit: 'shield',   every: 12, spr: 'camp_drum',   s: .5},
  t_wolf:    {name: '狼窝',     cost: 110, tier: 2, unit: 'wolf',     every: 14, spr: 'camp_bones',  s: .7},
  t_thrower: {name: '投石坑',   cost: 120, tier: 2, unit: 'thrower',  every: 15, spr: 'camp_cpost',  s: .6},
  t_shaman:  {name: '图腾',     cost: 130, tier: 2, unit: 'shaman',   every: 16, spr: 'camp_totem',  s: .55},
  t_troll:   {name: '巨魔帐',   cost: 220, tier: 3, unit: 'troll',    every: 25, spr: 'camp_tent_a', s: .62},
  t_mine:    {name: '赃物堆',   cost: 100, tier: 1, mine: 1,           spr: 'camp_crates', s: .72},
  d_skel:    {name: '骷髅坑',   cost: 50,  tier: 1, unit: 'skeleton', every: 9,  spr: 'camp_bones',  s: .6},
  d_shade:   {name: '影刃营',   cost: 70,  tier: 1, unit: 'shade',    every: 10, spr: 'camp_tent_b', s: .5},
  d_ghost:   {name: '怨灵祭坛', cost: 110, tier: 2, unit: 'ghost',    every: 14, spr: 'camp_totem',  s: .55},
  d_bomb:    {name: '黑雾仓库', cost: 90,  tier: 2, unit: 'bomb',     every: 12, spr: 'camp_crates', s: .6},
  d_mage:    {name: '黑魔塔',   cost: 120, tier: 2, unit: 'mage',     every: 15, spr: 'camp_rack',   s: .62},
  d_necro:   {name: '亡灵法阵', cost: 160, tier: 3, unit: 'necro',    every: 18, spr: 'camp_drum',   s: .5},
  d_giant:   {name: '巨人巢穴', cost: 230, tier: 3, unit: 'giant',    every: 24, spr: 'camp_tent_a', s: .62},
  d_mine:    {name: '祭品火坑', cost: 100, tier: 1, mine: 1,           spr: 'camp_fire',   s: .6},
};

const FACTIONS = {
  tribe: {name: '绿皮部落', desc: '数量与冲锋。小哥布林淹没对手，狼骑、巨魔正面撞开防线。', starters: ['t_blade', 't_mine'], mine: 't_mine', cheap: 'blade',
    build: ['t_kid', 't_blade', 't_archer', 't_shield', 't_wolf', 't_thrower', 't_shaman', 't_troll', 't_mine']},
  dark:  {name: '黑气教团', desc: '黑气层层叠加。攻击会给敌人上黑气（持续掉血、减速），死后留下黑气云；怨灵能飞过大海。', starters: ['d_skel', 'd_mine'], mine: 'd_mine', cheap: 'shade',
    build: ['d_skel', 'd_shade', 'd_ghost', 'd_bomb', 'd_mage', 'd_necro', 'd_giant', 'd_mine']},
};

// 强化卡：ap(M) 修改这一方的全局修正 M
const ENH = {
  e_income: {name: '税收',     desc: '每 10 秒收入 +10',            ap: M => M.income += 10},
  e_haste:  {name: '急行军',   desc: '所有兵营出兵间隔 -15%',       ap: M => M.haste *= .85},
  e_hp:     {name: '厚皮',     desc: '所有兵生命 +15%',             ap: M => M.hp *= 1.15},
  e_dmg:    {name: '锋利',     desc: '所有兵伤害 +15%',             ap: M => M.dmg *= 1.15},
  e_range:  {name: '远射',     desc: '远程兵射程 +20%',             ap: M => M.range *= 1.2},
  e_bounty: {name: '战利品',   desc: '击杀赏金 +50%',               ap: M => M.bounty *= 1.5},
  e_wall:   {name: '加固',     desc: '主堡生命 +800 并回复 800',     ap: (M, S) => { S.castle.max += 800; S.castle.hp += 800; }},
  e_cash:   {name: '军饷',     desc: '立刻获得 180 金币',            ap: (M, S) => S.gold += 180},
  e_swarm:  {f: 'tribe', name: '崽群',   desc: '出 2 个兵的兵营每次多出 1 个', ap: M => M.extra += 1},
  e_charge: {f: 'tribe', name: '冲锋号', desc: '狼骑移速 +25%，伤害 +20%',    ap: M => { M.unitSpd.wolf = 1.25; M.unitDmg.wolf = 1.2; }},
  e_troll:  {f: 'tribe', name: '血怒',   desc: '巨魔生命 +40%',               ap: M => M.unitHp.troll = 1.4},
  e_mist:   {f: 'dark',  name: '浓雾',   desc: '黑气持续伤害 +50%',           ap: M => M.mistDot *= 1.5},
  e_cloud:  {f: 'dark',  name: '怨魂',   desc: '黑气云持续时间翻倍',           ap: M => M.cloudT *= 2},
  e_abyss:  {f: 'dark',  name: '深渊',   desc: '黑气层数上限 +4',             ap: M => M.mistCap += 4},
};

// 主动技能：target = point（点地图）/ lane（点上半或下半）/ null；uses=每局次数；cd=冷却秒
const SKILLS = {
  s_fire:  {name: '烟花',     desc: '指定范围内敌兵受 350 点伤害（每局 1 次）',           uses: 1, cd: 0,  target: 'point'},
  s_sync:  {name: '同步',     desc: '我方所有兵营立刻出一轮兵（每局 2 次）',               uses: 2, cd: 0,  target: null},
  s_reinf: {name: '增援',     desc: '在指定一条路上空投 5 个兵（冷却 45 秒）',             uses: 99, cd: 45, target: 'lane'},
  s_haste: {name: '狂热',     desc: '15 秒内我方兵营出兵速度 ×2（冷却 60 秒）',            uses: 99, cd: 60, target: null},
  s_roar:  {f: 'tribe', name: '战吼',     desc: '10 秒内我方兵移速、伤害 +30%（冷却 50 秒）', uses: 99, cd: 50, target: null},
  s_burst: {f: 'dark',  name: '黑气爆发', desc: '引爆全场敌兵身上的黑气，每层 45 点伤害（冷却 40 秒）', uses: 99, cd: 40, target: null},
};

return {W, H, ROAD, TUNE, UNITS, BUILD, FACTIONS, ENH, SKILLS};
})();
