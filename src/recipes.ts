/**
 * 烹饪菜谱、成品菜格双向联动与职业/工坊能力聚合（2026-11-25）。
 *
 * - 「家常简食（simple）」零门槛免厨师证，如炭烤红薯、椒盐烤土豆、葱油拌面、番茄鸡蛋汤等；
 * - 「厨师招牌菜（chef）」需持「厨师证」或烹饪熟练度 ≥ 20（烘焙需小烤箱或厨师证），
 *   结合储物篮里的菜园作物与鸡/牛/鱼养殖产出，回复更高且能存进成品菜格直接上鱼市街摆料理摊。
 */

import {
  addCookedDish,
  consumeCookedDish,
  consumePantryByIngredient,
  inferIngredientId,
  pantryCountByIds,
  type CookedDishItem,
  type FarmHomeTier,
  type PantryItem,
} from './farm.ts';
import { CERTS, JOBS, TIER_LABEL, certOf, type JobTier } from './jobs.ts';
import {
  applyYieldBonus, EQUIP_CATALOG, normalizeMoodBonus, SKILL_DOMAIN_LABEL, findEquip,
  jobOutputOf, qualityOdds, rollWorkQuality, skillPayMultiplier,
  type OutputQualityId, type SkillDomain, type WorkOutputItem,
} from './town-life.ts';

export interface RecipeIngredientReq {
  label: string;
  anyOf: readonly string[];
  qty: number;
}

export interface RecipeDef {
  id: string;
  name: string;
  aliases: readonly string[];
  tier: 'simple' | 'chef';
  minutes: number;
  fuelCost: number;
  foodGain: number;
  funGain: number;
  energyGain?: number;
  cleanGain?: number;
  fitnessGain?: number;
  needEquip?: string;
  suggestedPrice: number;
  ingredients: readonly RecipeIngredientReq[];
  moodText: string;
  note: string;
}

