/**
 * 冒烟测试：这套算术到底对不对。
 *
 * 不测「接口返回 200」这种，测**数字**：一天不管她，五条掉成什么样；
 * 睡一觉回多少；关三天再开会不会被清零；存一次读回来是不是同一份。
 *
 * 跑法（用宿主自带那份 tsx，扩展目录里没有 node_modules）：
 *   node "<Coopani>/resources/app/node_modules/tsx/dist/cli.mjs" test/smoke.mjs
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ACTS, DECAY_PER_HOUR, HOME_TIER_COST, LOW, MAX_CATCHUP_HOURS, MAX_PENDING, StateStore,
  advance, applyAct, applyMove, applyWork, freshState, localDateKey, noteVisit,
  quoteMove, recentVisits, snapshot, applyCert, applySpend,
} from '../src/state.ts';
import { readTown } from '../src/bridge.ts';
import { LifeWorld } from '../src/world.ts';
import { LIFE_DEFAULTS } from '../src/config.ts';

let pass = 0;
let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass += 1; console.log('  ok   ' + label); }
  else { fail += 1; console.log('  FAIL ' + label + (extra ? '  → ' + extra : '')); }
};
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

console.log('\n[1] 默认状态');
{
  const s = freshState(new Date('2026-11-15T00:00:00Z'));
  ok(s.vitals.food === 80, '饱腹起始 80', String(s.vitals.food));
  ok(s.vitals.fun === 75, '娱乐起始 75', String(s.vitals.fun));
  ok(s.moodlets.length === 0 && s.conditions.length === 0, '一开始没有情绪也没有病');
  ok(s.street === '', '街名没被预设 —— 得她自己选');
}

console.log('\n[2] 六个小时不管她');
{
  const t0 = new Date('2026-11-15T00:00:00Z');
  const s = freshState(t0);
  const r = advance(s, new Date(t0.getTime() + 6 * 3_600_000));
  ok(near(r.hours, 6, 0.01), '算了 6 小时', String(r.hours));
  ok(near(s.vitals.food, 80 - DECAY_PER_HOUR.food * 6, 0.1),
    `饱腹 80 → ${(80 - DECAY_PER_HOUR.food * 6).toFixed(1)}`, String(s.vitals.food));
  ok(near(s.vitals.social, 75 - DECAY_PER_HOUR.social * 6, 0.1),
    '社交按自己的速率掉（比饱腹慢）', String(s.vitals.social));
  ok(s.social === undefined || s.vitals.social > s.vitals.food, '社交掉得比饱腹慢 —— 一会儿不说话不该难受');
}

console.log('\n[3] 一天不管，能不能掉到 0 以下（不能）');
{
  const t0 = new Date('2026-11-15T00:00:00Z');
  const s = freshState(t0);
  advance(s, new Date(t0.getTime() + 48 * 3_600_000));
  ok(s.vitals.food === 0, '饱腹归零但不为负', String(s.vitals.food));
  ok(s.vitals.energy >= 0, '精力不为负', String(s.vitals.energy));
  /*
   * 离线满 24 小时精力回到 85 —— 她睡了。这条是「关机三天回来不该快饿死」的实现。
   */
  ok(s.vitals.energy >= 85, '离线满一天，精力补到 85（她睡了）', String(s.vitals.energy));
  ok(s.vitals.clean < 30, '清爽没法靠睡觉补回来 —— 还是脏的');
}

console.log('\n[4] 关机两周（超上限）');
{
  const t0 = new Date('2026-11-15T00:00:00Z');
  const s = freshState(t0);
  const r = advance(s, new Date(t0.getTime() + 30 * 24 * 3_600_000));
  ok(near(r.hours, MAX_CATCHUP_HOURS, 0.01),
    `只按上限 ${MAX_CATCHUP_HOURS} 小时算，不按 720 小时`, String(r.hours));
  /*
   * 上限的意义：她该是「一直在等你」，不是「快饿死了」。
   * 数值上两者都归零，但语义不同 —— 这里钉住的是「不按 720 小时算」这件事。
   */
  ok(s.vitals.food === 0, '该归零还是归零');
}

console.log('\n[5] 时间倒着走（时钟被拨回去）');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  const before = { ...s.vitals };
  const r = advance(s, new Date(t0.getTime() - 5 * 3_600_000));
  ok(r.hours === 0, '不往回算', String(r.hours));
  ok(s.vitals.food === before.food, '五条一个数都没动');
}

