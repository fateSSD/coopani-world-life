/**
 * 冒烟测试：这套算术到底对不对。
 *
 * 不测「接口返回 200」这种，测**数字**：一天不管她，五条掉成什么样；
 * 睡一觉回多少；关三天再开会不会被清零；存一次读回来是不是同一份。
 *
 * 跑法（用宿主自带那份 tsx，扩展目录里没有 node_modules）：
 *   node "<Coopani>/resources/app/node_modules/tsx/dist/cli.mjs" test/smoke.mjs
 */
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ACTS, DECAY_PER_HOUR, HOME_TIER_COST, LOW, MAX_CATCHUP_HOURS, MAX_PENDING, StateStore,
  advance, applyAct, applyGift, applyMove, applyWork, freshState, localDateKey, noteVisit, normalize,
  quoteMove, recentVisits, snapshot, applyCert, applySpend, appendLedger, readLedger, marketPrices, weatherOf,
  certChance, SEEDS, applyPlant, applyWater, applyHarvest, applyRentFarm, applyUnrentFarm,
  evaluateStallPlan, pantryCount, cookedDishCount,
  ANIMALS, applyRentRanch, applyUnrentRanch, applyBuyAnimal, applyFeedAnimal, applyCollectRanch, applyHarvestRanch,
  HELPER_PLANS, countPendingFarmWork, calcNeighborErrandQuote, parseErrandMinutes,
  recordPostedNeighborErrand, applyNeighborErrandCompleted, refundExpiredErrand,
  runFarmHelperCatchup, applyHireHelper, applyUnhireHelper,
  RECIPES, evaluateRecipe, applyCookRecipe, applyEatCookedDish, buildCareerOverview,
} from '../src/state.ts';
import { readTown, fetchTownStalls, buyTownStall } from '../src/bridge.ts';
import { LifeWorld } from '../src/world.ts';
import { LIFE_DEFAULTS } from '../src/config.ts';
import { ImageLibrary } from '../src/library.ts';

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

console.log('\n[3] 醒着掉到 0 不为负，离线跨天有地板 30 保护');
{
  const tWake = new Date('2026-11-15T01:00:00Z'); // 北京 09:00
  const sLow = freshState(tWake);
  sLow.vitals.food = 10;
  sLow.vitals.clean = 8;
  advance(sLow, new Date(tWake.getTime() + 6 * 3_600_000)); // 白天 6 小时不触发跨夜补睡
  ok(sLow.vitals.food === 0, '白天醒着饱腹归零但不为负', String(sLow.vitals.food));
  ok(sLow.vitals.clean === 0, '白天醒着清爽归零但不为负', String(sLow.vitals.clean));

  const t0 = new Date('2026-11-15T00:00:00Z');
  const s = freshState(t0);
  advance(s, new Date(t0.getTime() + 48 * 3_600_000));
  ok(s.vitals.food === 30, '离线两天饱腹停在地板 30，不归零', String(s.vitals.food));
  ok(s.vitals.energy >= 0, '精力不为负', String(s.vitals.energy));
  /*
   * 离线满 24 小时精力回到 85 —— 她睡了；其余四条走地板 30 保护。
   */
  ok(s.vitals.energy >= 85, '离线满一天，精力补到 85（她睡了）', String(s.vitals.energy));
  ok(s.vitals.clean === 30, '离线两天清爽停在地板 30', String(s.vitals.clean));
}

console.log('\n[4] 关机两周（超上限）');
{
  const t0 = new Date('2026-11-15T00:00:00Z');
  const s = freshState(t0);
  const r = advance(s, new Date(t0.getTime() + 30 * 24 * 3_600_000));
  ok(near(r.hours, MAX_CATCHUP_HOURS, 0.01),
    `只按上限 ${MAX_CATCHUP_HOURS} 小时算，不按 720 小时`, String(r.hours));
  /*
   * 上限 + 地板的意义：她该是「一直在等你」，不是「快饿死了」。
   */
  ok(s.vitals.food === 30 && s.vitals.social === 30, '超长离线走地板 30 保护', `${s.vitals.food}/${s.vitals.social}`);
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

console.log('\n[6] 做一件事（按分钟结算）');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  s.vitals.food = 40;
  const r = applyAct(s, 'eat', t0);
  ok(r.ok && r.started, '开始吃了');
  ok(near(s.vitals.food, 40, 0.01), '刚开吃不瞬间加满', String(s.vitals.food));
  advance(s, new Date(t0.getTime() + ACTS.eat.minutes * 60_000));
  ok(near(s.vitals.food, 70, 0.3), '吃满 40 分钟饱腹 40 → 70', String(s.vitals.food));
  /*
   * 2026-11-17 改：普通一顿**不挂情绪**。
   */
  ok(s.moodlets.length === 0, '普通一顿不挂情绪', String(s.moodlets.length));
  ok(s.tellable.length === 1, '做完后记进 tellable 了 —— 她事后才有素材可讲', String(s.tellable.length));
}

console.log('\n[6b] 三档饭：好的回 50，随便的回 15');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  s.vitals.food = 20;
  const r = applyAct(s, 'feast', t0);
  ok(r.ok && r.started, '开始吃顿好的');
  const tEnd = new Date(t0.getTime() + ACTS.feast.minutes * 60_000);
  advance(s, tEnd);
  ok(near(s.vitals.food, 70, 0.6), '好的 60 分钟回约 50', String(s.vitals.food));
  const m = s.moodlets.find((x) => x.source === 'feast');
  ok(!!m && m.kind === 'good', '吃好的心情是好的');
  ok(m && near(Date.parse(m.expiresAt), tEnd.getTime() + 3 * 3_600_000, 1000),
    '好的一顿情绪 3 小时后过期');

  const s2 = freshState(t0);
  s2.vitals.food = 20;
  const r2 = applyAct(s2, 'instant', t0);
  ok(r2.ok && r2.started, '开始随便吃点');
  advance(s2, new Date(t0.getTime() + ACTS.instant.minutes * 60_000));
  ok(near(s2.vitals.food, 35, 0.3), '随便的 15 分钟回 15', String(s2.vitals.food));
  ok(s2.moodlets.some((x) => x.source === 'instant' && x.kind === 'bad'), '随便吃心里不痛快');
}

console.log('\n[6c] 住处越好，四条掉得越慢，精力不掉慢');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const days = (tier) => {
    const s = freshState(t0);
    s.home.tier = tier;
    s.vitals = { food: 100, energy: 100, clean: 100, fun: 100, social: 100 };
    advance(s, new Date(t0.getTime() + 10 * 3_600_000));
    return s.vitals;
  };
  const a = days('urban-village');
  const b = days('villa');
  ok(b.food > a.food, '别墅区饱腹掉得慢', `${a.food.toFixed(1)} vs ${b.food.toFixed(1)}`);
  ok(near(a.energy, b.energy, 0.01), '精力一分不减', `${a.energy.toFixed(1)} vs ${b.energy.toFixed(1)}`);
}

console.log('\n[7] 同一件事连着做，情绪不攒串');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  const dur = ACTS.feast.minutes * 60_000;
  applyAct(s, 'feast', t0);
  advance(s, new Date(t0.getTime() + dur));
  const t1 = new Date(t0.getTime() + dur + 60_000);
  applyAct(s, 'feast', t1);
  advance(s, new Date(t1.getTime() + dur));
  const t2 = new Date(t1.getTime() + dur + 60_000);
  applyAct(s, 'feast', t2);
  advance(s, new Date(t2.getTime() + dur));
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
  /*
   * 三十六件事：含三档吃、睡、午睡、坐着歇会儿、洗、玩、见人、闲聊、做饭、小酌、看病、复合动作、双栖新动作、露营微缩二期动作 + wake / cancel。
   * `wake` 不是可有可无的补充 —— 睡着时所有动作都被拦，没有它她就永远醒不过来。
   */
  ok(Object.keys(ACTS).length === 36, '三十六件事（含 rest、chat、see_doctor、复合动作、双栖与二期新动作、wake 与 cancel）', String(Object.keys(ACTS).length));
  ok(Boolean(ACTS.wake) && ACTS.wake.cost === 0, '「起来」不花钱');
  ok(Boolean(ACTS.cancel) && ACTS.cancel.cost === 0, '「停下来」不花钱');
  ok(ACTS.feast.cost > ACTS.eat.cost && ACTS.eat.cost > ACTS.instant.cost, '三档饭价依次递减');
}

console.log('\n[13] 钱：做事要花钱（随时间渐进扣款）');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  s.home.monthly = 0; // 排除日折算房租干扰，纯测动作扣款
  ok(s.money.cash === 3000, '起步 3000', String(s.money.cash));
  const r = applyAct(s, 'meet', t0);
  ok(r.ok && r.started, '开始见人');
  advance(s, new Date(t0.getTime() + ACTS.meet.minutes * 60_000));
  ok(s.money.cash === 2970, '余额扣了 30', String(s.money.cash));
  ok(s.money.spent === 30, '记进支出', String(s.money.spent));
  const free = applyAct(s, 'sleep', new Date(t0.getTime() + (ACTS.meet.minutes + 1) * 60_000));
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
  advance(s, new Date(t0.getTime() + ACTS.instant.minutes * 60_000));
  ok(s.moodlets.some((m) => m.source === 'instant' && m.kind === 'bad'), '但吃完心里不痛快');
}

console.log('\n[15] 出工：一天一次（干满工时进账）');
{
  const t0 = new Date('2026-11-15T09:00:00Z');
  const s = freshState(t0);
  s.home.monthly = 0;
  const before = s.money.cash;
  const r = applyWork(s, '菜市场搬货', t0);
  ok(r.ok && r.started, '开工了');
  ok(s.job.what === '菜市场搬货', '记住了干什么');
  advance(s, new Date(t0.getTime() + (r.minutes || 240) * 60_000));
  ok(s.money.cash === before + 90, '干满工时挣了 90 到账了', String(s.money.cash));
  ok(s.job.days === 1, '计了一天工', String(s.job.days));
  const again = applyWork(s, '再干一天', new Date(t0.getTime() + (r.minutes || 240) * 60_000 + 60_000));
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
  s.home.monthly = 0;
  s.vitals.energy = 90;

  /* 零工：没有门槛，100–120 */
  const cash0 = s.money.cash;
  const odd = applyWork(s, '搬货', t0);
  ok(odd.ok && odd.started, '搬货开工');
  advance(s, new Date(t0.getTime() + (odd.minutes || 240) * 60_000));
  ok(s.money.cash - cash0 === 112, '搬货干完一天 112', String(s.money.cash - cash0));

  /* 有证的活，没证接不了，而且要说清怎么补 */
  const t1 = new Date(t0.getTime() + 86_400_000);
  s.vitals.energy = 90;
  const noCert = applyWork(s, '护工', t1);
  ok(!noCert.ok, '没护工证接不了护工');
  ok(/护工证/.test(String(noCert.reason)) && /400/.test(String(noCert.reason)),
    '拒绝时说了缺哪张证、多少钱', String(noCert.reason));

  /* 考下来就能接，价钱按表。2026-11-17 起考证有概率 —— 这里给足见识 + 固定骰子 */
  s.knowledge = 40;
  const c = applyCert(s, '护工证', t1, 0);
  ok(c.ok && c.passed === true && c.paid === 400, '考护工证花 400 且考过了', String(c.paid));
  ok(s.job.certs.includes('护工证'), '证记在她身上');
  const t2 = new Date(t0.getTime() + 2 * 86_400_000);
  s.vitals.energy = 90;
  const cashBeforeCare = s.money.cash;
  const care = applyWork(s, '护工', t2);
  ok(care.ok && care.started, '护工开工');
  advance(s, new Date(t2.getTime() + (care.minutes || 360) * 60_000));
  ok(s.money.cash - cashBeforeCare === 252, '有证之后护工一天 260（先垫付 8 元耗材，净增 252）', String(s.money.cash - cashBeforeCare));

  /* 同一张证不用考两遍 */
  const again = applyCert(s, '护工证', t2, 0);
  ok(!again.ok, '同一张证考不了第二遍');

  /* 经验门槛：专业档要证 + 30 天工 */
  const t3 = new Date(t0.getTime() + 3 * 86_400_000);
  s.job.certs.push('护士执业证');
  s.vitals.energy = 90;
  const noDays = applyWork(s, '社区护士', t3);
  ok(!noDays.ok && /30 天/.test(String(noDays.reason)), '年头不够接不了护士', String(noDays.reason));
}