export const RECIPES: readonly RecipeDef[] = [
  // -------- 家常简食（零门槛，无需厨师证） --------
  {
    id: 'roast_sweet_potato',
    name: '炭烤红薯',
    aliases: ['烤红薯', '烤蜜薯', '烤地瓜', '炭烤红薯'],
    tier: 'simple',
    minutes: 30,
    fuelCost: 1,
    foodGain: 38,
    funGain: 10,
    suggestedPrice: 12,
    ingredients: [{ label: '蜜薯红薯', anyOf: ['sweet_potato'], qty: 1 }],
    moodText: '捧着烫手焦香的烤红薯，整个人都暖融融的',
    note: '无需厨师证，一块蜜薯直接上炉烤出蜜糖香。',
  },
  {
    id: 'roast_potato',
    name: '椒盐烤土豆',
    aliases: ['烤土豆', '烤洋芋', '椒盐土豆'],
    tier: 'simple',
    minutes: 25,
    fuelCost: 1,
    foodGain: 36,
    funGain: 8,
    suggestedPrice: 11,
    ingredients: [{ label: '黄心土豆', anyOf: ['potato'], qty: 1 }],
    moodText: '外皮微焦内里绵软的烤土豆，撒点椒盐格外管饱',
    note: '无需厨师证，土豆烤得起沙就能开吃。',
  },
  {
    id: 'scallion_noodles',
    name: '葱油拌面',
    aliases: ['葱油面', '拌面', '香葱拌面'],
    tier: 'simple',
    minutes: 20,
    fuelCost: 2,
    foodGain: 35,
    funGain: 7,
    suggestedPrice: 14,
    ingredients: [{ label: '香葱与罗勒', anyOf: ['scallion'], qty: 1 }],
    moodText: '滚油泼出葱香味儿，三两口嗦完一碗拌面太满足了',
    note: '无需厨师证，一把自家香葱配点常备挂面就能出锅。',
  },
  {
    id: 'stir_greens',
    name: '蒜蓉清炒时蔬',
    aliases: ['清炒青菜', '炒青菜', '炒菠菜', '清炒白菜', '炒时蔬'],
    tier: 'simple',
    minutes: 20,
    fuelCost: 2,
    foodGain: 34,
    funGain: 6,
    suggestedPrice: 15,
    ingredients: [{ label: '绿叶时蔬（青菜/菠菜/白菜）', anyOf: ['bokchoy', 'spinach', 'cabbage'], qty: 1 }],
    moodText: '翠绿爽脆的家常青菜下了肚，胃里清爽舒服',
    note: '无需厨师证，刚摘下的绿叶菜旺火快炒就鲜。',
  },
  {
    id: 'tomato_egg_soup',
    name: '番茄鸡蛋汤',
    aliases: ['番茄蛋汤', '西红柿鸡蛋汤', '西红柿蛋花汤'],
    tier: 'simple',
    minutes: 25,
    fuelCost: 2,
    foodGain: 40,
    funGain: 9,
    suggestedPrice: 18,
    ingredients: [
      { label: '沙瓤西红柿', anyOf: ['tomato'], qty: 1 },
      { label: '鲜鸡蛋', anyOf: ['egg'], qty: 1 },
    ],
    moodText: '酸甜鲜亮的番茄蛋花汤喝下去，浑身暖洋洋的',
    note: '无需厨师证，菜园西红柿配鸡舍鲜鸡蛋的国民搭配。',
  },
  {
    id: 'milk_egg_breakfast',
    name: '热牛奶配水煮蛋',
    aliases: ['牛奶鸡蛋', '水煮蛋', '热牛奶', '早点拼盘'],
    tier: 'simple',
    minutes: 15,
    fuelCost: 1,
    foodGain: 34,
    funGain: 7,
    energyGain: 4,
    suggestedPrice: 16,
    ingredients: [
      { label: '鲜牛奶', anyOf: ['milk'], qty: 1 },
      { label: '鲜鸡蛋', anyOf: ['egg'], qty: 1 },
    ],
    moodText: '热乎乎的鲜牛奶配溏心水煮蛋，一天都跟着有精神',
    note: '无需厨师证，温好鲜奶煮颗蛋，连精力也顺带提一点。',
  },
  {
    id: 'mushroom_porridge',
    name: '香菇青菜粥',
    aliases: ['香菇粥', '青菜粥', '菌菇青菜粥'],
    tier: 'simple',
    minutes: 35,
    fuelCost: 2,
    foodGain: 42,
    funGain: 8,
    suggestedPrice: 18,
    ingredients: [
      { label: '椴木鲜香菇', anyOf: ['mushroom'], qty: 1 },
      { label: '稻谷/绿叶菜', anyOf: ['rice', 'bokchoy', 'spinach'], qty: 1 },
    ],
    moodText: '小火咕嘟出来的香菇青菜粥，绵滑鲜香最养胃',
    note: '无需厨师证，一锅热粥暖心又养胃。',
  },
  {
    id: 'steamed_corn_pumpkin',
    name: '蒸甜玉米南瓜',
    aliases: ['蒸玉米', '蒸南瓜', '杂粮双蒸'],
    tier: 'simple',
    minutes: 25,
    fuelCost: 1,
    foodGain: 36,
    funGain: 7,
    suggestedPrice: 14,
    ingredients: [{ label: '甜玉米或板栗南瓜', anyOf: ['corn', 'pumpkin'], qty: 1 }],
    moodText: '金灿灿的蒸玉米和板栗南瓜，不加糖也甜滋滋的',
    note: '无需厨师证，上锅蒸熟即食。',
  },

  // -------- 厨师招牌菜（需「厨师证」或烹饪熟练度 ≥ 20） --------
  {
    id: 'tomato_beef_stew',
    name: '西红柿炖牛腩',
    aliases: ['番茄牛腩', '番茄炖牛腩', '西红柿牛肉'],
    tier: 'chef',
    minutes: 60,
    fuelCost: 4,
    foodGain: 62,
    funGain: 16,
    energyGain: 5,
    fitnessGain: 0.2,
    suggestedPrice: 46,
    ingredients: [
      { label: '沙瓤西红柿', anyOf: ['tomato'], qty: 1 },
      { label: '精选牛肉', anyOf: ['beef'], qty: 1 },
      { label: '土豆或胡萝卜', anyOf: ['potato', 'carrot'], qty: 1 },
    ],
    moodText: '浓稠酸甜的番茄牛腩炖得酥烂，光闻汤汁就幸福感爆棚',
    note: '厨师硬菜，高饱腹还补精力，在鱼市街极其抢手。',
  },
  {
    id: 'mushroom_chicken_pot',
    name: '鲜香菇滑鸡煲',
    aliases: ['香菇滑鸡', '滑鸡煲', '香菇炖鸡'],
    tier: 'chef',
    minutes: 55,
    fuelCost: 3,
    foodGain: 56,
    funGain: 14,
    energyGain: 3,
    suggestedPrice: 38,
    ingredients: [
      { label: '椴木鲜香菇', anyOf: ['mushroom'], qty: 1 },
      { label: '土鸡肉', anyOf: ['chicken_meat'], qty: 1 },
    ],
    moodText: '砂锅掀盖那一刻，菌菇和土鸡肉的醇香扑满整间屋子',
    note: '厨师招牌砂锅菜，肉嫩汤浓。',
  },
  {
    id: 'fish_tofu_soup',
    name: '奶白鲜鱼豆腐汤',
    aliases: ['鱼汤', '鲜鱼豆腐汤', '奶白鱼汤', '鲫鱼豆腐汤'],
    tier: 'chef',
    minutes: 50,
    fuelCost: 3,
    foodGain: 54,
    funGain: 14,
    energyGain: 4,
    suggestedPrice: 36,
    ingredients: [
      { label: '塘养鲜鱼/鲈鱼', anyOf: ['fresh_fish'], qty: 1 },
      { label: '金粒黄豆（点豆腐）', anyOf: ['soybean'], qty: 1 },
      { label: '香葱与罗勒', anyOf: ['scallion'], qty: 1 },
    ],
    moodText: '熬成奶白色的鲜鱼豆腐汤鲜掉眉毛，喝完浑身舒坦',
    note: '大肥鱼（鲸鱼）吃塘鱼天经地义！配自家黄豆磨的嫩豆腐一绝。',
  },
  {
    id: 'scallion_braised_fish',
    name: '葱烧嫩鲜鱼',
    aliases: ['葱烧鱼', '红烧鲜鱼', '红烧草鱼', '清蒸鲈鱼'],
    tier: 'chef',
    minutes: 50,
    fuelCost: 3,
    foodGain: 55,
    funGain: 15,
    suggestedPrice: 40,
    ingredients: [
      { label: '塘养鲜鱼/鲈鱼', anyOf: ['fresh_fish'], qty: 1 },
      { label: '香葱与罗勒', anyOf: ['scallion'], qty: 1 },
    ],
    moodText: '鱼肉蒜瓣似的嫩滑入味，葱香浓郁得停不下筷子',
    note: '考验火候的厨师拿手菜，成菜油润鲜亮。',
  },
  {
    id: 'lotus_radish_beef',
    name: '莲藕萝卜炖牛腩',
    aliases: ['莲藕牛腩', '萝卜炖牛肉', '莲藕萝卜汤'],
    tier: 'chef',
    minutes: 60,
    fuelCost: 4,
    foodGain: 60,
    funGain: 15,
    energyGain: 4,
    suggestedPrice: 44,
    ingredients: [
      { label: '浅滩嫩莲藕', anyOf: ['lotus'], qty: 1 },
      { label: '水润白萝卜', anyOf: ['radish'], qty: 1 },
      { label: '精选牛肉', anyOf: ['beef'], qty: 1 },
    ],
    moodText: '粉糯拉丝的嫩藕和清甜萝卜吸饱牛腩肉汁，冬日一绝',
    note: '水乡莲藕与牧场牛肉的顶级炖菜。',
  },
  {
    id: 'braised_eggplant_chicken',
    name: '酱烧茄子鸡丁',
    aliases: ['茄子鸡丁', '鱼香茄子鸡', '酱烧茄子'],
    tier: 'chef',
    minutes: 45,
    fuelCost: 3,
    foodGain: 52,
    funGain: 13,
    suggestedPrice: 34,
    ingredients: [
      { label: '紫皮长茄与辣椒', anyOf: ['eggplant'], qty: 1 },
      { label: '土鸡肉', anyOf: ['chicken_meat'], qty: 1 },
    ],
    moodText: '紫皮长茄烧得软糯入味，裹着嫩滑鸡丁拌两碗饭都不够',
    note: '色香味俱全的厨师下饭菜。',
  },
  {
    id: 'creamy_corn_pumpkin_soup',
    name: '奶香玉米南瓜浓汤',
    aliases: ['奶油浓汤', '南瓜浓汤', '玉米浓汤'],
    tier: 'chef',
    minutes: 40,
    fuelCost: 3,
    foodGain: 48,
    funGain: 15,
    suggestedPrice: 32,
    ingredients: [
      { label: '水果甜玉米', anyOf: ['corn'], qty: 1 },
      { label: '板栗南瓜', anyOf: ['pumpkin'], qty: 1 },
      { label: '鲜牛奶', anyOf: ['milk'], qty: 1 },
    ],
    moodText: '丝滑金黄的奶油南瓜玉米浓汤，像把秋天的阳光端上桌',
    note: '牧场鲜奶与甜玉米南瓜熬制的高颜值西式浓汤。',
  },
  {
    id: 'strawberry_cream_cake',
    name: '奶油草莓小蛋糕',
    aliases: ['草莓蛋糕', '奶油蛋糕', '草莓点心'],
    tier: 'chef',
    minutes: 55,
    fuelCost: 4,
    foodGain: 44,
    funGain: 22,
    needEquip: 'oven',
    suggestedPrice: 42,
    ingredients: [
      { label: '奶油草莓与青梅', anyOf: ['strawberry'], qty: 1 },
      { label: '鲜鸡蛋', anyOf: ['egg'], qty: 1 },
      { label: '鲜牛奶', anyOf: ['milk'], qty: 1 },
    ],
    moodText: '刚出炉的松软戚风抹上鲜奶霜，点缀红宝石似的草莓太治愈了',
    note: '需厨师证（或烹饪≥20）与家用小烤箱，娱乐加成极高。',
  },
  {
    id: 'winter_melon_chicken_soup',
    name: '冬瓜菌菇老鸡汤',
    aliases: ['冬瓜鸡汤', '菌菇鸡汤', '老鸡汤'],
    tier: 'chef',
    minutes: 55,
    fuelCost: 3,
    foodGain: 55,
    funGain: 14,
    energyGain: 4,
    suggestedPrice: 36,
    ingredients: [
      { label: '粉皮冬瓜', anyOf: ['winter_melon'], qty: 1 },
      { label: '椴木鲜香菇', anyOf: ['mushroom'], qty: 1 },
      { label: '土鸡肉', anyOf: ['chicken_meat'], qty: 1 },
    ],
    moodText: '清澈甘甜的冬瓜菌菇鸡汤一口润进心里，夏秋最舒坦',
    note: '解暑养神的厨师功夫汤。',
  },
  {
    id: 'cabbage_fish_hotpot',
    name: '白菜鲜鱼暖锅',
    aliases: ['鲜鱼暖锅', '白菜鱼锅', '暖锅'],
    tier: 'chef',
    minutes: 55,
    fuelCost: 4,
    foodGain: 58,
    funGain: 16,
    suggestedPrice: 42,
    ingredients: [
      { label: '黄心大白菜', anyOf: ['cabbage'], qty: 1 },
      { label: '水润白萝卜', anyOf: ['radish'], qty: 1 },
      { label: '塘养鲜鱼/鲈鱼', anyOf: ['fresh_fish'], qty: 1 },
    ],
    moodText: '咕嘟冒泡的白菜萝卜鲜鱼暖锅，热气蒸腾得屋里都亮堂了',
    note: '适合多人共享和摆摊的冬日招牌大菜。',
  },
];