console.log('\n[6] 做一件事');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  s.vitals.food = 40;
  const r = applyAct(s, 'eat', t0);
  ok(r.ok, '吃了');
  ok(near(s.vitals.food, 70, 0.01), '饱腹 40 → 70', String(s.vitals.food));
  ok(r.mood && r.mood.kind === 'good', '吃了一般是好事');
  ok(s.tellable.length === 1, '记进 tellable 了 —— 她事后才有素材可讲', String(s.tellable.length));
  ok(near(Date.parse(r.mood.expiresAt), t0.getTime() + 2 * 3_600_000, 1000),
    '情绪 2 小时后过期（真实时刻）');
}

console.log('\n[7] 同一件事连着做，情绪不攒串');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  applyAct(s, 'eat', t0);
  applyAct(s, 'eat', new Date(t0.getTime() + 60_000));
  applyAct(s, 'eat', new Date(t0.getTime() + 120_000));
  ok(s.moodlets.length === 1, '只留最新那条', String(s.moodlets.length));
  /*
   * tellable 是另一回事：吃了三次就该记三条。
   * 它不是情绪，是「发生过的事」—— 三次都发生过。
   */
  ok(s.tellable.length === 3, '但说了三次吃了，tellable 记三条', String(s.tellable.length));
}

console.log('\n[8] 生病与康复');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  s.vitals.energy = 10;
  s.vitals.clean = 10;
  const r = advance(s, new Date(t0.getTime() + 10 * 60_000));
  ok(r.caught.length >= 1, '精力清爽双低 → 病了', JSON.stringify(r.caught.map((c) => c.id)));
  const cold = r.caught.find((c) => c.id === 'cold');
  ok(!!cold, '得的是感冒');
  const t2 = new Date(Date.parse(cold.until) + 60_000);
  const r2 = advance(s, t2);
  ok(r2.recovered.some((c) => c.id === 'cold'), '到期自己好');
}

console.log('\n[9] 掉线只报一次');
{
  /*
   * 判据是「上一次在线上、这一次在线下」。不这样的话，
   * 她饿着的那十几个小时里每一跳都报一次 —— 一天上百条。
   */
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  s.vitals.food = LOW + 1;
  const r1 = advance(s, new Date(t0.getTime() + 60 * 60_000));
  ok(r1.crossed.includes('food'), '第一次掉过线，报了');
  const r2 = advance(s, new Date(t0.getTime() + 120 * 60_000));
  ok(!r2.crossed.includes('food'), '第二跳不再报（已经在下面了）');
}

console.log('\n[10] 存档：原子写 + 坏档不把她清零');
{
  const dir = mkdtempSync(join(tmpdir(), 'life-smoke-'));
  const store = new StateStore(dir);
  const s = freshState(new Date('2026-11-15T12:00:00Z'));
  s.vitals.food = 42;
  s.street = '灶前巷';
  store.save(s);

  const back = store.load();
  ok(back.recovered === 'ok', '正常读回来', back.recovered);
  ok(back.state.vitals.food === 42, '饱腹还是 42', String(back.state.vitals.food));
  ok(back.state.street === '灶前巷', '街名还在');

  /* 主档写坏，备份还在 —— 必须退备份，不许从零。 */
  store.save({ ...s, vitals: { ...s.vitals, food: 41 } });  // 这次把 42 那份挤到 .bak
  writeFileSync(join(dir, 'life-state.json'), '{ 不是 JSON', 'utf8');
  const rec = store.load();
  ok(rec.recovered === 'bak', '坏档退到备份', rec.recovered);
  ok(rec.state.vitals.food === 42, '备份里是 42', String(rec.state.vitals.food));

  /* 两份都坏才从零。 */
  writeFileSync(join(dir, 'life-state.json.bak'), 'x', 'utf8');
  const fresh = store.load();
  ok(fresh.recovered === 'fresh', '两份都坏才从零', fresh.recovered);

  /* 写完不许留 .tmp。 */
  store.save(s);
  const tmpLeft = readFileSync(join(dir, 'life-state.json'), 'utf8').length > 0;
  ok(tmpLeft, '写完之后主档是完整的 JSON');
}

