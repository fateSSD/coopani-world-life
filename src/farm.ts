/**
 * 菜园种菜、城郊租地、储物篮与五赛道摆摊真实成本引擎（2026-11-24）。
 *
 * 严格遵守「鱼不吃鱼」底线：全部种子、作物与食材仅限水乡浅滩藕菱菌菇及陆上果蔬粮豆，
 * 不含任何鱼肉、虾蟹、贝类或海鲜表达。
 */

export type FarmHomeTier = 'urban-village' | 'old' | 'new' | 'villa';

export const HOME_FARM_SLOTS: Record<FarmHomeTier, number> = {
  'urban-village': 1,
  old: 2,
  new: 4,
  villa: 8,
};

export const LEASE_PLOT_COUNT = 4;
export const LEASE_SIGNUP_FEE = 100;
export const LEASE_MONTHLY_RENT = 150;

export interface SeedDef {
  id: string;
  name: string;
  aliases: readonly string[];
  price: number;
  growHours: number;
  baseYield: number;
  solarTerms: readonly string[];
  needSpace?: boolean;
  note: string;
}

export const SEEDS: readonly SeedDef[] = [
  {
    id: 'scallion',
    name: '香葱与罗勒',
    aliases: ['葱', '香葱', '小葱', '罗勒'],
    price: 5,
    growHours: 96,
    baseYield: 2,
    solarTerms: ['立春', '雨水', '立夏', '小满'],
    note: '好养活的香草调味菜，4 天熟，窗台小花盆也能种。',
  },
  {
    id: 'bokchoy',
    name: '鲜嫩小青菜',
    aliases: ['青菜', '小青菜', '小白菜', '油菜'],
    price: 6,
    growHours: 120,
    baseYield: 3,
    solarTerms: ['惊蛰', '春分', '清明', '霜降', '立冬'],
    note: '5 天长成水灵青菜，下汤面炒菜最百搭。',
  },
  {
    id: 'tomato',
    name: '沙瓤西红柿',
    aliases: ['番茄', '西红柿'],
    price: 10,
    growHours: 144,
    baseYield: 3,
    solarTerms: ['谷雨', '立夏', '芒种', '夏至'],
    note: '6 天熟透红亮，自家吃或挂市集摊上都抢手。',
  },
  {
    id: 'mushroom',
    name: '椴木鲜香菇',
    aliases: ['香菇', '菌菇', '蘑菇'],
    price: 12,
    growHours: 144,
    baseYield: 3,
    solarTerms: ['白露', '秋分', '寒露', '小雪', '大雪'],
    note: '6 天采摘肥厚香菇，煮菌菇煲底味极鲜。',
  },
  {
    id: 'eggplant',
    name: '紫皮长茄与辣椒',
    aliases: ['茄子', '长茄', '辣椒'],
    price: 9,
    growHours: 144,
    baseYield: 3,
    solarTerms: ['小满', '夏至', '小暑', '大暑'],
    note: '6 天结果，炭烤或家常烧茄子都很顶饿。',
  },
  {
    id: 'lotus',
    name: '浅滩嫩莲藕',
    aliases: ['莲藕', '嫩藕', '藕'],
    price: 14,
    growHours: 168,
    baseYield: 4,
    solarTerms: ['夏至', '大暑', '立秋', '处暑'],
    needSpace: true,
    note: '水乡招牌浅滩作物，需至少 2 槽空间（老小区及以上或租地），7 天熟，一次收 4 份。',
  },
  {
    id: 'sweet_potato',
    name: '蜜薯红薯',
    aliases: ['红薯', '蜜薯', '地瓜', '番薯'],
    price: 8,
    growHours: 168,
    baseYield: 4,
    solarTerms: ['立秋', '处暑', '白露', '霜降'],
    note: '7 天起薯，烤红薯或做红薯粥本钱低产量稳。',
  },
  {
    id: 'strawberry',
    name: '奶油草莓与青梅',
    aliases: ['草莓', '青梅'],
    price: 18,
    growHours: 216,
    baseYield: 4,
    solarTerms: ['立春', '雨水', '清明', '谷雨'],
    note: '9 天慢熟精品果品，直接挂鲜蔬摊或做甜点利润最高。',
  },
];

export interface FarmPlot {
  id: string;
  seedId: string;
  name: string;
  plantedAt: string;
  matureAt: string;
  wateredAt: string;
  wateredDay: string;
  waterCount: number;
  baseYield: number;
  solarBonus: boolean;
  source: 'home' | 'leased';
}

export interface FarmState {
  leased: boolean;
  leasedSince: string;
  leasedMonthly: number;
  plots: FarmPlot[];
}

