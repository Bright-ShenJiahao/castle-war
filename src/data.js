// 城堡战争数据表：兵种、建筑、主堡等级、卡牌、技能、数值。想调平衡只改这个文件。
const DATA = (() => {
const W = 960, H = 540, ROAD = [88, 452];          // 逻辑画布 16:9（HD×2 = 1920×1080）
const CASTLE = [{x: 80, y: 270}, {x: W - 80, y: 270}];

// 每方 14 个建筑格（上半 7 个走上路，下半 7 个走下路），敌方水平镜像
const CELLS_UP = [[40, 150], [84, 150], [128, 150], [172, 150], [216, 150], [194, 200], [238, 200]];

const TUNE = {
  castleHp: 10000, towerHp: 3600, towerDmg: 18, towerReach: 115, castleDmg: 36, castleReach: 150,
  castleShield: [0.3, 0.65, 1],      // 主堡受伤倍率：己方路塔都在 / 倒 1 座 / 倒 2 座
  startGold: 200, baseIncome: 35, costRatio: 0.05, mineBase: 14, mineDecay: 0.82,
  castleUp: [150, 300, 500],         // 主堡 1→2→3→4 的升级费用
  castleHpPerLv: 1000, castleArrowPerLv: 0.2, incomePerLv: 5,
  popBase: 30, popPerLv: 5,          // 人口上限 = 30 + 5×(等级-1)
  priceStep: 0.3,                    // 同种建筑每多一座，造价 +30%
  buildTime: 8,                      // 建造时间（秒），期间不出兵
  upgradeCost: [1.5, 2.5], upgradeBoost: [1, 1.5, 2], // 建筑升到★/★★ 花造价×1.5 / ×2.5，出的兵生命、伤害 ×1.5 / ×2
  respecCost: 150,                   // "换选择"费用（每局 1 次）
  draws: [120, 270, 420],            // 定时抽卡（秒）
  overtime: 570,                     // 加时起点 9:30：血量较低的主堡持续崩塌
  drain: 70,
  speedMul: 0.75, reachMul: 1.35,    // 画面放大后，兵移速放慢、近战触及放大
  aiLevelAt: [100, 240, 400],        // 电脑升主堡的目标时间
  aiIncome: 1.0,
  mistRate: 0.6, mistSlow: 0.02, mistTime: 3, mistCap: 6, cloudR: 28, cloudLife: 6,
};

// 兵种。spr = enemies.json 素材名；dark = 黑气阵营；pop = 占用人口（默认 1）
const UNITS = {
  // —— 绿皮部落 ——
  kid:      {spr: 'gob_kid',     name: '小哥布林', hp: 45,  dmg: 7,  reach: 14, speed: 40, cd: 0.9, count: 2, pop: 0.5},
  blade:    {spr: 'gob_blade',   name: '刀手',     hp: 120, dmg: 14, reach: 18, speed: 34, cd: 1.1},
  archer:   {spr: 'gob_archer',  name: '弓手',     hp: 70,  dmg: 12, reach: 100, speed: 28, cd: 1.4, shot: 'arrow', ranged: 1},
  shield:   {spr: 'gob_shield',  name: '盾兵',     hp: 240, dmg: 9,  reach: 18, speed: 24, cd: 1.2},
  wolf:     {spr: 'gob_wolf',    name: '狼骑',     hp: 160, dmg: 16, reach: 20, speed: 52, cd: 1.0, pop: 2},
  thrower:  {spr: 'gob_thrower', name: '投石手',   hp: 90,  dmg: 22, reach: 115, speed: 24, cd: 2.0, shot: 'rock', ranged: 1, siege: 2, pop: 2},
  shaman:   {spr: 'gob_shaman',  name: '萨满',     hp: 90,  dmg: 22, reach: 90, speed: 26, cd: 1.8, shot: 'fire', ranged: 1, pop: 2},
  troll:    {spr: 'gob_troll',   name: '巨魔',     hp: 750, dmg: 45, reach: 30, speed: 16, cd: 2.0, pop: 4},
  // —— 黑气教团（哥布林素材 + 代码黑气） ——
  skeleton: {spr: 'skeleton',    name: '骷髅',     hp: 50,  dmg: 7,  reach: 16, speed: 32, cd: 0.9, count: 2, pop: 0.5, dark: 1, mist: 1},
  shade:    {spr: 'gob_blade',   name: '影刃',     hp: 100, dmg: 12, reach: 18, speed: 36, cd: 1.0, dark: 1, mist: 1},
  ghost:    {spr: 'gob_ghost',   name: '怨灵',     hp: 80,  dmg: 11, reach: 18, speed: 34, cd: 1.0, dark: 1, mist: 2, fly: 1, siege: .35},
  bomb:     {spr: 'gob_bomb',    name: '黑雾炸弹', hp: 40,  dmg: 55, reach: 22, speed: 42, cd: 1.0, dark: 1, mist: 3, boom: 28},
  mage:     {spr: 'gob_mage',    name: '黑魔导',   hp: 75,  dmg: 18, reach: 110, speed: 24, cd: 1.7, dark: 1, mist: 2, shot: 'dark', ranged: 1},
  necro:    {spr: 'gob_necro',   name: '死灵师',   hp: 160, dmg: 16, reach: 90, speed: 21, cd: 1.8, dark: 1, mist: 2, shot: 'dark', ranged: 1, aura: 40, pop: 2},
  giant:    {spr: 'gob_giant',   name: '黑雾巨人', hp: 700, dmg: 42, reach: 30, speed: 17, cd: 2.0, dark: 1, mist: 3, aura: 38, pop: 4},
  golem:    {spr: 'gob_rock',    name: '黑雾石魔', hp: 650, dmg: 38, reach: 24, speed: 15, cd: 1.8, dark: 1, mist: 3, pop: 4},
};

// 建筑：spr=营地素材，cap=最多几座（默认 3），big=大怪兵营（受"大怪上限"卡影响）
const BUILD = {
  t_kid:     {name: '崽窝',     cost: 50,  unit: 'kid',      every: 9,  spr: 'camp_tent_b'},
  t_blade:   {name: '刀手营',   cost: 60,  unit: 'blade',    every: 10, spr: 'camp_tent_b'},
  t_archer:  {name: '弓箭架',   cost: 80,  unit: 'archer',   every: 12, spr: 'camp_rack'},
  t_shield:  {name: '战鼓台',   cost: 90,  unit: 'shield',   every: 12, spr: 'camp_drum'},
  t_wolf:    {name: '狼窝',     cost: 110, unit: 'wolf',     every: 14, spr: 'camp_bones'},
  t_thrower: {name: '投石坑',   cost: 120, unit: 'thrower',  every: 15, spr: 'camp_cpost'},
  t_shaman:  {name: '图腾',     cost: 130, unit: 'shaman',   every: 16, spr: 'camp_totem'},
  t_troll:   {name: '巨魔帐',   cost: 220, unit: 'troll',    every: 25, spr: 'camp_tent_a', cap: 1, big: 1},
  t_mine:    {name: '赃物堆',   cost: 100, mine: 1, cap: 2,           spr: 'camp_crates'},
  d_skel:    {name: '骷髅坑',   cost: 50,  unit: 'skeleton', every: 9,  spr: 'camp_bones'},
  d_shade:   {name: '影刃营',   cost: 70,  unit: 'shade',    every: 10, spr: 'camp_tent_b'},
  d_ghost:   {name: '怨灵祭坛', cost: 110, unit: 'ghost',    every: 14, spr: 'camp_totem'},
  d_bomb:    {name: '黑雾仓库', cost: 90,  unit: 'bomb',     every: 12, spr: 'camp_crates'},
  d_mage:    {name: '黑魔塔',   cost: 120, unit: 'mage',     every: 15, spr: 'camp_rack'},
  d_necro:   {name: '亡灵法阵', cost: 160, unit: 'necro',    every: 18, spr: 'camp_drum'},
  d_giant:   {name: '巨人巢穴', cost: 230, unit: 'giant',    every: 24, spr: 'camp_tent_a', cap: 1, big: 1},
  d_golem:   {name: '石魔洞穴', cost: 210, unit: 'golem',    every: 22, spr: 'camp_cpost',  cap: 1, big: 1},
  d_mine:    {name: '祭品火坑', cost: 100, mine: 1, cap: 2,           spr: 'camp_fire'},
};

// 阵营：tiers[0] 是 1 级就给的（两个都给）；之后每升一级二选一
const FACTIONS = {
  tribe: {name: '绿皮部落', desc: '数量与冲锋。小哥布林淹没对手，狼骑、巨魔正面撞开防线。', mine: 't_mine', cheap: 'blade',
    tiers: [['t_blade', 't_kid'], ['t_archer', 't_thrower'], ['t_shield', 't_wolf'], ['t_shaman', 't_troll']]},
  dark:  {name: '黑气教团', desc: '黑气层层叠加。攻击会给敌人上黑气（持续掉血、减速），死后留下黑气云；怨灵能飞过大海。', mine: 'd_mine', cheap: 'shade',
    tiers: [['d_shade', 'd_skel'], ['d_ghost', 'd_bomb'], ['d_mage', 'd_necro'], ['d_giant', 'd_golem']]},
};

// 强化卡：ap(M, S) 修改这一方的全局修正 M / 状态 S；rare = 稀有（出现概率低）
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
  r_dual:   {rare: 1, name: '两全其美', desc: '下一次升主堡的二选一，两个兵营都解锁', ap: (M, S) => S.dual++},
  r_cap:    {rare: 1, name: '扩建',     desc: '所有普通兵营的座数上限 +1',          ap: M => M.capAdd += 1},
  r_big:    {rare: 1, name: '大怪工坊', desc: '大怪兵营的座数上限 +1',              ap: M => M.bigAdd += 1},
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

return {W, H, ROAD, CASTLE, CELLS_UP, TUNE, UNITS, BUILD, FACTIONS, ENH, SKILLS};
})();
