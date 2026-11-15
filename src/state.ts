/**
 * 她的身体和日子。
 *
 * ## 三层，别混
 *
 * | 层 | 是什么 | 怎么变 |
 * |---|---|---|
 * | **条**（vitals） | 五条需求，0–100 | 按真实时间线性衰减；她做事时跳一下 |
 * | **状态**（conditions） | 感冒、过劳这种「得过一阵」的 | 由条的持续低位触发，有起止时刻 |
 * | **情绪**（moodlets） | 「吃得舒服」「被夸了一句」 | 有来源（source）和过期时刻，过期按**真实小时** |
 *
 * 为什么分成三层而不是一条血量：因为它们回答的问题不一样。
 * 条回答「她现在缺什么」，状态回答「她这几天怎么了」，情绪回答「她刚才为什么高兴」。
 * 挤成一个数，她说话就只剩「我状态还行」。
 *
 * ## 衰减只认真实时间
 *
 * 用户明确要的（方案 §3）：日子按真实时间过，不加速。
 * 所以这里**不读 journey 的 `clock.speed`** —— 那边倍速开到 24× 是为了让旅行快点走完，
 * 而她饿得有多快不该跟着变。倍速下她一小时吃八顿饭是荒谬的。
 *
 * ## 离线的那段时间怎么办
 *
 * 关机三天再开，不能让她一睁眼五条全 0 —— 那不是在惩罚她，是在惩罚用户。
 * 也不能当没过去（那她永远不饿）。
 * 折中：**离线按「她自己也在过日子」推演** —— 需求继续掉，但每满 24 小时
 * 精力回到 85（她睡了），并且总时长封顶 7 天。超过 7 天按 7 天算：
 * 再长的那段，她该是「一直在等你」，不是「快饿死了」。
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type JobDef, findJob, certOf, CERTS } from './jobs.ts';

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

/** 五条需求。全部 0–100。 */
export interface Vitals {
  /** 饱腹。掉得最快的那条 —— 一天要吃三顿。 */
  food: number;
  /** 精力。醒着就在掉，睡觉回满。 */
  energy: number;
  /** 清爽。洗澡能回，出门走动也会掉。 */
  clean: number;
  /** 娱乐。有没有乐子。 */
  fun: number;
  /** 社交。**满足源是鱼和鱼之间**，不是跟用户说话（方案 §2.2）。 */
  social: number;
}

export type VitalKey = keyof Vitals;

/** 一条情绪。过了 `expiresAt` 就没影响了 —— 按**真实时刻**判，不按世界时长。 */
export interface Moodlet {
  id: string;
  /** 谁给的。`eat` / `sleep` / `cold` / `talk` … 出问题时靠它反查。 */
  source: string;
  /** 一句话。给她在提示词里用，不是给用户看的 UI 文案。 */
  text: string;
  kind: 'good' | 'bad';
  /** ISO8601。到点自己失效，不需要谁来清。 */
  expiresAt: string;
}

/** 得过一阵的状态。有起止，不是布尔开关。 */
export interface Condition {
  id: 'cold' | 'overwork';
  since: string;
  /** 预计什么时候好。到时由 tick 判退，**不是硬写一个日期就完了** —— 恢复期还要看条。 */
  until: string;
  text: string;
}

/**
 * 一条「常态」。
 *
 * 这是**放权**的落点（方案 §5）：不写 `plan`（那等于替她排日程，是 journey 的老路），
 * 只写「她一般怎么做」。时刻到了，代码**不替她执行**，只在提示词里告诉她
 * 「这会儿你平时会吃饭」，做不做她定。
 *
 * 判据：如果删掉这条她照样过，那它该留下；如果删掉她就不知道该干什么，那它是 plan，砍掉。
 */
export interface Habit {
  id: string;
  /** 想做的事，一句话。 */
  what: string;
  /** 一天里的哪一段。四档够粗 —— 精确到点就又变成日程表了。 */
  when: 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';
  at: string;
}

/** 她在留意的一件事。**不是待办** —— 待办有完成态，留意没有。 */
export interface Watch {
  id: string;
  what: string;
  since: string;
}

/** 她想要的东西。和 wish 的区别：wish 是她要许愿、要被答应；want 就是想要，不用谁批。 */
export interface Want {
  id: string;
  what: string;
  /** 多大的事。`small` = 今天就能办，`big` = 得攒一攒。 */
  scale: 'small' | 'big';
  /**
   * 想要的是**东西**还是**去的地方**（2026-11-15 Mr.Q：「想去哪也要有个容器」）。
   *
   * 两条都记在同一个池子里（同一个工具、同一张表），因为对她来说都是「想要」；
   * 分开只是**给他看的时候**要分栏 —— 「想买什么」和「想去哪」是两件事。
   */
  kind: 'thing' | 'place';
  since: string;
  note: string;
}

/**
 * 可以告诉他的事（方案 §6.2 里「说与不说」那一半）。
 *
 * 池子是**她自己的生活**记下来的，不是聊天记录 —— 所以她说出来的是
 * 「今天我感冒了」，不是「你上次说你会早点睡」。后者需要关系账，那是二期。
 */
export interface Tellable {
  id: string;
  text: string;
  at: string;
  /** 说出来了没有。说过的不删，只是不再往提示词里塞。 */
  said: boolean;
}

/* ------------------------------------------------------------------ */
/* 她是谁、住哪儿、有多少钱                                              */
/* ------------------------------------------------------------------ */

/**
 * 住处四档。来自方案 §4.17 的「住处四档」，不是随手分的：
 * 四档之间的差别是**钱和体面**，不是装修风格 —— 她攒够钱想搬，搬的是这四格里的下一个。
 */
export type HomeTier = 'urban-village' | 'old' | 'new' | 'villa';

export const HOME_TIER_LABEL: Record<HomeTier, string> = {
  'urban-village': '城中村',
  old: '老小区',
  new: '新小区',
  villa: '别墅区',
};

/** 每档每月的住的开销（租是房租，买是月供加物业水电）。数字按她世界的量级，不按现实。 */
export const HOME_TIER_COST: Record<HomeTier, number> = {
  'urban-village': 450,
  old: 1200,
  new: 2600,
  villa: 7800,
};

/**
 * 搬进去要押几个月。
 *
 * 两个月是本地租房的老规矩，也是这件事**该有的分量**：一个月太轻，随便就搬；
 * 三个月太重，她会永远困在城中村。两月 = 「得攒一阵，但攒得到」。
 */
export const MOVING_DEPOSIT_MONTHS = 2;