export interface RecipeHostState {
  home: { tier: FarmHomeTier };
  job: { what: string; id: string; daily: number; certs: string[]; lastAt: string; days: number };
  money: { cash: number; spent: number };
  vitals: { food: number; energy: number; clean: number; fun: number; social: number };
  knowledge: number;
  fitness: number;
  skills?: Partial<Record<SkillDomain, number>>;
  trained?: Partial<Record<SkillDomain, number>>;
  gear?: string[];
  pantry: PantryItem[];
  cookedDishes?: CookedDishItem[];
  asleepFrom: string;
  asleepUntil: string;
  activity?: {
    kind: 'act' | 'work';
    id: string;
    label: string;
    from: string;
    until: string;
    minutes: number;
    perMin: Partial<Record<'food' | 'energy' | 'clean' | 'fun' | 'social', number>>;
    knowPerMin?: number;
    costPerMin?: number;
    costAcc?: number;
    costPaid?: number;
    mood?: { text: string; kind: 'good' | 'bad'; hours: number };
    scene?: string;
  } | null;
  tellable: { id: string; text: string; at: string; said: boolean }[];
  moodlets: { id: string; source: string; text: string; kind: 'good' | 'bad'; expiresAt: string }[];
  workOutputs?: WorkOutputItem[];
  updatedAt: string;
}

