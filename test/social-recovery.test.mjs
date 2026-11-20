import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

globalThis.fetch = async (input) => {
  const url = String(input instanceof URL ? input : input?.url ?? input);
  throw new Error(`测试硬离线哨兵：${url}`);
};

const { LifeWorld } = await import('../src/world.ts');
const { LIFE_DEFAULTS } = await import('../src/config.ts');
const { ACTS, advance, applyAct, localDateKey } = await import('../src/state.ts');

function cleanupDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function makeWorld(dir, getNow, cfgPatch = {}) {
  const pushed = [];
  const world = new LifeWorld({
    cfg: { ...LIFE_DEFAULTS(), enabled: true, townUrl: '', ...cfgPatch },
    dataDir: dir,
    botName: '大肥鱼',
    now: getNow,
  });
  const host = {
    log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
    pushEvent: async (e, opts) => {
      const env = { ...e, cursor: pushed.length + 1, opts };
      pushed.push(env);
      return env;
    },
    pushDeferred: (_spec, _opts) => {},
    store: {},
    drainPendingEvents: async () => [],
  };
  return { world, host, pushed };
}

test('复现 11-19→11-20 死局：小幅回补后二次归零当天不重复，跨日后首跳重新推送且当日不再重复', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-soc-rec-1-'));
  let nowDate = new Date(2026, 10, 19, 13, 50, 0);
  const { world, host, pushed } = makeWorld(dir, () => nowDate);
  try {
    await world.start(host);
    world.state.vitals = { food: 90, energy: 90, clean: 90, fun: 90, social: 0.2 };
    world.state.updatedAt = new Date(nowDate.getTime() - 20 * 60_000).toISOString();

    // 1. 11-19 13:50 首次跌到 0 -> 推送 zero:social 并模拟 delivered 提交
    await world.tick();
    const day1Pushes = pushed.filter((e) => e.type === 'life.low');
    assert.equal(day1Pushes.length, 1, '首次归零应推送 1 次 life.low');
    assert.match(day1Pushes[0].text, /见底了：社交 0/);
    world.onEventsSettled([day1Pushes[0]], 'delivered');
    assert.equal(world.state.nagged['zero:social'], localDateKey(nowDate));

    // 2. 调 market 只补 +8（未达 45，nagged['zero:social'] 不清）
    applyAct(world.state, 'market', nowDate);
    nowDate = new Date(nowDate.getTime() + ACTS.market.minutes * 60_000);
    await world.tick();
    assert.ok(world.state.vitals.social > 0 && world.state.vitals.social < 15);
    assert.equal(world.state.nagged['zero:social'], localDateKey(nowDate), '小额回补不应解开当日锁');

    // 3. 几小时后在 11-19 21:13 二次归零：当天不再重复推送
    nowDate = new Date(2026, 10, 19, 21, 13, 0);
    await world.tick();
    assert.equal(world.state.vitals.social, 0);
    assert.equal(pushed.filter((e) => e.type === 'life.low').length, 1, '同一天内二次归零不重推');

    // 4. 跨日到 11-20 09:00（before=0, after=0，无边沿越线）：首跳 tick 必须补发一次
    nowDate = new Date(2026, 10, 20, 9, 0, 0);
    world.state.vitals.food = 90;
    world.state.vitals.energy = 90;
    world.state.vitals.clean = 90;
    world.state.vitals.fun = 90;
    await world.tick();
    const day2Pushes = pushed.filter((e) => e.type === 'life.low');
    assert.equal(day2Pushes.length, 2, '跨日后持续见底必须重新推送一次 life.low');
    assert.match(day2Pushes[1].text, /见底了：社交 0/);
    world.onEventsSettled([day2Pushes[1]], 'delivered');
    assert.equal(world.state.nagged['zero:social'], localDateKey(nowDate));

    // 5. 当日后续 tick 不再刷屏
    nowDate = new Date(2026, 10, 20, 11, 0, 0);
    await world.tick();
    assert.equal(pushed.filter((e) => e.type === 'life.low').length, 2, '送达后当日后续 tick 不得刷屏');
  } finally {
    await world.stop();
    cleanupDir(dir);
  }
});

