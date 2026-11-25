/**
 * 动物养殖引擎（鸡舍 / 牛棚 / 鱼塘，2026-11-25）。
 *
 * 设定演进：大肥鱼本体是鲸鱼（哺乳动物），不属鱼类，因此放开淡水食用鱼塘养殖
 * （塘养草鱼、清江鲈鱼）并保持田园温馨画风，不写血腥屠宰描写。
 */

import {
  addPantryItem, farmPlotView, findSeed,
  type FarmHomeTier, type FarmState, type IngredientKind, type PantryItem,
} from './farm.ts';

export type AnimalGroup = 'chicken' | 'cow' | 'fish';

export const ANIMAL_GROUP_LABEL: Record<AnimalGroup, string> = {
  chicken: '鸡舍',
  cow: '牛棚',
  fish: '鱼塘',
};

export const HOME_RANCH_SLOTS: Record<FarmHomeTier, Record<AnimalGroup, number>> = {
  'urban-village': { chicken: 0, cow: 0, fish: 0 },
  old: { chicken: 1, cow: 0, fish: 0 },
  new: { chicken: 1, cow: 0, fish: 1 },
  villa: { chicken: 2, cow: 0, fish: 2 },
};

export const RANCH_LEASE_SLOTS: Record<AnimalGroup, number> = {
  chicken: 2,
  cow: 2,
  fish: 2,
};

export const RANCH_SIGNUP_FEE = 180;
export const RANCH_MONTHLY_RENT = 240;

export interface AnimalDef {
  id: string;
  name: string;
  aliases: readonly string[];
  group: AnimalGroup;
  price: number;
  feedCost: number;
  /** 周期副产间隔（小时），例如产蛋/产奶每 24h。0 = 无周期副产。 */
  cycleHours: number;
  cycleProductId?: string;
  cycleProductName?: string;
  cycleProductKind?: IngredientKind;
  cycleYield: number;
  /** 育成周期（小时），满期后可起塘（鱼）或出栏（鸡/牛）。 */
  matureHours: number;
  harvestProductId: string;
  harvestProductName: string;
  harvestProductKind: IngredientKind;
  harvestYield: number;
  note: string;
}

export const ANIMALS: readonly AnimalDef[] = [
  {
    id: 'hen',
    name: '散养土鸡',
    aliases: ['鸡', '土鸡', '母鸡', '蛋鸡', '小鸡'],
    group: 'chicken',
    price: 25,
    feedCost: 2,
    cycleHours: 24,
    cycleProductId: 'egg',
    cycleProductName: '鲜鸡蛋',
    cycleProductKind: 'egg_dairy',
    cycleYield: 2,
    matureHours: 120,
    harvestProductId: 'chicken_meat',
    harvestProductName: '土鸡肉',
    harvestProductKind: 'meat',
    harvestYield: 3,
    note: '每天产 2 枚鲜鸡蛋（本周期喂过食多收 1 枚，最多攒 3 天量）；养满 5 天后可出栏收 3 份土鸡肉（累计喂满 2 次再 +1 份）。',
  },
  {
    id: 'dairy_cow',
    name: '农庄奶牛',
    aliases: ['牛', '奶牛', '小牛', '黄牛'],
    group: 'cow',
    price: 120,
    feedCost: 5,
    cycleHours: 24,
    cycleProductId: 'milk',
    cycleProductName: '鲜牛奶',
    cycleProductKind: 'egg_dairy',
    cycleYield: 2,
    matureHours: 168,
    harvestProductId: 'beef',
    harvestProductName: '精选牛肉',
    harvestProductKind: 'meat',
    harvestYield: 5,
    note: '每天产 2 瓶鲜牛奶（本周期喂过食多收 1 瓶，需签约城郊农牧场）；养满 7 天后可出栏收 5 份精选牛肉（累计喂满 2 次再 +1 份）。',
  },
  {
    id: 'grass_carp',
    name: '塘养草鱼',
    aliases: ['草鱼', '鱼苗', '淡水鱼'],
    group: 'fish',
    price: 18,
    feedCost: 2,
    cycleHours: 0,
    cycleYield: 0,
    matureHours: 96,
    harvestProductId: 'fresh_fish',
    harvestProductName: '塘养鲜鱼',
    harvestProductKind: 'fish',
    harvestYield: 3,
    note: '4 天育成起塘收 3 份塘养鲜鱼（累计喂满 2 次再 +1 份），炖豆腐汤或葱烧都很鲜甜。',
  },
  {
    id: 'perch',
    name: '清江鲈鱼',
    aliases: ['鲈鱼', '清江鲈鱼'],
    group: 'fish',
    price: 28,
    feedCost: 3,
    cycleHours: 0,
    cycleYield: 0,
    matureHours: 144,
    harvestProductId: 'fresh_fish',
    harvestProductName: '清江鲜鲈鱼',
    harvestProductKind: 'fish',
    harvestYield: 4,
    note: '6 天育成起塘收 4 份清江鲜鲈鱼（累计喂满 2 次再 +1 份），肉质细嫩。',
  },
];

export interface RanchPen {
  id: string;
  animalId: string;
  name: string;
  group: AnimalGroup;
  startedAt: string;
  matureAt: string;
  lastCollectedAt: string;
  fedAt: string;
  fedDay: string;
  feedCount: number;
  /** 本产蛋/奶周期内是否已喂过（收完蛋奶后归 false，防一次喂食永久白嫖）。 */
  fedCycleBonus?: boolean;
  source: 'home' | 'leased';
}

export interface RanchState {
  leased: boolean;
  leasedSince: string;
  leasedMonthly: number;
  pens: RanchPen[];
}

export interface RanchPenView extends RanchPen {
  progress: number;
  hoursLeft: number;
  daysLeft: number;
  mature: boolean;
  fedToday: boolean;
  collectableCycles: number;
  collectableQty: number;
  collectProductName: string;
  harvestYield: number;
  harvestProductName: string;
  feedCost: number;
}

export interface RanchHostState {
  home: { tier: FarmHomeTier };
  money: { cash: number; spent: number };
  vitals: { energy: number };
  fitness: number;
  ranch: RanchState;
  pantry: PantryItem[];
  tellable: { id: string; text: string; at: string; said: boolean }[];
  moodlets: { id: string; source: string; text: string; kind: 'good' | 'bad'; expiresAt: string }[];
  updatedAt: string;
}

export function freshRanch(): RanchState {
  return { leased: false, leasedSince: '', leasedMonthly: RANCH_MONTHLY_RENT, pens: [] };
}

export function findAnimal(q: string): AnimalDef | null {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return null;
  return ANIMALS.find((a) =>
    a.id.toLowerCase() === s
    || a.name.toLowerCase() === s
    || a.name.toLowerCase().includes(s)
    || a.aliases.some((al) => al.toLowerCase() === s || s.includes(al.toLowerCase())),
  ) ?? null;
}

export function homeRanchSlots(tier: FarmHomeTier): Record<AnimalGroup, number> {
  const base = HOME_RANCH_SLOTS[tier] ?? HOME_RANCH_SLOTS['urban-village'];
  return { ...base };
}

export function totalRanchSlots(state: { home: { tier: FarmHomeTier }; ranch: RanchState }): Record<AnimalGroup, number> {
  const home = homeRanchSlots(state.home.tier);
  if (!state.ranch.leased) return home;
  return {
    chicken: home.chicken + RANCH_LEASE_SLOTS.chicken,
    cow: home.cow + RANCH_LEASE_SLOTS.cow,
    fish: home.fish + RANCH_LEASE_SLOTS.fish,
  };
}

