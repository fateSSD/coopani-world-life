import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const networkCalls = [];
globalThis.fetch = async (input) => {
  const url = String(input instanceof URL ? input : input?.url ?? input);
  networkCalls.push(url);
  throw new Error(`测试硬离线哨兵：${url}`);
};

const { LifeWorld, LIFE_DESCRIBE } = await import('../src/world.ts');
const { LIFE_DEFAULTS } = await import('../src/config.ts');
const { JOBS } = await import('../src/jobs.ts');
const { StateStore, freshState, localDateKey, applyAct } = await import('../src/state.ts');

function cleanupDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

test('describe.json 与 world.tools() 单源对齐，且 life_work 数值与 JOBS/LOAD 一致', () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-sync-test-'));
  try {
    const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼' });
    const tools = world.tools();

    assert.equal(LIFE_DESCRIBE.tools.length, tools.length, '工具数量不一致');
    for (let i = 0; i < tools.length; i++) {
      const a = tools[i];
      const b = LIFE_DESCRIBE.tools[i];
      assert.equal(b.name, a.name);
      assert.equal(b.description, a.description, `${a.name} description 未与源码同步`);
      assert.deepEqual(b.parameters, a.parameters, `${a.name} parameters 未与源码同步`);
      assert.deepEqual(b.tags, [...a.tags], `${a.name} tags 未与源码同步`);
    }

    const st = LIFE_DESCRIBE.tools.find((t) => t.name === 'life_status');
    assert.ok(st?.tags.includes('snapshot'));
    const act = LIFE_DESCRIBE.tools.find((t) => t.name === 'life_act');
    assert.ok(act?.parameters?.properties?.kind?.enum?.includes('wake'));
    assert.ok(LIFE_DESCRIBE.events.some((e) => e.type === 'life.goal'));
    assert.ok(LIFE_DESCRIBE.events.some((e) => e.type === 'life.handoff' && e.trigger === 'piggyback'));
    // L10：life.day 与 life.handoff 补齐 snapshot 标签
    const dayEv = LIFE_DESCRIBE.events.find((e) => e.type === 'life.day');
    const handoffEv = LIFE_DESCRIBE.events.find((e) => e.type === 'life.handoff');
    assert.ok(dayEv?.tags?.includes('snapshot'), 'life.day 缺少 snapshot 标签');
    assert.ok(handoffEv?.tags?.includes('snapshot'), 'life.handoff 缺少 snapshot 标签');

    const workDesc = tools.find((t) => t.name === 'life_work').description;
    for (const tier of ['odd', 'skilled', 'certified', 'professional']) {
      const list = JOBS.filter((j) => j.tier === tier);
      const minPay = Math.min(...list.map((j) => j.pay));
      const maxPay = Math.max(...list.map((j) => j.pay));
      assert.ok(workDesc.includes(`${minPay}–${maxPay}`), `life_work 未包含 ${tier} 真实薪酬区间 ${minPay}–${maxPay}`);
    }
    assert.equal(workDesc.includes('社交和娱乐不会掉'), false, 'work 实际会扣少量 fun，不能声明娱乐不会掉');
  } finally {
    cleanupDir(dir);
  }
});

test('describe.json 与 envPromptVars 不含第三人称，life-public 含 libraryDir，life.now 无动态分钟', async () => {
  const descRaw = readFileSync(new URL('../describe.json', import.meta.url), 'utf8');
  assert.doesNotMatch(descRaw, /\b(she|her|hers)\b/i);
  assert.doesNotMatch(descRaw, /她/);

  const envTpl = readFileSync(new URL('../ENV_PROMPT.md', import.meta.url), 'utf8');
  assert.doesNotMatch(envTpl, /她/);

  const dir = mkdtempSync(join(tmpdir(), 'life-vars-'));
  const customLib = join(dir, 'custom-lib');
  try {
    const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true, libraryDir: customLib }, dataDir: dir, botName: '大肥鱼' });
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => e,
      store: {},
      drainPendingEvents: async () => [],
    });
    const vars = world.envPromptVars();
    assert.doesNotMatch(vars['life.now'], /她那边|\d{2}:\d{2}/);
    const pub = JSON.parse(readFileSync(join(dir, 'life-public.json'), 'utf8'));
    assert.equal(pub.libraryDir, customLib);
    await world.stop();
  } finally {
    cleanupDir(dir);
  }
});

test('L1/L8/L9：life.state 清理后不复活且广播失败诚实抛错，life.diary 清理双目录，life.library 名实一致', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-clear-'));
  const customDiary = join(dir, 'sync-diary');
  try {
    const store = new StateStore(dir);
    const s1 = freshState(new Date());
    s1.money.cash = 9876;
    store.save(s1);
    s1.money.cash = 8888;
    store.save(s1); // 生成 life-state.json 和 .bak
    assert.equal(existsSync(join(dir, 'life-state.json.bak')), true);

    const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true, diaryDir: customDiary }, dataDir: dir, botName: '大肥鱼' });
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => e,
      store: {},
      drainPendingEvents: async () => [],
    });

    // 写入两处日记并触发 _bak
    const localDiaryDir = join(dir, 'life-diary');
    mkdirSync(localDiaryDir, { recursive: true });
    writeFileSync(join(localDiaryDir, '2026-10.md'), '---\ndate: 2026-10-01\ntown: 芦花塘\n---\n旧本地日记\n', 'utf8');
    world.diary.write({ dateKey: '2026-11-18', townName: '芦花塘', body: '初版' });
    world.diary.write({ dateKey: '2026-11-18', townName: '芦花塘', body: '二版覆盖产生bak' });
    assert.ok(world.diary.count() >= 2);
    assert.equal(existsSync(join(customDiary, '_bak')), true);

    // L9：素材库存储项正名为策略配置，仅删策略配置、绝不误删参考图原件
    world.library.saveSettings({ policy: 'active', cooldownMin: 15 });
    const ui = world.webUi();
    const statePart = ui.storage.find((p) => p.key === 'life.state');
    const diaryPart = ui.storage.find((p) => p.key === 'life.diary');
    const libPart = ui.storage.find((p) => p.key === 'life.library');
    assert.equal(libPart.label, '参考素材库策略配置');
    assert.equal(libPart.danger, false);
    assert.match(libPart.location, /image-library-settings\.json$/);
    assert.match(libPart.stat(), /积极.*15 分钟/);
    const libEntriesBefore = world.library.list().length;
    assert.ok(libEntriesBefore > 0);
    libPart.clear();
    assert.equal(existsSync(join(dir, 'image-library-settings.json')), false);
    assert.match(libPart.stat(), /默认策略/);
    assert.equal(world.library.list().length, libEntriesBefore, '清理策略配置不得删除参考图条目');

    statePart.clear();
    assert.equal(existsSync(join(dir, 'life-state.json')), false);
    assert.equal(existsSync(join(dir, 'life-state.json.bak')), false);
    assert.equal(statePart.stat(), '未生成');
    const pub = JSON.parse(readFileSync(join(dir, 'life-public.json'), 'utf8'));
    assert.notEqual(pub.ledger.cash, 8888);

    diaryPart.clear();
    assert.equal(world.diary.count(), 0);
    assert.equal(existsSync(join(customDiary, '_bak')), false);

    // L1：当 life-public.json 被替换为非空目录导致原子覆盖失败时，life.state.clear() 必须抛错，绝不静默报成功
    const dirErr = mkdtempSync(join(tmpdir(), 'life-clear-err-'));
    try {
      const worldErr = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dirErr, botName: '大肥鱼' });
      const errUi = worldErr.webUi();
      const errStatePart = errUi.storage.find((p) => p.key === 'life.state');
      const pubFile = join(dirErr, 'life-public.json');
      if (existsSync(pubFile)) rmSync(pubFile, { recursive: true, force: true });
      mkdirSync(join(pubFile, 'blocker'), { recursive: true });
      writeFileSync(join(pubFile, 'blocker', 'keep.txt'), 'x', 'utf8');
      assert.throws(() => errStatePart.clear(), '公开快照写入失败时 clear() 必须抛出异常');
    } finally {
      cleanupDir(dirErr);
    }

    // stop 后不得写回旧状态，重启加载也必须是初始新现金
    await world.stop();
    assert.equal(existsSync(join(dir, 'life-state.json')), false, 'clear 后 stop() 不得写回复活');
    const world2 = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼' });
    assert.notEqual(world2.webUi().storage.find((p) => p.key === 'life.state').stat(), '未生成'.includes('8888') ? '' : 'ok');
    assert.equal(world2.envPromptVars()['life.who'].includes('8888'), false);
  } finally {
    cleanupDir(dir);
  }
});