export interface PantryItem {
  id: string;
  name: string;
  qty: number;
  freshVeg: boolean;
  origin: 'home-grown' | 'town-buy' | 'market';
  unitCost: number;
  fromSeller?: string;
  acquiredAt: string;
}

export type StallCategory = 'produce' | 'food' | 'craft' | 'writing' | 'photo';

export const STALL_CATEGORY_LABEL: Record<StallCategory, string> = {
  produce: '鲜蔬农产',
  food: '料理熟食',
  craft: '手作文创',
  writing: '写作出版',
  photo: '影像周边',
};

export interface StallRecord {
  id: string;
  item: string;
  category: StallCategory;
  unitPrice: number;
  stock: number;
  unitCost: number;
  totalCost: number;
  usedPantry: number;
  postedAt: string;
  expiresAt: string;
}

export interface StallRuleGuide {
  category: StallCategory;
  label: string;
  requirement: string;
  costFormula: string;
  energyNote: string;
  examples: string;
}

export const STALL_RULES_GUIDE: readonly StallRuleGuide[] = [
  {
    category: 'produce',
    label: '鲜蔬农产',
    requirement: '自家种植收成入储物篮；未种菜时 ≤20 元可按早市现批转卖（利润薄），>20 元或指定鲜蔬摊需自产鲜蔬',
    costFormula: '用自产鲜蔬仅扣 3 元/批打包保鲜费；现批进货另扣约定价 60%/份',
    energyNote: '扣 3–12 精力',
    examples: '香葱、浅滩嫩莲藕、蜜薯红薯、奶油草莓',
  },
  {
    category: 'food',
    label: '料理熟食',
    requirement: '≤25 元家常小吃不限；>25 元需「厨师证 / 烹饪≥10 / 小烤箱 / 老小区及以上厨房」其一',
    costFormula: '先消耗储物篮鲜蔬（仅 3 元/份油盐燃料费）；无囤货从早市现买原料（定价 38%/份，持厨师证 28%）',
    energyNote: '扣 4–18 精力',
    examples: '手擀面、桂花糕、卤豆干、菌菇砂锅饭',
  },
  {
    category: 'writing',
    label: '写作出版',
    requirement: '≤25 元小书签/手抄单不限；>25 元需「见识≥15 / 文字≥10 / 二手笔记本电脑」其一',
    costFormula: '纸笔排版底费 8 元/批（有电脑降为 3 元，10 元以内小件 3 元）+ 印刷装帧费 25%–30%/份',
    energyNote: '耗心神：扣 6–22 精力',
    examples: '芦花塘随笔集、手绘攻略册、手写诗签本',
  },
  {
    category: 'craft',
    label: '手作文创',
    requirement: '≤25 元小物不限；>25 元需「手作≥5 / 老式缝纫机」其一',
    costFormula: '毛线/陶土/布料/包装耗材费按定价 38%/份（手作≥20 或有缝纫机降至 30%）',
    energyNote: '扣 5–20 精力',
    examples: '陶土小摆件、拼微缩书屋、刺绣茶垫',
  },
  {
    category: 'photo',
    label: '影像周边',
    requirement: '≤15 元小贴纸/照片卡不限；>15 元需「二手胶片微单 / 影像≥10」其一',
    costFormula: '冲扫底费 6 元/批（10 元以内 3 元）+ 相纸冲印费 30%/份',
    energyNote: '扣 4–16 精力',
    examples: '胶片明信片、旅途风光画册、拍立得照片',
  },
];

export interface FarmHostState {
  home: { tier: FarmHomeTier };
  job: { certs: string[] };
  money: { cash: number; spent: number };
  vitals: { energy: number };
  knowledge: number;
  fitness: number;
  skills?: Record<string, number | undefined>;
  gear?: string[];
  freshVegUntil?: string;
  farm: FarmState;
  pantry: PantryItem[];
  tellable: { id: string; text: string; at: string; said: boolean }[];
  moodlets: { id: string; source: string; text: string; kind: 'good' | 'bad'; expiresAt: string }[];
  updatedAt: string;
}

export function freshFarm(): FarmState {
  return { leased: false, leasedSince: '', leasedMonthly: LEASE_MONTHLY_RENT, plots: [] };
}

