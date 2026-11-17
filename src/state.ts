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
import { readFileSync, writeFileSync, appendFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type JobDef, findJob, certOf, CERTS, jobAllowedAt } from './jobs.ts';

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
  id: 'cold' | 'overwork' | 'stomach' | 'injury' | 'hangover';
  since: string;
  /** 预计什么时候好。到时由 tick 判退，**不是硬写一个日期就完了** —— 恢复期还要看条。 */
  until: string;
  text: string;
}

/** 他伸手留下的东西（一天最多一件，不刷好感数值）。 */
export interface Gift {
  id: string;
  what: string;
  from: string;
  at: string;
}

/** 连着做同一件事的计数，用来触发「小脾气/肠胃/宿醉」。 */
export interface ActStreak {
  act: string;
  count: number;
}

/** 统一账本流水（写入 life-ledger.jsonl）。 */
export interface LedgerEntry {
  id: string;
  ts: string;
  kind: 'income' | 'expense';
  amount: number;
  source: string;
  payee: string;
  note: string;
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

/**
 * 住处对五条衰减的减免系数（2026-11-17 Mr.Q）。
 *
 * 原话：「好房子我觉得可以减少她五维的损失，越好的房子损失越少，除了疲劳值。」
 *
 * 所以：**四条按档打折，精力一分不减**。房子能挡住潮气、油烟、吵闹、孤独，
 * 挡不住「今天干了十小时活，累了」。
 *
 * 系数不是随便挑的 —— 城中村是 1（基准，不改老档体感），往上每档少掉一成上下：
 * 别墅区 0.75 意味着一天下来饱腹只掉 65 而不是 86，两顿正常饭就能补住；
 * 而房租是城中村的 17 倍（450 → 7800）。**贵得离谱是有意的**：
 * 减免只能省下麻烦，不能省下干活，所以它永远是一笔「划算但吃力」的账。
 */
export const HOME_TIER_RELIEF: Record<HomeTier, number> = {
  'urban-village': 1,
  old: 0.92,
  new: 0.84,
  villa: 0.75,
};

/** 四档的先后顺序。搬家的方向、兜底目标的指向都靠它。 */
export const TIER_ORDER: readonly HomeTier[] = ['urban-village', 'old', 'new', 'villa'];

/** 比现在这档好一级的那一档。已经是别墅区就返回 null（没得搬了）。 */
export function nextHomeTier(t: HomeTier): HomeTier | null {
  const i = TIER_ORDER.indexOf(t);
  return i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1] : null;
}

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
  /** 他留下的东西。 */
  gifts: Gift[];
  /** 连续动作计数（不破坏老档，缺省按空处理）。 */
  streak?: ActStreak;
  /** 已触发过「生活回声」的 want id，避免同一条反复念。 */
  echoedWants?: string[];
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
   * 她什么时候睡下的（ISO，真实时间）。空串 = 醒着。
   *
   * **和 `asleepUntil` 成对存在，两个都有才是一次完整的睡眠。**
   * 它的唯一用途是算「这一觉睡了几小时」—— 精力要按睡过的钟点结算，
   * 不能像以前那样在睡下那一瞬间就把 80 点打进去（睡十秒起来也拿满 80，
   * 那是免费回血按钮，不是睡觉）。
   */
  asleepFrom: string;
  /**
   * 她在睡，睡到什么时候（ISO，真实时间）。空串 = 醒着。
   *
   * 2026-11-15 Mr.Q：「睡眠时禁止 journey 的出发。」
   * 这是**唯一一个给别的扩展看的状态** —— 经 `life-public.json` 广播出去。
   * 用它判，不判「当前动作是不是 sleep」：动作是瞬时的，睡是**一段时间**。
   */
  asleepUntil: string;
  /**
   * 见识（0–100）。**只增不减，不进「五条」。**
   *
   * 2026-11-17 Mr.Q：「加娱乐，娱乐的同时还能增长见识（考证的前提，
   * 见识越高考过的概率就越大）」。
   *
   * 为什么不塞进 `vitals`：五条是会掉、会触阈值、每回合被念一遍的需求；
   * 见识是**积累**，掉下去就等于知识忘光了，那是另一种东西。
   * 它更像 `job.days` —— 只往上走，走慢一点。
   */
  knowledge: number;
  /**
   * 每张证最后一次去考是哪天（`YYYY-MM-DD`，本地日期）。
   *
   * 一天一张只考一次。不加这道闸，模型会在考砸之后连着再考 ——
   * 钱照扣，几次就把 3000 烧光，而用户看到的是「她在考证中心反复刷卡」。
   */
  certLast: Record<string, string>;
  /**
   * 已经扣过的外部花销 id（`life-spend/<id>.json`，来自旅行扩展）。
   *
   * **判重表要落在状态文件里**，不能另存一份：加钱/扣钱和「这条扣过了」
   * 必须一次原子写进去，崩在中间就是重复扣（`references/20` §2）。
   * 按条数滚，不按时间 —— 世界时刻在倍速下没有稳定含义。
   */
  spendApplied: string[];
  /**
   * 她睡着时跨过线、但没提的那几条（2026-11-17 修）。
   *
   * 原来睡着时 `crossed` 直接丢掉 —— 一句「半夜别吵她」的实现方式，
   * 顺手把**这八小时里的事实也扔了**：跨线只判「上一次在线上、这一次在线下」，
   * 醒来那一下 crossed 早就是空的，于是那几条永远没人提。
   * 她每天睡八小时，等于一天里有三分之一的越线事故被静音。
   *
   * 现在先记在这儿，醒来第一件事补发，补完清空。
   */
  deferred: VitalKey[];
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

/**
 * 睡着的时候，五条按另一套速率走（2026-11-15 Mr.Q 定）。
 *
 * **只有饱腹照常掉** —— 饿着睡醒了更饿，这是真的，也是「睡前该吃点东西」
 * 这个判断唯一的落点。其余四条：
 *
 * - 娱乐 `0` / 社交 `0`：睡着不消耗。躺八小时既不闷也不少人说话。
 * - 清爽 `1.0`：**掉，但慢**。一夜下来身上会有点黏 —— 这个 1.0 不是拍的：
 *   8 小时正好 −8，和原来那条「睡醒有点乱 −8」是同一件事，只是现在**按睡过的
 *   钟点摊**，睡三小时就只掉三。顺带把一天的账对平了：醒着 16 小时 −41.6，
 *   睡着 8 小时 −8，合计 −49.6，洗一次 +55 刚好覆盖一天。
 * - 精力 `0`：不是锁死，是**另算回升**（见 `SLEEP_ENERGY_PER_HOUR`）。
 *   锁死的话她睡八小时醒来还是原值，那不叫睡了一觉，叫暂停。
 */
