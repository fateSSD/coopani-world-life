import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SEEDS, inferIngredientId, applyPlant, applyWater, applyHarvest, pantryCount, evaluateStallPlan } from '../src/farm.ts';
import {
  ANIMALS, ANIMAL_GROUP_LABEL, RANCH_LEASE_SLOTS,
  applyBuyAnimal, applyFeedAnimal, applyCollectRanch, applyHarvestRanch, applyRentRanch,
} from '../src/ranch.ts';
import {
  RECIPES, WORKBENCH_RECIPES, evaluateRecipe, applyCookRecipe,
  evaluateAllWorkbenchRecipes, applyWorkbenchCraft, buildCareerOverview,
} from '../src/recipes.ts';
import { JOBS, CERTS, findJob, normalizeCityName, jobAllowedAt } from '../src/jobs.ts';
import {
  EQUIP_MAINTAIN, equipMaintainName, jobMaintainKey,
  CITY_SPECIALTIES, specialtiesForCity, streetWindowOf, marketCatalogOf,
} from '../src/town-life.ts';
import {
  freshState, advance, applyAct, applyWork, applyCert, jobGate,
  applyMaintainEquip, applyBuySpecialty, applyUseSpecialty, readLedger,
} from '../src/state.ts';
import { LifeWorld } from '../src/world.ts';
import { LIFE_DEFAULTS } from '../src/config.ts';

test('植物与动物扩充：35 种无鱼字种子、20 种养殖温和收成与池塘蚌类护栏', () => {
  assert.equal(SEEDS.length, 35, 'SEEDS 应扩充到 35 种');
  for (const sd of SEEDS) {
    const txt = `${sd.name}${sd.note}${sd.aliases.join('')}${sd.dishHints.join('')}`;
    assert.doesNotMatch(txt, /鱼|虾|蟹|贝|蚌|海鲜/);
  }
  assert.ok(SEEDS.some((s) => s.id === 'blueberry' && s.category === 'fruit'));
  assert.ok(SEEDS.some((s) => s.id === 'chamomile' && s.category === 'herb'));
  assert.equal(inferIngredientId('细软兔绒').itemId, 'rabbit_fur');
  assert.equal(inferIngredientId('天然蜂蜡').itemId, 'beeswax');

  const t0 = new Date('2026-11-28T09:00:00+08:00');
  const s = freshState(t0);
  s.home.monthly = 0;
  s.home.tier = 'old';
  const plBlue = applyPlant(s, 'blueberry', t0);
  const plCham = applyPlant(s, 'chamomile', t0);
  assert.equal(plBlue.ok && plCham.ok, true);
  const d8 = new Date(t0.getTime() + 8 * 86_400_000);
  const hv = applyHarvest(s, '', d8);
  assert.equal(hv.ok, true);
  assert.ok(s.pantry.some((p) => p.itemId === 'blueberry'));
  assert.ok(s.pantry.some((p) => p.itemId === 'chamomile'));

  assert.equal(ANIMALS.length, 20, 'ANIMALS 应扩充到 20 种');
  assert.deepEqual(ANIMAL_GROUP_LABEL, { chicken: '禽舍', cow: '畜棚', fish: '鱼塘' });
  assert.deepEqual(RANCH_LEASE_SLOTS, { chicken: 3, cow: 3, fish: 3 });
  for (const a of ANIMALS) {
    assert.doesNotMatch(`${a.name}${a.harvestProductName}${a.note}`, /屠|宰|杀|剥皮|放血/);
  }

  // 签约城郊农牧场 -> +3/+3/+3；测试 pond_mussel (cycleHours=48 > 0) 不被空 penId 自动起塘收走
  const rentRes = applyRentRanch(s, t0);
  assert.equal(rentRes.ok, true);
  assert.ok(s.tellable.some((t) => t.text.includes('3')), '租约记忆应体现 +3 栏位');
  const buyMussel = applyBuyAnimal(s, 'pond_mussel', t0);
  const buyShrimp = applyBuyAnimal(s, 'river_shrimp', t0);
  const buyGoat = applyBuyAnimal(s, 'dairy_goat', t0);
  assert.equal(buyMussel.ok && buyShrimp.ok && buyGoat.ok, true);

  // 验证喂食 fish 优先扣除 pantry 里的 fish_bait
  s.pantry.push({
    itemId: 'fish_bait',
    name: '自制复合鱼饵',
    qty: 2,
    freshVeg: false,
    origin: 'home-grown',
    unitCost: 2,
    ingredientKind: 'craft_mat',
    acquiredAt: t0.toISOString(),
  });
  const cashBeforeFeed = s.money.cash;
  const feedRes = applyFeedAnimal(s, buyShrimp.pen.id, t0);
  assert.equal(feedRes.ok, true);
  assert.equal(s.pantry.find((p) => p.itemId === 'fish_bait')?.qty, 1, '投喂鱼塘应优先消耗自制鱼饵');
  assert.equal(s.money.cash, cashBeforeFeed, '消耗自制鱼饵时应免现金饲料费');

  // 10 天后：自动起塘应只收浅塘青虾 (cycleHours=0)，保留育珠蚌 (cycleHours=48) 与奶山羊
  const d10 = new Date(t0.getTime() + 10 * 86_400_000);
  const autoH = applyHarvestRanch(s, '', d10);
  assert.equal(autoH.ok, true);
  assert.equal(autoH.harvested.length, 1);
  assert.equal(autoH.harvested[0].name, '鲜青虾');
  assert.ok(s.pantry.some((p) => p.itemId === 'river_shrimp'));
  assert.ok(s.ranch.pens.some((p) => p.animalId === 'pond_mussel'), '持续产珍珠的育珠蚌不可被无参自动起塘收走');

  // 指定奶山羊合作社冷链车队换购：无血腥文案
  const goatH = applyHarvestRanch(s, buyGoat.pen.id, d10);
  assert.equal(goatH.ok, true);
  assert.match(goatH.messages?.join('') ?? '', /冷链|合作社/);
  assert.doesNotMatch(goatH.messages?.join('') ?? '', /屠|宰|杀/);
  const colRes = applyCollectRanch(s, buyMussel.pen.id, d10);
  assert.equal(colRes.ok, true);
  assert.ok(s.pantry.some((p) => p.itemId === 'pearl'));
});