export function normFarm(raw: unknown): FarmState {
  const base = freshFarm();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Partial<FarmState>;
  const plots = Array.isArray(o.plots)
    ? o.plots
      .filter((p): p is FarmPlot => Boolean(p && typeof p === 'object' && typeof p.id === 'string' && typeof p.seedId === 'string'))
      .map((p) => ({
        id: p.id,
        seedId: p.seedId,
        name: String(p.name ?? p.seedId),
        plantedAt: typeof p.plantedAt === 'string' ? p.plantedAt : '',
        matureAt: typeof p.matureAt === 'string' ? p.matureAt : '',
        wateredAt: typeof p.wateredAt === 'string' ? p.wateredAt : '',
        wateredDay: typeof p.wateredDay === 'string' ? p.wateredDay : '',
        waterCount: Math.max(0, Math.round(Number(p.waterCount) || 0)),
        baseYield: Math.max(1, Math.round(Number(p.baseYield) || 2)),
        solarBonus: Boolean(p.solarBonus),
        source: p.source === 'leased' ? 'leased' : 'home',
      }))
    : [];
  return {
    leased: Boolean(o.leased),
    leasedSince: typeof o.leasedSince === 'string' ? o.leasedSince : '',
    leasedMonthly: Number.isFinite(Number(o.leasedMonthly)) && Number(o.leasedMonthly) > 0
      ? Math.round(Number(o.leasedMonthly))
      : LEASE_MONTHLY_RENT,
    plots,
  };
}

export function normPantry(raw: unknown): PantryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PantryItem[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Partial<PantryItem>;
    const name = String(o.name ?? '').trim();
    const qty = Math.max(0, Math.round(Number(o.qty) || 0));
    if (!name || qty <= 0) continue;
    out.push({
      id: typeof o.id === 'string' && o.id ? o.id : `pan-${out.length + 1}`,
      name,
      qty,
      freshVeg: Boolean(o.freshVeg),
      origin: o.origin === 'home-grown' || o.origin === 'town-buy' ? o.origin : 'market',
      unitCost: Math.max(0, Math.round(Number(o.unitCost) || 0)),
      ...(typeof o.fromSeller === 'string' && o.fromSeller ? { fromSeller: o.fromSeller } : {}),
      acquiredAt: typeof o.acquiredAt === 'string' ? o.acquiredAt : '',
    });
  }
  return out.slice(-40);
}

export function normStallRecords(raw: unknown): StallRecord[] {
  if (!Array.isArray(raw)) return [];
  const validCats = new Set<StallCategory>(['produce', 'food', 'craft', 'writing', 'photo']);
  const out: StallRecord[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Partial<StallRecord>;
    if (typeof o.id !== 'string' || !o.id || typeof o.item !== 'string' || !o.item) continue;
    const cat = validCats.has(o.category as StallCategory) ? (o.category as StallCategory) : 'food';
    out.push({
      id: o.id,
      item: o.item,
      category: cat,
      unitPrice: Math.max(1, Math.round(Number(o.unitPrice) || 1)),
      stock: Math.max(1, Math.round(Number(o.stock) || 1)),
      unitCost: Math.max(0, Math.round(Number(o.unitCost) || 0)),
      totalCost: Math.max(0, Math.round(Number(o.totalCost) || 0)),
      usedPantry: Math.max(0, Math.round(Number(o.usedPantry) || 0)),
      postedAt: typeof o.postedAt === 'string' ? o.postedAt : '',
      expiresAt: typeof o.expiresAt === 'string' ? o.expiresAt : '',
    });
  }
  return out.slice(-60);
}

export function normSettledDeals(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(-200);
}

export function homeFarmSlots(tier: FarmHomeTier): number {
  return HOME_FARM_SLOTS[tier] ?? 1;
}

export function totalFarmSlots(state: { home: { tier: FarmHomeTier }; farm: FarmState }): number {
  return homeFarmSlots(state.home.tier) + (state.farm.leased ? LEASE_PLOT_COUNT : 0);
}

export function findSeed(q: string): SeedDef | null {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return null;
  return SEEDS.find((item) =>
    item.id.toLowerCase() === s
    || item.name.toLowerCase() === s
    || item.name.toLowerCase().includes(s)
    || item.aliases.some((a) => a.toLowerCase() === s || s.includes(a.toLowerCase())),
  ) ?? null;
}

function fmtLocalDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function pushMemory(state: { tellable: { id: string; text: string; at: string; said: boolean }[] }, text: string, now: Date): void {
  const t = text.trim();
  if (!t) return;
  state.tellable.push({
    id: `t-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    text: t,
    at: now.toISOString(),
    said: false,
  });
  if (state.tellable.length > 20) state.tellable = state.tellable.slice(-20);
}

export interface FarmPlotView extends FarmPlot {
  progress: number;
  hoursLeft: number;
  daysLeft: number;
  ready: boolean;
  wateredToday: boolean;
  expectedYield: number;
}

export function farmPlotView(plot: FarmPlot, now: Date): FarmPlotView {
  const startMs = Date.parse(plot.plantedAt);
  const endMs = Date.parse(plot.matureAt);
  const nowMs = now.getTime();
  const totalMs = Math.max(3_600_000, endMs - startMs);
  const elapsedMs = Math.max(0, nowMs - startMs);
  const progress = Math.max(0, Math.min(1, Number.isFinite(startMs) && Number.isFinite(endMs) ? elapsedMs / totalMs : 0));
  const remMs = Math.max(0, endMs - nowMs);
  const hoursLeft = Math.round((remMs / 3_600_000) * 10) / 10;
  const daysLeft = Math.round((remMs / 86_400_000) * 10) / 10;
  const ready = Number.isFinite(endMs) && nowMs >= endMs;
  const today = fmtLocalDay(now);
  const wateredToday = plot.wateredDay === today;
  const expectedYield = plot.baseYield + (plot.waterCount >= 2 ? 1 : 0) + (plot.solarBonus ? 1 : 0);
  return { ...plot, progress, hoursLeft, daysLeft, ready, wateredToday, expectedYield };
}

export function addPantryItem(
  pantry: PantryItem[],
  item: Omit<PantryItem, 'id'>,
): PantryItem[] {
  const qty = Math.max(0, Math.round(item.qty));
  if (!item.name.trim() || qty <= 0) return pantry;
  const hit = pantry.find((x) =>
    x.name === item.name
    && x.origin === item.origin
    && (x.fromSeller || '') === (item.fromSeller || ''),
  );
  if (hit) {
    hit.qty += qty;
    hit.unitCost = Math.max(0, Math.round(item.unitCost));
    hit.acquiredAt = item.acquiredAt;
    return pantry.slice(-40);
  }
  pantry.push({
    id: `pan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    ...item,
    qty,
  });
  return pantry.slice(-40);
}

export function pantryCount(pantry: readonly PantryItem[], opts: { homeOnly?: boolean } = {}): number {
  let total = 0;
  for (const x of pantry) {
    if (opts.homeOnly && x.origin !== 'home-grown') continue;
    if (x.qty > 0) total += x.qty;
  }
  return total;
}

export function consumePantry(
  pantry: PantryItem[],
  qty: number,
  opts: { homeOnly?: boolean } = {},
): { consumed: number; sources: string[]; totalUnitCost: number } {
  let need = Math.max(0, Math.round(qty));
  if (need <= 0) return { consumed: 0, sources: [], totalUnitCost: 0 };
  const rank = (o: PantryItem['origin']) => (o === 'home-grown' ? 0 : o === 'town-buy' ? 1 : 2);
  const candidates = pantry
    .filter((x) => x.qty > 0 && (!opts.homeOnly || x.origin === 'home-grown'))
    .sort((a, b) => rank(a.origin) - rank(b.origin));

  let consumed = 0;
  let totalUnitCost = 0;
  const sources: string[] = [];
  for (const item of candidates) {
    if (need <= 0) break;
    const take = Math.min(need, item.qty);
    item.qty -= take;
    need -= take;
    consumed += take;
    totalUnitCost += take * item.unitCost;
    const fromLabel = item.origin === 'home-grown'
      ? `自种「${item.name}」×${take}`
      : item.origin === 'town-buy'
        ? `向${item.fromSeller || '街坊'}买的「${item.name}」×${take}`
        : `早市备的「${item.name}」×${take}`;
    sources.push(fromLabel);
  }
  for (let i = pantry.length - 1; i >= 0; i--) {
    if (pantry[i].qty <= 0) pantry.splice(i, 1);
  }
  return { consumed, sources, totalUnitCost };
}