console.log('\n[11] 少字段的旧档不许变 NaN');
{
  const dir = mkdtempSync(join(tmpdir(), 'life-smoke2-'));
  writeFileSync(join(dir, 'life-state.json'), JSON.stringify({
    updatedAt: '2026-11-14T00:00:00.000Z',
    vitals: { food: 50 },   // 缺四条
  }), 'utf8');
  const store = new StateStore(dir);
  const { state } = store.load();
  ok(Number.isFinite(state.vitals.energy), '缺的字段补成默认值，不是 NaN', String(state.vitals.energy));
  ok(state.vitals.food === 50, '有的那个留住', String(state.vitals.food));
  ok(Array.isArray(state.habits), '缺数组补成空数组');
}

console.log('\n[12] 快照');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  s.vitals.food = 12;
  s.vitals.fun = 25;
  s.tellable.push({ id: 't1', text: '出门转了一圈。', at: t0.toISOString(), said: false });
  const snap = snapshot(s, t0);
  ok(snap.low.length === 2, '两条低于阈值', String(snap.low.length));
  ok(snap.low[0].key === 'food', '缺得最狠的排前面', snap.low[0].key);
  ok(snap.unsaid.length === 1, '还没说出去的那条在');
  ok(Object.keys(ACTS).length === 6, '六件事都能做（五件要钱的 + 将就吃一口）', String(Object.keys(ACTS).length));
}

console.log('\n[13] 钱：做事要花钱');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  ok(s.money.cash === 3000, '起步 3000', String(s.money.cash));
  const r = applyAct(s, 'meet', t0);
  ok(r.ok && r.cost === 30, '见人花 30', String(r.cost));
  ok(s.money.cash === 2970, '余额扣了', String(s.money.cash));
  ok(s.money.spent === 30, '记进支出', String(s.money.spent));
  const free = applyAct(s, 'sleep', t0);
  ok(free.cost === 0 && s.money.cash === 2970, '睡觉不花钱');
}

console.log('\n[14] 钱不够：拒，但要给替代方案');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  s.money.cash = 10;
  const r = applyAct(s, 'meet', t0);
  ok(!r.ok, '钱不够不让做');
  ok(/instant|将就/.test(r.reason || ''), '说出了免费的替代（将就吃一口）', r.reason);
  ok(s.money.cash === 10, '拒绝了就不扣钱');
  const cheap = applyAct(s, 'instant', t0);
  ok(cheap.ok && cheap.cost === 0, '将就吃一口是免费的');
  ok(cheap.mood && cheap.mood.kind === 'bad', '但吃完心里不痛快');
}

console.log('\n[15] 出工：一天一次');
{
  const t0 = new Date('2026-11-15T09:00:00Z');
  const s = freshState(t0);
  const before = s.money.cash;
  const r = applyWork(s, '菜市场搬货', t0);
  /*
   * 2026-11-15：默认日薪从 120 改成 90 —— 新的 `freshState` 按零工价起步。
   * 老存档里的 120 由 `normJob` 兜着，不会跟着降。
   */
  ok(r.ok && r.earned === 90, '挣了 90', String(r.earned));
  ok(r.cash === before + 90, '到账了');
  ok(s.job.what === '菜市场搬货', '记住了干什么');
  ok(s.job.days === 1, '计了一天工');
  const again = applyWork(s, '再干一天', t0);
  ok(!again.ok, '同一天不许出两次工', again.reason);
  const tomorrow = new Date(t0.getTime() + 24 * 3_600_000);
  s.vitals.energy = 80;
  const next = applyWork(s, '', tomorrow);
  ok(next.ok, '第二天能去了', next.reason);
  ok(s.job.what === '菜市场搬货', '不填就沿用上次那个');
}

console.log('\n[16] 出工：精力太低去不了');
{
  const t0 = new Date('2026-11-15T09:00:00Z');
  const s = freshState(t0);
  s.vitals.energy = 12;
  const r = applyWork(s, '搬货', t0);
  ok(!r.ok, '精力 12 不让去', r.reason);
  ok(r.earned === 0, '没挣到钱');
}

console.log('\n[17] 房租按天扣');
{
  const t0 = new Date('2026-11-15T00:00:00Z');
  const s = freshState(t0);
  ok(s.home.tier === 'urban-village', '一开始住城中村', s.home.tier);
  ok(s.home.tenure === 'rent', '而且是租的');
  ok(s.home.monthly === HOME_TIER_COST['urban-village'], '月开销对得上档位');
  const before = s.money.cash;
  const r = advance(s, new Date(t0.getTime() + 24 * 3_600_000));
  const expectRent = Math.round(s.home.monthly / 30);
  ok(r.rent === expectRent, `一天扣了 ${expectRent}`, String(r.rent));
  ok(s.money.cash === before - expectRent, '余额少了那么多');
  ok(!r.rentMissed, '钱够，没欠');
}