export interface Home {
  /** 租的，还是买下来的。只影响说法和「搬走要不要押金」，不影响每月开销怎么扣。 */
  tenure: 'rent' | 'own';
  tier: HomeTier;
  /** 街名，取自本城的 `streets`。 */
  street: string;
  /** 每月住的开销。按天折算着扣（见 `advance`）。 */
  monthly: number;
  since: string;
}

/**
 * 职业。
 *
 * **一期只到「顶一天活」这一档** —— 干什么是她自己填的一句话，干一天拿一天的
 * `daily`。方案里的 66 种、五条通道、完成度系数都还没建（三四期）。
 *
 * 这一格存在的理由不是「职业系统做完了」，是**没有进项的钱是死数** ——
 * 一个只会变少的余额，两天就没人看了。
 */
export interface Job {
  /** 干什么。空串 = 现在没在做事。 */
  what: string;
  /** 职业表里的 id（`jobs.ts`）。空串 = 她自己随口说的一种活，按零工算。 */
  id: string;
  /** 顶一天活给多少。有 `id` 时跟着表走，自由描述时沿用这一格。 */
  daily: number;
  /** 手上的证（`jobs.ts` 的 `CERTS` 里的名字）。门槛就靠它兑现。 */
  certs: string[];
  /** 上一次出工是哪天（`YYYY-MM-DD`，本地日期）。一天一次就靠它判。 */
  lastAt: string;
  /** 一共出过几天工。 */
  days: number;
}

/**
 * 钱。
 *
 * **只记现金，不记房产。** 房子是「她住在哪儿」，不是「她能花多少」——
 * 把房子折进余额，她就永远有一大笔动不了的钱，而「攒够没有」这件事会变得说不清。
 */
export interface Money {
  cash: number;
  /** 进账合计（不按自然月清，从 `since` 起累加）。 */
  earned: number;
  spent: number;
  since: string;
}

/**
 * 目标。
 *
 * 和「想要」（`Want`）分开：**目标有进度条，想要没有。**
 * 「攒够 20000 换到新小区」是目标，它有明确的达成条件；
 * 「想买巷口那家的酱」是想要，买了就买了，没买也没关系。
 * 把两者合成一个列表，她说话就会分不清「我打算」和「我馋」。
 */
export interface Goal {
  id: string;
  what: string;
  /** 要攒到多少现金。0 = 不是钱的事（那类目标一期先不立）。 */
  need: number;
  /**
   * 达成了没有。
   *
   * **必须有这一格**：搬家类目标的判据不是「现金够不够」，而是「她真的搬进去了」——
   * 攒到 5200 那天她还没搬，目标不算完成；搬完钱花掉了，目标更不该退回「还差 4400」。
   * 只按现金算的目标，在花钱那一刻会自己倒回去，看起来像永远做不完。
   */
  done?: boolean;
  since: string;
}

/** 他哪天来过。 */
export interface Presence {
  /** 本地日期 `YYYY-MM-DD`。 */
  date: string;
  /** 那天第一次见到他的时刻。 */
  firstAt: string;
  /** 最后一次。 */
  lastAt: string;
  /** 一句话。那天她记住的事（现在由别处写，一期留空）。 */
  note: string;
}

/**
 * 悬着的事：她想做，但拿不准。
 *
 * 和 `Want` 的区别 —— 想要可以永远不兑现；**悬着的事有卡点**，卡点消了就该有下文。
 * 这个区别不是分类癖：`Want` 挂一年是常态，`Pending` 挂一年是她一直没决定，
 * 而后者会让她说话时反复回到同一件事上。
 */
export type PendingBlock = 'money' | 'time' | 'ask' | 'doubt';

export const PENDING_BLOCK_LABEL: Record<PendingBlock, string> = {
  money: '钱不够',
  time: '没时间',
  ask: '得先问一句',
  doubt: '自己没想清',
};

export interface Pending {
  id: string;
  what: string;
  blocked: PendingBlock;
  /** `blocked === 'money'` 时要多少。别的卡点填 0。 */
  cost: number;
  since: string;
  /** 悬太久就不再是「悬着」，是拖着。到期自己落到 pledge 或者干脆放弃。 */
  expiresAt: string;
}

/**
 * 承诺：她说好了要做的事。
 *
 * **这一层是「空话问题」的解药**（方案 §2.6）。她说「明天给你写张明信片」，
 * 世界里必须有这个东西记着；到期没做，不能静默消失 —— 要留一笔欠着。
 *
 * 为什么把 `said` 存原文：她是用**那句话**答应的。事后对账时，
 * 「我说过」和「我说的是这句」不是一回事。
 */
export interface Pledge {
  id: string;
  what: string;
  /** 对谁。空 = 对自己。 */
  to: string;
  dueAt: string;
  since: string;
  said: string;
}

/** 悬着的事最多几件。超过就是「什么都没在决定」，那不是纠结，是瘫着。 */
export const MAX_PENDING = 3;
/** 承诺同时最多几件。再多她做不完，而做不完的承诺比没承诺更糟。 */
export const MAX_PLEDGES = 5;
/** 悬着的事自动消几天。 */
export const PENDING_TTL_DAYS = 7;

export interface LifeState {
  version: number;
  /** 上一次推进的时刻。衰减的起点，**必须是真实时刻**。 */
  updatedAt: string;
  vitals: Vitals;
  moodlets: Moodlet[];
  conditions: Condition[];
  habits: Habit[];
  watches: Watch[];
  wants: Want[];
  /** 悬着的事（有卡点，不是欲望）。 */
  pending: Pending[];
  /** 她说好了要做的事。到期没做要留一笔欠着。 */
  pledges: Pledge[];
  tellable: Tellable[];
  presence: Presence[];
  /**
   * 她住哪条街。空 = 还没决定。**由她自己选，不是设置项**（方案 §4.17）。
   * 留在顶层而不是塞进 `home`，是因为它是「城的街名」而不是「房子的属性」——
   * 搬家会换 `home.tier`，但同一个街名可能一直住着。
   */
  street: string;
  home: Home;
  job: Job;
  money: Money;
  goals: Goal[];
  /** 今天已经提醒过哪几条 —— 用来实现「一天一次」。 */
  nagged: Record<string, string>;
  /**
   * 已经扣过的外部花销 id（`life-spend/<id>.json`，来自旅行扩展）。
   *
   * **判重表要落在状态文件里**，不能另存一份：加钱/扣钱和「这条扣过了」
   * 必须一次原子写进去，崩在中间就是重复扣（`references/20` §2）。
   * 按条数滚，不按时间 —— 世界时刻在倍速下没有稳定含义。
   */
  spendApplied: string[];
}

/* ------------------------------------------------------------------ */
/* 常量：所有数字都在这里，别散在代码各处                                */
/* ------------------------------------------------------------------ */

export const STATE_VERSION = 1;