export function applyPlant(
  state: FarmHostState,
  seedQuery: string,
  now: Date,
  solarTermName = '',
): { ok: boolean; reason?: string; plot?: FarmPlot; paid: number; cash: number } {
  const seed = findSeed(seedQuery);
  if (!seed) {
    const names = SEEDS.map((s) => `${s.name}（${s.price}元/${Math.round(s.growHours / 24)}天）`).join('、');
    return { ok: false, reason: `没认出「${seedQuery || '空白'}」是什么种子。现有种子：${names}。`, paid: 0, cash: state.money.cash };
  }
  const homeCap = homeFarmSlots(state.home.tier);
  const maxSlots = totalFarmSlots(state);
  if (seed.needSpace && maxSlots < 2) {
    return {
      ok: false,
      reason: `「${seed.name}」需要大一点的水钵或连槽（至少 2 个种植槽）。城中村窗台只有 1 槽，搬到老小区及以上或租一块城郊菜地就能种。`,
      paid: 0,
      cash: state.money.cash,
    };
  }
  if (state.farm.plots.length >= maxSlots) {
    return {
      ok: false,
      reason: state.farm.leased
        ? `自留与租来的 ${maxSlots} 块槽位都种满了，先收成成熟作物再撒种。`
        : `住处自带的 ${maxSlots} 个种植槽都种满了——搬到更高档住处，或花 ${LEASE_SIGNUP_FEE} 元（月租 ${LEASE_MONTHLY_RENT} 元）租一块 ${LEASE_PLOT_COUNT} 槽城郊菜地吧。`,
      paid: 0,
      cash: state.money.cash,
    };
  }
  if (state.money.cash < seed.price) {
    return {
      ok: false,
      reason: `「${seed.name}」种子要 ${seed.price} 元，手上只有 ${Math.round(state.money.cash)} 元。`,
      paid: 0,
      cash: state.money.cash,
    };
  }

  const homeUsed = state.farm.plots.filter((p) => p.source === 'home').length;
  const source: 'home' | 'leased' = homeUsed < homeCap ? 'home' : 'leased';
  const solarBonus = Boolean(solarTermName && seed.solarTerms.includes(solarTermName));
  const plot: FarmPlot = {
    id: `plot-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    seedId: seed.id,
    name: seed.name,
    plantedAt: now.toISOString(),
    matureAt: new Date(now.getTime() + seed.growHours * 3_600_000).toISOString(),
    wateredAt: '',
    wateredDay: '',
    waterCount: 0,
    baseYield: seed.baseYield,
    solarBonus,
    source,
  };
  state.money.cash -= seed.price;
  state.money.spent += seed.price;
  state.farm.plots.push(plot);
  const days = Math.round(seed.growHours / 24);
  pushMemory(
    state,
    `在${source === 'leased' ? '城郊菜地' : '家里种植槽'}播下了「${seed.name}」（花 ${seed.price} 元，约 ${days} 天成熟${solarBonus ? '，正赶上应季好节气' : ''}）。`,
    now,
  );
  state.updatedAt = now.toISOString();
  return { ok: true, plot, paid: seed.price, cash: state.money.cash };
}

export function applyWater(
  state: FarmHostState,
  plotId: string,
  now: Date,
): { ok: boolean; reason?: string; watered: number; energy: number } {
  if (!state.farm.plots.length) {
    return { ok: false, reason: '地里还没有种东西呢，先选种子播下去吧。', watered: 0, energy: state.vitals.energy };
  }
  const today = fmtLocalDay(now);
  const pickOne = plotId ? state.farm.plots.find((p) => p.id === plotId) : null;
  if (plotId && !pickOne) {
    return { ok: false, reason: `没找到 id 为「${plotId}」的那块地。`, watered: 0, energy: state.vitals.energy };
  }
  const targets = pickOne
    ? [pickOne]
    : state.farm.plots.filter((p) => Date.parse(p.matureAt) > now.getTime() && p.wateredDay !== today);

  if (!targets.length) {
    const allReady = state.farm.plots.every((p) => Date.parse(p.matureAt) <= now.getTime());
    return {
      ok: false,
      reason: allReady ? '地里的菜都已经熟透了，不用再浇水，直接收成吧。' : '地里在长的菜今天都已经浇过水了，明天再来打理。',
      watered: 0,
      energy: state.vitals.energy,
    };
  }
  const target = targets[0];
  if (Date.parse(target.matureAt) <= now.getTime()) {
    return { ok: false, reason: `「${target.name}」已经熟了，可以直接收割入储物篮。`, watered: 0, energy: state.vitals.energy };
  }
  if (target.wateredDay === today) {
    return { ok: false, reason: `「${target.name}」今天已经浇过水了，每天浇一次就够啦。`, watered: 0, energy: state.vitals.energy };
  }
  if (state.vitals.energy < 5) {
    return { ok: false, reason: `精力只剩 ${Math.round(state.vitals.energy)} 点了，歇一歇再去提水浇菜吧。`, watered: 0, energy: state.vitals.energy };
  }

  state.vitals.energy = Math.max(0, state.vitals.energy - 3);
  target.waterCount += 1;
  target.wateredAt = now.toISOString();
  target.wateredDay = today;
  pushMemory(state, `提水浇了「${target.name}」（已照料 ${target.waterCount} 次）。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true, watered: 1, energy: state.vitals.energy };
}