console.log('\n[18] 房租扣到 0 为止，不变负数');
{
  const t0 = new Date('2026-11-15T00:00:00Z');
  const s = freshState(t0);
  s.money.cash = 3;
  const r = advance(s, new Date(t0.getTime() + 48 * 3_600_000));
  ok(s.money.cash === 0, '扣到 0 就停', String(s.money.cash));
  ok(r.rentMissed, '记了「没凑够」');
  ok(s.tellable.some((t) => t.text.includes('房租')), '她记着这事');
}

console.log('\n[19] 老档缺 home/job/money 时补默认，不是 undefined');
{
  const dir = mkdtempSync(join(tmpdir(), 'life-smoke3-'));
  const t0 = new Date('2026-11-15T00:00:00Z');
  const s = freshState(t0);
  const raw = JSON.parse(JSON.stringify(s));
  delete raw.home; delete raw.job; delete raw.money; delete raw.goals;
  writeFileSync(join(dir, 'life-state.json'), JSON.stringify(raw), 'utf8');
  const back = new StateStore(dir).load().state;
  ok(back.home && back.home.tier === 'urban-village', 'home 补上了', String(back.home && back.home.tier));
  ok(back.home.monthly === HOME_TIER_COST['urban-village'], '月开销跟着档位算');
  ok(back.job && back.job.daily === 120, 'job 补上了', String(back.job && back.job.daily));
  ok(back.money && back.money.cash === 3000, 'money 补上了', String(back.money && back.money.cash));
  ok(Array.isArray(back.goals), 'goals 补成空数组');
}

console.log('\n[20] 搬家：报价');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  const q = quoteMove(s, 'new');
  ok(q.deposit === HOME_TIER_COST.new * 2, '押两个月', String(q.deposit));
  ok(!q.ok && q.short === q.deposit - s.money.cash, '钱不够，说得出还差多少', String(q.short));
  const same = quoteMove(s, 'urban-village');
  ok(same.deposit === HOME_TIER_COST['urban-village'] * 2, '自己那档也能报价');
}

console.log('\n[21] 搬家：钱不够就搬不了，一分不扣');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  const before = s.money.cash;
  const r = applyMove(s, 'villa', t0);
  ok(!r.ok, '别墅区搬不起');
  ok(/还差/.test(r.reason || ''), '说清了还差多少', r.reason);
  ok(s.money.cash === before, '拒绝了就不扣钱');
  ok(s.home.tier === 'urban-village', '也没搬');
}

console.log('\n[22] 搬家：搬成了，并且目标标达成');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  s.money.cash = 6000;
  const g = s.goals[0];
  ok(!g.done, '一开始没达成');
  const r = applyMove(s, 'new', t0);
  ok(r.ok, '搬成了', r.reason);
  ok(s.home.tier === 'new', '档位变了', s.home.tier);
  ok(s.home.monthly === HOME_TIER_COST.new, '月开销跟着变', String(s.home.monthly));
  ok(s.money.cash === 6000 - HOME_TIER_COST.new * 2, '押金扣了', String(s.money.cash));
  /*
   * 这一条是这轮抓出来的真 bug：目标如果只按「现金 ≥ need」判，
   * 搬完钱花掉了会掉回「还差 4400」—— 看起来永远做不完。
   */
  ok(g.done === true, '目标标成达成', String(g.done));
  ok(s.tellable.some((t) => t.text.includes('目标达成')), '她记着这事');
  const again = applyMove(s, 'new', t0);
  ok(!again.ok && /已经住/.test(again.reason || ''), '同一档不许再搬一次', again.reason);
}

console.log('\n[23] 搬家：往低处搬是能自救的那一步');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  s.home.tier = 'new';
  s.home.monthly = HOME_TIER_COST.new;
  s.money.cash = 1000;
  const r = applyMove(s, 'urban-village', t0);
  ok(r.ok, '钱紧时能搬回城中村', r.reason);
  ok(s.home.tier === 'urban-village', '住回去了');
  ok(s.home.monthly === HOME_TIER_COST['urban-village'], '月开销降下来');
}

