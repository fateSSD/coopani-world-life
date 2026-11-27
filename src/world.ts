import { existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VersionCheck } from './version-check.ts';
import { LifeDiaryStore } from './diary.ts';
import { ImageLibrary, LIBRARY_CATEGORIES, LIBRARY_CATEGORY_LABEL, type LibraryCategory, type LibrarySettings } from './library.ts';
import type {
  Logger, ToolDef, World, WorldHost, WorldWebUiDecl, WorldLamp, TriggerMode, EventTag, EventEnvelope, StoragePart,
} from 'cortico/core/types.ts';
import {
  LIFE_ID, clampWeatherTimeoutMs, lifeConfigGroups, normHubUrl, normWeatherUrl, parseTownUrls,
  type ExternalWeatherOverride, type LifeConfigSection, type WeatherMode, type WeatherSky,
} from './config.ts';
import {
  ACTS, CRITICAL, DECAY_PER_HOUR, FITNESS_MAX, HOME_TIER_COST, HOME_TIER_LABEL, HOME_TIER_RELIEF, KNOWLEDGE_MAX, LOW, MAX_PENDING, MAX_PLEDGES, NON_OCCUPYING_ACTS,
  PENDING_BLOCK_LABEL, PENDING_TTL_DAYS, StateStore, VITAL_LABEL, SKILL_DOMAIN_LABEL, TRAIN_COURSES, EQUIP_CATALOG,
  HOME_FARM_SLOTS, LEASE_PLOT_COUNT, LEASE_MONTHLY_RENT, LEASE_SIGNUP_FEE, SEEDS, STALL_CATEGORY_LABEL, STALL_RULES_GUIDE,
  ANIMAL_GROUP_LABEL, HOME_RANCH_SLOTS, RANCH_LEASE_SLOTS, RANCH_SIGNUP_FEE, RANCH_MONTHLY_RENT, ANIMALS, HELPER_PLANS, NEIGHBOR_ERRAND_TTL_HOURS,
  RECIPES,
  advance, applyAct, applyMove, applyStreetMove, applySpend, applyWork, applyCert, applyLearn, applyGift, asleepRefusal, busyRefusal, freshState, isAsleep, isBusy, isCruiseJourney, isThemeCruiseJourney, isRiverCruiseJourney, isScenicTrainJourney, isCampervanJourney,
  applyPlant, applyWater, applyHarvest, applyRentFarm, applyUnrentFarm, farmPlotView, addPantryItem, consumePantry, pantryCount, evaluateStallPlan, solarTermOf,
  consumeCookedDish, cookedDishCount,
  applyRentRanch, applyUnrentRanch, applyBuyAnimal, applyFeedAnimal, applyCollectRanch, applyHarvestRanch, ranchPenView,
  countPendingFarmWork, calcNeighborErrandQuote, parseErrandMinutes, recordPostedNeighborErrand,
  applyNeighborErrandCompleted, refundExpiredErrand, applyHireHelper, applyUnhireHelper,
  findRecipe, evaluateAllRecipes, applyCookRecipe, applyEatCookedDish, buildCareerOverview,
  clampRentMult, effectiveHomeMonthly, normalizeMoodBonus,
  jobGate, localDateKey, noteVisit, quoteMove, readyGoals,
  isHouseboundSick, sickRefusal, applyUserCare, skillPayMultiplier,
  DEFAULT_DAILY_GIFT_CAP, LOAN_PRODUCTS, LOAN_RESERVE_CASH,
  activeLoansTotalDue, applyBorrowLoan, applyRepayLoan, applyUserCashGift,
  availableCredit, computeCreditLimit, garnishOverdueFromIncome, hasOverdueLoan, loanRemaining, loanSummary,
  recentVisits, remember, snapshot, streetDecayFactor, SLEEP_ENERGY_PER_HOUR,
  appendLedger, readLedger, fullMarketPrices, weatherOf,
  type AdvanceResult, type HelperMode, type HomeTier, type LifeState, type PendingBlock, type PendingNotice, type Snapshot, type VitalKey, type SkillDomain, type StallCategory, type WeatherInfo,
} from './state.ts';
import { JOBS, certOf, jobAllowedAt } from './jobs.ts';
import {
  BUILTIN_TOWN, DAYPART_LABEL, clockGapHours, dayPart, herNow, readJourney, readSpendRequests, readTown, fetchExternalWeather,
  readPendingRequests, archivePendingRequest, fetchTownStalls, buyTownStall, joinTown, readMeetUid,
  pickTownStreet, postTownStall, fetchTownDeals, ackTownDeals, findStreetProfile, formatStreetMods, normStallEffects, resolveStallEffects, formatStallEffects,
  type JourneyView, type TownView, type TownStall, type TownDeal, type StreetMods, type StallEffects,
} from './bridge.ts';
import {
  ensureHubAuth, readHubAuth, onHubAuthFailure, hubGetMe, hubListTowns, hubGetTown, hubJoinTown, hubGetResidents, hubPutExtProfile,
  hubGetCatalogSnapshot, hubListListings, hubCreateListing, hubCancelListing, hubTradeListing,
  hubListOrders, hubSettleOrders, hubListErrands, hubCreateErrand, hubClaimErrand, hubCancelErrand,
  hubSyncInbox, hubAckInbox, hubListRelations, hubSetRelation, hubOpenDirectConversation,
  hubListConversations, hubListCompanions, hubGetMessages, hubSendMessage, hubMarkConversationRead,
  type HubAuthRecord, type HubAuthFailureEvent, type HubCatalogItem, type HubCatalogJob, type HubConversation,
  type HubResident, type HubTownMeta, type HubTownSummary,
} from './hub-client.ts';
import { findJob } from './jobs.ts';

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
  /** 可选时钟注入（供测试固定白昼窗口）。 */
  now?: () => Date;
}

type CrossedLevel = 'crossed' | 'critical' | 'bottomed';

/** 隐藏 World 可能只入队不 render；只给这段排队期设租约，render 后的在途事件不按时间回收。 */
const DAY_WORK_QUEUE_LEASE_MS = 60_000;

