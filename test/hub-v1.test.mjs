import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { LifeWorld } = await import('../src/world.ts');
const { LIFE_DEFAULTS } = await import('../src/config.ts');
const {
  ensureHubAuth,
  readHubAuth,
  writeHubAuthAtomic,
  hubGetTown,
  hubListTowns,
  hubGetCatalogSnapshot,
} = await import('../src/hub-client.ts');
const { freshState, StateStore, readLedger } = await import('../src/state.ts');

function mkDir() {
  return mkdtempSync(join(tmpdir(), 'life-hub-v1-'));
}

function makeSilentHost(pushedEvents = []) {
  return {
    log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
    pushEvent: async (e) => {
      pushedEvents.push(e);
      return e;
    },
    store: {},
    drainPendingEvents: async () => [],
  };
}

function startMockHub(handlers = {}) {
  const calls = [];
  const state = {
    registerCount: 0,
    joinTownCalls: [],
    tradeHeaders: [],
    claimHeaders: [],
    settledOrderIds: [],
    ackedEventIds: [],
    cancelledListings: [],
    cancelledErrands: [],
    sentMessages: [],
    markedReadConvs: [],
    relationsPut: [],
    etagHits304: 0,
    unreadCount: 2,
    errands: [
      {
        id: 'err_same_1',
        townId: 'lanzhou-reedpond',
        requesterPetId: 'pet_neighbor_1',
        requesterName: '花卷',
        errandKind: 'farm_care',
        title: '农牧代管·轻托(2菜1牧/20分)',
        rewardPrice: 12,
        estMinutes: 20,
        expiresAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
      },
      {
        id: 'err_cross_2',
        townId: 'beijing',
        requesterPetId: 'pet_bj_1',
        requesterName: '豆汁儿',
        errandKind: 'farm_care',
        title: '北京四合院浇菜(1菜/12分)',
        rewardPrice: 10,
        estMinutes: 12,
        expiresAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
      },
    ],
    listings: [
      {
        id: 'list_cross_1',
        townId: 'beijing',
        townName: '北京',
        sellerPetId: 'pet_bj_seller',
        sellerName: '京城手艺人',
        isMine: false,
        category: 'craft',
        itemCode: 'bj_sugar_man',
        isSpecialty: true,
        itemName: '景泰蓝小发卡',
        unitPrice: 25,
        stockTotal: 3,
        stockLeft: 3,
        isCrossTown: true,
        estimatedShippingFee: 6,
        effects: { fun: 16, clean: 6 },
        meta: { freshVeg: false, note: '老北京手作特产' },
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      {
        id: 'my_list_1',
        townId: 'lanzhou-reedpond',
        townName: '兰州·芦花塘',
        sellerPetId: 'pet_self_01',
        sellerName: '大肥鱼',
        isMine: true,
        category: 'craft',
        itemCode: null,
        isSpecialty: false,
        itemName: '手工毛毡挂件',
        unitPrice: 30,
        stockTotal: 4,
        stockLeft: 2,
        isCrossTown: false,
        estimatedShippingFee: 0,
        effects: { fun: 12 },
        meta: { freshVeg: false },
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    ],
    orders: [],
    inboxEvents: [],
    companions: [
      { petId: 'pet_journey_mate', displayName: '雪球旅伴', avatarTag: '', source: 'journey', lastAt: new Date().toISOString() },
    ],
    residencyTownId: 'lanzhou-reedpond',
    conversations: [
      {
        id: 'conv_1',
        convType: 'direct',
        title: null,
        peer: { petId: 'pet_neighbor_1', displayName: '花卷' },
        unreadCount: 2,
        lastMessage: {
          id: 501,
          senderPetId: 'pet_neighbor_1',
          msgType: 'text',
          body: '好呀带红薯去',
          createdAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      },
    ],
    messagesByConv: {
      conv_1: [
        {
          id: 500,
          conversationId: 'conv_1',
          senderPetId: 'pet_self_01',
          msgType: 'text',
          body: '晚上煮茶不？',
          meta: {},
          createdAt: new Date(Date.now() - 60_000).toISOString(),
        },
        {
          id: 501,
          conversationId: 'conv_1',
          senderPetId: 'pet_neighbor_1',
          msgType: 'text',
          body: '好呀带红薯去',
          meta: {},
          createdAt: new Date().toISOString(),
        },
      ],
    },
    residentsByTown: {
      'lanzhou-reedpond': [
        { petId: 'pet_neighbor_1', displayName: '花卷', street: 'nanbinhe', lastSeenAt: new Date().toISOString() },
        { petId: 'pet_self_01', displayName: '大肥鱼', street: 'nanbinhe', lastSeenAt: new Date().toISOString() },
      ],
      beijing: [
        { petId: 'pet_bj_1', displayName: '豆汁儿', street: 'nanluoguxiang', lastSeenAt: new Date().toISOString() },
      ],
    },
    towns: {
      'lanzhou-reedpond': {
        id: 'lanzhou-reedpond',
        name: '兰州·芦花塘',
        originDesc: '黄河边有苇子、早市和微风的老城。',
        notice: '芦花塘黑板报：今早黄河边鲜菜水灵。',
        rules: ['鱼不吃鱼', '买卖公平'],
        streets: [
          { id: 'nanbinhe', name: '南滨河路', desc: '河边步道', mods: { clean: 5, energy: 5 } },
          { id: 'zhangye', name: '张掖路', desc: '烟火老街', mods: { food: 5, fun: 5 } },
        ],
        buffs: { cooking_pay_mult: 1.05 },
        shipping: { base_fee: 6, per_extra_qty: 1 },
        metaVersion: 2,
        etag: '"lz-v2"',
      },
      beijing: {
        id: 'beijing',
        name: '北京',
        originDesc: '灰砖胡同和钟鼓楼之间的北国老城。',
        notice: '北京胡同公告：南锣鼓巷手作和文字零活热闹。',
        rules: ['问路先叫一声您好', '买卖公平'],
        streets: [
          { id: 'nanluoguxiang', name: '南锣鼓巷', desc: '灰砖胡同和小店', mods: { fun: 10, social: 10 } },
          { id: 'shichahai', name: '什刹海', desc: '水面柳树与胡同', mods: { clean: 10, energy: 10 } },
        ],
        buffs: { craft_mod_bonus: 2, writing_pay_mult: 1.08 },
        shipping: { base_fee: 6, per_extra_qty: 1 },
        metaVersion: 1,
        etag: '"bj-v1"',
      },
    },
  };

  const srv = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      const path = u.pathname;
      const method = req.method || 'GET';
      const body = raw ? JSON.parse(raw) : {};
      calls.push({ method, path, query: u.search, headers: req.headers, body });

      const send = (status, payload, extraHeaders = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...extraHeaders });
        res.end(JSON.stringify(payload));
      };

      if (typeof handlers.custom === 'function') {
        const handled = handlers.custom({ method, path, u, req, res, body, state, send });
        if (handled) return;
      }

      if (path === '/v1/core/pets/register' && method === 'POST') {
        state.registerCount += 1;
        if (handlers.conflict409) {
          send(409, { ok: false, error: { code: 'LEGACY_UID_CLAIMED', message: '该 legacyUid 已被认领' } });
          return;
        }
        send(200, {
          ok: true,
          data: {
            petId: 'pet_self_01',
            displayName: body.displayName || '大肥鱼',
            legacyUid: body.legacyUid ?? null,
            token: 'tok_mock_self_01',
          },
        });
        return;
      }

      if (path === '/v1/towns' && method === 'GET') {
        send(200, {
          ok: true,
          data: {
            towns: Object.values(state.towns).map((t) => ({
              id: t.id,
              name: t.name,
              notice: t.notice,
              residentCount: (state.residentsByTown[t.id] || []).length,
              metaVersion: t.metaVersion,
            })),
          },
        });
        return;
      }

      const townMatch = path.match(/^\/v1\/towns\/([^/]+)$/);
      if (townMatch && method === 'GET') {
        const tid = decodeURIComponent(townMatch[1]);
        const meta = state.towns[tid];
        if (!meta) {
          send(404, { ok: false, error: { code: 'TOWN_NOT_FOUND', message: '城镇不存在' } });
          return;
        }
        if (req.headers['if-none-match'] === meta.etag) {
          state.etagHits304 += 1;
          res.writeHead(304, { etag: meta.etag });
          res.end();
          return;
        }
        send(200, { ok: true, data: meta }, { etag: meta.etag });
        return;
      }

      const joinMatch = path.match(/^\/v1\/towns\/([^/]+)\/join$/);
      if (joinMatch && method === 'POST') {
        const tid = decodeURIComponent(joinMatch[1]);
        const meta = state.towns[tid];
        if (!meta) {
          send(404, { ok: false, error: { code: 'TOWN_NOT_FOUND', message: '城镇不存在' } });
          return;
        }
        const stObj = meta.streets.find((s) => s.id === body.street || s.name === body.street) || meta.streets[0];
        state.joinTownCalls.push({ townId: tid, street: stObj.id });
        send(200, {
          ok: true,
          data: { townId: meta.id, townName: meta.name, street: stObj.id, streetName: stObj.name },
        });
        return;
      }

      const resMatch = path.match(/^\/v1\/towns\/([^/]+)\/residents$/);
      if (resMatch && method === 'GET') {
        const tid = decodeURIComponent(resMatch[1]);
        send(200, { ok: true, data: { residents: state.residentsByTown[tid] || [] } });
        return;
      }

      if (path.startsWith('/v1/core/pets/me/ext/') && method === 'PUT') {
        send(200, { ok: true, data: { updated: true } });
        return;
      }

      if (path === '/v1/core/catalog/snapshot' && method === 'GET') {
        const catEtag = '"cat-v1"';
        if (req.headers['if-none-match'] === catEtag) {
          res.writeHead(304, { etag: catEtag });
          res.end();
          return;
        }
        send(200, {
          ok: true,
          data: {
            version: 1,
            items: [
              { code: 'bj_sugar_man', name: '景泰蓝小发卡', townId: 'beijing', category: 'craft', isSpecialty: true, basePrice: 25 },
            ],
            jobs: [],
          },
        }, { etag: catEtag });
        return;
      }

      if (path === '/v1/market/listings' && method === 'GET') {
        send(200, { ok: true, data: { buyerTownId: 'lanzhou-reedpond', listings: state.listings } });
        return;
      }

      if (path === '/v1/market/listings' && method === 'POST') {
        const id = `lst_${Date.now().toString(36)}`;
        send(200, {
          ok: true,
          data: {
            id,
            townId: body.townId,
            itemName: body.itemName,
            unitPrice: body.unitPrice,
            stockTotal: body.stockTotal,
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          },
        });
        return;
      }

      const delListMatch = path.match(/^\/v1\/market\/listings\/([^/]+)$/);
      if (delListMatch && method === 'DELETE') {
        const lid = decodeURIComponent(delListMatch[1]);
        state.cancelledListings.push(lid);
        state.listings = state.listings.filter((l) => l.id !== lid);
        send(200, { ok: true, data: { cancelled: true, id: lid } });
        return;
      }

      const tradeMatch = path.match(/^\/v1\/market\/listings\/([^/]+)\/trade$/);
      if (tradeMatch && method === 'POST') {
        const lid = decodeURIComponent(tradeMatch[1]);
        state.tradeHeaders.push(req.headers['idempotency-key'] || '');
        const lst = state.listings.find((l) => l.id === lid);
        if (!lst) {
          send(404, { ok: false, error: { code: 'LISTING_NOT_OPEN', message: '摊位不存在' } });
          return;
        }
        const qty = Number(body.qty || 1);
        const subtotal = lst.unitPrice * qty;
        const ship = lst.isCrossTown ? lst.estimatedShippingFee : 0;
        lst.stockLeft -= qty;
        send(200, {
          ok: true,
          data: {
            id: `ord_${Date.now().toString(36)}`,
            listingId: lst.id,
            sellerTownId: lst.townId,
            buyerTownId: 'lanzhou-reedpond',
            isCrossTown: lst.isCrossTown,
            sellerPetId: lst.sellerPetId,
            itemCode: lst.itemCode,
            itemName: lst.itemName,
            qty,
            unitPrice: lst.unitPrice,
            itemSubtotal: subtotal,
            shippingFee: ship,
            buyerTotal: subtotal + ship,
            effectsSnapshot: lst.effects || {},
          },
        });
        return;
      }

      if (path === '/v1/market/orders' && method === 'GET') {
        send(200, { ok: true, data: { orders: state.orders } });
        return;
      }

      if (path === '/v1/market/orders/settle' && method === 'POST') {
        const ids = Array.isArray(body.orderIds) ? body.orderIds : [];
        state.settledOrderIds.push(...ids);
        for (const o of state.orders) {
          if (ids.includes(o.id)) o.settledAt = new Date().toISOString();
        }
        send(200, { ok: true, data: { settledIds: ids } });
        return;
      }

      if (path === '/v1/errands' && method === 'GET') {
        send(200, { ok: true, data: { townId: 'lanzhou-reedpond', errands: state.errands } });
        return;
      }

      if (path === '/v1/errands' && method === 'POST') {
        const id = `err_new_${Date.now().toString(36)}`;
        const exp = new Date(Date.now() + 6 * 3_600_000).toISOString();
        state.errands.push({
          id,
          townId: body.townId,
          requesterPetId: 'pet_self_01',
          requesterName: '大肥鱼',
          errandKind: body.errandKind,
          title: body.title,
          rewardPrice: body.rewardPrice,
          estMinutes: body.estMinutes,
          expiresAt: exp,
        });
        send(200, { ok: true, data: { id, expiresAt: exp } });
        return;
      }

      const claimMatch = path.match(/^\/v1\/errands\/([^/]+)\/claim$/);
      if (claimMatch && method === 'POST') {
        const eid = decodeURIComponent(claimMatch[1]);
        state.claimHeaders.push(req.headers['idempotency-key'] || '');
        const er = state.errands.find((e) => e.id === eid);
        if (!er) {
          send(404, { ok: false, error: { code: 'ERRAND_NOT_FOUND', message: '委托已不见' } });
          return;
        }
        if (er.id === 'err_cross_2') {
          send(403, { ok: false, error: { code: 'ERRAND_TOWN_MISMATCH', message: '农牧代管委托仅限同城街坊互助，不能跨城接单' } });
          return;
        }
        send(200, {
          ok: true,
          data: {
            id: er.id,
            townId: er.townId,
            errandKind: er.errandKind,
            title: er.title,
            rewardPrice: er.rewardPrice,
            estMinutes: er.estMinutes,
            status: 'claimed',
          },
        });
        return;
      }

      const cancelErrMatch = path.match(/^\/v1\/errands\/([^/]+)\/cancel$/);
      if (cancelErrMatch && method === 'POST') {
        const eid = decodeURIComponent(cancelErrMatch[1]);
        state.cancelledErrands.push(eid);
        state.errands = state.errands.filter((e) => e.id !== eid);
        send(200, { ok: true, data: { id: eid, status: 'cancelled' } });
        return;
      }

      if (path === '/v1/inbox/sync' && method === 'GET') {
        const after = Number(u.searchParams.get('after_id') || 0);
        const events = state.inboxEvents.filter((e) => e.id > after);
        const nextAfterId = events.length ? Math.max(...events.map((e) => e.id)) : after;
        send(200, { ok: true, data: { events, nextAfterId } });
        return;
      }

      if (path === '/v1/inbox/ack' && method === 'POST') {
        const ids = Array.isArray(body.eventIds) ? body.eventIds : [];
        state.ackedEventIds.push(...ids);
        send(200, { ok: true, data: { ackedCount: ids.length } });
        return;
      }

      if (path === '/v1/core/pets/me' && method === 'GET') {
        send(200, {
          ok: true,
          data: {
            petId: 'pet_self_01',
            residency: state.residencyTownId ? { townId: state.residencyTownId, townName: state.residencyTownId, street: 'nanbinhe' } : null,
          },
        });
        return;
      }

      if (path === '/v1/social/companions' && method === 'GET') {
        send(200, { ok: true, data: { companions: state.companions } });
        return;
      }

      if (path === '/v1/social/relations' && method === 'GET') {
        send(200, {
          ok: true,
          data: {
            relations: [{ targetPetId: 'pet_neighbor_1', displayName: '花卷', relType: 'acquaintance', aliasNote: '' }],
          },
        });
        return;
      }

      const relPutMatch = path.match(/^\/v1\/social\/relations\/([^/]+)$/);
      if (relPutMatch && method === 'PUT') {
        state.relationsPut.push({ petId: decodeURIComponent(relPutMatch[1]), relType: body.relType });
        send(200, { ok: true, data: { updated: true } });
        return;
      }

      if (path === '/v1/social/conversations/direct' && method === 'POST') {
        send(200, { ok: true, data: { id: 'conv_1' } });
        return;
      }

      if (path === '/v1/social/conversations' && method === 'GET') {
        const convs = state.conversations.map((c) => (
          c.id === 'conv_1' ? { ...c, unreadCount: state.unreadCount } : c
        ));
        send(200, { ok: true, data: { conversations: convs } });
        return;
      }

      const msgMatch = path.match(/^\/v1\/social\/conversations\/([^/]+)\/messages$/);
      if (msgMatch && method === 'GET') {
        const cid = decodeURIComponent(msgMatch[1]);
        send(200, { ok: true, data: { lastReadMsgId: 500, messages: state.messagesByConv[cid] || [] } });
        return;
      }
      if (msgMatch && method === 'POST') {
        const cid = decodeURIComponent(msgMatch[1]);
        const nextId = 502 + state.sentMessages.length;
        const msg = {
          id: nextId,
          conversationId: cid,
          senderPetId: 'pet_self_01',
          msgType: body.msgType || 'text',
          body: body.body,
          meta: {},
          createdAt: new Date().toISOString(),
        };
        state.sentMessages.push({ cid, clientMsgId: body.clientMsgId, body: body.body });
        (state.messagesByConv[cid] ??= []).push(msg);
        send(200, { ok: true, data: msg });
        return;
      }

      const readMatch = path.match(/^\/v1\/social\/conversations\/([^/]+)\/read$/);
      if (readMatch && method === 'POST') {
        const cid = decodeURIComponent(readMatch[1]);
        state.markedReadConvs.push(cid);
        state.unreadCount = 0;
        send(200, { ok: true, data: { lastReadMsgId: 501 } });
        return;
      }

      send(404, { ok: false, error: { code: 'NOT_FOUND', message: `Unhandled ${method} ${path}` } });
    });
  });

  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        state,
        calls,
        close: () => new Promise((done) => srv.close(() => done())),
      });
    });
  });
}

