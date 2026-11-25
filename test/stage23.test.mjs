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
    assert.deepEqual(ui.panels.map((p) => p.id), ['now', 'career', 'wants', 'relation', 'market', 'diary', 'library']);

    const careerSnap = await ui.invoke('career', 'snapshot');
    assert.equal(careerSnap.career.certs.length, 9);
    assert.ok(careerSnap.career.recipes.some((r) => r.id === 'roast_sweet_potato' && r.unlocked === true));
    assert.ok(careerSnap.career.recipes.some((r) => r.id === 'tomato_beef_stew' && r.unlocked === false));

    const diarySnap = await ui.invoke('diary', 'snapshot');
    assert.ok(Array.isArray(diarySnap.todayTellable));
    assert.ok(Array.isArray(diarySnap.todayLedger));
    assert.ok(Array.isArray(diarySnap.days));

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

  // 小雪节气须明确标出「节气·小雪」，并避免「小雪小雨」拼接造成误解
  const xiaoxue = new Date('2026-11-24T06:00:00.000+08:00');
  const wXiao = weatherOf('兰州', xiaoxue);
  assert.equal(wXiao.solarTerm, '小雪');
  assert.match(wXiao.seasonNote, /节气·小雪/);
  assert.doesNotMatch(wXiao.seasonNote, /小雪小雨/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const panelSrc = readFileSync(new URL(`../${pkg.cortico.webUiClient}`, import.meta.url), 'utf8');
  assert.match(panelSrc, /节气·\$\{d\.solarTerm\.name\}/);
  const envPromptSrc = readFileSync(new URL('../ENV_PROMPT.md', import.meta.url), 'utf8');
  assert.match(envPromptSrc, /天气与节气：\{\{life\.weather\}\}/);

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
      if (req.url?.startsWith('/town/stalls') && req.method === 'GET') {
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
      if (req.url?.startsWith('/town/stalls') && req.method !== 'POST') {
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
      if (req.url?.startsWith('/town/stalls') && req.method !== 'POST') {
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
  assert.match(panelCode, /d\.otherStalls/, 'market 面板应展示鱼市街街坊在售摊位');
  assert.match(panelCode, /resolveStallEffects/, '面板应按摊位价格动态推导默认属性');
  const relBlock = panelCode.slice(panelCode.indexOf('relation: {'), panelCode.indexOf('market: {'));
  assert.ok(relBlock.length > 0, '应定位到 relation 面板块');
  assert.doesNotMatch(relBlock, /marketCard|d\.otherStalls|《街口黑板报》/, '「你和它」页签不再重复渲染鱼市街卡片');
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
      price: 50,
      stock: 2,
      freshVeg: false,
      note: '刚蒸好的',
      effects: { food: 20, fun: 12, social: 28, knowledge: 1, fitness: 0.5 },
    },
    {
      id: 'st-plain',
      seller: '老周',
      kind: 'goods',
      item: '手工芝麻饼',
      price: 40,
      stock: 2,
      freshVeg: false,
    },
    {
      id: 'st-cheap',
      seller: '小虾',
      kind: 'goods',
      item: '糖炒栗子',
      price: 5,
      stock: 3,
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
      if (req.url?.startsWith('/town/stalls') && req.method === 'GET') {
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
    assert.match(bulletin, /阿青的「红豆糯米糕」50元/, 'envPrompt life.bulletin 应直曝在售摊位');
    assert.match(bulletin, /手工芝麻饼」40元（饱腹\+56\/娱乐\+24）/, '无 effects 的高价摊位应按 2x 预算自动分配');
    assert.match(bulletin, /糖炒栗子」5元（饱腹\+7\/娱乐\+3）/, '无 effects 的低价摊位按定价线性缩放');

    const statusTool = world.tools().find((t) => t.name === 'life_status');
    const stText = (await statusTool.handler({})).text;
    assert.match(stText, /鱼市街在售摊位：.*红豆糯米糕/, 'life_status 应直接展示鱼市街在售摊位');

    const relSnap = await world.webUi().invoke('relation', 'snapshot');
    assert.equal(relSnap.otherStalls.length, 3);

    const stallTool = world.tools().find((t) => t.name === 'life_stall');
    const fitStallRes = await stallTool.handler({
      item: '握力圈',
      price: 1,
      stock: 2,
      effects: { fitness: 0.05 },
    });
    assert.match(fitStallRes.text, /体质\+0\.05/, '1 元摊位应精确支持 +0.05 体质');

    const stallRes = await stallTool.handler({
      item: '手擀面',
      price: 1,
      stock: 2,
      effects: { food: 80, fun: 80, knowledge: 10, fitness: 5 },
    });
    assert.match(stallRes.text, /手擀面/);
    const postedList = stalls.filter((s) => s.id === 'st-mine');
    const posted = postedList[postedList.length - 1];
    assert.ok(posted?.effects, '挂摊应透传自定义 effects');
    const postedCost = (posted.effects.food || 0) + (posted.effects.energy || 0) + (posted.effects.clean || 0)
      + (posted.effects.fun || 0) + (posted.effects.social || 0)
      + (posted.effects.knowledge || 0) * 20 + (posted.effects.fitness || 0) * 40;
    assert.ok(postedCost > 0 && postedCost <= 2.001, `1 元挂摊加权点数应在 2 预算内且不归零，实际 ${postedCost}`);

    const buyTool = world.tools().find((t) => t.name === 'life_buy');
    const buyFxRes = await buyTool.handler({ stall_id: 'st-fx' });
    assert.match(buyFxRes.text, /好心情/);
    assert.match(buyFxRes.text, /体质\+0\.5/);
    const s1 = store.load(nowFixed).state;
    assert.equal(Math.round(s1.vitals.food), 38, '自定义 food +20');
    assert.equal(Math.round(s1.vitals.fun), 32, '自定义 fun +12');
    assert.equal(Math.round(s1.vitals.social), 42, 'social 28 叠邻里寒暄 +4 => +32（10 -> 42）');
    assert.equal(s1.knowledge, 6, '自定义 knowledge +1');
    assert.equal(s1.fitness, 25.5, '自定义 fitness +0.5 精确保存为小数');
    const nowSnap1 = await world.webUi().invoke('now', 'snapshot');
    assert.equal(nowSnap1.fitness, 25.5, '面板快照应保留小数体质 25.5');
    assert.equal(s1.moodlets.some((m) => m.source === 'lonely'), false, '社交回到 >= 30 应清除 lonely');
    assert.equal(s1.moodlets.some((m) => m.source === 'town-buy' && m.kind === 'good'), true, '买摊应挂正向心情条');

    await buyTool.handler({ stall_id: 'st-plain' });
    const s2 = store.load(nowFixed).state;
    assert.equal(Math.round(s2.vitals.food), 94, '40 元无 effects 摊位按价默认 food +56（38 -> 94）');
    assert.equal(Math.round(s2.vitals.fun), 56, '40 元无 effects 摊位按价默认 fun +24（32 -> 56）');
    assert.equal(Math.round(s2.vitals.social), 46, '另叠邻里寒暄 +4（42 -> 46）');
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

test('审查回归：启动首次 /town/stalls 失败不锁死 15 分钟冷却，打开 relation 面板当场补拉在售摊位', async () => {
  const dir = mkDir();
  let stallsHits = 0;
  const srv = createServer((req, res) => {
    if (req.url === '/town/info') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ town: 'lanzhou', name: '兰州', origin: '黄河穿城', streets: ['南滨河路'], rules: [] }));
      return;
    }
    if (req.url === '/town/join' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, town: 'lanzhou', name: '兰州', street: '南滨河路' }));
      return;
    }
    if (req.url?.startsWith('/town/stalls') && req.method === 'GET') {
      stallsHits += 1;
      if (stallsHits === 1) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        stalls: [{ id: 'st-1', seller: '阿青', kind: 'goods', item: '烤红薯', price: 9, stock: 3 }],
        bulletin: ['鱼市街正常营业'],
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
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  try {
    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, townUrl: `http://127.0.0.1:${port}` },
      dataDir: dir,
      botName: '大肥鱼',
    });
    await world.start(silentHost);
    for (let i = 0; i < 40 && stallsHits < 1; i++) await new Promise((r) => setTimeout(r, 25));
    assert.ok(stallsHits >= 1, '启动时已触发一次后台拉取');

    const relSnap = await world.webUi().invoke('relation', 'snapshot');
    assert.equal(relSnap.otherStalls.length, 1, '打开 relation 面板应当场补拉并展示在售摊位');
    assert.equal(relSnap.otherStalls[0].item, '烤红薯');
    assert.equal(relSnap.bulletin[0], '鱼市街正常营业');

    await world.stop();
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('二期（P2）：broadcastLife 透出驾照 certs 且 statusText / envPromptVars 准确渲染三种慢旅行在途状态', async () => {
  const dir = mkDir();
  const nowFixed = new Date('2026-11-24T04:00:00Z');
  try {
    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => nowFixed,
    });
    await world.start(silentHost);
    world.state.job.certs = ['驾照'];
    world.broadcastLife(nowFixed);
    const pub = JSON.parse(readFileSync(join(dir, 'life-public.json'), 'utf8'));
    assert.deepEqual(pub.certs, ['驾照']);

    for (const sample of [
      { modeId: 'train', seatId: 'scenic-train', seat: '全景观光专列', re: /全景观光专列/ },
      { modeId: 'car', seatId: 'campervan', seat: '房车自驾', re: /房车自驾/ },
      { modeId: 'ship', seatId: 'river-cruise', seat: '内河峡谷游轮', re: /内河峡谷游轮/ },
    ]) {
      writeFileSync(join(dir, 'journey-public.json'), JSON.stringify({
        schema: 'coopani-journey-public/v1',
        updatedAt: nowFixed.toISOString(),
        phase: 'traveling',
        city: { id: 'chengdu', name: '成都', tz: 'Asia/Shanghai' },
        leg: {
          fromId: 'chengdu', toId: 'lasa',
          fromName: '成都', toName: '拉萨',
          modeId: sample.modeId,
          seatId: sample.seatId,
          seat: sample.seat,
          departedAt: new Date(nowFixed.getTime() - 3_600_000).toISOString(),
          arriveAt: new Date(nowFixed.getTime() + 10 * 3_600_000).toISOString(),
        },
      }), 'utf8');
      const vars = world.envPromptVars();
      const statusOut = await world.tools().find((t) => t.name === 'life_status').handler({});
      assert.match(vars['life.here'], sample.re);
      assert.match(vars['life.who'], sample.re);
      assert.match(String(statusOut.text), sample.re);
      assert.doesNotMatch(vars['life.here'] + String(statusOut.text), /她/);
    }

    await world.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('经济闭环与 UI（P2.5）：种菜进储物篮 → 五赛道扣本摆摊 → 跨鱼买菜再加工 → 成交真入账与 market 面板', async () => {
  const dirSeller = mkDir();
  const dirBuyer = mkDir();
  let curNow = new Date('2026-11-24T09:00:00+08:00');
  const stalls = [];
  const deals = [];
  let seq = 1;

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
      if (req.url?.startsWith('/town/stalls') && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          stalls: stalls.filter((s) => s.stock > 0),
          bulletin: ['鱼市街鲜蔬开市'],
        }));
        return;
      }
      if (req.url === '/town/stalls' && req.method === 'POST') {
        const id = `st-e2e-${seq++}`;
        const created = {
          id,
          uid: p.uid,
          seller: p.pet,
          kind: p.kind || 'goods',
          item: p.item,
          price: Number(p.price),
          stock: Number(p.stock || 3),
          freshVeg: Boolean(p.freshVeg),
          ...(p.category ? { category: p.category } : {}),
          note: p.note || '',
          ...(p.effects ? { effects: p.effects } : {}),
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
        deals.push({
          id: `dl-e2e-${seq++}`,
          stallId: st.id,
          sellerUid: st.uid,
          item: st.item,
          qty: 1,
          buyerPet: p.buyer || '大肥鱼',
          note: p.note || '',
          seen: false,
          at: curNow.toISOString(),
          // 刻意测试首笔传 unitPrice、次笔留 0 走本地 stallRecords 单价兜底
          unitPrice: st.item.includes('随笔') ? 0 : st.price,
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          item: st.item,
          price: st.price,
          seller: st.seller,
          freshVeg: Boolean(st.freshVeg),
          ...(st.category ? { category: st.category } : {}),
          ...(st.effects ? { effects: st.effects } : {}),
        }));
        return;
      }
      if (req.url?.startsWith('/town/deals')) {
        const u = new URL(req.url, 'http://127.0.0.1');
        const uid = u.searchParams.get('uid');
        const ack = u.searchParams.get('ack') === '1';
        const mine = deals.filter((d) => d.sellerUid === uid);
        const unseen = mine.filter((d) => !d.seen).length;
        const out = mine.map((d) => ({ ...d }));
        if (ack) for (const d of mine) d.seen = true;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, deals: out, unseen }));
        return;
      }
      res.writeHead(404); res.end();
    });
  });

  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  try {
    writeFileSync(join(dirSeller, 'meet-uid.txt'), 'aaaaaaaaaaaaaaaaaaaaaaaa', 'utf8');
    writeFileSync(join(dirBuyer, 'meet-uid.txt'), 'bbbbbbbbbbbbbbbbbbbbbbbb', 'utf8');

    const wSeller = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, townUrl: `http://127.0.0.1:${port}` },
      dataDir: dirSeller,
      botName: '菜农鱼',
      now: () => curNow,
    });
    const wBuyer = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, townUrl: `http://127.0.0.1:${port}` },
      dataDir: dirBuyer,
      botName: '厨师鱼',
      now: () => curNow,
    });
    await wSeller.start(silentHost);
    await wBuyer.start(silentHost);

    const farmTool = wSeller.tools().find((t) => t.name === 'life_farm');
    const sellerStall = wSeller.tools().find((t) => t.name === 'life_stall');
    const sellerDeals = wSeller.tools().find((t) => t.name === 'life_deals');
    const buyerBuy = wBuyer.tools().find((t) => t.name === 'life_buy');
    const buyerStall = wBuyer.tools().find((t) => t.name === 'life_stall');

    // A) 菜农未种菜直接硬挂 produce 鲜蔬摊被拦；先种香葱 → 4天后收成入储物篮
    const blockedProduce = await sellerStall.handler({ item: '自种香葱', price: 12, stock: 2, category: 'produce' });
    assert.match(blockedProduce.text, /自产鲜蔬储备不足/);

    const planted = await farmTool.handler({ action: 'plant', seed: '香葱' });
    assert.match(planted.text, /种进家里种植槽/);
    curNow = new Date(curNow.getTime() + 97 * 3_600_000);
    const harvested = await farmTool.handler({ action: 'harvest' });
    assert.match(harvested.text, /收成了.*香葱.*放进家里储物篮/);

    // B) 菜农挂 2 份鲜蔬（每份 12 元）仅扣 3 元打包费 + 精力，并耗掉储物篮
    const sellerCashBeforeStall = wSeller.state.money.cash;
    const postedProduce = await sellerStall.handler({
      item: '水灵香葱一把',
      price: 12,
      stock: 2,
      category: 'produce',
      fresh_veg: true,
    });
    assert.match(postedProduce.text, /摊子挂上鱼市街了：水灵香葱一把.*备货本钱 3 元/);
    assert.equal(wSeller.state.money.cash, sellerCashBeforeStall - 3);
    assert.equal(wSeller.state.pantry.length, 0, '摆鲜蔬摊后储物篮自产香葱应已扣除');

    // C) 菜农见识达标后同时写随笔挂 writing 摊（定价 30 元×2 份，扣纸笔底费 8 + 印刷 18 = 26 元）
    wSeller.state.knowledge = 30;
    const cashBeforeWrite = wSeller.state.money.cash;
    const postedWrite = await sellerStall.handler({
      item: '芦花塘随笔小册',
      price: 30,
      stock: 2,
      category: 'writing',
    });
    assert.match(postedWrite.text, /\[写作出版\].*备货本钱 26 元/);
    assert.equal(wSeller.state.money.cash, cashBeforeWrite - 26);

    // D) 厨师鱼买走 1 份鲜蔬 + 1 本随笔，鲜蔬进入厨师储物篮（+2 份）
    const vegStallId = stalls.find((s) => s.item === '水灵香葱一把').id;
    const bookStallId = stalls.find((s) => s.item === '芦花塘随笔小册').id;
    const buyVeg = await buyerBuy.handler({ stall_id: vegStallId });
    assert.match(buyVeg.text, /已收入储物篮/);
    assert.equal(wBuyer.state.pantry.length, 1);
    assert.equal(wBuyer.state.pantry[0].qty, 2);
    assert.equal(wBuyer.state.pantry[0].fromSeller, '菜农鱼');
    await buyerBuy.handler({ stall_id: bookStallId });

    // E) 厨师鱼先被无证高价料理拦下；考下厨师证后用刚买的鲜蔬摆 2 份 30 元手擀面仅扣 6 元油盐燃料费
    const blockedFood = await buyerStall.handler({ item: '招牌葱油面', price: 30, stock: 2, category: 'food' });
    assert.match(blockedFood.text, /厨师证/);
    wBuyer.state.job.certs.push('厨师证');
    const buyerCashBeforeFood = wBuyer.state.money.cash;
    const postedFood = await buyerStall.handler({ item: '招牌葱油面', price: 30, stock: 2, category: 'food' });
    assert.match(postedFood.text, /备货本钱 6 元.*用储物篮鲜蔬 2 份/);
    assert.equal(wBuyer.state.money.cash, buyerCashBeforeFood - 6);
    assert.equal(wBuyer.state.pantry.length, 0, '摆料理摊耗尽购买的 2 份鲜蔬');

    // F) 菜农鱼调 life_deals 收回 12 + 30 = 42 元真入账，且再调一次严格幂等不重复加钱
    const cashBeforeDeals = wSeller.state.money.cash;
    const dealsRes1 = await sellerDeals.handler({});
    assert.match(dealsRes1.text, /进账 \+12 元/);
    assert.match(dealsRes1.text, /进账 \+30 元/);
    assert.match(dealsRes1.text, /本次新入账 \+42 元/);
    assert.equal(wSeller.state.money.cash, cashBeforeDeals + 42, '菜农必须真正收到 42 元货款');

    const dealsRes2 = await sellerDeals.handler({});
    assert.equal(wSeller.state.money.cash, cashBeforeDeals + 42, '重复查 life_deals 绝不能重复加钱');
    assert.doesNotMatch(dealsRes2.text, /本次新入账/);

    // G) 验证 market 面板接口与当前 panel UI 讲解内容（含 18 种种子 + 手动种菜/养殖）
    const mktSnap = await wSeller.webUi().invoke('market', 'snapshot');
    assert.equal(mktSnap.seeds.length, 18);
    assert.equal(mktSnap.animals.length, 4);
    assert.equal(mktSnap.stallRules.length, 5);
    assert.equal(mktSnap.deals.some((d) => d.income === 30), true);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const panelSrc = readFileSync(new URL(`../${pkg.cortico.webUiClient}`, import.meta.url), 'utf8');
    assert.match(panelSrc, /career:\s*\{/, '面板必须包含 career 页签');
    assert.match(panelSrc, /market:\s*\{/, '面板必须包含 market 页签');
    assert.match(panelSrc, /diary:\s*\{/, '面板必须包含合并后的 diary 页签');
    assert.match(panelSrc, /农牧场（支持下方直接点击种菜与养殖）/);
    assert.match(panelSrc, /五大赛道门槛、本钱明细与常用对话示范/);
    assert.doesNotMatch(panelSrc, /\.slice\(11,\s*16\)|\.slice\(0,\s*16\)/);
    assert.doesNotMatch(panelSrc, /createElement\([^)]*,/, '不得把 className 作为第二参数误传给 document.createElement');

    // H) 面板手动操作种菜与养殖闭环（array args 契约）
    const uiSeller = wSeller.webUi();
    const plantUi = await uiSeller.invoke('market', 'plant', [{ seed: 'sweet_potato' }]);
    assert.equal(plantUi.ok, true);
    assert.equal(plantUi.farm.plots.length, 1);
    const waterUi = await uiSeller.invoke('market', 'water', [{ plotId: plantUi.farm.plots[0].id }]);
    assert.equal(waterUi.ok, true);

    const rentRanchUi = await uiSeller.invoke('market', 'rentRanch', [{}]);
    assert.equal(rentRanchUi.ok, true);
    assert.equal(rentRanchUi.ranch.leased, true);
    const buyCowUi = await uiSeller.invoke('market', 'ranchBuy', [{ animal: 'dairy_cow' }]);
    assert.equal(buyCowUi.ok, true);
    const feedCowUi = await uiSeller.invoke('market', 'ranchFeed', [{ penId: buyCowUi.ranch.pens[0].id }]);
    assert.equal(feedCowUi.ok, true);

    const hireUi = await uiSeller.invoke('market', 'hireHelper', [{ mode: 'full' }]);
    assert.equal(hireUi.ok, true);
    assert.equal(hireUi.farmHelper.mode, 'full');
    assert.equal(hireUi.farmHelper.dailyWage, 20);
    const unhireUi = await uiSeller.invoke('market', 'unhireHelper', [{}]);
    assert.equal(unhireUi.ok, true);
    assert.equal(unhireUi.farmHelper.mode, 'off');

    await wSeller.stop();
    await wBuyer.stop();
  } finally {
    srv.close();
    rmSync(dirSeller, { recursive: true, force: true });
    rmSync(dirBuyer, { recursive: true, force: true });
  }
});

