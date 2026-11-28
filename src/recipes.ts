/**
 * 烹饪菜谱、成品菜格双向联动与职业/工坊能力聚合（2026-11-25）。
 *
 * - 「家常简食（simple）」零门槛免厨师证，如炭烤红薯、椒盐烤土豆、葱油拌面、番茄鸡蛋汤等；
 * - 「厨师招牌菜（chef）」需持「厨师证」或烹饪熟练度 ≥ 20（烘焙需小烤箱或厨师证），
 *   结合储物篮里的菜园作物与鸡/牛/鱼养殖产出，回复更高且能存进成品菜格直接上鱼市街摆料理摊。
 */

import {
  addCookedDish,
  addPantryItem,
  consumeCookedDish,
  consumePantryByIngredient,
  inferIngredientId,
  pantryCountByIds,
  type CookedDishItem,
  type FarmHomeTier,
  type FarmPlot,
  type PantryItem,
} from './farm.ts';
import { CERTS, JOBS, TIER_LABEL, certOf, normalizeCityName, jobAllowedAt, type JobTier } from './jobs.ts';
import {
  applyYieldBonus, EQUIP_CATALOG, EQUIP_MAINTAIN, normalizeMoodBonus, SKILL_DOMAIN_LABEL, findEquip,
  jobMaintainKey, equipMaintainName,
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
  tier: 'simple' | 'chef' | 'feast';
  cityTag?: '兰州' | '北京';
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
      { label: '椴木鲜香菇或怀柔板栗仁', anyOf: ['mushroom', 'chestnut'], qty: 1 },
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
  // -------- 新增 27 道三档菜谱（农牧 18 + 兰州 5 + 北京 4） --------
  { id: 'chilled_melon_plate', name: '冰镇鲜切瓜果盘', aliases: ['瓜果盘', '冰镇西瓜', '切香瓜'], tier: 'simple', minutes: 15, fuelCost: 1, foodGain: 28, funGain: 11, energyGain: 2, suggestedPrice: 15, ingredients: [{ label: '脆甜香瓜或大西瓜', anyOf: ['melon', 'watermelon'], qty: 1 }], moodText: '冰爽清甜的鲜切瓜果下肚，燥意瞬间散了一半', note: '零门槛快手鲜果拼盘。' },
  { id: 'steamed_quail_custard', name: '嫩滑鹌鹑蛋羹', aliases: ['鹌鹑蛋羹', '蒸蛋羹'], tier: 'simple', minutes: 20, fuelCost: 1, foodGain: 34, funGain: 9, suggestedPrice: 15, ingredients: [{ label: '鹌鹑蛋', anyOf: ['quail_egg'], qty: 2 }, { label: '香葱与罗勒', anyOf: ['scallion'], qty: 1 }], moodText: '颤巍巍像布丁似的鹌鹑蛋羹，滴两滴香油格外鲜滑', note: '零门槛快手蒸菜。' },
  { id: 'boiled_water_caltrop', name: '盐水煮嫩菱角', aliases: ['煮菱角', '盐水菱角'], tier: 'simple', minutes: 20, fuelCost: 1, foodGain: 32, funGain: 8, suggestedPrice: 14, ingredients: [{ label: '塘边嫩菱角', anyOf: ['water_caltrop'], qty: 1 }], moodText: '一边剥菱角一边听风，粉甜脆嫩带着浅塘清气', note: '零门槛水乡小食。' },
  { id: 'fresh_soy_milk', name: '现磨香浓热豆浆', aliases: ['热豆浆', '现磨豆浆'], tier: 'simple', minutes: 20, fuelCost: 1, foodGain: 26, funGain: 8, energyGain: 4, suggestedPrice: 13, ingredients: [{ label: '金粒黄豆', anyOf: ['soybean'], qty: 1 }], moodText: '刚滤好的热豆浆醇香顺滑，捧在手里暖和极了', note: '零门槛早点，兼顾微补精力。' },
  { id: 'honey_stewed_pear', name: '蜂蜜冰糖炖雪梨', aliases: ['冰糖炖梨', '炖雪梨'], tier: 'simple', minutes: 30, fuelCost: 2, foodGain: 30, funGain: 12, energyGain: 3, suggestedPrice: 20, ingredients: [{ label: '冰糖翠冠梨或兰州甜百合干', anyOf: ['pear', 'lily_dry'], qty: 1 }, { label: '百花蜜', anyOf: ['honey'], qty: 1 }], moodText: '清甜润喉的炖雪梨带着淡淡花蜜香，喝完嗓子舒服多了', note: '零门槛清润甜汤。' },
  { id: 'purple_yam_porridge', name: '紫薯糯香杂粮粥', aliases: ['紫薯粥', '杂粮粥'], tier: 'simple', minutes: 30, fuelCost: 2, foodGain: 40, funGain: 9, suggestedPrice: 18, ingredients: [{ label: '紫心糯紫薯或怀柔板栗仁', anyOf: ['purple_yam', 'chestnut'], qty: 1 }, { label: '稻谷或冬小麦', anyOf: ['rice', 'wheat'], qty: 1 }], moodText: '熬出淡淡紫色的热粥软糯清甜，喝一碗格外踏实', note: '零门槛高饱腹主食粥。' },
  { id: 'lz_huizhou_bean', name: '冰镇灰豆子', aliases: ['灰豆子', '兰州灰豆子'], tier: 'simple', cityTag: '兰州', minutes: 30, fuelCost: 1, foodGain: 32, funGain: 11, energyGain: 2, suggestedPrice: 14, ingredients: [{ label: '金粒黄豆', anyOf: ['soybean'], qty: 1 }, { label: '百花蜜或红枣糖', anyOf: ['honey', 'rice'], qty: 1 }], moodText: '绵沙清甜的一碗灰豆子，冬暖夏凉最解馋', note: '兰州经典平价甜粥。' },
  { id: 'lz_milk_egg_laozao', name: '牛奶鸡蛋醪糟', aliases: ['鸡蛋醪糟', '牛奶醪糟'], tier: 'simple', cityTag: '兰州', minutes: 20, fuelCost: 2, foodGain: 38, funGain: 16, energyGain: 4, suggestedPrice: 19, ingredients: [{ label: '鲜牛奶', anyOf: ['milk'], qty: 1 }, { label: '鲜鸡蛋', anyOf: ['egg'], qty: 1 }, { label: '水乡稻谷', anyOf: ['rice'], qty: 1 }], moodText: '奶香裹着微甜酒酿和细嫩蛋花，夜里喝一碗满心治愈', note: '兰州夜市人气暖饮，情绪回馈极佳。' },
  { id: 'lz_jiangshui_noodle', name: '爽口浆水面', aliases: ['浆水面', '酸菜浆水面'], tier: 'simple', cityTag: '兰州', minutes: 25, fuelCost: 2, foodGain: 40, funGain: 12, suggestedPrice: 16, ingredients: [{ label: '黄金冬小麦', anyOf: ['wheat'], qty: 1 }, { label: '绿叶时蔬', anyOf: ['bokchoy', 'spinach', 'cabbage'], qty: 1 }, { label: '香葱与罗勒', anyOf: ['scallion'], qty: 1 }], moodText: '微酸清爽的浆水汤头一泼，连汤带面嗦得干干净净', note: '兰州夏日解腻主力，自动触发面食加成。' },

  { id: 'crucian_tofu_soup', name: '奶白嫩鲫鱼豆腐汤', aliases: ['鲫鱼汤', '嫩鲫鱼豆腐汤'], tier: 'chef', minutes: 50, fuelCost: 3, foodGain: 56, funGain: 15, energyGain: 4, suggestedPrice: 38, ingredients: [{ label: '鲜鲫鱼', anyOf: ['crucian_fish'], qty: 1 }, { label: '金粒黄豆', anyOf: ['soybean'], qty: 1 }, { label: '香葱与罗勒', anyOf: ['scallion'], qty: 1 }], moodText: '小火滚出雪白浓汤，鲜鲫鱼配嫩豆腐一口入魂', note: '厨师招牌塘鲜汤品。' },
  { id: 'stir_river_shrimp', name: '碧绿清炒青虾仁', aliases: ['清炒虾仁', '炒青虾'], tier: 'chef', minutes: 40, fuelCost: 3, foodGain: 50, funGain: 16, energyGain: 3, suggestedPrice: 40, ingredients: [{ label: '鲜青虾', anyOf: ['river_shrimp'], qty: 1 }, { label: '脆茭白或香葱', anyOf: ['wild_rice_stem', 'scallion'], qty: 1 }], moodText: '晶莹弹牙的青虾仁点缀脆嫩茭白，清鲜得恰到好处', note: '水乡快火小炒硬菜。' },
  { id: 'braised_bamboo_pork', name: '浓油焖茭白五花', aliases: ['油焖茭白', '茭白炒肉'], tier: 'chef', minutes: 50, fuelCost: 3, foodGain: 58, funGain: 15, energyGain: 3, suggestedPrice: 42, ingredients: [{ label: '水乡脆茭白', anyOf: ['wild_rice_stem'], qty: 1 }, { label: '冷鲜五花排骨', anyOf: ['pork'], qty: 1 }], moodText: '吸饱红烧肉汁的脆茭白油亮咸甜，配米饭香极了', note: '消化黑猪冷鲜肉与浅滩茭白的下饭王。' },
  { id: 'peach_seared_duck', name: '嫩煎蜜桃鸭胸肉', aliases: ['香煎鸭胸', '蜜桃鸭胸'], tier: 'chef', minutes: 45, fuelCost: 4, foodGain: 54, funGain: 17, energyGain: 4, suggestedPrice: 44, ingredients: [{ label: '冷鲜鸭胸肉', anyOf: ['duck_meat'], qty: 1 }, { label: '粉嫩水蜜桃', anyOf: ['peach'], qty: 1 }], moodText: '鸭皮煎得酥香不腻，配焦糖微烤的水蜜桃果香四溢', note: '果肉搭配的精致厨师料理。' },
  { id: 'duck_egg_gold_noodle', name: '咸蛋黄流沙拌面', aliases: ['蛋黄拌面', '流沙面'], tier: 'chef', minutes: 40, fuelCost: 3, foodGain: 54, funGain: 16, energyGain: 2, suggestedPrice: 36, ingredients: [{ label: '青壳鸭蛋', anyOf: ['duck_egg'], qty: 1 }, { label: '黄金冬小麦', anyOf: ['wheat'], qty: 1 }, { label: '香葱与罗勒', anyOf: ['scallion'], qty: 1 }], moodText: '起沙流油的鸭蛋黄裹满筋道面条，香气直往鼻子里钻', note: '自动触发面食加成。' },
  { id: 'blueberry_goat_pancake', name: '蓝莓羊奶松饼', aliases: ['蓝莓松饼', '羊奶松饼'], tier: 'chef', minutes: 45, fuelCost: 3, foodGain: 46, funGain: 19, energyGain: 3, suggestedPrice: 40, ingredients: [{ label: '爆浆蓝莓', anyOf: ['blueberry'], qty: 1 }, { label: '鲜羊奶', anyOf: ['goat_milk'], qty: 1 }, { label: '黄金冬小麦', anyOf: ['wheat'], qty: 1 }], moodText: '蓬松温热的羊奶松饼盖满爆浆蓝莓，像把下午茶搬回家', note: '自动触发面饼加成，高娱乐甜品餐。' },
  { id: 'lz_beef_noodle', name: '一清二白牛肉面', aliases: ['兰州牛肉面', '牛肉面', '拉面'], tier: 'chef', cityTag: '兰州', minutes: 45, fuelCost: 3, foodGain: 58, funGain: 15, energyGain: 4, suggestedPrice: 36, ingredients: [{ label: '黄金冬小麦', anyOf: ['wheat'], qty: 1 }, { label: '精选牛肉', anyOf: ['beef'], qty: 1 }, { label: '水润白萝卜', anyOf: ['radish'], qty: 1 }, { label: '香葱与罗勒', anyOf: ['scallion'], qty: 1 }], moodText: '汤清萝卜白、辣油红亮面筋道，一碗下肚满身热气', note: '兰州头牌面食，自动触发面食加成。' },
  { id: 'bj_zhajiang_noodle', name: '老北京小碗干炸酱面', aliases: ['炸酱面', '老北京炸酱面'], tier: 'chef', cityTag: '北京', minutes: 45, fuelCost: 3, foodGain: 56, funGain: 16, energyGain: 3, suggestedPrice: 38, ingredients: [{ label: '黄金冬小麦', anyOf: ['wheat'], qty: 1 }, { label: '冷鲜五花排骨', anyOf: ['pork'], qty: 1 }, { label: '黄豆或京式甜面酱', anyOf: ['soybean', 'sweet_sauce'], qty: 1 }], moodText: '浓香小碗干炸酱拌上脆爽菜码，越嚼越有老胡同味儿', note: '北京特色家常面，自动触发面食加成。' },
  { id: 'bj_mending_pie', name: '现烙门钉肉饼', aliases: ['门钉肉饼', '牛肉馅饼'], tier: 'chef', cityTag: '北京', minutes: 40, fuelCost: 3, foodGain: 58, funGain: 15, energyGain: 4, suggestedPrice: 36, ingredients: [{ label: '黄金冬小麦', anyOf: ['wheat'], qty: 1 }, { label: '精选牛肉', anyOf: ['beef'], qty: 1 }, { label: '香葱与罗勒', anyOf: ['scallion'], qty: 1 }], moodText: '焦脆薄皮里兜着鲜烫葱香牛肉汤汁，咬一口格外解馋', note: '北京经典面饼，自动触发面食加成。' },

  { id: 'steamed_mandarin_fish', name: '清蒸芦花肥鳜鱼', aliases: ['清蒸鳜鱼', '肥鳜鱼'], tier: 'feast', minutes: 60, fuelCost: 5, foodGain: 68, funGain: 22, energyGain: 6, suggestedPrice: 68, ingredients: [{ label: '肥鳜鱼', anyOf: ['mandarin_fish'], qty: 1 }, { label: '香葱与罗勒', anyOf: ['scallion'], qty: 1 }, { label: '金粒黄豆', anyOf: ['soybean'], qty: 1 }], moodText: '蒜瓣似的鳜鱼肉鲜嫩清甜，满屋都是芦花塘的宴客鲜香', note: '三档私房主厨顶配水产硬菜。' },
  { id: 'lotus_pork_rib_soup', name: '荷香莲藕排骨老火汤', aliases: ['莲藕排骨汤', '藕汤'], tier: 'feast', minutes: 65, fuelCost: 5, foodGain: 70, funGain: 20, energyGain: 8, suggestedPrice: 62, ingredients: [{ label: '浅滩嫩莲藕', anyOf: ['lotus'], qty: 1 }, { label: '冷鲜五花排骨', anyOf: ['pork'], qty: 1 }, { label: '水润白萝卜或怀柔板栗仁', anyOf: ['radish', 'chestnut'], qty: 1 }], moodText: '粉藕拉丝、排骨酥软，浓醇热汤把一整天的疲惫都抚平了', note: '三档私房主厨顶饱回精力大汤。' },
  { id: 'pigeon_lotus_tonic', name: '慢炖老鸽莲藕滋补盅', aliases: ['老鸽汤', '老鸽炖盅'], tier: 'feast', minutes: 70, fuelCost: 5, foodGain: 66, funGain: 20, energyGain: 9, fitnessGain: 0.3, suggestedPrice: 66, ingredients: [{ label: '冷鲜老鸽食材', anyOf: ['pigeon_meat'], qty: 1 }, { label: '浅滩嫩莲藕或兰州甜百合干', anyOf: ['lotus', 'lily_dry'], qty: 1 }, { label: '椴木鲜香菇', anyOf: ['mushroom'], qty: 1 }], moodText: '清澈金黄的慢炖滋补汤，喝完手脚温热元气满满', note: '三档主厨滋补炖盅，兼顾补体能。' },
  { id: 'fig_goat_cheese_bread', name: '无花果羊奶酪欧包', aliases: ['无花果欧包', '奶酪欧包'], tier: 'feast', needEquip: 'oven', minutes: 60, fuelCost: 5, foodGain: 56, funGain: 26, energyGain: 5, suggestedPrice: 58, ingredients: [{ label: '蜜汁无花果', anyOf: ['fig'], qty: 1 }, { label: '黄金冬小麦', anyOf: ['wheat'], qty: 1 }, { label: '鲜羊奶', anyOf: ['goat_milk'], qty: 1 }], moodText: '刚出窑炉的麦香欧包切开满是无花果与奶酪香，幸福感溢出来', note: '需厨师证、烹饪≥40 与家用小烤箱。' },
  { id: 'loquat_kumquat_brew', name: '枇杷金桔蜜渍冰酿', aliases: ['枇杷冰酿', '金桔冰饮'], tier: 'feast', minutes: 45, fuelCost: 4, foodGain: 36, funGain: 28, energyGain: 6, suggestedPrice: 54, ingredients: [{ label: '黄金枇杷', anyOf: ['loquat'], qty: 1 }, { label: '蜜香小金桔', anyOf: ['kumquat'], qty: 1 }, { label: '百花蜜', anyOf: ['honey'], qty: 1 }, { label: '清凉薄荷', anyOf: ['mint'], qty: 1 }], moodText: '琥珀色果酿冰凉清润，花蜜与柑橘香气在舌尖久久不散', note: '三档私房主厨超高情绪特饮。' },
  { id: 'persimmon_osmanthus_tart', name: '霜降甜柿桂花千层酥', aliases: ['甜柿千层酥', '桂花甜柿塔'], tier: 'feast', needEquip: 'oven', minutes: 60, fuelCost: 5, foodGain: 48, funGain: 30, energyGain: 4, suggestedPrice: 64, ingredients: [{ label: '红灯甜柿子', anyOf: ['persimmon'], qty: 1 }, { label: '黄金冬小麦', anyOf: ['wheat'], qty: 1 }, { label: '鲜鸡蛋或青壳鸭蛋', anyOf: ['egg', 'duck_egg'], qty: 1 }, { label: '洋甘菊与桂花', anyOf: ['chamomile'], qty: 1 }], moodText: '层层掉渣的金黄酥皮托着蜜甜柿肉与桂花香，堪称私房绝作', note: '需厨师证、烹饪≥40 与家用小烤箱，娱乐拉满。' },
  { id: 'lz_hand_mutton', name: '椒盐手抓羔羊肉', aliases: ['手抓羊肉', '兰州手抓'], tier: 'feast', cityTag: '兰州', minutes: 65, fuelCost: 5, foodGain: 68, funGain: 22, energyGain: 6, suggestedPrice: 66, ingredients: [{ label: '冷鲜精选羊肉', anyOf: ['mutton'], qty: 1 }, { label: '香葱与罗勒或花椒', anyOf: ['scallion', 'spice_pack'], qty: 1 }], moodText: '鲜嫩不膻的羔羊肉蘸一点椒盐，大口吃肉满身暖洋洋', note: '兰州待客硬菜，消化奶山羊冷鲜羊肉。' },
  { id: 'bj_roast_duck_wrap', name: '焦脆烤鸭荷叶卷', aliases: ['烤鸭卷饼', '烤鸭荷叶卷'], tier: 'feast', cityTag: '北京', needEquip: 'oven', minutes: 60, fuelCost: 5, foodGain: 64, funGain: 24, energyGain: 5, suggestedPrice: 64, ingredients: [{ label: '冷鲜鸭胸肉', anyOf: ['duck_meat'], qty: 1 }, { label: '黄金冬小麦', anyOf: ['wheat'], qty: 1 }, { label: '香葱与罗勒', anyOf: ['scallion'], qty: 1 }], moodText: '薄韧春饼卷上酥脆鸭片与葱丝甜酱，满口京味满足感', note: '北京招牌私房菜，自动触发面饼加成。' },
  { id: 'bj_copper_hotpot', name: '炭火铜锅涮鲜羊肉', aliases: ['铜锅涮肉', '老北京涮羊肉'], tier: 'feast', cityTag: '北京', minutes: 65, fuelCost: 5, foodGain: 72, funGain: 26, energyGain: 7, suggestedPrice: 68, ingredients: [{ label: '冷鲜精选羊肉', anyOf: ['mutton'], qty: 1 }, { label: '黄心大白菜', anyOf: ['cabbage'], qty: 1 }, { label: '水润白萝卜', anyOf: ['radish'], qty: 1 }], moodText: '清水滚锅涮出鲜嫩羊肉配热气腾腾的大白菜，冬日顶配享受', note: '北京冬日招牌大餐。' },
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
  const hasChefCert = certs.includes('厨师证');
  if (recipe.tier === 'feast') {
    if (!hasChefCert || cookExp < 40) {
      unlocked = false;
      lockReason = '私房主厨宴需持「厨师证」且烹饪熟练度 ≥ 40';
    } else if (recipe.needEquip && !gear.includes(recipe.needEquip)) {
      const eq = findEquip(recipe.needEquip);
      unlocked = false;
      lockReason = `需要添置「${eq ? eq.name : recipe.needEquip}」`;
    }
  } else if (recipe.tier === 'chef') {
    if (!hasChefCert && cookExp < 20) {
      unlocked = false;
      lockReason = '需要「厨师证」或烹饪熟练度 ≥ 20';
    } else if (recipe.needEquip && !gear.includes(recipe.needEquip) && !hasChefCert) {
      const eq = findEquip(recipe.needEquip);
      unlocked = false;
      lockReason = `需要添置「${eq ? eq.name : recipe.needEquip}」或持「厨师证」`;
    }
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
    return { ok: false, reason: `没找到叫「${recipeQuery || '空白'}」的菜谱。可以试试：${sample} 等（调 action=menu 看全部 ${RECIPES.length} 道菜谱）。`, paid: 0, cash: state.money.cash, usedSources: [] };
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

function addWorkOutputEntry(
  outputs: WorkOutputItem[],
  item: Omit<WorkOutputItem, 'id' | 'count'>,
): WorkOutputItem {
  const hit = outputs.find((x) => x.jobId === item.jobId && x.name === item.name && x.quality === item.quality);
  if (hit) {
    hit.count += 1;
    hit.value = Math.max(hit.value, item.value);
    hit.createdAt = item.createdAt;
    return hit;
  }
  const row: WorkOutputItem = {
    id: `wo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    count: 1,
    ...item,
  };
  outputs.push(row);
  if (outputs.length > 80) outputs.splice(0, outputs.length - 80);
  return row;
}

export type WorkbenchStation = 'tea' | 'weave' | 'photo' | 'book' | 'agro';

export interface WorkbenchRecipeDef {
  id: string;
  station: WorkbenchStation;
  stationLabel: string;
  domain: SkillDomain;
  name: string;
  aliases: readonly string[];
  unlockAny: readonly { cert?: string; equip?: string; minExp?: number }[];
  ingredients: readonly RecipeIngredientReq[];
  materialCost: number;
  minutes: number;
  energyCost: number;
  suggestedPrice: number;
  stallCategory: 'produce' | 'food' | 'craft' | 'writing' | 'photo';
  selfUse?: {
    foodGain?: number;
    funGain?: number;
    energyGain?: number;
    knowGain?: number;
    moodText?: string;
    moodHours?: number;
    farmBoost?: 'fertilizer' | 'fish_bait';
  };
  note: string;
}

export const WORKBENCH_RECIPES: readonly WorkbenchRecipeDef[] = [
  { id: 'wb_calm_tea', station: 'tea', stationLabel: '茶饮焙香台', domain: 'cooking', name: '薄荷洋甘菊安神茶包', aliases: ['安神茶包', '洋甘菊茶'], unlockAny: [{ cert: '茶艺咖啡证' }, { equip: 'coffee_kit' }, { minExp: 15 }], ingredients: [{ label: '清凉薄荷', anyOf: ['mint'], qty: 1 }, { label: '洋甘菊与桂花', anyOf: ['chamomile'], qty: 1 }], materialCost: 3, minutes: 30, energyCost: 5, suggestedPrice: 34, stallCategory: 'food', selfUse: { funGain: 12, energyGain: 6, moodText: '冲一杯清雅安神花茶，紧绷的神经松快了不少', moodHours: 4 }, note: '自饮缓疲劳或摆摊。' },
  { id: 'wb_fruit_coldbrew', station: 'tea', stationLabel: '茶饮焙香台', domain: 'cooking', name: '蜜桃蓝莓冷萃果茶', aliases: ['冷萃果茶', '蜜桃果茶'], unlockAny: [{ cert: '茶艺咖啡证' }, { equip: 'coffee_kit' }, { minExp: 15 }], ingredients: [{ label: '粉嫩水蜜桃', anyOf: ['peach'], qty: 1 }, { label: '爆浆蓝莓', anyOf: ['blueberry'], qty: 1 }], materialCost: 4, minutes: 25, energyCost: 4, suggestedPrice: 38, stallCategory: 'food', selfUse: { foodGain: 16, funGain: 14, moodText: '冰沁果茶满口桃香蓝莓甜，神清气爽', moodHours: 4 }, note: '快周转高颜值冷饮。' },
  { id: 'wb_loquat_paste', station: 'tea', stationLabel: '茶饮焙香台', domain: 'cooking', name: '枇杷金桔润喉膏', aliases: ['枇杷膏', '润喉膏'], unlockAny: [{ cert: '茶艺咖啡证' }, { equip: 'coffee_kit' }, { minExp: 15 }], ingredients: [{ label: '黄金枇杷或兰州甜百合干', anyOf: ['loquat', 'lily_dry'], qty: 1 }, { label: '蜜香小金桔', anyOf: ['kumquat'], qty: 1 }, { label: '百花蜜', anyOf: ['honey'], qty: 1 }], materialCost: 6, minutes: 50, energyCost: 7, suggestedPrice: 62, stallCategory: 'food', selfUse: { funGain: 15, energyGain: 8, moodText: '温水化开一勺自熬枇杷金桔膏，喉咙温润舒服', moodHours: 5 }, note: '高毛利养生手作。' },
  { id: 'wb_fruit_vinegar', station: 'tea', stationLabel: '茶饮焙香台', domain: 'cooking', name: '杨梅紫葡萄手工果醋', aliases: ['手工果醋', '杨梅果醋'], unlockAny: [{ cert: '茶艺咖啡证' }, { equip: 'coffee_kit' }, { minExp: 15 }], ingredients: [{ label: '紫红杨梅或巨峰葡萄', anyOf: ['yangmei', 'grape'], qty: 2 }], materialCost: 5, minutes: 40, energyCost: 6, suggestedPrice: 54, stallCategory: 'food', selfUse: { foodGain: 14, funGain: 12, moodText: '酸甜柔和的手工果醋格外开胃', moodHours: 4 }, note: '消化高产水果。' },
  { id: 'wb_beeswax_candle', station: 'tea', stationLabel: '茶饮焙香台', domain: 'cooking', name: '芦花蜂蜡香薰蜡烛', aliases: ['香薰蜡烛', '蜂蜡蜡烛'], unlockAny: [{ cert: '茶艺咖啡证' }, { equip: 'coffee_kit' }, { minExp: 15 }], ingredients: [{ label: '天然蜂蜡', anyOf: ['beeswax'], qty: 1 }, { label: '洋甘菊桂花或金桔', anyOf: ['chamomile', 'kumquat'], qty: 1 }], materialCost: 6, minutes: 40, energyCost: 6, suggestedPrice: 56, stallCategory: 'craft', selfUse: { funGain: 16, moodText: '点亮手作蜂蜡蜡烛，暖黄烛光里浮着淡淡花果甜香', moodHours: 6 }, note: '自用得 6 小时舒心状态或挂手作摊。' },

  { id: 'wb_wool_coaster', station: 'weave', stationLabel: '织造手作台', domain: 'craft', name: '软羊毛针织杯垫', aliases: ['羊毛杯垫', '针织杯垫'], unlockAny: [{ equip: 'sewing' }, { minExp: 10 }], ingredients: [{ label: '软绵羊毛', anyOf: ['wool'], qty: 1 }], materialCost: 3, minutes: 35, energyCost: 6, suggestedPrice: 38, stallCategory: 'craft', note: '轻门槛稳定羊毛手作。' },
  { id: 'wb_rabbit_scarf', station: 'weave', stationLabel: '织造手作台', domain: 'craft', name: '安哥拉兔绒软围巾', aliases: ['兔绒围巾', '软围巾'], unlockAny: [{ equip: 'sewing' }, { minExp: 10 }], ingredients: [{ label: '细软兔绒', anyOf: ['rabbit_fur'], qty: 2 }], materialCost: 6, minutes: 55, energyCost: 9, suggestedPrice: 76, stallCategory: 'craft', note: '高毛利暖冬织造爆品。' },
  { id: 'wb_goose_pillow', station: 'weave', stationLabel: '织造手作台', domain: 'craft', name: '鹅绒绵软小抱枕', aliases: ['鹅绒抱枕', '小抱枕'], unlockAny: [{ equip: 'sewing' }, { minExp: 10 }], ingredients: [{ label: '蓬松落羽绒', anyOf: ['goose_down'], qty: 2 }], materialCost: 8, minutes: 50, energyCost: 8, suggestedPrice: 72, stallCategory: 'craft', selfUse: { funGain: 14, energyGain: 6, moodText: '抱着亲手缝的蓬松鹅绒抱枕歇了会儿，格外解乏', moodHours: 5 }, note: '消化落羽绒，可自用可摆摊。' },
  { id: 'wb_pearl_bookmark', station: 'weave', stationLabel: '织造手作台', domain: 'craft', name: '蚕丝淡珠手工书签', aliases: ['珍珠书签', '蚕丝书签'], unlockAny: [{ equip: 'sewing' }, { minExp: 10 }], ingredients: [{ label: '淡水小珍珠', anyOf: ['pearl'], qty: 1 }, { label: '羽化空蚕茧', anyOf: ['silk_cocoon'], qty: 1 }], materialCost: 5, minutes: 35, energyCost: 6, suggestedPrice: 68, stallCategory: 'craft', note: '河蚌珍珠与蚕茧的核心高溢价消化口。' },
  { id: 'wb_lz_painted_gourd', station: 'weave', stationLabel: '织造手作台', domain: 'craft', name: '彩绘刻花小葫芦', aliases: ['刻葫芦', '彩绘葫芦'], unlockAny: [{ equip: 'sewing' }, { minExp: 10 }], ingredients: [{ label: '素面小葫芦坯', anyOf: ['lz_gourd_blank'], qty: 1 }], materialCost: 6, minutes: 45, energyCost: 7, suggestedPrice: 64, stallCategory: 'craft', selfUse: { knowGain: 1, funGain: 10 }, note: '兰州非遗特产深加工摆件。' },
  { id: 'wb_bj_painted_tuer', station: 'weave', stationLabel: '织造手作台', domain: 'craft', name: '手绘金线兔儿爷摆件', aliases: ['彩绘兔儿爷', '兔儿爷摆件'], unlockAny: [{ equip: 'sewing' }, { minExp: 10 }], ingredients: [{ label: '素坯兔儿爷彩绘套', anyOf: ['bj_tuer_blank'], qty: 1 }], materialCost: 6, minutes: 50, energyCost: 8, suggestedPrice: 74, stallCategory: 'craft', selfUse: { knowGain: 1, funGain: 12 }, note: '北京非遗特产深加工摆件。' },

  { id: 'wb_cyanotype_art', station: 'photo', stationLabel: '暗房影像台', domain: 'photo', name: '水乡植物手工蓝晒画', aliases: ['蓝晒画', '植物蓝晒'], unlockAny: [{ equip: 'camera' }, { cert: '摄影证' }, { minExp: 10 }], ingredients: [{ label: '薄荷、桂花或菱角', anyOf: ['mint', 'chamomile', 'water_caltrop'], qty: 1 }], materialCost: 10, minutes: 45, energyCost: 7, suggestedPrice: 58, stallCategory: 'photo', note: '农植与影像跨界的高颜值作品。' },
  { id: 'wb_film_postcards', station: 'photo', stationLabel: '暗房影像台', domain: 'photo', name: '芦花四季胶片明信片套', aliases: ['胶片明信片', '四季明信片'], unlockAny: [{ equip: 'camera' }, { cert: '摄影证' }, { minExp: 10 }], ingredients: [], materialCost: 12, minutes: 40, energyCost: 7, suggestedPrice: 48, stallCategory: 'photo', note: '无需农产，纯相纸冲扫手作。' },
  { id: 'wb_polaroid_frame', station: 'photo', stationLabel: '暗房影像台', domain: 'photo', name: '拍立得木框风光摆件', aliases: ['木框摆件', '风光相框'], unlockAny: [{ equip: 'camera' }, { cert: '摄影证' }, { minExp: 10 }], ingredients: [], materialCost: 16, minutes: 50, energyCost: 8, suggestedPrice: 66, stallCategory: 'photo', selfUse: { knowGain: 1 }, note: '高品质摆摊溢价高，制作顺带涨见识。' },

  { id: 'wb_silk_journal', station: 'book', stationLabel: '书案装帧台', domain: 'writing', name: '蚕丝线装精裱手账本', aliases: ['线装手账', '蚕丝手账本'], unlockAny: [{ equip: 'computer' }, { minExp: 10 }], ingredients: [{ label: '羽化空蚕茧', anyOf: ['silk_cocoon'], qty: 1 }], materialCost: 10, minutes: 45, energyCost: 7, suggestedPrice: 58, stallCategory: 'writing', note: '消化空蚕茧的常青文创。' },
  { id: 'wb_wax_book_sample', station: 'book', stationLabel: '书案装帧台', domain: 'writing', name: '蜂蜡护封旧书修补样册', aliases: ['旧书样册', '蜂蜡护封册'], unlockAny: [{ equip: 'computer' }, { minExp: 10 }], ingredients: [{ label: '天然蜂蜡', anyOf: ['beeswax'], qty: 1 }], materialCost: 8, minutes: 45, energyCost: 7, suggestedPrice: 54, stallCategory: 'writing', selfUse: { knowGain: 1.5 }, note: '修书静心活，顺带涨见识。' },
  { id: 'wb_solar_zine', station: 'book', stationLabel: '书案装帧台', domain: 'writing', name: '芦花节气风物手抄小志', aliases: ['手抄小志', '节气小志'], unlockAny: [{ equip: 'computer' }, { minExp: 10 }], ingredients: [], materialCost: 10, minutes: 50, energyCost: 8, suggestedPrice: 52, stallCategory: 'writing', note: '随时随地可做，适合旅途前后整理随笔。' },

  { id: 'wb_organic_fertilizer', station: 'agro', stationLabel: '农牧自制台', domain: 'labor', name: '豆渣果皮有机花肥', aliases: ['有机花肥', '自制花肥'], unlockAny: [], ingredients: [{ label: '黄豆或任意瓜果', anyOf: ['soybean', 'melon', 'watermelon', 'pear', 'peach', 'persimmon'], qty: 1 }], materialCost: 2, minutes: 25, energyCost: 5, suggestedPrice: 22, stallCategory: 'produce', selfUse: { farmBoost: 'fertilizer' }, note: '零门槛自制，给菜地施用缩短 15% 熟期或外售。' },
  { id: 'wb_fish_bait', station: 'agro', stationLabel: '农牧自制台', domain: 'labor', name: '玉米豆香复合鱼饵', aliases: ['复合鱼饵', '自制鱼饵'], unlockAny: [], ingredients: [{ label: '水果甜玉米', anyOf: ['corn'], qty: 1 }, { label: '金粒黄豆', anyOf: ['soybean'], qty: 1 }], materialCost: 1, minutes: 25, energyCost: 5, suggestedPrice: 24, stallCategory: 'produce', selfUse: { farmBoost: 'fish_bait' }, note: '零门槛自制，可抵扣鱼塘/禽舍喂食现金支出。' },
  { id: 'wb_cured_delicacy', station: 'agro', stationLabel: '农牧自制台', domain: 'labor', name: '风干青鱼干与慢晒柿饼', aliases: ['青鱼干', '甜柿饼', '慢晒柿饼'], unlockAny: [], ingredients: [{ label: '肥青鱼或红灯甜柿子', anyOf: ['black_carp', 'persimmon'], qty: 1 }], materialCost: 4, minutes: 40, energyCost: 6, suggestedPrice: 60, stallCategory: 'food', note: '零门槛深加工，把长周期产物转为高溢价干货。' },
];

export interface WorkbenchEvalResult {
  recipe: WorkbenchRecipeDef;
  unlocked: boolean;
  lockReason: string;
  canCraft: boolean;
  ingredients: RecipeEvalResult['ingredients'];
  missingLabels: string[];
}

export function findWorkbenchRecipe(q: string): WorkbenchRecipeDef | null {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return null;
  return WORKBENCH_RECIPES.find((r) =>
    r.id.toLowerCase() === s
    || r.name.toLowerCase() === s
    || r.name.toLowerCase().includes(s)
    || r.aliases.some((a) => a.toLowerCase() === s || s.includes(a.toLowerCase())),
  ) ?? null;
}

export function evaluateWorkbenchRecipe(
  state: { job: { certs: string[] }; skills?: Partial<Record<SkillDomain, number>>; gear?: string[]; pantry: PantryItem[] },
  wb: WorkbenchRecipeDef,
): WorkbenchEvalResult {
  const certs = state.job?.certs ?? [];
  const gear = Array.isArray(state.gear) ? state.gear : [];
  const exp = Number(state.skills?.[wb.domain] ?? 0);

  let unlocked = wb.unlockAny.length === 0;
  if (!unlocked) {
    unlocked = wb.unlockAny.some((cond) => {
      if (cond.cert && !certs.includes(cond.cert)) return false;
      if (cond.equip && !gear.includes(cond.equip)) return false;
      if (cond.minExp !== undefined && exp < cond.minExp) return false;
      return true;
    });
  }
  const lockReason = unlocked
    ? ''
    : `满足任一即可：${wb.unlockAny.map((cond) => {
      if (cond.cert) return `持「${cond.cert}」`;
      if (cond.equip) return `有「${findEquip(cond.equip)?.name ?? cond.equip}」`;
      return `${SKILL_DOMAIN_LABEL[wb.domain]}熟练度 ≥ ${cond.minExp}`;
    }).join(' / ')}`;

  const ingredients = wb.ingredients.map((req) => {
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
  const canCraft = unlocked && missingLabels.length === 0;
  return { recipe: wb, unlocked, lockReason, canCraft, ingredients, missingLabels };
}

export function evaluateAllWorkbenchRecipes(
  state: { job: { certs: string[] }; skills?: Partial<Record<SkillDomain, number>>; gear?: string[]; pantry: PantryItem[] },
): WorkbenchEvalResult[] {
  return WORKBENCH_RECIPES.map((wb) => evaluateWorkbenchRecipe(state, wb));
}

export function applyWorkbenchCraft(
  state: RecipeHostState & { farm?: { plots: FarmPlot[] }; knowledge: number },
  query: string,
  mode: 'store' | 'use',
  now: Date,
  opts: { luckBonus?: number; craftMoodBonus?: number; roll?: number } = {},
): {
  ok: boolean;
  reason?: string;
  recipe?: WorkbenchRecipeDef;
  mode?: 'store' | 'use';
  paid: number;
  cash: number;
  usedSources: string[];
  qualityLabel?: string;
  outputItem?: WorkOutputItem;
  effectText?: string;
} {
  const wb = findWorkbenchRecipe(query);
  if (!wb) {
    const sample = WORKBENCH_RECIPES.slice(0, 6).map((x) => x.name).join('、');
    return { ok: false, reason: `没找到工作台配方「${query || '空白'}」。可以试试：${sample} 等（共 ${WORKBENCH_RECIPES.length} 项）。`, paid: 0, cash: state.money.cash, usedSources: [] };
  }
  const busyUntil = Math.max(
    state.asleepUntil ? Date.parse(state.asleepUntil) : 0,
    state.activity ? Date.parse(state.activity.until) : 0,
  );
  if (Number.isFinite(busyUntil) && busyUntil > now.getTime()) {
    return { ok: false, reason: `你这会儿正忙着「${state.activity?.label ?? '休息'}」，腾出手再在工作台动手。`, paid: 0, cash: state.money.cash, usedSources: [] };
  }
  const ev = evaluateWorkbenchRecipe(state, wb);
  if (!ev.unlocked) {
    return { ok: false, reason: `「${wb.name}」（${wb.stationLabel}）还没解锁：${ev.lockReason}。`, paid: 0, cash: state.money.cash, usedSources: [] };
  }
  if (ev.missingLabels.length > 0) {
    return { ok: false, reason: `在${wb.stationLabel}做「${wb.name}」还缺材料：${ev.missingLabels.join('、')}。`, paid: 0, cash: state.money.cash, usedSources: [] };
  }
  if (state.money.cash < wb.materialCost) {
    return { ok: false, reason: `制作「${wb.name}」需要 ${wb.materialCost} 元辅料费，手上现金不够。`, paid: 0, cash: state.money.cash, usedSources: [] };
  }
  if (state.vitals.energy < wb.energyCost) {
    return { ok: false, reason: `精力只剩 ${Math.round(state.vitals.energy)} 点，做「${wb.name}」要 ${wb.energyCost} 点精力，先歇会儿。`, paid: 0, cash: state.money.cash, usedSources: [] };
  }

  const usedSources: string[] = [];
  for (const req of wb.ingredients) {
    const res = consumePantryByIngredient(state.pantry, req.anyOf, req.qty);
    usedSources.push(...res.sources);
  }
  state.money.cash -= wb.materialCost;
  state.money.spent += wb.materialCost;
  state.vitals.energy = Math.max(0, state.vitals.energy - wb.energyCost);

  const nowMs = now.getTime();
  const activeMoods = state.moodlets.filter((m) => Date.parse(m.expiresAt) > nowMs);
  const goodCnt = activeMoods.filter((m) => m.kind === 'good').length;
  const badCnt = activeMoods.filter((m) => m.kind === 'bad').length;
  const moodPolarity: 'good' | 'bad' | 'neutral' = goodCnt > badCnt ? 'good' : (badCnt > 0 ? 'bad' : 'neutral');

  const curExp = Number(state.skills?.[wb.domain] ?? 0);
  const q = rollWorkQuality(curExp, {
    trainedCount: Number(state.trained?.[wb.domain] ?? 0),
    moodPolarity,
    luckBonus: opts.luckBonus,
    roll: opts.roll,
  });
  state.skills = state.skills ?? {};
  state.skills[wb.domain] = Math.min(100, curExp + 1.2);
  const craftMoodDelta = wb.domain === 'craft' ? normalizeMoodBonus(opts.craftMoodBonus) : 0;

  if (mode === 'use' && wb.selfUse) {
    const su = wb.selfUse;
    const notes: string[] = [];
    if (su.foodGain) {
      state.vitals.food = Math.min(100, state.vitals.food + su.foodGain);
      notes.push(`饱腹+${su.foodGain}`);
    }
    if (su.funGain || craftMoodDelta !== 0) {
      const df = Math.max(0, (su.funGain ?? 0) + craftMoodDelta);
      state.vitals.fun = Math.min(100, state.vitals.fun + df);
      if (df > 0) notes.push(`娱乐+${df}`);
    }
    if (su.energyGain) {
      state.vitals.energy = Math.min(100, state.vitals.energy + su.energyGain);
      notes.push(`精力+${su.energyGain}`);
    }
    if (su.knowGain) {
      state.knowledge = Math.min(100, state.knowledge + su.knowGain);
      notes.push(`见识+${su.knowGain}`);
    }
    if (su.moodText && su.moodHours) {
      state.moodlets = state.moodlets.filter((m) => m.source !== wb.id);
      state.moodlets.push({
        id: `m-wb-${nowMs.toString(36)}`,
        source: wb.id,
        text: su.moodText,
        kind: 'good',
        expiresAt: new Date(nowMs + su.moodHours * 3_600_000).toISOString(),
      });
    }
    if (su.farmBoost === 'fertilizer') {
      const plots = state.farm?.plots ?? [];
      let boosted = 0;
      for (const p of plots) {
        const mMs = Date.parse(p.matureAt);
        if (Number.isFinite(mMs) && mMs > nowMs) {
          p.matureAt = new Date(nowMs + Math.round((mMs - nowMs) * 0.85)).toISOString();
          boosted += 1;
        }
      }
      if (boosted > 0) {
        notes.push(`已给 ${boosted} 块在种菜地施用（熟期缩短 15%）`);
      } else {
        addPantryItem(state.pantry, {
          itemId: 'organic_fertilizer',
          kind: 'craft_mat',
          name: wb.name,
          qty: 1,
          freshVeg: false,
          origin: 'home-grown',
          unitCost: Math.max(1, wb.materialCost),
          acquiredAt: now.toISOString(),
        });
        notes.push('菜地空着，已存入储物篮备用');
      }
    } else if (su.farmBoost === 'fish_bait') {
      addPantryItem(state.pantry, {
        itemId: 'fish_bait',
        kind: 'craft_mat',
        name: wb.name,
        qty: 2,
        freshVeg: false,
        origin: 'home-grown',
        unitCost: Math.max(1, Math.round(wb.materialCost / 2)),
        acquiredAt: now.toISOString(),
      });
      notes.push('制出 2 份复合鱼饵入储物篮，喂养鱼塘或禽舍可免现金饲料费');
    }
    const effectText = notes.join('，') || '自用完成';
    pushMemory(state, `在${wb.stationLabel}亲手做了【${q.label}】「${wb.name}」（${effectText}）。`, now);
    state.updatedAt = now.toISOString();
    return { ok: true, recipe: wb, mode: 'use', paid: wb.materialCost, cash: state.money.cash, usedSources, qualityLabel: q.label, effectText };
  }

  state.workOutputs = state.workOutputs ?? [];
  const val = Math.max(1, Math.round(wb.suggestedPrice * q.valueMult));
  const outItem = addWorkOutputEntry(state.workOutputs, {
    jobId: wb.id,
    jobName: wb.stationLabel,
    domain: wb.domain,
    name: wb.name,
    quality: q.id,
    qualityLabel: q.label,
    value: val,
    createdAt: now.toISOString(),
  });
  pushMemory(state, `在${wb.stationLabel}做出【${q.label}】「${wb.name}」（估值 ¥${val}，可拿去鱼市街摆摊）。`, now);
  state.updatedAt = now.toISOString();
  return { ok: true, recipe: wb, mode: 'store', paid: wb.materialCost, cash: state.money.cash, usedSources, qualityLabel: q.label, outputItem: outItem };
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
    used?: number;
    maintainEvery?: number;
    maintainCost?: number;
    maintainLabel?: string;
    pendingMaintain?: boolean;
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
    cities?: readonly string[];
    materialCost: number;
    outputName: string;
    qualified: boolean;
    missing: string[];
  }[];
  recipes: {
    id: string;
    name: string;
    tier: 'simple' | 'chef' | 'feast';
    cityTag?: '兰州' | '北京';
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
  workbench: {
    id: string;
    station: WorkbenchStation;
    stationLabel: string;
    domain: SkillDomain;
    name: string;
    unlocked: boolean;
    lockReason: string;
    canCraft: boolean;
    materialCost: number;
    energyCost: number;
    minutes: number;
    suggestedPrice: number;
    stallCategory: string;
    hasSelfUse: boolean;
    ingredients: RecipeEvalResult['ingredients'];
    missingLabels: string[];
    note: string;
  }[];
  pantrySummary: { itemId: string; name: string; qty: number; kind: string }[];
  cookedDishes: CookedDishItem[];
  workOutputs: WorkOutputItem[];
  specialties: { id: string; name: string; city: string; category: string; charges: number }[];
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
    equipUsage?: Record<string, number>;
    equipPendingMaintain?: string[];
    specialties?: { id: string; name: string; city: string; category: string; charges: number }[];
    moodlets?: { kind: 'good' | 'bad'; expiresAt: string }[];
    pantry: PantryItem[];
    cookedDishes?: CookedDishItem[];
    workOutputs?: WorkOutputItem[];
  },
  now: Date = new Date(),
  buffs: {
    certPassBonus?: number;
    qualityLuckBonus?: number;
    equipPriceMult?: number;
    currentCity?: string;
    phase?: 'home' | 'staying' | 'traveling';
  } = {},
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
  const equipUsage = state.equipUsage ?? {};
  const pendingMaintainSet = new Set(state.equipPendingMaintain ?? []);
  const gear = EQUIP_CATALOG.map((e) => {
    const mRule = EQUIP_MAINTAIN[e.id];
    return {
      id: e.id,
      name: e.name,
      kind: e.kind,
      price: Math.max(1, Math.round(e.price * eqMult)),
      owned: ownedGear.has(e.id),
      note: e.note,
      ...(mRule ? {
        used: Number(equipUsage[e.id] ?? 0),
        maintainEvery: mRule.every,
        maintainCost: mRule.cost,
        maintainLabel: mRule.label,
        pendingMaintain: pendingMaintainSet.has(e.id),
      } : {}),
    };
  });

  const jobs = JOBS.map((j) => {
    const missing: string[] = [];
    if (buffs.phase === 'traveling' && !jobAllowedAt(j, 'traveling', buffs.currentCity)) {
      missing.push('在途暂不可接');
    } else if (buffs.currentCity && j.cities?.length && !j.cities.includes(normalizeCityName(buffs.currentCity))) {
      missing.push(`限${j.cities.join('/')}本地`);
    }
    if (j.cert && !ownedCerts.has(j.cert)) {
      const c = certOf(j.cert);
      missing.push(`缺${j.cert}${c ? `(¥${c.price})` : ''}`);
    }
    if (j.equip && !ownedGear.has(j.equip)) {
      const eq = findEquip(j.equip);
      missing.push(`缺${eq ? eq.name : j.equip}`);
    }
    const mKey = jobMaintainKey(j.id, j.equip);
    if (mKey && pendingMaintainSet.has(mKey)) {
      missing.push(`${equipMaintainName(mKey)}待保养(¥${EQUIP_MAINTAIN[mKey]?.cost ?? 0})`);
    }
    if (j.days && state.job.days < j.days) {
      missing.push(`需出工满 ${j.days} 天(差 ${j.days - state.job.days} 天)`);
    }
    const domainExp = Number(state.skills?.[j.domain] ?? 0);
    const effPay = Math.max(1, Math.round(j.pay * skillPayMultiplier(domainExp)));
    const hourlyPay = Math.max(1, Math.round(effPay / Math.max(0.5, j.minutes / 60)));
    const outSpec = jobOutputOf(j.id);
    const placeLabel = j.cities?.length
      ? `${j.cities.join('/')}限定`
      : (j.place === 'anywhere' ? '随地可接' : j.place === 'destination' ? '外地短活' : '本地');
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
      ...(j.cities?.length ? { cities: j.cities } : {}),
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
    ...(ev.recipe.cityTag ? { cityTag: ev.recipe.cityTag } : {}),
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

  const workbench = evaluateAllWorkbenchRecipes(state).map((ev) => ({
    id: ev.recipe.id,
    station: ev.recipe.station,
    stationLabel: ev.recipe.stationLabel,
    domain: ev.recipe.domain,
    name: ev.recipe.name,
    unlocked: ev.unlocked,
    lockReason: ev.lockReason,
    canCraft: ev.canCraft,
    materialCost: ev.recipe.materialCost,
    energyCost: ev.recipe.energyCost,
    minutes: ev.recipe.minutes,
    suggestedPrice: ev.recipe.suggestedPrice,
    stallCategory: ev.recipe.stallCategory,
    hasSelfUse: Boolean(ev.recipe.selfUse),
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
    workbench,
    specialties: [...(state.specialties ?? [])].map((x) => ({
      id: x.id,
      name: x.name,
      city: x.city,
      category: x.category,
      charges: x.charges,
    })),
  };
}