test('Hub v1 身份认领与持久化复用 + 409 LEGACY_UID_CLAIMED 防裂号保护', async () => {
  const dir1 = mkDir();
  const dir2 = mkDir();
  const mock1 = await startMockHub();
  const mock409 = await startMockHub({ conflict409: true });
  try {
    const legacyUid = '11223344556677889900aabbccddeeff';
    writeFileSync(join(dir1, 'meet-uid.txt'), `${legacyUid}\n`, 'utf8');

    const w1 = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, hubUrl: mock1.url, hubTownId: 'lanzhou-reedpond' },
      dataDir: dir1,
      botName: '大肥鱼',
    });
    await w1.start(makeSilentHost());
    assert.equal(mock1.state.registerCount, 1);
    const saved = readHubAuth(dir1);
    assert.ok(saved);
    assert.equal(saved.petId, 'pet_self_01');
    assert.equal(saved.legacyUid, legacyUid);
    assert.equal(saved.token, 'tok_mock_self_01');
    await w1.stop();

    // 二次启动必须复用本地 coopanion-hub-auth.json，不重调 register
    const w1b = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, hubUrl: mock1.url, hubTownId: 'lanzhou-reedpond' },
      dataDir: dir1,
      botName: '大肥鱼',
    });
    await w1b.start(makeSilentHost());
    assert.equal(mock1.state.registerCount, 1);
    await w1b.stop();

    // 409 LEGACY_UID_CLAIMED 场景：报错且不生成本地 auth 文件，绝不裂号
    writeFileSync(join(dir2, 'meet-uid.txt'), `${legacyUid}\n`, 'utf8');
    const w2 = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, hubUrl: mock409.url, hubTownId: 'lanzhou-reedpond' },
      dataDir: dir2,
      botName: '大肥鱼',
    });
    await w2.start(makeSilentHost());
    assert.equal(readHubAuth(dir2), null);
    assert.equal(existsSync(join(dir2, 'coopanion-hub-auth.json')), false);
    const mailTool = w2.tools().find((t) => t.name === 'life_mail');
    const errOut = await mailTool.handler({ action: 'inbox' });
    assert.match(errOut.text, /已被 Hub v1 认领|LEGACY_UID_CLAIMED|tokens\/reset/);
    await w2.stop();
  } finally {
    await mock1.close();
    await mock409.close();
    rmSync(dir1, { recursive: true, force: true });
    rmSync(dir2, { recursive: true, force: true });
  }
});

