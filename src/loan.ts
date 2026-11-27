/**
 * 芦花塘信用社（单机借贷闭环）与用户现金赠与（零花钱）纯函数引擎。
 *
 * 设计红线：
 * 1. 「赠与」只负责把钱和留言交到她手上，怎么花由她自己决定，面板不替她下单。
 * 2. 「贷款」由她通过 `life_loan` 自主决定借还，带动态授信上限、微息与逾期 50% 进账抵债，
 *    但到期扣款始终保底 80 元生活费，绝不因还贷扣成死局。
 * 3. `giftedTotal` 单独记账，不混入 `earned`（自己挣的）；贷款放款不计 `earned`、还本不计 `spent`（仅利息计入 `spent`）。
 */

export type LoanProductId = 'emergency' | 'growth' | 'housing';
export type LoanStatus = 'active' | 'overdue' | 'paid';

export interface LoanProductDef {
  id: LoanProductId;
  name: string;
  termDays: number;
  ratePerDay: number;
  desc: string;
}

export const LOAN_PRODUCTS: readonly LoanProductDef[] = [
  {
    id: 'emergency',
    name: '小额应急金',
    termDays: 7,
    ratePerDay: 0.0015,
    desc: '7 天 · 微息 0.15%/天（7 天约 1.05%），适合房租/饲料/买菜周转',
  },
  {
    id: 'growth',
    name: '进修农牧贷',
    termDays: 14,
    ratePerDay: 0.0012,
    desc: '14 天 · 微息 0.12%/天（14 天约 1.68%），适合考证培训/添家伙/租地',
  },
  {
    id: 'housing',
    name: '置业安居贷',
    termDays: 30,
    ratePerDay: 0.001,
    desc: '30 天 · 微息 0.10%/天（30 天约 3.0%），适合凑搬家押金升级住处',
  },
];

export const LOAN_MAX_ACTIVE = 2;
export const LOAN_HARD_CAP = 5000;
export const LOAN_MIN_AMOUNT = 50;
export const LOAN_RESERVE_CASH = 80;
export const LOAN_OVERDUE_GARNISH_RATE = 0.5;
export const DEFAULT_DAILY_GIFT_CAP = 500;

export const LOAN_BASE_BY_TIER: Record<string, number> = {
  'urban-village': 300,
  old: 800,
  new: 1800,
  villa: 3000,
};

export interface LoanRecord {
  id: string;
  product: LoanProductId;
  productName: string;
  principal: number;
  ratePerDay: number;
  termDays: number;
  purpose: string;
  borrowedAt: string;
  borrowedDay: string;
  dueAt: string;
  dueDay: string;
  lastAccruedDay: string;
  accruedInterest: number;
  interestCarry?: number;
  repaidPrincipal: number;
  repaidInterest: number;
  status: LoanStatus;
  paidAt?: string;
}

export interface GiftCashRecord {
  id: string;
  ts: string;
  dateKey: string;
  amount: number;
  note: string;
}

export interface GiftCashState {
  dayKey: string;
  todayTotal: number;
  recent: GiftCashRecord[];
}

export interface LoanHostState {
  home: { tier: string };
  job: { certs: string[]; days: number };
  money: { cash: number; earned: number; spent: number; giftedTotal?: number };
  moodlets: { id: string; source: string; text: string; kind: 'good' | 'bad'; expiresAt: string }[];
  memories?: string[];
  tellable: { id: string; text: string; at: string; said?: boolean }[];
  loans: LoanRecord[];
  giftCash: GiftCashState;
  updatedAt: string;
}

export interface LoanAdvanceSettlement {
  interestAccrued: number;
  autoRepaidTotal: number;
  autoRepaidPrincipal: number;
  autoRepaidInterest: number;
  newlyOverdue: LoanRecord[];
  paidOff: LoanRecord[];
  hasOverdue: boolean;
}

export interface LoanGarnishResult {
  deductedTotal: number;
  deductedPrincipal: number;
  deductedInterest: number;
  paidOffIds: string[];
  clearedAllOverdue: boolean;
}

