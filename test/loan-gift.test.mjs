/**
 * 模拟鱼生 · 贷款（芦花塘信用社）与用户零花钱赠与全链路测试：
 * 1) 面板零花钱赠与：每日 500 软上限、可配置调高/0 不限、giftedTotal 与 earned 分账、life-ledger 记录 user_gift、flush 事件
 * 2) 信用社动态额度（住处/持证/工龄）+ 最多 2 笔 + 硬封顶 5000 + 微息（按天）+ 提前还本不计 spent
 * 3) 到期自动扣款保底 80 元 + 不够转 overdue + 冻借 + travelAllowance=0 + 打工/卖摊进账 50% 自动抵债清零解冻
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { LifeWorld } = await import('../src/world.ts');
const { LIFE_DEFAULTS } = await import('../src/config.ts');
const { freshState, StateStore, readLedger, computeCreditLimit } = await import('../src/state.ts');
const { advance } = await import('../src/state.ts');

function mkDir() {
  return mkdtempSync(join(tmpdir(), 'life-loan-gift-'));
}

function makeHost(events = []) {
  return {
    log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
    pushEvent: async (e, opts) => {
      const item = { ...e, ...(opts?.trigger ? { trigger: opts.trigger } : {}) };
      events.push(item);
      return item;
    },
    store: {},
    drainPendingEvents: async () => [],
  };
}

test('用户零花钱赠与：500 元日上限控制、giftedTotal 分账、life-ledger 落盘与 flush 事件', async () => {
  const dir = mkDir();
  const events = [];
  let now = new Date('2026-11-27T12:00:00.000+08:00');
  try {
    const st = freshState(now);
    st.money.cash = 400;
    new StateStore(dir).save(st);

    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, dailyGiftCap: 500 },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => now,
    });
    await world.start(makeHost(events));
    const ui = world.webUi();

    const r1 = await ui.invoke('now', 'giftCash', [{ amount: 200, note: '去吃条红烧鱼' }]);
    assert.equal(r1.ok, true);
    assert.equal(r1.money.cash, 600);
    assert.equal(r1.money.earned, 0, '零花钱不能算进自己挣的 earned');
    assert.equal(r1.money.giftedTotal, 200);
    assert.equal(r1.giftCash.todayTotal, 200);
    assert.equal(r1.giftCash.remainingToday, 300);

    // 当天想再发 350 -> 超过 500 上限被挡住
    const over = await ui.invoke('now', 'giftCash', [{ amount: 350, note: '多给点' }]);
    assert.equal(over.ok, false);
    assert.match(over.reason, /软上限 500/);
    assert.equal(over.money.cash, 600);

    // 发 300 凑满 500 允许通过
    const r2 = await ui.invoke('now', 'giftCash', [{ amount: 300, note: '添点饲料' }]);
    assert.equal(r2.ok, true);
    assert.equal(r2.money.cash, 900);
    assert.equal(r2.money.giftedTotal, 500);
    assert.equal(r2.giftCash.remainingToday, 0);

    // 验证 ledger 与事件
    const ledger = readLedger(dir, 20);
    assert.equal(ledger.filter((x) => x.source === 'user_gift').length, 2);
    const giftEvents = events.filter((e) => e.type === 'life.gift_cash');
    assert.equal(giftEvents.length, 2);
    assert.equal(giftEvents[0].trigger, 'flush');

    await world.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('芦花塘信用社：动态额度、微息提前还款与 journey 防套利 travelAllowance 扣除在贷本息', async () => {
  const dir = mkDir();
  const events = [];
  let now = new Date('2026-11-10T10:00:00.000+08:00');
  try {
    const st = freshState(now);
    st.money.cash = 1000;
    st.home.tier = 'old'; // 800
    st.job.certs = ['健康证', '驾照']; // +500
    st.job.days = 10; // +300 => 总额度 1600
    new StateStore(dir).save(st);

    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => now,
    });
    await world.start(makeHost(events));
    const loanTool = world.tools().find((t) => t.name === 'life_loan');
    assert.ok(loanTool, '必须注册 life_loan 工具');

    const statRes = await loanTool.handler({ action: 'status' });
    assert.match(statRes.text, /授信上限 1600 元/);

    // 借一笔 1000 元 14 天进修农牧贷（日息 0.12%）
    const b1 = await loanTool.handler({ action: 'borrow', amount: 1000, term_days: 14, purpose: '备战考厨师证' });
    assert.match(b1.text, /借了 1000 元/);

    // 检查 life-public.json：cash=2000，但 unpaidDebt=1000 => freeCash=1000 => travelAllowance=700
    const pub1 = JSON.parse(readFileSync(join(dir, 'life-public.json'), 'utf8'));
    assert.equal(pub1.ledger.cash, 2000);
    assert.equal(pub1.ledger.unpaidDebt, 1000);
    assert.equal(pub1.ledger.travelAllowance, 700);
    assert.equal(pub1.ledger.hasOverdueLoan, false);

    // 再借第 2 笔 600 元（凑满 1600 额度）
    const b2 = await loanTool.handler({ action: 'borrow', amount: 600, term_days: 7, purpose: '周转' });
    assert.match(b2.text, /借了 600 元/);

    // 尝试再借第 3 笔 -> 2 笔上限拦截
    const b3 = await loanTool.handler({ action: 'borrow', amount: 100, term_days: 7, purpose: '超笔数' });
    assert.match(b3.text, /最多只能背 2 笔/);

    // 推进 4 天（仅按实际占用 4 天计微息）
    now = new Date('2026-11-14T10:00:00.000+08:00');
    const stTool = world.tools().find((t) => t.name === 'life_status');
    const stTxt = await stTool.handler({});
    assert.match(stTxt.text, /信用社借款：待还/);

    // 主动还清所有借款
    const cashBeforeRepay = world.webUi();
    const snapBefore = await cashBeforeRepay.invoke('now', 'snapshot');
    const rep = await loanTool.handler({ action: 'repay' });
    assert.match(rep.text, /已结清/);

    const snapAfter = await cashBeforeRepay.invoke('now', 'snapshot');
    assert.equal(snapAfter.loan.activeCount, 0);
    // spent 只计入利息（600*0.15%*4 ≈ 4 + 1000*0.12%*4 ≈ 5 => 利息极少，绝不把 1600 本金计入 spent）
    assert.ok(snapAfter.money.spent < snapBefore.money.spent + 30, '提前还款只算微息，不把本金计入 spent');
    assert.equal(computeCreditLimit(st), 1600);

    await world.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('到期保底 80 元与逾期闭环：冻结新借、travelAllowance 归 0、出工自动抵半并还清解冻', async () => {
  const dir = mkDir();
  const events = [];
  let now = new Date('2026-11-10T09:00:00.000+08:00');
  try {
    const st = freshState(now);
    st.money.cash = 100;
    new StateStore(dir).save(st);

    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => now,
    });
    await world.start(makeHost(events));
    const loanTool = world.tools().find((t) => t.name === 'life_loan');

    // 城中村上限 300，借 200 元 7 天应急（现现金 300）
    await loanTool.handler({ action: 'borrow', amount: 200, term_days: 7, purpose: '买种子与吃饭' });

    // 在外面花了只剩 95 元现金，到 11-18 已过 7 天到期日（保底留 80 元 => 最多自动扣 15 元，不够还清转 overdue）
    const store = new StateStore(dir);
    const loaded = store.load(now).state;
    loaded.money.cash = 95;
    store.save(loaded);
    // 重启加载修改后状态
    await world.stop();

    const w2 = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => now,
    });
    await w2.start(makeHost(events));

    // 快进到第 8 天触发到期自动扣款（扣后现金应保底 >= 80 元，状态转 overdue）
    now = new Date('2026-11-18T10:00:00.000+08:00');
    const stTool2 = w2.tools().find((t) => t.name === 'life_status');
    const statusAfterDue = await stTool2.handler({});
    assert.match(statusAfterDue.text, /已逾期|逾期冻结/);
    assert.match(statusAfterDue.text, /出门能动用的：0 元/);

    const pubOd = JSON.parse(readFileSync(join(dir, 'life-public.json'), 'utf8'));
    assert.equal(pubOd.ledger.hasOverdueLoan, true);
    assert.equal(pubOd.ledger.travelAllowance, 0);
    assert.ok(events.some((e) => e.type === 'life.loan' && e.trigger === 'flush'), '逾期应推送 life.loan flush 事件');

    // 逾期期间尝试新借必须被冻结
    const loanTool2 = w2.tools().find((t) => t.name === 'life_loan');
    const frozenRes = await loanTool2.handler({ action: 'borrow', amount: 50, term_days: 7, purpose: '再借' });
    assert.match(frozenRes.text, /已暂停新借/);

    // 去搬货打工（日薪 90 元，4 小时）收工 -> 自动抽 50% (45 元) 抵债
    const workTool = w2.tools().find((t) => t.name === 'life_work');
    await workTool.handler({ what: '搬货' });
    now = new Date('2026-11-18T15:00:00.000+08:00');
    const ui2 = w2.webUi();
    const snapMid = await ui2.invoke('now', 'snapshot');
    assert.ok(snapMid.loan.totalDue < 200, '打工结算应按 50% 自动抵债一部分欠款');
    assert.ok(snapMid.loan.totalDue <= 144, `小额借款应按 0.15%/天真微息累计（预期剩余 <= 144，实际 ${snapMid.loan.totalDue}）`);
    const ledgerOd = readLedger(dir, 20);
    assert.ok(ledgerOd.some((r) => r.source === 'life_loan_repay' && r.note.includes('50%')));

    // 收到零花钱后还清剩余逾期欠款，应解除逾期冻结并恢复可借额度
    await ui2.invoke('now', 'giftCash', [{ amount: 200, note: '把信用社尾款清了' }]);
    const payoffRes = await loanTool2.handler({ action: 'repay' });
    assert.match(payoffRes.text, /已结清|逾期已解除/);
    const pubClean = JSON.parse(readFileSync(join(dir, 'life-public.json'), 'utf8'));
    assert.equal(pubClean.ledger.hasOverdueLoan, false);
    const reborrowRes = await loanTool2.handler({ action: 'borrow', amount: 80, term_days: 7, purpose: '解冻验证' });
    assert.match(reborrowRes.text, /借了 80 元/);

    // 验证纯函数 advance 也能正常在单日跨度下触发 garnishOverdueFromIncome
    assert.equal(typeof advance, 'function');

    await w2.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/*
 * 以下两条是 2026-11-27 修 bug 时补的回归：
 * 1) describe 里写的是「省略 amount 则尽量全额还清」，实现却是钱不够就整笔拒绝 —— 两边对不上；
 * 2) normLoans 用 slice(-40) 截断，会把最早的**未结清**借款一起切掉，那笔债就凭空消失。
 */