test('L2/L3/L4/L5/L6：render 零副作用与 onEventsSettled 提交、handoff 纯只读、settleBeforeTool 不吞病愈/生病', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-behavior-'));
  let nowDate = new Date('2026-11-19T02:00:00Z'); // Asia/Shanghai 当地 10:00（稳定白昼窗口）
  try {
    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => nowDate,
    });
    const pushed = [];
    const deferred = [];
    let pushShouldFail = false;

    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e, opts) => {
        if (pushShouldFail) throw new Error('mock push error');
        const env = { ...e, cursor: pushed.length + 1, opts };
        pushed.push(env);
        return env;
      },
      pushDeferred: (spec, opts) => {
        deferred.push({ spec, opts });
      },
      store: {},
      drainPendingEvents: async () => [],
    });

    // 1. L5: onHandoffEnded 同步入队且 render() 完全纯只读（不推进 this.state、不写盘、不写账本）
    writeFileSync(join(dir, 'journey-public.json'), JSON.stringify({
      schema: 1,
      updatedAt: nowDate.toISOString(),
      phase: 'staying',
      city: { id: 'chengdu', name: '成都' },
      clock: { worldNow: nowDate.toISOString(), speed: 1 },
    }), 'utf8');
    world.state.updatedAt = new Date(nowDate.getTime() - 2 * 3600_000).toISOString();
    world.state.activity = {
      id: 'odd',
      kind: 'work',
      label: '便利店帮工',
      startedAt: new Date(nowDate.getTime() - 2 * 3600_000).toISOString(),
      until: new Date(nowDate.getTime() - 3600_000).toISOString(),
      workEarned: 88,
    };
    const stateBeforeHandoff = JSON.stringify(world.state);
    world.onHandoffEnded(); // 故意不 await，验证同步入队！
    assert.equal(deferred.length, 1);
    assert.equal(deferred[0].spec.type, 'life.handoff');
    assert.equal(deferred[0].opts.trigger, 'piggyback');
    assert.deepEqual(deferred[0].spec.tags, ['snapshot']);
    const renderedHandoff = deferred[0].spec.render();
    assert.match(renderedHandoff.text, /在成都/);
    assert.equal(JSON.stringify(world.state), stateBeforeHandoff, 'handoff render() 不得修改 this.state');
    assert.equal(existsSync(join(dir, 'life-ledger.jsonl')), false, 'handoff render() 不得提前写账本');
    world.state.activity = null;

    // 2. L3: 多条独立 life.low 走即时且不带 snapshot 互覆
    world.state.vitals.food = 22;
    world.state.vitals.clean = 22;
    await world.reportCrossed(['food', 'clean'], nowDate);
    const lowEvents = pushed.filter((e) => e.type === 'life.low');
    assert.equal(lowEvents.length, 2);
    assert.equal(lowEvents[0].tags, undefined);
    assert.equal(lowEvents[1].tags, undefined);

    // 推送失败时不扣 nagged 额度
    pushShouldFail = true;
    world.state.vitals.fun = 22;
    await world.reportCrossed(['fun'], nowDate);
    const today = localDateKey(nowDate);
    assert.equal(world.state.nagged.fun, undefined);
    pushShouldFail = false;

    // 3. L4: settleBeforeTool 推进经过病愈时刻时必须补发 life.recovered，不得吞掉一次性事件
    pushed.length = 0;
    world.state.conditions = [{
      id: 'cold',
      text: '受凉了',
      since: new Date(nowDate.getTime() - 25 * 3600_000).toISOString(),
      until: new Date(nowDate.getTime() - 10 * 60_000).toISOString(),
    }];
    world.state.vitals.energy = 80;
    world.state.vitals.food = 80;
    world.state.vitals.clean = 80;
    world.state.vitals.fun = 80;
    world.state.vitals.social = 80;
    world.state.updatedAt = new Date(nowDate.getTime() - 3600_000).toISOString();
    await world.settleBeforeTool(nowDate);
    assert.ok(pushed.some((e) => e.type === 'life.recovered'), 'settleBeforeTool 必须发出 life.recovered');

    // 4. L2: 固定白天 10:00 入队 life.day；render() 不预先落盘消耗额度，直到 onEventsSettled('delivered') 才消费
    deferred.length = 0;
    world.state.updatedAt = new Date(nowDate.getTime() - 3 * 3600_000).toISOString();
    world.state.vitals.energy = 80;
    world.state.vitals.food = 80;
    world.state.vitals.clean = 80;
    world.state.vitals.fun = 80;
    world.state.vitals.social = 80;
    world.state.conditions = [];
    world.state.asleepUntil = '';
    world.state.activity = null;
    world.state.job.lastAt = '';
    world.state.money.cash = 100;
    delete world.state.nagged['day:work'];
    world.store.save(world.state);

    await world.tick();
    const dayItem = deferred.find((d) => d.spec.type === 'life.day');
    assert.ok(dayItem, '白天 10:00 满足条件时应当入队 life.day');
    assert.equal(world.state.nagged['day:work'], undefined, '仅入队时不应消耗当日额度');

    // 睡着时 render 返回 null，仍不消耗额度
    world.state.asleepFrom = new Date(nowDate.getTime() - 60_000).toISOString();
    world.state.asleepUntil = new Date(nowDate.getTime() + 3600_000).toISOString();
    assert.equal(dayItem.spec.render(), null);
    assert.equal(world.state.nagged['day:work'], undefined);

    // render(null) 会释放旧票据；醒来后通过下一跳重新入队，不能复用已失效票据
    world.state.asleepFrom = '';
    world.state.asleepUntil = '';
    world.state.money.cash = 777;
    world.state.updatedAt = new Date(nowDate.getTime() - 3600_000).toISOString();
    deferred.length = 0;
    await world.tick();
    const retryDayItem = deferred.find((d) => d.spec.type === 'life.day');
    assert.ok(retryDayItem, 'render(null) 后下一跳应允许重新入队');
    const expectedCash = Math.round(world.state.money.cash);
    const out = retryDayItem.spec.render();
    assert.match(out.text, new RegExp(`${expectedCash} 元`));
    assert.equal(world.state.nagged['day:work'], undefined, 'render() 期间不得预先写 nagged 或写盘');
    const dayEnvelope = (item, cursor) => ({
      type: 'life.day', source: 'life', senderKey: 'life', ts: nowDate.toISOString(),
      text: item.spec.render().text, origin: 'external', cursor, meta: item.spec.meta,
    });

    // discarded 只释放本次 attempt；旧票据随后即使迟到 delivered 也不能消费额度
    const discardedEnvelope = dayEnvelope(retryDayItem, 99);
    world.onEventsSettled([discardedEnvelope], 'discarded');
    world.onEventsSettled([discardedEnvelope], 'delivered');
    assert.equal(world.state.nagged['day:work'], undefined);

    // 再次入队并真实投递：仅这张新 attempt 能提交 nagged['day:work'] 并落盘
    world.state.updatedAt = new Date(nowDate.getTime() - 3600_000).toISOString();
    deferred.length = 0;
    await world.tick();
    const deliveredDayItem = deferred.find((d) => d.spec.type === 'life.day');
    assert.ok(deliveredDayItem);
    world.onEventsSettled([dayEnvelope(deliveredDayItem, 100)], 'delivered');
    assert.equal(world.state.nagged['day:work'], today);
    const savedOnDisk = new StateStore(dir).load().state;
    assert.equal(savedOnDisk.nagged['day:work'], today);

    await world.stop();
  } finally {
    cleanupDir(dir);
  }
});