export function localDayKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function shiftDayKey(dayKey: string, deltaDays: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  if (!y || !m || !d) return dayKey;
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return [
    dt.getUTCFullYear(),
    String(dt.getUTCMonth() + 1).padStart(2, '0'),
    String(dt.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function daysBetweenDayKeys(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const [ty, tm, td] = toKey.split('-').map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return 0;
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.max(0, Math.round((toMs - fromMs) / 86_400_000));
}

export function freshGiftCash(now: Date = new Date()): GiftCashState {
  return {
    dayKey: localDayKey(now),
    todayTotal: 0,
    recent: [],
  };
}

export function normLoans(raw: unknown, now: Date): LoanRecord[] {
  if (!Array.isArray(raw)) return [];
  const today = localDayKey(now);
  const out: LoanRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Partial<LoanRecord>;
    if (typeof o.id !== 'string' || !o.id) continue;
    const principal = Math.max(0, Math.round(Number(o.principal) || 0));
    if (principal <= 0) continue;
    const prodId: LoanProductId =
      o.product === 'housing' || o.product === 'growth' ? o.product : 'emergency';
    const def = LOAN_PRODUCTS.find((p) => p.id === prodId) ?? LOAN_PRODUCTS[0];
    const borrowedDay = typeof o.borrowedDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.borrowedDay)
      ? o.borrowedDay
      : today;
    const termDays = Math.max(1, Math.round(Number(o.termDays) || def.termDays));
    const dueDay = typeof o.dueDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.dueDay)
      ? o.dueDay
      : shiftDayKey(borrowedDay, termDays);
    const status: LoanStatus =
      o.status === 'paid' || o.status === 'overdue' ? o.status : 'active';
    out.push({
      id: o.id,
      product: prodId,
      productName: typeof o.productName === 'string' && o.productName ? o.productName : def.name,
      principal,
      ratePerDay: Number.isFinite(Number(o.ratePerDay)) && Number(o.ratePerDay) >= 0
        ? Number(o.ratePerDay)
        : def.ratePerDay,
      termDays,
      purpose: typeof o.purpose === 'string' ? o.purpose.slice(0, 60) : '',
      borrowedAt: typeof o.borrowedAt === 'string' ? o.borrowedAt : now.toISOString(),
      borrowedDay,
      dueAt: typeof o.dueAt === 'string' ? o.dueAt : new Date(now.getTime() + termDays * 86_400_000).toISOString(),
      dueDay,
      lastAccruedDay: typeof o.lastAccruedDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.lastAccruedDay)
        ? o.lastAccruedDay
        : borrowedDay,
      accruedInterest: Math.max(0, Math.round(Number(o.accruedInterest) || 0)),
      ...(Number.isFinite(Number(o.interestCarry)) && Number(o.interestCarry) > 0
        ? { interestCarry: Math.min(0.9999, Math.max(0, Number(o.interestCarry))) }
        : {}),
      repaidPrincipal: Math.min(principal, Math.max(0, Math.round(Number(o.repaidPrincipal) || 0))),
      repaidInterest: Math.max(0, Math.round(Number(o.repaidInterest) || 0)),
      status,
      ...(typeof o.paidAt === 'string' && o.paidAt ? { paidAt: o.paidAt } : {}),
    });
  }
  /*
   * 只留最近 40 笔，但**先丢已结清的**。
   * 直接 slice(-40) 会把最早的未结清借款一起切掉 —— 那笔债就凭空消失了，
   * 而额度、待还合计、逾期判定全都按这份数组算。截断只能截掉历史，不能截掉欠条。
   */
  if (out.length <= 40) return out;
  const excess = out.length - 40;
  const paidIndexes = out
    .map((l, i) => (l.status === 'paid' ? i : -1))
    .filter((i) => i >= 0);
  const drop = new Set(paidIndexes.slice(0, excess));
  return out.filter((_, i) => !drop.has(i));
}

