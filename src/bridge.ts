/**
 * 桥：只读别人的东西。
 *
 * 这里一条写操作都没有，也**永远不该有**。位置、时间、城名都只有一个来源，
 * 生活层是读者不是作者。这个约束不是洁癖 —— 一旦这边也开始写位置，
 * 两个扩展就会各说一套，而她到底是「在佛山」还是「在家」会变成一个谜。
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { clampWeatherTimeoutMs, normWeatherUrl, parseTownUrls, skyFromExternal, type WeatherSky } from './config.ts';
import { STALL_CATEGORY_LABEL, type StallCategory } from './farm.ts';

export { STALL_CATEGORY_LABEL, type StallCategory };

/* ------------------------------------------------------------------ */
/* journey：她在哪、那边几点                                            */
/* ------------------------------------------------------------------ */

/** journey 广播出来的那一份。这里只声明要读的几格，别的一概不碰。 */
export interface JourneyView {
  installed: boolean;
  /** `home` / `staying` / `traveling`。不明时给空串。 */
  phase: '' | 'home' | 'staying' | 'traveling';
  /** 城市 id。**`traveling` 时这是出发地**，不是她此刻所在。 */
  cityId: string;
  cityName: string;
  /** journey 那边的「现在」。倍速下和真实时间不一样。 */
  worldNow: string;
  /** 1 = 和真实时间同步。只用于提示词里说一句「她那边的钟快/慢」。 */
  speed: number;
  /** 在路上时的目的地。`traveling` 以外为空。 */
  toName: string;
  /** 文件多久没更新了（秒）。太大说明 journey 停了。 */
  staleSec: number;
  /**
   * 旅行那边记账开着没有（2026-11-17）。
   *
   * 开着 = 这一趟的路费房费记在她账上（`life-spend` 条子）。
   * 关着 = 他请客。两种都合法，但**她得知道是哪一种** ——
   * 不然她会以为「出门不花钱」，然后在账上对不上。
   */
  moneyOn: boolean;
  /** 这一趟累计花了多少、挣了多少（旅行那边的账）。 */
  spent: number;
  earned: number;
  /** 在路上时的交通方式 id（walk / bike / car / bus / train / ship / plane 等）。 */
  modeId: string;
  /** 在路上时的座位/舱位档 id 与名称（如 theme-cruise / 主题远洋游轮）。 */
  seatId: string;
  seat: string;
  seatMult: number;
  /** 在外地住店时的酒店档位。 */
  hotelTier: '' | 'budget' | 'comfort' | 'view' | 'luxury';
  /** journey 侧登记的出发地城市名（与生活层芦花塘并排对齐）。 */
  homeName: string;
  /** 回家休息截止时刻（ISO）；为空表示不在休息期。 */
  restUntil: string;
  /** 外地打工中状态（避免两边同时安排整天活）。 */
  tripWork: { cityId: string; gig: string; until: string } | null;
  /** 这趟同行的真鱼朋友名列表（外地社交条的硬事实来源）。 */
  partyWith: string[];
  partyDays: number;
  /** 此刻正在城内通勤中（坐公交/打车去景点等）。 */
  onWay: { what: string; arriveAt: string; leftMin: number } | null;
  /** 此刻正在某个景点内。 */
  atSpot: { name: string; until: string } | null;
  /** journey 那边记下的「想去还没去的城市名」列表。 */
  wishes: string[];
}

const EMPTY_JOURNEY: JourneyView = {
  installed: false,
  phase: '',
  cityId: '',
  cityName: '',
  worldNow: '',
  speed: 1,
  toName: '',
  staleSec: 0,
  moneyOn: false,
  spent: 0,
  earned: 0,
  modeId: '',
  seatId: '',
  seat: '',
  seatMult: 1,
  hotelTier: '',
  homeName: '',
  restUntil: '',
  tripWork: null,
  partyWith: [],
  partyDays: 0,
  onWay: null,
  atSpot: null,
  wishes: [],
};

/**
 * 读 journey 的广播文件。
 *
 * **没有这个文件 ≠ 出错。** 没装 journey 就是没有，她照样要过日子 ——
 * 只是提示词里不说「你在哪座城」，也不说「那边几点」。
 * 把它当错误会让「只装模拟鱼生」的人每次启动都看到一条红色日志。
 *
 * ⚠ `phase === 'traveling'` 时 `city` 是**出发地**（journey 源码注释原话）。
 * 只读 `city` 会判成「她在西安」，而她其实已经在车上一天了。
 * 所以这三个字段必须一起读，不能挑着用。
 */
export function readJourney(dataDir: string, now: Date = new Date()): JourneyView {
  const file = join(dataDir, 'journey-public.json');
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { ...EMPTY_JOURNEY };
  }
  if (!raw || typeof raw !== 'object') return { ...EMPTY_JOURNEY };

  const phase = raw.phase === 'home' || raw.phase === 'staying' || raw.phase === 'traveling'
    ? raw.phase
    : '';
  const cityId = typeof raw.city?.id === 'string' ? raw.city.id : '';
  const cityName = typeof raw.city?.name === 'string' ? raw.city.name : '';
  const worldNow = typeof raw.clock?.worldNow === 'string' ? raw.clock.worldNow : '';
  const speed = Number(raw.clock?.speed) || 1;
  const toName = phase === 'traveling' && typeof raw.leg?.toName === 'string' ? raw.leg.toName : '';

  const at = Date.parse(typeof raw.updatedAt === 'string' ? raw.updatedAt : '');
  const staleSec = Number.isFinite(at) ? Math.max(0, Math.round((now.getTime() - at) / 1000)) : 0;

  /* 记账这两格：读不到就当「不知道」（0 / false），不猜——猜错方向会让她乱花钱。 */
  const spent = Number(raw.money?.spent);
  const earned = Number(raw.money?.earned);
  const modeId = phase === 'traveling' && typeof raw.leg?.modeId === 'string' ? raw.leg.modeId : '';
  const seatId = phase === 'traveling' && typeof raw.leg?.seatId === 'string' ? raw.leg.seatId : '';
  const seat = phase === 'traveling' && typeof raw.leg?.seat === 'string' ? raw.leg.seat : '';
  const seatMult = phase === 'traveling' && Number.isFinite(Number(raw.leg?.seatMult)) ? Number(raw.leg.seatMult) : 1;
  const rawTier = raw.hotelTier;
  const hotelTier = phase === 'staying' && (rawTier === 'budget' || rawTier === 'comfort' || rawTier === 'view' || rawTier === 'luxury')
    ? rawTier
    : '';
  const homeName = typeof raw.home?.name === 'string' ? raw.home.name : '';
  const rawRestUntil = typeof raw.rest?.until === 'string' ? raw.rest.until : '';
  const restUntilMs = rawRestUntil ? Date.parse(rawRestUntil) : NaN;
  const restUntil = Number.isFinite(restUntilMs) && restUntilMs > now.getTime() ? rawRestUntil : '';
  const tripWork = raw.work && typeof raw.work === 'object' && typeof raw.work.gig === 'string'
    ? {
      cityId: typeof raw.work.cityId === 'string' ? raw.work.cityId : '',
      gig: raw.work.gig,
      until: typeof raw.work.until === 'string' ? raw.work.until : '',
    }
    : null;
  const partyWith = raw.party && Array.isArray(raw.party.with)
    ? raw.party.with.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  const partyDays = raw.party && Number.isFinite(Number(raw.party.days)) ? Math.max(0, Number(raw.party.days)) : 0;
  const rawOnWay = phase === 'staying' && raw.onWay && typeof raw.onWay === 'object' ? raw.onWay : null;
  const onWay = rawOnWay && typeof rawOnWay.what === 'string' && rawOnWay.what
    ? {
      what: rawOnWay.what,
      arriveAt: typeof rawOnWay.arriveAt === 'string' ? rawOnWay.arriveAt : '',
      leftMin: Math.max(1, Math.round(Number(rawOnWay.leftMin) || 1)),
    }
    : null;
  const rawAtSpot = phase === 'staying' && raw.atSpot && typeof raw.atSpot === 'object' ? raw.atSpot : null;
  const atSpot = rawAtSpot && typeof rawAtSpot.name === 'string' && rawAtSpot.name
    ? {
      name: rawAtSpot.name,
      until: typeof rawAtSpot.until === 'string' ? rawAtSpot.until : '',
    }
    : null;

  const wishes = Array.isArray(raw.wishes)
    ? raw.wishes.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0).map((x: string) => x.trim()).slice(0, 12)
    : [];

  return {
    installed: true, phase, cityId, cityName, worldNow, speed, toName, staleSec,
    moneyOn: raw.money?.enabled === true,
    spent: Number.isFinite(spent) ? spent : 0,
    earned: Number.isFinite(earned) ? earned : 0,
    modeId,
    seatId,
    seat,
    seatMult,
    hotelTier,
    homeName,
    restUntil,
    tripWork,
    partyWith,
    partyDays,
    onWay,
    atSpot,
    wishes,
  };
}