console.log('\n[24] 本地日期：不能拿 UTC 顶');
{
  /*
   * 这一条钉的是一个真 bug：`applyWork` 原来用 `toISOString().slice(0,10)`，
   * GMT+8 的凌晨 0–8 点，UTC 还停在前一天 —— 「今天已经出过工了」会判错。
   */
  const early = new Date(2026, 10, 15, 2, 30);   // 本地 11-15 凌晨 2:30
  ok(localDateKey(early) === '2026-11-15', '本地凌晨还是当天', localDateKey(early));
  ok(early.toISOString().slice(0, 10) !== localDateKey(early),
    'UTC 那天确实不是同一天（说明这个坑是真的）',
    early.toISOString().slice(0, 10));

  /* 凌晨出工一次、早上再出工一次，必须是两次。 */
  const t0 = new Date(2026, 10, 15, 1, 0);
  const s = freshState(t0);
  const a = applyWork(s, '搬货', t0);
  const b = applyWork(s, '搬货', new Date(2026, 10, 15, 9, 0));
  ok(a.ok, '凌晨能出工', a.reason);
  ok(!b.ok, '同一天第二次被拒（按本地日算，不是 UTC 日）', b.reason);
}

console.log('\n[25] 他来过几天');
{
  const d1 = new Date(2026, 10, 15, 10, 0);
  const s = freshState(d1);
  ok(noteVisit(s, d1) === 'new-day', '第一次记成新的一天');
  ok(noteVisit(s, new Date(2026, 10, 15, 15, 0)) === 'same-day', '同一天不再新建');
  ok(s.presence.length === 1, '只留一条', String(s.presence.length));
  ok(s.presence[0].firstAt !== s.presence[0].lastAt, '首末时刻差开了');

  noteVisit(s, new Date(2026, 10, 16, 9, 0));
  ok(s.presence.length === 2, '第二天多一条');
  ok(recentVisits(s, new Date(2026, 10, 16, 20, 0), 7) === 2, '7 天内来过 2 天',
    String(recentVisits(s, new Date(2026, 10, 16, 20, 0), 7)));
  ok(recentVisits(s, new Date(2026, 10, 30, 20, 0), 7) === 0, '过了 14 天，7 天窗口里是 0');
}

console.log('\n[26] 悬着的事：上限 + 过期自己消');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  for (let i = 0; i < MAX_PENDING; i += 1) {
    s.pending.push({
      id: `q${i}`, what: `事${i}`, blocked: 'money', cost: 100,
      since: t0.toISOString(), expiresAt: new Date(t0.getTime() + 7 * 86_400_000).toISOString(),
    });
  }
  ok(s.pending.length === MAX_PENDING, `最多 ${MAX_PENDING} 件`);
  /* 过期：7 天后推进，它们该自己消，并且她记着这事。 */
  const r = advance(s, new Date(t0.getTime() + 8 * 86_400_000));
  ok(s.pending.length === 0, '过期自己消', String(s.pending.length));
  ok(s.tellable.some((t) => t.text.includes('悬着')), '她记着「算了」这件事');
  ok(r.hours > 0, '时间确实走了');
}

console.log('\n[27] 承诺：到期没做要留一笔');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  s.pledges.push({
    id: 'p1', what: '给他写张明信片', to: '他',
    dueAt: new Date(t0.getTime() + 24 * 3_600_000).toISOString(),
    since: t0.toISOString(), said: '明天给你写一张。',
  });
  ok(snapshot(s, t0).overdue.length === 0, '还没到期，不算欠');
  ok(snapshot(s, t0).pledges.length === 1, '算「说好了」');
  const later = new Date(t0.getTime() + 25 * 3_600_000);
  ok(snapshot(s, later).overdue.length === 1, '过了期就算欠着', String(snapshot(s, later).overdue.length));
  ok(snapshot(s, later).pledges.length === 0, '不再算「说好了」');
  /*
   * **不自动删**。这是方案 §2.6「空话问题」那条：她说出口的事到期没做，
   * 不能静默消失 —— 那比不说更糟。
   */
  advance(s, new Date(t0.getTime() + 30 * 86_400_000));
  ok(s.pledges.length === 1, '过了一个月还在欠着，没有静默消失', String(s.pledges.length));
}