export function normGiftCash(raw: unknown, now: Date): GiftCashState {
  const today = localDayKey(now);
  if (!raw || typeof raw !== 'object') return freshGiftCash(now);
  const o = raw as Partial<GiftCashState>;
  const dayKey = typeof o.dayKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.dayKey) ? o.dayKey : today;
  const todayTotal = dayKey === today ? Math.max(0, Math.round(Number(o.todayTotal) || 0)) : 0;
  const recent = Array.isArray(o.recent)
    ? o.recent
      .filter((r): r is GiftCashRecord => Boolean(r && typeof r === 'object' && typeof r.id === 'string' && Number(r.amount) > 0))
      .map((r) => ({
        id: r.id,
        ts: typeof r.ts === 'string' ? r.ts : now.toISOString(),
        dateKey: typeof r.dateKey === 'string' ? r.dateKey : today,
        amount: Math.round(Number(r.amount) || 0),
        note: typeof r.note === 'string' ? r.note.slice(0, 80) : '',
      }))
      .slice(-20)
    : [];
  return { dayKey: today, todayTotal, recent };
}

export function pickLoanProduct(termDays?: number): LoanProductDef {
  const d = Math.round(Number(termDays) || 7);
  if (d >= 22) return LOAN_PRODUCTS[2];
  if (d >= 10) return LOAN_PRODUCTS[1];
  return LOAN_PRODUCTS[0];
}

export function computeCreditLimit(state: Pick<LoanHostState, 'home' | 'job'>): number {
  const base = LOAN_BASE_BY_TIER[state.home?.tier] ?? 300;
  const certCount = Array.isArray(state.job?.certs) ? state.job.certs.length : 0;
  const workDays = Math.max(0, Math.round(Number(state.job?.days) || 0));
  const raw = base + certCount * 250 + Math.min(1200, workDays * 30);
  return Math.min(LOAN_HARD_CAP, raw);
}

export function loanRemaining(loan: LoanRecord): { principal: number; interest: number; total: number } {
  const principal = Math.max(0, loan.principal - loan.repaidPrincipal);
  const interest = Math.max(0, loan.accruedInterest - loan.repaidInterest);
  return { principal, interest, total: principal + interest };
}

export function activeLoans(state: Pick<LoanHostState, 'loans'>): LoanRecord[] {
  return (state.loans ?? []).filter((l) => l.status === 'active' || l.status === 'overdue');
}

export function hasOverdueLoan(state: Pick<LoanHostState, 'loans'>): boolean {
  return (state.loans ?? []).some((l) => l.status === 'overdue' && loanRemaining(l).total > 0);
}

export function activeLoansPrincipal(state: Pick<LoanHostState, 'loans'>): number {
  return activeLoans(state).reduce((sum, l) => sum + loanRemaining(l).principal, 0);
}

export function activeLoansTotalDue(state: Pick<LoanHostState, 'loans'>): number {
  return activeLoans(state).reduce((sum, l) => sum + loanRemaining(l).total, 0);
}

export function availableCredit(state: Pick<LoanHostState, 'home' | 'job' | 'loans'>): number {
  if (hasOverdueLoan(state)) return 0;
  const open = activeLoans(state);
  if (open.length >= LOAN_MAX_ACTIVE) return 0;
  return Math.max(0, computeCreditLimit(state) - activeLoansPrincipal(state));
}