/* ------------------------------------------------------------------ */
/* 本城：她住在哪儿                                                     */
/* ------------------------------------------------------------------ */

export type StreetModKey = 'food' | 'energy' | 'clean' | 'fun' | 'social' | 'know' | 'work' | 'fit';
export type StreetMods = Partial<Record<StreetModKey, number>>;

export interface StreetProfile {
  name: string;
  desc: string;
  mods: StreetMods;
}

export const STREET_MOD_LABEL: Record<StreetModKey, string> = {
  food: '饱腹',
  energy: '精力',
  clean: '清爽',
  fun: '娱乐',
  social: '社交',
  know: '见识',
  work: '工钱',
  fit: '体质',
};

const STREET_MOD_KEYS: readonly StreetModKey[] = ['food', 'energy', 'clean', 'fun', 'social', 'know', 'work', 'fit'];

const DEFAULT_STREET_PROFILES: readonly StreetProfile[] = [
  {
    name: '南滨河路',
    desc: '傍着黄河长廊与水车园，清晨有带露水的早市，傍晚河风吹散暑气，沿河散步慢跑最养体格，就是河滩风大容易沾灰。',
    mods: { fit: 15, energy: 5, clean: -10 },
  },
  {
    name: '张掖路',
    desc: '老城最热闹的商业步行街，茶摊、馆子与傍晚半价尾货扎堆，街坊熟人多、零活也多，就是夜里灯火喧嚣不够清静。',
    mods: { social: 15, work: 10, energy: -10 },
  },
  {
    name: '皋兰路',
    desc: '老院落与林荫道交错的安静街区，街角有旧书摊与小茶馆，屋里整洁、静下心看书学手艺最快，只是夜里略显冷清。',
    mods: { clean: 10, know: 15, social: -10 },
  },
  {
    name: '雁滩路',
    desc: '河滩果园改出来的慢节奏生活片区，菜摊果铺便宜实在，夜里清静睡得最沉，就是离老城中心稍远、活儿少些。',
    mods: { energy: 15, food: 5, work: -10 },
  },
  {
    name: '正宁路',
    desc: '兰州最有名的夜市小吃街，牛奶鸡蛋醪糟、烤串与酿皮从傍晚香到半夜，吃喝解闷最痛快，就是油烟重、天天宵夜疏于活动。',
    mods: { food: 15, fun: 10, clean: -10, fit: -5 },
  },
  {
    name: '庆阳路',
    desc: '贯通东方红广场与南关的核心商圈干道，写字楼与商铺密集、接活赚钱和长见识最快，就是节奏紧、一天下来耗神又枯燥。',
    mods: { work: 15, know: 10, energy: -10, fun: -5 },
  },
  {
    name: '甘南路',
    desc: '兰州最有名的酒吧与驻唱街区，入夜霓虹亮起、乐队与桌游馆扎堆，解闷交友最热闹，就是静不下心看书、久坐少锻炼。',
    mods: { fun: 15, social: 10, know: -5, fit: -5 },
  },
  {
    name: '安宁西路',
    desc: '大学城与十里桃乡所在的新街区，林荫大道宽敞干爽、操场和校园氛围好，住着最清爽体面也爱运动，就是离主城商圈远、活儿略少。',
    mods: { clean: 15, fit: 10, work: -5 },
  },
];

export interface TownView {
  id: string;
  name: string;
  origin: string;
  streets: string[];
  streetProfiles: StreetProfile[];
  rules: string[];
  /** 服务器设过没有。false = 现在用的是内置默认。 */
  custom: boolean;
  /**
   * 从哪儿来的。
   *
   * **`builtin` 和 `failed` 必须分开** —— 两个都退成内置数据，但对用户意思完全不同：
   * `builtin` 是「你没配，我在用默认」，不是故障（灰灯）；
   * `failed` 是「你配了但读不到」，是故障（红灯）。
   * 混成一个，面板上就永远看不出「明明配了地址却一直是默认城名」。
   */
  source: 'server' | 'builtin' | 'own' | 'failed';
  /** `failed` 时的一句话原因。给灯上的 hint 用。 */
  problem?: string;
  /** Hub 模式下由城镇返回的附加信息。 */
  notice?: string;
  buffs?: Record<string, number>;
  shipping?: { base_fee?: number; per_extra_qty?: number };
  metaVersion?: number;
  hubMode?: boolean;
}

/**
 * 按 uid（或兜底种子）从本城街道中稳定、均匀地挑选一条。
 * 与服务端 `sight-cf` 使用同一 FNV-1a 算法，避免全员堆到 `streets[0]`。
 */
export function pickTownStreet(streets: readonly string[], seed: string): string {
  const list = streets.map((s) => s.trim()).filter(Boolean);
  if (!list.length) return '';
  const key = seed.trim();
  if (!key) return list[Math.floor(Math.random() * list.length)];
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return list[(h >>> 0) % list.length];
}

/**
 * 内置的那座城。
 *
 * ⚠ **这份和服务端 `cloud/sight-cf/src/worker.js` 的 `TOWN_DEFAULTS` 是同一个东西**，
 * 有意写了两份：服务器没连上时她总得有个地方住，不能因为一个请求超时就说
 * 「你没有家」。两边都改才不漂 —— 只改一边，会出现「面板说兰州、别的鱼说另一个名字」。
 */
