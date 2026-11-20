/**
 * 离线过夜：她关了机，那一夜算不算她睡过。
 *
 * ## 这条守的是哪个数
 *
 * 2026-11-20 Mr.Q：公司电脑上的桌宠，「昨天我回家了之后她应该也是自己吃饭睡觉才对，
 * 可精力没恢复」。截图上精力 28。
 *
 * 跑一遍旧逻辑就是这个数：17 点关机 → 次日 9 点开机 = 15.7 小时醒着，
 * `100 − 4.6 × 15.7 ≈ 26.4`。而旧规则只在「醒着满 24 小时」时才补一次睡 ——
 * 上班族的日子永远够不着，于是她的精力周一到周五只降不升。
 *
 * 现在按夜算：跨过一夜（本地 23:00–07:00，至少盖住 4 小时）就当她睡过，精力回到 85。
 *
 * ## ⚠ 时间一律用本地构造，不写 `...Z`
 *
 * 第一版用 `Date.parse('2026-11-19T09:00:00.000Z')` 当「本地 17:00」—— 那是把 UTC+8
 * 硬写进测试了。`offlineNightHours` 读的是 `getHours()`（本地时区），换台机器（`TZ=UTC`）
 * 四条直接挂，而代码是对的、挂的是测试。
 *
 * **判据：被测函数读本地时区，测试就必须用本地构造。**`new Date(2026, 10, 19, 17)` 在任何
 * 时区下都是「那台机器的下午五点」，这才是这条测试想说的事。
 *
 * 跑法（扩展目录里没有 node_modules，用宿主那份 tsx）：
 *   node "<Coopani>/resources/app/node_modules/tsx/dist/cli.mjs" test/offline-night.test.mjs
 * 换时区复跑：`TZ=UTC node ...` 与 `TZ=America/New_York node ...` 都必须全绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { advance, freshState, offlineNightHours, DECAY_PER_HOUR, SLEEP_ENERGY_PER_HOUR } = await import('../src/state.ts');

/** 本地时刻。月份从 1 数，省得每次减一。 */
const L = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);

/** 造一个「上次存档在 hours 小时前、精力 = energy」的她；`sleep` 给了就是睡着被关机。 */
function stale(hoursAgo, now, { energy = 100, food = 100, sleep = null } = {}) {
  const s = freshState(now);
  s.updatedAt = new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
  s.vitals.energy = energy;
  s.vitals.food = food;
  s.asleepFrom = sleep ? sleep[0].toISOString() : '';
  s.asleepUntil = sleep ? sleep[1].toISOString() : '';
  s.activity = null;
  return s;
}

/* ---------------- 纯函数：数夜 ---------------- */

test('offlineNightHours：本地一晚（17:00 → 次日 09:00）算满一夜', () => {
  const h = offlineNightHours(L(2026, 11, 19, 17).getTime(), L(2026, 11, 20, 9).getTime());
  assert.equal(h, 8, `这一夜的 23:00–07:00 是整 8 小时，算出来是 ${h}`);
});

test('offlineNightHours：白天整天（09:00 → 17:00）一夜都没有', () => {
  assert.equal(offlineNightHours(L(2026, 11, 20, 9).getTime(), L(2026, 11, 20, 17).getTime()), 0);
});

test('offlineNightHours：晚上 11 点关、凌晨 1 点开，不算睡过', () => {
  /* 只盖住 23:00–01:00 两小时 —— 那是他回来得晚，不是她睡了一觉。 */
  assert.equal(offlineNightHours(L(2026, 11, 19, 23).getTime(), L(2026, 11, 20, 1).getTime()), 0);
});

test('offlineNightHours：挖掉已结算的睡眠段，同一夜不数两遍', () => {
  /*
   * 整段是 22:00 → 次日 22:00，看着盖满一夜；但 23:00–07:00 她真的睡着，
   * 那一段在 `advance()` 里已经结算过精力。`skip` 挖掉之后应当剩 0。
   */
  const from = L(2026, 11, 19, 22).getTime();
  const to = L(2026, 11, 20, 22).getTime();
  assert.equal(offlineNightHours(from, to), 8, '不挖的话这夜是满的');
  assert.equal(
    offlineNightHours(from, to, { skip: { from: L(2026, 11, 19, 23).getTime(), to: L(2026, 11, 20, 7).getTime() } }),
    0,
    '挖掉睡眠段之后不该还算她睡过',
  );
});

test('offlineNightHours：有睡眠记录时只认整夜，6 小时不算', () => {
  /* 01:00 醒着熬到 09:00 盖住 6 小时 —— 那是「醒着熬到天亮」，不是「睡过」。 */
  const from = L(2026, 11, 19, 22).getTime();
  const to = L(2026, 11, 20, 9).getTime();
  assert.equal(
    offlineNightHours(from, to, { skip: { from: L(2026, 11, 19, 23).getTime(), to: L(2026, 11, 20, 1).getTime() }, fullNightOnly: true }),
    0,
    '缺了 23:00–01:00 的两小时，这一夜就不成立',
  );
});

/* ---------------- 真正的症状 ---------------- */