test('三档 45 道菜谱与五大工作台 20 项配方：宴席门槛、制作闭环与 CareerOverview 透出', () => {
  assert.equal(RECIPES.length, 45, 'RECIPES 应扩充至 45 道');
  assert.equal(WORKBENCH_RECIPES.length, 20, 'WORKBENCH_RECIPES 应包含 20 项');
  const stations = new Set(WORKBENCH_RECIPES.map((w) => w.station));
  assert.deepEqual([...stations].sort(), ['agro', 'book', 'photo', 'tea', 'weave']);

  const t0 = new Date('2026-11-28T10:00:00+08:00');
  const s = freshState(t0);
  s.home.monthly = 0;
  s.pantry.push(
    { itemId: 'mutton', name: '冷鲜精选羊肉', qty: 3, freshVeg: false, origin: 'ranch', unitCost: 22, ingredientKind: 'meat', acquiredAt: t0.toISOString() },
    { itemId: 'cabbage', name: '黄心大白菜', qty: 2, freshVeg: true, origin: 'home-grown', unitCost: 3, ingredientKind: 'veg', acquiredAt: t0.toISOString() },
    { itemId: 'radish', name: '水润白萝卜', qty: 2, freshVeg: true, origin: 'home-grown', unitCost: 3, ingredientKind: 'veg', acquiredAt: t0.toISOString() },
    { itemId: 'scallion', name: '香葱与罗勒', qty: 3, freshVeg: true, origin: 'home-grown', unitCost: 2, ingredientKind: 'herb', acquiredAt: t0.toISOString() },
    { itemId: 'mint', name: '清凉薄荷', qty: 2, freshVeg: true, origin: 'home-grown', unitCost: 4, ingredientKind: 'herb', acquiredAt: t0.toISOString() },
    { itemId: 'chamomile', name: '洋甘菊与桂花', qty: 2, freshVeg: true, origin: 'home-grown', unitCost: 5, ingredientKind: 'herb', acquiredAt: t0.toISOString() },
    { itemId: 'corn', name: '水果甜玉米', qty: 2, freshVeg: true, origin: 'home-grown', unitCost: 3, ingredientKind: 'starch', acquiredAt: t0.toISOString() },
    { itemId: 'soybean', name: '金粒黄豆', qty: 2, freshVeg: true, origin: 'home-grown', unitCost: 3, ingredientKind: 'veg', acquiredAt: t0.toISOString() },
  );

  // feast 档需厨师证且烹饪 >= 40
  const feastRec = RECIPES.find((r) => r.tier === 'feast' && r.id === 'lz_hand_mutton');
  assert.ok(feastRec, '应存在椒盐手抓羔羊肉宴席菜谱');
  assert.equal(evaluateRecipe(s, feastRec).unlocked, false);
  s.job.certs.push('厨师证');
  s.skills.cooking = 42;
  const evalOk = evaluateRecipe(s, feastRec);
  assert.equal(evalOk.unlocked && evalOk.canCook, true);
  const cookFeast = applyCookRecipe(s, feastRec.id, 'store', t0);
  assert.equal(cookFeast.ok, true);
  assert.ok(s.cookedDishes.some((d) => d.recipeId === 'lz_hand_mutton' && d.qty === 2));

  // 工作台：wb_calm_tea (store) 与 wb_fish_bait (use -> 自制复合鱼饵进储物篮)
  const wbEvalBefore = evaluateAllWorkbenchRecipes(s);
  assert.equal(wbEvalBefore.length, 20);
  s.skills.cooking = 20;
  s.vitals.energy = 80;
  const craftTea = applyWorkbenchCraft(s, 'wb_calm_tea', 'store', t0);
  assert.equal(craftTea.ok, true, craftTea.reason);
  assert.ok(s.workOutputs.some((w) => w.name === '薄荷洋甘菊安神茶包'));

  const craftBait = applyWorkbenchCraft(s, 'wb_fish_bait', 'use', t0);
  assert.equal(craftBait.ok, true, craftBait.reason);
  assert.ok(s.pantry.some((p) => p.itemId === 'fish_bait'), '农牧自制台 use 模式制作复合鱼饵应写入储物篮');

  const ov = buildCareerOverview(s, t0, { currentCity: '兰州' });
  assert.equal(ov.workbench.length, 20);
  assert.equal(ov.recipes.length, 45);
});