export function normStreetMods(raw: unknown): StreetMods {
  const out: StreetMods = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of STREET_MOD_KEYS) {
    const n = Math.round(Number((raw as Record<string, unknown>)[k]));
    if (Number.isFinite(n) && n !== 0) {
      out[k] = Math.max(-30, Math.min(30, n));
    }
  }
  return out;
}

export function normStreetProfiles(streets: readonly string[], rawProfiles?: unknown): StreetProfile[] {
  const list = Array.isArray(rawProfiles) && rawProfiles.length ? rawProfiles : streets;
  const out: StreetProfile[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item === 'string') {
      const name = item.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const def = DEFAULT_STREET_PROFILES.find((p) => p.name === name);
      out.push(def
        ? { name: def.name, desc: def.desc, mods: { ...def.mods } }
        : { name, desc: '', mods: {} });
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const name = typeof o.name === 'string' ? o.name.trim() : '';
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const hasDesc = Object.prototype.hasOwnProperty.call(o, 'desc');
      const hasMods = o.mods && typeof o.mods === 'object' && !Array.isArray(o.mods);
      const def = DEFAULT_STREET_PROFILES.find((p) => p.name === name);
      const desc = hasDesc ? String(o.desc ?? '').trim() : (def ? def.desc : '');
      const mods = hasMods ? normStreetMods(o.mods) : (def ? { ...def.mods } : {});
      out.push({ name, desc, mods });
    }
  }
  return out;
}

export function findStreetProfile(
  town: Pick<TownView, 'streets' | 'streetProfiles'>,
  street: string,
): StreetProfile | null {
  const name = String(street || '').trim();
  if (!name) return null;
  const hit = town.streetProfiles?.find((p) => p.name === name);
  if (hit) return hit;
  if (town.streets?.includes(name)) {
    const def = DEFAULT_STREET_PROFILES.find((p) => p.name === name);
    return def ? { name: def.name, desc: def.desc, mods: { ...def.mods } } : { name, desc: '', mods: {} };
  }
  return null;
}

export function formatStreetMods(mods?: StreetMods): string {
  if (!mods) return '';
  const parts: string[] = [];
  for (const k of STREET_MOD_KEYS) {
    const v = Number(mods[k] ?? 0);
    if (!Number.isFinite(v) || v === 0) continue;
    parts.push(`${STREET_MOD_LABEL[k]} ${v > 0 ? `+${v}` : v}%`);
  }
  return parts.join(' · ');
}

export const BUILTIN_TOWN: TownView = {
  id: 'lanzhou',
  name: '兰州',
  origin: '黄河自西向东穿城，两岸黄土山梁夹着长长一溜灯火，铁桥横在河面上。'
    + '早上出门沿着河边走两步就能吃碗热面，晚上不管走多远，望见河谷里的灯就知道到家了。',
  streets: DEFAULT_STREET_PROFILES.map((p) => p.name),
  streetProfiles: DEFAULT_STREET_PROFILES.map((p) => ({ name: p.name, desc: p.desc, mods: { ...p.mods } })),
  rules: ['河里的不吃河里的', '货不过夜', '价自己定，别人说贵你就听着', '赊账记在心里，不记在账上'],
  custom: false,
  source: 'builtin',
};

/**
 * 从服务器读本城设定。
 *
 * 三条纪律：
 * 1. **超时要短**（2.5 秒）。她是被宿主调起来的，不能因为一台服务器慢就把她卡住。
 * 2. **失败退内置，不报错、不空着** —— 理由同上。
 * 3. **只在启动和改了配置时读一次**，不进 tick。城名一天不会变两次，
 *    每 60 秒拉一次是白烧对方的额度（方案 §4.17 的额度纪律）。
 */
