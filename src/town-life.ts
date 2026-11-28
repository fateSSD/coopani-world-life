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
  { id: 'coffee_kit', name: '手冲咖啡套组', kind: 'tool', price: 450, note: '出门或在家萃一杯手冲咖啡与茶饮的便携套具' },
  { id: 'garden_kit', name: '园艺修枝工具箱', kind: 'tool', price: 360, note: '剪枝造型与养护苗木绿植的手工整套工具' },
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

export interface EquipMaintainRule {
  every: number;
  cost: number;
  label: string;
}

export const EQUIP_MAINTAIN: Record<string, EquipMaintainRule> = {
  garden_kit: { every: 8, cost: 22, label: '磨剪防锈油与园艺手套换新' },
  folding_bike: { every: 10, cost: 20, label: '链条上油与胎压刹车微调' },
  coffee_kit: { every: 8, cost: 28, label: '滤纸耗材与磨芯除垢清理' },
  sewing: { every: 10, cost: 25, label: '缝纫机上油、梭芯与换针' },
  oven: { every: 8, cost: 25, label: '烤盘垫纸与炉膛清垢校温' },
  camera: { every: 10, cost: 40, label: '传感器除尘与防潮保养耗材' },
  ebike: { every: 8, cost: 35, label: '补胎换刹片与充电耗损维护' },
  computer: { every: 12, cost: 30, label: '散热清灰与外设耗损维护' },
  vehicle_car: { every: 6, cost: 55, label: '洗车保养与机油里程分摊' },
};

export function equipMaintainName(key: string): string {
  if (key === 'vehicle_car') return '运营车辆';
  return EQUIP_CATALOG.find((e) => e.id === key)?.name ?? key;
}

export function jobMaintainKey(jobId: string, equip?: string): string | null {
  if (jobId === 'driver' || jobId === 'charter_captain') return 'vehicle_car';
  if (equip && Object.prototype.hasOwnProperty.call(EQUIP_MAINTAIN, equip)) return equip;
  return null;
}

export interface SpecialtyDef {
  id: string;
  city: '兰州' | '北京' | '通用';
  category: 'pantry_dry' | 'tea_drink' | 'snack' | 'craft_mat' | 'souvenir';
  name: string;
  price: number;
  useMode: 'pantry' | 'drink' | 'snack' | 'snack_or_pantry' | 'collect_or_stall';
  pantryId?: string;
  pantryKind?: 'veg' | 'starch' | 'fruit' | 'herb' | 'craft_mat';
  foodGain?: number;
  funGain?: number;
  energyGain?: number;
  charges?: number;
  knowFirst?: number;
  stallCategory?: 'produce' | 'food' | 'craft' | 'writing' | 'photo';
  note: string;
}

