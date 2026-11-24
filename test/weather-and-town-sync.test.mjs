import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { LifeWorld } = await import('../src/world.ts');
const { LIFE_DEFAULTS, clampWeatherTimeoutMs, normWeatherUrl, lifeConfigGroups } = await import('../src/config.ts');
const { fetchExternalWeather } = await import('../src/bridge.ts');
const { skyFromExternal, snapshot, weatherOf, applyAct, freshState } = await import('../src/state.ts');

const silentHost = {
  log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
  pushEvent: async (e) => e,
  store: {},
  drainPendingEvents: async () => [],
};

function mkDir() {
  return mkdtempSync(join(tmpdir(), 'life-weather-town-'));
}

async function waitFor(cond, ms = 1500) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.ok(cond(), '等待异步条件超时');
}

test('街道属性同步回归：管理页改完 /town/info 后无需重启，now 面板拉取与断网保护均正确', async () => {
  const dir = mkDir();
  let funMod = 10;
  let workMod = 0;
  let failInfo = false;
  let infoCalls = 0;

  const srv = createServer((req, res) => {
    const url = req.url || '';
    if (url.startsWith('/town/info')) {
      infoCalls += 1;
      if (failInfo) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'temp down' }));
        return;
      }
      const mods = { energy: 10, clean: -10, fun: funMod, ...(workMod ? { work: workMod } : {}) };
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({
        ok: true,
        town: 'lanzhou',
        name: '兰州',
        origin: '黄河穿城',
        streets: ['南滨河路', '张掖路'],
        streetProfiles: [
          { name: '南滨河路', desc: '河风拂面。', mods },
          { name: '张掖路', desc: '早市热闹。', mods: { food: 10 } },
        ],
        rules: ['河里的不吃河里的'],
        custom: true,
      }));
      return;
    }
    if (url.startsWith('/town/join')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, town: 'lanzhou', name: '兰州', street: '南滨河路' }));
      return;
    }
    if (url.startsWith('/town/stalls')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, stalls: [], bulletin: [] }));
      return;
    }
    if (url.startsWith('/town/deals')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, unseen: 0, deals: [] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const fixedNow = new Date('2026-11-24T04:00:00Z');
    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, townUrl: base },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => fixedNow,
    });
    await world.start(silentHost);
    const snap0 = await world.webUi().invoke('now', 'snapshot');
    assert.equal(snap0.streetQuotes[0].name, '南滨河路');
    assert.equal(snap0.streetQuotes[0].mods.fun, 10);

    // 模拟服务端管理员把南滨河路改成 娱+15% 与 +3% 精细微调
    funMod = 15;
    workMod = 3;
    // 冷却期内 snapshot 不重打网络
    const infoBefore = infoCalls;
    await world.webUi().invoke('now', 'snapshot');
    assert.equal(infoCalls, infoBefore, '30 秒冷却期内 snapshot 不得重复拉 /town/info');

    // 越过 30 秒冷却后，打开或自动轮询 now 面板即同步最新属性
    world.lastTownFetchMs = Date.now() - 35_000;
    const snap1 = await world.webUi().invoke('now', 'snapshot');
    assert.equal(infoCalls, infoBefore + 1);
    assert.equal(snap1.streetQuotes[0].mods.fun, 15);
    assert.equal(snap1.streetQuotes[0].mods.work, 3);

    // 临时 500 故障时自动刷新不得覆盖已有服务端档案（防 UI 闪烁退回默认）
    failInfo = true;
    funMod = 22;
    world.lastTownFetchMs = Date.now() - 35_000;
    const snapErr = await world.webUi().invoke('now', 'snapshot');
    assert.equal(snapErr.town.source, 'server');
    assert.equal(snapErr.streetQuotes[0].mods.fun, 15, '临时 500 时应保留上次有效的服务端街道属性');

    // 恢复后通过 reloadTown 强制刷新立即拿到最新 22%
    failInfo = false;
    await world.webUi().invoke('now', 'reloadTown');
    const snap2 = await world.webUi().invoke('now', 'snapshot');
    assert.equal(snap2.streetQuotes[0].mods.fun, 22);

    await world.stop();
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('外部天气映射、配置校验与 fetchExternalWeather 边界', async () => {
  assert.equal(skyFromExternal('小毛毛雨'), '小雨');
  assert.equal(skyFromExternal('雷阵雨'), '小雨');
  assert.equal(skyFromExternal('阵雨'), '小雨');
  assert.equal(skyFromExternal('中雪'), '多云');
  assert.equal(skyFromExternal('大雾'), '多云');
  assert.equal(skyFromExternal('阴'), '多云');
  assert.equal(skyFromExternal('东北大风'), '起风');
  assert.equal(skyFromExternal('扬沙'), '起风');
  assert.equal(skyFromExternal('重度霾'), '起风');
  assert.equal(skyFromExternal('晴'), '晴');
  assert.equal(skyFromExternal('晴间多云'), '晴');
  assert.equal(skyFromExternal('冻云未知'), '多云');

  assert.equal(normWeatherUrl(' http://127.0.0.1:7791/now/ '), 'http://127.0.0.1:7791');
  assert.equal(clampWeatherTimeoutMs(undefined), 2500);
  assert.equal(clampWeatherTimeoutMs(9999), 3000);
  assert.equal(clampWeatherTimeoutMs(100), 500);

  const cfgProps = lifeConfigGroups()[0].schema.properties;
  assert.ok(cfgProps['worlds.life.weatherMode']?.['x-hot']);
  assert.ok(cfgProps['worlds.life.weatherUrl']?.['x-hot']);
  assert.ok(cfgProps['worlds.life.weatherTimeoutMs']?.['x-hot']);

  const fixedNow = new Date('2026-11-24T04:00:00Z');
  const baseInfo = weatherOf('兰州', fixedNow);
  const rainInfo = weatherOf('兰州', fixedNow, { sky: '小雨', source: '中国天气网', rawWeather: '小毛毛雨', temperature: 8.8 });
  assert.equal(rainInfo.sky, '小雨');
  assert.equal(rainInfo.external, true);
  assert.equal(rainInfo.temperature, 8.8);
  assert.equal(rainInfo.source, '中国天气网');
  assert.equal(rainInfo.solarTerm, baseInfo.solarTerm);
  assert.match(rainInfo.seasonNote, /（小雨）/);

  const srv = createServer((req, res) => {
    if (req.url?.startsWith('/now')) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: '上游超时' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  try {
    const emptyRes = await fetchExternalWeather('', '北京');
    assert.equal(emptyRes.ok, false);
    const errRes = await fetchExternalWeather(`http://127.0.0.1:${port}`, '北京', 1500);
    assert.equal(errRes.ok, false);
    assert.equal(errRes.error, '上游超时');
  } finally {
    srv.close();
  }
});

test('外部天气端到端：真城名查询、小雨做饭心情、10 分钟缓存、builtin 零请求、external 失联兜底红灯与双实例隔离', async () => {
  const dirA = mkDir();
  const dirB = mkDir();
  const dirBuiltin = mkDir();
  const dirExtFail = mkDir();
  const dirAutoFail = mkDir();
  const citiesQueriedA = [];
  const citiesQueriedB = [];
  let hitsA = 0;

  const srvA = createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    if (u.pathname === '/now') {
      hitsA += 1;
      citiesQueriedA.push(u.searchParams.get('city'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        current: { weather: '小毛毛雨', temperature: 8.8, source: '中国天气网' },
        source: ['中国天气网', 'Open-Meteo'],
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const srvB = createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    if (u.pathname === '/now') {
      citiesQueriedB.push(u.searchParams.get('city'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        current: { weather: '晴', temperature: 21.4, source: 'Open-Meteo' },
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const srvFail = createServer((req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: '中国天气网与 Open-Meteo 均失败' }));
  });

  await Promise.all([
    new Promise((r) => srvA.listen(0, '127.0.0.1', r)),
    new Promise((r) => srvB.listen(0, '127.0.0.1', r)),
    new Promise((r) => srvFail.listen(0, '127.0.0.1', r)),
  ]);
  const urlA = `http://127.0.0.1:${srvA.address().port}`;
  const urlB = `http://127.0.0.1:${srvB.address().port}`;
  const urlFail = `http://127.0.0.1:${srvFail.address().port}`;
  const fixedNow = new Date('2026-11-24T04:00:00Z');

  try {
    // 1. auto 成功 + 真城名 + 状态灯 + cook 小雨联动 + 10 分钟节流 + 与另一实例隔离
    const worldA = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, weatherMode: 'auto', weatherUrl: urlA, weatherTimeoutMs: 2000 },
      dataDir: dirA,
      botName: '甲鱼',
      now: () => fixedNow,
    });
    await worldA.start(silentHost);
    await waitFor(() => hitsA >= 1);

    // 即使 state.street 已分配为本城具体街道（非「兰州」），请求外部天气仍传城名「兰州」
    assert.ok(worldA.town.streets.includes(worldA.state.street) && worldA.state.street !== '兰州');
    assert.deepEqual(citiesQueriedA, ['兰州']);

    const worldB = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, homeCity: '成都', weatherMode: 'auto', weatherUrl: urlB },
      dataDir: dirB,
      botName: '乙鱼',
      now: () => fixedNow,
    });
    await worldB.start(silentHost);
    await waitFor(() => citiesQueriedB.length >= 1);
    assert.deepEqual(citiesQueriedB, ['成都']);

    const snapA = await worldA.webUi().invoke('now', 'snapshot');
    assert.equal(snapA.weather.sky, '小雨');
    assert.equal(snapA.weather.temperature, 8.8);
    assert.equal(snapA.weather.source, '中国天气网');
    assert.equal(snapA.weather.external, true);
    assert.match(snapA.weather.seasonNote, /（小雨）/);

    const lampA = worldA.webUi().lamps.find((l) => l.label === '外部天气');
    assert.equal(lampA?.state, 'online');
    assert.match(lampA?.hint || '', /中国天气网/);
    assert.match(lampA?.hint || '', /8\.8°C/);

    // 另一独立实例仍保持自己的晴天，不被 worldA 缓存串台
    const snapB = await worldB.webUi().invoke('now', 'snapshot');
    assert.equal(snapB.weather.sky, '晴');
    assert.equal(snapB.weather.temperature, 21.4);
    assert.equal(snapB.weather.source, 'Open-Meteo');

    // 10 分钟缓存节流：再跑 tick 不重发 /now
    await worldA.tick();
    assert.equal(hitsA, 1, '10 分钟有效期内 tick 不得重复请求外部天气');

    // 小雨天气下触发 life_act('cook') 的下雨热汤面心情
    const actTool = worldA.tools().find((t) => t.name === 'life_act');
    const cookRes = await actTool.handler({ kind: 'cook' });
    assert.ok(cookRes.text);
    const hasRainCookMood = worldA.state.moodlets.some((m) => m.source === 'weather-cook');
    assert.equal(hasRainCookMood, true, '外部小雨天做饭应触发小雨热汤面心情');

    // 2. builtin 模式与空 url 严格 0 请求
    let builtinHits = 0;
    const srvBuiltin = createServer((_req, res) => { builtinHits += 1; res.writeHead(200); res.end('{}'); });
    await new Promise((r) => srvBuiltin.listen(0, '127.0.0.1', r));
    try {
      const worldBuiltin = new LifeWorld({
        cfg: {
          ...LIFE_DEFAULTS(),
          enabled: true,
          weatherMode: 'builtin',
          weatherUrl: `http://127.0.0.1:${srvBuiltin.address().port}`,
        },
        dataDir: dirBuiltin,
        botName: '内置鱼',
        now: () => fixedNow,
      });
      await worldBuiltin.start(silentHost);
      await worldBuiltin.tick();
      await worldBuiltin.webUi().invoke('now', 'reloadTown');
      assert.equal(builtinHits, 0, 'builtin 模式下绝对不能发出任何天气网络请求');
      const lampBuiltin = worldBuiltin.webUi().lamps.find((l) => l.label === '外部天气');
      assert.equal(lampBuiltin?.state, 'offline');
      await worldBuiltin.stop();
    } finally {
      srvBuiltin.close();
    }

    // 3. external 模式失联：仍返回内置有效天气（绝不空值），且状态灯标红并提示错误原因
    const worldFail = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, weatherMode: 'external', weatherUrl: urlFail },
      dataDir: dirExtFail,
      botName: '失联鱼',
      now: () => fixedNow,
    });
    await worldFail.start(silentHost);
    await worldFail.webUi().invoke('now', 'reloadTown');
    const snapFail = await worldFail.webUi().invoke('now', 'snapshot');
    assert.ok(['晴', '多云', '小雨', '起风'].includes(snapFail.weather.sky), 'external 失联时仍须回退有效内置天象');
    assert.equal(Boolean(snapFail.weather.external), false);
    const lampFail = worldFail.webUi().lamps.find((l) => l.label === '外部天气');
    assert.equal(lampFail?.state, 'error');
    assert.match(lampFail?.hint || '', /均失败/);

    // 4. auto 模式遇 500：静默回退内置天象不抛错、不影响 tick，状态灯标注回退原因
    const worldAutoFail = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, weatherMode: 'auto', weatherUrl: urlFail },
      dataDir: dirAutoFail,
      botName: '自动回退鱼',
      now: () => fixedNow,
    });
    await worldAutoFail.start(silentHost);
    await worldAutoFail.webUi().invoke('now', 'reloadTown');
    await worldAutoFail.tick();
    const snapAutoFail = await worldAutoFail.webUi().invoke('now', 'snapshot');
    assert.ok(['晴', '多云', '小雨', '起风'].includes(snapAutoFail.weather.sky));
    assert.equal(Boolean(snapAutoFail.weather.external), false);
    const lampAutoFail = worldAutoFail.webUi().lamps.find((l) => l.label === '外部天气');
    assert.match(lampAutoFail?.hint || '', /回退内置/);

    // 测试 snapshot(freshState, fixedNow) 不受残留副作用影响
    assert.equal(Boolean(snapshot(freshState(fixedNow), fixedNow).weather.external), false);
    assert.equal(applyAct(freshState(fixedNow), 'cook', fixedNow, { weatherSky: '小雨' }).ok, true);

    await worldA.stop();
    await worldB.stop();
    await worldFail.stop();
    await worldAutoFail.stop();
  } finally {
    srvA.close();
    srvB.close();
    srvFail.close();
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
    rmSync(dirBuiltin, { recursive: true, force: true });
    rmSync(dirExtFail, { recursive: true, force: true });
    rmSync(dirAutoFail, { recursive: true, force: true });
  }
});