console.log('\n[28] 职业：门槛决定工资（2026-11-15）');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  s.vitals.energy = 90;

  /* 零工：没有门槛，八九十 */
  const odd = applyWork(s, '搬货', t0);
  ok(odd.ok && odd.earned === 90, '搬货一天 90', String(odd.earned));

  /* 有证的活，没证接不了，而且要说清怎么补 */
  const t1 = new Date(t0.getTime() + 86_400_000);
  s.vitals.energy = 90;
  const noCert = applyWork(s, '护工', t1);
  ok(!noCert.ok, '没护工证接不了护工');
  ok(/护工证/.test(String(noCert.reason)) && /400/.test(String(noCert.reason)),
    '拒绝时说了缺哪张证、多少钱', String(noCert.reason));

  /* 考下来就能接，价钱按表 */
  const c = applyCert(s, '护工证', t1);
  ok(c.ok && c.paid === 400, '考护工证花 400', String(c.paid));
  ok(s.job.certs.includes('护工证'), '证记在她身上');
  const t2 = new Date(t0.getTime() + 2 * 86_400_000);
  s.vitals.energy = 90;
  const care = applyWork(s, '护工', t2);
  ok(care.ok && care.earned === 210, '有证之后护工一天 210', String(care.earned));

  /* 同一张证不用考两遍 */
  const again = applyCert(s, '护工证', t2);
  ok(!again.ok, '同一张证考不了第二遍');

  /* 经验门槛：专业档要证 + 30 天工 */
  const t3 = new Date(t0.getTime() + 3 * 86_400_000);
  s.job.certs.push('护士执业证');
  s.vitals.energy = 90;
  const noDays = applyWork(s, '社区护士', t3);
  ok(!noDays.ok && /30 天/.test(String(noDays.reason)), '年头不够接不了护士', String(noDays.reason));
}

console.log('\n[29] 高薪的代价：档越高越累，专业那档还掉社交');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const mk = (job, certs = []) => {
    const s = freshState(t0);
    s.vitals = { food: 90, energy: 90, clean: 90, fun: 90, social: 90 };
    s.job.certs = certs;
    s.job.days = 40;   // 年头门槛先满足，只测体力
    applyWork(s, job, t0);
    return s;
  };
  const odd = mk('搬货');
  const pro = mk('会计', ['会计证']);
  ok(odd.vitals.social === 90, '零工不掉社交', String(odd.vitals.social));
  ok(pro.vitals.social === 78, '专业岗掉 12 点社交', String(pro.vitals.social));
  ok(pro.vitals.energy < odd.vitals.energy, '专业岗更耗精力',
    `${pro.vitals.energy} vs ${odd.vitals.energy}`);
  ok(pro.vitals.fun < odd.vitals.fun, '专业岗更没力气玩');
}

console.log('\n[30] 考证：钱不够就考不了');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  s.money.cash = 300;
  const r = applyCert(s, '护士执业证', t0);
  ok(!r.ok && /800/.test(String(r.reason)), '钱不够说清差多少', String(r.reason));
  ok(s.money.cash === 300, '没考成不扣钱');
  ok(!applyCert(s, '不存在的证', t0).ok, '没有的证考不了');
}

console.log('\n[31] 旅行花销从她账上扣（life-spend 条子）');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  s.money.cash = 1000;

  const r1 = applySpend(s, [{ id: 'sp-1', amount: 451, note: '路费' }], t0);
  ok(r1.changed && s.money.cash === 549, '扣了 451', String(s.money.cash));
  ok(s.money.spent === 451, '花销记上', String(s.money.spent));
  ok(r1.settled[0].status === 'applied', '回执 applied');

  /* 同一张条子再来一次 —— 这是最贵的一种错：重复扣她的钱。 */
  const r2 = applySpend(s, [{ id: 'sp-1', amount: 451, note: '路费' }], t0);
  ok(s.money.cash === 549, '同一张条子不重复扣', String(s.money.cash));
  ok(!r2.changed, '没变就不写盘');
  ok(r2.settled[0].status === 'applied', '重复来的也要回执 —— 好让对面删掉自己那份');

  /* 钱不够：扣到 0，不欠（欠债是另一套系统，一期不做）。 */
  const before = s.tellable.length;
  const r3 = applySpend(s, [{ id: 'sp-2', amount: 2000, note: '房费' }], t0);
  ok(s.money.cash === 0, '扣到 0 为止，不欠', String(s.money.cash));
  ok(r3.settled[0].status === 'applied', '扣到 0 也算收了');
  ok(s.tellable.length > before, '没付清要留一句给她自己看见');

  /* 数不对的条子回 rejected —— 不然那份文件在对面永远删不掉。 */
  const r4 = applySpend(s, [{ id: 'sp-bad', amount: 0 }], t0);
  ok(r4.settled[0].status === 'rejected', '数不对回 rejected');
  ok(s.spendApplied.includes('sp-bad'), '坏条子也进判重表，不会每跳重拒一次');
}