test('第三轮复审（L2/L4/L11/L12/L13/L14/L15/L16）：重试发件箱、睡眠严重级别、applyAct透传、原子回滚与落盘告警', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-r3-'));
  let nowDate = new Date('2026-11-19T02:00:00Z'); // 当地 10:00 白天窗口
  try {
    // 1. L2 旧宿主（仅 pushEvent 无 pushDeferred）：pushEvent 成功后明确假定 delivered，立即消费当日额度
    const legacyDir = join(dir, 'legacy');
    mkdirSync(legacyDir, { recursive: true });
    const legacyPushed = [];
    const worldLegacy = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true },
      dataDir: legacyDir,
      botName: '大肥鱼',
      now: () => nowDate,
    });
    await worldLegacy.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => {
        const env = { ...e, cursor: legacyPushed.length + 1 };
        legacyPushed.push(env);
        return env;
      },
      store: {},
      drainPendingEvents: async () => [],
    });
    worldLegacy.state.updatedAt = new Date(nowDate.getTime() - 2 * 3600_000).toISOString();
    worldLegacy.state.vitals = { food: 80, energy: 80, clean: 80, fun: 80, social: 80 };
    worldLegacy.state.conditions = [];
    worldLegacy.state.asleepFrom = '';
    worldLegacy.state.asleepUntil = '';
    worldLegacy.state.activity = null;
    worldLegacy.state.job.lastAt = '';
    await worldLegacy.tick();
    assert.ok(legacyPushed.some((e) => e.type === 'life.day'), 'L2: 旧宿主应推即时 life.day');
    const legacyDay = legacyPushed.find((e) => e.type === 'life.day');
    assert.equal(worldLegacy.state.nagged['day:work'], localDateKey(nowDate), 'L2: 旧宿主 pushEvent 成功后按假定 delivered 消费额度');
    assert.equal(worldLegacy.deliveryAttempts.has(legacyDay.meta.lifeAttempt), false, '旧宿主不得遗留在途闩锁');
    worldLegacy.onEventsSettled([legacyDay], 'discarded');
    assert.equal(worldLegacy.state.nagged['day:work'], localDateKey(nowDate), '旧宿主迟到的伪回执不得撤销已完成的降级提交');
    await worldLegacy.stop();

    // 2. L4/L11/L12/L16：病愈/越线/睡眠严重级别/delivered 后 store.save 失败告警重试
    const d2 = join(dir, 'retry');
    mkdirSync(d2, { recursive: true });
    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true },
      dataDir: d2,
      botName: '大肥鱼',
      now: () => nowDate,
    });
    const sent = [];
    const deferred = [];
    const warns = [];
    let failPush = false;
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn: (m) => warns.push(String(m)), error() {} },
      pushEvent: async (e, opts) => {
        if (failPush) throw new Error('network down');
        const env = { ...e, cursor: sent.length + 1, opts };
        sent.push(env);
        return env;
      },
      pushDeferred: (spec, opts) => { deferred.push({ spec, opts }); },
      store: {},
      drainPendingEvents: async () => [],
    });

    // 2a. L11: 病愈首次推送失败（conditions 已被 advance 消费）-> 第二次 settleBeforeTool 恰补发 1 次 -> 第三次不再重发
    world.state.conditions = [{
      id: 'cold',
      text: '受凉了',
      since: new Date(nowDate.getTime() - 25 * 3600_000).toISOString(),
      until: new Date(nowDate.getTime() - 10 * 60_000).toISOString(),
    }];
    world.state.vitals = { food: 80, energy: 80, clean: 80, fun: 80, social: 80 };
    world.state.updatedAt = new Date(nowDate.getTime() - 3600_000).toISOString();
    failPush = true;
    await world.settleBeforeTool(nowDate);
    assert.equal(world.state.conditions.length, 0);
    assert.equal(sent.filter((e) => e.type === 'life.recovered').length, 0, '首次推送失败不应计数');
    failPush = false;
    await world.settleBeforeTool(nowDate);
    assert.equal(sent.filter((e) => e.type === 'life.recovered').length, 1, 'L11: 第二次应恰好补发 1 次');
    await world.settleBeforeTool(nowDate);
    assert.equal(sent.filter((e) => e.type === 'life.recovered').length, 1, 'L11: 第三次绝不重复发送');

    // 2a-ext. L11: caught / crossed / woke(hungry) 同样走 outbox，首次失败 -> 二次恰好 1 次 -> 三次不重发
    sent.length = 0;
    failPush = true;
    await world.settleAdvanceEffects({
      hours: 1,
      crossed: ['social'],
      critical: [],
      bottomed: [],
      caught: [{ id: 'cold2', text: '晚上有点着凉' }],
      recovered: [],
      woke: { reason: 'hungry', hours: 5 },
      completed: [],
    }, nowDate);
    world.state.vitals.social = 20;
    await world.settleAdvanceEffects({
      hours: 0,
      crossed: ['social'],
      critical: [],
      bottomed: [],
      caught: [],
      recovered: [],
      woke: false,
      completed: [],
    }, nowDate);
    assert.equal(sent.length, 0);
    failPush = false;
    await world.settleBeforeTool(nowDate);
    assert.equal(sent.filter((e) => e.type === 'life.sick').length, 1, 'L11: caught 应恰好补发 1 次');
    assert.equal(sent.filter((e) => e.text.includes('饿醒了')).length, 1, 'L11: hungry wake 应恰好补发 1 次');
    assert.equal(sent.filter((e) => e.type === 'life.low' && !e.text.includes('饿醒了')).length, 1, 'L11: crossed 应恰好补发 1 次');
    await world.settleBeforeTool(nowDate);
    assert.equal(sent.filter((e) => e.type === 'life.sick').length, 1, 'L11: caught 第三次不重发');
    assert.equal(sent.filter((e) => e.text.includes('饿醒了')).length, 1, 'L11: hungry wake 第三次不重发');

    // 2b. L12: 睡眠期间 critical/bottomed 保留各自严重级别；醒来推送失败可重试且使用 flush 级别与 crit:/zero: 独立额度
    sent.length = 0;
    world.state.asleepFrom = new Date(nowDate.getTime() - 60_000).toISOString();
    world.state.asleepUntil = new Date(nowDate.getTime() + 3600_000).toISOString();
    world.state.vitals = { food: 0, energy: 80, clean: 5, fun: 80, social: 80 };
    await world.flushCrossed({ hours: 1, crossed: [], critical: ['clean'], bottomed: ['food'], caught: [], recovered: [], woken: false }, nowDate);
    assert.deepEqual(world.state.deferredBottomed, ['food']);
    assert.deepEqual(world.state.deferredCritical, ['clean']);

    world.state.asleepFrom = '';
    world.state.asleepUntil = '';
    failPush = true;
    await world.flushCrossed({ hours: 0, crossed: [], critical: [], bottomed: [], caught: [], recovered: [], woken: false }, nowDate);
    assert.equal(sent.length, 0);
    assert.deepEqual(world.state.deferredBottomed, ['food'], '失败时必须保住 bottomed 等级不降级');
    assert.deepEqual(world.state.deferredCritical, ['clean'], '失败时必须保住 critical 等级不降级');
    failPush = false;
    await world.settleBeforeTool(nowDate);
    const botEv = sent.find((e) => e.text.includes('见底了'));
    const critEv = sent.find((e) => e.text.includes('很缺了'));
    assert.ok(botEv && botEv.opts.trigger === 'flush', 'L12: 见底唤醒必须保持 flush 级');
    assert.ok(critEv && critEv.opts.trigger === 'flush', 'L12: 紧急唤醒必须保持 flush 级');
    assert.equal(world.state.nagged['zero:food'], undefined, 'accepted 尚不能消费 zero 额度');
    assert.equal(world.state.nagged['crit:clean'], undefined, 'accepted 尚不能消费 crit 额度');
    world.onEventsSettled([botEv, critEv], 'delivered');
    assert.ok(world.state.nagged['zero:food'] && world.state.nagged['crit:clean'], 'L12: delivered 后使用独立额度键');

    // 2c. L16: delivered 后 store.save 抛错必须记录告警，且下一跳补存成功
    const realSave = world.store.save.bind(world.store);
    let saveShouldThrow = true;
    world.store.save = () => {
      if (saveShouldThrow) throw new Error('disk full');
      return realSave(world.state);
    };
    world.state.updatedAt = new Date(nowDate.getTime() - 3600_000).toISOString();
    world.state.vitals = { food: 80, energy: 80, clean: 80, fun: 80, social: 80 };
    world.state.conditions = [];
    world.state.asleepFrom = '';
    world.state.asleepUntil = '';
    world.state.activity = null;
    world.state.job.lastAt = '';
    deferred.length = 0;
    await world.tick();
    const deliveredDay = deferred.find((d) => d.spec.type === 'life.day');
    assert.ok(deliveredDay, 'L16: 应先取得真实 day attempt');
    const renderedDay = deliveredDay.spec.render();
    world.onEventsSettled([{
      type: 'life.day', source: 'life', senderKey: 'life', ts: nowDate.toISOString(),
      text: renderedDay.text, origin: 'external', cursor: 55, meta: deliveredDay.spec.meta,
    }], 'delivered');
    assert.ok(warns.some((w) => /投递后状态落盘失败.*disk full/.test(w)), 'L16: delivered 保存失败必须打告警');
    saveShouldThrow = false;
    await world.tick();
    const afterRetry = new StateStore(d2).load().state;
    assert.equal(afterRetry.nagged['day:work'], localDateKey(nowDate), 'L16: 下一跳应补存 delivered 额度');

    // 3. L13: 直接调用 state.applyAct('wake'/'cancel') 返回 advanced，不静默丢弃推进结果
    const stAct = freshState(nowDate);
    stAct.asleepFrom = new Date(nowDate.getTime() - 2 * 3600_000).toISOString();
    stAct.asleepUntil = new Date(nowDate.getTime() + 6 * 3600_000).toISOString();
    stAct.updatedAt = new Date(nowDate.getTime() - 2 * 3600_000).toISOString();
    const wakeRes = applyAct(stAct, 'wake', nowDate);
    assert.equal(wakeRes.ok, true);
    assert.ok(wakeRes.advanced && wakeRes.advanced.hours > 0, 'L13: wake 应返回 advanced');

    // 4. L14 & L15: life.state.clear 与 life.library.clear 遇到公开快照写阻塞时均抛错并回滚原盘面，不遗留 tmp
    const pubBlocker = join(d2, 'life-public.json');
    const stFile = join(d2, 'life-state.json');
    const stBak = `${stFile}.bak`;
    const libCfg = join(d2, 'image-library-settings.json');
    writeFileSync(stFile, JSON.stringify({ ...world.state, money: { ...world.state.money, cash: 4321 } }), 'utf8');
    writeFileSync(stBak, JSON.stringify({ ...world.state, money: { ...world.state.money, cash: 4320 } }), 'utf8');
    writeFileSync(libCfg, JSON.stringify({ policy: 'active', cooldownMin: 15 }), 'utf8');
    if (existsSync(pubBlocker)) rmSync(pubBlocker, { recursive: true, force: true });
    mkdirSync(join(pubBlocker, 'lockdir'), { recursive: true });
    writeFileSync(join(pubBlocker, 'lockdir', 'x.txt'), '1', 'utf8');

    const storage = world.webUi().storage;
    const statePart = storage.find((p) => p.key === 'life.state');
    const libPart = storage.find((p) => p.key === 'life.library');
    const origCash = world.state.money.cash;
    assert.throws(() => statePart.clear(), 'L14: 公开快照写入失败时 state.clear 必须抛错');
    assert.equal(world.state.money.cash, origCash, 'L14: 抛错后内存态必须回滚');
    assert.equal(existsSync(stFile), true, 'L14: 抛错后原有主档必须回滚保留');
    assert.equal(existsSync(stBak), true, 'L14: 抛错后原有 .bak 备份必须同步回滚保留');
    assert.equal(existsSync(`${pubBlocker}.tmp-${process.pid}`), false, 'L14: 不得遗留 tmp 文件');

    assert.throws(() => libPart.clear(), 'L15: 公开快照写入失败时 library.clear 必须抛错');
    assert.equal(existsSync(libCfg), true, 'L15: 抛错后原有策略配置文件必须回滚保留');

    await world.stop();
  } finally {
    cleanupDir(dir);
  }
});