export function applyHarvest(
  state: FarmHostState,
  plotId: string,
  now: Date,
): { ok: boolean; reason?: string; harvested: { name: string; qty: number }[]; totalQty: number } {
  if (!state.farm.plots.length) {
    return { ok: false, reason: '地里还空着，先播种再等成熟收成吧。', harvested: [], totalQty: 0 };
  }
  const target = plotId ? state.farm.plots.find((p) => p.id === plotId) : null;
  if (plotId && !target) {
    return { ok: false, reason: `没找到 id 为「${plotId}」的种植槽。`, harvested: [], totalQty: 0 };
  }
  const candidates = target ? [target] : state.farm.plots.filter((p) => Date.parse(p.matureAt) <= now.getTime());
  if (!candidates.length) {
    const earliest = state.farm.plots
      .map((p) => farmPlotView(p, now))
      .sort((a, b) => a.hoursLeft - b.hoursLeft)[0];
    return {
      ok: false,
      reason: earliest
        ? `菜还没长成呢，最快的一批「${earliest.name}」大约还要 ${earliest.daysLeft} 天（${earliest.hoursLeft} 小时）熟。`
        : '还没有成熟作物。',
      harvested: [],
      totalQty: 0,
    };
  }
  if (target && Date.parse(target.matureAt) > now.getTime()) {
    const view = farmPlotView(target, now);
    return {
      ok: false,
      reason: `「${target.name}」还要 ${view.daysLeft} 天（${view.hoursLeft} 小时）才熟透，再等等。`,
      harvested: [],
      totalQty: 0,
    };
  }

  const harvested: { name: string; qty: number }[] = [];
  let totalQty = 0;
  const harvestedIds = new Set<string>();
  for (const p of candidates) {
    const view = farmPlotView(p, now);
    const qty = view.expectedYield;
    const seed = findSeed(p.seedId);
    const unitCost = Math.max(1, Math.round((seed?.price ?? 8) / qty));
    addPantryItem(state.pantry, {
      name: p.name,
      qty,
      freshVeg: true,
      origin: 'home-grown',
      unitCost,
      acquiredAt: now.toISOString(),
    });
    harvested.push({ name: p.name, qty });
    totalQty += qty;
    harvestedIds.add(p.id);
  }
  state.farm.plots = state.farm.plots.filter((p) => !harvestedIds.has(p.id));

  const nextVegMs = now.getTime() + 24 * 3_600_000;
  const oldVegMs = state.freshVegUntil ? Date.parse(state.freshVegUntil) : 0;
  if (!Number.isFinite(oldVegMs) || nextVegMs > oldVegMs) {
    state.freshVegUntil = new Date(nextVegMs).toISOString();
  }
  state.fitness = Math.min(100, Math.max(5, (state.fitness ?? 25) + 0.3));
  state.moodlets = state.moodlets.filter((m) => m.source !== 'farm-harvest');
  const sumStr = harvested.map((h) => `${h.name}×${h.qty}`).join('、');
  state.moodlets.push({
    id: `m-fh-${now.getTime().toString(36)}`,
    source: 'farm-harvest',
    text: `亲手收成了 ${sumStr}，看着满满一篮真踏实`,
    kind: 'good',
    expiresAt: new Date(now.getTime() + 5 * 3_600_000).toISOString(),
  });
  pushMemory(state, `收成了亲手种的 ${sumStr}，放进了储物篮。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true, harvested, totalQty };
}

export function applyRentFarm(
  state: FarmHostState,
  now: Date,
): { ok: boolean; reason?: string; paid: number; cash: number } {
  if (state.farm.leased) {
    return { ok: false, reason: '你已经租着一块城郊菜地了（4 槽，月租 150 元）。', paid: 0, cash: state.money.cash };
  }
  if (state.money.cash < LEASE_SIGNUP_FEE) {
    return {
      ok: false,
      reason: `签下城郊菜地需要先交 ${LEASE_SIGNUP_FEE} 元起租费（之后月租 ${LEASE_MONTHLY_RENT} 元，按天扣 5 元），手上只有 ${Math.round(state.money.cash)} 元。`,
      paid: 0,
      cash: state.money.cash,
    };
  }
  state.money.cash -= LEASE_SIGNUP_FEE;
  state.money.spent += LEASE_SIGNUP_FEE;
  state.farm.leased = true;
  state.farm.leasedSince = now.toISOString();
  state.farm.leasedMonthly = LEASE_MONTHLY_RENT;
  pushMemory(state, `签下了一块城郊菜地（多出 ${LEASE_PLOT_COUNT} 个种菜槽，签约费 ${LEASE_SIGNUP_FEE} 元，月租 ${LEASE_MONTHLY_RENT} 元）。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true, paid: LEASE_SIGNUP_FEE, cash: state.money.cash };
}

export function applyUnrentFarm(
  state: FarmHostState,
  force: boolean,
  now: Date,
): { ok: boolean; reason?: string } {
  if (!state.farm.leased) {
    return { ok: false, reason: '现在没有租着城郊菜地。' };
  }
  const leasedPlots = state.farm.plots.filter((p) => p.source === 'leased');
  if (leasedPlots.length > 0 && !force) {
    return {
      ok: false,
      reason: `城郊菜地里还有 ${leasedPlots.map((p) => p.name).join('、')} 没收完，先收割或传 force: true 放弃作物退租。`,
    };
  }
  state.farm.plots = state.farm.plots.filter((p) => p.source !== 'leased');
  state.farm.leased = false;
  state.farm.leasedSince = '';
  pushMemory(state, '退掉了城郊菜地的租约。', now);
  state.updatedAt = now.toISOString();
  return { ok: true };
}

