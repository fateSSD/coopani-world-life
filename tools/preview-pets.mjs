#!/usr/bin/env node
/**
 * 本机预览「管鱼页」。
 *
 * ## 为什么需要它
 *
 * `/pets` 那个页面是 Worker 发出来的，改完之后要 `wrangler deploy` 才在线上看得到。
 * 而「本城」这一版还没部署（用户要求先不上传）。所以想看一眼新页签长什么样，
 * 只能本地起一个最小的假服务。
 *
 * ## 它是什么、不是什么
 *
 * 是**一个 60 行的 mock**：只实现 `/admin/town`（读写）+ 一条 `/admin/live` 的假数据。
 * **不是**整套 Worker 的本地版 —— 别的接口回空，页面上那两块会是空的，那是正常的。
 *
 * 城设定存在 `tools/.preview-town.json`，刷新还在、关掉再开也还在，
 * 这样能验出「保存之后重开还是那份」这条链。删掉那个文件就回默认。
 *
 * 用法：`node tools/preview-pets.mjs`　然后打开 http://127.0.0.1:8788/pets/town
 * 密钥随便填（这个 mock 不验）。
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/*
 * 要预览的那张页面**属于 journey 包**，不在这个包里 —— 这个脚本只是借过来跑。
 * 换机器要改这一行，或者给一个环境变量 `PETS_HTML`。
 */
const pageFile = process.env.PETS_HTML
  || 'C:/Users/Administrator/WorkBuddy/2026-10-31-11-15-27/coopani-world-journey/site/pets.html';
const storeFile = join(here, '.preview-town.json');

/** 和服务端 `TOWN_DEFAULTS` / 客户端 `BUILTIN_TOWN` 同一份。 */
const DEFAULTS = {
  id: 'luhuatang',
  name: '芦花塘',
  origin: '这一片是活水，不深，长着芦苇。每年秋天芦花一开，整片塘白得像落了雪。'
    + '塘边最早只有两户人家，一户在浅滩上种藕，一户磨豆腐。后来人多了，就有了街。'
    + '住在这儿的人出门回来，望见那片白，就知道到家了。',
  streets: ['早市街', '灶前巷', '望水坡'],
  /*
   * 四条城规。前三条各自对一条机制（§4.17）；**第一条不对应任何机制 ——
   * 它对应这个世界的底线：住在这儿的都是鱼，鱼不吃鱼。**
   *
   * 2026-11-15 补：Mr.Q 一句「这是肥鱼们住的地方，你在这杀鱼卖鱼，这合理嘛」，
   * 点破了整个方案里最难看的一处 —— 我原来的来历写着「一户卖鱼、一户腌鱼」，
   * 街上还有一条「鱼市街」。**那是同类相食，而我从头到尾没觉得不对。**
   *
   * 这一条写进数据里不是摆设：以后加菜谱、加职业、加上游的时候，
   * 它是一条能直接拿来判的规则。
   */
  rules: ['塘里的不吃塘里的', '货不过夜', '价自己定，别人说贵你就听着', '赊账记在心里，不记在账上'],
};

function loadTown() {
  try {
    const j = JSON.parse(readFileSync(storeFile, 'utf8'));
    return { ...DEFAULTS, ...j, custom: true, at: j.at || '' };
  } catch {
    return { ...DEFAULTS, custom: false, at: '' };
  }
}

const json = (res, status, body) => {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(s);
};

const readBody = (req) => new Promise((resolve) => {
  let buf = '';
  req.on('data', (c) => { buf += c; });
  req.on('end', () => {
    try { resolve(JSON.parse(buf || '{}')); } catch { resolve(null); }
  });
});

/** 假数据，只为了让「此刻」那一块不空 —— 内容对不上真实池子，看布局用。 */
const FAKE_LIVE = {
  ok: true,
  online: 3,
  today: 17,
  onlineWindowMin: 30,
  at: new Date().toISOString(),
  pets: [
    { uid: 'a'.repeat(24), pet: '小银鱼', city: 'xian', doing: '在城墙上走', at: new Date().toISOString(), profile: { text: '', at: '', expired: false } },
    { uid: 'b'.repeat(24), pet: '阿沅', city: 'luhuatang', doing: '灶前巷腌萝卜', at: new Date().toISOString(), profile: { text: '住灶前巷，做酱的', at: new Date().toISOString(), expired: false } },
  ],
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/pets' || path === '/pets/all' || path === '/pets/town') {
    let html;
    try { html = readFileSync(pageFile, 'utf8'); } catch {
      res.writeHead(500); res.end('找不到 site/pets.html'); return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(html);
    return;
  }

  if (path === '/admin/live') return json(res, 200, FAKE_LIVE);
  if (path === '/admin/flags') return json(res, 200, { ok: true, flags: [] });
  if (path === '/admin/pets') {
    return json(res, 200, {
      ok: true,
      truncated: false,
      pets: FAKE_LIVE.pets.map((p) => ({
        uid: p.uid, pet: p.pet, city: p.city, last: p.at, rows: 3, cities: 1, days: 1, kind: '', note: '', profile: p.profile,
      })),
    });
  }

  if (path === '/' || path === '/admin') return json(res, 200, { ok: true });

  if (path === '/admin/town') {
    if (req.method === 'GET') return json(res, 200, { ok: true, town: loadTown() });
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!body) return json(res, 400, { ok: false, error: 'bad json' });
      const id = String(body.id ?? '').trim();
      if (!/^[a-z0-9_-]{1,40}$/i.test(id)) return json(res, 400, { ok: false, error: 'bad id' });
      const name = String(body.name ?? '').trim().slice(0, 24);
      if (!name) return json(res, 400, { ok: false, error: 'bad name' });
      const clean = (arr, max, n) => (Array.isArray(arr) ? arr : [])
        .map((x) => String(x ?? '').trim().slice(0, max)).filter(Boolean).slice(0, n);
      const streets = clean(body.streets, 12, 5);
      const rules = clean(body.rules, 60, 5);
      if (!streets.length || !rules.length) return json(res, 400, { ok: false, error: 'bad lists' });
      const at = new Date().toISOString();
      const town = {
        id, name,
        origin: String(body.origin ?? '').trim().slice(0, 400) || DEFAULTS.origin,
        streets, rules, at,
      };
      writeFileSync(storeFile, JSON.stringify(town, null, 2), 'utf8');
      return json(res, 200, { ok: true, town: { ...town, custom: true } });
    }
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }

  /*
   * 其余接口一律 404，**行为要和真服务端一致** ——
   * 页面上有专门的 404 分支（提示「Worker 还是旧版」），让 mock 也走那条，
   * 才能看出那句提示本身写得好不好。
   */
  return json(res, 404, { ok: false, error: 'not found' });
});

const PORT = Number(process.env.PORT) || 8788;
server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  本机预览已起来（这是 mock，不是真服务器）');
  console.log('');
  console.log(`    本城（新页签）：http://127.0.0.1:${PORT}/pets/town`);
  console.log(`    此刻：          http://127.0.0.1:${PORT}/pets`);
  console.log('');
  console.log('  地址会自动填成这个 origin，密钥随便填。');
  console.log('  城设定存在 tools/.preview-town.json —— 删掉就回默认。');
  console.log('');
  console.log('  Ctrl+C 停。');
});