test('第四轮 L11/L12：accepted→discarded 恢复原 outbox/严重级别，下轮恰补一次且旧回执不串账', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-r4-delivery-'));
  const nowDate = new Date('2026-11-19T02:00:00Z');
  const sent = [];
  let cursor = 0;
  const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼', now: () => nowDate });
  try {
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e, opts) => {
        const env = { ...e, opts, cursor: ++cursor };
        sent.push(env);
        return env;
      },
      pushDeferred: (_spec, _opts) => {},
      store: {},
      drainPendingEvents: async () => [],
    });
    world.state.conditions = [{
      id: 'cold', text: '受凉了',
      since: new Date(nowDate.getTime() - 25 * 3600_000).toISOString(),
      until: new Date(nowDate.getTime() - 10 * 60_000).toISOString(),
    }];
    world.state.vitals = { food: 80, energy: 80, clean: 80, fun: 80, social: 80 };
    world.state.updatedAt = new Date(nowDate.getTime() - 3600_000).toISOString();

    await world.settleBeforeTool(nowDate);
    const recovered = sent.filter((e) => e.type === 'life.recovered');
    assert.equal(recovered.length, 1);
    assert.equal(world.state.pendingNotices.length, 1, 'accepted 后 outbox 必须仍在');
    world.onEventsSettled([recovered[0]], 'discarded');
    assert.equal(world.state.pendingNotices.length, 1, 'discarded 必须恢复待发');

    await world.settleBeforeTool(nowDate);
    await world.settleBeforeTool(nowDate);
    assert.equal(sent.filter((e) => e.type === 'life.recovered').length, 2, '下轮只补一次，在途期间不重复');
    const recovered2 = sent.filter((e) => e.type === 'life.recovered')[1];
    assert.notEqual(recovered2.meta.lifeAttempt, recovered[0].meta.lifeAttempt);
    world.onEventsSettled([recovered[0]], 'delivered');
    assert.equal(world.state.pendingNotices.length, 1, '旧 discarded 回执不得清除新 attempt');
    world.onEventsSettled([{ ...recovered2, cursor: 999999 }], 'delivered');
    assert.equal(world.state.pendingNotices.length, 1, 'cursor 不匹配不得出队');
    world.onEventsSettled([recovered2], 'delivered');
    assert.equal(world.state.pendingNotices.length, 0);
    await world.settleBeforeTool(nowDate);
    assert.equal(sent.filter((e) => e.type === 'life.recovered').length, 2, 'delivered 后不得再补发');

    sent.length = 0;
    world.state.vitals = { food: 0, energy: 80, clean: 5, fun: 80, social: 80 };
    await world.reportCrossed([], nowDate, ['food'], ['clean']);
    const bot1 = sent.find((e) => e.text.includes('见底了'));
    const crit1 = sent.find((e) => e.text.includes('很缺了'));
    assert.ok(bot1 && crit1);
    assert.deepEqual(world.state.deferredBottomed, ['food']);
    assert.deepEqual(world.state.deferredCritical, ['clean']);
    assert.equal(world.state.nagged['zero:food'], undefined);
    assert.equal(world.state.nagged['crit:clean'], undefined);
    world.onEventsSettled([bot1, crit1], 'discarded');
    assert.deepEqual(world.state.deferredBottomed, ['food'], 'discarded 保留 bottomed 等级');
    assert.deepEqual(world.state.deferredCritical, ['clean'], 'discarded 保留 critical 等级');

    await world.settleBeforeTool(nowDate);
    const bot2 = sent.filter((e) => e.text.includes('见底了'))[1];
    const crit2 = sent.filter((e) => e.text.includes('很缺了'))[1];
    assert.ok(bot2 && crit2, '两类严重事件下一轮各恰补一次');
    world.onEventsSettled([bot2, crit2], 'delivered');
    assert.deepEqual(world.state.deferredBottomed, []);
    assert.deepEqual(world.state.deferredCritical, []);
    assert.equal(world.state.nagged['zero:food'], '2026-11-19');
    assert.equal(world.state.nagged['crit:clean'], '2026-11-19');
    await world.settleBeforeTool(nowDate);
    assert.equal(sent.filter((e) => e.text.includes('见底了')).length, 2);
    assert.equal(sent.filter((e) => e.text.includes('很缺了')).length, 2);
    await world.stop();
  } finally {
    cleanupDir(dir);
  }
});