/**
 * 每小时掉多少。数字的来源是「一天该补几次」倒推，不是拍脑袋：
 *
 * - 饱腹 `3.6` → 一天掉 86，三顿各 +30 正好补回来
 * - 精力 `4.6` → 醒 16 小时掉 74，睡 8 小时回 80，周末补觉能回满
 * - 清爽 `2.6` → 一天掉 62，洗一次 +55，一天不洗就开始难受
 * - 娱乐 `2.8` → 一天掉 67，玩一次 +38，一天要有点乐子才够
 * - 社交 `1.8` → 一天掉 43，见一次人 +30，一天半见一次刚好
 */
export const DECAY_PER_HOUR: Record<VitalKey, number> = {
  food: 3.6,
  energy: 4.6,
  clean: 2.6,
  fun: 2.8,
  social: 1.8,
};

/** 低于这个数就该被注意到了。**不自动扣血、不自动生病** —— 只是阈值事件。 */
export const LOW = 30;
/** 低于这个数算「已经很缺了」。 */
export const CRITICAL = 15;
/** 单次推进最多按多少小时算。见文件头「离线的那段时间怎么办」。 */
export const MAX_CATCHUP_HOURS = 7 * 24;

/** 她的行为表。她「做」一件事，就跳一下对应的条。 */
export interface ActKind {
  id: string;
  /** 中文名，给她说话用。 */
  label: string;
  /** 耗时（分钟）。用来判「这件事做完了没有」，以及她一天能做几件。 */
  minutes: number;
  /**
   * 要花多少钱。**免费也是一个明确的值**（0），不是省略 ——
   * 省略的话「这件事花不花钱」要靠人记，而漏记一次就是她的账对不上。
   */
  cost: number;
  gain: Partial<Vitals>;
  /** 做完可能产生的情绪。 */
  mood?: { text: string; kind: 'good' | 'bad'; hours: number };
}

export const ACTS: Record<string, ActKind> = {
  eat: {
    id: 'eat',
    label: '吃东西',
    minutes: 40,
    cost: 15,
    gain: { food: 30, fun: 4 },
    mood: { text: '吃得挺舒服', kind: 'good', hours: 2 },
  },
  sleep: {
    id: 'sleep',
    label: '睡觉',
    minutes: 7 * 60,
    cost: 0,
    /* 睡醒会有点乱 —— 这是真的，不是刻薄。 */
    gain: { energy: 80, clean: -8 },
    mood: { text: '睡够了，脑子是清的', kind: 'good', hours: 4 },
  },
  wash: {
    id: 'wash',
    label: '洗澡',
    minutes: 30,
    cost: 0,
    gain: { clean: 55, energy: -4 },
    mood: { text: '身上清爽了', kind: 'good', hours: 3 },
  },
  play: {
    id: 'play',
    label: '找点乐子',
    minutes: 60,
    cost: 22,
    gain: { fun: 38, energy: -6 },
    mood: { text: '玩得挺高兴', kind: 'good', hours: 3 },
  },
  /*
   * 「将就吃一口」。
   *
   * 它存在的唯一理由是**钱会花光**。没有这一格，余额见底那天她就只能饿着，
   * 而那不是困境，是死局 —— 一个没法自救的系统不会让人心疼，只会让人关掉它。
   * 免费、补得少、情绪是负的：能活，但吃得不开心。
   */
  instant: {
    id: 'instant',
    label: '将就吃一口',
    minutes: 15,
    cost: 0,
    gain: { food: 12 },
    mood: { text: '凑合吃了点，不太顶饱', kind: 'bad', hours: 2 },
  },
  meet: {
    id: 'meet',
    label: '跟人说说话',
    minutes: 90,
    cost: 30,
    gain: { social: 30, fun: 8, energy: -5 },
    mood: { text: '有人说话，心里踏实', kind: 'good', hours: 5 },
  },
};

/* ------------------------------------------------------------------ */
/* 默认状态                                                            */
/* ------------------------------------------------------------------ */

export function freshState(now: Date = new Date()): LifeState {
  return {
    version: STATE_VERSION,
    updatedAt: now.toISOString(),
    /*
     * 一开始不是满分。满分意味着「她什么都不缺」，那她第一次开口就没有理由。
     * 80 是「过得好好的，但快该吃下一顿了」。
     */
    vitals: { food: 80, energy: 80, clean: 80, fun: 75, social: 75 },
    moodlets: [],
    conditions: [],
    habits: [],
    watches: [],
    wants: [],
    pending: [],
    pledges: [],
    tellable: [],
    presence: [],
    street: '',
    /*
     * 她一开始住城中村、租的。**不是随机分的。**
     *
     * 随机分一档的话，有人开局就在别墅区，「攒钱搬到更好的地方」这条线
     * 从一开始就是断的。从最便宜那档起步，那四格才是一条路。
     */
    home: {
      tenure: 'rent',
      tier: 'urban-village',
      street: '',
      monthly: HOME_TIER_COST['urban-village'],
      since: now.toISOString(),
    },
    /* 新档从零工的价起步 —— 老存档里的 120 由 `normJob` 兜着，不动。 */
    job: { what: '', id: '', daily: 90, certs: [], lastAt: '', days: 0 },
    /*
     * 启动的钱。
     *
     * 3000 大约是**城中村两个月的总开销**：够她把日子过起来，不够她躺平。
     * 给多了「挣钱」不要紧，给少了第一周就得靠「将就吃一口」活着。
     */
    money: { cash: 3000, earned: 0, spent: 0, since: now.toISOString() },
    /*
     * 初始目标。
     *
     * **这个数不是拍的，是新小区的押金**（2600 × 2）。原来写 20000 ——
     * 那是个空数，攒到了也搬不了（搬家要的是押金，不是总资产），
     * 于是「目标」变成一个永远不会触发任何事的进度条。
     * 目标必须对应一个真能做的动作，否则它只是安慰。
     */
    goals: [{
      id: 'g-home',
      what: `攒够 ${HOME_TIER_COST.new * MOVING_DEPOSIT_MONTHS}，搬到新小区`,
      need: HOME_TIER_COST.new * MOVING_DEPOSIT_MONTHS,
      since: now.toISOString(),
    }],
    nagged: {},
    spendApplied: [],
  };
}

/* ------------------------------------------------------------------ */
/* 读写：原子写，坏文件不许把她清零                                      */
/* ------------------------------------------------------------------ */

const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));

/**
 * 本地日期 `YYYY-MM-DD`。
 *
 * **不能用 `toISOString().slice(0,10)`** —— 那是 UTC 日期。用户在 GMT+8，
 * 凌晨 0 点到 8 点之间，UTC 还停在前一天，于是「今天已经出过工了」会判错：
 * 他凌晨出工一次，早上再出工一次，两笔都算同一天，第二笔被拒。
 * 2026-11-15 自查时抓到，`applyWork` 原来就写着那个错法。
 */