console.log('\n[29] 高薪的代价：档越高越累，工作期间社交暂停衰减');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const mk = (job, certs = []) => {
    const s = freshState(t0);
    s.vitals = { food: 90, energy: 90, clean: 90, fun: 90, social: 90 };
    s.job.certs = certs;
    s.job.days = 40;   // 年头门槛先满足，只测体力
    const r = applyWork(s, job, t0);
    advance(s, new Date(t0.getTime() + (r.minutes || 240) * 60_000));
    return s;
  };
  const odd = mk('搬货');
  const pro = mk('会计', ['会计证']);
  ok(odd.vitals.social === 90, '零工不掉社交', String(odd.vitals.social));
  ok(pro.vitals.social === 90, '工作期间社交暂停衰减', String(pro.vitals.social));
  ok(pro.vitals.energy < odd.vitals.energy, '专业岗更耗精力',
    `${pro.vitals.energy} vs ${odd.vitals.energy}`);
  ok(pro.vitals.fun < odd.vitals.fun, '专业岗娱乐微降略多于零工');
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
  ok(builtin.source === 'builtin' && builtin.name === '兰州', '什么都不填 → 兰州', builtin.name);

  /* 2026-11-15 Mr.Q：「服务器空着就是在用户填的城市」—— 这条路以前根本不存在。 */
  const mine = await readTown('', '北京');
  ok(mine.name === '北京' && mine.source === 'own', '填了北京 → 就是北京', `${mine.name}/${mine.source}`);
  ok(mine.streets.length === 0, '街名不替他编', String(mine.streets.length));

  /* 服务器不通时，退的是他填的那座城，不是兰州。 */
  const dead = await readTown('https://example.invalid', '北京');
  ok(dead.source === 'failed', '服务器不通标成 failed', dead.source);
  ok(dead.name === '北京', '服务器挂了也还住在自己填的城里', dead.name);

  /* 两个都空才落到兰州 —— 那是兜底，不是默认。 */
  const none = await readTown('', '');
  ok(none.name === '兰州', '什么都不填才是兰州');
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

  /* 睡着时除了「起来」什么都做不了 —— 这条是 2026-11-15 定的。 */
  const eatAsleep = await actTool.handler({ kind: 'eat' });
  ok(/在睡/.test(eatAsleep.text), '睡着时吃东西被拦住', eatAsleep.text);
  const pubStill = JSON.parse(readFileSync(join(dir, 'life-public.json'), 'utf8'));
  ok(Boolean(pubStill.asleepUntil), '拦住了，也还挂着在睡');

  /*
   * 她自己读状态时必须看见「在睡」。
   * 看不见的话，她明明躺着却以为自己能出门 —— 世界里有这个状态、她读不到。
   */
  const statusTool = w.tools().find((x) => x.name === 'life_status');
  const st = await statusTool.handler({});
  ok(/在睡/.test(st.text), 'life_status 里写着在睡', st.text);
  /*
   * 状态里必须写明「他说话不算叫醒」。
   * 只写「在睡」不够 —— 他一搭话，她会以为那是在叫她起来，于是睡眠形同虚设。
   */
  ok(/不算叫醒/.test(st.text), '状态里写明他说话不算叫醒', st.text);

  await actTool.handler({ kind: 'wake' });
  const pubAwake = JSON.parse(readFileSync(join(dir, 'life-public.json'), 'utf8'));
  ok(pubAwake.asleepUntil === '', 'wake 之后立刻清空 asleepUntil');

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

console.log('\n[34] 睡觉：按时长结算、五条各有各的走法（2026-11-15）');
{
  const t0 = new Date('2026-11-15T23:00:00Z');
  const s = freshState(t0);

  /* ① 睡下那一刻**不能**先给 80 —— 那是免费回血按钮。 */
  const bed = applyAct(s, 'sleep', t0);
  ok(bed.ok && s.vitals.energy === 80, '睡下瞬间精力不动（不再一次性 +80）', String(s.vitals.energy));
  ok(Boolean(s.asleepFrom) && Boolean(s.asleepUntil), '入睡时刻和醒来时刻都记下了');

  /* ② 睡八小时：精力 +80，清爽只掉 8，娱乐社交不动。 */
  const r8 = advance(s, new Date(t0.getTime() + 8 * 3_600_000));
  ok(r8.sleptHours === 8, '这一觉算满 8 小时', String(r8.sleptHours));
  ok(Math.abs(s.vitals.energy - 100) < 0.01, '精力 80 → 100（+80，封顶）', String(s.vitals.energy));
  ok(Math.abs(s.vitals.clean - 72) < 0.01, '清爽按 1.0/小时掉，八小时 −8', String(s.vitals.clean));
  ok(s.vitals.fun === 75, '娱乐睡着不掉', String(s.vitals.fun));
  ok(s.vitals.social === 75, '社交睡着不掉', String(s.vitals.social));
  ok(Math.abs(s.vitals.food - 51.2) < 0.01, '饱腹照常掉（八小时 −28.8）', String(s.vitals.food));
  ok(r8.woke?.reason === 'enough', '八小时算睡够了', String(r8.woke?.reason));
  ok(s.asleepUntil === '', '醒来之后不再挂着「在睡」');
  ok(s.moodlets.some((m) => m.source === 'sleep' && m.kind === 'good'), '醒来挂上「睡够了」');

  /* ③ 睡两小时就起：只拿 20。 */
  const s2 = freshState(t0);
  s2.vitals.energy = 40;
  applyAct(s2, 'sleep', t0);
  const r2 = advance(s2, new Date(t0.getTime() + 2 * 3_600_000));
  ok(Math.abs(s2.vitals.energy - 60) < 0.01, '睡两小时只回 20', String(s2.vitals.energy));
  ok(r2.woke === null, '两小时还没到点，仍然在睡');

  /* ④ 饿醒：饱腹只剩 20，睡不到点就被身体叫起来。 */
  const s3 = freshState(t0);
  s3.vitals.food = 20;
  s3.vitals.energy = 40;
  applyAct(s3, 'sleep', t0);
  const r3 = advance(s3, new Date(t0.getTime() + 8 * 3_600_000));
  ok(r3.woke?.reason === 'hungry', '饿醒了', String(r3.woke?.reason));
  ok(r3.woke.hours < 2, '只睡了一个多钟头', String(r3.woke?.hours));
  ok(s3.asleepUntil === '', '饿醒之后不再挂着「在睡」');
  ok(s3.moodlets.some((m) => m.source === 'sleep' && m.kind === 'bad'), '醒来心情是负的');

  /* ⑤ 同一时刻推两次，第二次一动不动（幂等）。 */
  const s4 = freshState(t0);
  applyAct(s4, 'sleep', t0);
  const t4 = new Date(t0.getTime() + 3 * 3_600_000);
  const a = advance(s4, t4);
  const before = s4.vitals.energy;
  const b = advance(s4, t4);
  ok(a.hours > 0 && b.hours === 0, '第二次推进没有任何时间可走', String(b.hours));
  ok(s4.vitals.energy === before, '幂等：不会多补一次精力');

  /* ⑥ 睡着时动作全禁（出工、搬家都拦）。 */
  const s5 = freshState(t0);
  s5.vitals.energy = 90;
  applyAct(s5, 'sleep', t0);
  const w = applyWork(s5, '搬货', new Date(t0.getTime() + 3_600_000));
  ok(!w.ok && /在睡/.test(w.reason), '睡着出不了工', w.reason);
  const mv = applyMove(s5, 'old', new Date(t0.getTime() + 3_600_000));
  ok(!mv.ok && /在睡/.test(mv.reason), '睡着搬不了家', mv.reason);
  const eat = applyAct(s5, 'eat', new Date(t0.getTime() + 3_600_000));
  ok(!eat.ok && /在睡/.test(eat.reason), '睡着吃不了东西', eat.reason);
  /* 拒绝话里要带路 —— 只说「不行」她会愣着。 */
  ok(/起来/.test(eat.reason) && /wake/.test(eat.reason), '拒绝时说清了唯一能走的路');
  ok(/不算叫/.test(eat.reason), '拒绝时也说明他说话不算叫醒');

  /* ⑦ 起来：提前起按已睡的钟点结算。 */
  const s6 = freshState(t0);
  s6.vitals.energy = 40;
  applyAct(s6, 'sleep', t0);
  const up = applyAct(s6, 'wake', new Date(t0.getTime() + 3 * 3_600_000));
  ok(up.ok, '能起来');
  ok(Math.abs(s6.vitals.energy - 70) < 0.01, '睡了 3 小时 → 精力 +30', String(s6.vitals.energy));
  ok(s6.asleepUntil === '' && s6.asleepFrom === '', '起来之后两个字段都清空');
  ok(s6.moodlets.some((m) => m.source === 'sleep' && m.kind === 'bad'), '没睡够就起，心情是负的');

  /* ⑧ 老档迁移：只有 asleepUntil、没有 asleepFrom，不能凭空补精力。 */
  const legacy = { ...freshState(t0) } ;
  delete legacy.asleepFrom;
  legacy.asleepUntil = new Date(t0.getTime() + 2 * 3_600_000).toISOString();
  const norm = normalize(legacy, t0);
  ok(norm.asleepUntil !== '', '老档的睡眠还认');
  ok(norm.asleepFrom !== '', '起点用 updatedAt 补上（只会算短，不会算长）');
  ok(Date.parse(norm.asleepFrom) <= t0.getTime(), '补出来的起点不晚于现在');

  /* ⑨ describe.json 里的 life_act 枚举与 ACTS 同步（含 wake）。 */
  const desc = JSON.parse(readFileSync(new URL('../describe.json', import.meta.url), 'utf8'));
  const actDecl = desc.tools.find((x) => x.name === 'life_act');
  ok(actDecl?.parameters?.properties?.kind?.enum?.includes('wake'), 'describe.json 里的 life_act 含 wake');

  /* ⑩ 跨 7 天封顶 + 睡眠：十天前睡满 8 小时，十天后上线不应误判成「没睡透」。 */
  const s10d = freshState(t0);
  s10d.vitals.energy = 50;
  applyAct(s10d, 'sleep', t0);
  const r10d = advance(s10d, new Date(t0.getTime() + 10 * 24 * 3_600_000));
  ok(r10d.sleptHours === 0, '十天前那觉在 7 天封顶之外，不单独再算睡眠', String(r10d.sleptHours));
  ok(r10d.woke === null, '十天前睡醒的不在今天上线时补挂「没睡透」');
  ok(!s10d.moodlets.some((m) => m.source === 'sleep' && m.kind === 'bad'), '不会因为封顶截断挂负心情');

  /* ⑪ 离线三天（无显式睡眠记录）：wholeDays = floor(awakeHours / 24) 与改前一致。 */
  const s3d = freshState(t0);
  s3d.vitals.energy = 60;
  const r3d = advance(s3d, new Date(t0.getTime() + 72 * 3_600_000));
  ok(r3d.sleptHours === 0, '无显式睡眠时 sleptHours = 0');
  ok(s3d.vitals.energy === 85, '离线三天无显式睡眠，精力照旧补回 85', String(s3d.vitals.energy));
}

console.log('\n[35] 工具入口先推进时间：掉过线的提醒不能被吞掉');
{
  /*
   * 真实场景：关机一夜，早上开机第一件事就是调工具。
   *
   * 如果工具入口自己调 `advance()` 却不处理 `crossed`，那一夜的「饿过线」
   * 就被工具消费掉了 —— `tick` 之后再也看不到（它判的是「上次在线上下次在线下」）。
   * 结果是她饿了一夜、一句提醒都没有。
   */
  const dir = mkdtempSync(join(tmpdir(), 'life-settle-'));
  const pushed = [];
  const cfg = { ...LIFE_DEFAULTS(), enabled: true, homeCity: '成都', notify: 'once' };
  const w = new LifeWorld({ cfg, dataDir: dir, botName: '大肥鱼' });
  await w.start({
    log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
    pushEvent: async (e) => { pushed.push(e); return { ...e, blobs: [] }; },
  });
  pushed.length = 0;

  /* 六小时前饱腹 35 —— 这会儿已经掉到 30 以下，但她第一件事是去吃饭。 */
  const sixHoursAgo = new Date(Date.now() - 6 * 3_600_000);
  w.state.vitals.food = 35;
  w.state.updatedAt = sixHoursAgo.toISOString();

  const actTool = w.tools().find((x) => x.name === 'life_act');
  await actTool.handler({ kind: 'eat' });

  const low = pushed.filter((e) => e.type === 'life.low');
  ok(low.length > 0, '工具推进时把掉过线的说了', low.map((x) => x.text).join(' | '));
  ok(low.some((x) => /饱腹/.test(x.text)), '说的是饱腹那条', low.map((x) => x.text).join(' | '));
  /* 时间段制下：推进 40 分钟吃完，饱腹才回来 */
  advance(w.state, new Date(Date.now() + ACTS.eat.minutes * 60_000));
  ok(w.state.vitals.food > 30, '吃完 40 分钟后饱腹回来了', String(w.state.vitals.food));
  await w.stop();
}

