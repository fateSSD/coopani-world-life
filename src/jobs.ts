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
  load: { energy: number; clean: number; fun: number; social: number };
}

/*
 * 一天的代价，四档各一版。
 *
 * 零工沿用老数字（−34 / −16 / −10 / 0）—— 那是 2026-11-15 之前的表现，不改它，
 * 老存档里的体感就不会突然变。
 */
const LOAD: Record<JobTier, JobDef['load']> = {
  odd: { energy: 34, clean: 16, fun: 10, social: 0 },
  skilled: { energy: 36, clean: 18, fun: 12, social: 4 },
  certified: { energy: 40, clean: 20, fun: 16, social: 8 },
  professional: { energy: 44, clean: 22, fun: 20, social: 12 },
};

const def = (
  id: string,
  name: string,
  tier: JobTier,
  pay: number,
  extra: Partial<Pick<JobDef, 'cert' | 'days' | 'place' | 'materialCost'>> = {},
): JobDef => ({ id, name, tier, pay, place: 'home', load: LOAD[tier], ...extra });

/**
 * 十八种，四档 + 三档地点过滤（home / anywhere / destination）。
 *
 * 城规有一条是「鱼不吃鱼」：没有渔业、没有鱼市、没有屠宰。
 * 加任何职业之前先拿这一条判一次。
 */
export const JOBS: readonly JobDef[] = [
  // 零工：谁都能干，说走就走
  def('porter', '搬货', 'odd', 90, { place: 'anywhere' }),
  def('shopkeeper', '看店', 'odd', 85, { place: 'home' }),
  def('waiter', '端盘子', 'odd', 90, { place: 'destination' }),
  def('delivery', '送外卖', 'odd', 95, { place: 'home', materialCost: 8 }),
  def('flyer', '发传单', 'odd', 80, { place: 'destination' }),

  // 熟练工：干满一个月，或者有人介绍
  def('kitchen', '后厨帮工', 'skilled', 140, { days: 30, place: 'destination' }),
  def('renovation', '装修队小工', 'skilled', 150, { days: 30, place: 'home' }),
  def('errand', '跑腿代办', 'skilled', 130, { days: 30, place: 'home', materialCost: 10 }),
  def('stall', '早市摆摊', 'skilled', 145, { days: 30, place: 'home', materialCost: 25 }),

  // 有证：一天的钱够她吃住两天，但那张证要一笔投入
  def('caregiver', '护工', 'certified', 210, { cert: '护工证', place: 'home' }),
  def('driver', '网约车司机', 'certified', 230, { cert: '驾照', place: 'home', materialCost: 45 }),
  def('cook', '厨师', 'certified', 240, { cert: '厨师证', place: 'destination' }),
  def('electrician', '电工', 'certified', 220, { cert: '电工证', place: 'home', materialCost: 15 }),

  // 专业：证 + 经验，两个都要
  def('nurse', '社区护士', 'professional', 330, { cert: '护士执业证', days: 30, place: 'home' }),
  def('teacher', '小学代课老师', 'professional', 320, { cert: '教师资格证', days: 30, place: 'home' }),
  def('accountant', '会计', 'professional', 340, { cert: '会计证', days: 30, place: 'anywhere' }),
  def('socialworker', '社区社工', 'professional', 300, { cert: '社工证', days: 30, place: 'home' }),
];

/** 判断某份活在当前位置阶段能否接：在路上只能接 anywhere；在外地可接 anywhere+destination；在家可接 home+anywhere。 */
export function jobAllowedAt(job: JobDef, phase: 'home' | 'staying' | 'traveling'): boolean {
  if (phase === 'traveling') return job.place === 'anywhere';
  if (phase === 'staying') return job.place === 'anywhere' || job.place === 'destination';
  return job.place === 'home' || job.place === 'anywhere';
}

/**
 * 考证：一张证要多少钱、要几天。
 *
 * ## 为什么证要花钱
 *
 * 不然「我有护工证」只是一句话 —— 她第一天就能说自己有，门槛形同虚设。
 * 花钱考证把门槛变成了一个**真的取舍**：手上有 3000，是去考一张 600 的驾照
 * （六天后日薪从 90 变 230），还是先搬去老小区？
 *
 * 天数一律 1 天，代价是精力 −20。不做多天培训：那要么是日程，
 * 要么是一段什么都不干的空转，两种都不好。
 */
export const CERTS: readonly { name: string; price: number; days: number }[] = [
  { name: '护工证', price: 400, days: 1 },
  { name: '驾照', price: 600, days: 1 },
  { name: '厨师证', price: 500, days: 1 },
  { name: '电工证', price: 450, days: 1 },
  { name: '护士执业证', price: 800, days: 1 },
  { name: '教师资格证', price: 700, days: 1 },
  { name: '会计证', price: 750, days: 1 },
  { name: '社工证', price: 550, days: 1 },
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
