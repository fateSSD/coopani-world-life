import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { LifeWorld } = await import('../src/world.ts');
const { LIFE_DEFAULTS, parseTownUrls } = await import('../src/config.ts');
const {
  freshState, advance, applyAct, applyWork, applyCert, applyLearn,
  snapshot, weatherOf, fullMarketPrices,
} = await import('../src/state.ts');
const { JOBS } = await import('../src/jobs.ts');
const { readJourney } = await import('../src/bridge.ts');

const silentHost = {
  log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
  pushEvent: async (e) => e,
  store: {},
  drainPendingEvents: async () => [],
};

function mkDir() {
  return mkdtempSync(join(tmpdir(), 'life-stage23-'));
}

test('二期收尾：journey-public.json 四格对齐与 day/wants/relation 三独立页签（只画事实不打分）', async () => {
  const dir = mkDir();
  try {
    const restIso = new Date(Date.now() + 2 * 3_600_000).toISOString();
    writeFileSync(join(dir, 'journey-public.json'), JSON.stringify({
      schema: 'coopani-journey-public/v1',
      phase: 'staying',
      city: { id: 'dali', name: '大理' },
      home: { id: 'luhuatang', name: '芦花塘' },
      rest: { until: restIso },
      work: { cityId: 'dali', gig: '客栈帮厨', until: restIso },
      party: { with: ['阿青', '老周'], days: 3 },
      updatedAt: new Date().toISOString(),
    }), 'utf8');

    const j = readJourney(dir);
    assert.equal(j.installed, true);
    assert.equal(j.homeName, '芦花塘');
    assert.equal(j.restUntil, restIso);
    assert.equal(j.tripWork?.gig, '客栈帮厨');
    assert.deepEqual(j.partyWith, ['阿青', '老周']);
    assert.equal(j.partyDays, 3);

    const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼' });
    await world.start(silentHost);
    const ui = world.webUi();
    assert.deepEqual(ui.panels.map((p) => p.id), ['now', 'day', 'wants', 'relation', 'diary', 'library']);

    const daySnap = await ui.invoke('day', 'snapshot');
    assert.ok(Array.isArray(daySnap.todayTellable));
    assert.ok(Array.isArray(daySnap.todayLedger));

    const wantsSnap = await ui.invoke('wants', 'snapshot');
    assert.ok(Array.isArray(wantsSnap.goals));
    assert.ok(Array.isArray(wantsSnap.habits));

    const relSnap = await ui.invoke('relation', 'snapshot');
    assert.equal(relSnap.journey.homeName, '芦花塘');
    assert.equal(relSnap.journey.tripWork.gig, '客栈帮厨');
    assert.deepEqual(relSnap.journey.partyWith, ['阿青', '老周']);
    assert.equal(relSnap.journey.partyDays, 3);
    assert.equal('affection' in relSnap, false);
    assert.equal('score' in relSnap, false);

    // 1.1 兜底：哪怕旧 journey 发来了过去的 rest.until，readJourney 也必须滤为空串
    const pastIso = new Date(Date.now() - 2 * 3_600_000).toISOString();
    writeFileSync(join(dir, 'journey-public.json'), JSON.stringify({
      schema: 'coopani-journey-public/v1',
      phase: 'home',
      city: { id: 'dali', name: '大理' },
      home: { id: 'luhuatang', name: '芦花塘' },
      rest: { until: pastIso },
      updatedAt: new Date().toISOString(),
    }), 'utf8');
    const jExpired = readJourney(dir);
    assert.equal(jExpired.restUntil, '', '过期休整时间在 readJourney 端必须置空');

    await world.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('三期成长与 G 类轻载具闭环：life_learn 培训/购车、装备门槛、五档完成度与 shift 结算', async () => {
  const t = new Date('2026-11-16T09:00:00.000+08:00');
  const s = freshState(t);
  s.home.monthly = 0;

  // 缺健康证与电动车时接「跑平台送外卖」应被挡
  const gateNoCert = applyWork(s, '跑平台送外卖', t, 'home');
  assert.equal(gateNoCert.ok, false);
  assert.match(gateNoCert.reason ?? '', /健康证/);

  // 考健康证（roll: 0.05 必过）
  const certRes = applyCert(s, '健康证', t, 0.05);
  assert.equal(certRes.ok, true);
  assert.equal(certRes.passed, true);

  // 有证没车仍被装备门槛拦下
  const gateNoBike = applyWork(s, '跑平台送外卖', t, 'home');
  assert.equal(gateNoBike.ok, false);
  assert.match(gateNoBike.reason ?? '', /二手电动车/);

  // 参加培训班 + 买电动车
  const course = applyLearn(s, '安全路况与跑单课', t);
  assert.equal(course.ok, true);
  assert.equal(course.kind, 'course');
  assert.equal(s.skills.driving, 12);
  assert.equal(s.trained.driving, 1);

  const buyBike = applyLearn(s, '二手电动车', t);
  assert.equal(buyBike.ok, true);
  assert.equal(buyBike.kind, 'equip');
  assert.ok(s.gear.includes('ebike'));

  // 养足精力+好心情再上阵，满血出车配合 gradeRoll=0.99 拿「漂亮」(1.6x)
  s.vitals.energy = 90;
  s.moodlets.push({
    id: 'm-ok',
    source: 'act',
    text: '精神饱满',
    kind: 'good',
    expiresAt: new Date(t.getTime() + 8 * 3_600_000).toISOString(),
  });

  // 正式开工：初始化 shift 状态，收工（gradeRoll=0.99 漂亮）拿 1.6× 报酬并结算 shiftSummary
  const workStart = applyWork(s, '跑平台送外卖', t, 'home');
  assert.equal(workStart.ok, true);
  assert.equal(workStart.materialPaid, 8);
  assert.equal(s.shift?.jobId, 'rider_delivery');
  assert.equal(s.shift?.vehicleId, 'ebike');

  const cashBeforeDone = s.money.cash;
  const end = new Date(t.getTime() + 240 * 60_000);
  const res = advance(s, end, { gradeRoll: 0.99 });
  assert.equal(res.completed.length, 1);
  assert.equal(res.completed[0].gradeLabel, '漂亮');
  assert.equal(res.completed[0].workEarned, Math.round(135 * 1.6));
  assert.match(res.completed[0].shiftSummary ?? '', /11 单/);
  assert.equal(s.money.cash - cashBeforeDone, Math.round(135 * 1.6));
  assert.equal(s.shift, null);
  assert.ok((s.skills.driving ?? 0) > 12);

  // 1.2 做砸真亏本：早市摆摊开工先垫 25 元本钱，gradeRoll=0.01 做砸被退货拿回 0 元，净变化 -25 元
  const day2 = new Date('2026-11-17T09:00:00.000+08:00');
  s.job.days = 30;
  const cashBeforeDay2 = s.money.cash;
  const w2 = applyWork(s, '早市摆摊', day2, 'home');
  assert.equal(w2.ok, true);
  assert.equal(w2.materialPaid, 25);
  const res2 = advance(s, new Date(day2.getTime() + 270 * 60_000), { gradeRoll: 0.01 });
  assert.equal(res2.completed[0].gradeLabel, '砸了');
  assert.equal(res2.completed[0].workEarned, 0);
  assert.equal(s.money.cash - cashBeforeDay2, -25, '做砸必须真正亏掉垫付的 25 元本钱');
  assert.ok(s.tellable.some((t) => /本钱没收回来/.test(t.text)));

  // 确认 JOBS 新增了 3 个 G 类轻载具岗位
  assert.ok(JOBS.some((j) => j.id === 'rider_delivery' && j.shift));
  assert.ok(JOBS.some((j) => j.id === 'courier_ebike' && j.shift));
  assert.ok(JOBS.some((j) => j.id === 'designated_driver' && j.shift && j.equip === 'folding_bike'));
});

test('三期节气时间轴 + 梦境切片 + 深夜静谧态', () => {
  // 南滨河路晨集 07:30（8 折） vs 张掖路 20:00（尾货半价） vs 周六雁滩路 19:00（周末集）
  const morning = new Date('2026-11-16T07:30:00.000+08:00');
  const nightClear = new Date('2026-11-16T20:00:00.000+08:00');
  const weekend = new Date('2026-11-21T19:00:00.000+08:00'); // 周六

  const s = freshState(morning);
  const snapM = snapshot(s, morning);
  assert.equal(snapM.solarTerm.name, '立冬');
  assert.equal(snapM.streetWindow?.id, 'morning-market');
  assert.match(weatherOf('兰州', morning).seasonNote, /立冬/);

  const catM = fullMarketPrices(morning);
  const catN = fullMarketPrices(nightClear);
  const catW = fullMarketPrices(weekend);
  assert.ok(catM.some((x) => x.discounted && /晨集/.test(x.tag || '')));
  assert.ok(catN.some((x) => x.item === '酱卤豆干拼盘' && x.discounted));
  assert.ok(catW.some((x) => x.item === '旧磁带随身听小带'));

  // 深夜静谧态（02:15 读书/做饭）触发 late-night 暖意心情 + 早市鲜蔬下厨加成
  const late = new Date('2026-11-17T02:15:00.000+08:00');
  s.freshVegUntil = new Date('2026-11-17T12:00:00.000+08:00').toISOString();
  const cookRes = applyAct(s, 'cook', late);
  assert.equal(cookRes.ok, true);
  assert.ok(s.moodlets.some((m) => m.source === 'late-night' && m.kind === 'good'));
  assert.ok(s.moodlets.some((m) => m.source === 'fresh-veg' && m.kind === 'good'));
  assert.equal(s.freshVegUntil, '');

  // 完饭后睡一觉（8h），自然醒触发梦境切片写进 tellable
  const afterCook = new Date(late.getTime() + 60 * 60_000);
  advance(s, afterCook);
  s.wants.push({ id: 'w-1', what: '去看雪乡', kind: 'place', scale: 'big', at: afterCook.toISOString() });
  applyAct(s, 'sleep', afterCook);
  const wakeTime = new Date(afterCook.getTime() + 8 * 3_600_000);
  advance(s, wakeTime, { journeyCity: '大理', dreamRoll: 0.05 });
  assert.ok(s.tellable.some((t) => /梦/.test(t.text)));
});

test('三期服务端多值容灾与 L2 报到/黑板报/带 uid 下单全链路', async () => {
  const dir = mkDir();
  const fakeUid = 'a1b2c3d4e5f6a1b2c3d4e5f6';
  writeFileSync(join(dir, 'meet-uid.txt'), fakeUid, 'utf8');

  const joinCalls = [];
  const buyCalls = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const p = body ? JSON.parse(body) : {};
      if (req.url === '/town/info') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ town: 'lanzhou', name: '兰州', origin: '黄河穿城', streets: ['南滨河路', '张掖路', '皋兰路', '雁滩路'], rules: [] }));
        return;
      }
      if (req.url === '/town/join' && req.method === 'POST') {
        joinCalls.push(p);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, town: '兰州', memberCount: 3 }));
        return;
      }
      if (req.url === '/town/stalls' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          stalls: [{ id: 'st-9', seller: '阿青', item: '现烤桂花糕', price: 11, stock: 3, freshVeg: true }],
          bulletin: ['大肥鱼昨天在张掖路买了桂花糕', '雁滩路今晚有人拎着吉他唱歌'],
        }));
        return;
      }
      if (req.url === '/town/stalls' && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: 'st-new', seller: p.pet, item: p.item, price: p.price, stock: p.stock, freshVeg: Boolean(p.freshVeg) }));
        return;
      }
      if (req.url?.startsWith('/town/deals') && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          unseen: 1,
          deals: [{ id: 'd-1', stallId: 'st-new', item: '头茬青菜', qty: 2, buyerPet: '肥鱼', seen: false, at: new Date().toISOString() }],
        }));
        return;
      }
      if (req.url === '/town/buy' && req.method === 'POST') {
        buyCalls.push(p);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, item: '现烤桂花糕', price: 11, seller: '阿青', freshVeg: true }));
        return;
      }
      res.writeHead(404); res.end();
    });
  });

  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  try {
    // 首位无效地址 + 备选有效地址数组容灾
    const townUrls = ['http://127.0.0.1:1/dead', `http://127.0.0.1:${port}`];
    assert.deepEqual(parseTownUrls(townUrls), townUrls);

    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, townUrl: townUrls },
      dataDir: dir,
      botName: '小青鱼',
    });
    await world.start(silentHost);
    // 等待异步 startup sync 完成
    for (let i = 0; i < 30 && joinCalls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.equal(joinCalls.length, 1);
    assert.equal(joinCalls[0].uid, fakeUid);
    assert.equal(joinCalls[0].pet, '小青鱼');

    // relation 面板 & vars 应带出黑板报
    const vars = world.envPromptVars();
    assert.match(vars['life.bulletin'], /桂花糕/);
    const rel = await world.webUi().invoke('relation', 'snapshot');
    assert.equal(rel.bulletin.length, 2);

    // 调 life_buy 工具购买应透传 buyerUid
    const buyTool = world.tools().find((t) => t.name === 'life_buy');
    const bought = await buyTool.handler({ stall_id: 'st-9' });
    assert.match(bought.text, /买了现烤桂花糕/);
    assert.equal(buyCalls.length, 1);
    assert.equal(buyCalls[0].buyerUid, fakeUid);

    // 调 life_learn 工具购买装备并检查账本
    const learnTool = world.tools().find((t) => t.name === 'life_learn');
    const learned = await learnTool.handler({ what: '家用小烤箱' });
    assert.match(learned.text, /家用小烤箱/);

    // 调 life_stall 挂摊 & life_deals 查成交回执
    const stallTool = world.tools().find((t) => t.name === 'life_stall');
    const stalled = await stallTool.handler({ item: '头茬青菜', price: 9, stock: 4, fresh_veg: true });
    assert.match(stalled.text, /摊子挂上鱼市街了：头茬青菜/);

    const dealsTool = world.tools().find((t) => t.name === 'life_deals');
    const dealsRes = await dealsTool.handler({});
    assert.match(dealsRes.text, /肥鱼 买走 2 份「头茬青菜」/);

    await world.stop();
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('1.3 & 1.4 & 时区：晨集番茄鸡蛋面触发鲜蔬/夜晚豆干不触发/记忆不混摊主名/面板用本地时区', async () => {
  // 1.3 & 1.4 测试晨集买菜（07:30）与夜晚尾货（20:00）
  const morningDir = mkDir();
  const nightDir = mkDir();
  try {
    const morningNow = new Date('2026-11-16T07:30:00.000+08:00');
    const wMorning = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true },
      dataDir: morningDir,
      botName: '大肥鱼',
      now: () => morningNow,
    });
    await wMorning.start(silentHost);
    const buyM = wMorning.tools().find((t) => t.name === 'life_buy');
    const rM = await buyM.handler({ stall_id: '番茄鸡蛋面料' });
    assert.match(rM.text, /买了番茄鸡蛋面料/);
    const stM = JSON.parse(readFileSync(join(morningDir, 'life-state.json'), 'utf8'));
    assert.ok(stM.freshVegUntil && stM.freshVegUntil.length > 0, '晨集买番茄鸡蛋面料必须触发 freshVegUntil');
    assert.equal(
      stM.tellable.some((t) => /带露水那儿|晨集8折.*那儿/.test(t.text)),
      false,
      '记忆不得把场地标签写成摊主',
    );
    assert.ok(stM.tellable.some((t) => /在晨集8折的摊子上买了番茄鸡蛋面料/.test(t.text)));
    const ledgerM = readFileSync(join(morningDir, 'life-ledger.jsonl'), 'utf8');
    assert.match(ledgerM, /"payee":"早市摊主"/);
    await wMorning.stop();

    const nightNow = new Date('2026-11-16T20:00:00.000+08:00');
    const wNight = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true },
      dataDir: nightDir,
      botName: '大肥鱼',
      now: () => nightNow,
    });
    await wNight.start(silentHost);
    const buyN = wNight.tools().find((t) => t.name === 'life_buy');
    const rN = await buyN.handler({ stall_id: '酱卤豆干拼盘' });
    assert.match(rN.text, /买了酱卤豆干拼盘/);
    const stN = JSON.parse(readFileSync(join(nightDir, 'life-state.json'), 'utf8'));
    assert.equal(stN.freshVegUntil || '', '', '夜晚买酱卤豆干拼盘熟食不得触发 freshVegUntil');
    await wNight.stop();
  } finally {
    rmSync(morningDir, { recursive: true, force: true });
    rmSync(nightDir, { recursive: true, force: true });
  }

  // 面板时区检查与黑板横幅防增殖检查：动态从 package.json 读取 webUiClient
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const panelCode = readFileSync(new URL(`../${pkg.cortico.webUiClient}`, import.meta.url), 'utf8');
  assert.match(panelCode, /timeZone:\s*'Asia\/Shanghai'/);
  assert.equal(/\.slice\(11,\s*16\)|\.slice\(0,\s*16\)/.test(panelCode), false, '面板不得对 UTC ISO 字符串直接 slice 截断');
  assert.match(panelCode, /note\.hidden\s*=\s*true;\s*note\.textContent\s*=\s*''/, 'render(d) 开始时必须清空 note.textContent，防止街口黑板反复拼接增殖');
});