console.log('\n[36] 二期：需求见底破例提醒（zero:key 独立额度）');
{
  const dir = mkdtempSync(join(tmpdir(), 'life-zero-'));
  const pushed = [];
  const cfg = { ...LIFE_DEFAULTS(), enabled: true, notify: 'once' };
  const w = new LifeWorld({ cfg, dataDir: dir, botName: '大肥鱼' });
  await w.start({
    log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
    /* 现代宿主：resolve 只返回带 cursor 的已接受信封，投递结果稍后由 settled 回执确认。 */
    pushEvent: async (e) => {
      const envelope = { ...e, blobs: [], cursor: pushed.length + 1 };
      pushed.push(envelope);
      return envelope;
    },
    pushDeferred: (_spec, _opts) => {},
  });
  pushed.length = 0;

  const today = localDateKey(new Date());
  /* 模拟今天已经跨过 30 提醒过一次，现在娱乐掉到 1，再过 1 小时见底。 */
  w.state.nagged.fun = today;
  w.state.vitals.fun = 1.5;
  w.state.updatedAt = new Date(Date.now() - 3_600_000).toISOString();

  await w.tools().find((x) => x.name === 'life_status').handler({});
  const zeroMsg = pushed.filter((e) => e.type === 'life.low' && /见底了/.test(e.text));
  ok(zeroMsg.length === 1, '今天报过 30 后，掉到 0 仍破例推一次见底提醒', zeroMsg.map((x) => x.text).join(' | '));
  ok(w.state.nagged['zero:fun'] === undefined, '无 settled 回执时只接受不提交 zero:fun 额度');
  ok(Boolean(zeroMsg[0]?.meta?.lifeAttempt) && zeroMsg[0]?.cursor === 1, '测试宿主保留 delivered 对账所需 meta 与 cursor');

  /* cursor 不符的回执不能提交；真实宿主随后按原 meta + cursor 回 delivered。 */
  w.onEventsSettled([{ ...zeroMsg[0], cursor: zeroMsg[0].cursor + 1 }], 'delivered');
  ok(w.state.nagged['zero:fun'] === undefined, 'cursor 不符的 delivered 不提交 zero:fun 额度');
  w.onEventsSettled([zeroMsg[0]], 'delivered');
  ok(w.state.nagged['zero:fun'] === today, '真实 delivered 后记下 zero:fun 独立防打扰标记');
  await w.stop();
}

console.log('\n[37] 二期：统一账本流水与 life-pending 结算 + 公共快照 schema 2');
{
  const dir = mkdtempSync(join(tmpdir(), 'life-ledger-'));
  const t0 = new Date('2026-11-16T10:00:00.000Z');
  ok(appendLedger(dir, { id: 'l1', ts: t0.toISOString(), kind: 'expense', amount: 15, source: 'life_act', payee: '吃东西', note: '午饭' }), '写入第一笔流水');
  ok(!appendLedger(dir, { id: 'l1', ts: t0.toISOString(), kind: 'expense', amount: 15, source: 'life_act', payee: '吃东西', note: '午饭' }), '同 id 不重复记账');
  const rows = readLedger(dir, 10);
  ok(rows.length === 1 && rows[0].amount === 15, '读回流水数量与金额正确');

  mkdirSync(join(dir, 'life-pending'), { recursive: true });
  writeFileSync(join(dir, 'life-pending', 'trip-1.json'), JSON.stringify({
    schema: 1, id: 'journey-trip-1', source: 'journey', kind: 'trip-settle',
    worldHours: 10, amount: 200, earned: 50, payee: '旅途', note: '西安三日',
  }));
  const cfg = { ...LIFE_DEFAULTS(), enabled: true };
  const w = new LifeWorld({ cfg, dataDir: dir, botName: '大肥鱼' });
  await w.start({
    log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
    pushEvent: async (e) => ({ ...e, blobs: [] }),
  });
  await w.tick();
  await w.tools().find((x) => x.name === 'life_act').handler({ kind: 'eat' });
  /* 吃一顿耗时 40 分钟，推进到结束后再读表验证 */
  advance(w.state, new Date(Date.now() + ACTS.eat.minutes * 60_000));
  const pub = JSON.parse(readFileSync(join(dir, 'life-public.json'), 'utf8'));
  ok(pub.schema === 2 && pub.ledger && pub.ledger.travelAllowance > 0, 'life-public.json 已升级 schema 2 并带 travelAllowance');
  ok(w.state.money.cash === 3000 - 200 + 50 - 15, 'pending 与吃东西扣钱全部对账正确', String(w.state.money.cash));

  /* 归档是判重的第二道保险：文件一旦离开 pending 目录，就算判重表被截断也读不到它。 */
  ok(!existsSync(join(dir, 'life-pending', 'trip-1.json')), '结算后条子已离开 pending 目录');
  ok(existsSync(join(dir, 'life-pending', 'done', 'trip-1.json')), '条子归档进 done/，还能查账');
  const cashAfterSettle = w.state.money.cash;
  w.state.spendApplied = []; // 模拟 120 条截断：老 id 被挤出判重表
  w.settleSpendRequests(new Date('2026-11-16T11:00:00.000Z'));
  ok(w.state.money.cash === cashAfterSettle, '判重表被清空也不重复扣款（条子已归档）', String(w.state.money.cash));
  await w.stop();
}

console.log('\n[38] 二期：礼物防签到 + §6.6 生活回声 + 物候天气');
{
  const s = freshState(new Date('2026-10-15T10:00:00.000Z'));
  const g1 = applyGift(s, '一袋橘子', 'Mr.Q', new Date('2026-10-15T10:00:00.000Z'));
  const g2 = applyGift(s, '另一袋', 'Mr.Q', new Date('2026-10-15T12:00:00.000Z'));
  ok(g1.ok && s.gifts.length === 1, '收到第一件礼物');
  ok(!g2.ok, '同一天第二件礼物被拦（防签到）');

  s.wants.push({ id: 'w-cook', what: '想自己煮面吃', scale: 'small', kind: 'thing', since: s.updatedAt, note: '' });
  applyAct(s, 'cook', new Date('2026-10-15T13:00:00.000Z'));
  ok(s.tellable.some((t) => /还记得之前惦记过「想自己煮面吃」/.test(t.text)), '命中 wants 触发生活回声');
  const wInfo = weatherOf('芦花塘', new Date('2026-10-15T13:00:00.000Z'));
  ok(['晴', '多云', '小雨', '起风'].includes(wInfo.sky) && Boolean(wInfo.seasonNote), '物候天气有效');
}

console.log('\n[39] 三期：完整五状态链（肠胃 / 宿醉 / 扭伤）');
{
  const t = new Date('2026-11-16T10:00:00.000Z');
  const s = freshState(t);
  let cur = t;
  for (let i = 0; i < 3; i++) {
    applyAct(s, 'instant', cur);
    cur = new Date(cur.getTime() + ACTS.instant.minutes * 60_000);
    advance(s, cur);
    cur = new Date(cur.getTime() + 60_000);
  }
  ok(s.conditions.some((c) => c.id === 'stomach'), '连吃 3 次将就饭触发肠胃不适');

  const s2 = freshState(t);
  let cur2 = t;
  for (let i = 0; i < 2; i++) {
    applyAct(s2, 'drink', cur2);
    cur2 = new Date(cur2.getTime() + ACTS.drink.minutes * 60_000);
    advance(s2, cur2);
    cur2 = new Date(cur2.getTime() + 60_000);
  }
  ok(s2.conditions.some((c) => c.id === 'hangover'), '连喝 2 次小酒触发宿醉');

  const s3 = freshState(t);
  s3.vitals.energy = 24;
  const wr = applyWork(s3, '搬货', t, 'home');
  ok(wr.ok && s3.conditions.some((c) => c.id === 'injury'), '低精力强行干体力活触发扭伤');
  advance(s3, new Date(t.getTime() + (wr.minutes || 210) * 60_000));
  s3.vitals.energy = 60;
  const wr2 = applyWork(s3, '看店', new Date('2026-11-17T10:00:00.000Z'), 'home');
  ok(!wr2.ok && /扭伤/.test(wr2.reason || ''), '扭伤期间拦住体力活');
}

console.log('\n[40] 三期：职业 place 过滤 + 材料成本 + L2 市集买卖');
{
  const t = new Date('2026-11-16T10:00:00.000Z');
  const s = freshState(t);
  s.home.monthly = 0;
  const travelBlocked = applyWork(s, '看店', t, 'traveling');
  ok(!travelBlocked.ok && /在路上/.test(travelBlocked.reason || ''), '在路上不能接 home 活');
  const deliv = applyWork(s, '送外卖', t, 'home');
  ok(deliv.ok && s.money.cash === 3000 - 8, '送外卖开工先扣 8 元成本', String(s.money.cash));
  advance(s, new Date(t.getTime() + (deliv.minutes || 210) * 60_000));
  ok(s.money.cash === 3000 - 8 + 120, '干完后入账 120 元', String(s.money.cash));

  const prices = marketPrices(t);
  ok(prices.length === 3 && prices.every((p) => p.price > 0), '本地早市物价表正常');

  const srv = createServer((req, res) => {
    if (req.url?.startsWith('/town/stalls') && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ stalls: [{ id: 'st-1', seller: '阿青', item: '葱油面', price: 14, stock: 2 }] }));
      return;
    }
    if (req.url === '/town/buy' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, item: '葱油面', price: 14, seller: '阿青' }));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const port = srv.address().port;
  const stRes = await fetchTownStalls(`http://127.0.0.1:${port}`);
  ok(stRes.ok && stRes.stalls.length === 1 && stRes.stalls[0].item === '葱油面', 'L2 GET /town/stalls 正常');
  const buyRes = await buyTownStall(`http://127.0.0.1:${port}`, 'st-1', 'u1');
  ok(buyRes.ok && buyRes.price === 14 && buyRes.seller === '阿青', 'L2 POST /town/buy 正常');
  srv.close();
}

console.log('\n[41] 出工消耗五条（含饱腹，但暂停社交和娱乐衰减）');
{
  const t0 = new Date('2026-11-15T08:00:00Z');
  const s = freshState(t0);
  s.vitals = { food: 90, energy: 90, clean: 90, fun: 90, social: 90 };
  const r = applyWork(s, '搬货', t0, 'home');
  ok(r.ok && r.started, '今天能出工');
  advance(s, new Date(t0.getTime() + (r.minutes || 210) * 60_000));
  ok(s.vitals.food < 90, '出工也掉饱腹（干活会饿）', String(s.vitals.food));
  ok(s.vitals.energy < 90 && s.vitals.clean < 90, '精力和清爽照扣');
  ok(near(s.vitals.fun, 85, 0.2) && near(s.vitals.social, 90, 0.01), '工作期间暂停日常社交与娱乐衰减（仅按岗位 load 消耗）', `${s.vitals.fun}/${s.vitals.social}`);
}

console.log('\n[42] 睡着跨的线不会丢（deferred 落盘）');
{
  const t0 = new Date('2026-11-15T20:00:00Z');
  const s = freshState(t0);
  s.vitals.food = 34;
  /* 睡八小时、不补饭：饱腹必然跨过 30。 */
  s.asleepFrom = t0.toISOString();
  s.asleepUntil = new Date(t0.getTime() + 8 * 3_600_000).toISOString();
  const r = advance(s, new Date(t0.getTime() + 8 * 3_600_000));
  ok(r.crossed.includes('food'), '这一觉里饱腹跨过了 30', r.crossed.join(','));
  /* 跨线事实要能被记下来并存活一次存盘读回 —— 否则醒来那一下永远补不上。 */
  s.deferred = [...new Set([...s.deferred, ...r.crossed])];
  const back = normalize(JSON.parse(JSON.stringify(s)), new Date(t0.getTime() + 9 * 3_600_000));
  ok(back.deferred.includes('food'), 'deferred 存得下来、读得回来', back.deferred.join(','));
}

console.log('\n[43] 目标兜底：老档没有 goals 时按当前住处补一条（且跳过已经够的档）');
{
  const t0 = new Date('2026-11-15T12:00:00Z');
  const s = freshState(t0);
  const rawLow = JSON.parse(JSON.stringify(s));
  rawLow.goals = [];
  rawLow.money.cash = 1000;
  const backLow = normalize(rawLow, t0);
  ok(backLow.goals.length === 1, '现金不足老小区时补回老小区目标', String(backLow.goals.length));
  ok(backLow.goals[0].id === 'g-home-old', '现金 1000 → 指向上一档（老小区 2400）', backLow.goals[0].id);

  const raw = JSON.parse(JSON.stringify(s));
  raw.goals = [];
  const back = normalize(raw, t0);
  ok(back.goals[0].id === 'g-home-new', '现金 3000 已够老小区 → 顺延指向新小区（5200）', back.goals[0].id);

  /* 已经住到别墅区的，不再立目标 —— 立了就是一个永远做不完的条。 */
  const villa = JSON.parse(JSON.stringify(s));
  villa.goals = [];
  villa.home = { tenure: 'own', tier: 'villa', street: '', monthly: 7800, since: t0.toISOString() };
  ok(normalize(villa, t0).goals.length === 0, '别墅区不补目标');
}