function addTellable(state: LoanHostState, text: string, now: Date): void {
  const list = state.tellable ?? (state.tellable = []);
  list.push({ id: `loan-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, text, at: now.toISOString(), said: false });
  if (list.length > 40) state.tellable = list.slice(-40);
}

function clearOverdueMoodletIfClean(state: LoanHostState): void {
  if (!hasOverdueLoan(state)) {
    state.moodlets = (state.moodlets ?? []).filter((m) => m.source !== 'loan_overdue');
  }
}

function applyRepayChunkToLoan(
  state: LoanHostState,
  loan: LoanRecord,
  budget: number,
  now: Date,
): { total: number; principal: number; interest: number; paidOff: boolean } {
  const rem = loanRemaining(loan);
  const payTotal = Math.min(Math.max(0, Math.floor(budget)), rem.total);
  if (payTotal <= 0) {
    return { total: 0, principal: 0, interest: 0, paidOff: false };
  }
  // 先息后本
  const payInterest = Math.min(rem.interest, payTotal);
  const payPrincipal = Math.min(rem.principal, payTotal - payInterest);
  loan.repaidInterest += payInterest;
  loan.repaidPrincipal += payPrincipal;
  state.money.cash = Math.max(0, state.money.cash - payTotal);
  // 只把利息算进消费支出（避免借还本金虚增 spent）
  if (payInterest > 0) state.money.spent += payInterest;
  const after = loanRemaining(loan);
  const paidOff = after.total <= 0;
  if (paidOff) {
    loan.status = 'paid';
    loan.paidAt = now.toISOString();
  }
  return { total: payTotal, principal: payPrincipal, interest: payInterest, paidOff };
}

export function applyBorrowLoan(
  state: LoanHostState,
  opts: { amount: number; termDays?: number; purpose?: string },
  now: Date,
): { ok: boolean; reason?: string; loan?: LoanRecord; creditLimit: number; availCredit: number } {
  const limit = computeCreditLimit(state);
  if (hasOverdueLoan(state)) {
    return {
      ok: false,
      reason: '你还有逾期没还清的借款，信用社已暂停新借，先把旧账结清再说。',
      creditLimit: limit,
      availCredit: 0,
    };
  }
  const open = activeLoans(state);
  if (open.length >= LOAN_MAX_ACTIVE) {
    return {
      ok: false,
      reason: `同时最多只能背 ${LOAN_MAX_ACTIVE} 笔在贷，先把手头一笔还清再借。`,
      creditLimit: limit,
      availCredit: 0,
    };
  }
  const avail = availableCredit(state);
  const amount = Math.round(Number(opts.amount) || 0);
  if (!Number.isFinite(amount) || amount < LOAN_MIN_AMOUNT) {
    return {
      ok: false,
      reason: `单笔至少借 ${LOAN_MIN_AMOUNT} 元（你当前可用授信 ${avail} 元 / 总额度 ${limit} 元）。`,
      creditLimit: limit,
      availCredit: avail,
    };
  }
  if (amount > avail) {
    return {
      ok: false,
      reason: `这笔想借 ${amount} 元，超出可用信用额度（当前可借 ${avail} 元 / 授信上限 ${limit} 元；提升住处档位、多考证、多积工龄可涨额度）。`,
      creditLimit: limit,
      availCredit: avail,
    };
  }

  const product = pickLoanProduct(opts.termDays);
  const today = localDayKey(now);
  const dueDay = shiftDayKey(today, product.termDays);
  const purpose = String(opts.purpose ?? '').trim().slice(0, 60) || '生活周转';
  const loan: LoanRecord = {
    id: `ln_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    product: product.id,
    productName: product.name,
    principal: amount,
    ratePerDay: product.ratePerDay,
    termDays: product.termDays,
    purpose,
    borrowedAt: now.toISOString(),
    borrowedDay: today,
    dueAt: new Date(now.getTime() + product.termDays * 86_400_000).toISOString(),
    dueDay,
    lastAccruedDay: today,
    accruedInterest: 0,
    repaidPrincipal: 0,
    repaidInterest: 0,
    status: 'active',
  };
  state.loans = [...(state.loans ?? []), loan];
  state.money.cash += amount;
  // 贷款不是收入，不加 money.earned
  state.updatedAt = now.toISOString();
  addTellable(state, `在芦花塘信用社办了一笔「${product.name}」${amount} 元（${product.termDays} 天期，用于${purpose}）。`, now);

  return {
    ok: true,
    loan,
    creditLimit: limit,
    availCredit: availableCredit(state),
  };
}

export function applyRepayLoan(
  state: LoanHostState,
  opts: { loanId?: string; amount?: number },
  now: Date,
): {
  ok: boolean;
  reason?: string;
  paidTotal: number;
  paidPrincipal: number;
  paidInterest: number;
  repaidLoans: { id: string; productName: string; paidTotal: number; paidOff: boolean; remaining: number }[];
  clearedOverdue: boolean;
  /** 想还的金额超过可动用现金，被上限截住后少还的部分（0 = 足额还上）。 */
  shortByCash: number;
  /** 本次原本打算还的金额（已按在贷总额封顶）。 */
  wantedTotal: number;
  /** 省略 amount 且现金不够全额清零时，是否按规矩预留了 80 元生活底钱。 */
  reservedLivingCash: boolean;
} {
  const open = activeLoans(state).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'overdue' ? -1 : 1;
    return a.dueDay.localeCompare(b.dueDay);
  });
  if (!open.length) {
    return {
      ok: false, reason: '眼下没有未结清的借款。',
      paidTotal: 0, paidPrincipal: 0, paidInterest: 0, repaidLoans: [], clearedOverdue: false,
      shortByCash: 0, wantedTotal: 0, reservedLivingCash: false,
    };
  }

  let targets = open;
  const reqId = String(opts.loanId ?? '').trim();
  if (reqId) {
    const hit = open.find((l) => l.id === reqId);
    if (!hit) {
      return {
        ok: false,
        reason: `没找到在贷编号「${reqId}」，当前在贷编号：${open.map((l) => l.id).join('、')}。`,
        paidTotal: 0,
        paidPrincipal: 0,
        paidInterest: 0,
        repaidLoans: [],
        clearedOverdue: false,
        shortByCash: 0,
        wantedTotal: 0,
        reservedLivingCash: false,
      };
    }
    targets = [hit];
  }

  const totalDebt = targets.reduce((s, l) => s + loanRemaining(l).total, 0);
  const explicitAmount = opts.amount !== undefined && opts.amount !== null;
  const reqAmt = explicitAmount ? Math.round(Number(opts.amount) || 0) : totalDebt;
  if (reqAmt <= 0) {
    return {
      ok: false, reason: '还款金额要大于 0。',
      paidTotal: 0, paidPrincipal: 0, paidInterest: 0, repaidLoans: [], clearedOverdue: false,
      shortByCash: 0, wantedTotal: 0, reservedLivingCash: false,
    };
  }
  const maxCash = Math.floor(state.money.cash);
  if (maxCash <= 0) {
    return {
      ok: false, reason: '手上没有现金，得先挣点钱才能还。',
      paidTotal: 0, paidPrincipal: 0, paidInterest: 0, repaidLoans: [], clearedOverdue: false,
      shortByCash: Math.min(reqAmt, totalDebt), wantedTotal: Math.min(reqAmt, totalDebt), reservedLivingCash: false,
    };
  }

  const hadOverdueBefore = hasOverdueLoan(state);
  /*
   * 现金不够一次性清零时**按手上可动用的先还**，不整笔退回：
   * - 若未传 amount 且当前现金不够一次还清选中欠款，留出 LOAN_RESERVE_CASH（80 元）生活底钱，防止手滑还成 0 元断顿；
   * - 若显式指定了 amount（或手上钱够全额还清），尊重本次明确指令，直接按手上现金上限实扣。
   */
  const wanted = Math.min(reqAmt, totalDebt);
  const reserveGuard = !explicitAmount && maxCash < wanted;
  const spendableCash = reserveGuard ? Math.max(0, maxCash - LOAN_RESERVE_CASH) : maxCash;
  if (reserveGuard && spendableCash <= 0) {
    return {
      ok: false,
      reason: `手上只有 ${maxCash} 元，自动尽量还款会预留 ${LOAN_RESERVE_CASH} 元生活底钱；若确认要动用底钱，可显式指定 amount 还款。`,
      paidTotal: 0,
      paidPrincipal: 0,
      paidInterest: 0,
      repaidLoans: [],
      clearedOverdue: false,
      shortByCash: wanted,
      wantedTotal: wanted,
      reservedLivingCash: true,
    };
  }
  const shortByCash = Math.max(0, wanted - spendableCash);
  let left = wanted - shortByCash;
  let paidTotal = 0;
  let paidPrincipal = 0;
  let paidInterest = 0;
  const repaidLoans: { id: string; productName: string; paidTotal: number; paidOff: boolean; remaining: number }[] = [];

  for (const loan of targets) {
    if (left <= 0) break;
    const res = applyRepayChunkToLoan(state, loan, left, now);
    if (res.total > 0) {
      left -= res.total;
      paidTotal += res.total;
      paidPrincipal += res.principal;
      paidInterest += res.interest;
      repaidLoans.push({
        id: loan.id,
        productName: loan.productName,
        paidTotal: res.total,
        paidOff: res.paidOff,
        remaining: loanRemaining(loan).total,
      });
    }
  }

  const clearedOverdue = hadOverdueBefore && !hasOverdueLoan(state);
  clearOverdueMoodletIfClean(state);
  state.updatedAt = now.toISOString();

  if (paidTotal > 0) {
    const allPaid = repaidLoans.every((r) => r.paidOff);
    addTellable(
      state,
      allPaid
        ? `还清了信用社借款（本次还 ${paidTotal} 元，其中微息 ${paidInterest} 元），无债一身轻。`
        : `向信用社先还了一笔 ${paidTotal} 元（本金 ${paidPrincipal} + 利息 ${paidInterest}）。`,
      now,
    );
  }

  return {
    ok: paidTotal > 0,
    paidTotal,
    paidPrincipal,
    paidInterest,
    repaidLoans,
    clearedOverdue,
    shortByCash,
    wantedTotal: wanted,
    reservedLivingCash: reserveGuard,
  };
}