/** 多址顺序容灾请求：仅在网络异常、超时或 5xx 时顺移下一个城地址；2xx 或 4xx 明确业务响应即停止。 */
async function tryTownFetch(
  townUrl: string | readonly string[],
  suffix: string,
  init: RequestInit = {},
  timeoutMs = 2500,
): Promise<{ res: Response | null; lastStatus: number }> {
  const roots = parseTownUrls(townUrl);
  let lastStatus = 0;
  for (const raw of roots) {
    const root = raw.replace(/\/+$/, '').replace(/\/town\/info$/, '');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${root}${suffix}`, { ...init, signal: ctrl.signal });
      lastStatus = res.status;
      if (res.status >= 500) continue;
      return { res, lastStatus };
    } catch {
      /* 超时或断网，继续试下一个备用城地址 */
    } finally {
      clearTimeout(timer);
    }
  }
  return { res: null, lastStatus };
}

export async function readTown(
  townUrl: string | readonly string[],
  homeCity = '',
  opts: { timeoutMs?: number } = {},
): Promise<TownView> {
  const roots = parseTownUrls(townUrl);
  const own = String(homeCity || '').trim();

  /*
   * 三条路的优先级（2026-11-15 Mr.Q：「服务器空着就是在用户填的城市，
   * 填了服务器才是服务器的城市」）：
   *
   *   1. 配了服务器 → 服务器说了算（那是「所有人住同一座城」的用法）
   *   2. 没配服务器、但本机填了城名 → **用他填的**（这条以前根本没有）
   *   3. 都没填 → 内置的芦花塘
   *
   * 第 3 条才是「兜底」，不是「默认」—— 一个没配任何东西的人，
   * 不该被塞进一座他没选过的虚构城。
   */
  const ownTown = (): TownView => ({
    id: 'own',
    name: own,
    /* 来历、街名、城规都留空：他没填的东西我不替他编。 */
    origin: '',
    streets: [],
    streetProfiles: [],
    rules: [],
    custom: true,
    source: 'own',
  });

  /*
   * 服务器出问题时退哪：**退他自己填的那座城，不是退芦花塘**。
   * 他填了北京，服务器超时不该让他一觉醒来住回塘里。
   */
  const fallback = (problem: string): TownView => (own
    ? { ...ownTown(), source: 'failed', problem }
    : { ...BUILTIN_TOWN, source: 'failed', problem });

  if (!roots.length) return own ? ownTown() : { ...BUILTIN_TOWN };

  const { res, lastStatus } = await tryTownFetch(
    roots,
    '/town/info',
    { headers: { accept: 'application/json' }, cache: 'no-store' },
    opts.timeoutMs ?? 2500,
  );
  if (!res) {
    return fallback(
      lastStatus > 0
        ? `服务器回了 ${lastStatus}，先按你填的算（可能是那个服务器还是旧版，没有 /town/info）`
        : '连不上那个地址（超时或断网），先按你填的算',
    );
  }
  if (!res.ok) {
    return fallback(
      `服务器回了 ${res.status}，先按你填的算（可能是那个服务器还是旧版，没有 /town/info）`,
    );
  }
  try {
    const j: any = await res.json();
    const rawStreets = Array.isArray(j?.streets) ? j.streets.filter((x: unknown) => typeof x === 'string') as string[] : [];
    const profiles = normStreetProfiles(rawStreets.length ? rawStreets : BUILTIN_TOWN.streets, j?.streetProfiles);
    const streets = profiles.map((p) => p.name);
    const rules = Array.isArray(j?.rules) ? j.rules.filter((x: unknown) => typeof x === 'string') : [];
    return {
      id: typeof j?.town === 'string' && j.town ? j.town : BUILTIN_TOWN.id,
      name: typeof j?.name === 'string' && j.name ? j.name : BUILTIN_TOWN.name,
      origin: typeof j?.origin === 'string' && j.origin ? j.origin : BUILTIN_TOWN.origin,
      streets: streets.length ? streets : BUILTIN_TOWN.streets.slice(),
      streetProfiles: profiles,
      rules: rules.length ? rules : BUILTIN_TOWN.rules.slice(),
      custom: !!j?.custom,
      source: 'server',
    };
  } catch {
    return fallback('连不上那个地址（返回不是 JSON），先按你填的算');
  }
}

/* ------------------------------------------------------------------ */
/* 她那边几点                                                          */
/* ------------------------------------------------------------------ */

export type DayPart = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night' | 'late';

export const DAYPART_LABEL: Record<DayPart, string> = {
  dawn: '天没亮',
  morning: '早上',
  noon: '中午',
  afternoon: '下午',
  evening: '傍晚',
  night: '夜里',
  late: '深夜',
};

/**
 * 她那边是几点的哪一段。
 *
 * 优先用 journey 的 `worldNow`（那边可能有倍速），没有就用本机时间 ——
 * **但衰减永远用真实时间**，这条边界不能混（见 state.ts 文件头）。
 */
export function dayPart(at: Date): DayPart {
  const h = at.getHours();
  if (h < 5) return 'late';
  if (h < 7) return 'dawn';
  if (h < 11) return 'morning';
  if (h < 14) return 'noon';
  if (h < 18) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

/** journey 的「现在」。读不到就用真实时间。 */
export function herNow(j: JourneyView, real: Date = new Date()): Date {
  const t = Date.parse(j.worldNow);
  return Number.isFinite(t) ? new Date(t) : real;
}

/** 她和真实时间差多少。倍速一开就必然不一样，提示词里要说得出来。 */
export function clockGapHours(j: JourneyView, real: Date = new Date()): number {
  const t = Date.parse(j.worldNow);
  if (!Number.isFinite(t)) return 0;
  return (t - real.getTime()) / 3_600_000;
}

/* ------------------------------------------------------------------ */
/* journey 递过来的花销条子                                             */

/**
 * 旅行扩展递过来的一张「这一笔该从她的账上扣」。
 *
 * ## 为什么要走文件，不让它直接扣
 *
 * `life-state.json` 只有一个写者 —— 本扩展。旅行扩展同时写那个文件的话，
 * 两个进程各自 `rename` 一份 `.tmp`，谁后写谁覆盖，丢的是她的钱。
 * 所以那边只往 `life-spend/<id>.json` 放一张条子，这边读、判重、扣、回执
 * （见 `coopani-world-extension` 的 `references/20-跨扩展联动.md`）。
 */
export type VitalDeltaMap = Partial<Record<'food' | 'energy' | 'clean' | 'fun' | 'social', number>>;

export interface SpendMoodlet {
  text: string;
  kind: 'good' | 'bad';
  hours: number;
}

export interface SpendRequest {
  /** 文件名就是它 —— 坏文件靠这个回一条 `rejected`。 */
  id: string;
  at: string;
  amount: number;
  note: string;
  vitalsDelta?: VitalDeltaMap;
  fitnessDelta?: number;
  moodlet?: SpendMoodlet;
  invalid?: boolean;
}

/** 条子目录名。和那边写死的那个字符串必须一致，改一处等于断桥。 */
export const SPEND_DIR = 'life-spend';

function parseVitalsDelta(raw: unknown): VitalDeltaMap | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: VitalDeltaMap = {};
  let hasAny = false;
  for (const k of ['food', 'energy', 'clean', 'fun', 'social'] as const) {
    const v = Number((raw as Record<string, unknown>)[k]);
    if (Number.isFinite(v) && v !== 0) {
      out[k] = Math.max(-100, Math.min(100, v));
      hasAny = true;
    }
  }
  return hasAny ? out : undefined;
}

function parseSpendMoodlet(raw: unknown): SpendMoodlet | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const text = typeof o.text === 'string' ? o.text.trim().slice(0, 80) : '';
  if (!text) return undefined;
  const kind = o.kind === 'bad' ? 'bad' : 'good';
  const hrs = Number(o.hours);
  const hours = Number.isFinite(hrs) && hrs > 0 ? Math.min(24, hrs) : 3;
  return { text, kind, hours };
}

/**
 * 读她名下的条子。**读不出来的一条不吞** —— 用文件名当 id 回 `rejected`，
 * 否则那份文件在那边永远删不掉。
 */
export function readSpendRequests(dataDir: string): SpendRequest[] {
  const dir = join(dataDir, SPEND_DIR);
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out: SpendRequest[] = [];
  for (const name of names) {
    const id = name.replace(/\.json$/, '');
    try {
      const raw = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      const amount = Math.round(Number(raw?.amount ?? 0));
      const vitalsDelta = parseVitalsDelta(raw?.vitalsDelta);
      const fitnessRaw = Number(raw?.fitnessDelta ?? 0);
      const fitnessDelta = Number.isFinite(fitnessRaw) && fitnessRaw !== 0
        ? Math.max(-20, Math.min(20, fitnessRaw))
        : undefined;
      const moodlet = parseSpendMoodlet(raw?.moodlet);
      const hasEffect = Boolean(vitalsDelta || fitnessDelta || moodlet);
      if (!Number.isFinite(amount) || amount < 0 || (amount === 0 && !hasEffect)) {
        /* 读得出来但数不对且没有任何状态效果：标 invalid，调用方按 rejected 回。 */
        out.push({ id, at: '', amount: 0, note: '看不懂这一笔', invalid: true });
        continue;
      }
      out.push({
        id,
        at: typeof raw?.at === 'string' ? raw.at : '',
        amount,
        note: typeof raw?.note === 'string' ? raw.note.slice(0, 60) : '',
        ...(vitalsDelta ? { vitalsDelta } : {}),
        ...(fitnessDelta ? { fitnessDelta } : {}),
        ...(moodlet ? { moodlet } : {}),
      });
    } catch {
      out.push({ id, at: '', amount: 0, note: '这文件读不出来', invalid: true });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 二期通用账本上报目录：`life-pending/`                                */
/* ------------------------------------------------------------------ */

export const PENDING_DIR = 'life-pending';

export interface PendingRequest {
  id: string;
  /** 条子文件名（含 `.json`）。结算完按它归档 —— 见 `archivePendingRequest`。 */
  file: string;
  source: string;
  kind: string;
  amount: number;
  earned: number;
  worldHours: number;
  payee: string;
  note: string;
  invalid?: boolean;
}

/**
 * 读各扩展写进 `life-pending/*.json` 的结算条子。
 * 读不出来或数不对的标 `invalid: true`，调用方回 `rejected` 好让对面删文件。
 */
export function readPendingRequests(dataDir: string): PendingRequest[] {
  const dir = join(dataDir, PENDING_DIR);
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out: PendingRequest[] = [];
  for (const name of names) {
    const fallbackId = name.replace(/\.json$/, '');
    try {
      const raw = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      const id = typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : fallbackId;
      const amount = Math.round(Number(raw?.amount ?? 0));
      const earned = Math.round(Number(raw?.earned ?? 0));
      const worldHours = Math.max(0, Number(raw?.worldHours ?? 0));
      if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(earned) || earned < 0 || (amount === 0 && earned === 0)) {
        out.push({ id, file: name, source: 'unknown', kind: 'invalid', amount: 0, earned: 0, worldHours: 0, payee: '', note: '数不对', invalid: true });
        continue;
      }
      out.push({
        id,
        file: name,
        source: typeof raw?.source === 'string' && raw.source ? raw.source : 'external',
        kind: typeof raw?.kind === 'string' && raw.kind ? raw.kind : 'spend',
        amount,
        earned,
        worldHours: Number.isFinite(worldHours) ? worldHours : 0,
        payee: typeof raw?.payee === 'string' ? raw.payee.slice(0, 40) : '',
        note: typeof raw?.note === 'string' ? raw.note.slice(0, 60) : '',
      });
    } catch {
      out.push({ id: fallbackId, file: name, source: 'unknown', kind: 'invalid', amount: 0, earned: 0, worldHours: 0, payee: '', note: '这文件读不出来', invalid: true });
    }
  }
  return out;
}

/**
 * 结算完把条子从 `life-pending/` 挪进 `life-pending/done/`。
 *
 * ## 为什么不能只靠 `spendApplied` 判重
 *
 * 那张表只留 120 条，广播给对面删文件用的回执只留 40 条 —— 两个窗口都会截断。
 * 对面扩展停一阵再回来，老条子它不知道该不该删，文件就长期留在目录里；
 * 等结算次数超过 120，最早的 id 被挤出判重表，**同一张条子会被再扣一次钱**，
 * 而且 `appendLedger` 判重拦的是记账、拦不住扣款，流水里还看不出来（2026-11-16 审查）。
 *
 * 归档之后 `readPendingRequests` 只读 `.json`，已结算的条子**根本读不到**，
 * 判重表截不截断都无所谓。文件本身留在 `done/` 里，还能查账。
 */
export function archivePendingRequest(dataDir: string, file: string): void {
  if (!file || file.includes('/') || file.includes('\\')) return;
  try {
    const dir = join(dataDir, PENDING_DIR);
    mkdirSync(join(dir, 'done'), { recursive: true });
    renameSync(join(dir, file), join(dir, 'done', file));
  } catch { /* 归档失败不挡这一跳：判重表还在，下次再试 */ }
}

/* ------------------------------------------------------------------ */
/* 三期 L2 市集买方半场 + 街口黑板报 + 住户入册                        */
/* ------------------------------------------------------------------ */

export type StallEffectKey = 'food' | 'energy' | 'clean' | 'fun' | 'social' | 'knowledge' | 'fitness';
export type StallEffects = Partial<Record<StallEffectKey, number>>;

export const STALL_EFFECT_LABEL: Record<StallEffectKey, string> = {
  food: '饱腹',
  energy: '精力',
  clean: '清洁',
  fun: '娱乐',
  social: '社交',
  knowledge: '见识',
  fitness: '体质',
};

export const STALL_EFFECT_SHORT: Record<StallEffectKey, string> = {
  food: '饱',
  energy: '精',
  clean: '洁',
  fun: '娱',
  social: '社',
  knowledge: '识',
  fitness: '体',
};

export const STALL_EFFECT_LIMITS: Record<StallEffectKey, { max: number; weight: number; step: number }> = {
  food: { max: 80, weight: 1, step: 1 },
  energy: { max: 80, weight: 1, step: 1 },
  clean: { max: 80, weight: 1, step: 1 },
  fun: { max: 80, weight: 1, step: 1 },
  social: { max: 80, weight: 1, step: 1 },
  knowledge: { max: 10, weight: 20, step: 0.1 },
  fitness: { max: 5, weight: 40, step: 0.05 },
};

export function stallEffectBudget(price: number): number {
  const p = Math.max(1, Math.min(999, Math.round(Number(price) || 1)));
  if (p <= 150) return p * 2;
  return Math.min(450, 300 + Math.round(Math.sqrt(p - 150) * 10));
}

function quantizeEffect(val: number, step: number, mode: 'round' | 'floor' = 'round'): number {
  if (!Number.isFinite(val) || val <= 0) return 0;
  const units = mode === 'floor'
    ? Math.floor((val + 1e-9) / step)
    : Math.round(val / step);
  return Math.round(units * step * 100) / 100;
}

export function normStallEffects(raw: unknown, price = 15): StallEffects | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const picked: StallEffects = {};
  const origCost: Partial<Record<StallEffectKey, number>> = {};
  let totalCost = 0;
  for (const [k, rule] of Object.entries(STALL_EFFECT_LIMITS) as [StallEffectKey, { max: number; weight: number; step: number }][]) {
    const v = quantizeEffect(Number(src[k] ?? 0), rule.step, 'round');
    if (v <= 0) continue;
    const clamped = Math.min(rule.max, v);
    picked[k] = clamped;
    const c = clamped * rule.weight;
    origCost[k] = c;
    totalCost += c;
  }
  const keys = Object.keys(picked) as StallEffectKey[];
  if (!keys.length) return undefined;
  const budget = stallEffectBudget(price);
  if (totalCost > budget + 1e-6) {
    const ratio = budget / totalCost;
    let remain = budget;
    for (const k of keys) {
      const rule = STALL_EFFECT_LIMITS[k];
      const scaled = Math.min(rule.max, quantizeEffect((picked[k] ?? 0) * ratio, rule.step, 'floor'));
      const maxAfford = quantizeEffect((remain + 1e-9) / rule.weight, rule.step, 'floor');
      const finalVal = Math.max(0, Math.min(scaled, maxAfford));
      if (finalVal > 0) {
        picked[k] = finalVal;
        remain = Math.max(0, Math.round((remain - finalVal * rule.weight) * 100) / 100);
      } else {
        delete picked[k];
      }
    }
    if (!Object.keys(picked).length && remain > 0) {
      const byPriority = [...keys].sort((a, b) => (origCost[b] ?? 0) - (origCost[a] ?? 0));
      for (const k of byPriority) {
        const rule = STALL_EFFECT_LIMITS[k];
        if (remain + 1e-9 >= rule.step * rule.weight) {
          const finalVal = Math.min(rule.max, quantizeEffect((remain + 1e-9) / rule.weight, rule.step, 'floor'));
          if (finalVal > 0) {
            picked[k] = finalVal;
            break;
          }
        }
      }
    }
  }
  return Object.keys(picked).length ? picked : undefined;
}