export interface RecipeEvalResult {
  recipe: RecipeDef;
  unlocked: boolean;
  lockReason: string;
  canCook: boolean;
  ingredients: {
    label: string;
    anyOf: readonly string[];
    need: number;
    have: number;
    ok: boolean;
  }[];
  missingLabels: string[];
}

export function findRecipe(q: string): RecipeDef | null {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return null;
  return RECIPES.find((r) =>
    r.id.toLowerCase() === s
    || r.name.toLowerCase() === s
    || r.name.toLowerCase().includes(s)
    || r.aliases.some((a) => a.toLowerCase() === s || s.includes(a.toLowerCase())),
  ) ?? null;
}

export function evaluateRecipe(
  state: { job: { certs: string[] }; skills?: Partial<Record<SkillDomain, number>>; gear?: string[]; pantry: PantryItem[] },
  recipe: RecipeDef,
): RecipeEvalResult {
  const certs = state.job?.certs ?? [];
  const cookExp = Number(state.skills?.cooking ?? 0);
  const gear = Array.isArray(state.gear) ? state.gear : [];

  let unlocked = true;
  let lockReason = '';
  if (recipe.tier === 'chef') {
    const hasChefCert = certs.includes('厨师证');
    if (!hasChefCert && cookExp < 20) {
      unlocked = false;
      lockReason = '需要「厨师证」或烹饪熟练度 ≥ 20';
    } else if (recipe.needEquip && !gear.includes(recipe.needEquip) && !hasChefCert) {
      const eq = findEquip(recipe.needEquip);
      unlocked = false;
      lockReason = `需要添置「${eq ? eq.name : recipe.needEquip}」或持「厨师证」`;
    } else if (recipe.needEquip && !gear.includes(recipe.needEquip) && hasChefCert) {
      // 考过厨师证或家里有小烤箱都能烤；若有明确 needEquip=oven 仍建议有烤箱或厨师证放行，避免卡死
      unlocked = true;
    }
  }
  if (recipe.needEquip && !gear.includes(recipe.needEquip) && recipe.tier === 'chef' && !certs.includes('厨师证')) {
    const eq = findEquip(recipe.needEquip);
    unlocked = false;
    lockReason = `需具备厨师资质并添置「${eq ? eq.name : recipe.needEquip}」`;
  }

  const ingredients = recipe.ingredients.map((req) => {
    const have = pantryCountByIds(state.pantry, req.anyOf);
    return {
      label: req.label,
      anyOf: req.anyOf,
      need: req.qty,
      have,
      ok: have >= req.qty,
    };
  });
  const missingLabels = ingredients.filter((i) => !i.ok).map((i) => `${i.label}（差 ${i.need - i.have}）`);
  const canCook = unlocked && missingLabels.length === 0;

  return { recipe, unlocked, lockReason, canCook, ingredients, missingLabels };
}

export function evaluateAllRecipes(
  state: { job: { certs: string[] }; skills?: Partial<Record<SkillDomain, number>>; gear?: string[]; pantry: PantryItem[] },
): RecipeEvalResult[] {
  return RECIPES.map((r) => evaluateRecipe(state, r));
}