/**
 * 随自然时间推进：
 * 1. 按跨过的本地自然日累计应付微息；
 * 2. 到期日触发自动还贷（但强制保留 >= 80 元生活底钱）；
 * 3. 还不够的部分转入 `overdue` 并挂逾期情绪胶囊。
 */
export function settleLoansOnAdvance(state: LoanHostState, now: Date): LoanAdvanceSettlement {
  const today = localDayKey(now);
  let interestAccrued = 0;
  let autoRepaidTotal = 0;
  let autoRepaidPrincipal = 0;
  let autoRepaidInterest = 0;
  const newlyOverdue: LoanRecord[] = [];
  const paidOff: LoanRecord[] = [];

  const open = activeLoans(state).sort((a, b) => a.dueDay.localeCompare(b.dueDay));
  for (const loan of open) {
    const remBefore = loanRemaining(loan);
    if (remBefore.principal > 0 && today > loan.lastAccruedDay) {
      const days = Math.min(365, daysBetweenDayKeys(loan.lastAccruedDay, today));
      if (days > 0) {
        const rawInt = (loan.interestCarry ?? 0) + remBefore.principal * loan.ratePerDay * days;
        const delta = Math.floor(rawInt + 1e-9);
        loan.interestCarry = Math.round((rawInt - delta) * 10000) / 10000;
        if (delta > 0) {
          loan.accruedInterest += delta;
          interestAccrued += delta;
        }
        loan.lastAccruedDay = today;
      }
    }

    if (loan.status === 'active' && today >= loan.dueDay) {
      if (loan.accruedInterest === 0 && (loan.interestCarry ?? 0) >= 0.5) {
        loan.accruedInterest += 1;
        loan.interestCarry = 0;
        interestAccrued += 1;
      }
      const availForDebt = Math.max(0, Math.floor(state.money.cash - LOAN_RESERVE_CASH));
      const res = applyRepayChunkToLoan(state, loan, availForDebt, now);
      if (res.total > 0) {
        autoRepaidTotal += res.total;
        autoRepaidPrincipal += res.principal;
        autoRepaidInterest += res.interest;
      }
      if (res.paidOff) {
        paidOff.push(loan);
        addTellable(state, `「${loan.productName}」到期自动还清（共扣 ${res.total} 元，含息 ${res.interest} 元）。`, now);
      } else {
        loan.status = 'overdue';
        newlyOverdue.push(loan);
        const rem = loanRemaining(loan);
        addTellable(state, `「${loan.productName}」到期了还没凑够，目前还欠 ${rem.total} 元，心里挺沉的。`, now);
      }
    }
  }

  const overdueNow = hasOverdueLoan(state);
  if (overdueNow) {
    state.moodlets = (state.moodlets ?? []).filter((m) => m.source !== 'loan_overdue');
    state.moodlets.push({
      id: `m-loan-od-${now.getTime().toString(36)}`,
      source: 'loan_overdue',
      text: '信用社借款到期还没还清，心里沉甸甸的',
      kind: 'bad',
      expiresAt: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
    });
  } else {
    clearOverdueMoodletIfClean(state);
  }

  return {
    interestAccrued,
    autoRepaidTotal,
    autoRepaidPrincipal,
    autoRepaidInterest,
    newlyOverdue,
    paidOff,
    hasOverdue: overdueNow,
  };
}

