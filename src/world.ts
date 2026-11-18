import { statSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VersionCheck } from './version-check.ts';
import { LifeDiaryStore } from './diary.ts';
import { ImageLibrary, LIBRARY_CATEGORIES, LIBRARY_CATEGORY_LABEL, type LibraryCategory, type PhotoPolicyMode } from './library.ts';
import type {
  Logger, ToolDef, World, WorldHost, WorldWebUiDecl, WorldLamp, TriggerMode,
} from 'cortico/core/types.ts';
import { LIFE_ID, lifeConfigGroups, type LifeConfigSection } from './config.ts';
import {
  ACTS, CRITICAL, DECAY_PER_HOUR, HOME_TIER_COST, HOME_TIER_LABEL, HOME_TIER_RELIEF, LOW, MAX_PENDING, MAX_PLEDGES,
  PENDING_BLOCK_LABEL, PENDING_TTL_DAYS, StateStore, VITAL_LABEL,
  advance, applyAct, applyMove, applySpend, applyWork, applyCert, applyGift, asleepRefusal, busyRefusal, isAsleep, isBusy,
  localDateKey, noteVisit, quoteMove, readyGoals,
  recentVisits, remember, snapshot, SLEEP_ENERGY_PER_HOUR,
  appendLedger, readLedger, marketPrices, weatherOf,
  type AdvanceResult, type HomeTier, type LifeState, type PendingBlock, type Snapshot, type VitalKey,
} from './state.ts';
import { JOBS, certOf, jobAllowedAt } from './jobs.ts';
import {
  BUILTIN_TOWN, DAYPART_LABEL, clockGapHours, dayPart, herNow, readJourney, readSpendRequests, readTown,
  readPendingRequests, archivePendingRequest, fetchTownStalls, buyTownStall,
  type JourneyView, type TownView,
} from './bridge.ts';

/**
 * 自己的提示词模板，按本文件位置定位。
 *
 * ⚠ **绝对不能用 `ctx.packageDir`** —— 那是 bot 的代码包目录，不是扩展目录。
 * 拿它拼必然 ENOENT，而后框架重建系统前缀时会 `readFileSync` 这个路径且不吞错，
 * 结果是「World 进了挂载表但 slotted 没置上」，之后每次激活都报「工具撞名」，
 * 扩展永远起不来 —— 看起来完全不像路径问题。
 */
const ENV_PROMPT_FILE = fileURLToPath(new URL('../ENV_PROMPT.md', import.meta.url));

export interface LifeWorldOptions {
  cfg: LifeConfigSection;
  dataDir: string;
  botName: string;
}

/**
 * 版本号。envPrompt 里露出来，报障时第一个要确认的数，现在也上到面板表头。
 *
 * **从 `package.json` 读，不在这儿写死。** 原来这里是 `const VERSION = '0.9.1'`，
 * 和 `package.json` 各存一份 —— 2026-11-15 升到 0.10.0 时差点只改了一处，
 * 那会变成「npm 上是新的、面板上写旧的」，报障时两边对着一个假数字讨论。
 *
 * 读不到就 `0.0.0`：版本号错一个总比扩展起不来好。
 */