test('69 项职业城市限定 + 四维工作成本 + 30 天证书轻续期费', () => {
  assert.equal(JOBS.length, 69, 'JOBS 应扩充至 69 项');

  const lzJob = findJob('lz_noodle_puller');
  const bjJob = findJob('bj_hutong_walk');
  assert.ok(lzJob && bjJob, '应同时存在兰州限定与北京限定岗位');

  assert.equal(normalizeCityName('北京市'), '北京');
  assert.equal(normalizeCityName('兰州市'), '兰州');
  assert.equal(jobAllowedAt(lzJob, 'home', '兰州市'), true);
  assert.equal(jobAllowedAt(lzJob, 'staying', '北京市'), false);
  assert.equal(jobAllowedAt(bjJob, 'staying', '北京市'), true);
  assert.equal(jobAllowedAt(bjJob, 'home', '兰州'), false);
  assert.equal(jobAllowedAt(bjJob, 'traveling', '北京'), false);

  const t0 = new Date('2026-11-28T08:00:00+08:00');
  const s = freshState(t0);
  s.home.monthly = 0;
  s.job.days = 50;
  s.job.certs = CERTS.map((c) => c.name);
  s.knowledge = 85;
  s.gear = ['camera', 'oven', 'sewing', 'computer', 'folding_bike', 'ebike', 'garden_kit'];
  s.vitals = { food: 95, energy: 95, clean: 95, fun: 95, social: 95 };

  // 城市不匹配时直接拒绝且不扣耗材
  const cashStart = s.money.cash;
  const wrongCity = applyWork(s, bjJob.id, t0, 'home', undefined, '兰州');
  assert.equal(wrongCity.ok, false);
  assert.equal(s.money.cash, cashStart);

  // 维度 3：fitnessGain（非 PHYSICAL_JOB_IDS 的 apiary_helper）与 streakTag（连续多日同类劳作提醒）
  const fitBefore = s.fitness;
  const wApiary = applyWork(s, 'apiary_helper', t0, 'home', undefined, '兰州');
  assert.equal(wApiary.ok, true);
  advance(s, new Date(t0.getTime() + (wApiary.minutes ?? 270) * 60_000), { gradeRoll: 0.6 });
  assert.ok(s.fitness > fitBefore, '带 fitnessGain 的农艺职业完工应提升体质');
  // 次日连续干重体力活（无需人为清 lastAt）应触发已连续 2 天提醒
  s.vitals = { food: 95, energy: 95, clean: 95, fun: 95, social: 95 };
  const tNextDay = new Date(t0.getTime() + 86_400_000);
  const wPorter = applyWork(s, 'porter', tNextDay, 'home', undefined, '兰州');
  assert.equal(wPorter.ok, true);
  const advStreak = advance(s, new Date(tNextDay.getTime() + (wPorter.minutes ?? 240) * 60_000));
  assert.match(advStreak.completed[0]?.streakNotice ?? '', /已连续 2 天干重体力活/);
  // 跳过一天后重置为 1
  const tSkipDay = new Date(tNextDay.getTime() + 2 * 86_400_000);
  s.vitals = { food: 95, energy: 95, clean: 95, fun: 95, social: 95 };
  const wPorterSkip = applyWork(s, 'porter', tSkipDay, 'home', undefined, '兰州');
  assert.equal(wPorterSkip.ok, true);
  advance(s, new Date(tSkipDay.getTime() + (wPorterSkip.minutes ?? 240) * 60_000));
  assert.equal(s.jobStreak?.labor, 1, '断档一天应重置连续天数计数');

  // 维度 2：装备阶梯维护（以 darkroom_print + camera 为例：every=10, cost=40）
  const camRule = EQUIP_MAINTAIN.camera;
  assert.ok(camRule);
  assert.equal(jobMaintainKey('darkroom_print', 'camera'), 'camera');
  assert.equal(equipMaintainName('camera'), '二手胶片微单');

  let curT = new Date('2026-12-05T09:00:00+08:00');
  for (let i = 0; i < camRule.every - 1; i++) {
    s.vitals = { food: 95, energy: 95, clean: 95, fun: 95, social: 95 };
    s.money.cash = 1000;
    const w = applyWork(s, 'darkroom_print', curT, 'home', undefined, '兰州');
    assert.equal(w.ok, true, `第 ${i + 1} 次应可接暗房胶片冲印`);
    const adv = advance(s, new Date(curT.getTime() + (w.minutes ?? 300) * 60_000), { gradeRoll: 0.6 });
    if (i === camRule.every - 2) {
      assert.match(adv.completed[0]?.maintainNotice ?? '', /再用 1 次/);
    }
    curT = new Date(curT.getTime() + 86_400_000);
  }
  // 第 every 次且现金不足保养费(40) -> 收工砸锅 earned=0 使 cash=8 < 40，触发待保养锁定
  s.vitals = { food: 95, energy: 95, clean: 95, fun: 95, social: 95 };
  s.money.cash = 20; // materialCost=12 -> 剩余 8
  const wCrit = applyWork(s, 'darkroom_print', curT, 'home', undefined, '兰州');
  assert.equal(wCrit.ok, true);
  assert.equal(s.money.cash, 8);
  const advCrit = advance(s, new Date(curT.getTime() + (wCrit.minutes ?? 300) * 60_000), { gradeRoll: 0.0 });
  assert.equal(advCrit.completed[0]?.workEarned, 0, '砸锅且有耗材垫付时应血本无归');
  assert.ok(s.equipPendingMaintain?.includes('camera'), '现金不足保养费时 camera 应记入待保养');

  const nextDay = new Date(curT.getTime() + 86_400_000);
  s.vitals = { food: 95, energy: 95, clean: 95, fun: 95, social: 95 };
  s.money.cash = 100;
  const blockedByMaint = applyWork(s, 'darkroom_print', nextDay, 'home', undefined, '兰州');
  assert.equal(blockedByMaint.ok, false);
  assert.match(blockedByMaint.reason ?? '', /维护|保养/);
  assert.equal(s.money.cash, 100, '因待保养被拒时严禁先扣耗材费');

  const maintRes = applyMaintainEquip(s, 'camera', nextDay);
  assert.equal(maintRes.ok, true);
  assert.equal(maintRes.paid, camRule.cost);
  assert.equal(s.equipPendingMaintain?.includes('camera'), false);
  assert.equal(applyWork(s, 'darkroom_print', nextDay, 'home', undefined, '兰州').ok, true, '检修完成后即可恢复接单');

  // 维度 4：30 天证书轻续期费（足额扣费 vs 不足额暂缓且不吊销）
  const cT0 = new Date('2026-10-01T09:00:00+08:00');
  const sc = freshState(cT0);
  sc.home.monthly = 0;
  sc.knowledge = 60;
  sc.money.cash = 1000;
  const certOk = applyCert(sc, '健康证', cT0, 0.01); // price=80 -> renewFee=8
  assert.equal(certOk.ok && certOk.passed, true);
  const cashAfterExam = sc.money.cash;
  const cT31 = new Date(cT0.getTime() + 31 * 86_400_000);
  const advRenewPaid = advance(sc, cT31);
  assert.ok(advRenewPaid.certRenewed?.includes('健康证'));
  assert.equal(advRenewPaid.certRenewFees?.[0]?.fee, 8);
  assert.equal(sc.money.cash, cashAfterExam - 8);

  const cT62 = new Date(cT31.getTime() + 31 * 86_400_000);
  sc.money.cash = 3;
  const advRenewDef = advance(sc, cT62);
  assert.ok(sc.job.certs.includes('健康证'), '现金不足轻续期费不可吊销有效证书');
  assert.equal(sc.money.cash, 3, '现金不足时不可扣成负数');
  assert.equal(advRenewDef.certRenewDeferred?.[0]?.fee, 8);
});

