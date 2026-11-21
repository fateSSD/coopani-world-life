/**
 * 三期生活层纯函数域：
 *   1. 芦花塘公共时间轴与二十四节气物价（§4.19）
 *   2. 八大领域经验、培训课、设备与轻载具、五档完成度定价（§4.5 / §4.10 / §4.15）
 *   3. 日有所思的「梦境切片」与深夜静谧态（§3.2）
 */

export type SkillDomain =
  | 'cooking'
  | 'photo'
  | 'writing'
  | 'craft'
  | 'labor'
  | 'social'
  | 'admin'
  | 'driving';

export const SKILL_DOMAIN_LABEL: Record<SkillDomain, string> = {
  cooking: '烹饪',
  photo: '影像',
  writing: '文字',
  craft: '手作',
  labor: '体力',
  social: '交际',
  admin: '办事',
  driving: '驾驶',
};

export interface TrainCourse {
  id: string;
  domain: SkillDomain;
  name: string;
  price: number;
  energyCost: number;
  expGain: number;
  knowGain: number;
  note: string;
}

export const TRAIN_COURSES: readonly TrainCourse[] = [
  { id: 'course-cooking', domain: 'cooking', name: '家常菜与火候班', price: 120, energyCost: 15, expGain: 12, knowGain: 3, note: '学调火候与备料，做饭与厨艺活不容易糊锅' },
  { id: 'course-photo', domain: 'photo', name: '街拍构图与光影课', price: 180, energyCost: 15, expGain: 12, knowGain: 4, note: '少出废片，接拍照或修图单容易出好评' },
  { id: 'course-writing', domain: 'writing', name: '实用文案与编辑课', price: 140, energyCost: 15, expGain: 12, knowGain: 5, note: '改稿更稳，写字与办公文员单报酬更稳' },
  { id: 'course-craft', domain: 'craft', name: '居家修补与手工课', price: 100, energyCost: 15, expGain: 12, knowGain: 3, note: '做手工与保洁整理更麻利，不易伤手' },
  { id: 'course-labor', domain: 'labor', name: '省力搬运与护腰课', price: 80, energyCost: 12, expGain: 12, knowGain: 2, note: '干重活懂得发力借力，体力流得慢一点' },
  { id: 'course-social', domain: 'social', name: '待人接物与照料课', price: 150, energyCost: 15, expGain: 12, knowGain: 4, note: '照料老人、接待客户更顺手' },
  { id: 'course-admin', domain: 'admin', name: '办公表格与账务课', price: 200, energyCost: 15, expGain: 12, knowGain: 6, note: '表格记账更有条理，减免返工' },
  { id: 'course-driving', domain: 'driving', name: '安全路况与跑单课', price: 220, energyCost: 15, expGain: 12, knowGain: 4, note: '认路规划更快，跑单接驾不易超时差评' },
];

export interface EquipDef {
  id: string;
  name: string;
  kind: 'tool' | 'vehicle';
  price: number;
  note: string;
}

export const EQUIP_CATALOG: readonly EquipDef[] = [
  { id: 'oven', name: '家用小烤箱', kind: 'tool', price: 600, note: '能在家里烤点心、做烘焙手艺' },
  { id: 'sewing', name: '老式缝纫机', kind: 'tool', price: 500, note: '缝补改衣与布艺手作的工具' },
  { id: 'camera', name: '二手胶片微单', kind: 'tool', price: 800, note: '接街拍、印明信片与活动跟拍' },
  { id: 'computer', name: '二手笔记本电脑', kind: 'tool', price: 3000, note: '线上修图、文案排版与远程做账' },
  { id: 'folding_bike', name: '折叠自行车', kind: 'vehicle', price: 400, note: '夜间跑代驾的随身代步车（需驾照）' },
  { id: 'ebike', name: '二手电动车', kind: 'vehicle', price: 2500, note: '跑平台送外卖或片区送快递的吃饭家伙' },
];

export function findCourse(q: string): TrainCourse | null {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return null;
  return TRAIN_COURSES.find((c) =>
    c.id === s
    || c.domain === s
    || SKILL_DOMAIN_LABEL[c.domain] === q.trim()
    || c.name.includes(q.trim()),
  ) ?? null;
}

export function findEquip(q: string): EquipDef | null {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return null;
  return EQUIP_CATALOG.find((e) => e.id === s || e.name.toLowerCase().includes(s)) ?? null;
}