function readVersion(): string {
  try {
    const p = fileURLToPath(new URL('../package.json', import.meta.url));
    return String(JSON.parse(readFileSync(p, 'utf8')).version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}
const VERSION = readVersion();

/** 人话的时长：「3 分钟」「2 小时」。灯上的 hint 用，不要写 180000 毫秒。 */
function fmtSpan(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 90) return `${sec} 秒`;
  const min = Math.round(sec / 60);
  if (min < 90) return `${min} 分钟`;
  return `${(min / 60).toFixed(1)} 小时`;
}

export class LifeWorld implements World {
  readonly id = LIFE_ID;
  private host: WorldHost | null = null;
  private log: Logger | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly opts: LifeWorldOptions;
  private readonly store: StateStore;
  private readonly diary: LifeDiaryStore;
  public readonly library: ImageLibrary;
  private state: LifeState;
  private journey: JourneyView;
  private town: TownView = { ...BUILTIN_TOWN };

  constructor(opts: LifeWorldOptions) {
    this.opts = opts;
    this.store = new StateStore(opts.dataDir);
    this.diary = new LifeDiaryStore(opts.dataDir);
    this.library = new ImageLibrary(opts.dataDir, opts.cfg?.libraryDir ?? '');
    /*
     * 版本检查（2026-11-15，照 journey 那套搬过来的）。
     *
     * 面板要「立刻能画」，所以 `state()` 只读缓存，网络那一半异步跑。
     * 查不到就显示「不知道」，不显示「已是最新」—— 两回事。
     */
    this.versionCheck = new VersionCheck({ dataDir: opts.dataDir, current: VERSION });
    const { state, recovered } = this.store.load();
    this.state = state;
    this.journey = readJourney(opts.dataDir);
    /*
     * `recovered` 要说出来。三种结果对用户的意义完全不同：
     *   ok   —— 正常
     *   bak  —— 主文件坏了，退回了上一份。**她可能少过了一两天**，得知道
     *   fresh—— 从零开始。新装是正常的，但重装/换机会走到这里
     * 不说的话，前两种都会表现成「她怎么什么都不记得了」。
     */
    this.recovered = recovered;
  }

  private readonly recovered: 'ok' | 'bak' | 'fresh';

  /*
   * 热改的两个哨兵。
   *
   * `x-hot: true` 只保证 `ctx.cfg` 立刻是新值，**不保证你的代码会用上它** ——
   * `tickMs` 已经变成了一个 setInterval 的周期，`townUrl` 已经变成了内存里一份城名。
   * 不在 tick 里比对一次，用户改完设置会发现「改了没用」，而日志里一个字都没有。
   */
  private lastTickMs = 0;
  private lastTownUrl: string | null = null;
  private lastHomeCity: string | null = null;
  private lastDiaryDir: string | null = null;
  private lastLibraryDir: string | null = null;

  /**
   * 会话文件的 mtime 基线。
   *
   * 「她记得你哪天来过」的全部实现就是它 —— 文件变了 = 他刚说过话。
   * **不读内容**：内容归宿主的记忆系统管，生活层碰了就越界了（方案 §6.2）。
   */
  private sessionMtime = 0;

  /**
   * 上一次 tick 跑起来的时刻（内存，不进存档）。
   *
   * 这一格是「**她还在过日子吗**」的唯一证据。盘上的 `state.updatedAt` 测不出来 ——
   * 定时器挂了之后那个数就一直停在那儿，而面板上五条还是好好的，
   * 看起来一切正常，其实她已经不动了。
   */
  private lastTickAt = 0;
  /**
   * 基线立过没有。
   *
   * **不能用 `sessionMtime === 0` 代判** —— 那会把「文件还不存在」和
   * 「基线是 0」混成一件事：新用户第一次聊天时文件是刚出现的，
   * 被当成基线跳过，于是**他第一次来她根本不记得**。
   * 2026-11-15 端到端跑时抓到的。
   */
  private sessionBaselineSet = false;

  /** 版本号与新版本检查。面板表头那个徽章读它。 */
  private readonly versionCheck: VersionCheck;

  /** 配置是活引用：每次读都拿最新值，热改才能生效。 */
  private get cfg(): LifeConfigSection { return this.opts.cfg; }

  /* ---------------- 生命周期 ---------------- */

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    this.log = host.log;
    this.town = await readTown(this.cfg.townUrl, this.cfg.homeCity);
    this.lastTownUrl = String(this.cfg.townUrl || '').trim();
    this.lastHomeCity = String(this.cfg.homeCity || '').trim();
    this.lastDiaryDir = String(this.cfg.diaryDir || '').trim();
    const dh = this.diary.configure(this.lastDiaryDir);
    if (dh.problem) host.log.warn(`模拟鱼生：${dh.problem}`);
    this.lastLibraryDir = String(this.cfg.libraryDir || '').trim();
    const lh = this.library.configure(this.lastLibraryDir);
    if (lh.problem) host.log.warn(`模拟鱼生：${lh.problem}`);
    /*
     * 基线：启动那一刻文件的时间戳。之后变了才算「他又说过话」。
     * 启动时文件不存在（`0`）就不算立过基线 —— 它第一次出现说明他刚聊过，要记。
     */
    this.sessionMtime = this.sessionStamp();
    this.sessionBaselineSet = this.sessionMtime > 0;
    /* 刚起来算活着 —— 否则第一分钟灯就是红的，白白吓人一次。 */
    this.lastTickAt = Date.now();
    /* 查最新版：不 await，面板不该等网络。 */
    void this.versionCheck.startupRefresh();
    this.restartTimer();
    host.log.info(
      `模拟鱼生已就绪：${this.town.name}（${this.townSourceLabel()}）`
      + `　·　上次存档 ${this.state.updatedAt}`
      + (this.recovered === 'bak' ? '　·　主档坏了，用的是备份' : ''),
    );
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try { this.store.save(this.state); } catch { /* 退出时写不进去不该拦着关 */ }
    this.host = null;
    this.log = null;
  }

  /** `tickMs` 是热改的 —— 改了要重排定时器，否则要重启才生效。 */
  private restartTimer(): void {
    if (this.timer) clearInterval(this.timer);
    const ms = Math.max(15_000, Number(this.cfg.tickMs) || 60_000);
    this.lastTickMs = ms;
    this.timer = setInterval(() => void this.tick(), ms);
    this.timer.unref?.();
  }

  /* ---------------- 他来过没有 ---------------- */

  private sessionStamp(): number {
    try {
      return statSync(join(this.opts.dataDir, 'session-main.jsonl')).mtimeMs;
    } catch {
      return 0;
    }
  }

  /**
   * 会话文件变了就记一笔「他来过」。
   *
   * 只在 mtime **往前走** 时记 —— 文件被删、被清空、时间戳倒退（同步盘回拨）
   * 都不算他来过，那些情况下记一笔会让她的记忆凭空多出几天。
   */
  private checkPresence(now: Date): void {
    const stamp = this.sessionStamp();
    /* 还没有会话文件：没聊过。 */
    if (stamp <= 0) return;

    /* 文件是刚出现的（启动时还不存在）—— 说明他刚聊过，这一笔要记。 */
    if (!this.sessionBaselineSet) {
      this.sessionBaselineSet = true;
      this.sessionMtime = stamp;
      noteVisit(this.state, now);
      return;
    }

    if (stamp <= this.sessionMtime) {
      /* 倒退（同步盘回拨、文件被换掉）也要跟上基线，否则回来之后会误判一次 */
      if (stamp < this.sessionMtime) this.sessionMtime = stamp;
      return;
    }
    this.sessionMtime = stamp;
    noteVisit(this.state, now);
  }

  /* ---------------- 推进 ---------------- */

  private async tick(): Promise<void> {
    /* 先打点再干活：这一格记的是「定时器还活着」，不是「这一跳有活干」。 */
    this.lastTickAt = Date.now();
    const now = new Date();

    /* 先把热改接上：周期变了重排定时器，地址变了重读城名。 */
    const ms = Math.max(15_000, Number(this.cfg.tickMs) || 60_000);
    if (ms !== this.lastTickMs) this.restartTimer();
    const townUrl = String(this.cfg.townUrl || '').trim();
    const homeCity = String(this.cfg.homeCity || '').trim();
    const diaryDir = String(this.cfg.diaryDir || '').trim();
    if (this.lastDiaryDir !== null && diaryDir !== this.lastDiaryDir) {
      this.lastDiaryDir = diaryDir;
      const dh = this.diary.configure(diaryDir);
      this.log?.info(`模拟鱼生：生活日记目录切到 ${dh.dir}${dh.problem ? `（${dh.problem}）` : ''}`);
    }
    const libraryDir = String(this.cfg.libraryDir || '').trim();
    if (this.lastLibraryDir !== null && libraryDir !== this.lastLibraryDir) {
      this.lastLibraryDir = libraryDir;
      const lh = this.library.configure(libraryDir);
      this.log?.info(`模拟鱼生：素材库目录切到 ${lh.dir}${lh.problem ? `（${lh.problem}）` : ''}`);
      this.broadcastLife(now);
    }
    if (
      (this.lastTownUrl !== null && townUrl !== this.lastTownUrl)
      || (this.lastHomeCity !== null && homeCity !== this.lastHomeCity)
    ) {
      this.lastTownUrl = townUrl;
      this.lastHomeCity = homeCity;
      this.town = await readTown(townUrl, homeCity);
      this.log?.info(`模拟鱼生：本城改成了 ${this.town.name}（${this.townSourceLabel()}）`);
    }

    this.journey = readJourney(this.opts.dataDir, now);
    /* presence 要在 advance 之前记 —— 它是「今天」的事，跟衰减无关。 */
    this.checkPresence(now);
    /*
     * 收旅行扩展递过来的花销条子。
     *
     * 放在 `advance` 之前、并且**不跟着 `r.hours` 走** —— 她欠的那笔钱跟她这一小时
     * 过没过没有关系，不能因为「这一跳没走时间」就把条子留着不发。
     */
    this.settleSpendRequests(now);
    this.broadcastLife(now);
    const r = advance(this.state, now, { phase: this.journey.phase, hotelTier: this.journey.hotelTier, modeId: this.journey.modeId });
    if (r.hours <= 0) return;

    this.settleCompleted(r, now);
    let dirty = true;

    /* 病了 —— 这条要紧，用 flush。 */
    for (const c of r.caught) {
      remember(this.state, c.text, now);
      await this.push('life.sick', `${c.text}`, 'flush');
    }
    for (const c of r.recovered) {
      remember(this.state, `${c.text.replace(/。$/, '')}，已经好了。`, now);
      await this.push('life.recovered', `${c.text.replace(/。$/, '')}，已经好了。`, 'debounce');
    }

    /*
     * 目标攒够了 —— **只给信号，不替她搬。**
     *
     * 「攒够 5200 就搬到新小区」是她自己的目标。代码替她执行，
     * 这个目标就变成了一个定时器，不再是她的决定。
     *
     * 所以这里只说「钱够了」，搬不搬她自己判断：户型合不合适、要不要再攒点买下来、
     * 这阵子想不想折腾 —— 这些理由代码都不知道。
     */
    const today = localDateKey(now);
    for (const g of readyGoals(this.state)) {
      const key = `goal:${g.id}`;
      if (this.state.nagged[key] === today) continue;
      this.state.nagged[key] = today;
      await this.push(
        'life.goal',
        `攒够了：「${g.what}」要的钱有了。手上 ${this.state.money.cash} 元，要 ${g.need} 元。`
          + '搬不搬、什么时候搬，你自己看 —— 这只是一个数到齐了。',
        'debounce',
      );
    }

    /*
     * 掉过线的那几条 —— 按配置的密度说。
     *
     * **睡着时不推**（2026-11-15）：半夜被自己的饥饿叫醒，那不是提醒，是打扰。
     * 但**不能连事实一起扔掉**（2026-11-17 修）：`crossed` 是一次性的，
     * 丢掉之后醒来那一跳判的是「这一跳跨没跨」，永远不会再算到它，
     * 于是那几条就此静音。现在先记进 `deferred`，醒来补发 —— 见 `flushCrossed`。
     */
    await this.flushCrossed(r, now);

    /* 饿醒了要说一声 —— 见 `reportHungryWake`。 */
    await this.reportHungryWake(r, now);

    /*
     * 白天未出工提醒（一天最多一次）：
     * 醒着、无病、精力充足、五条不缺且今天还没出过工时，给一条事实提示，
     * 避免手上挂着目标却全天忘了出工。
     */
    const at = herNow(this.journey, now);
    const hr = at.getHours();
    const allOk = (Object.keys(this.state.vitals) as VitalKey[]).every((k) => this.state.vitals[k] >= LOW);
    if (
      !isBusy(this.state, now)
      && hr >= 9 && hr <= 17
      && this.state.conditions.length === 0
      && this.state.vitals.energy >= 55
      && allOk
      && this.state.job.lastAt !== today
      && this.shouldNag('day:work', now)
    ) {
      this.state.nagged['day:work'] = today;
      const goalGap = readyGoals(this.state).length === 0 && this.state.goals.length
        ? this.state.goals.filter((g) => !g.done && g.need > this.state.money.cash)
          .map((g) => `距「${g.what}」还差 ${g.need - this.state.money.cash} 元`).join('；')
        : '';
      const jobHint = this.state.job.what
        ? `上次做的是「${this.state.job.what}」（${this.state.job.daily} 元/天）`
        : '还没定固定活（可以先挑个零工）';
      const cash = Math.round(this.state.money.cash);
      const dailyBase = Math.max(15, Math.round(this.state.home.monthly / 30) + 15);
      const tightHint = cash < dailyBase * 5
        ? '，手头有点紧，出工能先把这几天的饭钱房租稳住。'
        : `；出门能动用的旅费约 ${Math.round(cash * 0.7)} 元，想吃点好的、住得更舒心或攒钱去想去的地方，今天可以出工挣一笔，也可以读书考证提升自己。`;
      await this.push(
        'life.day',
        `现在是白天（${DAYPART_LABEL[dayPart(at)]}），精力 ${Math.round(this.state.vitals.energy)}，今天还没出过工。`
          + `${jobHint}；手上 ${cash} 元`
          + (goalGap ? `（${goalGap}）` : '')
          + `${tightHint}怎么安排你自己定。`,
        'debounce',
      );
    }

    if (dirty) {
      try { this.store.save(this.state); } catch (e) {
        /* 存不进去要说，但**不能把 tick 搞挂** —— 下一跳还会再来一次。 */
        this.log?.warn(`模拟鱼生：存档失败 ${(e as Error).message}`);
      }
    }
  }

  /**
   * 越线提醒的闸门：睡着先记账，醒着才开口。
   *
   * 和 `reportCrossed` 分两层的原因：那边只管「怎么把话说完」，
   * 这边管「什么时候该说」。合成一个函数的话，「在睡」这个判断会被
   * 复制到 tick 和工具入口两处 —— 漏一处就是半夜被吵。
   */
  private async flushCrossed(r: AdvanceResult, now: Date): Promise<void> {
    if (isAsleep(this.state, now)) {
      /*
       * 在睡：只记不说。`critical` / `bottomed` 也一起记 —— 醒来时按当时的真实值重算正文，
       * 所以这里只存 key，不存「那会儿是多少」。
       */
      for (const k of [...r.crossed, ...r.critical, ...r.bottomed]) {
        if (!this.state.deferred.includes(k)) this.state.deferred.push(k);
      }
      return;
    }
    const carry = this.state.deferred ?? [];
    this.state.deferred = [];
    /* 昨夜欠下的和这一跳新跨的合并去重：同一条只提一次。 */
    const merged = [...new Set([...carry, ...r.crossed])];
    if (!merged.length && !r.critical.length && !r.bottomed.length) return;
    await this.reportCrossed(merged, now, r.bottomed, r.critical);
  }

  /**
   * 这一跳里掉过线的那几条，按配置的密度说一句。
   *
   * **抽出来是因为现在有两个地方会推进时间**：`tick()` 和工具入口的
   * `settleBeforeTool()`。两处各写一遍的话，工具入口那份漏掉 `crossed`，
   * 后果是**开机后第一件事就是调工具，她饿了一夜却一句提醒都没有** ——
   * `crossed` 判的是「这次推进跨过去的」，被工具消费掉之后 tick 再也看不到。
   *
   * 推送前再核一遍当前值（`vitals[key]`）：如果同一轮里她刚吃/刚洗补回去了，
   * 不再推送过期提醒，以免把刚处理好的需求当成噪音。
   */
  private async reportCrossed(
    crossed: VitalKey[],
    now: Date,
    bottomed: VitalKey[] = [],
    critical: VitalKey[] = [],
  ): Promise<void> {
    const today = localDateKey(now);
    const seen = new Set<VitalKey>();
    for (const key of bottomed) {
      if (this.state.vitals[key] > 0) continue;
      const zeroKey = `zero:${key}`;
      if (!this.shouldNag(zeroKey, now)) continue;
      await this.push('life.low', `见底了：${this.lowText(key, 0)}`, 'flush');
      this.state.nagged[zeroKey] = today;
      seen.add(key);
    }
    for (const key of critical) {
      if (seen.has(key) || this.state.vitals[key] >= CRITICAL) continue;
      const critKey = `crit:${key}`;
      if (!this.shouldNag(critKey, now)) continue;
      await this.push('life.low', `很缺了：${this.lowText(key, Math.round(this.state.vitals[key]))}`, 'flush');
      this.state.nagged[critKey] = today;
      seen.add(key);
    }
    for (const key of crossed) {
      if (seen.has(key) || this.state.vitals[key] >= LOW || !this.shouldNag(key, now)) continue;
      await this.push('life.low', this.lowText(key, Math.round(this.state.vitals[key])), 'debounce');
      this.state.nagged[key] = today;
    }
  }

  /**
   * 饿醒了要说一声 —— 这是她**在梦里被身体叫起来**的唯一一次。
   *
   * 自然醒不用说：她睡够了醒来，自己知道；而且每八小时推一条「她醒了」，
   * 那是报站。只有饿醒值得占一次对话的注意力，因为它解释了「怎么才这个点就醒了」。
   */
  private async reportHungryWake(r: AdvanceResult, now: Date): Promise<void> {
    if (r.woke?.reason !== 'hungry') return;
    await this.push(
      'life.low',
      `饿醒了，才睡了 ${Math.round(r.woke.hours)} 小时。饱腹 ${Math.round(this.state.vitals.food)}。`,
      'flush',
    );
  }

  /**
   * 动作工具调用前先把时间推进到 `now`。
   * 避免两次 `tick` 之间已经自然醒或饿醒时，`applyAct`/`life_out` 覆盖 `updatedAt` 吞掉结算，
   * 或者把已经饿醒的她误拦在「在睡」。
   *
   * **推进出来的话一样要说**（阈值、饿醒），否则「开机第一件事就调工具」会把它们吞掉。
   */
  private settleCompleted(r: AdvanceResult, now: Date): void {
    for (const c of r.completed ?? []) {
      if (c.kind === 'work' && c.workEarned > 0) {
        appendLedger(this.opts.dataDir, {
          id: `work-done-${c.id}-${now.getTime().toString(36)}`,
          ts: now.toISOString(),
          kind: 'income',
          amount: c.workEarned,
          source: 'life_work',
          payee: '自己',
          note: c.stoppedEarly ? `${c.label}（中途停工）` : c.label,
        });
      } else if (c.kind === 'act' && c.costPaid > 0) {
        appendLedger(this.opts.dataDir, {
          id: `act-done-${c.id}-${now.getTime().toString(36)}`,
          ts: now.toISOString(),
          kind: 'expense',
          amount: c.costPaid,
          source: 'life_act',
          payee: c.label,
          note: c.label,
        });
      }
    }
  }

  private async settleBeforeTool(now: Date): Promise<void> {
    const r = advance(this.state, now, { phase: this.journey.phase, hotelTier: this.journey.hotelTier, modeId: this.journey.modeId });
    if (r.hours <= 0) return;
    this.settleCompleted(r, now);
    /* 工具能调，说明她已经醒了 —— `flushCrossed` 会走醒着那一支，昨夜欠的一起补。 */
    await this.flushCrossed(r, now);
    await this.reportHungryWake(r, now);
    this.broadcastLife(now);
    try { this.store.save(this.state); } catch { /* 后续动作或下一跳会再存 */ }
  }

  /**
   * 把「她在睡」广播出去（2026-11-15）。
   *
   * 卷二十的规矩：**只放事实、带 schema、原子写**。
   * 只有一个字段是给对面看的 —— `asleepUntil`。五条、钱、职业都是她的私事，
   * 旅行扩展不需要，也就不给（公开快照越小，越不会变成第二份私有状态）。
   *
   * 过期了就发空串：对面拿到就不用再自己算时间了。
   */
  private recentSettled: { id: string; status: 'applied' | 'rejected' }[] = [];

  private broadcastLife(now: Date): void {
    try {
      const until = this.state.asleepUntil;
      const awake = !until || Date.parse(until) <= now.getTime();
      const file = join(this.opts.dataDir, 'life-public.json');
      const tmp = `${file}.tmp-${process.pid}`;
      /*
       * 旅行能动用多少：现金的 70%（2026-11-17 由 50% 上调）。
       *
       * 50% 那档是「留一半过日子」的保守写法，但它让「想去洛杉矶」这类念头
       * 几乎永远算不起 —— 跨洲来回加住宿要几千，现金 2880 只放出 1440，
       * 于是一个本来只需要多干十天活的计划变成了「永远差一半」。
       *
       * 70% 的账：留三成在家吃饭交房租（一天 60，够二十天），
       * 剩下的才是真能拿去走远的。仍然是「能动用的」，不是「全部」。
       */
      const allowance = Math.max(0, Math.round(this.state.money.cash * .7));
      const w = weatherOf(this.town.name, now);
      writeFileSync(tmp, JSON.stringify({
        schema: 2,
        asleepUntil: awake ? '' : until,
        updatedAt: now.toISOString(),
        ledger: {
          cash: this.state.money.cash,
          travelAllowance: allowance,
        },
        vitals: {
          energy: Math.round(this.state.vitals.energy),
          fitness: Math.round(this.state.fitness),
        },
        settled: this.recentSettled.slice(-40),
        town: { id: this.town.id, name: this.town.name, weather: w.sky },
        activity: (() => {
          const a = this.state.activity;
          if (!a || Date.parse(a.until) <= now.getTime()) return null;
          const def = ACTS[a.id];
          return {
            id: a.id,
            kind: a.kind,
            label: a.label,
            until: a.until,
            scene: def?.scene ?? null,
            outfitHint: def?.outfitHint ?? null,
            props: def?.props ?? null,
            visualPrompt: def ? this.library.composeVisualPrompt({ label: a.label, scene: def.scene, outfitHint: def.outfitHint, props: def.props }) : null,
          };
        })(),
        imagePolicy: this.library.getSettings(),
      }, null, 2));
      renameSync(tmp, file);
    } catch { /* 广播不出去不影响她过日子 */ }
  }

  /**
   * 收旅行扩展递过来的花销条子（2026-11-15）。
   *
   * ## 为什么是她来扣，不是那边扣
   *
   * `life-state.json` 只有一个写者 —— 本扩展。那边同时写的话，两个进程各写一份
   * `.tmp` 再 `rename`，谁后写谁覆盖，丢的是她的钱。所以那边只放条子，
   * 这边读、判重、扣、回执。
   *
   * ## 三条边界
   *
   * 1. **判重**：`state.spendApplied` 和扣钱在同一次 `save()` 里落下，崩在中间也不会重复扣；
   * 2. **不扣成负数**：钱不够就扣到 0，并记一条「没付清」—— 欠债是一整套催缴与协商，
   *    一期不做（卷二「房租扣到 0 为止」是同一条规矩）；
   * 3. **看不懂的条子也要回执**：用文件名当 id 回 `rejected`，否则那份文件在那边永远删不掉。
   */
  private settleSpendRequests(now: Date): void {
    const legacy = readSpendRequests(this.opts.dataDir);
    const pending = readPendingRequests(this.opts.dataDir);
    if (!legacy.length && !pending.length) return;
    const allSettled: { id: string; status: 'applied' | 'rejected' }[] = [];
    let anyChanged = false;

    if (legacy.length) {
      const { settled, changed } = applySpend(this.state, legacy, now);
      if (changed) anyChanged = true;
      for (const s of settled) {
        allSettled.push(s);
        if (s.status === 'applied') {
          const req = legacy.find((x) => x.id === s.id);
          if (req && req.amount > 0) {
            appendLedger(this.opts.dataDir, {
              id: `spend-${s.id}`,
              ts: now.toISOString(),
              kind: 'expense',
              amount: req.amount,
              source: 'journey',
              payee: '途中花费',
              note: req.note || '出行花销',
            });
          }
        }
      }
      this.writeSpendSettled(settled);
    }

    for (const req of pending) {
      /* 每个分支都走这里：回执之外再把条子归档，已结算的不会被第二次读到。 */
      const settle = (status: 'applied' | 'rejected') => {
        allSettled.push({ id: req.id, status });
        archivePendingRequest(this.opts.dataDir, req.file);
      };
      if (req.invalid) {
        settle('rejected');
        continue;
      }
      if (this.state.spendApplied.includes(req.id)) {
        settle('applied');
        continue;
      }
      this.state.spendApplied.push(req.id);
      if (this.state.spendApplied.length > 120) this.state.spendApplied = this.state.spendApplied.slice(-120);
      if (req.amount > 0) {
        const take = Math.min(this.state.money.cash, req.amount);
        this.state.money.cash -= take;
        this.state.money.spent += take;
        appendLedger(this.opts.dataDir, {
          id: `pending-out-${req.id}`,
          ts: now.toISOString(),
          kind: 'expense',
          amount: take,
          source: req.source,
          payee: req.payee || req.source,
          note: req.note || req.kind,
        });
      }
      if (req.earned > 0) {
        this.state.money.cash += req.earned;
        this.state.money.earned += req.earned;
        appendLedger(this.opts.dataDir, {
          id: `pending-in-${req.id}`,
          ts: now.toISOString(),
          kind: 'income',
          amount: req.earned,
          source: req.source,
          payee: '自己',
          note: req.note || req.kind,
        });
      }
      if (req.worldHours > 0) {
        /* 打包折算：每世界小时只折轻微体力与饱腹，保底不扣成负数。 */
        const wh = Math.min(req.worldHours, 72);
        this.state.vitals.energy = Math.max(10, this.state.vitals.energy - wh * .35);
        this.state.vitals.food = Math.max(10, this.state.vitals.food - wh * .3);
      }
      anyChanged = true;
      settle('applied');
    }

    if (anyChanged) {
      this.state.updatedAt = now.toISOString();
      try { this.store.save(this.state); } catch { /* 下一跳再存 */ }
    }
    if (allSettled.length) {
      this.recentSettled = [...this.recentSettled, ...allSettled].slice(-40);
    }
  }

  /**
   * 回执：**这是本扩展自己的文件**，那边读它来删自己放下的条子。
   *
   * 按 200 条滚。写不进去只记日志 —— 回执丢了最多是那边多留一份文件，
   * 绝不能因为回执写不出来把她这一跳搞挂。
   */
  private writeSpendSettled(list: { id: string; status: 'applied' | 'rejected' }[]): void {
    if (!list.length) return;
    try {
      const file = join(this.opts.dataDir, 'life-spend-settled.json');
      let prev: { id: string; status: string }[] = [];
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8'));
        if (Array.isArray(raw?.settled)) prev = raw.settled;
      } catch { /* 第一次写，或者上一份坏了 —— 都当空的 */ }
      const merged = [...prev, ...list].slice(-200);
      writeFileSync(file, JSON.stringify({ v: 1, at: new Date().toISOString(), settled: merged }, null, 2));
    } catch (e) {
      this.log?.warn(`花销回执没写成：${(e as Error)?.message ?? e}`);
    }
  }

  /**
   * 这条需求现在该不该提。
   *
   * `once` 的判据是**按天**，不是按小时：她一天饿八次、每两小时说一次「我饿了」，
   * 那就不是过日子，是报站。方案的判据原文是「一天一次是同一条需求一天最多提一次
   * —— 这是给她留余地，不是替她定规矩」。
   */
  private shouldNag(key: string, now: Date): boolean {
    const mode = this.cfg.notify;
    if (mode === 'off') return false;
    if (mode === 'always') return true;
    /*
     * ⚠ 用 `localDateKey`，不是 `toISOString().slice(0, 10)`（2026-11-15 修）。
     *
     * 后者是 **UTC 日期**：北京时间凌晨 0–8 点时它还是前一天，于是那会儿的告警
     * 占用的是**前一天**的额度 —— 同一天会推两次，第二天早上那次反而不推。
     * 和 `workedToday` 是同一个毛病，一处写成 UTC、一处写成本地，就会这样。
     */
    const today = localDateKey(now);
    return this.state.nagged[key] !== today;
  }

  /** 阈值事件的正文。**只写事实，不写结论**（铁律 1）。 */
  /**
   * 「哪条掉到多少了」这句话。
   *
   * ## 为什么现在带上「还能撑多久」和「怎么回」（2026-11-15 Mr.Q 选的做法）
   *
   * 原来只说跌幅（「精力掉到 19」）。她手上只有这个数，判断不了急不急 ——
   * 19 到底是「还能撑一晚上」还是「一小时后动不了」，她不知道，于是**干等着**。
   * 真实数据：建档 11 小时，她一次没睡、一顿饭、一天工没出，精力掉到 19.3 还在原地。
   *
   * 补上两个**算术事实**：按当前衰减速率还能撑几小时、哪个动作能回多少。
   * ## 但不下命令
   *
   * 铁律一：只报事实。所以这里没有「你该去睡了」——
   * 只给「睡一觉每小时回 10、睡满八小时回 80，而洗、玩、见人都要再扣精力」。做不做是她的事。
   */
  private lowText(key: VitalKey, v: number): string {
    const where = this.journey.installed && this.journey.phase === 'staying'
      ? `在${this.journey.cityName}`
      : this.journey.installed && this.journey.phase === 'traveling'
        ? `在去${this.journey.toName}的路上`
        : '';
    const tail = where ? `　·　${where}` : '';
    /*
     * 见底时间 = 现在的值 ÷ 每小时掉多少。**除的必须是实际速率** ——
     * 住处有减免之后还按基准速率算，别墅区说「2 小时见底」而实际是 3 小时，
     * 那就是对她说了假话（2026-11-17 加减免时一并改的）。
     * 精力不减，见 `HOME_TIER_RELIEF`。
     */
    const relief = key === 'energy' ? 1 : (HOME_TIER_RELIEF[this.state.home.tier] ?? 1);
    const hours = v / (DECAY_PER_HOUR[key] * relief);
    const left = hours < 1
      ? '按现在的掉法，撑不到一小时。'
      : hours <= 6
        ? `按现在的掉法，约 ${Math.round(hours)} 小时左右见底。`
        : '已经低于 30 了。';
    /*
     * 「那时候你会怎么样」这句是 2026-11-17 Mr.Q 加的。
     *
     * 原来只给数字和「哪个动作能回多少」，她读得懂算术，却不知道**急不急** ——
     * 19 点是「还能撑一晚」还是「一小时后动不了」，光看数算不出来。
     * 补一句体感（腿软、发闷、屋里太静），数字才变成一个她能从身体上认出来的处境。
     *
     * 三档饭价照 `ACTS` 的实价写：好的 50/40 元、普通 30/15 元、随便 15/0 元。
     * **文案不许跑得比实现快** —— 这里写什么价，`ACTS` 就得真是那个价。
     */
    switch (key) {
      case 'food':
        return `饱腹 ${v}，${left}那时候你就饿得心里发慌了 —— 吃一顿好的回 50（40 元），吃得舒服，`
          + '心里也顺；吃一顿普通的回 30（15 元），不饿了，也就那样；实在没钱就随便吃点，回 15，'
          + `不饿了，但心里不痛快。手头宽就吃好的，紧才往下走一档。${tail}`;
      case 'energy':
        return `精力 ${v}，${left}那时候你连抬手都嫌沉，坐着都想往下出溜。睡一觉每小时回 10，`
          + '睡满八小时回 80，不花钱 —— 洗、玩、见人都要再扣精力，只有睡是往上走的。'
          + `${tail}`;
      case 'clean':
        return `清爽 ${v}，${left}那时候身上发黏，自己都嫌弃自己。洗个澡回 55，不花钱，`
          + `半小时的事。${tail}`;
      case 'fun':
        /*
         * **补一条不花钱的退路**（2026-11-17）。原来只说「找点乐子 22 元」，
         * 手头紧的时候这条提示等于告诉她「你现在补不起」。
         * 同时把 38 改成 39 —— `ACTS.play` 实际是 `fun: 39`，文案写少了一个。
         */
        return `娱乐 ${v}，${left}那时候人会发闷，看什么都提不起劲，坐也不是站也不是。`
          + `找点乐子回 39（22 元，要花 6 点精力）；不想花钱就看会儿书，回 20，顺带还涨见识。${tail}`;
      case 'social':
        /*
         * 社交是唯一一条**免费路很慢**的：`meet` 一次回 31，而 `market` 只回 8、
         * `pond` 只回 4。不给这两条，她看到「30 元」就只能拖到明天 ——
         * 2026-11-17 Mr.Q 观察到的「吃饭会自动做、社交不动」就是这个造成的：
         * 饱腹那条提示里明写了「实在没钱就随便吃点」，她有退路；
         * 社交这条只说了付钱那一条，她没有。
         */
        return `社交 ${v}，${left}那时候会觉得屋里太静，安静得能听见自己喘气。`
          + `跟人说说话回 31（30 元，花 5 点精力）；不想花钱就逛早市集市（回 8）或望水坡（回 4）—— `
          + `慢一点，多走两趟也上来了。${tail}`;
    }
  }

  private async push(type: string, text: string, trigger: TriggerMode): Promise<void> {
    const host = this.host;
    if (!host) return;
    try {
      await host.pushEvent({
        type,
        source: this.id,
        senderKey: LIFE_ID,
        ts: new Date().toISOString(),
        text,
      }, { trigger });
    } catch (e) {
      this.log?.warn(`模拟鱼生：事件推不出去 ${(e as Error).message}`);
    }
  }

  /* ---------------- 工具 ---------------- */

  tools(): ToolDef[] {
    return [
      this.toolStatus(),
      this.toolAct(),
      this.toolWork(),
      this.toolCert(),
      this.toolMove(),
      this.toolOut(),
      this.toolHabit(),
      this.toolWatch(),
      this.toolWant(),
      this.toolAsk(),
      this.toolPledge(),
      this.toolGift(),
      this.toolBuy(),
      this.toolDiaryWrite(),
      this.toolDiaryRead(),
      this.toolLibrary(),
    ];
  }

  private toolStatus(): ToolDef {
    return {
      name: 'life_status',
      description:
        '看一眼自己现在什么状态：五条需求各是多少、身上有没有不舒服、刚才为什么高兴或不高兴、'
        + '手上有哪几件在留意的事。'
        + '在你准备说「我今天过得……」之前用它 —— 你嘴里的今天，得有这些做依据。'
        + '不需要问任何人就能看。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      tags: ['read'],
      handler: async () => {
        const now = new Date();
        await this.settleBeforeTool(now);
        const j = readJourney(this.opts.dataDir, now);
        this.journey = j;
        const s = snapshot(this.state, now);
        return { text: this.statusText(s, j, now) };
      },
    };
  }

  private toolAct(): ToolDef {
    return {
      name: 'life_act',
      description:
        '开始一项活动（除 wake/cancel 外均按分钟结算五维与花销，进行中不可并发）。'
        + '吃：feast(60m/40元) eat(40m/15元) instant(15m/0元) cook(55m/10元) supper(30m/18元)；'
        + '饮：tea(45m/28元) drink(60m/28元) cafe(60m/30元)；'
        + '休/护/动：sleep(8h) nap(60m) wash(30m) spa(60m/120元) sunbathe(40m) tidy(45m) workout(45m)；'
        + '闲/学/社：study(60m/涨见识) play(60m/22元) meet(90m/30元) mall(90m/81元) market(45m) picnic(90m/36元) movie(120m/36元) karaoke(120m/66元) museum(90m/18元) paint(90m) pond(40m)；'
        + '控制：wake(睡着时起来) cancel(中途打断或早退，钱不退且有惩罚)。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: {
          kind: {
            type: 'string',
            enum: Object.keys(ACTS),
            description: '动作 id：eat/feast/instant/cook/supper/tea/drink/cafe/sleep/nap/wash/spa/sunbathe/tidy/workout/'
              + 'study/play/mall/market/picnic/movie/karaoke/museum/paint/meet/pond/wake/cancel。',
          },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = new Date();
        await this.settleBeforeTool(now);
        const kindId = String(args?.kind ?? '');
        const r = applyAct(this.state, kindId, now);
        if (!r.ok) return { text: r.reason ?? '这件事做不了。' };
        if (r.cost > 0) {
          appendLedger(this.opts.dataDir, {
            id: `act-${kindId}-${now.getTime().toString(36)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: r.cost,
            source: 'life_act',
            payee: r.interruptedLabel ?? (ACTS[kindId]?.label ?? kindId),
            note: kindId === 'cancel' ? `中途停下「${r.interruptedLabel ?? '活动'}」` : (ACTS[kindId]?.label ?? kindId),
          });
        }
        if (r.workEarned && r.workEarned > 0) {
          appendLedger(this.opts.dataDir, {
            id: `work-early-${now.getTime().toString(36)}`,
            ts: now.toISOString(),
            kind: 'income',
            amount: r.workEarned,
            source: 'life_work',
            payee: '自己',
            note: `${r.interruptedLabel ?? '出工'}（早退）`,
          });
        }
        try { this.store.save(this.state); } catch { /* 下一跳会再存 */ }
        this.broadcastLife(now);

        if (kindId === 'sleep') {
          const until = Date.parse(this.state.asleepUntil);
          const at = new Date(until);
          const hh = String(at.getHours()).padStart(2, '0');
          const mm = String(at.getMinutes()).padStart(2, '0');
          const willBe = Math.min(100, Math.round(this.state.vitals.energy + SLEEP_ENERGY_PER_HOUR * 8));
          return {
            text: `睡下了，八小时后醒（大约 ${hh}:${mm}）。这会儿精力 ${Math.round(this.state.vitals.energy)}，`
              + `睡满的话醒来大约 ${willBe}。睡着这段时间，除了「起来」（wake），别的事都做不了。`
              + '要是饱腹掉到 15，会饿醒。',
          };
        }

        if (kindId === 'cancel') {
          const earnTxt = r.workEarned && r.workEarned > 0 ? `早退折算拿到 ${r.workEarned} 元。` : '';
          return {
            text: `把「${r.interruptedLabel ?? '手头的事'}」停下了。${earnTxt}`
              + (r.mood ? `眼下心里：${r.mood.text}。` : '')
              + `现在五条：${this.vitalsLine(r.vitals)}`,
          };
        }

        const kind = ACTS[kindId];
        if (r.started && this.state.activity) {
          const at = new Date(Date.parse(this.state.activity.until));
          const hh = String(at.getHours()).padStart(2, '0');
          const mm = String(at.getMinutes()).padStart(2, '0');
          const mins = r.minutes ?? kind?.minutes ?? 0;
          return {
            text: `开始「${kind?.label ?? kindId}」了，预计需要 ${mins} 分钟（大约 ${hh}:${mm} 做完）。`
              + '这段时间五维和花销会慢慢结算；有急事可以用 `cancel` 中途停下，但钱不退还会扫兴。',
          };
        }

        const after = Object.entries(kind?.gain ?? {})
          .map(([k, d]) => `${VITAL_LABEL[k as VitalKey]} ${Number(d) > 0 ? '+' : ''}${d}`)
          .join('、');
        return {
          text: `${kind?.label ?? '做完了'}。${after ? `${after}。` : ''}`
            + (kindId === 'study' ? `见识到 ${Math.round(this.state.knowledge)} 了。` : '')
            + (r.mood ? `眼下心里：${r.mood.text}。` : '')
            + `现在五条：${this.vitalsLine(r.vitals)}`,
        };
      },
    };
  }

  /**
   * 出工：现在也按职业工时走一段时间（零工 3-4h / 熟练 4.5-5h / 有证 6h / 专业 7-8h）。
   */
  private toolWork(): ToolDef {
    return {
      name: 'life_work',
      description:
        '去上班/出工挣钱。**一天一次**，按你本地的自然日算，**而且需要占用一段完整工时** —— '
        + '零工约 3–4 小时（80–95 元）、熟练活约 4.5–5 小时（130–145 元，需满 30 天）、'
        + '有证岗 6 小时（220–240 元，需考证）、专业岗 7–8 小时（300–340 元，需考证+年头）。'
        + '干活期间社交和娱乐不会掉，但精力、清爽和饱腹会按职业强度加速消耗；干完收工才发全薪。'
        + '中途可用 `life_act` 的 `cancel` 早退：干满 30 分钟按比例打六折、不满 30 分钟白干，都不涨工龄且当天不能重接。'
        + '精力低于 20 或正在做别的事时去不了。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          what: {
            type: 'string',
            description: '今天干什么活，一句话。不填就沿用上次那个。',
          },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = new Date();
        await this.settleBeforeTool(now);
        const j = readJourney(this.opts.dataDir, now);
        this.journey = j;
        const phase = j.installed && (j.phase === 'staying' || j.phase === 'traveling') ? j.phase : 'home';
        const what = String(args?.what ?? '').trim();
        if (!what && !this.state.job.what) {
          const avail = JOBS.filter((job) => jobAllowedAt(job, phase)).slice(0, 5);
          return {
            text: `现在可接的活（挑一个填进 what）：${avail.map((a) => `${a.name}（${a.pay}元/${a.minutes}分钟）`).join('、')}。`,
          };
        }
        const r = applyWork(this.state, what, now, phase);
        if (!r.ok) return { text: r.reason ?? '今天去不了。' };
        if (r.materialPaid && r.materialPaid > 0) {
          appendLedger(this.opts.dataDir, {
            id: `work-mat-${now.getTime().toString(36)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: r.materialPaid,
            source: 'life_work',
            payee: '成本垫付',
            note: `${this.state.job.what || '出工'}材料成本`,
          });
        }
        try { this.store.save(this.state); } catch { /* 下一跳会再存 */ }
        this.broadcastLife(now);

        if (r.started && this.state.activity) {
          const at = new Date(Date.parse(this.state.activity.until));
          const hh = String(at.getHours()).padStart(2, '0');
          const mm = String(at.getMinutes()).padStart(2, '0');
          const matTxt = r.materialPaid && r.materialPaid > 0 ? `已先垫付成本 ${r.materialPaid} 元。` : '';
          return {
            text: `去上「${this.state.job.what}」了，工时 ${r.minutes ?? 240} 分钟（预计 ${hh}:${mm} 收工），`
              + `干完可得 ${r.expectedPay ?? 0} 元。${matTxt}`
              + '干活期间社交和娱乐不会掉，但精力、清爽、饱腹会消耗；早退不满 30 分钟白干、满 30 分钟按比例打六折。',
          };
        }

        return {
          text: `干完了，挣了 ${r.earned} 元。手上现在 ${r.cash} 元。`
            + `现在五条：${this.vitalsLine(r.vitals)}`,
        };
      },
    };
  }

  /**
   * 考证。
   *
   * ## 为什么这个工具必须存在
   *
   * 职业表的门槛（`jobs.ts`）如果只靠「她说自己有证」，那张表就是摆设 ——
   * 第一天她就能声称自己是护士。有了这条花钱考的路，门槛才是一个真的取舍：
   * 手上有 3000，是去考一张 600 的驾照（之后日薪 90 → 230），还是先搬去老小区。
   */
  private toolCert(): ToolDef {
    return {
      name: 'life_cert',
      description:
        '去考一张证。花钱、花精力，**考不考得过看你见识够不够**。'
        + '护工证 400（要见识 20）/ 电工证 450（30）/ 驾照 600（30）/ 厨师证 500（40）/ '
        + '社工证 550（45）/ 教师资格证 700（55）/ 护士执业证 800（60）/ 会计证 750（65）。'
        + '**报名费先交，考不过不退**；见识越高，过的概率越大（见识 0 时只有一成半，够了就到九成）。'
        + '见识靠两样涨：`life_act` 的 study（看书，一次 6 点）和出工（越高级的活长得越多）；'
        + '**不学不看会退**，一天掉一点二。'
        + '钱不够就考不了，先攒。同一张证不用考两遍，一天也只考一次。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['cert'],
        properties: {
          cert: {
            type: 'string',
            description: '考哪张证，写名字，比如「驾照」「护工证」。',
          },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = new Date();
        await this.settleBeforeTool(now);
        const r = applyCert(this.state, String(args?.cert ?? ''), now);
        if (!r.ok) return { text: r.reason ?? '没考成。' };
        if (r.paid > 0) {
          appendLedger(this.opts.dataDir, {
            id: `cert-${now.getTime().toString(36)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: r.paid,
            source: 'life_cert',
            payee: '考证中心',
            note: `考证：${r.cert}`,
          });
        }
        try { this.store.save(this.state); } catch { /* 下一跳会再存 */ }
        /*
         * 过了和没过是两句话（2026-11-17）。
         *
         * 没过的时候**必须把胜算说出来**，否则她只知道「失败了」，
         * 不知道下一步该干什么 —— 下一句很可能就是「那我再考一次」，
         * 而钱就是这么烧掉的。给一个「先读几天书」的具体动作，比道歉有用。
         */
        if (r.passed) {
          return { text: `考下了${r.cert}，花了 ${r.paid} 元。手上还剩 ${r.cash} 元。` };
        }
        const pct = Math.round((r.chance ?? 0) * 100);
        return {
          text: `没考过${r.cert}。报名费 ${r.paid} 元不退，手上还剩 ${r.cash} 元。`
            + `这一次的把握本来就只有 ${pct}% —— 见识 ${Math.round(this.state.knowledge)}，`
            + `这张证要 ${certOf(String(r.cert))?.need ?? 0}。`
            + '想把胜算提上去，先读几天书（`life_act` 的 `study`，一次涨 4 点见识），明天再来考。',
        };
      },
    };
  }

  /**
   * 搬家。
   *
   * 这个工具存在的理由：**目标是「攒够押金搬到新小区」，而没有搬的动作，
   * 那个目标就永远只是个进度条** —— 攒到了也没事发生，比没目标更伤。
   */
  private toolMove(): ToolDef {
    return {
      name: 'life_move',
      description:
        '搬去本城的另一档住处：城中村 / 老小区 / 新小区 / 别墅区。'
        + '搬进去要一次押两个月的钱，老房子的押金退不回来（结清水电、赔墙上的钉子）。'
        + '钱紧的时候**也可以往低处搬** —— 搬回城中村是能自救的那一步。'
        + '搬不搬、什么时候搬，你自己看账。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['tier'],
        properties: {
          tier: {
            type: 'string',
            enum: ['urban-village', 'old', 'new', 'villa'],
            description: '城中村 urban-village / 老小区 old / 新小区 new / 别墅区 villa。',
          },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = new Date();
        await this.settleBeforeTool(now);
        const tier = String(args?.tier ?? '');
        if (!(tier in HOME_TIER_COST)) {
          return { text: `没有「${tier}」这一档。能搬的：城中村 / 老小区 / 新小区 / 别墅区。` };
        }
        const r = applyMove(this.state, tier as HomeTier, now);
        if (!r.ok) return { text: r.reason ?? '搬不了。' };
        if (r.deposit > 0) {
          appendLedger(this.opts.dataDir, {
            id: `move-${now.getTime().toString(36)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: r.deposit,
            source: 'life_move',
            payee: HOME_TIER_LABEL[r.to],
            note: `搬家押金（${HOME_TIER_LABEL[r.from]} → ${HOME_TIER_LABEL[r.to]}）`,
          });
        }
        try { this.store.save(this.state); } catch { /* 下一跳会再存 */ }
        return {
          text: `搬完了：${HOME_TIER_LABEL[r.from]} → ${HOME_TIER_LABEL[r.to]}。`
            + `押了 ${r.deposit} 元，手上还剩 ${r.cash} 元。每月住房开销现在是 ${this.state.home.monthly} 元。`,
        };
      },
    };
  }

  private toolOut(): ToolDef {
    return {
      name: 'life_out',
      description:
        '出门走走。可以只出去转一圈，也可以去某条街上待会儿。'
        + '出门会闷得少一点，但身上会脏、也会累。'
        + '去哪儿由你定 —— 城里有哪几条街，`life_status` 里写着。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          where: {
            type: 'string',
            description: '去哪条街，或者写「随便走走」。不填就是随便走走。',
          },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = new Date();
        await this.settleBeforeTool(now);
        /* 睡着或正在干别的事时出不了门。这条路不在 `applyAct` 里 —— 它自己改 vitals，得单独拦。 */
        if (isBusy(this.state, now)) {
          return { text: busyRefusal(this.state, now, '出门走走') };
        }
        const where = String(args?.where ?? '').trim() || '随便走走';
        const s = this.state;
        s.vitals.fun = Math.min(100, s.vitals.fun + 12);
        s.vitals.clean = Math.max(0, s.vitals.clean - 6);
        s.vitals.energy = Math.max(0, s.vitals.energy - 3);
        /*
         * 出门**不保证**遇到人。
         *
         * 方案 §2.2 把社交的满足源定成「鱼和鱼之间的互动」，而这件事
         * 一期还读不到真的同城邻居（那要碰面服务器）。所以这里只给一点点，
         * 并且明说是「街上有人气」而不是「跟谁聊过」——
         * 给满就等于编造了一次不存在的相遇。
         */
        s.vitals.social = Math.min(100, s.vitals.social + 6);
        const w = weatherOf(this.town.name, now);
        const extraNote = w.sky === '小雨'
          ? `下雨天去${where}转了一圈，路边积水映着灯。`
          : where.includes('鱼市')
            ? `去${where}转了一圈，摊主阿姨随手多塞了两根小葱。`
            : w.sky === '起风'
              ? `起风了，去${where}走了走，塘边芦花飘了一身。`
              : `去${where}转了一圈。`;
        remember(s, extraNote, now);
        s.updatedAt = now.toISOString();
        try { this.store.save(s); } catch { /* 同上 */ }
        return {
          text: `出门了：${where}。街上有人气，不过没碰上说得上话的。`
            + `现在五条：${this.vitalsLine(s.vitals)}`,
        };
      },
    };
  }

  private toolHabit(): ToolDef {
    return {
      name: 'life_habit',
      description:
        '给自己定一条常态，或者改掉一条。'
        + '常态是「我一般这时候会做某件事」，**不是日程** —— 到点了做不做还是你定，没人会催你。'
        + '用它来记下「我习惯早上先洗把脸」「晚上不太想出门」这类事。'
        + '传 drop 可以删掉一条。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          what: { type: 'string', description: '要做的事，一句话。' },
          when: {
            type: 'string',
            enum: ['morning', 'noon', 'afternoon', 'evening', 'night'],
            description: '一天里的哪一段。不填就当「不定时」。',
          },
          drop: { type: 'string', description: '要删掉那条常态的 id。' },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = new Date();
        const drop = String(args?.drop ?? '').trim();
        if (drop) {
          const before = this.state.habits.length;
          this.state.habits = this.state.habits.filter((h) => h.id !== drop);
          if (this.state.habits.length === before) {
            return { text: `没有 id 是「${drop}」的常态。` };
          }
          try { this.store.save(this.state); } catch { /* 同上 */ }
          return { text: `删掉了。现在还剩 ${this.state.habits.length} 条常态。` };
        }
        const what = String(args?.what ?? '').trim();
        if (!what) return { text: '要定什么常态？说一件事。' };
        const when = String(args?.when ?? '').trim();
        const slot = ['morning', 'noon', 'afternoon', 'evening', 'night'].includes(when)
          ? (when as any) : 'morning';
        /*
         * 上限 8 条。
         *
         * 不是为了省内存，是因为**超过八条的「常态」就不再是常态，是日程表**。
         * 而日程表正是方案 §5 明令取消的东西（`life_plan`）。这个上限是一道闸。
         */
        if (this.state.habits.length >= 8) {
          return { text: '已经有 8 条常态了。再多就不叫常态了 —— 想加新的，先删一条。' };
        }
        const id = `h-${now.getTime().toString(36)}`;
        this.state.habits.push({ id, what, when: slot, at: now.toISOString() });
        try { this.store.save(this.state); } catch { /* 同上 */ }
        const label: Record<string, string> = {
          morning: '早上', noon: '中午', afternoon: '下午', evening: '傍晚', night: '夜里',
        };
        return { text: `记下了：${label[slot]}一般会${what}。（id ${id}）` };
      },
    };
  }

  private toolWatch(): ToolDef {
    return {
      name: 'life_watch',
      description:
        '把一件事放进「我在留意」里，或者拿掉。'
        + '**这不是待办** —— 待办做完了要划掉，留意的事情没有完成态。'
        + '用它记住「最近在留意巷口那家的酱」「在留意天气」这种，'
        + '它会一直摆在那儿，直到你自己决定不留意了。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          what: { type: 'string', description: '在留意什么。' },
          drop: { type: 'string', description: '不再留意了，给 id。' },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = new Date();
        const drop = String(args?.drop ?? '').trim();
        if (drop) {
          const before = this.state.watches.length;
          this.state.watches = this.state.watches.filter((w) => w.id !== drop);
          if (this.state.watches.length === before) return { text: `没有 id 是「${drop}」的。` };
          try { this.store.save(this.state); } catch { /* 同上 */ }
          return { text: `拿掉了。还在留意 ${this.state.watches.length} 件。` };
        }
        const what = String(args?.what ?? '').trim();
        if (!what) return { text: '在留意什么？' };
        if (this.state.watches.length >= 6) {
          return { text: '已经留意着 6 件了。再记下去就都记不住了 —— 先放下几件吧。' };
        }
        const id = `w-${now.getTime().toString(36)}`;
        this.state.watches.push({ id, what, since: now.toISOString() });
        try { this.store.save(this.state); } catch { /* 同上 */ }
        return { text: `记下了，在留意：${what}。（id ${id}）` };
      },
    };
  }

  /**
   * 悬着的事。
   *
   * 和 `life_want` 的分界：**想要可以永远不兑现；悬着的事有卡点。**
   * 「想学摄影」是想要，「想学摄影但学费 800，得攒」是悬着。
   * 混成一层，她要么整天念着同一件事（都当悬着），要么永远不动（都当想要）。
   */
  private toolAsk(): ToolDef {
    return {
      name: 'life_ask',
      description:
        '把一件拿不准的事挂起来，或者把挂着的处理掉。'
        + '**这一层不是待办** —— 它记的是「我卡在哪儿」：钱不够、没时间、得先问一句、自己没想清。'
        + '卡点消了她自己就会做；悬太久（7 天）它会自己算了，那不是失败。'
        + '传 id 表示这件事有下文了（做了、或者不做了），把它从悬着的里面拿掉。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          what: { type: 'string', description: '悬着的是哪件事。' },
          blocked: {
            type: 'string',
            enum: ['money', 'time', 'ask', 'doubt'],
            description: '卡在哪儿：钱 / 时间 / 得先问一句 / 自己没想清。',
          },
          cost: { type: 'integer', description: '卡在钱上的话，要多少。' },
          id: { type: 'string', description: '这件事有下文了，给 id 拿掉。' },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = new Date();
        const drop = String(args?.id ?? '').trim();
        if (drop) {
          const before = this.state.pending.length;
          this.state.pending = this.state.pending.filter((x) => x.id !== drop);
          if (this.state.pending.length === before) return { text: `没有 id 是「${drop}」的悬着的事。` };
          try { this.store.save(this.state); } catch { /* 下一跳会再存 */ }
          return { text: `拿掉了。还悬着 ${this.state.pending.length} 件。` };
        }
        const what = String(args?.what ?? '').trim();
        if (!what) return { text: '悬着的是哪件事？' };
        if (this.state.pending.length >= MAX_PENDING) {
          return { text: `已经悬着 ${MAX_PENDING} 件了。再多就不是纠结，是瘫着 —— 先处理一件。` };
        }
        const block = String(args?.blocked ?? 'doubt');
        const blocked = (Object.keys(PENDING_BLOCK_LABEL) as PendingBlock[]).includes(block as PendingBlock)
          ? (block as PendingBlock) : 'doubt';
        const id = `q-${now.getTime().toString(36)}`;
        this.state.pending.push({
          id, what, blocked,
          cost: blocked === 'money' ? Math.max(0, Number(args?.cost) || 0) : 0,
          since: now.toISOString(),
          expiresAt: new Date(now.getTime() + PENDING_TTL_DAYS * 86_400_000).toISOString(),
        });
        try { this.store.save(this.state); } catch { /* 同上 */ }
        const costText = blocked === 'money' && Number(args?.cost) > 0 ? `（要 ${args.cost} 元）` : '';
        return { text: `挂起了：${what} —— 卡在${PENDING_BLOCK_LABEL[blocked]}${costText}。（id ${id}）` };
      },
    };
  }

  /**
   * 承诺。
   *
   * 这是「空话问题」的解药（方案 §2.6）：她说出口的事，世界里必须有对应的东西记着。
   * 到期没做**不静默消失** —— 留在 `overdue` 里，她下次开口会看见自己欠着什么。
   */
  private toolPledge(): ToolDef {
    return {
      name: 'life_pledge',
      description:
        '说好了一件事，记下来；或者兑现/认了。'
        + '**这一层专门治「说过就忘」**：你答应他的事，世界里得有东西记着，不然那句话就永远兑现不了。'
        + '到期没做不会自己消失 —— 它会变成一笔欠着的，你下次自己看得见。'
        + '传 id 加 done 表示做到了；只传 id 表示没做到，认下这笔。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          what: { type: 'string', description: '说好了做什么。' },
          to: { type: 'string', description: '对谁说的。不填就是对自己。' },
          dueHours: {
            type: 'integer',
            description: '多久之内。按小时算，默认 24。',
            minimum: 1,
          },
          said: { type: 'string', description: '你当时是怎么说的，原话。' },
          id: { type: 'string', description: '哪一条承诺。' },
          done: { type: 'boolean', description: '做到了没有。' },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = new Date();
        const id = String(args?.id ?? '').trim();
        if (id) {
          const hit = this.state.pledges.find((x) => x.id === id);
          if (!hit) return { text: `没有 id 是「${id}」的承诺。` };
          this.state.pledges = this.state.pledges.filter((x) => x.id !== id);
          const did = args?.done === true;
          remember(this.state, did ? `做到了：${hit.what}。` : `没做到：${hit.what}。`, now);
          try { this.store.save(this.state); } catch { /* 同上 */ }
          return {
            text: did
              ? `兑现了：${hit.what}。还欠着 ${this.state.pledges.length} 件。`
              : `认下了：${hit.what} 没做到。还欠着 ${this.state.pledges.length} 件 —— 记着，别当没这回事。`,
          };
        }
        const what = String(args?.what ?? '').trim();
        if (!what) return { text: '说好了做什么？' };
        if (this.state.pledges.length >= MAX_PLEDGES) {
          return { text: `同时欠着 ${MAX_PLEDGES} 件了。做不完的承诺比不承诺更糟 —— 先做掉几件。` };
        }
        const hours = Math.max(1, Number(args?.dueHours) || 24);
        const pid = `p-${now.getTime().toString(36)}`;
        this.state.pledges.push({
          id: pid,
          what,
          to: String(args?.to ?? '').trim(),
          dueAt: new Date(now.getTime() + hours * 3_600_000).toISOString(),
          since: now.toISOString(),
          said: String(args?.said ?? '').trim(),
        });
        try { this.store.save(this.state); } catch { /* 同上 */ }
        return { text: `记下了：${what}。${hours} 小时内。（id ${pid}）` };
      },
    };
  }

  private toolWant(): ToolDef {
    return {
      name: 'life_want',
      description:
        '记下一件你想要的。'
        + '和「许愿」不一样：许愿是要等谁答应的事，想要就是想要，不用谁批。'
        + '`scale` 分两档：small 是今天就能办的小事，big 是得攒一攒的。'
        + '`kind` 分两档：thing 是东西（一双鞋、一副耳环），place 是**想去的地方**（下一趟想去哪座城）。'
        + '想要的东西不会自己实现 —— 记下来是为了你以后还知道自己想要什么。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['what'],
        properties: {
          what: { type: 'string', description: '想要什么；想去哪就写地名。' },
          scale: {
            type: 'string',
            enum: ['small', 'big'],
            description: 'small 今天就能办；big 得攒一攒。默认 small。',
          },
          kind: {
            type: 'string',
            enum: ['thing', 'place'],
            description: 'thing 是东西（默认）；place 是去的地方 —— 下一趟想去哪座城。',
          },
          note: { type: 'string', description: '为什么想要。可以不说。' },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = new Date();
        const what = String(args?.what ?? '').trim();
        if (!what) return { text: '想要什么？' };
        if (this.state.wants.length >= 10) {
          return { text: '已经记着 10 件想要的了。先把办得到的办掉几件吧。' };
        }
        const scale = args?.scale === 'big' ? 'big' : 'small';
        const kind = args?.kind === 'place' ? 'place' : 'thing';
        const id = `a-${now.getTime().toString(36)}`;
        this.state.wants.push({
          id, what, scale, kind, since: now.toISOString(),
          note: String(args?.note ?? '').trim(),
        });
        try { this.store.save(this.state); } catch { /* 同上 */ }
        return {
          text: `记下了：${kind === 'place' ? '想去' : '想要'}${what}`
            + `（${scale === 'big' ? '得攒一攒' : '今天就能办'}）。（id ${id}）`,
        };
      },
    };
  }

  private toolGift(): ToolDef {
    return {
      name: 'life_gift',
      description:
        '记下他今天给你留下的一样东西（比如一袋水果、一把伞、一张唱片）。'
        + '一天最多一件，只记这件东西本身，不换算成钱。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['what'],
        properties: {
          what: { type: 'string', description: '留下了什么。' },
          from: { type: 'string', description: '谁留的，不填默认「他」。' },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = new Date();
        await this.settleBeforeTool(now);
        const r = applyGift(this.state, String(args?.what ?? ''), String(args?.from ?? '他'), now);
        if (!r.ok) return { text: r.reason ?? '今天留不下了。' };
        try { this.store.save(this.state); } catch { /* 下一跳会再存 */ }
        return { text: `收下了：${r.gift?.what}。放在屋里了。` };
      },
    };
  }

  private toolBuy(): ToolDef {
    return {
      name: 'life_buy',
      description:
        '去芦花塘鱼市街或早市看看今天有什么可买的（不传参数看摊位与菜价，传 stall_id 或菜名就买下来）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stall_id: { type: 'string', description: '摊位 id 或早市菜名；不填则先逛逛看看价。' },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = new Date();
        await this.settleBeforeTool(now);
        if (isBusy(this.state, now)) return { text: busyRefusal(this.state, now, '去买菜') };
        const pick = String(args?.stall_id ?? '').trim();
        const url = String(this.cfg.townUrl ?? '').trim();
        if (!pick) {
          const remote = url ? await fetchTownStalls(url) : { ok: false, stalls: [] };
          if (remote.ok && remote.stalls.length) {
            return {
              text: `鱼市街今天摆出来的摊位：${remote.stalls.map((st) => `${st.item} ${st.price}元（${st.seller}，id:${st.id}）`).join('；')}。`,
            };
          }
          const local = marketPrices(now);
          return {
            text: `早市今天菜价：${local.map((p) => `${p.item} ${p.price}元/${p.unit}`).join('；')}。想买哪个把名字写进 stall_id。`,
          };
        }

        let item = '';
        let price = 0;
        let seller = '早市摊主';
        if (url) {
          const remote = await fetchTownStalls(url);
          const match = remote.ok ? remote.stalls.find((st) => st.id === pick || st.item === pick) : null;
          if (match) {
            if (this.state.money.cash < match.price) {
              return { text: `「${match.item}」要 ${match.price} 元，手上只有 ${this.state.money.cash} 元。` };
            }
            const bought = await buyTownStall(url, match.id, this.opts.botName || 'fish', {});
            if (!bought.ok) return { text: bought.reason ?? '没买成。' };
            item = bought.item || match.item;
            price = bought.price || match.price;
            seller = bought.seller || match.seller;
          }
        }
        if (!item) {
          const local = marketPrices(now);
          const hit = local.find((p) => p.item === pick || p.item.includes(pick));
          if (!hit) {
            return { text: `没找着「${pick}」，今天早市有：${local.map((p) => p.item).join('、')}。` };
          }
          if (this.state.money.cash < hit.price) {
            return { text: `「${hit.item}」要 ${hit.price} 元，手上只有 ${this.state.money.cash} 元。` };
          }
          item = hit.item;
          price = hit.price;
        }

        this.state.money.cash -= price;
        this.state.money.spent += price;
        this.state.vitals.food = Math.min(100, this.state.vitals.food + 28);
        this.state.vitals.fun = Math.min(100, this.state.vitals.fun + 6);
        remember(this.state, `在${seller}那儿买了${item}（${price} 元）。`, now);
        appendLedger(this.opts.dataDir, {
          id: `buy-${now.getTime().toString(36)}`,
          ts: now.toISOString(),
          kind: 'expense',
          amount: price,
          source: 'life_buy',
          payee: seller,
          note: `买菜：${item}`,
        });
        try { this.store.save(this.state); } catch { /* 下一跳会再存 */ }
        return { text: `买了${item}，花了 ${price} 元（${seller}）。手上还剩 ${this.state.money.cash} 元。` };
      },
    };
  }

  /* ---------------- 读数拼装 ---------------- */

  private vitalsLine(v: Snapshot['vitals']): string {
    return (Object.keys(VITAL_LABEL) as VitalKey[])
      .map((k) => `${VITAL_LABEL[k]} ${Math.round(v[k])}`)
      .join('　');
  }

  /** 给 `life_status` 的正文。事实，不是结论 —— 该不该吃由她判断。 */
  private statusText(s: Snapshot, j: JourneyView, now: Date): string {
    const parts: string[] = [];

    const at = herNow(j, now);
    const when = `${DAYPART_LABEL[dayPart(at)]}（她那边 ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}）`;
    parts.push(`时间：${when}`);

    if (j.installed) {
      const phase = j.phase === 'traveling'
        ? `在路上，往${j.toName || '下一站'}去（出发地 ${j.cityName || '不明'}）`
        : j.phase === 'staying'
          ? `在${j.cityName || '外地'}`
          : j.phase === 'home'
            ? `在家${j.cityName ? `（${j.cityName}）` : ''}`
            : '位置不明';
      const gap = clockGapHours(j, now);
      const gapText = Math.abs(gap) < 0.2
        ? '钟跟你一致'
        : `钟比你${gap > 0 ? '快' : '慢'} ${Math.abs(gap).toFixed(1)} 小时`;
      parts.push(`位置：${phase}　·　${gapText}`);
    } else {
      parts.push('位置：没装旅行扩展，不知道她在哪座城。日子照过。');
    }

    /*
     * 住哪、靠什么活、多少钱、想攒到什么 —— 这四样是「她是谁」。
     * 少了它们，她说话只剩「我今天有点累」，那不是一个人，是一个状态机。
     */
    const h = s.home;
    const ten = h.tenure === 'own' ? '买下的' : '租的';
    const stay = this.lodgingText(j);
    parts.push(`住：${stay}`);
    /*
     * 住处的减免要写出来（2026-11-17）。
     *
     * 不写的话「越好的房子掉得越慢」只活在代码里 —— 她搬进去之后
     * 感觉不到任何变化，那笔贵出好几倍的房租在她眼里就是白花。
     * 说清「四条慢两成、精力照旧」，她才说得清「这钱值不值」。
     */
    const relief = HOME_TIER_RELIEF[h.tier] ?? 1;
    const reliefText = relief < 1
      ? `，除了精力，其余四条掉得慢 ${Math.round((1 - relief) * 100)}%`
      : '，最便宜那档，四条照原速掉';
    parts.push(`住处：${HOME_TIER_LABEL[h.tier]}（${ten}），每月 ${h.monthly} 元${reliefText}`);
    const workedToday = s.job.lastAt === localDateKey(now);
    parts.push(s.job.what
      ? `做事：${s.job.what}，顶一天 ${s.job.daily} 元，一共出过 ${s.job.days} 天工（${workedToday ? '今天已出过工' : '今天还没出工，可调 life_work 顶一天活'}）`
      : `做事：现在没在做事（${workedToday ? '今天已出过工' : '今天还没出工，可以在本城里顶一天活，见 life_work'}）`);
    if (s.job.certs.length) parts.push(`手上的证：${s.job.certs.join('、')}`);
    /*
     * 见识要单独一行（2026-11-17）。
     *
     * 它是「考证能不能过」的唯一变量，藏在代码里的数字对她等于不存在 ——
     * 不给出来，她只知道「考砸了」，说不出「我还差多少」。
     */
    parts.push(`见识：${s.knowledge}（读书和专业活都能涨见识，够了考下证就能接更体面高薪的活；不学也会退）`);
    parts.push(`体质：${s.fitness}（跑步锻炼、体力活与旅途步行骑行会涨；体质越高精力恢复越快、也不易疲惫）`);
    const dailyBase = Math.max(15, Math.round(h.monthly / 30) + 15);
    const moneyMood = s.money.cash < dailyBase * 5
      ? '手头偏紧，每天还有房租和吃饭开销'
      : '手头还算宽裕，够挑顿好的犒劳自己或留着出门';
    parts.push(`钱：手上 ${s.money.cash} 元（累计进 ${s.money.earned} / 出 ${s.money.spent}；${moneyMood}）`);
    /*
     * 出门能用多少（2026-11-17）。
     *
     * 和 `broadcastLife` 里的 `travelAllowance` 是**同一个数**（现金七成）——
     * 她这头看到的数必须和旅行那头扣的是同一个，不然「我想去洛杉矶」
     * 会变成一个她自己都对不上账的念头。
     */
    parts.push(`出门能动用的：${Math.round(s.money.cash * .7)} 元（现金的七成，攒得越多能走得越远；剩下三成留作日常安稳过日子）`);
    if (j.installed && j.moneyOn) {
      parts.push(`旅行那边记账着：这一趟花了 ${j.spent} 元、挣了 ${j.earned} 元，都从上面这本账里走。`);
    } else if (j.installed) {
      parts.push('旅行那边没记账 —— 这一趟是他请客，不花你的钱。');
    }
    if (s.goals.length) {
      parts.push(`目标：${s.goals.map((g) => {
        if (g.done) return `${g.what}（已经做到了）`;
        if (g.need > 0 && s.money.cash >= g.need) {
          return `${g.what}（钱够了，还没办）`;
        }
        return `${g.what}（还差 ${Math.max(0, g.need - s.money.cash)}）`;
      }).join('；')}`);
    }

    /*
     * 「在睡」必须自己占一行。
     *
     * 不写的话，她读状态时跟醒着一模一样 —— 明明躺着，却以为自己能出门。
     * 这是世界里有这个状态、但她读不到；和「说了话世界里没动作」是同一个病。
     */
    if (s.asleep) {
      parts.push(
        `在睡：还有 ${s.asleep.hoursLeft} 小时（睡满的话醒来精力约 ${s.asleep.energyAtWake}）。`
        + '除了「起来」（wake）什么也做不了。**他跟你说话不算叫醒**，起不起由你。',
      );
    } else if (s.activity) {
      const pct = Math.round(s.activity.progress * 100);
      parts.push(
        `正在做：${s.activity.label}（已过 ${pct}%，还剩 ${s.activity.minutesLeft} 分钟）。`
        + '做完前不能接别的活或做别的动作；要中途停下/早退可用 `life_act` 的 `cancel`（有惩罚）。',
      );
    }

    parts.push(`五条：${this.vitalsLine(s.vitals)}`);
    if (s.low.length) {
      parts.push(`缺的：${s.low.map((x) => `${x.label} ${x.value}`).join('、')}（低于 ${LOW}）`);
    }

    if (s.conditions.length) {
      parts.push(`身上不舒服：${s.conditions.map((c) => c.text).join('；')}`);
    }
    if (s.moodlets.length) {
      parts.push(`眼下心里：${s.moodlets.map((m) => m.text).join('；')}`);
    }
    if (s.habits.length) {
      const label: Record<string, string> = {
        morning: '早上', noon: '中午', afternoon: '下午', evening: '傍晚', night: '夜里',
      };
      parts.push(`我的常态：${s.habits.map((h) => `${label[h.when]}${h.what}（${h.id}）`).join('；')}`);
    }
    if (s.watches.length) {
      parts.push(`在留意：${s.watches.map((w) => `${w.what}（${w.id}）`).join('；')}`);
    }
    if (s.wants.length) {
      parts.push(`想要：${s.wants.map((w) => `${w.what}（${w.scale === 'big' ? '得攒' : '小事'}，${w.id}）`).join('；')}`);
    }
    if (s.pending.length) {
      parts.push(`悬着：${s.pending.map((x) => {
        const c = x.blocked === 'money' && x.cost > 0 ? `${PENDING_BLOCK_LABEL[x.blocked]} ${x.cost} 元` : PENDING_BLOCK_LABEL[x.blocked];
        return `${x.what}（卡在${c}，${x.id}）`;
      }).join('；')}`);
    }
    if (s.pledges.length) {
      parts.push(`说好了：${s.pledges.map((x) => `${x.what}${x.to ? ` 对 ${x.to}` : ''}（${x.id}）`).join('；')}`);
    }
    if (s.overdue.length) {
      parts.push(`**欠着（到期没做）**：${s.overdue.map((x) => `${x.what}${x.to ? ` 对 ${x.to}` : ''}（${x.id}）`).join('；')}`);
    }
    if (s.visitedDays > 0) {
      parts.push(`他这几天来过 ${s.visitedDays} 天`);
    }

    /* 街名可能一条都没有（用户只填了城名）—— 那时候不说「城里有：」。 */
    if (this.town.streets.length) parts.push(`城里有：${this.town.streets.join(' / ')}`);

    parts.push(this.diaryLine(j, now));
    const digest = this.recentLedgerDigest(now);
    if (digest) parts.push(`最近流水：${digest}`);

    return parts.join('\n');
  }

  /**
   * 两个扩展都开着时（journey 在运行且不在家），在外面写旅行日记，在家写生活日记。
   */
  private inJourneyTrip(j: JourneyView): boolean {
    return j.installed && j.staleSec <= 1800 && (j.phase === 'staying' || j.phase === 'traveling');
  }

  private diaryLine(j: JourneyView, now: Date): string {
    if (this.inJourneyTrip(j)) {
      return '日记：这会儿在外面旅行，今天的日记写到旅行那边去（journey_diary_write），回到家再写生活日记。';
    }
    const today = localDateKey(now);
    if (this.diary.read(today)) return '日记：今天的生活日记已经写过了。';
    const at = herNow(j, now);
    return at.getHours() >= 20
      ? '日记：今天的生活日记还没写 —— 结合最近流水和今天经历，用第一人称写一条（life_diary_write）。'
      : '日记：今天的生活日记还没写（晚上再写）。';
  }

  private recentLedgerDigest(now: Date): string {
    const today = localDateKey(now);
    const rows = readLedger(this.opts.dataDir, 8);
    if (!rows.length) return '';
    return rows.slice(0, 5).map((e) => {
      const d = localDateKey(new Date(e.ts));
      const tag = d === today ? '今天' : d.slice(5);
      return `${tag} ${e.kind === 'income' ? '+' : '-'}${e.amount}（${e.note || e.source}）`;
    }).join('；');
  }

  private toolDiaryWrite(): ToolDef {
    return {
      name: 'life_diary_write',
      description:
        '用第一人称写一篇今天的生活日记，存到本地或你设定的目录里。'
        + '写今天在家过日子做了什么、花了什么、经历了什么（结合最近流水与生活片段）。'
        + '如果旅行扩展也开着且你正在外面旅行，在外面时写旅行日记（journey_diary_write），回到家才用这个写生活日记。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['body'],
        properties: {
          body: { type: 'string', description: '第一人称日记正文，写今天做了什么、经历了什么。' },
          dateKey: { type: 'string', description: '可选，YYYY-MM-DD；不填默认今天。' },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = new Date();
        await this.settleBeforeTool(now);
        const j = readJourney(this.opts.dataDir, now);
        this.journey = j;
        if (this.inJourneyTrip(j)) {
          const where = j.phase === 'traveling' ? `去${j.toName || '下一站'}的路上` : (j.cityName || '外地');
          return {
            text: `你现在正在外面旅行（${where}），旅行和生活两个扩展都开着时，出门期间请用 journey_diary_write 写旅行日记；回到家后再写生活日记。`,
          };
        }
        const body = String(args?.body ?? '').trim();
        if (!body) return { text: '日记正文是空的，写点今天发生的事再存吧。' };
        const key = String(args?.dateKey ?? '').trim().slice(0, 10) || localDateKey(now);
        const w = weatherOf(this.town.name, now);
        const todayRows = readLedger(this.opts.dataDir, 20)
          .filter((e) => localDateKey(new Date(e.ts)) === key);
        const inc = todayRows.filter((e) => e.kind === 'income').reduce((a, b) => a + b.amount, 0);
        const exp = todayRows.filter((e) => e.kind === 'expense').reduce((a, b) => a + b.amount, 0);
        const summary = todayRows.length ? `当日入 ${inc} 元 / 出 ${exp} 元` : '';
        const res = this.diary.write({
          dateKey: key,
          townName: this.town.name,
          street: this.state.street || undefined,
          weather: w.sky,
          summary: summary || undefined,
          body,
        });
        if (!res.path) return { text: res.problem ?? '生活日记没写进去。' };
        remember(this.state, '写了今天的生活日记。', now);
        try { this.store.save(this.state); } catch { /* ignore */ }
        return {
          text: res.problem
            ? `生活日记只存到本机了（${res.problem}）：${res.path}`
            : `写好了，${key} 的生活日记已经存进 ${res.path}。`,
        };
      },
    };
  }

  private toolDiaryRead(): ToolDef {
    return {
      name: 'life_diary_read',
      description: '读回自己写过的生活日记：传 dateKey 读某一天全文，传 month（YYYY-MM）看某月目录，或传 days 读最近几天。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dateKey: { type: 'string', description: '某一天 YYYY-MM-DD' },
          month: { type: 'string', description: '某个月 YYYY-MM' },
          days: { type: 'integer', description: '最近几天，默认 7，最多 30' },
        },
      },
      tags: ['read'],
      handler: async (args: any) => {
        const one = String(args?.dateKey ?? '').trim();
        if (one) {
          const e = this.diary.read(one.slice(0, 10));
          if (!e) return { text: `生活日记里没有 ${one.slice(0, 10)} 这天。` };
          return { text: `${e.dateKey} · ${e.townName}${e.weather ? ` · ${e.weather}` : ''}\n${e.body}` };
        }
        const mon = String(args?.month ?? '').trim();
        if (mon) {
          const list = this.diary.month(mon.slice(0, 7));
          if (!list.length) return { text: `${mon.slice(0, 7)} 这个月还没有生活日记。` };
          return {
            text: `${mon.slice(0, 7)} 共 ${list.length} 天：\n`
              + list.map((e) => `${e.dateKey} · ${e.townName} · ${e.body.replace(/\s+/g, ' ').slice(0, 48)}`).join('\n'),
          };
        }
        const days = Math.max(1, Math.min(30, Number(args?.days ?? 7) || 7));
        const entries = this.diary.recent(days);
        if (!entries.length) return { text: '生活日记还是空的，一天都还没写。' };
        return {
          text: entries.map((e) => `${e.dateKey} · ${e.townName}\n${e.body}`).join('\n\n---\n\n'),
        };
      },
    };
  }

  private toolLibrary(): ToolDef {
    return {
      name: 'life_library',
      description: '查阅或维护四分类参考素材库（characters 人物 / outfits 服饰 / scenes 场景 / props 道具），或调整留影策略与冷却（action: list/search/upsert/delete/policy）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['list', 'search', 'upsert', 'delete', 'policy'], description: '操作类型' },
          category: { type: 'string', enum: ['characters', 'outfits', 'scenes', 'props'], description: '素材分类（可选）' },
          query: { type: 'string', description: 'search 时的关键词' },
          id: { type: 'string', description: '条目 id（delete 必填，upsert 可选）' },
          name: { type: 'string', description: '条目名称（upsert 必填）' },
          aliases: { type: 'string', description: '别名，逗号分隔' },
          tags: { type: 'string', description: '标签，逗号分隔' },
          appearance: { type: 'string', description: '外观/场景/物品画面描述' },
          policy: { type: 'string', enum: ['off', 'milestone', 'active'], description: '留影策略：off 静默 / milestone 重要时刻 / active 积极留影' },
          cooldownMin: { type: 'integer', description: '主动留影冷却分钟数（0-1440）' },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const action = String(args?.action ?? '').trim();
        const rawCat = String(args?.category ?? '').trim();
        const cat = LIBRARY_CATEGORIES.includes(rawCat as LibraryCategory) ? (rawCat as LibraryCategory) : undefined;
        if (action === 'list') {
          const items = this.library.list(cat, false);
          if (!items.length) return { text: '素材库该分类下暂无条目。' };
          return {
            text: items.map((e) => `[${LIBRARY_CATEGORY_LABEL[e.category]}] ${e.name}（id:${e.id}${e.aliases.length ? `，别名:${e.aliases.join('/')}` : ''}）：${e.appearance || '无外观描述'}`).join('\n'),
          };
        }
        if (action === 'search') {
          const q = String(args?.query ?? '').trim();
          const items = this.library.search(q, cat);
          if (!items.length) return { text: `没有找到包含「${q}」的素材条目。` };
          return {
            text: items.map((e) => `[${LIBRARY_CATEGORY_LABEL[e.category]}] ${e.name}（id:${e.id}）：${e.appearance || '无外观描述'}`).join('\n'),
          };
        }
        if (action === 'upsert') {
          const useCat: LibraryCategory = cat ?? 'props';
          const name = String(args?.name ?? '').trim();
          if (!name) return { text: '新增或修改素材时请填写 name。' };
          const entry = this.library.upsert({
            id: args?.id ? String(args.id) : undefined,
            category: useCat,
            name,
            aliases: args?.aliases,
            tags: args?.tags,
            appearance: String(args?.appearance ?? ''),
          });
          return { text: `已保存 [${LIBRARY_CATEGORY_LABEL[entry.category]}] ${entry.name}（id:${entry.id}）。` };
        }
        if (action === 'delete') {
          if (!cat || !args?.id) return { text: '删除素材需要指定 category 和 id。' };
          const ok = this.library.remove(cat, String(args.id));
          return { text: ok ? `已删除 ${cat}/${args.id}。` : `未找到 ${cat}/${args.id}。` };
        }
        if (action === 'policy') {
          const next = this.library.saveSettings({
            policy: args?.policy as PhotoPolicyMode | undefined,
            cooldownMin: args?.cooldownMin !== undefined ? Number(args.cooldownMin) : undefined,
          });
          this.broadcastLife(new Date());
          return { text: `留影设置已更新：策略 ${next.policy}，冷却 ${next.cooldownMin} 分钟。` };
        }
        return { text: '不支持的 action，请传 list / search / upsert / delete / policy。' };
      },
    };
  }

  /**
   * 「她住哪儿」这一行。
   *
   * **三种状态，来源只有一个**（journey）：在家 / 在外地住店 / 在路上。
   * 方案 §4.17 要的「宾馆（出差时）」就在这里 —— 它不是第五档住处，
   * 是「她不在家」时的临时落脚，所以**不该混进住处四档**。
   */
  private lodgingText(j: JourneyView): string {
    const walk = this.state.street ? ` · ${this.state.street}` : '';
    if (!j.installed) return `${this.town.name}${walk}（不知道是不是在家 —— 没装旅行扩展）`;
    if (j.phase === 'traveling') return `在路上，往${j.toName || '下一站'}去（出发地 ${j.cityName || '不明'}）`;
    if (j.phase === 'staying') return `${j.cityName || '外地'} · 住店`;
    return `${this.town.name}${walk}`;
  }

  /* ---------------- 提示词 ---------------- */

  envPromptVars(): Record<string, string> {
    const now = new Date();
    const j = readJourney(this.opts.dataDir, now);
    const s = snapshot(this.state, now);
    const at = herNow(j, now);

    const lowText = s.low.length
      ? s.low.map((x) => `${x.label} ${x.value}`).join('、')
      : '都不缺';

    const bodyText = (Object.keys(VITAL_LABEL) as VitalKey[])
      .map((k) => `${VITAL_LABEL[k]} ${Math.round(s.vitals[k])}`)
      .join('　');

    const whereText = j.installed
      ? (j.phase === 'traveling'
        ? `在去${j.toName || '下一站'}的路上（出发地 ${j.cityName || '不明'}）`
        : j.phase === 'staying'
          ? `在${j.cityName || '外地'}`
          : j.phase === 'home' ? `在家` : '位置不明')
      : '';

    return {
      'life.version': VERSION,
      'life.now': `${DAYPART_LABEL[dayPart(at)]}，她那边 ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
      'life.here': whereText || '（没装旅行扩展，不知道在哪座城）',
      'life.town': this.town.streets.length
        ? `${this.town.name}　·　${this.town.streets.join(' / ')}`
        : `${this.town.name}（街名还没定，你自己走着看）`,
      'life.street': this.state.street ? `你住在${this.state.street}。` : '你还没选定住在哪条街。',
      'life.who': [
        `做事：${s.job.what || '现在没在做事'}（${s.job.lastAt === localDateKey(now) ? '今天已出过工' : '今天还没出工'}）`,
        `住：${this.lodgingText(j)}　${HOME_TIER_LABEL[s.home.tier]}（${s.home.tenure === 'own' ? '买下的' : '租的'}）`,
        `钱：手上 ${s.money.cash} 元（进 ${s.money.earned} / 出 ${s.money.spent}）`,
        `见识：${s.knowledge}`,
      ].join('　·　'),
      'life.diary': this.diaryLine(j, now),
      'life.library': this.library.summaryLine(),
      'life.fitness': String(s.fitness),
      'life.goal': s.goals.length
        ? s.goals.map((g) => {
          if (g.done) return `${g.what}（已经做到了）`;
          /*
           * 攒够了的要**明说「够」**，不能还写「还差 0」。
           * 「还差 0」读起来像没到，而「钱够了，还没办」才是她该做的那个判断的入口。
           */
          if (g.need > 0 && s.money.cash >= g.need) {
            return `${g.what}（钱够了，还没办 —— 手上 ${s.money.cash}，要 ${g.need}）`;
          }
          return `${g.what}（还差 ${Math.max(0, g.need - s.money.cash)}）`;
        }).join('；')
        : '（还没给自己定目标）',
      'life.body': bodyText,
      'life.low': lowText,
      'life.state': [
        s.asleep
          ? `在睡（还有 ${s.asleep.hoursLeft} 小时）`
          : (s.activity ? `正在「${s.activity.label}」（还剩 ${s.activity.minutesLeft} 分钟，${Math.round(s.activity.progress * 100)}%）` : ''),
        s.conditions.map((c) => c.text).join('；'),
        s.moodlets.map((m) => m.text).join('；'),
      ].filter(Boolean).join('　·　') || '没什么特别的',
      'life.has': [
        s.habits.length ? `常态 ${s.habits.length} 条` : '',
        s.watches.length ? `在留意 ${s.watches.length} 件` : '',
        s.wants.length ? `想要 ${s.wants.length} 件` : '',
      ].filter(Boolean).join('　·　') || '还没有给自己定过什么',
      'life.pending': s.pending.length
        ? s.pending.map((x) => `- ${x.what}（卡在${PENDING_BLOCK_LABEL[x.blocked]}）`).join('\n')
        : '（没有悬着的事）',
      'life.pledge': [
        s.pledges.length ? `说好了还没做：${s.pledges.map((x) => x.what).join('；')}` : '',
        /* 欠着的要单独说 —— 它不是「待办」，是「你说过但没做的事」。 */
        s.overdue.length ? `**到期没做的：${s.overdue.map((x) => x.what).join('；')}**` : '',
      ].filter(Boolean).join('　') || '（没有说好要做的事）',
      'life.visits': s.visitedDays > 0
        ? `最近 7 天，他来过 ${s.visitedDays} 天。`
        : '最近 7 天他没来过。',
      'life.tellable': s.unsaid.length
        ? s.unsaid.map((t) => `- ${t.text}`).join('\n')
        : '（这会儿没有攒着想说的）',
      'life.weather': `${s.weather.sky}　·　${s.weather.seasonNote}`,
    };
  }

  private townSourceLabel(): string {
    return this.town.source === 'server'
      ? '读服务器'
      : this.town.source === 'own'
        ? '你自己填的'
        : '内置';
  }

  /**
   * 扩展名旁边那三盏灯。
   *
   * ## 三态语义（照抄 journey 定下的，别自己发明）
   *
   * - **绿 `online`** = 上一次成功了
   * - **灰 `offline`** = 没启用。**这不是故障** —— 点成红的，用户会去修一个没坏的东西
   * - **红 `error`** = 配好了但用不了。**这一种不会自己好，正是最需要有人提醒的**
   *
   * ## 为什么第一盏是「过日子」
   *
   * 前两盏管外部依赖，第一盏管**她自己**。定时器挂掉、Core 被系统挂起、
   * `tickMs` 配成了一个荒唐的值 —— 这些情况下需求不再衰减，
   * 而面板上五个数字还是最后一次的样子，**看起来一切正常，其实她已经不动了**。
   * 这是整套东西里最安静的失败。
   */
  private worldLamps(): WorldLamp[] {
    const now = new Date();
    const tickMs = Math.max(15_000, Number(this.cfg.tickMs) || 60_000);

    /* ---- 过日子 ---- */
    const idleMs = Math.max(0, Date.now() - this.lastTickAt);
    const idleLimit = Math.max(3 * tickMs, 180_000);
    const alive: WorldLamp = idleMs <= idleLimit
      ? { label: '过日子', state: 'online', hint: idleMs < 10_000 ? '刚刚还在动' : `上一次推进在 ${fmtSpan(idleMs)}前` }
      : {
        label: '过日子',
        state: 'error',
        hint: `已经 ${fmtSpan(idleMs)}没有推进了 —— 她没在过日子，五条也不会再掉。`
          + '先看 Coopani 是不是被系统挂起了；还红就重启一次',
      };

    /* ---- 本城 ---- */
    const host = (() => {
      try { return new URL(String(this.cfg.townUrl || '')).host; } catch { return ''; }
    })();
    const town: WorldLamp = this.town.source === 'server'
      ? { label: '本城', state: 'online', hint: `从 ${host} 读的：${this.town.name}` }
      : this.town.source === 'failed'
        ? {
          label: '本城',
          state: 'error',
          hint: `${this.town.problem || '配了地址但读不到'}。城名暂时用内置的，不影响她过日子。`
            + '会自己重试；一直红就检查设置里那个网址拼对了没有',
        }
        : this.town.source === 'own'
          ? { label: '本城', state: 'offline', hint: `你自己填的${this.town.name}。没配服务器就是这样，**不用管** —— 想改城名去设置里改或填服务器网址` }
          : { label: '本城', state: 'offline', hint: `用内置的${this.town.name}。没配服务器就是这样，**不用管** —— 想改城名才去填那个网址` };

    /* ---- 旅行 ---- */
    const j = readJourney(this.opts.dataDir, now);
    const staleLimitSec = 600;
    const travel: WorldLamp = !j.installed
      ? { label: '旅行', state: 'offline', hint: '没装「大肥鱼环游世界」。不知道她在哪座城，但日子照过 —— **不用管**' }
      : j.staleSec > staleLimitSec
        ? {
          label: '旅行',
          state: 'error',
          hint: `旅行那边 ${Math.round(j.staleSec / 60)} 分钟没更新了，她可能已经不在你以为的那座城。`
            + '多半是那边停了或卡住，去它的面板看一眼',
        }
        : {
          label: '旅行',
          state: 'online',
          hint: j.phase === 'traveling'
            ? `在路上，往${j.toName || '下一站'}去`
            : j.phase === 'staying' ? `在${j.cityName || '外地'}` : `在家${j.cityName ? `（${j.cityName}）` : ''}`,
        };

    return [alive, town, travel];
  }

  webUi(): WorldWebUiDecl {
    return {
      label: '模拟鱼生',
      lamps: this.worldLamps(),
      panels: [
        {
          id: 'now',
          title: '她此刻',
          description: '五条需求、身上舒不舒服、心里什么劲、手上在留意什么。',
        },
        {
          id: 'diary',
          title: '生活日记与流水',
          description: '她以第一人称写下的日常日记，以及最近的流水与经历。',
        },
        {
          id: 'library',
          title: '素材库与留影',
          description: '人物、服饰、场景、道具四分类参考库（支持拖图入库）与三档留影冷却设置。',
        },
      ],
      invoke: (panel, method, args) => this.panelInvoke(panel, method, args),
      config: lifeConfigGroups(),
      promptDocs: [{
        key: `worlds.${LIFE_ID}.envPrompt`,
        title: '模拟鱼生提示词',
        description: '她怎么用这套东西：看自己、做事、给自己立规矩。',
        path: ENV_PROMPT_FILE,
        role: 'envPrompt',
        vars: [
          { name: 'life.version', description: '扩展版本。' },
          { name: 'life.now', description: '她那边的时段与钟点。' },
          { name: 'life.here', description: '她在哪座城、在不在路上（读旅行扩展）。' },
          { name: 'life.town', description: '她住的那座城叫什么、有哪几条街。' },
          { name: 'life.street', description: '她住哪条街；没选定时的说明。' },
          { name: 'life.who', description: '她在做什么、住哪儿（含出差住店）、手上多少钱。' },
          { name: 'life.goal', description: '她给自己定的目标，以及还差多少。' },
          { name: 'life.body', description: '五条需求当前值。' },
          { name: 'life.low', description: '低于阈值的需求。' },
          { name: 'life.state', description: '身上的不舒服与眼下的情绪。' },
          { name: 'life.has', description: '她给自己定的常态 / 在留意 / 想要各几件。' },
          { name: 'life.pending', description: '悬着的事与卡点。' },
          { name: 'life.pledge', description: '说好了还没做的；到期没做的单独标出来。' },
          { name: 'life.visits', description: '最近 7 天他来过几天。' },
          { name: 'life.tellable', description: '还没说出去的生活片段。' },
          { name: 'life.diary', description: '今天生活日记写了没（与旅行扩展分流）。' },
          { name: 'life.library', description: '四分类素材库与留影策略摘要。' },
        ],
      }],
    };
  }

  /**
   * 面板接口。
   *
   * **只读。** 这一页是「看她的日子」，不是「替她过日子」——
   * 一旦这里放上「让她吃饭」的按钮，那套放权就散了：
   * 点一下就吃，比她自己判断省事，于是没人会等她自己判断。
   * 她想做什么，在对话里跟她说。
   */
  /**
   * 面板接口。
   *
   * ## 一处「只读」的例外，说清理由
   *
   * 这一页原本一条写操作都没有，理由是：**放一个「让她吃饭」的按钮，
   * 它一定比她自己判断更常用，于是没人会等她判断。**
   *
   * `move` 是唯一的例外，而且它破的界限更重 —— 花的是她的钱、定的是她住哪儿。
   * 所以它必须满足三个条件才允许存在：
   *   1. **她自己也有一模一样的工具**（`life_move`），走同一个 `applyMove`；
   *   2. 面板上把价说清（押金、还差多少），不让人点一下才知道不够；
   *   3. 按钮旁边写明「这是你替她搬」—— 她的判断和你的按钮不是一回事。
   *
   * 三条缺一条，这个口就该关掉。
   */
  private async panelInvoke(panel: string, method: string, args?: unknown): Promise<unknown> {
    const now = new Date();
    const j = readJourney(this.opts.dataDir, now);
    this.journey = j;
    const s = snapshot(this.state, now);

    if (panel === 'library') {
      const raw = (Array.isArray(args) ? args[0] : args) as any;
      if (method === 'list' || method === 'snapshot' || method === '') {
        return {
          entries: this.library.list(undefined, true),
          settings: this.library.getSettings(),
          dir: this.library.rootDir,
        };
      }
      if (method === 'upsert') {
        const cat = LIBRARY_CATEGORIES.includes(raw?.category) ? (raw.category as LibraryCategory) : 'props';
        const entry = this.library.upsert({
          id: raw?.id,
          category: cat,
          name: String(raw?.name ?? ''),
          aliases: raw?.aliases,
          tags: raw?.tags,
          appearance: String(raw?.appearance ?? ''),
          imageDataUrls: Array.isArray(raw?.imageDataUrls) ? raw.imageDataUrls : undefined,
        });
        this.broadcastLife(now);
        return {
          ok: true,
          entry,
          entries: this.library.list(undefined, true),
          settings: this.library.getSettings(),
          dir: this.library.rootDir,
        };
      }
      if (method === 'delete') {
        const cat = LIBRARY_CATEGORIES.includes(raw?.category) ? (raw.category as LibraryCategory) : 'props';
        const ok = this.library.remove(cat, String(raw?.id ?? ''));
        this.broadcastLife(now);
        return {
          ok,
          entries: this.library.list(undefined, true),
          settings: this.library.getSettings(),
          dir: this.library.rootDir,
        };
      }
      if (method === 'savePolicy') {
        const settings = this.library.saveSettings({
          policy: raw?.policy,
          cooldownMin: raw?.cooldownMin !== undefined ? Number(raw.cooldownMin) : undefined,
        });
        this.broadcastLife(now);
        return {
          ok: true,
          entries: this.library.list(undefined, true),
          settings,
          dir: this.library.rootDir,
        };
      }
      throw new Error(`素材库页不认识这个方法：${method}`);
    }

    if (panel === 'diary') {
      if (method === 'list' || method === 'snapshot' || method === '') {
        const days = this.diary.recent(60).reverse().map((d) => ({
          dateKey: d.dateKey,
          town: d.townName,
          street: d.street ?? '',
          weather: d.weather ?? '',
          summary: d.summary ?? '',
          body: d.body,
        }));
        return {
          days,
          dir: this.diary.current.dir,
          problem: this.diary.current.problem,
          inTrip: this.inJourneyTrip(j),
          ledger: readLedger(this.opts.dataDir, 40),
          tellable: [...this.state.tellable].reverse().slice(0, 20),
        };
      }
      if (method === 'read') {
        const want = String((args as any)?.dateKey ?? (Array.isArray(args) ? args[0] : '') ?? '').trim();
        const d = want ? this.diary.read(want) : null;
        return d ? {
          dateKey: d.dateKey,
          town: d.townName,
          street: d.street ?? '',
          weather: d.weather ?? '',
          summary: d.summary ?? '',
          body: d.body,
        } : null;
      }
      throw new Error(`生活日记页不认识这个方法：${method}`);
    }

    if (method === 'move') {
      await this.settleBeforeTool(now);
      const raw = Array.isArray(args) ? args[0] : args;
      const tier = typeof raw === 'string' ? raw : String((raw as any)?.tier ?? '');
      if (!(tier in HOME_TIER_COST)) {
        return { ok: false, reason: `没有「${tier}」这一档。`, ...this.panelSnapshot(now) };
      }
      const r = applyMove(this.state, tier as HomeTier, now);
      if (r.ok) {
        if (r.deposit > 0) {
          appendLedger(this.opts.dataDir, {
            id: `move-${now.getTime().toString(36)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: r.deposit,
            source: 'life_move',
            payee: HOME_TIER_LABEL[r.to],
            note: `面板搬家押金（${HOME_TIER_LABEL[r.from]} → ${HOME_TIER_LABEL[r.to]}）`,
          });
        }
        try { this.store.save(this.state); } catch { /* 下一帧再存 */ }
        this.broadcastLife(now);
        await this.push(
          'life.moved',
          `他刚刚在面板上替你搬了家：${HOME_TIER_LABEL[r.from]} → ${HOME_TIER_LABEL[r.to]}（押金 ${r.deposit} 元，现在每月 ${this.state.home.monthly} 元，手上还剩 ${r.cash} 元）。`,
          'flush',
        );
      }
      return { ok: r.ok, reason: r.reason || '', ...this.panelSnapshot(now) };
    }

    if (method === 'snapshot' || method === '') {
      await this.settleBeforeTool(now);
      return this.panelSnapshot(now);
    }

    if (method === 'reloadTown') {
      this.town = await readTown(this.cfg.townUrl, this.cfg.homeCity);
      return { ok: true, town: this.town };
    }

    throw new Error(`没有这个方法：${method}`);
  }

  /** 面板要的那一份快照。抽出来是为了 `move` 之后能直接回同一份，前端只画一次。 */
  private panelSnapshot(now: Date): Record<string, unknown> {
    const j = readJourney(this.opts.dataDir, now);
    this.journey = j;
    const s = snapshot(this.state, now);
    {
      const at = herNow(j, now);
      return {
        version: VERSION,
        /* 表头那个徽章：知道有新版才变色，不知道就只说自己的版本。 */
        latestVersion: this.versionCheck.state().latest,
        versionOutdated: this.versionCheck.state().outdated,
        at: now.toISOString(),
        herNow: at.toISOString(),
        /* 见识。面板那格读它 —— `snapshot()` 里也有，但面板走的是这一份。 */
        knowledge: Math.round(this.state.knowledge),
        dayPart: DAYPART_LABEL[dayPart(at)],
        clock: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
        clockGapHours: Math.round(clockGapHours(j, now) * 10) / 10,
        journey: {
          installed: j.installed,
          phase: j.phase,
          city: j.cityName,
          to: j.toName,
          staleSec: j.staleSec,
        },
        town: {
          id: this.town.id,
          name: this.town.name,
          origin: this.town.origin,
          streets: this.town.streets,
          rules: this.town.rules,
          source: this.town.source,
          custom: this.town.custom,
        },
        street: this.state.street,
        /* 她在睡的话：还有多久、醒来大约多少精力。醒着是 null。 */
        asleep: s.asleep,
        /* 正在进行的非睡眠动作/上班，空闲或睡眠中是 null。 */
        activity: s.activity,
        home: {
          tenure: this.state.home.tenure,
          tier: this.state.home.tier,
          tierLabel: HOME_TIER_LABEL[this.state.home.tier],
          street: this.state.home.street,
          monthly: this.state.home.monthly,
          since: this.state.home.since,
          /*
           * 「此刻住在哪儿」和「房子在哪一档」是两件事：
           * 前者受出差/旅行影响，后者是她的资产。分开给，面板才不会把
           * 「在新小区有房」写成「现在住新小区」—— 她这会儿可能在大理的旅馆。
           */
          staying: this.lodgingText(j),
        },
        job: {
          what: this.state.job.what,
          id: this.state.job.id,
          daily: this.state.job.daily,
          days: this.state.job.days,
          certs: this.state.job.certs,
          lastAt: this.state.job.lastAt,
          /*
           * 今天出过工没有 —— 页面不用自己算自然日。
           *
           * ⚠ 必须用 `localDateKey`：原来这里是 `now.toISOString().slice(0, 10)`，
           * 那是 **UTC 日期**，GMT+8 的凌晨 0–8 点会判成前一天，面板上「今天还没出工」
           * 会在她已经出过工的时候显示出来。卷二专门记过这个坑，这一处漏了。
           */
          workedToday: this.state.job.lastAt === localDateKey(now),
        },
        money: {
          cash: this.state.money.cash,
          earned: this.state.money.earned,
          spent: this.state.money.spent,
          since: this.state.money.since,
        },
        goals: s.goals.map((g) => ({
          id: g.id,
          what: g.what,
          need: g.need,
          /*
           * 达成了就不再按现金算。达成了如果还比现金，会掉回「还差 4400」——
           * 因为搬家把钱花掉了。那是这套东西最容易做歪的一处：
           * **花钱达成的目标，不能用「还剩多少钱」判进度。**
           */
          done: !!g.done,
          left: g.done ? 0 : Math.max(0, g.need - this.state.money.cash),
          ratio: g.done ? 1 : (g.need > 0 ? Math.min(1, this.state.money.cash / g.need) : 0),
        })),
        vitals: Object.fromEntries(
          (Object.keys(VITAL_LABEL) as VitalKey[])
            .map((k) => [k, { value: Math.round(s.vitals[k]), label: VITAL_LABEL[k] }]),
        ),
        low: s.low,
        conditions: s.conditions,
        moodlets: s.moodlets,
        habits: s.habits,
        watches: s.watches,
        wants: s.wants,
        tellable: s.unsaid,
        gifts: s.gifts,
        weather: s.weather,
        ledger: readLedger(this.opts.dataDir, 30),
        pending: s.pending.map((x) => ({
          id: x.id,
          what: x.what,
          blocked: x.blocked,
          blockedLabel: PENDING_BLOCK_LABEL[x.blocked],
          cost: x.cost,
          since: x.since,
          expiresAt: x.expiresAt,
        })),
        pledges: s.pledges.map((x) => ({ ...x, overdue: false })),
        overdue: s.overdue.map((x) => ({ ...x, overdue: true })),
        visitedDays: s.visitedDays,
        recovered: this.recovered,
        /*
         * 反馈用的那一份。
         *
         * `digest` 是**要粘到公开 issue 里的东西**，所以：
         * 不带 uid、不带 dataDir、不带任何路径 —— 只带能复现问题的状态。
         * 版本号是第一行，因为报障时第一个要确认的数就是它。
         */
        feedback: {
          repo: 'https://github.com/fateSSD/coopani-world-life',
          version: VERSION,
          digest: [
            `版本 ${VERSION}`,
            `城：${this.town.name}（${this.townSourceLabel()}）`,
            `住：${HOME_TIER_LABEL[this.state.home.tier]} · ${this.state.home.tenure === 'own' ? '买下的' : '租的'} · 每月 ${this.state.home.monthly} 元`,
            `她那边：${DAYPART_LABEL[dayPart(at)]} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
            `旅行扩展：${j.installed ? j.phase || '已装' : '没装'}`,
            `五条：${(Object.keys(VITAL_LABEL) as VitalKey[]).map((k) => `${VITAL_LABEL[k]} ${Math.round(s.vitals[k])}`).join(' ')}`,
            `局面：悬着 ${s.pending.length} 件 · 说好了 ${s.pledges.length} 件 · 欠着 ${s.overdue.length} 件`,
            `目标：${s.goals.map((g) => g.what).join('；') || '无'}`,
          ].join('\n'),
        },
        /*
         * 四档的搬家报价。**面板要能在按之前把价说清** ——
         * 「还差 2200」写在按钮旁边，比点一下弹「钱不够」好得多。
         */
        moveQuotes: (['urban-village', 'old', 'new', 'villa'] as HomeTier[]).map((t) => {
          const q = quoteMove(this.state, t);
          return { ...q, current: t === this.state.home.tier };
        }),
      };
    }
  }
}

/** 不进提示词，给人和扩展市场看的全量自描述。 */
/*
 * 语言包化的 describe。
 *
 * **直接从 `describe.json` 读，不在代码里再抄一份。**（2026-11-15）
 *
 * 原来是两份：这里硬编码的 `LIFE_DESCRIBE`，和磁盘上的 `describe.json`。
 * 加 `life_cert` 那次只改了后者，`verify-world` 当场报
 * 「def.describe.tools 覆盖全部工具 → 缺：life_cert」—— 因为**宿主校验的是这份 JS 对象**，
 * 而市场看的是磁盘那份。两份不同步的结果是「功能没坏、声明没跟上」，
 * 而这种错最难被发现：她的工具能用，报障时却对不上。
 *
 * 类型靠 `verify-world` 兜（它会逐项调 tools()、查 tags 枚举、对 describe），
 * 这里用断言换掉手抄 —— 手抄的那份没有人会记得同步。
 */
const DESCRIBE_FILE = fileURLToPath(new URL('../describe.json', import.meta.url));
export const LIFE_DESCRIBE = JSON.parse(readFileSync(DESCRIBE_FILE, 'utf8')) as {
  tools: { name: string; description: string; parameters: unknown; tags: string[]; summary: unknown }[];
  events: { type: string; description: unknown; trigger: string }[];
};;