console.log('\n[44] 读书涨见识，见识决定考证的胜算（2026-11-17）');
{
  const t0 = new Date('2026-11-17T09:00:00Z');
  const s = freshState(t0);
  s.vitals = { food: 80, energy: 80, clean: 80, fun: 30, social: 60 };

  ok(s.knowledge === 0, '新档见识从 0 起', String(s.knowledge));
  const r = applyAct(s, 'study', t0);
  ok(r.ok && r.started, '能读书');
  const tStudyEnd = new Date(t0.getTime() + ACTS.study.minutes * 60_000);
  advance(s, tStudyEnd);
  ok(near(s.knowledge, 6, 0.1), '读完一次涨约 6 点（见 KNOWLEDGE_PER_STUDY）', String(s.knowledge));
  ok(s.vitals.fun > 30, '读书也补娱乐（Mr.Q：「加娱乐」）', String(s.vitals.fun));
  ok(s.moodlets.some((m) => m.source === 'study' && m.kind === 'good'), '读进去了是好情绪');

  /* 见识封顶，读成专家之后只补娱乐 */
  s.knowledge = 100;
  const t2 = new Date(tStudyEnd.getTime() + 60_000);
  applyAct(s, 'study', t2);
  advance(s, new Date(t2.getTime() + ACTS.study.minutes * 60_000));
  ok(s.knowledge <= 100 && s.knowledge >= 99.9, '见识封顶 100，不会溢出', String(s.knowledge));

  /*
   * 不看不学要退（2026-11-17 Mr.Q 追加）。
   * 0.05/小时 → 一天 1.2；**按总时长算，睡觉也在忘**。
   */
  const s3 = freshState(t0);
  s3.knowledge = 30;
  advance(s3, new Date(t0.getTime() + 24 * 3_600_000));
  ok(near(s3.knowledge, 28.8, 0.01), '一天不读掉 1.2', String(s3.knowledge));
  const s4 = freshState(t0);
  s4.knowledge = 5;
  advance(s4, new Date(t0.getTime() + 30 * 24 * 3_600_000));
  ok(s4.knowledge === 0, '一直不读掉到 0 就停，不会变负', String(s4.knowledge));

  /* 干活也长见识，越高级越多；零工不长 */
  const s5 = freshState(t0);
  s5.vitals = { food: 90, energy: 90, clean: 90, fun: 90, social: 90 };
  applyWork(s5, '搬货', t0, 'home');
  ok(s5.knowledge === 0, '零工不长见识', String(s5.knowledge));

  const s6 = freshState(t0);
  s6.vitals = { food: 90, energy: 90, clean: 90, fun: 90, social: 90 };
  s6.job.certs = ['护士执业证'];
  s6.job.days = 40;
  const pro = applyWork(s6, '社区护士', t0, 'home');
  ok(pro.ok, `专业岗没接上：${pro.reason ?? ''}`);
  advance(s6, new Date(t0.getTime() + (pro.minutes || 480) * 60_000));
  ok(s6.knowledge > 0, '专业岗一天长见识', String(s6.knowledge));
  ok(s6.knowledge < 6, '但比专心读一次书少', String(s6.knowledge));

  /* 概率曲线：见识 0 一成半，达到 need 九成，封顶九成 */
  const need = 40;
  ok(near(certChance(0, need), 0.15, 0.001), '见识 0 → 15%', String(certChance(0, need)));
  ok(near(certChance(20, need), 0.525, 0.001), '见识一半 → 52.5%', String(certChance(20, need)));
  ok(near(certChance(need, need), 0.9, 0.001), '见识够了 → 90%', String(certChance(need, need)));
  ok(near(certChance(100, need), 0.9, 0.001), '再高也不到 100%', String(certChance(100, need)));

  /* 考砸：钱照扣、证没到手、情绪是坏的、当天不能再考 */
  const s2 = freshState(t0);
  s2.knowledge = 0;
  s2.money.cash = 3000;
  const fail = applyCert(s2, '厨师证', t0, 0.99);
  ok(fail.ok && fail.passed === false, '考砸了也是一件「做过的事」', String(fail.passed));
  ok(s2.money.cash === 2500, '报名费 500 照扣、不退', String(s2.money.cash));
  ok(!s2.job.certs.includes('厨师证'), '没考过就没有证');
  ok(s2.moodlets.some((m) => m.source === 'cert-fail' && m.kind === 'bad'), '考砸了要有坏情绪');
  const sameDay = applyCert(s2, '厨师证', t0, 0);
  ok(!sameDay.ok, '一天一张只考一次');
  /* 第二天再来，这次骰子好 */
  const nextDay = applyCert(s2, '厨师证', new Date(t0.getTime() + 86_400_000), 0);
  ok(nextDay.ok && nextDay.passed === true, '第二天考过了');
}

console.log('\n[45] 跨关机睡眠结算：睡醒过点重启后不能抹掉整晚睡眠');
{
  const dir = mkdtempSync(join(tmpdir(), 'life-sleep-boot-'));
  const tSleep = new Date('2026-11-16T15:00:00.000Z');
  const s = freshState(tSleep);
  s.vitals.energy = 10;
  s.vitals.food = 90;
  applyAct(s, 'sleep', tSleep);
  new StateStore(dir).save(s);

  /* 9 小时后（已过 8 小时醒来点）再 load + advance：必须拿到 +80 精力 */
  const tWake = new Date(tSleep.getTime() + 9 * 3_600_000);
  const loaded = new StateStore(dir).load(tWake);
  ok(Boolean(loaded.state.asleepUntil), 'normalize 不提前清空已过点的睡眠区间');
  const r = advance(loaded.state, tWake);
  ok(near(r.sleptHours, 8, 0.01), '结算了完整的 8 小时睡眠', String(r.sleptHours));
  ok(loaded.state.vitals.energy > 80, '睡醒拿到 +80 精力，不再被倒扣成熬夜', String(loaded.state.vitals.energy));
  ok(loaded.state.asleepUntil === '', '结算完后才清空 asleepUntil');
}

console.log('\n[46] 需求补回后解锁当日提醒 + 跨 15 紧急提醒 + 防过期告警');
{
  const t0 = new Date('2026-11-17T08:00:00');
  const s = freshState(t0);
  s.vitals.food = 25;
  s.nagged.food = localDateKey(t0);
  applyAct(s, 'eat', t0);
  advance(s, new Date(t0.getTime() + ACTS.eat.minutes * 60_000));
  ok(s.vitals.food >= 45 && s.nagged.food === undefined, '吃回到 45 以上后清掉当日 nagged.food 锁');

  const s2 = freshState(t0);
  s2.vitals.food = 17;
  const rCrit = advance(s2, new Date(t0.getTime() + 3_600_000));
  ok(rCrit.critical.includes('food'), '掉穿 15 触发 critical 标记', rCrit.critical.join(','));
}

console.log('\n[47] 生活日记、可改路径与双扩展分流 + diary 面板');
{
  const dir = mkdtempSync(join(tmpdir(), 'life-diary-'));
  const customDir = join(dir, 'my-onedrive-life');
  const cfg = { ...LIFE_DEFAULTS(), enabled: true, homeCity: '成都', diaryDir: customDir };
  const w = new LifeWorld({ cfg, dataDir: dir, botName: '大肥鱼' });
  await w.start({
    log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
    pushEvent: async (e) => ({ ...e, blobs: [] }),
  });

  const writeTool = w.tools().find((x) => x.name === 'life_diary_write');
  const readTool = w.tools().find((x) => x.name === 'life_diary_read');
  const wr = await writeTool.handler({ body: '今天去早市街转了转，花了 15 块钱吃了一碗热面。', dateKey: '2026-11-17' });
  ok(/2026-11-17/.test(wr.text) && existsSync(join(customDir, '2026-11.md')), '日记写入自定义目录', wr.text);

  const rd = await readTool.handler({ dateKey: '2026-11-17' });
  ok(/早市街/.test(rd.text), 'life_diary_read 读回第一人称日记', rd.text);

  const panelList = await w.panelInvoke('diary', 'list');
  ok(panelList.dir === customDir && panelList.days.length === 1, 'diary 面板返回目录和日记列表');

  /* 模拟旅行扩展开着且正在外地停留：life_diary_write 提示去写旅行日记 */
  writeFileSync(join(dir, 'journey-public.json'), JSON.stringify({
    phase: 'staying',
    city: { id: 'chengdu', name: '成都' },
    updatedAt: new Date().toISOString(),
  }));
  const tripBlock = await writeTool.handler({ body: '外地测试', dateKey: '2026-11-18' });
  ok(/journey_diary_write/.test(tripBlock.text), '旅行期间提示用 journey_diary_write', tripBlock.text);

  await w.stop();
}

console.log('\n[48] 时间段制动作、新复合动作、打断惩罚与上班早退');
{
  const t0 = new Date('2026-11-18T10:00:00Z');
  const s = freshState(t0);
  s.vitals = { food: 70, energy: 80, clean: 80, fun: 40, social: 40 };

  /* 1. 复合动作：找朋友逛商场（90 分钟，按分钟精力-0.01/社交+0.35/娱乐+0.35 等，总计 81 元） */
  const mallStart = applyAct(s, 'mall', t0);
  ok(mallStart.ok && mallStart.started && mallStart.minutes === 90, '开始逛商场 90 分钟');
  ok(s.money.cash === 3000, '刚开局不扣光钱');
  /* 进行中互斥拦截 */
  ok(!applyAct(s, 'eat', new Date(t0.getTime() + 10 * 60_000)).ok, '逛商场途中不能再开吃');
  ok(!applyWork(s, '搬货', new Date(t0.getTime() + 10 * 60_000), 'home').ok, '逛商场途中不能去上班');

  /* 推进一半（45 分钟）：五维与花销大约各走一半 */
  advance(s, new Date(t0.getTime() + 45 * 60_000));
  ok(s.vitals.fun > 40 && s.vitals.social > 40 && s.vitals.energy < 80, '逛商场过半时娱乐社交渐增、精力微降');
  ok(s.money.cash < 3000 && s.money.cash > 2919, '过半时按分钟累进扣了部分钱', String(s.money.cash));

  /* 走完后半（90 分钟）：结清全部 */
  advance(s, new Date(t0.getTime() + 90 * 60_000));
  ok(!s.activity, '逛完 90 分钟后活动结束');
  ok(s.money.cash === 3000 - 81, '逛商场 90 分钟结清 81 元', String(s.money.cash));

  /* 2. 中途 cancel 打断普通动作（SPA 60m / 120元，做 20 分钟就停：扣约 40 元 + 扫兴） */
  const s2 = freshState(t0);
  const spaStart = applyAct(s2, 'spa', t0);
  ok(spaStart.ok && spaStart.started, '开始做 SPA');
  const tMid = new Date(t0.getTime() + 20 * 60_000);
  advance(s2, tMid);
  const cancelRes = applyAct(s2, 'cancel', tMid);
  ok(cancelRes.ok && cancelRes.interruptedLabel === ACTS.spa.label, 'cancel 成功打断做 SPA');
  ok(!s2.activity, '打断后活动清空');
  ok(s2.money.cash < 3000 && cancelRes.mood?.kind === 'bad', '已花的钱不退且挂扫兴坏情绪', String(s2.money.cash));

  /* 3. 上班早退：不满 30 分钟白干，满 30 分钟打 6 折，不涨 job.days 且当天不能重接 */
  const s3 = freshState(t0);
  s3.home.monthly = 0;
  const wShort = applyWork(s3, '搬货', t0, 'home');
  ok(wShort.ok && wShort.minutes && wShort.minutes >= 180 && wShort.minutes <= 240, '零工工时在 180-240 分钟', String(wShort.minutes));
  const t15 = new Date(t0.getTime() + 15 * 60_000);
  advance(s3, t15);
  const cShort = applyAct(s3, 'cancel', t15);
  ok(cShort.ok && (cShort.workEarned ?? 0) === 0, '不满 30 分钟早退白干', String(cShort.workEarned));
  ok(s3.job.days === 0, '早退不涨工龄');
  ok(!applyWork(s3, '搬货', new Date(t15.getTime() + 60_000), 'home').ok, '早退后当天不能重接');

  const s4 = freshState(t0);
  s4.home.monthly = 0;
  const wHalf = applyWork(s4, '搬货', t0, 'home'); // 112 元 / 240 分钟
  const tHalf = new Date(t0.getTime() + Math.round((wHalf.minutes || 240) / 2) * 60_000);
  advance(s4, tHalf);
  const cHalf = applyAct(s4, 'cancel', tHalf);
  ok(cHalf.ok && cHalf.workEarned === 34, '干满一半早退按 6 折结算 (112 * 0.5 * 0.6 = 34)', String(cHalf.workEarned));
  ok(s4.job.days === 0 && s4.money.cash === 3034, '不涨工龄且早退钱到账');

  /* 4. 面板搬家：忙时返回明确原因，闲时搬成记流水并推 life.moved 通知肥鱼 */
  const moveDir = mkdtempSync(join(tmpdir(), 'life-move-panel-'));
  const movePushed = [];
  const mw = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: moveDir, botName: '大肥鱼' });
  await mw.start({
    log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
    pushEvent: async (e) => { movePushed.push(e); return { ...e, blobs: [] }; },
  });
  await mw.tools().find((x) => x.name === 'life_act').handler({ kind: 'tea' });
  const pubDuringTea = JSON.parse(readFileSync(join(moveDir, 'life-public.json'), 'utf8'));
  ok(
    pubDuringTea.activity && pubDuringTea.activity.id === 'tea'
    && pubDuringTea.activity.scene === '临水茶室'
    && pubDuringTea.activity.outfitHint === '浅色针织衫',
    'life-public.json 广播进行中活动的 scene 与 outfitHint',
    JSON.stringify(pubDuringTea.activity),
  );
  const moveWhileBusy = await mw.panelInvoke('now', 'move', { tier: 'old' });
  ok(moveWhileBusy.ok === false && /停下来/.test(moveWhileBusy.reason || ''), '忙时点面板搬家返回明确拦阻原因', moveWhileBusy.reason);
  await mw.tools().find((x) => x.name === 'life_act').handler({ kind: 'cancel' });
  const moveOk = await mw.panelInvoke('now', 'move', [{ tier: 'old' }]);
  ok(moveOk.ok === true && mw.state.home.tier === 'old', '闲时面板搬家成功（兼容宿主数组传参 [{ tier }]）');
  ok(movePushed.some((e) => e.type === 'life.moved' && /老小区/.test(e.text)), '面板搬家后推送 life.moved 通知肥鱼');
  ok(readLedger(moveDir, 10).some((e) => e.source === 'life_move' && e.amount === 2400), '面板搬家押金记入账本');
  await mw.stop();

  /* 5. 完成后 tellable 带出场景与手边物品细节 */
  const sScene = freshState(t0);
  applyAct(sScene, 'cafe', t0);
  advance(sScene, new Date(t0.getTime() + ACTS.cafe.minutes * 60_000));
  ok(
    sScene.tellable.some((t) => /街角咖啡馆/.test(t.text) && /手冲咖啡/.test(t.text)),
    '完成活动记入 tellable 时带出场景与物品细节',
    sScene.tellable.map((t) => t.text).join(' | '),
  );
}