/**
 * 逾期期间有新进账（打工结算、鱼市街卖摊入账）时，抽取 50% 自动冲抵逾期欠款；
 * 剩余 50% 留给她自己吃饭过日子。
 */
export function garnishOverdueFromIncome(
  state: LoanHostState,
  grossIncome: number,
  now: Date,
): LoanGarnishResult {
  const overdue = (state.loans ?? [])
    .filter((l) => l.status === 'overdue' && loanRemaining(l).total > 0)
    .sort((a, b) => a.dueDay.localeCompare(b.dueDay));
  if (!overdue.length || grossIncome <= 0) {
    return { deductedTotal: 0, deductedPrincipal: 0, deductedInterest: 0, paidOffIds: [], clearedAllOverdue: false };
  }

  const garnishCap = Math.min(
    Math.floor(state.money.cash),
    Math.max(1, Math.floor(grossIncome * LOAN_OVERDUE_GARNISH_RATE)),
  );
  if (garnishCap <= 0) {
    return { deductedTotal: 0, deductedPrincipal: 0, deductedInterest: 0, paidOffIds: [], clearedAllOverdue: false };
  }

  let left = garnishCap;
  let deductedTotal = 0;
  let deductedPrincipal = 0;
  let deductedInterest = 0;
  const paidOffIds: string[] = [];

  for (const loan of overdue) {
    if (left <= 0) break;
    const res = applyRepayChunkToLoan(state, loan, left, now);
    if (res.total > 0) {
      left -= res.total;
      deductedTotal += res.total;
      deductedPrincipal += res.principal;
      deductedInterest += res.interest;
      if (res.paidOff) paidOffIds.push(loan.id);
    }
  }

  const clearedAllOverdue = !hasOverdueLoan(state);
  clearOverdueMoodletIfClean(state);

  if (deductedTotal > 0) {
    addTellable(
      state,
      clearedAllOverdue
        ? `刚刚这笔进账按规矩划扣了 ${deductedTotal} 元，逾期欠款总算全清零了！`
        : `刚刚这笔进账抽了一半（${deductedTotal} 元）先抵信用社逾期欠款。`,
      now,
    );
  }

  return {
    deductedTotal,
    deductedPrincipal,
    deductedInterest,
    paidOffIds,
    clearedAllOverdue,
  };
}

