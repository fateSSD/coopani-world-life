/**
 * 桥：只读别人的东西。
 *
 * 这里一条写操作都没有，也**永远不该有**。位置、时间、城名都只有一个来源，
 * 生活层是读者不是作者。这个约束不是洁癖 —— 一旦这边也开始写位置，
 * 两个扩展就会各说一套，而她到底是「在佛山」还是「在家」会变成一个谜。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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

  return { installed: true, phase, cityId, cityName, worldNow, speed, toName, staleSec };
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
export async function readTown(
  townUrl: string,
  homeCity = '',
  opts: { timeoutMs?: number } = {},
): Promise<TownView> {
  const base = String(townUrl || '').trim();
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

  if (!base) return own ? ownTown() : { ...BUILTIN_TOWN };

  const root = base.replace(/\/+$/, '').replace(/\/town\/info$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 2500);
  try {
    const res = await fetch(`${root}/town/info`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      /*
       * 配了地址但服务端回非 200 —— **这是故障，不是「没配」**。
       * 常见是 Worker 还是旧版（没有 `/town/info` 这个口），或者域名指错了。
       */
      return fallback(
        `服务器回了 ${res.status}，先按你填的算（可能是那个服务器还是旧版，没有 /town/info）`,
      );
    }
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
    /*
     * 超时、断网、证书错、返回不是 JSON。
     *
     * **对她来说结果一样**（今天不知道城名改了没有），所以照样退内置、不抛。
     * **但对用户不一样** —— 他明明配了地址，城名却一直显示「内置」，
     * 而「内置」两个字看起来像「我没配」。所以要标成 `failed`，让灯上说清。
     *
     * 具体是哪种错（ECONNREFUSED / 证书 / JSON）**不往 hint 里塞** ——
     * 那既不解释问题也不指向动作。
     */
    return fallback('连不上那个地址（超时或断网），先按你填的算');
  } finally {
    clearTimeout(timer);
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
export interface SpendRequest {
  /** 文件名就是它 —— 坏文件靠这个回一条 `rejected`。 */
  id: string;
  at: string;
  amount: number;
  note: string;
}

/** 条子目录名。和那边写死的那个字符串必须一致，改一处等于断桥。 */
export const SPEND_DIR = 'life-spend';

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
      const amount = Math.round(Number(raw?.amount));
      if (!Number.isFinite(amount) || amount <= 0) {
        /* 读得出来但数不对：记一条 0，调用方按 rejected 回。 */
        out.push({ id, at: '', amount: 0, note: '看不懂这一笔' });
        continue;
      }
      out.push({
        id,
        at: typeof raw?.at === 'string' ? raw.at : '',
        amount,
        note: typeof raw?.note === 'string' ? raw.note.slice(0, 60) : '',
      });
    } catch {
      out.push({ id, at: '', amount: 0, note: '这文件读不出来' });
    }
  }
  return out;
}