test('双城街市/特产总表（14 项）与 LifeWorld 工具/账本/防在途泄漏集成闭环', async () => {
  assert.equal(CITY_SPECIALTIES.length, 14, 'CITY_SPECIALTIES 应含 14 项特产');
  assert.ok(specialtiesForCity('兰州').length >= 6);
  assert.ok(specialtiesForCity('北京').length >= 6);

  const morning = new Date('2026-11-28T07:30:00+08:00');
  const night = new Date('2026-11-28T20:00:00+08:00');
  assert.equal(streetWindowOf(morning, '兰州')?.place, '南滨河路');
  assert.equal(streetWindowOf(morning, '北京')?.place, '鼓楼西大街');
  assert.equal(streetWindowOf(night, '兰州')?.place, '张掖路');
  assert.equal(streetWindowOf(night, '北京')?.place, '什刹海沿岸');

  const bjMarket = marketCatalogOf(morning, '2026-11-28', '北京');
  assert.ok(bjMarket.some((m) => m.item.includes('驴打滚') || m.item.includes('门钉肉饼')));
  const defaultMarket = marketCatalogOf(morning, '2026-11-28');
  assert.ok(defaultMarket.some((m) => m.item === '青菜豆腐'));

  // 测试特产不同 useMode：pantry 直入储物篮 + souvenir 首次涨见识 + snack 多次享用消耗
  const tSpec = new Date('2026-11-28T14:00:00+08:00');
  const st = freshState(tSpec);
  st.home.monthly = 0;
  const crossCityDeny = applyBuySpecialty(st, '盖碗三泡台料包', '北京', tSpec);
  assert.equal(crossCityDeny.ok, false);
  const buyGourd = applyBuySpecialty(st, '素面小葫芦坯', '兰州', tSpec);
  assert.equal(buyGourd.ok && buyGourd.intoPantry, true);
  assert.ok(st.pantry.some((p) => p.itemId === 'lz_gourd_blank'));

  const knowBeforeMark = st.knowledge;
  const buyBookmark = applyBuySpecialty(st, '黄河铁桥木刻书签', '兰州', tSpec);
  assert.equal(buyBookmark.ok, true);
  assert.equal(st.knowledge, knowBeforeMark + 1, '首次购入纪念特产应涨 1 点见识');

  const dir = mkdtempSync(join(tmpdir(), 'life-expand-'));
  try {
    // 写入在途 journey-public.json：home=兰州, to=北京，验证 traveling 时不泄漏北京城市活
    writeFileSync(join(dir, 'journey-public.json'), JSON.stringify({
      schema: 'coopani-journey-public/v1',
      updatedAt: morning.toISOString(),
      phase: 'traveling',
      city: { id: 'lanzhou', name: '兰州', tz: 'Asia/Shanghai' },
      leg: {
        fromId: 'lanzhou', toId: 'beijing',
        fromName: '兰州', toName: '北京',
        modeId: 'train',
        departedAt: new Date(morning.getTime() - 3_600_000).toISOString(),
        arriveAt: new Date(morning.getTime() + 6 * 3_600_000).toISOString(),
      },
    }), 'utf8');

    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, weatherMode: 'builtin' },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => morning,
    });
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => ({ ...e, blobs: [] }),
    });

    const tools = world.tools();
    const workTool = tools.find((t) => t.name === 'life_work');
    const learnTool = tools.find((t) => t.name === 'life_learn');
    const buyTool = tools.find((t) => t.name === 'life_buy');
    const cookTool = tools.find((t) => t.name === 'life_cook');
    assert.ok(workTool && learnTool && buyTool && cookTool);

    // traveling 时接北京限定活必须被拒
    const bjDuringTravel = await workTool.handler({ what: 'bj_hutong_walk' });
    assert.match(bjDuringTravel.text, /路上|没法在车上干/);

    // traveling 时买本地特产被拒
    const specDuringTravel = await buyTool.handler({ action: 'buy_specialty', stall_id: '京八件手工糕点盒' });
    assert.match(specDuringTravel.text, /路上|安顿/);

    // 切为 staying 北京
    writeFileSync(join(dir, 'journey-public.json'), JSON.stringify({
      schema: 'coopani-journey-public/v1',
      updatedAt: morning.toISOString(),
      phase: 'staying',
      city: { id: 'beijing', name: '北京', tz: 'Asia/Shanghai' },
    }), 'utf8');

    const buyBjSpec = await buyTool.handler({ action: 'buy_specialty', stall_id: '京八件手工糕点盒' });
    assert.match(buyBjSpec.text, /买下了「京八件手工糕点盒」/);
    const use1 = await buyTool.handler({ action: 'use_specialty', stall_id: '京八件' });
    assert.match(use1.text, /还剩 1 次/);
    const use2 = await buyTool.handler({ action: 'use_specialty', stall_id: '京八件' });
    assert.match(use2.text, /用完了/);

    // 回到家里后测试 life_cook(action="workbench") 与 life_learn(action="maintain")
    writeFileSync(join(dir, 'journey-public.json'), JSON.stringify({
      schema: 'coopani-journey-public/v1',
      updatedAt: morning.toISOString(),
      phase: 'home',
      city: { id: 'lanzhou', name: '兰州', tz: 'Asia/Shanghai' },
    }), 'utf8');

    const cookWb = await cookTool.handler({ action: 'workbench', recipe: 'wb_solar_zine' });
    assert.match(cookWb.text, /未解锁|电脑/);
    world.state.skills.writing = 15;
    world.state.vitals.energy = 80;
    const cookWbOk = await cookTool.handler({ action: 'workbench', recipe: 'wb_solar_zine' });
    assert.match(cookWbOk.text, /做出了/);

    world.state.gear.push('camera');
    world.state.equipPendingMaintain = ['camera'];
    const maintOut = await learnTool.handler({ action: 'maintain', what: 'camera' });
    assert.match(maintOut.text, /检修保养好了/);

    // 验证 career 面板返回 workbench(20) 与 market 面板返回 3/3/3 & 14 特产 & 35 种子 & 20 动物
    const careerSnap = await world.panelInvoke('career', 'snapshot', []);
    assert.equal(careerSnap.career.workbench.length, 20);
    assert.equal(careerSnap.career.jobs.length, 69);
    const marketSnap = await world.panelInvoke('market', 'snapshot', []);
    assert.equal(marketSnap.seeds.length, 35);
    assert.equal(marketSnap.animals.length, 20);
    assert.equal(marketSnap.recipes.length, 45);
    assert.deepEqual(marketSnap.ranchLeaseConfig.slots, { chicken: 3, cow: 3, fish: 3 });

    const ledger = readLedger(dir, 30);
    assert.ok(ledger.some((e) => e.source === 'life_specialty' && e.amount > 0), '应记录 life_specialty 账本流水');
    assert.ok(ledger.some((e) => e.source === 'life_workbench' && e.amount > 0), '应记录 life_workbench 账本流水');
    assert.ok(ledger.some((e) => e.source === 'life_maintain' && e.amount > 0), '应记录 life_maintain 账本流水');

    const rawLog = readFileSync(join(dir, 'life-ledger.jsonl'), 'utf8');
    assert.ok(rawLog.includes('life_specialty'));

    await world.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('复核 11 项问题全量回归（P0 #1-3 / P1 #4-8 / P2 #9-11）', async () => {
  const t0 = new Date('2026-11-28T09:00:00+08:00');

  // P0 #1: craft_mat 不混入可食用储物篮统计、不被 life_act('cook') 吃掉、不被鲜蔬/料理摊消耗
  const sMat = freshState(t0);
  sMat.home.monthly = 0;
  sMat.vitals = { food: 70, energy: 90, clean: 90, fun: 90, social: 90 };
  sMat.pantry.push(
    { itemId: 'rabbit_fur', name: '细软兔绒', kind: 'craft_mat', qty: 2, freshVeg: false, origin: 'ranch', unitCost: 8, acquiredAt: t0.toISOString() },
    { itemId: 'organic_fertilizer', name: '豆渣果皮有机花肥', kind: 'craft_mat', qty: 1, freshVeg: false, origin: 'home-grown', unitCost: 2, acquiredAt: t0.toISOString() },
  );
  assert.equal(pantryCount(sMat.pantry, { edibleOnly: true }), 0);
  assert.equal(pantryCount(sMat.pantry, { homeOnly: true, edibleOnly: true }), 0);
  const prodPlanBlock = evaluateStallPlan(sMat, { item: '自产鲜蔬篮', price: 25, stock: 1, freshVeg: true, category: 'produce' });
  assert.equal(prodPlanBlock.ok, false, '仅有 craft_mat 不应允许冒充鲜蔬摆 produce 摊');
  const cashBeforeCook = sMat.money.cash;
  const actCook = applyAct(sMat, 'cook', t0);
  assert.equal(actCook.ok, true);
  advance(sMat, new Date(t0.getTime() + 55 * 60_000));
  assert.equal(cashBeforeCook - sMat.money.cash, 10, '无真正食材时下厨应按正常成本 10 元扣费，不消费兔绒/花肥');
  assert.equal(sMat.pantry.find((p) => p.itemId === 'rabbit_fur')?.qty, 2);

  // P0 #2: phase === 'home' 放行当前所在城市的 destination 限定职业（含北京 7 岗与兰州黄河讲解员）
  assert.equal(jobAllowedAt(findJob('bj_hutong_walk'), 'home', '北京'), true);
  assert.equal(jobAllowedAt(findJob('bj_alley_bookstore'), 'home', '北京'), true);
  assert.equal(jobAllowedAt(findJob('lz_river_docent'), 'home', '兰州'), true);
  assert.equal(jobAllowedAt(findJob('lz_river_docent'), 'home', '北京'), false);

  // P0 #3: life_cook(action="workbench") 暴露 mode="use" 且花肥默认走 use；organic_fertilizer 在 applyPlant/applyWater 被消耗缩熟期 15%
  const sFert = freshState(t0);
  sFert.home.monthly = 0;
  sFert.pantry.push({
    itemId: 'soybean', name: '金粒黄豆', kind: 'veg', qty: 3, freshVeg: true, origin: 'home-grown', unitCost: 3, acquiredAt: t0.toISOString(),
  });
  const makeFert = applyWorkbenchCraft(sFert, 'wb_organic_fertilizer', 'use', t0);
  assert.equal(makeFert.ok, true);
  assert.equal(sFert.pantry.find((p) => p.itemId === 'organic_fertilizer')?.qty, 1);
  const pl = applyPlant(sFert, 'scallion', t0); // 96h -> fertilized * 0.85 = 81.6h
  assert.equal(pl.ok && pl.fertilized, true);
  assert.equal(sFert.pantry.some((p) => p.itemId === 'organic_fertilizer'), false, 'applyPlant 应消耗有机花肥');
  const plantedHrs = (Date.parse(pl.plot.matureAt) - t0.getTime()) / 3_600_000;
  assert.ok(Math.abs(plantedHrs - 96 * 0.85) < 0.05, `施肥后熟期应约为 81.6h，实得 ${plantedHrs}`);

  // applyWater 也可追施有机花肥
  sFert.pantry.push({
    itemId: 'organic_fertilizer', name: '豆渣果皮有机花肥', kind: 'craft_mat', qty: 1, freshVeg: false, origin: 'home-grown', unitCost: 2, acquiredAt: t0.toISOString(),
  });
  const beforeMat = Date.parse(pl.plot.matureAt);
  const wat = applyWater(sFert, pl.plot.id, new Date(t0.getTime() + 60_000));
  assert.equal(wat.ok && wat.fertilizedCount, 1);
  assert.ok(Date.parse(pl.plot.matureAt) < beforeMat, '浇水有有机花肥时应再缩短剩余熟期 15%');

  // P1 #4: snack_or_pantry 双通 + 零孤儿 pantryId + workOutputs/specialties 摆摊消费
  const usedPantryIds = new Set();
  for (const r of RECIPES) for (const ing of r.ingredients) for (const id of ing.anyOf) usedPantryIds.add(id);
  for (const w of WORKBENCH_RECIPES) for (const ing of w.ingredients) for (const id of ing.anyOf) usedPantryIds.add(id);
  for (const sp of CITY_SPECIALTIES) {
    if (sp.pantryId) {
      assert.ok(usedPantryIds.has(sp.pantryId), `特产 ${sp.id} 的 pantryId=${sp.pantryId} 不得为孤儿原料`);
    }
  }
  const sSpec = freshState(t0);
  sSpec.home.monthly = 0;
  const buyChest = applyBuySpecialty(sSpec, '怀柔去壳熟板栗仁', '北京', t0);
  assert.equal(buyChest.ok && buyChest.intoPantry, true, 'snack_or_pantry 应进入储物篮供烹饪用');
  assert.ok(sSpec.pantry.some((p) => p.itemId === 'chestnut'));
  const useChest = applyUseSpecialty(sSpec, '板栗', t0);
  assert.equal(useChest.ok, true, '存于 pantry 的 snack_or_pantry 特产也可直接当零嘴吃掉');
  assert.equal(sSpec.pantry.some((p) => p.itemId === 'chestnut'), false);

  // P1 #5 & P2 #11: buildCareerOverview 过滤城市/保养状态，jobGate 同样拦待保养装备
  const sOv = freshState(t0);
  sOv.job.days = 50;
  sOv.job.certs = CERTS.map((c) => c.name);
  sOv.gear = ['camera'];
  sOv.equipPendingMaintain = ['camera'];
  const ovLz = buildCareerOverview(sOv, t0, { currentCity: '兰州', phase: 'home' });
  const bjCard = ovLz.jobs.find((j) => j.id === 'bj_hutong_walk');
  const camCard = ovLz.jobs.find((j) => j.id === 'darkroom_print');
  assert.equal(bjCard?.qualified, false);
  assert.equal(camCard?.qualified, false);
  assert.match(camCard?.missing.join(';') ?? '', /待保养/);
  assert.match(jobGate(sOv, findJob('darkroom_print'), 'home', '兰州') ?? '', /维护|保养/);

  // P1 #6: advance 透传 currentCity -> buildDreamSlice 切到北京梦境
  const sDream = freshState(t0);
  sDream.home.monthly = 0;
  sDream.wants.push({ id: 'w1', what: '去看老槐树', scale: 'small', kind: 'place', since: t0.toISOString(), note: '' });
  sDream.asleepFrom = t0.toISOString();
  sDream.asleepUntil = new Date(t0.getTime() + 8 * 3_600_000).toISOString();
  advance(sDream, new Date(t0.getTime() + 8 * 3_600_000), { currentCity: '北京', dreamRoll: 0.01 });
  assert.ok(sDream.tellable.some((t) => t.text.includes('什刹海') || t.text.includes('钟鼓楼')), '北京驻留睡眠应梦出北京地标');

  // P2 #10: applyMaintainEquip 生病静养时拒出门检修
  const sSick = freshState(t0);
  sSick.gear = ['camera'];
  sSick.equipPendingMaintain = ['camera'];
  sSick.conditions.push({ id: 'cold', since: t0.toISOString(), until: new Date(t0.getTime() + 24 * 3_600_000).toISOString(), text: '感冒静养中。' });
  assert.equal(applyMaintainEquip(sSick, 'camera', t0).ok, false, '感冒静养时不应出门检修装备');

  // P0 #3 / P1 #4c / P1 #8 / P2 #9 / P2 #10: World + 面板 DOM 实测
  const dir = mkdtempSync(join(tmpdir(), 'life-p012-'));
  const prevDoc = globalThis.document;
  try {
    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, weatherMode: 'builtin', townUrl: 'https://example.invalid/town' },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => t0,
    });
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => ({ ...e, blobs: [] }),
    });
    const tools = world.tools();
    const cookTool = tools.find((t) => t.name === 'life_cook');
    const workTool = tools.find((t) => t.name === 'life_work');

    // wb_organic_fertilizer 省略 mode 默认走 use 并写入 pantry organic_fertilizer
    world.state.pantry.push({
      itemId: 'soybean', name: '金粒黄豆', kind: 'veg', qty: 2, freshVeg: true, origin: 'home-grown', unitCost: 3, acquiredAt: t0.toISOString(),
    });
    const wbDefaultUse = await cookTool.handler({ action: 'workbench', recipe: 'wb_organic_fertilizer' });
    assert.match(wbDefaultUse.text, /储物篮备用/);
    assert.ok(world.state.pantry.some((p) => p.itemId === 'organic_fertilizer'));

    // workOutputs 进 stall 计划（含 wb_solar_zine / wb_calm_tea 与 collect_or_stall 特产）
    world.state.skills.writing = 15;
    await cookTool.handler({ action: 'workbench', recipe: 'wb_solar_zine', mode: 'store' });
    const woPlan = evaluateStallPlan(world.state, { item: '芦花节气风物手抄小志', price: 52, stock: 1, freshVeg: false, category: 'writing' });
    assert.equal(woPlan.ok && woPlan.workOutputUsed === 1 && woPlan.cashCost === 2, true);

    world.state.specialties = [{ id: 'lz_bridge_mark', name: '黄河铁桥木刻书签', city: '兰州', category: 'souvenir', charges: 1 }];
    const spPlan = evaluateStallPlan(world.state, { item: '黄河铁桥木刻书签', price: 16, stock: 1, freshVeg: false, category: 'writing' });
    assert.equal(spPlan.ok && spPlan.specialtyUsed === 1 && spPlan.cashCost === 2, true);

    // life_work({}) 无参推荐列表应剔除 pending maintain 锁定职业，且 vehicle_car 与 labor 工坊页正确渲染
    world.state.equipUsage = { vehicle_car: 6 };
    world.state.equipPendingMaintain = ['vehicle_car'];
    world.state.workOutputs.push({
      id: 'wo-labor', jobId: 'wb_cured_delicacy', jobName: '农牧自制台', domain: 'labor', name: '风干青鱼干与慢晒柿饼',
      quality: 'fine', qualityLabel: '精品', value: 87, count: 1, createdAt: t0.toISOString(),
    });
    const recList = await workTool.handler({});
    assert.doesNotMatch(recList.text, /网约车司机/);

    const makeNode = (tag) => {
      const listeners = {};
      const node = {
        tagName: String(tag || 'div').toUpperCase(),
        children: [],
        attrs: {},
        style: {},
        className: '',
        id: '',
        _text: '',
        set innerHTML(v) { this.children = []; this._text = String(v ?? ''); },
        get textContent() { return this._text + this.children.map((c) => c.textContent ?? '').join(''); },
        set textContent(v) { this.children = []; this._text = String(v ?? ''); },
        append(...items) {
          for (const it of items) {
            if (it == null) continue;
            this.children.push(typeof it === 'string' ? { textContent: it, children: [], attrs: {} } : it);
          }
        },
        prepend(...items) { this.children.unshift(...items.filter(Boolean)); },
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
    const fakeDoc = {
      head: makeNode('head'),
      body: makeNode('body'),
      createElement(tag) { return makeNode(tag); },
      createTextNode(t) { return { textContent: String(t ?? ''), children: [], attrs: {} }; },
      getElementById(id) { return findAll(this.head, (x) => x.id === id)[0] || findAll(this.body, (x) => x.id === id)[0] || null; },
    };
    globalThis.document = fakeDoc;
    const panelMod = await import(`../web/panel-1.8.0.js?p12=${Date.now()}`);
    const careerSnap = await world.panelInvoke('career', 'snapshot', []);
    const careerRoot = fakeDoc.createElement('div');
    await panelMod.default.panels.career.mount({ root: careerRoot, language: 'zh', invoke: async () => careerSnap, timeout: () => 0 });
    assert.match(careerRoot.textContent, /运营车辆·需保养/);
    assert.match(careerRoot.textContent, /随身特产/);
    const laborBtn = findAll(careerRoot, (n) => n.attrs?.['data-studio-tab'] === 'labor')[0];
    assert.ok(laborBtn, '应存在农牧·自制工坊台页签');
    laborBtn.click();
    assert.match(careerRoot.textContent, /风干青鱼干与慢晒柿饼/);
    assert.match(careerRoot.textContent, /豆渣果皮有机花肥/);

    await world.stop();
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('主面板 now 支付宝资助二维码默认收起且展开时按需加载原图', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'life-sponsor-qr-'));
  const prevDoc = globalThis.document;
  try {
    const t0 = new Date('2026-11-28T10:00:00+08:00');
    const world = new LifeWorld({
      cfg: { ...LIFE_DEFAULTS(), enabled: true, weatherMode: 'builtin' },
      dataDir: dir,
      botName: '大肥鱼',
      now: () => t0,
    });
    await world.start({
      log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
      pushEvent: async (e) => ({ ...e, blobs: [] }),
    });

    const qrRes = await world.panelInvoke('now', 'sponsorQr', []);
    assert.equal(qrRes.ok, true);
    assert.ok(typeof qrRes.dataUrl === 'string' && qrRes.dataUrl.startsWith('data:image/jpeg;base64,'));
    const rawDisk = readFileSync(new URL('../assets/sponsor-alipay.jpg', import.meta.url));
    const decoded = Buffer.from(qrRes.dataUrl.slice('data:image/jpeg;base64,'.length), 'base64');
    assert.equal(Buffer.compare(decoded, rawDisk), 0, 'sponsorQr 返回字节必须与 assets/sponsor-alipay.jpg 完全一致');

    const findAll = (n, pred, out = []) => {
      if (!n) return out;
      if (pred(n)) out.push(n);
      for (const ch of n.children || []) findAll(ch, pred, out);
      return out;
    };
    const makeNode = (tag) => ({
      tagName: String(tag || 'div').toUpperCase(),
      children: [],
      attrs: {},
      style: {},
      listeners: {},
      className: '',
      id: '',
      open: false,
      disabled: false,
      hidden: false,
      _text: '',
      set innerHTML(v) { this.children = []; this._text = String(v ?? ''); },
      get textContent() { return this._text + this.children.map((c) => c.textContent ?? '').join(''); },
      set textContent(v) { this.children = []; this._text = String(v ?? ''); },
      append(...items) {
        for (const it of items) {
          if (it == null) continue;
          this.children.push(typeof it === 'string' ? { textContent: it, children: [], attrs: {} } : it);
        }
      },
      prepend(...items) { this.children.unshift(...items.filter(Boolean)); },
      addEventListener(ev, fn) { (this.listeners[ev] ??= []).push(fn); },
      dispatchEvent(ev) {
        const type = typeof ev === 'string' ? ev : ev?.type;
        for (const fn of this.listeners[type] || []) fn(typeof ev === 'string' ? { type } : ev);
      },
      click() { for (const fn of this.listeners.click || []) fn({ target: this }); },
      closest() { return null; },
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); },
    });
    const fakeDoc = {
      head: makeNode('head'),
      body: makeNode('body'),
      createElement(tag) { return makeNode(tag); },
      createTextNode(t) { return { textContent: String(t ?? ''), children: [], attrs: {} }; },
      getElementById(id) { return findAll(this.head, (x) => x.id === id)[0] || findAll(this.body, (x) => x.id === id)[0] || null; },
    };
    globalThis.document = fakeDoc;

    const called = [];
    const panelMod = await import(`../web/panel-1.8.0.js?sponsor=${Date.now()}`);
    const nowRoot = fakeDoc.createElement('div');
    await panelMod.default.panels.now.mount({
      root: nowRoot,
      language: 'zh',
      invoke: (m, a) => {
        called.push(m);
        return world.panelInvoke('now', m, a);
      },
      timeout: () => 0,
    });

    const sponsorBox = findAll(nowRoot, (n) => n.tagName === 'DETAILS' && String(n.className).includes('lf-sponsor'))[0];
    assert.ok(sponsorBox, '主面板 now 应包含资助折叠栏');
    assert.equal(Boolean(sponsorBox.open), false, '资助折叠栏默认必须收起');
    assert.equal(called.includes('sponsorQr'), false, '首次挂载未展开时不应对 sponsorQr 发起调用');

    sponsorBox.open = true;
    sponsorBox.dispatchEvent('toggle');
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(called.filter((m) => m === 'sponsorQr').length, 1, '展开资助栏应按需调用一次 sponsorQr');
    const imgs = findAll(sponsorBox, (n) => n.tagName === 'IMG');
    assert.equal(imgs.length, 1);
    assert.ok(String(imgs[0].src || '').startsWith('data:image/jpeg;base64,'));

    await world.stop();
  } finally {
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
    rmSync(dir, { recursive: true, force: true });
  }
});