test('Hub v1 多城信息 ETag/304、北京 writing_pay_mult 1.08 实算、与面板/工具迁城', async () => {
  const dir = mkDir();
  const mock = await startMockHub();
  const pushed = [];
  try {
    // 预置符合老师岗位要求的状态（教师资格证 + 30天工龄）
    const now = new Date('2026-11-27T10:00:00.000+08:00');
    const st = freshState(now);
    st.vitals = { food: 90, energy: 95, clean: 90, fun: 80, social: 80 };
    st.money.cash = 500;
    st.job.certs.push('教师资格证');
    st.job.days = 30;
    new StateStore(dir).save(st);

    // 验证 ETag 304 缓存命中
    const townsRes = await hubListTowns(mock.url);
    assert.equal(townsRes.ok, true);
    assert.equal(townsRes.towns.length, 2);
    const t1 = await hubGetTown(mock.url, 'beijing');
    assert.equal(t1.ok, true);
    assert.equal(t1.etag, '"bj-v1"');
    const t304 = await hubGetTown(mock.url, 'beijing', { etag: t1.etag });
    assert.equal(t304.ok, true);
    assert.equal(t304.notModified, true);
    assert.equal(t304.status, 304);
    assert.equal(mock.state.etagHits304, 1);

    const cat = await hubGetCatalogSnapshot(mock.url, { ext: 'life', townId: 'beijing' });
    assert.equal(cat.ok, true);
    assert.ok(cat.items.some((x) => x.code === 'bj_sugar_man' && x.isSpecialty));

    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, hubUrl: mock.url, hubTownId: 'beijing' },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => now,
    });
    await world.start(makeSilentHost(pushed));

    const workTool = world.tools().find((t) => t.name === 'life_work');
    const workOut = await workTool.handler({ what: '小学代课老师' });
    assert.match(workOut.text, /北京风貌加成 \+8%/);
    const ui = world.webUi();
    const careerSnap = await ui.invoke('career', 'snapshot');
    assert.equal(careerSnap.job.daily, Math.round(320 * 1.08));

    // 清掉进行中活动以便测试迁城
    const cancelOut = await world.tools().find((t) => t.name === 'life_act').handler({ kind: 'cancel' });
    assert.ok(cancelOut.text);

    // 面板迁城到兰州
    const movedPanel = await ui.invoke('now', 'moveTown', { townId: 'lanzhou-reedpond' });
    assert.equal(movedPanel.ok, true);
    assert.equal(movedPanel.town.id, 'lanzhou-reedpond');
    assert.ok(pushed.some((e) => e.type === 'life.moved' && String(e.text || '').includes('兰州')));

    // 工具迁城回北京
    const moveTool = world.tools().find((t) => t.name === 'life_move');
    const moveToolOut = await moveTool.handler({ town: 'beijing' });
    assert.match(moveToolOut.text, /北京/);

    await world.stop();
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Hub v1 跨城买摊实扣货款+运费明细、卖家仅入账 itemSubtotal 并结算与面板下架', async () => {
  const dir = mkDir();
  const mock = await startMockHub();
  try {
    const now = new Date('2026-11-27T11:00:00.000+08:00');
    const st = freshState(now);
    st.money.cash = 500;
    new StateStore(dir).save(st);

    // 注入卖家一笔待结算跨城订单（unitPrice=30, qty=2 -> itemSubtotal=60, shippingFee=6, buyerTotal=66）
    mock.state.orders.push({
      id: 'ord_cross_sell_1',
      listingId: 'my_list_1',
      sellerTownId: 'lanzhou-reedpond',
      buyerTownId: 'beijing',
      isCrossTown: true,
      sellerPetId: 'pet_self_01',
      takerPetId: '豆汁儿',
      itemCode: null,
      itemName: '手工毛毡挂件',
      qty: 2,
      unitPrice: 30,
      itemSubtotal: 60,
      shippingFee: 6,
      buyerTotal: 66,
      buyerNote: '好看',
      settledAt: null,
      createdAt: now.toISOString(),
    });
    mock.state.inboxEvents.push({
      id: 101,
      sourceExt: 'life',
      eventType: 'market.order_created',
      refId: 'ord_cross_sell_1',
      payload: { orderId: 'ord_cross_sell_1' },
      createdAt: now.toISOString(),
    });

    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, hubUrl: mock.url, hubTownId: 'lanzhou-reedpond' },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => now,
    });
    await world.start(makeSilentHost());
    const ui = world.webUi();

    // 触发刷新：既拉到跨城摊位 list_cross_1，又自动结算卖家订单 ord_cross_sell_1 (+60 而不含 +6 运费)，且 ack 101
    const snapAfterRefresh = await ui.invoke('market', 'snapshot');
    assert.ok(snapAfterRefresh.otherStalls.some((s) => s.id === 'list_cross_1' && s.isCrossTown && s.estimatedShippingFee === 6));
    assert.equal(snapAfterRefresh.money.cash, 560);
    assert.ok(mock.state.settledOrderIds.includes('ord_cross_sell_1'));
    assert.ok(mock.state.ackedEventIds.includes(101));

    // 买家跨城买 list_cross_1：单价 25 + 运费 6 = 实扣 31 -> 560 - 31 = 529
    const buyTool = world.tools().find((t) => t.name === 'life_buy');
    const buyRes = await buyTool.handler({ stall_id: 'list_cross_1' });
    assert.match(buyRes.text, /景泰蓝小发卡/);
    assert.match(buyRes.text, /快递费 6 元/);
    assert.equal(mock.state.tradeHeaders.length, 1);
    assert.ok(mock.state.tradeHeaders[0].startsWith('trade-'));

    const snapAfterBuy = await ui.invoke('now', 'snapshot');
    assert.equal(snapAfterBuy.money.cash, 529);
    const ledger = readLedger(dir, 20);
    assert.ok(ledger.some((r) => r.kind === 'income' && r.amount === 60 && r.source === 'life_stall_sale'));
    assert.ok(ledger.some((r) => r.kind === 'expense' && r.amount === 31 && r.source === 'life_buy' && r.note.includes('含货款 25 元 + 跨城快递费 6 元')));

    // 面板一键下架自己的摊位
    const cancelRes = await ui.invoke('market', 'cancelListing', { listingId: 'my_list_1' });
    assert.equal(cancelRes.ok, true);
    assert.ok(mock.state.cancelledListings.includes('my_list_1'));

    await world.stop();
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Hub v1 同城代管委托发单/接单/跨城 403 防护与面板撤单退预扣', async () => {
  const dir = mkDir();
  const mock = await startMockHub();
  try {
    const now = new Date('2026-11-27T09:30:00.000+08:00');
    const st = freshState(now);
    st.money.cash = 300;
    st.vitals.energy = 90;
    new StateStore(dir).save(st);

    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, hubUrl: mock.url, hubTownId: 'lanzhou-reedpond' },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => now,
    });
    await world.start(makeSilentHost());
    const ui = world.webUi();

    // 种两格菜，使其处于待浇水状态（然后用新日期或直接让 applyPlant 不浇完？种完立即为需照料或进面板 postErrand 测试）
    await ui.invoke('market', 'plant', { seed: '青菜' });
    const afterPlantCash = (await ui.invoke('now', 'snapshot')).money.cash;

    // 1) 面板发邻里代管单并随后撤单退预扣（手动置回待浇并重置现金为 300，保证必走到完整断言链）
    world.state.farm.plots[0].wateredDay = '';
    world.state.money.cash = 300;
    world.saveDeliveredState();
    await world.stop();
    const w2 = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, hubUrl: mock.url, hubTownId: 'lanzhou-reedpond' },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => now,
    });
    await w2.start(makeSilentHost());
    const ui2 = w2.webUi();
    const posted2 = await ui2.invoke('market', 'postErrand', { mode: 'care' });
    assert.equal(posted2.ok, true, `postErrand should succeed: ${posted2.reason}`);
    const cashAfterPost = posted2.money.cash;
    assert.ok(cashAfterPost < 300);

    const newErrId = mock.state.errands.find((e) => e.requesterPetId === 'pet_self_01')?.id;
    assert.ok(newErrId);
    const cancelled = await ui2.invoke('market', 'cancelErrand', { errandId: newErrId });
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.money.cash, 300, '未到期撤回委托必须全额退回预扣工钱');
    assert.equal(w2.state.farmHelper.pendingErrand, null, '撤回后 pendingErrand 必须清空');
    assert.ok(mock.state.cancelledErrands.includes(newErrId));

    // 2) 跨城接单 403 ERRAND_TOWN_MISMATCH
    await ui2.invoke('market', 'snapshot');
    const farmTool = w2.tools().find((t) => t.name === 'life_farm');
    const crossOut = await farmTool.handler({ action: 'accept_errand', errand_id: 'err_cross_2' });
    assert.match(crossOut.text, /同城|跨城|ERRAND_TOWN_MISMATCH/);

    // 3) 接同城单成功并带 Idempotency-Key
    const sameOut = await farmTool.handler({ action: 'accept_errand', errand_id: 'err_same_1' });
    assert.match(sameOut.text, /接下了街坊 花卷 的农牧代管委托/);
    assert.equal(mock.state.claimHeaders.length >= 1, true);
    assert.ok(mock.state.claimHeaders.at(-1).startsWith('claim-'));
    await w2.stop();
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Hub v1 鱼间私信 life_mail、social.new_message 不自清未读、与面板显式标已读', async () => {
  const dir = mkDir();
  const mock = await startMockHub();
  const pushed = [];
  try {
    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, hubUrl: mock.url, hubTownId: 'lanzhou-reedpond' },
      dataDir: dir,
      botName: '大肥鱼',
    });
    await world.start(makeSilentHost(pushed));
    const mail = world.tools().find((t) => t.name === 'life_mail');
    const ui = world.webUi();

    const resOut = await mail.handler({ action: 'residents' });
    assert.match(resOut.text, /花卷/);

    const relOut = await mail.handler({ action: 'relation', peer: '花卷', rel_type: 'friend' });
    assert.match(relOut.text, /好友/);
    assert.equal(mock.state.relationsPut.length, 1);

    // 注入一条收件箱新私信通知
    mock.state.inboxEvents.push({
      id: 202,
      sourceExt: 'life',
      eventType: 'social.new_message',
      refId: '501',
      payload: { messageId: 501, senderName: '花卷', preview: '好呀带红薯去' },
      createdAt: new Date().toISOString(),
    });

    // 刷新同步收件箱：必须 ack 202 并推送 life.social，但绝对不能私自调 /read 清零未读数
    const afterRefresh = await ui.invoke('relation', 'mailRefresh');
    assert.ok(mock.state.ackedEventIds.includes(202));
    assert.equal(mock.state.markedReadConvs.length, 0);
    assert.equal(afterRefresh.hub.unreadMail, 2);
    assert.ok(pushed.some((e) => e.type === 'life.social' && String(e.text || '').includes('花卷')));

    // 面板拉取私信气泡（依然不触发 /read）
    const msgsRes = await ui.invoke('relation', 'mailMessages', { conversationId: 'conv_1' });
    assert.equal(msgsRes.ok, true);
    assert.equal(msgsRes.messages.length, 2);
    assert.equal(mock.state.markedReadConvs.length, 0);

    // 面板显式标已读：此时才调 POST /read 且未读数清零
    const readDone = await ui.invoke('relation', 'mailMarkRead', { conversationId: 'conv_1' });
    assert.equal(readDone.ok, true);
    assert.deepEqual(mock.state.markedReadConvs, ['conv_1']);
    assert.equal(readDone.hub.unreadMail, 0);

    // 写信携带 clientMsgId
    const sentOut = await mail.handler({ action: 'send', peer: '花卷', message: '今晚来喝热茶吗' });
    assert.match(sentOut.text, /今晚来喝热茶吗/);
    assert.equal(mock.state.sentMessages.length, 1);
    assert.ok(mock.state.sentMessages[0].clientMsgId.startsWith('msg-'));

    await world.stop();
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Hub v1 断网降级不崩、清空 hubUrl 平滑退回单机、及无头 DOM 挂载全 7 页签', async () => {
  const dir = mkDir();
  const mock = await startMockHub();
  const prevDoc = globalThis.document;

  class FakeNode {
    constructor(nodeType, tagName) {
      this.nodeType = nodeType;
      this.tagName = String(tagName || 'div').toUpperCase();
      this.children = [];
      this.attrs = {};
      this.listeners = {};
      this.className = '';
      this.id = '';
      this._text = '';
      this.style = {};
      this.disabled = false;
      this.value = '';
      this.checked = false;
      this.placeholder = '';
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
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'id') this.id = String(v);
    }
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
  function findById(node, id) {
    if (!node || node.nodeType === 3) return null;
    if (node.id === id) return node;
    for (const c of node.children || []) {
      const hit = findById(c, id);
      if (hit) return hit;
    }
    return null;
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
    const cfg = { ...LIFE_DEFAULTS(), enabled: true, hubUrl: mock.url, hubTownId: 'beijing' };
    const world = new LifeWorld({ cfg, dataDir: dir, botName: '大肥鱼' });
    await world.start(makeSilentHost());
    const ui = world.webUi();
    await ui.invoke('market', 'snapshot');

    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const panelMod = await import(`../${pkg.cortico.webUiClient}?hubtest=${Date.now()}`);
    const panels = panelMod.default.panels;
    const tabNames = ['now', 'career', 'wants', 'relation', 'market', 'diary', 'library'];
    const mountedText = {};
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
      mountedText[tab] = root.textContent;
      assert.ok(mountedText[tab].length > 10, `页签 ${tab} 在 Hub 模式下必须非空渲染`);
    }
    assert.match(mountedText.now, /北京/);
    assert.match(mountedText.market, /景泰蓝小发卡/);
    assert.match(mountedText.relation, /花卷/);

    // 停掉 mock 服务器测试断网降级
    await mock.close();
    const statusOk = await world.tools().find((t) => t.name === 'life_status').handler({});
    assert.ok(statusOk.text.length > 0);
    await ui.invoke('market', 'snapshot');

    // 清空 hubUrl 热更新退回单机
    cfg.hubUrl = '';
    await world.tick();
    const mailAfterOff = await world.tools().find((t) => t.name === 'life_mail').handler({ action: 'inbox' });
    assert.match(mailAfterOff.text, /还没接入 Hub/);

    await world.stop();
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    await mock.close().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureHubAuth 409 竞态自愈 + panel-1.5.0 独立报错区 lf-alert 与 Buff 汉化', async () => {
  const dirRace = mkDir();
  const dirMiss = mkDir();
  const mock409 = await startMockHub({ conflict409: true });
  const prevDoc = globalThis.document;

  class FakeNode {
    constructor(tag = 'div') {
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.className = '';
      this.hidden = false;
      this.attrs = {};
      this.style = {};
      this._text = '';
      this.id = '';
    }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this._text = String(v ?? ''); this.children = []; }
    set innerHTML(v) { if (!v) { this.children = []; this._text = ''; } }
    append(...ns) { for (const n of ns) if (n) this.children.push(typeof n === 'string' ? { textContent: n } : n); }
    prepend(...ns) { this.children = [...ns.filter(Boolean).map((n) => (typeof n === 'string' ? { textContent: n } : n)), ...this.children]; }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }
    addEventListener() {}
    find(pred) {
      if (pred(this)) return this;
      for (const c of this.children) {
        const hit = c.find?.(pred);
        if (hit) return hit;
      }
      return null;
    }
  }
  const fakeDoc = {
    head: new FakeNode('head'),
    body: new FakeNode('body'),
    createElement: (t) => new FakeNode(t),
    createTextNode: (s) => ({ textContent: String(s ?? '') }),
    getElementById(id) { return this.head.find((n) => n.id === id) || this.body.find((n) => n.id === id); },
  };
  fakeDoc.head.ownerDocument = fakeDoc;
  fakeDoc.body.ownerDocument = fakeDoc;
  globalThis.document = fakeDoc;

  try {
    const legacyUid = '78797e521122334455667788';
    writeFileSync(join(dirRace, 'meet-uid.txt'), `${legacyUid}\n`, 'utf8');
    setTimeout(() => {
      writeHubAuthAtomic(dirRace, {
        schema: 1,
        hubUrl: mock409.url,
        petId: 'pet_sister_journey',
        token: 'chub_from_sister_journey',
        legacyUid,
        displayName: '大肥鱼',
        updatedAt: new Date().toISOString(),
      });
    }, 60);

    const raced = await ensureHubAuth({
      hubUrl: mock409.url,
      dataDir: dirRace,
      displayName: '大肥鱼',
      conflictRetryDelaysMs: [0, 100, 200],
    });
    assert.equal(raced.ok, true);
    assert.equal(raced.created, false);
    assert.equal(raced.auth?.petId, 'pet_sister_journey');

    // 面板 snapshot 磁盘自愈
    new StateStore(dirRace).save(freshState(new Date()));
    const w = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, hubUrl: mock409.url, hubTownId: 'lanzhou-reedpond' },
      dataDir: dirRace,
      botName: '大肥鱼',
    });
    w.hubAuth = null;
    w.hubAuthError = '老服 uid 已被认领';
    const snap = await w.webUi().invoke('now', 'snapshot');
    assert.equal(snap.hub.petId, 'pet_sister_journey');
    assert.equal(snap.hub.authError, '');

    // 无共享凭据时仍返回 409
    writeFileSync(join(dirMiss, 'meet-uid.txt'), `${legacyUid}\n`, 'utf8');
    const missed = await ensureHubAuth({
      hubUrl: mock409.url,
      dataDir: dirMiss,
      displayName: '大肥鱼',
      conflictRetryDelaysMs: [0, 25],
    });
    assert.equal(missed.ok, false);
    assert.equal(missed.code, 'LEGACY_UID_CLAIMED');

    // 验证 panel-1.6.1.js：报错进入 lf-alert（不混入 lf-note），且兰州小数 bonus 汉化为百分比
    const panelMod = await import(`../web/panel-1.6.1.js?alertbuff=${Date.now()}`);
    const root = new FakeNode('div');
    root.ownerDocument = fakeDoc;
    fakeDoc.body.append(root);
    await panelMod.default.panels.now.mount({
      root,
      language: 'zh',
      invoke: async () => ({
        version: '1.6.0',
        dayPart: '早上',
        clock: '07:45',
        town: {
          name: '兰州',
          source: 'server',
          notice: '黄河风吹过芦花塘',
          buffs: { crop_yield_bonus: 0.1, noodle_craft_bonus: 0.15, craft_mood_bonus: 2 },
          shipping: { base_fee: 5, per_extra_qty: 1 },
        },
        hub: {
          enabled: true,
          petId: 'pet_0mwy',
          authError: '老服 uid（78797e52…）已被 Hub v1 认领',
          towns: [],
          specialties: [],
          residents: [],
          conversations: [],
          unreadMail: 0,
        },
        journey: { installed: false },
        vitals: {},
        low: [],
        goals: [],
        conditions: [],
        moodlets: [],
        overdue: [],
        pending: [],
        home: {},
        job: {},
        money: { cash: 100 },
        skills: {},
        streetQuotes: [],
      }),
      timeout: () => 0,
    });

    const alertEl = root.find((n) => n.className === 'lf-alert');
    const noteEl = root.find((n) => n.className === 'lf-note');
    const heroChipsEl = root.find((n) => n.className === 'lf-hero-chips');
    assert.ok(alertEl && alertEl.hidden === false, '应显示独立 lf-alert 报错区');
    assert.match(alertEl.textContent, /总服连接报错/);
    assert.match(alertEl.textContent, /78797e52/);
    assert.ok(noteEl && !noteEl.textContent.includes('78797e52'), 'lf-note 城门公告不得混入总服报错');
    assert.match(heroChipsEl.textContent, /农作收成 \+10%/);
    assert.match(heroChipsEl.textContent, /面食手作 \+15%/);
    assert.match(heroChipsEl.textContent, /手作心情加成 \+2/);
    assert.ok(!heroChipsEl.textContent.includes('crop_yield_bonus'), '顶部 Buff 不应再暴露英文键');
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    await mock409.close();
    rmSync(dirRace, { recursive: true, force: true });
    rmSync(dirMiss, { recursive: true, force: true });
    rmSync(join(process.cwd(), '.tmp-noop-never'), { recursive: true, force: true });
  }
});