test('notify=always 时持续见底仍受每日一次约束，不每跳刷屏', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-soc-rec-2-'));
  let nowDate = new Date(2026, 10, 20, 10, 0, 0);
  const { world, host, pushed } = makeWorld(dir, () => nowDate, { notify: 'always' });
  try {
    await world.start(host);
    world.state.vitals = { food: 90, energy: 90, clean: 90, fun: 90, social: 0 };
    world.state.nagged = {};
    world.state.updatedAt = new Date(nowDate.getTime() - 10 * 60_000).toISOString();

    await world.tick();
    const first = pushed.filter((e) => e.type === 'life.low');
    assert.equal(first.length, 1);
    world.onEventsSettled([first[0]], 'delivered');

    // 后续多次 tick，即使 notify='always' 也不在持续趴底时连环刷屏
    for (let i = 1; i <= 3; i++) {
      nowDate = new Date(nowDate.getTime() + 5 * 60_000);
      await world.tick();
    }
    assert.equal(pushed.filter((e) => e.type === 'life.low').length, 1, 'always 模式持续归零一天仍只推一次');
  } finally {
    await world.stop();
    cleanupDir(dir);
  }
});

test('睡着时持续见底不推送，醒来后首跳立即补推', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-soc-rec-3-'));
  let nowDate = new Date(2026, 10, 20, 1, 0, 0);
  const { world, host, pushed } = makeWorld(dir, () => nowDate);
  try {
    await world.start(host);
    world.state.vitals = { food: 90, energy: 40, clean: 90, fun: 90, social: 0 };
    world.state.nagged = { 'zero:social': '2026-11-19' };
    applyAct(world.state, 'sleep', nowDate); // 睡到 09:00

    nowDate = new Date(2026, 10, 20, 3, 0, 0);
    await world.tick();
    assert.equal(pushed.filter((e) => e.type === 'life.low').length, 0, '睡着时不得推送持续见底提醒');

    nowDate = new Date(2026, 10, 20, 9, 5, 0);
    await world.tick();
    const afterWake = pushed.filter((e) => e.type === 'life.low');
    assert.equal(afterWake.length, 1, '醒来后首跳必须补推持续见底');
    assert.match(afterWake[0].text, /见底了：社交 0/);
  } finally {
    await world.stop();
    cleanupDir(dir);
  }
});

test('持续危急（< 15 且 > 0）跨日后同样补发一次 crit 提醒', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-soc-rec-4-'));
  let nowDate = new Date(2026, 10, 20, 10, 0, 0);
  const { world, host, pushed } = makeWorld(dir, () => nowDate);
  try {
    await world.start(host);
    world.state.vitals = { food: 90, energy: 90, clean: 90, fun: 90, social: 10 };
    world.state.nagged = { social: '2026-11-19', 'crit:social': '2026-11-19' };
    world.state.updatedAt = new Date(nowDate.getTime() - 10 * 60_000).toISOString();

    await world.tick();
    const lows = pushed.filter((e) => e.type === 'life.low');
    assert.equal(lows.length, 1, '持续危急跨日后应补推 1 次');
    assert.match(lows[0].text, /很缺了：社交/);
    world.onEventsSettled([lows[0]], 'delivered');
    assert.equal(world.state.nagged['crit:social'], localDateKey(nowDate));

    nowDate = new Date(nowDate.getTime() + 10 * 60_000);
    await world.tick();
    assert.equal(pushed.filter((e) => e.type === 'life.low').length, 1, '当日已推 crit 后不重复');
  } finally {
    await world.stop();
    cleanupDir(dir);
  }
});

test('在外旅途（staying）触发社交提醒时推荐 chat/meet，不提芦花塘早市/望水坡', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-soc-rec-5-'));
  const nowDate = new Date(2026, 10, 20, 10, 0, 0);
  writeFileSync(join(dir, 'journey-public.json'), JSON.stringify({
    schema: 1,
    updatedAt: nowDate.toISOString(),
    clock: { worldNow: nowDate.toISOString(), speed: 1 },
    phase: 'staying',
    hotelTier: 'view',
    city: { id: 'jiayuguan', name: '嘉峪关', timezone: 'Asia/Shanghai' },
  }), 'utf8');
  const { world, host, pushed } = makeWorld(dir, () => nowDate);
  try {
    await world.start(host);
    world.state.vitals = { food: 90, energy: 90, clean: 90, fun: 90, social: 0 };
    world.state.nagged = {};
    world.state.updatedAt = new Date(nowDate.getTime() - 10 * 60_000).toISOString();

    await world.tick();
    const lows = pushed.filter((e) => e.type === 'life.low');
    assert.equal(lows.length, 1);
    assert.match(lows[0].text, /chat/);
    assert.match(lows[0].text, /meet/);
    assert.match(lows[0].text, /在嘉峪关/);
    assert.doesNotMatch(lows[0].text, /早市|望水坡/);
  } finally {
    await world.stop();
    cleanupDir(dir);
  }
});