test('1.4.2 端到端闭环：雇主发邻里农牧委托 → 街坊真鱼接单挣钱不扣本钱 → 雇主查 deals 免费代管绝不重复进账', async () => {
  const dirA = mkDir();
  const dirB = mkDir();
  let curNow = new Date('2026-12-01T10:00:00+08:00');
  const stalls = [];
  const deals = [];
  let seq = 1;

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
      if (req.url?.startsWith('/town/stalls') && req.method === 'GET') {
        const u = new URL(req.url, 'http://127.0.0.1');
        const inc = u.searchParams.get('include_errands') === '1';
        const visible = stalls.filter((s) => s.stock > 0 && (inc || s.kind !== 'errand'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, stalls: visible, bulletin: [] }));
        return;
      }
      if (req.url === '/town/stalls' && req.method === 'POST') {
        const id = `err-e2e-${seq++}`;
        const created = {
          id,
          uid: p.uid,
          seller: p.pet,
          kind: p.kind === 'errand' ? 'errand' : 'goods',
          item: p.item,
          price: Number(p.price),
          stock: Number(p.stock || 1),
          freshVeg: false,
          note: p.note || '',
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
        if (st.uid === p.buyerUid) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'own stall' }));
          return;
        }
        st.stock -= 1;
        deals.push({
          id: `err-dl-${seq++}`,
          stallId: st.id,
          sellerUid: st.uid,
          item: st.item,
          qty: 1,
          buyerPet: p.buyer || '热心邻鱼',
          note: p.note || '',
          seen: false,
          at: curNow.toISOString(),
          unitPrice: st.price,
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, item: st.item, price: st.price, seller: st.seller, freshVeg: false, qty: 1 }));
        return;
      }
      if (req.url?.startsWith('/town/deals')) {
        const u = new URL(req.url, 'http://127.0.0.1');
        const uid = u.searchParams.get('uid');
        const ack = u.searchParams.get('ack') === '1';
        const mine = deals.filter((d) => d.sellerUid === uid);
        const unseen = mine.filter((d) => !d.seen).length;
        const out = mine.map((d) => ({ ...d }));
        if (ack) for (const d of mine) d.seen = true;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, deals: out, unseen }));
        return;
      }
      res.writeHead(404); res.end();
    });
  });

  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  try {
    writeFileSync(join(dirA, 'meet-uid.txt'), 'cccccccccccccccccccccccc', 'utf8');
    writeFileSync(join(dirB, 'meet-uid.txt'), 'dddddddddddddddddddddddd', 'utf8');

    const wA = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, townUrl: `http://127.0.0.1:${port}` },
      dataDir: dirA,
      botName: '雇主鱼A',
      now: () => curNow,
    });
    const wB = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, townUrl: `http://127.0.0.1:${port}` },
      dataDir: dirB,
      botName: '邻鱼B',
      now: () => curNow,
    });
    await wA.start(silentHost);
    await wB.start(silentHost);

    // 雇主鱼A 置办 1 块红薯 + 1 只散养土鸡（老小区），然后发邻里代管
    const moveA = wA.tools().find((t) => t.name === 'life_move');
    await moveA.handler({ tier: 'old' });
    wA.state.home.monthly = 0;
    wB.state.home.monthly = 0;
    const farmA = wA.tools().find((t) => t.name === 'life_farm');
    const ranchA = wA.tools().find((t) => t.name === 'life_ranch');
    const dealsA = wA.tools().find((t) => t.name === 'life_deals');
    const buyB = wB.tools().find((t) => t.name === 'life_buy');

    await farmA.handler({ action: 'plant', seed: '红薯' });
    await ranchA.handler({ action: 'buy', animal: '散养土鸡' });

    const aCashBeforeHire = wA.state.money.cash;
    const hireRes = await farmA.handler({ action: 'hire', helper_mode: 'care', prefer_neighbor: true });
    assert.match(hireRes.text, /邻里代管委托/);
    assert.equal(stalls.length, 1);
    assert.equal(stalls[0].kind, 'errand');
    // 1菜+1牧 => care 报价 = min(9, 6 + floor(2/2)) = 7 元，耗时 = 12 + 5 + 8 = 25 分钟
    assert.equal(stalls[0].price, 7);
    assert.equal(wA.state.money.cash, aCashBeforeHire - 7, '雇主先托管预扣 7 元邻里工钱而非扣系统 12 元');

    // 邻鱼B 浏览并接单：绝不扣 B 的钱，开启 25 分钟代管活动
    const bList = await buyB.handler({});
    assert.match(bList.text, /\[邻里代管委托·挣钱\]/);
    const bCashBefore = wB.state.money.cash;
    const bAccept = await buyB.handler({ stall_id: stalls[0].id });
    assert.match(bAccept.text, /不用自己花钱.*25 分钟.*\+7 元/);
    assert.equal(wB.state.money.cash, bCashBefore, '接委托不扣接单鱼钱包');
    assert.equal(wB.state.activity?.id, 'neighbor_errand');

    // 时间推过 26 分钟：邻鱼B 完工实得 +7 元，且 job.lastAt 依然空白不占正式打工日限
    curNow = new Date(curNow.getTime() + 26 * 60_000);
    const bStatus = wB.tools().find((t) => t.name === 'life_status');
    await bStatus.handler({});
    assert.equal(wB.state.money.cash, bCashBefore + 7, '接单鱼完工实得 +7 元');
    assert.equal(wB.state.job.lastAt, '', '邻里零工不得占用今日正式打工日限');

    // 雇主鱼A 查 deals：绝不能当成卖货再给 A 加 7 元，而是只扣 2 元鸡饲料并免费完成今日浇水喂食
    const aCashBeforeDeals = wA.state.money.cash;
    const dealsRes = await dealsA.handler({});
    assert.match(dealsRes.text, /街坊帮忙照料，已自动完成今日农活/);
    assert.doesNotMatch(dealsRes.text, /进账 \+7 元/);
    assert.equal(wA.state.money.cash, aCashBeforeDeals - 2, '雇主只扣 2 元鸡饲料费，绝不重复加钱也不扣系统 12 元');
    assert.equal(wA.state.farm.plots[0].waterCount, 1, '红薯被邻鱼免费浇水 1 次');
    assert.equal(wA.state.ranch.pens[0].feedCount, 1, '土鸡被邻鱼免费喂食 1 次');
    assert.equal(wA.state.farmHelper.pendingErrand, null);

    // 验证邻鱼代管完毕后当天再推进时间也不会扣自动照料费
    curNow = new Date(curNow.getTime() + 3_600_000);
    const aCashBeforeSameDayStatus = wA.state.money.cash;
    await ranchA.handler({ action: 'status' });
    assert.equal(wA.state.money.cash, aCashBeforeSameDayStatus, '邻鱼帮完当天后续推进绝不再扣自动照料费');

    // 先停雇常驻帮手 → 次日单次发 post_errand 预扣 → 7h 超时自动原路退预扣 → 即使旧委托稍晚被人点走也绝不误加钱
    await ranchA.handler({ action: 'unhire' });
    curNow = new Date(curNow.getTime() + 24 * 3_600_000); // 次日
    const cashBeforePostLater = wA.state.money.cash;
    const postLater = await ranchA.handler({ action: 'post_errand', helper_mode: 'care' });
    assert.match(postLater.text, /已在鱼市街挂出邻里代管委托/);
    const lateStallId = stalls[1].id;
    assert.equal(wA.state.money.cash, cashBeforePostLater - stalls[1].price, '单次发邻里委托预扣对应工钱');
    curNow = new Date(curNow.getTime() + 7 * 3_600_000); // 7h 超时自动退预扣
    await ranchA.handler({ action: 'status' });
    assert.equal(wA.state.money.cash, cashBeforePostLater, '未雇常驻帮手时单次委托超 6h 无人接同样自动原路退还预扣');
    // 模拟旧端缓存点走过期前还挂着的那一单
    deals.push({
      id: `err-dl-${seq++}`,
      stallId: lateStallId,
      sellerUid: 'cccccccccccccccccccccccc',
      item: stalls[1].item,
      qty: 1,
      buyerPet: '迟到邻鱼C',
      note: '',
      seen: false,
      at: curNow.toISOString(),
      unitPrice: stalls[1].price,
    });
    const cashBeforeLateDeal = wA.state.money.cash;
    const lateDealsRes = await dealsA.handler({});
    assert.equal(wA.state.money.cash, cashBeforeLateDeal, '超时后的旧委托再成交也绝不误当卖货进账');
    assert.doesNotMatch(lateDealsRes.text, /本次新入账/);

    // 校验老客户端不带 ?include_errands=1 拉 /town/stalls 看不到任何 errand；带参数的新客户端才看得到
    stalls.push({ id: 'err-only-99', uid: 'cccccccccccccccccccccccc', seller: '雇主鱼A', kind: 'errand', item: '农牧代管·照料(1菜1牧/25分)', price: 7, stock: 1, freshVeg: false, note: '' });
    const legacyResp = await fetch(`http://127.0.0.1:${port}/town/stalls`).then((r) => r.json());
    assert.equal(legacyResp.stalls.some((s) => s.kind === 'errand'), false, '老版本客户端不传 include_errands=1 时必须过滤掉委托单');

    // 校验 ⑥：别人真挂了一个以「农牧代管·」开头的普通货物（stallId 不在自己委托列表中），卖出照常进账不被误吞
    const sellerStallA = wA.tools().find((t) => t.name === 'life_stall');
    const decoyRes = await sellerStallA.handler({ item: '农牧代管·手写小手册', price: 15, stock: 1, category: 'writing' });
    assert.match(decoyRes.text, /摊子挂上鱼市街了/);
    const decoyStall = stalls.find((s) => s.item === '农牧代管·手写小手册');
    deals.push({
      id: `goods-dl-${seq++}`,
      stallId: decoyStall.id,
      sellerUid: 'cccccccccccccccccccccccc',
      item: decoyStall.item,
      qty: 1,
      buyerPet: '邻鱼B',
      note: '',
      seen: false,
      at: curNow.toISOString(),
      unitPrice: 15,
    });
    const cashBeforeDecoyDeals = wA.state.money.cash;
    await dealsA.handler({});
    assert.equal(wA.state.money.cash, cashBeforeDecoyDeals + 15, '非本机发出的同名前缀普通商品必须正常给卖家入账');

    // 校验 ④：life_stall 摆菜谱成品菜省略 price 自动套用 suggestedPrice（炭烤红薯 = 12 元）
    const cookA = wA.tools().find((t) => t.name === 'life_cook');
    wA.state.pantry.push({
      id: 'sp-test',
      itemId: 'sweet_potato',
      kind: 'starch',
      name: '蜜薯红薯',
      qty: 2,
      freshVeg: true,
      origin: 'home-grown',
      unitCost: 3,
      acquiredAt: curNow.toISOString(),
    });
    const cookedA = await cookA.handler({ action: 'cook', recipe: '炭烤红薯', mode: 'store' });
    assert.match(cookedA.text, /做好了 2 份「炭烤红薯」存进成品菜格/);
    const autoPriceStall = await sellerStallA.handler({ item: '炭烤红薯', stock: 2, category: 'food' });
    assert.match(autoPriceStall.text, /定价 12 元.*已自动按菜谱参考摊价 12 元定价/);

    await wA.stop();
    await wB.stop();
  } finally {
    srv.close();
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

test('1.4.2 面板自动化回归：无头 DOM 桩挂载全部 7 个页签无异常渲染', async () => {
  const dir = mkDir();
  const prevDoc = globalThis.document;

  class FakeNode {
    constructor(nodeType, tagName = '') {
      this.nodeType = nodeType;
      this.tagName = tagName;
      this.children = [];
      this.parentNode = null;
      this.attrs = {};
      this.style = { cssText: '' };
      this.className = '';
      this.id = '';
      this.listeners = {};
      this._text = '';
      this.hidden = false;
      this.disabled = false;
      this.checked = false;
      this.value = '';
      this.type = '';
      this.title = '';
    }
    get textContent() {
      if (this.nodeType === 3) return this._text;
      return this._text + this.children.map((c) => c.textContent).join('');
    }
    set textContent(v) {
      this._text = String(v ?? '');
      this.children = [];
    }
    get innerHTML() {
      return '';
    }
    set innerHTML(v) {
      if (!v) {
        this.children = [];
        this._text = '';
      }
    }
    append(...nodes) {
      for (const n of nodes) {
        if (typeof n === 'string') this.children.push(new FakeText(n));
        else if (n) { n.parentNode = this; this.children.push(n); }
      }
    }
    prepend(...nodes) {
      const wrapped = nodes.map((n) => (typeof n === 'string' ? new FakeText(n) : n)).filter(Boolean);
      for (const n of wrapped) n.parentNode = this;
      this.children = [...wrapped, ...this.children];
    }
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'id') this.id = String(v);
    }
    addEventListener(ev, fn) {
      (this.listeners[ev] ??= []).push(fn);
    }
    remove() {
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      }
    }
    focus() {}
    select() {}
  }
  class FakeText {
    constructor(text) { this.nodeType = 3; this._text = String(text ?? ''); }
    get textContent() { return this._text; }
    set textContent(v) { this._text = String(v ?? ''); }
  }
  function findById(node, id) {
    if (!node || node.nodeType === 3) return null;
    if (node.id === id) return node;
    for (const c of node.children || []) {
      const hit = findById(c, id);
      if (hit) return hit;
    }
    return null;
  }
  function countNodes(node) {
    if (!node) return 0;
    if (node.nodeType === 3) return 1;
    let total = 1;
    for (const c of node.children || []) total += countNodes(c);
    return total;
  }

  const fakeDoc = {
    head: new FakeNode(1, 'head'),
    body: new FakeNode(1, 'body'),
    createElement(tag) { return new FakeNode(1, tag); },
    createTextNode(txt) { return new FakeText(txt); },
    getElementById(id) { return findById(this.head, id) || findById(this.body, id); },
    execCommand() { return true; },
  };
  fakeDoc.head.ownerDocument = fakeDoc;
  fakeDoc.body.ownerDocument = fakeDoc;

  globalThis.document = fakeDoc;
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const panelMod = await import(`../${pkg.cortico.webUiClient}?test=${Date.now()}`);
    const panels = panelMod.default.panels;
    const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼' });
    await world.start(silentHost);
    const ui = world.webUi();

    const tabNames = ['now', 'career', 'wants', 'relation', 'market', 'diary', 'library'];
    assert.deepEqual(Object.keys(panels), tabNames);

    for (const tab of tabNames) {
      const root = new FakeNode(1, 'div');
      root.ownerDocument = fakeDoc;
      fakeDoc.body.append(root);
      await panels[tab].mount({
        root,
        language: 'zh',
        invoke: (method, args) => ui.invoke(tab, method, ...(args ?? [])),
        timeout: () => 0,
      });
      assert.equal(countNodes(root) > 5, true, `页签 ${tab} 必须渲染出非空 DOM 树`);
    }
    await world.stop();
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    rmSync(dir, { recursive: true, force: true });
  }
});