export function defaultStallEffects(price: number): StallEffects {
  const b = stallEffectBudget(price);
  const food = Math.min(80, Math.max(1, Math.round(b * 0.7)));
  const r1 = Math.max(0, b - food);
  const fun = Math.min(60, r1);
  const r2 = Math.max(0, r1 - fun);
  const energy = Math.min(60, r2);
  const r3 = Math.max(0, r2 - energy);
  const social = Math.min(60, r3);
  const out: StallEffects = { food };
  if (fun > 0) out.fun = fun;
  if (energy > 0) out.energy = energy;
  if (social > 0) out.social = social;
  return out;
}

export function resolveStallEffects(effects: StallEffects | undefined | null, price: number): StallEffects {
  return normStallEffects(effects, price) ?? defaultStallEffects(price);
}

export function formatStallEffects(effects?: StallEffects | null, opts: { compact?: boolean } = {}): string {
  if (!effects) return '';
  const labels = opts.compact ? STALL_EFFECT_SHORT : STALL_EFFECT_LABEL;
  const sep = opts.compact ? ' ' : '/';
  const parts: string[] = [];
  for (const k of Object.keys(STALL_EFFECT_LIMITS) as StallEffectKey[]) {
    const raw = Number(effects[k] ?? 0);
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const v = Number(raw.toFixed(2));
    if (v > 0) parts.push(`${labels[k]}+${v}`);
  }
  return parts.join(sep);
}