export const SLEEP_DECAY_PER_HOUR: Record<VitalKey, number> = {
  food: 3.6,
  energy: 0,
  clean: 1.0,
  fun: 0,
  social: 0,
};

/**
 * 睡着的时候每小时回多少精力。
 *
 * **10 不是拍的：8 小时正好 +80** —— 和原来「睡一觉 +80」那张表对得上，
 * 只是从「睡下瞬间一次打进去」改成「按睡过的钟点结算」。
 * 睡两小时就起，只拿 20；睡十秒起来，拿 0。
 */
export const SLEEP_ENERGY_PER_HOUR = 10;

/**
 * 睡够多久算睡饱了。用来决定醒来挂哪条情绪，**不参与数值**。
 *
 * 6 小时：低于这个数醒来会头沉。世界卫生组织那套「七到九小时」是一般人，
 * 这里取 6 是因为 8 小时已经是标称时长，用 8 当阈值等于「几乎永远睡不够」。
 */
export const SLEEP_ENOUGH_HOURS = 6;

/** 低于这个数就该被注意到了。**不自动扣血、不自动生病** —— 只是阈值事件。 */
export const LOW = 30;
/** 低于这个数就算「已经很缺了」。也是**饿醒**的阈值 —— 饿到这个份上，睡着也会醒。 */
export const CRITICAL = 15;
/** 单次推进最多按多少小时算。见文件头「离线的那段时间怎么办」。 */
export const MAX_CATCHUP_HOURS = 7 * 24;

/**
 * 读一次书涨多少见识（2026-11-17 Mr.Q；0.13.0 时是 4）。
 *
 * 4 是「只增不减」时的数。加了衰减之后必须往上抬 —— 否则「读一天 +4、放四天掉 4.8」
 * 等于白读，读书变成一件**连维持都做不到**的事，那就没人会去读。
 *
 * 6 的账：每小时掉 0.05（一天 1.2），读一次抵消五天。
 * 一天读一次净 +4.8，八天够一张 40 的证；放着不读，一个月退 36。
 */
export const KNOWLEDGE_PER_STUDY = 6;

/**
 * 见识每小时掉多少（2026-11-17 Mr.Q：「书你不看不学的话还是见识会降」）。
 *
 * **0.05 是有意压小的。** 见识不是饱腹 —— 一顿不吃就饿，一天不读书忘不掉多少。
 * 但也不能太小：太小等于「读过一次就永久有效」，那这条需求就没落地。
 *
 * 0.05 × 24 = 1.2/天：三天不读退 3.6（有感觉），一个月退 36（够让「考完证就荒废」有代价），
 * 而一天读一次净赚 4.8（读书仍然是划算的）。**三个数同时成立，这个值才站得住。**
 *
 * 不按住处减免（`HOME_TIER_RELIEF` 只管五条）：好房子挡得住潮气，挡不住脑子生锈。
 */
export const KNOWLEDGE_DECAY_PER_HOUR = 0.05;

/** 见识封顶。到顶之后再读只补娱乐，不再涨 —— 读成专家就没意思了。 */
export const KNOWLEDGE_MAX = 100;

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
  /*
   * 吃，分三档（2026-11-17 Mr.Q）。
   *
   * 原来只有「吃」（30 元档）和「将就吃一口」，中间少一档、上面也少一档，
   * 于是 2880 块和 200 块吃的是同一顿饭 —— 钱多钱少在吃上没差别，
   * 「挣得多一点就能吃好一点」这条最直接的因果就断了。
   *
   * 三档的分法照他的话：好的回 50、普通的回 30、随便的回 15。
   * 情绪也跟着分：好的是好事，普通的不往心里去（不挂情绪），随便的心里不痛快。
   */
  feast: {
    id: 'feast',
    label: '吃顿好的',
    minutes: 60,
    cost: 40,
    gain: { food: 50, fun: 6 },
    mood: { text: '吃得舒服，心里也顺', kind: 'good', hours: 3 },
  },
  eat: {
    id: 'eat',
    label: '吃一顿',
    minutes: 40,
    cost: 15,
    gain: { food: 30 },
    /*
     * **不挂情绪** —— 「心情一般」不是一条情绪，是没起波澜。
     * 原来这里是 good「吃得挺舒服」，那等于把普通一顿说得比实际好。
     */
  },
  sleep: {
    id: 'sleep',
    label: '睡觉',
    /* 8 小时，**真的会读**：睡下时设 asleepFrom / asleepUntil，这段时间她做不了别的。 */
    minutes: 8 * 60,
    cost: 0,
    /*
     * 一条都不跳（2026-11-15 改）。
     *
     * 原来这里是 `{energy: 80, clean: -8}` —— 睡下那一瞬间就打进去。
     * 两个毛病：① 睡十秒起来也拿满 80；② 之后那 8 小时 tick 照常扣，
     * 实际到手只有 43，而提醒里写着「回 80」，等于对她说了假话。
     *
     * 现在精力和清爽都交给 `advance()` 按时长结算：睡着每小时 +10 精力、
     * −1.0 清爽。见 `SLEEP_DECAY_PER_HOUR`。
     */
    gain: {},
    /* 情绪也不在这里挂 —— 挂上了要 8 小时才醒，4 小时的情绪早就过期了。见 advance。 */
  },
  /*
   * 「起来」。
   *
   * **它是「睡着时唯一能干的事」**，不是可有可无的补充：如果睡着期间所有动作
   * 都被禁，而「醒来」原本靠「做别的动作」触发，她就永远醒不过来 —— 死锁。
   * 这个动作什么都不改，只把 asleep 清掉、按睡过的钟点结算。
   */
  wake: {
    id: 'wake',
    label: '起来',
    minutes: 0,
    cost: 0,
    gain: {},
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
    label: '随便吃点',
    minutes: 15,
    cost: 0,
    /*
     * 12 → 15（2026-11-17）：三档拉开之后，12 和普通的 30 差得太远，
     * 变成「吃与不吃」而不是「吃得好不好」。15 刚好是「能活着，但心里不痛快」。
     */
    gain: { food: 15 },
    mood: { text: '凑合一口，心里有点不是滋味', kind: 'bad', hours: 2 },
  },
  /*
   * 读书（2026-11-17 Mr.Q）。
   *
   * 「加娱乐，娱乐的同时还能增长见识」。所以它是**两用**：补娱乐（比「找点乐子」少
   * 一半多：那是玩，这是啃），并涨见识。**免费** —— 一个要花钱才能长见识的世界，
   * 穷的时候就被锁死在这条路外面，那不是取舍，是门槛。
   *
   * 代价是时间和精力（一小时、−3 精力）。一小时换 4 点见识：
   * 一张要 40 的证，得读十天。
   */
  study: {
    id: 'study',
    label: '看会儿书',
    minutes: 60,
    cost: 0,
    gain: { fun: 20, energy: -3 },
    mood: { text: '看进去一段，脑子亮了一下', kind: 'good', hours: 3 },
  },
  meet: {
    id: 'meet',
    label: '跟人说说话',
    minutes: 90,
    cost: 30,
    gain: { social: 30, fun: 8, energy: -5 },
    mood: { text: '有人说话，心里踏实', kind: 'good', hours: 5 },
  },
  cook: {
    id: 'cook',
    label: '买菜自己做',
    minutes: 55,
    cost: 10,
    gain: { food: 36, fun: 8, energy: -4 },
    mood: { text: '自己开火煮了一顿热乎的', kind: 'good', hours: 3 },
  },
  drink: {
    id: 'drink',
    label: '喝两口小酒',
    minutes: 60,
    cost: 28,
    gain: { fun: 26, energy: -10 },
    mood: { text: '微醺，脑子轻了一点', kind: 'good', hours: 2 },
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
    gifts: [],
    streak: { act: '', count: 0 },
    echoedWants: [],
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
    deferred: [],
    knowledge: 0,
    certLast: {},
    asleepFrom: '',
    asleepUntil: '',
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
  const home = normHome(s.home, now);
  /*
   * 目标兜底（2026-11-17 修）。
   *
   * 实测：她的存档里 `goals` 是空数组，于是 `{{life.goal}}` 空着、
   * 提示词里「手上想攒到的」那一行什么都没有 —— **攒钱这件事在她的世界里不存在**，
   * 也就没有任何理由去出工（现存记录：出工 0 天、进项 0 元）。
   *
   * 空就按当前住处指向上一档重新立一条。已经有目标的不动；
   * 已经住到别墅区的也不再立（没得搬了，立了就是个永远做不完的条）。
   */
  const goals = arr<Goal>(s.goals).filter((g) => g && typeof g.id === 'string');
  const fallbackGoal = (): Goal[] => {
    const next = nextHomeTier(home.tier);
    if (!next) return [];
    const need = HOME_TIER_COST[next] * MOVING_DEPOSIT_MONTHS;
    return [{
      id: `g-home-${next}`,
      what: `攒够 ${need}，搬到${HOME_TIER_LABEL[next]}`,
      need,
      since: now.toISOString(),
    }];
  };
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
    gifts: arr(s.gifts).filter((g) => g && typeof g.id === 'string'),
    streak: (s.streak && typeof s.streak === 'object' && typeof s.streak.act === 'string')
      ? { act: s.streak.act, count: Math.max(0, Number(s.streak.count) || 0) }
      : { act: '', count: 0 },
    echoedWants: arr(s.echoedWants).filter((x) => typeof x === 'string').slice(-40),
    street: typeof s.street === 'string' ? s.street : '',
    home,
    job: normJob(s.job),
    money: normMoney(s.money, now),
    goals: goals.length ? goals : fallbackGoal(),
    nagged: (s.nagged && typeof s.nagged === 'object') ? s.nagged : {},
    spendApplied: arr(s.spendApplied).filter((x) => typeof x === 'string').slice(-120),
    deferred: arr<unknown>(s.deferred).filter((k): k is VitalKey => typeof k === 'string' && k in DECAY_PER_HOUR),
    knowledge: Number.isFinite(Number(s.knowledge)) ? clamp100(Number(s.knowledge)) : 0,
    certLast: (s.certLast && typeof s.certLast === 'object' && !Array.isArray(s.certLast))
      ? Object.fromEntries(
        Object.entries(s.certLast as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'string')
          .map(([k, v]) => [k, v as string]),
      )
      : {},
    asleepFrom: normAsleepFrom(s, now),
    asleepUntil: normAsleepUntil(s, now),
  };
}