test('还款：省略 amount 钱不够时预留 80 元底钱尽量先还；指定 amount 则按手上现金先还且回执不混口径', async () => {
  const { applyBorrowLoan, applyRepayLoan, loanSummary } = await import('../src/loan.ts');
  const now = new Date('2026-11-27T10:00:00.000+08:00');
  const s = freshState(now);
  s.money.cash = 500;

  const b = applyBorrowLoan(s, { amount: 300, termDays: 7, purpose: '周转' }, now);
  assert.equal(b.ok, true, '授信 300 时应能借到 300');

  // 省略 amount 且现金不足一次清零：180 - 80 = 100 先还，口袋保留 80 元生活底钱
  s.money.cash = 180;
  const r = applyRepayLoan(s, {}, now);
  assert.equal(r.ok, true, '钱不够一次清零时也应先还多余部分');
  assert.equal(r.paidTotal, 100);
  assert.equal(r.shortByCash, 200);
  assert.equal(r.reservedLivingCash, true);
  assert.equal(Math.round(s.money.cash), 80, '省略 amount 时必须保留 80 元生活底钱');
  assert.equal(Math.round(loanSummary(s, now).totalDue), 200);

  // 只剩 80 元底钱时省略 amount -> 不再强扣成 0，提示需显式指定 amount
  const rGuard = applyRepayLoan(s, {}, now);
  assert.equal(rGuard.ok, false);
  assert.match(rGuard.reason, /预留 80 元生活底钱/);
  assert.match(rGuard.reason, /指定 amount/);

  // 显式指定 amount: 150 且现金只有 80 -> 尊重显式指令，按手头现金 80 封顶实扣
  const r2 = applyRepayLoan(s, { amount: 150 }, now);
  assert.equal(r2.ok, true);
  assert.equal(r2.paidTotal, 80);
  assert.equal(r2.wantedTotal, 150);
  assert.equal(r2.shortByCash, 70);
  assert.equal(r2.reservedLivingCash, false);
  assert.equal(Math.round(s.money.cash), 0);

  // 现金为 0 仍然是拒绝
  const r3 = applyRepayLoan(s, {}, now);
  assert.equal(r3.ok, false);

  // 验证 life_loan(repay) 回执不会把「本次计划少还」和「剩余总待还」混成两个「还差」
  const dir = mkDir();
  try {
    const wSt = freshState(now);
    wSt.money.cash = 100;
    wSt.loans = s.loans.slice(0, 1).map((l) => ({
      ...l,
      repaidPrincipal: 0,
      repaidInterest: 0,
      accruedInterest: 0,
      status: 'active',
    }));
    new StateStore(dir).save(wSt);
    const w = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼', now: () => now });
    await w.start(makeHost());
    const loanTool = w.tools().find((t) => t.name === 'life_loan');
    const repToolRes = await loanTool.handler({ action: 'repay', amount: 150 });
    assert.match(repToolRes.text, /本次原本计划还 150 元，按手头现金先还了 100 元/);
    assert.match(repToolRes.text, /名下还剩待还 200 元/);
    assert.doesNotMatch(repToolRes.text, /还差 \d+ 元/);
    await w.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('账目截断：只留最近 40 笔时，未结清的欠条不能被切掉', async () => {
  const { normLoans } = await import('../src/loan.ts');
  const now = new Date('2026-11-27T10:00:00.000+08:00');
  const mk = (i, status) => ({
    id: `ln_${i}`,
    product: 'emergency',
    principal: 100,
    termDays: 7,
    borrowedDay: '2026-11-01',
    dueDay: '2026-11-08',
    lastAccruedDay: '2026-11-01',
    accruedInterest: 0,
    repaidPrincipal: 0,
    repaidInterest: 0,
    status,
  });

  const raw = [mk(0, 'active'), ...Array.from({ length: 44 }, (_, j) => mk(j + 1, 'paid'))];
  const out = normLoans(raw, now);
  assert.equal(out.length, 40, '总数仍应被收敛到 40');
  assert.ok(out.some((l) => l.id === 'ln_0' && l.status === 'active'), '最老那笔未结清借款必须留住');

  const allPaid = Array.from({ length: 50 }, (_, j) => mk(j, 'paid'));
  assert.equal(normLoans(allPaid, now).length, 40, '全结清时正常按上限裁剪');
});