export function inferStallCategory(item: string, freshVeg: boolean, explicit?: unknown): StallCategory {
  const valid = new Set<StallCategory>(['produce', 'food', 'craft', 'writing', 'photo']);
  if (typeof explicit === 'string' && valid.has(explicit as StallCategory)) {
    return explicit as StallCategory;
  }
  if (freshVeg) return 'produce';
  const s = String(item || '').trim();
  if (/书|册|诗|随笔|攻略|故事|手抄|文集|杂志|小报|手账本|日记本|散文|小说|签/.test(s)) return 'writing';
  if (/摄影|胶片|明信片|画册|照片|拍立得|贴纸|风景照/.test(s)) return 'photo';
  if (/面|饭|菜|糕|饼|汤|茶|酱|卤|粥|包|饺|点心|甜|薯|栗|糖|饮|便当|烤|锅|炒|拌|奶茶|咖啡|汁|馍|粉|酿/.test(s)) return 'food';
  return 'craft';
}

export interface StallPlanResult {
  ok: boolean;
  reason?: string;
  category: StallCategory;
  freshVeg: boolean;
  explicitCategory: boolean;
  cashCost: number;
  pantryUsed: number;
  pantrySources: string[];
  pantryUnitCostSum: number;
  energyCost: number;
  breakdown: string;
  breakEvenPrice: number;
}