export const CITY_SPECIALTIES: readonly SpecialtyDef[] = [
  { id: 'lz_lily_dry', city: '兰州', category: 'pantry_dry', name: '兰州真空甜百合干', price: 24, useMode: 'pantry', pantryId: 'lily_dry', pantryKind: 'veg', note: '入炖汤甜品提鲜润口。' },
  { id: 'lz_pepper', city: '兰州', category: 'pantry_dry', name: '陇南大红袍花椒', price: 18, useMode: 'pantry', pantryId: 'spice_pack', pantryKind: 'herb', note: '炖羊肉与牛肉面提味底料。' },
  { id: 'lz_sanpaotai', city: '兰州', category: 'tea_drink', name: '盖碗三泡台料包', price: 22, useMode: 'drink', funGain: 14, energyGain: 5, note: '枸杞红枣桂圆冰糖茶包，泡饮解乏。' },
  { id: 'lz_rose_jam', city: '兰州', category: 'snack', name: '苦水玫瑰花酱', price: 26, useMode: 'snack_or_pantry', pantryId: 'honey', pantryKind: 'herb', foodGain: 24, funGain: 14, note: '可直接抹面包吃，或当花蜜入烘焙。' },
  { id: 'lz_gourd_blank', city: '兰州', category: 'craft_mat', name: '素面小葫芦坯', price: 20, useMode: 'pantry', pantryId: 'lz_gourd_blank', pantryKind: 'craft_mat', note: '进织造手作台加工为彩绘刻花小葫芦。' },
  { id: 'lz_bridge_mark', city: '兰州', category: 'souvenir', name: '黄河铁桥木刻书签', price: 16, useMode: 'collect_or_stall', knowFirst: 1, stallCategory: 'writing', note: '首次获得见识 +1，亦可摆摊转卖。' },

  { id: 'bj_chestnut', city: '北京', category: 'pantry_dry', name: '怀柔去壳熟板栗仁', price: 22, useMode: 'snack_or_pantry', pantryId: 'chestnut', pantryKind: 'starch', foodGain: 26, funGain: 10, note: '便携甜栗，亦可入炖菜。' },
  { id: 'bj_sweet_sauce', city: '北京', category: 'pantry_dry', name: '京式六味甜面酱', price: 16, useMode: 'pantry', pantryId: 'sweet_sauce', pantryKind: 'herb', note: '复刻炸酱面与烤鸭荷叶卷的增香酱料。' },
  { id: 'bj_jasmine_tea', city: '北京', category: 'tea_drink', name: '浓香茉莉花茶罐', price: 28, useMode: 'drink', funGain: 15, energyGain: 5, note: '京味花茶，泡饮舒心提神。' },
  { id: 'bj_pastry_box', city: '北京', category: 'snack', name: '京八件手工糕点盒', price: 34, useMode: 'snack', charges: 2, foodGain: 30, funGain: 14, note: '可分 2 次享用的旅途高情绪点心盒。' },
  { id: 'bj_tuer_blank', city: '北京', category: 'craft_mat', name: '素坯兔儿爷彩绘套', price: 26, useMode: 'pantry', pantryId: 'bj_tuer_blank', pantryKind: 'craft_mat', note: '进织造手作台加工为手绘金线兔儿爷摆件。' },
  { id: 'bj_axis_cards', city: '北京', category: 'souvenir', name: '中轴线铜版明信片套', price: 20, useMode: 'collect_or_stall', knowFirst: 1, stallCategory: 'photo', note: '首次获得见识 +1，亦可挂影像摊转卖。' },

  { id: 'town_osmanthus', city: '通用', category: 'tea_drink', name: '手筛干金桂花罐', price: 18, useMode: 'pantry', pantryId: 'chamomile', pantryKind: 'herb', note: '居家常备桂花香料，可替代洋甘菊桂花入茶入点心。' },
  { id: 'town_bamboo_dry', city: '通用', category: 'pantry_dry', name: '水乡手晒春笋干', price: 20, useMode: 'pantry', pantryId: 'wild_rice_stem', pantryKind: 'veg', note: '跨季替代脆茭白入锅，缓解反季缺料。' },
];

export function findSpecialty(q: string, city?: string): SpecialtyDef | null {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return null;
  const norm = city ? String(city).trim().replace(/[市省区县]$/, '') : '';
  const pool = norm
    ? CITY_SPECIALTIES.filter((x) => x.city === norm || x.city === '通用')
    : CITY_SPECIALTIES;
  return pool.find((x) => x.id.toLowerCase() === s || x.name.toLowerCase() === s || x.name.toLowerCase().includes(s))
    ?? CITY_SPECIALTIES.find((x) => x.id.toLowerCase() === s || x.name.toLowerCase() === s || x.name.toLowerCase().includes(s))
    ?? null;
}