test('工作日一晚：精力不该从 100 掉到 28', () => {
  const now = L(2026, 11, 20, 9);
  const s = stale(16, now);   // 昨天 17:00 关机，没有睡眠记录
  advance(s, now);
  assert.ok(s.vitals.energy >= 85, `跨过了一夜，精力应当回到 85 以上，实际 ${s.vitals.energy}`);
});

test('白天离开一整天：不许白拿补睡，该多低就多低', () => {
  /*
   * 反例条款。判据不能宽到「只要离线就补」——那样白天旷工也算睡过了，
   * 「睡前该吃点东西」「熬夜有代价」这些规则会一起塌。
   */
  const now = L(2026, 11, 20, 17);
  const s = stale(8, now);    // 本地 09:00 起离开
  advance(s, now);
  const want = 100 - DECAY_PER_HOUR.energy * 8;
  assert.ok(Math.abs(s.vitals.energy - want) < 0.01,
    `白天 8 小时不该有补睡，按纯衰减应是 ${want}，实际 ${s.vitals.energy}`);
});

test('饿醒之后硬熬到天亮：不许补回 85', () => {
  /*
   * 22:00 关机（饱腹 22、精力 40），23:00 睡下，01:00 前饿醒，然后醒着熬到 09:00。
   *
   * 修复前这里是 85 —— 「跨过一夜」把那一夜算成她睡过，**饿醒的惩罚直接归零**。
   * 可她明明已经醒了，之后每一小时都是清醒的代价。
   */
  const now = L(2026, 11, 20, 9);
  const s = stale(11, now, {
    energy: 40, food: 22,
    sleep: [L(2026, 11, 19, 23), L(2026, 11, 20, 7)],
  });
  const r = advance(s, now);
  assert.equal(r.woke?.reason, 'hungry', `这一觉应当以饿醒结束：${r.woke?.reason}`);
  assert.ok(s.vitals.energy < 30,
    `饿醒后硬熬 8 小时不该还有精力，实际 ${s.vitals.energy}`);
});

test('短睡 2.5 小时再熬一天：不许补回 85', () => {
  const now = L(2026, 11, 20, 15);
  const s = stale(17, now, {
    energy: 60, food: 90,
    sleep: [L(2026, 11, 19, 23), L(2026, 11, 20, 1, 30)],
  });
  const r = advance(s, now);
  assert.equal(r.sleptHours.toFixed(2), '2.50', `只睡了 2.5 小时：${r.sleptHours}`);
  assert.ok(s.vitals.energy < 40, `短睡之后熬 13.5 小时，精力该掉了：${s.vitals.energy}`);
});

test('睡满 8 小时后白天醒着：只按睡眠那 8 小时回，不再额外补', () => {
  /*
   * 这条要的是「不重复领取」，不是「精力必须低」。
   *
   * 睡 8 小时本身回 `SLEEP_ENERGY_PER_HOUR × 8`，起点 40 的话已经到顶 ——
   * 所以判据只能用**起点低到不会封顶**的构造，比对「睡眠恢复 − 白天衰减」的净值。
   * 补睡一旦重复触发，结果会卡在 >= 85，这条就会红。
   */
  const now = L(2026, 11, 20, 22);
  const s = stale(24, now, {
    energy: 40, food: 90,
    sleep: [L(2026, 11, 19, 23), L(2026, 11, 20, 7)],
  });
  const r = advance(s, now);
  const want = Math.min(100, Math.max(0, 40 + SLEEP_ENERGY_PER_HOUR * 8 - DECAY_PER_HOUR.energy * (24 - 8)));
  assert.ok(Math.abs(s.vitals.energy - want) < 0.01,
    `应只按睡眠 8h 回、白天 16h 掉，净值 ${want}，实际 ${s.vitals.energy}（slept=${r.sleptHours}）`);
});

test('真的睡着被关机：走显式睡眠那条路，不领第二份', () => {
  const now = L(2026, 11, 20, 9);
  const s = stale(9, now, {
    energy: 55,
    sleep: [L(2026, 11, 20, 0), L(2026, 11, 20, 8)],
  });
  advance(s, now);
  assert.ok(s.vitals.energy >= 85, `睡过一觉还被扣着，实际 ${s.vitals.energy}`);
});

test('离线三天的老规矩不变：回来还是 85', () => {
  /* 旧断言（smoke.mjs）是 85，改判据不能把它顺手改掉。 */
  const now = L(2026, 11, 20, 9);
  const s = stale(72, now);
  advance(s, now);
  assert.equal(s.vitals.energy, 85);
});

test('睡前在睡、关机三天：后面还有完整夜，照样补', () => {
  /* 挖掉睡眠段不等于「有睡眠记录就永远不补」—— 之后跨过的整夜仍然算。 */
  const now = L(2026, 11, 23, 9);
  const s = stale(72, now, {
    energy: 40, food: 90,
    sleep: [L(2026, 11, 20, 23), L(2026, 11, 21, 7)],
  });
  advance(s, now);
  assert.ok(s.vitals.energy >= 85, `后面两天各有一整夜，应当补回来，实际 ${s.vitals.energy}`);
});