function pushMemory(state: { tellable: { id: string; text: string; at: string; said: boolean }[] }, text: string, now: Date): void {
  const t = text.trim();
  if (!t) return;
  state.tellable.push({
    id: `t-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    text: t,
    at: now.toISOString(),
    said: false,
  });
  if (state.tellable.length > 20) state.tellable = state.tellable.slice(-20);
}

export function isNoodleRecipe(recipe: RecipeDef): boolean {
  return /noodle|面|粉|饺|饼|包|馒头/i.test(`${recipe.id} ${recipe.name}`);
}

export function applyCookRecipe(
  state: RecipeHostState,
  recipeQuery: string,
  mode: 'eat' | 'store',
  now: Date,
  opts: { noodleBonus?: number; foodMoodBonus?: number; craftMoodBonus?: number; luckBonus?: number; roll?: number } = {},
): {
  ok: boolean;
  reason?: string;
  recipe?: RecipeDef;
  mode?: 'eat' | 'store';
  paid: number;
  cash: number;
  usedSources: string[];
  dishQty?: number;
  foodGain?: number;
  funGain?: number;
  quality?: OutputQualityId;
  qualityLabel?: string;
} {
  const recipe = findRecipe(recipeQuery);
  if (!recipe) {
    const sample = RECIPES.slice(0, 6).map((r) => r.name).join('、');
    return { ok: false, reason: `没找到叫「${recipeQuery || '空白'}」的菜谱。可以试试：${sample} 等（调 action=menu 看全部 18 道菜谱）。`, paid: 0, cash: state.money.cash, usedSources: [] };
  }

  const busyUntil = Math.max(
    state.asleepUntil ? Date.parse(state.asleepUntil) : 0,
    state.activity ? Date.parse(state.activity.until) : 0,
  );
  if (Number.isFinite(busyUntil) && busyUntil > now.getTime()) {
    return { ok: false, reason: `你这会儿正忙着「${state.activity?.label ?? '休息'}」，腾出手再下厨。`, paid: 0, cash: state.money.cash, usedSources: [] };
  }

  const ev = evaluateRecipe(state, recipe);
  if (!ev.unlocked) {
    return { ok: false, reason: `「${recipe.name}」是进阶菜谱，${ev.lockReason}。（像炭烤红薯、番茄鸡蛋汤、葱油拌面等家常简食无需厨师证就能做！）`, paid: 0, cash: state.money.cash, usedSources: [] };
  }
  if (ev.missingLabels.length > 0) {
    return { ok: false, reason: `做「${recipe.name}」还缺原料：${ev.missingLabels.join('、')}。先种菜或去养殖场收货吧。`, paid: 0, cash: state.money.cash, usedSources: [] };
  }
  if (state.money.cash < recipe.fuelCost) {
    return { ok: false, reason: `开火油盐炭火费需要 ${recipe.fuelCost} 元，手上现金不够了。`, paid: 0, cash: state.money.cash, usedSources: [] };
  }
  if (mode === 'store' && state.vitals.energy < 10) {
    return { ok: false, reason: `精力只剩 ${Math.round(state.vitals.energy)} 点了，歇一歇再起灶备菜吧。`, paid: 0, cash: state.money.cash, usedSources: [] };
  }

  const usedSources: string[] = [];
  let unitCostSum = 0;
  for (const req of recipe.ingredients) {
    const res = consumePantryByIngredient(state.pantry, req.anyOf, req.qty);
    usedSources.push(...res.sources);
    unitCostSum += res.totalUnitCost;
  }

  const cookExp = state.skills?.cooking ?? 0;
  const cookTrained = state.trained?.cooking ?? 0;
  const nowMs = now.getTime();
  const activeMoods = state.moodlets.filter((m) => Date.parse(m.expiresAt) > nowMs);
  const goodCnt = activeMoods.filter((m) => m.kind === 'good').length;
  const badCnt = activeMoods.filter((m) => m.kind === 'bad').length;
  const moodPolarity: 'good' | 'bad' | 'neutral' = goodCnt > badCnt ? 'good' : (badCnt > 0 ? 'bad' : 'neutral');
  const cookQual = rollWorkQuality(cookExp, {
    trainedCount: cookTrained,
    moodPolarity,
    luckBonus: opts.luckBonus,
    roll: opts.roll,
  });
  const qualFoodFunFactor = 1 + (cookQual.valueMult - 1) * 0.45;

  state.skills = state.skills ?? {};
  state.skills.cooking = Math.min(100, (state.skills.cooking ?? 0) + 1.5);
  if (recipe.fitnessGain && recipe.fitnessGain > 0) {
    state.fitness = Math.min(100, Math.max(5, (state.fitness ?? 25) + recipe.fitnessGain));
  }

  const noodleRaw = Number(opts.noodleBonus) || 0;
  const noodleActive = noodleRaw !== 0 && isNoodleRecipe(recipe);
  const noodlePct = noodleActive
    ? (Math.abs(noodleRaw) < 1 ? Math.max(-0.5, Math.min(2, noodleRaw)) : Math.max(-0.5, Math.min(2, noodleRaw / 100)))
    : 0;
  const effFoodGain = Math.max(1, Math.round(recipe.foodGain * (1 + noodlePct) * qualFoodFunFactor));
  const effBaseFunGain = Math.max(1, Math.round(recipe.funGain * (1 + noodlePct) * qualFoodFunFactor));
  const foodMoodDelta = normalizeMoodBonus(opts.foodMoodBonus);
  const craftMoodDelta = normalizeMoodBonus(opts.craftMoodBonus);

  if (mode === 'store') {
    const yieldQty = noodleActive ? applyYieldBonus(2, noodleRaw) : 2;
    state.money.cash -= recipe.fuelCost;
    state.money.spent += recipe.fuelCost;
    state.vitals.energy = Math.max(0, state.vitals.energy - 6);
    if (craftMoodDelta !== 0) {
      state.vitals.fun = Math.max(0, Math.min(100, (state.vitals.fun ?? 50) + craftMoodDelta));
    }
    state.cookedDishes = state.cookedDishes ?? [];
    addCookedDish(state.cookedDishes, {
      recipeId: recipe.id,
      name: recipe.name,
      qty: yieldQty,
      unitCost: Math.max(1, Math.round((unitCostSum + recipe.fuelCost) / yieldQty)),
      foodGain: effFoodGain,
      funGain: effBaseFunGain,
      ...(recipe.energyGain ? { energyGain: recipe.energyGain } : {}),
      ...(recipe.cleanGain ? { cleanGain: recipe.cleanGain } : {}),
      tier: recipe.tier,
      quality: cookQual.id,
      qualityLabel: cookQual.label,
      cookedAt: now.toISOString(),
    });
    state.moodlets = state.moodlets.filter((m) => m.source !== 'cook');
    state.moodlets.push({
      id: `m-cook-${now.getTime().toString(36)}`,
      source: 'cook',
      text: recipe.moodText,
      kind: 'good',
      expiresAt: new Date(now.getTime() + 4 * 3_600_000).toISOString(),
    });
    pushMemory(state, `用${usedSources.join('、')}做了 ${yieldQty} 份【${cookQual.label}】「${recipe.name}」，收进成品菜格留着吃或拿去鱼市街摆摊。`, now);
    state.updatedAt = now.toISOString();
    return { ok: true, recipe, mode: 'store', paid: recipe.fuelCost, cash: state.money.cash, usedSources, dishQty: yieldQty, foodGain: effFoodGain, funGain: effBaseFunGain, quality: cookQual.id, qualityLabel: cookQual.label };
  }

  // mode === 'eat'：进入耗时烹饪活动，按分钟渐进结算高饱腹高心情
  const effFunGain = Math.max(1, effBaseFunGain + foodMoodDelta + craftMoodDelta);
  const m = Math.max(10, recipe.minutes);
  const untilIso = new Date(now.getTime() + m * 60_000).toISOString();
  state.asleepFrom = '';
  state.asleepUntil = '';
  state.activity = {
    kind: 'act',
    id: 'cook',
    label: `制作并享用「${recipe.name}」（${cookQual.label}）`,
    from: now.toISOString(),
    until: untilIso,
    minutes: m,
    perMin: {
      food: effFoodGain / m,
      fun: effFunGain / m,
      energy: ((recipe.energyGain ?? -2) / m),
      clean: ((recipe.cleanGain ?? -1) / m),
    },
    costPerMin: recipe.fuelCost > 0 ? recipe.fuelCost / m : 0,
    costAcc: 0,
    costPaid: 0,
    mood: { text: recipe.moodText, kind: 'good', hours: 4 },
    scene: `家里灶台前（用${usedSources.join('、')}做${recipe.name}）`,
  };
  pushMemory(state, `用${usedSources.join('、')}开火做了【${cookQual.label}】「${recipe.name}」。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true, recipe, mode: 'eat', paid: 0, cash: state.money.cash, usedSources, foodGain: effFoodGain, funGain: effFunGain, quality: cookQual.id, qualityLabel: cookQual.label };
}

export function applyEatCookedDish(
  state: RecipeHostState,
  dishQuery: string,
  now: Date,
  opts: { foodMoodBonus?: number } = {},
): { ok: boolean; reason?: string; dishName?: string; minutes?: number } {
  const dishes = state.cookedDishes ?? [];
  if (!dishes.length) {
    return { ok: false, reason: '成品菜格里眼下空着呢，先用储物篮原料做一道菜存着吧。' };
  }
  const busyUntil = Math.max(
    state.asleepUntil ? Date.parse(state.asleepUntil) : 0,
    state.activity ? Date.parse(state.activity.until) : 0,
  );
  if (Number.isFinite(busyUntil) && busyUntil > now.getTime()) {
    return { ok: false, reason: `这会儿正忙着「${state.activity?.label ?? '休息'}」，腾出手再热饭吃。` };
  }
  const qRank = (qual?: string) => (qual === 'exquisite' ? 3 : qual === 'fine' ? 2 : qual === 'good' ? 1 : 0);
  const q = String(dishQuery || '').trim().toLowerCase();
  const matching = dishes
    .filter((d) => d.qty > 0 && (!q || d.name.toLowerCase() === q || d.recipeId.toLowerCase() === q || d.name.toLowerCase().includes(q)))
    .sort((a, b) => {
      if (q) {
        const ae = a.name.toLowerCase() === q || a.recipeId.toLowerCase() === q ? 0 : 1;
        const be = b.name.toLowerCase() === q || b.recipeId.toLowerCase() === q ? 0 : 1;
        if (ae !== be) return ae - be;
      }
      return qRank(b.quality) - qRank(a.quality);
    });
  const target = matching[0];
  if (!target) {
    return { ok: false, reason: `成品菜格里没找到「${dishQuery}」，现有：${dishes.map((d) => `${d.qualityLabel ? `【${d.qualityLabel}】` : ''}${d.name}×${d.qty}`).join('、')}。` };
  }

  consumeCookedDish(dishes, 1, target.id);
  const qualTag = target.qualityLabel ? `【${target.qualityLabel}】` : '';
  const displayName = `${qualTag}${target.name}`;
  const foodMoodDelta = normalizeMoodBonus(opts.foodMoodBonus);
  const effFunGain = Math.max(0, target.funGain + foodMoodDelta);
  const m = 20;
  state.asleepFrom = '';
  state.asleepUntil = '';
  state.activity = {
    kind: 'act',
    id: 'eat',
    label: `加热吃「${displayName}」`,
    from: now.toISOString(),
    until: new Date(now.getTime() + m * 60_000).toISOString(),
    minutes: m,
    perMin: {
      food: target.foodGain / m,
      fun: effFunGain / m,
      energy: (target.energyGain ?? 0) / m,
      clean: (target.cleanGain ?? 0) / m,
    },
    mood: { text: `热了一碗之前做的「${displayName}」，省事又合胃口`, kind: 'good', hours: 3 },
    scene: `家里餐桌前（热吃自制${displayName}）`,
  };
  pushMemory(state, `热了成品菜格里的「${displayName}」当一顿正餐。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true, dishName: displayName, minutes: m };
}

function calcCertChance(knowledge: number, need: number, moodDelta = 0): number {
  const base = !(need > 0) ? 0.9 : Math.max(0.15, Math.min(0.9, 0.15 + 0.75 * (knowledge / need)));
  if (!moodDelta) return base;
  return Math.max(0.1, Math.min(0.95, base + moodDelta));
}

export interface CareerOverview {
  currentJob: {
    id: string;
    what: string;
    daily: number;
    days: number;
    certs: string[];
  };
  knowledge: number;
  certs: {
    name: string;
    owned: boolean;
    price: number;
    need: number;
    chancePct: number;
    unlockJobs: string[];
    verifiedAt?: string;
    daysLeft?: number;
    warnNeedKnow?: boolean;
  }[];
  skills: {
    domain: SkillDomain;
    label: string;
    exp: number;
    trained: number;
    payMult: number;
    payBonusPct: number;
    odds: Record<OutputQualityId, number>;
  }[];
  gear: {
    id: string;
    name: string;
    kind: 'tool' | 'vehicle';
    price: number;
    owned: boolean;
    note: string;
  }[];
  jobs: {
    id: string;
    name: string;
    tier: JobTier;
    tierLabel: string;
    domain: SkillDomain;
    domainLabel: string;
    basePay: number;
    pay: number;
    hourlyPay: number;
    minutes: number;
    place: string;
    materialCost: number;
    outputName: string;
    qualified: boolean;
    missing: string[];
  }[];
  recipes: {
    id: string;
    name: string;
    tier: 'simple' | 'chef';
    unlocked: boolean;
    lockReason: string;
    canCook: boolean;
    foodGain: number;
    funGain: number;
    energyGain: number;
    fuelCost: number;
    minutes: number;
    suggestedPrice: number;
    ingredients: RecipeEvalResult['ingredients'];
    missingLabels: string[];
    note: string;
  }[];
  pantrySummary: { itemId: string; name: string; qty: number; kind: string }[];
  cookedDishes: CookedDishItem[];
  workOutputs: WorkOutputItem[];
  hasLicense: boolean;
}

export function buildCareerOverview(
  state: {
    job: { what: string; id: string; daily: number; certs: string[]; days: number };
    knowledge: number;
    certVerifiedAt?: Record<string, string>;
    skills?: Partial<Record<SkillDomain, number>>;
    trained?: Partial<Record<SkillDomain, number>>;
    gear?: string[];
    moodlets?: { kind: 'good' | 'bad'; expiresAt: string }[];
    pantry: PantryItem[];
    cookedDishes?: CookedDishItem[];
    workOutputs?: WorkOutputItem[];
  },
  now: Date = new Date(),
  buffs: { certPassBonus?: number; qualityLuckBonus?: number; equipPriceMult?: number } = {},
): CareerOverview {
  const ownedCerts = new Set(state.job?.certs ?? []);
  const ownedGear = new Set(state.gear ?? []);
  const know = Math.round((state.knowledge ?? 0) * 10) / 10;
  const nowMs = now.getTime();
  const activeMoods = (state.moodlets ?? []).filter((m) => Date.parse(m.expiresAt) > nowMs);
  const goodMoodCnt = activeMoods.filter((m) => m.kind === 'good').length;
  const badMoodCnt = activeMoods.filter((m) => m.kind === 'bad').length;
  const moodPolarity: 'good' | 'bad' | 'neutral' = goodMoodCnt > badMoodCnt ? 'good' : (badMoodCnt > 0 ? 'bad' : 'neutral');
  const rawPassBonus = Number(buffs.certPassBonus) || 0;
  const clampedPassBonus = Math.max(-0.3, Math.min(0.3, Number.isFinite(rawPassBonus) ? rawPassBonus : 0));
  const certMoodDelta = (moodPolarity === 'good' ? 0.08 : (moodPolarity === 'bad' ? -0.08 : 0)) + clampedPassBonus;

  const certs = CERTS.map((c) => {
    const owned = ownedCerts.has(c.name);
    const verifiedIso = owned ? (state.certVerifiedAt?.[c.name] || '') : '';
    const vMs = verifiedIso ? Date.parse(verifiedIso) : NaN;
    const daysLeft = owned && Number.isFinite(vMs)
      ? Math.max(0, Math.ceil((vMs + 30 * 86_400_000 - nowMs) / 86_400_000))
      : (owned ? 30 : undefined);
    return {
      name: c.name,
      owned,
      price: c.price,
      need: c.need,
      chancePct: Math.round(calcCertChance(know, c.need, certMoodDelta) * 100),
      unlockJobs: JOBS.filter((j) => j.cert === c.name).map((j) => j.name),
      ...(owned && verifiedIso ? { verifiedAt: verifiedIso } : {}),
      ...(owned && daysLeft !== undefined ? { daysLeft, warnNeedKnow: know < c.need } : {}),
    };
  });

  const skills = (Object.keys(SKILL_DOMAIN_LABEL) as SkillDomain[]).map((domain) => {
    const exp = Math.round(Number(state.skills?.[domain] ?? 0) * 10) / 10;
    const trained = Math.round(Number(state.trained?.[domain] ?? 0));
    const payMult = skillPayMultiplier(exp);
    return {
      domain,
      label: SKILL_DOMAIN_LABEL[domain],
      exp,
      trained,
      payMult,
      payBonusPct: Math.round((payMult - 1) * 100),
      odds: qualityOdds(exp, { trainedCount: trained, moodPolarity, luckBonus: buffs.qualityLuckBonus }),
    };
  });

  const rawEqMult = Number(buffs.equipPriceMult);
  const eqMult = Number.isFinite(rawEqMult) && rawEqMult > 0 ? Math.max(0.5, Math.min(2.0, rawEqMult)) : 1;
  const gear = EQUIP_CATALOG.map((e) => ({
    id: e.id,
    name: e.name,
    kind: e.kind,
    price: Math.max(1, Math.round(e.price * eqMult)),
    owned: ownedGear.has(e.id),
    note: e.note,
  }));

  const jobs = JOBS.map((j) => {
    const missing: string[] = [];
    if (j.cert && !ownedCerts.has(j.cert)) {
      const c = certOf(j.cert);
      missing.push(`缺${j.cert}${c ? `(¥${c.price})` : ''}`);
    }
    if (j.equip && !ownedGear.has(j.equip)) {
      const eq = findEquip(j.equip);
      missing.push(`缺${eq ? eq.name : j.equip}`);
    }
    if (j.days && state.job.days < j.days) {
      missing.push(`需出工满 ${j.days} 天(差 ${j.days - state.job.days} 天)`);
    }
    const domainExp = Number(state.skills?.[j.domain] ?? 0);
    const effPay = Math.max(1, Math.round(j.pay * skillPayMultiplier(domainExp)));
    const hourlyPay = Math.max(1, Math.round(effPay / Math.max(0.5, j.minutes / 60)));
    const outSpec = jobOutputOf(j.id);
    const placeLabel = j.place === 'anywhere' ? '随地可接' : j.place === 'destination' ? '外地短活' : '本地';
    return {
      id: j.id,
      name: j.name,
      tier: j.tier,
      tierLabel: TIER_LABEL[j.tier],
      domain: j.domain,
      domainLabel: SKILL_DOMAIN_LABEL[j.domain] ?? j.domain,
      basePay: j.pay,
      pay: effPay,
      hourlyPay,
      minutes: j.minutes,
      place: placeLabel,
      materialCost: j.materialCost ?? 0,
      outputName: outSpec?.name ?? '',
      qualified: missing.length === 0,
      missing,
    };
  });

  const recipes = evaluateAllRecipes(state).map((ev) => ({
    id: ev.recipe.id,
    name: ev.recipe.name,
    tier: ev.recipe.tier,
    unlocked: ev.unlocked,
    lockReason: ev.lockReason,
    canCook: ev.canCook,
    foodGain: ev.recipe.foodGain,
    funGain: ev.recipe.funGain,
    energyGain: ev.recipe.energyGain ?? 0,
    fuelCost: ev.recipe.fuelCost,
    minutes: ev.recipe.minutes,
    suggestedPrice: ev.recipe.suggestedPrice,
    ingredients: ev.ingredients,
    missingLabels: ev.missingLabels,
    note: ev.recipe.note,
  }));

  const pantryMap = new Map<string, { itemId: string; name: string; qty: number; kind: string }>();
  for (const p of state.pantry) {
    if (p.qty <= 0) continue;
    const inf = inferIngredientId(p.name, p.itemId);
    const id = p.itemId || inf.itemId;
    const cur = pantryMap.get(id);
    if (cur) cur.qty += p.qty;
    else pantryMap.set(id, { itemId: id, name: p.name, qty: p.qty, kind: p.kind || inf.kind });
  }

  return {
    currentJob: {
      id: state.job.id,
      what: state.job.what,
      daily: state.job.daily,
      days: state.job.days,
      certs: [...state.job.certs],
    },
    knowledge: know,
    certs,
    skills,
    gear,
    jobs,
    recipes,
    pantrySummary: [...pantryMap.values()],
    cookedDishes: [...(state.cookedDishes ?? [])],
    workOutputs: [...(state.workOutputs ?? [])].slice(-40).reverse(),
    hasLicense: ownedCerts.has('驾照'),
  };
}