export function localDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export class StateStore {
  readonly file: string;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'life-state.json');
  }

  /**
   * 读。
   *
   * **坏文件不抛、也不清空** —— 它先试 `life-state.json.bak`，再退全新状态。
   * 理由：她的日子是**不可再生**的（过去的事没法重演），
   * 一个写坏的文件不该让她从此凭空消失。宁可退回几天前那份，也不要从零。
   */
  load(now: Date = new Date()): { state: LifeState; recovered: 'ok' | 'bak' | 'fresh' } {
    for (const [path, tag] of [
      [this.file, 'ok'] as const,
      [`${this.file}.bak`, 'bak'] as const,
    ]) {
      try {
        const raw = readFileSync(path, 'utf8');
        const parsed = JSON.parse(raw) as Partial<LifeState>;
        if (parsed && typeof parsed === 'object' && parsed.vitals) {
          return { state: normalize(parsed, now), recovered: tag };
        }
      } catch {
        /* 下一个 */
      }
    }
    return { state: freshState(now), recovered: 'fresh' };
  }

  /**
   * 写。先写 `.tmp` 再 rename —— rename 在同一分区上是原子的，
   * 所以任何时刻磁盘上都是一个**完整**的文件，不会留半个 JSON。
   *
   * 上一版那份留成 `.bak`：写坏的那种事故里，它比「从零开始」值钱得多。
   */
  save(state: LifeState): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    try {
      /* 上一份先留成 .bak。第一次写没有旧文件，忽略即可。 */
      renameSync(this.file, `${this.file}.bak`);
    } catch {
      /* 没有旧文件 */
    }
    renameSync(tmp, this.file);
  }
}

/**
 * 把读进来的东西补齐、夹到合法范围。
 *
 * **必须做**：文件可能是上一版写的（少几个字段），也可能被手工改过。
 * 少一个字段就让 `.food` 变 undefined，后面的算术全变 NaN，而她会在提示词里
 * 看到「饱腹 NaN」——那比少一个字段难查得多。
 */
