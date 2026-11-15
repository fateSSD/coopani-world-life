import { statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VersionCheck } from './version-check.ts';
import type {
  Logger, ToolDef, World, WorldHost, WorldWebUiDecl, WorldLamp, TriggerMode,
} from 'cortico/core/types.ts';
import { LIFE_ID, lifeConfigGroups, type LifeConfigSection } from './config.ts';
import {
  ACTS, DECAY_PER_HOUR, HOME_TIER_COST, HOME_TIER_LABEL, LOW, MAX_PENDING, MAX_PLEDGES,
  PENDING_BLOCK_LABEL, PENDING_TTL_DAYS, StateStore, VITAL_LABEL,
  advance, applyAct, applyMove, applySpend, applyWork, applyCert, localDateKey, noteVisit, quoteMove, readyGoals,
  recentVisits, remember, snapshot,
  type HomeTier, type LifeState, type PendingBlock, type Snapshot, type VitalKey,
} from './state.ts';
import {
  BUILTIN_TOWN, DAYPART_LABEL, clockGapHours, dayPart, herNow, readJourney, readSpendRequests, readTown,
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
  private state: LifeState;
  private journey: JourneyView;
  private town: TownView = { ...BUILTIN_TOWN };

  constructor(opts: LifeWorldOptions) {
    this.opts = opts;
    this.store = new StateStore(opts.dataDir);
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
      `模拟鱼生已就绪：${this.town.name}（${this.town.source === 'server' ? '读服务器' : '内置'}）`
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
    if (this.lastTownUrl !== null && townUrl !== this.lastTownUrl) {
      this.lastTownUrl = townUrl;
      this.town = await readTown(townUrl, this.cfg.homeCity);
      this.log?.info(`模拟鱼生：本城改成了 ${this.town.name}（${this.town.source === 'server' ? '读服务器' : '内置'}）`);
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
    const r = advance(this.state, now);
    if (r.hours <= 0) return;

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
    const today = now.toISOString().slice(0, 10);
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

    /* 掉过线的那几条 —— 按配置的密度说。 */
    for (const key of r.crossed) {
      if (!this.shouldNag(key, now)) continue;
      const label = VITAL_LABEL[key];
      const v = Math.round(this.state.vitals[key]);
      await this.push(
        'life.low',
        this.lowText(key, v),
        'debounce',
      );
      this.state.nagged[key] = now.toISOString().slice(0, 10);
    }

    if (dirty) {
      try { this.store.save(this.state); } catch (e) {
        /* 存不进去要说，但**不能把 tick 搞挂** —— 下一跳还会再来一次。 */
        this.log?.warn(`模拟鱼生：存档失败 ${(e as Error).message}`);
      }
    }
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
    const reqs = readSpendRequests(this.opts.dataDir);
    if (!reqs.length) return;
    const { settled, changed } = applySpend(this.state, reqs, now);
    if (changed) {
      try { this.store.save(this.state); } catch { /* 下一跳再存 —— 判重表已经进内存了 */ }
    }
    this.writeSpendSettled(settled);
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
  private shouldNag(key: VitalKey, now: Date): boolean {
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
   * 只给「睡一觉能回 80，而洗、玩、见人都要再扣精力」。做不做是她的事。
   */
  private lowText(key: VitalKey, v: number): string {
    const where = this.journey.installed && this.journey.phase === 'staying'
      ? `在${this.journey.cityName}`
      : this.journey.installed && this.journey.phase === 'traveling'
        ? `在去${this.journey.toName}的路上`
        : '';
    const tail = where ? `　·　${where}` : '';
    /* 见底时间 = 现在的值 ÷ 每小时掉多少。除出来的，不是估的。 */
    const hours = v / DECAY_PER_HOUR[key];
    const left = hours >= 1
      ? `按现在的掉法，${Math.round(hours)} 小时左右见底。`
      : '按现在的掉法，撑不到一小时。';
    switch (key) {
      case 'food':
        return `饱腹 ${v}，${left}吃一顿能回 30（15 元）；钱紧就将就吃一口，回 12。${tail}`;
      case 'energy':
        return `精力 ${v}，${left}睡一觉回 80，不花钱 —— 洗、玩、见人都要再扣精力，只有睡是往上走的。${tail}`;
      case 'clean':
        return `清爽 ${v}，${left}洗个澡回 55，不花钱。${tail}`;
      case 'fun':
        return `娱乐 ${v}，${left}找点乐子回 38（22 元，要花 6 点精力）。${tail}`;
      case 'social':
        return `社交 ${v}，${left}跟人说说话回 30（30 元，花 5 点精力）。${tail}`;
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
        '你自己做一件事，身体会变。'
        + '吃（eat）、睡（sleep）、洗（wash）、玩（play）、跟人说话（meet）。'
        + '**这是你自己去做，不是别人让你做** —— 他让你吃饭的时候，你现在是不是饿、'
        + '现在是不是吃饭的点，都由你自己判断；不想吃就别吃，说一句就行。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: {
          kind: {
            type: 'string',
            enum: Object.keys(ACTS),
            description: 'eat 吃 / sleep 睡 / wash 洗 / play 玩 / meet 见人。',
          },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = new Date();
        const r = applyAct(this.state, String(args?.kind ?? ''), now);
        if (!r.ok) return { text: r.reason ?? '这件事做不了。' };
        try { this.store.save(this.state); } catch { /* 下一跳会再存 */ }
        const kind = ACTS[String(args.kind)];
        const after = Object.entries(ACTS[String(args.kind)]?.gain ?? {})
          .map(([k, d]) => `${VITAL_LABEL[k as VitalKey]} ${Number(d) > 0 ? '+' : ''}${d}`)
          .join('、');
        return {
          text: `${kind?.label ?? '做完了'}。${after}。`
            + (r.mood ? `眼下心里：${r.mood.text}。` : '')
            + `现在五条：${this.vitalsLine(r.vitals)}`,
        };
      },
    };
  }

  /**
   * 出工。
   *
   * 这是**一期的「职业」**：干什么由她自己填一句话，干一天拿一天的价。
   * 方案的 66 种、五条通道、完成度系数都还没建 —— 但「没有进项的钱」是个死数，
   * 一个只会变少的余额撑不过两天，所以先把「挣」这一半补上。
   */
  private toolWork(): ToolDef {
    return {
      name: 'life_work',
      description:
        '去顶一天活，挣这一天的钱。**一天一次**，按你本地的自然日算。'
        + '价钱不一样：搬货、看店、端盘子、送外卖、发传单这类零工一天八九十；'
        + '后厨帮工、装修小工、跑腿、摆摊这类熟练活一百三四（要干满三十天）；'
        + '护工、网约车司机、厨师、电工要证、一天两百二到两百四；'
        + '护士、代课老师、会计、社工要证又要有年头、一天三百到三百四。'
        + '要证的活没证接不了 —— 证去考，用 `life_cert`。'
        + '越贵的活越累：档越高扣得越多，专业那档一整天不在家，社交也掉。'
        + '填表里的名字就按那个价；自己随口说的活按零工算，说了就记下，以后默认还是这个。'
        + '精力低于 20 的时候去不了，那是身体真的动不了，不是不让你去。',
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
        const r = applyWork(this.state, String(args?.what ?? ''), now);
        if (!r.ok) return { text: r.reason ?? '今天去不了。' };
        try { this.store.save(this.state); } catch { /* 下一跳会再存 */ }
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
        '去考一张证。花钱、花精力，考下来才能接要证的活。'
        + '护工证 400 / 驾照 600 / 厨师证 500 / 电工证 450 / 护士执业证 800 / 教师资格证 700 / 会计证 750 / 社工证 550。'
        + '钱不够就考不了，先攒。同一张证不用考两遍。',
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
        const r = applyCert(this.state, String(args?.cert ?? ''), new Date());
        if (!r.ok) return { text: r.reason ?? '没考成。' };
        try { this.store.save(this.state); } catch { /* 下一跳会再存 */ }
        return { text: `考下了${r.cert}，花了 ${r.paid} 元。手上还剩 ${r.cash} 元。` };
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
        const tier = String(args?.tier ?? '');
        if (!(tier in HOME_TIER_COST)) {
          return { text: `没有「${tier}」这一档。能搬的：城中村 / 老小区 / 新小区 / 别墅区。` };
        }
        const r = applyMove(this.state, tier as HomeTier, now);
        if (!r.ok) return { text: r.reason ?? '搬不了。' };
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
        remember(s, `去${where}转了一圈。`, now);
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
    parts.push(`住处：${HOME_TIER_LABEL[h.tier]}（${ten}），每月 ${h.monthly} 元`);
    parts.push(s.job.what
      ? `做事：${s.job.what}，顶一天 ${s.job.daily} 元，一共出过 ${s.job.days} 天工`
      : '做事：现在没在做事（可以在本城里顶一天活，见 life_work）');
    if (s.job.certs.length) parts.push(`手上的证：${s.job.certs.join('、')}`);
    parts.push(`钱：手上 ${s.money.cash} 元（累计进 ${s.money.earned} / 出 ${s.money.spent}）`);
    if (s.goals.length) {
      parts.push(`目标：${s.goals.map((g) => {
        if (g.done) return `${g.what}（已经做到了）`;
        if (g.need > 0 && s.money.cash >= g.need) {
          return `${g.what}（钱够了，还没办）`;
        }
        return `${g.what}（还差 ${Math.max(0, g.need - s.money.cash)}）`;
      }).join('；')}`);
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

    return parts.join('\n');
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
        `做事：${s.job.what || '现在没在做事'}`,
        `住：${this.lodgingText(j)}　${HOME_TIER_LABEL[s.home.tier]}（${s.home.tenure === 'own' ? '买下的' : '租的'}）`,
        `钱：手上 ${s.money.cash} 元`,
      ].join('　·　'),
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
    };
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

    if (method === 'move') {
      const tier = String((args as any)?.tier ?? '');
      if (!(tier in HOME_TIER_COST)) {
        return { ok: false, reason: `没有「${tier}」这一档。`, ...this.panelSnapshot(now) };
      }
      const r = applyMove(this.state, tier as HomeTier, now);
      if (r.ok) {
        try { this.store.save(this.state); } catch { /* 下一帧再存 */ }
      }
      return { ok: r.ok, reason: r.reason || '', ...this.panelSnapshot(now) };
    }

    if (method === 'snapshot' || method === '') {
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
            `城：${this.town.name}（${this.town.source === 'server' ? '读服务器' : '内置'}）`,
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