test('P0-2/P0-3/P1 综合回归：迁居持久化、已结算订单不重刷、29位Hub ID、旅伴寻人与睡眠拦截、多服凭据并单飞锁', async () => {
  const dir = mkDir();
  let ackShouldFail = true;
  const mock = await startMockHub({
    custom: ({ method, path, body, state, send }) => {
      if (path === '/v1/inbox/ack' && method === 'POST' && ackShouldFail) {
        send(500, { ok: false, error: { code: 'TMP_FAIL', message: 'ack fail' } });
        return true;
      }
      if (path === '/v1/social/conversations/direct' && method === 'POST' && body.targetPetId === 'pet_journey_mate') {
        state.conversations.push({
          id: 'conv_mate',
          convType: 'direct',
          title: null,
          peer: { petId: 'pet_journey_mate', displayName: '雪球旅伴' },
          unreadCount: 0,
          lastMessage: null,
          updatedAt: new Date().toISOString(),
        });
        send(200, { ok: true, data: { id: 'conv_mate' } });
        return true;
      }
      return false;
    },
  });
  const now = new Date('2026-11-27T11:00:00.000+08:00');
  try {
    // 准备一条已结算的 Hub 历史订单，验证本地清零 settledDeals 后绝不会重复入账
    mock.state.orders.push({
      id: 'ord_settled_before',
      listingId: 'my_list_1',
      sellerTownId: 'lanzhou-reedpond',
      buyerTownId: 'beijing',
      isCrossTown: true,
      makerPetId: 'pet_self_01',
      takerPetId: 'pet_bj_1',
      takerName: '豆汁儿',
      itemName: '手工毛毡挂件',
      qty: 1,
      unitPrice: 30,
      itemSubtotal: 30,
      shippingFee: 6,
      buyerTotal: 36,
      effectsSnapshot: { fun: 12 },
      buyerNote: '',
      settledAt: new Date().toISOString(),
      createdAt: now.toISOString(),
    });
    // 准备一条 29 位 Hub ID 委托 + 一条非农牧跑腿（应被过滤）
    mock.state.errands.push(
      {
        id: 'err_hub29abcdef1234567890ab',
        townId: 'lanzhou-reedpond',
        requesterPetId: 'pet_neighbor_1',
        requesterName: '花卷',
        errandKind: 'farm_care',
        title: '长ID浇水单(1菜/15分)',
        rewardPrice: 9,
        estMinutes: 15,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
      {
        id: 'err_delivery_skip_123456',
        townId: 'lanzhou-reedpond',
        requesterPetId: 'pet_neighbor_1',
        requesterName: '花卷',
        errandKind: 'delivery',
        title: '送包裹跑腿',
        rewardPrice: 20,
        estMinutes: 10,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    );
    mock.state.inboxEvents.push(
      {
        id: 301,
        sourceExt: 'life',
        eventType: 'market.order_created',
        refId: 'ord_x',
        payload: {},
        createdAt: now.toISOString(),
      },
      {
        id: 302,
        sourceExt: 'life',
        eventType: 'future.unknown_event',
        refId: 'u_future',
        payload: {},
        createdAt: now.toISOString(),
      },
    );

    const w = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, hubUrl: mock.url, hubTownId: 'lanzhou-reedpond' },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => now,
    });
    // 单飞锁验证：并发两次 ensureHubReady 只调 1 次 /register
    await Promise.all([w.ensureHubReady(w.stateGeneration), w.ensureHubReady(w.stateGeneration)]);
    assert.equal(mock.state.registerCount, 1);

    await w.start(makeSilentHost());
    const startCash = w.state.money.cash;
    // ack 失败时游标不得前进，ack 恢复后才推进
    await w.refreshTownMarket(w.stateGeneration);
    assert.equal(w.hubInboxCursor, 0, 'inbox ack 失败时游标不得提前推进');
    ackShouldFail = false;
    await w.refreshTownMarket(w.stateGeneration);
    assert.equal(w.hubInboxCursor, 302);
    assert.ok(mock.state.ackedEventIds.includes(301));
    assert.ok(!mock.state.ackedEventIds.includes(302), '未知 inbox 事件不得盲 ACK');
    assert.equal(w.state.money.cash, startCash, '已 settledAt 的历史订单绝不重复入账');

    const dealsTool = w.tools().find((t) => t.name === 'life_deals');
    const dealsOut = await dealsTool.handler({ ack: false });
    assert.match(dealsOut.text, /豆汁儿/, 'life_deals 应展示买家昵称 takerName');
    assert.ok(!dealsOut.text.includes('pet_bj_1'), 'life_deals 不应直接暴露 takerPetId');

    // 29 位 Hub ID 前缀/内嵌匹配，且过滤非农牧委托
    const farmTool = w.tools().find((t) => t.name === 'life_farm');
    const listOut = await farmTool.handler({ action: 'accept_errand' });
    assert.ok(!listOut.text.includes('送包裹跑腿'), '不得列出非农牧委托');
    const claimLong = await farmTool.handler({ action: 'accept_errand', errand_id: '请接单 编号 err_hub29abcdef1234567890ab' });
    assert.match(claimLong.text, /长ID浇水单/);

    // 委托完结后再迁城到北京并重启：应持久保持在 beijing
    w.state.activity = null;
    const ui = w.webUi();
    mock.state.residencyTownId = 'beijing';
    const mv = await ui.invoke('now', 'moveTown', { townId: 'beijing' });
    assert.equal(mv.ok, true);
    assert.equal(w.state.hubTownId, 'beijing');
    await w.stop();

    const wReboot = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, hubUrl: mock.url, hubTownId: 'lanzhou-reedpond' },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => now,
    });
    await wReboot.start(makeSilentHost());
    assert.equal(wReboot.town.id, 'beijing', '重启后应延续迁居地 beijing，不可回滚为 lanzhou-reedpond');

    // 异城旅伴通过 companions 寻人解锁私信 + 睡眠时禁发信
    const mail = wReboot.tools().find((t) => t.name === 'life_mail');
    const mateSend = await mail.handler({ action: 'send', peer: '雪球旅伴', message: '到北京啦寄张明信片' });
    assert.match(mateSend.text, /雪球旅伴/);

    wReboot.state.asleepFrom = now.toISOString();
    wReboot.state.asleepUntil = new Date(now.getTime() + 4 * 3_600_000).toISOString();
    const asleepSend = await mail.handler({ action: 'send', peer: '雪球旅伴', message: '梦话' });
    assert.match(asleepSend.text, /睡/);
    // 多服凭据隔离：写第二个 hubUrl 后再按原 mock.url 仍能读回原凭据，且 panelSnapshot 能命中 byHub 自愈
    writeHubAuthAtomic(dir, {
      schema: 1,
      hubUrl: 'https://other-hub.example.org',
      petId: 'pet_other',
      token: 'tok_other',
      legacyUid: null,
      displayName: '大肥鱼',
      updatedAt: now.toISOString(),
    });
    assert.equal(readHubAuth(dir, mock.url)?.petId, 'pet_self_01');
    assert.equal(readHubAuth(dir, 'https://other-hub.example.org')?.petId, 'pet_other');

    wReboot.hubAuth = null;
    wReboot.hubAuthError = '409';
    await wReboot.webUi().invoke('now', 'snapshot');
    assert.equal(wReboot.hubAuth?.petId, 'pet_self_01', 'panelSnapshot 应命中 activeHubUrl() 对应 byHub 凭据自愈');
    assert.equal(wReboot.hubAuthError, '');
    await wReboot.stop();
  } finally {
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Life P2 回归：冷启动跨扩展锁、睡眠静默、热切清缓存、401/403 亮红灯与刷新信箱同步气泡', async () => {
  const dir = mkDir();
  const dirLock = mkDir();
  let nextAuthStatus = 200;
  let nextAuthCode = '';
  let nextAuthMsg = '';
  const mailMsgCalls = [];
  const pushed = [];
  const mock = await startMockHub({
    custom: ({ method, path, send }) => {
      if (path === '/v1/social/conversations/conv_1/messages' && method === 'POST') {
        if (nextAuthStatus === 401 || nextAuthStatus === 403) {
          send(nextAuthStatus, { ok: false, error: { code: nextAuthCode, message: nextAuthMsg } });
          return true;
        }
      }
      return false;
    },
  });
  const now = new Date('2026-11-27T11:00:00.000+08:00');
  const prevDoc = globalThis.document;
  try {
    // 1) 冷启动跨扩展文件锁：并发 ensureHubAuth 只触发 1 次 /register 且自动清理 .lock 文件
    const [a1, a2] = await Promise.all([
      ensureHubAuth({ hubUrl: mock.url, dataDir: dirLock, displayName: '大肥鱼' }),
      ensureHubAuth({ hubUrl: mock.url, dataDir: dirLock, displayName: '大肥鱼' }),
    ]);
    assert.equal(a1.ok, true);
    assert.equal(a2.ok, true);
    assert.equal(mock.state.registerCount, 1);
    assert.equal(existsSync(join(dirLock, 'coopanion-hub-auth.lock')), false, '认证结束后必须清理锁文件');

    const badFile = join(dirLock, 'block-file');
    writeFileSync(badFile, 'x', 'utf8');
    const writeFail = await ensureHubAuth({ hubUrl: mock.url, dataDir: badFile, displayName: '大肥鱼' });
    assert.equal(writeFail.ok, false);
    assert.equal(writeFail.code, 'AUTH_WRITE_FAILED');

    // 2) 睡眠时收到 social.new_message 不推 life.social，且正常 ACK
    const cfg = { ...LIFE_DEFAULTS(), enabled: true, hubUrl: mock.url, hubTownId: 'lanzhou-reedpond' };
    const w = new LifeWorld({ cfg, dataDir: dir, botName: '大肥鱼', now: () => now });
    await w.start(makeSilentHost(pushed));
    w.state.asleepFrom = new Date(now.getTime() - 3_600_000).toISOString();
    w.state.asleepUntil = new Date(now.getTime() + 3_600_000).toISOString();
    mock.state.inboxEvents.push({
      id: 401,
      sourceExt: 'life',
      eventType: 'social.new_message',
      refId: '901',
      payload: { messageId: 901, senderName: '花卷', preview: '晚安问候' },
      createdAt: now.toISOString(),
    });
    await w.refreshTownMarket(w.stateGeneration);
    assert.ok(mock.state.ackedEventIds.includes(401));
    assert.equal(pushed.some((e) => e.type === 'life.social'), false, '睡眠时不得推送 life.social');

    // 3) 运行期捕获 403 RENAME_REQUIRED / 403 ACCOUNT_BANNED / 401 INVALID_TOKEN，亮红灯并在换新 token 后自愈
    w.state.asleepFrom = '';
    w.state.asleepUntil = '';
    const mailTool = w.tools().find((t) => t.name === 'life_mail');
    nextAuthStatus = 403;
    nextAuthCode = 'RENAME_REQUIRED';
    nextAuthMsg = '请先改名';
    await mailTool.handler({ action: 'send', peer: '花卷', message: '改名测试' });
    assert.match(w.worldLamps().find((l) => l.label === '本城')?.state ?? '', /error/);
    let snap = await w.webUi().invoke('now', 'snapshot');
    assert.match(snap.hub.authError, /改名/);

    nextAuthStatus = 403;
    nextAuthCode = 'ACCOUNT_BANNED';
    nextAuthMsg = '违规封禁';
    await mailTool.handler({ action: 'send', peer: '花卷', message: '封禁测试' });
    assert.match(w.worldLamps().find((l) => l.label === '本城')?.state ?? '', /error/);
    snap = await w.webUi().invoke('now', 'snapshot');
    assert.match(snap.hub.authError, /封禁/);

    nextAuthStatus = 401;
    nextAuthCode = 'INVALID_TOKEN';
    nextAuthMsg = 'token revoked';
    await mailTool.handler({ action: 'send', peer: '花卷', message: '失效测试' });
    assert.equal(w.worldLamps().find((l) => l.label === '本城')?.state, 'error');
    // 旧盘仍是同一失效 token 时，panelSnapshot 不得误清报错
    snap = await w.webUi().invoke('now', 'snapshot');
    assert.match(snap.hub.authError, /INVALID_TOKEN/);
    // 管理端 tokens/reset 后写入新 token，panelSnapshot 自动自愈且本城灯变绿
    writeHubAuthAtomic(dir, {
      schema: 1,
      hubUrl: mock.url,
      petId: 'pet_self_01',
      token: 'chub_healed_new_tok',
      legacyUid: null,
      displayName: '大肥鱼',
      updatedAt: now.toISOString(),
    });
    snap = await w.webUi().invoke('now', 'snapshot');
    assert.equal(snap.hub.authError, '');
    assert.equal(w.worldLamps().find((l) => l.label === '本城')?.state, 'online');

    // 4) 热清空 hubUrl 清掉残留摊位与公告缓存
    w.myStallsCache = [{ id: 's1', item: '番茄', price: 5, qty: 1, left: 1, at: now.toISOString(), seller: '大肥鱼' }];
    w.otherStallsCache = [{ id: 's2', item: '红薯', price: 6, qty: 1, left: 1, at: now.toISOString(), seller: '花卷' }];
    w.townBulletin = ['旧公告'];
    cfg.hubUrl = '';
    await w.tick();
    assert.equal(w.myStallsCache.length, 0);
    assert.equal(w.otherStallsCache.length, 0);
    assert.equal(w.townBulletin.length, 0);
    await w.stop();

    // 5) panel-1.6.1.js：点击「刷新信箱」时同步刷新已展开对话气泡
    class MiniNode {
      constructor(nodeType, tagName) {
        this.nodeType = nodeType;
        this.tagName = String(tagName || 'div').toUpperCase();
        this.children = [];
        this.listeners = {};
        this.className = '';
        this._text = '';
        this.style = {};
        this.disabled = false;
        this.type = '';
        this.title = '';
        this.id = '';
      }
      get textContent() { return this.nodeType === 3 ? this._text : this._text + this.children.map((c) => c.textContent).join(''); }
      set textContent(v) { this._text = String(v ?? ''); this.children = []; }
      get innerHTML() { return ''; }
      set innerHTML(v) { if (!v) { this.children = []; this._text = ''; } }
      append(...nodes) { for (const n of nodes) if (n) this.children.push(typeof n === 'string' ? new MiniNode(3, '') : n); }
      prepend(...nodes) { this.children = [...nodes.filter(Boolean), ...this.children]; }
      setAttribute(k, v) { if (k === 'id') this.id = String(v); }
      addEventListener(ev, fn) { (this.listeners[ev] ??= []).push(fn); }
      findAll(pred, out = []) {
        if (pred(this)) out.push(this);
        for (const c of this.children) if (c instanceof MiniNode) c.findAll(pred, out);
        return out;
      }
    }
    const doc = {
      head: new MiniNode(1, 'head'),
      body: new MiniNode(1, 'body'),
      createElement(t) { return new MiniNode(1, t); },
      createTextNode(s) { const n = new MiniNode(3, ''); n._text = String(s ?? ''); return n; },
      getElementById(id) { return this.head.findAll((n) => n.id === id)[0] || this.body.findAll((n) => n.id === id)[0] || null; },
    };
    doc.head.ownerDocument = doc;
    doc.body.ownerDocument = doc;
    globalThis.document = doc;
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const panelMod = await import(`../${pkg.cortico.webUiClient}?p2panel=${Date.now()}`);
    const relRoot = new MiniNode(1, 'div');
    relRoot.ownerDocument = doc;
    const mailSnap = {
      presence: [],
      gifts: [],
      journey: { installed: false },
      hub: {
        enabled: true,
        petId: 'pet_self_01',
        unreadMail: 1,
        residents: [],
        conversations: [{ id: 'conv_1', peer: { petId: 'pet_neighbor_1', displayName: '花卷' }, unreadCount: 1, lastMessage: { body: 'hi' } }],
      },
    };
    await panelMod.default.panels.relation.mount({
      root: relRoot,
      language: 'zh',
      invoke: async (m, args) => {
        if (m === 'snapshot' || m === 'mailRefresh') return mailSnap;
        if (m === 'mailMessages') {
          mailMsgCalls.push(args?.[0]?.conversationId);
          return { ok: true, messages: [{ id: 1, senderPetId: 'pet_neighbor_1', body: 'hi', createdAt: now.toISOString() }] };
        }
        return {};
      },
      timeout: () => 0,
    });
    const convRow = relRoot.findAll((n) => n.className === 'lf-mail-conv')[0];
    assert.ok(convRow);
    for (const fn of convRow.listeners.click || []) fn();
    await new Promise((r) => setTimeout(r, 20));
    const rfBtn = relRoot.findAll((n) => n.tagName === 'BUTTON' && n.textContent === '刷新信箱')[0];
    assert.ok(rfBtn);
    for (const fn of rfBtn.listeners.click || []) fn();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(mailMsgCalls, ['conv_1', 'conv_1'], '刷新信箱应同步刷新当前已展开的对话气泡');
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirLock, { recursive: true, force: true });
  }
});