export function specialtiesForCity(city = '兰州'): SpecialtyDef[] {
  const norm = String(city || '兰州').trim().replace(/[市省区县]$/, '') || '兰州';
  return CITY_SPECIALTIES.filter((x) => x.city === norm || x.city === '通用');
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
  /** 若由 moodSummary 传入净分权重，优先以此为准，避免混合心情抵消。 */
  moodScoreDelta?: number;
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
  if (typeof opts.moodScoreDelta === 'number' && Number.isFinite(opts.moodScoreDelta)) {
    score += opts.moodScoreDelta;
  } else {
    if (opts.hasBadMood) score -= 0.12;
    if (opts.hasGoodMood) score += 0.14;
  }
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
/* 二十四节气与兰州公共时间轴（§4.19）                                  */
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
  { mmdd: 219, name: '雨水', season: 'spring', note: '河风带着水汽，岸边柳条透了绿意' },
  { mmdd: 306, name: '惊蛰', season: 'spring', note: '春雷响过，菜摊上摆出嫩绿的香椿芽' },
  { mmdd: 321, name: '春分', season: 'spring', note: '昼夜平分，青团铺子门前飘着艾草香' },
  { mmdd: 405, name: '清明', season: 'spring', note: '雨丝细密，南滨河路早市卖着新采的春茶' },
  { mmdd: 420, name: '谷雨', season: 'spring', note: '春末雨足，嫩蚕豆和竹笋最鲜' },
  { mmdd: 506, name: '立夏', season: 'summer', note: '天渐暖和，张掖路支起酿皮和甜醅子小摊' },
  { mmdd: 521, name: '小满', season: 'summer', note: '河水渐丰，新摘的果子和蚕豆上了市' },
  { mmdd: 606, name: '芒种', season: 'summer', note: '梅子黄了，正适合熬一罐酸甜青梅酱' },
  { mmdd: 621, name: '夏至', season: 'summer', note: '白昼最长，傍晚河边乘凉的人到九点还不散' },
  { mmdd: 707, name: '小暑', season: 'summer', note: '热浪起来了，冰镇绿豆汤和甜醅子最抢手' },
  { mmdd: 723, name: '大暑', season: 'summer', note: '三伏盛夏，午后街上静悄悄的' },
  { mmdd: 808, name: '立秋', season: 'autumn', note: '早晚有了凉意，秋茄和新瓜果脆生生的' },
  { mmdd: 823, name: '处暑', season: 'autumn', note: '暑气渐收，傍晚云彩常染成橘子色' },
  { mmdd: 908, name: '白露', season: 'autumn', note: '清晨草尖挂着露水，早市板栗刚炒好' },
  { mmdd: 923, name: '秋分', season: 'autumn', note: '河岸柳色转黄，糖炒栗子和桂花也开了' },
  { mmdd: 1008, name: '寒露', season: 'autumn', note: '夜露渐重，糖炒栗子和热牛奶摆上摊头' },
  { mmdd: 1023, name: '霜降', season: 'autumn', note: '秋意深了，早晚添件薄外套正好' },
  { mmdd: 1107, name: '立冬', season: 'winter', note: '河风转凉，张掖路晚市熬上了萝卜羊汤' },
  { mmdd: 1122, name: '小雪', season: 'winter', note: '初冬微寒，烤红薯炉子在街角冒白烟' },
  { mmdd: 1207, name: '大雪', season: 'winter', note: '夜长昼短，早睡最养神' },
  { mmdd: 1222, name: '冬至', season: 'winter', note: '家家都在剁饺子馅，热气能暖透整条张掖路' },
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

export const CITY_STREET_WINDOWS = {
  兰州: {
    'morning-market': { street: '南滨河路', label: '晨集', hint: '鲜菜早点 8 折', discount: 0.8 },
    'night-clearance': { street: '张掖路', label: '尾货市', hint: '熟食点心半价', discount: 0.5 },
    'weekend-flea': { street: '雁滩路', label: '周末旧货集与夜唱', hint: '有旧货和小物件摆出来', discount: 1 },
  },
  北京: {
    'morning-market': { street: '鼓楼西大街', label: '胡同早市', hint: '鲜蔬早点 8 折', discount: 0.8 },
    'night-clearance': { street: '什刹海沿岸', label: '晚市尾货', hint: '熟食京味点心半价', discount: 0.5 },
    'weekend-flea': { street: '琉璃厂', label: '周末旧书文玩集', hint: '有旧连环画与书签摆出来', discount: 1 },
  },
} as const;

export const CITY_MARKET_SNACKS = {
  兰州: [
    { item: '冰镇灰豆子', price: 10, unit: '碗', foodGain: 32, funGain: 11 },
    { item: '燕麦甜醅子', price: 12, unit: '杯', foodGain: 26, funGain: 13 },
    { item: '牛奶鸡蛋醪糟', price: 15, unit: '碗', foodGain: 38, funGain: 16 },
    { item: '一清二白牛肉面', price: 16, unit: '碗', foodGain: 52, funGain: 14 },
  ],
  北京: [
    { item: '胡同瓷瓶老酸奶', price: 10, unit: '瓶', foodGain: 20, funGain: 10 },
    { item: '糖炒栗子与冰糖葫芦', price: 16, unit: '份', foodGain: 26, funGain: 16 },
    { item: '豌豆黄与驴打滚拼盘', price: 18, unit: '盒', foodGain: 32, funGain: 15 },
    { item: '老北京小碗干炸酱面', price: 22, unit: '碗', foodGain: 52, funGain: 15 },
    { item: '现烙门钉肉饼', price: 24, unit: '份', foodGain: 54, funGain: 14 },
  ],
} as const;

function pickMarketCity(city?: string): '兰州' | '北京' {
  const norm = String(city ?? '').trim().replace(/[市省区县]$/, '');
  return norm === '北京' ? '北京' : '兰州';
}

export function streetWindowOf(now: Date, city = '兰州'): StreetWindow | null {
  const h = now.getHours() + now.getMinutes() / 60;
  const day = now.getDay();
  const c = pickMarketCity(city);
  const tbl = CITY_STREET_WINDOWS[c];
  if (h >= 6 && h < 9.5) {
    const row = tbl['morning-market'];
    return { id: 'morning-market', street: row.street, place: row.street, label: row.label, hint: row.hint, discount: row.discount };
  }
  if (h >= 19.5 && h < 21.5) {
    const row = tbl['night-clearance'];
    return { id: 'night-clearance', street: row.street, place: row.street, label: row.label, hint: row.hint, discount: row.discount };
  }
  if ((day === 0 || day === 6) && h >= 18 && h < 22) {
    const row = tbl['weekend-flea'];
    return { id: 'weekend-flea', street: row.street, place: row.street, label: row.label, hint: row.hint, discount: row.discount };
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
 * 确定性街市物价表（融合日内街巷折扣 + 二十四节气时令货 + 周末集市；未传 city 默认保持兰州旧版输出）。
 */
export function marketCatalogOf(now: Date, localDate: string, city?: string): MarketItem[] {
  let h = 0;
  for (let i = 0; i < localDate.length; i++) h = (h * 33 + localDate.charCodeAt(i)) >>> 0;
  const delta = (offset: number) => ((h + offset) % 5) - 2;

  const targetCity = pickMarketCity(city);
  const term = solarTermOf(now);
  const win = streetWindowOf(now, targetCity);
  const vegDisc = win?.id === 'morning-market' ? win.discount : 1;
  const cookedDisc = win?.id === 'night-clearance' ? win.discount : 1;

  const seasonalBySeason: Record<SolarTermInfo['season'], { item: string; base: number; unit: string; food: number; fun: number }> = {
    spring: { item: '香椿青团', base: 10, unit: '盒', food: 26, fun: 10 },
    summer: { item: '冰镇绿豆汤', base: 8, unit: '碗', food: 22, fun: 12 },
    autumn: { item: '桂花糖藕配栗子', base: 12, unit: '份', food: 30, fun: 10 },
    winter: { item: '炭烤红薯', base: 9, unit: '个', food: 28, fun: 10 },
  };
  const sea = seasonalBySeason[term.season];
  const morningTag = win?.id === 'morning-market' ? `${win.label}8折` : '生鲜';
  const nightTag = win?.id === 'night-clearance' ? '尾货半价' : '熟食';

  const list: MarketItem[] = [
    {
      item: '青菜豆腐',
      price: Math.max(3, Math.round((7 + delta(1)) * vegDisc)),
      unit: '一份',
      tag: win?.id === 'morning-market' ? `${win.label}8折·带露水` : '生鲜',
      foodGain: 28,
      funGain: 6,
      freshVeg: win?.id === 'morning-market',
      discounted: win?.id === 'morning-market',
    },
    {
      item: '番茄鸡蛋面料',
      price: Math.max(4, Math.round((10 + delta(2)) * vegDisc)),
      unit: '一份',
      tag: morningTag,
      foodGain: 30,
      funGain: 6,
      freshVeg: win?.id === 'morning-market',
      discounted: win?.id === 'morning-market',
    },
    {
      item: '小鱼干配菜',
      price: Math.max(4, Math.round((12 + delta(3)) * cookedDisc)),
      unit: '一份',
      tag: nightTag,
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
      tag: targetCity === '北京' ? '什刹海尾货' : '张掖路尾货',
      foodGain: 34,
      funGain: 10,
      discounted: true,
    });
  }
  if (win?.id === 'weekend-flea') {
    if (targetCity === '北京') {
      list.push(
        { item: '琉璃厂旧连环画', price: 14, unit: '本', tag: '周末旧书文玩集', foodGain: 0, funGain: 26 },
        { item: '老胡同铜纹书签', price: 8, unit: '枚', tag: '周末集市', foodGain: 0, funGain: 20 },
      );
    } else {
      list.push(
        { item: '旧磁带随身听小带', price: 14, unit: '盘', tag: '周末旧货集', foodGain: 0, funGain: 26 },
        { item: '街口扭蛋机盲盒', price: 5, unit: '颗', tag: '周末集市', foodGain: 0, funGain: 20 },
      );
    }
  }
  if (city !== undefined) {
    for (const sk of CITY_MARKET_SNACKS[targetCity]) {
      list.push({
        item: sk.item,
        price: win?.id === 'night-clearance' ? Math.max(4, Math.round(sk.price * cookedDisc)) : sk.price,
        unit: sk.unit,
        tag: `${targetCity}风味${win?.id === 'night-clearance' ? '·半价' : ''}`,
        foodGain: sk.foodGain,
        funGain: sk.funGain,
        discounted: win?.id === 'night-clearance',
      });
    }
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
  city?: string;
  lowEnergy?: boolean;
  roll?: number;
}): string | null {
  const chance = opts.overdueCount > 0 || opts.lowEnergy ? 0.45 : 0.25;
  const r = typeof opts.roll === 'number' && Number.isFinite(opts.roll) ? opts.roll : Math.random();
  if (r >= chance) return null;

  const anchor = opts.pledges[0] || opts.wants[0] || opts.recentTexts[0] || '';
  const homePlace = pickMarketCity(opts.city) === '北京'
    ? '沿着什刹海湖岸走过钟鼓楼下的老槐树'
    : '沿着滨河路走到铁桥边看黄河水光';
  const place = opts.journeyCity ? `一路走到了${opts.journeyCity}` : homePlace;
  if (!anchor && !opts.journeyCity) return null;

  if (opts.pledges[0]) {
    return `[梦] 昨晚做梦还在惦记「${opts.pledges[0]}」，梦里${place}，醒来天都亮了。`;
  }
  if (opts.wants[0]) {
    return `[梦] 昨晚梦见「${opts.wants[0]}」这事成了，还顺道${place}。`;
  }
  return `[梦] 昨晚乱七八糟梦到白天的事（${anchor.slice(0, 18)}），梦里${place}。`;
}

/** 根据城市收成加成计算实际产出份数（<1 按百分比向上增产，>=1 按整份加减，保底 1 份）。 */
export function applyYieldBonus(baseQty: number, bonus?: number): number {
  const base = Math.max(1, Math.round(Number(baseQty) || 1));
  if (typeof bonus !== 'number' || !Number.isFinite(bonus) || bonus === 0) return base;
  if (Math.abs(bonus) < 1) {
    if (bonus > 0) {
      return base + Math.max(1, Math.ceil(base * Math.min(3, bonus)));
    }
    return Math.max(1, Math.floor(base * (1 + Math.max(-0.8, bonus))));
  }
  return Math.max(1, base + Math.round(Math.max(-20, Math.min(20, bonus))));
}

/** 将城市心情加成（<1 按 *20 折算为点数，>=1 直接取整）规整为 [-15, 20] 区间内的整数。 */
export function normalizeMoodBonus(raw?: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw === 0) return 0;
  const val = Math.abs(raw) < 1
    ? (raw > 0 ? Math.max(1, Math.round(raw * 20)) : Math.min(-1, Math.round(raw * 20)))
    : Math.round(raw);
  return Math.max(-15, Math.min(20, val));
}

/* ------------------------------------------------------------------ */
/* 技能熟练度薪资加成 & 产出四档品质（普通 / 良品 / 精品 / 臻品）         */
/* ------------------------------------------------------------------ */

export type OutputQualityId = 'common' | 'good' | 'fine' | 'exquisite';

export interface OutputQualityMeta {
  id: OutputQualityId;
  label: string;
  valueMult: number;
  badgeColor: 'muted' | 'green' | 'blue' | 'gold';
}

export const OUTPUT_QUALITY_ORDER: readonly OutputQualityId[] = ['common', 'good', 'fine', 'exquisite'];

export const OUTPUT_QUALITY_META: Record<OutputQualityId, OutputQualityMeta> = {
  common: { id: 'common', label: '普通', valueMult: 1.0, badgeColor: 'muted' },
  good: { id: 'good', label: '良品', valueMult: 1.2, badgeColor: 'green' },
  fine: { id: 'fine', label: '精品', valueMult: 1.45, badgeColor: 'blue' },
  exquisite: { id: 'exquisite', label: '臻品', valueMult: 1.8, badgeColor: 'gold' },
};

export interface WorkOutputItem {
  id: string;
  jobId: string;
  jobName: string;
  domain: SkillDomain;
  name: string;
  quality: OutputQualityId;
  qualityLabel: string;
  value: number;
  count: number;
  createdAt: string;
}

export const JOB_OUTPUT_CATALOG: Record<string, { name: string; basePrice: number }> = {
  kitchen: { name: '切配风味备菜盒', basePrice: 28 },
  stall: { name: '早市现做点心', basePrice: 32 },
  cook: { name: '掌勺拿手热菜品鉴份', basePrice: 68 },
  bakery_assistant: { name: '现烤枣泥核桃酥礼盒', basePrice: 82 },
  street_photo: { name: '城市街景抓拍明信片', basePrice: 26 },
  darkroom_print: { name: '手工银盐冲印相片组', basePrice: 54 },
  arch_photo: { name: '古建风物画册样张', basePrice: 92 },
  photo_column: { name: '城记纪实摄影专刊样片', basePrice: 145 },
  renovation: { name: '木石精细修缮样件', basePrice: 44 },
  electrician: { name: '家居电路改造验收件', basePrice: 72 },
  linen_embroidery: { name: '手绣亚麻茶席垫', basePrice: 56 },
  custom_tailor: { name: '手工改衣定制成衣件', basePrice: 95 },
  menu_copy: { name: '手写体店铺菜单样张', basePrice: 24 },
  local_notes: { name: '街巷风物随笔稿', basePrice: 50 },
  magazine_feature: { name: '城市生活特约专栏稿', basePrice: 96 },
  teacher: { name: '校本教案与练习册', basePrice: 84 },
  delivery: { name: '同城顺路配送单', basePrice: 20 },
  rider_delivery: { name: '准点跑单成绩单', basePrice: 36 },
  courier_ebike: { name: '片区急件妥投记录', basePrice: 42 },
  driver: { name: '全天安全接送台账', basePrice: 66 },
  designated_driver: { name: '夜间平安代驾记录', basePrice: 62 },
  charter_captain: { name: '城际定制路书手册', basePrice: 120 },
  handbrew_barista: { name: '手冲风味单品特调', basePrice: 78 },
  pastry_chef: { name: '主厨私房酥点拼盘', basePrice: 118 },
  gift_wrapper: { name: '手扎四季鲜花礼束', basePrice: 28 },
  garden_trimmer: { name: '盆景造型修剪成品', basePrice: 74 },
  landscape_chief: { name: '庭院植物养护设计单', basePrice: 115 },
  pottery_master: { name: '手工拉坯釉面茶盏', basePrice: 128 },
  homestay_host: { name: '民宿暖心欢迎手卡', basePrice: 46 },
  local_guide: { name: '老城风物深度讲义', basePrice: 82 },
  aerial_landscape: { name: '山河航拍大片底片组', basePrice: 98 },
  travel_editor: { name: '城际深度特稿样刊', basePrice: 125 },
  archivist: { name: '分类典藏卷宗索引', basePrice: 68 },
  greenhouse_helper: { name: '温室时令壮苗礼篮', basePrice: 48 },
  rehab_therapist: { name: '居家理疗调理随访案', basePrice: 76 },
  community_doctor: { name: '社区健康随访手册', basePrice: 110 },
  orchard_picker: { name: '时令鲜果采摘篮', basePrice: 24 },
  book_restorer: { name: '修旧如旧线装书样', basePrice: 52 },
  apiary_helper: { name: '封盖巢蜜试吃罐', basePrice: 48 },
  tea_sommelier: { name: '节气拼配花果茶罐', basePrice: 84 },
  wool_artisan: { name: '手工纺线绒毛织片', basePrice: 86 },
  agro_advisor: { name: '农牧生态轮作规划册', basePrice: 122 },
  lz_teahouse_boy: { name: '黄河岸边盖碗茶单', basePrice: 22 },
  lz_noodle_puller: { name: '手工拉面二细面坯盒', basePrice: 46 },
  lz_lily_sorter: { name: '精选特级鲜百合礼盒', basePrice: 48 },
  lz_gourd_carver: { name: '针刻水墨花鸟小葫芦', basePrice: 90 },
  lz_river_docent: { name: '黄河铁桥风物手绘讲稿', basePrice: 82 },
  lz_noodle_master: { name: '秘制牛骨清汤辣子套组', basePrice: 126 },
  bj_alley_bookstore: { name: '旧书摊寻得毛边诗签', basePrice: 24 },
  bj_pastry_packer: { name: '红绳纸包传统点心盒', basePrice: 25 },
  bj_hutong_walk: { name: '胡同门墩漫步手账页', basePrice: 50 },
  bj_clay_artisan: { name: '手绘金线兔儿爷小像', basePrice: 56 },
  bj_axis_photo: { name: '红墙银杏中轴线印样', basePrice: 94 },
  bj_courtyard_docent: { name: '古建彩画与匾额札记', basePrice: 86 },
  bj_book_conservator: { name: '宣纸托裱古籍修复样卷', basePrice: 134 },
};

export function jobOutputOf(jobId: string): { name: string; basePrice: number } | null {
  return JOB_OUTPUT_CATALOG[jobId] ?? null;
}

/** 熟练度对工钱与时薪的倍率：0 级 1.00x，50 级 1.25x，100 级 1.50x。 */
export function skillPayMultiplier(domainExp: number): number {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(domainExp) ? domainExp : 0));
  return Math.round((1 + (clamped / 100) * 0.5) * 100) / 100;
}