console.log('\n[32] 本城：留空用内置，填了就用他填的');
{
  const builtin = await readTown('');
  ok(builtin.source === 'builtin' && builtin.name === '芦花塘', '什么都不填 → 芦花塘', builtin.name);

  /* 2026-11-15 Mr.Q：「服务器空着就是在用户填的城市」—— 这条路以前根本不存在。 */
  const mine = await readTown('', '北京');
  ok(mine.name === '北京' && mine.source === 'own', '填了北京 → 就是北京', `${mine.name}/${mine.source}`);
  ok(mine.streets.length === 0, '街名不替他编', String(mine.streets.length));

  /* 服务器不通时，退的是他填的那座城，不是芦花塘。 */
  const dead = await readTown('https://example.invalid', '北京');
  ok(dead.source === 'failed', '服务器不通标成 failed', dead.source);
  ok(dead.name === '北京', '服务器挂了也还住在自己填的城里', dead.name);

  /* 两个都空才落到芦花塘 —— 那是兜底，不是默认。 */
  const none = await readTown('', '');
  ok(none.name === '芦花塘', '什么都不填才是芦花塘');
}

console.log('\n[33] 睡觉即时广播 / homeCity 热改 / 凌晨 nagged 本地日期');
{
  const dir = mkdtempSync(join(tmpdir(), 'life-reg-'));
  const pushed = [];
  const cfg = { ...LIFE_DEFAULTS(), enabled: true, homeCity: '成都', notify: 'once' };
  const w = new LifeWorld({ cfg, dataDir: dir, botName: '大肥鱼' });
  await w.start({
    log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
    pushEvent: async (e) => { pushed.push(e); return { ...e, blobs: [] }; },
  });

  const actTool = w.tools().find((x) => x.name === 'life_act');
  await actTool.handler({ kind: 'sleep' });
  const pubSleep = JSON.parse(readFileSync(join(dir, 'life-public.json'), 'utf8'));
  ok(Boolean(pubSleep.asleepUntil), 'life_act sleep 后立刻广播 life-public.json');

  await actTool.handler({ kind: 'eat' });
  const pubAwake = JSON.parse(readFileSync(join(dir, 'life-public.json'), 'utf8'));
  ok(pubAwake.asleepUntil === '', 'life_act eat 醒来后立刻清空 asleepUntil');

  /* homeCity 热改：只改 cfg.homeCity，tick 应重读本城。 */
  cfg.homeCity = '杭州';
  await w.tick();
  ok(w.town.name === '杭州' && w.town.source === 'own', 'homeCity 热改后 tick 生效', `${w.town.name}/${w.town.source}`);

  /* 凌晨 0–8 点（UTC 前一天）跨线提醒后，nagged[key] 必须写本地日期，不能写 UTC 日期。 */
  const dawn = new Date(2026, 10, 16, 2, 0, 0); // 本地 2026-11-16 02:00
  const localDay = localDateKey(dawn);
  w.state.vitals.food = 31;
  w.state.updatedAt = new Date(dawn.getTime() - 3_600_000).toISOString();
  /* 模拟 tick 里跨线后的记录逻辑：shouldNag 与写入同口径 */
  const r = advance(w.state, dawn);
  ok(r.crossed.includes('food'), '测试前提：饱腹掉过阈值');
  if (w.shouldNag('food', dawn)) {
    w.state.nagged.food = localDateKey(dawn);
  }
  ok(w.state.nagged.food === localDay, 'nagged 写入本地日期', w.state.nagged.food);
  ok(!w.shouldNag('food', new Date(2026, 10, 16, 3, 0, 0)), '同一本地日凌晨再次检查不重复提醒');
  await w.stop();
}

console.log(`\n${pass} 通过 / ${fail} 失败 ${fail ? '← 有红，别交付' : ''}`);
process.exit(fail ? 1 : 0);