/* ------------------------------------------------------------------ */
/* 五档完成度定价（§4.10）                                             */
/* ------------------------------------------------------------------ */

export type WorkGradeId = 'smash' | 'passable' | 'decent' | 'good' | 'brilliant';

export interface WorkGradeResult {
  grade: WorkGradeId;
  label: string;
  mult: number;
  text: string;
}

const GRADE_TABLE: Record<WorkGradeId, { label: string; mult: number }> = {
  smash: { label: '砸了', mult: 0.3 },
  passable: { label: '凑合', mult: 0.6 },
  decent: { label: '过得去', mult: 0.9 },
  good: { label: '不错', mult: 1.2 },
  brilliant: { label: '漂亮', mult: 1.6 },
};

/**
 * 依据领域经验、培训次数与当下身心状态算出这一班的五档完成度。
 * `roll` 仅用于确定性测试；线上由真实随机数抽样。
 */
export function rollWorkGrade(opts: {
  domainExp: number;
  trainedCount: number;
  energy: number;
  hasBadCond: boolean;
  hasHangover: boolean;
  hasBadMood: boolean;
  hasGoodMood: boolean;
  hasFreshVeg?: boolean;
  domain?: SkillDomain;
  jobName: string;
  roll?: number;
}): WorkGradeResult {
  const r = typeof opts.roll === 'number' && Number.isFinite(opts.roll) ? opts.roll : Math.random();
  let score = 0.5 + (Math.min(100, Math.max(0, opts.domainExp)) / 100) * 0.38;
  score += Math.min(3, opts.trainedCount) * 0.08;
  if (opts.energy < 25) score -= 0.25;
  if (opts.hasBadCond) score -= 0.16;
  if (opts.hasHangover) score -= 0.35;
  if (opts.hasBadMood) score -= 0.12;
  if (opts.hasGoodMood) score += 0.14;
  if (opts.hasFreshVeg && opts.domain === 'cooking') score += 0.14;

  /* 从随机抖动与实力线叠加出五档（熟练+培训后几乎不再砸锅，新手有失手亏本风险）。 */
  const adj = score + (r - 0.5) * 0.65;
  let grade: WorkGradeId;
  if (adj < 0.32) grade = 'smash';
  else if (adj < 0.52) grade = 'passable';
  else if (adj < 0.78) grade = 'decent';
  else if (adj < 1.02) grade = 'good';
  else grade = 'brilliant';

  const row = GRADE_TABLE[grade];
  const textByGrade: Record<WorkGradeId, string> = {
    smash: `今天这趟「${opts.jobName}」出了岔子，返工了大半，只拿回很少一点钱`,
    passable: `今天这趟「${opts.jobName}」算勉强交了差，人家挑了几句毛病`,
    decent: `今天这趟「${opts.jobName}」顺顺当当地做完了，该拿多少拿多少`,
    good: `今天这趟「${opts.jobName}」干得不错，对方挺满意，多给了点赏钱`,
    brilliant: `今天这趟「${opts.jobName}」干得特别漂亮，人家夸完问下次还能不能再找你`,
  };
  return { grade, label: row.label, mult: row.mult, text: textByGrade[grade] };
}

/* ------------------------------------------------------------------ */
/* 二十四节气与芦花塘公共时间轴（§4.19）                                */
/* ------------------------------------------------------------------ */

export interface SolarTermInfo {
  name: string;
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  note: string;
}