/**
 * 老档没有 `asleepFrom`（0.10.2 以前只有 `asleepUntil`）。
 *
 * **不许猜一个起点。** 猜长了是白送精力，猜短了是白扣 —— 两种都比「她醒了」更糟。
 * 能用得上的只有 `updatedAt`：旧版 `applyAct('sleep')` 也会把 `updatedAt` 写成
 * 入睡那一刻，之后每一次 tick 又把它推到最近一次结算点。所以拿它当起点，
 * 只会把这一觉算得**偏短**，不会偏长 —— 宁少不多。
 */
function normAsleepFrom(s: Partial<LifeState>, now: Date): string {
  if (typeof s.asleepFrom === 'string' && s.asleepFrom) {
    const f = Date.parse(s.asleepFrom);
    const u = typeof s.asleepUntil === 'string' ? Date.parse(s.asleepUntil) : NaN;
    /* 起点必须在终点之前，且不能晚于现在 —— 否则这次睡眠不成立。 */
    if (Number.isFinite(f) && Number.isFinite(u) && u > f && f <= now.getTime()) return s.asleepFrom;
    return '';
  }
  const u = typeof s.asleepUntil === 'string' ? Date.parse(s.asleepUntil) : NaN;
  const up = Date.parse(s.updatedAt);
  if (Number.isFinite(u) && u > now.getTime() && Number.isFinite(up) && up < u) {
    return new Date(up).toISOString();
  }
  return '';
}

function normAsleepUntil(s: Partial<LifeState>, now: Date): string {
  if (typeof s.asleepUntil !== 'string' || !s.asleepUntil) return '';
  const u = Date.parse(s.asleepUntil);
  /* 已经过点的，就是醒了 —— 留着会让「她在睡」永远为真。 */
  if (!Number.isFinite(u) || u <= now.getTime()) return '';
  /* 起点不成立（见上），那就别承认这次睡眠。 */
  return normAsleepFrom(s, now) ? s.asleepUntil : '';
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
  /** 这一次推进里，哪几条从「大于 0」掉到了「见底（0）」。单独算一次紧急提醒额度。 */
  bottomed: VitalKey[];
  /** 这次推进里自己好起来的病。 */
  recovered: Condition[];
  /** 这次新得的病。 */
  caught: Condition[];
  /** 这一段时间里她醒了（自然醒、饿醒、或者被叫起来）。没醒就是 null。 */
  woke: WakeResult | null;
  /** 这一段时间里她**真的睡着**了几个小时。醒着推进时是 0。 */
  sleptHours: number;
}

/** 她刚醒。`hours` 是这一觉**真的睡了**几个钟点。 */
export interface WakeResult {
  hours: number;
  /**
   * 为什么醒的。
   * - `enough` 睡满八小时，睡够了
   * - `short` 没到点就起了（她自己起来的，或者被叫起来的）
   * - `hungry` 饿醒的 —— 饱腹掉到 `CRITICAL`
   */
  reason: 'enough' | 'short' | 'hungry';
}