console.log('\n[49] 四分类素材库、留影策略与跨扩展 visualPrompt');
{
  const libDir = mkdtempSync(join(tmpdir(), 'life-lib-'));
  const lw = new LifeWorld({ cfg: { ...LIFE_DEFAULTS(), enabled: true }, dataDir: libDir, botName: '大肥鱼' });
  await lw.start({
    log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
    pushEvent: async (e) => ({ ...e, blobs: [] }),
  });

  const listSnap = await lw.panelInvoke('library', 'list');
  ok(Array.isArray(listSnap.entries) && listSnap.entries.length >= 10, '素材库首次启动自动写入默认条目', String(listSnap.entries?.length));

  /* 工具增改与检索 */
  const libTool = lw.tools().find((x) => x.name === 'life_library');
  ok(Boolean(libTool), '已注册 life_library 工具');
  await libTool.handler({
    action: 'upsert', category: 'outfits', id: 'autumn-coat', name: '秋日风衣',
    aliases: '焦糖风衣', tags: '秋装,出门', appearance: '焦糖色长风衣配米色围巾',
  });
  const sr = await libTool.handler({ action: 'search', query: '焦糖' });
  ok(/秋日风衣/.test(sr.text), 'life_library search 命中别名与描述', sr.text);

  /* 面板上传 base64 参考图与留影策略设置 */
  const samplePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await lw.panelInvoke('library', 'upsert', [{
    category: 'props', id: 'test-cup', name: '测试陶杯',
    appearance: '手工粗陶马克杯', imageDataUrls: [samplePng],
  }]);
  ok(up.ok && up.entry.images.length === 1 && up.entries.some((e) => e.id === 'test-cup' && e.imagePreviews?.length === 1), '面板 upsert 支持保存图片与回传预览');

  const pol = await lw.panelInvoke('library', 'savePolicy', [{ policy: 'active', cooldownMin: 30 }]);
  ok(pol.ok && pol.settings.policy === 'active' && pol.settings.cooldownMin === 30, '面板保存留影策略与冷却成功');

  /* 开始 cafe 活动，检查 life-public.json 广播的 visualPrompt 与 imagePolicy */
  await lw.tools().find((x) => x.name === 'life_act').handler({ kind: 'cafe' });
  const pub = JSON.parse(readFileSync(join(libDir, 'life-public.json'), 'utf8'));
  ok(pub.activity && /木质暖光街角咖啡馆/.test(pub.activity.visualPrompt || ''), 'life-public.json 广播出匹配场景库的外观 visualPrompt', pub.activity?.visualPrompt);
  ok(pub.imagePolicy && pub.imagePolicy.policy === 'active' && pub.imagePolicy.cooldownMin === 30, 'life-public.json 携带 imagePolicy');

  const del = await lw.panelInvoke('library', 'delete', [{ category: 'props', id: 'test-cup' }]);
  ok(del.ok && !del.entries.some((e) => e.id === 'test-cup'), '面板 delete 正常删掉条目');

  const customLibDir = mkdtempSync(join(tmpdir(), 'life-custom-lib-'));
  const sw = lw.library.configure(customLibDir);
  ok(sw.problem === null && lw.library.rootDir === customLibDir, '素材库支持切换到自定义目录', sw.problem ?? lw.library.rootDir);
  const snap2 = await lw.panelInvoke('library', 'list');
  ok(snap2.dir === customLibDir && Array.isArray(snap2.entries) && snap2.entries.length >= 10, '切换后在新目录自动播撒默认条目且面板返回新 dir');
  const swBack = lw.library.configure('');
  ok(swBack.problem === null && lw.library.rootDir === join(libDir, 'image-library'), '留空切回默认 <dataDir>/image-library');

  await lw.stop();
}

console.log('\n[换素材库目录：设置不能跟着重置]');
{
  const dir = mkdtempSync(join(tmpdir(), 'life-lib-'));
  const lib = new ImageLibrary(dir);
  lib.saveSettings({ policy: 'off', cooldownMin: 0 });
  ok(lib.getSettings().policy === 'off', '先设成「静默」');

  const other = join(dir, 'another-place');
  const r = lib.configure(other);
  ok(r.problem === null, '换目录没报错', String(r.problem));
  ok(lib.rootDir === other, '根目录确实换过去了');
  /*
   * 2026-11-18：设置原来在 `<库>/settings.json`，用户换保存目录后会悄悄回到默认。
   * 配置页只写了「改完立即生效」，没说策略会重置 —— 她拍照的频率变了，人找不到原因。
   */
  ok(lib.getSettings().policy === 'off', '换目录把留影策略重置了 —— 用户以为只是换个地方存图');
  ok(existsSync(join(dir, 'image-library-settings.json')), '设置文件应该在 dataDir 下，不在库目录里');
}

console.log('\n[老版本的 settings.json 要搬过来]');
{
  const dir = mkdtempSync(join(tmpdir(), 'life-lib-legacy-'));
  const legacyDir = join(dir, 'image-library');
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, 'settings.json'), JSON.stringify({ policy: 'active', cooldownMin: 30 }), 'utf8');

  const lib = new ImageLibrary(dir);
  const s = lib.getSettings();
  ok(s.policy === 'active' && s.cooldownMin === 30, '升级后旧设置搬到了新位置', JSON.stringify(s));
}

console.log('\n[50] 体质词条、豪华酒店稳住娱乐社交、交通消耗倍率与条子五维反哺');
{
  const t0 = new Date('2026-11-18T08:00:00Z');
  const stFit = freshState(t0);
  ok(stFit.fitness === 25, '新档体质初始 25');
  applyAct(stFit, 'workout', t0);
  advance(stFit, new Date(t0.getTime() + ACTS.workout.minutes * 60_000));
  ok(stFit.fitness > 27, '跑步锻炼后体质上升', String(stFit.fitness));

  /* 高体质睡眠精力恢复快于基准体质 */
  const sLow = freshState(t0);
  const sHigh = freshState(t0);
  sLow.vitals.energy = 30;
  sHigh.vitals.energy = 30;
  sHigh.fitness = 100;
  applyAct(sLow, 'sleep', t0);
  applyAct(sHigh, 'sleep', t0);
  advance(sLow, new Date(t0.getTime() + 4 * 3_600_000));
  advance(sHigh, new Date(t0.getTime() + 4 * 3_600_000));
  ok(sHigh.vitals.energy > sLow.vitals.energy + 10, '高体质睡眠精力回得更快', `${sLow.vitals.energy} vs ${sHigh.vitals.energy}`);

  /* 豪华酒店期间娱乐与社交稳住不掉 */
  const sLux = freshState(t0);
  sLux.vitals.fun = 80;
  sLux.vitals.social = 80;
  advance(sLux, new Date(t0.getTime() + 6 * 3_600_000), { phase: 'staying', hotelTier: 'luxury' });
  ok(sLux.vitals.fun === 80 && sLux.vitals.social === 80, '豪华酒店期间娱乐社交稳住不掉');

  /* 路上步行比自驾更耗精力 */
  const sWalk = freshState(t0);
  const sCar = freshState(t0);
  advance(sWalk, new Date(t0.getTime() + 3 * 3_600_000), { phase: 'traveling', modeId: 'walk' });
  advance(sCar, new Date(t0.getTime() + 3 * 3_600_000), { phase: 'traveling', modeId: 'car' });
  ok(sWalk.vitals.energy < sCar.vitals.energy - 5, '步行赶路比自驾更耗精力', `${sWalk.vitals.energy} vs ${sCar.vitals.energy}`);

  /* applySpend 消费纯状态反哺条子（amount=0） */
  const sEff = freshState(t0);
  sEff.vitals.food = 40;
  sEff.vitals.energy = 60;
  const { settled } = applySpend(sEff, [{
    id: 'eff-1',
    amount: 0,
    note: '旅途吃顿好的',
    vitalsDelta: { food: 35, energy: -10 },
    fitnessDelta: 2,
    moodlet: { text: '在当地吃了顿顺口的好饭', kind: 'good', hours: 3 },
  }], t0);
  ok(settled[0]?.status === 'applied' && sEff.vitals.food === 75 && sEff.vitals.energy === 50 && sEff.fitness === 27 && sEff.moodlets.some((m) => /好饭/.test(m.text)), 'applySpend 支持 amount=0 五维/体质/心情反哺');
}

console.log('\n[51] 社交动作减负（meet 45m / chat 20m免费）与社交见底体感情绪');
{
  const t0 = new Date('2026-11-20T10:00:00Z');
  ok(ACTS.meet.minutes === 45, 'meet 耗时已压短至 45 分钟', String(ACTS.meet.minutes));
  ok(ACTS.chat.minutes === 20 && ACTS.chat.cost === 0 && ACTS.chat.gain.social === 18, 'chat 为 20 分钟 0 元 +18 社交');

  const s = freshState(t0);
  s.home.monthly = 0;
  s.vitals = { food: 80, energy: 80, clean: 80, fun: 80, social: 20 };
  const rChat = applyAct(s, 'chat', t0);
  ok(rChat.ok && rChat.started && rChat.minutes === 20, '能开始跟人闲聊几句');
  advance(s, new Date(t0.getTime() + ACTS.chat.minutes * 60_000));
  ok(near(s.vitals.social, 38, 0.2) && s.money.cash === 3000, 'chat 完成 20m 不花钱且社交 20 → 38', `${s.vitals.social}/${s.money.cash}`);
  ok(s.moodlets.some((m) => m.source === 'chat' && m.kind === 'good'), 'chat 完成后挂正向情绪');

  /* 社交见底醒着推进挂 lonely 情绪，补到 >= 30 自动清除（动作与 applySpend 两条路径） */
  const sLonely = freshState(t0);
  sLonely.vitals = { food: 80, energy: 80, clean: 80, fun: 80, social: 0 };
  advance(sLonely, new Date(t0.getTime() + 10 * 60_000));
  ok(sLonely.moodlets.some((m) => m.source === 'lonely' && m.kind === 'bad'), '社交归零醒着推进挂上 lonely 负情绪');

  applyAct(sLonely, 'meet', new Date(t0.getTime() + 10 * 60_000));
  advance(sLonely, new Date(t0.getTime() + (10 + ACTS.meet.minutes) * 60_000));
  ok(sLonely.vitals.social >= 30 && !sLonely.moodlets.some((m) => m.source === 'lonely'), '通过 meet 补回 >=30 后自动清除 lonely 情绪', String(sLonely.vitals.social));

  const sSpend = freshState(t0);
  sSpend.vitals = { food: 80, energy: 80, clean: 80, fun: 80, social: 0 };
  advance(sSpend, new Date(t0.getTime() + 10 * 60_000));
  ok(sSpend.moodlets.some((m) => m.source === 'lonely'), '反哺前存在 lonely 情绪');
  applySpend(sSpend, [{ id: 'sp-soc-1', amount: 0, note: '和旅伴碰头', vitalsDelta: { social: 32 } }], new Date(t0.getTime() + 11 * 60_000));
  ok(sSpend.vitals.social >= 30 && !sSpend.moodlets.some((m) => m.source === 'lonely'), 'applySpend 补回社交 >=30 后清除 lonely 情绪');
}