export function normRanch(raw: unknown): RanchState {
  const base = freshRanch();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Partial<RanchState>;
  const validGroups = new Set<AnimalGroup>(['chicken', 'cow', 'fish']);
  const pens = Array.isArray(o.pens)
    ? o.pens
      .filter((p): p is RanchPen => Boolean(p && typeof p === 'object' && typeof p.id === 'string' && typeof p.animalId === 'string'))
      .map((p) => {
        const def = findAnimal(p.animalId);
        const grp = validGroups.has(p.group) ? p.group : (def?.group ?? 'chicken');
        return {
          id: p.id,
          animalId: p.animalId,
          name: String(p.name ?? def?.name ?? p.animalId),
          group: grp,
          startedAt: typeof p.startedAt === 'string' ? p.startedAt : '',
          matureAt: typeof p.matureAt === 'string' ? p.matureAt : '',
          lastCollectedAt: typeof p.lastCollectedAt === 'string' ? p.lastCollectedAt : (typeof p.startedAt === 'string' ? p.startedAt : ''),
          fedAt: typeof p.fedAt === 'string' ? p.fedAt : '',
          fedDay: typeof p.fedDay === 'string' ? p.fedDay : '',
          feedCount: Math.max(0, Math.round(Number(p.feedCount) || 0)),
          ...(typeof p.fedCycleBonus === 'boolean' ? { fedCycleBonus: p.fedCycleBonus } : {}),
          source: p.source === 'leased' ? 'leased' : 'home',
        };
      })
    : [];
  return {
    leased: Boolean(o.leased),
    leasedSince: typeof o.leasedSince === 'string' ? o.leasedSince : '',
    leasedMonthly: Number.isFinite(Number(o.leasedMonthly)) && Number(o.leasedMonthly) > 0
      ? Math.round(Number(o.leasedMonthly))
      : RANCH_MONTHLY_RENT,
    pens,
  };
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

/** 周期蛋奶单份成本（摊入本周期饲料费与幼苗日折旧）。 */
export function calcCycleProductUnitCost(def: AnimalDef, pen: RanchPen, qty: number): number {
  const matureDays = Math.max(1, Math.round(def.matureHours / 24));
  const depPerDay = def.price / matureDays;
  const feedPart = isPenFedThisCycle(pen) ? def.feedCost : 0;
  return Math.max(1, Math.round((feedPart + depPerDay) / Math.max(1, qty)));
}

/** 育成出栏/起塘肉鱼单份成本（幼苗本金 + 累计实喂饲料全额摊入）。 */
export function calcHarvestProductUnitCost(def: AnimalDef, pen: RanchPen, qty: number): number {
  const totalFeedCost = Math.max(0, pen.feedCount) * def.feedCost;
  return Math.max(2, Math.round((def.price + totalFeedCost) / Math.max(1, qty)));
}

function isPenFedThisCycle(pen: RanchPen): boolean {
  if (typeof pen.fedCycleBonus === 'boolean') return pen.fedCycleBonus;
  const lastMs = Date.parse(pen.lastCollectedAt || pen.startedAt);
  const fedMs = pen.fedAt ? Date.parse(pen.fedAt) : NaN;
  return Number.isFinite(fedMs) && Number.isFinite(lastMs) && fedMs > lastMs;
}

export function ranchPenView(pen: RanchPen, now: Date): RanchPenView {
  const def = findAnimal(pen.animalId) ?? ANIMALS[0];
  const startMs = Date.parse(pen.startedAt);
  const endMs = Date.parse(pen.matureAt);
  const nowMs = now.getTime();
  const totalMs = Math.max(3_600_000, endMs - startMs);
  const elapsedMs = Math.max(0, nowMs - startMs);
  const progress = Math.max(0, Math.min(1, Number.isFinite(startMs) && Number.isFinite(endMs) ? elapsedMs / totalMs : 0));
  const remMs = Math.max(0, endMs - nowMs);
  const hoursLeft = Math.round((remMs / 3_600_000) * 10) / 10;
  const daysLeft = Math.round((remMs / 86_400_000) * 10) / 10;
  const mature = Number.isFinite(endMs) && nowMs >= endMs;
  const today = fmtLocalDay(now);
  const fedToday = pen.fedDay === today;

  let collectableCycles = 0;
  let collectableQty = 0;
  if (def.cycleHours > 0) {
    const lastMs = Date.parse(pen.lastCollectedAt || pen.startedAt);
    if (Number.isFinite(lastMs)) {
      const cycleMs = def.cycleHours * 3_600_000;
      collectableCycles = Math.min(3, Math.max(0, Math.floor((nowMs - lastMs) / cycleMs)));
      if (collectableCycles > 0) {
        const bonus = isPenFedThisCycle(pen) ? 1 : 0;
        collectableQty = collectableCycles * def.cycleYield + bonus;
      }
    }
  }

  const harvestYield = def.harvestYield + (pen.feedCount >= 2 ? 1 : 0);
  return {
    ...pen,
    progress,
    hoursLeft,
    daysLeft,
    mature,
    fedToday,
    collectableCycles,
    collectableQty,
    collectProductName: def.cycleProductName ?? '',
    harvestYield,
    harvestProductName: def.harvestProductName,
    feedCost: def.feedCost,
  };
}

export function applyRentRanch(
  state: RanchHostState,
  now: Date,
  opts: { byUser?: boolean } = {},
): { ok: boolean; reason?: string; paid: number; cash: number } {
  if (state.ranch.leased) {
    return { ok: false, reason: '已经签约了城郊农牧场（+2鸡/+2牛/+2鱼，月租 240 元）。', paid: 0, cash: state.money.cash };
  }
  if (state.money.cash < RANCH_SIGNUP_FEE) {
    return {
      ok: false,
      reason: `签约城郊农牧场需要 ${RANCH_SIGNUP_FEE} 元起租费（之后月租 ${RANCH_MONTHLY_RENT} 元，按天扣 8 元），手上只有 ${Math.round(state.money.cash)} 元。`,
      paid: 0,
      cash: state.money.cash,
    };
  }
  state.money.cash -= RANCH_SIGNUP_FEE;
  state.money.spent += RANCH_SIGNUP_FEE;
  state.ranch.leased = true;
  state.ranch.leasedSince = now.toISOString();
  state.ranch.leasedMonthly = RANCH_MONTHLY_RENT;
  pushMemory(
    state,
    `${opts.byUser ? '你在面板上签下了' : '签下了'}城郊农牧场（鸡舍+2、牛棚+2、鱼塘+2，签约费 ${RANCH_SIGNUP_FEE} 元，月租 ${RANCH_MONTHLY_RENT} 元）。`,
    now,
  );
  state.updatedAt = now.toISOString();
  return { ok: true, paid: RANCH_SIGNUP_FEE, cash: state.money.cash };
}

export function applyUnrentRanch(
  state: RanchHostState,
  force: boolean,
  now: Date,
  opts: { byUser?: boolean } = {},
): { ok: boolean; reason?: string } {
  if (!state.ranch.leased) {
    return { ok: false, reason: '现在没有租着城郊农牧场。' };
  }
  const leasedPens = state.ranch.pens.filter((p) => p.source === 'leased');
  if (leasedPens.length > 0 && !(force && opts.byUser)) {
    const names = leasedPens.map((p) => p.name).join('、');
    return {
      ok: false,
      reason: opts.byUser
        ? `城郊农牧场里还有 ${names} 在养着，先收获出栏，或再次点击「确认退租」放弃场内在养止损。`
        : `城郊农牧场里还有 ${names} 在养着，必须先收获或出栏清空才能退租（若确实要放弃在养动物止损，请由用户在面板上二次确认退租）。`,
    };
  }
  state.ranch.pens = state.ranch.pens.filter((p) => p.source !== 'leased');
  state.ranch.leased = false;
  state.ranch.leasedSince = '';
  pushMemory(state, `${opts.byUser ? '你在面板上' : ''}退掉了城郊农牧场租约。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true };
}

export function applyBuyAnimal(
  state: RanchHostState,
  animalQuery: string,
  now: Date,
  opts: { byUser?: boolean } = {},
): { ok: boolean; reason?: string; pen?: RanchPen; paid: number; cash: number } {
  const def = findAnimal(animalQuery);
  if (!def) {
    const names = ANIMALS.map((a) => `${a.name}(${a.price}元)`).join('、');
    return { ok: false, reason: `没认出「${animalQuery || '空白'}」，可养：${names}。`, paid: 0, cash: state.money.cash };
  }
  const homeCap = homeRanchSlots(state.home.tier)[def.group];
  const maxCap = totalRanchSlots(state)[def.group];
  const usedInGroup = state.ranch.pens.filter((p) => p.group === def.group);
  if (maxCap <= 0) {
    const hint = def.group === 'cow'
      ? `养奶牛需要签约城郊农牧场（签约费 ${RANCH_SIGNUP_FEE} 元 + 月租 ${RANCH_MONTHLY_RENT} 元，自带 2 个牛棚）。`
      : `当前住处没有${ANIMAL_GROUP_LABEL[def.group]}位（老小区起有鸡舍，新小区起有鱼池），可以先搬家或花 ${RANCH_SIGNUP_FEE} 元签约城郊农牧场。`;
    return { ok: false, reason: hint, paid: 0, cash: state.money.cash };
  }
  if (usedInGroup.length >= maxCap) {
    return {
      ok: false,
      reason: state.ranch.leased
        ? `${ANIMAL_GROUP_LABEL[def.group]}的 ${maxCap} 个栏位都已经满了，等育成收获后再放养新的。`
        : `住处自带的 ${maxCap} 个${ANIMAL_GROUP_LABEL[def.group]}栏位已满——搬到更高档住处或签约城郊农牧场可扩展更多栏位。`,
      paid: 0,
      cash: state.money.cash,
    };
  }
  if (state.money.cash < def.price) {
    return {
      ok: false,
      reason: `放养「${def.name}」要 ${def.price} 元，手上只有 ${Math.round(state.money.cash)} 元。`,
      paid: 0,
      cash: state.money.cash,
    };
  }

  const homeUsed = usedInGroup.filter((p) => p.source === 'home').length;
  const source: 'home' | 'leased' = homeUsed < homeCap ? 'home' : 'leased';
  const pen: RanchPen = {
    id: `pen-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    animalId: def.id,
    name: def.name,
    group: def.group,
    startedAt: now.toISOString(),
    matureAt: new Date(now.getTime() + def.matureHours * 3_600_000).toISOString(),
    lastCollectedAt: now.toISOString(),
    fedAt: '',
    fedDay: '',
    feedCount: 0,
    source,
  };
  state.money.cash -= def.price;
  state.money.spent += def.price;
  state.ranch.pens.push(pen);
  const days = Math.round(def.matureHours / 24);
  const placeTxt = source === 'leased' ? '城郊农牧场' : `家里${ANIMAL_GROUP_LABEL[def.group]}`;
  pushMemory(
    state,
    `${opts.byUser ? '你在面板上帮我' : ''}在${placeTxt}放养了「${def.name}」（花 ${def.price} 元${def.cycleProductName ? `，每天可收${def.cycleProductName}` : ''}，约 ${days} 天育成）。`,
    now,
  );
  state.updatedAt = now.toISOString();
  return { ok: true, pen, paid: def.price, cash: state.money.cash };
}

export function applyFeedAnimal(
  state: RanchHostState,
  penId: string,
  now: Date,
  opts: { byUser?: boolean } = {},
): { ok: boolean; reason?: string; fed: number; paid: number; cash: number; energy: number } {
  if (!state.ranch.pens.length) {
    return { ok: false, reason: '牧场和鱼塘里还空着，先添几只小鸡、奶牛或鱼苗吧。', fed: 0, paid: 0, cash: state.money.cash, energy: state.vitals.energy };
  }
  const today = fmtLocalDay(now);
  const pickOne = penId ? state.ranch.pens.find((p) => p.id === penId) : null;
  if (penId && !pickOne) {
    return { ok: false, reason: `没找到 id 为「${penId}」的栏位。`, fed: 0, paid: 0, cash: state.money.cash, energy: state.vitals.energy };
  }
  const targets = pickOne ? [pickOne] : state.ranch.pens.filter((p) => p.fedDay !== today);
  if (!targets.length) {
    return { ok: false, reason: '在养的鸡牛鱼今天都已经喂过饲料啦，明天再来照料。', fed: 0, paid: 0, cash: state.money.cash, energy: state.vitals.energy };
  }
  const target = targets[0];
  if (target.fedDay === today) {
    return { ok: false, reason: `「${target.name}」今天已经喂过食了，每天一次就够。`, fed: 0, paid: 0, cash: state.money.cash, energy: state.vitals.energy };
  }
  const def = findAnimal(target.animalId) ?? ANIMALS[0];
  if (state.money.cash < def.feedCost) {
    return { ok: false, reason: `给「${target.name}」买饲料要 ${def.feedCost} 元，手上现金不够了。`, fed: 0, paid: 0, cash: state.money.cash, energy: state.vitals.energy };
  }
  if (!opts.byUser && state.vitals.energy < 5) {
    return { ok: false, reason: `精力只剩 ${Math.round(state.vitals.energy)} 点了，歇一歇再去喂食吧。`, fed: 0, paid: 0, cash: state.money.cash, energy: state.vitals.energy };
  }

  state.money.cash -= def.feedCost;
  state.money.spent += def.feedCost;
  if (!opts.byUser) state.vitals.energy = Math.max(0, state.vitals.energy - 3);
  target.feedCount += 1;
  target.fedAt = now.toISOString();
  target.fedDay = today;
  target.fedCycleBonus = true;
  pushMemory(state, `${opts.byUser ? '你在面板上顺手帮我喂了' : '提着饲料喂了'}「${target.name}」（饲料 ${def.feedCost} 元，已照料 ${target.feedCount} 次）。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true, fed: 1, paid: def.feedCost, cash: state.money.cash, energy: state.vitals.energy };
}

export function applyCollectRanch(
  state: RanchHostState,
  penId: string,
  now: Date,
  opts: { byUser?: boolean } = {},
): { ok: boolean; reason?: string; collected: { name: string; qty: number }[]; totalQty: number } {
  if (!state.ranch.pens.length) {
    return { ok: false, reason: '还没有在养的动物，先去放养土鸡或奶牛吧。', collected: [], totalQty: 0 };
  }
  const pickOne = penId ? state.ranch.pens.find((p) => p.id === penId) : null;
  if (penId && !pickOne) {
    return { ok: false, reason: `没找到 id 为「${penId}」的栏位。`, collected: [], totalQty: 0 };
  }
  const candidates = (pickOne ? [pickOne] : state.ranch.pens)
    .map((p) => ({ pen: p, view: ranchPenView(p, now) }))
    .filter(({ view }) => view.collectableQty > 0);

  if (!candidates.length) {
    if (pickOne) {
      const def = findAnimal(pickOne.animalId);
      if (!def?.cycleHours) {
        return { ok: false, reason: `「${pickOne.name}」是育成后整批起塘的，不产日常蛋奶。`, collected: [], totalQty: 0 };
      }
      return { ok: false, reason: `「${pickOne.name}」这批${def.cycleProductName}还没到时间，明天再来收。`, collected: [], totalQty: 0 };
    }
    return { ok: false, reason: '眼下还没有积攒出可收的鲜鸡蛋或鲜牛奶，过一天再来看看。', collected: [], totalQty: 0 };
  }

  const collected: { name: string; qty: number }[] = [];
  let totalQty = 0;
  for (const { pen, view } of candidates) {
    const def = findAnimal(pen.animalId);
    if (!def || !def.cycleProductId || !def.cycleProductName) continue;
    const qty = view.collectableQty;
    const unitCost = calcCycleProductUnitCost(def, pen, qty);
    addPantryItem(state.pantry, {
      itemId: def.cycleProductId,
      kind: def.cycleProductKind ?? 'egg_dairy',
      name: def.cycleProductName,
      qty,
      freshVeg: true,
      origin: 'ranch',
      unitCost,
      acquiredAt: now.toISOString(),
    });
    pen.lastCollectedAt = now.toISOString();
    pen.fedCycleBonus = false;
    collected.push({ name: def.cycleProductName, qty });
    totalQty += qty;
  }

  const sumStr = collected.map((c) => `${c.name}×${c.qty}`).join('、');
  state.moodlets = state.moodlets.filter((m) => m.source !== 'ranch-collect');
  state.moodlets.push({
    id: `m-rc-${now.getTime().toString(36)}`,
    source: 'ranch-collect',
    text: `收了新鲜的 ${sumStr}，篮子里沉甸甸的`,
    kind: 'good',
    expiresAt: new Date(now.getTime() + 4 * 3_600_000).toISOString(),
  });
  pushMemory(state, `${opts.byUser ? '你在面板上收好了' : '在农牧场收了'} ${sumStr}，存进储物篮。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true, collected, totalQty };
}

export function applyHarvestRanch(
  state: RanchHostState,
  penId: string,
  now: Date,
  opts: { byUser?: boolean } = {},
): { ok: boolean; reason?: string; harvested: { name: string; qty: number }[]; totalQty: number } {
  if (!state.ranch.pens.length) {
    return { ok: false, reason: '养殖栏位眼下都空着呢。', harvested: [], totalQty: 0 };
  }
  const target = penId ? state.ranch.pens.find((p) => p.id === penId) : null;
  if (penId && !target) {
    return { ok: false, reason: `没找到 id 为「${penId}」的栏位。`, harvested: [], totalQty: 0 };
  }

  // 不传 penId 时，仅自动起塘已成熟的鱼塘，避免误把持续产蛋产奶的鸡牛一键出栏
  const candidates = target
    ? [target]
    : state.ranch.pens.filter((p) => p.group === 'fish' && Date.parse(p.matureAt) <= now.getTime());

  if (!candidates.length) {
    const earliest = state.ranch.pens
      .map((p) => ranchPenView(p, now))
      .sort((a, b) => a.hoursLeft - b.hoursLeft)[0];
    return {
      ok: false,
      reason: earliest
        ? `暂时没有可直接自动起塘的鱼塘（鸡舍和牛棚需指定栏位出栏）。最近一期「${earliest.name}」育成还需 ${earliest.daysLeft} 天。`
        : '暂时没有成熟可收获的养殖产出。',
      harvested: [],
      totalQty: 0,
    };
  }

  if (target && Date.parse(target.matureAt) > now.getTime()) {
    const view = ranchPenView(target, now);
    return {
      ok: false,
      reason: `「${target.name}」还在生长中，还要 ${view.daysLeft} 天（${view.hoursLeft} 小时）才育成。`,
      harvested: [],
      totalQty: 0,
    };
  }

  const harvested: { name: string; qty: number }[] = [];
  let totalQty = 0;
  const harvestedIds = new Set<string>();
  for (const pen of candidates) {
    const def = findAnimal(pen.animalId) ?? ANIMALS[0];
    const view = ranchPenView(pen, now);
    const qty = view.harvestYield;
    const unitCost = calcHarvestProductUnitCost(def, pen, qty);
    addPantryItem(state.pantry, {
      itemId: def.harvestProductId,
      kind: def.harvestProductKind,
      name: def.harvestProductName,
      qty,
      freshVeg: true,
      origin: 'ranch',
      unitCost,
      acquiredAt: now.toISOString(),
    });
    harvested.push({ name: def.harvestProductName, qty });
    totalQty += qty;
    harvestedIds.add(pen.id);
  }
  state.ranch.pens = state.ranch.pens.filter((p) => !harvestedIds.has(p.id));
  if (!opts.byUser) state.fitness = Math.min(100, Math.max(5, (state.fitness ?? 25) + 0.3));

  const sumStr = harvested.map((h) => `${h.name}×${h.qty}`).join('、');
  state.moodlets = state.moodlets.filter((m) => m.source !== 'ranch-harvest');
  state.moodlets.push({
    id: `m-rh-${now.getTime().toString(36)}`,
    source: 'ranch-harvest',
    text: `农牧场收获了 ${sumStr}，厨房备料顿时充裕起来`,
    kind: 'good',
    expiresAt: new Date(now.getTime() + 5 * 3_600_000).toISOString(),
  });
  pushMemory(state, `${opts.byUser ? '你在面板上帮忙起塘/收获了' : '从农牧场收获了'} ${sumStr}，放进了储物篮。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true, harvested, totalQty };
}

/* ------------------------------------------------------------------ */
/* 农牧帮手（离线 / 旅行自动浇水、喂食、收蛋奶与全托管）                */
/* ------------------------------------------------------------------ */

export type HelperMode = 'off' | 'care' | 'full';

export const NEIGHBOR_ERRAND_TTL_HOURS = 6;

export const HELPER_PLANS: Record<Exclude<HelperMode, 'off'>, {
  mode: Exclude<HelperMode, 'off'>;
  label: string;
  dailyWage: number;
  note: string;
}> = {
  care: {
    mode: 'care',
    label: '日常照料工',
    dailyWage: 12,
    note: '每日自动给菜地浇水、给鸡牛鱼喂食（实扣饲料费），并把满 24h 的鲜鸡蛋和鲜牛奶收进储物篮（当日活已干完或空场不扣工钱）。',
  },
  full: {
    mode: 'full',
    label: '农牧全托管',
    dailyWage: 20,
    note: '含日常照料全部内容，外加自动收割成熟蔬菜与起塘成熟鱼塘入储物篮（绝不擅自出栏产蛋产奶的鸡牛；当日活已干完或空场不扣工钱）。',
  },
};

export interface PendingFarmErrand {
  stallId: string;
  day: string;
  mode: Exclude<HelperMode, 'off'>;
  wage: number;
  minutes: number;
  postedAt: string;
  expiresAt: string;
}

export interface NeighborErrandQuote {
  mode: Exclude<HelperMode, 'off'>;
  plots: number;
  pens: number;
  wage: number;
  minutes: number;
  itemLabel: string;
}

export interface PendingFarmWork {
  unwateredPlots: number;
  unfedPens: number;
  collectablePens: number;
  readyPlots: number;
  readyFishPens: number;
  workPlots: number;
  workPens: number;
  total: number;
}

export interface FarmHelperState {
  mode: HelperMode;
  dailyWage: number;
  hiredAt: string;
  lastRunDay: string;
  lastSummary: string;
  /** 是否优先发鱼市街邻里真鱼代管委托（找不到再退预扣并回落自动照料）。 */
  preferNeighbor: boolean;
  /** 当前挂在鱼市街等待街坊接单的农牧代管委托。 */
  pendingErrand: PendingFarmErrand | null;
  /** 本机发过的农牧委托摊位 ID 历史（防超时后成交回执重复给雇主进账）。 */
  errandStallIds: string[];
}

export interface HelperRunSummary {
  days: number;
  wagePaid: number;
  feedPaid: number;
  watered: number;
  fed: number;
  collectedQty: number;
  harvestedQty: number;
  pausedByLowCash: boolean;
  errandRefunded?: number;
  summary: string;
}

export interface HelperHostState extends RanchHostState {
  farm: FarmState;
  freshVegUntil?: string;
  farmHelper: FarmHelperState;
}

export function freshFarmHelper(): FarmHelperState {
  return {
    mode: 'off',
    dailyWage: 0,
    hiredAt: '',
    lastRunDay: '',
    lastSummary: '',
    preferNeighbor: true,
    pendingErrand: null,
    errandStallIds: [],
  };
}

function normPendingErrand(raw: unknown): PendingFarmErrand | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Partial<PendingFarmErrand>;
  const stallId = typeof o.stallId === 'string' ? o.stallId.trim() : '';
  const day = typeof o.day === 'string' ? o.day.trim() : '';
  const postedAt = typeof o.postedAt === 'string' ? o.postedAt : '';
  const expiresAt = typeof o.expiresAt === 'string' ? o.expiresAt : '';
  const wage = Math.round(Number(o.wage));
  const minutes = Math.round(Number(o.minutes));
  const mode: Exclude<HelperMode, 'off'> = o.mode === 'full' ? 'full' : 'care';
  if (!stallId || !day || !postedAt || !expiresAt || !Number.isFinite(wage) || wage <= 0) return null;
  return {
    stallId,
    day,
    mode,
    wage,
    minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 25,
    postedAt,
    expiresAt,
  };
}

export function normFarmHelper(raw: unknown): FarmHelperState {
  const base = freshFarmHelper();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Partial<FarmHelperState>;
  const mode: HelperMode = o.mode === 'care' || o.mode === 'full' ? o.mode : 'off';
  const dailyWage = mode === 'off'
    ? 0
    : (Number.isFinite(Number(o.dailyWage)) && Number(o.dailyWage) > 0
      ? Math.round(Number(o.dailyWage))
      : HELPER_PLANS[mode].dailyWage);
  const errandStallIds = Array.isArray(o.errandStallIds)
    ? o.errandStallIds.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(-100)
    : [];
  return {
    mode,
    dailyWage,
    hiredAt: typeof o.hiredAt === 'string' ? o.hiredAt : '',
    lastRunDay: typeof o.lastRunDay === 'string' ? o.lastRunDay : '',
    lastSummary: typeof o.lastSummary === 'string' ? o.lastSummary : '',
    preferNeighbor: typeof o.preferNeighbor === 'boolean' ? o.preferNeighbor : true,
    pendingErrand: normPendingErrand(o.pendingErrand),
    errandStallIds,
  };
}

/** 精确统计指定日期（now）农牧场实际尚未完成的待干活数量；全部干完时 total = 0。 */
export function countPendingFarmWork(
  state: Pick<HelperHostState, 'farm' | 'ranch'>,
  mode: Exclude<HelperMode, 'off'>,
  now: Date,
): PendingFarmWork {
  const dayKey = fmtLocalDay(now);
  const nowMs = now.getTime();

  let unwateredPlots = 0;
  let readyPlots = 0;
  for (const plot of state.farm.plots) {
    if (Date.parse(plot.matureAt) <= nowMs) {
      if (mode === 'full') readyPlots += 1;
    } else if (plot.wateredDay !== dayKey) {
      unwateredPlots += 1;
    }
  }

  let unfedPens = 0;
  let collectablePens = 0;
  let readyFishPens = 0;
  const workPenIds = new Set<string>();
  for (const pen of state.ranch.pens) {
    let penNeedsWork = false;
    if (pen.fedDay !== dayKey) {
      unfedPens += 1;
      penNeedsWork = true;
    }
    const def = findAnimal(pen.animalId);
    if (def && def.cycleHours > 0 && ranchPenView(pen, now).collectableQty > 0) {
      collectablePens += 1;
      penNeedsWork = true;
    }
    if (mode === 'full' && pen.group === 'fish' && Date.parse(pen.matureAt) <= nowMs) {
      readyFishPens += 1;
      penNeedsWork = true;
    }
    if (penNeedsWork) workPenIds.add(pen.id);
  }

  const workPlots = unwateredPlots + readyPlots;
  const workPens = workPenIds.size;
  const total = unwateredPlots + unfedPens + collectablePens + readyPlots + readyFishPens;
  return {
    unwateredPlots,
    unfedPens,
    collectablePens,
    readyPlots,
    readyFishPens,
    workPlots,
    workPens,
    total,
  };
}

/** 计算邻里真鱼代管报价与动态耗时：比系统自动照料便宜，耗时按动植物数量增减。 */
export function calcNeighborErrandQuote(
  plotsCount: number,
  pensCount: number,
  mode: Exclude<HelperMode, 'off'>,
): NeighborErrandQuote {
  const plots = Math.max(0, Math.round(Number(plotsCount) || 0));
  const pens = Math.max(0, Math.round(Number(pensCount) || 0));
  const units = plots + pens;
  const wage = mode === 'full'
    ? Math.min(15, 10 + Math.floor(units / 2))
    : Math.min(9, 6 + Math.floor(units / 2));
  const minutes = mode === 'full'
    ? Math.max(20, Math.min(90, 16 + plots * 6 + pens * 10))
    : Math.max(15, Math.min(90, 12 + plots * 5 + pens * 8));
  const modeTag = mode === 'full' ? '全托' : '照料';
  const itemLabel = `农牧代管·${modeTag}(${plots}菜${pens}牧/${minutes}分)`;
  return { mode, plots, pens, wage, minutes, itemLabel };
}

/** 从邻里代管委托名称中解析预估干活时长（分钟）。 */
export function parseErrandMinutes(item: string): number {
  const m = /(\d+)\s*分/.exec(String(item || ''));
  if (!m) return 25;
  const n = Math.round(Number(m[1]));
  if (!Number.isFinite(n)) return 25;
  return Math.max(15, Math.min(90, n));
}

function parseLocalDay(dayKey: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  return Number.isFinite(d.getTime()) ? d : null;
}

function addLocalDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12, 0, 0, 0);
}

interface HelperDayStep {
  wagePaid: number;
  feedPaid: number;
  watered: number;
  fed: number;
  collectedItems: Map<string, number>;
  harvestedItems: Map<string, number>;
  idleDay: boolean;
  idleReason?: 'empty' | 'done';
  pausedByLowCash: boolean;
}

function runHelperTasksForDate(
  state: HelperHostState,
  mode: Exclude<HelperMode, 'off'>,
  dayDate: Date,
  opts: { skipWage: boolean },
): HelperDayStep {
  const dayKey = fmtLocalDay(dayDate);
  const nowMs = dayDate.getTime();
  const collectedItems = new Map<string, number>();
  const harvestedItems = new Map<string, number>();

  const pending = countPendingFarmWork(state, mode, dayDate);
  if (pending.total === 0) {
    state.farmHelper.lastRunDay = dayKey;
    const isEmpty = state.farm.plots.length === 0 && state.ranch.pens.length === 0;
    return {
      wagePaid: 0,
      feedPaid: 0,
      watered: 0,
      fed: 0,
      collectedItems,
      harvestedItems,
      idleDay: true,
      idleReason: isEmpty ? 'empty' : 'done',
      pausedByLowCash: false,
    };
  }

  let wagePaid = 0;
  const wageNeed = HELPER_PLANS[mode].dailyWage;
  if (!opts.skipWage) {
    if (state.money.cash < wageNeed) {
      state.farmHelper.mode = 'off';
      state.farmHelper.dailyWage = 0;
      state.farmHelper.lastRunDay = dayKey;
      return {
        wagePaid: 0,
        feedPaid: 0,
        watered: 0,
        fed: 0,
        collectedItems,
        harvestedItems,
        idleDay: false,
        pausedByLowCash: true,
      };
    }
    state.money.cash -= wageNeed;
    state.money.spent += wageNeed;
    wagePaid = wageNeed;
  }

  // 1) 给当天未浇水且未成熟的菜地浇水（帮手代劳不扣她精力）
  let watered = 0;
  for (const plot of state.farm.plots) {
    if (Date.parse(plot.matureAt) <= nowMs) continue;
    if (plot.wateredDay === dayKey) continue;
    plot.waterCount += 1;
    plot.wateredAt = dayDate.toISOString();
    plot.wateredDay = dayKey;
    watered += 1;
  }

  // 2) 给当天未喂食的鸡/牛/鱼喂食（实扣对应饲料费，钱不够时跳过喂食）
  let fed = 0;
  let feedPaid = 0;
  for (const pen of state.ranch.pens) {
    if (pen.fedDay === dayKey) continue;
    const def = findAnimal(pen.animalId) ?? ANIMALS[0];
    if (state.money.cash < def.feedCost) continue;
    state.money.cash -= def.feedCost;
    state.money.spent += def.feedCost;
    feedPaid += def.feedCost;
    pen.feedCount += 1;
    pen.fedAt = dayDate.toISOString();
    pen.fedDay = dayKey;
    pen.fedCycleBonus = true;
    fed += 1;
  }

  // 3) 收取满 24h 的鲜鸡蛋 / 鲜牛奶，防止离线多日溢出 3 周期上限
  for (const pen of state.ranch.pens) {
    const def = findAnimal(pen.animalId);
    if (!def || !def.cycleHours || !def.cycleProductId || !def.cycleProductName) continue;
    const view = ranchPenView(pen, dayDate);
    if (view.collectableQty <= 0) continue;
    const unitCost = calcCycleProductUnitCost(def, pen, view.collectableQty);
    addPantryItem(state.pantry, {
      itemId: def.cycleProductId,
      kind: def.cycleProductKind ?? 'egg_dairy',
      name: def.cycleProductName,
      qty: view.collectableQty,
      freshVeg: true,
      origin: 'ranch',
      unitCost,
      acquiredAt: dayDate.toISOString(),
    });
    pen.lastCollectedAt = dayDate.toISOString();
    pen.fedCycleBonus = false;
    collectedItems.set(def.cycleProductName, (collectedItems.get(def.cycleProductName) ?? 0) + view.collectableQty);
  }

  // 4) 全托管模式：收割成熟蔬菜与起塘成熟鱼塘（绝不擅自出栏产蛋产奶的鸡牛）
  if (mode === 'full') {
    const keepPlots: FarmState['plots'] = [];
    let vegHarvested = false;
    for (const plot of state.farm.plots) {
      if (Date.parse(plot.matureAt) > nowMs) {
        keepPlots.push(plot);
        continue;
      }
      const view = farmPlotView(plot, dayDate);
      const qty = view.expectedYield;
      const sd = findSeed(plot.seedId);
      const unitCost = Math.max(1, Math.round((sd?.price ?? 8) / Math.max(1, qty)));
      addPantryItem(state.pantry, {
        itemId: plot.seedId,
        kind: sd?.category ?? 'veg',
        name: plot.name,
        qty,
        freshVeg: true,
        origin: 'home-grown',
        unitCost,
        acquiredAt: dayDate.toISOString(),
      });
      harvestedItems.set(plot.name, (harvestedItems.get(plot.name) ?? 0) + qty);
      vegHarvested = true;
    }
    state.farm.plots = keepPlots;
    if (vegHarvested) {
      const nextVegMs = dayDate.getTime() + 24 * 3_600_000;
      const oldVegMs = state.freshVegUntil ? Date.parse(state.freshVegUntil) : 0;
      if (!Number.isFinite(oldVegMs) || nextVegMs > oldVegMs) {
        state.freshVegUntil = new Date(nextVegMs).toISOString();
      }
    }

    const keepPens: RanchPen[] = [];
    for (const pen of state.ranch.pens) {
      if (pen.group !== 'fish' || Date.parse(pen.matureAt) > nowMs) {
        keepPens.push(pen);
        continue;
      }
      const def = findAnimal(pen.animalId) ?? ANIMALS[0];
      const view = ranchPenView(pen, dayDate);
      const qty = view.harvestYield;
      const unitCost = calcHarvestProductUnitCost(def, pen, qty);
      addPantryItem(state.pantry, {
        itemId: def.harvestProductId,
        kind: def.harvestProductKind,
        name: def.harvestProductName,
        qty,
        freshVeg: true,
        origin: 'ranch',
        unitCost,
        acquiredAt: dayDate.toISOString(),
      });
      harvestedItems.set(def.harvestProductName, (harvestedItems.get(def.harvestProductName) ?? 0) + qty);
    }
    state.ranch.pens = keepPens;
  }

  state.farmHelper.lastRunDay = dayKey;
  return {
    wagePaid,
    feedPaid,
    watered,
    fed,
    collectedItems,
    harvestedItems,
    idleDay: false,
    pausedByLowCash: false,
  };
}

function mergeCountMap(dst: Map<string, number>, src: Map<string, number>): void {
  for (const [k, v] of src) dst.set(k, (dst.get(k) ?? 0) + v);
}

function sumMap(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

function fmtCountMap(m: Map<string, number>): string {
  return [...m.entries()].map(([k, v]) => `${k}×${v}`).join('、');
}

function buildHelperReport(
  days: number,
  wagePaid: number,
  feedPaid: number,
  watered: number,
  fed: number,
  collected: Map<string, number>,
  harvested: Map<string, number>,
  idleDays: number,
  pausedByLowCash: boolean,
  allEmpty = true,
): string {
  const segs: string[] = [];
  if (watered > 0) segs.push(`浇菜 ${watered} 次`);
  if (fed > 0) segs.push(`喂食 ${fed} 次`);
  const colStr = fmtCountMap(collected);
  if (colStr) segs.push(`收了 ${colStr}`);
  const harStr = fmtCountMap(harvested);
  if (harStr) segs.push(`收获 ${harStr}`);
  const costParts: string[] = [];
  if (wagePaid > 0) costParts.push(`工钱 ¥${wagePaid}`);
  if (feedPaid > 0) costParts.push(`饲料 ¥${feedPaid}`);

  if (pausedByLowCash) {
    const donePart = segs.length ? `此前已完成 ${segs.join('、')}（${costParts.join(' + ')}），但` : '';
    return `${donePart}手上现金不够发帮手工钱了，帮手已自动暂停（可在面板或对话里重新雇用）。`;
  }
  if (!segs.length && idleDays > 0 && wagePaid === 0) {
    return allEmpty
      ? '农牧场这几天都空着，帮手没出工不收费。'
      : '今日农牧活都已照料完毕，自动帮手没出工不扣费。';
  }
  const dayTag = days > 1 ? `近 ${days} 天` : '今日';
  const body = segs.length ? segs.join('、') : '巡看照料一圈';
  const costTag = costParts.length ? `（${costParts.join('、')}）` : '';
  return `${dayTag}帮手代管：${body}${costTag}。`;
}

/** 登记已发到鱼市街的农牧邻里代管委托并托管预扣工钱。 */
export function recordPostedNeighborErrand(
  state: HelperHostState,
  opts: {
    stallId: string;
    mode: Exclude<HelperMode, 'off'>;
    wage: number;
    minutes: number;
    now: Date;
  },
): { ok: boolean; reason?: string; errand?: PendingFarmErrand } {
  const wage = Math.round(Number(opts.wage));
  const minutes = Math.round(Number(opts.minutes));
  const stallId = String(opts.stallId || '').trim();
  if (!stallId || !(wage > 0)) {
    return { ok: false, reason: '委托编号或工钱无效。' };
  }
  if (state.money.cash < wage) {
    return { ok: false, reason: `发邻里代管委托需先托管预扣 ¥${wage} 工钱，手上只有 ${Math.round(state.money.cash)} 元。` };
  }
  state.money.cash -= wage;
  state.money.spent += wage;
  const errand: PendingFarmErrand = {
    stallId,
    day: fmtLocalDay(opts.now),
    mode: opts.mode,
    wage,
    minutes: Math.max(15, Math.min(90, minutes || 25)),
    postedAt: opts.now.toISOString(),
    expiresAt: new Date(opts.now.getTime() + NEIGHBOR_ERRAND_TTL_HOURS * 3_600_000).toISOString(),
  };
  state.farmHelper.pendingErrand = errand;
  const ids = state.farmHelper.errandStallIds ?? (state.farmHelper.errandStallIds = []);
  if (!ids.includes(stallId)) ids.push(stallId);
  if (ids.length > 100) state.farmHelper.errandStallIds = ids.slice(-100);
  state.farmHelper.lastSummary = `已发鱼市街邻里代管委托（预扣 ¥${wage} · 约 ${errand.minutes} 分钟），等待街坊接单；${NEIGHBOR_ERRAND_TTL_HOURS} 小时无人接自动退回。`;
  pushMemory(state, state.farmHelper.lastSummary, opts.now);
  state.updatedAt = opts.now.toISOString();
  return { ok: true, errand };
}

/** 街坊真鱼接单后，免费为雇主执行当日农牧照料（不扣自动照料工钱，只实扣饲料费）。 */
export function applyNeighborErrandCompleted(
  state: HelperHostState,
  buyerPet: string,
  now: Date,
  opts: { stallId?: string; mode?: Exclude<HelperMode, 'off'> } = {},
): { ok: boolean; feedPaid: number; summary: string } {
  const pe = state.farmHelper.pendingErrand;
  const mode: Exclude<HelperMode, 'off'> = opts.mode ?? pe?.mode ?? (state.farmHelper.mode === 'full' ? 'full' : 'care');
  const wage = pe?.wage ?? 0;
  const step = runHelperTasksForDate(state, mode, now, { skipWage: true });
  state.farmHelper.pendingErrand = null;

  const segs: string[] = [];
  if (step.watered > 0) segs.push(`浇菜 ${step.watered} 次`);
  if (step.fed > 0) segs.push(`喂食 ${step.fed} 次`);
  const colStr = fmtCountMap(step.collectedItems);
  if (colStr) segs.push(`收了 ${colStr}`);
  const harStr = fmtCountMap(step.harvestedItems);
  if (harStr) segs.push(`收获 ${harStr}`);
  const workTxt = segs.length ? segs.join('、') : '顺手照看一圈';
  const feeTxt = [
    wage > 0 ? `邻里工钱 ¥${wage}` : '',
    step.feedPaid > 0 ? `饲料 ¥${step.feedPaid}` : '',
  ].filter(Boolean).join(' + ');
  const summary = `街坊${buyerPet || '邻居'}帮忙照料了农牧场：${workTxt}${feeTxt ? `（${feeTxt}）` : ''}，今日不再扣自动照料费。`;
  state.farmHelper.lastSummary = summary;
  state.moodlets = state.moodlets.filter((m) => m.source !== 'neighbor-errand');
  state.moodlets.push({
    id: `m-ne-${now.getTime().toString(36)}`,
    source: 'neighbor-errand',
    text: `街坊${buyerPet || '邻居'}帮忙照看好了家里农牧场，省钱又暖心`,
    kind: 'good',
    expiresAt: new Date(now.getTime() + 4 * 3_600_000).toISOString(),
  });
  pushMemory(state, summary, now);
  state.updatedAt = now.toISOString();
  return { ok: true, feedPaid: step.feedPaid, summary };
}

/** 若鱼市街挂着的邻里代管单已超 6h 无人接或已跨日，原路退还预扣工钱到雇主钱包。 */
export function refundExpiredErrand(
  state: HelperHostState,
  now: Date,
): { refunded: number; day: string; mode: Exclude<HelperMode, 'off'> } | null {
  const pe = state.farmHelper.pendingErrand;
  if (!pe) return null;
  const todayKey = fmtLocalDay(now);
  const expMs = Date.parse(pe.expiresAt);
  const expired = (Number.isFinite(expMs) && now.getTime() >= expMs) || pe.day !== todayKey;
  if (!expired) return null;

  state.money.cash += pe.wage;
  state.money.spent = Math.max(0, state.money.spent - pe.wage);
  state.farmHelper.pendingErrand = null;
  state.farmHelper.lastSummary = `鱼市街农牧代管委托无人接单已到期，预扣 ¥${pe.wage} 原路退回${state.farmHelper.mode !== 'off' ? '，已转系统自动照料兜底' : ''}。`;
  pushMemory(state, state.farmHelper.lastSummary, now);
  state.updatedAt = now.toISOString();
  return { refunded: pe.wage, day: pe.day, mode: pe.mode };
}

export function runFarmHelperCatchup(state: HelperHostState, now: Date): HelperRunSummary | null {
  const expired = refundExpiredErrand(state, now);
  const refundedAmt = expired?.refunded ?? 0;

  if (state.farmHelper.mode === 'off') {
    if (refundedAmt > 0) {
      return {
        days: 0,
        wagePaid: 0,
        feedPaid: 0,
        watered: 0,
        fed: 0,
        collectedQty: 0,
        harvestedQty: 0,
        pausedByLowCash: false,
        errandRefunded: refundedAmt,
        summary: state.farmHelper.lastSummary,
      };
    }
    return null;
  }

  const mode = state.farmHelper.mode;
  const todayKey = fmtLocalDay(now);
  const hasActiveErrandToday = Boolean(
    state.farmHelper.pendingErrand && state.farmHelper.pendingErrand.day === todayKey,
  );

  if (state.farmHelper.lastRunDay === todayKey) {
    if (refundedAmt > 0) {
      return {
        days: 0,
        wagePaid: 0,
        feedPaid: 0,
        watered: 0,
        fed: 0,
        collectedQty: 0,
        harvestedQty: 0,
        pausedByLowCash: false,
        errandRefunded: refundedAmt,
        summary: state.farmHelper.lastSummary,
      };
    }
    return null;
  }

  const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  const lastDay = parseLocalDay(state.farmHelper.lastRunDay);
  const dates: Date[] = [];

  if (!lastDay) {
    if (!hasActiveErrandToday) dates.push(now);
  } else {
    const diffDays = Math.round((todayNoon.getTime() - lastDay.getTime()) / 86_400_000);
    if (diffDays <= 0) {
      if (refundedAmt > 0) {
        return {
          days: 0,
          wagePaid: 0,
          feedPaid: 0,
          watered: 0,
          fed: 0,
          collectedQty: 0,
          harvestedQty: 0,
          pausedByLowCash: false,
          errandRefunded: refundedAmt,
          summary: state.farmHelper.lastSummary,
        };
      }
      return null;
    }
    const span = Math.min(7, diffDays);
    const startOffset = diffDays - span + 1;
    for (let i = startOffset; i <= diffDays; i++) {
      if (i === diffDays && hasActiveErrandToday) continue;
      dates.push(i === diffDays ? now : addLocalDays(lastDay, i));
    }
  }

  if (!dates.length) {
    if (refundedAmt > 0) {
      return {
        days: 0,
        wagePaid: 0,
        feedPaid: 0,
        watered: 0,
        fed: 0,
        collectedQty: 0,
        harvestedQty: 0,
        pausedByLowCash: false,
        errandRefunded: refundedAmt,
        summary: state.farmHelper.lastSummary,
      };
    }
    return null;
  }

  let wagePaid = 0;
  let feedPaid = 0;
  let watered = 0;
  let fed = 0;
  let idleDays = 0;
  let pausedByLowCash = false;
  const collected = new Map<string, number>();
  const harvested = new Map<string, number>();

  for (const d of dates) {
    const step = runHelperTasksForDate(state, mode, d, { skipWage: false });
    wagePaid += step.wagePaid;
    feedPaid += step.feedPaid;
    watered += step.watered;
    fed += step.fed;
    if (step.idleDay) idleDays += 1;
    mergeCountMap(collected, step.collectedItems);
    mergeCountMap(harvested, step.harvestedItems);
    if (step.pausedByLowCash) {
      pausedByLowCash = true;
      break;
    }
  }

  const collectedQty = sumMap(collected);
  const harvestedQty = sumMap(harvested);
  const allEmpty = state.farm.plots.length === 0 && state.ranch.pens.length === 0;
  const summary = buildHelperReport(
    dates.length,
    wagePaid,
    feedPaid,
    watered,
    fed,
    collected,
    harvested,
    idleDays,
    pausedByLowCash,
    allEmpty,
  );
  state.farmHelper.lastSummary = summary;

  if (wagePaid > 0 || feedPaid > 0 || watered > 0 || fed > 0 || collectedQty > 0 || harvestedQty > 0 || pausedByLowCash) {
    pushMemory(state, summary, now);
  }

  return {
    days: dates.length,
    wagePaid,
    feedPaid,
    watered,
    fed,
    collectedQty,
    harvestedQty,
    pausedByLowCash,
    ...(refundedAmt > 0 ? { errandRefunded: refundedAmt } : {}),
    summary,
  };
}

export function applyHireHelper(
  state: HelperHostState,
  modeQuery: string,
  now: Date,
  opts: { byUser?: boolean; preferNeighbor?: boolean; deferTodayForNeighbor?: boolean } = {},
): {
  ok: boolean;
  reason?: string;
  mode: HelperMode;
  paid: number;
  feedPaid: number;
  cash: number;
  summary: string;
} {
  const raw = String(modeQuery || 'care').trim().toLowerCase();
  const mode: Exclude<HelperMode, 'off'> = (raw === 'full' || /全|托管|收/.test(raw)) ? 'full' : 'care';
  const plan = HELPER_PLANS[mode];
  const todayKey = fmtLocalDay(now);
  const prevMode = state.farmHelper.mode;
  const prevWagePaidToday = state.farmHelper.lastRunDay === todayKey ? state.farmHelper.dailyWage : 0;

  if (typeof opts.preferNeighbor === 'boolean') {
    state.farmHelper.preferNeighbor = opts.preferNeighbor;
  }

  const pending = countPendingFarmWork(state, mode, now);
  const isEmpty = state.farm.plots.length === 0 && state.ranch.pens.length === 0;

  if (prevMode === mode && state.farmHelper.lastRunDay === todayKey && pending.total === 0) {
    return {
      ok: true,
      mode,
      paid: 0,
      feedPaid: 0,
      cash: state.money.cash,
      summary: `已经雇着「${plan.label}」（¥${plan.dailyWage}/天）啦，今日农牧活已经照料完毕。`,
    };
  }

  if (opts.deferTodayForNeighbor) {
    state.farmHelper.mode = mode;
    state.farmHelper.dailyWage = plan.dailyWage;
    if (!state.farmHelper.hiredAt || prevMode === 'off') {
      state.farmHelper.hiredAt = now.toISOString();
    }
    state.updatedAt = now.toISOString();
    return {
      ok: true,
      mode,
      paid: 0,
      feedPaid: 0,
      cash: state.money.cash,
      summary: state.farmHelper.lastSummary || `已启用「${plan.label}」，优先等待街坊真鱼接单，无人接再自动兜底。`,
    };
  }

  let needToday = 0;
  if (pending.total > 0) {
    needToday = prevWagePaidToday > 0 ? Math.max(0, plan.dailyWage - prevWagePaidToday) : plan.dailyWage;
  } else if (prevWagePaidToday === 0 && state.money.cash < plan.dailyWage) {
    return {
      ok: false,
      reason: `请「${plan.label}」日薪 ${plan.dailyWage} 元（有未完成的活才扣钱），手上至少得备够第一天工钱。`,
      mode: prevMode,
      paid: 0,
      feedPaid: 0,
      cash: state.money.cash,
      summary: '',
    };
  }

  if (needToday > 0 && state.money.cash < needToday) {
    return {
      ok: false,
      reason: `请「${plan.label}」今日需工钱 ${needToday} 元，手上只有 ${Math.round(state.money.cash)} 元。`,
      mode: prevMode,
      paid: 0,
      feedPaid: 0,
      cash: state.money.cash,
      summary: '',
    };
  }

  state.farmHelper.mode = mode;
  state.farmHelper.dailyWage = plan.dailyWage;
  if (!state.farmHelper.hiredAt || prevMode === 'off') {
    state.farmHelper.hiredAt = now.toISOString();
  }

  let paid = 0;
  let feedPaid = 0;
  let summary = '';

  if (pending.total > 0) {
    if (prevWagePaidToday > 0 && needToday > 0) {
      state.money.cash -= needToday;
      state.money.spent += needToday;
      paid += needToday;
    }
    const step = runHelperTasksForDate(state, mode, now, { skipWage: prevWagePaidToday > 0 });
    paid += step.wagePaid;
    feedPaid += step.feedPaid;
    summary = buildHelperReport(
      1,
      paid,
      feedPaid,
      step.watered,
      step.fed,
      step.collectedItems,
      step.harvestedItems,
      0,
      step.pausedByLowCash,
      isEmpty,
    );
  } else {
    state.farmHelper.lastRunDay = todayKey;
    summary = isEmpty
      ? `已聘请「${plan.label}」（¥${plan.dailyWage}/天，眼下农牧场空着不收费，放养或种下后自动开始照料）。`
      : `已聘请「${plan.label}」（¥${plan.dailyWage}/天，今日农牧活已经全部照料完，今天 0 元免扣，明天有活按天结算）。`;
  }

  state.farmHelper.lastSummary = summary;
  const who = opts.byUser ? '你在面板上' : '';
  pushMemory(state, `${who}雇了「${plan.label}」（¥${plan.dailyWage}/天，不在家也能照看菜地与牧场）。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true, mode, paid, feedPaid, cash: state.money.cash, summary };
}

export function applyUnhireHelper(
  state: HelperHostState,
  now: Date,
  opts: { byUser?: boolean } = {},
): { ok: boolean; reason?: string } {
  if (state.farmHelper.mode === 'off') {
    return { ok: false, reason: '眼下没有雇着农牧帮手。' };
  }
  const prevLabel = HELPER_PLANS[state.farmHelper.mode].label;
  state.farmHelper.mode = 'off';
  state.farmHelper.dailyWage = 0;
  const pe = state.farmHelper.pendingErrand;
  state.farmHelper.lastSummary = pe
    ? `已停雇${prevLabel}（今日鱼市街挂着的邻里单 ¥${pe.wage} 到期无人接会自动退回）。`
    : `已停雇${prevLabel}。`;
  pushMemory(state, `${opts.byUser ? '你在面板上' : ''}辞退了${prevLabel}。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true };
}