test('第四轮 L17：life.day 跨日乱序不消费新日额度，旧宿主成功即结清闩锁', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-r4-day-'));
  let nowDate = new Date('2026-11-19T02:00:00Z');
  const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼', now: () => nowDate });
  const deferred = [];
  const envelope = (item, cursor) => ({
    type: 'life.day', source: 'life', senderKey: 'life', ts: nowDate.toISOString(),
    text: 'day', origin: 'external', cursor, meta: item.spec.meta,
  });
  const prime = (w) => {
    w.state.updatedAt = new Date(nowDate.getTime() - 3600_000).toISOString();
    w.state.vitals = { food: 80, energy: 80, clean: 80, fun: 80, social: 80 };
    w.state.conditions = [];
    w.state.asleepFrom = '';
    w.state.asleepUntil = '';
    w.state.activity = null;
    w.state.job.lastAt = '';
  };
  try {
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => e,
      pushDeferred: (spec, opts) => { deferred.push({ spec, opts }); },
      store: {}, drainPendingEvents: async () => [],
    });
    prime(world);
    await world.tick();
    const yesterday = deferred.find((d) => d.spec.type === 'life.day');
    assert.ok(yesterday);
    yesterday.spec.render();

    nowDate = new Date('2026-11-20T02:00:00Z');
    prime(world);
    await world.tick();
    const today = deferred.filter((d) => d.spec.type === 'life.day')[1];
    assert.ok(today, '新的一天应使用新的 attempt');
    const todayAttempt = today.spec.meta.lifeAttempt;
    world.onEventsSettled([envelope(yesterday, 1)], 'delivered');
    assert.equal(world.state.nagged['day:work'], undefined, '昨天回执不得消费今天额度');
    assert.equal(world.dayWorkPending.id, todayAttempt, '昨天回执不得清掉今天在途占位');

    world.onEventsSettled([envelope(today, 2)], 'discarded');
    world.onEventsSettled([envelope(today, 2)], 'delivered');
    assert.equal(world.state.nagged['day:work'], undefined, 'discarded 后的迟到 delivered 必须忽略');
    prime(world);
    await world.tick();
    const retry = deferred.filter((d) => d.spec.type === 'life.day')[2];
    world.onEventsSettled([envelope(retry, 3)], 'delivered');
    assert.equal(world.state.nagged['day:work'], '2026-11-20');
    await world.stop();

    const legacyDir = join(dir, 'legacy');
    mkdirSync(legacyDir, { recursive: true });
    const legacySent = [];
    const legacy = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: legacyDir, botName: '大肥鱼', now: () => nowDate });
    await legacy.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => { const env = { ...e, cursor: legacySent.length + 1 }; legacySent.push(env); return env; },
      store: {}, drainPendingEvents: async () => [],
    });
    prime(legacy);
    await legacy.tick();
    const legacy1 = legacySent.find((e) => e.type === 'life.day');
    assert.ok(legacy1);
    assert.equal(legacy.state.nagged['day:work'], '2026-11-20', '旧宿主 pushEvent 成功后立即假定 delivered');
    assert.equal(legacy.dayWorkPending, null, '旧宿主成功后不得残留日提醒闩锁');
    prime(legacy);
    await legacy.tick();
    const legacyDays = legacySent.filter((e) => e.type === 'life.day');
    assert.equal(legacyDays.length, 1, '无 settled 的旧宿主也不得每 tick 重发');
    legacy.onEventsSettled([legacyDays[0]], 'discarded');
    assert.equal(legacy.state.nagged['day:work'], '2026-11-20', '降级提交后迟到回执不得回退额度');
    await legacy.stop();
  } finally {
    cleanupDir(dir);
  }
});

test('第四轮 L18：两个并发 settleBeforeTool 共享单飞，同一病愈只接受一次', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-r4-singleflight-'));
  const nowDate = new Date('2026-11-19T02:00:00Z');
  const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼', now: () => nowDate });
  const sent = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  try {
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => {
        if (e.type === 'life.recovered') await gate;
        const env = { ...e, cursor: sent.length + 1 };
        sent.push(env);
        return env;
      },
      pushDeferred: (_spec, _opts) => {}, store: {}, drainPendingEvents: async () => [],
    });
    world.state.conditions = [{
      id: 'cold', text: '受凉了',
      since: new Date(nowDate.getTime() - 25 * 3600_000).toISOString(),
      until: new Date(nowDate.getTime() - 10 * 60_000).toISOString(),
    }];
    world.state.updatedAt = new Date(nowDate.getTime() - 3600_000).toISOString();
    const first = world.settleBeforeTool(nowDate);
    const second = world.settleBeforeTool(nowDate);
    release();
    await Promise.all([first, second]);
    assert.equal(sent.filter((e) => e.type === 'life.recovered').length, 1);
    world.onEventsSettled([sent.find((e) => e.type === 'life.recovered')], 'delivered');
    await Promise.all([world.settleBeforeTool(nowDate), world.settleBeforeTool(nowDate)]);
    assert.equal(sent.filter((e) => e.type === 'life.recovered').length, 1);
    await world.stop();
  } finally {
    cleanupDir(dir);
  }
});

test('第四轮 L19：clear 使在途 AdvanceResult 失效，恢复后不得保存、广播或提交到新状态', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-r4-clear-inflight-'));
  const nowDate = new Date('2026-11-19T02:00:00Z');
  const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼', now: () => nowDate });
  const sent = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  try {
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => {
        if (e.type === 'life.recovered') await gate;
        const env = { ...e, cursor: sent.length + 1 };
        sent.push(env);
        return env;
      },
      pushDeferred: (_spec, _opts) => {}, store: {}, drainPendingEvents: async () => [],
    });
    world.state.conditions = [{
      id: 'cold', text: '受凉了',
      since: new Date(nowDate.getTime() - 25 * 3600_000).toISOString(),
      until: new Date(nowDate.getTime() - 10 * 60_000).toISOString(),
    }];
    world.state.money.cash = 8765;
    world.state.updatedAt = new Date(nowDate.getTime() - 3600_000).toISOString();
    const inflight = world.tick();
    await Promise.resolve();
    const realSave = world.store.save.bind(world.store);
    const realBroadcast = world.broadcastLife.bind(world);
    let saves = 0;
    let broadcasts = 0;
    world.store.save = (...args) => { saves++; return realSave(...args); };
    world.broadcastLife = (...args) => { broadcasts++; return realBroadcast(...args); };

    const statePart = world.webUi().storage.find((p) => p.key === 'life.state');
    statePart.clear();
    assert.equal(broadcasts, 1, 'clear 自身只广播新快照一次');
    release();
    await inflight;
    world.onEventsSettled([sent.find((e) => e.type === 'life.recovered')], 'delivered');
    assert.equal(saves, 0, '旧 tick 与旧回执不得保存新状态');
    assert.equal(broadcasts, 1, '旧 tick 恢复后不得再次广播');
    assert.equal(existsSync(join(dir, 'life-state.json')), false, 'clear 后旧状态文件不得复活');
    const pub = JSON.parse(readFileSync(join(dir, 'life-public.json'), 'utf8'));
    assert.notEqual(pub.ledger.cash, 8765);
    await world.stop();
  } finally {
    cleanupDir(dir);
  }
});

test('第四轮 L16：stop() 保存失败保留内存与宿主句柄并抛错，重试可补存', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-r4-stop-'));
  const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼' });
  const warns = [];
  try {
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn: (m) => warns.push(String(m)), error() {} },
      pushEvent: async (e) => e, pushDeferred: (_spec, _opts) => {}, store: {}, drainPendingEvents: async () => [],
    });
    world.state.money.cash = 6543;
    const realSave = world.store.save.bind(world.store);
    world.store.save = () => { throw new Error('stop disk full'); };
    await assert.rejects(world.stop(), /stop disk full/);
    assert.equal(world.stateSaveDirty, true);
    assert.ok(world.host && world.log, 'stop 失败后必须保留可重试的宿主与日志句柄');
    assert.equal(world.state.money.cash, 6543, '内存状态不得被丢弃');
    assert.ok(warns.some((w) => /stop\(\) 存档失败.*可重试/.test(w)));

    world.store.save = realSave;
    await world.stop();
    assert.equal(world.stateSaveDirty, false);
    assert.equal(world.host, null);
    assert.equal(new StateStore(dir).load().state.money.cash, 6543, '第二次 stop 必须把同一状态补存到磁盘');
  } finally {
    cleanupDir(dir);
  }
});