const SOLAR_TERMS: readonly { mmdd: number; name: string; season: SolarTermInfo['season']; note: string }[] = [
  { mmdd: 105, name: '小寒', season: 'winter', note: '天冷风硬，屋里炖锅热汤最舒坦' },
  { mmdd: 120, name: '大寒', season: 'winter', note: '一年里最冷的几天，早市热豆浆摊前排着队' },
  { mmdd: 204, name: '立春', season: 'spring', note: '河冰微融，早市上开始冒出头茬春菜' },
  { mmdd: 219, name: '雨水', season: 'spring', note: '湿润润的风，塘边柳条透了绿意' },
  { mmdd: 306, name: '惊蛰', season: 'spring', note: '春雷响过，菜摊上摆出嫩绿的香椿芽' },
  { mmdd: 321, name: '春分', season: 'spring', note: '昼夜平分，青团铺子门前飘着艾草香' },
  { mmdd: 405, name: '清明', season: 'spring', note: '雨丝细密，早市街卖着新采的明前茶' },
  { mmdd: 420, name: '谷雨', season: 'spring', note: '春末雨足，嫩蚕豆和竹笋最鲜' },
  { mmdd: 506, name: '立夏', season: 'summer', note: '天渐暖和，灶前巷支起凉粉小摊' },
  { mmdd: 521, name: '小满', season: 'summer', note: '夏水渐丰，新摘的杨梅与蚕豆上了市' },
  { mmdd: 606, name: '芒种', season: 'summer', note: '梅子黄了，正适合熬一罐酸甜青梅酱' },
  { mmdd: 621, name: '夏至', season: 'summer', note: '白昼最长，傍晚望水坡乘凉的人到九点还不散' },
  { mmdd: 707, name: '小暑', season: 'summer', note: '热浪起来了，冰镇绿豆汤最抢手' },
  { mmdd: 723, name: '大暑', season: 'summer', note: '三伏盛夏，午后街上静悄悄的' },
  { mmdd: 808, name: '立秋', season: 'autumn', note: '早晚有了凉意，秋茄和新莲藕脆生生的' },
  { mmdd: 823, name: '处暑', season: 'autumn', note: '暑气渐收，傍晚云彩常染成橘子色' },
  { mmdd: 908, name: '白露', season: 'autumn', note: '清晨草尖挂着露水，早市板栗刚炒好' },
  { mmdd: 923, name: '秋分', season: 'autumn', note: '塘边芦花开始抽出白穗，桂花也开了' },
  { mmdd: 1008, name: '寒露', season: 'autumn', note: '夜露渐重，糖炒栗子和桂花糖藕摆上摊头' },
  { mmdd: 1023, name: '霜降', season: 'autumn', note: '秋意深了，早晚添件薄外套正好' },
  { mmdd: 1107, name: '立冬', season: 'winter', note: '塘风转凉，灶前巷晚市熬上了萝卜羊汤' },
  { mmdd: 1122, name: '小雪', season: 'winter', note: '初冬微寒，烤红薯炉子在街角冒白烟' },
  { mmdd: 1207, name: '大雪', season: 'winter', note: '夜长昼短，早睡最养神' },
  { mmdd: 1222, name: '冬至', season: 'winter', note: '家家都在剁饺子馅，热气能暖透整条灶前巷' },
];

export function solarTermOf(now: Date): SolarTermInfo {
  const mmdd = (now.getMonth() + 1) * 100 + now.getDate();
  let cur = SOLAR_TERMS[SOLAR_TERMS.length - 1];
  for (const t of SOLAR_TERMS) {
    if (mmdd >= t.mmdd) cur = t;
  }
  return { name: cur.name, season: cur.season, note: cur.note };
}

export interface StreetWindow {
  id: 'morning-market' | 'night-clearance' | 'weekend-flea';
  street: string;
  place: string;
  label: string;
  hint: string;
  discount: number;
}

export function streetWindowOf(now: Date): StreetWindow | null {
  const h = now.getHours() + now.getMinutes() / 60;
  const day = now.getDay();
  if (h >= 6 && h < 9.5) {
    return { id: 'morning-market', street: '早市街', place: '早市街', label: '晨集', hint: '鲜菜早点 8 折', discount: 0.8 };
  }
  if (h >= 19.5 && h < 21.5) {
    return { id: 'night-clearance', street: '灶前巷', place: '灶前巷', label: '尾货市', hint: '熟食点心半价', discount: 0.5 };
  }
  if ((day === 0 || day === 6) && h >= 18 && h < 22) {
    return { id: 'weekend-flea', street: '望水坡', place: '望水坡', label: '周末旧货集与夜唱', hint: '有旧货和小物件摆出来', discount: 1 };
  }
  return null;
}

export interface MarketItem {
  item: string;
  price: number;
  unit: string;
  tag?: string;
  foodGain?: number;
  funGain?: number;
  freshVeg?: boolean;
  discounted?: boolean;
}

/**
 * 芦花塘本地确定性物价表（融合 §4.19 日内街巷折扣 + 二十四节气时令货 + 周末旧货集）。
 */
