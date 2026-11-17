/**
 * 住房目标必须指向「当前档位的**上一档**」（2026-11-17，Mr.Q 抓到）。
 *
 * ## 现场
 *
 * 面板上写着「攒够 2400，搬到老小区」，而她**已经住进老小区了**。
 *
 * 根因不是算错，是**没人去重算**：`fallbackGoal()` 只在 `goals` 为空时才跑。
 * 她一开局在城中村立下的「搬到老小区」，搬完家还留在存档里 ——
 * 目标从此指向一个已经完成的事，攒钱这件事就没有下一个由头了。
 *
 * ## 这条守什么
 *
 * 1. 住房目标指向**当前或更低**档位时，作废重算（重算出来是上一档）；
 * 2. 已经指向更高档的，原样保留（那是她自己或用户立的，别覆盖）；
 * 3. 住到最高档（别墅区）时不再立住房目标 —— 没得搬了，立了就是个永远做不完的条；
 * 4. 非住房类的目标一律不碰。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { normalize, freshState, TIER_ORDER } = await import('../src/state.ts');

const NOW = new Date('2026-11-17T12:00:00Z');

/** 造一个「已经住在某档、手上挂着某条住房目标」的存档。 */
function withGoal(tier, goalTier) {
  const base = freshState(NOW);
  return {
    ...base,
    home: { ...base.home, tier },
    goals: [{
      id: `g-home-${goalTier}`,
      what: `攒够 2400，搬到${goalTier}`,
      need: 2400,
      since: NOW.toISOString(),
    }],
  };
}

const goalTiers = (st) => st.goals
  .map((g) => g.id)
  .filter((id) => id.startsWith('g-home-'))
  .map((id) => id.slice('g-home-'.length));

test('已经住进老小区，目标不能再写「搬到老小区」', () => {
  const st = normalize(withGoal('old', 'old'), NOW);
  assert.deepEqual(goalTiers(st), ['new'], `目标还是指向了 ${goalTiers(st)}`);
});

test('住在城中村、目标是老小区 —— 这是对的，别动它', () => {
  const st = normalize(withGoal('urban-village', 'old'), NOW);
  assert.deepEqual(goalTiers(st), ['old']);
});

test('目标指向更低档（存档被改过）也要重算', () => {
  const st = normalize(withGoal('new', 'old'), NOW);
  assert.deepEqual(goalTiers(st), ['villa'], '住在新区却挂着「搬到老小区」');
});

test('目标已经指向更高档时保留原样', () => {
  const st = normalize(withGoal('old', 'villa'), NOW);
  assert.deepEqual(goalTiers(st), ['villa'], '把人家自己立的更高目标改掉了');
});

test('住到别墅区就不再立住房目标', () => {
  const st = normalize(withGoal('villa', 'villa'), NOW);
  assert.deepEqual(goalTiers(st), [], '已经是最高档，还在挂「攒够搬走」');
});

test('非住房的目标不碰', () => {
  const base = freshState(NOW);
  const st = normalize({
    ...base,
    home: { ...base.home, tier: 'old' },
    goals: [
      { id: 'g-home-old', what: '攒够 2400，搬到老小区', need: 2400, since: NOW.toISOString() },
      { id: 'w-camera', what: '买台相机', need: 3000, since: NOW.toISOString() },
    ],
  }, NOW);
  assert.ok(st.goals.some((g) => g.id === 'w-camera'), '把她的别的愿望删了');
  assert.deepEqual(goalTiers(st), ['new']);
});

test('档位顺序本身没被改坏', () => {
  /* 上面所有断言都建立在「老 -> 新 -> 别墅」这个顺序上。 */
  assert.deepEqual([...TIER_ORDER], ['urban-village', 'old', 'new', 'villa']);
});