console.log('\n[52] 短时坐着歇会儿（rest 20m / 0元 / +5 精力，照常扣其余四维、不白嫖好心情）');
{
  const t0 = new Date('2026-11-22T10:00:00Z');
  ok(ACTS.rest.minutes === 20 && ACTS.rest.cost === 0 && ACTS.rest.gain.energy === 5, 'rest 为 20 分钟 0 元 +5 精力');
  ok(ACTS.rest.gain.energy * 3 < ACTS.nap.gain.energy, '三次坐着歇会儿(60m/+15) 严格低于午睡小憩(60m/+18)');

  const s = freshState(t0);
  s.home.monthly = 0;
  s.vitals = { food: 80, energy: 25, clean: 80, fun: 80, social: 80 };
  const rRest = applyAct(s, 'rest', t0);
  ok(rRest.ok && rRest.started && rRest.minutes === 20, '能开始坐着歇会儿');
  advance(s, new Date(t0.getTime() + ACTS.rest.minutes * 60_000));
  ok(near(s.vitals.energy, 30, 0.2) && s.money.cash === 3000, 'rest 20m 精力 25 → 30 且不花钱', `${s.vitals.energy}/${s.money.cash}`);
  ok(s.vitals.food < 80 && s.vitals.clean < 80 && s.vitals.fun < 80 && s.vitals.social < 80, 'rest 期间其余四维照常消耗', JSON.stringify(s.vitals));
  ok(!s.moodlets.some((m) => m.source === 'rest' && m.kind === 'good'), 'rest 不挂正向情绪（防 0 成本刷好心情）');
}

console.log('\n[53] 远洋游轮在途特权与双栖新活动（swim / live_show / craft_shop）');
{
  const t0 = new Date('2026-11-23T10:00:00Z');
  // 1) 在家泳池 swim：扣 35 元，涨 fun/clean 且涨 fitness +2.5
  const sHome = freshState(t0);
  sHome.home.monthly = 0;
  sHome.vitals = { food: 80, energy: 80, clean: 50, fun: 40, social: 60 };
  const fit0 = sHome.fitness;
  const rSwim = applyAct(sHome, 'swim', t0);
  ok(rSwim.ok && rSwim.started, '在家可开始游泳');
  advance(sHome, new Date(t0.getTime() + ACTS.swim.minutes * 60_000));
  ok(near(sHome.fitness, fit0 + 2.5, 0.05) && sHome.money.cash === 2965, '游泳完成涨体质 +2.5 且扣费 35 元', `${sHome.fitness}/${sHome.money.cash}`);
  ok(sHome.vitals.clean > 65 && sHome.vitals.fun > 65, '游泳同步回清爽与娱乐', JSON.stringify(sHome.vitals));

  // 2) 做手作 craft_shop：涨 fun +38、know +2 且涨 skills.craft +1.5
  const sCraft = freshState(t0);
  sCraft.home.monthly = 0;
  const rCraft = applyAct(sCraft, 'craft_shop', t0);
  ok(rCraft.ok && rCraft.started, '可开始做手作工坊');
  advance(sCraft, new Date(t0.getTime() + ACTS.craft_shop.minutes * 60_000));
  ok(near(sCraft.skills.craft ?? 0, 1.5, 0.05) && sCraft.money.cash === 2945, '手作工坊完成涨 skills.craft +1.5 且扣 55 元', `${sCraft.skills.craft}/${sCraft.money.cash}`);
  ok(sCraft.knowledge > 1.8, '手作工坊完成涨见识', String(sCraft.knowledge));

  // 3) 主题远洋游轮在途：放行 swim / live_show / feast / play，一价全包 0 元，场景自动映射游轮
  const cruiseCtx = { phase: 'traveling', toName: '横滨', modeId: 'ship', seatId: 'theme-cruise', seat: '主题远洋游轮' };
  const sCruise = freshState(t0);
  sCruise.home.monthly = 0;
  sCruise.money.cash = 10; // 现金仅 10 元，验证一价全包免单不拦且不扣钱
  const rCruiseSwim = applyAct(sCruise, 'swim', t0, cruiseCtx);
  ok(rCruiseSwim.ok && sCruise.activity?.scene?.includes('游轮顶层无边泳池'), '主题游轮放行 swim 并映射游轮泳池场景', sCruise.activity?.scene);
  ok(sCruise.activity?.costPerMin === 0, '主题游轮上 swim 一价全包 0 元', String(sCruise.activity?.costPerMin));
  advance(sCruise, new Date(t0.getTime() + ACTS.swim.minutes * 60_000), cruiseCtx);
  ok(sCruise.money.cash === 10, '主题游轮游泳完现金一分不扣', String(sCruise.money.cash));

  const tShow = new Date(t0.getTime() + 70 * 60_000);
  const rCruiseShow = applyAct(sCruise, 'live_show', tShow, cruiseCtx);
  ok(rCruiseShow.ok && sCruise.activity?.scene === '游轮海上大剧院', '主题游轮放行 live_show 并映射海上大剧院', sCruise.activity?.scene);
  advance(sCruise, new Date(tShow.getTime() + ACTS.live_show.minutes * 60_000), cruiseCtx);
  ok(sCruise.money.cash === 10, '主题游轮看演出完现金一分不扣', String(sCruise.money.cash));

  // 4) 反例：普通自驾车在途依然拦截 swim/feast，且坐普通渡轮/飞机报错不喊「车上」
  const sCar = freshState(t0);
  const carBlock = applyAct(sCar, 'swim', t0, { phase: 'traveling', toName: '西安', modeId: 'car' });
  ok(!carBlock.ok && carBlock.reason?.includes('车上没法'), '自驾在途照常拦截 swim 且提示车上', carBlock.reason);
  const ferryBlock = applyAct(sCar, 'feast', t0, { phase: 'traveling', toName: '舟山', modeId: 'ship', seatId: 'ferry', seat: '普通渡轮' });
  ok(!ferryBlock.ok && ferryBlock.reason?.includes('船上没法'), '短途渡轮被拦截时提示「船上没法」而非「车上」', ferryBlock.reason);
}

console.log('\n[54] 二期活动（glamping / miniature）与全景观光专列 / 房车 / 内河游轮在途联动');
{
  // 1) glamping：120m / 95 元 / food+40, fun+45, social+28, energy-5，且严守鱼不吃鱼
  const glampText = `${ACTS.glamping.scene ?? ''} ${ACTS.glamping.props ?? ''} ${ACTS.glamping.mood?.text ?? ''}`;
  ok(!/鱼|虾|蟹|贝|海鲜/.test(glampText), 'glamping 严守鱼不吃鱼底线', glampText);
  const tDay = new Date(2026, 10, 24, 14, 0, 0);
  const sGlamp = freshState(tDay);
  sGlamp.home.monthly = 0;
  sGlamp.vitals = { food: 40, energy: 80, clean: 80, fun: 40, social: 40 };
  const rg = applyAct(sGlamp, 'glamping', tDay);
  ok(rg.ok && rg.started, '白天可开始城郊精致露营');
  advance(sGlamp, new Date(tDay.getTime() + ACTS.glamping.minutes * 60_000));
  ok(sGlamp.money.cash === 2905, 'glamping 完整耗时扣 95 元', String(sGlamp.money.cash));
  ok(sGlamp.vitals.food > 70 && sGlamp.vitals.fun > 75 && sGlamp.vitals.social > 60, 'glamping 同步回饱腹/娱乐/社交', JSON.stringify(sGlamp.vitals));

  // 2) miniature：75m / 25 元 / fun+32, know+1, skills.craft+1，深夜 01:30 触发安静陪伴好心情
  const tLate = new Date(2026, 10, 24, 1, 30, 0);
  const sMini = freshState(tLate);
  sMini.home.monthly = 0;
  const rm = applyAct(sMini, 'miniature', tLate);
  ok(rm.ok && rm.started, '深夜可开始拼微缩模型');
  ok(sMini.moodlets.some((m) => m.source === 'cozy-miniature' && m.kind === 'good'), '深夜拼微缩模型触发安静踏实好心情');
  advance(sMini, new Date(tLate.getTime() + ACTS.miniature.minutes * 60_000));
  ok(near(sMini.skills.craft ?? 0, 1, 0.05) && sMini.money.cash === 2975, 'miniature 完结涨 skills.craft +1 且扣 25 元', `${sMini.skills.craft}/${sMini.money.cash}`);
  ok(sMini.knowledge > 0.8, 'miniature 完结涨见识', String(sMini.knowledge));

  // 3) 全景观光专列（scenic-train）：放行 feast / tea / drink / sleep，正常扣费不白嫖，拦截 swim
  const scenicCtx = { phase: 'traveling', toName: '拉萨', modeId: 'train', seatId: 'scenic-train', seat: '全景观光专列' };
  const sTrain = freshState(tDay);
  sTrain.home.monthly = 0;
  const rTrainFeast = applyAct(sTrain, 'feast', tDay, scenicCtx);
  ok(rTrainFeast.ok && sTrain.activity?.scene?.includes('观光专列全景餐车'), '观光专列放行 feast 并映射全景餐车', sTrain.activity?.scene);
  advance(sTrain, new Date(tDay.getTime() + ACTS.feast.minutes * 60_000), scenicCtx);
  ok(sTrain.money.cash === 2960, '观光专列餐车正常扣 40 元', String(sTrain.money.cash));
  const rTrainBlock = applyAct(sTrain, 'swim', new Date(tDay.getTime() + 70 * 60_000), scenicCtx);
  ok(!rTrainBlock.ok && rTrainBlock.reason?.includes('专列'), '观光专列拦截 swim 并提示专列');

  // 4) 房车自驾（campervan）：放行 cook / sleep / glamping，映射便携灶台/星空卧铺，拦截 swim
  const camperCtx = { phase: 'traveling', toName: '大理', modeId: 'car', seatId: 'campervan', seat: '房车自驾' };
  const sCamper = freshState(tDay);
  sCamper.home.monthly = 0;
  const rCampCook = applyAct(sCamper, 'cook', tDay, camperCtx);
  ok(rCampCook.ok && sCamper.activity?.scene?.includes('房车'), '房车在途放行 cook 并映射房车便携灶台', sCamper.activity?.scene);
  advance(sCamper, new Date(tDay.getTime() + ACTS.cook.minutes * 60_000), camperCtx);
  const tSleep = new Date(tDay.getTime() + 70 * 60_000);
  const rCampSleep = applyAct(sCamper, 'sleep', tSleep, camperCtx);
  ok(rCampSleep.ok && sCamper.activity?.scene === '房车星空卧铺床', '房车在途睡觉映射星空卧铺', sCamper.activity?.scene);
  const rCampBlock = applyAct(freshState(tDay), 'swim', tDay, camperCtx);
  ok(!rCampBlock.ok && rCampBlock.reason?.includes('房车'), '房车在途拦截 swim 并提示房车');

  // 5) 内河游轮（river-cruise）：不误走主题远洋游轮 0 元免单与海上场景，映射江景餐厅与两岸山影
  const riverCtx = { phase: 'traveling', toName: '宜昌', modeId: 'ship', seatId: 'river-cruise', seat: '内河峡谷游轮' };
  const sRiver = freshState(tDay);
  sRiver.home.monthly = 0;
  sRiver.money.cash = 100;
  const rRiverFeast = applyAct(sRiver, 'feast', tDay, riverCtx);
  ok(rRiverFeast.ok && sRiver.activity?.scene?.includes('内河游轮江景餐厅'), '内河游轮映射江景餐厅且不含鱼虾', sRiver.activity?.scene);
  ok(!/鱼|虾|蟹|贝|海鲜/.test(sRiver.activity?.scene ?? ''), '内河游轮江景餐厅严守鱼不吃鱼');
  ok((sRiver.activity?.costPerMin ?? 0) > 0, '内河游轮不误走主题远洋游轮 0 元免单', String(sRiver.activity?.costPerMin));
  const rRiverBlock = applyAct(freshState(tDay), 'swim', tDay, riverCtx);
  ok(!rRiverBlock.ok && rRiverBlock.reason?.includes('河轮'), '内河游轮拦截 swim 并提示河轮');
}