export interface TownStall {
  id: string;
  seller: string;
  kind?: 'goods' | 'errand';
  item: string;
  price: number;
  stock: number;
  freshVeg?: boolean;
  category?: StallCategory;
  note?: string;
  effects?: StallEffects;
  townId?: string;
  townName?: string;
  sellerPetId?: string;
  isMine?: boolean;
  isCrossTown?: boolean;
  estimatedShippingFee?: number;
  isSpecialty?: boolean;
  itemCode?: string;
  estMinutes?: number;
  errandKind?: string;
  expiresAt?: string;
}

export interface TownDeal {
  id: string;
  stallId: string;
  item: string;
  qty: number;
  buyerPet: string;
  note?: string;
  seen: boolean;
  at: string;
  unitPrice?: number;
  isCrossTown?: boolean;
  shippingFee?: number;
  buyerTotal?: number;
  sellerTownId?: string;
  buyerTownId?: string;
  orderId?: string;
}

/**
 * 读取本机 `dataDir/meet-uid.txt`；若只装了 life 未装 journey，则自动生成并复用本机 `dataDir/life-town-uid.txt`
 * （绝不进云盘备份，防止双机同 id 串档案）。
 */
export function readMeetUid(dataDir: string): string {
  if (!dataDir) return '';
  for (const name of ['meet-uid.txt', 'life-town-uid.txt']) {
    try {
      const raw = readFileSync(join(dataDir, name), 'utf8').trim();
      if (/^[a-f0-9]{20,64}$/i.test(raw)) return raw;
    } catch { /* 继续找或生成 */ }
  }
  const gen = randomBytes(16).toString('hex');
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'life-town-uid.txt'), `${gen}\n`, 'utf8');
  } catch { /* 目录不可写也返回临时 32 位 hex，确保协议合法 */ }
  return gen;
}

export async function joinTown(
  townUrl: string | readonly string[],
  payload: { uid: string; pet: string; street: string },
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; town?: string; street?: string; reason?: string }> {
  const roots = parseTownUrls(townUrl);
  if (!roots.length || !payload.uid) return { ok: false, reason: '缺少地址或 uid' };
  const { res } = await tryTownFetch(
    roots,
    '/town/join',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    },
    opts.timeoutMs ?? 2500,
  );
  if (!res) return { ok: false, reason: '城服务器连不上' };
  try {
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) return { ok: false, reason: typeof j?.error === 'string' ? j.error : `入册失败 ${res.status}` };
    return {
      ok: true,
      town: typeof j.town === 'string' ? j.town : undefined,
      street: typeof j.street === 'string' ? j.street : undefined,
    };
  } catch {
    return { ok: false, reason: '城服务器响应异常' };
  }
}

export async function fetchTownStalls(
  townUrl: string | readonly string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; stalls: TownStall[]; bulletin: string[] }> {
  const roots = parseTownUrls(townUrl);
  if (!roots.length) return { ok: false, stalls: [], bulletin: [] };
  const { res } = await tryTownFetch(
    roots,
    '/town/stalls?include_errands=1',
    { headers: { accept: 'application/json' } },
    opts.timeoutMs ?? 2500,
  );
  if (!res || !res.ok) return { ok: false, stalls: [], bulletin: [] };
  try {
    const j: any = await res.json();
    const list = Array.isArray(j?.stalls) ? j.stalls : [];
    const stalls: TownStall[] = list
      .filter((x: any) => x && typeof x.id === 'string' && typeof x.item === 'string' && Number(x.price) > 0 && Number(x.stock) > 0)
      .map((x: any) => {
        const price = Math.round(Number(x.price));
        const effects = normStallEffects(x.effects, price);
        const rawCat = typeof x.category === 'string' ? x.category : '';
        const category = rawCat in STALL_CATEGORY_LABEL ? (rawCat as StallCategory) : undefined;
        return {
          id: String(x.id),
          seller: typeof x.seller === 'string' ? x.seller : '街坊',
          kind: x.kind === 'errand' ? 'errand' : 'goods',
          item: String(x.item),
          price,
          stock: Math.round(Number(x.stock)),
          freshVeg: Boolean(x.freshVeg),
          ...(category ? { category } : {}),
          ...(typeof x.note === 'string' && x.note ? { note: x.note } : {}),
          ...(effects ? { effects } : {}),
        };
      });
    const bulletin = Array.isArray(j?.bulletin)
      ? j.bulletin.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
      : [];
    return { ok: true, stalls, bulletin };
  } catch {
    return { ok: false, stalls: [], bulletin: [] };
  }
}