test('第四轮 L14：公开快照失败后的回滚写失败以 AggregateError 明示，内存仍可恢复', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-r4-rollback-'));
  const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼' });
  const originalWrite = fs.writeFileSync;
  try {
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => e, pushDeferred: (_spec, _opts) => {}, store: {}, drainPendingEvents: async () => [],
    });
    const file = join(dir, 'life-state.json');
    world.store.save(world.state);
    world.state.money.cash = 7654;
    world.store.save(world.state);
    const previousState = world.state;
    world.broadcastLife = () => { throw new Error('mock public snapshot failure'); };
    fs.writeFileSync = (path, ...args) => {
      if (String(path).includes('.rollback-')) throw new Error('mock rollback write failure');
      return originalWrite(path, ...args);
    };
    syncBuiltinESMExports();

    let failure;
    try { world.webUi().storage.find((p) => p.key === 'life.state').clear(); } catch (e) { failure = e; }
    assert.ok(failure instanceof AggregateError, '原错与回滚错必须一起抛出，不能吞回滚写失败');
    assert.equal(failure.errors.length, 3, '公开快照原错 + 主档/备份两个回滚错');
    assert.match(failure.message, /回滚未完整恢复/);
    assert.equal(world.state, previousState, '即使磁盘回滚失败，内存旧对象也不能丢');
    assert.equal(existsSync(file), false, '测试已确认回滚写故障不是假成功');
  } finally {
    fs.writeFileSync = originalWrite;
    syncBuiltinESMExports();
    await world.stop();
    cleanupDir(dir);
  }
});

test('第四轮 L20：工具与面板策略写入遇广播故障均回滚，恢复后严格成功', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-r4-policy-'));
  const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼' });
  try {
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => e, pushDeferred: (_spec, _opts) => {}, store: {}, drainPendingEvents: async () => [],
    });
    const settingsFile = join(dir, 'image-library-settings.json');
    world.library.saveSettings({ policy: 'active', cooldownMin: 15 });
    const before = readFileSync(settingsFile, 'utf8');
    const pub = join(dir, 'life-public.json');
    rmSync(pub, { force: true });
    mkdirSync(join(pub, 'blocker'), { recursive: true });
    writeFileSync(join(pub, 'blocker', 'keep.txt'), 'x');

    const libraryTool = world.tools().find((t) => t.name === 'life_library');
    await assert.rejects(libraryTool.handler({ action: 'policy', policy: 'off', cooldownMin: 5 }));
    assert.equal(readFileSync(settingsFile, 'utf8'), before, '工具策略写入必须随广播失败回滚');
    await assert.rejects(world.webUi().invoke('library', 'savePolicy', [{ policy: 'off', cooldownMin: 5 }]));
    assert.equal(readFileSync(settingsFile, 'utf8'), before, '面板策略写入必须走同一 strict 事务');
    assert.equal(world.library.getSettings().policy, 'active');
    assert.equal(existsSync(`${pub}.tmp-${process.pid}`), false);

    rmSync(pub, { recursive: true, force: true });
    const ok = await libraryTool.handler({ action: 'policy', policy: 'off', cooldownMin: 5 });
    assert.match(ok.text, /off.*5/);
    const publicNow = JSON.parse(readFileSync(pub, 'utf8'));
    assert.equal(publicNow.imagePolicy.policy, 'off');
    assert.equal(publicNow.imagePolicy.cooldownMin, 5);
    await world.stop();
  } finally {
    cleanupDir(dir);
  }
});

test('第四轮 L21：双目录日记删除中途失败会回滚，缓存 finally 失效，重试可全部清理', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-r4-diary-'));
  const custom = join(dir, 'custom-diary');
  const local = join(dir, 'life-diary');
  const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true, diaryDir: custom }, dataDir: dir, botName: '大肥鱼' });
  const originalUnlink = fs.unlinkSync;
  try {
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => e, pushDeferred: (_spec, _opts) => {}, store: {}, drainPendingEvents: async () => [],
    });
    world.diary.write({ dateKey: '2026-11-19', townName: '芦花塘', body: '自定义目录日记' });
    mkdirSync(join(custom, '_bak'), { recursive: true });
    writeFileSync(join(custom, '_bak', 'old.md'), 'backup');
    mkdirSync(local, { recursive: true });
    const localFile = join(local, '2026-10.md');
    writeFileSync(localFile, '---\ndate: 2026-10-01\ntown: 芦花塘\n---\n本机目录日记\n');
    assert.ok(world.diary.count() >= 2);

    fs.unlinkSync = (path) => {
      if (String(path) === localFile) throw new Error('injected unlink failure');
      return originalUnlink(path);
    };
    syncBuiltinESMExports();
    const diaryPart = world.webUi().storage.find((p) => p.key === 'life.diary');
    assert.throws(() => diaryPart.clear(), /injected unlink failure/);
    assert.equal(world.diary.cacheKey, '', '删除失败后缓存键必须在 finally 失效');
    assert.equal(world.diary.cache.size, 0, '删除失败后缓存正文必须清空');
    assert.equal(existsSync(join(custom, '2026-11.md')), true, '先删的自定义目录文件必须恢复');
    assert.equal(existsSync(join(custom, '_bak', 'old.md')), true, '先删的备份必须恢复');
    assert.equal(existsSync(localFile), true);
    assert.ok(world.diary.count() >= 2, '回滚后内存视图与磁盘一致');

    fs.unlinkSync = originalUnlink;
    syncBuiltinESMExports();
    const receipt = diaryPart.clear();
    assert.match(receipt, /已清理/);
    assert.equal(world.diary.count(), 0);
    assert.equal(existsSync(join(custom, '_bak')), false);
    await world.stop();
  } finally {
    fs.unlinkSync = originalUnlink;
    syncBuiltinESMExports();
    cleanupDir(dir);
  }
});

test('第五轮投递：旧宿主 pushEvent 成功后假定 delivered，notice/crossed/goal 不永久阻塞也不重发', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-r5-legacy-delivery-'));
  const nowDate = new Date('2026-11-19T02:00:00Z');
  const sent = [];
  const warns = [];
  const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼', now: () => nowDate });
  const effects = (extra = {}) => ({
    hours: 1, crossed: [], critical: [], bottomed: [], caught: [], recovered: [], woke: false, completed: [], ...extra,
  });
  try {
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn: (m) => warns.push(String(m)), error() {} },
      pushEvent: async (e) => {
        const env = { ...e, cursor: sent.length + 1 };
        sent.push(env);
        return env;
      },
      store: {}, drainPendingEvents: async () => [],
    });
    world.state.goals = [{ id: 'goal-1', what: '搬到老小区', need: 100, since: nowDate.toISOString() }];
    world.state.vitals = { food: 20, energy: 80, clean: 80, fun: 80, social: 80 };
    world.state.deferred = ['food'];

    await world.settleAdvanceEffects(effects({ recovered: [{ id: 'cold', text: '受凉了' }] }), nowDate);
    const today = localDateKey(nowDate);
    assert.equal(world.state.pendingNotices.length, 0, '旧宿主成功后 notice 必须出队');
    assert.deepEqual(world.state.deferred, [], '旧宿主成功后 crossed 必须结清');
    assert.equal(world.state.nagged.food, today);
    assert.equal(world.state.nagged['goal:goal-1'], today);
    assert.equal(world.deliveryAttempts.size, 0, '旧宿主不得遗留任何永久在途占位');
    assert.ok(sent.some((e) => e.type === 'life.recovered'));
    assert.ok(sent.some((e) => e.type === 'life.low'));
    assert.ok(sent.some((e) => e.type === 'life.goal'));
    assert.equal(warns.filter((w) => /假定 delivered/.test(w)).length, 3, '降级必须逐条明确记录');

    const count = sent.length;
    await world.settleAdvanceEffects(effects(), nowDate);
    assert.equal(sent.length, count, '下一轮不得因无 settled 重发同一批事件');
    const saved = new StateStore(dir).load().state;
    assert.equal(saved.nagged['goal:goal-1'], today);
    assert.equal(saved.pendingNotices.length, 0);
    await world.stop();
  } finally {
    cleanupDir(dir);
  }
});

