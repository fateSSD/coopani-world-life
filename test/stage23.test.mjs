import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { LifeWorld } = await import('../src/world.ts');
const { LIFE_DEFAULTS, parseTownUrls } = await import('../src/config.ts');
const {
  freshState, advance, applyAct, applySpend, applyWork, applyCert, applyLearn, applyMove, normalize,
  snapshot, weatherOf, fullMarketPrices, localDateKey, StateStore, moodSummary, certChance, ACTS, MAX_PENDING,
  skillPayMultiplier,
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
    assert.equal(careerSnap.career.certs.length, 10);
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
  const expectedSkillPay = Math.round(135 * skillPayMultiplier(12));
  assert.equal(res.completed[0].workEarned, Math.round(expectedSkillPay * 1.6));
  assert.match(res.completed[0].shiftSummary ?? '', /11 单/);
  assert.equal(s.money.cash - cashBeforeDone, Math.round(expectedSkillPay * 1.6));
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

test('审查回归：睡眠回精不再与 streetDecay 抵消，精力 +15%/+5% 街道显著高于无加成与 -10% 街道', async () => {
  const { BUILTIN_TOWN } = await import('../src/bridge.ts');
  const yantan = BUILTIN_TOWN.streetProfiles.find((p) => p.name === '雁滩路');
  const nanbin = BUILTIN_TOWN.streetProfiles.find((p) => p.name === '南滨河路');
  const zhangye = BUILTIN_TOWN.streetProfiles.find((p) => p.name === '张掖路');
  assert.equal(yantan?.mods?.energy, 15);
  assert.equal(nanbin?.mods?.energy, 5);
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
  const eTop = runSleep4h(yantan.mods);
  const ePlus = runSleep4h(nanbin.mods);
  const eMinus = runSleep4h(zhangye.mods);

  assert.equal(eNone, 70, '无加成白昼睡 4 小时应回 40 点（30 -> 70）');
  assert.equal(eTop, 76, '精力 +15% 街道睡 4 小时应回 46 点（30 -> 76）');
  assert.equal(ePlus, 72, '精力 +5% 街道睡 4 小时应回 42 点（30 -> 72）');
  assert.equal(eMinus, 66, '精力 -10% 街道睡 4 小时应回 36 点（30 -> 66）');
  assert.ok(eTop > ePlus && ePlus > eNone && eNone > eMinus);
});

test('审查回归：DEFAULT_STREET_PROFILES 结构完整（8 街含正宁路与体质加成）且与服务端 worker.js 一致（不漂移）', async () => {
  const { BUILTIN_TOWN } = await import('../src/bridge.ts');
  assert.equal(BUILTIN_TOWN.streetProfiles.length, 8);
  const weights = { work: 1.6, energy: 1.5, food: 1.2, fun: 1.0, clean: 0.9, fit: 0.9, social: 0.8, know: 0.8 };
  for (const p of BUILTIN_TOWN.streetProfiles) {
    assert.ok(p.name && p.desc && p.desc.length >= 10, `街道画像不完整：${p.name}`);
    assert.ok(p.mods && Object.keys(p.mods).length > 0, `街道缺乏 mods：${p.name}`);
    const net = Math.round(
      Object.entries(p.mods).reduce((acc, [k, v]) => acc + Number(v) * (weights[k] ?? 1), 0) * 10,
    ) / 10;
    assert.ok(net >= 12 && net <= 15, `街道 ${p.name} 加权净分 ${net} 越出 [12, 15]`);
    assert.equal(Boolean((p.mods.work ?? 0) > 0 && (p.mods.energy ?? 0) > 0), false, `街道 ${p.name} 不应工钱与精力同正`);
  }
  assert.ok(BUILTIN_TOWN.streetProfiles.some((p) => p.name === '正宁路' && p.mods.fit === -5));

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

test('街道体质双边倍率：fit 加成同时作用于锻炼收益与日常退化，且打工按开工街道快照防切街套利', async () => {
  const { BUILTIN_TOWN } = await import('../src/bridge.ts');
  const nanbin = BUILTIN_TOWN.streetProfiles.find((p) => p.name === '南滨河路');
  const zhengning = BUILTIN_TOWN.streetProfiles.find((p) => p.name === '正宁路');
  const yantan = BUILTIN_TOWN.streetProfiles.find((p) => p.name === '雁滩路');
  const qingyang = BUILTIN_TOWN.streetProfiles.find((p) => p.name === '庆阳路');

  // 1) 锻炼增长（workout +3 fit / 60min）
  const runWorkout = (streetMods) => {
    const t0 = new Date('2026-11-23T02:00:00Z');
    const t1 = new Date(t0.getTime() + 60 * 60_000);
    const s = freshState(t0);
    s.fitness = 25;
    s.vitals = { food: 90, energy: 90, clean: 90, fun: 90, social: 90 };
    const r = applyAct(s, 'workout', t0);
    assert.equal(r.ok, true);
    advance(s, t1, streetMods ? { streetMods } : undefined);
    return Number(s.fitness.toFixed(4));
  };
  assert.equal(runWorkout(undefined), 27.98);
  assert.equal(runWorkout(nanbin.mods), 28.433);
  assert.equal(runWorkout(zhengning.mods), 27.829);

  // 2) 24h 日常退化（0.02/h * 24 = 0.48）
  const runDecay24h = (streetMods) => {
    const t0 = new Date('2026-11-23T02:00:00Z');
    const t24 = new Date(t0.getTime() + 24 * 3_600_000);
    const s = freshState(t0);
    s.fitness = 50;
    advance(s, t24, streetMods ? { streetMods } : undefined);
    return Number(s.fitness.toFixed(4));
  };
  const fNone = runDecay24h(undefined);
  const fPlus = runDecay24h(nanbin.mods);
  const fMinus = runDecay24h(zhengning.mods);
  assert.equal(fNone, 49.52);
  assert.equal(fPlus, 49.592);
  assert.equal(fMinus, 49.496);
  assert.ok(fPlus > fNone && fNone > fMinus);

  // 3) 开工街道快照防收工前切街套利（护工日薪 210，无浮动）
  const tStart = new Date('2026-11-23T02:00:00Z');
  const tEnd = new Date(tStart.getTime() + 360 * 60_000);
  const sLow = freshState(tStart);
  sLow.job.certs = ['护工证'];
  sLow.vitals = { food: 90, energy: 90, clean: 90, fun: 90, social: 90 };
  const wLow = applyWork(sLow, '护工', tStart, 'home', yantan.mods);
  assert.equal(wLow.ok, true);
  // 收工时切到庆阳路（work +15%），仍按开工时的雁滩路（work -10%）结算
  const resLow = advance(sLow, tEnd, { phase: 'home', streetMods: qingyang.mods });
  assert.equal(resLow.completed[0].workEarned, 189);

  const sHigh = freshState(tStart);
  sHigh.job.certs = ['护工证'];
  sHigh.vitals = { food: 90, energy: 90, clean: 90, fun: 90, social: 90 };
  const wHigh = applyWork(sHigh, '护工', tStart, 'home', qingyang.mods);
  assert.equal(wHigh.ok, true);
  // 收工时切回雁滩路，仍按开工时的庆阳路（work +15%）结算
  const resHigh = advance(sHigh, tEnd, { phase: 'home', streetMods: yantan.mods });
  assert.equal(resHigh.completed[0].workEarned, 241);
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

test('面板折叠栏在刷新重绘后保持展开状态并同步提示文案', async () => {
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
      this.open = false;
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
    get innerHTML() { return ''; }
    set innerHTML(v) { if (!v) { this.children = []; this._text = ''; } }
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
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }
    addEventListener(ev, fn) { (this.listeners[ev] ??= []).push(fn); }
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    }
    focus() {}
    select() {}
  }
  class FakeText {
    constructor(text) { this.nodeType = 3; this._text = String(text ?? ''); }
    get textContent() { return this._text; }
    set textContent(v) { this._text = String(v ?? ''); }
  }
  function findAll(node, pred, out = []) {
    if (!node || node.nodeType === 3) return out;
    if (pred(node)) out.push(node);
    for (const c of node.children || []) findAll(c, pred, out);
    return out;
  }

  const fakeDoc = {
    head: new FakeNode(1, 'head'),
    body: new FakeNode(1, 'body'),
    createElement(tag) { return new FakeNode(1, tag); },
    createTextNode(txt) { return new FakeText(txt); },
    getElementById(id) { return findAll(this.head, (n) => n.id === id)[0] || findAll(this.body, (n) => n.id === id)[0] || null; },
    execCommand() { return true; },
  };
  fakeDoc.head.ownerDocument = fakeDoc;
  fakeDoc.body.ownerDocument = fakeDoc;
  globalThis.document = fakeDoc;

  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const panelMod = await import(`../${pkg.cortico.webUiClient}?fold=${Date.now()}`);
    const panels = panelMod.default.panels;
    const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, botName: '大肥鱼' });
    await world.start(silentHost);
    const ui = world.webUi();

    // 1) career 页签：全部职业门槛与日薪清单
    const careerRoot = new FakeNode(1, 'div');
    careerRoot.ownerDocument = fakeDoc;
    fakeDoc.body.append(careerRoot);
    await panels.career.mount({
      root: careerRoot,
      language: 'zh',
      invoke: (method, args) => ui.invoke('career', method, ...(args ?? [])),
      timeout: () => 0,
    });
    const careerFold0 = findAll(careerRoot, (n) => n.tagName === 'details')[0];
    assert.ok(careerFold0);
    assert.equal(careerFold0.open, false);
    careerFold0.open = true;
    for (const fn of careerFold0.listeners.toggle || []) fn();
    const reloadCareerBtn = findAll(careerRoot, (n) => n.tagName === 'button' && n.textContent === '刷新')[0];
    assert.ok(reloadCareerBtn);
    for (const fn of reloadCareerBtn.listeners.click || []) await fn();
    await new Promise((r) => setTimeout(r, 20));
    const careerFold1 = findAll(careerRoot, (n) => n.tagName === 'details')[0];
    assert.equal(careerFold1.open, true, 'career 折叠栏刷新后必须保持展开');
    assert.ok(careerFold1.textContent.includes('点击收起岗位表'));

    // 2) market 页签：4 个折叠栏（攻略、规则表、种子、养殖）
    const marketRoot = new FakeNode(1, 'div');
    marketRoot.ownerDocument = fakeDoc;
    fakeDoc.body.append(marketRoot);
    await panels.market.mount({
      root: marketRoot,
      language: 'zh',
      invoke: (method, args) => ui.invoke('market', method, ...(args ?? [])),
      timeout: () => 0,
    });
    const marketFolds0 = findAll(marketRoot, (n) => n.tagName === 'details');
    assert.equal(marketFolds0.length, 4);
    for (const f of [marketFolds0[0], marketFolds0[2]]) {
      f.open = true;
      for (const fn of f.listeners.toggle || []) fn();
    }
    const reloadMarketBtn = findAll(marketRoot, (n) => n.tagName === 'button' && n.textContent === '刷新')[0];
    assert.ok(reloadMarketBtn);
    for (const fn of reloadMarketBtn.listeners.click || []) await fn();
    await new Promise((r) => setTimeout(r, 20));
    const marketFolds1 = findAll(marketRoot, (n) => n.tagName === 'details');
    assert.equal(marketFolds1[0].open, true, 'market 攻略折叠栏刷新后必须保持展开');
    assert.equal(marketFolds1[1].open, false, 'market 未点开的折叠栏保持收起');
    assert.equal(marketFolds1[2].open, true, 'market 种子目录折叠栏刷新后必须保持展开');
    assert.equal(marketFolds1[3].open, false);
    assert.ok(marketFolds1[0].textContent.includes('点击收起规则与攻略'));
    assert.ok(marketFolds1[2].textContent.includes('点击收起'));

    await world.stop();
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('1.5.1 省略 id 一次浇完多块菜/喂完多栏动物 + 傍晚 farm:care:pm 兜底提醒与 life.day 农牧待办提示', async () => {
  const dir = mkDir();
  try {
    let curNow = new Date('2026-11-27T10:00:00.000+08:00');
    const st = freshState(curNow);
    st.home.tier = 'new';
    st.money.cash = 1000;
    st.vitals.energy = 80;
    const tPlus = new Date(curNow.getTime() + 72 * 3_600_000).toISOString();
    st.farm.plots.push(
      { id: 'p-1', seedId: 'scallion', name: '香葱与罗勒', plantedAt: curNow.toISOString(), matureAt: tPlus, wateredAt: '', wateredDay: '', waterCount: 0, baseYield: 2, solarBonus: false, source: 'home' },
      { id: 'p-2', seedId: 'mushroom', name: '椴木鲜香菇', plantedAt: curNow.toISOString(), matureAt: tPlus, wateredAt: '', wateredDay: '', waterCount: 0, baseYield: 3, solarBonus: false, source: 'home' },
    );
    st.ranch.pens.push(
      { id: 'r-1', animalId: 'hen', name: '散养土鸡', group: 'chicken', startedAt: curNow.toISOString(), matureAt: tPlus, lastCollectedAt: curNow.toISOString(), fedAt: '', fedDay: '', feedCount: 0, fedCycleBonus: false, source: 'home' },
      { id: 'r-2', animalId: 'carp', name: '塘养草鱼', group: 'fish', startedAt: curNow.toISOString(), matureAt: tPlus, lastCollectedAt: curNow.toISOString(), fedAt: '', fedDay: '', feedCount: 0, fedCycleBonus: false, source: 'home' },
    );
    new StateStore(dir).save(st);

    const pushed = [];
    const host = {
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => {
        const env = { ...e, cursor: pushed.length + 1 };
        pushed.push(env);
        return env;
      },
      store: {},
      drainPendingEvents: async () => [],
    };
    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => curNow,
    });
    await world.start(host);

    // 1) 上午 10:10 推进：触发上午 farm:care + life.day（life.day 应附带农牧待办提示）
    curNow = new Date('2026-11-27T10:10:00.000+08:00');
    await world.tick();
    assert.equal(pushed.filter((e) => e.type === 'life.farm' && e.text.includes('还没打理')).length, 1);
    const dayEv = pushed.find((e) => e.type === 'life.day');
    assert.ok(dayEv && dayEv.text.includes('农牧场') && dayEv.text.includes('待浇水') && dayEv.text.includes('待喂食'));

    // 2) 若白天没打理，傍晚 18:00 触发 farm:care:pm 二次兜底提醒（仅一次）
    curNow = new Date('2026-11-27T18:00:00.000+08:00');
    await world.tick();
    assert.equal(pushed.filter((e) => e.type === 'life.farm' && e.text.includes('快入夜了')).length, 1);
    curNow = new Date('2026-11-27T18:10:00.000+08:00');
    await world.tick();
    assert.equal(pushed.filter((e) => e.type === 'life.farm' && e.text.includes('快入夜了')).length, 1);

    // 3) 省略 plot_id / pen_id 调 life_farm(water) 与 life_ranch(feed) 一次性照料全部
    const farmTool = world.tools().find((t) => t.name === 'life_farm');
    const wRes = await farmTool.handler({ action: 'water' });
    assert.match(wRes.text, /2 块菜/);
    assert.ok(world.state.farm.plots.every((p) => p.wateredDay === '2026-11-27'));

    const ranchTool = world.tools().find((t) => t.name === 'life_ranch');
    const fRes = await ranchTool.handler({ action: 'feed' });
    assert.match(fRes.text, /2 栏/);
    assert.ok(world.state.ranch.pens.every((p) => p.fedDay === '2026-11-27'));

    await world.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('1.4.3 鱼市街邻里代管接单修复：带 id: 前缀/全角括号/短前缀/最短单/双入口/防落早市/专用报错/同名鱼可见性', async () => {
  const dir = mkDir();
  const fakeUid = '0123456789abcdef0123456789abcdef';
  writeFileSync(join(dir, 'meet-uid.txt'), `${fakeUid}\n`, 'utf8');

  let buyErrorMode = '';
  const buyRequests = [];
  const goodsList = Array.from({ length: 13 }, (_, i) => ({
    id: `aa000000000000${i.toString(16).padStart(2, '0')}`,
    seller: `街坊${i + 1}`,
    kind: 'goods',
    item: `街坊吃食${i + 1}`,
    price: 10 + i,
    stock: 3,
    freshVeg: false,
  }));
  const stallsPayload = [
    {
      id: 'cb396a9c824504f5',
      seller: '大肥鱼',
      kind: 'errand',
      item: '农牧代管·全托(5菜0牧/46分)',
      price: 12,
      stock: 1,
      freshVeg: false,
      note: '请街坊帮忙浇水喂食收蛋奶，6h无人接自动退回',
    },
    {
      id: '9f25155523f49159',
      seller: 'zip132si',
      kind: 'errand',
      item: '农牧代管·全托(12菜0牧/88分)',
      price: 15,
      stock: 1,
      freshVeg: false,
      note: '请街坊帮忙浇水喂食收蛋奶，6h无人接自动退回',
    },
    ...goodsList,
  ];

  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const p = body ? JSON.parse(body) : {};
      if (req.url === '/town/info' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, town: 'lanzhou', name: '兰州', streets: ['南滨河路', '张掖路', '皋兰路', '雁滩路'] }));
        return;
      }
      if (req.url === '/town/join' && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, town: 'lanzhou', street: '南滨河路' }));
        return;
      }
      if (req.url?.startsWith('/town/deals') && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, unseen: 0, deals: [] }));
        return;
      }
      if (req.url?.startsWith('/town/stalls') && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          town: 'lanzhou',
          name: '兰州',
          stalls: stallsPayload,
          bulletin: ['测试黑板报'],
        }));
        return;
      }
      if (req.url === '/town/buy' && req.method === 'POST') {
        buyRequests.push(p);
        if (buyErrorMode === 'own stall') {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'own stall' }));
          return;
        }
        if (buyErrorMode === 'sold out') {
          res.writeHead(409, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'sold out' }));
          return;
        }
        if (buyErrorMode === 'pair limit') {
          res.writeHead(429, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'pair limit' }));
          return;
        }
        const st = stallsPayload.find((x) => x.id === p.stallId);
        if (!st) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'not found' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          id: 'deal-test',
          kind: st.kind,
          item: st.item,
          price: st.price,
          seller: st.seller,
          freshVeg: false,
          qty: 1,
          stockLeft: 0,
        }));
        return;
      }
      res.writeHead(404); res.end();
    });
  });

  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  let stopped = false;

  try {
    const curNow = new Date('2026-11-25T10:00:00.000+08:00');
    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, townUrl: baseUrl },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => curNow,
    });
    await world.start(silentHost);
    const buyTool = world.tools().find((t) => t.name === 'life_buy');
    const farmTool = world.tools().find((t) => t.name === 'life_farm');
    const ranchTool = world.tools().find((t) => t.name === 'life_ranch');

    // 1) 同名「大肥鱼」非本机委托必须出现在 market 面板与 life_buy 列表中，且不被 13 条普通摊货截丢
    const browse = await buyTool.handler({});
    assert.match(browse.text, /委托编号 cb396a9c824504f5/);
    assert.match(browse.text, /委托编号 9f25155523f49159/);
    const mkt = await world.webUi().invoke('market', 'snapshot');
    assert.equal(mkt.otherStalls.some((s) => s.id === 'cb396a9c824504f5' && s.seller === '大肥鱼'), true);
    assert.equal(mkt.otherStalls.some((s) => s.id === '9f25155523f49159'), true);

    // 2) 带 id: 前缀接单：必须成功接下 46 分委托，且不扣现金
    const cashBefore = world.state.money.cash;
    const rIdPrefix = await buyTool.handler({ stall_id: 'id:cb396a9c824504f5' });
    assert.match(rIdPrefix.text, /接下了街坊 大肥鱼 的农牧代管委托.*46 分钟/);
    assert.equal(world.state.money.cash, cashBefore);
    assert.equal(world.state.activity?.id, 'neighbor_errand');
    assert.equal(world.state.activity?.minutes, 46);
    assert.equal(buyRequests.at(-1)?.stallId, 'cb396a9c824504f5');

    // 3) 中文全角括号标题接单：必须命中 88 分委托
    world.state.activity = null;
    const rFullWidth = await buyTool.handler({ stall_id: '农牧代管·全托（12菜0牧/88分）' });
    assert.match(rFullWidth.text, /接下了街坊 zip132si 的农牧代管委托.*88 分钟/);
    assert.equal(world.state.activity?.minutes, 88);
    assert.equal(buyRequests.at(-1)?.stallId, '9f25155523f49159');

    // 4) life_farm({ action: 'accept_errand' }) 列表、复合字符串、短前缀与 life_ranch 最短单
    world.state.activity = null;
    const listErrands = await farmTool.handler({ action: 'accept_errand' });
    assert.match(listErrands.text, /编号 cb396a9c824504f5.*约46分/);

    const rCompound = await farmTool.handler({ action: 'accept_errand', errand_id: '委托编号 cb396a9c824504f5（46分）' });
    assert.match(rCompound.text, /接下了街坊 大肥鱼 的农牧代管委托.*46 分钟/);
    assert.equal(world.state.activity?.minutes, 46);

    world.state.activity = null;
    const rShortPrefix = await farmTool.handler({ action: 'accept_errand', errand_id: 'cb396a9c' });
    assert.match(rShortPrefix.text, /接下了街坊 大肥鱼 的农牧代管委托.*46 分钟/);

    world.state.activity = null;
    const rShortest = await ranchTool.handler({ action: 'accept_errand', errand_id: '最短' });
    assert.match(rShortest.text, /接下了街坊 大肥鱼 的农牧代管委托.*46 分钟/);

    // 5) 不存在的委托编号绝对不能掉进早市菜单
    world.state.activity = null;
    const rMissing = await buyTool.handler({ stall_id: 'id:deadbeef12345678' });
    assert.match(rMissing.text, /没有误买任何普通摊货/);
    assert.equal(/牛肉面|今天摊上有/.test(rMissing.text), false);

    // 6) 委托专属错误映射不得说成「买摊货」
    for (const [mode, expectRe, forbidRe] of [
      ['own stall', /不能自己接自己的单哦/, /摊货/],
      ['sold out', /抢先接走了/, /买光/],
      ['pair limit', /买摊货与接委托合计/, /买过两单/],
    ]) {
      buyErrorMode = mode;
      const errRes = await buyTool.handler({ stall_id: 'cb396a9c824504f5' });
      assert.match(errRes.text, expectRe);
      assert.equal(forbidRe.test(errRes.text), false);
    }
    buyErrorMode = '';

    // 7) 断网时传委托编号绝不落进本地早市
    await new Promise((resolve) => srv.close(resolve));
    stopped = true;
    const rOffline = await buyTool.handler({ stall_id: 'cb396a9c824504f5' });
    assert.match(rOffline.text, /连不上.*没有误买任何摊货/);
    assert.equal(/牛肉面|今天摊上有/.test(rOffline.text), false);

    await world.stop();
  } finally {
    if (!stopped) await new Promise((resolve) => srv.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('旅行反哺情绪去重：连续多顿旅途正餐只留最新一条，老存档已攒重复胶囊读档自动合并', () => {
  const baseTime = Date.parse('2026-11-25T12:00:00.000+08:00');
  const st = freshState(new Date(baseTime));
  for (let i = 1; i <= 5; i++) {
    const t = new Date(baseTime + i * 20 * 60_000);
    applySpend(
      st,
      [{
        id: `sp-${i}`,
        amount: 0,
        note: '旅途正餐',
        moodlet: { text: '在当地吃了顿顺口的好饭', kind: 'good', hours: 3 },
      }],
      t,
    );
  }
  const shipAt = new Date(baseTime + 110 * 60_000);
  applySpend(
    st,
    [{
      id: 'sp-ship-1',
      amount: 0,
      note: '抵达（ship）',
      moodlet: { text: '海景阳台房伴着浪声睡了一觉，晨起吹海风很清醒', kind: 'good', hours: 4 },
    }],
    shipAt,
  );

  const mealMoods = st.moodlets.filter((m) => m.text === '在当地吃了顿顺口的好饭');
  assert.equal(mealMoods.length, 1);
  assert.equal(mealMoods[0].expiresAt, new Date(baseTime + 5 * 20 * 60_000 + 3 * 3_600_000).toISOString());
  assert.equal(st.moodlets.length, 2);

  // 老存档里已攒成串的 9 条重复随机 source 情绪，经 normalize() 自动合并只留最晚一条
  const legacyRaw = {
    ...freshState(new Date(baseTime)),
    moodlets: [
      {
        id: 'm-study-1',
        source: 'study',
        text: '看进去一段，脑子亮了一下',
        kind: 'good',
        expiresAt: new Date(baseTime + 2 * 3_600_000).toISOString(),
      },
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `m-old-${i + 1}`,
        source: `journey:sp-old-${i + 1}`,
        text: '在当地吃了顿顺口的好饭',
        kind: 'good',
        expiresAt: new Date(baseTime + (i + 1) * 30 * 60_000).toISOString(),
      })),
    ],
  };
  const normed = normalize(legacyRaw, new Date(baseTime));
  const normedMeals = normed.moodlets.filter((m) => m.text === '在当地吃了顿顺口的好饭');
  assert.equal(normedMeals.length, 1);
  assert.equal(normedMeals[0].expiresAt, new Date(baseTime + 9 * 30 * 60_000).toISOString());
  assert.equal(normed.moodlets.some((m) => m.text === '看进去一段，脑子亮了一下'), true);
  assert.equal(normed.moodlets.length, 2);
});