test('城市 Buff 全量生效：rent_mult 房价调控、7 项 _bonus 数值结算与 16 项面板汉化', async () => {
  const dir = mkDir();
  const diaryDir = mkDir();
  const mock = await startMockHub();
  const now = new Date('2026-11-27T11:00:00.000+08:00');
  const prevDoc = globalThis.document;
  try {
    const {
      clampRentMult, effectiveHomeMonthly, applyYieldBonus, normalizeMoodBonus,
      addPantryItem, applyHarvest, applyCollectRanch, applyHarvestRanch,
    } = await import('../src/state.ts');

    // 1) 房价倍率纯函数边界与数值
    assert.equal(clampRentMult(0), 1);
    assert.equal(clampRentMult(-2), 1);
    assert.equal(clampRentMult(Number.NaN), 1);
    assert.equal(clampRentMult(0.1), 0.3);
    assert.equal(clampRentMult(8), 5);
    assert.equal(effectiveHomeMonthly('urban-village', 1.3), 585);
    assert.equal(effectiveHomeMonthly('old', 1.3), 1560);
    assert.equal(effectiveHomeMonthly('new', 1.3), 3380);
    assert.equal(effectiveHomeMonthly('villa', 1.3), 10140);
    assert.equal(effectiveHomeMonthly('urban-village', 0.8), 360);
    assert.equal(effectiveHomeMonthly('urban-village', 0.3), 135);
    assert.equal(applyYieldBonus(4, -0.5), 2);
    assert.equal(normalizeMoodBonus(0.15), 3);

    // 2) 配置城市 buffs（兰州 1.3 倍房价 + 全套农牧面食心情/体力加成；北京 0.8 倍房价）
    mock.state.towns['lanzhou-reedpond'].buffs = {
      rent_mult: 1.3,
      crop_yield_bonus: 0.1,
      noodle_craft_bonus: 0.15,
      ranch_yield_bonus: 0.2,
      fish_yield_bonus: 1,
      craft_mood_bonus: 2,
      food_mood_bonus: 3,
      writing_mood_bonus: 2,
      labor_pay_mult: 1.1,
    };
    mock.state.towns.beijing.buffs = {
      rent_mult: 0.8,
      writing_pay_mult: 1.08,
      craft_mood_bonus: 2,
    };

    const cfg = { ...LIFE_DEFAULTS(), enabled: true, hubUrl: mock.url, hubTownId: 'lanzhou-reedpond', diaryDir };
    const w = new LifeWorld({ cfg, dataDir: dir, botName: '大肥鱼', now: () => now });
    await w.start(makeSilentHost());

    // 启动后月租与 moveQuotes 均按 rent_mult = 1.3 实时折算
    assert.equal(w.state.home.monthly, 585);
    let snap = await w.webUi().invoke('now', 'snapshot');
    const qMap = Object.fromEntries(snap.moveQuotes.map((q) => [q.tier, q]));
    assert.equal(qMap['urban-village'].monthly, 585);
    assert.equal(qMap.old.monthly, 1560);
    assert.equal(qMap.old.deposit, 3120);
    assert.equal(qMap.new.monthly, 3380);
    assert.equal(qMap.villa.monthly, 10140);

    // 搬去老小区应扣 3120 押金、月租写入 1560
    w.state.money.cash = 4000;
    const moveTool = w.tools().find((t) => t.name === 'life_move');
    await moveTool.handler({ tier: 'old' });
    assert.equal(w.state.home.tier, 'old');
    assert.equal(w.state.home.monthly, 1560);
    assert.equal(w.state.money.cash, 880);

    // 3) crop_yield_bonus（+10% 增产）
    w.state.farm.plots.push({
      id: 'plot_buff_1',
      seedId: 'sweet_potato',
      name: '蜜薯',
      plantedAt: new Date(now.getTime() - 48 * 3_600_000).toISOString(),
      matureAt: new Date(now.getTime() - 60_000).toISOString(),
      waterCount: 0,
      lastWaterAt: '',
      baseYield: 3,
      source: 'home',
    });
    const baseHarvest = applyHarvest(structuredClone(w.state), 'plot_buff_1', now);
    const farmTool = w.tools().find((t) => t.name === 'life_farm');
    await farmTool.handler({ action: 'harvest', plot_id: 'plot_buff_1' });
    const boostedVeg = w.state.pantry.find((p) => p.itemId === 'sweet_potato')?.qty ?? 0;
    assert.equal(boostedVeg, baseHarvest.totalQty + 1, 'crop_yield_bonus=0.1 应从 3 份增产到 4 份');

    // 4) ranch_yield_bonus（+20% 蛋奶）与 fish_yield_bonus（+1 塘鱼）
    w.state.ranch.pens.push(
      {
        id: 'pen_hen_buff',
        animalId: 'hen',
        group: 'chicken',
        name: '散养土鸡',
        startedAt: new Date(now.getTime() - 48 * 3_600_000).toISOString(),
        matureAt: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
        fedAt: '',
        fedDay: '',
        lastCollectedAt: new Date(now.getTime() - 30 * 3_600_000).toISOString(),
        feedCount: 0,
        fedCycleBonus: false,
        source: 'home',
      },
      {
        id: 'pen_fish_buff',
        animalId: 'grass_carp',
        group: 'fish',
        name: '清水草鱼',
        startedAt: new Date(now.getTime() - 120 * 3_600_000).toISOString(),
        matureAt: new Date(now.getTime() - 60_000).toISOString(),
        fedAt: '',
        fedDay: '',
        lastCollectedAt: '',
        feedCount: 0,
        fedCycleBonus: false,
        source: 'home',
      },
    );
    const baseEgg = applyCollectRanch(structuredClone(w.state), 'pen_hen_buff', now).totalQty;
    const baseFish = applyHarvestRanch(structuredClone(w.state), 'pen_fish_buff', now).totalQty;
    assert.ok(baseEgg >= 2, '测试夹具：散养土鸡基准产出应 >= 2');
    assert.ok(baseFish >= 3, '测试夹具：清水草鱼基准产出应 >= 3');
    const ranchTool = w.tools().find((t) => t.name === 'life_ranch');
    await ranchTool.handler({ action: 'collect', pen_id: 'pen_hen_buff' });
    await ranchTool.handler({ action: 'harvest', pen_id: 'pen_fish_buff' });
    const gotEgg = w.state.pantry.find((p) => p.itemId === 'egg')?.qty ?? 0;
    const gotFish = w.state.pantry.find((p) => p.itemId === 'fresh_fish')?.qty ?? 0;
    assert.ok(gotEgg > baseEgg, 'ranch_yield_bonus 应提高蛋奶收集量');
    assert.equal(gotFish, baseFish + 1, 'fish_yield_bonus=1 应额外多收 1 份鲜鱼');

    // 5) noodle_craft_bonus + craft_mood_bonus + food_mood_bonus + writing_mood_bonus
    addPantryItem(w.state.pantry, {
      itemId: 'scallion', kind: 'herb', name: '香葱与罗勒', qty: 3, freshVeg: true, origin: 'home-grown', unitCost: 2, acquiredAt: now.toISOString(),
    });
    addPantryItem(w.state.pantry, {
      itemId: 'potato', kind: 'starch', name: '黄心土豆', qty: 3, freshVeg: true, origin: 'home-grown', unitCost: 2, acquiredAt: now.toISOString(),
    });
    w.state.vitals.fun = 50;
    w.state.vitals.energy = 80;
    const cookTool = w.tools().find((t) => t.name === 'life_cook');
    const noodleStore = await cookTool.handler({ action: 'cook', recipe: '葱油拌面', mode: 'store' });
    assert.match(noodleStore.text, /做好了 3 份/, 'noodle_craft_bonus=0.15 应使面食备菜从 2 份增产至 3 份');
    const noodleDish = w.state.cookedDishes.find((d) => d.recipeId === 'scallion_noodles');
    assert.ok(noodleDish && noodleDish.foodGain > 35 && noodleDish.funGain > 7);
    assert.equal(w.state.vitals.fun, 52, 'store 备菜时 craft_mood_bonus=2 应即时生效');

    const potatoStore = await cookTool.handler({ action: 'cook', recipe: '椒盐烤土豆', mode: 'store' });
    assert.match(potatoStore.text, /做好了 2 份/, '非面食菜谱不应吃到 noodle_craft_bonus');

    const potatoEat = await cookTool.handler({ action: 'cook', recipe: '椒盐烤土豆', mode: 'eat' });
    assert.match(potatoEat.text, /娱乐 \+13/, '烤土豆基础娱乐 8 + food_mood_bonus 3 + craft_mood_bonus 2 = 13');
    w.state.activity = null;

    // 写日记验证 writing_mood_bonus = 2
    const funBeforeDiary = w.state.vitals.fun;
    const diaryTool = w.tools().find((t) => t.name === 'life_diary_write');
    const diaryRes = await diaryTool.handler({ body: '今天菜园丰收，算清楚了城市物价。' });
    assert.match(diaryRes.text, /写作心情 \+2/);
    assert.equal(w.state.vitals.fun, funBeforeDiary + 2);

    // 后 5 个职业域倍率之一（labor_pay_mult = 1.1）在 life_work 生效（搬货 90 -> 99）
    const workTool = w.tools().find((t) => t.name === 'life_work');
    const workOut = await workTool.handler({ what: '搬货' });
    assert.match(workOut.text, /标准工钱 99 元/);
    w.state.activity = null;

    // 6) 迁居去 0.8 倍房价的北京后，state.home.monthly 自动跟着调低（1200 * 0.8 = 960）
    mock.state.residencyTownId = 'beijing';
    await moveTool.handler({ town: 'beijing' });
    assert.equal(w.state.home.monthly, 960);

    // 7) panel-1.6.1.js 对 rent_mult 与后 5 项职业倍率正确输出中文芯片且无裸英文键
    class MiniNode {
      constructor(nodeType, tagName) {
        this.nodeType = nodeType;
        this.tagName = String(tagName || 'div').toUpperCase();
        this.children = [];
        this.listeners = {};
        this.className = '';
        this._text = '';
        this.style = {};
        this.disabled = false;
        this.type = '';
        this.title = '';
        this.id = '';
      }
      get textContent() { return this.nodeType === 3 ? this._text : this._text + this.children.map((c) => c.textContent).join(''); }
      set textContent(v) { this._text = String(v ?? ''); this.children = []; }
      get innerHTML() { return ''; }
      set innerHTML(v) { if (!v) { this.children = []; this._text = ''; } }
      append(...nodes) { for (const n of nodes) if (n) this.children.push(typeof n === 'string' ? new MiniNode(3, '') : n); }
      prepend(...nodes) { this.children = [...nodes.filter(Boolean), ...this.children]; }
      setAttribute(k, v) { if (k === 'id') this.id = String(v); }
      addEventListener(ev, fn) { (this.listeners[ev] ??= []).push(fn); }
      findAll(pred, out = []) {
        if (pred(this)) out.push(this);
        for (const c of this.children) if (c instanceof MiniNode) c.findAll(pred, out);
        return out;
      }
    }
    const doc = {
      head: new MiniNode(1, 'head'),
      body: new MiniNode(1, 'body'),
      createElement(t) { return new MiniNode(1, t); },
      createTextNode(s) { const n = new MiniNode(3, ''); n._text = String(s ?? ''); return n; },
      getElementById(id) { return this.head.findAll((n) => n.id === id)[0] || this.body.findAll((n) => n.id === id)[0] || null; },
    };
    doc.head.ownerDocument = doc;
    doc.body.ownerDocument = doc;
    globalThis.document = doc;
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const panelMod = await import(`../${pkg.cortico.webUiClient}?buffspanel=${Date.now()}`);
    const nowRoot = new MiniNode(1, 'div');
    nowRoot.ownerDocument = doc;
    const uiSnap = {
      version: '1.6.0',
      at: now.toISOString(),
      herNow: now.toISOString(),
      knowledge: 0,
      fitness: 25,
      town: {
        id: 'beijing',
        name: '北京',
        source: 'server',
        buffs: {
          rent_mult: 1.2,
          labor_pay_mult: 1.1,
          social_pay_mult: 1.05,
          admin_pay_mult: 1.06,
          driving_pay_mult: 0.9,
          photo_pay_mult: 1.04,
        },
        shipping: { base_fee: 6, per_extra_qty: 1 },
      },
      hub: { enabled: true, towns: [] },
      vitals: w.state.vitals,
      low: [],
      goals: [],
      conditions: [],
      moodlets: [],
      overdue: [],
      pending: [],
      home: w.state.home,
      job: { what: '', daily: 120, certs: [], days: 0 },
      money: w.state.money,
      skills: {},
      streetQuotes: [],
      moveQuotes: [],
    };
    await panelMod.default.panels.now.mount({
      root: nowRoot,
      language: 'zh',
      invoke: async () => uiSnap,
      timeout: () => 0,
    });
    assert.match(nowRoot.textContent, /房价倍率 \+20%/);
    assert.match(nowRoot.textContent, /体力薪酬 \+10%/);
    assert.match(nowRoot.textContent, /驾驶薪酬 -10%/);
    assert.match(nowRoot.textContent, /影像薪酬 \+4%/);
    assert.ok(!nowRoot.textContent.includes('rent_mult'));
    assert.ok(!nowRoot.textContent.includes('labor_pay_mult'));
    assert.ok(!nowRoot.textContent.includes('driving_pay_mult'));
    assert.ok(!nowRoot.textContent.includes('photo_pay_mult'));

    await w.stop();
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(diaryDir, { recursive: true, force: true });
  }
});