test('第五轮投递：现代 life.goal 仅 delivered 写 nagged，discarded 与迟到回执不提交', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-r5-goal-delivery-'));
  const nowDate = new Date('2026-11-19T02:00:00Z');
  const sent = [];
  const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼', now: () => nowDate });
  const effects = { hours: 1, crossed: [], critical: [], bottomed: [], caught: [], recovered: [], woke: false, completed: [] };
  try {
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => {
        const env = { ...e, cursor: sent.length + 1 };
        sent.push(env);
        return env;
      },
      pushDeferred: (_spec, _opts) => {}, store: {}, drainPendingEvents: async () => [],
    });
    world.state.goals = [{ id: 'goal-1', what: '搬到老小区', need: 100, since: nowDate.toISOString() }];

    await world.settleAdvanceEffects(effects, nowDate);
    const first = sent.find((e) => e.type === 'life.goal');
    assert.ok(first);
    assert.equal(world.state.nagged['goal:goal-1'], undefined, 'accepted 不得写 nagged');
    world.onEventsSettled([first], 'discarded');
    assert.equal(world.state.nagged['goal:goal-1'], undefined, 'discarded 不得写 nagged');

    await world.settleAdvanceEffects(effects, nowDate);
    const goals = sent.filter((e) => e.type === 'life.goal');
    assert.equal(goals.length, 2, 'discarded 后下一轮应恰好补发一次');
    const second = goals[1];
    assert.notEqual(second.meta.lifeAttempt, first.meta.lifeAttempt);
    world.onEventsSettled([first], 'delivered');
    assert.equal(world.state.nagged['goal:goal-1'], undefined, '旧 discarded 回执迟到 delivered 不得提交');
    assert.equal(world.deliveryAttempts.has(second.meta.lifeAttempt), true, '旧回执不得清掉新 attempt');

    world.onEventsSettled([second], 'delivered');
    assert.equal(world.state.nagged['goal:goal-1'], localDateKey(nowDate));
    await world.settleAdvanceEffects(effects, nowDate);
    assert.equal(sent.filter((e) => e.type === 'life.goal').length, 2, 'delivered 后不得再发');
    await world.stop();
  } finally {
    cleanupDir(dir);
  }
});

test('第五轮代次：settleFlight 等待者与发起者在 clear 后都拒绝旧结算', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-r5-settle-clear-'));
  const nowDate = new Date('2026-11-19T02:00:00Z');
  const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼', now: () => nowDate });
  const sent = [];
  let release;
  let markInflight;
  const gate = new Promise((resolve) => { release = resolve; });
  const inflight = new Promise((resolve) => { markInflight = resolve; });
  try {
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => {
        if (e.type === 'life.recovered') {
          markInflight();
          await gate;
        }
        const env = { ...e, cursor: sent.length + 1 };
        sent.push(env);
        return env;
      },
      pushDeferred: (_spec, _opts) => {}, store: {}, drainPendingEvents: async () => [],
    });
    world.state.conditions = [{
      id: 'cold', text: '受凉了',
      since: new Date(nowDate.getTime() - 25 * 3600_000).toISOString(),
      until: new Date(nowDate.getTime() - 10 * 60_000).toISOString(),
    }];
    world.state.updatedAt = new Date(nowDate.getTime() - 3600_000).toISOString();

    const first = world.settleBeforeTool(nowDate);
    const second = world.settleBeforeTool(nowDate);
    await inflight;
    const firstRejected = assert.rejects(first, /生活档案已清理/);
    const secondRejected = assert.rejects(second, /生活档案已清理/);
    world.webUi().storage.find((p) => p.key === 'life.state').clear();
    release();
    await Promise.all([firstRejected, secondRejected]);

    world.onEventsSettled([sent.find((e) => e.type === 'life.recovered')], 'delivered');
    assert.deepEqual(world.state.pendingNotices, [], '旧回执不得写入清理后的新档');
    assert.equal(existsSync(join(dir, 'life-state.json')), false, '两个旧等待者都不得保存新档');
    await world.stop();
  } finally {
    cleanupDir(dir);
  }
});

test('第五轮代次：life_buy 在 stalls/buy 两个外部 await 中 clear 都不扣新档、不写账不 save', async () => {
  const root = mkdtempSync(join(tmpdir(), 'life-r5-buy-clear-'));
  const originalFetch = globalThis.fetch;
  const stall = { id: 'stall-1', item: '莲藕', price: 12, seller: '早市摊主', stock: 3 };
  const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  try {
    const dir1 = join(root, 'stalls');
    mkdirSync(dir1, { recursive: true });
    const world1 = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true, townUrl: 'https://town.invalid' }, dataDir: dir1, botName: '大肥鱼' });
    world1.state.money.cash = 500;
    world1.store.save(world1.state);
    let releaseStalls;
    let markStalls;
    let buyCalls1 = 0;
    const stallsGate = new Promise((resolve) => { releaseStalls = resolve; });
    const stallsStarted = new Promise((resolve) => { markStalls = resolve; });
    globalThis.fetch = async (input) => {
      const url = String(input instanceof URL ? input : input?.url ?? input);
      if (url.endsWith('/town/stalls')) {
        markStalls();
        await stallsGate;
        return response({ stalls: [stall] });
      }
      if (url.endsWith('/town/buy')) {
        buyCalls1++;
        return response({ ok: true, item: stall.item, price: stall.price, seller: stall.seller });
      }
      throw new Error(`未打桩 URL：${url}`);
    };
    const pending1 = world1.tools().find((t) => t.name === 'life_buy').handler({ stall_id: stall.id });
    await stallsStarted;
    world1.webUi().storage.find((p) => p.key === 'life.state').clear();
    releaseStalls();
    const result1 = await pending1;
    assert.match(result1.text, /旧购买操作已停止/);
    assert.equal(buyCalls1, 0, 'stalls 返回后发现换代，不得继续调用 buy');
    assert.equal(world1.state.money.cash, 3000);
    assert.equal(existsSync(join(dir1, 'life-state.json')), false);
    assert.equal(existsSync(join(dir1, 'life-ledger.jsonl')), false);
    await world1.stop();

    const dir2 = join(root, 'buy');
    mkdirSync(dir2, { recursive: true });
    const world2 = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true, townUrl: 'https://town.invalid' }, dataDir: dir2, botName: '大肥鱼' });
    world2.state.money.cash = 500;
    world2.store.save(world2.state);
    let releaseBuy;
    let markBuy;
    let buyCalls2 = 0;
    const buyGate = new Promise((resolve) => { releaseBuy = resolve; });
    const buyStarted = new Promise((resolve) => { markBuy = resolve; });
    globalThis.fetch = async (input) => {
      const url = String(input instanceof URL ? input : input?.url ?? input);
      if (url.endsWith('/town/stalls')) return response({ stalls: [stall] });
      if (url.endsWith('/town/buy')) {
        buyCalls2++;
        markBuy();
        await buyGate;
        return response({ ok: true, item: stall.item, price: stall.price, seller: stall.seller });
      }
      throw new Error(`未打桩 URL：${url}`);
    };
    const pending2 = world2.tools().find((t) => t.name === 'life_buy').handler({ stall_id: stall.id });
    await buyStarted;
    world2.webUi().storage.find((p) => p.key === 'life.state').clear();
    releaseBuy();
    const result2 = await pending2;
    assert.match(result2.text, /旧购买操作已停止/);
    assert.equal(buyCalls2, 1);
    assert.equal(world2.state.money.cash, 3000, '远端 buy 返回后也不得扣清理后的新档');
    assert.equal(world2.state.money.spent, 0);
    assert.equal(existsSync(join(dir2, 'life-state.json')), false, '旧 buy 不得 save 复活主档');
    assert.equal(existsSync(join(dir2, 'life-ledger.jsonl')), false, '旧 buy 不得写新账本');
    await world2.stop();
  } finally {
    globalThis.fetch = originalFetch;
    cleanupDir(root);
  }
});

test('第五轮投递：两个实例同序号回执不串，attempt id 跨实例唯一', async () => {
  const root = mkdtempSync(join(tmpdir(), 'life-r5-attempt-id-'));
  const quiet = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };
  const make = async (name) => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼' });
    const sent = [];
    world.log = quiet;
    world.host = {
      pushEvent: async (e) => {
        const env = { ...e, cursor: 1 };
        sent.push(env);
        return env;
      },
      pushDeferred: (_spec, _opts) => {},
    };
    world.state.pendingNotices = [{ id: 'same-notice', type: 'life.sick', text: '同一条待发病愈通知', trigger: 'flush' }];
    await world.flushPendingNotices();
    return { world, sent };
  };
  try {
    const first = await make('first');
    const second = await make('second');
    const oldEnvelope = first.sent[0];
    const newEnvelope = second.sent[0];
    assert.equal(oldEnvelope.cursor, newEnvelope.cursor, '测试必须构造同 cursor 的旧回执');
    assert.notEqual(oldEnvelope.meta.lifeAttempt, newEnvelope.meta.lifeAttempt, 'attempt id 不得从相同序号跨实例复用');

    second.world.onEventsSettled([oldEnvelope], 'delivered');
    assert.equal(second.world.state.pendingNotices.length, 1, '旧实例回执不得清新实例 outbox');
    assert.equal(second.world.deliveryAttempts.size, 1, '旧实例回执不得清新实例 attempt');
    second.world.onEventsSettled([newEnvelope], 'delivered');
    assert.equal(second.world.state.pendingNotices.length, 0, '本实例真实回执仍应正常提交');
    first.world.onEventsSettled([oldEnvelope], 'delivered');
    assert.equal(first.world.state.pendingNotices.length, 0);
    await first.world.stop();
    await second.world.stop();
  } finally {
    cleanupDir(root);
  }
});

