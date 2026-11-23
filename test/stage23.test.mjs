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
  snapshot, weatherOf, fullMarketPrices, localDateKey, StateStore,
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

test('街道分配与迁移：多鱼按 uid 均匀分布到四条街，不再全挤南滨河路；旧城街道「春熙路」启动自愈重分并重新报到', async () => {
  const { pickTownStreet } = await import('../src/bridge.ts');
  const streets = ['南滨河路', '张掖路', '皋兰路', '雁滩路'];

  // 1) 确定性哈希应把不同 uid 均匀分配到 4 条街，不会全部落到 streets[0]
  const buckets = new Set();
  for (let i = 0; i < 40; i++) {
    const uid = i.toString(16).padStart(24, 'a');
    buckets.add(pickTownStreet(streets, uid));
  }
  assert.equal(buckets.size, 4, `40 个不同 uid 应分布到全部 4 条街，实际只有：${[...buckets].join(',')}`);
  assert.equal(pickTownStreet(streets, 'abcdef0123456789abcdef01'), pickTownStreet(streets, 'abcdef0123456789abcdef01'));

  // 2) 老存档残留成都「春熙路」且 today 已经报过到：连到兰州服务器后应自动改派进兰州四街、清 lastJoinedTownAt 并立刻重报
  const dir = mkDir();
  const staleUid = '415dd826eadfc6cc5c6ca7fb';
  writeFileSync(join(dir, 'meet-uid.txt'), staleUid, 'utf8');
  const today = localDateKey(new Date());
  const st = freshState(new Date());
  st.street = '春熙路';
  st.home.street = '春熙路';
  st.lastJoinedTownAt = today;
  new StateStore(dir).save(st);

  const joinCalls = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const p = body ? JSON.parse(body) : {};
      if (req.url === '/town/info') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          town: 'lanzhou', name: '兰州', origin: '黄河穿城',
          streets, rules: ['河里的不吃河里的'], custom: true,
        }));
        return;
      }
      if (req.url === '/town/join' && req.method === 'POST') {
        joinCalls.push(p);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, town: 'lanzhou', name: '兰州', street: p.street }));
        return;
      }
      if (req.url === '/town/stalls') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, stalls: [], bulletin: [] }));
        return;
      }
      if (req.url?.startsWith('/town/deals')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, unseen: 0, deals: [] }));
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  try {
    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, townUrl: `http://127.0.0.1:${port}` },
      dataDir: dir,
      botName: '大肥鱼',
    });
    await world.start(silentHost);
    for (let i = 0; i < 30 && joinCalls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.equal(joinCalls.length, 1, '旧街名迁走后即便今天已报过，也应立即重新向 /town/join 报到更新街道');
    const assigned = joinCalls[0].street;
    assert.ok(streets.includes(assigned), `新分配街道必须属于兰州：${assigned}`);
    assert.equal(assigned, pickTownStreet(streets, staleUid));
    assert.ok(world.envPromptVars()['life.street'].startsWith(`你住在${assigned}。`));
    const saved = JSON.parse(readFileSync(join(dir, 'life-state.json'), 'utf8'));
    assert.equal(saved.street, assigned);
    assert.equal(saved.home.street, assigned);
    await world.stop();
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('旅途上做的事绝不显示成「在家里」：经 StateStore 保存再读档完成结算仍保持旅途场景', async () => {
  const dir = mkDir();
  try {
    const store = new StateStore(dir);
    const t0 = new Date('2026-11-23T09:00:00+08:00');
    const s = freshState(t0);
    s.vitals.clean = 40;
    s.vitals.fun = 40;

    // 1) 外地住店（staying）洗澡：保存→读档→推进完成，必须记录「在酒店浴室洗澡了」，绝不能丢失 scene 回退成「在家里浴室」
    const washAct = applyAct(s, 'wash', t0, { phase: 'staying', cityName: '成都' });
    assert.equal(washAct.ok, true);
    assert.equal(s.activity.scene, '酒店浴室');
    store.save(s);
    const reloaded1 = store.load(new Date(t0.getTime() + 10 * 60_000)).state;
    assert.equal(reloaded1.activity?.scene, '酒店浴室', 'normActivity 读档不得丢掉 scene');
    advance(reloaded1, new Date(t0.getTime() + 35 * 60_000), { phase: 'staying', journeyCity: '成都' });
    assert.equal(reloaded1.tellable.at(-1)?.text, '在酒店浴室洗澡了。');

    // 2) 外地住店看书 + 景区画画 + 赶路看书
    const t1 = new Date('2026-11-23T12:00:00+08:00');
    applyAct(reloaded1, 'study', t1, { phase: 'staying', cityName: '成都' });
    store.save(reloaded1);
    const reloaded2 = store.load(new Date(t1.getTime() + 5 * 60_000)).state;
    advance(reloaded2, new Date(t1.getTime() + 65 * 60_000), { phase: 'staying', journeyCity: '成都' });
    assert.equal(reloaded2.tellable.at(-1)?.text, '在酒店书桌旁看会儿书了（书本与笔记本）。');

    const t2 = new Date('2026-11-23T14:00:00+08:00');
    applyAct(reloaded2, 'study', t2, { phase: 'traveling', toName: '重庆', modeId: 'train' });
    advance(reloaded2, new Date(t2.getTime() + 65 * 60_000), { phase: 'traveling', modeId: 'train' });
    assert.equal(reloaded2.tellable.at(-1)?.text, '在旅途车厢座位旁看会儿书了（书本与笔记本）。');
    assert.equal(reloaded2.tellable.some((item) => /在家里/.test(item.text)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('同城换街搬家（life_move 与面板）、服务器自定义街道档案同步、属性增益/减益实测生效', async () => {
  // 1) 纯数值验证：皋兰路（clean +10, know +15, social -10）与张掖路（work +10）
  const t0 = new Date('2026-11-23T10:00:00+08:00');
  const sBase = freshState(t0);
  const sGao = freshState(t0);
  advance(sBase, new Date(t0.getTime() + 10 * 3_600_000), { phase: 'home' });
  advance(sGao, new Date(t0.getTime() + 10 * 3_600_000), { phase: 'home', streetMods: { clean: 10, know: 15, social: -10 } });
  assert.ok(sGao.vitals.clean > sBase.vitals.clean, '皋兰路 clean +10% 应让清爽掉得更慢');
  assert.ok(sGao.vitals.social < sBase.vitals.social, '皋兰路 social -10% 应让社交掉得更快');

  // 外地旅行时不受本城街道增益/减益影响
  const sTripA = freshState(t0);
  const sTripB = freshState(t0);
  advance(sTripA, new Date(t0.getTime() + 5 * 3_600_000), { phase: 'staying', hotelTier: 'comfort' });
  advance(sTripB, new Date(t0.getTime() + 5 * 3_600_000), { phase: 'staying', hotelTier: 'comfort', streetMods: { clean: 30, social: -30 } });
  assert.equal(sTripA.vitals.clean, sTripB.vitals.clean);
  assert.equal(sTripA.vitals.social, sTripB.vitals.social);

  // 看书见识 +15% & 出工工钱 +10%
  const bStudy = freshState(t0);
  const gStudy = freshState(t0);
  applyAct(bStudy, 'study', t0);
  applyAct(gStudy, 'study', t0);
  advance(bStudy, new Date(t0.getTime() + 65 * 60_000), { phase: 'home' });
  advance(gStudy, new Date(t0.getTime() + 65 * 60_000), { phase: 'home', streetMods: { know: 15 } });
  assert.ok(gStudy.knowledge > bStudy.knowledge, `皋兰路见识+15% 未生效：${gStudy.knowledge} vs ${bStudy.knowledge}`);

  const bWork = freshState(t0);
  const gWork = freshState(t0);
  applyWork(bWork, '搬货', t0, 'home');
  applyWork(gWork, '搬货', t0, 'home');
  const wEnd = new Date(t0.getTime() + 250 * 60_000);
  const bRes = advance(bWork, wEnd, { phase: 'home', gradeRoll: 0.5 });
  const gRes = advance(gWork, wEnd, { phase: 'home', gradeRoll: 0.5, streetMods: { work: 10 } });
  assert.ok(gRes.completed[0].workEarned > bRes.completed[0].workEarned, `张掖路工钱+10% 未生效：${gRes.completed[0].workEarned} vs ${bRes.completed[0].workEarned}`);

  // 2) 集成测试：服务器下发 streetProfiles + life_move({ street }) + 面板 move({ street }) + /town/join 上报
  const dir = mkDir();
  writeFileSync(join(dir, 'meet-uid.txt'), 'u-street-test-0001', 'utf8');
  const joinStreets = [];
  const customProfiles = [
    { name: '南滨河路', desc: '黄河风吹水车园。', mods: { energy: 10, fun: 10, clean: -10 } },
    { name: '正宁路', desc: '夜市热气扑面而来。', mods: { food: 20, social: 10, clean: -15 } },
  ];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const p = body ? JSON.parse(body) : {};
      if (req.url === '/town/info') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          town: 'lanzhou',
          name: '兰州',
          origin: '黄河穿城',
          streets: ['南滨河路', '正宁路'],
          streetProfiles: customProfiles,
          rules: ['河里的不吃河里的'],
          custom: true,
        }));
        return;
      }
      if (req.url === '/town/join' && req.method === 'POST') {
        joinStreets.push(p.street);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, town: 'lanzhou', name: '兰州', street: p.street }));
        return;
      }
      if (req.url === '/town/stalls') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, stalls: [], bulletin: [] }));
        return;
      }
      if (req.url?.startsWith('/town/deals')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, unseen: 0, deals: [] }));
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  const pushedEvents = [];
  try {
    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, townUrl: `http://127.0.0.1:${port}` },
      dataDir: dir,
      botName: '大肥鱼',
    });
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => { pushedEvents.push(e); return e; },
      store: {},
      drainPendingEvents: async () => [],
    });
    for (let i = 0; i < 30 && joinStreets.length === 0; i++) await new Promise((r) => setTimeout(r, 25));

    const moveTool = world.tools().find((t) => t.name === 'life_move');
    const snap0 = await world.webUi().invoke('now', 'snapshot');
    assert.equal(snap0.streetQuotes.length, 2);
    assert.equal(snap0.streetQuotes[1].desc, '夜市热气扑面而来。');

    const targetStreet = snap0.street === '正宁路' ? '南滨河路' : '正宁路';
    const res1 = await moveTool.handler({ street: targetStreet });
    assert.match(res1.text, new RegExp(`换到本城的${targetStreet}了`));
    assert.match(res1.text, /不收押金/);
    for (let i = 0; i < 30 && joinStreets.at(-1) !== targetStreet; i++) await new Promise((r) => setTimeout(r, 25));
    assert.equal(joinStreets.at(-1), targetStreet);

    const backStreet = targetStreet === '正宁路' ? '南滨河路' : '正宁路';
    const panelRes = await world.webUi().invoke('now', 'move', [{ street: backStreet }]);
    assert.equal(panelRes.ok, true);
    assert.equal(panelRes.street, backStreet);
    assert.ok(pushedEvents.some((e) => e.type === 'life.moved' && e.text.includes(backStreet)));

    await world.stop();
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recentVisits 连续 8 天只计数近 7 天，relation 面板修复 [object Object] 并展示在售摊位', async () => {
  const { recentVisits, noteVisit } = await import('../src/state.ts');
  const tNow = new Date(2026, 10, 23, 18, 0);
  const s = freshState(tNow);
  for (let i = 0; i < 8; i++) {
    const d = new Date(2026, 10, 23 - i, 10, 0);
    noteVisit(s, d);
  }
  noteVisit(s, new Date(2026, 10, 23, 15, 0));
  assert.equal(s.presence.length, 8);
  assert.equal(recentVisits(s, tNow, 7), 7, '连续 8 天到访在近 7 天窗口里只能算 7 天');
  assert.equal(recentVisits(s, tNow, 1), 1, '1 天窗口只算今天');

  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const panelCode = readFileSync(new URL(`../${pkg.cortico.webUiClient}`, import.meta.url), 'utf8');
  assert.doesNotMatch(panelCode, /el\(\s*['"]span['"]\s*,\s*['"]lf-chip['"]\s*,\s*day\s*\)/, '禁止再把 day 对象直接传进 .lf-chip');
  assert.match(panelCode, /day\?\.date|day\.date/, '胶囊应提取 day.date');
  assert.match(panelCode, /d\.otherStalls/, 'relation 面板应展示鱼市街街坊在售摊位');
});

test('鱼市街摆摊自定义 effects 与买摊叠加五维/见识/体质/邻里社交及好心情 + 状态/黑板报直接曝光摊位', async () => {
  const { normStallEffects } = await import('../src/bridge.ts');
  const { LOW } = await import('../src/state.ts');
  const dir = mkDir();
  const nowFixed = new Date();
  const todayKey = localDateKey(nowFixed);
  const store = new StateStore(dir);
  const initState = freshState(nowFixed);
  initState.vitals = { food: 18, energy: 70, clean: 70, fun: 20, social: 10 };
  initState.knowledge = 5;
  initState.fitness = 25;
  initState.money.cash = 300;
  initState.nagged = { food: todayKey, fun: todayKey, social: todayKey };
  initState.moodlets = [{
    id: 'm-lonely-test',
    source: 'lonely',
    text: '一个人待太久了',
    kind: 'bad',
    expiresAt: new Date(nowFixed.getTime() + 6 * 3_600_000).toISOString(),
  }];
  store.save(initState);

  const stalls = [
    {
      id: 'st-fx',
      seller: '阿青',
      kind: 'goods',
      item: '红豆糯米糕',
      price: 64,
      stock: 2,
      freshVeg: false,
      note: '刚蒸好的',
      effects: { food: 24, fun: 15, social: 20, knowledge: 2, fitness: 1 },
    },
    {
      id: 'st-plain',
      seller: '老周',
      kind: 'goods',
      item: '手工芝麻饼',
      price: 16,
      stock: 2,
      freshVeg: false,
    },
  ];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const p = body ? JSON.parse(body) : {};
      if (req.url === '/town/info') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ town: 'lanzhou', name: '兰州', origin: '黄河穿城', streets: ['南滨河路'], rules: [] }));
        return;
      }
      if (req.url === '/town/join' && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, town: 'lanzhou', name: '兰州', street: p.street || '南滨河路' }));
        return;
      }
      if (req.url === '/town/stalls' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          stalls: stalls.filter((s) => s.stock > 0),
          bulletin: ['过去一天城里一共成交了 1 份摊货'],
        }));
        return;
      }
      if (req.url === '/town/stalls' && req.method === 'POST') {
        const fx = normStallEffects(p.effects, Number(p.price) || 1);
        const created = {
          id: 'st-mine',
          seller: p.pet,
          kind: p.kind || 'goods',
          item: p.item,
          price: Number(p.price),
          stock: Number(p.stock || 3),
          freshVeg: Boolean(p.freshVeg),
          note: p.note || '',
          ...(fx ? { effects: fx } : {}),
        };
        stalls.push(created);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...created }));
        return;
      }
      if (req.url === '/town/buy' && req.method === 'POST') {
        const st = stalls.find((s) => s.id === p.stallId);
        if (!st || st.stock <= 0) {
          res.writeHead(409, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'sold out' }));
          return;
        }
        st.stock -= 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          item: st.item,
          price: st.price,
          seller: st.seller,
          freshVeg: Boolean(st.freshVeg),
          ...(st.effects ? { effects: st.effects } : {}),
        }));
        return;
      }
      if (req.url?.startsWith('/town/deals')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, unseen: 0, deals: [] }));
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  try {
    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, townUrl: `http://127.0.0.1:${port}` },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => nowFixed,
    });
    await world.start(silentHost);
    for (let i = 0; i < 40 && !world.envPromptVars()['life.bulletin'].includes('红豆糯米糕'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const bulletin = world.envPromptVars()['life.bulletin'];
    assert.match(bulletin, /阿青的「红豆糯米糕」64元/, 'envPrompt life.bulletin 应直曝在售摊位');

    const statusTool = world.tools().find((t) => t.name === 'life_status');
    const stText = (await statusTool.handler({})).text;
    assert.match(stText, /鱼市街在售摊位：.*红豆糯米糕/, 'life_status 应直接展示鱼市街在售摊位');

    const relSnap = await world.webUi().invoke('relation', 'snapshot');
    assert.equal(relSnap.otherStalls.length, 2);

    const stallTool = world.tools().find((t) => t.name === 'life_stall');
    const stallRes = await stallTool.handler({
      item: '手擀面',
      price: 1,
      stock: 2,
      effects: { food: 55, fun: 55, knowledge: 6, fitness: 4 },
    });
    assert.match(stallRes.text, /手擀面/);
    const posted = stalls.find((s) => s.id === 'st-mine');
    assert.ok(posted?.effects, '挂摊应透传自定义 effects');
    const postedCost = (posted.effects.food || 0) + (posted.effects.energy || 0) + (posted.effects.clean || 0)
      + (posted.effects.fun || 0) + (posted.effects.social || 0)
      + (posted.effects.knowledge || 0) * 6 + (posted.effects.fitness || 0) * 8;
    assert.ok(postedCost > 0 && postedCost <= 41, `1 元挂摊加权点数应在 41 预算内，实际 ${postedCost}`);

    const buyTool = world.tools().find((t) => t.name === 'life_buy');
    const buyFxRes = await buyTool.handler({ stall_id: 'st-fx' });
    assert.match(buyFxRes.text, /好心情/);
    const s1 = store.load(nowFixed).state;
    assert.equal(Math.round(s1.vitals.food), 42, '自定义 food +24');
    assert.equal(Math.round(s1.vitals.fun), 35, '自定义 fun +15');
    assert.equal(Math.round(s1.vitals.social), 35, 'social 20 叠邻里 +8 应封顶到 +25（10 -> 35）');
    assert.equal(Math.round(s1.knowledge), 7, '自定义 knowledge +2');
    assert.equal(Math.round(s1.fitness), 26, '自定义 fitness +1');
    assert.equal(s1.moodlets.some((m) => m.source === 'lonely'), false, '社交回到 >= 30 应清除 lonely');
    assert.equal(s1.moodlets.some((m) => m.source === 'town-buy' && m.kind === 'good'), true, '买摊应挂正向心情条');

    await buyTool.handler({ stall_id: 'st-plain' });
    const s2 = store.load(nowFixed).state;
    assert.equal(Math.round(s2.vitals.food), 78, '无 effects 摊位默认 food +36');
    assert.equal(Math.round(s2.vitals.fun), 47, '无 effects 摊位默认 fun +12');
    assert.equal(Math.round(s2.vitals.social), 53, '无 effects 摊位默认 social +10 再叠 +8 = +18');
    assert.ok(s2.vitals.food >= LOW + 15 && !s2.nagged.food, '回 >= LOW+15 应清 food 的 nagged');
    assert.ok(s2.vitals.fun >= LOW + 15 && !s2.nagged.fun, '回 >= LOW+15 应清 fun 的 nagged');
    assert.ok(s2.vitals.social >= LOW + 15 && !s2.nagged.social, '回 >= LOW+15 应清 social 的 nagged');

    await world.stop();
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('审查回归：睡眠回精不再与 streetDecay 抵消，精力 +10% 街道显著高于无加成与 -10% 街道', async () => {
  const { BUILTIN_TOWN } = await import('../src/bridge.ts');
  const nanbin = BUILTIN_TOWN.streetProfiles.find((p) => p.name === '南滨河路');
  const zhangye = BUILTIN_TOWN.streetProfiles.find((p) => p.name === '张掖路');
  assert.equal(nanbin?.mods?.energy, 10);
  assert.equal(zhangye?.mods?.energy, -10);

  const runSleep4h = (streetMods) => {
    const t0 = new Date('2026-11-23T02:00:00Z'); // 北京 10:00 白昼窗口
    const t4 = new Date(t0.getTime() + 4 * 3_600_000);
    const s = freshState(t0);
    s.vitals = { food: 90, energy: 30, clean: 80, fun: 80, social: 80 };
    s.fitness = 25;
    s.asleepFrom = t0.toISOString();
    s.asleepUntil = new Date(t0.getTime() + 8 * 3_600_000).toISOString();
    advance(s, t4, streetMods ? { streetMods } : undefined);
    return Number(s.vitals.energy.toFixed(3));
  };

  const eNone = runSleep4h(undefined);
  const ePlus = runSleep4h(nanbin.mods);
  const eMinus = runSleep4h(zhangye.mods);

  assert.equal(eNone, 70, '无加成白昼睡 4 小时应回 40 点（30 -> 70）');
  assert.equal(ePlus, 74, '精力 +10% 街道睡 4 小时应回 44 点（30 -> 74）');
  assert.equal(eMinus, 66, '精力 -10% 街道睡 4 小时应回 36 点（30 -> 66）');
  assert.ok(ePlus > eNone && eNone > eMinus);
});

test('审查回归：DEFAULT_STREET_PROFILES 结构完整且与服务端 worker.js 一致（不漂移）', async () => {
  const { BUILTIN_TOWN } = await import('../src/bridge.ts');
  assert.equal(BUILTIN_TOWN.streetProfiles.length, 4);
  for (const p of BUILTIN_TOWN.streetProfiles) {
    assert.ok(p.name && p.desc && p.desc.length >= 10, `街道画像不完整：${p.name}`);
    assert.ok(p.mods && Object.keys(p.mods).length > 0, `街道缺乏 mods：${p.name}`);
  }

  const workerUrl = new URL('../../../2026-10-31-11-15-27/coopani-world-journey/cloud/sight-cf/src/worker.js', import.meta.url);
  if (existsSync(workerUrl)) {
    const src = readFileSync(workerUrl, 'utf8');
    const m = src.match(/const DEFAULT_STREET_PROFILES = (\[[\s\S]*?\n\]);/);
    assert.ok(m, 'worker.js 中未找到 DEFAULT_STREET_PROFILES 定义');
    const workerProfiles = new Function(`return (${m[1]});`)();
    assert.deepEqual(
      BUILTIN_TOWN.streetProfiles,
      workerProfiles,
      'life BUILTIN_TOWN.streetProfiles 与 worker.js DEFAULT_STREET_PROFILES 必须一字不差同步',
    );
  }
});

test('审查回归：panelSnapshot().journey 与面板代码透出游轮舱位（seatId / seat / seatMult）', async () => {
  const dir = mkDir();
  const nowFixed = new Date('2026-11-23T04:00:00Z');
  try {
    writeFileSync(join(dir, 'journey-public.json'), JSON.stringify({
      schema: 'coopani-journey-public/v1',
      updatedAt: nowFixed.toISOString(),
      phase: 'traveling',
      city: { id: 'shanghai', name: '上海', tz: 'Asia/Shanghai' },
      leg: {
        fromId: 'shanghai', toId: 'qingdao',
        fromName: '上海', toName: '青岛',
        modeId: 'ship',
        seatId: 'theme-cruise',
        seat: '主题远洋游轮',
        seatMult: 3.2,
        departedAt: new Date(nowFixed.getTime() - 3_600_000).toISOString(),
        arriveAt: new Date(nowFixed.getTime() + 10 * 3_600_000).toISOString(),
      },
    }), 'utf8');

    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => nowFixed,
    });
    const snap = await world.webUi().invoke('now', 'snapshot');
    assert.equal(snap.journey.modeId, 'ship');
    assert.equal(snap.journey.seatId, 'theme-cruise');
    assert.equal(snap.journey.seat, '主题远洋游轮');
    assert.equal(snap.journey.seatMult, 3.2);
    assert.match(snap.home.staying, /主题远洋游轮/);

    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const panelCode = readFileSync(new URL(`../${pkg.cortico.webUiClient}`, import.meta.url), 'utf8');
    assert.match(panelCode, /d\.journey\.seat/, '面板顶部提示应渲染 journey.seat');
    assert.match(panelCode, /j\.seat/, '生活×旅行卡片应渲染 j.seat');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