export function evaluateStallPlan(
  state: FarmHostState,
  opts: {
    item: string;
    price: number;
    stock: number;
    freshVeg: boolean;
    category?: unknown;
    usePantry?: boolean;
  },
): StallPlanResult {
  const validCats = new Set<StallCategory>(['produce', 'food', 'craft', 'writing', 'photo']);
  const explicitCategory = typeof opts.category === 'string' && validCats.has(opts.category as StallCategory);
  const category = inferStallCategory(opts.item, opts.freshVeg, opts.category);
  const freshVeg = opts.freshVeg || category === 'produce';
  const price = Math.max(1, Math.round(Number(opts.price) || 1));
  const stock = Math.max(1, Math.round(Number(opts.stock) || 1));
  const usePantry = opts.usePantry !== false;
  const gear = Array.isArray(state.gear) ? state.gear : [];
  const skills = state.skills ?? {};
  const certs = state.job?.certs ?? [];
  const homeTier = state.home?.tier ?? 'urban-village';

  const fail = (reason: string, energyCost = 0): StallPlanResult => ({
    ok: false,
    reason,
    category,
    freshVeg,
    explicitCategory,
    cashCost: 0,
    pantryUsed: 0,
    pantrySources: [],
    pantryUnitCostSum: 0,
    energyCost,
    breakdown: reason,
    breakEvenPrice: price,
  });

  let cashCost = 0;
  let pantryUsed = 0;
  let energyCost = 0;
  let breakdown = '';

  if (category === 'produce') {
    energyCost = Math.min(12, 3 + Math.ceil(stock / 2));
    const homeAvail = usePantry ? pantryCount(state.pantry, { homeOnly: true }) : 0;
    const packFee = 3;
    if (homeAvail >= stock) {
      pantryUsed = stock;
      cashCost = packFee;
      breakdown = `消耗自产鲜蔬 ${stock} 份 + 打包保鲜费 ${packFee} 元`;
    } else if (explicitCategory || price > 20) {
      return fail(
        `自产鲜蔬储备不足（家里储物篮里自己种出的只有 ${homeAvail} 份，摆 ${stock} 份还差 ${stock - homeAvail} 份）。先用 life_farm 在阳台/菜地种菜收成再摆鲜蔬摊吧。`,
        energyCost,
      );
    } else {
      const fromHome = homeAvail;
      const buyNeed = stock - fromHome;
      const wholesalePer = Math.max(2, Math.ceil(price * 0.6));
      pantryUsed = fromHome;
      cashCost = packFee + buyNeed * wholesalePer;
      breakdown = fromHome > 0
        ? `自产鲜蔬 ${fromHome} 份 + 早市现批 ${buyNeed} 份(${buyNeed * wholesalePer}元) + 打包 ${packFee} 元`
        : `暂无自产囤菜，按早市现批进货 ${buyNeed} 份(${buyNeed * wholesalePer}元) + 打包 ${packFee} 元（自己种菜卖只用 3 元打包费）`;
    }
  } else if (category === 'food') {
    energyCost = Math.min(18, 4 + stock);
    const hasChef = certs.includes('厨师证');
    const cookExp = Number(skills.cooking ?? 0);
    const hasOven = gear.includes('oven');
    const hasKitchen = homeTier !== 'urban-village';
    if (price > 25 && !hasChef && cookExp < 10 && !hasOven && !hasKitchen) {
      return fail(
        `想卖 ${price} 元一盘的进阶/私房料理，需要先满足之一：考取「厨师证」、烹饪熟练度达到 10、添置「家用小烤箱」，或搬出城中村拥有独立厨房。`,
        energyCost,
      );
    }
    const avail = usePantry ? pantryCount(state.pantry) : 0;
    const fromPantry = Math.min(stock, avail);
    const buyNeed = stock - fromPantry;
    const fuelPer = price <= 5 ? Math.min(3, Math.max(1, Math.ceil(price * 0.45))) : 3;
    const marketPer = price <= 5
      ? Math.max(1, Math.ceil(price * 0.45))
      : Math.max(2, Math.ceil(price * (hasChef ? 0.28 : 0.38)));
    pantryUsed = fromPantry;
    cashCost = fromPantry * fuelPer + buyNeed * marketPer;
    const segs: string[] = [];
    if (fromPantry > 0) segs.push(`用储物篮鲜蔬 ${fromPantry} 份(油盐燃料 ${fromPantry * fuelPer}元)`);
    if (buyNeed > 0) segs.push(`早市现买原料 ${buyNeed} 份(${buyNeed * marketPer}元)`);
    breakdown = segs.join(' + ');
  } else if (category === 'writing') {
    energyCost = Math.min(22, 6 + stock * 2);
    const writeExp = Number(skills.writing ?? 0);
    const hasComputer = gear.includes('computer');
    if (price > 25 && state.knowledge < 15 && writeExp < 10 && !hasComputer) {
      return fail(
        `定价超过 25 元的写作/出版物需要一定积累（见识达到 15、文字熟练度达到 10 或自备「二手笔记本电脑」任一即可）。`,
        energyCost,
      );
    }
    const paperBase = hasComputer ? 3 : (price <= 10 ? 3 : 8);
    const printPer = Math.max(1, price <= 5 ? Math.ceil(price * 0.4) : Math.ceil(price * (writeExp >= 25 ? 0.25 : 0.30)));
    cashCost = paperBase + stock * printPer;
    breakdown = `纸笔排版底费 ${paperBase} 元${hasComputer ? '(电脑减免)' : ''} + 印刷装帧 ${stock}×${printPer}=${stock * printPer} 元`;
  } else if (category === 'craft') {
    energyCost = Math.min(20, 5 + stock * 2);
    const craftExp = Number(skills.craft ?? 0);
    const hasSewing = gear.includes('sewing');
    if (price > 25 && craftExp < 5 && !hasSewing) {
      return fail(
        `定价超过 25 元的精致手作需要「手作熟练度 ≥ 5」或添置「老式缝纫机」（做两次 miniature/craft_shop 或上一次手工课就能达到）。`,
        energyCost,
      );
    }
    const matPer = Math.max(1, Math.ceil(price * (craftExp >= 20 || hasSewing ? 0.30 : 0.38)));
    cashCost = stock * matPer;
    breakdown = `手作耗材 ${stock}×${matPer}=${cashCost} 元`;
  } else {
    energyCost = Math.min(16, 4 + stock);
    const photoExp = Number(skills.photo ?? 0);
    const hasCam = gear.includes('camera');
    if (price > 15 && !hasCam && photoExp < 10) {
      return fail(
        `定价超过 15 元的影像周边需要「二手胶片微单」或「影像熟练度 ≥ 10」。`,
        energyCost,
      );
    }
    const devBase = price <= 10 ? 3 : 6;
    const printPer = Math.max(1, price <= 5 ? Math.ceil(price * 0.4) : Math.ceil(price * 0.30));
    cashCost = devBase + stock * printPer;
    breakdown = `冲扫整理底费 ${devBase} 元 + 相纸印制 ${stock}×${printPer}=${stock * printPer} 元`;
  }

  if (state.money.cash < cashCost) {
    return fail(
      `摆摊备货需要 ${cashCost} 元本钱（${breakdown}），手上只有 ${Math.round(state.money.cash)} 元，还差 ${cashCost - Math.round(state.money.cash)} 元。`,
      energyCost,
    );
  }
  if (state.vitals.energy < energyCost + 5) {
    return fail(
      `备货和支摊大约要耗 ${energyCost} 点精力，现在精力只有 ${Math.round(state.vitals.energy)} 点，先歇一歇或睡一觉再出摊吧。`,
      energyCost,
    );
  }

  return {
    ok: true,
    category,
    freshVeg,
    explicitCategory,
    cashCost,
    pantryUsed,
    pantrySources: [],
    pantryUnitCostSum: 0,
    energyCost,
    breakdown,
    breakEvenPrice: Math.max(1, Math.ceil(cashCost / stock)),
  };
}