export function applyUserCashGift(
  state: LoanHostState,
  opts: { amount: number; note?: string; dailyCap?: number },
  now: Date,
): {
  ok: boolean;
  reason?: string;
  amount: number;
  note: string;
  todayTotal: number;
  dailyCap: number;
  remainingToday: number | null;
  cash: number;
  giftedTotal: number;
  record?: GiftCashRecord;
} {
  const today = localDayKey(now);
  const giftState = normGiftCash(state.giftCash, now);
  state.giftCash = giftState;

  const rawCap = opts.dailyCap !== undefined && Number.isFinite(Number(opts.dailyCap))
    ? Math.max(0, Math.round(Number(opts.dailyCap)))
    : DEFAULT_DAILY_GIFT_CAP;

  const amt = Math.round(Number(opts.amount) || 0);
  if (!Number.isFinite(amt) || amt <= 0) {
    return {
      ok: false,
      reason: '赠与金额必须是大于 0 的整数。',
      amount: 0,
      note: '',
      todayTotal: giftState.todayTotal,
      dailyCap: rawCap,
      remainingToday: rawCap > 0 ? Math.max(0, rawCap - giftState.todayTotal) : null,
      cash: state.money.cash,
      giftedTotal: state.money.giftedTotal ?? 0,
    };
  }

  if (rawCap > 0 && giftState.todayTotal + amt > rawCap) {
    const rem = Math.max(0, rawCap - giftState.todayTotal);
    return {
      ok: false,
      reason: rem > 0
        ? `今天已经给过 ${giftState.todayTotal} 元零花钱了，按当前每日软上限 ${rawCap} 元，今天最多还能给 ${rem} 元（可在扩展设置里调高或设为 0 不限）。`
        : `今天已经给满 ${rawCap} 元零花钱啦，明天再给吧（可在扩展设置里调高每日软上限或设为 0 不限）。`,
      amount: 0,
      note: '',
      todayTotal: giftState.todayTotal,
      dailyCap: rawCap,
      remainingToday: rem,
      cash: state.money.cash,
      giftedTotal: state.money.giftedTotal ?? 0,
    };
  }

  const note = String(opts.note ?? '').trim().slice(0, 80);
  const rec: GiftCashRecord = {
    id: `gift-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    ts: now.toISOString(),
    dateKey: today,
    amount: amt,
    note,
  };

  state.money.cash += amt;
  state.money.giftedTotal = (state.money.giftedTotal ?? 0) + amt;
  giftState.todayTotal += amt;
  giftState.recent = [...giftState.recent, rec].slice(-20);
  state.updatedAt = now.toISOString();

  addTellable(
    state,
    `他发来一笔 ${amt} 元零花钱${note ? `，留了句话：「${note}」` : ''}。`,
    now,
  );

  return {
    ok: true,
    amount: amt,
    note,
    todayTotal: giftState.todayTotal,
    dailyCap: rawCap,
    remainingToday: rawCap > 0 ? Math.max(0, rawCap - giftState.todayTotal) : null,
    cash: state.money.cash,
    giftedTotal: state.money.giftedTotal,
    record: rec,
  };
}

export function loanSummary(state: Pick<LoanHostState, 'home' | 'job' | 'loans'>, now: Date) {
  const limit = computeCreditLimit(state);
  const avail = availableCredit(state);
  const overdue = hasOverdueLoan(state);
  const open = activeLoans(state).map((l) => {
    const rem = loanRemaining(l);
    return {
      ...l,
      remainingPrincipal: rem.principal,
      remainingInterest: rem.interest,
      remainingTotal: rem.total,
    };
  });
  const totalDue = open.reduce((s, l) => s + l.remainingTotal, 0);
  const recentPaid = (state.loans ?? []).filter((l) => l.status === 'paid').slice(-5).reverse();
  return {
    creditLimit: limit,
    availableCredit: avail,
    creditFrozen: overdue,
    maxActive: LOAN_MAX_ACTIVE,
    hardCap: LOAN_HARD_CAP,
    reserveCash: LOAN_RESERVE_CASH,
    garnishRate: LOAN_OVERDUE_GARNISH_RATE,
    activeCount: open.length,
    totalDue,
    today: localDayKey(now),
    active: open,
    recentPaid,
    products: LOAN_PRODUCTS,
  };
}