/** 根据领域熟练度与培训/心情算四档品质出率（百分比之和严格为 100）。 */
export function qualityOdds(
  domainExp: number,
  opts: {
    trainedCount?: number;
    hasGoodMood?: boolean;
    hasBadMood?: boolean;
    moodPolarity?: 'good' | 'bad' | 'neutral';
    luckBonus?: number;
  } = {},
): Record<OutputQualityId, number> {
  const base = Math.min(100, Math.max(0, Number.isFinite(domainExp) ? domainExp : 0)) / 100;
  const trainBoost = Math.min(0.08, Math.max(0, Number(opts.trainedCount) || 0) * 0.02);
  const moodBoost = opts.moodPolarity
    ? (opts.moodPolarity === 'good' ? 0.05 : opts.moodPolarity === 'bad' ? -0.05 : 0)
    : ((opts.hasGoodMood ? 0.05 : 0) - (opts.hasBadMood ? 0.05 : 0));
  const townLuck = Number.isFinite(Number(opts.luckBonus))
    ? Math.max(-0.1, Math.min(0.35, Number(opts.luckBonus)))
    : 0;
  const e = Math.max(0, Math.min(1, base + trainBoost + moodBoost + townLuck));

  const exquisite = Math.round(1 + e * 24);
  const fine = Math.round(5 + e * 30);
  const good = Math.round(18 + e * 14 - Math.max(0, e - 0.6) * 10);
  const common = Math.max(4, 100 - exquisite - fine - good);
  const diff = 100 - (common + good + fine + exquisite);
  return {
    common: Math.max(1, common + diff),
    good,
    fine,
    exquisite,
  };
}

/** 抽取一件四档品质结果；roll 取 [0, 1)，越接近 1 越容易出高档品质。 */
export function rollWorkQuality(
  domainExp: number,
  opts: {
    trainedCount?: number;
    hasGoodMood?: boolean;
    hasBadMood?: boolean;
    moodPolarity?: 'good' | 'bad' | 'neutral';
    luckBonus?: number;
    roll?: number;
    forceCommon?: boolean;
  } = {},
): OutputQualityMeta {
  if (opts.forceCommon) return OUTPUT_QUALITY_META.common;
  const odds = qualityOdds(domainExp, opts);
  const r = typeof opts.roll === 'number' && Number.isFinite(opts.roll)
    ? Math.max(0, Math.min(0.999999, opts.roll))
    : Math.random();
  const pct = r * 100;
  if (pct < odds.common) return OUTPUT_QUALITY_META.common;
  if (pct < odds.common + odds.good) return OUTPUT_QUALITY_META.good;
  if (pct < odds.common + odds.good + odds.fine) return OUTPUT_QUALITY_META.fine;
  return OUTPUT_QUALITY_META.exquisite;
}
