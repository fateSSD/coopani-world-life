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
import { parseTownUrls } from './config.ts';

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
  hotelTier: '',
  homeName: '',
  restUntil: '',
  tripWork: null,
  partyWith: [],
  partyDays: 0,
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

  return {
    installed: true, phase, cityId, cityName, worldNow, speed, toName, staleSec,
    moneyOn: raw.money?.enabled === true,
    spent: Number.isFinite(spent) ? spent : 0,
    earned: Number.isFinite(earned) ? earned : 0,
    modeId,
    hotelTier,
    homeName,
    restUntil,
    tripWork,
    partyWith,
    partyDays,
  };
}

/* ------------------------------------------------------------------ */
/* 本城：她住在哪儿                                                     */
/* ------------------------------------------------------------------ */

export interface TownView {
  id: string;
  name: string;
  origin: string;
  streets: string[];
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
}

/**
 * 内置的那座城。
 *
 * ⚠ **这份和服务端 `cloud/sight-cf/src/worker.js` 的 `TOWN_DEFAULTS` 是同一个东西**，
 * 有意写了两份：服务器没连上时她总得有个地方住，不能因为一个请求超时就说
 * 「你没有家」。两边都改才不漂 —— 只改一边，会出现「面板说芦花塘、别的鱼说另一个名字」。
 */
export const BUILTIN_TOWN: TownView = {
  id: 'luhuatang',
  name: '芦花塘',
  /*
   * 来历（2026-11-15 改）。原来叫「浅水埠」，用户说不好听。
   *
   * 不只是音的问题：**「浅」是自贬** —— 水浅意味着养不住东西，
   * 一个地方的名字里带「浅」，她说着就没底气。而「埠」字虽自带市集，
   * 却是个货的落脚点，不是活物待的地方。
   *
   * 「塘」是活水，鱼在那儿；「芦花」给她一个认家的凭据 ——
   * 住在这儿的人不靠门牌认家，靠的是看见那片白。
   */
  origin: '这一片是活水，不深，长着芦苇。每年秋天芦花一开，整片塘白得像落了雪。'
    + '塘边最早只有两户人家，一户在浅滩上种藕，一户磨豆腐。后来人多了，就有了街。'
    + '住在这儿的人出门回来，望见那片白，就知道到家了。',
  streets: ['早市街', '灶前巷', '望水坡'],
  /*
   * 四条城规。前三条各自对一条机制（§4.17）；**第一条不对应任何机制 ——
   * 它对应这个世界的底线：住在这儿的都是鱼，鱼不吃鱼。**
   *
   * 2026-11-15 补：Mr.Q 一句「这是肥鱼们住的地方，你在这杀鱼卖鱼，这合理嘛」，
   * 点破了整个方案里最难看的一处 —— 我原来的来历写着「一户卖鱼、一户腌鱼」，
   * 街上还有一条「鱼市街」。**那是同类相食，而我从头到尾没觉得不对。**
   *
   * 这一条写进数据里不是摆设：以后加菜谱、加职业、加上游的时候，
   * 它是一条能直接拿来判的规则。
   */
  rules: ['塘里的不吃塘里的', '货不过夜', '价自己定，别人说贵你就听着', '赊账记在心里，不记在账上'],
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
    { headers: { accept: 'application/json' } },
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
    const streets = Array.isArray(j?.streets) ? j.streets.filter((x: unknown) => typeof x === 'string') : [];
    const rules = Array.isArray(j?.rules) ? j.rules.filter((x: unknown) => typeof x === 'string') : [];
    return {
      id: typeof j?.town === 'string' && j.town ? j.town : BUILTIN_TOWN.id,
      name: typeof j?.name === 'string' && j.name ? j.name : BUILTIN_TOWN.name,
      origin: typeof j?.origin === 'string' && j.origin ? j.origin : BUILTIN_TOWN.origin,
      streets: streets.length ? streets : BUILTIN_TOWN.streets.slice(),
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

export interface TownStall {
  id: string;
  seller: string;
  kind?: 'goods' | 'errand';
  item: string;
  price: number;
  stock: number;
  freshVeg?: boolean;
  note?: string;
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
): Promise<{ ok: boolean; town?: string; reason?: string }> {
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
    return { ok: true, town: typeof j.town === 'string' ? j.town : undefined };
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
    '/town/stalls',
    { headers: { accept: 'application/json' } },
    opts.timeoutMs ?? 2500,
  );
  if (!res || !res.ok) return { ok: false, stalls: [], bulletin: [] };
  try {
    const j: any = await res.json();
    const list = Array.isArray(j?.stalls) ? j.stalls : [];
    const stalls: TownStall[] = list
      .filter((x: any) => x && typeof x.id === 'string' && typeof x.item === 'string' && Number(x.price) > 0 && Number(x.stock) > 0)
      .map((x: any) => ({
        id: String(x.id),
        seller: typeof x.seller === 'string' ? x.seller : '街坊',
        kind: x.kind === 'errand' ? 'errand' : 'goods',
        item: String(x.item),
        price: Math.round(Number(x.price)),
        stock: Math.round(Number(x.stock)),
        freshVeg: Boolean(x.freshVeg),
        ...(typeof x.note === 'string' && x.note ? { note: x.note } : {}),
      }));
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
  opts: { timeoutMs?: number; buyerUid?: string; note?: string } = {},
): Promise<{ ok: boolean; item?: string; price?: number; seller?: string; freshVeg?: boolean; reason?: string }> {
  const roots = parseTownUrls(townUrl);
  if (!roots.length) return { ok: false, reason: '没配城服务器地址' };
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
  if (!res) return { ok: false, reason: '市集连不上' };
  try {
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) {
      return { ok: false, reason: typeof j?.error === 'string' ? j.error : `市集返回 ${res.status}` };
    }
    return {
      ok: true,
      item: typeof j?.item === 'string' ? j.item : '一份吃食',
      price: Math.round(Number(j?.price ?? 0)),
      seller: typeof j?.seller === 'string' ? j.seller : '街坊',
      freshVeg: Boolean(j?.freshVeg),
    };
  } catch {
    return { ok: false, reason: '市集连不上' };
  }
}

export async function postTownStall(
  townUrl: string | readonly string[],
  payload: { uid: string; pet: string; item: string; price: number; stock?: number; freshVeg?: boolean; kind?: 'goods' | 'errand'; note?: string },
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; id?: string; seller?: string; item?: string; price?: number; stock?: number; freshVeg?: boolean; reason?: string }> {
  const roots = parseTownUrls(townUrl);
  if (!roots.length) return { ok: false, reason: '没配城服务器地址' };
  if (!payload.uid) return { ok: false, reason: '缺少本机 uid，无法实名挂摊' };
  const { res } = await tryTownFetch(
    roots,
    '/town/stalls',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
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
    return {
      ok: true,
      id: typeof j?.id === 'string' ? j.id : '',
      seller: typeof j?.seller === 'string' ? j.seller : payload.pet,
      item: typeof j?.item === 'string' ? j.item : payload.item,
      price: Math.round(Number(j?.price ?? payload.price)),
      stock: Math.round(Number(j?.stock ?? payload.stock ?? 1)),
      freshVeg: Boolean(j?.freshVeg),
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