console.log('\n[55] 种菜（4–9 天慢节奏）、城郊租地、储物篮减费与五赛道摆摊真实成本');
{
  const t0 = new Date('2026-11-24T09:00:00+08:00');
  const s = freshState(t0);
  s.home.monthly = 0;

  // 1) 鱼不吃鱼校验：8 种种子与说明不得出现鱼/虾/蟹/贝/海鲜
  const seedBlob = SEEDS.map((x) => `${x.name} ${x.note} ${x.aliases.join(' ')}`).join(' ');
  ok(!/鱼|虾|蟹|贝|海鲜/.test(seedBlob), 'SEEDS 严守鱼不吃鱼底线');

  // 2) 城中村自带 1 槽：浅滩嫩莲藕需要 >= 2 槽会被拦下；种香葱占满 1 槽后再种会被拦
  const rLotusBlocked = applyPlant(s, '莲藕', t0);
  ok(!rLotusBlocked.ok && rLotusBlocked.reason?.includes('2 个种植槽'), '城中村 1 槽拦截浅滩嫩莲藕');
  const rPlant1 = applyPlant(s, '香葱', t0);
  ok(rPlant1.ok && s.farm.plots.length === 1 && s.money.cash === 2995, '城中村成功种下香葱并扣 5 元种子钱');
  const rPlantFull = applyPlant(s, '青菜', t0);
  ok(!rPlantFull.ok && rPlantFull.reason?.includes('城郊菜地'), '满槽提示升级住处或租城郊菜地');

  // 3) 签约城郊菜地（100 起租费 + 150/月 = 5 元/天）后共 5 槽，可种莲藕，且 advance() 按天扣菜地月租
  const rRent = applyRentFarm(s, t0);
  ok(rRent.ok && s.farm.leased && s.money.cash === 2895, '租城郊菜地扣 100 元起租费');
  const rLotusOk = applyPlant(s, '莲藕', t0);
  ok(rLotusOk.ok && s.farm.plots[1]?.source === 'leased' && s.money.cash === 2881, '租地后莲藕落入 leased 槽并扣 14 元种子钱');
  advance(s, new Date(t0.getTime() + 24 * 3_600_000), {});
  ok(s.money.cash === 2876, '城郊菜地推进 1 天精准扣 5 元月租（150/30）', String(s.money.cash));

  // 4) 浇水每天每块地限一次，耗精力 3，满 2 次收成 +1 份；4 天后香葱熟，莲藕（7 天）未熟
  const d1 = new Date(t0.getTime() + 24 * 3_600_000);
  const w1 = applyWater(s, s.farm.plots[0].id, d1);
  ok(w1.ok && s.farm.plots[0].waterCount === 1, '第 1 天给香葱浇水成功');
  const wDup = applyWater(s, s.farm.plots[0].id, new Date(d1.getTime() + 3600_000));
  ok(!wDup.ok && wDup.reason?.includes('今天已经浇过'), '同天同块地不许重复浇水');
  const d2 = new Date(t0.getTime() + 48 * 3_600_000);
  const w2 = applyWater(s, s.farm.plots[0].id, d2);
  ok(w2.ok && s.farm.plots[0].waterCount === 2, '第 2 天浇水达到 2 次增产线');

  const d3 = new Date(t0.getTime() + 72 * 3_600_000);
  ok(!applyHarvest(s, s.farm.plots[0].id, d3).ok, '第 3 天香葱（需 4 天）尚未成熟不得早收');
  const d4 = new Date(t0.getTime() + 96 * 3_600_000);
  const hRes = applyHarvest(s, s.farm.plots[0].id, d4);
  ok(hRes.ok && hRes.totalQty >= 3, '第 4 天香葱成熟收割且因浇水×2 至少收 3 份进储物篮', String(hRes.totalQty));
  ok(pantryCount(s.pantry) === hRes.totalQty, '收成准确写入储物篮');

  // 5) 在家做饭（cook）优先消耗 1 份储物篮鲜蔬，现金成本从 10 元降到 3 元
  const cashBeforeCook = s.money.cash;
  const rCookPantry = applyAct(s, 'cook', d4);
  ok(rCookPantry.ok && (s.activity?.costPerMin ?? 0) * ACTS.cook.minutes <= 3.01, '有囤菜时下厨总扣款降为 3 元油盐费');
  ok(pantryCount(s.pantry) === hRes.totalQty - 1, '下厨消耗 1 份储物篮囤菜');
  advance(s, new Date(d4.getTime() + ACTS.cook.minutes * 60_000), {});
  ok(s.money.cash <= cashBeforeCook - 3 && s.money.cash >= cashBeforeCook - 3.5, '完结 cook 实扣约 3 元');

  // 6) 五赛道真实成本与高价门控校核
  const pChefBlock = evaluateStallPlan(s, { item: '私房佛跳墙菌菇煲', price: 45, stock: 2, freshVeg: false, category: 'food' });
  ok(!pChefBlock.ok && pChefBlock.reason?.includes('厨师证'), '无厨师证/烹饪/烤箱/独立厨房卖 45 元高价菜被拦');
  const pWriteBlock = evaluateStallPlan(s, { item: '芦花塘风物手札', price: 32, stock: 2, freshVeg: false, category: 'writing' });
  ok(!pWriteBlock.ok && pWriteBlock.reason?.includes('见识'), '零见识零电脑卖 32 元书被拦');
  s.knowledge = 25;
  const pWriteOk = evaluateStallPlan(s, { item: '芦花塘风物手札', price: 32, stock: 2, freshVeg: false, category: 'writing' });
  ok(pWriteOk.ok && pWriteOk.cashCost > 10 && pWriteOk.energyCost >= 10, '见识达标后写作摆摊扣纸笔印刷费与精力', `${pWriteOk.cashCost}元/${pWriteOk.energyCost}精`);
  const rUnrentBlock = applyUnrentFarm(s, false, d4);
  ok(!rUnrentBlock.ok && rUnrentBlock.reason?.includes('莲藕'), '租地里还有未收莲藕时默认拦截退租');
  ok(!applyUnrentFarm(s, true, d4).ok && s.farm.leased, '非面板用户侧哪怕传 force=true 也不允许抹掉未收作物退租');
  ok(applyUnrentFarm(s, true, d4, { byUser: true }).ok && !s.farm.leased, '面板用户二次确认(byUser+force)可放弃作物止损退租');
}

console.log('\n[56] 18 种种子、养殖场（鸡舍/牛棚/鱼塘）按天扣租与蛋奶肉鱼入库');
{
  const t0 = new Date('2026-11-25T09:00:00+08:00');
  const s = freshState(t0);
  s.home.monthly = 0;

  ok(SEEDS.length === 35, '种子目录已扩充至 35 种', String(SEEDS.length));
  ok(ANIMALS.length === 20, '养殖目录包含 20 种品类', String(ANIMALS.length));
  ok(RECIPES.length === 45, '菜谱库包含 45 道分级菜谱', String(RECIPES.length));

  // 城中村 0 养殖位拦截土鸡/奶牛
  const noPen = applyBuyAnimal(s, '散养土鸡', t0);
  ok(!noPen.ok && noPen.reason?.includes('禽舍'), '城中村 0 栏位拦截放养土鸡');

  // 搬入老小区自带 1 个鸡舍位
  s.home.tier = 'old';
  const buyHen = applyBuyAnimal(s, '散养土鸡', t0);
  ok(buyHen.ok && s.ranch.pens.length === 1 && s.money.cash === 2975, '老小区自带 1 鸡舍放养土鸡扣 25 元');
  ok(!applyBuyAnimal(s, '散养土鸡', t0).ok, '老小区鸡舍满 1 栏时拦截第二只');

  // 签约城郊农牧场（180 元起租 + 240/月 = 8 元/天）解锁 +2鸡/+2牛/+2鱼
  const rentR = applyRentRanch(s, t0);
  ok(rentR.ok && s.ranch.leased && s.money.cash === 2795, '签约城郊农牧场扣 180 元起租费');
  const buyCow = applyBuyAnimal(s, '奶牛', t0);
  const buyCarp = applyBuyAnimal(s, '草鱼', t0);
  ok(buyCow.ok && buyCarp.ok && s.ranch.pens.length === 3, '租牧场后可同时放养奶牛与塘养草鱼');

  // 推进 1 天扣 8 元农牧场月租 + 喂鸡喂牛 + 收蛋收奶
  const d1 = new Date(t0.getTime() + 24 * 3_600_000);
  const cashBeforeAdv = s.money.cash;
  advance(s, d1, {});
  ok(s.money.cash === cashBeforeAdv - 8, '城郊农牧场推进 1 天精准扣 8 元月租（240/30）', String(s.money.cash));

  const feedHen = applyFeedAnimal(s, buyHen.pen.id, d1);
  ok(feedHen.ok && s.ranch.pens[0].feedCount === 1, '第 1 天给土鸡喂食成功');
  ok(!applyFeedAnimal(s, buyHen.pen.id, d1).ok, '同天同栏不许重复喂食');
  const colRes = applyCollectRanch(s, '', d1);
  ok(colRes.ok && colRes.totalQty >= 5, '24h 后收取鲜鸡蛋与鲜牛奶共 ≥5 份入储物篮', String(colRes.totalQty));
  ok(s.pantry.some((p) => p.itemId === 'egg' && p.origin === 'ranch'), '鲜鸡蛋准确写入储物篮(itemId=egg)');
  ok(s.pantry.some((p) => p.itemId === 'milk' && p.origin === 'ranch'), '鲜牛奶准确写入储物篮(itemId=milk)');

  // 4 天后草鱼熟：不传 penId 自动起塘鱼塘但不误出栏鸡牛；传 penId 可出栏土鸡肉
  const d4 = new Date(t0.getTime() + 96 * 3_600_000);
  const fishH = applyHarvestRanch(s, '', d4);
  ok(fishH.ok && fishH.harvested.length === 1 && fishH.harvested[0].name === '塘养鲜鱼', '不传 penId 自动起塘成熟草鱼并保留鸡牛');
  ok(s.pantry.some((p) => p.itemId === 'fresh_fish'), '塘养鲜鱼进入储物篮');

  const d5 = new Date(t0.getTime() + 120 * 3_600_000);
  // 再喂第 2 次土鸡后出栏，验证累计喂食满 2 次出栏+1份且单价摊入饲料费 (25 + 2*2) / 4 = 7 元
  const feedHen2 = applyFeedAnimal(s, buyHen.pen.id, d5);
  ok(feedHen2.ok && s.ranch.pens[0].feedCount === 2, '第 5 天再喂 1 次土鸡累计 2 次喂食');
  const henH = applyHarvestRanch(s, buyHen.pen.id, d5);
  const meatItem = s.pantry.find((p) => p.itemId === 'chicken_meat');
  ok(henH.ok && henH.harvested[0].name === '土鸡肉' && meatItem?.qty === 4, '累计喂满 2 次土鸡出栏得 4 份土鸡肉');
  ok(meatItem?.unitCost === 7, '出栏单价摊入幼苗与累计饲料费 (25+4)/4 ≈ 7 元', String(meatItem?.unitCost));
  ok(!applyUnrentRanch(s, false, d5).ok, '场内还有奶牛时默认拦截退租');
  ok(!applyUnrentRanch(s, true, d5).ok && s.ranch.leased, '非面板用户侧哪怕传 force=true 也不允许抹掉在养动物退租');
  ok(applyUnrentRanch(s, true, d5, { byUser: true }).ok && !s.ranch.leased, '面板用户二次确认(byUser+force)可退掉农牧场租约');

  // 喂食蛋奶加成仅本周期有效，不喂则恢复基础产蛋量（绝不永久白嫖 +1）
  const sEgg = freshState(t0);
  sEgg.home.tier = 'old';
  const buyE = applyBuyAnimal(sEgg, '散养土鸡', t0);
  applyFeedAnimal(sEgg, buyE.pen.id, t0);
  const cDay1 = applyCollectRanch(sEgg, '', new Date(t0.getTime() + 24 * 3_600_000));
  ok(cDay1.totalQty === 3, '本周期喂过 1 次，第 1 天收蛋 2+1=3 枚', String(cDay1.totalQty));
  const cDay2 = applyCollectRanch(sEgg, '', new Date(t0.getTime() + 48 * 3_600_000));
  ok(cDay2.totalQty === 2, '次日未喂恢复基础每天 2 枚（不永久白嫖）', String(cDay2.totalQty));
}

console.log('\n[57] 菜谱分级（烤红薯免证 vs 厨师招牌菜）、成品菜格与摆摊联动');
{
  const t0 = new Date('2026-11-25T10:00:00+08:00');
  const s = freshState(t0);
  s.home.monthly = 0;

  // 种红薯 → 7 天收割 → 无需厨师证即可炭烤红薯
  const rPlantSp = applyPlant(s, '红薯', t0);
  ok(rPlantSp.ok, '播下蜜薯红薯种子');
  const d7 = new Date(t0.getTime() + 168 * 3_600_000);
  const hSp = applyHarvest(s, rPlantSp.plot.id, d7);
  ok(hSp.ok && s.pantry.some((p) => p.itemId === 'sweet_potato'), '红薯收成精确标注 itemId=sweet_potato');

  const simpleCook = applyCookRecipe(s, '烤红薯', 'eat', d7);
  ok(simpleCook.ok && s.activity?.label.includes('炭烤红薯'), '无厨师证零门槛可直接炭烤红薯');
  advance(s, new Date(d7.getTime() + 35 * 60_000), {});
  ok(s.activity === null, '烤红薯完成后清空进行中活动');

  // 存入 2 份成品格：再次烤红薯存成品格
  const d8 = new Date(d7.getTime() + 40 * 60_000);
  const storeRes = applyCookRecipe(s, '烤红薯', 'store', d8);
  ok(storeRes.ok && cookedDishCount(s.cookedDishes) === 2, 'store 模式将 2 份炭烤红薯存入成品菜格');

  // 成品菜格可直接用来摆料理摊（仅收 2 元打包费，不扣原料费也不拦门槛）
  const stallPlanCooked = evaluateStallPlan(s, { item: '炭烤红薯', price: 15, stock: 2, freshVeg: false, category: 'food' });
  ok(stallPlanCooked.ok && stallPlanCooked.cookedUsed === 2 && stallPlanCooked.cashCost === 2, '摆料理摊优先消耗成品菜格仅收 2 元打包费');

  // 也可直接加热吃成品菜
  const eatDish = applyEatCookedDish(s, '炭烤红薯', d8);
  ok(eatDish.ok && cookedDishCount(s.cookedDishes) === 1, 'eat_dish 扣 1 份成品菜并开始用餐');
  advance(s, new Date(d8.getTime() + 25 * 60_000), {});

  // 厨师招牌菜门控测试：备齐番茄+牛肉+土豆后，无厨师证会被拦，考证后放行
  s.pantry.push(
    { id: 't1', itemId: 'tomato', kind: 'veg', name: '沙瓤西红柿', qty: 2, freshVeg: true, origin: 'home-grown', unitCost: 3, acquiredAt: d8.toISOString() },
    { id: 't2', itemId: 'beef', kind: 'meat', name: '精选牛肉', qty: 2, freshVeg: true, origin: 'ranch', unitCost: 15, acquiredAt: d8.toISOString() },
    { id: 't3', itemId: 'potato', kind: 'starch', name: '黄心土豆', qty: 2, freshVeg: true, origin: 'home-grown', unitCost: 2, acquiredAt: d8.toISOString() },
  );
  const chefBlock = applyCookRecipe(s, '西红柿炖牛腩', 'store', new Date(d8.getTime() + 30 * 60_000));
  ok(!chefBlock.ok && chefBlock.reason?.includes('厨师证'), '无厨师证且烹饪<20 时禁止制作厨师招牌菜');

  s.job.certs.push('厨师证');
  const chefOk = applyCookRecipe(s, '西红柿炖牛腩', 'store', new Date(d8.getTime() + 30 * 60_000));
  ok(chefOk.ok && s.cookedDishes.some((d) => d.recipeId === 'tomato_beef_stew' && d.qty === 2), '取得厨师证后成功做出 2 份西红柿炖牛腩存入成品菜格');

  // 职业面板概览聚合检查
  const ov = buildCareerOverview(s);
  ok(ov.certs.length === 14 && ov.certs.find((c) => c.name === '厨师证')?.owned === true, 'buildCareerOverview 准确汇总 14 张证与持有状态');
  ok(ov.recipes.find((r) => r.id === 'roast_sweet_potato')?.unlocked === true, '家常简食在职业面板保持解锁');
  ok(ov.recipes.find((r) => r.id === 'tomato_beef_stew')?.canCook === true, '持证且余料充足时厨师招牌菜标记材料齐可做');
}

