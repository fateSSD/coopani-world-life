/**
 * 职业表。
 *
 * ## 为什么要有这张表
 *
 * 2026-11-15 Mr.Q：「每个职业获得工资应该不同才对，包括职业的执业资格，
 * 经验要求越多的工资越高。」
 *
 * 在那之前只有一格 `job.daily = 120`，硬编码，干什么是她随口说的一句话 ——
 * 「搬货」和「会计」拿一样的钱，那「职业」这个词就不成立。
 *
 * ## 分档的判据是「攒钱的速度」，不是「体面」
 *
 * 城中村一天要 60 块（三顿 45 + 房租 15），老小区押金 2400。所以四档的差别
 * 不是「能不能活」——零工也活得下去，差别是**多久能搬到更好的地方**：
 *
 * | 档 | 日薪 | 城中村净剩 | 攒 2400 要 |
 * |---|---|---|---|
 * | 零工 | 80–95 | 20–35 | 70–120 天 |
 * | 熟练 | 130–150 | 70–90 | 27–34 天 |
 * | 有证 | 210–240 | 150–180 | 13–16 天 |
 * | 专业 | 300–340 | 240–280 | 9–10 天 |
 *
 * ## 高薪有代价（Mr.Q 选的第 2 条，2026-11-15）
 *
 * 光涨工资而物价不动，「攒钱搬家」这条线两周就走完了，之后钱对她没有意义。
 * 所以档位越高，这一天占得越满：精力掉得更多、没力气玩、**而且一整天不在家**
 * （社交按档扣）。钱多了别的会少，这才是一个要做的取舍。
 *
 * 数字都用整数：浮点数落盘会产生 43.00000000000001 这种垃圾，面板上也难看。
 */

/** 一档比一档贵，也一档比一档累。 */
export type JobTier = 'odd' | 'skilled' | 'certified' | 'professional';

export const TIER_LABEL: Record<JobTier, string> = {
  odd: '零工',
  skilled: '熟练工',
  certified: '有证',
  professional: '专业',
};

export type JobPlace = 'home' | 'anywhere' | 'destination';

export interface JobDef {
  id: string;
  /** 她在话里怎么说这件事。也是 `life_work` 认的第二个名字。 */
  name: string;
  tier: JobTier;
  /** 顶一天给多少。 */
  pay: number;
  /** 要哪张证。没有就是不要证。 */
  cert?: string;
  /** 要出过多少天工才有资格。0 = 不要求。 */
  days?: number;
  /** 在哪儿能干：只在芦花塘家这边、随身带着走、还是外地也能接的短活。 */
  place: JobPlace;
  /** 材料/出车前垫付成本（元）。干完再结，不够垫付接不了。 */
  materialCost?: number;
  /** 一天的代价。老版本是 −34 / −16 / −10 三样，这里按档加重，并加了社交。 */
  /**
   * 一天的代价。**五条都要动**（2026-11-17 Mr.Q：「不同的工作也得消耗五维」）。
   *
   * 原来只有精力、清爽、娱乐、社交四条 —— 少了饱腹。
   * 结果是「干了一整天活回来不饿」，那三顿饭跟出不出工没关系，
   * 一天的口粮就成了纯背景开销。加上之后：干重的就多饿，得吃得好一点才补得回来。
   *
   * `know` 是**反向的**：这一天涨多少见识（2026-11-17 Mr.Q 第二条
   * 「见识其实在工作的过程中也是能增长的，而且越高级的工作增长应该越多」）。
   * 所以它不写在 `gain` 里也不带负号 —— 见 `applyWork`。
   */
  /** 干完这一班需要多少分钟。 */
  minutes: number;
  /** 这一班干完的总代价（在工作期间按分钟分摊扣减；社交与娱乐暂停日常衰减）。 */
  load: { energy: number; clean: number; fun: number; social: number; food: number; know: number };
}

/*
 * 一天的代价，四档各一版。
 *
 * 零工沿用老数字（−34 / −16 / −10 / 0）—— 那是 2026-11-15 之前的表现，不改它，
 * 老存档里的体感就不会突然变。
 */
/**
 * 一天的代价，按档分。
 *
 * `know`（涨多少见识）**跟着档位走** —— 越高级的活，一天里接触到的判断越多：
 * 搬货搬一年还是搬货；带病人、算账、教课，干一天长一天的见识。
 * 数值压得比读书低（读书一次 6）：**专心学永远比边干边学快**，
 * 否则「读书」这条路就成了多余的。
 */
const DEFAULT_MINUTES: Record<JobTier, number> = {
  odd: 240,          // 4 小时
  skilled: 300,      // 5 小时
  certified: 360,    // 6 小时
  professional: 420, // 7 小时
};

const LOAD: Record<JobTier, JobDef['load']> = {
  odd: { energy: 34, clean: 17, fun: 5, social: 0, food: 19, know: 0 },
  skilled: { energy: 38, clean: 20, fun: 6, social: 0, food: 22, know: 0.5 },
  certified: { energy: 42, clean: 22, fun: 6, social: 0, food: 25, know: 1 },
  professional: { energy: 46, clean: 24, fun: 6, social: 0, food: 28, know: 1.5 },
};

const def = (
  id: string,
  name: string,
  tier: JobTier,
  pay: number,
  extra: Partial<Pick<JobDef, 'cert' | 'days' | 'place' | 'materialCost' | 'minutes'>> = {},
): JobDef => ({ id, name, tier, pay, place: 'home', minutes: DEFAULT_MINUTES[tier], load: LOAD[tier], ...extra });