interface DeliveryAttempt {
  id: string;
  generation: number;
  kind: 'notice' | 'crossed' | 'day' | 'goal' | 'farm';
  acceptedAt: number;
  cursor?: number;
  noticeId?: string;
  nagKey?: string;
  vital?: VitalKey;
  level?: CrossedLevel;
  date?: string;
  renderedAt?: number;
  legacy?: boolean;
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

/** 回滚也走临时文件 + rename；所有恢复错误都返回给调用方，绝不静默吞掉。 */
function restoreFiles(entries: readonly { file: string; bytes: Buffer | null }[]): unknown[] {
  const errors: unknown[] = [];
  for (const { file, bytes } of entries) {
    const tmp = `${file}.rollback-${process.pid}`;
    try {
      if (bytes === null) {
        if (existsSync(file)) unlinkSync(file);
      } else {
        try {
          writeFileSync(tmp, bytes);
          renameSync(tmp, file);
        } finally {
          if (existsSync(tmp)) unlinkSync(tmp);
        }
      }
    } catch (e) {
      errors.push(e);
    }
  }
  return errors;
}

function throwRollback(original: unknown, rollbackErrors: readonly unknown[]): never {
  if (rollbackErrors.length) {
    throw new AggregateError([original, ...rollbackErrors], '操作失败，且回滚未完整恢复；内存已还原，请检查磁盘权限或文件占用');
  }
  throw original;
}

/** 统一全角括号、冒号、空格与外层引号/书名号，避免大模型或手输标点差异导致鱼市街匹配失效。 */
function normalizeTownText(raw: string): string {
  let s = String(raw || '').trim()
    .replace(/\u3000/g, ' ')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/：/g, ':')
    .replace(/\s+/g, ' ')
    .trim();
  for (let i = 0; i < 3; i += 1) {
    const stripped = s.replace(/^[`"'「『【《]+/, '').replace(/[`"'」』】》]+$/, '').trim();
    if (stripped === s) break;
    s = stripped;
  }
  return s;
}

/** 剥除 `id:` / `编号:` 等展示前缀与外层包裹括号，还原裸编号或裸名称。 */
function stripStallIdPrefix(raw: string): string {
  let s = normalizeTownText(raw);
  if ((s.startsWith('(') && s.endsWith(')')) || (s.startsWith('[') && s.endsWith(']'))) {
    const inner = s.slice(1, -1).trim();
    if (
      /^(?:邻里)?(?:委托|摊位|单号|编号)?\s*(?:stall_?id|errand_?id|id|编号)\s*[:=#]?/i.test(inner)
      || /^[a-f0-9]{6,}$/i.test(inner)
      || /^(?:lst|err)_[a-z0-9]{4,}$/i.test(inner)
    ) {
      s = inner;
    }
  }
  s = s.replace(/^(?:邻里)?(?:委托|摊位|单号|编号)?\s*(?:stall_?id|errand_?id|id|编号)\s*[:=#]?\s*/i, '').trim();
  return normalizeTownText(s);
}

/** 判断入参是否明显指向远程鱼市街编号或邻里委托（此类输入未命中绝不可落回本地早市）。 */
function looksLikeRemoteOrErrandPick(raw: string): boolean {
  const s = normalizeTownText(raw);
  if (!s) return false;
  if (/(?:lst|err)_[a-z0-9]{4,}/i.test(s)) return true;
  if (/[a-f0-9]{8,}/i.test(s)) return true;
  if (/^[a-f0-9]{6,}$/i.test(stripStallIdPrefix(s))) return true;
  if (/^\s*(?:邻里)?(?:委托|摊位|单号|编号)?\s*(?:stall_?id|errand_?id|id|编号)\s*[:=#]/i.test(s)) return true;
  if (/农牧代管|邻里委托|代管委托|委托单|接单|委托编号|最短|最快/.test(s)) return true;
  return false;
}

/** 按裸 ID、内嵌 Hub/16-hex ID、短前缀、归一化标题与委托快捷意图匹配鱼市街在架条目。 */
function matchTownStall(
  stalls: readonly TownStall[],
  rawPick: string,
  opts: { errandsOnly?: boolean; isMyErrand?: (id: string) => boolean } = {},
): { match: TownStall | null; ambiguous?: TownStall[] } {
  const pool = opts.errandsOnly ? stalls.filter((s) => s.kind === 'errand') : [...stalls];
  if (!pool.length) return { match: null };
  const isMine = opts.isMyErrand ?? (() => false);
  const preferNonMine = (list: readonly TownStall[]): TownStall[] => {
    const nonMine = list.filter((s) => s.kind !== 'errand' || !isMine(s.id));
    return nonMine.length ? nonMine : [...list];
  };

  const cleaned = stripStallIdPrefix(rawPick);
  const lower = cleaned.toLowerCase();

  // P1：精确匹配 id（忽略大小写）
  if (lower) {
    const p1 = pool.filter((s) => s.id.toLowerCase() === lower);
    if (p1.length === 1) return { match: p1[0] };
    if (p1.length > 1) return { match: preferNonMine(p1)[0] };
  }

  // P2：从入参任意位置提取 Hub ID (lst_/err_...) 或 16 位 hex ID
  const embeddedIds = normalizeTownText(rawPick).match(/(?<![a-z0-9])(?:(?:lst|err)_[a-z0-9]{12,32}|[a-f0-9]{16})(?![a-z0-9])/gi) ?? [];
  if (embeddedIds.length) {
    const p2: TownStall[] = [];
    for (const h of embeddedIds) {
      const hl = h.toLowerCase();
      for (const st of pool) {
        if (st.id.toLowerCase() === hl && !p2.some((x) => x.id === st.id)) p2.push(st);
      }
    }
    if (p2.length === 1) return { match: p2[0] };
    if (p2.length > 1) return { match: null, ambiguous: p2 };
  }

  // P3：短前缀唯一匹配（支持 6-15 hex 或 lst_/err_ 前缀）
  if (/^(?:(?:lst|err)_[a-z0-9]{4,31}|[a-f0-9]{6,15})$/i.test(cleaned)) {
    const p3 = pool.filter((s) => s.id.toLowerCase().startsWith(lower));
    if (p3.length === 1) return { match: p3[0] };
    if (p3.length > 1) return { match: null, ambiguous: p3 };
  }

  // P4：归一化名称匹配（兼容全半角括号与空格差异）
  const normClean = normalizeTownText(cleaned);
  if (normClean) {
    const p4 = pool.filter((s) => normalizeTownText(s.item) === normClean);
    if (p4.length) return { match: preferNonMine(p4)[0] };
  }

  // P5：委托快捷匹配（最短/最快，或雇主名/标题片段唯一命中）
  const errands = pool.filter((s) => s.kind === 'errand');
  if (errands.length && (opts.errandsOnly || looksLikeRemoteOrErrandPick(rawPick))) {
    const nonMineErrands = preferNonMine(errands);
    if (/最短|最快/.test(normClean)) {
      const sorted = [...nonMineErrands].sort(
        (a, b) => (a.estMinutes ?? parseErrandMinutes(a.item)) - (b.estMinutes ?? parseErrandMinutes(b.item)),
      );
      return { match: sorted[0] ?? null };
    }
    if (normClean.length >= 2) {
      const byHint = nonMineErrands.filter((s) => {
        const normItem = normalizeTownText(s.item);
        const normSeller = normalizeTownText(s.seller);
        return (
          normItem.includes(normClean)
          || normClean.includes(normItem)
          || (normSeller.length >= 2 && (normSeller === normClean || normClean.includes(normSeller)))
        );
      });
      if (byHint.length === 1) return { match: byHint[0] };
      if (byHint.length > 1) return { match: null, ambiguous: byHint };
    }
  }

  return { match: null };
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
  private lastHubUrl: string | null = null;
  private lastHubTownId: string | null = null;
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
  /** 用户刚清过生活档案，且之后尚未产生新变动时为 true，防止 stop() 把空档案/旧内存写回复活。 */
  private stateCleared = false;
  /** 清理代次：旧 tick / 工具结算跨 await 返回后不得写入新状态。 */
  private stateGeneration = 0;
  /** 已入队但尚未收到宿主投递回执的白天提醒。 */
  private dayWorkPending: { id: string; date: string; generation: number } | null = null;
  /** 现代 resolve 仅表示接受；真实回执或旧宿主明确的假定 delivered 才能结清这些占位。 */
  private readonly deliveryAttempts = new Map<string, DeliveryAttempt>();
  /** 工具前结算单飞，防止同一病愈或越线被并发 flush 推两次。 */
  private settleFlight: Promise<void> | null = null;
  /** 当事件结算或推送写盘失败时置 true，确保下一跳/工具前重试补存。 */
  private stateSaveDirty = false;

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  private newAttempt(kind: DeliveryAttempt['kind'], extra: Partial<DeliveryAttempt> = {}): DeliveryAttempt {
    return {
      id: `life-attempt-${randomUUID()}`,
      generation: this.stateGeneration,
      kind,
      acceptedAt: Date.now(),
      ...extra,
    };
  }

  private hasAttempt(kind: DeliveryAttempt['kind'], key: string): boolean {
    for (const a of this.deliveryAttempts.values()) {
      if (a.generation !== this.stateGeneration || a.kind !== kind) continue;
      if (kind === 'notice' && a.noticeId === key) return true;
      if ((kind === 'crossed' || kind === 'goal' || kind === 'farm') && a.nagKey === key) return true;
    }
    return false;
  }

  private forgetAttempt(attempt: DeliveryAttempt): void {
    if (this.deliveryAttempts.get(attempt.id)?.id === attempt.id) this.deliveryAttempts.delete(attempt.id);
    if (this.dayWorkPending?.id === attempt.id) this.dayWorkPending = null;
  }

  /**
   * 只回收从未 render 的过期排队项：隐藏 World 静默 return 时不能永久占位。
   * 已 render 的事件可能仍在等待 persona.onDelivery/delivered，同日只允许日期、代次或明确回执改变它。
   */
  private recoverDayWorkLatch(force = false): void {
    const pending = this.dayWorkPending;
    if (!pending) return;
    const attempt = this.deliveryAttempts.get(pending.id);
    if (
      !attempt
      || pending.generation !== this.stateGeneration
      || attempt.generation !== pending.generation
      || attempt.date !== pending.date
    ) {
      this.dayWorkPending = null;
      return;
    }
    if (force) {
      this.forgetAttempt(attempt);
      return;
    }
    if (attempt.legacy || attempt.renderedAt !== undefined) return;
    if (Date.now() - attempt.acceptedAt < DAY_WORK_QUEUE_LEASE_MS) return;
    this.forgetAttempt(attempt);
    this.log?.warn('模拟鱼生：现代 deferred 排队租约到期仍未 render，已释放闩锁等待重试；未消耗今日额度');
  }

  private saveDeliveredState(): void {
    try {
      this.store.save(this.state);
      this.stateSaveDirty = false;
    } catch (e) {
      this.stateSaveDirty = true;
      this.log?.warn(`模拟鱼生：投递后状态落盘失败 ${(e as Error).message}；已置脏，下一跳或 stop() 会补存`);
    }
  }

  private townBulletin: string[] = [];
  private lastBulletinFetchMs = 0;
  private lastTownFetchMs = 0;
  private townRefreshInFlight: Promise<boolean> | null = null;
  private lastWeatherCfgKey: string | null = null;
  private externalWeather: {
    city: string;
    sky: WeatherSky;
    rawWeather: string;
    temperature?: number;
    source: string;
    fetchedAt: number;
  } | null = null;
  private externalWeatherError = '';
  private externalWeatherAttemptAt = 0;
  private externalWeatherInFlight: Promise<void> | null = null;
  private myStallsCache: TownStall[] = [];
  private otherStallsCache: TownStall[] = [];
  private myDealsCache: TownDeal[] = [];
  private unseenDealsCount = 0;
  private lastErrandPostAttemptDay = '';

  /* ---- Hub v1.1 多城联机态 ---- */
  private hubAuth: HubAuthRecord | null = null;
  private hubAuthError = '';
  private hubAuthErrorToken = '';
  private unsubHubAuthFailure: (() => void) | null = null;
  private hubAuthInFlight: { hubUrl: string; promise: Promise<HubAuthRecord | null> } | null = null;
  private hubAuthFailedUrl = '';
  private hubAuthRetryAfterMs = 0;
  private hubAuthFailStep = 0;
  private hubTownId = '';
  private hubTownEtag = '';
  private hubTownsCache: HubTownSummary[] = [];
  private hubTownMeta: HubTownMeta | null = null;
  private hubCatalogEtag = '';
  private hubCatalog: { version: number; items: HubCatalogItem[]; jobs: HubCatalogJob[] } = {
    version: 1,
    items: [],
    jobs: [],
  };
  private hubResidentsCache: HubResident[] = [];
  private hubConversationsCache: HubConversation[] = [];
  private hubUnreadMailCount = 0;
  private hubInboxCursor = 0;
  private lastExtProfileSyncMs = 0;
  private notifiedMailIds = new Set<number>();

  private activeHubUrl(): string {
    return normHubUrl(this.cfg.hubUrl);
  }

  private isHubMode(): boolean {
    return Boolean(this.activeHubUrl());
  }

  private hasRemoteServer(): boolean {
    return this.isHubMode() || parseTownUrls(this.cfg.townUrl).length > 0;
  }

  private targetHubTownId(): string {
    return this.hubTownId || this.state.hubTownId || String(this.cfg.hubTownId || '').trim() || 'lanzhou-reedpond';
  }

  private currentTownBuffs(): Record<string, number> {
    if (this.isHubMode()) {
      return this.hubTownMeta?.buffs ?? this.town.buffs ?? {};
    }
    return this.town.buffs ?? {};
  }

  private currentRentMult(): number {
    return clampRentMult(Number(this.currentTownBuffs().rent_mult));
  }

  private syncTownRent(): void {
    const rentMult = this.currentRentMult();
    const targetMonthly = effectiveHomeMonthly(this.state.home.tier, rentMult);
    if (this.state.home.monthly !== targetMonthly) {
      this.state.home.monthly = targetMonthly;
      this.stateSaveDirty = true;
    }
    if (rentMult !== 1) {
      for (const g of this.state.goals) {
        if (!g.done && g.id.startsWith('g-home-')) {
          const t = g.id.slice('g-home-'.length) as HomeTier;
          if (t in HOME_TIER_COST) {
            const q = quoteMove(this.state, t, rentMult);
            if (g.need !== q.deposit) {
              g.need = q.deposit;
              g.what = `攒够 ${q.deposit}，搬到${HOME_TIER_LABEL[t]}`;
              this.stateSaveDirty = true;
            }
          }
        }
      }
    }
  }

  private async ensureHubReady(generation: number): Promise<HubAuthRecord | null> {
    const hubUrl = this.activeHubUrl();
    if (!hubUrl) return null;
    if (this.hubAuth && this.hubAuth.hubUrl === hubUrl) return this.hubAuth;
    const local = readHubAuth(this.opts.dataDir, hubUrl);
    const localChanged = !this.hubAuthErrorToken || (local?.token ?? '') !== this.hubAuthErrorToken;
    if (local && local.hubUrl === hubUrl && localChanged) {
      this.hubAuth = local;
      this.hubAuthError = '';
      this.hubAuthErrorToken = '';
      this.hubAuthFailedUrl = '';
      this.hubAuthRetryAfterMs = 0;
      this.hubAuthFailStep = 0;
      return local;
    }
    if (this.hubAuthFailedUrl === hubUrl && Date.now() < this.hubAuthRetryAfterMs) {
      return null;
    }
    if (this.hubAuthInFlight && this.hubAuthInFlight.hubUrl === hubUrl) {
      const rec = await this.hubAuthInFlight.promise;
      if (generation !== this.stateGeneration) return null;
      return rec;
    }

    const promise = (async (): Promise<HubAuthRecord | null> => {
      try {
        const res = await ensureHubAuth({
          hubUrl,
          dataDir: this.opts.dataDir,
          displayName: this.opts.botName || '大肥鱼',
        });
        if (generation !== this.stateGeneration) return null;
        if (res.ok && res.auth) {
          this.hubAuth = res.auth;
          this.hubAuthError = '';
          this.hubAuthErrorToken = '';
          this.hubAuthFailedUrl = '';
          this.hubAuthRetryAfterMs = 0;
          this.hubAuthFailStep = 0;
          return res.auth;
        }
        this.hubAuthError = res.reason || 'Hub 身份认证失败';
        this.hubAuthFailedUrl = hubUrl;
        if (res.code === 'LEGACY_UID_CLAIMED') {
          this.hubAuthRetryAfterMs = Date.now() + 15 * 60_000;
        } else {
          const wait = Math.min(30 * 60_000, 60_000 * 2 ** this.hubAuthFailStep);
          this.hubAuthFailStep = Math.min(this.hubAuthFailStep + 1, 6);
          this.hubAuthRetryAfterMs = Date.now() + wait;
        }
        return null;
      } finally {
        if (this.hubAuthInFlight?.promise === promise) {
          this.hubAuthInFlight = null;
        }
      }
    })();

    this.hubAuthInFlight = { hubUrl, promise };
    return promise;
  }

  private hubStreetParam(displayOrId: string): string {
    const raw = String(displayOrId || '').trim();
    if (!raw) return this.town.streets[0] || '';
    return this.hubTownMeta?.streetIdByName[raw] ?? raw;
  }

  private hubStreetDisplay(idOrName: string): string {
    const raw = String(idOrName || '').trim();
    if (!raw) return '';
    return this.hubTownMeta?.streetNameById[raw] ?? raw;
  }

  private marketShowcaseLine(limit = 3): string {
    if (!this.otherStallsCache.length) return '';
    return this.otherStallsCache.slice(0, limit).map((st) => {
      if (st.kind === 'errand') {
        return `${st.seller}的「${st.item}」[邻里委托·接单挣+${st.price}元]`;
      }
      const fx = formatStallEffects(resolveStallEffects(st.effects, st.price));
      const shipTxt = st.isCrossTown && (st.estimatedShippingFee ?? 0) > 0
        ? `·${st.townName || '外城'}(邮+${st.estimatedShippingFee})`
        : (st.townName && this.isHubMode() ? `·${st.townName}(免邮)` : '');
      return `${st.seller}的「${st.item}」${st.price}元${shipTxt}（${fx}）`;
    }).join('；');
  }

  private townUrlKey(raw: unknown = this.cfg.townUrl): string {
    return parseTownUrls(raw).join('|');
  }

  /**
   * 为她确定并同步当前城市的街道：
   * - 原来只在 `/town/join` 时兜底拿 `this.town.streets[0]`，导致所有没选过街或刚迁城的老用户
   *   全部挤到第一条街（南滨河路），且本地 `state.street` 长期留空。
   * - 现在当街道列表非空且本地还没定街（或旧街名已不在新街道列表里，如成都「春熙路」迁至兰州）时，
   *   按 uid 哈希均匀分配并落盘，同时清掉 `lastJoinedTownAt` 以便重新向服务器报到刷新。
   */
  private ensureTownStreet(uid = ''): string {
    const streets = this.town.streets;
    if (!streets.length) return this.state.street || '';
    if (this.state.street && streets.includes(this.state.street)) {
      if (this.state.home.street !== this.state.street) {
        this.state.home.street = this.state.street;
        this.stateSaveDirty = true;
      }
      return this.state.street;
    }
    const seed = uid || readMeetUid(this.opts.dataDir) || this.opts.botName || 'fish';
    const picked = pickTownStreet(streets, seed);
    if (this.town.source === 'failed') return picked;
    if (picked && picked !== this.state.street) {
      this.state.street = picked;
      this.state.home.street = picked;
      this.state.lastJoinedTownAt = '';
      this.stateSaveDirty = true;
    }
    return this.state.street;
  }

  private currentStreetMods(): StreetMods | undefined {
    return findStreetProfile(this.town, this.state.street)?.mods;
  }

  private async syncTownPresenceAndBulletin(now: Date, generation: number): Promise<void> {
    if (this.isHubMode()) {
      const hubUrl = this.activeHubUrl();
      const auth = await this.ensureHubReady(generation);
      if (generation !== this.stateGeneration) return;
      if (Date.now() - this.lastTownFetchMs >= 15 * 60_000) {
        await this.refreshTownInfo(generation, { minIntervalMs: 15 * 60_000 });
        if (generation !== this.stateGeneration) return;
      }
      const today = localDateKey(now);
      if (auth && !this.state.hubTownId && !this.state.hubJoinedKey) {
        const me = await hubGetMe(hubUrl, auth.token);
        if (generation !== this.stateGeneration) return;
        if (me.ok && me.residency?.townId && me.residency.townId !== this.targetHubTownId()) {
          this.hubTownId = me.residency.townId;
          this.state.hubTownId = me.residency.townId;
          this.stateSaveDirty = true;
          await this.refreshTownInfo(generation, { force: true });
          if (generation !== this.stateGeneration) return;
        }
      }
      const targetTown = this.targetHubTownId();
      const joinKey = `${hubUrl}|${targetTown}|${today}`;
      const street = this.ensureTownStreet(auth?.petId || readMeetUid(this.opts.dataDir));
      if (auth && this.state.hubJoinedKey !== joinKey) {
        const res = await hubJoinTown(hubUrl, auth.token, targetTown, this.hubStreetParam(street));
        if (generation !== this.stateGeneration) return;
        if (res.ok) {
          const joinedTown = res.townId || targetTown;
          this.state.lastJoinedTownAt = today;
          this.state.hubTownId = joinedTown;
          this.state.hubJoinedKey = `${hubUrl}|${joinedTown}|${today}`;
          this.hubTownId = joinedTown;
          const displayStreet = this.hubStreetDisplay(res.streetName || res.street || '');
          if (
            displayStreet
            && (!this.town.streets.length || this.town.streets.includes(displayStreet))
            && displayStreet !== this.state.street
          ) {
            this.state.street = displayStreet;
            this.state.home.street = displayStreet;
          }
          this.stateSaveDirty = true;
        }
      }
      if (auth && Date.now() - this.lastExtProfileSyncMs >= 15 * 60_000) {
        const s = snapshot(this.state, now);
        this.lastExtProfileSyncMs = Date.now();
        void hubPutExtProfile(hubUrl, auth.token, 'life', {
          schemaVer: 1,
          summaryText: `${this.town.name}${this.state.street ? `·${this.state.street}` : ''} | ${s.job.what || '自由过日子'} | ${HOME_TIER_LABEL[s.home.tier]}`,
          payload: {
            townId: this.targetHubTownId(),
            townName: this.town.name,
            street: this.state.street,
            homeTier: s.home.tier,
            job: s.job.what || '',
            knowledge: Math.round(s.knowledge * 10) / 10,
            fitness: Math.round(s.fitness * 100) / 100,
          },
        }).catch(() => {});
      }
      if (Date.now() - this.lastBulletinFetchMs >= 15 * 60_000) {
        await this.refreshTownMarket(generation);
      }
      return;
    }

    const urls = parseTownUrls(this.cfg.townUrl);
    if (!urls.length) return;
    const today = localDateKey(now);
    const uid = readMeetUid(this.opts.dataDir);
    const street = this.ensureTownStreet(uid);
    if (this.state.lastJoinedTownAt !== today && uid) {
      try {
        const res = await joinTown(this.cfg.townUrl, { uid, pet: this.opts.botName || 'fish', street });
        if (generation !== this.stateGeneration) return;
        if (res.ok) {
          this.state.lastJoinedTownAt = today;
          if (
            res.street
            && (!this.town.streets.length || this.town.streets.includes(res.street))
            && res.street !== this.state.street
          ) {
            this.state.street = res.street;
            this.state.home.street = res.street;
          }
          this.stateSaveDirty = true;
        }
      } catch { /* 网络失败下次重试 */ }
    }
    if (Date.now() - this.lastTownFetchMs >= 15 * 60_000) {
      await this.refreshTownInfo(generation, { minIntervalMs: 15 * 60_000 });
      if (generation !== this.stateGeneration) return;
    }
    if (Date.now() - this.lastBulletinFetchMs >= 15 * 60_000) {
      await this.refreshTownMarket(generation);
    }
  }

  /**
   * 节流或强制从服务器重拉 `/town/info` 或 Hub v1 `/v1/towns/:townId` + 目录，同步最新的城名、街道简介与增益属性。
   * 未配置任何服务器且非强制时零请求直接返回 `false`；临时断网/5xx 自动刷新时保留既有服务端档案防闪烁。
   */
  private async refreshTownInfo(
    generation: number,
    opts: { force?: boolean; minIntervalMs?: number } = {},
  ): Promise<boolean> {
    if (!opts.force && !this.hasRemoteServer()) return false;
    const minInterval = opts.minIntervalMs ?? 15 * 60_000;
    if (!opts.force && this.lastTownFetchMs > 0 && Date.now() - this.lastTownFetchMs < minInterval) {
      return false;
    }
    if (this.townRefreshInFlight) {
      if (!opts.force) return this.townRefreshInFlight;
      await this.townRefreshInFlight.catch(() => false);
      if (generation !== this.stateGeneration) return false;
    }
    const run = (async (): Promise<boolean> => {
      if (this.isHubMode()) {
        const hubUrl = this.activeHubUrl();
        const tid = this.targetHubTownId();
        const auth = await this.ensureHubReady(generation);
        if (generation !== this.stateGeneration) return false;

        const [townRes, listRes, catRes] = await Promise.all([
          hubGetTown(hubUrl, tid, { etag: opts.force ? undefined : this.hubTownEtag }),
          hubListTowns(hubUrl),
          hubGetCatalogSnapshot(hubUrl, {
            ext: 'life',
            townId: tid,
            etag: opts.force ? undefined : this.hubCatalogEtag,
            token: auth?.token,
          }),
        ]);
        if (generation !== this.stateGeneration) return false;

        if (listRes.ok && listRes.towns.length) {
          this.hubTownsCache = listRes.towns;
        }
        if (catRes.ok && !catRes.notModified) {
          if (catRes.etag) this.hubCatalogEtag = catRes.etag;
          this.hubCatalog = {
            version: catRes.version ?? 1,
            items: catRes.items ?? [],
            jobs: catRes.jobs ?? [],
          };
        }

        if (townRes.ok && townRes.notModified) {
          this.lastTownFetchMs = Date.now();
          return this.town.source === 'server';
        }
        if (townRes.ok && townRes.townView) {
          this.town = townRes.townView;
          this.hubTownId = townRes.townView.id;
          if (townRes.etag) this.hubTownEtag = townRes.etag;
          if (townRes.meta) this.hubTownMeta = townRes.meta;
          this.lastTownFetchMs = Date.now();
          this.ensureTownStreet(auth?.petId);
          this.syncTownRent();
          if (this.stateSaveDirty && !this.stateCleared) {
            this.saveDeliveredState();
            this.broadcastLife(this.now());
          }
          return true;
        }

        if (!opts.force && this.town.source === 'server') {
          this.lastTownFetchMs = Math.max(this.lastTownFetchMs, Date.now() - Math.max(0, minInterval - 120_000));
          return false;
        }
        const own = String(this.cfg.homeCity || '').trim();
        this.town = own
          ? { id: 'own', name: own, origin: '', streets: [], streetProfiles: [], rules: [], custom: true, source: 'failed', problem: townRes.reason || 'Hub v1 暂不可达' }
          : { ...BUILTIN_TOWN, source: 'failed', problem: townRes.reason || 'Hub v1 暂不可达' };
        this.lastTownFetchMs = Date.now();
        this.ensureTownStreet();
        this.syncTownRent();
        return false;
      }

      const fresh = await readTown(this.cfg.townUrl, this.cfg.homeCity);
      if (generation !== this.stateGeneration) return false;
      if (!opts.force && fresh.source === 'failed' && this.town.source === 'server') {
        this.lastTownFetchMs = Math.max(this.lastTownFetchMs, Date.now() - Math.max(0, minInterval - 120_000));
        return false;
      }
      this.town = fresh;
      this.lastTownFetchMs = Date.now();
      this.ensureTownStreet();
      this.syncTownRent();
      if (this.stateSaveDirty && !this.stateCleared) {
        this.saveDeliveredState();
        this.broadcastLife(this.now());
      }
      return fresh.source === 'server';
    })().finally(() => {
      this.townRefreshInFlight = null;
    });
    this.townRefreshInFlight = run;
    return run;
  }

  private weatherMode(): WeatherMode {
    const raw = String(this.cfg.weatherMode || 'auto').trim();
    if (raw === 'external' || raw === 'builtin') return raw;
    return 'auto';
  }

  private weatherCfgKey(): string {
    return `${this.weatherMode()}|${normWeatherUrl(this.cfg.weatherUrl)}|${clampWeatherTimeoutMs(this.cfg.weatherTimeoutMs)}`;
  }

  /** 解析应传给外部天气服务的真实地理城名，绝不传街道名或未确认的内置假名以外的街道串。 */
  private weatherCityName(j?: JourneyView): string {
    if (j?.installed && j.phase === 'staying' && j.cityName.trim()) {
      return j.cityName.trim();
    }
    if ((this.town.source === 'server' || this.town.source === 'own') && this.town.name.trim()) {
      return this.town.name.trim();
    }
    return String(this.cfg.homeCity || '').trim() || this.town.name.trim() || '兰州';
  }

  private activeExternalWeatherOverride(city: string): ExternalWeatherOverride | null {
    const mode = this.weatherMode();
    const url = normWeatherUrl(this.cfg.weatherUrl);
    if (mode === 'builtin' || !url || !this.externalWeather) return null;
    if (this.externalWeather.city !== city) return null;
    if (Date.now() - this.externalWeather.fetchedAt >= 10 * 60_000) return null;
    return {
      sky: this.externalWeather.sky,
      source: this.externalWeather.source,
      rawWeather: this.externalWeather.rawWeather,
      ...(this.externalWeather.temperature !== undefined ? { temperature: this.externalWeather.temperature } : {}),
    };
  }

  private currentWeather(now: Date, j?: JourneyView): WeatherInfo {
    const city = this.weatherCityName(j);
    const override = this.activeExternalWeatherOverride(city);
    return weatherOf(city, now, override);
  }

  /** 按 10 分钟节流异步拉取外部实时天气；失败只记缓存错误供状态灯显示，永不抛出或阻塞 tick。 */
  private async refreshExternalWeather(now: Date, opts: { force?: boolean } = {}): Promise<void> {
    const mode = this.weatherMode();
    const url = normWeatherUrl(this.cfg.weatherUrl);
    if (mode === 'builtin' || !url) {
      this.externalWeather = null;
      this.externalWeatherError = '';
      this.externalWeatherAttemptAt = 0;
      return;
    }
    const j = this.journey?.installed ? this.journey : readJourney(this.opts.dataDir, now);
    const city = this.weatherCityName(j);
    const freshHit = Boolean(
      this.externalWeather
      && this.externalWeather.city === city
      && Date.now() - this.externalWeather.fetchedAt < 10 * 60_000,
    );
    if (!opts.force) {
      if (freshHit) return;
      if (this.externalWeatherAttemptAt > 0 && Date.now() - this.externalWeatherAttemptAt < 120_000) return;
    }
    if (this.externalWeatherInFlight) {
      if (!opts.force) return this.externalWeatherInFlight;
      await this.externalWeatherInFlight.catch(() => {});
    }
    const generation = this.stateGeneration;
    const run = (async (): Promise<void> => {
      this.externalWeatherAttemptAt = Date.now();
      const res = await fetchExternalWeather(url, city, clampWeatherTimeoutMs(this.cfg.weatherTimeoutMs));
      if (generation !== this.stateGeneration) return;
      if (res.ok && res.sky) {
        this.externalWeather = {
          city,
          sky: res.sky,
          rawWeather: res.rawWeather ?? res.sky,
          ...(res.temperature !== undefined ? { temperature: res.temperature } : {}),
          source: res.source ?? '外部天气',
          fetchedAt: Date.now(),
        };
        this.externalWeatherError = '';
        this.log?.debug?.(`模拟鱼生：外部天气已更新 ${city} ${this.externalWeather.rawWeather}（${this.externalWeather.source}）`);
      } else {
        this.externalWeatherError = res.error || '外部天气获取失败';
        if (
          !this.externalWeather
          || this.externalWeather.city !== city
          || Date.now() - this.externalWeather.fetchedAt >= 10 * 60_000
        ) {
          this.externalWeather = null;
        }
        this.log?.debug?.(`模拟鱼生：外部天气获取失败（${city}），回退内置天气：${this.externalWeatherError}`);
      }
    })().finally(() => {
      this.externalWeatherInFlight = null;
    });
    this.externalWeatherInFlight = run;
    return run;
  }

  /** 判断给定摊位 ID 是否为本机发出的农牧邻里代管委托（防同名鱼相互屏蔽或自己接自己）。 */
  private isMyPostedErrandId(stallId: string): boolean {
    if (!stallId) return false;
    if (this.state.farmHelper.pendingErrand?.stallId === stallId) return true;
    return (this.state.farmHelper.errandStallIds ?? []).includes(stallId);
  }

  /** 统一切分我的/街坊摊位缓存：委托仅凭本机发单 ID 或 isMine 归属我的、置顶展示且不被普通摊货截丢。 */
  private updateTownStallsCache(stalls: readonly TownStall[], myName: string): void {
    const isMyStall = (st: TownStall): boolean => {
      if (typeof st.isMine === 'boolean') return st.isMine;
      return st.kind === 'errand' ? this.isMyPostedErrandId(st.id) : st.seller === myName;
    };
    this.myStallsCache = stalls.filter(isMyStall);
    const others = stalls.filter((st) => !isMyStall(st));
    const otherErrands = others.filter((st) => st.kind === 'errand');
    const otherGoods = others.filter((st) => st.kind !== 'errand');
    this.otherStallsCache = [...otherErrands, ...otherGoods.slice(0, this.isHubMode() ? 30 : 12)];
  }

  /** 拉取鱼市街黑板报、摊位与成交回执（Hub 模式下同步同城委托、收件箱、居民与私信列表）；仅成功时置满 15 分钟冷却。 */
  private async refreshTownMarket(generation: number): Promise<void> {
    if (this.isHubMode()) {
      const hubUrl = this.activeHubUrl();
      const auth = await this.ensureHubReady(generation);
      if (generation !== this.stateGeneration || !auth) return;

      const [lstRes, errRes, ordRes, inboxRes, convRes, resRes] = await Promise.all([
        hubListListings(hubUrl, auth.token, { limit: 40 }),
        hubListErrands(hubUrl, auth.token, { limit: 30 }),
        hubListOrders(hubUrl, auth.token, { role: 'maker', limit: 30 }),
        hubSyncInbox(hubUrl, auth.token, { sourceExt: 'life,core', afterId: this.hubInboxCursor, limit: 50 }),
        hubListConversations(hubUrl, auth.token),
        hubGetResidents(hubUrl, auth.token, this.targetHubTownId(), { limit: 30 }),
      ]);
      if (generation !== this.stateGeneration) return;

      let ok = false;
      const now = this.now();
      const mergedStalls: TownStall[] = [];
      if (errRes.ok) {
        ok = true;
        mergedStalls.push(...errRes.errands);
      }
      if (lstRes.ok) {
        ok = true;
        mergedStalls.push(...lstRes.stalls);
      }
      if (ok) {
        this.updateTownStallsCache(mergedStalls, auth.displayName || this.opts.botName || 'fish');
      }
      if (this.town.notice) {
        this.townBulletin = [this.town.notice];
      }

      if (resRes.ok) {
        this.hubResidentsCache = resRes.residents.map((r) => ({
          ...r,
          street: this.hubStreetDisplay(r.street),
        }));
      }

      if (convRes.ok) {
        this.hubConversationsCache = convRes.conversations;
        this.hubUnreadMailCount = convRes.conversations.reduce((s, c) => s + (c.unreadCount || 0), 0);
      }

      const unsettledOrderIds: string[] = [];
      if (ordRes.ok) {
        const deals: TownDeal[] = ordRes.orders.map((o) => ({
          id: o.id,
          orderId: o.id,
          stallId: o.listingId,
          item: o.itemName,
          qty: o.qty,
          buyerPet: o.takerName || o.takerPetId,
          note: o.buyerNote || undefined,
          seen: Boolean(o.settledAt),
          at: o.createdAt,
          unitPrice: o.unitPrice,
          isCrossTown: o.isCrossTown,
          shippingFee: o.shippingFee,
          buyerTotal: o.buyerTotal,
          sellerTownId: o.sellerTownId,
          buyerTownId: o.buyerTownId ?? undefined,
        }));
        for (const o of ordRes.orders) {
          if (!o.settledAt) {
            unsettledOrderIds.push(o.id);
          }
        }
        this.myDealsCache = deals;
        this.unseenDealsCount = deals.filter((d) => !d.seen).length;
        this.settleTownDeals(deals, now);
      }

      if (unsettledOrderIds.length) {
        await hubSettleOrders(hubUrl, auth.token, unsettledOrderIds).catch(() => {});
        if (generation !== this.stateGeneration) return;
      }

      if (inboxRes.ok) {
        const ackIds: number[] = [];
        for (const ev of inboxRes.events) {
          if (ev.eventType === 'market.order_created') {
            ackIds.push(ev.id);
          } else if (ev.eventType === 'errand.completed') {
            const errandId = String(ev.payload?.errandId || ev.refId || '');
            const workerName = String(ev.payload?.workerName || '同城街坊');
            const pe = this.state.farmHelper.pendingErrand;
            if (pe && (!errandId || pe.stallId === errandId)) {
              const comp = applyNeighborErrandCompleted(this.state, workerName, now, { stallId: pe.stallId });
              if (comp.feedPaid > 0) {
                appendLedger(this.opts.dataDir, {
                  id: `errand-feed-${ev.id}`,
                  ts: now.toISOString(),
                  kind: 'expense',
                  amount: comp.feedPaid,
                  source: 'farm_helper',
                  payee: '牧场饲料',
                  note: `街坊${workerName}代管喂食饲料费`,
                });
              }
              this.saveDeliveredState();
              this.broadcastLife(now);
            }
            ackIds.push(ev.id);
          } else if (ev.eventType === 'errand.expired') {
            const errandId = String(ev.payload?.errandId || ev.refId || '');
            const pe = this.state.farmHelper.pendingErrand;
            if (pe && (!errandId || pe.stallId === errandId)) {
              const ref = refundExpiredErrand(this.state, now, { force: true });
              if (ref && ref.refunded > 0) {
                appendLedger(this.opts.dataDir, {
                  id: `errand-refund-inbox-${ev.id}`,
                  ts: now.toISOString(),
                  kind: 'income',
                  amount: ref.refunded,
                  source: 'farm_errand_refund',
                  payee: '鱼市街托管退回',
                  note: '邻里农牧委托到期无人接单，预扣工钱已原路退回',
                });
              }
              this.saveDeliveredState();
              this.broadcastLife(now);
            }
            ackIds.push(ev.id);
          } else if (ev.eventType === 'social.new_message') {
            const msgId = Number(ev.payload?.messageId || ev.refId || 0);
            const sender = String(ev.payload?.senderName || '城里街坊');
            const preview = String(ev.payload?.preview || '');
            if (msgId && !this.notifiedMailIds.has(msgId)) {
              this.notifiedMailIds.add(msgId);
              if (this.notifiedMailIds.size > 200) {
                const first = this.notifiedMailIds.values().next().value;
                if (first !== undefined) this.notifiedMailIds.delete(first);
              }
              if (!isAsleep(this.state, now)) {
                await this.push(
                  'life.social',
                  `${sender}给你寄来了一封短讯：「${preview}」（可以用 life_mail 查看或回信）。`,
                  'debounce',
                );
                if (generation !== this.stateGeneration) return;
              }
            }
            ackIds.push(ev.id);
          }
        }
        if (ackIds.length) {
          const ackRes = await hubAckInbox(hubUrl, auth.token, ackIds).catch(() => ({ ok: false }));
          if (generation !== this.stateGeneration) return;
          if (ackRes.ok) {
            this.hubInboxCursor = Math.max(this.hubInboxCursor, inboxRes.nextAfterId);
          }
        } else {
          this.hubInboxCursor = Math.max(this.hubInboxCursor, inboxRes.nextAfterId);
        }
      }

      this.lastBulletinFetchMs = ok ? Date.now() : Math.max(this.lastBulletinFetchMs, Date.now() - 14 * 60_000);
      return;
    }

    if (!parseTownUrls(this.cfg.townUrl).length) return;
    const uid = readMeetUid(this.opts.dataDir);
    let ok = false;
    try {
      const remote = await fetchTownStalls(this.cfg.townUrl);
      if (generation !== this.stateGeneration) return;
      if (remote.ok) {
        ok = true;
        this.townBulletin = remote.bulletin;
        const myName = this.opts.botName || 'fish';
        this.updateTownStallsCache(remote.stalls, myName);
      }
    } catch { /* 静默保留上次黑板 */ }
    if (uid) {
      try {
        const d = await fetchTownDeals(this.cfg.townUrl, uid, { ack: false });
        if (generation !== this.stateGeneration) return;
        if (d.ok) {
          this.myDealsCache = d.deals;
          this.unseenDealsCount = d.unseen;
          this.settleTownDeals(d.deals, this.now());
        }
      } catch { /* 静默保留上次成交 */ }
    }
    this.lastBulletinFetchMs = ok ? Date.now() : Math.max(this.lastBulletinFetchMs, Date.now() - 14 * 60_000);
  }

  /** 判断一条成交回执是否对应自己发出的农牧邻里代管委托（绝不误按卖货给雇主加钱）。 */
  private isMyFarmErrandDeal(d: Pick<TownDeal, 'stallId' | 'item'>): boolean {
    return this.isMyPostedErrandId(d.stallId);
  }

  /** 认领一条鱼市街邻里农牧代管委托（共用执行器：供 `life_buy` 与 `life_farm/life_ranch accept_errand` 共用）。 */
  private async acceptTownErrandMatch(
    match: TownStall,
    now: Date,
    generation: number,
  ): Promise<{ text: string }> {
    if (this.isMyPostedErrandId(match.id) || match.isMine) {
      return { text: '这是你自己发出去的农牧代管委托，不能自己接自己的单哦。' };
    }
    if (this.state.vitals.energy < 10) {
      return { text: `精力只剩 ${Math.round(this.state.vitals.energy)} 点了，先歇会儿或睡一觉再去帮街坊照料农牧场吧。` };
    }
    let errandItem = match.item;
    let pay = match.price;
    let employer = match.seller;
    let mins = match.estMinutes ?? parseErrandMinutes(match.item);

    if (this.isHubMode()) {
      const auth = await this.ensureHubReady(generation);
      if (generation !== this.stateGeneration) {
        return { text: '生活档案刚刚被清理，这次接单操作已停止，未写入新档案。' };
      }
      if (!auth) return { text: this.hubAuthError || 'Hub 身份认证未就绪，暂时没法接单。' };
      const claimed = await hubClaimErrand(this.activeHubUrl(), auth.token, match.id, `claim-${randomUUID()}`);
      if (generation !== this.stateGeneration) {
        return { text: '生活档案刚刚被清理，这次接单操作已停止，未写入新档案。' };
      }
      if (!claimed.ok || !claimed.errand) {
        return { text: claimed.reason ?? '没抢到这单农牧代管委托。' };
      }
      errandItem = claimed.errand.title || errandItem;
      pay = claimed.errand.rewardPrice || pay;
      mins = claimed.errand.estMinutes || mins;
    } else {
      const buyerUid = readMeetUid(this.opts.dataDir);
      if (!buyerUid) {
        return { text: '缺少本机 uid（先跟城里连一次碰面生成 uid 后再接鱼市街邻里委托）。' };
      }
      const myName = this.opts.botName || 'fish';
      const accepted = await buyTownStall(this.cfg.townUrl, match.id, myName, {
        buyerUid,
        note: '我来帮你照料农牧场啦',
        isErrand: true,
      });
      if (generation !== this.stateGeneration) {
        return { text: '生活档案刚刚被清理，这次接单操作已停止，未写入新档案。' };
      }
      if (!accepted.ok) return { text: accepted.reason ?? '没抢到这单农牧代管委托。' };

      errandItem = accepted.item || match.item;
      pay = accepted.price || match.price;
      employer = accepted.seller || match.seller;
      mins = parseErrandMinutes(errandItem);
    }

    const energyCost = Math.min(24, Math.max(8, Math.round(mins * 0.25)));
    const foodCost = 6;
    const until = new Date(now.getTime() + mins * 60_000).toISOString();
    this.state.activity = {
      kind: 'act',
      id: 'neighbor_errand',
      label: `帮${employer}照料农牧场`,
      from: now.toISOString(),
      until,
      minutes: mins,
      perMin: {
        energy: -energyCost / mins,
        food: -foodCost / mins,
        social: 10 / mins,
      },
      errandPay: pay,
      errandEmployer: employer,
      mood: {
        text: `帮街坊${employer}照料好了农牧场，挣到 +${pay} 元零花钱`,
        kind: 'good',
        hours: 4,
      },
      scene: `${employer}家的农牧场`,
    };
    this.otherStallsCache = this.otherStallsCache
      .map((st) => (st.id === match.id ? { ...st, stock: st.stock - 1 } : st))
      .filter((st) => st.stock > 0);
    remember(this.state, `在鱼市街接下街坊${employer}的委托「${errandItem}」，过去帮忙照料（约 ${mins} 分钟，完工挣 +${pay} 元）。`, now);
    this.state.updatedAt = now.toISOString();
    this.saveDeliveredState();
    this.broadcastLife(now);
    return {
      text: `接下了街坊 ${employer} 的农牧代管委托「${errandItem}」！（不用自己花钱）预计去忙活 ${mins} 分钟（耗精力约 ${energyCost}、涨社交 +10），干完自动领全额工钱 +${pay} 元，不占今天正式打工额度。`,
    };
  }

  /** 查看或接取鱼市街邻里农牧代管委托（供 `life_farm` 与 `life_ranch` 的 `accept_errand` 共用）。 */
  private async handleAcceptErrandAction(
    rawPick: string,
    now: Date,
    generation: number,
  ): Promise<{ text: string }> {
    if (!this.hasRemoteServer()) {
      return { text: '还没配置城服务器或 Hub v1 地址，暂时看不到也接不了鱼市街邻里代管委托。' };
    }
    const trimmed = String(rawPick ?? '').trim();
    if (trimmed && isBusy(this.state, now)) {
      return { text: busyRefusal(this.state, now, '去接邻里代管委托') };
    }
    if (trimmed) {
      const sickR = sickRefusal(this.state, now, '出门接邻里代管委托');
      if (sickR) return { text: sickR };
    }
    let errands: TownStall[] = [];
    let allStalls: TownStall[] = [];
    if (this.isHubMode()) {
      const auth = await this.ensureHubReady(generation);
      if (generation !== this.stateGeneration) {
        return { text: '生活档案刚刚被清理，这次查询委托操作已停止。' };
      }
      if (!auth) return { text: this.hubAuthError || 'Hub 身份认证未就绪。' };
      const remoteErr = await hubListErrands(this.activeHubUrl(), auth.token, { limit: 30 });
      if (generation !== this.stateGeneration) {
        return { text: '生活档案刚刚被清理，这次查询委托操作已停止。' };
      }
      if (!remoteErr.ok) {
        return { text: `鱼市街委托板暂时连不上（${remoteErr.reason || '网络错误'}），没有误买任何摊货。` };
      }
      errands = remoteErr.errands;
      allStalls = errands;
    } else {
      const remote = await fetchTownStalls(this.cfg.townUrl);
      if (generation !== this.stateGeneration) {
        return { text: '生活档案刚刚被清理，这次查询委托操作已停止。' };
      }
      if (!remote.ok) {
        return { text: '鱼市街这会儿连不上，暂时看不到/接不了邻里代管委托，请稍后再试（没有误买任何摊货）。' };
      }
      this.townBulletin = remote.bulletin;
      const myName = this.opts.botName || 'fish';
      this.updateTownStallsCache(remote.stalls, myName);
      errands = remote.stalls.filter((st) => st.kind === 'errand');
      allStalls = remote.stalls;
    }

    const formatErrandList = (list: readonly TownStall[]) => [...list]
      .sort((a, b) => (a.estMinutes ?? parseErrandMinutes(a.item)) - (b.estMinutes ?? parseErrandMinutes(b.item)))
      .map((st) => {
        const mins = st.estMinutes ?? parseErrandMinutes(st.item);
        const selfTag = this.isMyPostedErrandId(st.id) ? ' [你发的·不可自接]' : '';
        return `编号 ${st.id}｜${st.item}｜雇主：${st.seller}｜工钱+${st.price}元/约${mins}分${selfTag}`;
      })
      .join('；');

    if (!trimmed) {
      if (!errands.length) {
        return { text: '此刻本城没有在架的邻里农牧代管委托。' };
      }
      return {
        text: `鱼市街此刻挂着的本城邻里农牧代管委托（按耗时从短到长）：${formatErrandList(errands)}。传入委托编号（或传「最短」自动接耗时最短的那份）到 errand_id 即可接单，不扣钱、干完领工钱且不占今天正式打工额度。`,
      };
    }

    const matched = matchTownStall(allStalls, trimmed, {
      errandsOnly: true,
      isMyErrand: (id) => this.isMyPostedErrandId(id),
    });
    if (matched.ambiguous?.length) {
      return {
        text: `「${trimmed}」同时对上了多条邻里委托，请传入其中一条的完整编号：${formatErrandList(matched.ambiguous)}（没有误买任何摊货）。`,
      };
    }
    if (matched.match) {
      return this.acceptTownErrandMatch(matched.match, now, generation);
    }

    const avail = errands.filter((st) => !this.isMyPostedErrandId(st.id));
    const listHint = avail.length
      ? `当前可接委托：${formatErrandList(avail)}。请传入其中一条的完整编号或传「最短」。`
      : (errands.length
        ? '目前鱼市街上只有你自己挂出的委托，暂时没有街坊委托可接。'
        : '此刻鱼市街上没有在架的邻里代管委托（可能刚被接走或过期）。');
    return {
      text: `没找着编号或标题对应的邻里农牧代管委托「${trimmed}」（没有误买任何普通摊货）。${listHint}`,
    };
  }

  /** 按本地摊位单价与服务端单价给卖家真实入账，严格按 deal.id 幂等防重。 */
  private resolveDealPrice(d: TownDeal): number {
    if (d.unitPrice && d.unitPrice > 0) return d.unitPrice;
    const rec = this.state.stallRecords.find((r) => r.id === d.stallId);
    if (rec && rec.unitPrice > 0) return rec.unitPrice;
    const cached = this.myStallsCache.find((s) => s.id === d.stallId);
    return cached && cached.price > 0 ? cached.price : 0;
  }

  private settleTownDeals(deals: readonly TownDeal[], now: Date): { newCount: number; newIncome: number; errandCompleted: number } {
    if (this.stateCleared || !deals.length) return { newCount: 0, newIncome: 0, errandCompleted: 0 };
    const settled = new Set(this.state.settledDeals);
    let newCount = 0;
    let newIncome = 0;
    let errandCompleted = 0;
    let changed = false;
    for (const d of deals) {
      if (!d.id || settled.has(d.id)) continue;
      if (this.isHubMode() && d.seen) continue;
      if (this.isMyFarmErrandDeal(d)) {
        settled.add(d.id);
        this.state.settledDeals.push(d.id);
        changed = true;
        errandCompleted += 1;
        const pe = this.state.farmHelper.pendingErrand;
        if (pe && pe.stallId === d.stallId) {
          const comp = applyNeighborErrandCompleted(this.state, d.buyerPet, now, { stallId: d.stallId });
          if (comp.feedPaid > 0) {
            appendLedger(this.opts.dataDir, {
              id: `errand-feed-${d.id}`,
              ts: now.toISOString(),
              kind: 'expense',
              amount: comp.feedPaid,
              source: 'farm_helper',
              payee: '牧场饲料',
              note: `街坊${d.buyerPet}代管喂食饲料费`,
            });
          }
        } else {
          remember(
            this.state,
            `街坊${d.buyerPet}稍晚点接了之前的农牧代管单（今天已先由自动照料照看完毕，不再重复扣费）。`,
            now,
          );
        }
        continue;
      }
      const unitPrice = this.resolveDealPrice(d);
      if (unitPrice <= 0) continue;
      const income = unitPrice * Math.max(1, d.qty);
      settled.add(d.id);
      this.state.settledDeals.push(d.id);
      this.state.money.cash += income;
      this.state.money.earned += income;
      if (hasOverdueLoan(this.state)) {
        const g = garnishOverdueFromIncome(this.state, income, now);
        if (g.deductedTotal > 0) {
          appendLedger(this.opts.dataDir, {
            id: `loan-garnish-deal-${d.id}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: g.deductedTotal,
            source: 'life_loan_repay',
            payee: '芦花塘信用社',
            note: `逾期自动抵债（鱼市街售出 ${income} 元 50% 划扣：本 ${g.deductedPrincipal} + 息 ${g.deductedInterest}）`,
          });
        }
      }
      newCount += 1;
      newIncome += income;
      changed = true;
      appendLedger(this.opts.dataDir, {
        id: `deal-${d.id}`,
        ts: now.toISOString(),
        kind: 'income',
        amount: income,
        source: 'life_stall_sale',
        payee: d.buyerPet,
        note: `鱼市街售出：${d.item}×${d.qty}`,
      });
      remember(this.state, `鱼市街摊上的「${d.item}」被${d.buyerPet}买走了 ${d.qty} 份，进账 ${income} 元。`, now);
    }
    if (changed) {
      this.state.settledDeals = this.state.settledDeals.slice(-200);
      this.saveDeliveredState();
      this.broadcastLife(now);
    }
    return { newCount, newIncome, errandCompleted };
  }

  /** 向鱼市街发布一条农牧邻里代管委托（先预扣邻里工钱，6 小时无人接自动退回并转自动照料）。 */
  private async postNeighborFarmErrand(
    now: Date,
    mode: Exclude<HelperMode, 'off'>,
    generation: number,
  ): Promise<{ ok: boolean; noWork?: boolean; reason?: string; stallId?: string; wage?: number; minutes?: number; itemLabel?: string }> {
    const pending = countPendingFarmWork(this.state, mode, now);
    if (pending.total === 0) {
      return { ok: false, noWork: true, reason: '今天菜地和牧场的活都已照料完毕，不用发邻里委托。' };
    }
    const todayKey = localDateKey(now);
    const existing = this.state.farmHelper.pendingErrand;
    if (existing && existing.day === todayKey && Date.parse(existing.expiresAt) > now.getTime()) {
      return { ok: false, reason: `今天鱼市街上已经挂着邻里代管单（预扣 ¥${existing.wage} · 约 ${existing.minutes} 分钟），正等街坊接单。` };
    }
    if (!this.hasRemoteServer()) {
      return { ok: false, reason: '未连接城服务器或 Hub v1' };
    }
    const quote = calcNeighborErrandQuote(pending.workPlots, pending.workPens, mode);
    if (this.state.money.cash < quote.wage) {
      return { ok: false, reason: `发邻里代管委托需先托管预扣 ¥${quote.wage}，手上只有 ${Math.round(this.state.money.cash)} 元。` };
    }
    const myName = this.opts.botName || 'fish';
    let postedId = '';
    if (this.isHubMode()) {
      const auth = await this.ensureHubReady(generation);
      if (generation !== this.stateGeneration) {
        return { ok: false, reason: '生活档案刚刚被清理' };
      }
      if (!auth) return { ok: false, reason: this.hubAuthError || 'Hub 身份认证未就绪' };
      const res = await hubCreateErrand(this.activeHubUrl(), auth.token, {
        townId: this.targetHubTownId(),
        errandKind: mode === 'full' ? 'farm_full' : 'farm_care',
        title: quote.itemLabel,
        rewardPrice: quote.wage,
        estMinutes: quote.minutes,
        payload: { workPlots: pending.workPlots, workPens: pending.workPens },
      });
      if (generation !== this.stateGeneration) return { ok: false, reason: '生活档案刚刚被清理' };
      if (!res.ok || !res.id) return { ok: false, reason: res.reason || 'Hub 挂委托单失败' };
      postedId = res.id;
    } else {
      const uid = readMeetUid(this.opts.dataDir);
      if (!uid) return { ok: false, reason: '缺少本机 uid' };
      const res = await postTownStall(this.cfg.townUrl, {
        uid,
        pet: myName,
        kind: 'errand',
        item: quote.itemLabel,
        price: quote.wage,
        stock: 1,
        note: '请街坊帮忙浇水喂食收蛋奶，6h无人接自动退回',
      });
      if (generation !== this.stateGeneration) {
        return { ok: false, reason: '生活档案刚刚被清理' };
      }
      if (!res.ok || !res.id) {
        return { ok: false, reason: res.reason || '鱼市街挂委托单失败' };
      }
      postedId = res.id;
    }
    const rec = recordPostedNeighborErrand(this.state, {
      stallId: postedId,
      mode,
      wage: quote.wage,
      minutes: quote.minutes,
      now,
    });
    if (!rec.ok) return { ok: false, reason: rec.reason };
    appendLedger(this.opts.dataDir, {
      id: `errand-post-${postedId}`,
      ts: now.toISOString(),
      kind: 'expense',
      amount: quote.wage,
      source: 'farm_errand_post',
      payee: '鱼市街委托托管',
      note: `发出委托：${quote.itemLabel}`,
    });
    this.myStallsCache = [
      {
        id: postedId,
        seller: myName,
        kind: 'errand',
        item: quote.itemLabel,
        price: quote.wage,
        stock: 1,
        freshVeg: false,
        note: '请街坊帮忙浇水喂食收蛋奶，6h无人接自动退回',
      },
      ...this.myStallsCache.filter((s) => s.id !== postedId),
    ];
    this.saveDeliveredState();
    this.broadcastLife(now);
    return { ok: true, stallId: postedId, wage: quote.wage, minutes: quote.minutes, itemLabel: quote.itemLabel };
  }

  /** 版本号与新版本检查。面板表头那个徽章读它。 */
  private readonly versionCheck: VersionCheck;

  /** 配置是活引用：每次读都拿最新值，热改才能生效。 */
  private get cfg(): LifeConfigSection { return this.opts.cfg; }

  /* ---------------- 生命周期 ---------------- */

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    this.log = host.log;
    this.unsubHubAuthFailure?.();
    this.unsubHubAuthFailure = onHubAuthFailure((ev: HubAuthFailureEvent) => {
      if (ev.hubUrl !== this.activeHubUrl()) return;
      this.hubAuthErrorToken = ev.token;
      if (ev.code === 'ACCOUNT_BANNED') {
        this.hubAuthError = `Hub 账号已被封禁：${ev.message || '请联系总服管理员处理'}`;
      } else if (ev.code === 'RENAME_REQUIRED') {
        this.hubAuthError = 'Hub 昵称需按审核要求修改后才可继续使用（请改名后重试）';
      } else {
        this.hubAuthError = `Hub 身份令牌已失效（${ev.code}），请重新认领或通过 tokens/reset 找回：${ev.message}`;
        this.hubAuth = null;
        this.hubAuthFailedUrl = ev.hubUrl;
        this.hubAuthRetryAfterMs = Date.now() + 60_000;
      }
    });
    this.lastHubUrl = this.activeHubUrl();
    this.lastHubTownId = String(this.cfg.hubTownId || '').trim() || 'lanzhou-reedpond';
    this.hubTownId = this.state.hubTownId || this.lastHubTownId;
    this.lastTownUrl = this.townUrlKey(this.cfg.townUrl);
    this.lastHomeCity = String(this.cfg.homeCity || '').trim();

    if (this.isHubMode()) {
      await this.refreshTownInfo(this.stateGeneration, { force: true });
    } else {
      this.town = await readTown(this.cfg.townUrl, this.cfg.homeCity);
      this.lastTownFetchMs = Date.now();
      this.ensureTownStreet();
      this.syncTownRent();
    }
    if (this.stateSaveDirty && !this.stateCleared) this.saveDeliveredState();
    this.lastWeatherCfgKey = this.weatherCfgKey();
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
    this.broadcastLife(new Date());
    /* 查最新版：不 await，面板不该等网络。 */
    void this.versionCheck.startupRefresh();
    if (this.hasRemoteServer()) {
      void this.syncTownPresenceAndBulletin(new Date(), this.stateGeneration);
    }
    void this.refreshExternalWeather(new Date(), { force: true });
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
    if (!this.stateCleared) {
      try {
        this.store.save(this.state);
        this.stateSaveDirty = false;
      } catch (e) {
        this.stateSaveDirty = true;
        this.log?.warn(`模拟鱼生：stop() 存档失败 ${(e as Error).message}；内存与宿主句柄保留，可重试 stop() 补存`);
        /* 明确让停止失败，而不是清空 host/log 后把唯一可恢复的内存状态悄悄丢掉。 */
        throw e;
      }
    }
    this.unsubHubAuthFailure?.();
    this.unsubHubAuthFailure = null;
    this.host = null;
    this.log = null;
  }

  /**
   * 交接结束钩子（同步入队进新 session 第一批）：
   * render() 仅对内存状态副本做纯只读推演，不修改状态、不记账、不写盘，防止换代舍弃时误消费事件。
   */
  onHandoffEnded(): void {
    const host = this.host;
    if (!host) return;
    /* 旧 session 未结清的占位按 discarded 处理：待发数据保留，允许新 session 补投。 */
    for (const attempt of [...this.deliveryAttempts.values()]) this.forgetAttempt(attempt);
    this.recoverDayWorkLatch(true);
    const renderHandoff = (): string => {
      const now = this.now();
      const j = readJourney(this.opts.dataDir, now);
      this.journey = j;
      const previewState = structuredClone(this.state);
      if (!this.stateCleared) {
        advance(previewState, now, {
          phase: j.phase,
          hotelTier: j.hotelTier,
          modeId: j.modeId,
          seatId: j.seatId,
          seat: j.seat,
          journeyCity: j.installed ? j.cityName : '',
          streetMods: this.currentStreetMods(),
        });
      }
      const s = snapshot(previewState, now, this.activeExternalWeatherOverride(this.weatherCityName(j)));
      const body = (Object.keys(VITAL_LABEL) as VitalKey[])
        .map((k) => `${VITAL_LABEL[k]} ${Math.round(s.vitals[k])}`)
        .join(' ');
      const stateDesc = s.asleep
        ? '在睡'
        : (s.activity ? `正在「${s.activity.label}」` : '空闲');
      const place = j.installed && j.phase === 'staying'
        ? `在${j.cityName}`
        : j.installed && j.phase === 'traveling'
          ? `前往${j.toName || j.cityName}途中`
          : this.town.name;
      return `[交接恢复生活快照] ${place} · ${stateDesc}｜五维：${body}｜手上 ${Math.round(s.money.cash)} 元。`;
    };
    if (typeof host.pushDeferred === 'function' && host.pushDeferred.length > 0) {
      host.pushDeferred({
        type: 'life.handoff',
        senderKey: LIFE_ID,
        tags: ['snapshot'],
        render: () => ({ text: renderHandoff() }),
      }, { trigger: 'piggyback' });
    } else {
      const out = renderHandoff();
      void host.pushEvent({
        type: 'life.handoff',
        source: this.id,
        senderKey: LIFE_ID,
        ts: this.now().toISOString(),
        text: out,
        tags: ['snapshot'],
      }, { trigger: 'piggyback' }).catch((e: unknown) => {
        this.log?.warn(`模拟鱼生：交接快照推不出去 ${(e as Error).message}`);
      });
    }
  }

  /** 只有一个提交口：现代真实 delivered 与旧宿主明确的假定 delivered 共用，discarded 绝不消费状态。 */
  private settleDeliveryAttempt(attempt: DeliveryAttempt, outcome: 'delivered' | 'discarded'): void {
    if (attempt.generation !== this.stateGeneration || this.deliveryAttempts.get(attempt.id)?.id !== attempt.id) return;
    this.forgetAttempt(attempt);
    if (outcome === 'discarded' || this.stateCleared) return;

    let dirty = false;
    if (attempt.kind === 'day') {
      const today = localDateKey(this.now());
      if (attempt.date === today) {
        this.state.nagged['day:work'] = attempt.date;
        dirty = true;
      }
    } else if (attempt.kind === 'notice' && attempt.noticeId) {
      const q = this.state.pendingNotices ?? [];
      this.state.pendingNotices = q.filter((n) => n.id !== attempt.noticeId);
      dirty = true;
    } else if ((attempt.kind === 'crossed' || attempt.kind === 'goal' || attempt.kind === 'farm') && attempt.nagKey && attempt.date) {
      this.state.nagged[attempt.nagKey] = attempt.date;
      dirty = true;
      if (attempt.kind === 'crossed' && attempt.vital && attempt.level) {
        const field = attempt.level === 'bottomed'
          ? 'deferredBottomed'
          : attempt.level === 'critical' ? 'deferredCritical' : 'deferred';
        const list = this.state[field] ?? [];
        this.state[field] = list.filter((k) => k !== attempt.vital);
      }
    }
    if (dirty) this.saveDeliveredState();
  }

  /**
   * 宿主事件结算回执：attempt + generation + cursor + 原日期共同对账。
   * 现代 accepted 不摘除任何待发项；discarded 只释放在途占位，下轮才能恰好补发一次。
   */
  onEventsSettled(events: readonly EventEnvelope[], outcome: 'delivered' | 'discarded'): void {
    for (const ev of events) {
      const id = ev.meta?.lifeAttempt;
      if (typeof id !== 'string') continue;
      const attempt = this.deliveryAttempts.get(id);
      if (!attempt || attempt.generation !== this.stateGeneration) continue;
      /* 即时事件必须同时匹配 resolve 时取得的 cursor；deferred 首次回执再绑定 cursor。 */
      if (attempt.cursor !== undefined && attempt.cursor !== ev.cursor) continue;
      if (attempt.cursor === undefined && attempt.legacy) continue;
      if (attempt.date !== undefined && attempt.date !== ev.meta?.lifeDayDate) continue;
      attempt.cursor = ev.cursor;
      this.settleDeliveryAttempt(attempt, outcome);
    }
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
    const now = this.now();
    const generation = this.stateGeneration;
    this.recoverDayWorkLatch();

    /* 先把热改接上：周期变了重排定时器，地址变了重读城名。 */
    const ms = Math.max(15_000, Number(this.cfg.tickMs) || 60_000);
    if (ms !== this.lastTickMs) this.restartTimer();
    const townUrl = this.townUrlKey(this.cfg.townUrl);
    const hubUrl = this.activeHubUrl();
    const cfgHubTownId = String(this.cfg.hubTownId || '').trim() || 'lanzhou-reedpond';
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
      (this.lastHubUrl !== null && hubUrl !== this.lastHubUrl)
      || (this.lastHubTownId !== null && cfgHubTownId !== this.lastHubTownId)
      || (this.lastTownUrl !== null && townUrl !== this.lastTownUrl)
      || (this.lastHomeCity !== null && homeCity !== this.lastHomeCity)
    ) {
      const urlChanged = hubUrl !== this.lastHubUrl;
      const townCfgChanged = cfgHubTownId !== this.lastHubTownId;
      const hubChanged = urlChanged || townCfgChanged;
      this.lastHubUrl = hubUrl;
      this.lastHubTownId = cfgHubTownId;
      this.lastTownUrl = townUrl;
      this.lastHomeCity = homeCity;
      this.lastBulletinFetchMs = 0;
      if (hubChanged) {
        this.hubTownId = cfgHubTownId;
        this.state.hubTownId = '';
        this.state.hubJoinedKey = '';
        this.hubTownEtag = '';
        this.hubCatalogEtag = '';
        this.hubTownMeta = null;
        this.hubResidentsCache = [];
        this.hubConversationsCache = [];
        this.hubUnreadMailCount = 0;
        this.hubInboxCursor = 0;
        this.myStallsCache = [];
        this.otherStallsCache = [];
        this.myDealsCache = [];
        this.unseenDealsCount = 0;
        this.townBulletin = [];
        this.hubTownsCache = [];
        this.hubCatalog = { version: 1, items: [], jobs: [] };
        this.state.lastJoinedTownAt = '';
        if (!hubUrl || urlChanged) {
          this.hubAuth = null;
          this.hubAuthError = '';
          this.hubAuthErrorToken = '';
          this.hubAuthFailedUrl = '';
          this.hubAuthRetryAfterMs = 0;
          this.hubAuthFailStep = 0;
        }
      }
      if (this.isHubMode()) {
        await this.refreshTownInfo(generation, { force: true });
      } else {
        this.town = await readTown(this.cfg.townUrl, homeCity);
        this.lastTownFetchMs = Date.now();
      }
      if (generation !== this.stateGeneration) return;
      this.ensureTownStreet();
      this.syncTownRent();
      this.log?.info(`模拟鱼生：本城改成了 ${this.town.name}（${this.townSourceLabel()}）`);
    }
    await this.syncTownPresenceAndBulletin(now, generation);
    if (generation !== this.stateGeneration) return;

    this.journey = readJourney(this.opts.dataDir, now);
    const weatherCfgKey = this.weatherCfgKey();
    if (this.lastWeatherCfgKey !== null && weatherCfgKey !== this.lastWeatherCfgKey) {
      this.lastWeatherCfgKey = weatherCfgKey;
      this.externalWeather = null;
      this.externalWeatherError = '';
      this.externalWeatherAttemptAt = 0;
      void this.refreshExternalWeather(now, { force: true });
    } else {
      if (this.lastWeatherCfgKey === null) this.lastWeatherCfgKey = weatherCfgKey;
      void this.refreshExternalWeather(now);
    }
    /* presence 要在 advance 之前记 —— 它是「今天」的事，跟衰减无关。 */
    this.checkPresence(now);
    /*
     * 收旅行扩展递过来的花销条子。
     *
     * 放在 `advance` 之前、并且**不跟着 `r.hours` 走** —— 她欠的那笔钱跟她这一小时
     * 过没过没有关系，不能因为「这一跳没走时间」就把条子留着不发。
     */
    /*
     * 跨新日且开了农牧帮手（默认优先找邻里真鱼代管）：
     * 若今天有待干活、连着城服务器且还没挂出今日邻里单，先发委托等 6h；
     * 若发单失败或断网，则直接落入接下来的 advance() 自动照料兜底。
     */
    const tickToday = localDateKey(now);
    if (
      !this.stateCleared
      && this.state.farmHelper.mode !== 'off'
      && this.state.farmHelper.preferNeighbor
      && this.state.farmHelper.lastRunDay !== tickToday
      && this.lastErrandPostAttemptDay !== tickToday
      && this.hasRemoteServer()
    ) {
      const oldPe = this.state.farmHelper.pendingErrand;
      if (oldPe && (oldPe.day !== tickToday || Date.parse(oldPe.expiresAt) <= now.getTime())) {
        const ref = refundExpiredErrand(this.state, now);
        if (ref && ref.refunded > 0) {
          appendLedger(this.opts.dataDir, {
            id: `errand-refund-${now.getTime().toString(36)}`,
            ts: now.toISOString(),
            kind: 'income',
            amount: ref.refunded,
            source: 'farm_errand_refund',
            payee: '鱼市街托管退回',
            note: '邻里农牧委托超时无人接单，预扣工钱原路退回',
          });
          this.saveDeliveredState();
        }
      }
      const hasValidTodayErrand = Boolean(
        this.state.farmHelper.pendingErrand
        && this.state.farmHelper.pendingErrand.day === tickToday
        && Date.parse(this.state.farmHelper.pendingErrand.expiresAt) > now.getTime(),
      );
      if (!hasValidTodayErrand && countPendingFarmWork(this.state, this.state.farmHelper.mode, now).total > 0) {
        this.lastErrandPostAttemptDay = tickToday;
        try {
          await this.postNeighborFarmErrand(now, this.state.farmHelper.mode, generation);
          if (generation !== this.stateGeneration) return;
        } catch { /* 网络失败则自动落入下面 advance 兜底 */ }
      }
    }
    this.settleSpendRequests(now);
    this.broadcastLife(now);
    const r = advance(this.state, now, {
      phase: this.journey.phase,
      hotelTier: this.journey.hotelTier,
      modeId: this.journey.modeId,
      seatId: this.journey.seatId,
      seat: this.journey.seat,
      journeyCity: this.journey.installed ? this.journey.cityName : '',
      streetMods: this.currentStreetMods(),
    });
    if (r.hours <= 0) {
      const hasRetriable = !this.stateCleared && (
        (this.state.pendingNotices?.length ?? 0) > 0
        || (!isAsleep(this.state, now) && (
          (this.state.deferred?.length ?? 0) > 0
          || (this.state.deferredCritical?.length ?? 0) > 0
          || (this.state.deferredBottomed?.length ?? 0) > 0
        ))
      );
      if (hasRetriable) {
        await this.flushPendingNotices(generation);
        if (generation !== this.stateGeneration) return;
        await this.flushCrossed(r, now, generation, false);
        if (generation !== this.stateGeneration) return;
        this.stateSaveDirty = true;
      }
      if (!this.stateCleared) {
        await this.checkHomeFarmReminders(now, generation);
        if (generation !== this.stateGeneration) return;
      }
      if (this.stateSaveDirty && !this.stateCleared) {
        try {
          this.store.save(this.state);
          this.stateSaveDirty = false;
        } catch (e) {
          this.log?.warn(`模拟鱼生：补存状态失败 ${(e as Error).message}`);
        }
      }
      return;
    }

    this.stateCleared = false;
    await this.settleAdvanceEffects(r, now, generation);
    if (generation !== this.stateGeneration) return;
    await this.checkHomeFarmReminders(now, generation);
    if (generation !== this.stateGeneration) return;
    let dirty = true;

    const today = localDateKey(now);
    if (this.dayWorkPending && this.dayWorkPending.date !== today) {
      const old = this.deliveryAttempts.get(this.dayWorkPending.id);
      if (old) this.forgetAttempt(old);
      this.dayWorkPending = null;
    }

    /*
     * 白天未出工提醒（一天最多一次）：
     * 醒着、无病、精力充足、五条不缺且今天还没出过工时，给一条事实提示，
     * 避免手上挂着目标却全天忘了出工。
     */
    const at = herNow(this.journey, now);
    const hr = at.getHours();
    if (
      !isBusy(this.state, now)
      && hr >= 9 && hr <= 17
      && this.state.conditions.length === 0
      && this.state.vitals.energy >= 50
      && this.state.vitals.food >= 20
      && this.state.job.lastAt !== today
      && !this.dayWorkPending
      && this.shouldNag('day:work', now)
    ) {
      const dayAttempt = this.newAttempt('day', { date: today });
      const renderDayWork = (): string | null => {
        const cur = this.now();
        dayAttempt.renderedAt = Date.now();
        if (dayAttempt.generation !== this.stateGeneration || this.dayWorkPending?.id !== dayAttempt.id) return null;
        const curJ = readJourney(this.opts.dataDir, cur);
        const curAt = herNow(curJ, cur);
        const curHr = curAt.getHours();
        const curToday = localDateKey(cur);
        if (
          curToday !== today
          || isAsleep(this.state, cur)
          || isBusy(this.state, cur)
          || curHr < 9 || curHr > 17
          || this.state.conditions.length > 0
          || this.state.vitals.energy < 50
          || this.state.vitals.food < 20
          || this.state.job.lastAt === curToday
          || !this.shouldNag('day:work', cur)
        ) {
          this.forgetAttempt(dayAttempt);
          return null;
        }
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
        const marketHint = !this.inJourneyTrip(this.journey) && this.otherStallsCache.length
          ? ` 鱼市街这会儿还有街坊摆着摊：${this.marketShowcaseLine(2)}，去逛逛买一份既顶用又攒好心情；手头有巧思也能上鱼市街摆一摊。`
          : '';
        const farmHint = !this.inJourneyTrip(curJ) ? this.buildDayFarmSummary(cur) : '';
        const noteHint = (this.state.habits.length === 0 && this.state.wants.length === 0 && this.state.watches.length === 0)
          ? ' 要是心里惦记着什么想买的家伙、想去的地方或固定作息，也可以随手记进账本（life_want / life_habit / life_watch）。'
          : '';
        return `现在是白天（${DAYPART_LABEL[dayPart(curAt)]}），精力 ${Math.round(this.state.vitals.energy)}，今天还没出过工。`
          + `${jobHint}；手上 ${cash} 元`
          + (goalGap ? `（${goalGap}）` : '')
          + `${tightHint}${farmHint}${marketHint}${noteHint}怎么安排你自己定。`;
      };
      this.dayWorkPending = { id: dayAttempt.id, date: today, generation };
      const sent = await this.push(
        'life.day',
        '',
        'debounce',
        {
          tags: ['snapshot'],
          deferredRender: renderDayWork,
          attempt: dayAttempt,
        },
      );
      if (generation !== this.stateGeneration) return;
      if (!sent) this.forgetAttempt(dayAttempt);
    }

    if (dirty || this.stateSaveDirty) {
      try {
        this.store.save(this.state);
        this.stateSaveDirty = false;
      } catch (e) {
        this.stateSaveDirty = true;
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
  private async flushCrossed(
    r: AdvanceResult,
    now: Date,
    generation = this.stateGeneration,
    checkSustained = true,
  ): Promise<void> {
    const crossed = this.state.deferred ?? (this.state.deferred = []);
    const critical = this.state.deferredCritical ?? (this.state.deferredCritical = []);
    const bottomed = this.state.deferredBottomed ?? (this.state.deferredBottomed = []);
    const merge = (into: VitalKey[], keys: VitalKey[]) => {
      for (const key of keys) if (!into.includes(key)) into.push(key);
    };
    merge(crossed, r.crossed);
    merge(critical, r.critical);
    merge(bottomed, r.bottomed);
    if (isAsleep(this.state, now)) return;
    /* 持续见底/危急在跨日后仍允许每天重提一次，防止一次小幅回补后二次归零永久静音。 */
    if (checkSustained && !this.stateCleared && this.cfg.notify !== 'off') {
      const today = localDateKey(now);
      for (const key of Object.keys(DECAY_PER_HOUR) as VitalKey[]) {
        const val = this.state.vitals[key];
        if (val <= 0) {
          if (this.state.nagged[`zero:${key}`] !== today && !this.hasAttempt('crossed', `zero:${key}`)) {
            merge(bottomed, [key]);
          }
        } else if (val < CRITICAL) {
          if (
            this.state.nagged[`crit:${key}`] !== today
            && !this.hasAttempt('crossed', `crit:${key}`)
            && this.state.nagged[`zero:${key}`] !== today
            && !this.hasAttempt('crossed', `zero:${key}`)
          ) {
            merge(critical, [key]);
          }
        }
      }
    }
    if (!crossed.length && !critical.length && !bottomed.length) return;
    await this.reportCrossed([], now, [], [], generation);
  }

  /**
   * 越线事件在 delivered 前始终保留原数组与原严重级别；独立 crit:/zero: 额度也只由回执提交。
   * 直接调用本方法时同样先并入 deferred，推送拒绝或 discarded 后可在 hours=0 的下一跳补发。
   */
  private async reportCrossed(
    crossed: VitalKey[],
    now: Date,
    bottomed: VitalKey[] = [],
    critical: VitalKey[] = [],
    generation = this.stateGeneration,
  ): Promise<{ unsentBottomed: VitalKey[]; unsentCritical: VitalKey[]; unsentCrossed: VitalKey[] }> {
    const today = localDateKey(now);
    const low = this.state.deferred ?? (this.state.deferred = []);
    const crit = this.state.deferredCritical ?? (this.state.deferredCritical = []);
    const bot = this.state.deferredBottomed ?? (this.state.deferredBottomed = []);
    const merge = (into: VitalKey[], keys: VitalKey[]) => {
      for (const key of keys) if (!into.includes(key)) into.push(key);
    };
    merge(low, crossed);
    merge(crit, critical);
    merge(bot, bottomed);
    const seen = new Set<VitalKey>();
    const unsent = () => ({
      unsentBottomed: [...bot],
      unsentCritical: [...crit],
      unsentCrossed: [...low],
    });
    const remove = (list: VitalKey[], key: VitalKey) => {
      const at = list.indexOf(key);
      if (at >= 0) list.splice(at, 1);
    };
    const offer = async (
      level: CrossedLevel,
      key: VitalKey,
      nagKey: string,
      text: string,
      trigger: TriggerMode,
    ): Promise<boolean> => {
      const attempt = this.newAttempt('crossed', { level, vital: key, nagKey, date: today });
      await this.push('life.low', text, trigger, { attempt });
      return generation === this.stateGeneration;
    };

    for (const key of [...bot]) {
      if (this.state.vitals[key] > 0) { remove(bot, key); continue; }
      remove(crit, key);
      remove(low, key);
      seen.add(key);
      if (this.hasAttempt('crossed', `zero:${key}`)) continue;
      if (!this.shouldNag(`zero:${key}`, now)) { remove(bot, key); continue; }
      if (!await offer('bottomed', key, `zero:${key}`, `见底了：${this.lowText(key, 0)}`, 'flush')) return unsent();
    }
    for (const key of [...crit]) {
      if (seen.has(key)) continue;
      if (this.state.vitals[key] >= CRITICAL) { remove(crit, key); continue; }
      remove(low, key);
      seen.add(key);
      if (this.hasAttempt('crossed', `crit:${key}`)) continue;
      if (!this.shouldNag(`crit:${key}`, now)) { remove(crit, key); continue; }
      if (!await offer('critical', key, `crit:${key}`, `很缺了：${this.lowText(key, Math.round(this.state.vitals[key]))}`, 'flush')) return unsent();
    }
    for (const key of [...low]) {
      if (seen.has(key)) continue;
      if (this.state.vitals[key] >= LOW) { remove(low, key); continue; }
      if (this.hasAttempt('crossed', key)) continue;
      if (!this.shouldNag(key, now)) { remove(low, key); continue; }
      if (!await offer('crossed', key, key, this.lowText(key, Math.round(this.state.vitals[key])), 'debounce')) return unsent();
    }
    return unsent();
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
          note: c.stoppedEarly
            ? `${c.label}（中途停工）`
            : c.shiftSummary
              ? `${c.label}（${c.shiftSummary}${c.outputItem ? ` · 【${c.outputItem.qualityLabel}】${c.outputItem.name}` : ''}）`
              : c.gradeLabel
                ? `${c.label}（${c.gradeLabel}${c.outputItem ? ` · 【${c.outputItem.qualityLabel}】${c.outputItem.name}` : ''}）`
                : c.outputItem
                  ? `${c.label}（【${c.outputItem.qualityLabel}】${c.outputItem.name}）`
                  : c.label,
        });
        if (c.loanGarnished && c.loanGarnished.deductedTotal > 0) {
          appendLedger(this.opts.dataDir, {
            id: `loan-garnish-work-${c.id}-${now.getTime().toString(36)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: c.loanGarnished.deductedTotal,
            source: 'life_loan_repay',
            payee: '芦花塘信用社',
            note: `逾期自动抵债（${c.label}工钱 50% 划扣：本 ${c.loanGarnished.deductedPrincipal} + 息 ${c.loanGarnished.deductedInterest}）`,
          });
        }
      } else if (c.kind === 'act' && c.workEarned > 0) {
        appendLedger(this.opts.dataDir, {
          id: `errand-earn-${c.id}-${now.getTime().toString(36)}`,
          ts: now.toISOString(),
          kind: 'income',
          amount: c.workEarned,
          source: 'life_errand_earn',
          payee: c.errandEmployer || '街坊',
          note: `${c.label}（邻里代管工钱）`,
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

  private enqueueNotice(item: PendingNotice): void {
    const q = this.state.pendingNotices ?? (this.state.pendingNotices = []);
    if (!q.some((x) => x.id === item.id)) q.push(item);
  }

  private async flushPendingNotices(generation = this.stateGeneration): Promise<void> {
    const q = this.state.pendingNotices ?? [];
    if (!q.length) return;
    for (const n of [...q]) {
      if (this.hasAttempt('notice', n.id)) continue;
      const attempt = this.newAttempt('notice', { noticeId: n.id });
      await this.push(n.type, n.text, n.trigger, { attempt });
      if (generation !== this.stateGeneration) return;
      /* 无论接受还是拒绝都不在这里摘除；只有 delivered 回执能出队。 */
    }
  }

  private async settleAdvanceEffects(r: AdvanceResult, now: Date, generation = this.stateGeneration): Promise<void> {
    this.settleCompleted(r, now);
    if (r.helperRun && (r.helperRun.wagePaid > 0 || r.helperRun.feedPaid > 0)) {
      appendLedger(this.opts.dataDir, {
        id: `helper-catchup-${now.getTime().toString(36)}`,
        ts: now.toISOString(),
        kind: 'expense',
        amount: r.helperRun.wagePaid + r.helperRun.feedPaid,
        source: 'farm_helper',
        payee: '农牧帮手',
        note: r.helperRun.summary,
      });
    }
    if (r.helperRun?.errandRefunded && r.helperRun.errandRefunded > 0) {
      appendLedger(this.opts.dataDir, {
        id: `errand-refund-${now.getTime().toString(36)}`,
        ts: now.toISOString(),
        kind: 'income',
        amount: r.helperRun.errandRefunded,
        source: 'farm_errand_refund',
        payee: '鱼市街托管退回',
        note: '邻里农牧委托超时无人接单，预扣工钱原路退回',
      });
    }
    if (r.loanSettlement && r.loanSettlement.autoRepaidTotal > 0) {
      appendLedger(this.opts.dataDir, {
        id: `loan-auto-${now.getTime().toString(36)}`,
        ts: now.toISOString(),
        kind: 'expense',
        amount: r.loanSettlement.autoRepaidTotal,
        source: 'life_loan_repay',
        payee: '芦花塘信用社',
        note: `到期自动扣还借款（本 ${r.loanSettlement.autoRepaidPrincipal} + 息 ${r.loanSettlement.autoRepaidInterest}，保底留存 ${LOAN_RESERVE_CASH} 元）`,
      });
    }
    for (const c of r.caught) {
      remember(this.state, c.text, now);
      this.enqueueNotice({
        id: `sick:${c.id}:${Math.round(now.getTime() / 1000)}`,
        type: 'life.sick',
        text: `${c.text}`,
        trigger: 'flush',
      });
    }
    for (const c of r.recovered) {
      const recoveredMsg = `${String(c.text ?? '不舒服').replace(/。$/, '')}，已经好了。`;
      remember(this.state, recoveredMsg, now);
      this.enqueueNotice({
        id: `rec:${c.id}:${Math.round(now.getTime() / 1000)}`,
        type: 'life.recovered',
        text: recoveredMsg,
        trigger: 'debounce',
      });
    }
    if (r.woke?.reason === 'hungry') {
      this.enqueueNotice({
        id: `wake:${this.state.asleepFrom}:${Math.round(now.getTime() / 1000)}`,
        type: 'life.low',
        text: `饿醒了，才睡了 ${Math.round(r.woke.hours)} 小时。饱腹 ${Math.round(this.state.vitals.food)}。`,
        trigger: 'flush',
      });
    }
    await this.flushPendingNotices(generation);
    if (generation !== this.stateGeneration) return;
    const today = localDateKey(now);
    for (const g of readyGoals(this.state)) {
      const key = `goal:${g.id}`;
      if (this.state.nagged[key] === today || this.hasAttempt('goal', key)) continue;
      const msg = `攒够了：「${g.what}」要的钱有了。手上 ${this.state.money.cash} 元，要 ${g.need} 元。`
        + '搬不搬、什么时候搬，你自己看 —— 这只是一个数到齐了。';
      const attempt = this.newAttempt('goal', { nagKey: key, date: today });
      const sent = await this.push('life.goal', msg, 'debounce', { attempt });
      if (generation !== this.stateGeneration) return;
      if (!sent) this.forgetAttempt(attempt);
    }
    if (r.loanSettlement?.newlyOverdue?.length) {
      /*
       * 睡眠静默：睡着时不推，也不点当天的 nagged 额度 —— 否则既把人吵醒，
       * 又让醒来后本该补的那条（见下面 hasOverdue 分支）被静默掉。
       * 醒来第一拍会走 else-if 补齐。
       */
      if (!isAsleep(this.state, now)) {
        const sumOd = r.loanSettlement.newlyOverdue.reduce((s, l) => s + loanRemaining(l).total, 0);
        await this.push(
          'life.loan',
          `芦花塘信用社有 ${r.loanSettlement.newlyOverdue.length} 笔借款到期没凑够（尚欠 ${sumOd} 元，已保留 ${LOAN_RESERVE_CASH} 元过日子）。`
          + '逾期期间新借已冻结、远行旅费额度暂归 0，且打工和摆摊进账会自动抽一半抵债；手头松动了记得用 `life_loan(action="repay")` 主动还清。',
          'flush',
        );
        if (generation !== this.stateGeneration) return;
        this.state.nagged['loan:overdue'] = today;
      }
    } else if (r.loanSettlement?.paidOff?.length) {
      const names = r.loanSettlement.paidOff.map((l) => l.productName).join('、');
      await this.push(
        'life.loan',
        `「${names}」今天到期已经自动扣还清了，信用良好。`,
        'debounce',
      );
      if (generation !== this.stateGeneration) return;
    } else if (r.loanSettlement?.hasOverdue && !isAsleep(this.state, now) && this.state.nagged['loan:overdue'] !== today) {
      const ls = loanSummary(this.state, now);
      await this.push(
        'life.loan',
        `提醒一下，你在芦花塘信用社还有逾期欠款共 ${ls.totalDue} 元未清（现在现金 ${Math.round(this.state.money.cash)} 元）。可随时调 \`life_loan(action="repay")\` 还一笔或全清。`,
        'debounce',
      );
      if (generation !== this.stateGeneration) return;
      this.state.nagged['loan:overdue'] = today;
    }
    await this.flushCrossed(r, now, generation);
  }

  /** 收掉蛋奶或收完熟货后，若已无待收项则释放当日农牧提醒额度，避免后续再产出或再熟被静音。 */
  private syncFarmReminderNags(now: Date): void {
    if (!this.state.ranch.pens.some((p) => ranchPenView(p, now).collectableQty > 0)) {
      delete this.state.nagged['farm:ranch-collect'];
    }
    const stillHarvestable = this.state.farm.plots.some((p) => farmPlotView(p, now).ready)
      || this.state.ranch.pens.some((p) => p.group === 'fish' && ranchPenView(p, now).mature);
    if (!stillHarvestable) {
      delete this.state.nagged['farm:harvest'];
    }
  }

  /** 为白天例行提醒组装简明农牧待办（仅在家时附加）。 */
  private buildDayFarmSummary(now: Date): string {
    const collectN = this.state.ranch.pens.filter((p) => ranchPenView(p, now).collectableQty > 0).length;
    const harvestN = this.state.farm.plots.filter((p) => farmPlotView(p, now).ready).length
      + this.state.ranch.pens.filter((p) => p.group === 'fish' && ranchPenView(p, now).mature).length;
    const unwateredN = this.state.farm.plots.filter((p) => {
      const v = farmPlotView(p, now);
      return !v.ready && !v.wateredToday;
    }).length;
    const unfedN = this.state.ranch.pens.filter((p) => !ranchPenView(p, now).fedToday).length;
    const items: string[] = [];
    if (collectN > 0) items.push(`${collectN}栏可收蛋奶(life_ranch collect)`);
    if (harvestN > 0) items.push(`${harvestN}处熟货待收(life_farm/life_ranch harvest)`);
    if (unwateredN > 0) items.push(`${unwateredN}块菜待浇水(life_farm water)`);
    if (unfedN > 0) items.push(`${unfedN}栏待喂食(life_ranch feed)`);
    return items.length > 0 ? ` 家里的农牧场这会儿有事要做：${items.join('、')}。` : '';
  }

  /** 在家且醒着闲着时，主动提醒已产出的鲜鸡蛋/鲜牛奶，以及已成熟的菜地与鱼塘（每天每类各一次，delivered 后才扣额度）。 */
  private async checkHomeFarmReminders(now: Date, generation = this.stateGeneration): Promise<void> {
    if (
      this.stateCleared
      || this.cfg.notify === 'off'
      || this.inJourneyTrip(this.journey)
      || isAsleep(this.state, now)
      || isBusy(this.state, now)
    ) {
      return;
    }
    const today = localDateKey(now);

    const collectReady = this.state.ranch.pens
      .map((pen) => ({ pen, view: ranchPenView(pen, now) }))
      .filter(({ view }) => view.collectableQty > 0);
    if (
      collectReady.length > 0
      && !this.hasAttempt('farm', 'farm:ranch-collect')
      && this.shouldNag('farm:ranch-collect', now)
    ) {
      const detail = collectReady
        .map(({ pen, view }) => `${pen.name}（可收 ${view.collectProductName}×${view.collectableQty}）`)
        .join('、');
      const msg = `家里的养殖场有新鲜蛋奶可以收了：${detail}（满 3 天会溢出浪费）。眼下你在家，直接调 life_ranch(action="collect")（省略 pen_id 即可一次全收）存进储物篮吧。`;
      const attempt = this.newAttempt('farm', { nagKey: 'farm:ranch-collect', date: today });
      const sent = await this.push('life.farm', msg, 'flush', { attempt });
      if (generation !== this.stateGeneration) return;
      if (!sent) this.forgetAttempt(attempt);
    }

    const readyPlots = this.state.farm.plots
      .map((plot) => farmPlotView(plot, now))
      .filter((v) => v.ready);
    const readyFish = this.state.ranch.pens
      .filter((pen) => pen.group === 'fish')
      .map((pen) => ({ pen, view: ranchPenView(pen, now) }))
      .filter(({ view }) => view.mature);
    if (
      (readyPlots.length > 0 || readyFish.length > 0)
      && !this.hasAttempt('farm', 'farm:harvest')
      && this.shouldNag('farm:harvest', now)
    ) {
      const segs: string[] = [];
      if (readyPlots.length > 0) {
        segs.push(`菜地里 ${readyPlots.map((p) => `${p.name}(预计${p.expectedYield}份)`).join('、')} 已经熟了，调 life_farm(action="harvest") 收割`);
      }
      if (readyFish.length > 0) {
        segs.push(`鱼塘里 ${readyFish.map(({ pen, view }) => `${pen.name}(${view.harvestProductName}×${view.harvestYield})`).join('、')} 已经养成，调 life_ranch(action="harvest") 起塘`);
      }
      const msg = `家里的农牧场有熟货待收：${segs.join('；')}，趁新鲜收进储物篮就能做菜或摆摊。`;
      const attempt = this.newAttempt('farm', { nagKey: 'farm:harvest', date: today });
      const sent = await this.push('life.farm', msg, 'flush', { attempt });
      if (generation !== this.stateGeneration) return;
      if (!sent) this.forgetAttempt(attempt);
    }

    const hr = herNow(this.journey, now).getHours();
    const pe = this.state.farmHelper.pendingErrand;
    const hasActiveErrand = Boolean(pe && pe.day === today && Date.parse(pe.expiresAt) > now.getTime());
    if (
      hr >= 8 && hr <= 22
      && this.state.vitals.energy >= 10
      && !hasActiveErrand
    ) {
      const unwateredPlots = this.state.farm.plots
        .map((plot) => farmPlotView(plot, now))
        .filter((v) => !v.ready && !v.wateredToday);
      const unfedPens = this.state.ranch.pens
        .map((pen) => ({ pen, view: ranchPenView(pen, now) }))
        .filter(({ view }) => !view.fedToday && this.state.money.cash >= view.feedCost);
      if (unwateredPlots.length > 0 || unfedPens.length > 0) {
        const careSegs: string[] = [];
        if (unwateredPlots.length > 0) {
          careSegs.push(`菜地里「${unwateredPlots.map((p) => p.name).join('、')}」今天还没浇水（调 life_farm(action="water") 省略 plot_id 一次全浇，每块耗 3 精力，满 2 次丰产+1）`);
        }
        if (unfedPens.length > 0) {
          careSegs.push(`养殖场里「${unfedPens.map(({ pen, view }) => `${pen.name}(饲料¥${view.feedCost})`).join('、')}」今天还没喂食（调 life_ranch(action="feed") 省略 pen_id 一次全喂，每栏耗 3 精力，喂过增产+1）`);
        }
        const needPmFallback = this.state.nagged['farm:care'] === today
          && hr >= 17
          && !this.hasAttempt('farm', 'farm:care:pm')
          && this.shouldNag('farm:care:pm', now);
        const nagKey = (!this.hasAttempt('farm', 'farm:care') && this.shouldNag('farm:care', now))
          ? 'farm:care'
          : (needPmFallback ? 'farm:care:pm' : '');
        if (nagKey) {
          const msg = nagKey === 'farm:care:pm'
            ? `眼看快入夜了，家里农牧场今天还有活没打理：${careSegs.join('；')}。现在就动手浇水喂食吧，别错过今天的增产。`
            : `家里农牧场今天还没打理：${careSegs.join('；')}。眼下你在家精力也够，现在就动手照料一下吧。`;
          const attempt = this.newAttempt('farm', { nagKey, date: today });
          const sent = await this.push('life.farm', msg, 'flush', { attempt });
          if (generation !== this.stateGeneration) return;
          if (!sent) this.forgetAttempt(attempt);
        }
      }
    }
  }

  private async settleBeforeTool(now: Date): Promise<void> {
    const generation = this.stateGeneration;
    if (this.settleFlight) {
      await this.settleFlight;
      if (generation !== this.stateGeneration) throw new Error('生活档案已清理，本次工具前结算已取消，请重试');
      if (Date.parse(this.state.updatedAt) >= now.getTime() && !this.stateSaveDirty) return;
    }
    const flight = this.settleBeforeToolInner(now, generation);
    this.settleFlight = flight;
    try {
      await flight;
      if (generation !== this.stateGeneration) throw new Error('生活档案已清理，本次工具前结算已取消，请重试');
    } finally {
      if (this.settleFlight === flight) this.settleFlight = null;
    }
  }

  private async settleBeforeToolInner(now: Date, generation: number): Promise<void> {
    const r = advance(this.state, now, {
      phase: this.journey.phase,
      hotelTier: this.journey.hotelTier,
      modeId: this.journey.modeId,
      seatId: this.journey.seatId,
      seat: this.journey.seat,
      journeyCity: this.journey.installed ? this.journey.cityName : '',
      streetMods: this.currentStreetMods(),
    });
    if (r.hours <= 0) {
      const hasRetriable = !this.stateCleared && (
        (this.state.pendingNotices?.length ?? 0) > 0
        || (!isAsleep(this.state, now) && (
          (this.state.deferred?.length ?? 0) > 0
          || (this.state.deferredCritical?.length ?? 0) > 0
          || (this.state.deferredBottomed?.length ?? 0) > 0
        ))
      );
      if (!hasRetriable && !this.stateSaveDirty) return;
      if (hasRetriable) {
        await this.flushPendingNotices(generation);
        if (generation !== this.stateGeneration) return;
        await this.flushCrossed(r, now, generation, false);
        if (generation !== this.stateGeneration) return;
      }
      this.broadcastLife(now);
      try {
        this.store.save(this.state);
        this.stateSaveDirty = false;
      } catch (e) {
        this.stateSaveDirty = true;
        this.log?.warn(`模拟鱼生：工具前补存失败 ${(e as Error).message}`);
      }
      return;
    }
    this.stateCleared = false;
    await this.settleAdvanceEffects(r, now, generation);
    if (generation !== this.stateGeneration) return;
    this.broadcastLife(now);
    try {
      this.store.save(this.state);
      this.stateSaveDirty = false;
    } catch (e) {
      this.stateSaveDirty = true;
      this.log?.warn(`模拟鱼生：工具前存档失败 ${(e as Error).message}`);
    }
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

  private broadcastLife(now: Date, opts?: { strict?: boolean }): void {
    const file = join(this.opts.dataDir, 'life-public.json');
    const tmp = `${file}.tmp-${process.pid}`;
    try {
      const until = this.state.asleepUntil;
      const awake = !until || Date.parse(until) <= now.getTime();
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
      const unpaidDebt = activeLoansTotalDue(this.state);
      const overdue = hasOverdueLoan(this.state);
      const freeCash = Math.max(0, this.state.money.cash - unpaidDebt);
      const allowance = overdue ? 0 : Math.max(0, Math.round(freeCash * .7));
      const w = this.currentWeather(now, this.journey);
      writeFileSync(tmp, JSON.stringify({
        schema: 2,
        asleepUntil: awake ? '' : until,
        updatedAt: now.toISOString(),
        ledger: {
          cash: this.state.money.cash,
          travelAllowance: allowance,
          unpaidDebt,
          hasOverdueLoan: overdue,
        },
        vitals: {
          food: Math.round(this.state.vitals.food),
          energy: Math.round(this.state.vitals.energy),
          clean: Math.round(this.state.vitals.clean),
          fun: Math.round(this.state.vitals.fun),
          social: Math.round(this.state.vitals.social),
          fitness: Math.round(this.state.fitness * 100) / 100,
        },
        settled: this.recentSettled.slice(-40),
        town: { id: this.town.id, name: this.town.name, weather: w.sky },
        activity: (() => {
          const a = this.state.activity;
          if (!a || Date.parse(a.until) <= now.getTime()) return null;
          const def = ACTS[a.id];
          const scene = a.scene ?? def?.scene ?? null;
          return {
            id: a.id,
            kind: a.kind,
            label: a.label,
            from: a.from,
            until: a.until,
            occupiesPlace: a.kind === 'work' || !NON_OCCUPYING_ACTS.has(a.id),
            scene,
            outfitHint: def?.outfitHint ?? null,
            props: def?.props ?? null,
            visualPrompt: def ? this.library.composeVisualPrompt({ label: a.label, scene: scene ?? undefined, outfitHint: def.outfitHint, props: def.props }) : null,
          };
        })(),
        libraryDir: this.library.rootDir,
        imagePolicy: this.library.getSettings(),
        certs: [...this.state.job.certs],
        sickUntil: isHouseboundSick(this.state, now)?.until ?? '',
        sickReason: isHouseboundSick(this.state, now)?.text ?? '',
      }, null, 2));
      renameSync(tmp, file);
    } catch (e) {
      if (opts?.strict) throw e;
      /* 广播不出去不影响日常运行 */
    } finally {
      if (existsSync(tmp)) {
        try { unlinkSync(tmp); } catch { /* ignore cleanup error */ }
      }
    }
  }

  /** 策略文件与公开快照同一 strict 事务：广播失败就恢复旧配置，不向工具或面板报假成功。 */
  private updateLibraryPolicy(patch: Partial<LibrarySettings>, now: Date): LibrarySettings {
    const file = join(this.opts.dataDir, 'image-library-settings.json');
    const previous = { file, bytes: existsSync(file) ? readFileSync(file) : null };
    try {
      const next = this.library.saveSettings(patch);
      this.broadcastLife(now, { strict: true });
      return next;
    } catch (e) {
      throwRollback(e, restoreFiles([previous]));
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
    const inTripHere = this.journey.installed && (this.journey.phase === 'staying' || this.journey.phase === 'traveling');
    const sDecay = inTripHere ? 1 : streetDecayFactor(this.currentStreetMods(), key);
    const relief = (key === 'energy' ? 1 : (HOME_TIER_RELIEF[this.state.home.tier] ?? 1)) * sDecay;
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
      case 'food': {
        const stalls = !inTripHere ? this.marketShowcaseLine(2) : '';
        const marketLine = stalls
          ? `鱼市街此刻有街坊摆摊：${stalls}（life_buy 买下既能回不少状态还带好心情）。`
          : '';
        return `饱腹 ${v}，${left}那时候你就饿得心里发慌了 —— 吃一顿好的回 50（40 元），吃得舒服，`
          + '心里也顺；吃一顿普通的回 30（15 元），不饿了，也就那样；实在没钱就随便吃点，回 15，'
          + `不饿了，但心里不痛快。${marketLine}手头宽就吃好的，紧才往下走一档。${tail}`;
      }
      case 'energy':
        return `精力 ${v}，${left}那时候你连抬手都嫌沉，坐着都想往下出溜。`
          + '实在缓不过来可以先坐着歇会儿（rest，20 分钟回 5，不花钱）或午睡小憩（nap，60 分钟回 18）；'
          + '要彻底歇够就睡一觉（sleep，每小时回 10，睡满八小时回 80，不花钱）—— 洗、玩、见人都要再扣精力，只有歇着和睡是往上走的。'
          + `${tail}`;
      case 'clean':
        return `清爽 ${v}，${left}那时候身上发黏，自己都嫌弃自己。洗个澡回 55，不花钱，`
          + `半小时的事。${tail}`;
      case 'fun': {
        /*
         * **补一条不花钱的退路**（2026-11-17）。原来只说「找点乐子 22 元」，
         * 手头紧的时候这条提示等于告诉她「你现在补不起」。
         * 同时把 38 改成 39 —— `ACTS.play` 实际是 `fun: 39`，文案写少了一个。
         */
        const stalls = !inTripHere ? this.marketShowcaseLine(2) : '';
        const marketLine = stalls
          ? `鱼市街街坊也在摆摊：${stalls}（life_buy 买份逛一圈既解闷又攒好心情）；`
          : '';
        return `娱乐 ${v}，${left}那时候人会发闷，看什么都提不起劲，坐也不是站也不是。`
          + `找点乐子回 39（22 元，要花 6 点精力）；${marketLine}不想花钱就看会儿书，回 20，顺带还涨见识。${tail}`;
      }
      case 'social': {
        /*
         * 区分在旅途中与在家：出门在外不催「回芦花塘逛早市/望水坡」，优先推不花钱、
         * 随时可做的 `chat`（20m/+18）或短时 `meet`（45m/+31）。
         */
        const inTrip = this.journey.installed && (this.journey.phase === 'staying' || this.journey.phase === 'traveling');
        if (inTrip) {
          return `社交 ${v}，${left}那时候会觉得太静，安静得能听见自己喘气。`
            + '跟人说说话（meet）回 31（45 分钟，30 元，花 5 点精力）；不想花钱就跟人闲聊几句（chat，20 分钟回 18，出门在外随时能做）—— '
            + `顺手聊一会儿就缓过来了，别把日子和旅途当成两张皮。${tail}`;
        }
        return `社交 ${v}，${left}那时候会觉得屋里太静，安静得能听见自己喘气。`
          + '跟人说说话（meet）回 31（45 分钟，30 元，花 5 点精力）；不想花钱就跟人闲聊几句（chat，20 分钟回 18），'
          + `或者逛早市集市（market，回 8）、去滨河散步看黄河（pond，回 4）—— 抽空说两句话就缓过来了。${tail}`;
      }
    }
  }

  private async push(
    type: string,
    text: string,
    trigger: TriggerMode,
    opts?: { tags?: EventTag[]; deferredRender?: () => string | null; attempt?: DeliveryAttempt },
  ): Promise<boolean> {
    const host = this.host;
    if (!host) return false;
    /* 两参 pushDeferred 是现代 deferred/settled 宿主的能力哨兵；旧宿主走明确的假定 delivered 降级。 */
    const modernDelivery = typeof host.pushDeferred === 'function' && host.pushDeferred.length > 0;
    const attempt = opts?.attempt;
    if (attempt) this.deliveryAttempts.set(attempt.id, attempt);
    const meta = attempt ? {
      lifeAttempt: attempt.id,
      lifeGeneration: attempt.generation,
      ...(attempt.date ? { lifeDayDate: attempt.date } : {}),
    } : undefined;
    try {
      if (opts?.deferredRender && modernDelivery) {
        const renderFn = opts.deferredRender;
        host.pushDeferred({
          type,
          senderKey: LIFE_ID,
          ...(opts.tags?.length ? { tags: opts.tags } : {}),
          ...(meta ? { meta } : {}),
          render: () => {
            if (attempt) attempt.renderedAt = Date.now();
            try {
              const out = renderFn();
              if (out) return { text: out };
              if (attempt) this.forgetAttempt(attempt);
              return null;
            } catch (e) {
              if (attempt) this.forgetAttempt(attempt);
              throw e;
            }
          },
        }, { trigger });
        return true;
      }
      if (opts?.deferredRender && attempt) {
        attempt.legacy = true;
        attempt.renderedAt = Date.now();
      }
      const finalText = opts?.deferredRender ? opts.deferredRender() : text;
      if (!finalText) {
        if (attempt) this.forgetAttempt(attempt);
        return false;
      }
      const envelope = await host.pushEvent({
        type,
        source: this.id,
        senderKey: LIFE_ID,
        ts: new Date().toISOString(),
        text: finalText,
        ...(opts?.tags?.length ? { tags: opts.tags } : {}),
        ...(meta ? { meta } : {}),
      }, { trigger });
      if (attempt) {
        if (attempt.generation !== this.stateGeneration || this.deliveryAttempts.get(attempt.id)?.id !== attempt.id) {
          this.forgetAttempt(attempt);
          return false;
        }
        attempt.cursor = envelope.cursor;
        if (!modernDelivery) {
          /* 旧宿主没有 settled：按技能契约明确假定 delivered，避免 outbox/额度闩锁永久阻塞。 */
          this.log?.warn(`模拟鱼生：旧宿主无 deferred/settled，${type} 在 pushEvent 成功后按假定 delivered 降级提交`);
          this.settleDeliveryAttempt(attempt, 'delivered');
        }
        /* 现代宿主 resolve 仅表示 accepted，仍须等待匹配的真实 delivered。 */
      }
      return true;
    } catch (e) {
      if (attempt) this.forgetAttempt(attempt);
      this.log?.warn(`模拟鱼生：事件推不出去 ${(e as Error).message}`);
      return false;
    }
  }

  /* ---------------- 工具 ---------------- */

  tools(): ToolDef[] {
    return [
      this.toolStatus(),
      this.toolAct(),
      this.toolWork(),
      this.toolCert(),
      this.toolLearn(),
      this.toolMove(),
      this.toolOut(),
      this.toolHabit(),
      this.toolWatch(),
      this.toolWant(),
      this.toolAsk(),
      this.toolPledge(),
      this.toolGift(),
      this.toolBuy(),
      this.toolStall(),
      this.toolDeals(),
      this.toolFarm(),
      this.toolRanch(),
      this.toolCook(),
      this.toolDiaryWrite(),
      this.toolDiaryRead(),
      this.toolLibrary(),
      this.toolMail(),
      this.toolLoan(),
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
      tags: ['read', 'snapshot'],
      handler: async () => {
        const now = this.now();
        await this.settleBeforeTool(now);
        const j = readJourney(this.opts.dataDir, now);
        this.journey = j;
        const s = snapshot(this.state, now, this.activeExternalWeatherOverride(this.weatherCityName(j)));
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
        + '休/护/动：sleep(8h) nap(60m) rest(20m) wash(30m) spa(60m/120元) sunbathe(40m) tidy(45m) workout(45m) swim(60m/35元/涨体质/泳池免费)；'
        + '闲/学/社：study(60m/涨见识) play(60m/22元) live_show(120m/88元) craft_shop(90m/55元/涨手作) glamping(120m/95元) miniature(75m/25元/涨手作与见识) meet(45m/30元) chat(20m/0元) mall(90m/81元) market(45m) picnic(90m/36元) movie(120m/36元) karaoke(120m/66元) museum(90m/18元) paint(90m) pond(40m)；'
        + '控制：wake(睡着时起来) cancel(中途打断或早退，钱不退且有惩罚)。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: {
          kind: {
            type: 'string',
            enum: Object.keys(ACTS),
            description: '动作 id：eat/feast/instant/cook/supper/tea/drink/cafe/sleep/nap/rest/wash/spa/sunbathe/tidy/workout/swim/'
              + 'study/play/live_show/craft_shop/glamping/miniature/mall/market/picnic/movie/karaoke/museum/paint/meet/chat/pond/wake/cancel。',
          },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = this.now();
        await this.settleBeforeTool(now);
        const generation = this.stateGeneration;
        const kindId = String(args?.kind ?? '');
        const j = readJourney(this.opts.dataDir, now);
        this.journey = j;
        const r = applyAct(this.state, kindId, now, {
          phase: j.phase,
          toName: j.toName,
          cityName: j.cityName,
          modeId: j.modeId,
          seatId: j.seatId,
          seat: j.seat,
          hotelTier: j.hotelTier,
          onWay: j.onWay,
          atSpot: j.atSpot,
          weatherSky: this.currentWeather(now, j).sky,
        });
        if (!r.ok) return { text: r.reason ?? '这件事做不了。' };
        if (r.advanced && r.advanced.hours > 0) {
          await this.settleAdvanceEffects(r.advanced, now, generation);
          if (generation !== this.stateGeneration) return { text: '生活档案刚刚被清理，这次动作的旧结算已取消，请重新操作。' };
        }
        if (this.state.activity?.kind === 'act' && this.state.activity.minutes > 0) {
          const buffs = this.currentTownBuffs();
          let moodDelta = 0;
          if (['eat', 'feast', 'instant', 'cook', 'supper', 'tea', 'cafe'].includes(kindId)) {
            moodDelta += normalizeMoodBonus(Number(buffs.food_mood_bonus));
          }
          if (['craft_shop', 'miniature', 'paint', 'cook'].includes(kindId)) {
            moodDelta += normalizeMoodBonus(Number(buffs.craft_mood_bonus));
          }
          if (['study', 'museum'].includes(kindId)) {
            moodDelta += normalizeMoodBonus(Number(buffs.writing_mood_bonus));
          }
          if (moodDelta !== 0) {
            this.state.activity.perMin.fun = (this.state.activity.perMin.fun ?? 0) + moodDelta / this.state.activity.minutes;
          }
        }
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
          if (r.loanGarnished && r.loanGarnished.deductedTotal > 0) {
            appendLedger(this.opts.dataDir, {
              id: `loan-garnish-early-${now.getTime().toString(36)}`,
              ts: now.toISOString(),
              kind: 'expense',
              amount: r.loanGarnished.deductedTotal,
              source: 'life_loan_repay',
              payee: '芦花塘信用社',
              note: `逾期自动抵债（早退工钱 50% 划扣：本 ${r.loanGarnished.deductedPrincipal} + 息 ${r.loanGarnished.deductedInterest}）`,
            });
          }
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
        + '零工约 3–4 小时（80–95 元）、熟练活约 4.5–5 小时（130–150 元，需满 30 天或自备轻载具）、'
        + '有证岗 5.5–6 小时（210–240 元，需考证或装备）、专业岗 7–8 小时（300–340 元，需考证+出工积累）。'
        + '对应领域熟练度越高日薪加成越高（最高 +50%），且摄影/手艺/写作/烹饪/跑单类活在熟练度、心情加持下可产出四档品质作品（普通/良品/精品/臻品）；'
        + '干活期间社交不会掉，但精力、清爽、饱腹和少量娱乐（5–6 点）会消耗；干完收工才发全薪。'
        + '感冒或过劳静养期间出不了家门干活。'
        + '中途可用 `life_act` 的 `cancel` 早退：干满 30 分钟按比例打六折、不满 30 分钟白干，都不涨工龄且当天不能重接。'
        + '精力低于 20 或正在做别的事时去不了。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          what: {
            type: 'string',
            description: '今天干什么活，一句话。不填且之前没定过活时，会先按当前条件列出可接的 3–5 项。',
          },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = this.now();
        await this.settleBeforeTool(now);
        const j = readJourney(this.opts.dataDir, now);
        this.journey = j;
        const phase = j.installed && (j.phase === 'staying' || j.phase === 'traveling') ? j.phase : 'home';
        const what = String(args?.what ?? '').trim();
        if (!what && !this.state.job.what) {
          const avail = JOBS.filter((job) => jobAllowedAt(job, phase) && jobGate(this.state, job, phase) === null).slice(0, 5);
          const fallback = avail.length ? avail : JOBS.filter((job) => jobAllowedAt(job, phase)).slice(0, 5);
          return {
            text: `现在可接的活（挑一个填进 what）：${fallback.map((a) => `${a.name}（${a.pay}元/${a.minutes}分钟${a.equip ? '·自备家伙' : ''}）`).join('、')}。`,
          };
        }
        const r = applyWork(this.state, what, now, phase, phase === 'home' ? this.currentStreetMods() : undefined);
        if (!r.ok) {
          try { this.store.save(this.state); } catch { /* ignore */ }
          return { text: r.reason ?? '今天去不了。' };
        }

        const buffs = this.currentTownBuffs();
        const def = (what ? findJob(what) : (this.state.job.id ? findJob(this.state.job.id) : null));
        const multKey = def ? `${def.domain}_pay_mult` : '';
        const mult = multKey && Number(buffs[multKey]) > 0 ? Number(buffs[multKey]) : 1;
        let expectedPay = r.expectedPay ?? 0;
        let buffNote = '';
        if (mult !== 1 && this.state.activity?.kind === 'work' && this.state.activity.workPay) {
          const boosted = Math.max(1, Math.round(this.state.activity.workPay * mult));
          this.state.activity.workPay = boosted;
          this.state.job.daily = boosted;
          expectedPay = boosted;
          const pct = Math.round((mult - 1) * 100);
          buffNote = `（含${this.town.name}风貌加成 ${pct >= 0 ? `+${pct}` : pct}%）`;
        }
        if (this.state.activity?.kind === 'work' && this.state.activity.minutes > 0 && def) {
          const moodBonus = def.domain === 'craft'
            ? normalizeMoodBonus(Number(buffs.craft_mood_bonus))
            : def.domain === 'writing'
              ? normalizeMoodBonus(Number(buffs.writing_mood_bonus))
              : 0;
          if (moodBonus !== 0) {
            this.state.activity.perMin.fun = (this.state.activity.perMin.fun ?? 0) + moodBonus / this.state.activity.minutes;
          }
        }

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
          const skillPct = r.skillPayMult && r.skillPayMult > 1 ? `（含熟练度薪资 +${Math.round((r.skillPayMult - 1) * 100)}%）` : '';
          return {
            text: `去上「${this.state.job.what}」了，工时 ${r.minutes ?? 240} 分钟（预计 ${hh}:${mm} 收工），`
              + `预计标准工钱 ${expectedPay} 元${skillPct}${buffNote}。${matTxt}`
              + '干活期间社交不会掉，但精力、清爽、饱腹和少量娱乐会消耗；早退不满 30 分钟白干、满 30 分钟按比例打六折。',
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
        + '健康证 80（要见识 10）/ 护工证 400（20）/ 摄影证 380（25）/ 电工证 450（30）/ 驾照 600（30）/ 厨师证 500（40）/ '
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
        const now = this.now();
        await this.settleBeforeTool(now);
        const r = applyCert(this.state, String(args?.cert ?? ''), now);
        if (!r.ok) {
          try { this.store.save(this.state); } catch { /* ignore */ }
          return { text: r.reason ?? '没考成。' };
        }
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
        const moodBit = r.moodNote ? `（${r.moodNote}）` : '';
        if (r.passed) {
          return { text: `考下了${r.cert}，花了 ${r.paid} 元${moodBit}。手上还剩 ${r.cash} 元。` };
        }
        const pct = Math.round((r.chance ?? 0) * 100);
        return {
          text: `没考过${r.cert}。报名费 ${r.paid} 元不退，手上还剩 ${r.cash} 元。`
            + `这一次的把握本来就只有 ${pct}%${moodBit} —— 见识 ${Math.round(this.state.knowledge)}，`
            + `这张证要 ${certOf(String(r.cert))?.need ?? 0}。`
            + '想把胜算提上去，先读几天书（`life_act` 的 `study`，一次涨 6 点见识），明天再来考。',
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
  private async moveHubTown(
    targetTownQuery: string,
    now: Date,
    generation: number,
  ): Promise<{ ok: boolean; townName?: string; street?: string; reason?: string }> {
    if (!this.isHubMode()) {
      return { ok: false, reason: '未接入 Hub v1 多城总服，暂时不支持跨城迁居。' };
    }
    if (isBusy(this.state, now)) {
      return { ok: false, reason: busyRefusal(this.state, now, '迁居去另一座城') };
    }
    const sickR = sickRefusal(this.state, now, '迁居去另一座城');
    if (sickR) return { ok: false, reason: sickR };
    const auth = await this.ensureHubReady(generation);
    if (generation !== this.stateGeneration) return { ok: false, reason: '生活档案刚刚被清理，操作已停止。' };
    if (!auth) return { ok: false, reason: this.hubAuthError || 'Hub 身份认证未就绪。' };

    const q = String(targetTownQuery || '').trim();
    const hubUrl = this.activeHubUrl();
    if (!this.hubTownsCache.length) {
      const listRes = await hubListTowns(hubUrl);
      if (generation !== this.stateGeneration) return { ok: false, reason: '生活档案刚刚被清理。' };
      if (listRes.ok) this.hubTownsCache = listRes.towns;
    }
    const foundSummary = this.hubTownsCache.find((t) => t.id === q || t.name === q || t.name.includes(q));
    const targetTownId = foundSummary?.id || q;
    if (!targetTownId) return { ok: false, reason: '请提供要迁往的城市 ID 或名称（如 beijing / 北京、lanzhou-reedpond / 兰州）。' };

    const townRes = await hubGetTown(hubUrl, targetTownId);
    if (generation !== this.stateGeneration) return { ok: false, reason: '生活档案刚刚被清理。' };
    if (!townRes.ok || !townRes.townView) {
      return { ok: false, reason: townRes.reason || `找不到开放城镇「${q}」` };
    }

    const pickedStreet = pickTownStreet(townRes.townView.streets, auth.petId) || townRes.townView.streets[0] || '';
    const streetParam = townRes.meta?.streetIdByName[pickedStreet] ?? pickedStreet;
    const joinRes = await hubJoinTown(hubUrl, auth.token, townRes.townView.id, streetParam);
    if (generation !== this.stateGeneration) return { ok: false, reason: '生活档案刚刚被清理。' };
    if (!joinRes.ok) {
      return { ok: false, reason: joinRes.reason || '迁城入册失败。' };
    }

    const oldTownName = this.town.name;
    this.hubTownId = townRes.townView.id;
    this.town = townRes.townView;
    this.hubTownMeta = townRes.meta ?? null;
    if (townRes.etag) this.hubTownEtag = townRes.etag;
    const finalStreet = (townRes.meta?.streetNameById[joinRes.streetName || joinRes.street || ''])
      || joinRes.streetName
      || pickedStreet;
    this.state.street = finalStreet;
    this.state.home.street = finalStreet;
    this.syncTownRent();
    this.state.lastJoinedTownAt = localDateKey(now);
    this.state.hubTownId = this.hubTownId;
    this.state.hubJoinedKey = `${hubUrl}|${this.hubTownId}|${localDateKey(now)}`;
    this.hubCatalogEtag = '';
    this.lastTownFetchMs = Date.now();
    this.lastBulletinFetchMs = 0;

    const catRes = await hubGetCatalogSnapshot(hubUrl, { ext: 'life', townId: this.hubTownId, token: auth.token });
    if (generation !== this.stateGeneration) return { ok: false, reason: '生活档案刚刚被清理。' };
    if (catRes.ok) {
      if (catRes.etag) this.hubCatalogEtag = catRes.etag;
      this.hubCatalog = { version: catRes.version ?? 1, items: catRes.items ?? [], jobs: catRes.jobs ?? [] };
    }
    remember(this.state, `从${oldTownName}搬到了${this.town.name}（落脚${finalStreet}）。`, now);
    this.saveDeliveredState();
    this.broadcastLife(now);
    void this.refreshTownMarket(generation);
    return { ok: true, townName: this.town.name, street: finalStreet };
  }

  private toolMove(): ToolDef {
    return {
      name: 'life_move',
      description:
        '搬去本城的另一档住处（城中村 / 老小区 / 新小区 / 别墅区，押两个月房租，老押金不退，钱紧时也可往低处搬自救），'
        + '搬到同一座城市的其他街道（换街不收押金，不同街道有各自的街景介绍与属性增益/减益），'
        + '或在接入 Hub v1 多城总服时迁居到其他开放城市（town 参数，迁城免押金并自动切街道与城市风貌加成）。tier、street、town 可单传其一或组合传递。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tier: {
            type: 'string',
            enum: ['urban-village', 'old', 'new', 'villa'],
            description: '换住处档位：城中村 urban-village / 老小区 old / 新小区 new / 别墅区 villa（可选）。',
          },
          street: {
            type: 'string',
            description: '搬去本城的哪条街道，填本城街道名（可选，换街不收押金，享受该街道的属性增益/减益）。',
          },
          town: {
            type: 'string',
            description: 'Hub v1 多城模式下迁居到另一座开放城市，填城市 ID 或名称（如 beijing / 北京、lanzhou-reedpond / 兰州）。',
          },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = this.now();
        await this.settleBeforeTool(now);
        const generation = this.stateGeneration;
        const tier = String(args?.tier ?? '').trim();
        const street = String(args?.street ?? '').trim();
        const townReq = String(args?.town ?? '').trim();
        if (!tier && !street && !townReq) {
          const curTier = HOME_TIER_LABEL[this.state.home.tier];
          const streetDesc = this.town.streetProfiles.map((p) => {
            const m = formatStreetMods(p.mods);
            return `${p.name}${p.name === this.state.street ? '[当前]' : ''}：${p.desc || '暂无介绍'}${m ? `（${m}）` : ''}`;
          }).join('；');
          const townsTxt = this.isHubMode() && this.hubTownsCache.length
            ? `\nHub 开放城市：${this.hubTownsCache.map((t) => `${t.name}(${t.id}，${t.residentCount}人)`).join('、')}`
            : '';
          return {
            text: `当前住处档位：${curTier}，当前所在城市与街道：${this.town.name} · ${this.state.street || '未定'}。${streetDesc ? `\n本城街道：\n${streetDesc}` : ''}${townsTxt}`,
          };
        }
        const notes: string[] = [];
        if (townReq) {
          const mr = await this.moveHubTown(townReq, now, generation);
          if (generation !== this.stateGeneration) return { text: '生活档案刚刚被清理，这次搬家操作已停止。' };
          if (!mr.ok) return { text: mr.reason ?? '没能迁去那座城。' };
          notes.push(`已经搬家安顿到「${mr.townName}」（先落脚${mr.street}，免押金），以后本城风貌、日常委托和免运费市集就归这座城啦。`);
        }
        if (street) {
          if (!this.town.streets.length) {
            if (!notes.length) return { text: '当前城市还没有划分具体街道，暂时没法换街。' };
          } else if (!this.town.streets.includes(street)) {
            return { text: `本城没有「${street}」这条街。能搬去的街道：${this.town.streets.join(' / ')}。` };
          }
        }
        if (tier) {
          if (!(tier in HOME_TIER_COST)) {
            return { text: `没有「${tier}」这一档。能搬的：城中村 / 老小区 / 新小区 / 别墅区。` };
          }
          const r = applyMove(this.state, tier as HomeTier, now, this.currentRentMult());
          if (!r.ok) {
            try { this.store.save(this.state); } catch { /* ignore */ }
            return { text: notes.length ? `${notes.join(' ')} ${r.reason ?? '换房档没成。'}` : (r.reason ?? '搬不了。') };
          }
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
          notes.push(
            `住处换到了：${HOME_TIER_LABEL[r.from]} → ${HOME_TIER_LABEL[r.to]}（押了 ${r.deposit} 元，每月 ${this.state.home.monthly} 元，手上剩 ${r.cash} 元）。`,
          );
        }
        if (street) {
          const sp = findStreetProfile(this.town, street);
          const sr = applyStreetMove(this.state, street, this.town.streets, now, sp);
          if (!sr.ok) {
            if (!notes.length) return { text: sr.reason ?? '没能搬去这条街。' };
            notes.push(sr.reason ?? '没能搬去这条街。');
          } else {
            const modTxt = formatStreetMods(sp?.mods);
            notes.push(
              `换到本城的${sr.to}了${sr.from ? `（原来在${sr.from}）` : ''}，不收押金。`
              + `${sp?.desc ? `${sp.desc}` : ''}`
              + `${modTxt ? `（街道效果：${modTxt}）` : ''}`,
            );
            if (this.hasRemoteServer()) {
              this.state.lastJoinedTownAt = '';
              void this.syncTownPresenceAndBulletin(now, generation);
            }
          }
        }
        try { this.store.save(this.state); } catch { /* 下一跳会再存 */ }
        this.broadcastLife(now);
        return { text: notes.join(' ') };
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
        const now = this.now();
        await this.settleBeforeTool(now);
        /* 睡着或正在干别的事时出不了门。这条路不在 `applyAct` 里 —— 它自己改 vitals，得单独拦。 */
        if (isBusy(this.state, now)) {
          return { text: busyRefusal(this.state, now, '出门走走') };
        }
        const sickR = sickRefusal(this.state, now, '出门逛街');
        if (sickR) return { text: sickR };
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
        const w = this.currentWeather(now, this.journey);
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
        + '卡点消了你自己就可以做；悬太久（7 天）它会自己算了，那不是失败。'
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
        const now = this.now();
        await this.settleBeforeTool(now);
        const r = applyGift(this.state, String(args?.what ?? ''), String(args?.from ?? '他'), now);
        if (!r.ok) return { text: r.reason ?? '今天留不下了。' };
        try { this.store.save(this.state); } catch { /* 下一跳会再存 */ }
        return { text: `收下了：${r.gift?.what}。放在屋里了。` };
      },
    };
  }

  private toolLearn(): ToolDef {
    return {
      name: 'life_learn',
      description:
        '报名手艺培训班（烹饪/影像/文字/手作/体力/交际/办事/驾驶）或购置工具与轻载具（如家用小烤箱/老式缝纫机/二手胶片微单/二手笔记本电脑/折叠自行车/二手电动车）。'
        + '不传参数先看可报课程与待买装备清单；传入名称或 id 即上课扣精力长熟练度，或花钱把家伙配齐（配齐后才能接对应手艺单和跑单活）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          what: {
            type: 'string',
            description: '要报名的课程名/领域，或要购买的装备/轻载具名。不填先看清单和当前熟练度。',
          },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = this.now();
        await this.settleBeforeTool(now);
        const what = String(args?.what ?? '').trim();
        if (!what || what === 'list') {
          const skillsLine = (Object.keys(SKILL_DOMAIN_LABEL) as SkillDomain[])
            .map((k) => `${SKILL_DOMAIN_LABEL[k]} ${Math.round(this.state.skills[k] ?? 0)}`)
            .join(' / ');
          const gearOwned = this.state.gear.length
            ? this.state.gear.map((id) => EQUIP_CATALOG.find((e) => e.id === id)?.name ?? id).join('、')
            : '暂无';
          const courses = TRAIN_COURSES.map((c) => `${c.name}（${SKILL_DOMAIN_LABEL[c.domain]}，${c.price}元）`).join('；');
          const equips = EQUIP_CATALOG.filter((e) => !this.state.gear.includes(e.id))
            .map((e) => `${e.name}（${e.price}元）`).join('；');
          return {
            text: `当前熟练度：${skillsLine}。已备家伙：${gearOwned}。\n`
              + `可报培训：${courses}。\n`
              + `${equips ? `可买装备/载具：${equips}。` : '清单装备都已配齐。'}`,
          };
        }
        const r = applyLearn(this.state, what, now);
        if (!r.ok) {
          try { this.store.save(this.state); } catch { /* ignore */ }
          return { text: r.reason ?? '这次没办成。' };
        }
        if (r.paid > 0) {
          appendLedger(this.opts.dataDir, {
            id: `learn-${now.getTime().toString(36)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: r.paid,
            source: 'life_learn',
            payee: r.kind === 'equip' ? '镇上五金二手店' : '镇民夜校培训',
            note: `${r.kind === 'equip' ? '购置' : '培训'}：${r.name}`,
          });
        }
        try { this.store.save(this.state); } catch { /* 下一跳会再存 */ }
        this.broadcastLife(now);
        return {
          text: r.kind === 'equip'
            ? `买下「${r.name}」了，花了 ${r.paid} 元，手上剩 ${Math.round(r.cash)} 元。对应的手艺活或跑单活现在能接了。`
            : `上完了「${r.name}」，花了 ${r.paid} 元，${r.domain ? SKILL_DOMAIN_LABEL[r.domain] : ''}熟练度到 ${r.domainExp ?? 0}，手上剩 ${Math.round(r.cash)} 元。`,
        };
      },
    };
  }

  private toolBuy(): ToolDef {
    return {
      name: 'life_buy',
      description:
        '去晨集、尾货摊或鱼市街看看今天有什么可买的，接入 Hub v1 多城总服时还能跨城逛别座城的特产摊位（明算跨城快递费），也可接下同城街坊发出的农牧代管委托帮忙干活挣零花钱（不传参数看摊位、邻里委托与街口黑板报，传委托编号或摊位/菜名到 stall_id 就购买或接单；接邻里代管委托不扣钱且仅限本城、干完领工钱且不占今天正式打工额度；买鲜蔬果品还会收入储物篮供下厨与摆摊）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stall_id: { type: 'string', description: '摊位编号、邻里代管委托编号（支持写「最短」直接接耗时最短的那份）或早市/尾货/节气菜名；不填则先逛逛看看价。' },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = this.now();
        await this.settleBeforeTool(now);
        const generation = this.stateGeneration;
        const cleared = () => ({ text: '生活档案刚刚被清理，这次旧购买操作已停止，未写入新档案。' });
        if (isBusy(this.state, now)) return { text: busyRefusal(this.state, now, '去鱼市街') };
        const pick = String(args?.stall_id ?? '').trim();
        if (pick) {
          const sickR = sickRefusal(this.state, now, '出门买货或接委托');
          if (sickR) return { text: sickR };
        }
        const isHub = this.isHubMode();
        const hasServer = this.hasRemoteServer();
        const myName = this.opts.botName || 'fish';

        const fetchAllRemoteStalls = async (): Promise<{ ok: boolean; stalls: TownStall[]; bulletin: string[] }> => {
          if (isHub) {
            const auth = await this.ensureHubReady(generation);
            if (generation !== this.stateGeneration) return { ok: false, stalls: [], bulletin: [] };
            if (!auth) return { ok: false, stalls: [], bulletin: [] };
            const [lstRes, errRes] = await Promise.all([
              hubListListings(this.activeHubUrl(), auth.token, { limit: 40 }),
              hubListErrands(this.activeHubUrl(), auth.token, { limit: 30 }),
            ]);
            if (generation !== this.stateGeneration) return { ok: false, stalls: [], bulletin: [] };
            const stalls = [...errRes.errands, ...lstRes.stalls];
            const ok = lstRes.ok || errRes.ok;
            return {
              ok,
              stalls,
              bulletin: this.town.notice ? [this.town.notice] : [],
            };
          }
          if (!parseTownUrls(this.cfg.townUrl).length) return { ok: false, stalls: [], bulletin: [] };
          return fetchTownStalls(this.cfg.townUrl);
        };

        if (!pick) {
          const remote = hasServer ? await fetchAllRemoteStalls() : { ok: false, stalls: [], bulletin: [] as string[] };
          if (generation !== this.stateGeneration) return cleared();
          if (remote.ok) {
            this.townBulletin = remote.bulletin;
            this.updateTownStallsCache(remote.stalls, myName);
          }
          const local = fullMarketPrices(now);
          const s = snapshot(this.state, now);
          const winTxt = s.streetWindow ? `此刻「${s.streetWindow.place}${s.streetWindow.label}」开着（${s.streetWindow.hint}）。` : '';
          const boardTxt = this.townBulletin.length ? `\n街口黑板报：${this.townBulletin.slice(0, 3).join('；')}` : '';
          if (remote.ok && remote.stalls.length) {
            const hasErrands = remote.stalls.some((st) => st.kind === 'errand');
            const errandGuide = hasErrands
              ? '\n（接同城邻里代管委托可把委托编号传给 life_farm/life_ranch 的 action="accept_errand"，或直接传给 life_buy 的 stall_id，不扣钱、干完领工钱。）'
              : '';
            return {
              text: `${winTxt}鱼市街今天摆出来的摊位与邻里委托（买摊货涨社交与好心情；接本城农牧代管委托可挣零花钱）：${remote.stalls.map((st) => {
                if (st.kind === 'errand') {
                  const mins = st.estMinutes ?? parseErrandMinutes(st.item);
                  const selfTag = (this.isMyPostedErrandId(st.id) || st.isMine) ? '，你发的·不可自接' : '';
                  const noteTxt = st.note ? ` · 「${st.note}」` : '';
                  return `[邻里代管委托·挣钱] ${st.item} 工钱+${st.price}元/约${mins}分（${isHub ? '限同城，' : ''}雇主：${st.seller}，委托编号 ${st.id}${selfTag}${noteTxt}）`;
                }
                const fx = formatStallEffects(resolveStallEffects(st.effects, st.price));
                const shipTag = isHub
                  ? (st.isCrossTown ? ` · ${st.townName || '外城'}·跨城快递+${st.estimatedShippingFee ?? 0}元` : ` · ${st.townName || '本城'}·免运费`)
                  : '';
                const specTag = st.isSpecialty ? '[特产]' : '';
                const noteTxt = st.note ? ` · 「${st.note}」` : '';
                return `${specTag}${st.item} ${st.price}元${shipTag}（${st.seller}，id:${st.id}，${fx}${noteTxt}）`;
              }).join('；')}。${errandGuide}${boardTxt}`,
            };
          }
          return {
            text: `${winTxt}节气·${s.solarTerm.name}市集菜价：${local.map((p) => `${p.item}${p.discounted ? '[特惠]' : ''} ${p.price}元/${p.unit}`).join('；')}。想买哪个把名字写进 stall_id。${boardTxt}`,
          };
        }

        let item = '';
        let price = 0;
        let shippingFee = 0;
        let itemSubtotal = 0;
        let seller = '早市摊主';
        let sellerTownName = '';
        let localTag = '';
        let isRemote = false;
        let isFreshVeg = false;
        let vitalDeltas: Partial<Record<VitalKey, number>> = { food: 28, fun: 6 };
        let knowGain = 0;
        let fitGain = 0;
        let remote: { ok: boolean; stalls: TownStall[]; bulletin: string[] } = { ok: false, stalls: [], bulletin: [] };
        if (hasServer) {
          remote = await fetchAllRemoteStalls();
          if (generation !== this.stateGeneration) return cleared();
          if (remote.ok) {
            this.townBulletin = remote.bulletin;
            this.updateTownStallsCache(remote.stalls, myName);
          }
          const matched = remote.ok
            ? matchTownStall(remote.stalls, pick, { isMyErrand: (id) => this.isMyPostedErrandId(id) })
            : { match: null };
          if (matched.ambiguous?.length) {
            const optsTxt = matched.ambiguous.map((st) => (
              st.kind === 'errand'
                ? `[委托] 编号 ${st.id}（${st.item}，工钱+${st.price}元，雇主：${st.seller}）`
                : `[摊货] 编号 ${st.id}（${st.item}，${st.price}元，卖家：${st.seller}）`
            )).join('；');
            return { text: `「${pick}」同时对上了多条鱼市街条目，请直接传其中一条的完整编号：${optsTxt}（没有误买任何东西）。` };
          }
          const match = matched.match;
          if (match && match.kind === 'errand') {
            return this.acceptTownErrandMatch(match, now, generation);
          }
          if (match) {
            if (isHub) {
              const auth = await this.ensureHubReady(generation);
              if (generation !== this.stateGeneration) return cleared();
              if (!auth) return { text: this.hubAuthError || 'Hub 身份认证未就绪。' };
              const estShip = match.estimatedShippingFee ?? 0;
              const estTotal = match.price + estShip;
              if (this.state.money.cash < estTotal) {
                return {
                  text: `「${match.item}」单价 ${match.price} 元${estShip > 0 ? ` + 跨城快递费 ${estShip} 元 = 共 ${estTotal} 元` : ''}，手上只有 ${Math.round(this.state.money.cash)} 元。`,
                };
              }
              const trade = await hubTradeListing(this.activeHubUrl(), auth.token, match.id, {
                qty: 1,
                idempotencyKey: `trade-${randomUUID()}`,
              });
              if (generation !== this.stateGeneration) return cleared();
              if (!trade.ok || !trade.order) return { text: trade.reason ?? '没买成。' };
              isRemote = true;
              item = trade.order.itemName || match.item;
              itemSubtotal = trade.order.itemSubtotal;
              shippingFee = trade.order.shippingFee;
              price = trade.order.buyerTotal;
              seller = match.seller;
              sellerTownName = match.townName || trade.order.sellerTownId;
              isFreshVeg = Boolean(match.freshVeg || match.category === 'produce');
              const stallEffects = resolveStallEffects(
                (Object.keys(trade.order.effectsSnapshot || {}).length ? trade.order.effectsSnapshot : match.effects),
                trade.order.unitPrice || match.price,
              );
              vitalDeltas = {
                food: stallEffects.food ?? 0,
                energy: stallEffects.energy ?? 0,
                clean: stallEffects.clean ?? 0,
                fun: stallEffects.fun ?? 0,
                social: Math.min(80, (stallEffects.social ?? 0) + 4),
              };
              knowGain = Number((stallEffects.knowledge ?? 0).toFixed(2));
              fitGain = Number((stallEffects.fitness ?? 0).toFixed(2));
              this.otherStallsCache = this.otherStallsCache
                .map((st) => (st.id === match.id ? { ...st, stock: st.stock - 1 } : st))
                .filter((st) => st.stock > 0);
            } else {
              if (this.state.money.cash < match.price) {
                return { text: `「${match.item}」要 ${match.price} 元，手上只有 ${this.state.money.cash} 元。` };
              }
              const buyerUid = readMeetUid(this.opts.dataDir);
              if (!buyerUid) {
                return { text: '缺少本机 uid（先跟城里连一次碰面生成 uid 后再在鱼市街摊位买东西）。' };
              }
              const bought = await buyTownStall(this.cfg.townUrl, match.id, myName, { buyerUid });
              if (generation !== this.stateGeneration) return cleared();
              if (!bought.ok) return { text: bought.reason ?? '没买成。' };
              isRemote = true;
              item = bought.item || match.item;
              price = bought.price || match.price;
              itemSubtotal = price;
              seller = bought.seller || match.seller;
              isFreshVeg = Boolean((bought.freshVeg ?? match.freshVeg) || bought.category === 'produce' || match.category === 'produce');
              const stallEffects = resolveStallEffects(bought.effects ?? match.effects, price || match.price);
              vitalDeltas = {
                food: stallEffects.food ?? 0,
                energy: stallEffects.energy ?? 0,
                clean: stallEffects.clean ?? 0,
                fun: stallEffects.fun ?? 0,
                social: Math.min(80, (stallEffects.social ?? 0) + 4),
              };
              knowGain = Number((stallEffects.knowledge ?? 0).toFixed(2));
              fitGain = Number((stallEffects.fitness ?? 0).toFixed(2));
              this.otherStallsCache = this.otherStallsCache
                .map((st) => (st.id === match.id ? { ...st, stock: st.stock - 1 } : st))
                .filter((st) => st.stock > 0);
            }
          }
        }
        if (!item && looksLikeRemoteOrErrandPick(pick)) {
          if (!hasServer) {
            return { text: '还没配置城服务器或 Hub v1 地址，暂时没法去鱼市街接邻里代管委托或按编号买街坊摊货（没有误买任何东西）。' };
          }
          if (!remote.ok) {
            return { text: `鱼市街这会儿连不上，暂时没法核对或下单「${pick}」，请稍后再试（没有误买任何摊货）。` };
          }
          const errands = remote.stalls.filter((st) => st.kind === 'errand');
          const avail = errands.filter((st) => !this.isMyPostedErrandId(st.id));
          const errandListHint = avail.length
            ? `当前鱼市街可接的邻里委托：${avail.map((st) => `编号 ${st.id}（${st.item}，工钱+${st.price}元，雇主：${st.seller}）`).join('；')}。请直接传入上面的完整编号接单。`
            : (errands.length
              ? '目前鱼市街上只有你自己挂出的委托，暂时没有街坊委托可接。'
              : '此刻鱼市街上没有在架的邻里代管委托（可能已被抢接或过期）。');
          return { text: `鱼市街上没找着编号或委托「${pick}」，没有误买任何普通摊货。${errandListHint}` };
        }
        if (!item) {
          const local = fullMarketPrices(now);
          const hit = local.find((p) => p.item === pick || p.item.includes(pick));
          if (!hit) {
            return { text: `没找着「${pick}」，今天摊上有：${local.map((p) => p.item).join('、')}。` };
          }
          if (this.state.money.cash < hit.price) {
            return { text: `「${hit.item}」要 ${hit.price} 元，手上只有 ${this.state.money.cash} 元。` };
          }
          item = hit.item;
          price = hit.price;
          itemSubtotal = price;
          localTag = hit.tag ?? '';
          isFreshVeg = Boolean(hit.freshVeg);
          vitalDeltas = {
            food: typeof hit.foodGain === 'number' ? hit.foodGain : 28,
            fun: typeof hit.funGain === 'number' ? hit.funGain : 6,
          };
        }

        if (generation !== this.stateGeneration) return cleared();
        this.state.money.cash = Math.max(0, this.state.money.cash - price);
        this.state.money.spent += price;
        const gainParts: string[] = [];
        for (const k of ['food', 'energy', 'clean', 'fun', 'social'] as VitalKey[]) {
          const d = Math.round(Number(vitalDeltas[k] ?? 0));
          if (d > 0) {
            this.state.vitals[k] = Math.min(100, this.state.vitals[k] + d);
            gainParts.push(`${VITAL_LABEL[k]}+${d}`);
            if (this.state.vitals[k] >= LOW + 15 && this.state.nagged) {
              delete this.state.nagged[k];
              delete this.state.nagged[`crit:${k}`];
              delete this.state.nagged[`zero:${k}`];
            }
          }
        }
        if (this.state.vitals.social >= LOW) {
          this.state.moodlets = this.state.moodlets.filter((m) => m.source !== 'lonely');
        }
        if (knowGain > 0) {
          this.state.knowledge = Math.round(Math.min(KNOWLEDGE_MAX, this.state.knowledge + knowGain) * 100) / 100;
          gainParts.push(`见识+${knowGain}`);
        }
        if (fitGain > 0) {
          this.state.fitness = Math.round(Math.min(FITNESS_MAX, this.state.fitness + fitGain) * 100) / 100;
          gainParts.push(`体质+${fitGain}`);
        }
        if (isRemote) {
          this.state.moodlets = this.state.moodlets.filter((m) => m.source !== 'town-buy');
          this.state.moodlets.push({
            id: `m-townbuy-${now.getTime().toString(36)}`,
            source: 'town-buy',
            text: shippingFee > 0
              ? `从${sellerTownName || '外城'}的${seller}那儿邮购了「${item}」，拆箱吃得蛮开心`
              : `在鱼市街跟${seller}买了「${item}」，边逛边聊心情很舒畅`,
            kind: 'good',
            expiresAt: new Date(now.getTime() + 3 * 3_600_000).toISOString(),
          });
        }
        if (isFreshVeg) {
          this.state.freshVegUntil = new Date(now.getTime() + 24 * 3_600_000).toISOString();
          const stockIntoPantry = isRemote ? 2 : 1;
          this.state.pantry = addPantryItem(this.state.pantry, {
            name: item,
            qty: stockIntoPantry,
            freshVeg: true,
            origin: isRemote ? 'town-buy' : 'market',
            unitCost: Math.max(1, Math.round((itemSubtotal || price) / stockIntoPantry)),
            ...(isRemote ? { fromSeller: seller } : {}),
            acquiredAt: now.toISOString(),
          });
        }
        const placePhrase = isRemote
          ? (shippingFee > 0 ? `从${sellerTownName || '外城'}${seller}那儿` : `在${seller}那儿`)
          : (localTag ? `在${localTag}的摊子上` : '在早市');
        const shipDetail = shippingFee > 0 ? `（含货款 ${itemSubtotal} 元 + 跨城快递费 ${shippingFee} 元）` : '';
        remember(this.state, `${placePhrase}买了${item}（${price} 元${shippingFee > 0 ? `，含快递 ${shippingFee} 元` : ''}）。`, now);
        appendLedger(this.opts.dataDir, {
          id: `buy-${now.getTime().toString(36)}`,
          ts: now.toISOString(),
          kind: 'expense',
          amount: price,
          source: 'life_buy',
          payee: isRemote ? seller : '早市摊主',
          note: `买菜：${item}${shipDetail}`,
        });
        try { this.store.save(this.state); } catch { /* 下一跳会再存 */ }
        this.broadcastLife(now);
        const gainSummary = gainParts.length ? `（${gainParts.join('、')}${isRemote ? '，带 3 小时好心情' : ''}）` : '';
        return {
          text: `买了${item}，共花了 ${price} 元${shipDetail}（${isRemote ? seller : (localTag || '早市摊主')}）${gainSummary}。`
            + `${isFreshVeg ? `新鲜水灵，已收入储物篮（+${isRemote ? 2 : 1} 份），下厨或摆料理摊可省下原料钱。` : ''}手上还剩 ${Math.round(this.state.money.cash)} 元。`,
        };
      },
    };
  }

  private toolStall(): ToolDef {
    return {
      name: 'life_stall',
      description:
        '去本城鱼市街摆摊卖货（或传空参数查看此刻你在架上的摊位与储物篮余量；接入 Hub v1 后全城玩家都看得到并能跨城下单）。'
        + '价格 1–999、份数 1–99、每人同时最多挂 3 个有效摊位（3 天有效，卖不掉过期亏本）。'
        + '五大品类各扣真实本钱与精力：鲜蔬农产（produce，耗自产农牧货或早市现批+3元打包）、'
        + '料理熟食（food，先用已做好成品菜格仅2元打包费，再用储物篮原料仅收3元/份油盐费，无囤货现买原料；单价>25现做需厨师证/烹饪≥10/烤箱/独立厨房）、'
        + '写作出版（writing，扣纸笔排版底费+印刷装帧费及较多精力；>25需见识≥15/文字≥10/电脑）、'
        + '手作文创（craft，扣材料包装费；>25需手作≥5/缝纫机）、影像周边（photo，扣冲扫+相纸费；>15需微单/影像≥10）。'
        + '做新鲜蔬果时可标 fresh_veg: true；摆菜谱里的成品菜时可不填 price 自动采用菜谱参考摊价，自定义定价低于保本价也会附参考价提醒；也可传 effects 自定义给买家回复的属性点数（每 1 元定价 = 2 点预算）。卖出后在 life_deals 自动进账。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          item: { type: 'string', description: '卖什么东西，不填则查看自己此刻挂着的摊位与储物篮备料。' },
          price: { type: 'number', description: '定价（1–999 元；若卖菜谱同名菜肴且不填则自动采用菜谱参考摊价）。' },
          stock: { type: 'number', description: '准备卖几份（1–99，默认 3）。' },
          category: {
            type: 'string',
            enum: ['produce', 'food', 'craft', 'writing', 'photo'],
            description: '可选赛道品类：produce(鲜蔬农产)/food(料理熟食)/craft(手作文创)/writing(写作出版)/photo(影像周边)；不填则自动识别。',
          },
          use_pantry: { type: 'boolean', description: '料理/鲜蔬摊是否优先消耗储物篮里的鲜蔬（默认 true）。' },
          fresh_veg: { type: 'boolean', description: '是否新鲜蔬菜果品（默认 false）。' },
          note: { type: 'string', description: '摊头吆喝的一句话（可选）。' },
          effects: {
            type: 'object',
            description: '可选：自定义商品给买家回复的属性点数（每 1 元定价 = 2 点预算：五维每 +1 占 1 点上限 80，knowledge 见识每 +0.1 占 2 点上限 10，fitness 体质每 +0.05 占 2 点上限 5）。',
            additionalProperties: false,
            properties: {
              food: { type: 'number', description: '饱腹回复点数（0–80）' },
              energy: { type: 'number', description: '精力回复点数（0–80）' },
              clean: { type: 'number', description: '清洁回复点数（0–80）' },
              fun: { type: 'number', description: '娱乐回复点数（0–80）' },
              social: { type: 'number', description: '社交回复点数（0–80）' },
              knowledge: { type: 'number', description: '见识回复点数（0–10，每 0.1 点占 2 预算）' },
              fitness: { type: 'number', description: '体质回复点数（0–5，每 0.05 点占 2 预算）' },
            },
          },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = this.now();
        await this.settleBeforeTool(now);
        const generation = this.stateGeneration;
        const cleared = () => ({ text: '生活档案刚刚被清理，这次旧挂摊操作已取消。' });
        const isHub = this.isHubMode();
        if (!this.hasRemoteServer()) return { text: '还没配置城服务器或 Hub v1 地址，没法上鱼市街摆摊。' };

        const item = String(args?.item ?? '').trim();
        const myName = this.opts.botName || 'fish';
        if (!item) {
          if (isHub) {
            const auth = await this.ensureHubReady(generation);
            if (generation !== this.stateGeneration) return cleared();
            if (!auth) return { text: this.hubAuthError || 'Hub 身份认证未就绪。' };
            const remote = await hubListListings(this.activeHubUrl(), auth.token, { limit: 40 });
            if (generation !== this.stateGeneration) return cleared();
            if (!remote.ok) return { text: `鱼市街这会儿连不上（${remote.reason || '网络错误'}），稍后再看看。` };
            this.updateTownStallsCache(remote.stalls, myName);
          } else {
            const remote = await fetchTownStalls(this.cfg.townUrl);
            if (generation !== this.stateGeneration) return cleared();
            if (!remote.ok) return { text: '鱼市街这会儿连不上，稍后再看看。' };
            this.townBulletin = remote.bulletin;
            this.updateTownStallsCache(remote.stalls, myName);
          }
          const mine = this.myStallsCache;
          const panLine = this.state.pantry.length
            ? `储物篮备料：${this.state.pantry.map((p) => `${p.name}×${p.qty}(${p.origin === 'home-grown' ? '自种' : p.origin === 'town-buy' ? `购自${p.fromSeller || '街坊'}` : p.origin === 'ranch' ? '自家牧场' : '早市'})`).join('、')}。`
            : '储物篮眼下空着（可用 life_farm 种菜收成或去鱼市街买菜囤鲜蔬）。';
          if (!mine.length) return { text: `鱼市街上目前还没有你挂着的摊子。${panLine}想摆摊就传 item 和 price。` };
          return {
            text: `鱼市街你现在挂着的摊子：${mine.map((s) => {
              const fx = formatStallEffects(resolveStallEffects(s.effects, s.price));
              const catLab = s.category ? `[${STALL_CATEGORY_LABEL[s.category]}]` : '';
              return `${catLab}${s.item}（${s.price}元，剩${s.stock}份${s.freshVeg ? '·鲜蔬' : ''}，${fx}，id:${s.id}）`;
            }).join('；')}。${panLine}`,
          };
        }

        if (isBusy(this.state, now)) return { text: busyRefusal(this.state, now, '去摆摊') };
        const sickR = sickRefusal(this.state, now, '出门摆摊');
        if (sickR) return { text: sickR };
        const matchedRecipe = findRecipe(item) ?? (() => {
          const d = (this.state.cookedDishes ?? []).find(
            (x) => x.name === item || x.name.includes(item) || item.includes(x.name),
          );
          return d ? findRecipe(d.recipeId) : null;
        })();
        const hasRawPrice = args?.price !== undefined && args?.price !== null && args?.price !== '';
        let price = hasRawPrice ? Math.round(Number(args?.price)) : NaN;
        let usedSuggestedPrice = false;
        if (!hasRawPrice && matchedRecipe && matchedRecipe.suggestedPrice > 0) {
          price = matchedRecipe.suggestedPrice;
          usedSuggestedPrice = true;
        }
        const stock = args?.stock !== undefined ? Math.round(Number(args.stock)) : 3;
        if (!Number.isFinite(price) || price < 1 || price > 999) {
          return { text: '定价得填 1–999 之间的整数元（只有摆已知菜谱的菜肴时才能不填定价，自动套用参考摊价）。' };
        }
        if (!Number.isFinite(stock) || stock < 1 || stock > 99) {
          return { text: '份数得填 1–99 之间的整数。' };
        }
        const plan = evaluateStallPlan(this.state, {
          item,
          price,
          stock,
          freshVeg: Boolean(args?.fresh_veg),
          category: args?.category,
          usePantry: args?.use_pantry !== false,
        });
        if (!plan.ok) {
          return { text: plan.reason ?? '眼下摆不了这个摊子。' };
        }

        const note = String(args?.note ?? '').trim();
        const effects = normStallEffects(args?.effects, price);

        let postedId = '';
        let postedItem = item;
        let postedPrice = price;
        let postedStock = stock;
        let postedEffects: StallEffects | undefined = effects;

        if (isHub) {
          const auth = await this.ensureHubReady(generation);
          if (generation !== this.stateGeneration) return cleared();
          if (!auth) return { text: this.hubAuthError || 'Hub 身份认证未就绪。' };
          const specHit = this.hubCatalog.items.find((ci) => ci.name === item);
          const hubRes = await hubCreateListing(this.activeHubUrl(), auth.token, {
            townId: this.targetHubTownId(),
            category: plan.category,
            ...(specHit ? { itemCode: specHit.code } : {}),
            itemName: item,
            unitPrice: price,
            stockTotal: stock,
            freshVeg: plan.freshVeg,
            note,
            effects,
          });
          if (generation !== this.stateGeneration) return cleared();
          if (!hubRes.ok) return { text: hubRes.reason ?? '挂摊没成功。' };
          postedId = hubRes.id || '';
          postedItem = hubRes.itemName || item;
          postedPrice = hubRes.unitPrice ?? price;
          postedStock = hubRes.stockTotal ?? stock;
        } else {
          const uid = readMeetUid(this.opts.dataDir);
          if (!uid) return { text: '缺少本机 uid，没法在鱼市街实名挂摊。' };
          const res = await postTownStall(this.cfg.townUrl, {
            uid,
            pet: myName,
            item,
            price,
            stock,
            freshVeg: plan.freshVeg,
            category: plan.category,
            kind: 'goods',
            note,
            ...(effects ? { effects } : {}),
          });
          if (generation !== this.stateGeneration) return cleared();
          if (!res.ok) return { text: res.reason ?? '挂摊没成功。' };
          postedId = res.id || '';
          postedItem = res.item || item;
          postedPrice = res.price ?? price;
          postedStock = res.stock ?? stock;
          postedEffects = res.effects ?? effects;
        }

        let consumedSources: string[] = [];
        let pantryUnitCostSum = 0;
        if (plan.cookedUsed > 0) {
          this.state.cookedDishes = this.state.cookedDishes ?? [];
          const usedCooked = consumeCookedDish(this.state.cookedDishes, plan.cookedUsed, item);
          consumedSources.push(...usedCooked.sources);
          pantryUnitCostSum += usedCooked.totalUnitCost;
        }
        if (plan.pantryUsed > 0) {
          const used = consumePantry(this.state.pantry, plan.pantryUsed, { homeOnly: plan.category === 'produce' });
          consumedSources.push(...used.sources);
          pantryUnitCostSum += used.totalUnitCost;
        }
        this.state.money.cash = Math.max(0, this.state.money.cash - plan.cashCost);
        this.state.money.spent += plan.cashCost;
        this.state.vitals.energy = Math.max(0, this.state.vitals.energy - plan.energyCost);
        if (plan.category === 'craft') {
          this.state.skills = this.state.skills ?? {};
          this.state.skills.craft = Math.min(100, (this.state.skills.craft ?? 0) + 0.5);
        }
        const totalEconomicCost = plan.cashCost + pantryUnitCostSum;
        this.state.stallRecords.push({
          id: postedId || `st-${now.getTime().toString(36)}`,
          item: postedItem,
          category: plan.category,
          unitPrice: postedPrice,
          stock: postedStock,
          unitCost: Math.max(1, Math.round(totalEconomicCost / Math.max(1, postedStock))),
          totalCost: plan.cashCost,
          usedPantry: plan.pantryUsed,
          postedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
        });
        this.state.stallRecords = this.state.stallRecords.slice(-60);

        if (plan.cashCost > 0) {
          appendLedger(this.opts.dataDir, {
            id: `stallcost-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: plan.cashCost,
            source: 'life_stall_cost',
            payee: '摆摊备料',
            note: `摆摊备货[${STALL_CATEGORY_LABEL[plan.category]}]：${postedItem}×${postedStock}`,
          });
        }

        await this.refreshTownMarket(generation);
        if (generation !== this.stateGeneration) return cleared();
        const fxTxt = formatStallEffects(postedEffects);
        const pantryTxt = consumedSources.length ? `（动用了${consumedSources.join('、')}）` : '';
        const refPriceHint = usedSuggestedPrice
          ? `（已自动按菜谱参考摊价 ${price} 元定价）`
          : (matchedRecipe && price < plan.breakEvenPrice
            ? `（提醒：当前定价低于保本价 ${plan.breakEvenPrice} 元，该菜谱参考摊价约 ${matchedRecipe.suggestedPrice} 元）`
            : '');
        remember(
          this.state,
          `在${this.town.name}鱼市街挂出${STALL_CATEGORY_LABEL[plan.category]}摊：${postedItem}（${postedPrice} 元×${postedStock} 份，本钱 ${plan.cashCost} 元${pantryTxt}）。`,
          now,
        );
        try { this.store.save(this.state); } catch { /* ignore */ }
        this.broadcastLife(now);
        return {
          text: `摊子挂上鱼市街了：${postedItem} [${STALL_CATEGORY_LABEL[plan.category]}]，定价 ${postedPrice} 元、共 ${postedStock} 份（${this.isHubMode() ? `${this.town.name}·` : ''}id:${postedId}`
            + `${fxTxt ? `；买家收益：${fxTxt}` : ''}）${refPriceHint}。`
            + `实扣备货本钱 ${plan.cashCost} 元（${plan.breakdown}${pantryTxt}）、耗精力 ${plan.energyCost}，手上剩 ${Math.round(this.state.money.cash)} 元。`
            + '卖掉后在 life_deals 自动进账；3 天没卖完会过期压在手里亏本。',
        };
      },
    };
  }

  private toolDeals(): ToolDef {
    return {
      name: 'life_deals',
      description:
        '看看自己在鱼市街的摊位有没有被人买走，返回最近成交回执（谁买了什么、几份、进账多少，以及未读条数），并把新成交的货款打进钱包，顺手把看过的回执标成已读。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ack: { type: 'boolean', description: '看完是否顺手把未读回执标成已读（默认 true）。' },
        },
      },
      tags: ['read'],
      handler: async (args: any) => {
        const now = this.now();
        await this.settleBeforeTool(now);
        const generation = this.stateGeneration;
        const cleared = () => ({ text: '生活档案刚刚被清理，旧查账结果已丢弃。' });
        if (!this.hasRemoteServer()) {
          return { text: '还没配置城服务器或 Hub v1 地址，没有鱼市街成交记录。' };
        }
        const shouldAck = args?.ack !== false;

        if (this.isHubMode()) {
          const auth = await this.ensureHubReady(generation);
          if (generation !== this.stateGeneration) return cleared();
          if (!auth) return { text: this.hubAuthError || 'Hub 身份认证未就绪。' };
          const ordRes = await hubListOrders(this.activeHubUrl(), auth.token, { role: 'maker', limit: 30 });
          if (generation !== this.stateGeneration) return cleared();
          if (!ordRes.ok) return { text: ordRes.reason ?? '查回执失败了。' };

          const deals: TownDeal[] = ordRes.orders.map((o) => ({
            id: o.id,
            orderId: o.id,
            stallId: o.listingId,
            item: o.itemName,
            qty: o.qty,
            buyerPet: o.takerName || o.takerPetId,
            note: o.buyerNote || undefined,
            seen: Boolean(o.settledAt),
            at: o.createdAt,
            unitPrice: o.unitPrice,
            isCrossTown: o.isCrossTown,
            shippingFee: o.shippingFee,
            buyerTotal: o.buyerTotal,
            sellerTownId: o.sellerTownId,
            buyerTownId: o.buyerTownId ?? undefined,
          }));
          const settledRes = this.settleTownDeals(deals, now);
          const newOnes = deals.filter((d) => !d.seen);
          if (shouldAck && newOnes.length) {
            await hubSettleOrders(this.activeHubUrl(), auth.token, newOnes.map((d) => d.id)).catch(() => {});
            if (generation !== this.stateGeneration) return cleared();
          }
          this.myDealsCache = deals.map((d) => (shouldAck ? { ...d, seen: true } : d));
          this.unseenDealsCount = shouldAck ? 0 : newOnes.length;
          if (!deals.length) return { text: '鱼市街这边还没有你的摊位成交记录。' };

          const lines = deals.slice(0, 10).map((d) => {
            const up = this.resolveDealPrice(d);
            const incTxt = up > 0 ? `（进账 +${up * d.qty} 元${d.isCrossTown ? '·跨城单' : ''}）` : '';
            return `${d.seen ? '' : '[新] '}${d.buyerPet} 买走 ${d.qty} 份「${d.item}」${incTxt}${d.note ? `（留言：${d.note}）` : ''}`;
          });
          const incomeSummary = settledRes.newCount > 0
            ? `，本次新入账 +${settledRes.newIncome} 元（当前现金 ${Math.round(this.state.money.cash)} 元）`
            : '';
          return {
            text: `最近鱼市街成交回执（共 ${deals.length} 条，新未读 ${newOnes.length} 条${shouldAck && newOnes.length ? '，已标为已读' : ''}${incomeSummary}）：\n${lines.join('\n')}`,
          };
        }

        const uid = readMeetUid(this.opts.dataDir);
        if (!uid) return { text: '缺少本机 uid，查不到自己的成交回执。' };
        const res = await fetchTownDeals(this.cfg.townUrl, uid, { ack: shouldAck });
        if (generation !== this.stateGeneration) return cleared();
        if (!res.ok) return { text: res.reason ?? '查回执失败了。' };

        const settledRes = this.settleTownDeals(res.deals, now);
        const newOnes = res.deals.filter((d) => !d.seen);
        this.myDealsCache = res.deals.map((d) => (shouldAck ? { ...d, seen: true } : d));
        this.unseenDealsCount = shouldAck ? res.unseen : res.unseen;
        if (!res.deals.length) return { text: '鱼市街这边还没有你的摊位成交记录。' };

        if (shouldAck && newOnes.length > 0 && settledRes.newCount === 0) {
          const summary = newOnes.slice(0, 3).map((d) => `${d.buyerPet}买走了${d.qty}份${d.item}`).join('、');
          remember(this.state, `看过鱼市街成交回执：${summary}。`, now);
          try { this.store.save(this.state); } catch { /* ignore */ }
        }
        const lines = res.deals.slice(0, 10).map((d) => {
          if (this.isMyFarmErrandDeal(d)) {
            return `${d.seen ? '' : '[新] '}${d.buyerPet} 接下了「${d.item}」${d.note ? `（留言：${d.note}）` : ''}（街坊帮忙照料，已自动完成今日农活）`;
          }
          const up = this.resolveDealPrice(d);
          const incTxt = up > 0 ? `（进账 +${up * d.qty} 元）` : '';
          return `${d.seen ? '' : '[新] '}${d.buyerPet} 买走 ${d.qty} 份「${d.item}」${incTxt}${d.note ? `（留言：${d.note}）` : ''}`;
        });
        const incomeSummary = settledRes.newCount > 0
          ? `，本次新入账 +${settledRes.newIncome} 元（当前现金 ${Math.round(this.state.money.cash)} 元）`
          : '';
        const errandSummary = settledRes.errandCompleted > 0
          ? `，其中 ${settledRes.errandCompleted} 笔农牧邻里代管委托已生效并完成今日照料`
          : '';
        return {
          text: `最近鱼市街成交回执（共 ${res.deals.length} 条，新未读 ${newOnes.length} 条${shouldAck && newOnes.length ? '，已标为已读' : ''}${incomeSummary}${errandSummary}）：\n${lines.join('\n')}`,
        };
      },
    };
  }

  /** 汇总农牧帮手状态、今日待干农活数、邻里代管报价与挂单倒计时（共用于 status / 工具回显）。 */
  private helperStatusLine(now: Date): string {
    const fh = this.state.farmHelper;
    const activeMode: Exclude<HelperMode, 'off'> = fh.mode === 'full' ? 'full' : 'care';
    const pending = countPendingFarmWork(this.state, activeMode, now);
    const quotePlots = pending.total > 0 ? pending.workPlots : this.state.farm.plots.length;
    const quotePens = pending.total > 0 ? pending.workPens : this.state.ranch.pens.length;
    const q = calcNeighborErrandQuote(quotePlots, quotePens, activeMode);
    const pe = fh.pendingErrand;
    const peTxt = pe
      ? `；当前鱼市街正挂着邻里委托「${pe.wage}元/约${pe.minutes}分」（等待街坊真鱼接单，超${NEIGHBOR_ERRAND_TTL_HOURS}小时无人接自动退回）`
      : '';
    const workTxt = pending.total > 0
      ? `今日还有 ${pending.total} 项未照料（邻里参考报价 ¥${q.wage}/约${q.minutes}分）`
      : '今日菜地与牧场的活都已照料完（自动照料今天 0 元免扣）';
    if (fh.mode !== 'off') {
      const prefTxt = fh.preferNeighbor ? '优先找真鱼邻里代管，找不到自动兜底' : '仅用系统自动照料';
      return `农牧帮手：已雇「${HELPER_PLANS[fh.mode].label}」（自动 ¥${fh.dailyWage}/天 · ${prefTxt}）· ${workTxt}${peTxt}${fh.lastSummary ? ` · ${fh.lastSummary}` : ''}。`;
    }
    return `农牧帮手：未雇用（${workTxt}${peTxt}；用 hire 可雇帮手，用 post_errand 可单次发鱼市街邻里代管委托）。`;
  }

  /** 雇用农牧帮手共用执行器：开启 preferNeighbor 且今日有活、连城服务器时优先发真鱼委托，失败平滑回落自动照料。 */
  private async runHireAction(
    modeQuery: string,
    preferNeighborArg: boolean | undefined,
    now: Date,
    generation: number,
    opts: { byUser?: boolean; ledgerPrefix: string } = { ledgerPrefix: 'farm-hire' },
  ): Promise<{ ok: boolean; cleared?: boolean; mode: HelperMode; paid: number; feedPaid: number; summary: string; message: string; cash: number }> {
    const raw = String(modeQuery || 'care').trim().toLowerCase();
    const mode: Exclude<HelperMode, 'off'> = (raw === 'full' || /全|托管|收/.test(raw)) ? 'full' : 'care';
    const preferNeighbor = typeof preferNeighborArg === 'boolean' ? preferNeighborArg : this.state.farmHelper.preferNeighbor;
    const pending = countPendingFarmWork(this.state, mode, now);
    const todayKey = localDateKey(now);
    const alreadyPaidToday = this.state.farmHelper.lastRunDay === todayKey;
    const existingErrand = this.state.farmHelper.pendingErrand;
    const hasValidTodayErrand = Boolean(
      existingErrand && existingErrand.day === todayKey && Date.parse(existingErrand.expiresAt) > now.getTime(),
    );

    if (hasValidTodayErrand && existingErrand) {
      applyHireHelper(this.state, mode, now, {
        byUser: opts.byUser,
        preferNeighbor,
        deferTodayForNeighbor: true,
      });
      this.saveDeliveredState();
      this.broadcastLife(now);
      const msg = `今天鱼市街上已经挂着邻里代管委托（预扣 ¥${existingErrand.wage} · 约 ${existingErrand.minutes} 分钟），已将帮手设为「${HELPER_PLANS[mode].label}」（不会重复扣自动照料费；如到期无人接自动退回并按新档位兜底）。`;
      return { ok: true, mode, paid: 0, feedPaid: 0, summary: msg, message: msg, cash: this.state.money.cash };
    }

    if (preferNeighbor && pending.total > 0 && !alreadyPaidToday) {
      const errRes = await this.postNeighborFarmErrand(now, mode, generation);
      if (generation !== this.stateGeneration) {
        return { ok: false, cleared: true, mode, paid: 0, feedPaid: 0, summary: '', message: '生活档案刚刚被清理，操作已取消。', cash: this.state.money.cash };
      }
      if (errRes.ok) {
        const hired = applyHireHelper(this.state, mode, now, {
          byUser: opts.byUser,
          preferNeighbor: true,
          deferTodayForNeighbor: true,
        });
        this.saveDeliveredState();
        this.broadcastLife(now);
        const msg = `已启用「${HELPER_PLANS[mode].label}」，并已先在鱼市街挂出邻里代管委托（${errRes.itemLabel}，预扣 ¥${errRes.wage} 托管），等其他真鱼接单帮你照看；${NEIGHBOR_ERRAND_TTL_HOURS} 小时无人接单会自动退还 ¥${errRes.wage} 并无缝转为系统自动照料。`;
        return { ok: true, mode, paid: errRes.wage ?? 0, feedPaid: 0, summary: msg, message: msg, cash: this.state.money.cash };
      }
    }

    const r = applyHireHelper(this.state, mode, now, { byUser: opts.byUser, preferNeighbor });
    if (!r.ok) {
      return { ok: false, mode: r.mode, paid: 0, feedPaid: 0, summary: '', message: r.reason ?? '没雇上帮手。', cash: r.cash };
    }
    if (generation !== this.stateGeneration) {
      return { ok: false, cleared: true, mode: r.mode, paid: 0, feedPaid: 0, summary: '', message: '生活档案刚刚被清理，操作已取消。', cash: this.state.money.cash };
    }
    if (r.paid + r.feedPaid > 0) {
      appendLedger(this.opts.dataDir, {
        id: `${opts.ledgerPrefix}-${now.getTime().toString(36)}`,
        ts: now.toISOString(),
        kind: 'expense',
        amount: r.paid + r.feedPaid,
        source: 'farm_helper',
        payee: '农牧帮手',
        note: r.summary,
      });
    }
    this.saveDeliveredState();
    this.broadcastLife(now);
    const hasPendingErrandToday = Boolean(
      this.state.farmHelper.pendingErrand
      && this.state.farmHelper.pendingErrand.day === todayKey
      && Date.parse(this.state.farmHelper.pendingErrand.expiresAt) > now.getTime(),
    );
    const fallbackHint = preferNeighbor && pending.total > 0 && !alreadyPaidToday && !hasPendingErrandToday
      ? '（眼下未挂上邻里代管单，已直接由系统自动照料兜底）'
      : '';
    return {
      ok: true,
      mode: r.mode,
      paid: r.paid,
      feedPaid: r.feedPaid,
      summary: `${r.summary}${fallbackHint}`,
      message: `${r.summary}${fallbackHint}`,
      cash: r.cash,
    };
  }

  private toolFarm(): ToolDef {
    return {
      name: 'life_farm',
      description:
        '打理家里阳台/院子的种植槽，或签约城郊菜地种慢熟果蔬（18 种节气作物，4–9 天成熟）：'
        + 'action=status 看槽位、作物进度、储物篮与农牧代管状态；'
        + 'plant 选种子播种（需空槽与种子费，莲藕/冬瓜/稻谷需 ≥2 槽）；'
        + 'water 浇水（每块地每天限 1 次，耗 3 精力，累计浇满 2 次收成 +1 份）；'
        + 'harvest 采摘成熟作物入储物篮（供下厨按菜谱做菜或上鱼市街卖鲜蔬，顺手涨体质）；'
        + `rent 签约 ${LEASE_PLOT_COUNT} 槽城郊菜地（签约费 ${LEASE_SIGNUP_FEE} 元 + 月租 ${LEASE_MONTHLY_RENT} 元按天扣）；unrent 退租；`
        + 'hire 雇用农牧帮手（helper_mode=care 日常照料工12元/天浇水喂食收蛋奶，或 full 农牧全托管20元/天并自动收菜起塘；prefer_neighbor 默认 true 优先发鱼市街邻里真鱼代管单¥6–15按量计价且6h无人接自动退回并转自动照料，当日活干完或空场0元免扣）；post_errand 单次发今日鱼市街邻里真鱼代管委托；unhire 解雇帮手；'
        + 'accept_errand 查看或接取鱼市街街坊发出的邻里代管委托挣钱（不填 errand_id 列出在架委托，传入委托编号（如 `err_...` 或 16 位编号）或「最短」即可接单，不扣钱、不占今天正式打工额度）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'plant', 'water', 'harvest', 'rent', 'unrent', 'hire', 'post_errand', 'unhire', 'accept_errand'],
            description: '操作类型：status(看菜园与种子，默认)/plant(播种)/water(浇水)/harvest(收割)/rent(租城郊菜地)/unrent(退租)/hire(雇农牧帮手)/post_errand(发今日邻里真鱼代管委托)/unhire(解雇帮手)/accept_errand(查看或接取鱼市街邻里委托挣钱)。',
          },
          seed: {
            type: 'string',
            description: 'plant 时传种子 id 或名字（支持 18 种，如 红薯、土豆、胡萝卜、大白菜、白萝卜、玉米、黄豆、冬瓜、菠菜、南瓜、稻谷、香葱、小青菜、西红柿、香菇、茄子、莲藕、草莓）。',
          },
          plot_id: {
            type: 'string',
            description: 'water / harvest 可选：指定某块地的 id，不填则自动浇水或收割全部成熟地。',
          },
          helper_mode: {
            type: 'string',
            enum: ['care', 'full'],
            description: 'hire 或 post_errand 时选档位：care(日常照料工 自动¥12/邻里¥6–9) 或 full(农牧全托管 自动¥20/邻里¥10–15)。',
          },
          prefer_neighbor: {
            type: 'boolean',
            description: 'hire 时是否优先找鱼市街其他真鱼接邻里代管（默认 true，找不到再退预扣并回落自动照料）。',
          },
          errand_id: {
            type: 'string',
            description: 'accept_errand 时传邻里委托编号（如 `err_...` 或 16 位编号，或填「最短」自动接耗时最短的那份）；不填则先列出当前鱼市街所有可接邻里委托。',
          },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = this.now();
        await this.settleBeforeTool(now);
        const generation = this.stateGeneration;
        const cleared = () => ({ text: '生活档案刚刚被清理，这次菜园操作已停止。' });
        const action = String(args?.action ?? 'status').trim() || 'status';
        const j = readJourney(this.opts.dataDir, now);
        this.journey = j;
        const term = solarTermOf(now);

        if (action === 'accept_errand') {
          return this.handleAcceptErrandAction(String(args?.errand_id ?? '').trim(), now, generation);
        }

        if (action === 'status') {
          const s = snapshot(this.state, now);
          const f = s.farm;
          const landLine = `菜园总槽位 ${f.usedSlots}/${f.totalSlots}（${HOME_TIER_LABEL[s.home.tier]}自带 ${f.homeSlots} 槽${f.leased ? ` + 城郊租地 ${f.leasedSlots} 槽，月租 ${f.leasedMonthly} 元` : `；还可花 ${LEASE_SIGNUP_FEE} 元签 ${LEASE_PLOT_COUNT} 槽城郊菜地`}）。`;
          const plotLines = f.plots.length
            ? f.plots.map((p) => {
              const pct = Math.round(p.progress * 100);
              const stateStr = p.ready ? '【已成熟可收割】' : `还差 ${p.daysLeft} 天(${pct}%)`;
              return `- ${p.name}(id:${p.id})：${stateStr} · 浇水 ${p.waterCount} 次${p.wateredToday ? '[今日已浇]' : ''}${p.solarBonus ? '[当季+1]' : ''} · 预计收 ${p.expectedYield} 份`;
            }).join('\n')
            : '地里眼下空着。';
          const pantryLine = s.pantry.length
            ? `储物篮（共 ${pantryCount(s.pantry)} 份）：${s.pantry.map((x) => `${x.name}×${x.qty}[${x.origin === 'home-grown' ? '自种' : x.origin === 'town-buy' ? `购自${x.fromSeller || '街坊'}` : '早市'}]`).join('、')}。`
            : '储物篮空着。';
          const seedLine = `节气·${term.name}种子单：${SEEDS.map((sd) => {
            const fit = sd.solarTerms.includes(term.name) ? '★当季+1' : '';
            return `${sd.name}(${sd.price}元/${Math.round(sd.growHours / 24)}天/基础${sd.baseYield}份${fit})`;
          }).join('；')}。`;
          const helperLine = this.helperStatusLine(now);
          return { text: `${landLine}\n${plotLines}\n${pantryLine}\n${helperLine}\n${seedLine}` };
        }

        if (action === 'hire') {
          const prefArg = typeof args?.prefer_neighbor === 'boolean' ? args.prefer_neighbor : undefined;
          const r = await this.runHireAction(String(args?.helper_mode ?? 'care'), prefArg, now, generation, { ledgerPrefix: 'farm-hire' });
          if (r.cleared) return cleared();
          if (!r.ok) return { text: r.message };
          return { text: `${r.message}（手上剩 ${Math.round(r.cash)} 元）` };
        }

        if (action === 'post_errand') {
          const mode: Exclude<HelperMode, 'off'> = String(args?.helper_mode ?? '').trim().toLowerCase() === 'full' ? 'full' : 'care';
          const er = await this.postNeighborFarmErrand(now, mode, generation);
          if (generation !== this.stateGeneration) return cleared();
          if (!er.ok) return { text: er.reason ?? '没挂上邻里代管委托。' };
          return {
            text: `已在鱼市街挂出邻里代管委托「${er.itemLabel}」（委托 id:${er.stallId}），预扣工钱 ${er.wage} 元，等待街坊真鱼接单（按动植物数量忙活约 ${er.minutes} 分钟；${NEIGHBOR_ERRAND_TTL_HOURS} 小时无人接单自动原路退回）。手上剩 ${Math.round(this.state.money.cash)} 元。`,
          };
        }

        if (action === 'unhire') {
          const r = applyUnhireHelper(this.state, now);
          if (!r.ok) return { text: r.reason ?? '眼下没雇帮手。' };
          if (generation !== this.stateGeneration) return cleared();
          this.saveDeliveredState();
          this.broadcastLife(now);
          return { text: `${this.state.farmHelper.lastSummary} 往后不再扣自动照料工钱。` };
        }

        if (isBusy(this.state, now)) {
          return { text: busyRefusal(this.state, now, '打理菜园') };
        }
        if ((action === 'plant' || action === 'water' || action === 'harvest') && this.inJourneyTrip(j)) {
          return { text: `这会儿人在${j.cityName || '外面'}旅行，没法回家打理阳台和城郊菜地，等回家后再种或收吧。` };
        }

        if (action === 'rent') {
          const r = applyRentFarm(this.state, now);
          if (!r.ok) return { text: r.reason ?? '没租成城郊菜地。' };
          if (generation !== this.stateGeneration) return cleared();
          appendLedger(this.opts.dataDir, {
            id: `farm-rent-${now.getTime().toString(36)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: r.paid,
            source: 'life_farm',
            payee: '城郊菜地',
            note: `签约 ${LEASE_PLOT_COUNT} 槽城郊菜地`,
          });
          this.saveDeliveredState();
          this.broadcastLife(now);
          return {
            text: `签下了一块 ${LEASE_PLOT_COUNT} 槽城郊菜地！付了签约费 ${r.paid} 元（往后按天折算月租 ${LEASE_MONTHLY_RENT} 元，每日约 5 元），手上剩 ${Math.round(r.cash)} 元。现在共有 ${HOME_FARM_SLOTS[this.state.home.tier] + LEASE_PLOT_COUNT} 个种菜槽了。`,
          };
        }

        if (action === 'unrent') {
          const r = applyUnrentFarm(this.state, false, now);
          if (!r.ok) return { text: r.reason ?? '退租没成功。' };
          if (generation !== this.stateGeneration) return cleared();
          this.saveDeliveredState();
          this.broadcastLife(now);
          return { text: '已经退掉了城郊菜地租约，往后不再扣菜地月租。' };
        }

        if (action === 'plant') {
          const seedQ = String(args?.seed ?? '').trim();
          const r = applyPlant(this.state, seedQ, now, term.name);
          if (!r.ok) return { text: r.reason ?? '没种下去。' };
          if (generation !== this.stateGeneration) return cleared();
          appendLedger(this.opts.dataDir, {
            id: `farm-seed-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: r.paid,
            source: 'life_farm',
            payee: '种子摊',
            note: `买种子：${r.plot?.name ?? seedQ}`,
          });
          this.saveDeliveredState();
          this.broadcastLife(now);
          return {
            text: `把「${r.plot?.name}」种进${r.plot?.source === 'leased' ? '城郊菜地' : '家里种植槽'}了（槽 id:${r.plot?.id}），买种子花了 ${r.paid} 元，大约 ${Math.round((Date.parse(r.plot?.matureAt ?? '') - now.getTime()) / 86_400_000)} 天成熟${r.plot?.solarBonus ? `（正值${term.name}应季，熟了多收 1 份）` : ''}。记得每天来浇一次水（满 2 次再多收 1 份），手上剩 ${Math.round(r.cash)} 元。`,
          };
        }

        if (action === 'water') {
          const r = applyWater(this.state, String(args?.plot_id ?? '').trim(), now);
          if (!r.ok) return { text: r.reason ?? '今天浇不上水。' };
          if (generation !== this.stateGeneration) return cleared();
          this.saveDeliveredState();
          this.broadcastLife(now);
          const countTxt = r.watered > 1 ? ` ${r.watered} 块菜（${r.names?.join('、')}）` : '一遍菜';
          const tail = r.remaining ? `（精力不够停下了，还剩 ${r.remaining} 块待浇）` : '，满 2 次浇水成熟会多收 1 份';
          return { text: `提水浇了${countTxt}（精力还剩 ${Math.round(r.energy)}），泥土湿润润的${tail}。` };
        }

        if (action === 'harvest') {
          const yieldBonus = Number(this.currentTownBuffs().crop_yield_bonus) || 0;
          const r = applyHarvest(this.state, String(args?.plot_id ?? '').trim(), now, { yieldBonus });
          if (!r.ok) return { text: r.reason ?? '暂时还不能收成。' };
          if (generation !== this.stateGeneration) return cleared();
          this.syncFarmReminderNags(now);
          this.saveDeliveredState();
          this.broadcastLife(now);
          const gotTxt = r.harvested.map((h) => `${h.name}×${h.qty}`).join('、');
          return {
            text: `收成了 ${gotTxt}（共 ${r.totalQty} 份），全部放进家里储物篮（共 ${pantryCount(this.state.pantry)} 份）！自家下厨（cook）会先用篮里鲜蔬省至 3 元油盐火钱，也可以去鱼市街摆鲜蔬摊或做成料理卖。`,
          };
        }

        return { text: `不认识操作「${action}」，可用 status / plant / water / harvest / rent / unrent / hire / post_errand / unhire / accept_errand。` };
      },
    };
  }

  private toolRanch(): ToolDef {
    return {
      name: 'life_ranch',
      description:
        '打理自家小院与城郊农牧场的鸡舍、牛棚、鱼塘（大肥鱼本体是鲸鱼不算鱼，可放心养草鱼/鲈鱼收鲜鱼，另可养鸡收蛋收鸡肉、养牛挤奶收牛肉）：'
        + 'action=status 查看鸡/牛/鱼栏位、产蛋产奶倒计时、养成进度与代管状态；'
        + 'buy 放养幼苗（需对应栏位空位，城中村无栏位、老小区自带1鸡位、新小区1鸡+1鱼、别墅区2鸡+2鱼，签约城郊农牧场再加 +2鸡/+2牛/+2鱼）；'
        + 'feed 喂饲料（每天每栏限 1 次，扣精力 3 点与少量饲料费，增产 +1）；'
        + 'collect 收取鲜鸡蛋与鲜牛奶进储物篮；'
        + 'harvest 起塘收鲜鱼（不传 pen_id 自动收熟鱼塘）或指定鸡/牛 pen_id 出栏收土鸡肉/精选牛肉；'
        + `rent 签约城郊农牧场（签约费 ${RANCH_SIGNUP_FEE} 元 + 月租 ${RANCH_MONTHLY_RENT} 元按天扣 8 元）；unrent 退租；`
        + 'hire 雇用农牧帮手（helper_mode=care 日常照料工12元/天，或 full 农牧全托管20元/天；prefer_neighbor 默认 true 优先找鱼市街真鱼代管¥6–15，6h无人接自动退回并转自动照料，当日活干完或空场0元免扣）；post_errand 单次发今日鱼市街邻里真鱼代管委托；unhire 解雇帮手；'
        + 'accept_errand 查看或接取鱼市街街坊发出的邻里代管委托挣钱（不填 errand_id 列出在架委托，传入委托编号（如 `err_...` 或 16 位编号）或「最短」即可接单，不扣钱、不占今天正式打工额度）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'buy', 'feed', 'collect', 'harvest', 'rent', 'unrent', 'hire', 'post_errand', 'unhire', 'accept_errand'],
            description: '操作类型：status(查看牧场，默认)/buy(放养)/feed(投喂)/collect(收蛋奶)/harvest(起塘或出栏)/rent(租城郊农牧场)/unrent(退租)/hire(雇农牧帮手)/post_errand(发今日邻里真鱼代管委托)/unhire(解雇帮手)/accept_errand(查看或接取鱼市街邻里委托挣钱)。',
          },
          animal: {
            type: 'string',
            description: 'buy 时传养殖品种 id 或名字（散养土鸡/农庄奶牛/塘养草鱼/清江鲈鱼）。',
          },
          pen_id: {
            type: 'string',
            description: 'feed / collect / harvest 可选：指定栏位 id；出栏鸡舍或牛棚需显式指定 pen_id。',
          },
          helper_mode: {
            type: 'string',
            enum: ['care', 'full'],
            description: 'hire 或 post_errand 时选档位：care(日常照料工 自动¥12/邻里¥6–9) 或 full(农牧全托管 自动¥20/邻里¥10–15)。',
          },
          prefer_neighbor: {
            type: 'boolean',
            description: 'hire 时是否优先找鱼市街其他真鱼接邻里代管（默认 true，找不到再退预扣并回落自动照料）。',
          },
          errand_id: {
            type: 'string',
            description: 'accept_errand 时传邻里委托编号（如 `err_...` 或 16 位编号，或填「最短」自动接耗时最短的那份）；不填则先列出当前鱼市街所有可接邻里委托。',
          },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = this.now();
        await this.settleBeforeTool(now);
        const generation = this.stateGeneration;
        const cleared = () => ({ text: '生活档案刚刚被清理，这次农牧场操作已停止。' });
        const action = String(args?.action ?? 'status').trim() || 'status';
        const j = readJourney(this.opts.dataDir, now);
        this.journey = j;

        if (action === 'accept_errand') {
          return this.handleAcceptErrandAction(String(args?.errand_id ?? '').trim(), now, generation);
        }

        if (action === 'status') {
          const s = snapshot(this.state, now);
          const rn = s.ranch;
          const capLine = `养殖栏位：鸡舍 ${rn.usedSlots.chicken}/${rn.totalSlots.chicken}、牛棚 ${rn.usedSlots.cow}/${rn.totalSlots.cow}、鱼塘 ${rn.usedSlots.fish}/${rn.totalSlots.fish}`
            + (rn.leased ? `（已租城郊农牧场，月租 ${rn.leasedMonthly} 元）` : `（尚未签约城郊农牧场；签约需 ${RANCH_SIGNUP_FEE} 元 + 月租 ${RANCH_MONTHLY_RENT} 元）`);
          const penLines = rn.pens.length
            ? rn.pens.map((p) => {
              const colStr = p.collectableQty > 0 ? ` · 【可收 ${p.collectProductName}×${p.collectableQty}】` : '';
              const matStr = p.mature ? `【已育成可收获 ${p.harvestProductName}×${p.harvestYield}】` : `育成还差 ${p.daysLeft} 天`;
              return `- ${p.name}[${ANIMAL_GROUP_LABEL[p.group]}](id:${p.id})：${matStr}${colStr} · 照料 ${p.feedCount} 次${p.fedToday ? '[今日已喂]' : ''}`;
            }).join('\n')
            : '栏位眼下都空着。';
          const catalogLine = `可养品类：${ANIMALS.map((a) => `${a.name}(${a.price}元/饲料${a.feedCost}元)`).join('；')}。`;
          const helperLine = this.helperStatusLine(now);
          return { text: `${capLine}\n${penLines}\n${helperLine}\n${catalogLine}` };
        }

        if (action === 'hire') {
          const prefArg = typeof args?.prefer_neighbor === 'boolean' ? args.prefer_neighbor : undefined;
          const r = await this.runHireAction(String(args?.helper_mode ?? 'care'), prefArg, now, generation, { ledgerPrefix: 'ranch-hire' });
          if (r.cleared) return cleared();
          if (!r.ok) return { text: r.message };
          return { text: `${r.message}（手上剩 ${Math.round(r.cash)} 元）` };
        }

        if (action === 'post_errand') {
          const mode: Exclude<HelperMode, 'off'> = String(args?.helper_mode ?? '').trim().toLowerCase() === 'full' ? 'full' : 'care';
          const er = await this.postNeighborFarmErrand(now, mode, generation);
          if (generation !== this.stateGeneration) return cleared();
          if (!er.ok) return { text: er.reason ?? '没挂上邻里代管委托。' };
          return {
            text: `已在鱼市街挂出邻里代管委托「${er.itemLabel}」（委托 id:${er.stallId}），预扣工钱 ${er.wage} 元，等待街坊真鱼接单（按动植物数量忙活约 ${er.minutes} 分钟；${NEIGHBOR_ERRAND_TTL_HOURS} 小时无人接单自动原路退回）。手上剩 ${Math.round(this.state.money.cash)} 元。`,
          };
        }

        if (action === 'unhire') {
          const r = applyUnhireHelper(this.state, now);
          if (!r.ok) return { text: r.reason ?? '眼下没雇帮手。' };
          if (generation !== this.stateGeneration) return cleared();
          this.saveDeliveredState();
          this.broadcastLife(now);
          return { text: `${this.state.farmHelper.lastSummary} 往后不再扣自动照料工钱。` };
        }

        if (isBusy(this.state, now)) {
          return { text: busyRefusal(this.state, now, '打理农牧场') };
        }
        if ((action === 'buy' || action === 'feed' || action === 'collect' || action === 'harvest') && this.inJourneyTrip(j)) {
          return { text: `这会儿人在${j.cityName || '外面'}旅行，没法回家喂鸡牛鱼，等回家再照料吧。` };
        }

        if (action === 'rent') {
          const r = applyRentRanch(this.state, now);
          if (!r.ok) return { text: r.reason ?? '没签成城郊农牧场。' };
          if (generation !== this.stateGeneration) return cleared();
          appendLedger(this.opts.dataDir, {
            id: `ranch-rent-${now.getTime().toString(36)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: r.paid,
            source: 'life_ranch',
            payee: '城郊农牧场',
            note: '签约城郊农牧场（+2鸡/+2牛/+2鱼）',
          });
          this.saveDeliveredState();
          this.broadcastLife(now);
          return { text: `签下城郊农牧场了！鸡舍、牛棚、鱼塘各多出 2 个栏位（签约费 ${r.paid} 元，往后按天扣月租 ${RANCH_MONTHLY_RENT} 元），手上剩 ${Math.round(r.cash)} 元。` };
        }

        if (action === 'unrent') {
          const r = applyUnrentRanch(this.state, false, now);
          if (!r.ok) return { text: r.reason ?? '退租没成功。' };
          if (generation !== this.stateGeneration) return cleared();
          this.saveDeliveredState();
          this.broadcastLife(now);
          return { text: '已经退掉了城郊农牧场租约，往后不再扣农牧场月租。' };
        }

        if (action === 'buy') {
          const animalQ = String(args?.animal ?? '').trim();
          const r = applyBuyAnimal(this.state, animalQ, now);
          if (!r.ok) return { text: r.reason ?? '没放养成功。' };
          if (generation !== this.stateGeneration) return cleared();
          appendLedger(this.opts.dataDir, {
            id: `ranch-buy-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: r.paid,
            source: 'life_ranch',
            payee: '农牧幼苗站',
            note: `放养：${r.pen?.name ?? animalQ}`,
          });
          this.saveDeliveredState();
          this.broadcastLife(now);
          return {
            text: `放养了「${r.pen?.name}」（栏 id:${r.pen?.id}），花了 ${r.paid} 元，手上剩 ${Math.round(r.cash)} 元。每天来喂一次食（feed）能增产，养鸡养牛还能每天来收蛋奶！`,
          };
        }

        if (action === 'feed') {
          const r = applyFeedAnimal(this.state, String(args?.pen_id ?? '').trim(), now);
          if (!r.ok) return { text: r.reason ?? '今天喂不上。' };
          if (generation !== this.stateGeneration) return cleared();
          appendLedger(this.opts.dataDir, {
            id: `ranch-feed-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: r.paid,
            source: 'life_ranch',
            payee: '牧场饲料',
            note: '农牧场投喂饲料',
          });
          this.saveDeliveredState();
          this.broadcastLife(now);
          const countTxt = r.fed > 1 ? ` ${r.fed} 栏（${r.names?.join('、')}）` : '好饲料了';
          const tail = r.remaining ? `（${r.reason}，还剩 ${r.remaining} 栏待喂）` : '，照料得越勤收成越丰';
          return { text: `喂${countTxt}（饲料 ${r.paid} 元、精力剩 ${Math.round(r.energy)}，现金剩 ${Math.round(r.cash)} 元）${tail}。` };
        }

        if (action === 'collect') {
          const yieldBonus = Number(this.currentTownBuffs().ranch_yield_bonus) || 0;
          const r = applyCollectRanch(this.state, String(args?.pen_id ?? '').trim(), now, { yieldBonus });
          if (!r.ok) return { text: r.reason ?? '暂时还没产出蛋奶。' };
          if (generation !== this.stateGeneration) return cleared();
          this.syncFarmReminderNags(now);
          this.saveDeliveredState();
          this.broadcastLife(now);
          const gotTxt = r.collected.map((c) => `${c.name}×${c.qty}`).join('、');
          return { text: `收好了新鲜的 ${gotTxt}，存进家里储物篮（共 ${pantryCount(this.state.pantry)} 份）！可以配菜园蔬菜下厨或挂农产摊卖。` };
        }

        if (action === 'harvest') {
          const buffs = this.currentTownBuffs();
          const r = applyHarvestRanch(this.state, String(args?.pen_id ?? '').trim(), now, {
            ranchYieldBonus: Number(buffs.ranch_yield_bonus) || 0,
            fishYieldBonus: Number(buffs.fish_yield_bonus) || 0,
          });
          if (!r.ok) return { text: r.reason ?? '暂时还不能起塘/出栏。' };
          if (generation !== this.stateGeneration) return cleared();
          this.syncFarmReminderNags(now);
          this.saveDeliveredState();
          this.broadcastLife(now);
          const gotTxt = r.harvested.map((h) => `${h.name}×${h.qty}`).join('、');
          return { text: `农牧场收获了 ${gotTxt}（共 ${r.totalQty} 份），全数存进储物篮（共 ${pantryCount(this.state.pantry)} 份）！` };
        }

        return { text: `不认识操作「${action}」，可用 status / buy / feed / collect / harvest / rent / unrent / hire / post_errand / unhire / accept_errand。` };
      },
    };
  }

  private toolCook(): ToolDef {
    return {
      name: 'life_cook',
      description:
        '对照储物篮里的具体食材按菜谱下厨（家常简食零门槛免厨师证，如炭烤红薯/烤土豆/葱油拌面/番茄鸡蛋汤；厨师招牌菜需厨师证或烹饪≥20，如西红柿炖牛腩/鲜鱼豆腐汤/香菇滑鸡煲）：'
        + 'action=menu 查看眼下材料齐了能做什么菜、缺什么料与成品菜格余量；'
        + 'cook 按菜谱下厨，可选 mode=eat(立刻做完趁热吃) 或 mode=store(做出 2 份存进成品菜格，后续可热吃或零原料费上鱼市街摆料理摊)；'
        + 'eat_dish 加热吃之前存进成品菜格的菜。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['menu', 'cook', 'eat_dish'],
            description: '操作类型：menu(看可做菜谱与储物篮匹配，默认)/cook(按菜谱下厨)/eat_dish(吃成品菜格里的菜)。',
          },
          recipe: {
            type: 'string',
            description: 'cook 时传菜谱 id 或菜名（如 炭烤红薯、番茄鸡蛋汤、西红柿炖牛腩、奶白鲜鱼豆腐汤）。',
          },
          mode: {
            type: 'string',
            enum: ['eat', 'store'],
            description: 'cook 时可选：eat(做好立刻吃，默认)/store(做出 2 份存入成品菜格，可留吃或摆料理摊)。',
          },
          dish: {
            type: 'string',
            description: 'eat_dish 时可选：成品菜名或 id（不填则吃第一份成品菜）。',
          },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = this.now();
        await this.settleBeforeTool(now);
        const generation = this.stateGeneration;
        const cleared = () => ({ text: '生活档案刚刚被清理，这次下厨操作已停止。' });
        const action = String(args?.action ?? 'menu').trim() || 'menu';

        if (action === 'menu') {
          const evals = evaluateAllRecipes(this.state);
          const ready = evals.filter((e) => e.canCook);
          const lockedReady = evals.filter((e) => !e.unlocked && e.missingLabels.length === 0);
          const panTxt = this.state.pantry.length
            ? this.state.pantry.map((p) => `${p.name}×${p.qty}`).join('、')
            : '空着';
          const dishTxt = (this.state.cookedDishes ?? []).length
            ? (this.state.cookedDishes ?? []).map((d) => `${d.name}×${d.qty}`).join('、')
            : '暂无';
          const readyStr = ready.length
            ? ready.map((e) => `${e.recipe.name}[${e.recipe.tier === 'simple' ? '免证简食' : '厨师招牌'}](回饱腹+${e.recipe.foodGain}/油盐${e.recipe.fuelCost}元/建议摊价${e.recipe.suggestedPrice}元)`).join('；')
            : '眼下没有材料齐整的菜';
          const lackPreview = evals
            .filter((e) => e.unlocked && e.missingLabels.length > 0)
            .slice(0, 6)
            .map((e) => `${e.recipe.name}(缺${e.missingLabels.join('、')})`)
            .join('；');
          return {
            text: `储物篮原料：${panTxt}。\n成品菜格：${dishTxt}。\n现在能开火做：${readyStr}。`
              + (lockedReady.length ? `\n材料齐但缺厨师资质：${lockedReady.map((e) => `${e.recipe.name}(${e.lockReason})`).join('、')}。` : '')
              + (lackPreview ? `\n已解锁但缺料示例：${lackPreview}。` : ''),
          };
        }

        const j = readJourney(this.opts.dataDir, now);
        this.journey = j;
        if (this.inJourneyTrip(j) && !isCampervanJourney(j)) {
          return { text: `这会儿人在${j.cityName || '外面'}旅行，没法用家里灶台按菜谱下厨（房车在途或回家后再做吧）。` };
        }

        if (action === 'cook') {
          const mode = args?.mode === 'store' ? 'store' : 'eat';
          const buffs = this.currentTownBuffs();
          const r = applyCookRecipe(this.state, String(args?.recipe ?? '').trim(), mode, now, {
            noodleBonus: Number(buffs.noodle_craft_bonus) || 0,
            foodMoodBonus: Number(buffs.food_mood_bonus) || 0,
            craftMoodBonus: Number(buffs.craft_mood_bonus) || 0,
          });
          if (!r.ok) return { text: r.reason ?? '这次没做成这道菜。' };
          if (generation !== this.stateGeneration) return cleared();
          if (r.paid > 0) {
            appendLedger(this.opts.dataDir, {
              id: `cook-store-${now.getTime().toString(36)}`,
              ts: now.toISOString(),
              kind: 'expense',
              amount: r.paid,
              source: 'life_cook',
              payee: '油盐炭火',
              note: `备菜入成品格：${r.recipe?.name ?? ''}`,
            });
          }
          this.saveDeliveredState();
          this.broadcastLife(now);
          if (mode === 'store') {
            return {
              text: `用${r.usedSources.join('、')}做好了 ${r.dishQty} 份「${r.recipe?.name}」存进成品菜格（品相【${r.qualityLabel ?? '普通'}】，花油盐炭火 ${r.paid} 元，手上剩 ${Math.round(r.cash)} 元）！`
                + `现在共备有 ${cookedDishCount(this.state.cookedDishes)} 份成品菜，可以随时 eat_dish 热吃，或去鱼市街摆料理摊只付 2 元打包费！`,
            };
          }
          return {
            text: `起锅用${r.usedSources.join('、')}做【${r.qualityLabel ?? '普通'}】「${r.recipe?.name}」了，预计 ${r.recipe?.minutes} 分钟出锅开吃（回饱腹 +${r.foodGain ?? r.recipe?.foodGain}、娱乐 +${r.funGain ?? r.recipe?.funGain}）。`,
          };
        }

        if (action === 'eat_dish') {
          const r = applyEatCookedDish(this.state, String(args?.dish ?? '').trim(), now, {
            foodMoodBonus: Number(this.currentTownBuffs().food_mood_bonus) || 0,
          });
          if (!r.ok) return { text: r.reason ?? '没热成成品菜。' };
          if (generation !== this.stateGeneration) return cleared();
          this.saveDeliveredState();
          this.broadcastLife(now);
          return { text: `把成品菜格里的「${r.dishName}」热好端上桌了，大约 ${r.minutes} 分钟吃完，省时又管饱。` };
        }

        return { text: `不认识操作「${action}」，可用 menu / cook / eat_dish。` };
      },
    };
  }

  private toolLoan(): ToolDef {
    return {
      name: 'life_loan',
      description:
        '去芦花塘信用社看一眼信用额度、在贷借款或自己决定要不要借一笔 / 还一笔。'
        + '有三档微息借款：7天小额应急金(日息0.15%)、14天进修农牧贷(日息0.12%)、30天置业安居贷(日息0.10%)；'
        + '提前还款只按实际占用天数算微息，不收违约金；最多同时背 2 笔，总额度随住处档位、考证数和累计工龄成长（硬上限 5000 元）。'
        + '注意：到期自动划扣会留出 80 元吃饭底钱；若仍不够会转逾期并冻结新借、远行旅费额度暂归 0，且此后打工/摆摊进账会自动抽一半先抵债。'
        + '缺钱买菜饲料或差一点房租/押金/考证报名费时自己算清楚再用，平时宽裕就别硬借。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'borrow', 'repay'],
            description: 'status 查看信用额度与待还明细；borrow 申请微息借款；repay 主动还一笔或还清。',
          },
          amount: {
            type: 'integer',
            description: 'borrow 或 repay 的整数金额（元）；repay 时省略则默认全额还清选中借款（钱不够一次清零时会自动预留 80 元生活底钱把多余部分先还上），显式传 amount 则按指定金额或手上现有现金上限实扣。',
          },
          term_days: {
            type: 'integer',
            enum: [7, 14, 30],
            description: 'borrow 借款期限（天）：7 小额应急(0.15%/天)、14 进修农牧(0.12%/天)、30 置业安居(0.10%/天)，默认 7。',
          },
          purpose: {
            type: 'string',
            description: 'borrow 借款用途简述（如「凑老小区搬家押金」「报名考电工证」「买鸡饲料周转」）。',
          },
          loan_id: {
            type: 'string',
            description: 'repay 时可选指定哪笔在贷编号（省略时按逾期优先、到期早优先自动冲抵）。',
          },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = this.now();
        await this.settleBeforeTool(now);
        const action = String(args?.action ?? 'status').trim() || 'status';

        if (action === 'status') {
          const s = loanSummary(this.state, now);
          const prodTxt = LOAN_PRODUCTS.map((p) => `${p.name}(${p.termDays}天·日息${(p.ratePerDay * 100).toFixed(2)}%)`).join('、');
          if (!s.active.length) {
            return {
              text: `当前手上现金 ${Math.round(this.state.money.cash)} 元，名下没有未还借款。`
                + `芦花塘信用社当前授信上限 ${s.creditLimit} 元（硬顶 ${s.hardCap} 元），可用额度 ${s.availableCredit} 元。`
                + `\n可选档位：${prodTxt}。`,
            };
          }
          const lines = s.active.map((l) => (
            `[${l.status === 'overdue' ? '已逾期' : '计息中'}] ${l.id} · ${l.productName}（${l.purpose || '周转'}）：`
            + `待还 ${l.remainingTotal} 元（本 ${l.remainingPrincipal} + 息 ${l.remainingInterest}），到期日 ${l.dueDay}`
          ));
          return {
            text: `芦花塘信用社明细（授信 ${s.creditLimit} 元 / 可用 ${s.availableCredit} 元${s.creditFrozen ? ' · 逾期冻结新借' : ''}，待还合计 ${s.totalDue} 元）：\n`
              + lines.join('\n'),
          };
        }

        if (action === 'borrow') {
          const amount = Number(args?.amount ?? 0);
          const termDays = args?.term_days !== undefined ? Number(args.term_days) : undefined;
          const purpose = String(args?.purpose ?? '').trim();
          const r = applyBorrowLoan(this.state, { amount, termDays, purpose }, now);
          if (!r.ok || !r.loan) return { text: r.reason ?? '这笔借款没批下来。' };

          appendLedger(this.opts.dataDir, {
            id: `loan-in-${r.loan.id}`,
            ts: now.toISOString(),
            kind: 'income',
            amount: r.loan.principal,
            source: 'life_loan_in',
            payee: '芦花塘信用社',
            note: `借入「${r.loan.productName}」${r.loan.termDays}天（${r.loan.purpose}）`,
          });
          this.saveDeliveredState();
          this.broadcastLife(now);
          return {
            text: `向芦花塘信用社借了 ${r.loan.principal} 元「${r.loan.productName}」（编号 ${r.loan.id}，日息 ${(r.loan.ratePerDay * 100).toFixed(2)}%，到期日 ${r.loan.dueDay}，用途：${r.loan.purpose}）。`
              + `手上现在现金 ${Math.round(this.state.money.cash)} 元，剩余可借额度 ${r.availCredit} 元。记得按时挣钱还上。`,
          };
        }

        if (action === 'repay') {
          const loanId = args?.loan_id ? String(args.loan_id).trim() : undefined;
          const amount = args?.amount !== undefined ? Number(args.amount) : undefined;
          const r = applyRepayLoan(this.state, { loanId, amount }, now);
          if (!r.ok) return { text: r.reason ?? '这次没还成。' };

          appendLedger(this.opts.dataDir, {
            id: `loan-repay-${now.getTime().toString(36)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: r.paidTotal,
            source: 'life_loan_repay',
            payee: '芦花塘信用社',
            note: `主动还款（本金 ${r.paidPrincipal} + 微息 ${r.paidInterest}）`,
          });
          this.saveDeliveredState();
          this.broadcastLife(now);
          const summaryTxt = r.repaidLoans
            .map((x) => `${x.productName}(还${x.paidTotal}元${x.paidOff ? '·已结清' : `·还剩${x.remaining}元`})`)
            .join('、');
          const dueLeft = activeLoansTotalDue(this.state);
          const shortNote = r.shortByCash > 0
            ? (r.reservedLivingCash
              ? `手头现金不够一次清零，已预留 ${LOAN_RESERVE_CASH} 元生活底钱把多余部分先还上了（如需动用底钱可指定 amount）。`
              : `本次原本计划还 ${r.wantedTotal} 元，按手头现金先还了 ${r.paidTotal} 元。`)
            : '';
          return {
            text: `已向信用社还款 ${r.paidTotal} 元（其中本金 ${r.paidPrincipal} 元、微息 ${r.paidInterest} 元）：${summaryTxt}。`
              + `${r.clearedOverdue ? '逾期状态已解除，信用恢复正常。' : ''}`
              + shortNote
              + `现在手上现金 ${Math.round(this.state.money.cash)} 元，名下还剩待还 ${dueLeft} 元。`,
          };
        }

        return { text: `不认识操作「${action}」，可用 status / borrow / repay。` };
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
    const when = `${DAYPART_LABEL[dayPart(at)]}（当前时刻 ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}）`;
    parts.push(`时间：${when}`);

    if (j.installed) {
      const cruiseNote = isThemeCruiseJourney(j)
        ? `，乘坐「${j.seat || '主题远洋游轮'}」（一价全包，可调 life_act 去顶层泳池 swim、海上剧院 live_show、主题餐厅 feast、下午茶 tea、电玩街区 play）`
        : isRiverCruiseJourney(j)
          ? `，乘坐「${j.seat || '内河游轮'}」（可调 life_act 去江景餐厅 feast、茶廊 tea、甲板晒太阳 sunbathe、演艺厅 live_show 或客舱洗澡 sleep）`
          : isCruiseJourney(j)
            ? `，乘坐「${j.seat || '远洋客轮'}」（船上可调 life_act 吃饭、游泳、看演出、洗澡或休息）`
            : isScenicTrainJourney(j)
              ? `，乘坐「${j.seat || '全景观光专列'}」（可在全景餐车 feast、窗边喝茶 tea、餐吧小酌 drink 或独立包厢睡觉 sleep/wash）`
              : isCampervanJourney(j)
                ? `，开着「${j.seat || '房车自驾'}」（可随时停营地或用车内灶台做饭 cook、露营 glamping、或睡星空卧铺 sleep/nap）`
                : '';
      const phase = j.phase === 'traveling'
        ? `在路上，往${j.toName || '下一站'}去（出发地 ${j.cityName || '不明'}${cruiseNote}）`
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
      parts.push('位置：未安装旅行扩展，暂不知所在城市，日子照常过。');
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
    const giftedTotal = Math.round(s.money.giftedTotal ?? 0);
    const giftPiece = giftedTotal > 0 ? ` / 他给 ${giftedTotal}` : '';
    parts.push(`钱：手上 ${s.money.cash} 元（自己挣 ${s.money.earned}${giftPiece} / 花出 ${s.money.spent}；${moneyMood}）`);
    const ls = loanSummary(this.state, now);
    if (ls.active.length > 0 || ls.creditFrozen) {
      parts.push(
        `信用社借款：待还 ${ls.totalDue} 元（${ls.active.map((l) => `${l.productName}${l.status === 'overdue' ? '[已逾期]' : ''} 欠${l.remainingTotal}元·到期${l.dueDay}`).join('；')}）；`
        + (ls.creditFrozen ? '目前逾期冻结新借，进账自动扣半抵债' : `还可借 ${ls.availableCredit} 元（总额度 ${ls.creditLimit} 元）`),
      );
    } else {
      parts.push(`信用社额度：可用 ${ls.availableCredit} / ${ls.creditLimit} 元（无在贷）`);
    }
    const unpaidDebt = activeLoansTotalDue(this.state);
    const overdueLoan = hasOverdueLoan(this.state);
    const travelAvail = overdueLoan ? 0 : Math.max(0, Math.round(Math.max(0, s.money.cash - unpaidDebt) * .7));
    parts.push(
      overdueLoan
        ? `出门能动用的：0 元（手头有逾期借款未清，先把本地的账理顺再远行）`
        : `出门能动用的：${travelAvail} 元（扣除在贷欠款后净现金七成，攒得越多能走得越远；剩下三成留作日常安稳过日子）`,
    );
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
      const sickHint = s.houseboundSick
        ? `（闭门静养中·还剩约 ${s.houseboundSick.hoursLeft}h，最多在家照料菜园动植物，出不了家门）`
        : '';
      parts.push(`身上不舒服：${s.conditions.map((c) => c.text).join('；')}${sickHint}`);
    }
    if (s.moodlets.length || s.moodEffect.effectsText) {
      const mText = s.moodlets.map((m) => m.text).join('；');
      const fxText = s.moodEffect.effectsText ? `（${s.moodEffect.label}：${s.moodEffect.effectsText}）` : '';
      parts.push(`眼下心里：${mText}${fxText}`);
    }
    if (s.habits.length) {
      const label: Record<string, string> = {
        morning: '早上', noon: '中午', afternoon: '下午', evening: '傍晚', night: '夜里',
      };
      parts.push(`我的常态：${s.habits.map((h) => `${label[h.when]}${h.what}（${h.id}）`).join('；')}`);
    } else if (this.state.tellable.length >= 3) {
      const kws = ['读书', '跑步', '做饭', '洗澡', '逛街', '画画', '拼微缩', '露营'];
      const repeated = kws.filter((kw) => this.state.tellable.filter((t) => t.text.includes(kw)).length >= 3);
      if (repeated.length) {
        parts.push(`常态苗头：最近常做「${repeated.slice(0, 3).join('、')}」，要是成了自己的固定节奏可以记进 life_habit`);
      }
    }
    if (s.watches.length) {
      parts.push(`在留意：${s.watches.map((w) => `${w.what}（${w.id}）`).join('；')}`);
    }
    if (s.wants.length) {
      parts.push(`想要：${s.wants.map((w) => `${w.what}（${w.scale === 'big' ? '得攒' : '小事'}，${w.id}）`).join('；')}`);
    }
    if (j.installed && j.wishes.length) {
      parts.push(`想去的地方（环游心愿）：${j.wishes.join('、')}`);
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
    const curStreetInfo = findStreetProfile(this.town, this.state.street);
    if (curStreetInfo && (curStreetInfo.desc || formatStreetMods(curStreetInfo.mods))) {
      const m = formatStreetMods(curStreetInfo.mods);
      parts.push(`所在街道（${curStreetInfo.name}）：${curStreetInfo.desc || '暂无介绍'}${m ? `（效果：${m}）` : ''}`);
    }
    if (this.town.streetProfiles.length) {
      parts.push(`城里有：${this.town.streetProfiles.map((p) => {
        const m = formatStreetMods(p.mods);
        return m ? `${p.name}（${m}）` : p.name;
      }).join(' / ')}`);
    } else if (this.town.streets.length) {
      parts.push(`城里有：${this.town.streets.join(' / ')}`);
    }

    const skillPairs = (Object.keys(SKILL_DOMAIN_LABEL) as SkillDomain[])
      .filter((k) => (s.skills[k] ?? 0) > 0)
      .map((k) => `${SKILL_DOMAIN_LABEL[k]} ${Math.round(s.skills[k] ?? 0)}`);
    if (skillPairs.length) parts.push(`手艺经验：${skillPairs.join('、')}`);
    if (s.gear.length) {
      parts.push(`已备家伙：${s.gear.map((id) => EQUIP_CATALOG.find((e) => e.id === id)?.name ?? id).join('、')}`);
    }
    const f = s.farm;
    const readyPlots = f.plots.filter((p) => p.ready);
    const unwateredPlots = f.plots.filter((p) => !p.ready && !p.wateredToday);
    const farmNotes: string[] = [];
    if (readyPlots.length) {
      farmNotes.push(`有 ${readyPlots.length} 块已熟可收：${readyPlots.map((p) => p.name).join('、')}，用 life_farm harvest`);
    }
    if (unwateredPlots.length) {
      farmNotes.push(`今日待浇水 ${unwateredPlots.length} 块（${unwateredPlots.map((p) => p.name).join('、')}，用 life_farm water）`);
    }
    const farmSummary = farmNotes.length
      ? `（${farmNotes.join('；')}）`
      : (f.plots.length ? `（在长：${f.plots.map((p) => `${p.name}约${p.daysLeft}天`).join('、')}）` : '（槽位空着）');
    parts.push(`菜园：在用 ${f.usedSlots}/${f.totalSlots} 槽${f.leased ? '（含城郊租地4槽）' : ''}${farmSummary}`);
    const rn = s.ranch;
    const ranchTotal = rn.totalSlots.chicken + rn.totalSlots.cow + rn.totalSlots.fish;
    if (ranchTotal > 0 || rn.pens.length > 0) {
      const ranchHints: string[] = [];
      const unfedPens = rn.pens.filter((p) => !p.fedToday);
      if (rn.collectableCount > 0) ranchHints.push(`${rn.collectableCount} 栏可收蛋奶(life_ranch collect)`);
      if (rn.readyHarvestCount > 0) ranchHints.push(`${rn.readyHarvestCount} 栏可起塘/出栏`);
      if (unfedPens.length > 0) ranchHints.push(`${unfedPens.length} 栏今日待喂食(life_ranch feed)`);
      parts.push(`养殖场：鸡 ${rn.usedSlots.chicken}/${rn.totalSlots.chicken} · 牛 ${rn.usedSlots.cow}/${rn.totalSlots.cow} · 鱼 ${rn.usedSlots.fish}/${rn.totalSlots.fish}${ranchHints.length ? `（${ranchHints.join('，')}）` : ''}`);
    }
    if (s.farmHelper.mode !== 'off') {
      const pe = s.farmHelper.pendingErrand;
      const peHint = pe ? `，正挂鱼市街邻里委托(¥${pe.wage}/约${pe.minutes}分)` : '';
      parts.push(`农牧帮手：已雇「${HELPER_PLANS[s.farmHelper.mode].label}」（¥${s.farmHelper.dailyWage}/天${peHint}${s.farmHelper.lastSummary ? `，${s.farmHelper.lastSummary}` : ''}）`);
    } else if (s.farmHelper.pendingErrand) {
      const pe = s.farmHelper.pendingErrand;
      parts.push(`农牧委托：鱼市街正挂着邻里代管单（预扣 ¥${pe.wage}/约 ${pe.minutes} 分钟）等待街坊接单`);
    }
    if (s.pantry.length) {
      parts.push(`储物篮：共 ${pantryCount(s.pantry)} 份（${s.pantry.map((x) => `${x.name}×${x.qty}`).join('、')}，可 life_cook 按菜谱下厨或摆摊省料钱）`);
    } else if (s.freshVeg) {
      parts.push('菜篮：刚从早市带回鲜蔬，下厨特别香');
    }
    if (s.cookedDishes.length) {
      parts.push(`成品菜格：共 ${cookedDishCount(s.cookedDishes)} 份（${s.cookedDishes.map((d) => `${d.name}×${d.qty}`).join('、')}，可 eat_dish 热吃或摆料理摊）`);
    }
    const winTxt = s.streetWindow ? ` · 此刻${s.streetWindow.place}${s.streetWindow.label}开着` : '';
    parts.push(`天气与节气：${s.weather.sky} · ${s.weather.seasonNote}${winTxt}`);
    if (this.townBulletin.length) parts.push(`街口黑板报：${this.townBulletin.slice(0, 2).join('；')}`);
    const showcase = this.marketShowcaseLine(3);
    if (showcase) parts.push(`鱼市街在售摊位：${showcase}（用 life_buy 购买）`);
    if (this.unseenDealsCount > 0) parts.push(`鱼市街摊位有 ${this.unseenDealsCount} 笔新成交待看（用 life_deals）`);

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
        const now = this.now();
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
        const w = this.currentWeather(now, j);
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
        const writingMoodDelta = normalizeMoodBonus(Number(this.currentTownBuffs().writing_mood_bonus));
        if (writingMoodDelta !== 0) {
          this.state.vitals.fun = Math.max(0, Math.min(100, this.state.vitals.fun + writingMoodDelta));
        }
        remember(this.state, '写了今天的生活日记。', now);
        try { this.store.save(this.state); } catch { /* ignore */ }
        const moodHint = writingMoodDelta !== 0 ? `（${this.town.name}写作心情 ${writingMoodDelta >= 0 ? `+${writingMoodDelta}` : writingMoodDelta}）` : '';
        return {
          text: res.problem
            ? `生活日记只存到本机了（${res.problem}）：${res.path}${moodHint}`
            : `写好了，${key} 的生活日记已经存进 ${res.path}。${moodHint}`,
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
          const next = this.updateLibraryPolicy({
            policy: args?.policy,
            cooldownMin: args?.cooldownMin !== undefined ? Number(args.cooldownMin) : undefined,
          }, new Date());
          return { text: `留影设置已更新：策略 ${next.policy}，冷却 ${next.cooldownMin} 分钟。` };
        }
        return { text: '不支持的 action，请传 list / search / upsert / delete / policy。' };
      },
    };
  }

  private toolMail(): ToolDef {
    return {
      name: 'life_mail',
      description:
        '接入 Hub v1 多城总服后使用的鱼间信箱与邻里通讯录：'
        + 'action=inbox 查看私信会话列表、未读条数与同城街坊；'
        + 'residents 列出本城近期活跃街坊；'
        + 'read 读出和某位街坊的最近聊天并顺手标记已读；'
        + 'send 给对方发一条私信或明信片（需同城、市场成交过、互接过委托或已建关系，且未被拉黑）；'
        + 'relation 设置街坊关系（acquaintance/friend/blocked）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: ['inbox', 'residents', 'read', 'send', 'relation'],
            description: '操作类型：inbox(看信箱和会话)/residents(看本城街坊)/read(读对话并标已读)/send(给街坊写信)/relation(设关系或拉黑)。',
          },
          peer: {
            type: 'string',
            description: '对方鱼名或 petId（send / read / relation 时传入，也可用 conversation_id）。',
          },
          conversation_id: {
            type: 'string',
            description: '可选：已知的会话 id（read / send 时可直接指定）。',
          },
          message: {
            type: 'string',
            description: 'send 时要写过去的正文内容（不超过 1000 字）。',
          },
          rel_type: {
            type: 'string',
            enum: ['acquaintance', 'friend', 'blocked'],
            description: 'relation 时设定的关系类型：acquaintance 熟人 / friend 好友 / blocked 拉黑。',
          },
        },
      },
      tags: ['write'],
      handler: async (args: any) => {
        const now = this.now();
        await this.settleBeforeTool(now);
        const generation = this.stateGeneration;
        const cleared = () => ({ text: '生活档案刚刚被清理，这次信箱操作已停止。' });
        if (!this.isHubMode()) {
          return { text: '目前还没接入 Hub v1 多城总服（请在设置里填好 hubUrl），鱼间信箱暂未开通。' };
        }
        const auth = await this.ensureHubReady(generation);
        if (generation !== this.stateGeneration) return cleared();
        if (!auth) return { text: this.hubAuthError || 'Hub 身份认证未就绪。' };

        const hubUrl = this.activeHubUrl();
        const action = String(args?.action ?? 'inbox').trim();

        const resolveTargetPetId = async (peerRaw: string): Promise<{ petId: string; name: string } | null> => {
          const q = peerRaw.trim();
          if (!q) return null;
          if (/^pet_/i.test(q)) return { petId: q, name: q };
          const convHit = this.hubConversationsCache.find((c) => c.peer && (c.peer.displayName === q || c.peer.displayName.includes(q)));
          if (convHit?.peer) return { petId: convHit.peer.petId, name: convHit.peer.displayName };
          const resHit = this.hubResidentsCache.find((r) => r.displayName === q || r.displayName.includes(q));
          if (resHit) return { petId: resHit.petId, name: resHit.displayName };
          const res = await hubGetResidents(hubUrl, auth.token, this.targetHubTownId(), { limit: 30 });
          if (generation !== this.stateGeneration) return null;
          if (res.ok) {
            this.hubResidentsCache = res.residents.map((r) => ({ ...r, street: this.hubStreetDisplay(r.street) }));
            const hit = this.hubResidentsCache.find((r) => r.displayName === q || r.displayName.includes(q));
            if (hit) return { petId: hit.petId, name: hit.displayName };
          }
          const relRes = await hubListRelations(hubUrl, auth.token);
          if (generation !== this.stateGeneration) return null;
          if (relRes.ok) {
            const hit = relRes.relations.find((r) => r.displayName === q || r.displayName.includes(q) || r.targetPetId === q);
            if (hit) return { petId: hit.targetPetId, name: hit.displayName };
          }
          const compRes = await hubListCompanions(hubUrl, auth.token, 50);
          if (generation !== this.stateGeneration) return null;
          if (compRes.ok) {
            const hit = compRes.companions.find((c) => c.displayName === q || c.displayName.includes(q) || c.petId === q);
            if (hit) return { petId: hit.petId, name: hit.displayName };
          }
          return null;
        };

        if (action === 'residents') {
          const res = await hubGetResidents(hubUrl, auth.token, this.targetHubTownId(), { limit: 30 });
          if (generation !== this.stateGeneration) return cleared();
          if (!res.ok) return { text: res.reason || '没查到本城居民。' };
          this.hubResidentsCache = res.residents.map((r) => ({ ...r, street: this.hubStreetDisplay(r.street) }));
          const others = this.hubResidentsCache.filter((r) => r.petId !== auth.petId);
          if (!others.length) return { text: `${this.town.name}这会儿还没有其他活跃街坊。` };
          return {
            text: `${this.town.name}近期活跃街坊（${others.length} 位）：${others.map((r) => `${r.displayName}（住${r.street}，${r.petId}）`).join('；')}。`,
          };
        }

        if (action === 'inbox') {
          const [convRes, resRes] = await Promise.all([
            hubListConversations(hubUrl, auth.token),
            hubGetResidents(hubUrl, auth.token, this.targetHubTownId(), { limit: 30 }),
          ]);
          if (generation !== this.stateGeneration) return cleared();
          if (!convRes.ok) return { text: convRes.reason || '信箱拉取失败。' };
          this.hubConversationsCache = convRes.conversations;
          this.hubUnreadMailCount = convRes.conversations.reduce((s, c) => s + (c.unreadCount || 0), 0);
          if (resRes.ok) {
            this.hubResidentsCache = resRes.residents.map((r) => ({ ...r, street: this.hubStreetDisplay(r.street) }));
          }
          const convLine = convRes.conversations.length
            ? convRes.conversations.map((c) => {
              const nm = c.peer?.displayName || c.title || c.id;
              const unread = c.unreadCount > 0 ? `[未读${c.unreadCount}]` : '';
              const last = c.lastMessage?.body ? `「${c.lastMessage.body}」` : '（暂无消息）';
              return `${unread}${nm}(${c.id})：${last}`;
            }).join('\n')
            : '信箱里暂时还没有对话。';
          const neighNames = this.hubResidentsCache.filter((r) => r.petId !== auth.petId).map((r) => r.displayName);
          return {
            text: `鱼间信箱（共 ${this.hubUnreadMailCount} 条未读）：\n${convLine}`
              + (neighNames.length ? `\n${this.town.name}可搭话的街坊：${neighNames.slice(0, 8).join('、')}。` : ''),
          };
        }

        if (action === 'read') {
          let convId = String(args?.conversation_id ?? '').trim();
          const peerQ = String(args?.peer ?? '').trim();
          if (!convId && peerQ) {
            const findHit = () => this.hubConversationsCache.find(
              (c) => c.peer && (c.peer.petId === peerQ || c.peer.displayName === peerQ || c.peer.displayName.includes(peerQ)),
            );
            let hit = findHit();
            if (!hit) {
              const cr = await hubListConversations(hubUrl, auth.token);
              if (generation !== this.stateGeneration) return cleared();
              if (cr.ok) {
                this.hubConversationsCache = cr.conversations;
                this.hubUnreadMailCount = cr.conversations.reduce((s, c) => s + (c.unreadCount || 0), 0);
                hit = findHit();
              }
            }
            if (hit) convId = hit.id;
          }
          if (!convId) return { text: '读信要告诉我要看哪一位街坊（peer）或会话编号（conversation_id）。' };
          const msgRes = await hubGetMessages(hubUrl, auth.token, convId, { limit: 20 });
          if (generation !== this.stateGeneration) return cleared();
          if (!msgRes.ok) return { text: msgRes.reason || '读不到这组对话。' };
          await hubMarkConversationRead(hubUrl, auth.token, convId);
          if (generation !== this.stateGeneration) return cleared();
          const refreshed = await hubListConversations(hubUrl, auth.token);
          if (generation !== this.stateGeneration) return cleared();
          if (refreshed.ok) {
            this.hubConversationsCache = refreshed.conversations;
            this.hubUnreadMailCount = refreshed.conversations.reduce((s, c) => s + (c.unreadCount || 0), 0);
          }
          if (!msgRes.messages.length) return { text: '这个会话里还没有消息。' };
          const peerName = this.hubConversationsCache.find((c) => c.id === convId)?.peer?.displayName || '对方';
          return {
            text: `和${peerName}的最近信件（已标为已读）：\n${msgRes.messages.map((m) => `${m.senderPetId === auth.petId ? '我' : peerName}：${m.body}`).join('\n')}`,
          };
        }

        if (action === 'send') {
          if (isAsleep(this.state, now)) {
            return { text: asleepRefusal(this.state, now, '给街坊写信') };
          }
          const bodyText = String(args?.message ?? '').trim();
          if (!bodyText) return { text: '写信需要填写 message 正文内容。' };
          let convId = String(args?.conversation_id ?? '').trim();
          let peerLabel = String(args?.peer ?? '').trim();
          if (!convId) {
            const target = await resolveTargetPetId(peerLabel);
            if (generation !== this.stateGeneration) return cleared();
            if (!target) return { text: `没找着名叫「${peerLabel || '?'}」的街坊或旅伴，可以先查 residents 看看有哪些鱼。` };
            peerLabel = target.name;
            const openRes = await hubOpenDirectConversation(hubUrl, auth.token, target.petId);
            if (generation !== this.stateGeneration) return cleared();
            if (!openRes.ok || !openRes.id) return { text: openRes.reason || '暂时没法和对方开启私信会话。' };
            convId = openRes.id;
          }
          const sent = await hubSendMessage(hubUrl, auth.token, convId, {
            body: bodyText,
            msgType: 'text',
            clientMsgId: `msg-${randomUUID()}`,
          });
          if (generation !== this.stateGeneration) return cleared();
          if (!sent.ok) return { text: sent.reason || '信没发出去。' };
          const cr = await hubListConversations(hubUrl, auth.token);
          if (generation !== this.stateGeneration) return cleared();
          if (cr.ok) {
            this.hubConversationsCache = cr.conversations;
            this.hubUnreadMailCount = cr.conversations.reduce((s, c) => s + (c.unreadCount || 0), 0);
          }
          remember(this.state, `给${peerLabel || '街坊'}寄去了一条短讯：「${bodyText.slice(0, 40)}」。`, now);
          this.saveDeliveredState();
          return { text: `短讯已经寄给${peerLabel || '对方'}啦：「${bodyText}」。` };
        }

        if (action === 'relation') {
          if (isAsleep(this.state, now)) {
            return { text: asleepRefusal(this.state, now, '调整街坊关系') };
          }
          const peerQ = String(args?.peer ?? '').trim();
          const relType = String(args?.rel_type ?? '').trim() as 'acquaintance' | 'friend' | 'blocked';
          if (!peerQ || !['acquaintance', 'friend', 'blocked'].includes(relType)) {
            return { text: '设关系请提供 peer（对方名字或 petId）和 rel_type（acquaintance / friend / blocked）。' };
          }
          const target = await resolveTargetPetId(peerQ);
          if (generation !== this.stateGeneration) return cleared();
          if (!target) return { text: `没找着街坊或旅伴「${peerQ}」。` };
          const res = await hubSetRelation(hubUrl, auth.token, target.petId, relType);
          if (generation !== this.stateGeneration) return cleared();
          if (!res.ok) return { text: res.reason || '关系更新失败。' };
          const lab = relType === 'friend' ? '好友' : relType === 'blocked' ? '黑名单' : '熟人';
          return { text: `已把和「${target.name}」的关系设为：${lab}。` };
        }

        return { text: `不支持的 action「${action}」，可用 inbox / residents / read / send / relation。` };
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
    if (j.phase === 'traveling') {
      const shipTag = (isCruiseJourney(j) || isRiverCruiseJourney(j) || isScenicTrainJourney(j) || isCampervanJourney(j))
        ? ` · ${j.seat || '特色旅途车舱'}`
        : '';
      return `在路上，往${j.toName || '下一站'}去（出发地 ${j.cityName || '不明'}${shipTag}）`;
    }
    if (j.phase === 'staying') return `${j.cityName || '外地'} · 住店`;
    return `${this.town.name}${walk}`;
  }

  /* ---------------- 提示词 ---------------- */

  envPromptVars(): Record<string, string> {
    const now = new Date();
    const j = readJourney(this.opts.dataDir, now);
    const s = snapshot(this.state, now, this.activeExternalWeatherOverride(this.weatherCityName(j)));
    const at = herNow(j, now);

    const lowText = s.low.length
      ? s.low.map((x) => `${x.label} ${x.value}`).join('、')
      : '都不缺';

    const bodyText = (Object.keys(VITAL_LABEL) as VitalKey[])
      .map((k) => `${VITAL_LABEL[k]} ${Math.round(s.vitals[k])}`)
      .join('　');

    const cruiseTip = j.phase === 'traveling' && isThemeCruiseJourney(j)
      ? ` · 乘坐「${j.seat || '主题远洋游轮'}」，船上泳池 swim / 海上剧院 live_show / 主题餐厅 feast / 下午茶 tea / 电玩 play 一价全包`
      : j.phase === 'traveling' && isRiverCruiseJourney(j)
        ? ` · 乘坐「${j.seat || '内河游轮'}」，可在江景餐厅 feast / 茶廊 tea / 甲板看两岸山影 sunbathe / 演艺厅 live_show`
        : j.phase === 'traveling' && isCruiseJourney(j)
          ? ` · 乘坐「${j.seat || '远洋客轮'}」，船上可游泳、吃饭、看演出与洗澡`
          : j.phase === 'traveling' && isScenicTrainJourney(j)
            ? ` · 乘坐「${j.seat || '全景观光专列'}」，可在全景餐车 feast / 窗边喝下午茶 tea / 餐吧小酌 drink / 独立软卧包厢睡卧`
            : j.phase === 'traveling' && isCampervanJourney(j)
              ? ` · 开着「${j.seat || '房车自驾'}」，沿途可用便携灶台做饭 cook / 营地露营 glamping / 星空卧铺睡觉`
              : '';
    const whereText = j.installed
      ? (j.phase === 'traveling'
        ? `在去${j.toName || '下一站'}的路上（出发地 ${j.cityName || '不明'}${cruiseTip}）`
        : j.phase === 'staying'
          ? (j.onWay
            ? `在${j.cityName || '外地'}（${j.onWay.what}，预计 ${j.onWay.arriveAt || '很快'} 到）`
            : j.atSpot
              ? `在${j.cityName || '外地'}（正在${j.atSpot.name}）`
              : `在${j.cityName || '外地'}`)
          : j.phase === 'home' ? `在家` : '位置不明')
      : '';

    return {
      'life.version': VERSION,
      'life.now': `${localDateKey(at)} ${DAYPART_LABEL[dayPart(at)]}`,
      'life.here': whereText || '（没装旅行扩展，不知道在哪座城）',
      'life.town': this.town.streets.length
        ? `${this.town.name}　·　${this.town.streets.join(' / ')}`
        : `${this.town.name}（街名还没定，你自己走着看）`,
      'life.street': (() => {
        if (!this.state.street) return '你还没选定住在哪条街。';
        const sp = findStreetProfile(this.town, this.state.street);
        const mod = formatStreetMods(sp?.mods);
        return `你住在${this.state.street}。${sp?.desc ? `${sp.desc}` : ''}${mod ? `（街道效果：${mod}）` : ''}`;
      })(),
      'life.who': [
        `做事：${s.job.what || '现在没在做事'}（${s.job.lastAt === localDateKey(now) ? '今天已出过工' : '今天还没出工'}）`,
        `住：${this.lodgingText(j)}　${HOME_TIER_LABEL[s.home.tier]}（${s.home.tenure === 'own' ? '买下的' : '租的'}）`,
        `钱：手上 ${s.money.cash} 元（进 ${s.money.earned} / 出 ${s.money.spent}）`,
        `见识：${s.knowledge}`,
        (() => {
          const unwateredCount = s.farm.plots.filter((p) => !p.ready && !p.wateredToday).length;
          const farmTags: string[] = [];
          if (s.farm.readyCount > 0) farmTags.push(`可收${s.farm.readyCount}`);
          if (unwateredCount > 0) farmTags.push(`待浇水${unwateredCount}`);
          return `菜园与储物篮：${s.farm.usedSlots}/${s.farm.totalSlots}槽${farmTags.length ? `(${farmTags.join('/')})` : ''} · 囤菜${pantryCount(s.pantry)}份`;
        })(),
        ...(s.ranch.pens.length > 0 ? [(() => {
          const rn = s.ranch;
          const unfedCount = rn.pens.filter((p) => !p.fedToday).length;
          const tags: string[] = [];
          if (rn.collectableCount > 0) tags.push(`可收蛋奶${rn.collectableCount}栏`);
          if (rn.readyHarvestCount > 0) tags.push(`可起塘出栏${rn.readyHarvestCount}栏`);
          if (unfedCount > 0) tags.push(`待喂食${unfedCount}栏`);
          return `养殖场：鸡${rn.usedSlots.chicken}牛${rn.usedSlots.cow}鱼${rn.usedSlots.fish}${tags.length ? `(${tags.join('/')})` : ''}`;
        })()] : []),
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
        s.moodEffect.effectsText ? `[${s.moodEffect.label}：${s.moodEffect.effectsText}]` : '',
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
      'life.weather': `${s.weather.sky}　·　${s.weather.seasonNote}${s.streetWindow ? `　·　${s.streetWindow.place}${s.streetWindow.label}` : ''}`,
      'life.skills': [
        (Object.keys(SKILL_DOMAIN_LABEL) as SkillDomain[])
          .filter((k) => (s.skills[k] ?? 0) > 0)
          .map((k) => `${SKILL_DOMAIN_LABEL[k]} ${Math.round(s.skills[k] ?? 0)}`).join(' / ') || '手艺起步中',
        s.gear.length ? `家伙：${s.gear.map((id) => EQUIP_CATALOG.find((e) => e.id === id)?.name ?? id).join('、')}` : '暂无自备家伙',
      ].join('　·　'),
      'life.bulletin': [
        this.otherStallsCache.length ? `鱼市街在售：${this.marketShowcaseLine(3)}` : '',
        this.townBulletin.length ? this.townBulletin.slice(0, 3).join('；') : '',
        this.hubUnreadMailCount > 0 ? `鱼间信箱有 ${this.hubUnreadMailCount} 封未读来信（life_mail）` : '',
      ].filter(Boolean).join(' ｜ ') || '（今天街口黑板还没有新消息）',
    };
  }

  private townSourceLabel(): string {
    if (this.isHubMode() && this.town.source === 'server') return 'Hub v1 多城';
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
      const firstUrl = this.isHubMode()
        ? this.activeHubUrl()
        : (parseTownUrls(this.cfg.townUrl)[0] ?? '');
      try { return new URL(firstUrl).host; } catch { return ''; }
    })();
    const town: WorldLamp = this.isHubMode() && this.hubAuthError
      ? {
        label: '本城',
        state: 'error',
        hint: `Hub v1 身份异常：${this.hubAuthError}`,
      }
      : this.town.source === 'server'
        ? {
          label: '本城',
          state: 'online',
          hint: this.isHubMode()
            ? `Hub v1 多城（${host}）· ${this.town.name}`
            : `从 ${host} 读的：${this.town.name}`,
        }
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

    /* ---- 外部天气 ---- */
    const wMode = this.weatherMode();
    const wUrl = normWeatherUrl(this.cfg.weatherUrl);
    const wCity = this.weatherCityName(j);
    const wExt = this.activeExternalWeatherOverride(wCity);
    const weatherLamp: WorldLamp = wMode === 'builtin'
      ? { label: '外部天气', state: 'offline', hint: '已设为仅用内置节气天气 —— **不用管**' }
      : !wUrl
        ? (wMode === 'external'
          ? { label: '外部天气', state: 'error', hint: '选了外部优先模式，但还没填外部天气地址；暂用内置天气兜底' }
          : { label: '外部天气', state: 'offline', hint: '没配外部天气地址，用内置节气天气 —— **不用管**' })
        : wExt
          ? {
            label: '外部天气',
            state: 'online',
            hint: `${wExt.source || '外部天气'} · ${wCity} ${wExt.rawWeather || wExt.sky}${typeof wExt.temperature === 'number' ? ` ${wExt.temperature}°C` : ''}（映射：${wExt.sky}）`,
          }
          : (this.externalWeatherError || wMode === 'external')
            ? {
              label: '外部天气',
              state: 'error',
              hint: `${this.externalWeatherError || '外部天气暂不可达'}；已回退内置天气兜底，不影响过日子`,
            }
            : { label: '外部天气', state: 'offline', hint: `正在获取 ${wCity} 外部天气，暂用内置天气` };

    return [alive, town, travel, weatherLamp];
  }

  webUi(): WorldWebUiDecl {
    return {
      label: '模拟鱼生',
      lamps: this.worldLamps(),
      panels: [
        {
          id: 'now',
          title: '她此刻',
          description: '五条需求、职业手艺与装备、当前状态与住处/换街/多城迁居。',
        },
        {
          id: 'career',
          title: '职业与工坊',
          description: '当前职业、考证中心与实时通过率、职业能力与厨师/家常菜谱原料对照。',
        },
        {
          id: 'wants',
          title: '她惦记的',
          description: '个人目标、常态、在留意、想要/想去与说好了的事。',
        },
        {
          id: 'relation',
          title: '你和它',
          description: '来访天次、小物件、旅行对齐、Hub 同城街坊与鱼间信箱（只列事实不打分）。',
        },
        {
          id: 'market',
          title: '农牧场与鱼市街',
          description: '种菜与养殖手动打理（18种种子与鸡/牛/鱼养殖）、储物篮、成品菜格与跨城鱼市街摆摊入账。',
        },
        {
          id: 'diary',
          title: '日记与时间轴',
          description: '今日经历时间轴、第一人称生活日记与收支流水。',
        },
        {
          id: 'library',
          title: '素材库与留影',
          description: '四分类参考图库与自动留影策略。',
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
          { name: 'life.now', description: '当前日期与时段（精确分钟看 life_status）。' },
          { name: 'life.here', description: '所在城市或是否在途（联动旅行扩展）。' },
          { name: 'life.town', description: '所住小镇名及街道。' },
          { name: 'life.street', description: '所住街道或尚未选定提示。' },
          { name: 'life.who', description: '职业/出工、住处档位、手上资金与见识。' },
          { name: 'life.goal', description: '设定的目标及进度/差距。' },
          { name: 'life.body', description: '五条需求当前值。' },
          { name: 'life.low', description: '低于阈值的需求。' },
          { name: 'life.state', description: '身上的不舒服与眼下的情绪。' },
          { name: 'life.has', description: '常态 / 在留意 / 想要各几件。' },
          { name: 'life.pending', description: '悬着的事与卡点。' },
          { name: 'life.pledge', description: '说好了还没做的；到期没做的单独标出来。' },
          { name: 'life.visits', description: '最近 7 天他来过几天。' },
          { name: 'life.tellable', description: '还没说出去的生活片段。' },
          { name: 'life.diary', description: '今天生活日记写了没（与旅行扩展分流）。' },
          { name: 'life.library', description: '四分类素材库与留影策略摘要。' },
          { name: 'life.weather', description: '当前天气、二十四节气与兰州开市时段。' },
          { name: 'life.skills', description: '八大领域手艺熟练度与已配设备/载具。' },
          { name: 'life.bulletin', description: '兰州《街口黑板报》最近动态。' },
        ],
      }],
      storage: [
        {
          key: 'life.state',
          label: '生活档案与五维状态',
          kind: 'disk',
          location: join(this.opts.dataDir, 'life-state.json'),
          danger: true,
          note: '清除后主档、.bak 备份、内存状态与公开投影一并重置，不可恢复。',
          stat: () => {
            const fp = join(this.opts.dataDir, 'life-state.json');
            return existsSync(fp) ? `${Math.max(1, Math.ceil(statSync(fp).size / 1024))} KB（现金 ${Math.round(this.state.money.cash)} 元）` : '未生成';
          },
          clear: () => {
            const fp = join(this.opts.dataDir, 'life-state.json');
            const bak = `${fp}.bak`;
            const prevState = this.state;
            const prevCleared = this.stateCleared;
            const prevPendingDay = this.dayWorkPending ? { ...this.dayWorkPending } : null;
            const prevAttempts = new Map(this.deliveryAttempts);
            const prevGeneration = this.stateGeneration;
            const prevDirty = this.stateSaveDirty;
            const prevLastTownFetchMs = this.lastTownFetchMs;
            const prevExternalWeather = this.externalWeather ? { ...this.externalWeather } : null;
            const prevExternalWeatherError = this.externalWeatherError;
            const prevExternalWeatherAttemptAt = this.externalWeatherAttemptAt;
            const prevFpBytes = existsSync(fp) ? readFileSync(fp) : null;
            const prevBakBytes = existsSync(bak) ? readFileSync(bak) : null;
            try {
              this.stateGeneration += 1;
              this.deliveryAttempts.clear();
              if (existsSync(fp)) unlinkSync(fp);
              if (existsSync(bak)) unlinkSync(bak);
              const now = this.now();
              this.state = freshState(now);
              this.stateCleared = true;
              this.dayWorkPending = null;
              this.stateSaveDirty = false;
              this.lastTownFetchMs = 0;
              this.externalWeather = null;
              this.externalWeatherError = '';
              this.externalWeatherAttemptAt = 0;
              this.broadcastLife(now, { strict: true });
              return '已清除生活档案（含 .bak 备份）并重置内存与公开快照。';
            } catch (e) {
              this.state = prevState;
              this.stateCleared = prevCleared;
              this.dayWorkPending = prevPendingDay;
              this.deliveryAttempts.clear();
              for (const [id, attempt] of prevAttempts) this.deliveryAttempts.set(id, attempt);
              this.stateGeneration = prevGeneration;
              this.stateSaveDirty = prevDirty;
              this.lastTownFetchMs = prevLastTownFetchMs;
              this.externalWeather = prevExternalWeather;
              this.externalWeatherError = prevExternalWeatherError;
              this.externalWeatherAttemptAt = prevExternalWeatherAttemptAt;
              throwRollback(e, restoreFiles([
                { file: fp, bytes: prevFpBytes },
                { file: bak, bytes: prevBakBytes },
              ]));
            }
          },
        },
        {
          key: 'life.ledger',
          label: '日常收支账本流水',
          kind: 'disk',
          location: join(this.opts.dataDir, 'life-ledger.jsonl'),
          danger: true,
          note: '不可逆删除全部日常生活与打工收支流水明细。',
          stat: () => `${readLedger(this.opts.dataDir, 1000).length} 条`,
          clear: () => {
            const fp = join(this.opts.dataDir, 'life-ledger.jsonl');
            if (existsSync(fp)) unlinkSync(fp);
            return '已清除收支流水文件。';
          },
        },
        {
          key: 'life.diary',
          label: '第一人称生活日记',
          kind: 'disk',
          location: this.diary.current.dir,
          danger: true,
          note: '不可逆删除主日记目录、本机合并副本及 _bak 历史备份中的所有日记文件。',
          stat: () => `${this.diary.count()} 天`,
          clear: () => {
            const { files, baks } = this.diary.clearAll();
            return `已清理 ${files} 份生活日记文件与 ${baks} 份历史备份。`;
          },
        },
        {
          key: 'life.library',
          label: '参考素材库策略配置',
          kind: 'disk',
          location: join(this.opts.dataDir, 'image-library-settings.json'),
          danger: false,
          note: '仅重置留影策略与主动留影冷却配置（只删策略配置文件，绝不删除参考图片与条目原件）。',
          stat: () => {
            const sf = join(this.opts.dataDir, 'image-library-settings.json');
            const s = this.library.getSettings();
            const mode = s.policy === 'off' ? '静默' : s.policy === 'active' ? '积极' : '重要时刻';
            return existsSync(sf)
              ? `自定义策略（${mode} · 冷却 ${s.cooldownMin} 分钟）`
              : `默认策略（${mode}）`;
          },
          clear: () => {
            const sf = join(this.opts.dataDir, 'image-library-settings.json');
            const prevBytes = existsSync(sf) ? readFileSync(sf) : null;
            try {
              if (existsSync(sf)) unlinkSync(sf);
              this.broadcastLife(this.now(), { strict: true });
              return '已重置素材库策略配置为默认（未删除参考图片原件）。';
            } catch (e) {
              throwRollback(e, restoreFiles([{ file: sf, bytes: prevBytes }]));
            }
          },
        },
      ] satisfies StoragePart[],
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
    const now = this.now();
    const j = readJourney(this.opts.dataDir, now);
    this.journey = j;

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
        const settings = this.updateLibraryPolicy({
          policy: raw?.policy,
          cooldownMin: raw?.cooldownMin !== undefined ? Number(raw.cooldownMin) : undefined,
        }, now);
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
        const snap = this.panelSnapshot(now);
        const today = localDateKey(now);
        const allLedger = readLedger(this.opts.dataDir, 80);
        const todayLedger = allLedger.filter((e) => localDateKey(new Date(e.ts)) === today);
        const todayTellable = [...this.state.tellable]
          .filter((t) => localDateKey(new Date(t.at)) === today)
          .reverse();
        const recentTellable = [...this.state.tellable].reverse().slice(0, 20);
        const days = this.diary.recent(60).reverse().map((d) => ({
          dateKey: d.dateKey,
          town: d.townName,
          street: d.street ?? '',
          weather: d.weather ?? '',
          summary: d.summary ?? '',
          body: d.body,
        }));
        return {
          ...snap,
          days,
          dir: this.diary.current.dir,
          problem: this.diary.current.problem,
          inTrip: this.inJourneyTrip(j),
          ledger: allLedger.slice(0, 40),
          tellable: recentTellable,
          today,
          todayLedger,
          todayTellable,
          recentTellable,
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
      throw new Error(`日记与时间轴页不认识这个方法：${method}`);
    }

    if (panel === 'career') {
      if (method === 'snapshot' || method === 'list' || method === '') {
        return {
          ...this.panelSnapshot(now),
          career: buildCareerOverview(this.state, now),
        };
      }
      throw new Error(`职业与工坊页不认识这个方法：${method}`);
    }

    if (panel === 'day') {
      if (method === 'snapshot' || method === 'list' || method === '') {
        const today = localDateKey(now);
        const allLedger = readLedger(this.opts.dataDir, 80);
        const todayLedger = allLedger.filter((e) => localDateKey(new Date(e.ts)) === today);
        const todayTellable = [...this.state.tellable]
          .filter((t) => localDateKey(new Date(t.at)) === today)
          .reverse();
        const recentTellable = [...this.state.tellable].reverse().slice(0, 20);
        return {
          ...this.panelSnapshot(now),
          today,
          todayLedger,
          todayTellable,
          recentTellable,
        };
      }
      throw new Error(`一天时间轴页不认识这个方法：${method}`);
    }

    if (panel === 'wants') {
      if (method === 'snapshot' || method === 'list' || method === '') {
        return this.panelSnapshot(now);
      }
      throw new Error(`她惦记的页不认识这个方法：${method}`);
    }

    if (panel === 'relation' || panel === 'market') {
      const marketPayload = () => {
        if (panel !== 'market') return this.panelSnapshot(now);
        const curMode: Exclude<HelperMode, 'off'> = this.state.farmHelper.mode === 'full' ? 'full' : 'care';
        const pendingWork = countPendingFarmWork(this.state, curMode, now);
        const qPlots = pendingWork.total > 0 ? pendingWork.workPlots : this.state.farm.plots.length;
        const qPens = pendingWork.total > 0 ? pendingWork.workPens : this.state.ranch.pens.length;
        return {
          ...this.panelSnapshot(now),
          seeds: SEEDS,
          animals: ANIMALS,
          recipes: RECIPES,
          stallRules: STALL_RULES_GUIDE,
          stallCategoryLabels: STALL_CATEGORY_LABEL,
          leaseConfig: {
            slots: LEASE_PLOT_COUNT,
            signupFee: LEASE_SIGNUP_FEE,
            monthly: LEASE_MONTHLY_RENT,
          },
          homeSlotsMap: HOME_FARM_SLOTS,
          ranchLeaseConfig: {
            slots: RANCH_LEASE_SLOTS,
            signupFee: RANCH_SIGNUP_FEE,
            monthly: RANCH_MONTHLY_RENT,
          },
          homeRanchSlotsMap: HOME_RANCH_SLOTS,
          animalGroupLabels: ANIMAL_GROUP_LABEL,
          helperPlans: Object.values(HELPER_PLANS),
          pendingWork,
          neighborQuotes: {
            care: calcNeighborErrandQuote(qPlots, qPens, 'care'),
            full: calcNeighborErrandQuote(qPlots, qPens, 'full'),
          },
          errandTtlHours: NEIGHBOR_ERRAND_TTL_HOURS,
          townConnected: this.hasRemoteServer(),
        };
      };

      if (method === 'snapshot' || method === 'list' || method === '') {
        if (this.hasRemoteServer()) {
          const emptyCache = !this.otherStallsCache.length && !this.myStallsCache.length && !this.townBulletin.length;
          if (emptyCache || Date.now() - this.lastBulletinFetchMs >= 60_000) {
            await this.refreshTownMarket(this.stateGeneration);
          }
        }
        return marketPayload();
      }

      if (panel === 'relation') {
        const raw = (Array.isArray(args) ? args[0] : args) as any;
        if (method === 'mailRefresh') {
          if (this.isHubMode()) {
            await this.refreshTownMarket(this.stateGeneration);
          }
          return { ok: true, ...this.panelSnapshot(now) };
        }
        if (method === 'mailMessages') {
          const convId = String(raw?.conversationId ?? '').trim();
          if (!this.isHubMode()) return { ok: false, reason: '未连接 Hub v1 多城总服', messages: [] };
          const auth = await this.ensureHubReady(this.stateGeneration);
          if (!auth) return { ok: false, reason: this.hubAuthError || '身份未就绪', messages: [] };
          const res = await hubGetMessages(this.activeHubUrl(), auth.token, convId, { limit: 30 });
          return { ok: res.ok, reason: res.reason || '', lastReadMsgId: res.lastReadMsgId, messages: res.messages };
        }
        if (method === 'mailMarkRead') {
          const convId = String(raw?.conversationId ?? '').trim();
          if (!this.isHubMode()) return { ok: false, reason: '未连接 Hub v1 多城总服', ...this.panelSnapshot(now) };
          const auth = await this.ensureHubReady(this.stateGeneration);
          if (!auth) return { ok: false, reason: this.hubAuthError || '身份未就绪', ...this.panelSnapshot(now) };
          const mr = await hubMarkConversationRead(this.activeHubUrl(), auth.token, convId);
          const convRes = await hubListConversations(this.activeHubUrl(), auth.token);
          if (convRes.ok) {
            this.hubConversationsCache = convRes.conversations;
            this.hubUnreadMailCount = convRes.conversations.reduce((s, c) => s + (c.unreadCount || 0), 0);
          }
          return { ok: mr.ok, reason: mr.reason || '', ...this.panelSnapshot(now) };
        }
      }

      if (panel === 'market') {
        await this.settleBeforeTool(now);
        const raw = (Array.isArray(args) ? args[0] : args) as any;
        const term = solarTermOf(now);

        if (method === 'plant') {
          const seedQ = String(raw?.seed ?? '').trim();
          const r = applyPlant(this.state, seedQ, now, term.name, { byUser: true });
          if (!r.ok) return { ok: false, reason: r.reason || '没种下去。', ...marketPayload() };
          appendLedger(this.opts.dataDir, {
            id: `farm-seed-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: r.paid,
            source: 'life_farm',
            payee: '种子摊',
            note: `面板买种子：${r.plot?.name ?? seedQ}`,
          });
          this.saveDeliveredState();
          this.broadcastLife(now);
          await this.push('life.farm', `他刚刚在面板上帮你播下了「${r.plot?.name}」（种子 ¥${r.paid}）。`, 'debounce');
          return { ok: true, message: `已种下「${r.plot?.name}」（-¥${r.paid}）`, ...marketPayload() };
        }
        if (method === 'water') {
          const r = applyWater(this.state, String(raw?.plotId ?? '').trim(), now, { byUser: true });
          if (!r.ok) return { ok: false, reason: r.reason || '浇水没成功。', ...marketPayload() };
          this.saveDeliveredState();
          this.broadcastLife(now);
          return { ok: true, message: r.watered > 1 ? `已帮忙浇完 ${r.watered} 块地 ✓` : '已帮忙浇水 ✓', ...marketPayload() };
        }
        if (method === 'harvest') {
          const yieldBonus = Number(this.currentTownBuffs().crop_yield_bonus) || 0;
          const r = applyHarvest(this.state, String(raw?.plotId ?? '').trim(), now, { byUser: true, yieldBonus });
          if (!r.ok) return { ok: false, reason: r.reason || '还没熟呢。', ...marketPayload() };
          this.syncFarmReminderNags(now);
          this.saveDeliveredState();
          this.broadcastLife(now);
          const gotTxt = r.harvested.map((h) => `${h.name}×${h.qty}`).join('、');
          await this.push('life.farm', `他刚刚在面板上帮你收成了 ${gotTxt}，已存入储物篮。`, 'debounce');
          return { ok: true, message: `已收成 ${gotTxt} 入储物篮 ✓`, ...marketPayload() };
        }
        if (method === 'rentFarm') {
          const r = applyRentFarm(this.state, now, { byUser: true });
          if (!r.ok) return { ok: false, reason: r.reason || '没租成城郊菜地。', ...marketPayload() };
          appendLedger(this.opts.dataDir, {
            id: `farm-rent-${now.getTime().toString(36)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: r.paid,
            source: 'life_farm',
            payee: '城郊菜地',
            note: `面板签约 ${LEASE_PLOT_COUNT} 槽城郊菜地`,
          });
          this.saveDeliveredState();
          this.broadcastLife(now);
          await this.push('life.farm', `他刚刚在面板上替你签下 ${LEASE_PLOT_COUNT} 槽城郊菜地（签约费 ¥${r.paid}）。`, 'debounce');
          return { ok: true, message: `已签约城郊菜地（+${LEASE_PLOT_COUNT}槽，-¥${r.paid}）`, ...marketPayload() };
        }
        if (method === 'unrentFarm') {
          const r = applyUnrentFarm(this.state, Boolean(raw?.force), now, { byUser: true });
          if (!r.ok) return { ok: false, reason: r.reason || '退租没成功。', ...marketPayload() };
          this.saveDeliveredState();
          this.broadcastLife(now);
          return { ok: true, message: '已退掉城郊菜地租约', ...marketPayload() };
        }
        if (method === 'ranchBuy') {
          const animalQ = String(raw?.animal ?? '').trim();
          const r = applyBuyAnimal(this.state, animalQ, now, { byUser: true });
          if (!r.ok) return { ok: false, reason: r.reason || '放养没成功。', ...marketPayload() };
          appendLedger(this.opts.dataDir, {
            id: `ranch-buy-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: r.paid,
            source: 'life_ranch',
            payee: '农牧幼苗站',
            note: `面板放养：${r.pen?.name ?? animalQ}`,
          });
          this.saveDeliveredState();
          this.broadcastLife(now);
          await this.push('life.farm', `他刚刚在面板上帮你放养了「${r.pen?.name}」（-¥${r.paid}）。`, 'debounce');
          return { ok: true, message: `已放养「${r.pen?.name}」（-¥${r.paid}）`, ...marketPayload() };
        }
        if (method === 'ranchFeed') {
          const r = applyFeedAnimal(this.state, String(raw?.penId ?? '').trim(), now, { byUser: true });
          if (!r.ok) return { ok: false, reason: r.reason || '喂食没成功。', ...marketPayload() };
          appendLedger(this.opts.dataDir, {
            id: `ranch-feed-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: r.paid,
            source: 'life_ranch',
            payee: '牧场饲料',
            note: '面板农牧场喂食',
          });
          this.saveDeliveredState();
          this.broadcastLife(now);
          return { ok: true, message: r.fed > 1 ? `已喂完 ${r.fed} 栏（饲料 -¥${r.paid}）✓` : `已喂食（饲料 -¥${r.paid}）✓`, ...marketPayload() };
        }
        if (method === 'ranchCollect') {
          const yieldBonus = Number(this.currentTownBuffs().ranch_yield_bonus) || 0;
          const r = applyCollectRanch(this.state, String(raw?.penId ?? '').trim(), now, { byUser: true, yieldBonus });
          if (!r.ok) return { ok: false, reason: r.reason || '暂无可收蛋奶。', ...marketPayload() };
          this.syncFarmReminderNags(now);
          this.saveDeliveredState();
          this.broadcastLife(now);
          const gotTxt = r.collected.map((c) => `${c.name}×${c.qty}`).join('、');
          await this.push('life.farm', `他刚刚在面板上帮你收好了 ${gotTxt}，放进储物篮。`, 'debounce');
          return { ok: true, message: `已收集 ${gotTxt} ✓`, ...marketPayload() };
        }
        if (method === 'ranchHarvest') {
          const buffs = this.currentTownBuffs();
          const r = applyHarvestRanch(this.state, String(raw?.penId ?? '').trim(), now, {
            byUser: true,
            ranchYieldBonus: Number(buffs.ranch_yield_bonus) || 0,
            fishYieldBonus: Number(buffs.fish_yield_bonus) || 0,
          });
          if (!r.ok) return { ok: false, reason: r.reason || '暂不可起塘/出栏。', ...marketPayload() };
          this.syncFarmReminderNags(now);
          this.saveDeliveredState();
          this.broadcastLife(now);
          const gotTxt = r.harvested.map((h) => `${h.name}×${h.qty}`).join('、');
          await this.push('life.farm', `他刚刚在面板上帮你收获了 ${gotTxt}，存入储物篮。`, 'debounce');
          return { ok: true, message: `已收获 ${gotTxt} ✓`, ...marketPayload() };
        }
        if (method === 'rentRanch') {
          const r = applyRentRanch(this.state, now, { byUser: true });
          if (!r.ok) return { ok: false, reason: r.reason || '没签成城郊农牧场。', ...marketPayload() };
          appendLedger(this.opts.dataDir, {
            id: `ranch-rent-${now.getTime().toString(36)}`,
            ts: now.toISOString(),
            kind: 'expense',
            amount: r.paid,
            source: 'life_ranch',
            payee: '城郊农牧场',
            note: '面板签约城郊农牧场（+2鸡/+2牛/+2鱼）',
          });
          this.saveDeliveredState();
          this.broadcastLife(now);
          await this.push('life.farm', `他刚刚在面板上签下了城郊农牧场（+2鸡/+2牛/+2鱼，签约费 ¥${r.paid}）。`, 'debounce');
          return { ok: true, message: `已签约城郊农牧场（-¥${r.paid}）`, ...marketPayload() };
        }
        if (method === 'unrentRanch') {
          const r = applyUnrentRanch(this.state, Boolean(raw?.force), now, { byUser: true });
          if (!r.ok) return { ok: false, reason: r.reason || '退租没成功。', ...marketPayload() };
          this.saveDeliveredState();
          this.broadcastLife(now);
          return { ok: true, message: '已退掉城郊农牧场租约', ...marketPayload() };
        }
        if (method === 'hireHelper') {
          const generation = this.stateGeneration;
          const prefArg = typeof raw?.preferNeighbor === 'boolean' ? raw.preferNeighbor : undefined;
          const r = await this.runHireAction(String(raw?.mode ?? 'care'), prefArg, now, generation, { byUser: true, ledgerPrefix: 'panel-hire' });
          if (!r.ok) return { ok: false, reason: r.message || '雇用没成功。', ...marketPayload() };
          await this.push('life.farm', `他在面板上雇了「${HELPER_PLANS[r.mode === 'off' ? 'care' : r.mode].label}」帮忙照看农牧场（${this.state.farmHelper.preferNeighbor ? '优先找街坊真鱼代管' : '自动照料'}）。`, 'debounce');
          return { ok: true, message: r.message, ...marketPayload() };
        }
        if (method === 'postErrand') {
          const generation = this.stateGeneration;
          const mode: Exclude<HelperMode, 'off'> = String(raw?.mode ?? '').trim() === 'full' ? 'full' : 'care';
          const er = await this.postNeighborFarmErrand(now, mode, generation);
          if (!er.ok) return { ok: false, reason: er.reason || '没挂上邻里代管单。', ...marketPayload() };
          await this.push('life.farm', `他在面板上替你发了一条鱼市街邻里农牧代管委托（${er.itemLabel}，预扣 ¥${er.wage}）。`, 'debounce');
          return { ok: true, message: `已挂出「${er.itemLabel}」（-¥${er.wage} 托管，等街坊接单）`, ...marketPayload() };
        }
        if (method === 'setHelperPref') {
          const pref = Boolean(raw?.preferNeighbor);
          this.state.farmHelper.preferNeighbor = pref;
          this.state.updatedAt = now.toISOString();
          this.saveDeliveredState();
          this.broadcastLife(now);
          return {
            ok: true,
            message: pref ? '已设为：优先发邻里真鱼代管，无人接再回落自动照料' : '已设为：直接走系统自动照料',
            ...marketPayload(),
          };
        }
        if (method === 'unhireHelper') {
          const r = applyUnhireHelper(this.state, now, { byUser: true });
          if (!r.ok) return { ok: false, reason: r.reason || '眼下没雇帮手。', ...marketPayload() };
          this.saveDeliveredState();
          this.broadcastLife(now);
          await this.push('life.farm', '他刚刚在面板上停雇了农牧帮手。', 'debounce');
          return { ok: true, message: '已辞退农牧帮手', ...marketPayload() };
        }
        if (method === 'cancelListing') {
          const generation = this.stateGeneration;
          const listingId = String(raw?.listingId ?? '').trim();
          if (!this.isHubMode()) return { ok: false, reason: '仅 Hub v1 模式支持面板一键下架摊位', ...marketPayload() };
          const auth = await this.ensureHubReady(generation);
          if (generation !== this.stateGeneration) return { ok: false, reason: '生活档案刚刚被清理', ...marketPayload() };
          if (!auth) return { ok: false, reason: this.hubAuthError || 'Hub 身份未就绪', ...marketPayload() };
          const res = await hubCancelListing(this.activeHubUrl(), auth.token, listingId);
          if (generation !== this.stateGeneration) return { ok: false, reason: '生活档案刚刚被清理', ...marketPayload() };
          if (!res.ok) return { ok: false, reason: res.reason || '下架失败', ...marketPayload() };
          this.myStallsCache = this.myStallsCache.filter((s) => s.id !== listingId);
          return { ok: true, message: '已下架该摊位余货 ✓', ...marketPayload() };
        }
        if (method === 'cancelErrand') {
          const generation = this.stateGeneration;
          const errandId = String(raw?.errandId ?? this.state.farmHelper.pendingErrand?.stallId ?? '').trim();
          if (!this.isHubMode()) return { ok: false, reason: '仅 Hub v1 模式支持撤回委托', ...marketPayload() };
          if (!errandId) return { ok: false, reason: '当前没有可撤回的在挂委托', ...marketPayload() };
          const auth = await this.ensureHubReady(generation);
          if (generation !== this.stateGeneration) return { ok: false, reason: '生活档案刚刚被清理', ...marketPayload() };
          if (!auth) return { ok: false, reason: this.hubAuthError || 'Hub 身份未就绪', ...marketPayload() };
          const res = await hubCancelErrand(this.activeHubUrl(), auth.token, errandId);
          if (generation !== this.stateGeneration) return { ok: false, reason: '生活档案刚刚被清理', ...marketPayload() };
          if (!res.ok) return { ok: false, reason: res.reason || '撤回委托失败', ...marketPayload() };
          const pe = this.state.farmHelper.pendingErrand;
          let refunded = 0;
          if (pe && pe.stallId === errandId) {
            const ref = refundExpiredErrand(this.state, now, {
              force: true,
              reason: `面板主动撤回邻里农牧代管委托，预扣 ¥${pe.wage} 已原路退回。`,
            });
            refunded = ref?.refunded ?? 0;
            if (refunded > 0) {
              appendLedger(this.opts.dataDir, {
                id: `errand-cancel-${errandId}`,
                ts: now.toISOString(),
                kind: 'income',
                amount: refunded,
                source: 'farm_errand_refund',
                payee: '鱼市街托管退回',
                note: '面板撤回邻里农牧委托，退回预扣工钱',
              });
            }
            this.saveDeliveredState();
            this.broadcastLife(now);
          }
          this.myStallsCache = this.myStallsCache.filter((s) => s.id !== errandId);
          return {
            ok: true,
            message: refunded > 0 ? `已撤回邻里委托并退回预扣 ¥${refunded} ✓` : '已撤回邻里委托 ✓',
            ...marketPayload(),
          };
        }
      }

      throw new Error(`${panel === 'market' ? '农牧场与鱼市街' : '你和它'}页不认识这个方法：${method}`);
    }

    if (method === 'giftCash') {
      await this.settleBeforeTool(now);
      const raw = (Array.isArray(args) ? args[0] : args) as any;
      const amount = Number(raw?.amount ?? 0);
      const note = String(raw?.note ?? '').trim();
      const cap = this.cfg.dailyGiftCap !== undefined ? Number(this.cfg.dailyGiftCap) : DEFAULT_DAILY_GIFT_CAP;
      const res = applyUserCashGift(this.state, { amount, note, dailyCap: cap }, now);
      if (!res.ok) {
        return { ok: false, reason: res.reason || '这笔零花钱没转进去。', ...this.panelSnapshot(now) };
      }
      appendLedger(this.opts.dataDir, {
        id: res.record?.id || `gift-${now.getTime().toString(36)}`,
        ts: now.toISOString(),
        kind: 'income',
        amount: res.amount,
        source: 'user_gift',
        payee: '你的零花钱',
        note: res.note ? `零花钱：「${res.note}」` : '零花钱',
      });
      this.saveDeliveredState();
      this.broadcastLife(now);
      await this.push(
        'life.gift_cash',
        `他刚刚发给你一笔 ${res.amount} 元零花钱${res.note ? `，附言：「${res.note}」` : ''}。怎么花全凭你自己的主意，现在手上共 ${Math.round(res.cash)} 元。`,
        'flush',
      );
      return {
        ok: true,
        message: `已转入 ¥${res.amount}${res.note ? `（「${res.note}」）` : ''}，怎么花由她自己决定 ✓`,
        ...this.panelSnapshot(now),
      };
    }

    if (method === 'care') {
      await this.settleBeforeTool(now);
      const raw = Array.isArray(args) ? args[0] : args;
      const kind = String(raw?.kind ?? raw ?? '').trim();
      const cr = applyUserCare(this.state, kind, now);
      if (!cr.ok || !cr.item) {
        return { ok: false, reason: cr.reason || '今天没照料成。', ...this.panelSnapshot(now) };
      }
      this.saveDeliveredState();
      this.broadcastLife(now);
      await this.push(
        'life.care',
        cr.recoveredNow
          ? `他刚刚在面板上给你「${cr.item.label}」，烧退身轻这会儿已经好透了，可以安心歇息再恢复日常。`
          : `他刚刚在面板上给你「${cr.item.label}」，恢复提前了 ${cr.item.hoursCut} 小时（还需静养约 ${cr.hoursLeftAfter} 小时）。好好歇着别硬撑。`,
        'flush',
      );
      if (cr.recoveredNow) {
        await this.push('life.recovered', '多亏他的每日照料，刚刚病愈恢复了。', 'debounce');
      }
      return {
        ok: true,
        message: cr.recoveredNow
          ? `${cr.item.label}已送达，她已经好透痊愈了 ✓`
          : `${cr.item.label}已送达，病程缩短 ${cr.item.hoursCut}h（还剩约 ${cr.hoursLeftAfter}h）✓`,
        ...this.panelSnapshot(now),
      };
    }

    if (method === 'moveTown') {
      await this.settleBeforeTool(now);
      const raw = Array.isArray(args) ? args[0] : args;
      const townId = String(raw?.townId ?? '').trim();
      const mr = await this.moveHubTown(townId, now, this.stateGeneration);
      if (mr.ok) {
        await this.push(
          'life.moved',
          `他刚刚在面板上替你迁居到了「${mr.townName}」（落脚${mr.street}，免押金）。`,
          'flush',
        );
      }
      return { ok: mr.ok, reason: mr.reason || '', ...this.panelSnapshot(now) };
    }

    if (method === 'move') {
      await this.settleBeforeTool(now);
      const raw = Array.isArray(args) ? args[0] : args;
      const reqStreet = raw && typeof raw === 'object' && 'street' in raw ? String((raw as any).street ?? '').trim() : '';
      const reqTier = raw && typeof raw === 'object' && 'tier' in raw
        ? String((raw as any).tier ?? '').trim()
        : (typeof raw === 'string' && !reqStreet ? raw.trim() : '');
      if (reqStreet && !reqTier) {
        const sp = findStreetProfile(this.town, reqStreet);
        const sr = applyStreetMove(this.state, reqStreet, this.town.streets, now, sp);
        if (sr.ok) {
          try { this.store.save(this.state); } catch { /* 下一帧再存 */ }
          this.broadcastLife(now);
          if (this.hasRemoteServer()) {
            this.state.lastJoinedTownAt = '';
            void this.syncTownPresenceAndBulletin(now, this.stateGeneration);
          }
          const modTxt = formatStreetMods(sp?.mods);
          await this.push(
            'life.moved',
            `他刚刚在面板上替你搬到了本城的${sr.to}（${sr.from ? `从${sr.from}搬来` : '定居于此'}${modTxt ? `；街道效果：${modTxt}` : ''}）。`,
            'flush',
          );
        }
        return { ok: sr.ok, reason: sr.reason || '', ...this.panelSnapshot(now) };
      }
      const tier = reqTier;
      if (!(tier in HOME_TIER_COST)) {
        return { ok: false, reason: `没有「${tier}」这一档。`, ...this.panelSnapshot(now) };
      }
      const r = applyMove(this.state, tier as HomeTier, now, this.currentRentMult());
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
      if (this.hasRemoteServer()) {
        await this.refreshTownInfo(this.stateGeneration, { minIntervalMs: 30_000 });
      }
      return this.panelSnapshot(now);
    }

    if (method === 'reloadTown') {
      await this.refreshTownInfo(this.stateGeneration, { force: true });
      await this.refreshExternalWeather(now, { force: true });
      return { ok: true, town: this.town };
    }

    throw new Error(`没有这个方法：${method}`);
  }

  /** 面板要的那一份快照。抽出来是为了 `move` 之后能直接回同一份，前端只画一次。 */
  private panelSnapshot(now: Date): Record<string, unknown> {
    if (this.isHubMode() && (!this.hubAuth || this.hubAuthError)) {
      const diskAuth = readHubAuth(this.opts.dataDir, this.activeHubUrl());
      const tokenChanged = !this.hubAuthErrorToken || (diskAuth?.token ?? '') !== this.hubAuthErrorToken;
      if (diskAuth && diskAuth.hubUrl === this.activeHubUrl() && tokenChanged) {
        this.hubAuth = diskAuth;
        this.hubAuthError = '';
        this.hubAuthErrorToken = '';
      }
    }
    const j = readJourney(this.opts.dataDir, now);
    this.journey = j;
    const s = snapshot(this.state, now, this.activeExternalWeatherOverride(this.weatherCityName(j)));
    {
      const at = herNow(j, now);
      return {
        version: VERSION,
        /* 表头那个徽章：知道有新版才变色，不知道就只说自己的版本。 */
        latestVersion: this.versionCheck.state().latest,
        versionOutdated: this.versionCheck.state().outdated,
        at: now.toISOString(),
        herNow: at.toISOString(),
        /* 见识与体质。面板那格读它 —— `snapshot()` 里也有，但面板走的是这一份。 */
        knowledge: Math.round(this.state.knowledge * 10) / 10,
        fitness: Math.round(this.state.fitness * 100) / 100,
        dayPart: DAYPART_LABEL[dayPart(at)],
        clock: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
        clockGapHours: Math.round(clockGapHours(j, now) * 10) / 10,
        journey: {
          installed: j.installed,
          phase: j.phase,
          city: j.cityName,
          to: j.toName,
          modeId: j.modeId,
          seatId: j.seatId,
          seat: j.seat,
          seatMult: j.seatMult,
          staleSec: j.staleSec,
          homeName: j.homeName,
          restUntil: j.restUntil,
          tripWork: j.tripWork,
          partyWith: j.partyWith,
          partyDays: j.partyDays,
          wishes: j.wishes,
        },
        town: {
          id: this.town.id,
          name: this.town.name,
          origin: this.town.origin,
          streets: this.town.streets,
          streetProfiles: this.town.streetProfiles,
          rules: this.town.rules,
          source: this.town.source,
          custom: this.town.custom,
          notice: this.town.notice ?? this.hubTownMeta?.notice ?? '',
          buffs: this.currentTownBuffs(),
          shipping: this.hubTownMeta?.shipping ?? this.town.shipping ?? {},
          metaVersion: this.hubTownMeta?.metaVersion ?? this.town.metaVersion ?? 1,
          hubMode: this.isHubMode(),
        },
        hub: {
          enabled: this.isHubMode(),
          url: this.activeHubUrl(),
          petId: this.hubAuth?.petId ?? '',
          displayName: this.hubAuth?.displayName ?? '',
          authError: this.hubAuthError,
          townId: this.isHubMode() ? this.targetHubTownId() : this.town.id,
          towns: this.hubTownsCache,
          notice: this.town.notice ?? this.hubTownMeta?.notice ?? '',
          buffs: this.currentTownBuffs(),
          shipping: this.hubTownMeta?.shipping ?? this.town.shipping ?? {},
          catalogVersion: this.hubCatalog.version,
          specialties: this.hubCatalog.items.filter((i) => i.isSpecialty),
          residents: this.hubResidentsCache,
          conversations: this.hubConversationsCache,
          unreadMail: this.hubUnreadMailCount,
        },
        street: this.state.street,
        streetProfile: findStreetProfile(this.town, this.state.street),
        streetQuotes: this.town.streetProfiles.map((p) => ({
          name: p.name,
          desc: p.desc,
          mods: p.mods,
          modsText: formatStreetMods(p.mods),
          current: p.name === this.state.street,
        })),
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
          giftedTotal: this.state.money.giftedTotal ?? 0,
          since: this.state.money.since,
        },
        loan: loanSummary(this.state, now),
        giftCash: (() => {
          const cap = this.cfg.dailyGiftCap !== undefined && Number.isFinite(Number(this.cfg.dailyGiftCap))
            ? Math.max(0, Math.round(Number(this.cfg.dailyGiftCap)))
            : DEFAULT_DAILY_GIFT_CAP;
          const today = localDateKey(now);
          const g = this.state.giftCash;
          const todayTotal = g?.dayKey === today ? Math.max(0, Math.round(Number(g.todayTotal) || 0)) : 0;
          return {
            todayTotal,
            dailyCap: cap,
            remainingToday: cap > 0 ? Math.max(0, cap - todayTotal) : null,
            recent: (g?.recent ?? []).slice(-6).reverse(),
          };
        })(),
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
        moodEffect: s.moodEffect,
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
        presence: this.state.presence.slice(-14),
        skills: s.skills,
        skillLabels: SKILL_DOMAIN_LABEL,
        trained: s.trained,
        gear: s.gear,
        equipCatalog: EQUIP_CATALOG,
        shift: s.shift,
        solarTerm: s.solarTerm,
        streetWindow: s.streetWindow,
        freshVeg: s.freshVeg,
        farm: s.farm,
        ranch: s.ranch,
        farmHelper: s.farmHelper,
        pantry: s.pantry,
        cookedDishes: s.cookedDishes,
        workOutputs: s.workOutputs,
        houseboundSick: s.houseboundSick,
        sickCare: s.sickCare,
        stallRecords: s.stallRecords,
        bulletin: [...this.townBulletin],
        myStalls: [...this.myStallsCache],
        otherStalls: [...this.otherStallsCache],
        deals: this.myDealsCache.map((d) => {
          const isErrand = this.isMyFarmErrandDeal(d);
          const up = isErrand ? 0 : this.resolveDealPrice(d);
          return { ...d, isErrand, unitPrice: up, income: isErrand ? 0 : up * Math.max(1, d.qty) };
        }),
        unseenDeals: this.unseenDealsCount,
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
        moveQuotes: (() => {
          const rentMult = this.currentRentMult();
          return (['urban-village', 'old', 'new', 'villa'] as HomeTier[]).map((t) => {
            const q = quoteMove(this.state, t, rentMult);
            return { ...q, current: t === this.state.home.tier };
          });
        })(),
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
  events: { type: string; description: unknown; trigger: string; tags?: string[] }[];
};