/**
 * 推进到 `now`。
 *
 * **幂等**：`now` 比 `updatedAt` 早（时钟被拨回去、或者两次调用同一个时刻）时
 * 一动不动 —— 否则会把时间倒着扣，她越活越精神。
 *
 * ## 睡着的那一段要单独算（2026-11-15）
 *
 * 原来是整段套一套衰减率，于是「睡八小时」在她身上是：精力先跳到 100，
 * 然后八小时里又被扣掉 36.8，实际到手 43；清爽、娱乐、社交照掉不误。
 * 那不是睡觉，是「躺着受罪」。
 *
 * 现在把 `[updatedAt, now]` 切成**睡着**和**醒着**两段，各用各的速率
 * （见 `SLEEP_DECAY_PER_HOUR`）：睡着时只有饱腹照常掉、清爽掉得很慢、
 * 娱乐和社交不动、精力按小时回升。
 *
 * **跨时段必须分段** —— 一次推进跨了八小时睡眠加三天醒着，
 * 整段套一种规则会把后面那三天也算成在睡觉。
 */
export function advance(state: LifeState, now: Date): AdvanceResult {
  const from = Date.parse(state.updatedAt);
  const to = now.getTime();
  const rawHours = Number.isFinite(from) ? (to - from) / 3_600_000 : 0;
  if (!(rawHours > 0)) {
    return {
      hours: 0, crossed: [], bottomed: [], recovered: [], caught: [],
      rentMissed: false, rent: 0, woke: null, sleptHours: 0,
    };
  }

  const hours = Math.min(rawHours, MAX_CATCHUP_HOURS);
  /** 真正的结算起点。超长离线被 7 天封顶时，它晚于 `updatedAt`。 */
  const fromMs = to - hours * 3_600_000;

  const before: Vitals = { ...state.vitals };

  /* ---------------- 睡着的那一段 ---------------- */

  const sFrom = Date.parse(state.asleepFrom);
  const sUntil = Date.parse(state.asleepUntil);
  const hadSleep = Number.isFinite(sFrom) && Number.isFinite(sUntil) && sUntil > sFrom;

  let sleepHours = 0;
  let woke: WakeResult | null = null;

  if (hadSleep) {
    /*
     * 饿醒：饱腹掉到 `CRITICAL` 的那一刻她睡不下去了。
     *
     * 这一条是「睡前该吃点东西」唯一的落点。不做的话，睡前饱腹 20 睡八小时，
     * 醒来 −28.8，中间没有任何后果 —— 那睡觉就成了一个免费的时间加速器。
     */
    const perHour = SLEEP_DECAY_PER_HOUR.food;
    const hungryAt = before.food > CRITICAL
      ? from + ((before.food - CRITICAL) / perHour) * 3_600_000
      : from;

    const planEnd = Math.min(to, sUntil);
    const sleepEnd = Math.min(planEnd, hungryAt);

    const lo = Math.max(fromMs, sFrom);
    sleepHours = Math.max(0, (sleepEnd - lo) / 3_600_000);
    /* 7 天封顶之外的那部分睡眠不结算，按醒着算。 */
    sleepHours = Math.min(sleepHours, hours);

    /*
     * 醒来发生在 7 天封顶窗口之内（`sleepEnd > fromMs`）才结算 `woke` ——
     * 十天前睡醒或饿醒的事，十天后上线不该挂一条「刚醒」心情或推饿醒提醒。
     * `enough` / `short` 按整觉实际时长（`sleepEnd - sFrom`）判，不被 7 天截断冤枉成没睡够。
     */
    if (sleepEnd > fromMs) {
      const actualHours = Math.max(0, (sleepEnd - sFrom) / 3_600_000);
      if (sleepEnd < planEnd) {
        woke = { hours: actualHours, reason: 'hungry' };
      } else if (to >= sUntil) {
        woke = {
          hours: actualHours,
          reason: actualHours >= SLEEP_ENOUGH_HOURS ? 'enough' : 'short',
        };
      }
    }
  }

  const awakeHours = hours - sleepHours;

  /* ---------------- 结算 ---------------- */

  /*
   * 住处的减免（2026-11-17）：越好的房子，四条掉得越慢；**精力不减**。
   * 见 `HOME_TIER_RELIEF`。睡着那段的清爽也一起受它影响 ——
   * 潮气和通风不因为她躺着就绕道。
   */
  const reliefOf = (key: VitalKey): number =>
    key === 'energy' ? 1 : (HOME_TIER_RELIEF[state.home.tier] ?? 1);

  for (const key of Object.keys(DECAY_PER_HOUR) as VitalKey[]) {
    /* 精力不衰减，是**另算回升** —— 锁死的话她睡八小时醒来还是原值。 */
    const sleepDelta = key === 'energy' ? SLEEP_ENERGY_PER_HOUR : -SLEEP_DECAY_PER_HOUR[key];
    const relief = reliefOf(key);
    const v = state.vitals[key]
      - DECAY_PER_HOUR[key] * relief * awakeHours
      + sleepDelta * relief * sleepHours;
    state.vitals[key] = clamp100(v);
  }

  /*
   * 见识也掉（2026-11-17 Mr.Q）。
   *
   * **按总时长算，不按醒着的小时** —— 睡着的时候同样在忘。这一点和「娱乐/社交
   * 睡着不消耗」不同：那两条是活动，见识是痕迹。
   *
   * 也不乘住处减免：好房子挡得住潮气，挡不住脑子生锈。
   */
  if (state.knowledge > 0) {
    state.knowledge = Math.max(0, state.knowledge - KNOWLEDGE_DECAY_PER_HOUR * hours);
  }

  /*
   * 离线补睡。
   *
   * 每满 24 小时她至少睡下过一次，精力回到 85。这样关机三天回来，
   * 她是「有点饿、有点闷」，不是「快不行了」。
   * 只补精力 —— 吃饭、洗澡、找乐子、见人这些**不能凭空补**，
   * 补了就等于「她不在的时候你替她过了日子」，那她的日子就不算她的。
   *
   * **按醒着的小时数算天**（2026-11-15 改）：她真的睡过的那一段已经结算过了，
   * 再按整段时间补一次，等于同一觉领两份。用 `awakeHours`，两边不会重叠。
   */
  const wholeDays = Math.floor(awakeHours / 24);
  if (wholeDays > 0) {
    state.vitals.energy = clamp100(Math.max(state.vitals.energy, 85));
  }

  /* ---------------- 住的开销 ---------------- */

  /*
   * 按天折算着扣。
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

  /*
   * 醒了。
   *
   * **情绪要挂在这一刻**，不是睡下那一刻 —— 原来那条「睡够了，脑子是清的」
   * 只活 4 小时，睡下时挂上，第 4 小时就过期了，而那时她还在睡。
   * 「睡醒心情好」这件事在老版本里**永远不会发生**。
   */
  const iso = now.toISOString();
  if (woke) {
    state.asleepFrom = '';
    state.asleepUntil = '';
    const w = woke;
    const mood = w.reason === 'enough'
      ? { text: '睡够了，脑子是清的', kind: 'good' as const }
      : w.reason === 'hungry'
        ? { text: '饿醒了，胃里空得慌', kind: 'bad' as const }
        : { text: '醒了，还没睡透', kind: 'bad' as const };
    state.moodlets = state.moodlets.filter((m) => m.source !== 'sleep');
    state.moodlets.push({
      id: `m-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      source: 'sleep',
      text: mood.text,
      kind: mood.kind,
      expiresAt: new Date(now.getTime() + (mood.kind === 'good' ? 4 : 2) * 3_600_000).toISOString(),
    });
    remember(
      state,
      w.reason === 'hungry'
        ? '饿醒了，没睡到点。'
        : `睡了一觉，${Math.round(w.hours)} 小时。`,
      now,
    );
  }

  /* 过期的情绪清掉。按真实时刻判 —— 见文件头。 */
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
   *
   * ⚠ 睡着时掉过线也照记，但 `world.ts` 不推 —— 半夜被自己的饥饿叫醒很怪，
   * 醒来仍低再说。**记录和推送是两件事**，别在记录这一层替她决定要不要说。
   */
  const crossed: VitalKey[] = [];
  const bottomed: VitalKey[] = [];
  for (const key of Object.keys(DECAY_PER_HOUR) as VitalKey[]) {
    if (before[key] >= LOW && state.vitals[key] < LOW) crossed.push(key);
    if (before[key] > 0 && state.vitals[key] <= 0) bottomed.push(key);
  }

  state.updatedAt = iso;
  return {
    hours, crossed, bottomed, recovered, caught, rentMissed, rent,
    woke, sleptHours: sleepHours,
  };
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
 * 她现在是不是在睡。
 *
 * **判据是时刻，不是「上一次动作是不是 sleep」** —— 动作是瞬时的，睡是一段时间。
 * 三个条件缺一不可：起点有、终点有、终点还没到。
 */
export function isAsleep(state: LifeState, now: Date): boolean {
  const f = Date.parse(state.asleepFrom);
  const u = Date.parse(state.asleepUntil);
  return Number.isFinite(f) && Number.isFinite(u) && u > f && u > now.getTime();
}

/**
 * 睡着时拦下一件事该说的话。
 *
 * **所有动作工具都走这一个函数。** 两处各写一句，迟早有一处变成
 * 「你在睡」而另一处放行 —— 那就等于没有锁。
 *
 * 话里必须带路（和卷二那条「钱不够要说替代方案」同一个道理）：
 * 只说「不行」她会愣着，下次再试一次还是不行。
 */
export function asleepRefusal(state: LifeState, now: Date, what: string): string {
  const u = Date.parse(state.asleepUntil);
  const mins = Math.max(0, Math.round((u - now.getTime()) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const left = h > 0 ? `${h} 小时${m ? ` ${m} 分钟` : ''}` : `${m} 分钟`;
  return `你在睡，还有 ${left}。${what}这件事得起来才能做 —— 起得来就用 \`life_act\` 的「起来」（wake）；`
    + '不过提前起，精力只按睡过的钟点算，没睡够的那部分不补。'
    + '他随口一句不算叫你起来，起不起你自己定。';
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
   * 睡着了，只有「起来」这一件事能做（2026-11-15 Mr.Q）。
   *
   * 为什么要拦在 state 这一层，而不是只在工具层拦：`life_act` / `life_work` /
   * `life_cert` / `life_move` / `life_out` 是五个不同的入口，工具层要各写一次；
   * 写漏一个，她就多一条在梦里洗澡的路。
   */
  const sleeping = isAsleep(state, now);
  if (sleeping && act.id !== 'wake') {
    return {
      ok: false,
      reason: act.id === 'sleep'
        ? `你已经在睡了，还有 ${Math.max(0, Math.round((Date.parse(state.asleepUntil) - now.getTime()) / 3_600_000))} 小时到点。`
        : asleepRefusal(state, now, act.label),
      vitals: state.vitals,
      mood: null,
      cost: 0,
      cash: state.money.cash,
    };
  }

  /* 醒着的时候调「起来」—— 没有这回事，但也别当成错，说清就行。 */
  if (act.id === 'wake' && !sleeping) {
    return {
      ok: false,
      reason: '你醒着呢，不用起来。',
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

  /*
   * 睡下去（2026-11-15 改）。
   *
   * **这里一条都不加** —— 精力和清爽全部交给 `advance()` 按睡过的钟点结算。
   * 原来的写法是睡下瞬间 energy +80，睡十秒起来也拿满 —— 那不是睡觉，
   * 是一个免费回血按钮。
   */
  if (act.id === 'sleep') {
    state.asleepFrom = now.toISOString();
    state.asleepUntil = new Date(now.getTime() + act.minutes * 60_000).toISOString();
    remember(state, '睡下了。', now);
    state.updatedAt = now.toISOString();
    return {
      ok: true, vitals: state.vitals, mood: null, cost: act.cost, cash: state.money.cash,
    };
  }

  /*
   * 起来（2026-11-15）。
   *
   * 先把 `[updatedAt, now]` 这一段结算掉 —— **不结算就清字段，等于这一觉白睡**。
   * `advance()` 自己是幂等的，重复调用不会多补。
   *
   * 如果这段里她已经饿醒了，`advance` 会醒并把情绪挂好（`woke !== null`），
   * 这里就不再挂第二条 —— 同一件事两条情绪，她说话会前后矛盾。
   */
  if (act.id === 'wake') {
    const f = Date.parse(state.asleepFrom);
    const slept = Number.isFinite(f) ? Math.max(0, (now.getTime() - f) / 3_600_000) : 0;
    const r = advance(state, now);
    state.asleepFrom = '';
    state.asleepUntil = '';
    let mood: Moodlet | null = null;
    if (!r.woke) {
      const good = slept >= SLEEP_ENOUGH_HOURS;
      mood = {
        id: `m-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        source: 'sleep',
        text: good ? '睡够了，脑子是清的' : '没睡够就起来了，头有点沉',
        kind: good ? 'good' : 'bad',
        expiresAt: new Date(now.getTime() + (good ? 4 : 2) * 3_600_000).toISOString(),
      };
      state.moodlets = state.moodlets.filter((m) => m.source !== 'sleep');
      state.moodlets.push(mood);
    }
    /* 已经被饿醒的，`advance` 已经记过一条了，这里不再补一句「起来了」。 */
    if (!r.woke) {
      remember(
        state,
        slept >= 1 ? `起来了，这一觉睡了 ${Math.round(slept)} 小时。` : '起来了。',
        now,
      );
    }
    state.updatedAt = now.toISOString();
    return { ok: true, vitals: state.vitals, mood, cost: 0, cash: state.money.cash };
  }

  /* 醒着做了别的事 —— 兜底清掉残留的 asleep（正常情况本来就该是空的）。 */
  state.asleepFrom = '';
  state.asleepUntil = '';

  const hasStomach = state.conditions.some((c) => c.id === 'stomach');
  const hasHangover = state.conditions.some((c) => c.id === 'hangover');
  for (const [k, delta] of Object.entries(act.gain)) {
    const key = k as VitalKey;
    let d = Number(delta);
    if (key === 'food' && d > 0 && hasStomach) d = Math.round(d * .5);
    if (d > 0 && hasHangover) d = Math.round(d * .75);
    state.vitals[key] = clamp100(state.vitals[key] + d);
  }

  /*
   * 读书涨见识（2026-11-17）。
   *
   * 放在 `gain` 之外，因为**见识不是五条之一**：它不衰减、不触阈值、
   * 不进 `vitalsLine`。混进去会让「五条」变成六条，而那一整套阈值提醒、
   * 存档、面板都是按五条写的。
   */
  if (act.id === 'study' && state.knowledge < KNOWLEDGE_MAX) {
    state.knowledge = Math.min(KNOWLEDGE_MAX, state.knowledge + KNOWLEDGE_PER_STUDY);
  }

  /* 连续行为追踪：同一件事连做 3 次出小脾气，连吃 3 次将就饭出肠胃不适，连喝 2 次小酒出宿醉。 */
  const prevStreak = state.streak ?? { act: '', count: 0 };
  const nextCount = prevStreak.act === act.id ? prevStreak.count + 1 : 1;
  state.streak = { act: act.id, count: nextCount };

  const hasCond = (id: Condition['id']) => state.conditions.some((c) => c.id === id);
  if (act.id === 'instant' && nextCount >= 3 && !hasCond('stomach')) {
    state.conditions.push({
      id: 'stomach',
      since: now.toISOString(),
      until: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
      text: '肠胃不太舒服，吃正餐只能慢慢吸收。',
    });
    remember(state, '连吃了几顿将就饭，胃有点闹脾气。', now);
  }
  if (act.id === 'drink' && nextCount >= 2 && !hasCond('hangover')) {
    state.conditions.push({
      id: 'hangover',
      since: now.toISOString(),
      until: new Date(now.getTime() + 12 * 3_600_000).toISOString(),
      text: '有点宿醉，脑袋沉，干什么都慢半拍。',
    });
    remember(state, '多喝了两杯，今天有点宿醉。', now);
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

  /* 小脾气与偏执（§6.6 ①）：连续 4 次同件事生出一条念叨。 */
  if (nextCount === 4 && act.id !== 'sleep' && act.id !== 'wake') {
    const quirk = `连着三次「${act.label}」了，有点腻，想换点别的。`;
    state.moodlets = state.moodlets.filter((m) => m.source !== 'quirk');
    state.moodlets.push({
      id: `m-q-${now.getTime().toString(36)}`,
      source: 'quirk',
      text: quirk,
      kind: 'bad',
      expiresAt: new Date(now.getTime() + 6 * 3_600_000).toISOString(),
    });
    remember(state, quirk, now);
  }

  /* 雨天开火煮面 extra 小确幸（§6.6 ③）。 */
  if (act.id === 'cook' && weatherOf(state.street || '芦花塘', now).sky === '小雨') {
    state.moodlets = state.moodlets.filter((m) => m.source !== 'weather-cook');
    state.moodlets.push({
      id: `m-wc-${now.getTime().toString(36)}`,
      source: 'weather-cook',
      text: '外面下着小雨，屋里热汤面特别香',
      kind: 'good',
      expiresAt: new Date(now.getTime() + 4 * 3_600_000).toISOString(),
    });
  }

  /* 生活里的回声（§6.6 ④）：如果之前在 wants 里记过相关想头，触发一次专属回声。 */
  const echoed = new Set(state.echoedWants ?? []);
  const actKeywords: Record<string, string[]> = {
    cook: ['做饭', '煮面', '下厨', '炒菜', '做菜'],
    play: ['玩', '乐子', '拍照', '听歌', '散心'],
    eat: ['吃', '馆子', '美食'],
    study: ['书', '读书', '看书', '学', '课', '考试'],
    wash: ['洗', '澡'],
    meet: ['见', '朋友', '聊天', '说话'],
    drink: ['酒', '喝'],
  };
  const kws = actKeywords[act.id] ?? [];
  if (kws.length) {
    const hitWant = state.wants.find((w) => !echoed.has(w.id) && kws.some((k) => w.what.includes(k)));
    if (hitWant) {
      echoed.add(hitWant.id);
      state.echoedWants = [...echoed].slice(-40);
      remember(state, `还记得之前惦记过「${hitWant.what}」，今天真去做了。`, now);
    }
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
export function applyWork(
  state: LifeState,
  what: string,
  now: Date,
  phase: 'home' | 'staying' | 'traveling' = 'home',
): WorkResult {
  /* 睡着去不了 —— 出工是一整天的事，得先起来。 */
  if (isAsleep(state, now)) {
    return {
      ok: false,
      reason: asleepRefusal(state, now, '出工'),
      earned: 0,
      cash: state.money.cash,
      vitals: state.vitals,
    };
  }
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
    const gate = jobGate(state, def, phase);
    if (gate) {
      return { ok: false, reason: gate, earned: 0, cash: state.money.cash, vitals: state.vitals };
    }
    const mat = def.materialCost ?? 0;
    if (mat > 0 && state.money.cash < mat) {
      return {
        ok: false,
        reason: `「${def.name}」需要先垫付 ${mat} 元成本（材料/油电），你手上只有 ${state.money.cash} 元。`,
        earned: 0,
        cash: state.money.cash,
        vitals: state.vitals,
      };
    }
    pay = def.pay - mat;
    label = def.name;
    load = def.load;
    state.job.id = def.id;
    if (mat > 0) {
      state.money.cash -= mat;
      state.money.spent += mat;
    }
  } else {
    /*
     * 表里没有 —— 她自己说的活，按零工算，**价格沿用 `daily`**。
     *
     * 不改成 90：老存档里她一天挣 120，突然掉到 90 会像是「你干活不值钱了」，
     * 而用户什么都没改过。要降，是下一次调表的事。
     */
    label = told || state.job.what || '打零工';
    pay = state.job.daily;
    load = { energy: 34, clean: 16, fun: 10, social: 0, food: 12, know: 0 };
    state.job.id = '';
  }

  const grossPay = def ? def.pay : pay;
  state.job.what = label;
  state.job.daily = grossPay;

  state.money.cash += grossPay;
  state.money.earned += grossPay;

  /* 扭伤/割伤触发：低精力（< 28）仍接体力活（零工/熟练工）时触发 36h 扭伤。 */
  const tier = def?.tier ?? 'odd';
  if ((tier === 'odd' || tier === 'skilled') && state.vitals.energy < 28 && !state.conditions.some((c) => c.id === 'injury')) {
    state.conditions.push({
      id: 'injury',
      since: now.toISOString(),
      until: new Date(now.getTime() + 36 * 3_600_000).toISOString(),
      text: '干活闪了腰（轻度扭伤），重体力活接不了。',
    });
    remember(state, '没歇够就硬出工，干活时把腰闪了一下。', now);
  }

  /*
   * 一天的代价。比一件「事」重得多 —— 这是整天。
   *
   * 档位越高扣得越多（见 `jobs.ts` 的 `LOAD`）：钱多出来的那部分，
   * 是从她这一天里挤出来的。专业岗还扣社交 —— 一整天不在家，谁也没见着。
   */
  state.vitals.energy = clamp100(state.vitals.energy - load.energy);
  state.vitals.clean = clamp100(state.vitals.clean - load.clean);
  state.vitals.fun = clamp100(state.vitals.fun - load.fun);
  state.vitals.food = clamp100(state.vitals.food - load.food);
  if (load.social) state.vitals.social = clamp100(state.vitals.social - load.social);
  /*
   * 干一天也长见识（2026-11-17 Mr.Q 第二条）。**这一格是加的，不是扣的** ——
   * 所以它不写在 `load` 的扣减那一列里，得单独说一句，否则下一个人读代码会以为符号反了。
   * 越高级的活长得越多（见 `LOAD`），但都比读一次书少。
   */
  if (load.know > 0) {
    state.knowledge = Math.min(KNOWLEDGE_MAX, state.knowledge + load.know);
  }

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
export function jobGate(
  state: LifeState,
  def: JobDef,
  phase: 'home' | 'staying' | 'traveling' = 'home',
): string | null {
  if (!jobAllowedAt(def, phase)) {
    return phase === 'traveling'
      ? `还在路上呢，「${def.name}」没法在车上干。只有随身能接的活才行。`
      : `你现在不在芦花塘家里，「${def.name}」只能在家那头接。`;
  }
  if (state.conditions.some((c) => c.id === 'injury') && (def.tier === 'odd' || def.tier === 'skilled')) {
    return `身上还挂着扭伤，像「${def.name}」这种体力活暂时接不了，先歇一两天或干点轻省的。`;
  }
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
  /** 花掉多少。**考砸了也照花** —— 报名费不退。 */
  paid: number;
  cash: number;
  /** 考过了没有。`ok` 是「去考了」，这个是「过了」。两件事分开。 */
  passed?: boolean;
  /** 这一次的通过概率（0–1），给回执用。 */
  chance?: number;
}

/**
 * 这张证她现在考得过的概率（2026-11-17）。
 *
 * `0.15` 起步：见识为零也不是零 —— 有人就是蒙得过去，而 0 概率会让她
 * 「明知道考不过还非要去」变成一个纯亏的按钮。
 * `need` 那一档到 `0.9`，**封顶不封 1** —— 考试永远有一成失手，
 * 这样「读过书」是提高胜算，不是买通。
 */
export function certChance(knowledge: number, need: number): number {
  if (!(need > 0)) return 0.9;
  const p = 0.15 + 0.75 * (knowledge / need);
  return Math.max(0.15, Math.min(0.9, p));
}

/**
 * 去考一张证。
 *
 * ## 为什么考证要花钱
 *
 * 不然「我有护工证」只是一句话。花了钱，它就是一个真的取舍：
 * 手上有 3000，是去考一张 600 的驾照（之后日薪从 90 变 230），还是先搬去老小区？
 *
 * ## 为什么现在还要考得过（2026-11-17）
 *
 * 加了「见识」之后，`life_cert` 从「交钱就发证」变成**真的考试**：
 * 通过率由见识和这张证的难度决定（`certChance`）。考砸了报名费照扣 ——
 * 这是这条路上唯一的风险，也是「先读书还是先攒钱」这个取舍成立的原因。
 *
 * ## 为什么只花一天、不占出工日
 *
 * 占的话，`job.lastAt` 一写，「今天已经出过工」就提前判死了 —— 一个字段两种含义，
 * 迟早出错。所以考证只扣精力（−20），不碰 `lastAt`。
 *
 * `roll` 是给测试用的：不传就真掷骰子。**别在业务代码里传它。**
 */
export function applyCert(state: LifeState, name: string, now: Date, roll?: number): CertResult {
  /* 考证要出门、要上课，睡着办不了。 */
  if (isAsleep(state, now)) {
    return {
      ok: false,
      reason: asleepRefusal(state, now, '考证'),
      paid: 0,
      cash: state.money.cash,
    };
  }
  const c = certOf(name);
  if (!c) {
    const list = CERTS.map((x) => `${x.name}（${x.price} 元，要见识 ${x.need}）`).join('、');
    return { ok: false, reason: `没有这张证可考。能考的：${list}。`, paid: 0, cash: state.money.cash };
  }
  if (state.job.certs.includes(c.name)) {
    return { ok: false, reason: `你已经考过${c.name}了。`, paid: 0, cash: state.money.cash };
  }
  /*
   * 一天一张只考一次。
   *
   * 不加这道闸，考砸之后会连着再考 —— 钱照扣，几次就烧光 3000，
   * 而用户看到的是「她在考证中心反复刷卡」。一天，是给她一个「明天再说」的间隔。
   */
  const day = localDateKey(now);
  if (state.certLast?.[c.name] === day) {
    return {
      ok: false,
      reason: `今天已经考过一次${c.name}了，没过的话明天再来。`,
      paid: 0,
      cash: state.money.cash,
    };
  }
  if (state.money.cash < c.price) {
    return {
      ok: false,
      reason: `${c.name}要 ${c.price} 元，你手上只有 ${Math.round(state.money.cash)} 元。`,
      paid: 0,
      cash: state.money.cash,
    };
  }

  const chance = certChance(state.knowledge, c.need);
  /* 先扣钱再掷骰子 —— 报名费是去考之前就交的，不是考过才交。 */
  state.money.cash -= c.price;
  state.money.spent += c.price;
  state.vitals.energy = clamp100(state.vitals.energy - 20);
  state.certLast = { ...(state.certLast ?? {}), [c.name]: day };

  const dice = typeof roll === 'number' && Number.isFinite(roll) ? roll : Math.random();
  const passed = dice < chance;

  if (passed) {
    state.job.certs.push(c.name);
    remember(state, `考下了${c.name}，花了 ${c.price} 元。`, now);
    state.updatedAt = now.toISOString();
    return { ok: true, passed: true, chance, cert: c.name, paid: c.price, cash: state.money.cash };
  }

  /*
   * 考砸了。**钱和精力不退，情绪要挂** ——
   * 不挂情绪的话，这件事在她心里等于没发生，第二天会原样再来一次。
   */
  state.moodlets = state.moodlets.filter((m) => m.source !== 'cert-fail');
  state.moodlets.push({
    id: `m-cert-${now.getTime().toString(36)}`,
    source: 'cert-fail',
    text: `${c.name}没考过，白花了 ${c.price} 块`,
    kind: 'bad',
    expiresAt: new Date(now.getTime() + 6 * 3_600_000).toISOString(),
  });
  remember(state, `${c.name}没考过，${c.price} 元的报名费也没了。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true, passed: false, chance, cert: c.name, paid: c.price, cash: state.money.cash };
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
  /* 搬家是体力活，睡着的办不了。 */
  if (isAsleep(state, now)) {
    return {
      ok: false,
      reason: asleepRefusal(state, now, '搬家'),
      from: state.home.tier, to: tier, deposit: 0, cash: state.money.cash,
    };
  }
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
  gifts: Gift[];
  weather: WeatherInfo;
  /** 她在睡的话，这里给出「还有多久」和「醒来精力大约多少」。
   * 醒着是 null —— **不写 `{ asleep: false }`**：面板里一个恒为真的字段容易被当成开关。
   */
  asleep: { hoursLeft: number; energyAtWake: number } | null;
  /** 见识（0–100）。考证的通过率由它决定。**不是第六条需求** —— 它只增不减。 */
  knowledge: number;
}

export interface WeatherInfo {
  sky: '晴' | '多云' | '小雨' | '起风';
  seasonNote: string;
}

/**
 * 确定性本地天气与芦花塘物候（§6.6 ③）：不靠随机数，同一天同一个时段大家看到一样。
 */
export function weatherOf(city: string, now: Date): WeatherInfo {
  const key = `${city || '芦花塘'}-${localDateKey(now)}-${Math.floor(now.getHours() / 8)}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const skies: WeatherInfo['sky'][] = ['晴', '多云', '晴', '小雨', '起风', '多云'];
  const sky = skies[h % skies.length];
  const m = now.getMonth() + 1;
  const seasonNote = (m >= 9 && m <= 11)
    ? (sky === '起风' ? '秋天起风了，芦花塘边的芦花白了一片' : '秋凉，早晚风里带着水汽')
    : (m >= 6 && m <= 8)
      ? '夏水涨得高，傍晚塘边风凉'
      : (m >= 3 && m <= 5)
        ? '春水微暖，巷口早市摊子摆得早'
        : '冬塘水静，屋里热汤最顶用';
  return { sky, seasonNote };
}

/** 他伸手给她留一样东西（一天最多一件，不进金额、不刷好感数值）。 */
export interface GiftResult {
  ok: boolean;
  reason?: string;
  gift?: Gift;
}

export function applyGift(state: LifeState, what: string, from: string, now: Date): GiftResult {
  const text = String(what || '').trim().slice(0, 60);
  if (!text) return { ok: false, reason: '没写是什么东西。' };
  const today = localDateKey(now);
  const already = state.gifts.some((g) => localDateKey(new Date(g.at)) === today);
  if (already) {
    return { ok: false, reason: '今天已经留过一样东西了，一天最多一件。' };
  }
  const gift: Gift = {
    id: `gift-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    what: text,
    from: String(from || '他').trim() || '他',
    at: now.toISOString(),
  };
  state.gifts.push(gift);
  if (state.gifts.length > 30) state.gifts = state.gifts.slice(-30);
  state.moodlets = state.moodlets.filter((m) => m.source !== 'gift');
  state.moodlets.push({
    id: `m-g-${now.getTime().toString(36)}`,
    source: 'gift',
    text: `收到他留下的「${text}」`,
    kind: 'good',
    expiresAt: new Date(now.getTime() + 6 * 3_600_000).toISOString(),
  });
  remember(state, `他留下了一样东西：${text}。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true, gift };
}

/** 原子追加一笔账本流水到 life-ledger.jsonl（按 id 去重）。 */
export function appendLedger(dataDir: string, entry: LedgerEntry): boolean {
  if (!dataDir || !entry.id || !(entry.amount > 0)) return false;
  const file = join(dataDir, 'life-ledger.jsonl');
  try {
    mkdirSync(dirname(file), { recursive: true });
    if (existsSync(file)) {
      const existing = readFileSync(file, 'utf8');
      if (existing.includes(`"id":"${entry.id}"`)) return false;
    }
    appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 读取最近 N 笔流水（倒序，最新的在前）。 */
export function readLedger(dataDir: string, limit = 30): LedgerEntry[] {
  const file = join(dataDir, 'life-ledger.jsonl');
  try {
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    const out: LedgerEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj && typeof obj.id === 'string') out.push(obj as LedgerEntry);
      } catch { /* 跳过坏行 */ }
    }
    return out;
  } catch {
    return [];
  }
}

/** 本地早市当日确定性物价表（三期买菜用，服务端市集不可达时的兜底）。 */
export function marketPrices(now: Date): { item: string; price: number; unit: string }[] {
  const d = localDateKey(now);
  let h = 0;
  for (let i = 0; i < d.length; i++) h = (h * 33 + d.charCodeAt(i)) >>> 0;
  const delta = (offset: number) => ((h + offset) % 5) - 2; // -2 ~ +2
  return [
    { item: '青菜豆腐', price: Math.max(4, 7 + delta(1)), unit: '一份' },
    { item: '番茄鸡蛋面料', price: Math.max(6, 10 + delta(2)), unit: '一份' },
    { item: '小鱼干配菜', price: Math.max(8, 12 + delta(3)), unit: '一份' },
  ];
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

  /*
   * 「她还在睡吗」得进快照。
   *
   * 不进的话，`life_status` 读出来跟醒着一模一样 —— 她明明躺着，却以为自己能出门。
   * 那是「空话问题」的另一个形态：世界里有这个状态，但她读不到。
   *
   * `energyAtWake` 是**算术**：现在的精力 + 剩下的钟点 × 每小时回升，封顶 100。
   * 不是承诺 —— 中途醒了就没这么多。
   */
  let asleep: Snapshot['asleep'] = null;
  if (isAsleep(state, now)) {
    const until = Date.parse(state.asleepUntil);
    const left = Math.max(0, (until - now.getTime()) / 3_600_000);
    asleep = {
      hoursLeft: Math.round(left * 10) / 10,
      energyAtWake: Math.round(clamp100(state.vitals.energy + SLEEP_ENERGY_PER_HOUR * left)),
    };
  }

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
    gifts: state.gifts,
    weather: weatherOf(state.street || '芦花塘', now),
    asleep,
    knowledge: Math.round(state.knowledge),
  };
}