/**
 * 十八种，四档 + 三档地点过滤（home / anywhere / destination）。
 *
 * 城规有一条是「鱼不吃鱼」：没有渔业、没有鱼市、没有屠宰。
 * 加任何职业之前先拿这一条判一次。
 */
export const JOBS: readonly JobDef[] = [
  // 零工：谁都能干，说走就走（3~4 小时）
  def('porter', '搬货', 'odd', 90, { place: 'anywhere', minutes: 240 }),
  def('shopkeeper', '看店', 'odd', 85, { place: 'home', minutes: 240 }),
  def('waiter', '端盘子', 'odd', 90, { place: 'destination', minutes: 240 }),
  def('delivery', '送外卖', 'odd', 95, { place: 'home', materialCost: 8, minutes: 210 }),
  def('flyer', '发传单', 'odd', 80, { place: 'destination', minutes: 180 }),

  // 熟练工：干满一个月，或者有人介绍（5 小时）
  def('kitchen', '后厨帮工', 'skilled', 140, { days: 30, place: 'destination', minutes: 300 }),
  def('renovation', '装修队小工', 'skilled', 150, { days: 30, place: 'home', minutes: 300 }),
  def('errand', '跑腿代办', 'skilled', 130, { days: 30, place: 'home', materialCost: 10, minutes: 270 }),
  def('stall', '早市摆摊', 'skilled', 145, { days: 30, place: 'home', materialCost: 25, minutes: 270 }),

  // 有证：一天的钱够她吃住两天，但那张证要一笔投入（6 小时）
  def('caregiver', '护工', 'certified', 210, { cert: '护工证', place: 'home', minutes: 360 }),
  def('driver', '网约车司机', 'certified', 230, { cert: '驾照', place: 'home', materialCost: 45, minutes: 360 }),
  def('cook', '厨师', 'certified', 240, { cert: '厨师证', place: 'destination', minutes: 360 }),
  def('electrician', '电工', 'certified', 220, { cert: '电工证', place: 'home', materialCost: 15, minutes: 360 }),

  // 专业：证 + 经验，两个都要（7~8 小时）
  def('nurse', '社区护士', 'professional', 330, { cert: '护士执业证', days: 30, place: 'home', minutes: 480 }),
  def('teacher', '小学代课老师', 'professional', 320, { cert: '教师资格证', days: 30, place: 'home', minutes: 420 }),
  def('accountant', '会计', 'professional', 340, { cert: '会计证', days: 30, place: 'anywhere', minutes: 420 }),
  def('socialworker', '社区社工', 'professional', 300, { cert: '社工证', days: 30, place: 'home', minutes: 420 }),
];

/** 判断某份活在当前位置阶段能否接：在路上只能接 anywhere；在外地可接 anywhere+destination；在家可接 home+anywhere。 */
export function jobAllowedAt(job: JobDef, phase: 'home' | 'staying' | 'traveling'): boolean {
  if (phase === 'traveling') return job.place === 'anywhere';
  if (phase === 'staying') return job.place === 'anywhere' || job.place === 'destination';
  return job.place === 'home' || job.place === 'anywhere';
}

/**
 * 考证：一张证要多少钱、要几天、**要多少见识**。
 *
 * ## 为什么证要花钱
 *
 * 不然「我有护工证」只是一句话 —— 她第一天就能说自己有，门槛形同虚设。
 * 花钱考证把门槛变成了一个**真的取舍**：手上有 3000，是去考一张 600 的驾照
 * （六天后日薪从 90 变 230），还是先搬去老小区？
 *
 * ## 为什么加 `need`（2026-11-17 Mr.Q）
 *
 * 「娱乐的同时还能增长见识（考证的前提，见识越高考过的概率就越大）」。
 *
 * 在那之前考证是**花钱必成**：钱够、证就到手，一天一张，谁都能当护士。
 * 现在多一道：见识不够就是考不过，报名费照扣。于是「先读书还是先攒钱」
 * 变成了一个真问题 —— 而这是她该自己算的账。
 *
 * `need` 按「这张证有多难」定，不是按价格：驾照 600 只要 30（技术活，练就会），
 * 社工证 550 要 45（要读的东西比驾照厚）。**价格是培训费，见识是门槛，两回事。**
 */
export const CERTS: readonly { name: string; price: number; days: number; need: number }[] = [
  { name: '护工证', price: 400, days: 1, need: 20 },
  { name: '电工证', price: 450, days: 1, need: 30 },
  { name: '驾照', price: 600, days: 1, need: 30 },
  { name: '厨师证', price: 500, days: 1, need: 40 },
  { name: '社工证', price: 550, days: 1, need: 45 },
  { name: '教师资格证', price: 700, days: 1, need: 55 },
  { name: '护士执业证', price: 800, days: 1, need: 60 },
  { name: '会计证', price: 750, days: 1, need: 65 },
];

export function certOf(name: string) {
  const key = String(name ?? '').trim();
  return CERTS.find((c) => c.name === key) ?? null;
}

/** 按 id 或名字找职业 —— 她说话不会用 id。 */
export function findJob(key: string): JobDef | null {
  const s = String(key ?? '').trim();
  if (!s) return null;
  return JOBS.find((j) => j.id === s) ?? JOBS.find((j) => j.name === s) ?? null;
}

/** 这一档里最便宜的一个，用作「没有指定干什么」时的兜底。 */
export function defaultJob(): JobDef {
  return JOBS[0];
}