export function marketCatalogOf(now: Date, localDate: string): MarketItem[] {
  let h = 0;
  for (let i = 0; i < localDate.length; i++) h = (h * 33 + localDate.charCodeAt(i)) >>> 0;
  const delta = (offset: number) => ((h + offset) % 5) - 2;

  const term = solarTermOf(now);
  const win = streetWindowOf(now);
  const vegDisc = win?.id === 'morning-market' ? win.discount : 1;
  const cookedDisc = win?.id === 'night-clearance' ? win.discount : 1;

  const seasonalBySeason: Record<SolarTermInfo['season'], { item: string; base: number; unit: string; food: number; fun: number }> = {
    spring: { item: '香椿青团', base: 10, unit: '盒', food: 26, fun: 10 },
    summer: { item: '冰镇绿豆汤', base: 8, unit: '碗', food: 22, fun: 12 },
    autumn: { item: '桂花糖藕配栗子', base: 12, unit: '份', food: 30, fun: 10 },
    winter: { item: '炭烤红薯', base: 9, unit: '个', food: 28, fun: 10 },
  };
  const sea = seasonalBySeason[term.season];

  const list: MarketItem[] = [
    {
      item: '青菜豆腐',
      price: Math.max(3, Math.round((7 + delta(1)) * vegDisc)),
      unit: '一份',
      tag: win?.id === 'morning-market' ? '晨集8折·带露水' : '生鲜',
      foodGain: 28,
      funGain: 6,
      freshVeg: win?.id === 'morning-market',
      discounted: win?.id === 'morning-market',
    },
    {
      item: '番茄鸡蛋面料',
      price: Math.max(4, Math.round((10 + delta(2)) * vegDisc)),
      unit: '一份',
      tag: win?.id === 'morning-market' ? '晨集8折' : '生鲜',
      foodGain: 30,
      funGain: 6,
      freshVeg: win?.id === 'morning-market',
      discounted: win?.id === 'morning-market',
    },
    {
      item: '小鱼干配菜',
      price: Math.max(4, Math.round((12 + delta(3)) * cookedDisc)),
      unit: '一份',
      tag: win?.id === 'night-clearance' ? '尾货半价' : '熟食',
      foodGain: 32,
      funGain: 8,
      discounted: win?.id === 'night-clearance',
    },
    {
      item: sea.item,
      price: Math.max(4, Math.round((sea.base + delta(4)) * (win?.id === 'night-clearance' ? 0.5 : 1))),
      unit: sea.unit,
      tag: `${term.name}时令${win?.id === 'night-clearance' ? '·尾货半价' : ''}`,
      foodGain: sea.food,
      funGain: sea.fun,
      discounted: win?.id === 'night-clearance',
    },
  ];

  if (win?.id === 'night-clearance') {
    list.push({
      item: '酱卤豆干拼盘',
      price: 6,
      unit: '半价袋',
      tag: '灶前巷尾货',
      foodGain: 34,
      funGain: 10,
      discounted: true,
    });
  }
  if (win?.id === 'weekend-flea') {
    list.push(
      { item: '旧磁带随身听小带', price: 14, unit: '盘', tag: '周末旧货集', foodGain: 0, funGain: 26 },
      { item: '街口扭蛋机盲盒', price: 5, unit: '颗', tag: '周末集市', foodGain: 0, funGain: 20 },
    );
  }
  return list;
}

/* ------------------------------------------------------------------ */
/* 睡眠梦境切片与深夜静谧态（§3.2）                                    */
/* ------------------------------------------------------------------ */

export function isLateNightQuiet(at: Date): boolean {
  const h = at.getHours();
  return h >= 0 && h < 4;
}

export function buildDreamSlice(opts: {
  wants: readonly string[];
  pledges: readonly string[];
  overdueCount: number;
  recentTexts: readonly string[];
  journeyCity?: string;
  lowEnergy?: boolean;
  roll?: number;
}): string | null {
  const chance = opts.overdueCount > 0 || opts.lowEnergy ? 0.45 : 0.25;
  const r = typeof opts.roll === 'number' && Number.isFinite(opts.roll) ? opts.roll : Math.random();
  if (r >= chance) return null;

  const anchor = opts.pledges[0] || opts.wants[0] || opts.recentTexts[0] || '';
  const place = opts.journeyCity ? `一路走到了${opts.journeyCity}` : '绕过望水坡看见了整片白芦花';
  if (!anchor && !opts.journeyCity) return null;

  if (opts.pledges[0]) {
    return `[梦] 昨晚做梦还在惦记「${opts.pledges[0]}」，梦里${place}，醒来天都亮了。`;
  }
  if (opts.wants[0]) {
    return `[梦] 昨晚梦见「${opts.wants[0]}」这事成了，还顺道${place}。`;
  }
  return `[梦] 昨晚乱七八糟梦到白天的事（${anchor.slice(0, 18)}），梦里${place}。`;
}