export function normalize(s: Partial<LifeState>, now: Date): LifeState {
  const base = freshState(now);
  const v = (s.vitals ?? {}) as Partial<Vitals>;
  return {
    version: STATE_VERSION,
    updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : now.toISOString(),
    vitals: {
      food: num(v.food, base.vitals.food),
      energy: num(v.energy, base.vitals.energy),
      clean: num(v.clean, base.vitals.clean),
      fun: num(v.fun, base.vitals.fun),
      social: num(v.social, base.vitals.social),
    },
    moodlets: arr(s.moodlets).filter((m) => m && typeof m.id === 'string' && typeof m.expiresAt === 'string'),
    conditions: arr(s.conditions).filter((c) => c && typeof c.id === 'string'),
    habits: arr(s.habits).filter((h) => h && typeof h.id === 'string'),
    watches: arr(s.watches).filter((w) => w && typeof w.id === 'string'),
    wants: arr(s.wants)
      .filter((w) => w && typeof w.id === 'string')
      /* 老存档没有 `kind` —— 一律当「东西」，不改她原来记的内容。 */
      .map((w) => ({ ...w, kind: w.kind === 'place' ? 'place' : 'thing' })),
    pending: arr(s.pending).filter((x) => x && typeof x.id === 'string'),
    pledges: arr(s.pledges).filter((x) => x && typeof x.id === 'string'),
    tellable: arr(s.tellable).filter((t) => t && typeof t.id === 'string'),
    presence: arr(s.presence).filter((p) => p && typeof p.date === 'string'),
    street: typeof s.street === 'string' ? s.street : '',
    home: normHome(s.home, now),
    job: normJob(s.job),
    money: normMoney(s.money, now),
    goals: arr(s.goals).filter((g) => g && typeof g.id === 'string'),
    nagged: (s.nagged && typeof s.nagged === 'object') ? s.nagged : {},
    spendApplied: arr(s.spendApplied).filter((x) => typeof x === 'string').slice(-120),
  };
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? clamp100(n) : fallback;
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** 老档里没有 `home` / `job` / `money` 那三格 —— 补齐，别让读面板的地方拿到 undefined。 */
function normHome(v: unknown, now: Date): Home {
  const o = (v ?? {}) as Partial<Home>;
  const tier = (['urban-village', 'old', 'new', 'villa'] as HomeTier[]).includes(o.tier as HomeTier)
    ? (o.tier as HomeTier) : 'urban-village';
  return {
    tenure: o.tenure === 'own' ? 'own' : 'rent',
    tier,
    street: typeof o.street === 'string' ? o.street : '',
    /*
     * **开销跟着档位走，不信档里存的那个数。**
     * 存着的话，改一次价目表，老档还是老价格 —— 而用户在设置里看到的是新价格。
     * 这一条是「事实只有一个来源」的最小版本。
     */
    monthly: HOME_TIER_COST[tier],
    since: typeof o.since === 'string' ? o.since : now.toISOString(),
  };
}

function normJob(v: unknown): Job {
  const o = (v ?? {}) as Partial<Job>;
  const certs = Array.isArray(o.certs) ? o.certs.filter((x) => typeof x === 'string') : [];
  return {
    what: typeof o.what === 'string' ? o.what : '',
    id: typeof o.id === 'string' ? o.id : '',
    daily: Number.isFinite(Number(o.daily)) && Number(o.daily) > 0 ? Number(o.daily) : 120,
    certs,
    lastAt: typeof o.lastAt === 'string' ? o.lastAt : '',
    days: Number.isFinite(Number(o.days)) ? Number(o.days) : 0,
  };
}

function normMoney(v: unknown, now: Date): Money {
  const o = (v ?? {}) as Partial<Money>;
  const n = (x: unknown, d: number) => (Number.isFinite(Number(x)) ? Number(x) : d);
  return {
    cash: Math.max(0, n(o.cash, 3000)),
    earned: Math.max(0, n(o.earned, 0)),
    spent: Math.max(0, n(o.spent, 0)),
    since: typeof o.since === 'string' ? o.since : now.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* 推进：时间过去了多少，她就缺了多少                                    */
/* ------------------------------------------------------------------ */

export interface AdvanceResult {
  hours: number;
  /** 这一段时间里房租（月供）没凑够。**钱扣到 0 为止，不会变成负数。** */
  rentMissed: boolean;
  /** 这一次扣掉的住的开销。 */
  rent: number;
  /** 这一次推进里，哪几条从「够」掉进了「低」。按需求分，同一条一小时只报一次。 */
  crossed: VitalKey[];
  /** 这次推进里自己好起来的病。 */
  recovered: Condition[];
  /** 这次新得的病。 */
  caught: Condition[];
}

/**
 * 推进到 `now`。
 *
 * **幂等**：`now` 比 `updatedAt` 早（时钟被拨回去、或者两次调用同一个时刻）时
 * 一动不动 —— 否则会把时间倒着扣，她越活越精神。
 */
export function advance(state: LifeState, now: Date): AdvanceResult {
  const from = Date.parse(state.updatedAt);
  const to = now.getTime();
  const rawHours = Number.isFinite(from) ? (to - from) / 3_600_000 : 0;
  if (!(rawHours > 0)) {
    return { hours: 0, crossed: [], recovered: [], caught: [], rentMissed: false, rent: 0 };
  }

  const hours = Math.min(rawHours, MAX_CATCHUP_HOURS);

  const before: Vitals = { ...state.vitals };
  for (const key of Object.keys(DECAY_PER_HOUR) as VitalKey[]) {
    state.vitals[key] = clamp100(state.vitals[key] - DECAY_PER_HOUR[key] * hours);
  }

  /*
   * 离线补睡。
   *
   * 每满 24 小时她至少睡下过一次，精力回到 85。这样关机三天回来，
   * 她是「有点饿、有点闷」，不是「快不行了」。
   * 只补精力 —— 吃饭、洗澡、找乐子、见人这些**不能凭空补**，
   * 补了就等于「她不在的时候你替她过了日子」，那她的日子就不算她的。
   */
  const wholeDays = Math.floor(hours / 24);
  if (wholeDays > 0) {
    state.vitals.energy = clamp100(Math.max(state.vitals.energy, 85));
  }

  /*
   * 住的开销，按天折算着扣。
   *
   * **按天不按月**：按月的话，她 15 号搬进来、下个月 1 号才扣，
   * 中间那半个月白住；而且关机跨月再开，那次扣款会凭空消失。
   * 按天算，账永远对得上，哪怕她一整月没开机。
   *
   * 扣到 0 为止，**不许变负数** —— 欠租要有一套催缴、协商、被赶走的规则，
   * 那是一整个系统，一期不做。扣不动就记一条「这个月房租没凑够」，
   * 那是她的处境，不是 bug。
   */
  const perDay = state.home.monthly / 30;
  const rent = Math.round(perDay * hours / 24);
  let rentMissed = false;
  if (rent > 0) {
    const paid = Math.min(rent, state.money.cash);
    state.money.cash -= paid;
    state.money.spent += paid;
    rentMissed = paid < rent;
    if (rentMissed) {
      remember(state, '这个月的房租没凑够。', now);
    }
  }

  /* 过期的情绪清掉。按真实时刻判 —— 见文件头。 */
  const iso = now.toISOString();
  state.moodlets = state.moodlets.filter((m) => Date.parse(m.expiresAt) > now.getTime());

  /*
   * 悬着的事过期就消。
   *
   * 不自动转成 pledge —— 那是替她决定。悬太久的东西，
   * 正确答案往往是「她其实不想做」，而不是「那就定下来吧」。
   */
  const beforePending = state.pending.length;
  state.pending = state.pending.filter((x) => Date.parse(x.expiresAt) > now.getTime());
  if (state.pending.length < beforePending) {
    const gone = beforePending - state.pending.length;
    remember(state, `有 ${gone} 件悬着的事自己算了。`, now);
  }

  /* 病好了没有。 */
  const recovered: Condition[] = [];
  state.conditions = state.conditions.filter((c) => {
    if (Date.parse(c.until) <= now.getTime()) {
      recovered.push(c);
      return false;
    }
    return true;
  });

  /* 新得的病。 */
  const caught: Condition[] = [];
  const has = (id: Condition['id']) => state.conditions.some((c) => c.id === id);
  if (!has('cold') && state.vitals.energy < CRITICAL && state.vitals.clean < CRITICAL) {
    const c: Condition = {
      id: 'cold',
      since: iso,
      until: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
      text: '感冒了。有点晕，鼻子不通。',
    };
    state.conditions.push(c);
    caught.push(c);
  }
  if (!has('overwork') && state.vitals.energy <= CRITICAL) {
    const c: Condition = {
      id: 'overwork',
      since: iso,
      until: new Date(now.getTime() + 1 * 86_400_000).toISOString(),
      text: '过劳。歇一天，什么都提不起劲。',
    };
    state.conditions.push(c);
    caught.push(c);
  }

  /*
   * 哪几条在这一段里掉过了线。
   *
   * 判据是「上一次在线上、这一次在线下」—— **不是「现在低」**。
   * 只判「现在低」的话，她饿着的那十几个小时里每一跳都会报一次，
   * 一天报上百次，那是刷屏不是提醒。
   */
  const crossed: VitalKey[] = [];
  for (const key of Object.keys(DECAY_PER_HOUR) as VitalKey[]) {
    if (before[key] >= LOW && state.vitals[key] < LOW) crossed.push(key);
  }

  state.updatedAt = iso;
  return { hours, crossed, recovered, caught, rentMissed, rent };
}

/* ------------------------------------------------------------------ */
/* 她做一件事                                                          */
/* ------------------------------------------------------------------ */

export interface ActResult {
  ok: boolean;
  reason?: string;
  /** 做完之后的五条。 */
  vitals: Vitals;
  /** 这件事带出来的情绪。 */
  mood: Moodlet | null;
  /** 这件事花了多少。免费的是 0。 */
  cost: number;
  /** 花完还剩多少。 */
  cash: number;
}

/**
 * 她做了 `kind` 这件事。
 *
 * **不做时间校验**（比如「现在半夜三点不该洗澡」）——
 * 那是替她判断，而判断权是她的（PHILOSOPHY 铁律 4）。这里只算数。
 *
 * **但要做一件事：把这件事记进 tellable。**
 * 生活事件是「说与不说」的原料（方案 §6.3）。不记，她事后就没素材可讲，
 * 说出来的全是空的「我今天过得还行」。
 */
export function applyAct(
  state: LifeState, kindId: string, now: Date,
): ActResult {
  const act = ACTS[kindId];
  if (!act) {
    /*
     * 报错要报**她看得懂的那种**：给 `eat / sleep / …` 她只会在下一次调用里
     * 照抄那串英文 id，而那串 id 出现在她的句子里就是一股机器味。
     * 给中文名 + 括号里的 id，两边都能用。
     */
    const list = Object.values(ACTS)
      .map((a) => `${a.label}（${a.id}）`)
      .join('　');
    return {
      ok: false,
      reason: `没有「${kindId}」这件事。能做的：${list}。`,
      vitals: state.vitals,
      mood: null,
      cost: 0,
      cash: state.money.cash,
    };
  }

  /*
   * 钱不够就不许做 —— **但要把「替代方案」说出来。**
   *
   * 只说「钱不够」她会愣在那儿，下次再试一次，还是不行。
   * 说「钱不够，只能将就吃一口」，她才知道路在哪儿。
   */
  if (act.cost > state.money.cash) {
    const alt = Object.values(ACTS).filter((a) => a.cost <= state.money.cash);
    const altText = alt.length
      ? `现在还能做：${alt.map((a) => `${a.label}（${a.id}）`).join('　')}。`
      : '现在什么都做不了 —— 一分钱都没有了。';
    return {
      ok: false,
      reason: `「${act.label}」要 ${act.cost} 元，你手上只有 ${state.money.cash} 元。${altText}`,
      vitals: state.vitals,
      mood: null,
      cost: 0,
      cash: state.money.cash,
    };
  }

  for (const [k, delta] of Object.entries(act.gain)) {
    const key = k as VitalKey;
    state.vitals[key] = clamp100(state.vitals[key] + Number(delta));
  }

  let mood: Moodlet | null = null;
  if (act.mood) {
    mood = {
      id: `m-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      source: act.id,
      text: act.mood.text,
      kind: act.mood.kind,
      expiresAt: new Date(now.getTime() + act.mood.hours * 3_600_000).toISOString(),
    };
    /* 同一件事连着做，只留最新那条 —— 不然「吃得舒服」会攒成一串。 */
    state.moodlets = state.moodlets.filter((m) => m.source !== act.id);
    state.moodlets.push(mood);
  }

  if (act.cost > 0) {
    state.money.cash -= act.cost;
    state.money.spent += act.cost;
  }

  remember(state, `${act.label}了。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true, vitals: state.vitals, mood, cost: act.cost, cash: state.money.cash };
}

/* ------------------------------------------------------------------ */
/* 出工：钱从哪儿来                                                      */
/* ------------------------------------------------------------------ */

export interface WorkResult {
  ok: boolean;
  reason?: string;
  /** 这一天挣了多少。 */
  earned: number;
  cash: number;
  vitals: Vitals;
}

/**
 * 她去顶一天活。
 *
 * ## 为什么是「一天一次」而不是「一次几小时」
 *
 * 按小时算要有一个「现在是几点」的判定，而她的钟可能是 journey 的倍速钟 ——
 * 那就成了「她在倍速世界里一天能干八份工」。
 * 按**本地的自然日**判，一天一次，简单，而且和真实时间对得上。
 *
 * ## 为什么精力低于 20 就不让去
 *
 * 这不是替她判断「该不该去」，是**身体真的动不了**。
 * 这个阈值比饿肚子严，因为饿着还能走，脱力了走不了。
 */
export function applyWork(state: LifeState, what: string, now: Date): WorkResult {
  const day = localDateKey(now);
  if (state.job.lastAt === day) {
    return {
      ok: false,
      reason: '今天已经出过工了。一天顶一天。',
      earned: 0,
      cash: state.money.cash,
      vitals: state.vitals,
    };
  }
  if (state.vitals.energy < 20) {
    return {
      ok: false,
      reason: `精力只剩 ${Math.round(state.vitals.energy)}，今天出不动工。先歇着。`,
      earned: 0,
      cash: state.money.cash,
      vitals: state.vitals,
    };
  }

  const told = String(what || '').trim();
  /*
   * 认表：说「护工」就按护工的价，说「帮人看摊」就还是零工的价。
   *
   * 不填的时候沿用上一次那个 —— 她说过「以后默认还是这个」。
   */
  const def = told
    ? findJob(told)
    : (state.job.id ? findJob(state.job.id) : null);

  let pay: number;
  let label: string;
  let load: JobDef['load'];

  if (def) {
    const gate = jobGate(state, def);
    if (gate) {
      return { ok: false, reason: gate, earned: 0, cash: state.money.cash, vitals: state.vitals };
    }
    pay = def.pay;
    label = def.name;
    load = def.load;
    state.job.id = def.id;
  } else {
    /*
     * 表里没有 —— 她自己说的活，按零工算，**价格沿用 `daily`**。
     *
     * 不改成 90：老存档里她一天挣 120，突然掉到 90 会像是「你干活不值钱了」，
     * 而用户什么都没改过。要降，是下一次调表的事。
     */
    label = told || state.job.what || '打零工';
    pay = state.job.daily;
    load = { energy: 34, clean: 16, fun: 10, social: 0 };
    state.job.id = '';
  }

  state.job.what = label;
  state.job.daily = pay;

  state.money.cash += pay;
  state.money.earned += pay;

  /*
   * 一天的代价。比一件「事」重得多 —— 这是整天。
   *
   * 档位越高扣得越多（见 `jobs.ts` 的 `LOAD`）：钱多出来的那部分，
   * 是从她这一天里挤出来的。专业岗还扣社交 —— 一整天不在家，谁也没见着。
   */
  state.vitals.energy = clamp100(state.vitals.energy - load.energy);
  state.vitals.clean = clamp100(state.vitals.clean - load.clean);
  state.vitals.fun = clamp100(state.vitals.fun - load.fun);
  if (load.social) state.vitals.social = clamp100(state.vitals.social - load.social);

  state.job.lastAt = day;
  state.job.days += 1;

  remember(state, `${label}，挣了 ${pay} 元。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true, earned: pay, cash: state.money.cash, vitals: state.vitals };
}

/**
 * 这道活她够不够格。返回**拒绝时该说的话**，`null` = 能去。
 *
 * ## 为什么门槛要能兑现
 *
 * 2026-11-15 Mr.Q：「包括职业的执业资格，经验要求越多的工资越高。」
 * 工资按门槛分档之后，门槛本身必须是真的 —— 否则她第一天就能说自己有护工证，
 * 那张表就白做了。
 *
 * 三种门槛都落在**世界能查的地方**：`job.certs`（考过就是考过）、
 * `job.days`（出过几天工，代码一直在记）。不靠她自述。
 *
 * 拒绝的话要把「差什么、怎么补」说出来 —— 只说「你不行」，
 * 她下一步还是不知道往哪走（跟卷二那条「钱不够要说替代方案」同一个道理）。
 */
export function jobGate(state: LifeState, def: JobDef): string | null {
  if (def.cert && !state.job.certs.includes(def.cert)) {
    const c = certOf(def.cert);
    return `「${def.name}」要${def.cert}，你手上没有。`
      + (c ? `考一张 ${c.price} 元，用 \`life_cert\`。` : '');
  }
  if (def.days && state.job.days < def.days) {
    return `「${def.name}」要出过 ${def.days} 天工，你才 ${state.job.days} 天。先干几天不要证的活。`;
  }
  return null;
}

/** 考证的结果。 */
export interface CertResult {
  ok: boolean;
  reason?: string;
  cert?: string;
  /** 花掉多少。 */
  paid: number;
  cash: number;
}

/**
 * 去考一张证。
 *
 * ## 为什么考证要花钱
 *
 * 不然「我有护工证」只是一句话。花了钱，它就是一个真的取舍：
 * 手上有 3000，是去考一张 600 的驾照（之后日薪从 90 变 230），还是先搬去老小区？
 *
 * ## 为什么只花一天、不占出工日
 *
 * 占的话，`job.lastAt` 一写，「今天已经出过工」就提前判死了 —— 一个字段两种含义，
 * 迟早出错。所以考证只扣精力（−20），不碰 `lastAt`。
 * 代价是理论上她可以「考一张证再上一整天班」，但那要 20 点精力，连着来两次就动不了。
 */
export function applyCert(state: LifeState, name: string, now: Date): CertResult {
  const c = certOf(name);
  if (!c) {
    const list = CERTS.map((x) => `${x.name}（${x.price} 元）`).join('、');
    return { ok: false, reason: `没有这张证可考。能考的：${list}。`, paid: 0, cash: state.money.cash };
  }
  if (state.job.certs.includes(c.name)) {
    return { ok: false, reason: `你已经考过${c.name}了。`, paid: 0, cash: state.money.cash };
  }
  if (state.money.cash < c.price) {
    return {
      ok: false,
      reason: `${c.name}要 ${c.price} 元，你手上只有 ${Math.round(state.money.cash)} 元。`,
      paid: 0,
      cash: state.money.cash,
    };
  }
  state.money.cash -= c.price;
  state.money.spent += c.price;
  state.job.certs.push(c.name);
  state.vitals.energy = clamp100(state.vitals.energy - 20);
  remember(state, `考下了${c.name}，花了 ${c.price} 元。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true, cert: c.name, paid: c.price, cash: state.money.cash };
}

/**
 * 收一笔外部递来的花销（旅行扩展的 `life-spend/<id>.json`）。
 *
 * ## 为什么抽成纯函数
 *
 * 这条路的错法很贵：**重复扣她的钱**。抽出来才能在冒烟里一条条试
 * （同一张条子跑两次、数不对、钱不够），不用起一个 World。
 *
 * ## 三条边界
 *
 * 1. **判重看 `state.spendApplied`**，和扣钱在同一次 `save()` 里落盘；
 * 2. **不扣成负数**：钱不够就扣到 0，记一条「没付清」—— 欠债是另一套系统（一期不做）；
 * 3. **数不对的条子回 `rejected`**，不然那份文件在对面永远删不掉。
 */
export interface SpendSettle {
  id: string;
  status: 'applied' | 'rejected';
}

export function applySpend(
  state: LifeState,
  reqs: readonly { id: string; amount: number; note?: string }[],
  now: Date,
): { settled: SpendSettle[]; changed: boolean } {
  const done = new Set(state.spendApplied);
  const settled: SpendSettle[] = [];
  let changed = false;

  for (const r of reqs) {
    const id = String(r?.id ?? '').trim();
    if (!id) continue;
    if (done.has(id)) {
      /* 收过了 —— 仍然回 `applied`，让对面能删它那份文件。 */
      settled.push({ id, status: 'applied' });
      continue;
    }
    const amount = Math.round(Number(r?.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      state.spendApplied.push(id);
      settled.push({ id, status: 'rejected' });
      changed = true;
      continue;
    }
    const pay = Math.min(amount, Math.max(0, Math.round(state.money.cash)));
    state.money.cash -= pay;
    state.money.spent += pay;
    state.spendApplied.push(id);
    settled.push({ id, status: 'applied' });
    changed = true;
    const note = String(r?.note ?? '').slice(0, 60);
    if (pay < amount) {
      remember(state, `${note || '旅行的花销'}没付清，还差 ${amount - pay} 元。`, now);
    } else if (note) {
      remember(state, `${note}花了 ${amount} 元。`, now);
    }
  }

  state.spendApplied = state.spendApplied.slice(-120);
  if (changed) state.updatedAt = now.toISOString();
  return { settled, changed };
}

/* ------------------------------------------------------------------ */
/* 他来过没有                                                          */
/* ------------------------------------------------------------------ */

export type VisitResult = 'new-day' | 'same-day';

/**
 * 记一次「他来过」。
 *
 * ## 为什么这件事值得单独一个函数
 *
 * 「她记得你哪天来过」是关系账里最轻、也最先见效的一条（方案 §6.2）。
 * 它需要一个**只记时间、不记内容**的通道 —— 内容归宿主的记忆系统管，
 * 生活层碰了就越界了。
 *
 * ## 判据是「会话文件变了」，不是「他说了几句」
 *
 * 会话文件里也有她自己的回复，而且一轮对话会写好几行。
 * **数不清楚的东西就不数** —— 所以这里只记「哪天、第一次、最后一次」，
 * 不记条数。写一个「他说了 7 句」而实际是他的 3 句加她的 4 句，那是编。
 */
export function noteVisit(state: LifeState, now: Date): VisitResult {
  const date = localDateKey(now);
  const hit = state.presence.find((p) => p.date === date);
  if (hit) {
    hit.lastAt = now.toISOString();
    return 'same-day';
  }
  state.presence.push({
    date,
    firstAt: now.toISOString(),
    lastAt: now.toISOString(),
    note: '',
  });
  /* 留 60 天。再长就不是「记得你来过」，是一份考勤表。 */
  if (state.presence.length > 60) state.presence = state.presence.slice(-60);
  return 'new-day';
}

/** 他这几天来过几次 —— 给她说话用的口径。 */
export function recentVisits(state: LifeState, now: Date, days = 7): number {
  const from = new Date(now.getTime() - days * 86_400_000);
  const cut = localDateKey(from);
  return state.presence.filter((p) => p.date >= cut).length;
}

/**
 * 攒够了、但还没办的目标。
 *
 * ## 为什么不在这里直接帮她搬
 *
 * 「攒够 5200 就搬到新小区」是**她自己的目标**。代码替她执行，那这个目标
 * 就不再是她的决定了 —— 它变成一个定时器。
 *
 * 所以这一层只回答「钱够了没有」，**搬不搬由她判断**：
 * 户型可能不合适、可能想再攒点买下来、可能这阵子不想折腾。
 * 这些理由代码都不知道，只有她（和她的模型）知道。
 *
 * 调用方拿到结果后只该做一件事：**告诉她「攒够了」**，然后等她自己动。
 */
export function readyGoals(state: LifeState): Goal[] {
  return state.goals.filter((g) => !g.done && g.need > 0 && state.money.cash >= g.need);
}

/**
 * 往 tellable 池子里放一条。
 *
 * **上限 20 条，满了丢最旧的。** 它不是日志，是「她可以拿出来说的事」。
 * 攒到两百条的时候，她说话会开始随机抽一条讲过八百遍的旧事 ——
 * 那比没有素材更像复读机。
 */
export function remember(state: LifeState, text: string, now: Date): void {
  const t = String(text || '').trim();
  if (!t) return;
  const id = `t-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  state.tellable.push({ id, text: t, at: now.toISOString(), said: false });
  if (state.tellable.length > 20) state.tellable = state.tellable.slice(-20);
}

/* ------------------------------------------------------------------ */
/* 搬家                                                                */
/* ------------------------------------------------------------------ */

export interface MoveQuote {
  tier: HomeTier;
  label: string;
  monthly: number;
  /** 一次性押金。老房子的押金**不退**，所以实际要准备的是这个数。 */
  deposit: number;
  ok: boolean;
  /** 还差多少。够了是 0。 */
  short: number;
}

/**
 * 搬去某一档要多少钱。
 *
 * 单独拆出来是因为**面板要在按之前就把价说清**。让人点一下才知道
 * 「钱不够」，比在旁边写着「还差 1800」难受得多。
 */
export function quoteMove(state: LifeState, tier: HomeTier): MoveQuote {
  const monthly = HOME_TIER_COST[tier];
  const deposit = monthly * MOVING_DEPOSIT_MONTHS;
  const short = Math.max(0, deposit - state.money.cash);
  return { tier, label: HOME_TIER_LABEL[tier], monthly, deposit, ok: short === 0, short };
}

export interface MoveResult {
  ok: boolean;
  reason?: string;
  from: HomeTier;
  to: HomeTier;
  deposit: number;
  cash: number;
}

/**
 * 搬家。
 *
 * ## 老房子的押金不退
 *
 * 不是刻薄，是这件事该有代价：走的时候要结清水电、赔墙上那几颗钉子。
 * 押金能全额拿回来的话，搬家就没有成本，她会一个月搬八次 ——
 * 而「住哪儿」就不是一个决定了。
 *
 * ## 为什么允许往低处搬
 *
 * 钱紧的时候搬回城中村是**唯一能自救的动作**。只允许往上走，
 * 那余额见底那天她就彻底没路了（这就是上一版「将就吃一口」解决的同一个问题）。
 *
 * ## 租的搬过去还是租的
 *
 * `tenure` 不变。买房是另一件事（要一次付两年租金当房价），一期不做 ——
 * 半做的话会出现「她买了房，但我们没算过房价和月供」这种半截状态。
 */
export function applyMove(state: LifeState, tier: HomeTier, now: Date): MoveResult {
  const from = state.home.tier;
  if (tier === from) {
    return {
      ok: false,
      reason: `你已经住在${HOME_TIER_LABEL[from]}了。`,
      from, to: tier, deposit: 0, cash: state.money.cash,
    };
  }
  const q = quoteMove(state, tier);
  if (!q.ok) {
    return {
      ok: false,
      reason: `搬去${q.label}要押两个月 ${q.deposit} 元，你手上只有 ${state.money.cash} 元，还差 ${q.short} 元。`,
      from, to: tier, deposit: q.deposit, cash: state.money.cash,
    };
  }

  state.money.cash -= q.deposit;
  state.money.spent += q.deposit;
  state.home.tier = tier;
  state.home.monthly = q.monthly;
  state.home.since = now.toISOString();

  /*
   * 搬到位的目标标成达成。
   *
   * 判据是「新家的押金 ≤ 目标要攒的数」—— 不是硬编码 `tier === 'new'`。
   * 这样加一档、改一次价，逻辑都不用动。
   */
  for (const g of state.goals) {
    if (!g.done && g.id === 'g-home' && g.need >= q.deposit) {
      g.done = true;
      remember(state, `目标达成了：${g.what}。`, now);
    }
  }

  remember(state, `搬到${q.label}了。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true, from, to: tier, deposit: q.deposit, cash: state.money.cash };
}

/* ------------------------------------------------------------------ */
/* 读数：给提示词和面板用的那一份「现状」                                 */
/* ------------------------------------------------------------------ */

export interface Snapshot {
  vitals: Vitals;
  home: Home;
  job: Job;
  money: Money;
  goals: Goal[];
  /** 低于 LOW 的那几条，按缺得最狠的排前面。 */
  low: { key: VitalKey; value: number; label: string }[];
  conditions: Condition[];
  moodlets: Moodlet[];
  habits: Habit[];
  watches: Watch[];
  wants: Want[];
  /** 还没说出去的、最近那几条。 */
  unsaid: Tellable[];
  pending: Pending[];
  /** 说好了还没到期的。 */
  pledges: Pledge[];
  /** 到期没做的承诺 —— 她欠着的。 */
  overdue: Pledge[];
  /** 7 天内他来过几天。 */
  visitedDays: number;
}

export const VITAL_LABEL: Record<VitalKey, string> = {
  food: '饱腹',
  energy: '精力',
  clean: '清爽',
  fun: '娱乐',
  social: '社交',
};

export function snapshot(state: LifeState, now: Date): Snapshot {
  const low = (Object.keys(state.vitals) as VitalKey[])
    .filter((k) => state.vitals[k] < LOW)
    .map((k) => ({ key: k, value: Math.round(state.vitals[k]), label: VITAL_LABEL[k] }))
    .sort((a, b) => a.value - b.value);

  return {
    vitals: state.vitals,
    home: state.home,
    job: state.job,
    money: state.money,
    /* 目标进度不掉 —— 它是「攒到多少」，不是「还剩多少」。面板自己拿 cash 比。 */
    goals: state.goals,
    low,
    conditions: state.conditions,
    /* 过期的在这一刻已经不该算数了 —— 读的时候再滤一遍，别指望 tick 一定跑过。 */
    moodlets: state.moodlets.filter((m) => Date.parse(m.expiresAt) > now.getTime()),
    habits: state.habits,
    watches: state.watches,
    wants: state.wants,
    unsaid: state.tellable.filter((t) => !t.said).slice(-3),
    pending: state.pending,
    pledges: state.pledges.filter((p) => Date.parse(p.dueAt) > now.getTime()),
    overdue: state.pledges.filter((p) => Date.parse(p.dueAt) <= now.getTime()),
    visitedDays: recentVisits(state, now, 7),
  };
}