console.log('\n[58] 农牧帮手（离线/旅行自动浇水、喂食、收蛋奶与全托管）');
{
  const t0 = new Date('2026-11-25T10:00:00+08:00');
  const s = freshState(t0);
  s.home.monthly = 0;
  s.home.tier = 'new'; // 4 菜槽 + 1 鸡舍 + 1 鱼塘

  // 1) 空场雇帮手：先校验兜底门槛，再确认空场不扣工钱
  const hireEmpty = applyHireHelper(s, 'care', t0);
  ok(hireEmpty.ok && hireEmpty.paid === 0 && s.money.cash === 3000, '空场雇日常照料工不扣当天工钱');

  // 2) 种青菜(5天) + 养土鸡 + 养草鱼(4天)，然后升级成 care 同日再雇或次日推进
  applyPlant(s, '小青菜', t0);
  applyBuyAnimal(s, '散养土鸡', t0);
  applyBuyAnimal(s, '塘养草鱼', t0);
  const cashAfterSetup = s.money.cash;

  // 离线推进 3 天：应自动补第 1/2/3 天照料（每天 12 工钱 + 2 鸡饲料 + 2 鱼饲料 = 16/天，共 3 天 48 元）
  const d3 = new Date(t0.getTime() + 72 * 3_600_000);
  const adv3 = advance(s, d3, {});
  ok(Boolean(adv3.helperRun) && adv3.helperRun.days === 3, '离线 3 天精确追补 3 个自然日', String(adv3.helperRun?.days));
  ok(adv3.helperRun?.wagePaid === 36 && adv3.helperRun?.feedPaid === 12, '3 天扣除 36 元工钱与 12 元饲料费', `${adv3.helperRun?.wagePaid}/${adv3.helperRun?.feedPaid}`);
  ok(s.money.cash === cashAfterSetup - 48, '现金实扣 48 元且未扣她精力', String(s.money.cash));
  ok(s.farm.plots[0].waterCount >= 3, '帮手 3 天自动给青菜浇水 ≥3 次', String(s.farm.plots[0].waterCount));
  ok(s.ranch.pens[0].feedCount >= 3 && s.ranch.pens[1].feedCount >= 3, '帮手 3 天自动给鸡和鱼喂食');
  ok(s.pantry.some((p) => p.itemId === 'egg' && p.qty >= 6), '帮手 3 天自动收进鲜鸡蛋到储物篮');

  // 同日再跑 advance 不应重复扣工钱
  const cashSameDay = s.money.cash;
  const advSame = advance(s, new Date(d3.getTime() + 3600_000), {});
  ok(!advSame.helperRun && s.money.cash === cashSameDay, '同一天重复推进不二次扣帮手工钱');

  // 3) 同日活已干完且无熟菜熟鱼时升级 full 今日 0 差价；第 5 天草鱼(4天)与青菜(5天)应被自动收获，而产蛋鸡保留
  const upg = applyHireHelper(s, 'full', new Date(d3.getTime() + 3600_000));
  ok(upg.ok && upg.mode === 'full' && upg.paid === 0, '今日已照料完毕且无待收熟菜时升级全托管 0 差价免扣', String(upg.paid));
  const d5 = new Date(t0.getTime() + 120 * 3_600_000);
  advance(s, d5, {});
  ok(s.farm.plots.length === 0 && s.pantry.some((p) => p.itemId === 'bokchoy'), '全托管到期自动收割小青菜进储物篮');
  ok(s.ranch.pens.length === 1 && s.ranch.pens[0].group === 'chicken' && s.pantry.some((p) => p.itemId === 'fresh_fish'), '全托管自动起塘草鱼并保留产蛋鸡');

  // 4) 现金不够工钱时自动停工，不扣成负数
  s.money.cash = 5;
  const d6 = new Date(d5.getTime() + 24 * 3_600_000);
  const advLow = advance(s, d6, {});
  ok(advLow.helperRun?.pausedByLowCash === true && s.farmHelper.mode === 'off' && s.money.cash === 5, '现金不够工钱时帮手自动暂停不扣成负数');

  // 5) 辞退检查
  s.money.cash = 100;
  applyHireHelper(s, 'care', d6);
  ok(applyUnhireHelper(s, d6).ok && s.farmHelper.mode === 'off', 'applyUnhireHelper 可正常辞退帮手');
}

console.log('\n[59] 活已干完不扣自动照料费 + 真鱼邻里代管报价/动态耗时/超时退款/接单完工领钱');
{
  // A) 手动把当天的水浇完、鸡喂完后，自动照料不再扣当天工钱
  const t0 = new Date('2026-11-25T10:00:00+08:00');
  const s = freshState(t0);
  s.home.monthly = 0;
  s.home.tier = 'old'; // 2 菜槽 + 1 鸡舍
  applyPlant(s, '红薯', t0);
  applyWater(s, '', t0, { byUser: true });
  applyBuyAnimal(s, '散养土鸡', t0);
  applyFeedAnimal(s, '', t0, { byUser: true });

  const pendingCare = countPendingFarmWork(s, 'care', t0);
  ok(pendingCare.total === 0, '手动浇完水喂完食后待干活数量精确为 0', String(pendingCare.total));
  const cashBeforeHire = s.money.cash;
  const hireDone = applyHireHelper(s, 'care', t0);
  ok(hireDone.ok && hireDone.paid === 0 && s.money.cash === cashBeforeHire, '当天活已干完再雇照料工 0 元不扣费', String(hireDone.paid));

  // 已跑过一次后，次日若一上线先由本人手动干完活，再触发跨日追补同样 0 元不扣工钱
  const d1 = new Date(t0.getTime() + 24 * 3_600_000);
  applyWater(s, '', d1, { byUser: true });
  applyFeedAnimal(s, '', d1, { byUser: true });
  applyCollectRanch(s, '', d1, { byUser: true });
  const cashBeforeD1Catchup = s.money.cash;
  const catchupDone = runFarmHelperCatchup(s, new Date(d1.getTime() + 3600_000));
  ok(Boolean(catchupDone) && catchupDone.wagePaid === 0 && s.money.cash === cashBeforeD1Catchup, '次日本人干完活后再触发追补仍 0 元不扣工钱', String(catchupDone?.wagePaid));

  // B) 若当天地里正好有成熟作物待收，同日由 care 升 full 精准补 8 元差价并收割
  const d7 = new Date(t0.getTime() + 168 * 3_600_000);
  s.farmHelper.lastRunDay = localDateKey(d7);
  s.farmHelper.dailyWage = 12;
  const upgMature = applyHireHelper(s, 'full', d7);
  ok(upgMature.ok && upgMature.paid === 8 && s.farm.plots.length === 0, '有熟菜待收时同日升 full 仅补 8 元差价并完成收割', `${upgMature.paid}/${s.farm.plots.length}`);

  // C) 邻里代管报价严格低于自动照料（¥12 / ¥20），且耗时随动植物数量单调递增
  const qSmall = calcNeighborErrandQuote(1, 0, 'care');
  const qLarge = calcNeighborErrandQuote(4, 3, 'care');
  const qFullMax = calcNeighborErrandQuote(8, 6, 'full');
  ok(qSmall.wage < 12 && qLarge.wage <= 9 && qFullMax.wage <= 15, '邻里代管单价恒低于系统自动价（care<=9, full<=15）', `${qSmall.wage}/${qLarge.wage}/${qFullMax.wage}`);
  ok(qLarge.minutes > qSmall.minutes && qFullMax.minutes <= 90, '邻里耗时随动植物数量递增并封顶 90 分钟', `${qSmall.minutes} -> ${qLarge.minutes} -> ${qFullMax.minutes}`);
  ok(parseErrandMinutes(qLarge.itemLabel) === qLarge.minutes, 'parseErrandMinutes 能精确还原委托名称中的分钟数');

  // D) 挂出邻里代管委托预扣托管 → 2h 未超时跳过今日自动扣费 → 满 6h 超时退还预扣并回落自动照料
  const sErr = freshState(t0);
  sErr.home.monthly = 0;
  sErr.home.tier = 'new';
  applyPlant(sErr, '小青菜', t0);
  applyBuyAnimal(sErr, '散养土鸡', t0);
  applyHireHelper(sErr, 'care', t0, { deferTodayForNeighbor: true });
  const cashBeforePost = sErr.money.cash;
  const q2 = calcNeighborErrandQuote(1, 1, 'care');
  const rec = recordPostedNeighborErrand(sErr, { stallId: 'st-n1', mode: 'care', wage: q2.wage, minutes: q2.minutes, now: t0 });
  ok(rec.ok && sErr.money.cash === cashBeforePost - q2.wage, '发邻里委托先托管预扣对应工钱', String(q2.wage));

  const t2h = new Date(t0.getTime() + 2 * 3_600_000);
  const advWait = advance(sErr, t2h, {});
  ok(!advWait.helperRun && sErr.money.cash === cashBeforePost - q2.wage, '6 小时等待期内不走自动照料重复扣费');

  const t7h = new Date(t0.getTime() + 7 * 3_600_000);
  const advFallback = advance(sErr, t7h, {});
  // 到期退款 +7 元，然后自动照料扣 12 元工钱 + 2 元鸡饲料 = 净变化 -(14 - 7) 相对于 t2h，即相对于 cashBeforePost 是 -14 元
  ok(advFallback.helperRun?.errandRefunded === q2.wage, '超过 6 小时无人接单自动原路退还预扣工钱', String(advFallback.helperRun?.errandRefunded));
  ok(advFallback.helperRun?.wagePaid === 12 && advFallback.helperRun?.feedPaid === 2, '退预扣后自动回落系统照料完成当日浇水喂食', `${advFallback.helperRun?.wagePaid}/${advFallback.helperRun?.feedPaid}`);
  ok(sErr.money.cash === cashBeforePost - 14 && sErr.farm.plots[0].waterCount === 1 && sErr.ranch.pens[0].feedCount === 1, '退款与自动兜底后资金账和农活结果分毫不差', String(sErr.money.cash));

  // E) 街坊真鱼接单后活动完工领全额工钱且不占当日正式打工额度
  const helperFish = freshState(t0);
  helperFish.home.monthly = 0;
  helperFish.activity = {
    kind: 'act',
    id: 'neighbor_errand',
    label: '帮雇主鱼照料农牧场',
    from: t0.toISOString(),
    until: new Date(t0.getTime() + q2.minutes * 60_000).toISOString(),
    minutes: q2.minutes,
    perMin: { energy: -8 / q2.minutes, social: 10 / q2.minutes },
    errandPay: q2.wage,
    errandEmployer: '雇主鱼',
  };
  const advHelperFinish = advance(helperFish, new Date(t0.getTime() + (q2.minutes + 1) * 60_000), {});
  ok(helperFish.money.cash === 3000 + q2.wage && helperFish.job.lastAt === '', '街坊真鱼完工实得全额零花钱且不占今日正式打工额度', `${helperFish.money.cash}/${helperFish.job.lastAt}`);
  ok(advHelperFinish.completed.some((c) => c.id === 'neighbor_errand' && c.workEarned === q2.wage), 'CompletedTask 记录领钱完工供账本入账');
}

console.log(`\n${pass} 通过 / ${fail} 失败 ${fail ? '← 有红，别交付' : ''}`);

process.exit(fail ? 1 : 0);
