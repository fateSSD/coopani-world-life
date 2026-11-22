/**
 * `lowText()` 是「她感觉到缺」那一刻递过去的话（2026-11-17）。
 *
 * ## 守什么
 *
 * Mr.Q 观察到的现象：**吃饭会自动做，社交一直拖着**。根子不在一处，而在 `lowText`：
 *
 * | 条 | 提示里给的建议 | 有退路 |
 * |---|---|---|
 * | 饱腹 | 三档全给，含「实在没钱就随便吃点，回 15」 | ✅ |
 * | 精力 | 睡一觉回 80，**不花钱** | ✅ |
 * | 清爽 | 洗个澡回 55，**不花钱** | ✅ |
 * | 娱乐 | 只有「找点乐子 22 元」 | ❌ |
 * | 社交 | 只有「跟人说说话 30 元」 | ❌ |
 *
 * 有退路的那两条她敢做，没有的那两条只能拖 —— 因为提示递过来的时候，
 * 等于在告诉她「你现在补不起」。
 *
 * ## 为什么用读源码的方式断言
 *
 * `lowText` 是 private，构造 World 实例来测它的成本远高于这一条的价值。
 * 而且这里要守的正是**文案本身**：改了 ACCTS 的数值忘了改文案，是这批里真实发生过的
 * （`play` 的 fun 实际 39，文案写的 38；`meet` 的 social 实际 31，文案写的 30）——
 * 源头注释自己写着「文案不许跑得比实现快」，然后跑快了两次。
 *
 * 所以这里读 `src/` 的原文，直接看那两句长什么样。**它不是行为测试，是文案守卫。**
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worldSrc = readFileSync(new URL('../src/world.ts', import.meta.url), 'utf8');
const stateSrc = readFileSync(new URL('../src/state.ts', import.meta.url), 'utf8');

/** 取 `case 'xxx':` 到下一个 `case` 之间的那段。 */
function caseOf(key) {
  const start = worldSrc.indexOf(`case '${key}':`);
  assert.ok(start > 0, `lowText 里找不到 case '${key}'`);
  const rest = worldSrc.slice(start + 10);
  const end = rest.indexOf('case ');
  return end > 0 ? rest.slice(0, end) : rest;
}

/** 取某个动作在 ACTS 里的某一维数值。 */
function actValue(act, key) {
  const at = stateSrc.indexOf(`mkAct('${act}'`);
  assert.ok(at > 0, `ACTS 里找不到 ${act}`);
  const body = stateSrc.slice(at, at + 400);
  const m = body.match(new RegExp(`${key}:\\s*(-?\\d+)`));
  assert.ok(m, `${act} 里找不到 ${key}`);
  return Number(m[1]);
}

test('娱乐的提示必须给一条不花钱的路', () => {
  const c = caseOf('fun');
  assert.match(c, /看会儿书|study/, `娱乐提示里没有免费路：${c.slice(0, 120)}`);
  assert.match(c, /不花钱|不想花钱|不要钱/, '说了免费动作，但没说「不花钱」');
});

test('社交的提示必须给两条免费路', () => {
  const c = caseOf('social');
  assert.match(c, /早市|market/, '社交提示里没提逛早市');
  assert.match(c, /滨河|pond/, '社交提示里没提滨河散步');
  assert.match(c, /不花钱|不想花钱|不要钱/);
});

test('饱腹那条的「没钱退路」不能丢', () => {
  /* 这条是原本就写对的，留着当参照 —— 别的条要是忘了，它就是模板。 */
  const c = caseOf('food');
  assert.match(c, /没钱|随便吃点|instant/, '饱腹提示里没有退路档');
});

test('提示里的数字和 ACTS 对得上（文案不许跑得比实现快）', () => {
  /* 这两条都真的跑快过，所以逐个钉。 */
  assert.equal(actValue('play', 'fun'), 39);
  assert.match(caseOf('fun'), /回 39/, '`play` 的 fun 是 39，文案写的不是 39');

  assert.equal(actValue('meet', 'social'), 31);
  assert.match(caseOf('social'), /回 31/, '`meet` 的 social 是 31，文案写的不是 31');

  assert.equal(actValue('chat', 'social'), 18);
  assert.match(caseOf('social'), /回 18/, '`chat` 的 social 是 18，文案写的不是 18');
  assert.match(caseOf('social'), /chat|闲聊/, '社交提示里必须给出 chat 闲聊轻路径');

  assert.equal(actValue('wash', 'clean'), 55);
  assert.match(caseOf('clean'), /回 55/);

  assert.equal(actValue('rest', 'energy'), 5);
  assert.match(caseOf('energy'), /rest|坐着歇/);
  assert.match(caseOf('energy'), /回 5/);
  assert.equal(actValue('nap', 'energy'), 18);
  assert.match(caseOf('energy'), /回 18/);
  assert.match(caseOf('energy'), /回 80/);
});