test('第六轮投递：life.day 已 render 后不按短 TTL 重发，discard 隔离旧回执且 delivered 只提交一次', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-r6-rendered-day-'));
  const nowDate = new Date('2026-11-19T02:00:00Z');
  const deferred = [];
  const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼', now: () => nowDate });
  const dayItems = () => deferred.filter((d) => d.spec.type === 'life.day');
  const envelope = (item, cursor) => ({
    type: 'life.day', source: 'life', senderKey: 'life', ts: nowDate.toISOString(),
    text: 'day', origin: 'external', cursor, meta: item.spec.meta,
  });
  const tick = async () => {
    world.state.updatedAt = new Date(nowDate.getTime() - 3600_000).toISOString();
    world.state.vitals = { food: 80, energy: 80, clean: 80, fun: 80, social: 80 };
    world.state.conditions = [];
    world.state.asleepFrom = '';
    world.state.asleepUntil = '';
    world.state.activity = null;
    world.state.job.lastAt = '';
    await world.tick();
  };
  try {
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => e,
      pushDeferred: (spec, opts) => { deferred.push({ spec, opts }); },
      store: {}, drainPendingEvents: async () => [],
    });

    await tick();
    const first = dayItems()[0];
    assert.ok(first, '首个白天提醒应入队');
    const firstId = first.spec.meta.lifeAttempt;
    assert.equal(world.state.nagged['day:work'], undefined, 'accepted 不得视为 delivered');
    assert.ok(first.spec.render()?.text, '首次 render 应产生真实提醒');

    // 不睡眠、不改业务日：把排队时刻拨到 1 小时前、render 时刻拨到 5 秒前，
    // 同时越过排队租约与原来的 2 秒窗口；已 render 的 attempt 不得被任何时间阈值回收。
    const firstAttempt = world.deliveryAttempts.get(firstId);
    firstAttempt.renderedAt = Date.now() - 5000;
    firstAttempt.acceptedAt = Date.now() - 3600_000;
    await tick();
    assert.equal(dayItems().length, 1, 'render 后超过任何短租约仍不得重新入队同一业务日提醒');
    assert.equal(world.dayWorkPending.id, firstId, '已 render 的在途 attempt 必须继续占位');
    assert.equal(world.state.nagged['day:work'], undefined, '等待真实 delivered 时不得提前消费额度');

    world.onEventsSettled([envelope(first, 1)], 'discarded');
    assert.equal(world.dayWorkPending, null, '明确 discarded 应立即释放旧 attempt');
    await tick();
    const second = dayItems()[1];
    assert.ok(second, 'discarded 后下一跳应允许新 attempt');
    const secondId = second.spec.meta.lifeAttempt;
    assert.notEqual(secondId, firstId);
    assert.ok(second.spec.render()?.text);

    world.onEventsSettled([envelope(first, 1)], 'delivered');
    assert.equal(world.state.nagged['day:work'], undefined, '旧 attempt 的迟到 delivered 不得提交');
    assert.equal(world.dayWorkPending.id, secondId, '旧回执不得清掉新 attempt 的占位');
    // deferred 游标由第一条权威回执绑定（见第四轮 L17）；绑定后，伪造的其他 cursor 不得结算。
    world.deliveryAttempts.get(secondId).cursor = 2;
    world.onEventsSettled([{ ...envelope(second, 2), cursor: 999 }], 'discarded');
    assert.equal(world.dayWorkPending.id, secondId, 'cursor 不匹配不得结算新 attempt');

    const realSave = world.store.save.bind(world.store);
    let deliveredSaves = 0;
    world.store.save = (...args) => { deliveredSaves++; return realSave(...args); };
    const finalEnvelope = envelope(second, 2);
    world.onEventsSettled([finalEnvelope], 'delivered');
    world.onEventsSettled([finalEnvelope], 'delivered');
    assert.equal(world.state.nagged['day:work'], localDateKey(nowDate));
    assert.equal(deliveredSaves, 1, '同一 attempt 重复 delivered 只能提交并落盘一次');
    assert.equal(world.dayWorkPending, null);
    await tick();
    assert.equal(dayItems().length, 2, '最终 delivered 后不得再补发同日提醒');
    await world.stop();
  } finally {
    cleanupDir(dir);
  }
});

test('第六轮投递：life.day 隐藏无 render 按排队租约恢复，null/异常立即清理', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-r6-queued-day-'));
  const nowDate = new Date('2026-11-19T02:00:00Z');
  const deferred = [];
  const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼', now: () => nowDate });
  const dayItems = () => deferred.filter((d) => d.spec.type === 'life.day');
  const tick = async () => {
    world.state.updatedAt = new Date(nowDate.getTime() - 3600_000).toISOString();
    world.state.vitals = { food: 80, energy: 80, clean: 80, fun: 80, social: 80 };
    world.state.conditions = [];
    world.state.asleepFrom = '';
    world.state.asleepUntil = '';
    world.state.activity = null;
    world.state.job.lastAt = '';
    await world.tick();
  };
  try {
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => e,
      // 模拟隐藏 World：宿主接受排队但静默 return，从不调用 render。
      pushDeferred: (spec, opts) => { deferred.push({ spec, opts }); },
      store: {}, drainPendingEvents: async () => [],
    });

    await tick();
    const queued = dayItems()[0];
    assert.ok(queued);
    const queuedId = queued.spec.meta.lifeAttempt;
    world.deliveryAttempts.get(queuedId).acceptedAt = Date.now() - 3600_000;
    await tick();
    const replacement = dayItems()[1];
    assert.ok(replacement, '从未 render 的排队项超过有界租约后应恢复');
    assert.notEqual(replacement.spec.meta.lifeAttempt, queuedId, '租约恢复必须使用新 attempt');
    assert.equal(world.deliveryAttempts.has(queuedId), false, '过期排队 attempt 不得残留');
    assert.equal(world.state.nagged['day:work'], undefined, '排队租约恢复不得视为 delivered');

    const replacementId = replacement.spec.meta.lifeAttempt;
    world.state.asleepFrom = new Date(nowDate.getTime() - 60_000).toISOString();
    world.state.asleepUntil = new Date(nowDate.getTime() + 3600_000).toISOString();
    assert.equal(replacement.spec.render(), null);
    assert.equal(world.dayWorkPending, null, 'render 返回 null 必须立即释放闩锁');
    assert.equal(world.deliveryAttempts.has(replacementId), false, 'render 返回 null 必须立即删除 attempt');

    await tick();
    const throwing = dayItems()[2];
    assert.ok(throwing, 'null 清理后应允许新 attempt');
    const throwingId = throwing.spec.meta.lifeAttempt;
    world.state.goals = null;
    assert.throws(() => throwing.spec.render(), TypeError, '测试必须实际进入 render 异常分支');
    assert.equal(world.dayWorkPending, null, 'render 异常必须立即释放闩锁');
    assert.equal(world.deliveryAttempts.has(throwingId), false, 'render 异常必须立即删除 attempt');

    world.state.goals = [];
    await tick();
    assert.equal(dayItems().length, 4, '异常清理后下一跳应允许重新入队');
    assert.equal(world.state.nagged['day:work'], undefined, 'null/异常均不得消费当日额度');
    await world.stop();
  } finally {
    cleanupDir(dir);
  }
});

test('测试网络硬哨兵：除 npm 版本探测外没有任何未打桩 URL', () => {
  const unknown = networkCalls.filter((url) => !url.startsWith('https://registry.npmjs.org/'));
  assert.deepEqual(unknown, []);
});