test('1.4.5 在家醒着产蛋/熟货主动提醒（life.farm + life.who）、旅途/睡眠静默、收取清零与面板浇水文案消歧', async () => {
  const dir = mkDir();
  const prevDoc = globalThis.document;
  try {
    let curNow = new Date('2026-11-26T10:00:00.000+08:00');
    new StateStore(dir).save(freshState(curNow));
    const pushed = [];
    const host = {
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => {
        const env = { ...e, cursor: pushed.length + 1 };
        pushed.push(env);
        return env;
      },
      store: {},
      drainPendingEvents: async () => [],
    };
    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => curNow,
    });
    await world.start(host);

    // 1) 升老小区解锁鸡舍并放养土鸡（记昨天的起始时间使其满 24h 可收蛋）
    world.state.home.tier = 'old';
    world.state.money.cash = 500;
    const plantedAt = new Date(curNow.getTime() - 25 * 3_600_000).toISOString();
    world.state.ranch.pens.push({
      id: 'pen-hen-1',
      animalId: 'hen',
      name: '散养土鸡',
      group: 'chicken',
      startedAt: plantedAt,
      matureAt: new Date(curNow.getTime() + 95 * 3_600_000).toISOString(),
      lastCollectedAt: plantedAt,
      fedAt: '',
      fedDay: '',
      feedCount: 0,
      fedCycleBonus: false,
      source: 'home',
    });

    // 2) 外出旅行期间（staying）和睡着时，不应推送在家收蛋提醒
    writeFileSync(join(dir, 'journey-public.json'), JSON.stringify({
      schema: 'coopani-journey-public/v1',
      phase: 'staying',
      city: { id: 'chengdu', name: '成都', tz: 'Asia/Shanghai' },
      updatedAt: curNow.toISOString(),
    }), 'utf8');
    curNow = new Date(curNow.getTime() + 10 * 60_000);
    await world.tick();
    assert.equal(pushed.some((e) => e.type === 'life.farm'), false, '外出旅行时不推在家收蛋提醒');

    writeFileSync(join(dir, 'journey-public.json'), JSON.stringify({
      schema: 'coopani-journey-public/v1',
      phase: 'home',
      city: { id: 'lanzhou', name: '兰州', tz: 'Asia/Shanghai' },
      updatedAt: curNow.toISOString(),
    }), 'utf8');
    world.state.asleepFrom = curNow.toISOString();
    world.state.asleepUntil = new Date(curNow.getTime() + 4 * 3_600_000).toISOString();
    curNow = new Date(curNow.getTime() + 10 * 60_000);
    await world.tick();
    assert.equal(pushed.some((e) => e.type === 'life.farm'), false, '睡着时不推在家收蛋提醒');

    // 3) 回到家且醒着闲着：tick 应主动推 life.farm 收蛋提醒 + 当日喂食提醒，且 envPromptVars()['life.who'] 与 life_status 带出待收与待喂食
    world.state.asleepFrom = '';
    world.state.asleepUntil = '';
    curNow = new Date(curNow.getTime() + 10 * 60_000);
    await world.tick();
    const eggEvents = pushed.filter((e) => e.type === 'life.farm' && e.text.includes('新鲜蛋奶'));
    assert.equal(eggEvents.length, 1, '在家醒着应推送一次鸡下蛋提醒');
    assert.match(eggEvents[0].text, /鲜鸡蛋/);
    assert.match(eggEvents[0].text, /life_ranch/);
    const careEventsDay1 = pushed.filter((e) => e.type === 'life.farm' && e.text.includes('还没打理'));
    assert.equal(careEventsDay1.length, 1, '在家醒着 08:00-22:00 精力充足应推送一次每日喂食提醒');
    assert.match(careEventsDay1[0].text, /散养土鸡.*还没喂食/);
    assert.match(world.envPromptVars()['life.who'], /养殖场：鸡1牛0鱼0\(可收蛋奶1栏\/待喂食1栏\)/);

    const statusTool = world.tools().find((t) => t.name === 'life_status');
    const stInit = await statusTool.handler({});
    assert.match(stInit.text, /1 栏今日待喂食/);

    // 同一天再 tick 不重复推送；调 life_ranch(collect) 收掉后清除 nagged['farm:ranch-collect']
    curNow = new Date(curNow.getTime() + 10 * 60_000);
    await world.tick();
    assert.equal(pushed.filter((e) => e.type === 'life.farm' && e.text.includes('新鲜蛋奶')).length, 1);
    assert.equal(pushed.filter((e) => e.type === 'life.farm' && e.text.includes('还没打理')).length, 1);

    const ranchTool = world.tools().find((t) => t.name === 'life_ranch');
    const colRes = await ranchTool.handler({ action: 'collect' });
    assert.match(colRes.text, /鲜鸡蛋/);
    assert.equal(world.state.nagged['farm:ranch-collect'], undefined);

    // 4) 成熟菜地提醒与收割清零
    world.state.farm.plots.push({
      id: 'plot-ready-1',
      seedId: 'scallion',
      name: '香葱与罗勒',
      plantedAt: new Date(curNow.getTime() - 96 * 3_600_000).toISOString(),
      matureAt: new Date(curNow.getTime() - 60_000).toISOString(),
      wateredAt: new Date(curNow.getTime() - 24 * 3_600_000).toISOString(),
      wateredDay: '2026-11-25',
      waterCount: 3,
      baseYield: 2,
      solarBonus: false,
      source: 'home',
    });
    curNow = new Date(curNow.getTime() + 10 * 60_000);
    await world.tick();
    const harvestEv = pushed.find((e) => e.type === 'life.farm' && e.text.includes('熟货待收') && e.text.includes('香葱与罗勒'));
    assert.ok(harvestEv, '在家醒着有成熟蔬菜时应推送熟货待收提醒');
    assert.match(harvestEv.text, /life_farm/);

    const farmTool = world.tools().find((t) => t.name === 'life_farm');
    await farmTool.handler({ action: 'harvest' });
    assert.equal(world.state.nagged['farm:harvest'], undefined);

    // 4b) 次日每日浇水 + 喂食门控与汇总提醒验证
    world.state.farm.plots.push({
      id: 'plot-grow-1',
      seedId: 'mushroom',
      name: '椴木鲜香菇',
      plantedAt: curNow.toISOString(),
      matureAt: new Date(curNow.getTime() + 96 * 3_600_000).toISOString(),
      wateredAt: '',
      wateredDay: '',
      waterCount: 0,
      baseYield: 3,
      solarBonus: false,
      source: 'home',
    });
    // 凌晨 02:00 不触发 farm:care
    curNow = new Date('2026-11-27T02:00:00.000+08:00');
    await world.tick();
    assert.equal(pushed.filter((e) => e.type === 'life.farm' && e.text.includes('还没打理')).length, 1, '凌晨不消耗当天照料提醒');

    // 先推进到 08:50（避免 02:00→09:00 跨夜触发离线补睡把精力拉回 85），再测精力不足（< 10）不触发；补足精力但挂着今日未过期邻里委托也不触发
    curNow = new Date('2026-11-27T08:50:00.000+08:00');
    await world.tick();
    world.state.nagged = {};
    const careBase = pushed.filter((e) => e.type === 'life.farm' && e.text.includes('还没打理')).length;

    curNow = new Date('2026-11-27T08:55:00.000+08:00');
    world.state.vitals.energy = 8;
    await world.tick();
    assert.equal(pushed.filter((e) => e.type === 'life.farm' && e.text.includes('还没打理')).length, careBase, '精力不足时不推照料提醒');

    world.state.vitals.energy = 80;
    world.state.farmHelper.pendingErrand = {
      stallId: 'err-today-1',
      mode: 'care',
      wage: 7,
      minutes: 25,
      day: '2026-11-27',
      postedAt: curNow.toISOString(),
      expiresAt: new Date(curNow.getTime() + 5 * 3_600_000).toISOString(),
    };
    curNow = new Date(curNow.getTime() + 5 * 60_000);
    await world.tick();
    assert.equal(pushed.filter((e) => e.type === 'life.farm' && e.text.includes('还没打理')).length, careBase, '已发今日邻里代管委托时不重复提醒自己浇水喂食');

    // 撤销委托后同一天白天应汇总推送一次「待浇水 + 待喂食」，且 life.who 与 life_status 同步曝光
    world.state.farmHelper.pendingErrand = null;
    curNow = new Date(curNow.getTime() + 5 * 60_000);
    await world.tick();
    const careDay2 = pushed.filter((e) => e.type === 'life.farm' && e.text.includes('还没打理'));
    assert.equal(careDay2.length, careBase + 1, '次日白天在家精力充足应合并推送浇水与喂食提醒');
    assert.match(careDay2.at(-1).text, /椴木鲜香菇.*还没浇水/);
    assert.match(careDay2.at(-1).text, /散养土鸡.*还没喂食/);
    assert.match(world.envPromptVars()['life.who'], /待浇水1/);
    assert.match(world.envPromptVars()['life.who'], /待喂食1栏/);
    const stDay2 = await statusTool.handler({});
    assert.match(stDay2.text, /今日待浇水 1 块（椴木鲜香菇/);
    assert.match(stDay2.text, /1 栏今日待喂食/);

    // 5) 面板浇水文案验证：waterCount=3, wateredToday=true 显示「累计浇 3次(已+1产) · 今日✓」绝不出现「3/2」；waterCount=1 显示「1/2(满2+1产) · 今日待浇」
    class MiniEl {
      constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.style = {};
        this.dataset = {};
        this.className = '';
        this.id = '';
        this._text = '';
      }
      set textContent(v) { this._text = String(v ?? ''); this.children = []; }
      get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
      append(...args) {
        for (const a of args) {
          if (a == null) continue;
          this.children.push(typeof a === 'string' ? { textContent: a, children: [] } : a);
        }
      }
      set innerHTML(v) { if (v === '') { this.children = []; this._text = ''; } }
      addEventListener() {}
      setAttribute() {}
    }
    const fakeDoc = {
      head: new MiniEl('head'),
      body: new MiniEl('body'),
      createElement: (t) => new MiniEl(t),
      createTextNode: (txt) => ({ textContent: String(txt ?? ''), children: [] }),
      getElementById: () => null,
      execCommand: () => true,
    };
    globalThis.document = fakeDoc;
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const panelMod = await import(`../${pkg.cortico.webUiClient}?water=${Date.now()}`);
    const root = new MiniEl('div');
    const mockSnap = {
      ...(await world.webUi().invoke('market', 'snapshot')),
      farm: {
        homeSlots: 2,
        leased: false,
        leasedSlots: 0,
        leasedMonthly: 150,
        totalSlots: 2,
        usedSlots: 2,
        readyCount: 0,
        plots: [
          {
            id: 'p3',
            seedId: 'scallion',
            name: '香葱与罗勒',
            source: 'home',
            waterCount: 3,
            wateredToday: true,
            expectedYield: 3,
            daysLeft: 2.1,
            progress: 0.48,
            ready: false,
            solarBonus: false,
            matureAt: new Date(curNow.getTime() + 50 * 3_600_000).toISOString(),
          },
          {
            id: 'p1',
            seedId: 'mushroom',
            name: '椴木鲜香菇',
            source: 'home',
            waterCount: 1,
            wateredToday: false,
            expectedYield: 3,
            daysLeft: 4.1,
            progress: 0.3,
            ready: false,
            solarBonus: false,
            matureAt: new Date(curNow.getTime() + 98 * 3_600_000).toISOString(),
          },
        ],
      },
    };
    await panelMod.default.panels.market.mount({
      root,
      language: 'zh',
      invoke: async () => mockSnap,
      timeout: () => 0,
    });
    const renderedText = root.textContent;
    assert.match(renderedText, /累计浇 3次\(已\+1产\) · 今日✓/);
    assert.match(renderedText, /累计浇 1\/2\(满2\+1产\) · 今日待浇/);
    assert.doesNotMatch(renderedText, /浇水 3\/2/);

    await world.stop();
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('1.5.1 省略 id 一次浇完多块菜/喂完多栏动物 + 傍晚 farm:care:pm 兜底提醒与 life.day 农牧待办提示', async () => {
  const dir = mkDir();
  try {
    let curNow = new Date('2026-11-27T10:00:00.000+08:00');
    const st = freshState(curNow);
    st.home.tier = 'new';
    st.money.cash = 1000;
    st.vitals.energy = 80;
    const tPlus = new Date(curNow.getTime() + 72 * 3_600_000).toISOString();
    st.farm.plots.push(
      { id: 'p-1', seedId: 'scallion', name: '香葱与罗勒', plantedAt: curNow.toISOString(), matureAt: tPlus, wateredAt: '', wateredDay: '', waterCount: 0, baseYield: 2, solarBonus: false, source: 'home' },
      { id: 'p-2', seedId: 'mushroom', name: '椴木鲜香菇', plantedAt: curNow.toISOString(), matureAt: tPlus, wateredAt: '', wateredDay: '', waterCount: 0, baseYield: 3, solarBonus: false, source: 'home' },
    );
    st.ranch.pens.push(
      { id: 'r-1', animalId: 'hen', name: '散养土鸡', group: 'chicken', startedAt: curNow.toISOString(), matureAt: tPlus, lastCollectedAt: curNow.toISOString(), fedAt: '', fedDay: '', feedCount: 0, fedCycleBonus: false, source: 'home' },
      { id: 'r-2', animalId: 'carp', name: '塘养草鱼', group: 'fish', startedAt: curNow.toISOString(), matureAt: tPlus, lastCollectedAt: curNow.toISOString(), fedAt: '', fedDay: '', feedCount: 0, fedCycleBonus: false, source: 'home' },
    );
    new StateStore(dir).save(st);

    const pushed = [];
    const host = {
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => {
        const env = { ...e, cursor: pushed.length + 1 };
        pushed.push(env);
        return env;
      },
      store: {},
      drainPendingEvents: async () => [],
    };
    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => curNow,
    });
    await world.start(host);

    // 1) 上午 10:10 推进：触发上午 farm:care + life.day（life.day 应附带农牧待办提示）
    curNow = new Date('2026-11-27T10:10:00.000+08:00');
    await world.tick();
    assert.equal(pushed.filter((e) => e.type === 'life.farm' && e.text.includes('还没打理')).length, 1);
    const dayEv = pushed.find((e) => e.type === 'life.day');
    assert.ok(dayEv && dayEv.text.includes('农牧场') && dayEv.text.includes('待浇水') && dayEv.text.includes('待喂食'));

    // 2) 若白天没打理，傍晚 18:00 触发 farm:care:pm 二次兜底提醒（仅一次）
    curNow = new Date('2026-11-27T18:00:00.000+08:00');
    await world.tick();
    assert.equal(pushed.filter((e) => e.type === 'life.farm' && e.text.includes('快入夜了')).length, 1);
    curNow = new Date('2026-11-27T18:10:00.000+08:00');
    await world.tick();
    assert.equal(pushed.filter((e) => e.type === 'life.farm' && e.text.includes('快入夜了')).length, 1);

    // 3) 省略 plot_id / pen_id 调 life_farm(water) 与 life_ranch(feed) 一次性照料全部
    const farmTool = world.tools().find((t) => t.name === 'life_farm');
    const wRes = await farmTool.handler({ action: 'water' });
    assert.match(wRes.text, /2 块菜/);
    assert.ok(world.state.farm.plots.every((p) => p.wateredDay === '2026-11-27'));

    const ranchTool = world.tools().find((t) => t.name === 'life_ranch');
    const fRes = await ranchTool.handler({ action: 'feed' });
    assert.match(fRes.text, /2 栏/);
    assert.ok(world.state.ranch.pens.every((p) => p.fedDay === '2026-11-27'));

    await world.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('好/坏心情明确作用于五维衰减、读书、锻炼、考证概率与状态/面板透出', async () => {
  const t0 = new Date('2026-11-27T10:00:00.000+08:00');
  const expIso = new Date(t0.getTime() + 6 * 3_600_000).toISOString();

  // 1) moodSummary 纯函数与衰减倍率验证
  const sNeu = freshState(t0);
  const sGood = freshState(t0);
  const sBad = freshState(t0);
  sGood.moodlets.push({ id: 'mg1', source: 'feast', text: '吃爽了', kind: 'good', expiresAt: expIso });
  sBad.moodlets.push({ id: 'mb1', source: 'instant', text: '将就糊弄了一口', kind: 'bad', expiresAt: expIso });

  assert.equal(moodSummary(sNeu, t0).polarity, 'neutral');
  assert.equal(moodSummary(sGood, t0).polarity, 'good');
  assert.equal(moodSummary(sGood, t0).studyMult, 1.15);
  assert.equal(moodSummary(sGood, t0).fitMult, 1.15);
  assert.equal(moodSummary(sGood, t0).certDelta, 0.08);
  assert.equal(moodSummary(sBad, t0).polarity, 'bad');
  assert.equal(moodSummary(sBad, t0).studyMult, 0.85);
  assert.equal(moodSummary(sBad, t0).certDelta, -0.08);

  const t2h = new Date(t0.getTime() + 2 * 3_600_000);
  advance(sNeu, t2h);
  advance(sGood, t2h);
  advance(sBad, t2h);
  assert.ok(sGood.vitals.fun > sNeu.vitals.fun, '好心情下娱乐衰减减缓 15%');
  assert.ok(sGood.vitals.social > sNeu.vitals.social, '好心情下社交衰减减缓 15%');
  assert.ok(sBad.vitals.energy < sNeu.vitals.energy, '坏心情下精力衰减加快 15%');
  assert.ok(sBad.vitals.fun < sNeu.vitals.fun, '坏心情下娱乐衰减加快 15%');

  // 2) 读书与锻炼涨幅受心情影响
  const studyNeu = freshState(t0);
  const studyGood = freshState(t0);
  const studyBad = freshState(t0);
  studyGood.moodlets.push({ id: 'mg2', source: 'feast', text: '神清气爽', kind: 'good', expiresAt: expIso });
  studyBad.moodlets.push({ id: 'mb2', source: 'cert-fail', text: '有点郁闷', kind: 'bad', expiresAt: expIso });
  applyAct(studyNeu, 'study', t0);
  applyAct(studyGood, 'study', t0);
  applyAct(studyBad, 'study', t0);
  const tStudyEnd = new Date(t0.getTime() + ACTS.study.minutes * 60_000);
  advance(studyNeu, tStudyEnd);
  advance(studyGood, tStudyEnd);
  advance(studyBad, tStudyEnd);
  assert.ok(studyGood.knowledge > studyNeu.knowledge + 0.7, '好心情读书多涨 15%');
  assert.ok(studyBad.knowledge < studyNeu.knowledge - 0.7, '坏心情读书少涨 15%');

  const fitNeu = freshState(t0);
  const fitGood = freshState(t0);
  fitGood.moodlets.push({ id: 'mg3', source: 'feast', text: '状态正好', kind: 'good', expiresAt: expIso });
  applyAct(fitNeu, 'workout', t0);
  applyAct(fitGood, 'workout', t0);
  const tFitEnd = new Date(t0.getTime() + ACTS.workout.minutes * 60_000);
  advance(fitNeu, tFitEnd);
  advance(fitGood, tFitEnd);
  assert.ok(fitGood.fitness > fitNeu.fitness + 0.3, '好心情锻炼多涨 15%');

  // 3) 考证胜算受 ±8% 修正（两参口径不变）
  assert.equal(certChance(20, 40), 0.525);
  assert.ok(Math.abs(certChance(20, 40, 0.08) - 0.605) < 1e-9);
  assert.ok(Math.abs(certChance(20, 40, -0.08) - 0.445) < 1e-9);

  const cGood = freshState(t0);
  cGood.knowledge = 20;
  cGood.money.cash = 1000;
  cGood.moodlets.push({ id: 'mg4', source: 'gift', text: '开心', kind: 'good', expiresAt: expIso });
  const rGood = applyCert(cGood, '厨师证', t0, 0.56);
  assert.equal(rGood.passed, true, '0.525 + 0.08 = 0.605 应让 roll=0.56 通过');
  assert.match(String(rGood.moodNote), /好心情加持/);

  const cBad = freshState(t0);
  cBad.knowledge = 20;
  cBad.money.cash = 1000;
  cBad.moodlets.push({ id: 'mb4', source: 'instant', text: '心烦', kind: 'bad', expiresAt: expIso });
  const rBad = applyCert(cBad, '厨师证', t0, 0.48);
  assert.equal(rBad.passed, false, '0.525 - 0.08 = 0.445 应让 roll=0.48 落榜');
  assert.match(String(rBad.moodNote), /坏心情拖累/);

  // 4) snapshot().moodEffect 透出效果摘要
  assert.match(snapshot(cGood, t0).moodEffect.effectsText, /考证 \+8%/);
  assert.equal(snapshot(freshState(t0), t0).moodEffect.effectsText, '');
});

test('她惦记的自动记账（买家伙/考证/搬家遇阻写入与办成消除）+ 跨扩展读取 journey 心愿渲染进面板', async () => {
  const dir = mkDir();
  const prevDoc = globalThis.document;
  try {
    const t0 = new Date('2026-11-27T11:00:00.000+08:00');
    const st = freshState(t0);
    st.money.cash = 100;
    st.goals = [];

    // 1) 差钱买烤箱 -> 自动进 wants；有钱买下 -> 自动清掉
    const buyFail = applyLearn(st, '烤箱', t0);
    assert.equal(buyFail.ok, false);
    assert.ok(st.wants.some((w) => w.what.includes('烤箱')), '买不起烤箱应自动记进 wants');
    st.money.cash = 1000;
    const buyOk = applyLearn(st, '烤箱', t0);
    assert.equal(buyOk.ok, true);
    assert.equal(st.wants.some((w) => w.what.includes('烤箱')), false, '买到烤箱后自动清掉对应 want');

    // 2) 差钱考证 & 考砸 -> 写入 pending；考过 -> 清掉
    st.money.cash = 50;
    assert.equal(applyCert(st, '护工证', t0).ok, false);
    assert.ok(st.pending.some((p) => p.what.includes('护工证') && p.blocked === 'money'));
    st.money.cash = 1000;
    assert.equal(applyCert(st, '护工证', t0, 0).passed, true);
    assert.equal(st.pending.some((p) => p.what.includes('护工证')), false);

    // 3) 搬新小区差押金 -> 记进 wants；接门槛高岗位缺证 -> 记进 pending 且不超过 MAX_PENDING
    st.money.cash = 500;
    assert.equal(applyMove(st, 'new', t0).ok, false);
    assert.ok(st.wants.some((w) => w.what.includes('新小区')));
    for (const jobName of ['电工', '大厨', '社区护士', '会计助理']) {
      applyWork(st, jobName, t0, 'home');
    }
    assert.ok(st.pending.length <= MAX_PENDING, `自动记录绝不挤爆 MAX_PENDING(${MAX_PENDING})`);

    // 4) 跨扩展读取 journey-public.json.wishes 并渲染到 now 心情效果卡与 wants 面板
    writeFileSync(join(dir, 'journey-public.json'), JSON.stringify({
      schema: 'coopani-journey-public/v1',
      phase: 'home',
      city: { id: 'lanzhou', name: '兰州', tz: 'Asia/Shanghai' },
      wishes: ['舟山', '大理'],
      updatedAt: t0.toISOString(),
    }), 'utf8');
    const jv = readJourney(dir, t0);
    assert.deepEqual(jv.wishes, ['舟山', '大理']);

    st.moodlets.push({
      id: 'mg-ui',
      source: 'feast',
      text: '今天胃口极好',
      kind: 'good',
      expiresAt: new Date(t0.getTime() + 4 * 3_600_000).toISOString(),
    });
    new StateStore(dir).save(st);
    const world = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: dir, now: () => t0 });
    await world.start(silentHost);
    const snap = await world.panelInvoke('now', 'snapshot');
    assert.deepEqual(snap.journey.wishes, ['舟山', '大理']);
    assert.match(snap.moodEffect.effectsText, /娱乐\/社交衰减 -15%/);

    // 用最小 DOM 桩挂载 now 与 wants 页签验证渲染输出
    const makeNode = (tag) => {
      const node = {
        tagName: String(tag).toUpperCase(),
        children: [],
        style: { cssText: '' },
        className: '',
        id: '',
        hidden: false,
        title: '',
        open: false,
        value: '',
        _text: '',
        ownerDocument: null,
        get textContent() { return this._text + this.children.map((c) => c.textContent || '').join(''); },
        set textContent(v) { this._text = String(v ?? ''); this.children = []; },
        get innerHTML() { return ''; },
        set innerHTML(_) { this.children = []; this._text = ''; },
        append(...items) {
          for (const it of items) {
            if (typeof it === 'string') this.children.push({ textContent: it, children: [], style: {} });
            else if (it) { it.parentNode = this; this.children.push(it); }
          }
        },
        prepend(...items) {
          for (const it of items.reverse()) {
            const c = typeof it === 'string' ? { textContent: it, children: [], style: {} } : it;
            if (c) this.children.unshift(c);
          }
        },
        appendChild(it) { this.append(it); return it; },
        addEventListener() {},
        setAttribute(k, v) { if (k === 'id') this.id = String(v); },
      };
      return node;
    };
    const findId = (n, id) => {
      if (!n) return null;
      if (n.id === id) return n;
      for (const c of n.children || []) { const hit = findId(c, id); if (hit) return hit; }
      return null;
    };
    const fakeDoc = {
      head: makeNode('head'),
      body: makeNode('body'),
      createElement(tag) { const el = makeNode(tag); el.ownerDocument = fakeDoc; return el; },
      createTextNode(t) { return { textContent: String(t ?? ''), children: [] }; },
      getElementById(id) { return findId(this.head, id) || findId(this.body, id); },
    };
    fakeDoc.head.ownerDocument = fakeDoc;
    fakeDoc.body.ownerDocument = fakeDoc;
    globalThis.document = fakeDoc;
    const panelMod = await import(`../web/panel-1.6.3.js?mood=${Date.now()}`);
    const panels = panelMod.default.panels;

    const nowRoot = fakeDoc.createElement('div');
    fakeDoc.body.append(nowRoot);
    await panels.now.mount({ root: nowRoot, language: 'zh', invoke: async () => snap, timeout: () => 0 });
    assert.match(nowRoot.textContent, /好心情加持：/);

    const wantsRoot = fakeDoc.createElement('div');
    fakeDoc.body.append(wantsRoot);
    await panels.wants.mount({ root: wantsRoot, language: 'zh', invoke: async () => snap, timeout: () => 0 });
    assert.match(wantsRoot.textContent, /舟山（环游心愿）/);
    assert.match(wantsRoot.textContent, /大理（环游心愿）/);

    await world.stop();
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('30 个职业无鱼类禁忌词，熟练度涨薪(1.0x→1.5x)、四档产出品质与 5 页职业工作台/每日照料闭环', async () => {
  const { JOBS } = await import('../src/jobs.ts');
  const {
    LifeWorld,
  } = await import('../src/world.ts');
  const { LIFE_DEFAULTS } = await import('../src/config.ts');
  const {
    freshState, applyWork, applyAct, advance, applyUserCare, applyCookRecipe,
    buildCareerOverview, skillPayMultiplier, qualityOdds,
  } = await import('../src/state.ts');
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  // 1) 30 个职业与零鱼肉忌讳校验
  assert.equal(JOBS.length, 30, 'JOBS 应扩充到 30 项');
  for (const jb of JOBS) {
    assert.doesNotMatch(jb.name, /鱼肉|生鱼|鱼排|鱼丸|烤鱼|鱼汤|水煮鱼|刺身/);
    assert.ok(jb.pay > 0 && jb.minutes > 0);
  }
  assert.equal(skillPayMultiplier(0), 1);
  assert.equal(skillPayMultiplier(50), 1.25);
  assert.equal(skillPayMultiplier(100), 1.5);
  const lowOdds = qualityOdds(0);
  const highOdds = qualityOdds(100);
  assert.equal(lowOdds.common + lowOdds.good + lowOdds.fine + lowOdds.exquisite, 100);
  assert.equal(highOdds.common + highOdds.good + highOdds.fine + highOdds.exquisite, 100);
  assert.ok(highOdds.fine + highOdds.exquisite > lowOdds.fine + lowOdds.exquisite, '高熟练度应显著提高高品阶概率');

  // 2) 熟练度提升日薪 + 四档品质工作产出 + 菜谱四档品质
  const t0 = new Date('2026-11-28T09:00:00+08:00');
  const sLow = freshState(t0);
  sLow.gear = ['camera', 'oven', 'sewing', 'computer'];
  sLow.skills = { photo: 0, cooking: 90 };
  const wLow = applyWork(sLow, 'darkroom_print', t0, 'home');
  assert.equal(wLow.ok, true);
  assert.equal(wLow.expectedPay, 150);

  const sHigh = freshState(t0);
  sHigh.gear = ['camera', 'oven', 'sewing', 'computer'];
  sHigh.skills = { photo: 100, cooking: 95 };
  const wHigh = applyWork(sHigh, 'darkroom_print', t0, 'home');
  assert.equal(wHigh.ok, true);
  assert.equal(wHigh.expectedPay, 225, '100 熟练度下 150 元基薪应涨到 225 元 (1.5x)');
  const adv = advance(sHigh, new Date(t0.getTime() + 310 * 60_000), { qualityRoll: 0.99 });
  assert.ok(adv.completed?.some((c) => c.outputItem?.quality === 'exquisite' && c.outputItem?.qualityLabel === '臻品'));
  assert.equal(sHigh.workOutputs.length, 1);
  assert.equal(sHigh.workOutputs[0].qualityLabel, '臻品');

  sHigh.pantry.push({ id: 'p1', itemId: 'sweet_potato', name: '蜜薯红薯', kind: 'veg', qty: 3, unitCost: 2, acquiredAt: t0.toISOString() });
  const cookRes = applyCookRecipe(sHigh, 'roast_sweet_potato', 'store', new Date(t0.getTime() + 320 * 60_000), { roll: 0.99 });
  assert.equal(cookRes.ok, true);
  assert.equal(cookRes.quality, 'exquisite');
  assert.equal(cookRes.qualityLabel, '臻品');
  assert.equal(sHigh.cookedDishes[0].qualityLabel, '臻品');

  const overview = buildCareerOverview(sHigh);
  assert.equal(overview.jobs.length, 30);
  assert.equal(overview.workOutputs.length, 1);

  // 3) 过劳生病门禁（禁外出打工/逛街，放行在家休息与农牧照料）+ 每日照料与 World 广播
  const dir = mkdtempSync(join(tmpdir(), 'life-stage24-'));
  const prevDoc = globalThis.document;
  try {
    let fixedNow = new Date('2026-11-28T14:00:00+08:00');
    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => fixedNow,
    });
    const events = [];
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => { events.push(e); return e; },
      store: {},
      drainPendingEvents: async () => [],
    });
    world.state.updatedAt = fixedNow.toISOString();
    world.state.gear = ['camera', 'sewing', 'computer'];
    world.state.skills = { photo: 80, cooking: 60 };
    world.state.workOutputs = [...sHigh.workOutputs];
    world.state.cookedDishes = [...sHigh.cookedDishes];
    world.state.vitals.energy = 12;
    fixedNow = new Date(fixedNow.getTime() + 60_000);
    advance(world.state, fixedNow);
    const overwork = world.state.conditions.find((c) => c.id === 'overwork');
    assert.ok(overwork, '低精力应触发过劳静养');
    world.broadcastLife(fixedNow);
    const pubSick = JSON.parse(readFileSync(join(dir, 'life-public.json'), 'utf8'));
    assert.ok(pubSick.sickUntil && Date.parse(pubSick.sickUntil) > fixedNow.getTime());

    const tools = new Map(world.tools().map((x) => [x.name, x.handler]));
    const workBlocked = await tools.get('life_work')({ what: '搬货' });
    assert.match(workBlocked.text, /生病静养/);
    const outBlocked = await tools.get('life_out')({ where: '南滨河路' });
    assert.match(outBlocked.text, /生病静养/);
    const mallBlocked = applyAct(world.state, 'mall', new Date(fixedNow.getTime() + 120_000));
    assert.equal(mallBlocked.ok, false);
    assert.match(String(mallBlocked.reason), /生病静养/);

    const restAllowed = applyAct(world.state, 'rest', new Date(fixedNow.getTime() + 120_000));
    assert.equal(restAllowed.ok, true, '在家休息应放行');
    applyAct(world.state, 'cancel', new Date(fixedNow.getTime() + 180_000));

    const farmStatus = await tools.get('life_farm')({ action: 'status' });
    assert.ok(farmStatus.text && !/生病静养/.test(farmStatus.text), '生病期间应允许在家照料菜园动植物');

    // 每日照料（第 1 次缩短 18h，第 2 次同日被拒）
    const c1 = await world.panelInvoke('now', 'care', [{ kind: 'medicine' }]);
    assert.equal(c1.ok, true);
    assert.ok(events.some((e) => e.type === 'life.care'), '照料应推送 life.care 事件');
    const c2 = await world.panelInvoke('now', 'care', [{ kind: 'soup' }]);
    assert.equal(c2.ok, false);
    assert.match(String(c2.reason), /今天已经照料过一次/);

    // 无头 DOM：验证 now 页每日照料卡片 + career 页 5 个职业特色工作台都能切换并渲染完整内容
    const makeNode = (tag) => {
      const listeners = {};
      const node = {
        tagName: String(tag).toUpperCase(),
        children: [],
        style: { cssText: '' },
        className: '',
        id: '',
        hidden: false,
        disabled: false,
        title: '',
        open: false,
        value: '',
        attrs: {},
        _text: '',
        ownerDocument: null,
        get textContent() { return this._text + this.children.map((c) => c.textContent || '').join(''); },
        set textContent(v) { this._text = String(v ?? ''); this.children = []; },
        get innerHTML() { return ''; },
        set innerHTML(_) { this.children = []; this._text = ''; },
        append(...items) {
          for (const it of items) {
            if (typeof it === 'string') this.children.push({ textContent: it, children: [], style: {}, attrs: {} });
            else if (it) { it.parentNode = this; this.children.push(it); }
          }
        },
        prepend(...items) {
          for (const it of items.reverse()) {
            const c = typeof it === 'string' ? { textContent: it, children: [], style: {}, attrs: {} } : it;
            if (c) this.children.unshift(c);
          }
        },
        appendChild(it) { this.append(it); return it; },
        addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
        click() { for (const fn of listeners.click || []) fn({}); },
        setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); },
      };
      return node;
    };
    const findAll = (n, pred, out = []) => {
      if (!n) return out;
      if (pred(n)) out.push(n);
      for (const ch of n.children || []) findAll(ch, pred, out);
      return out;
    };
    const findId = (n, id) => findAll(n, (x) => x.id === id)[0] || null;
    const fakeDoc = {
      head: makeNode('head'),
      body: makeNode('body'),
      createElement(tag) { const el = makeNode(tag); el.ownerDocument = fakeDoc; return el; },
      createTextNode(t) { return { textContent: String(t ?? ''), children: [], attrs: {} }; },
      getElementById(id) { return findId(this.head, id) || findId(this.body, id); },
    };
    fakeDoc.head.ownerDocument = fakeDoc;
    fakeDoc.body.ownerDocument = fakeDoc;
    globalThis.document = fakeDoc;

    const panelMod = await import(`../web/panel-1.6.3.js?stage24=${Date.now()}`);
    const panels = panelMod.default.panels;

    const nowSnap = await world.panelInvoke('now', 'snapshot', []);
    const nowRoot = fakeDoc.createElement('div');
    await panels.now.mount({ root: nowRoot, language: 'zh', invoke: async () => nowSnap, timeout: () => 0 });
    assert.match(nowRoot.textContent, /生病闭门静养中/);
    assert.match(nowRoot.textContent, /买药送来/);
    assert.match(nowRoot.textContent, /熬热姜枣粥/);

    const careerSnap = await world.panelInvoke('career', 'snapshot', []);
    const careerRoot = fakeDoc.createElement('div');
    await panels.career.mount({ root: careerRoot, language: 'zh', invoke: async () => careerSnap, timeout: () => 0 });
    assert.match(careerRoot.textContent, /五大职业特色工作台/);
    assert.match(careerRoot.textContent, /30 项/);
    for (const [sid, expectWord] of [
      ['photo', '暗房胶片冲印'],
      ['craft', '亚麻刺绣手作'],
      ['writing', '风物随笔撰稿'],
      ['driving', '网约车司机'],
    ]) {
      const btn = findAll(careerRoot, (n) => n.attrs?.['data-studio-tab'] === sid)[0];
      assert.ok(btn, `应存在工作台标签 ${sid}`);
      btn.click();
      assert.ok(careerRoot.textContent.includes(expectWord), `${sid} 工作台应渲染 ${expectWord}`);
    }

    // 病愈：再推进一天或继续照料使病程到期，sickUntil 应清空
    fixedNow = new Date(fixedNow.getTime() + 19 * 3_600_000);
    advance(world.state, fixedNow);
    world.broadcastLife(fixedNow);
    const pubClean = JSON.parse(readFileSync(join(dir, 'life-public.json'), 'utf8'));
    assert.equal(pubClean.sickUntil, '', '到期痊愈后 life-public.sickUntil 应清空');

    await world.stop();
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('复审 P0/P1/P2 全项回归：照料点击不报错、混合心情对齐、离线过劳无幻觉通知、多病照料一致、全外出门禁与做砸/心愿边界', async () => {
  const { LifeWorld } = await import('../src/world.ts');
  const { LIFE_DEFAULTS } = await import('../src/config.ts');
  const {
    freshState, advance, applyWork, applyCert, applyLearn, applyMove,
    applyUserCare, applyCookRecipe, buildCareerOverview,
    rollWorkGrade, qualityOdds, moodSummary,
  } = await import('../src/state.ts');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  // 1) P1 #3: 混合心情（2 好 + 1 坏）→ moodSummary/rollWorkGrade/qualityOdds/buildCareerOverview 口径一致
  const t0 = new Date('2026-11-28T10:00:00+08:00');
  const sm = freshState(t0);
  const expIso = new Date(t0.getTime() + 5 * 3_600_000).toISOString();
  sm.moodlets.push(
    { id: 'mg1', source: 'act1', text: '开心1', kind: 'good', expiresAt: expIso },
    { id: 'mg2', source: 'act2', text: '开心2', kind: 'good', expiresAt: expIso },
    { id: 'mb1', source: 'act3', text: '微烦', kind: 'bad', expiresAt: expIso },
  );
  const ms = moodSummary(sm, t0);
  assert.equal(ms.polarity, 'good');
  assert.equal(ms.workScoreDelta, 0.14);
  const oddsMixed = qualityOdds(40, { moodPolarity: ms.polarity });
  const oddsPureGood = qualityOdds(40, { moodPolarity: 'good' });
  assert.deepEqual(oddsMixed, oddsPureGood, '混合好心情占比胜出应与纯好心情一致');
  const ov = buildCareerOverview(sm, t0);
  const ovPure = buildCareerOverview({ ...sm, moodlets: sm.moodlets.slice(0, 2) }, t0);
  assert.deepEqual(ov.certs[0].chancePct, ovPure.certs[0].chancePct, '职业概览过考率应同步心情修正');
  const gMixed = rollWorkGrade({
    domainExp: 0, trainedCount: 0, energy: 80, hasBadCond: false, hasHangover: false,
    hasBadMood: true, hasGoodMood: true, moodScoreDelta: ms.workScoreDelta,
    domain: 'cooking', jobName: '厨师', roll: 0.5,
  });
  const gPure = rollWorkGrade({
    domainExp: 0, trainedCount: 0, energy: 80, hasBadCond: false, hasHangover: false,
    hasBadMood: false, hasGoodMood: true, moodScoreDelta: 0.14,
    domain: 'cooking', jobName: '厨师', roll: 0.5,
  });
  assert.equal(gMixed.grade, gPure.grade, 'moodScoreDelta 应统一收工考评心情口径');

  // 2) P1 #4: 离线 48h 后收工过劳并早已过期，pendingNotices 不得残留 life.sick
  const soff = freshState(t0);
  soff.gear = ['camera'];
  soff.vitals.energy = 20;
  applyWork(soff, 'darkroom_print', t0, 'home');
  const advOff = advance(soff, new Date(t0.getTime() + 48 * 3_600_000));
  assert.ok(!soff.pendingNotices?.some((n) => n.type === 'life.sick'), '已过期并进 recovered 的过劳不得残留 pendingNotices.life.sick');
  assert.ok(!advOff.caught.some((c) => c.id === 'overwork'));

  // 3) P1 #5: 同时挂 cold(5h) + overwork(30h)，medicine(-18h) 后全部状态统一返回 recoveredNow:false
  const smulti = freshState(t0);
  smulti.conditions = [
    { id: 'cold', since: t0.toISOString(), until: new Date(t0.getTime() + 5 * 3_600_000).toISOString(), text: '感冒静养' },
    { id: 'overwork', since: t0.toISOString(), until: new Date(t0.getTime() + 30 * 3_600_000).toISOString(), text: '过劳静养' },
  ];
  const careRes = applyUserCare(smulti, 'medicine', t0);
  assert.equal(careRes.ok, true);
  assert.equal(careRes.recoveredNow, false);
  assert.equal(smulti.sickCare.history.at(-1)?.recovered, false, 'history.recovered 不得与 recoveredNow 矛盾');
  assert.ok(!/好得差不多/.test(smulti.moodlets.find((m) => m.source === 'care')?.text || ''), '尚有30h过劳未好时心情不得写快好透');

  // 4) P2 #9 & #10: applyCookRecipe(eat) 享品质加成、smash 不入 workOutputs、搬老小区不删手动心愿
  const scook = freshState(t0);
  scook.pantry.push({ id: 'sp1', itemId: 'sweet_potato', name: '蜜薯红薯', kind: 'veg', qty: 3, unitCost: 2, acquiredAt: t0.toISOString() });
  const eatCommon = applyCookRecipe({ ...structuredClone(scook) }, 'roast_sweet_potato', 'eat', t0, { roll: 0.01 });
  const eatExq = applyCookRecipe({ ...structuredClone(scook) }, 'roast_sweet_potato', 'eat', t0, { roll: 0.99 });
  assert.ok((eatExq.foodGain ?? 0) > (eatCommon.foodGain ?? 0), 'eat 模式臻品也应有更高回复');

  const ssmash = freshState(t0);
  ssmash.gear = ['sewing'];
  ssmash.vitals.energy = 80;
  applyWork(ssmash, 'linen_embroidery', t0, 'home');
  advance(ssmash, new Date(t0.getTime() + 310 * 60_000), { gradeRoll: 0.01 });
  assert.equal(ssmash.workOutputs.length, 0, '做砸退货不得写入 workOutputs 作品库');

  const smove = freshState(t0);
  smove.wants.push({ id: 'w-manual-1', what: '去老小区菜市场逛逛', kind: 'place', scale: 'small', since: t0.toISOString() });
  const mv = applyMove(smove, 'old', t0);
  assert.equal(mv.ok, true);
  assert.ok(smove.wants.some((w) => w.id === 'w-manual-1'), '搬家不得误删包含档位词的手动心愿');

  // 5) P0 #1 + P1 #6: 无头 DOM 实点 data-care="medicine" 无 ReferenceError + 全外出门禁生效
  const dir = mkdtempSync(join(tmpdir(), 'life-fix-p0-'));
  const prevDoc = globalThis.document;
  try {
    let fixedNow = new Date('2026-11-28T15:00:00+08:00');
    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, townUrl: 'http://127.0.0.1:9' },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => fixedNow,
    });
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => e,
      store: {},
      drainPendingEvents: async () => [],
    });
    world.state.updatedAt = fixedNow.toISOString();
    world.state.conditions.push({
      id: 'overwork',
      since: fixedNow.toISOString(),
      until: new Date(fixedNow.getTime() + 36 * 3_600_000).toISOString(),
      text: '过劳静养。浑身乏力，不能出家门，最多只能在家照料菜园动植物。',
    });

    assert.equal(applyCert(world.state, '健康证', fixedNow).ok, false);
    assert.equal(applyLearn(world.state, 'camera', fixedNow).ok, false);
    assert.equal(applyMove(world.state, 'old', fixedNow).ok, false);
    const tools = new Map(world.tools().map((x) => [x.name, x.handler]));
    assert.match((await tools.get('life_buy')({ stall_id: 's1' })).text, /生病静养/);
    assert.match((await tools.get('life_stall')({ item: '烤红薯', price: 12 })).text, /生病静养/);
    assert.match((await tools.get('life_farm')({ action: 'accept_errand', errand_id: 'e1' })).text, /生病静养/);

    const makeNode = (tag) => {
      const listeners = {};
      return {
        tagName: String(tag).toUpperCase(),
        children: [],
        style: { cssText: '' },
        className: '',
        id: '',
        hidden: false,
        disabled: false,
        title: '',
        open: false,
        value: '',
        attrs: {},
        _text: '',
        ownerDocument: null,
        get textContent() { return this._text + this.children.map((c) => c.textContent || '').join(''); },
        set textContent(v) { this._text = String(v ?? ''); this.children = []; },
        get innerHTML() { return ''; },
        set innerHTML(_) { this.children = []; this._text = ''; },
        append(...items) {
          for (const it of items) {
            if (typeof it === 'string') this.children.push({ textContent: it, children: [], style: {}, attrs: {} });
            else if (it) { it.parentNode = this; this.children.push(it); }
          }
        },
        prepend(...items) {
          for (const it of items.reverse()) {
            const c = typeof it === 'string' ? { textContent: it, children: [], style: {}, attrs: {} } : it;
            if (c) this.children.unshift(c);
          }
        },
        appendChild(it) { this.append(it); return it; },
        addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
        click() { for (const fn of listeners.click || []) fn({}); },
        setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); },
      };
    };
    const findAll = (n, pred, out = []) => {
      if (!n) return out;
      if (pred(n)) out.push(n);
      for (const ch of n.children || []) findAll(ch, pred, out);
      return out;
    };
    const fakeDoc = {
      head: makeNode('head'),
      body: makeNode('body'),
      createElement(tag) { const el = makeNode(tag); el.ownerDocument = fakeDoc; return el; },
      createTextNode(t) { return { textContent: String(t ?? ''), children: [], attrs: {} }; },
      getElementById(id) { return findAll(this.head, (x) => x.id === id)[0] || findAll(this.body, (x) => x.id === id)[0] || null; },
    };
    fakeDoc.head.ownerDocument = fakeDoc;
    fakeDoc.body.ownerDocument = fakeDoc;
    globalThis.document = fakeDoc;

    const panelMod = await import(`../web/panel-1.6.3.js?careclick=${Date.now()}`);
    const nowRoot = fakeDoc.createElement('div');
    await panelMod.default.panels.now.mount({
      root: nowRoot,
      language: 'zh',
      invoke: (m, a) => world.panelInvoke('now', m, a),
      timeout: () => 0,
    });
    const medBtn = findAll(nowRoot, (n) => n.attrs?.['data-care'] === 'medicine')[0];
    assert.ok(medBtn, '应渲染 data-care="medicine" 按钮');
    medBtn.click();
    await new Promise((r) => setTimeout(r, 30));
    assert.doesNotMatch(nowRoot.textContent, /ReferenceError|not defined/);
    assert.match(nowRoot.textContent, /今日已照料 ✓/);
    assert.match(nowRoot.textContent, /还剩约 18 小时/);

    await world.stop();
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    rmSync(dir, { recursive: true, force: true });
  }
});