export async function buyTownStall(
  townUrl: string | readonly string[],
  stallId: string,
  buyer: string,
  opts: { timeoutMs?: number; buyerUid?: string; note?: string; isErrand?: boolean } = {},
): Promise<{ ok: boolean; kind?: 'goods' | 'errand'; item?: string; price?: number; seller?: string; freshVeg?: boolean; category?: StallCategory; effects?: StallEffects; reason?: string }> {
  const roots = parseTownUrls(townUrl);
  if (!roots.length) return { ok: false, reason: '没配城服务器地址' };
  const isErrand = Boolean(opts.isErrand);
  const netFailReason = isErrand ? '鱼市街委托板暂时连不上，稍后再试（没有误买任何摊货）。' : '市集连不上';
  const { res } = await tryTownFetch(
    roots,
    '/town/buy',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        stallId,
        buyer,
        ...(opts.buyerUid ? { buyerUid: opts.buyerUid } : {}),
        ...(opts.note ? { note: opts.note } : {}),
      }),
    },
    opts.timeoutMs ?? 2500,
  );
  if (!res) return { ok: false, reason: netFailReason };
  try {
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) {
      const errMap: Record<string, string> = isErrand
        ? {
            'pair limit': '今天和这位街坊在鱼市街的往来（买摊货与接委托合计）已达每日 2 单上限，明天再来帮忙吧。',
            'sold out': '这单农牧代管委托刚好被别的街坊抢先接走了。',
            'own stall': '这是你自己发出去的农牧代管委托，不能自己接自己的单哦。',
            'not found': '没在鱼市街找到这单委托（可能已过期或刚被接走）。',
          }
        : {
            'pair limit': '今天已经在这位街坊摊上买过两单了，明天再来逛吧。',
            'sold out': '这样货刚好被人买光了。',
            'own stall': '不能自己买自己挂出去的摊货哦。',
            'not found': '鱼市街上没找着这个摊位（可能已卖光或过期下架）。',
          };
      const rawErr = typeof j?.error === 'string' ? j.error : '';
      return { ok: false, reason: errMap[rawErr] || rawErr || `市集返回 ${res.status}` };
    }
    const price = Math.round(Number(j?.price ?? 0));
    const effects = normStallEffects(j?.effects, price || 15);
    const rawCat = typeof j?.category === 'string' ? j.category : '';
    const category = rawCat in STALL_CATEGORY_LABEL ? (rawCat as StallCategory) : undefined;
    const kind = j?.kind === 'errand' ? 'errand' : undefined;
    return {
      ok: true,
      ...(kind ? { kind } : {}),
      item: typeof j?.item === 'string' ? j.item : '一份吃食',
      price,
      seller: typeof j?.seller === 'string' ? j.seller : '街坊',
      freshVeg: Boolean(j?.freshVeg),
      ...(category ? { category } : {}),
      ...(effects ? { effects } : {}),
    };
  } catch {
    return { ok: false, reason: netFailReason };
  }
}

export async function postTownStall(
  townUrl: string | readonly string[],
  payload: { uid: string; pet: string; item: string; price: number; stock?: number; freshVeg?: boolean; category?: StallCategory; kind?: 'goods' | 'errand'; note?: string; effects?: StallEffects },
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; id?: string; seller?: string; item?: string; price?: number; stock?: number; freshVeg?: boolean; category?: StallCategory; effects?: StallEffects; reason?: string }> {
  const roots = parseTownUrls(townUrl);
  if (!roots.length) return { ok: false, reason: '没配城服务器地址' };
  if (!payload.uid) return { ok: false, reason: '缺少本机 uid，无法实名挂摊' };
  const normalizedEffects = normStallEffects(payload.effects, payload.price);
  const bodyPayload = {
    ...payload,
    ...(normalizedEffects ? { effects: normalizedEffects } : {}),
  };
  if (!normalizedEffects) delete bodyPayload.effects;
  const { res } = await tryTownFetch(
    roots,
    '/town/stalls',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(bodyPayload),
    },
    opts.timeoutMs ?? 2500,
  );
  if (!res) return { ok: false, reason: '市集连不上' };
  try {
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) {
      const msgMap: Record<string, string> = {
        'too many stalls': '你同时在架上的摊位已经有 3 个了，先等卖掉或过期再来挂',
        'too many': '今天挂摊太频繁了，明天再来',
        banned: '当前账号被限制在鱼市街摆摊',
      };
      const rawErr = typeof j?.error === 'string' ? j.error : '';
      return { ok: false, reason: msgMap[rawErr] || rawErr || `挂摊返回 ${res.status}` };
    }
    const price = Math.round(Number(j?.price ?? payload.price));
    const resEffects = normStallEffects(j?.effects, price) ?? normalizedEffects;
    const rawCat = typeof j?.category === 'string' ? j.category : (payload.category ?? '');
    const category = rawCat in STALL_CATEGORY_LABEL ? (rawCat as StallCategory) : undefined;
    return {
      ok: true,
      id: typeof j?.id === 'string' ? j.id : '',
      seller: typeof j?.seller === 'string' ? j.seller : payload.pet,
      item: typeof j?.item === 'string' ? j.item : payload.item,
      price,
      stock: Math.round(Number(j?.stock ?? payload.stock ?? 1)),
      freshVeg: Boolean(j?.freshVeg),
      ...(category ? { category } : {}),
      ...(resEffects ? { effects: resEffects } : {}),
    };
  } catch {
    return { ok: false, reason: '市集连不上' };
  }
}

export async function fetchTownDeals(
  townUrl: string | readonly string[],
  uid: string,
  opts: { ack?: boolean; timeoutMs?: number } = {},
): Promise<{ ok: boolean; deals: TownDeal[]; unseen: number; reason?: string }> {
  const roots = parseTownUrls(townUrl);
  if (!roots.length || !uid) return { ok: false, deals: [], unseen: 0, reason: '缺少城服务器地址或 uid' };
  const q = new URLSearchParams({ uid });
  if (opts.ack) q.set('ack', '1');
  const { res } = await tryTownFetch(
    roots,
    `/town/deals?${q.toString()}`,
    { headers: { accept: 'application/json' } },
    opts.timeoutMs ?? 2500,
  );
  if (!res) return { ok: false, deals: [], unseen: 0, reason: '市集连不上' };
  try {
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) {
      return { ok: false, deals: [], unseen: 0, reason: typeof j?.error === 'string' ? j.error : `回执返回 ${res.status}` };
    }
    const list = Array.isArray(j?.deals) ? j.deals : [];
    const deals: TownDeal[] = list
      .filter((x: any) => x && typeof x.id === 'string' && typeof x.item === 'string')
      .map((x: any) => ({
        id: String(x.id),
        stallId: typeof x.stallId === 'string' ? x.stallId : '',
        item: String(x.item),
        qty: Math.max(1, Math.round(Number(x.qty) || 1)),
        buyerPet: typeof x.buyerPet === 'string' ? x.buyerPet : '一只鱼',
        ...(typeof x.note === 'string' && x.note ? { note: x.note } : {}),
        seen: Boolean(x.seen),
        at: typeof x.at === 'string' ? x.at : '',
        ...(Number.isFinite(Number(x.unitPrice)) && Number(x.unitPrice) > 0
          ? { unitPrice: Math.round(Number(x.unitPrice)) }
          : {}),
      }));
    return { ok: true, deals, unseen: Math.max(0, Math.round(Number(j?.unseen ?? 0) || 0)) };
  } catch {
    return { ok: false, deals: [], unseen: 0, reason: '市集连不上' };
  }
}

export async function ackTownDeals(
  townUrl: string | readonly string[],
  uid: string,
  ids?: readonly string[],
  opts: { timeoutMs?: number } = {},
): Promise<boolean> {
  const roots = parseTownUrls(townUrl);
  if (!roots.length || !uid) return false;
  const { res } = await tryTownFetch(
    roots,
    '/town/deals/seen',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ uid, ...(ids?.length ? { ids: [...ids] } : {}) }),
    },
    opts.timeoutMs ?? 2500,
  );
  return Boolean(res && res.ok);
}

/* ------------------------------------------------------------------ */
/* 外部真实天气源                                                      */
/* ------------------------------------------------------------------ */

export interface ExternalWeatherResult {
  ok: boolean;
  city?: string;
  sky?: WeatherSky;
  rawWeather?: string;
  temperature?: number;
  source?: string;
  error?: string;
}

/**
 * 从外部天气服务读实时天象：`GET {weatherUrl}/now?city=<城名>`。
 * 只保留有限数字温度与非空状态串，任何网络/解析异常一律返回 `{ ok: false, error }` 绝不外抛。
 */
export async function fetchExternalWeather(
  weatherUrl: string,
  city: string,
  timeoutMs = 2500,
): Promise<ExternalWeatherResult> {
  const root = normWeatherUrl(weatherUrl);
  const cleanCity = String(city || '').trim();
  if (!root || !cleanCity) {
    return { ok: false, error: !root ? '未配置外部天气地址' : '缺少城市名称' };
  }
  const ctrl = new AbortController();
  const ms = clampWeatherTimeoutMs(timeoutMs);
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const isAdcode = /^\d{6}$/.test(cleanCity);
    const qs = isAdcode
      ? `city=${encodeURIComponent(cleanCity)}&adcode=${encodeURIComponent(cleanCity)}`
      : `city=${encodeURIComponent(cleanCity)}`;
    const res = await fetch(`${root}/now?${qs}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: ctrl.signal,
    });
    const j: any = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = typeof j?.error === 'string' && j.error.trim() ? j.error.trim() : `HTTP ${res.status}`;
      return { ok: false, error: msg };
    }
    if (!j || j.ok === false) {
      const msg = typeof j?.error === 'string' && j.error.trim() ? j.error.trim() : '外部天气返回 ok=false';
      return { ok: false, error: msg };
    }
    const rawWeather = typeof j?.current?.weather === 'string' ? j.current.weather.trim() : '';
    if (!rawWeather) {
      return { ok: false, error: '外部天气缺少 current.weather 字段' };
    }
    const tempRaw = Number(j?.current?.temperature);
    const temperature = Number.isFinite(tempRaw) ? Math.round(tempRaw * 10) / 10 : undefined;
    const srcFromCur = typeof j?.current?.source === 'string' ? j.current.source.trim() : '';
    const srcFromArr = Array.isArray(j?.source) && typeof j.source[0] === 'string' ? j.source[0].trim() : '';
    const source = srcFromCur || srcFromArr || '外部天气';
    return {
      ok: true,
      city: cleanCity,
      sky: skyFromExternal(rawWeather),
      rawWeather,
      ...(temperature !== undefined ? { temperature } : {}),
      source,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error && e.name === 'AbortError'
      ? `请求超时（>${ms}ms）`
      : (e instanceof Error && e.message ? e.message : '连接外部天气失败');
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

const amapAdcodeCache = new Map<string, string>();

async function lookupAmapAdcode(amapKey: string, city: string, timeoutMs: number): Promise<string | null> {
  const cached = amapAdcodeCache.get(city);
  if (cached) return cached;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `https://restapi.amap.com/v3/config/district?key=${encodeURIComponent(amapKey)}`
      + `&keywords=${encodeURIComponent(city)}&subdistrict=0&extensions=base`;
    const res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store', signal: ctrl.signal });
    const j: any = await res.json().catch(() => null);
    const adcode = typeof j?.districts?.[0]?.adcode === 'string' ? j.districts[0].adcode.trim() : '';
    if (j?.status === '1' && /^\d{6}$/.test(adcode)) {
      amapAdcodeCache.set(city, adcode);
      return adcode;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 直连高德实况天气接口：`GET https://restapi.amap.com/v3/weather/weatherInfo?key=...&city=...&extensions=base`。
 * 若传中文城名未直接命中 `lives[0]`，自动查 `district` 转 6 位 `adcode` 并缓存后重试一次。
 */
export async function fetchAmapWeather(
  amapKey: string,
  city: string,
  timeoutMs = 2500,
): Promise<ExternalWeatherResult> {
  const key = String(amapKey || '').trim();
  const cleanCity = String(city || '').trim();
  if (!key || !cleanCity) {
    return { ok: false, error: !key ? '未配置高德天气 Key' : '缺少城市名称' };
  }
  const ms = clampWeatherTimeoutMs(timeoutMs);

  const queryLive = async (cityParam: string) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const url = `https://restapi.amap.com/v3/weather/weatherInfo?key=${encodeURIComponent(key)}`
        + `&city=${encodeURIComponent(cityParam)}&extensions=base&output=JSON`;
      const res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store', signal: ctrl.signal });
      const j: any = await res.json().catch(() => null);
      return { httpOk: res.ok, status: res.status, json: j };
    } catch (e: unknown) {
      const msg = e instanceof Error && e.name === 'AbortError'
        ? `高德天气超时（>${ms}ms）`
        : (e instanceof Error && e.message ? e.message : '高德天气连接失败');
      return { httpOk: false, status: 0, json: null, err: msg };
    } finally {
      clearTimeout(timer);
    }
  };

  let resp = await queryLive(cleanCity);
  if (resp.err) return { ok: false, error: resp.err };
  if (!resp.httpOk) return { ok: false, error: `高德天气 HTTP ${resp.status}` };

  const infoCode = String(resp.json?.infocode ?? '').trim();
  const rawInfo = String(resp.json?.info ?? '').trim();
  const isFatalAuthOrQuota = ['10001', '10003', '10004', '10009', '10010'].includes(infoCode)
    || /INVALID_USER_KEY|USERKEY_PLAT_NOMATCH|DAILY_QUERY_OVER_LIMIT|CUQPS_HAS_EXCEEDED_THE_LIMIT/i.test(rawInfo);

  let live = resp.json?.status === '1' && Array.isArray(resp.json?.lives) ? resp.json.lives[0] : null;
  if ((!live || typeof live.weather !== 'string' || !live.weather.trim()) && !isFatalAuthOrQuota && !/^\d{6}$/.test(cleanCity)) {
    const adcode = await lookupAmapAdcode(key, cleanCity, ms);
    if (adcode) {
      resp = await queryLive(adcode);
      if (resp.err) return { ok: false, error: resp.err };
      if (!resp.httpOk) return { ok: false, error: `高德天气 HTTP ${resp.status}` };
      if (resp.json?.status === '1') {
        live = Array.isArray(resp.json?.lives) ? resp.json.lives[0] : null;
      }
    }
  }
  if (resp.json?.status !== '1') {
    const info = String(resp.json?.info || '高德天气返回异常');
    return { ok: false, error: info };
  }

  const rawWeather = typeof live?.weather === 'string' ? live.weather.trim() : '';
  if (!rawWeather) {
    return { ok: false, error: `高德天气未查到「${cleanCity}」实况数据` };
  }
  const tempRaw = Number(live?.temperature);
  const temperature = Number.isFinite(tempRaw) ? Math.round(tempRaw * 10) / 10 : undefined;
  return {
    ok: true,
    city: cleanCity,
    sky: skyFromExternal(rawWeather),
    rawWeather,
    ...(temperature !== undefined ? { temperature } : {}),
    source: '高德天气',
  };
}
