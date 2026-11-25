/*
 * 模拟鱼生面板（1.4.4，原生 ES module，零打包直跑）。
 */

/** 作者的 QQ 群。反馈栏那一行和简介里写的是同一个号，改这里一处就够。 */
const QQ_GROUP = '284525159';

const TEXT = {
  zh: {
    loading: '读她的日子…',
    empty: '还没读到。',
    helpTitle: '状态灯说明',
    helpOn: '绿',
    helpOnDesc: '运行正常。',
    helpOff: '灰',
    helpOffDesc: '未启用（比如未装旅行或未配城服），不是报错。',
    helpErr: '红',
    helpErrDesc: '已配置但异常，悬停看原因。',
    helpHint: '三盏灯依次代表：过日子 · 本城服务器 · 旅行同步。',
    fbLead: '问题反馈与建议',
    fbBug: '复制诊断',
    fbWant: '复制建议模板',
    fbOpenBug: '报 bug ↗',
    fbOpenWant: '提需求 ↗',
    fbCopied: '已复制 ✓',
    fbAddr: '仓库：',
    fbGroupLead: 'QQ 群：',
    fbWhy: '仅复制脱敏版本号与当前状态，点右侧链接可粘贴至 Issue。',
    who: '此刻概览',
    visits: '陪伴天数',
    visitDays: '近 7 天 {n} 天',
    noVisit: '近 7 天暂无',
    visitsHint: '含今日以内',
    job: '当前营生',
    certs: '证书',
    knowledge: '见识',
    knowledgeHint: '影响考证胜算与写作摆摊门槛，读书或高阶工作涨',
    fitness: '体质',
    fitnessHint: '运动/体力活/收菜涨，加快睡眠回精',
    verSelf: 'v{v}',
    verNew: 'v{v} → v{new}',
    verHint: '新版本 {new} 已在市场上',
    noJob: '暂无营生',
    home: '住处',
    rent: '租',
    own: '自有',
    money: '现金',
    goals: '目标',
    moves: '住处与换街',
    streetsTitle: '本城街道（换街不收押金）',
    moveStreetTo: '搬去这里',
    streetMoveNote: '换街免押金，仅在本城生效；与 life_move 共用同一本账。',
    livingHere: '现居',
    moveTo: '搬过去',
    cantMove: '钱不够',
    moving: '搬…',
    moveNote: '换房押二付一（老房子押金不退）；住得越好日常损耗越慢，种植槽与鸡舍/鱼池也越多。',
    noGoal: '暂未定目标。',
    left: '还差 ¥{n}',
    canNow: '攒够了，可以办了',
    achieved: '已达成',
    vitals: '五条需求',
    asleep: '在睡',
    asleepLeft: '还剩 {h} 小时（醒来精力约 {e}）',
    acting: '正在做：{label}',
    actingLeft: '还剩 {m} 分钟（{p}%）',
    mindBody: '身心与挂念',
    calm: '身心平稳，暂无待催事项。',
    none: '—',
    town: '住',
    server: '读服务器',
    townOwn: '自定义',
    builtin: '内置',
    noJourney: '未装旅行扩展（仅本地过日子）',
    onRoad: '在路上 → {to}（出发地 {from}）',
    reload: '重读城设定',
    recoveredBak: '主档损坏，已从备份恢复。',
    recoveredFresh: '新档案启动（已读取服务器设定）。',
  },
  en: {
    loading: 'Reading her day…',
    empty: 'Nothing yet.',
    helpTitle: 'Status lamps',
    helpOn: 'Green',
    helpOnDesc: 'healthy.',
    helpOff: 'Grey',
    helpOffDesc: 'disabled (normal).',
    helpErr: 'Red',
    helpErrDesc: 'configured but failing; hover dot for details.',
    helpHint: 'Daily life · Town server · Journey sync.',
    fbLead: 'Feedback & Issues',
    fbBug: 'Copy diagnostics',
    fbWant: 'Copy state',
    fbOpenBug: 'Report bug ↗',
    fbOpenWant: 'Request feature ↗',
    fbCopied: 'Copied ✓',
    fbAddr: 'Repo: ',
    fbGroupLead: 'QQ group: ',
    fbWhy: 'Copies sanitized version & state, then paste into GitHub Issue.',
    who: 'Overview',
    visits: 'Visits',
    visitDays: '{n}d / 7d',
    noVisit: '0d / 7d',
    visitsHint: 'recent 7 days',
    job: 'Doing',
    certs: 'Certs',
    knowledge: 'Knowledge',
    knowledgeHint: 'decides exam pass chance and writing stall threshold',
    fitness: 'Fitness',
    fitnessHint: 'speeds up sleep recovery',
    verSelf: 'v{v}',
    verNew: 'v{v} → v{new}',
    verHint: 'Version {new} is out',
    noJob: 'idle',
    home: 'Home',
    rent: 'rent',
    own: 'owned',
    money: 'Cash',
    goals: 'Goals',
    moves: 'Housing & Streets',
    streetsTitle: 'Streets in town (no deposit)',
    moveStreetTo: 'Move here',
    streetMoveNote: 'Changing streets costs no deposit; same books as life_move.',
    livingHere: 'here',
    moveTo: 'Move',
    cantMove: 'short',
    moving: 'moving…',
    moveNote: 'Two months deposit upfront; better housing gives more garden slots & ranch pens.',
    noGoal: 'No goal set.',
    left: '¥{n} left',
    canNow: 'ready',
    achieved: 'done',
    vitals: 'Needs',
    asleep: 'Asleep',
    asleepLeft: '{h}h left (~{e} energy on wake)',
    acting: 'Doing: {label}',
    actingLeft: '{m}m left ({p}%)',
    mindBody: 'Body, Mood & Alerts',
    calm: 'All steady.',
    none: '—',
    town: 'Lives in',
    server: 'server',
    townOwn: 'custom',
    builtin: 'built-in',
    noJourney: 'Journey not installed.',
    onRoad: 'Traveling to {to} (from {from})',
    reload: 'Reload town',
    recoveredBak: 'Recovered from backup.',
    recoveredFresh: 'Fresh save initialized.',
  },
};

const t = (lang, key, vars) => {
  const dict = TEXT[lang] || TEXT.zh;
  let s = dict[key] != null ? dict[key] : (TEXT.zh[key] || key);
  if (vars) for (const k of Object.keys(vars)) s = s.replace(`{${k}}`, vars[k]);
  return s;
};

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function fmtLocal(iso, mode = 'mdhm') {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso);
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (k) => parts.find((p) => p.type === k)?.value || '';
  const mmdd = `${get('month')}-${get('day')}`;
  const hh = get('hour') === '24' ? '00' : get('hour');
  const hm = `${hh}:${get('minute')}`;
  if (mode === 'hm') return hm;
  if (mode === 'md') return mmdd;
  if (mode === 'full') return `${get('year')}-${mmdd} ${hm}`;
  return `${mmdd} ${hm}`;
}

/* 与 bridge.ts / worker.js 同源的商品属性预算与默认配点，保证前端与后端展示一分不差 */
const EFFECT_RULE = {
  food: { label: '饱腹', short: '饱', max: 80, weight: 1, step: 1 },
  energy: { label: '精力', short: '精', max: 80, weight: 1, step: 1 },
  clean: { label: '清洁', short: '洁', max: 80, weight: 1, step: 1 },
  fun: { label: '娱乐', short: '娱', max: 80, weight: 1, step: 1 },
  social: { label: '社交', short: '社', max: 80, weight: 1, step: 1 },
  knowledge: { label: '见识', short: '识', max: 10, weight: 20, step: 0.1 },
  fitness: { label: '体质', short: '体', max: 5, weight: 40, step: 0.05 },
};

const CAT_LABEL = {
  produce: '鲜蔬农产',
  food: '料理熟食',
  craft: '手作文创',
  writing: '写作出版',
  photo: '影像周边',
};

const ORIGIN_LABEL = {
  'home-grown': '自种',
  ranch: '自家牧场',
  'town-buy': '街坊',
  market: '早市',
};

const KIND_LABEL = {
  veg: '蔬菜',
  starch: '粮薯',
  fruit: '鲜果',
  herb: '香草',
  egg_dairy: '蛋奶',
  meat: '肉类',
  fish: '鲜鱼',
};

const HOME_SLOTS_FALLBACK = {
  'urban-village': 1,
  old: 2,
  new: 4,
  villa: 8,
};

const DEFAULT_STALL_RULES = [
  {
    category: 'produce',
    label: '鲜蔬农产',
    requirement: '自家种植收成或养殖产出的肉蛋奶鱼入储物篮；未种养时 ≤20 元可按早市现批转卖（利润薄），>20 元或指定鲜蔬摊需自产农牧货',
    costFormula: '用自产蔬果肉蛋奶鱼仅扣 3 元/批打包保鲜费；现批进货另扣约定价 60%/份',
    energyNote: '扣 3–12 精力',
    examples: '香葱、蜜薯红薯、鲜鸡蛋、鲜牛奶、塘养鲜鱼',
  },
  {
    category: 'food',
    label: '料理熟食',
    requirement: '≤25 元家常小吃或使用已做好的「成品菜格」不限；>25 元现做需「厨师证 / 烹饪≥10 / 小烤箱 / 老小区及以上厨房」其一',
    costFormula: '先消耗成品菜格（整批仅 2 元打包保鲜费）；再耗储物篮原料（3 元/份油盐费）；无囤货早市现买原料（定价 38%/份，持厨师证 28%）',
    energyNote: '扣 4–18 精力',
    examples: '炭烤红薯、番茄鸡蛋汤、西红柿炖牛腩、鲜香菇滑鸡煲',
  },
  {
    category: 'writing',
    label: '写作出版',
    requirement: '≤25 元小书签/手抄单不限；>25 元需「见识≥15 / 文字≥10 / 二手笔记本电脑」其一',
    costFormula: '纸笔排版底费 8 元/批（有电脑降为 3 元，10 元以内小件 3 元）+ 印刷装帧费 25%–30%/份',
    energyNote: '耗心神：扣 6–22 精力',
    examples: '芦花塘随笔集、手绘攻略册、手写诗签本',
  },
  {
    category: 'craft',
    label: '手作文创',
    requirement: '≤25 元小物不限；>25 元需「手作≥5 / 老式缝纫机」其一',
    costFormula: '毛线/陶土/布料/包装耗材费按定价 38%/份（手作≥20 或有缝纫机降至 30%）',
    energyNote: '扣 5–20 精力',
    examples: '陶土小摆件、拼微缩书屋、刺绣茶垫',
  },
  {
    category: 'photo',
    label: '影像周边',
    requirement: '≤15 元小贴纸/照片卡不限；>15 元需「二手胶片微单 / 影像≥10」其一',
    costFormula: '冲扫底费 6 元/批（10 元以内 3 元）+ 相纸冲印费 30%/份',
    energyNote: '扣 4–16 精力',
    examples: '胶片明信片、旅途风光画册、拍立得照片',
  },
];

function budgetOfPrice(price) {
  const p = Math.max(1, Math.min(999, Math.round(Number(price) || 1)));
  return p <= 150 ? p * 2 : Math.min(450, 300 + Math.round(Math.sqrt(p - 150) * 10));
}

function quantEffect(val, step, mode) {
  if (!Number.isFinite(val) || val <= 0) return 0;
  const u = mode === 'floor' ? Math.floor((val + 1e-9) / step) : Math.round(val / step);
  return Math.round(u * step * 100) / 100;
}

function defaultEffects(price) {
  const b = budgetOfPrice(price);
  const food = Math.min(80, Math.max(1, Math.round(b * 0.7)));
  const r1 = Math.max(0, b - food);
  const fun = Math.min(60, r1);
  const r2 = Math.max(0, r1 - fun);
  const energy = Math.min(60, r2);
  const r3 = Math.max(0, r2 - energy);
  const social = Math.min(60, r3);
  const out = { food };
  if (fun > 0) out.fun = fun;
  if (energy > 0) out.energy = energy;
  if (social > 0) out.social = social;
  return out;
}

function resolveStallEffects(raw, price) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultEffects(price);
  const picked = {};
  const origCost = {};
  let total = 0;
  for (const [k, r] of Object.entries(EFFECT_RULE)) {
    const v = quantEffect(Number(raw[k] ?? 0), r.step, 'round');
    if (v <= 0) continue;
    const cl = Math.min(r.max, v);
    picked[k] = cl;
    origCost[k] = cl * r.weight;
    total += origCost[k];
  }
  const keys = Object.keys(picked);
  if (!keys.length) return defaultEffects(price);
  const b = budgetOfPrice(price);
  if (total > b + 1e-6) {
    const ratio = b / total;
    let remain = b;
    for (const k of keys) {
      const r = EFFECT_RULE[k];
      const sc = Math.min(r.max, quantEffect(picked[k] * ratio, r.step, 'floor'));
      const af = quantEffect((remain + 1e-9) / r.weight, r.step, 'floor');
      const v = Math.max(0, Math.min(sc, af));
      if (v > 0) {
        picked[k] = v;
        remain = Math.max(0, Math.round((remain - v * r.weight) * 100) / 100);
      } else delete picked[k];
    }
    if (!Object.keys(picked).length && remain > 0) {
      const byPrio = [...keys].sort((a, z) => (origCost[z] || 0) - (origCost[a] || 0));
      for (const k of byPrio) {
        const r = EFFECT_RULE[k];
        if (remain + 1e-9 >= r.step * r.weight) {
          const v = Math.min(r.max, quantEffect((remain + 1e-9) / r.weight, r.step, 'floor'));
          if (v > 0) { picked[k] = v; break; }
        }
      }
    }
  }
  return Object.keys(picked).length ? picked : defaultEffects(price);
}

function fmtEffectsText(fx, compact = false) {
  if (!fx) return '';
  const parts = [];
  for (const [k, r] of Object.entries(EFFECT_RULE)) {
    const v = Number(Number(fx[k] || 0).toFixed(2));
    if (v > 0) parts.push(`${compact ? r.short : r.label}+${v}`);
  }
  return parts.join(compact ? ' ' : ' / ');
}

const STYLE_ID = 'life-panel-style';
function ensureStyle(root) {
  const doc = root.ownerDocument || document;
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
.lf { color: #1b1e24; font: 13.5px/1.55 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
.lf * { box-sizing: border-box; }
.lf-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 3px; }
.lf-town { font-size: 18px; font-weight: 650; margin: 0; }
.lf-tag { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #eef2f7; color: #64748b; border: 1px solid #e2e8f0; }
.lf-ver { font-size: 11px; color: #94a3b8; }
.lf-ver[data-new="1"] { padding: 1px 7px; border-radius: 999px; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; font-weight: 600; }
.lf-sub { color: #64748b; font-size: 12px; margin: 0 0 12px; }
.lf-note { margin: 0 0 10px; padding: 7px 10px; border-radius: 8px; background: #fdf8ec; border: 1px solid #ecd9b6; color: #7a5b1c; font-size: 12px; }

.lf-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; }
.lf-card h3 { font-size: 12px; font-weight: 600; color: #6b7280; margin: 0 0 8px; }
.lf-cols { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
.lf-cols > .lf-card { flex: 1 1 200px; margin-bottom: 0; }

.lf-vital { display: flex; align-items: center; gap: 9px; margin-bottom: 7px; }
.lf-vital:last-child { margin-bottom: 0; }
.lf-vital .k { flex: 0 0 40px; font-size: 12.5px; color: #374151; }
.lf-vital .track { flex: 1 1 auto; height: 8px; border-radius: 999px; background: #eef0f3; overflow: hidden; }
.lf-vital .fill { height: 100%; border-radius: 999px; transition: width .3s ease; }
.lf-vital .n { flex: 0 0 32px; text-align: right; font-size: 12.5px; font-variant-numeric: tabular-nums; color: #6b7280; }
.lf-vital.low .k, .lf-vital.low .n { color: #c0392b; font-weight: 600; }

.lf-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.lf-chip { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #f4f6f8; border: 1px solid #e5e7eb; color: #374151; }
.lf-chip.bad { background: #fdeceb; border-color: #f0cfcb; color: #c0392b; }
.lf-chip.good { background: #eaf5ee; border-color: #cbe7d6; color: #2f855a; }
.lf-chip.info { background: #eff6ff; border-color: #dbeafe; color: #1d4ed8; }
.lf-chip.warn { background: #fff7ed; border-color: #fed7aa; color: #c2410c; }
.lf-muted { color: #9ca3af; font-size: 12.5px; margin: 0; }

.lf-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
.lf-stat { padding: 8px 10px; border: 1px solid #eef0f3; border-radius: 8px; background: #fbfcfd; }
.lf-stat .lab { font-size: 11px; color: #9ca3af; display: block; margin-bottom: 2px; }
.lf-stat .val { font-size: 14px; font-weight: 600; color: #1b1e24; font-variant-numeric: tabular-nums; word-break: break-word; }
.lf-stat .sub2 { font-size: 11px; color: #6b7280; margin-top: 2px; }
.lf-stat.money .val { color: #1a6b4a; }
.lf-subrow { margin-top: 9px; padding-top: 8px; border-top: 1px dashed #eef0f3; display: flex; flex-wrap: wrap; gap: 5px; }

.lf-goal { margin-bottom: 8px; }
.lf-goal:last-child { margin-bottom: 0; }
.lf-goal .top { display: flex; justify-content: space-between; align-items: baseline; font-size: 12.5px; color: #374151; margin-bottom: 4px; gap: 8px; }
.lf-goal .left { flex: 0 0 auto; color: #6b7280; font-size: 12px; font-variant-numeric: tabular-nums; }
.lf-goal .track { height: 7px; border-radius: 999px; background: #eef0f3; overflow: hidden; }
.lf-goal .fill { height: 100%; border-radius: 999px; background: #2f6fed; transition: width .3s ease; }

details.lf-fold summary { list-style: none; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: #374151; }
details.lf-fold summary::-webkit-details-marker { display: none; }
details.lf-fold summary .hint { font-size: 11.5px; font-weight: 400; color: #94a3b8; }
details.lf-fold[open] summary { margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px dashed #eef0f3; }

.lf-move { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px dashed #f0f1f3; }
.lf-move:last-child { border-bottom: 0; }
.lf-move .nm { flex: 0 0 68px; font-size: 12.5px; color: #374151; font-weight: 600; }
.lf-move.now .nm { color: #2f6fed; }
.lf-move .cost { flex: 1 1 auto; font-size: 11.5px; color: #6b7280; }
.lf-move .cost b { color: #374151; font-weight: 600; }
.lf-move .cost .short { color: #c0392b; }
.lf-move .btnbox { flex: 0 0 auto; }
.lf-move .nowtag, .lf-st-row .nowtag { font-size: 11.5px; color: #2f6fed; }
.lf-note-line { margin: 8px 0 0; font-size: 11px; color: #9ca3af; line-height: 1.5; }
.lf-st-box { margin-top: 10px; padding-top: 10px; border-top: 1px solid #eef0f3; }
.lf-st-box h4 { font-size: 12px; font-weight: 600; color: #6b7280; margin: 0 0 6px; }
.lf-st-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px dashed #f0f1f3; }
.lf-st-row:last-child { border-bottom: 0; }
.lf-st-row.now .st-nm { color: #2f6fed; }
.lf-st-info { flex: 1 1 auto; min-width: 0; }
.lf-st-info .st-nm { font-size: 12.5px; font-weight: 600; color: #374151; }
.lf-st-info .st-desc { font-size: 11.5px; color: #6b7280; margin-top: 1px; }
.lf-st-info .lf-chips { margin-top: 4px; }

/* 鱼市街单行紧凑摊位清单 & 农牧场操作面板 */
.lf-mkt-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.lf-mkt-head h3 { margin: 0; }
.lf-mkt-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.lf-feedback { margin: 6px 0 8px; padding: 6px 10px; border-radius: 7px; font-size: 12px; }
.lf-feedback.ok { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; }
.lf-feedback.err { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
.lf-board-strip { font-size: 12px; padding: 6px 9px; border-radius: 7px; background: #fdf8ec; border: 1px solid #ecd9b6; color: #7a5b1c; margin-bottom: 8px; }
.lf-stall { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px dashed #f0f1f3; }
.lf-stall:last-child { border-bottom: 0; }
.lf-stall-l { flex: 1 1 auto; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.lf-stall-l .nm { font-weight: 600; color: #1f2937; font-size: 13px; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.lf-stall-l .seller { font-size: 11.5px; color: #94a3b8; }
.lf-fx-pill { font-size: 11px; padding: 1px 6px; border-radius: 5px; background: #f1f5f9; color: #475569; white-space: nowrap; }
.lf-veg-pill { font-size: 11px; padding: 1px 6px; border-radius: 5px; background: #eaf5ee; color: #2f855a; white-space: nowrap; }
.lf-cost-pill { font-size: 11px; padding: 1px 6px; border-radius: 5px; background: #fff7ed; color: #b45309; border: 1px solid #fed7aa; white-space: nowrap; }
.lf-income-pill { font-size: 11px; padding: 1px 6px; border-radius: 5px; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; margin-left: 5px; font-weight: 600; white-space: nowrap; }
.lf-cat-pill { font-size: 11px; padding: 1px 6px; border-radius: 5px; white-space: nowrap; font-weight: 500; }
.lf-cat-pill[data-cat="produce"] { background: #ecfdf5; color: #047857; }
.lf-cat-pill[data-cat="food"] { background: #fef3c7; color: #92400e; }
.lf-cat-pill[data-cat="craft"] { background: #f3e8ff; color: #6b21a8; }
.lf-cat-pill[data-cat="writing"] { background: #e0f2fe; color: #0369a1; }
.lf-cat-pill[data-cat="photo"] { background: #fce7f3; color: #9d174d; }
.lf-stall-r { flex: 0 0 auto; font-size: 12px; font-variant-numeric: tabular-nums; color: #475569; white-space: nowrap; }
.lf-stall-r b { color: #1a6b4a; font-weight: 600; margin-right: 4px; }
.lf-mkt-split { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #eef0f3; }
.lf-subh { font-size: 11.5px; font-weight: 600; color: #6b7280; margin: 0 0 6px; }

.lf-steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-bottom: 10px; }
.lf-step { padding: 8px 10px; border-radius: 8px; border: 1px solid #e5e7eb; background: #f8fafc; }
.lf-step .st-t { font-size: 12px; font-weight: 650; color: #1e3a8a; margin-bottom: 3px; }
.lf-step .st-d { font-size: 11.5px; color: #475569; line-height: 1.5; }
.lf-plots { display: grid; grid-template-columns: repeat(auto-fill, minmax(195px, 1fr)); gap: 8px; margin-bottom: 8px; }
.lf-plot { border: 1px solid #e5e7eb; border-radius: 8px; padding: 9px 10px; background: #fbfcfd; display: flex; flex-direction: column; gap: 5px; }
.lf-plot.ready { border-color: #86efac; background: #f0fdf4; }
.lf-plot.empty { border-style: dashed; border-color: #cbd5e1; background: #f8fafc; justify-content: space-between; min-height: 86px; }
.lf-plot .ptop { display: flex; justify-content: space-between; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 600; color: #1f2937; }
.lf-plot .ptag { font-size: 10.5px; padding: 1px 6px; border-radius: 999px; background: #eef2f7; color: #475569; font-weight: 500; }
.lf-plot.ready .ptag { background: #dcfce7; color: #166534; }
.lf-plot .pmeta { font-size: 11px; color: #64748b; display: flex; justify-content: space-between; gap: 4px; flex-wrap: wrap; }
.lf-plot .ptrack { height: 6px; border-radius: 999px; background: #e5e7eb; overflow: hidden; }
.lf-plot .pfill { height: 100%; border-radius: 999px; background: #3b82f6; }
.lf-plot.ready .pfill { background: #16a34a; }
.lf-plot .pact { display: flex; gap: 5px; flex-wrap: wrap; margin-top: auto; padding-top: 3px; }
.lf-plot .pact select { flex: 1 1 110px; min-width: 0; font-size: 11.5px; padding: 3px 5px; }

.lf-table-wrap { overflow-x: auto; width: 100%; margin-top: 6px; border: 1px solid #e5e7eb; border-radius: 8px; }
.lf-table { width: 100%; min-width: 520px; border-collapse: collapse; font-size: 11.5px; }
.lf-table thead th { background: #f3f4f6; color: #374151; font-weight: 600; text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; white-space: nowrap; }
.lf-table tbody td { padding: 6px 8px; border-bottom: 1px dashed #eef0f3; color: #334155; vertical-align: top; line-height: 1.5; }
.lf-table tbody tr:last-child td { border-bottom: 0; }
.lf-say-list { margin: 6px 0 0; padding-left: 16px; font-size: 11.5px; color: #475569; line-height: 1.65; }

/* 职业与工坊面板 */
.lf-cert-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(175px, 1fr)); gap: 8px; }
.lf-cert { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; background: #fbfcfd; display: flex; flex-direction: column; gap: 4px; }
.lf-cert.owned { border-color: #86efac; background: #f0fdf4; }
.lf-cert .ctop { display: flex; justify-content: space-between; align-items: center; gap: 5px; font-weight: 600; font-size: 12.5px; }
.lf-cert .cmeta { font-size: 11px; color: #64748b; }
.lf-recipe-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; }
.lf-recipe { border: 1px solid #e5e7eb; border-radius: 8px; padding: 9px 10px; background: #fbfcfd; display: flex; flex-direction: column; gap: 5px; }
.lf-recipe.ready { border-color: #86efac; background: #f0fdf4; }
.lf-recipe.locked { opacity: .82; background: #f8fafc; }
.lf-recipe .rtop { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
.lf-recipe .rmeta { font-size: 11px; color: #64748b; }
.lf-ing { font-size: 11px; padding: 1px 6px; border-radius: 5px; border: 1px solid #e5e7eb; }
.lf-ing.ok { background: #ecfdf5; border-color: #a7f3d0; color: #065f46; }
.lf-ing.miss { background: #fef2f2; border-color: #fecaca; color: #991b1b; }

.lf-list { margin: 0; padding: 0; list-style: none; }
.lf-list li { font-size: 12.5px; padding: 4px 0; border-bottom: 1px dashed #f0f1f3; color: #374151; }
.lf-list li:last-child { border-bottom: 0; }
.lf-list .id { color: #b0b5bd; font-size: 11px; margin-left: 6px; font-family: ui-monospace, Consolas, monospace; }
.lf-btn { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid #e5e7eb; background: #fff; color: #1b1e24; cursor: pointer; text-decoration: none; display: inline-block; }
.lf-btn:hover:not(:disabled) { background: #f7f8fa; }
.lf-btn:disabled { opacity: .55; cursor: not-allowed; }
.lf-btn.sm { font-size: 11.5px; padding: 3px 8px; }
.lf-btn.primary { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; font-weight: 600; }
.lf-btn.primary:hover:not(:disabled) { background: #dbeafe; }
.lf-btn.danger { border-color: #fecaca; background: #fef2f2; color: #b91c1c; }
.lf-foot { margin-top: 8px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.lf-msg { font-size: 12px; color: #6b7280; }
.lf-tools-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
.lf-help { font-size: 12px; color: #4b5563; }
.lf-help summary { cursor: pointer; color: #6b7280; font-size: 12px; padding: 3px 0; }
.lf-help summary:hover { color: #2f6fed; }
.lf-help ul { margin: 6px 0 0; padding-left: 16px; line-height: 1.7; }
.lf-help .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
.lf-help .row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.lf-help .addr { margin-top: 6px; font-size: 11px; color: #6b7280; }
.lf-help code { background: #f3f4f6; padding: 1px 4px; border-radius: 4px; font-size: 11px; }

.lf-diary-wrap { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
.lf-dlist { flex: 0 0 150px; display: flex; flex-direction: column; gap: 5px; }
.lf-ditem { text-align: left; padding: 7px 9px; border-radius: 7px; border: 1px solid #e5e7eb; background: #fff; cursor: pointer; font: inherit; color: #1b1e24; }
.lf-ditem:hover { background: #f7f8fa; }
.lf-ditem[data-on="1"] { border-color: #2f6fed; background: #f0f5ff; }
.lf-ditem .d { font-size: 12px; font-weight: 600; display: block; }
.lf-ditem .c { font-size: 11px; color: #6b7280; }
.lf-dview { flex: 1 1 260px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; }
.lf-dview h2 { margin: 0 0 4px; font-size: 15px; }
.lf-dmeta { margin: 0 0 10px; font-size: 11.5px; color: #6b7280; }
.lf-dp { margin: 0 0 8px; font-size: 13px; line-height: 1.7; color: #1f2937; white-space: pre-wrap; }
.lf-dp:last-child { margin-bottom: 0; }
.lf-dir { font-size: 11px; color: #9ca3af; word-break: break-all; margin: 2px 0 8px; }
.lf-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.lf-tab[data-on="1"] { border-color: #2f6fed; background: #f0f5ff; color: #1d4ed8; font-weight: 600; }
.lf-lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 9px; }
.lf-lib-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 9px; padding: 10px 11px; display: flex; flex-direction: column; gap: 5px; }
.lf-lib-card .top { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
.lf-lib-card .nm { font-size: 13.5px; font-weight: 600; }
.lf-lib-card .alias { font-size: 11px; color: #6b7280; }
.lf-lib-card .desc { font-size: 12px; color: #374151; line-height: 1.45; }
.lf-lib-thumbs { display: flex; gap: 5px; flex-wrap: wrap; }
.lf-lib-thumbs img { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid #e5e7eb; }
.lf-form-row { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; margin-bottom: 7px; }
.lf-input, .lf-textarea, .lf-select { font: inherit; font-size: 12px; padding: 5px 8px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; color: #1b1e24; }
.lf-input { flex: 1 1 150px; }
.lf-textarea { width: 100%; min-height: 54px; resize: vertical; margin-bottom: 7px; }
.lf-drop { border: 1.5px dashed #cbd5e1; border-radius: 7px; padding: 8px; font-size: 11.5px; color: #64748b; text-align: center; cursor: pointer; margin-bottom: 7px; background: #f8fafc; }
.lf-drop.over { border-color: #2f6fed; background: #eff6ff; color: #1d4ed8; }
`;
  doc.head.append(s);
}

function colorOf(v) {
  if (v < 30) return '#c0392b';
  if (v < 60) return '#d69e2e';
  return '#2f855a';
}

const copyText = (str) => {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(str).catch(() => {});
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  } catch { /* ignore */ }
  return Promise.resolve();
};

function renderStallRow(st, showSeller, recordMap) {
  const row = el('div', 'lf-stall');
  if (st.note) row.title = `说明：${st.note}`;
  const left = el('div', 'lf-stall-l');
  if (st.kind === 'errand') {
    const ePill = el('span', 'lf-cat-pill', '邻里代管委托');
    ePill.setAttribute('data-cat', 'writing');
    left.append(ePill);
    left.append(el('span', 'nm', st.item));
    if (showSeller && st.seller) left.append(el('span', 'seller', `雇主：${st.seller}`));
    const mMatch = /(\d+)\s*分/.exec(String(st.item || ''));
    const mins = mMatch ? Number(mMatch[1]) : 25;
    left.append(el('span', 'lf-fx-pill', `忙活约 ${mins} 分 · 社交+10 · 不占正式出工`));
    if (st.id) left.append(el('span', 'lf-fx-pill', `编号 ${st.id}`));
    const right = el('div', 'lf-stall-r');
    right.append(el('b', null, `挣+¥${st.price}`), document.createTextNode(`×${st.stock}`));
    row.append(left, right);
    return row;
  }
  if (st.category && CAT_LABEL[st.category]) {
    const cPill = el('span', 'lf-cat-pill', CAT_LABEL[st.category]);
    cPill.setAttribute('data-cat', st.category);
    left.append(cPill);
  }
  left.append(el('span', 'nm', st.item));
  if (showSeller && st.seller) left.append(el('span', 'seller', st.seller));
  if (st.freshVeg) left.append(el('span', 'lf-veg-pill', '鲜蔬'));
  const rec = recordMap && st.id ? recordMap.get(st.id) : null;
  if (!showSeller && rec && rec.totalCost > 0) {
    if (!st.category && rec.category && CAT_LABEL[rec.category]) {
      const cPill = el('span', 'lf-cat-pill', CAT_LABEL[rec.category]);
      cPill.setAttribute('data-cat', rec.category);
      left.prepend(cPill);
    }
    left.append(el('span', 'lf-cost-pill', `本钱 ¥${rec.totalCost}`));
  }
  const fx = resolveStallEffects(st.effects, st.price);
  const pill = el('span', 'lf-fx-pill', fmtEffectsText(fx, true));
  pill.title = fmtEffectsText(fx, false);
  left.append(pill);

  const right = el('div', 'lf-stall-r');
  right.append(el('b', null, `¥${st.price}`), document.createTextNode(`×${st.stock}`));
  row.append(left, right);
  return row;
}

function renderDealsList(ds) {
  if (!ds || !ds.length) return el('p', 'lf-muted', '最近没有成交回执。');
  const ul = el('ul', 'lf-list');
  for (const dl of ds) {
    const li = el('li');
    const isErrand = Boolean(dl.isErrand);
    if (isErrand) {
      li.append(document.createTextNode(`${dl.seen ? '' : '[新] '}${dl.buyerPet} 接下「${dl.item}」帮忙照料`));
      li.append(el('span', 'lf-chip good', '已代管完成'));
    } else {
      li.append(document.createTextNode(`${dl.seen ? '' : '[新] '}${dl.buyerPet} 买走 ${dl.qty} 份「${dl.item}」`));
      if (dl.income > 0) {
        li.append(el('span', 'lf-income-pill', `+¥${dl.income}`));
      }
    }
    if (dl.at) li.append(el('span', 'id', fmtLocal(dl.at, 'mdhm')));
    ul.append(li);
  }
  return ul;
}

export default {
  panels: {
    now: {
      async mount(ctx) {
        const lang = ctx.language === 'en' ? 'en' : 'zh';
        ensureStyle(ctx.root);
        const app = el('div', 'lf');
        ctx.root.append(app);

        const head = el('div', 'lf-head');
        const town = el('h1', 'lf-town', '—');
        const tag = el('span', 'lf-tag', '');
        const ver = el('span', 'lf-ver', '');
        head.append(town, tag, ver);

        const sub = el('p', 'lf-sub', t(lang, 'loading'));
        const note = el('div', 'lf-note');
        note.hidden = true;

        const whoCard = el('div', 'lf-card');
        const vitalsCard = el('div', 'lf-card');
        const goalCard = el('div', 'lf-card');
        const mindBodyCard = el('div', 'lf-card');
        const moveFold = el('details', 'lf-card lf-fold');
        const moveSum = el('summary', null, t(lang, 'moves'));
        const moveHint = el('span', 'hint', '');
        moveSum.append(moveHint);
        const moveBody = el('div', null);
        moveFold.append(moveSum, moveBody);

        const toolsRow = el('div', 'lf-tools-row');
        const helpBox = el('details', 'lf-help');
        const fbBox = el('details', 'lf-help');
        toolsRow.append(helpBox, fbBox);

        const foot = el('div', 'lf-foot');
        const reload = el('button', 'lf-btn', t(lang, 'reload'));
        reload.type = 'button';
        const msg = el('span', 'lf-msg', '');
        foot.append(reload, msg);

        app.append(head, sub, note, whoCard, vitalsCard, goalCard, mindBodyCard, moveFold, toolsRow, foot);

        let moveTip = null;
        const MOD_SHORT = { food: '饱', energy: '精', clean: '洁', fun: '娱', social: '社', know: '识', work: '钱' };
        const MOD_FULL = { food: '饱腹', energy: '精力', clean: '清爽', fun: '娱乐', social: '社交', know: '见识', work: '工钱' };

        const drawWho = (d) => {
          whoCard.innerHTML = '';
          whoCard.append(el('h3', null, t(lang, 'who')));
          const box = el('div', 'lf-stats');

          const jb = d.job || {};
          const jobCell = el('div', 'lf-stat');
          jobCell.append(el('span', 'lab', t(lang, 'job')));
          jobCell.append(el('div', 'val', jb.what || t(lang, 'noJob')));
          jobCell.append(el('div', 'sub2', jb.what ? `¥${jb.daily}/天 · ${jb.days}天工` : `日薪 ¥${jb.daily || 0}`));

          const home = d.home || {};
          const homeCell = el('div', 'lf-stat');
          homeCell.append(el('span', 'lab', t(lang, 'home')));
          homeCell.append(el('div', 'val', `${home.tierLabel || '—'} · ${home.tenure === 'own' ? t(lang, 'own') : t(lang, 'rent')}`));
          homeCell.append(el('div', 'sub2', `${d.street || ''}${d.street ? ' · ' : ''}月租 ¥${home.monthly || 0}`));

          const money = d.money || {};
          const moneyCell = el('div', 'lf-stat money');
          moneyCell.append(el('span', 'lab', t(lang, 'money')));
          moneyCell.append(el('div', 'val', `¥ ${Number(money.cash || 0).toLocaleString('zh-CN')}`));
          moneyCell.append(el('div', 'sub2', `进${Number(money.earned || 0).toLocaleString('zh-CN')} / 出${Number(money.spent || 0).toLocaleString('zh-CN')}`));

          const visitCell = el('div', 'lf-stat');
          visitCell.append(el('span', 'lab', t(lang, 'visits')));
          visitCell.append(el('div', 'val', d.visitedDays > 0 ? t(lang, 'visitDays', { n: d.visitedDays }) : t(lang, 'noVisit')));
          visitCell.append(el('div', 'sub2', t(lang, 'visitsHint')));

          box.append(jobCell, homeCell, moneyCell, visitCell);
          whoCard.append(box);

          const subRow = el('div', 'lf-subrow');
          const knChip = el('span', 'lf-chip', `${t(lang, 'knowledge')} ${typeof d.knowledge === 'number' ? d.knowledge : 0}`);
          knChip.title = t(lang, 'knowledgeHint');
          const ftChip = el('span', 'lf-chip', `${t(lang, 'fitness')} ${typeof d.fitness === 'number' ? d.fitness : 25}`);
          ftChip.title = t(lang, 'fitnessHint');
          subRow.append(knChip, ftChip);

          const certs = jb.certs || [];
          if (certs.length) subRow.append(el('span', 'lf-chip info', `${t(lang, 'certs')}：${certs.join('、')}`));

          const skills = d.skills || {};
          const labels = d.skillLabels || {};
          for (const k of Object.keys(skills)) {
            if (Number(skills[k]) > 0) subRow.append(el('span', 'lf-chip', `${labels[k] || k} ${Math.round(Number(skills[k]))}`));
          }
          const gear = d.gear || [];
          const eqCat = d.equipCatalog || [];
          if (gear.length) {
            const gNames = gear.map((id) => (eqCat.find((e) => e.id === id) || {}).name || id);
            subRow.append(el('span', 'lf-chip', `家伙：${gNames.join('、')}`));
          }
          if (d.shift) subRow.append(el('span', 'lf-chip info', `跑单：${d.shift.label} (${d.shift.minutes}m)`));
          if (d.farm) {
            const fm = d.farm;
            const fChip = el(
              'span',
              'lf-chip' + (fm.readyCount > 0 ? ' good' : ''),
              `菜园 ${fm.usedSlots}/${fm.totalSlots}槽${fm.readyCount > 0 ? `（可收${fm.readyCount}）` : ''}${fm.leased ? '·含租地' : ''}`,
            );
            fChip.title = '可在「农牧场与鱼市街」页签手动播种、浇水与收成';
            subRow.append(fChip);
          }
          if (d.ranch) {
            const rn = d.ranch;
            const tot = (rn.totalSlots?.chicken || 0) + (rn.totalSlots?.cow || 0) + (rn.totalSlots?.fish || 0);
            const used = (rn.usedSlots?.chicken || 0) + (rn.usedSlots?.cow || 0) + (rn.usedSlots?.fish || 0);
            if (tot > 0 || used > 0) {
              const readySum = (rn.collectableCount || 0) + (rn.readyHarvestCount || 0);
              const rChip = el(
                'span',
                'lf-chip' + (readySum > 0 ? ' good' : ''),
                `牧场 ${used}/${tot}栏${readySum > 0 ? `（可收${readySum}）` : ''}${rn.leased ? '·含城郊' : ''}`,
              );
              subRow.append(rChip);
            }
          }
          if (d.farmHelper && d.farmHelper.mode && d.farmHelper.mode !== 'off') {
            const hLab = d.farmHelper.mode === 'full' ? '全托管' : '照料工';
            const hChip = el('span', 'lf-chip info', `代管：${hLab}(¥${d.farmHelper.dailyWage}/天)`);
            if (d.farmHelper.lastSummary) hChip.title = d.farmHelper.lastSummary;
            subRow.append(hChip);
          }
          const pan = d.pantry || [];
          const panQty = pan.reduce((sum, x) => sum + (Number(x.qty) || 0), 0);
          if (panQty > 0) {
            const pChip = el('span', 'lf-chip good', `储物篮 ${panQty} 份`);
            pChip.title = pan.map((x) => `${x.name}×${x.qty}(${ORIGIN_LABEL[x.origin] || x.origin})`).join('、');
            subRow.append(pChip);
          } else if (d.freshVeg) {
            subRow.append(el('span', 'lf-chip good', '带鲜蔬（下厨更香）'));
          }
          const dishes = d.cookedDishes || [];
          const dishQty = dishes.reduce((sum, x) => sum + (Number(x.qty) || 0), 0);
          if (dishQty > 0) {
            const dChip = el('span', 'lf-chip info', `成品菜 ${dishQty} 份`);
            dChip.title = dishes.map((x) => `${x.name}×${x.qty}`).join('、');
            subRow.append(dChip);
          }
          whoCard.append(subRow);
        };

        const drawVitals = (vitals, low, asleep, activity) => {
          vitalsCard.innerHTML = '';
          vitalsCard.append(el('h3', null, t(lang, 'vitals')));
          if (asleep) {
            const p = el('p', 'lf-muted', `${t(lang, 'asleep')} · ${t(lang, 'asleepLeft', { h: asleep.hoursLeft, e: asleep.energyAtWake })}`);
            p.style.marginBottom = '8px';
            vitalsCard.append(p);
          } else if (activity) {
            const pct = Math.round((Number(activity.progress) || 0) * 100);
            const row = el('div', 'lf-goal');
            const top = el('div', 'top');
            top.append(el('span', null, t(lang, 'acting', { label: activity.label || activity.id })));
            top.append(el('span', 'left', t(lang, 'actingLeft', { m: activity.minutesLeft ?? 0, p: pct })));
            const track = el('div', 'track');
            const fill = el('div', 'fill');
            fill.style.width = Math.max(2, Math.min(100, pct)) + '%';
            fill.style.background = '#2b6cb0';
            track.append(fill);
            row.append(top, track);
            vitalsCard.append(row);
          }
          const lowKeys = new Set((low || []).map((x) => x.key));
          for (const key of Object.keys(vitals || {})) {
            const it = vitals[key];
            const v = Math.round(Number(it.value) || 0);
            const row = el('div', 'lf-vital' + (lowKeys.has(key) ? ' low' : ''));
            row.append(el('span', 'k', it.label || key));
            const track = el('div', 'track');
            const fill = el('div', 'fill');
            fill.style.width = Math.max(2, Math.min(100, v)) + '%';
            fill.style.background = colorOf(v);
            track.append(fill);
            row.append(track, el('span', 'n', String(v)));
            vitalsCard.append(row);
          }
        };

        const drawGoals = (d) => {
          const gs = d.goals || [];
          goalCard.hidden = !gs.length;
          if (!gs.length) return;
          goalCard.innerHTML = '';
          goalCard.append(el('h3', null, t(lang, 'goals')));
          for (const g of gs) {
            const row = el('div', 'lf-goal');
            const top = el('div', 'top');
            top.append(el('span', null, g.what || ''));
            top.append(el('span', 'left', g.done ? t(lang, 'achieved') : (g.left > 0 ? t(lang, 'left', { n: Number(g.left).toLocaleString('zh-CN') }) : t(lang, 'canNow'))));
            const track = el('div', 'track');
            const fill = el('div', 'fill');
            fill.style.width = Math.max(1, Math.min(100, Math.round((g.ratio || 0) * 100))) + '%';
            if (g.done || g.left <= 0) fill.style.background = '#2f855a';
            track.append(fill);
            row.append(top, track);
            goalCard.append(row);
          }
        };

        const drawMindBody = (d) => {
          mindBodyCard.innerHTML = '';
          mindBodyCard.append(el('h3', null, t(lang, 'mindBody')));
          const chips = el('div', 'lf-chips');
          for (const c of (d.conditions || [])) chips.append(el('span', 'lf-chip bad', c.text || c.id));
          for (const m of (d.moodlets || [])) chips.append(el('span', 'lf-chip ' + (m.kind === 'bad' ? 'bad' : 'good'), m.text || ''));
          for (const o of (d.overdue || [])) chips.append(el('span', 'lf-chip bad', `到期：${o.what}`));
          for (const p of (d.pending || [])) chips.append(el('span', 'lf-chip', `悬着：${p.what}（${p.blockedLabel}）`));
          if (!chips.childElementCount) {
            mindBodyCard.append(el('p', 'lf-muted', t(lang, 'calm')));
          } else {
            mindBodyCard.append(chips);
          }
        };

        const drawMoves = (d) => {
          const h = d.home || {};
          moveHint.textContent = `${h.tierLabel || '—'}${d.street ? ` · ${d.street}` : ''}（点击展开）`;
          if (moveTip && moveTip.until > Date.now()) moveFold.open = true;

          moveBody.innerHTML = '';
          const qs = d.moveQuotes || [];
          const busyHint = d.asleep
            ? '她正在睡觉，醒来后再搬'
            : (d.activity ? `正在「${d.activity.label}」，还剩 ${d.activity.minutesLeft} 分钟，停下来后再搬` : '');
          for (const q of qs) {
            const row = el('div', 'lf-move' + (q.current ? ' now' : ''));
            row.append(el('span', 'nm', q.label));
            const cost = el('div', 'cost');
            const slots = q.farmSlots ?? HOME_SLOTS_FALLBACK[q.tier] ?? 1;
            cost.append(el('b', null, `¥${q.monthly}/月`));
            cost.append(document.createTextNode(` · 押 ${q.deposit} · ${slots} 种植槽`));
            if (!q.current && !q.ok) cost.append(el('span', 'short', `（差 ${Number(q.short).toLocaleString('zh-CN')}）`));
            row.append(cost);
            const box = el('div', 'btnbox');
            if (q.current) box.append(el('span', 'nowtag', t(lang, 'livingHere')));
            else {
              const b = el('button', 'lf-btn', q.ok ? t(lang, 'moveTo') : t(lang, 'cantMove'));
              b.type = 'button';
              b.disabled = !q.ok || Boolean(busyHint);
              if (busyHint && q.ok) b.title = busyHint;
              b.setAttribute('data-move', q.tier);
              box.append(b);
            }
            row.append(box);
            moveBody.append(row);
          }
          if (busyHint) {
            const p = el('p', 'lf-note-line', busyHint);
            p.style.color = '#b45309';
            moveBody.append(p);
          }
          if (moveTip && moveTip.until > Date.now()) {
            const p = el('p', 'lf-note-line', moveTip.text);
            p.style.color = moveTip.err ? '#c0392b' : '#2f855a';
            p.style.fontWeight = '600';
            moveBody.append(p);
          }
          moveBody.append(el('p', 'lf-note-line', t(lang, 'moveNote')));

          const sqs = d.streetQuotes || [];
          if (sqs.length) {
            const stBox = el('div', 'lf-st-box');
            stBox.append(el('h4', null, t(lang, 'streetsTitle')));
            for (const sq of sqs) {
              const row = el('div', 'lf-st-row' + (sq.current ? ' now' : ''));
              const info = el('div', 'lf-st-info');
              info.append(el('div', 'st-nm', sq.name || ''));
              if (sq.desc) info.append(el('div', 'st-desc', sq.desc));
              const mods = sq.mods || {};
              const modKeys = Object.keys(MOD_SHORT).filter((k) => Number(mods[k]) !== 0 && Number.isFinite(Number(mods[k])));
              if (modKeys.length) {
                const chips = el('div', 'lf-chips');
                for (const k of modKeys) {
                  const val = Math.round(Number(mods[k]));
                  const ch = el('span', 'lf-chip ' + (val > 0 ? 'good' : 'bad'), `${MOD_SHORT[k]}${val > 0 ? '+' + val : val}%`);
                  ch.title = `${MOD_FULL[k]} ${val > 0 ? '+' + val : val}%`;
                  chips.append(ch);
                }
                info.append(chips);
              }
              const btnBox = el('div', 'btnbox');
              if (sq.current) btnBox.append(el('span', 'nowtag', t(lang, 'livingHere')));
              else {
                const sb = el('button', 'lf-btn', t(lang, 'moveStreetTo'));
                sb.type = 'button';
                sb.disabled = Boolean(busyHint);
                if (busyHint) sb.title = busyHint;
                sb.setAttribute('data-move-street', sq.name || '');
                btnBox.append(sb);
              }
              row.append(info, btnBox);
              stBox.append(row);
            }
            stBox.append(el('p', 'lf-note-line', t(lang, 'streetMoveNote')));
            moveBody.append(stBox);
          }
        };

        const drawFeedback = (d) => {
          const fb = d.feedback;
          if (!fb || !fb.repo) { fbBox.remove(); return; }
          fbBox.innerHTML = '';
          fbBox.append(el('summary', null, t(lang, 'fbLead')));
          const row = el('div', 'row');
          for (const kind of ['bug', 'want']) {
            const btn = el('button', 'lf-btn', t(lang, kind === 'bug' ? 'fbBug' : 'fbWant'));
            btn.type = 'button';
            btn.addEventListener('click', () => {
              copyText(fb.digest).then(() => {
                const old = btn.textContent;
                btn.textContent = t(lang, 'fbCopied');
                setTimeout(() => { btn.textContent = old; }, 1800);
              });
            });
            row.append(btn);
          }
          for (const kind of ['bug', 'want']) {
            const a = el('a', 'lf-btn', t(lang, kind === 'bug' ? 'fbOpenBug' : 'fbOpenWant'));
            a.href = fb.repo + '/issues/new?title=' + encodeURIComponent((kind === 'bug' ? '[bug] ' : '[want] ') + 'v' + fb.version);
            a.target = '_blank';
            a.rel = 'noreferrer';
            row.append(a);
          }
          fbBox.append(row);
          const addr = el('div', 'addr');
          addr.append(el('span', null, t(lang, 'fbAddr')));
          addr.append(el('code', null, fb.repo));
          const grp = el('div', 'addr');
          grp.append(el('span', null, t(lang, 'fbGroupLead')));
          grp.append(el('code', null, QQ_GROUP));
          fbBox.append(addr, grp, el('p', 'lf-note-line', t(lang, 'fbWhy')));
        };

        const drawHelp = () => {
          helpBox.append(el('summary', null, t(lang, 'helpTitle')));
          const ul = el('ul');
          for (const [color, key, desc] of [['#2f855a', 'helpOn', 'helpOnDesc'], ['#9ca3af', 'helpOff', 'helpOffDesc'], ['#c0392b', 'helpErr', 'helpErrDesc']]) {
            const li = el('li');
            const dot = el('span', 'dot');
            dot.style.background = color;
            li.append(dot, el('b', null, t(lang, key)), document.createTextNode(' ' + t(lang, desc)));
            ul.append(li);
          }
          helpBox.append(ul, el('p', 'lf-note-line', t(lang, 'helpHint')));
        };

        const render = (d) => {
          if (!d) return;
          town.textContent = d.town.name || '—';
          tag.textContent = t(lang, d.town.source === 'server' ? 'server' : d.town.source === 'own' ? 'townOwn' : 'builtin');
          const bits = [`${d.dayPart} ${d.clock}`];
          if (d.solarTerm && d.solarTerm.name) bits.push(lang === 'en' ? `Solar term: ${d.solarTerm.name}` : `节气·${d.solarTerm.name}`);
          if (d.weather && d.weather.sky) {
            bits.push(typeof d.weather.temperature === 'number'
              ? `${d.weather.sky} ${Math.round(d.weather.temperature)}°C`
              : d.weather.sky);
          }
          if (d.streetWindow && d.streetWindow.label) bits.push(`${d.streetWindow.place}${d.streetWindow.label}`);
          if (d.street) bits.push(d.street);
          sub.textContent = bits.join(' · ');

          note.hidden = true;
          note.textContent = '';
          const notes = [];
          if (!d.journey.installed) notes.push(t(lang, 'noJourney'));
          else if (d.journey.phase === 'traveling') {
            notes.push(t(lang, 'onRoad', { to: d.journey.to || '?', from: d.journey.city || '?' }) + (d.journey.seat ? `（${d.journey.seat}）` : ''));
          } else if (d.journey.tripWork && d.journey.tripWork.gig) notes.push(`旅途打工：${d.journey.tripWork.gig}`);
          else if (d.journey.restUntil) notes.push(`休整至 ${fmtLocal(d.journey.restUntil, 'mdhm')}`);
          if (d.bulletin && d.bulletin.length) notes.push(`黑板报：${d.bulletin[0]}`);
          if (d.recovered === 'bak') notes.push(t(lang, 'recoveredBak'));
          else if (d.recovered === 'fresh' && d.town.custom) notes.push(t(lang, 'recoveredFresh'));
          if (notes.length) {
            note.hidden = false;
            note.textContent = notes.join(' · ');
          }

          if (!fbBox.childElementCount) drawFeedback(d);
          const hasNew = Boolean(d.versionOutdated && d.latestVersion);
          ver.dataset.new = hasNew ? '1' : '0';
          ver.textContent = hasNew ? t(lang, 'verNew', { v: d.version || '', new: d.latestVersion }) : `· ${t(lang, 'verSelf', { v: d.version || '' })}`;
          ver.title = hasNew ? t(lang, 'verHint', { v: d.version || '', new: d.latestVersion }) : '';

          drawWho(d);
          drawVitals(d.vitals, d.low, d.asleep, d.activity);
          drawGoals(d);
          drawMindBody(d);
          drawMoves(d);
        };

        const load = () => ctx.invoke('snapshot').then(render).catch((e) => {
          sub.textContent = t(lang, 'empty');
          msg.textContent = (e && e.message) ? e.message : '读取失败';
        });

        moveBody.addEventListener('click', (ev) => {
          const b = ev.target && ev.target.closest ? ev.target.closest('button[data-move], button[data-move-street]') : null;
          if (!b || b.disabled) return;
          const tier = b.getAttribute('data-move');
          const street = b.getAttribute('data-move-street');
          b.disabled = true;
          b.textContent = t(lang, 'moving');
          msg.textContent = '';
          ctx.invoke('move', [street ? { street } : { tier }])
            .then((r) => {
              moveTip = (r && r.ok === false && r.reason)
                ? { text: r.reason, err: true, until: Date.now() + 5000 }
                : { text: '搬过去了 ✓', err: false, until: Date.now() + 4000 };
              if (moveTip.err) msg.textContent = moveTip.text;
              render(r);
            })
            .catch((e) => {
              moveTip = { text: (e && e.message) || '没搬成', err: true, until: Date.now() + 5000 };
              msg.textContent = moveTip.text;
            })
            .finally(() => load());
        });

        reload.addEventListener('click', () => {
          msg.textContent = '';
          ctx.invoke('reloadTown')
            .then(() => load())
            .then(() => { msg.textContent = t(lang, 'reload') + ' ✓'; })
            .catch((e) => { msg.textContent = (e && e.message) || '失败'; });
        });

        drawHelp();
        await load();
        const loop = () => ctx.timeout(() => load().finally(loop), 30_000);
        loop();
      },
    },

    career: {
      async mount(ctx) {
        ensureStyle(ctx.root);
        const app = el('div', 'lf');
        ctx.root.append(app);

        const head = el('div', 'lf-head');
        head.append(el('h1', 'lf-town', '职业与工坊'));
        const ver = el('span', 'lf-ver', '');
        head.append(ver);
        const sub = el('p', 'lf-sub', '读取中…');

        const summaryCard = el('div', 'lf-card');
        const certCard = el('div', 'lf-card');
        const recipeCard = el('div', 'lf-card');
        const jobCard = el('div', 'lf-card');
        const foot = el('div', 'lf-foot');
        const reload = el('button', 'lf-btn', '刷新');
        reload.type = 'button';
        foot.append(reload);

        app.append(head, sub, summaryCard, certCard, recipeCard, jobCard, foot);

        let recipeTab = 'all';
        let lastSnap = null;

        const render = (d) => {
          if (!d) return;
          lastSnap = d;
          ver.textContent = d.version ? `· v${d.version}` : '';
          const c = d.career || {};
          const jb = c.currentJob || d.job || {};
          const ownedCerts = (jb.certs || []).length;
          sub.textContent = `${jb.what ? `当前职业：${jb.what}（¥${jb.daily}/天）` : '暂无固定营生'} · 工龄 ${jb.days || 0} 天 · 见识 ${c.knowledge ?? d.knowledge ?? 0} · 已考取 ${ownedCerts}/${(c.certs || []).length || 9} 证`;

          /* 1. 职业概览与手艺/装备 */
          summaryCard.innerHTML = '';
          summaryCard.append(el('h3', null, '当前职业、八大手艺与装备（只读：对话里让它考证/打工/培训/下厨）'));
          const stats = el('div', 'lf-stats');
          const c1 = el('div', 'lf-stat');
          c1.append(el('span', 'lab', '当前营生'), el('div', 'val', jb.what || '自由接活'));
          c1.append(el('div', 'sub2', d.job?.workedToday ? '今日已出工 ✓' : '今日还未出工'));
          const c2 = el('div', 'lf-stat');
          c2.append(el('span', 'lab', '日薪与工龄'), el('div', 'val', `¥${jb.daily || 0}/天`));
          c2.append(el('div', 'sub2', `累计出工 ${jb.days || 0} 天`));
          const c3 = el('div', 'lf-stat');
          c3.append(el('span', 'lab', '见识水平'), el('div', 'val', String(c.knowledge ?? d.knowledge ?? 0)));
          c3.append(el('div', 'sub2', '读书 +6 / 天，不学 -1.2 / 天'));
          const readyRecipes = (c.recipes || []).filter((r) => r.canCook);
          const c4 = el('div', 'lf-stat');
          c4.append(el('span', 'lab', '此刻能做的菜'), el('div', 'val', `${readyRecipes.length} 道`));
          c4.append(el('div', 'sub2', `成品菜格 ${(c.cookedDishes || []).reduce((s, x) => s + x.qty, 0)} 份`));
          stats.append(c1, c2, c3, c4);
          summaryCard.append(stats);

          const skillRow = el('div', 'lf-subrow');
          for (const sk of (c.skills || [])) {
            const ch = el('span', 'lf-chip' + (sk.exp > 0 ? ' info' : ''), `${sk.label} ${sk.exp}${sk.trained > 0 ? `(${sk.trained}课)` : ''}`);
            skillRow.append(ch);
          }
          for (const eq of (c.gear || [])) {
            const ch = el('span', 'lf-chip' + (eq.owned ? ' good' : ''), `${eq.owned ? '✓ ' : ''}${eq.name}`);
            ch.title = `${eq.owned ? '已购置' : `未买 · ¥${eq.price}`}：${eq.note}`;
            skillRow.append(ch);
          }
          summaryCard.append(skillRow);

          /* 2. 考证中心 */
          certCard.innerHTML = '';
          certCard.append(el('h3', null, '考证进度与实时通过率（随当前见识动态计算）'));
          const certGrid = el('div', 'lf-cert-grid');
          for (const ct of (c.certs || [])) {
            const box = el('div', 'lf-cert' + (ct.owned ? ' owned' : ''));
            const top = el('div', 'ctop');
            top.append(el('span', null, ct.name));
            top.append(el('span', 'lf-chip ' + (ct.owned ? 'good' : (ct.chancePct >= 70 ? 'info' : '')), ct.owned ? '已持证' : `${ct.chancePct}% 过考率`));
            box.append(top);
            box.append(el('div', 'cmeta', `考费 ¥${ct.price} · 建议见识 ${ct.need}`));
            if (ct.unlockJobs && ct.unlockJobs.length) {
              box.append(el('div', 'cmeta', `解锁：${ct.unlockJobs.join('、')}`));
            }
            if (!ct.owned) {
              const tr = el('div', 'lf-goal');
              const tk = el('div', 'track');
              const fl = el('div', 'fill');
              fl.style.width = `${ct.chancePct}%`;
              fl.style.background = ct.chancePct >= 75 ? '#16a34a' : (ct.chancePct >= 45 ? '#2563eb' : '#d97706');
              tk.append(fl);
              tr.append(tk);
              box.append(tr);
            }
            certGrid.append(box);
          }
          certCard.append(certGrid);

          /* 3. 厨房与菜谱工坊 */
          recipeCard.innerHTML = '';
          const rHead = el('div', 'lf-mkt-head');
          rHead.append(el('h3', null, '职业能做什么 · 厨房菜谱与原料匹配（简食免证，招牌菜需厨师资质）'));
          const tabBox = el('div', 'lf-tabs');
          tabBox.style.marginBottom = '0';
          for (const [tid, tlab] of [['all', '全部菜谱'], ['ready', `材料齐可做 (${readyRecipes.length})`], ['simple', '零门槛简食'], ['chef', '厨师招牌菜']]) {
            const tb = el('button', 'lf-btn sm lf-tab', tlab);
            tb.type = 'button';
            if (recipeTab === tid) tb.dataset.on = '1';
            tb.addEventListener('click', () => { recipeTab = tid; render(lastSnap); });
            tabBox.append(tb);
          }
          rHead.append(tabBox);
          recipeCard.append(rHead);

          const panSum = c.pantrySummary || [];
          const panChips = el('div', 'lf-chips');
          panChips.style.marginBottom = '8px';
          if (!panSum.length) {
            panChips.append(el('span', 'lf-chip warn', '储物篮目前空着，去「农牧场与鱼市街」种菜或养殖就能做菜'));
          } else {
            for (const p of panSum) {
              panChips.append(el('span', 'lf-chip good', `${p.name} ×${p.qty}`));
            }
          }
          recipeCard.append(panChips);

          const rList = (c.recipes || []).filter((r) => {
            if (recipeTab === 'ready') return r.canCook;
            if (recipeTab === 'simple') return r.tier === 'simple';
            if (recipeTab === 'chef') return r.tier === 'chef';
            return true;
          });
          if (!rList.length) {
            recipeCard.append(el('p', 'lf-muted', '当前筛选下暂无菜谱。'));
          } else {
            const rGrid = el('div', 'lf-recipe-grid');
            for (const rc of rList) {
              const card = el('div', 'lf-recipe' + (rc.canCook ? ' ready' : (!rc.unlocked ? ' locked' : '')));
              const top = el('div', 'rtop');
              top.append(el('span', null, rc.name));
              const badgeTxt = !rc.unlocked ? '未解锁' : (rc.canCook ? '材料齐 · 可做' : '缺原料');
              const badgeCls = !rc.unlocked ? '' : (rc.canCook ? 'good' : 'warn');
              top.append(el('span', 'lf-chip ' + badgeCls, badgeTxt));
              card.append(top);
              card.append(el('div', 'rmeta', `${rc.tier === 'simple' ? '家常简食(免证)' : '厨师招牌'} · 饱腹+${rc.foodGain} 娱+${rc.funGain}${rc.energyGain ? ` 精+${rc.energyGain}` : ''} · 油盐¥${rc.fuelCost} · 建议摊价¥${rc.suggestedPrice}`));
              if (!rc.unlocked && rc.lockReason) {
                const lp = el('div', 'rmeta', `门槛：${rc.lockReason}`);
                lp.style.color = '#b45309';
                card.append(lp);
              }
              const ingRow = el('div', 'lf-chips');
              for (const ing of (rc.ingredients || [])) {
                ingRow.append(el('span', 'lf-ing ' + (ing.ok ? 'ok' : 'miss'), `${ing.label} ${ing.have}/${ing.need}`));
              }
              card.append(ingRow);
              rGrid.append(card);
            }
            recipeCard.append(rGrid);
          }
          recipeCard.append(el('p', 'lf-note-line', '在对话里对它说「去烤个红薯」「做一份番茄鸡蛋汤存起来」「用成品菜去鱼市街摆摊」即可由它自主开火。'));

          /* 4. 全职业岗位目录 */
          jobCard.innerHTML = '';
          const jFold = el('details', 'lf-fold');
          const qualifiedCnt = (c.jobs || []).filter((j) => j.qualified).length;
          const jSum = el('summary', null, `全部职业门槛与日薪清单（当前可接 ${qualifiedCnt}/${(c.jobs || []).length} 项）`);
          jSum.append(el('span', 'hint', '点击展开岗位表'));
          const jWrap = el('div', 'lf-table-wrap');
          const jTable = el('table', 'lf-table');
          const jThead = document.createElement('thead');
          const jThr = document.createElement('tr');
          for (const hText of ['档位', '职业', '日薪', '工时/地点', '门槛与缺项']) jThr.append(el('th', null, hText));
          jThead.append(jThr);
          const jTbody = document.createElement('tbody');
          for (const jbItem of (c.jobs || [])) {
            const tr = document.createElement('tr');
            const statusTd = el('td', null, jbItem.qualified ? '✓ 已可接' : `缺：${jbItem.missing.join('、')}`);
            statusTd.style.color = jbItem.qualified ? '#166534' : '#9a3412';
            tr.append(
              el('td', null, `${jbItem.tierLabel}·${jbItem.domainLabel}`),
              el('td', null, jbItem.name + (jbItem.materialCost > 0 ? ` (垫¥${jbItem.materialCost})` : '')),
              el('td', null, `¥${jbItem.pay}`),
              el('td', null, `${Math.round(jbItem.minutes / 60 * 10) / 10}h · ${jbItem.place}`),
              statusTd,
            );
            jTbody.append(tr);
          }
          jTable.append(jThead, jTbody);
          jWrap.append(jTable);
          jFold.append(jSum, jWrap);
          jobCard.append(jFold);
        };

        const load = () => ctx.invoke('snapshot').then(render).catch(() => {});
        reload.addEventListener('click', load);
        await load();
        const loop = () => ctx.timeout(() => load().finally(loop), 25_000);
        loop();
      },
    },

    wants: {
      async mount(ctx) {
        ensureStyle(ctx.root);
        const app = el('div', 'lf');
        ctx.root.append(app);

        const head = el('div', 'lf-head');
        head.append(el('h1', 'lf-town', '她惦记的'));
        head.style.marginBottom = '10px';
        const goalsCard = el('div', 'lf-card');
        const cols = el('div', 'lf-cols');
        const habitsCard = el('div', 'lf-card');
        const watchesCard = el('div', 'lf-card');
        const buyCard = el('div', 'lf-card');
        const placeCard = el('div', 'lf-card');
        const pendCard = el('div', 'lf-card');
        const pledgeCard = el('div', 'lf-card');
        cols.append(habitsCard, watchesCard, buyCard, placeCard, pendCard, pledgeCard);
        app.append(head, goalsCard, cols);

        const drawSec = (card, title, items, fmt) => {
          card.innerHTML = '';
          card.append(el('h3', null, title));
          if (!items || !items.length) {
            card.append(el('p', 'lf-muted', '暂无。'));
            return;
          }
          const ul = el('ul', 'lf-list');
          for (const it of items) {
            const li = el('li', null, fmt(it));
            if (it.id) li.title = it.id;
            ul.append(li);
          }
          card.append(ul);
        };

        const render = (d) => {
          if (!d) return;
          const gs = d.goals || [];
          goalsCard.hidden = !gs.length;
          if (gs.length) {
            goalsCard.innerHTML = '';
            goalsCard.append(el('h3', null, '个人目标'));
            for (const g of gs) {
              const row = el('div', 'lf-goal');
              const top = el('div', 'top');
              top.append(el('span', null, g.what || ''));
              top.append(el('span', 'left', g.done ? '已达成' : (g.left > 0 ? `还差 ¥${g.left}` : '钱够了')));
              const track = el('div', 'track');
              const fill = el('div', 'fill');
              fill.style.width = Math.max(1, Math.min(100, Math.round((g.ratio || 0) * 100))) + '%';
              if (g.done || g.left <= 0) fill.style.background = '#2f855a';
              track.append(fill);
              row.append(top, track);
              goalsCard.append(row);
            }
          }
          const whenLabel = { morning: '早上', noon: '中午', afternoon: '下午', evening: '傍晚', night: '夜里' };
          drawSec(habitsCard, '常态规律', d.habits, (h) => `${whenLabel[h.when] || ''} ${h.what}`.trim());
          drawSec(watchesCard, '在留意的事', d.watches, (w) => w.what);
          const wantsAll = d.wants || [];
          drawSec(buyCard, '想买 / 想办', wantsAll.filter((w) => w.kind !== 'place'),
            (w) => `${w.what}${w.scale === 'big' ? '（得攒）' : ''}`);
          drawSec(placeCard, '想去的地方', wantsAll.filter((w) => w.kind === 'place'), (w) => w.what);
          drawSec(pendCard, '悬着未决', d.pending,
            (p) => `${p.what}（卡在${p.blockedLabel || p.blocked}${p.cost ? ` ¥${p.cost}` : ''}）`);
          const pls = [...(d.overdue || []), ...(d.pledges || [])];
          drawSec(pledgeCard, '说好了的事', pls,
            (p) => `${p.overdue ? '[已到期] ' : ''}${p.what}${p.to ? ` · 对${p.to}` : ''}`);
        };

        const load = () => ctx.invoke('snapshot').then(render).catch(() => {});
        await load();
        const loop = () => ctx.timeout(() => load().finally(loop), 25_000);
        loop();
      },
    },

    relation: {
      async mount(ctx) {
        ensureStyle(ctx.root);
        const app = el('div', 'lf');
        ctx.root.append(app);

        const head = el('div', 'lf-head');
        head.append(el('h1', 'lf-town', '你和它'));
        head.style.marginBottom = '10px';
        const cols = el('div', 'lf-cols');
        const visitsCard = el('div', 'lf-card');
        const giftsCard = el('div', 'lf-card');
        const bridgeCard = el('div', 'lf-card');
        cols.append(visitsCard, giftsCard, bridgeCard);

        app.append(head, cols);

        const render = (d) => {
          if (!d) return;
          visitsCard.innerHTML = '';
          visitsCard.append(el('h3', null, d.visitedDays > 0 ? `最近陪伴（近 7 天 ${d.visitedDays} 天）` : '最近陪伴'));
          const pr = d.presence || [];
          if (!pr.length) {
            visitsCard.append(el('p', 'lf-muted', '近 7 天暂无来访记录。'));
          } else {
            const box = el('div', 'lf-chips');
            for (const day of pr.slice().reverse()) {
              const rawDate = typeof day === 'string' ? day : (day && day.date ? String(day.date) : '');
              if (!rawDate) continue;
              const shortLabel = rawDate.replace(/^\d{4}-/, '');
              const chip = el('span', 'lf-chip', shortLabel);
              const tips = [rawDate];
              if (day && typeof day === 'object' && (day.firstAt || day.lastAt)) {
                const f = day.firstAt ? fmtLocal(day.firstAt, 'hm') : '';
                const l = day.lastAt ? fmtLocal(day.lastAt, 'hm') : '';
                if (f && l && f !== l) tips.push(`首次 ${f} · 最近 ${l}`);
                else if (l || f) tips.push(l || f);
              }
              chip.title = tips.join(' · ');
              box.append(chip);
            }
            visitsCard.append(box);
          }

          giftsCard.innerHTML = '';
          giftsCard.append(el('h3', null, '留下的小物件'));
          const gs = d.gifts || [];
          if (!gs.length) {
            giftsCard.append(el('p', 'lf-muted', '还没有收到物件。'));
          } else {
            const ul = el('ul', 'lf-list');
            for (const g of gs.slice().reverse()) {
              const li = el('li');
              li.append(document.createTextNode(`${g.what}（${g.from || '他'}）`));
              if (g.at) li.append(el('span', 'id', fmtLocal(g.at, 'md')));
              ul.append(li);
            }
            giftsCard.append(ul);
          }

          bridgeCard.innerHTML = '';
          bridgeCard.append(el('h3', null, '生活 × 旅行'));
          const j = d.journey || {};
          if (!j.installed) {
            bridgeCard.append(el('p', 'lf-muted', '未安装旅行扩展。'));
          } else {
            const ul = el('ul', 'lf-list');
            const rows = [
              `母港：${j.homeName || d.town?.name || '兰州'} · ${j.phase || 'home'}${j.city ? `（${j.city}）` : ''}`,
              j.seat ? `舱位：${j.seat}${j.seatMult && j.seatMult !== 1 ? `（×${j.seatMult}）` : ''}` : '',
              j.tripWork ? `打工：${j.tripWork.gig}` : '',
              j.restUntil ? `休整至：${fmtLocal(j.restUntil, 'mdhm')}` : '',
              (j.partyWith && j.partyWith.length) ? `结伴（${j.partyDays || 0}天）：${j.partyWith.join('、')}` : '',
            ].filter(Boolean);
            for (const text of rows) ul.append(el('li', null, text));
            bridgeCard.append(ul);
          }
        };

        const load = () => ctx.invoke('snapshot').then(render).catch(() => {});
        await load();
        const loop = () => ctx.timeout(() => load().finally(loop), 30_000);
        loop();
      },
    },

    market: {
      async mount(ctx) {
        ensureStyle(ctx.root);
        const app = el('div', 'lf');
        ctx.root.append(app);

        const head = el('div', 'lf-head');
        const title = el('h1', 'lf-town', '农牧场与鱼市街');
        const ver = el('span', 'lf-ver', '');
        head.append(title, ver);
        const sub = el('p', 'lf-sub', '读取中…');

        const guideCard = el('div', 'lf-card');
        const helperCard = el('div', 'lf-card');
        const farmCard = el('div', 'lf-card');
        const ranchCard = el('div', 'lf-card');
        const pantryCard = el('div', 'lf-card');
        const stallCard = el('div', 'lf-card');

        const foot = el('div', 'lf-foot');
        const reload = el('button', 'lf-btn', '刷新');
        reload.type = 'button';
        const msg = el('span', 'lf-msg', '');
        foot.append(reload, msg);
        app.append(head, sub, guideCard, helperCard, farmCard, ranchCard, pantryCard, stallCard, foot);

        let helperTip = null;
        let farmTip = null;
        let ranchTip = null;
        let confirmHarvestId = '';
        let confirmUnrentFarm = false;
        let confirmUnrentRanch = false;
        let lastData = null;

        const runOp = (section, method, payload) => {
          return ctx.invoke(method, payload !== undefined ? [payload] : undefined)
            .then((r) => {
              const tip = (r && r.ok === false)
                ? { text: r.reason || '操作没成功', err: true, until: Date.now() + 5500 }
                : { text: (r && r.message) || '操作成功 ✓', err: false, until: Date.now() + 4500 };
              if (section === 'farm') farmTip = tip;
              else if (section === 'helper') helperTip = tip;
              else ranchTip = tip;
              render(r);
            })
            .catch((e) => {
              const tip = { text: (e && e.message) || '请求失败', err: true, until: Date.now() + 5500 };
              if (section === 'farm') farmTip = tip;
              else if (section === 'helper') helperTip = tip;
              else ranchTip = tip;
              if (lastData) render(lastData);
            });
        };

        const render = (d) => {
          if (!d) return;
          lastData = d;
          ver.textContent = d.version ? `· v${d.version}` : '';
          const parts = [
            d.town?.name || '兰州',
            d.solarTerm?.name ? `节气·${d.solarTerm.name}` : '',
            d.home?.tierLabel ? `${d.home.tierLabel}（菜槽 ${d.farm?.homeSlots ?? 1}）` : '',
            d.money ? `现金 ¥${Number(d.money.cash || 0).toLocaleString('zh-CN')}` : '',
          ].filter(Boolean);
          sub.textContent = parts.join(' · ');

          /* 1. 玩法全链路图解 + 五大赛道成本说明表 */
          guideCard.innerHTML = '';
          guideCard.append(el('h3', null, '农牧场（支持下方直接点击种菜与养殖）× 鱼市街闭环'));
          const steps = el('div', 'lf-steps');
          const stepDefs = [
            ['① 种菜扩展 18 种', '18 种节气作物（红薯/土豆/萝卜/玉米/黄豆/莲藕等，4–9 天）；可直接在下方选种子点击播种、浇水与收割。'],
            ['② 养鸡牛与鱼塘', '大肥鱼是鲸鱼不算鱼，可放心养草鱼/鲈鱼，另有鸡舍收蛋肉、牛棚挤奶收牛肉；老小区起有鸡舍，签约城郊农牧场全解锁。'],
            ['③ 储物篮与成品菜', '蔬果与肉蛋奶鱼入储物篮；她下厨做出成品菜格既可热吃，也能在鱼市街摆料理摊免现买原料费（仅 ¥2 打包）。'],
            ['④ 鱼市街摆摊入账', '五大品类摆摊实扣本钱与精力（3 天过期压货）；成交后由 life_deals 进账钱包（同两人每日限 2 单防刷）。'],
          ];
          for (const [st, sd] of stepDefs) {
            const box = el('div', 'lf-step');
            box.append(el('div', 'st-t', st), el('div', 'st-d', sd));
            steps.append(box);
          }
          guideCard.append(steps);

          const rulesFold = el('details', 'lf-fold');
          const rulesSum = el('summary', null, '五大赛道门槛、本钱明细与常用对话示范');
          rulesSum.append(el('span', 'hint', '点击展开规则表'));
          const rulesBody = el('div', null);
          const wrap = el('div', 'lf-table-wrap');
          const table = el('table', 'lf-table');
          const thead = document.createElement('thead');
          const thr = document.createElement('tr');
          for (const hText of ['赛道品类', '准入门槛', '真实本钱结算', '精力消耗', '代表商品']) {
            thr.append(el('th', null, hText));
          }
          thead.append(thr);
          const tbody = document.createElement('tbody');
          const rules = d.stallRules || DEFAULT_STALL_RULES;
          for (const r of rules) {
            const tr = document.createElement('tr');
            const cTd = el('td');
            const cp = el('span', 'lf-cat-pill', r.label);
            cp.setAttribute('data-cat', r.category);
            cTd.append(cp);
            tr.append(
              cTd,
              el('td', null, r.requirement),
              el('td', null, r.costFormula),
              el('td', null, r.energyNote),
              el('td', null, r.examples),
            );
            tbody.append(tr);
          }
          table.append(thead, tbody);
          wrap.append(table);
          rulesBody.append(wrap);

          const sayTitle = el('div', 'lf-subh', '常用对话示范（下厨与摆摊在聊天里对它说即可）');
          sayTitle.style.marginTop = '9px';
          const sayList = el('ul', 'lf-say-list');
          sayList.append(
            el('li', null, '菜谱下厨：「去用储物篮里的红薯烤个红薯吃」「考个厨师证」「用番茄和牛肉做份西红柿炖牛腩存着摆摊」'),
            el('li', null, '养殖与收货：「看看牧场和鱼塘还能放养啥」「去鸡舍把鸡蛋收了」「起塘收草鱼」'),
            el('li', null, '农产/料理摆摊：「把自家鲜鸡蛋或莲藕挂鱼市街卖 16 元 3 份」「把做好的成品菜拿去鱼市街摆摊」'),
          );
          rulesBody.append(sayTitle, sayList);
          rulesFold.append(rulesSum, rulesBody);
          guideCard.append(rulesFold);

          /* 1.5 农牧帮手（活干完0元免扣 · 优先真鱼邻里代管，找不到自动回落） */
          helperCard.innerHTML = '';
          const fh = d.farmHelper || { mode: 'off', dailyWage: 0, lastRunDay: '', lastSummary: '', preferNeighbor: true, pendingErrand: null };
          const hPlans = d.helperPlans || [
            { mode: 'care', label: '日常照料工', dailyWage: 12, note: '每日自动浇水、喂食（实扣饲料）并收鸡蛋/牛奶入储物篮；当日活干完 0 元免扣。' },
            { mode: 'full', label: '农牧全托管', dailyWage: 20, note: '含照料全部内容，外加自动收割成熟蔬菜与起塘鱼塘（不出栏鸡牛）；当日活干完 0 元免扣。' },
          ];
          const pw = d.pendingWork || { total: 0, workPlots: 0, workPens: 0 };
          const nQuotes = d.neighborQuotes || {
            care: { wage: 6, minutes: 15, itemLabel: '农牧代管·照料' },
            full: { wage: 10, minutes: 20, itemLabel: '农牧代管·全托' },
          };
          const prefNeighbor = fh.preferNeighbor !== false;
          const curModeForErrand = fh.mode === 'full' ? 'full' : 'care';
          const curQuote = nQuotes[curModeForErrand] || nQuotes.care;

          const hHead = el('div', 'lf-mkt-head');
          const curPlan = hPlans.find((p) => p.mode === fh.mode);
          const hTitle = fh.mode !== 'off'
            ? `农牧帮手 · 已雇「${curPlan ? curPlan.label : fh.mode}」(自动 ¥${fh.dailyWage}/天 · ${prefNeighbor ? '优先找真鱼代管' : '仅自动照料'})`
            : '农牧帮手 · 今日活干完不扣钱 · 优先找真鱼代管（找不到自动兜底）';
          hHead.append(el('h3', null, hTitle));
          const hActs = el('div', 'lf-mkt-actions');

          const prefLabel = document.createElement('label');
          prefLabel.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#334155;cursor:pointer;';
          const prefBox = document.createElement('input');
          prefBox.type = 'checkbox';
          prefBox.checked = prefNeighbor;
          prefBox.addEventListener('change', () => {
            prefBox.disabled = true;
            runOp('helper', 'setHelperPref', { preferNeighbor: prefBox.checked });
          });
          prefLabel.append(prefBox, document.createTextNode('优先找真鱼代管'));
          hActs.append(prefLabel);

          for (const pl of hPlans) {
            const on = fh.mode === pl.mode;
            const nq = nQuotes[pl.mode];
            const priceHint = nq ? `邻里¥${nq.wage}/自动¥${pl.dailyWage}` : `¥${pl.dailyWage}/天`;
            const btn = el('button', 'lf-btn sm ' + (on ? 'info' : 'primary'), on ? `✓ ${pl.label}` : `雇 ${pl.label}(${priceHint})`);
            btn.type = 'button';
            btn.disabled = on;
            btn.title = pl.note;
            btn.addEventListener('click', () => { btn.disabled = true; runOp('helper', 'hireHelper', { mode: pl.mode, preferNeighbor: prefBox.checked }); });
            hActs.append(btn);
          }
          if (d.townConnected && pw.total > 0 && !fh.pendingErrand) {
            const postErrBtn = el('button', 'lf-btn sm', `发今日邻里单(¥${curQuote.wage}·约${curQuote.minutes}分)`);
            postErrBtn.type = 'button';
            postErrBtn.title = '在鱼市街单次发一条农牧代管委托，比系统自动更便宜；耗时按动植物数量算，6 小时无人接自动退钱';
            postErrBtn.addEventListener('click', () => { postErrBtn.disabled = true; runOp('helper', 'postErrand', { mode: curModeForErrand }); });
            hActs.append(postErrBtn);
          }
          if (fh.mode !== 'off') {
            const offBtn = el('button', 'lf-btn sm danger', '解雇帮手');
            offBtn.type = 'button';
            offBtn.addEventListener('click', () => { offBtn.disabled = true; runOp('helper', 'unhireHelper', {}); });
            hActs.append(offBtn);
          }
          hHead.append(hActs);
          helperCard.append(hHead);
          if (helperTip && helperTip.until > Date.now()) {
            helperCard.append(el('div', 'lf-feedback ' + (helperTip.err ? 'err' : 'ok'), helperTip.text));
          }
          if (fh.pendingErrand) {
            const pe = fh.pendingErrand;
            const peBar = el('div', 'lf-feedback ok');
            peBar.textContent = `鱼市街正挂着邻里代管委托：预扣 ¥${pe.wage} · 预计忙活 ${pe.minutes} 分钟 · 截止 ${fmtLocal(pe.expiresAt, 'mdhm')}（街坊接单即免费照看，超时无人接自动退回并转自动照料）`;
            helperCard.append(peBar);
          }
          if (fh.lastSummary) {
            helperCard.append(el('div', 'lf-board-strip', `最近代管：${fh.lastSummary}`));
          }
          const workStatusTxt = pw.total > 0
            ? `眼下有 ${pw.total} 项未照料（邻里参考：照料 ¥${nQuotes.care.wage}/约${nQuotes.care.minutes}分 · 全托 ¥${nQuotes.full.wage}/约${nQuotes.full.minutes}分）。`
            : '今天菜地与牧场的活都已照料完毕（自己干或街坊帮完后，自动照料系统今日 0 元不扣钱）。';
          helperCard.append(el('p', 'lf-note-line', `${workStatusTxt} 找不到街坊时才走系统自动照料兜底（最多追补 7 天）；现金不够工钱自动暂停绝不倒欠；绝不擅自出栏产蛋产奶的鸡牛。`));

          /* 2. 菜园与种植槽（支持用户直接点击操作） */
          farmCard.innerHTML = '';
          const fm = d.farm || { homeSlots: 1, leased: false, leasedSlots: 0, leasedMonthly: 150, totalSlots: 1, usedSlots: 0, readyCount: 0, plots: [] };
          const leaseCfg = d.leaseConfig || { slots: 4, signupFee: 100, monthly: 150 };
          const fHead = el('div', 'lf-mkt-head');
          fHead.append(el('h3', null, `菜园与种植槽（${fm.usedSlots}/${fm.totalSlots} 槽已种${fm.readyCount > 0 ? ` · ${fm.readyCount} 槽已熟可收` : ''}）`));
          const fActs = el('div', 'lf-mkt-actions');
          if (!fm.leased) {
            const rentBtn = el('button', 'lf-btn sm primary', `签约城郊菜地 +${leaseCfg.slots}槽 (¥${leaseCfg.signupFee}+¥${leaseCfg.monthly}/月)`);
            rentBtn.type = 'button';
            rentBtn.addEventListener('click', () => { rentBtn.disabled = true; runOp('farm', 'rentFarm', {}); });
            fActs.append(rentBtn);
          } else {
            fActs.append(el('span', 'lf-chip info', `城郊菜地已签：+${fm.leasedSlots}槽（¥${fm.leasedMonthly}/月）`));
            const unrentBtn = el('button', 'lf-btn sm' + (confirmUnrentFarm ? ' danger' : ''), confirmUnrentFarm ? '确认退租(放弃租地未收)?' : '退租菜地');
            unrentBtn.type = 'button';
            unrentBtn.addEventListener('click', () => {
              const hasLeasedPlot = (fm.plots || []).some((p) => p.source === 'leased');
              if (hasLeasedPlot && !confirmUnrentFarm) {
                confirmUnrentFarm = true;
                render(d);
                return;
              }
              confirmUnrentFarm = false;
              unrentBtn.disabled = true;
              runOp('farm', 'unrentFarm', { force: hasLeasedPlot });
            });
            fActs.append(unrentBtn);
          }
          fHead.append(fActs);
          farmCard.append(fHead);

          if (farmTip && farmTip.until > Date.now()) {
            farmCard.append(el('div', 'lf-feedback ' + (farmTip.err ? 'err' : 'ok'), farmTip.text));
          }

          const plotsGrid = el('div', 'lf-plots');
          for (const p of (fm.plots || [])) {
            const card = el('div', 'lf-plot' + (p.ready ? ' ready' : ''));
            const top = el('div', 'ptop');
            top.append(el('span', null, p.name || p.seedId));
            top.append(el('span', 'ptag', p.ready ? '可收割' : `剩 ${p.daysLeft}天`));
            const meta1 = el('div', 'pmeta');
            meta1.append(
              el('span', null, `${p.source === 'leased' ? '城郊租地' : '住处槽'} · 预产 ${p.expectedYield} 份`),
              el('span', null, `浇水 ${p.waterCount}/2${p.wateredToday ? ' ✓今' : ''}`),
            );
            const track = el('div', 'ptrack');
            const fill = el('div', 'pfill');
            fill.style.width = `${Math.max(4, Math.min(100, Math.round((p.progress || 0) * 100)))}%`;
            track.append(fill);
            const meta2 = el('div', 'pmeta');
            meta2.append(
              el('span', null, p.solarBonus ? '★当季节气 +1 产' : `成熟：${fmtLocal(p.matureAt, 'mdhm')}`),
              el('span', null, `${Math.round((p.progress || 0) * 100)}%`),
            );
            const pact = el('div', 'pact');
            if (p.ready) {
              const hb = el('button', 'lf-btn sm primary', '收割入篮');
              hb.type = 'button';
              hb.addEventListener('click', () => { hb.disabled = true; runOp('farm', 'harvest', { plotId: p.id }); });
              pact.append(hb);
            } else {
              const wb = el('button', 'lf-btn sm', p.wateredToday ? '今日已浇水' : '浇水');
              wb.type = 'button';
              wb.disabled = Boolean(p.wateredToday);
              wb.addEventListener('click', () => { wb.disabled = true; runOp('farm', 'water', { plotId: p.id }); });
              pact.append(wb);
            }
            card.append(top, meta1, track, meta2, pact);
            plotsGrid.append(card);
          }

          const emptyCount = Math.max(0, (fm.totalSlots || 0) - (fm.plots || []).length);
          const curTerm = d.solarTerm?.name || '';
          const seeds = d.seeds || [];
          for (let i = 0; i < emptyCount; i++) {
            const ec = el('div', 'lf-plot empty');
            ec.append(el('div', 'ptop', '空种植槽'));
            const pact = el('div', 'pact');
            const sel = document.createElement('select');
            sel.className = 'lf-select';
            for (const sd of seeds) {
              const op = document.createElement('option');
              op.value = sd.id;
              const hit = curTerm && Array.isArray(sd.solarTerms) && sd.solarTerms.includes(curTerm);
              op.textContent = `${sd.name} ¥${sd.price}/${Math.round(sd.growHours / 24)}天${hit ? ' ★' : ''}${sd.needSpace && (fm.totalSlots || 0) < 2 ? '(需≥2槽)' : ''}`;
              if (sd.needSpace && (fm.totalSlots || 0) < 2) op.disabled = true;
              sel.append(op);
            }
            const pb = el('button', 'lf-btn sm primary', '播种');
            pb.type = 'button';
            pb.addEventListener('click', () => { pb.disabled = true; runOp('farm', 'plant', { seed: sel.value }); });
            pact.append(sel, pb);
            ec.append(pact);
            plotsGrid.append(ec);
          }
          farmCard.append(plotsGrid);

          const seedsFold = el('details', 'lf-fold');
          const seedsSum = el('summary', null, '节气种子目录（4–9 天慢熟 · 含下游菜品联动）');
          seedsSum.append(el('span', 'hint', `共 ${seeds.length} 种`));
          const sWrap = el('div', 'lf-table-wrap');
          const sTable = el('table', 'lf-table');
          const sThead = document.createElement('thead');
          const sThr = document.createElement('tr');
          for (const hText of ['作物名称', '种子费', '周期', '基础产量', '加产节气', '下游可做菜品', '说明']) sThr.append(el('th', null, hText));
          sThead.append(sThr);
          const sTbody = document.createElement('tbody');
          for (const sd of seeds) {
            const tr = document.createElement('tr');
            const hitTerm = curTerm && Array.isArray(sd.solarTerms) && sd.solarTerms.includes(curTerm);
            const nmTd = el('td', null, sd.name + (hitTerm ? ' ★当季+1' : ''));
            if (hitTerm) nmTd.style.color = '#166534';
            tr.append(
              nmTd,
              el('td', null, `¥${sd.price}`),
              el('td', null, `${Math.round(sd.growHours / 24)} 天`),
              el('td', null, `${sd.baseYield} 份`),
              el('td', null, (sd.solarTerms || []).join(' / ')),
              el('td', null, (sd.dishHints || []).join('、') || '—'),
              el('td', null, sd.note || ''),
            );
            sTbody.append(tr);
          }
          sTable.append(sThead, sTbody);
          sWrap.append(sTable);
          seedsFold.append(seedsSum, sWrap);
          farmCard.append(seedsFold);

          /* 3. 动物养殖场（鸡舍 / 牛棚 / 鱼塘，支持手动点击操作） */
          ranchCard.innerHTML = '';
          const rn = d.ranch || {
            homeSlots: { chicken: 0, cow: 0, fish: 0 },
            leased: false,
            leasedSlots: { chicken: 0, cow: 0, fish: 0 },
            leasedMonthly: 240,
            totalSlots: { chicken: 0, cow: 0, fish: 0 },
            usedSlots: { chicken: 0, cow: 0, fish: 0 },
            collectableCount: 0,
            readyHarvestCount: 0,
            pens: [],
          };
          const rLease = d.ranchLeaseConfig || { slots: { chicken: 2, cow: 2, fish: 2 }, signupFee: 180, monthly: 240 };
          const grpLabels = d.animalGroupLabels || { chicken: '鸡舍', cow: '牛棚', fish: '鱼塘' };

          const rHead = el('div', 'lf-mkt-head');
          const capDesc = `鸡 ${rn.usedSlots.chicken}/${rn.totalSlots.chicken} · 牛 ${rn.usedSlots.cow}/${rn.totalSlots.cow} · 鱼 ${rn.usedSlots.fish}/${rn.totalSlots.fish}`;
          rHead.append(el('h3', null, `养殖场 · 鸡舍 / 牛棚 / 鱼塘（${capDesc}）`));
          const rActs = el('div', 'lf-mkt-actions');
          if (!rn.leased) {
            const rrBtn = el('button', 'lf-btn sm primary', `签约城郊农牧场 +2鸡/+2牛/+2鱼 (¥${rLease.signupFee}+¥${rLease.monthly}/月)`);
            rrBtn.type = 'button';
            rrBtn.addEventListener('click', () => { rrBtn.disabled = true; runOp('ranch', 'rentRanch', {}); });
            rActs.append(rrBtn);
          } else {
            rActs.append(el('span', 'lf-chip info', `城郊农牧场已签（¥${rn.leasedMonthly}/月）`));
            const urBtn = el('button', 'lf-btn sm' + (confirmUnrentRanch ? ' danger' : ''), confirmUnrentRanch ? '确认退租(放弃场内在养)?' : '退租农牧场');
            urBtn.type = 'button';
            urBtn.addEventListener('click', () => {
              const hasLeasedPen = (rn.pens || []).some((p) => p.source === 'leased');
              if (hasLeasedPen && !confirmUnrentRanch) {
                confirmUnrentRanch = true;
                render(d);
                return;
              }
              confirmUnrentRanch = false;
              urBtn.disabled = true;
              runOp('ranch', 'unrentRanch', { force: hasLeasedPen });
            });
            rActs.append(urBtn);
          }
          rHead.append(rActs);
          ranchCard.append(rHead);

          if (ranchTip && ranchTip.until > Date.now()) {
            ranchCard.append(el('div', 'lf-feedback ' + (ranchTip.err ? 'err' : 'ok'), ranchTip.text));
          }

          const pensGrid = el('div', 'lf-plots');
          const animals = d.animals || [];
          for (const pen of (rn.pens || [])) {
            const readyFlag = pen.collectableQty > 0 || pen.mature;
            const card = el('div', 'lf-plot' + (readyFlag ? ' ready' : ''));
            const top = el('div', 'ptop');
            top.append(el('span', null, `${pen.name} (${grpLabels[pen.group] || pen.group})`));
            top.append(el('span', 'ptag', pen.mature ? '已育成' : `剩 ${pen.daysLeft}天`));
            const m1 = el('div', 'pmeta');
            m1.append(
              el('span', null, `${pen.source === 'leased' ? '城郊牧场' : '自家小院'} · 喂食 ${pen.feedCount}次${pen.fedToday ? ' ✓今' : ''}`),
              el('span', null, pen.collectableQty > 0 ? `可收 ${pen.collectProductName}×${pen.collectableQty}` : `出栏/起塘：${pen.harvestProductName}×${pen.harvestYield}`),
            );
            const track = el('div', 'ptrack');
            const fill = el('div', 'pfill');
            fill.style.width = `${Math.max(4, Math.min(100, Math.round((pen.progress || 0) * 100)))}%`;
            track.append(fill);

            const pact = el('div', 'pact');
            const fb = el('button', 'lf-btn sm', pen.fedToday ? '今日已喂' : `喂食 ¥${pen.feedCost}`);
            fb.type = 'button';
            fb.disabled = Boolean(pen.fedToday);
            fb.addEventListener('click', () => { fb.disabled = true; runOp('ranch', 'ranchFeed', { penId: pen.id }); });
            pact.append(fb);

            if (pen.collectableQty > 0) {
              const cb = el('button', 'lf-btn sm primary', `收${pen.collectProductName}×${pen.collectableQty}`);
              cb.type = 'button';
              cb.addEventListener('click', () => { cb.disabled = true; runOp('ranch', 'ranchCollect', { penId: pen.id }); });
              pact.append(cb);
            }
            if (pen.mature) {
              const isFish = pen.group === 'fish';
              const needConf = !isFish && confirmHarvestId !== pen.id;
              const hb = el('button', 'lf-btn sm ' + (isFish ? 'primary' : (needConf ? '' : 'danger')), isFish ? `起塘收${pen.harvestProductName}` : (needConf ? `出栏收${pen.harvestProductName}` : `确认出栏收肉`));
              hb.type = 'button';
              hb.addEventListener('click', () => {
                if (needConf) {
                  confirmHarvestId = pen.id;
                  render(d);
                  return;
                }
                confirmHarvestId = '';
                hb.disabled = true;
                runOp('ranch', 'ranchHarvest', { penId: pen.id });
              });
              pact.append(hb);
            }
            card.append(top, m1, track, pact);
            pensGrid.append(card);
          }

          let hasAnyEmptyRanch = false;
          for (const grp of ['chicken', 'cow', 'fish']) {
            const free = Math.max(0, (rn.totalSlots?.[grp] || 0) - (rn.usedSlots?.[grp] || 0));
            const opts = animals.filter((a) => a.group === grp);
            for (let i = 0; i < free; i++) {
              hasAnyEmptyRanch = true;
              const ec = el('div', 'lf-plot empty');
              ec.append(el('div', 'ptop', `空${grpLabels[grp] || grp}栏`));
              const pact = el('div', 'pact');
              const sel = document.createElement('select');
              sel.className = 'lf-select';
              for (const an of opts) {
                const op = document.createElement('option');
                op.value = an.id;
                op.textContent = `${an.name} ¥${an.price}`;
                sel.append(op);
              }
              const bb = el('button', 'lf-btn sm primary', '放养');
              bb.type = 'button';
              bb.addEventListener('click', () => { bb.disabled = true; runOp('ranch', 'ranchBuy', { animal: sel.value }); });
              pact.append(sel, bb);
              ec.append(pact);
              pensGrid.append(ec);
            }
          }
          if (!(rn.pens || []).length && !hasAnyEmptyRanch) {
            ranchCard.append(el('p', 'lf-muted', '当前住处（城中村）还没有自家养殖栏位：搬到老小区起解锁鸡舍，新小区起解锁鱼池，或直接点右上角签约城郊农牧场解锁鸡舍+牛棚+鱼塘！'));
          } else {
            ranchCard.append(pensGrid);
          }

          const animalsFold = el('details', 'lf-fold');
          const animalsSum = el('summary', null, '养殖品类与产出周期表（住处栏位 + 城郊农牧场）');
          animalsSum.append(el('span', 'hint', `共 ${animals.length} 种`));
          const aWrap = el('div', 'lf-table-wrap');
          const aTable = el('table', 'lf-table');
          const aThead = document.createElement('thead');
          const aThr = document.createElement('tr');
          for (const hText of ['品种', '栏位类型', '幼苗/饲料', '日常周期产出', '育成收获', '说明']) aThr.append(el('th', null, hText));
          aThead.append(aThr);
          const aTbody = document.createElement('tbody');
          for (const an of animals) {
            const tr = document.createElement('tr');
            tr.append(
              el('td', null, an.name),
              el('td', null, grpLabels[an.group] || an.group),
              el('td', null, `¥${an.price} / 饲料¥${an.feedCost}`),
              el('td', null, an.cycleHours > 0 ? `每${an.cycleHours}h ${an.cycleProductName}×${an.cycleYield}` : '无'),
              el('td', null, `${Math.round(an.matureHours / 24)}天 ${an.harvestProductName}×${an.harvestYield}`),
              el('td', null, an.note || ''),
            );
            aTbody.append(tr);
          }
          aTable.append(aThead, aTbody);
          aWrap.append(aTable);
          animalsFold.append(animalsSum, aWrap);
          ranchCard.append(animalsFold);

          /* 4. 储物篮与成品菜格 */
          pantryCard.innerHTML = '';
          const pan = d.pantry || [];
          const dishes = d.cookedDishes || [];
          const panTotal = pan.reduce((s, x) => s + (Number(x.qty) || 0), 0);
          const dishTotal = dishes.reduce((s, x) => s + (Number(x.qty) || 0), 0);
          pantryCard.append(el('h3', null, `储物篮原料（${panTotal} 份）与成品菜格（${dishTotal} 份）`));

          const splitBox = el('div', 'lf-mkt-split');
          splitBox.style.marginTop = '0';
          splitBox.style.paddingTop = '0';
          splitBox.style.borderTop = '0';

          const panCol = el('div', null);
          panCol.append(el('div', 'lf-subh', '储物篮原料（来自种菜、牧场与买菜）'));
          if (!pan.length) {
            panCol.append(el('p', 'lf-muted', '储物篮眼下空着。播种收割、收集蛋奶鱼肉或早市买鲜蔬后会存在这里。'));
          } else {
            const ul = el('ul', 'lf-list');
            for (const item of pan) {
              const li = el('li');
              const originTxt = ORIGIN_LABEL[item.origin] || item.origin;
              const kTxt = item.kind && KIND_LABEL[item.kind] ? KIND_LABEL[item.kind] : '';
              const pill = el('span', 'lf-chip ' + (item.origin === 'home-grown' || item.origin === 'ranch' ? 'good' : (item.origin === 'town-buy' ? 'info' : '')), originTxt);
              pill.style.marginRight = '6px';
              li.append(pill, document.createTextNode(`${item.name}${kTxt ? `(${kTxt})` : ''} ×${item.qty}`), el('span', 'id', `约¥${item.unitCost}/份`));
              ul.append(li);
            }
            panCol.append(ul);
          }

          const dishCol = el('div', null);
          dishCol.append(el('div', 'lf-subh', '成品菜格（可让它热吃或直挂料理摊）'));
          if (!dishes.length) {
            dishCol.append(el('p', 'lf-muted', '暂无存好的成品菜（在对话里让它做菜存起来即可，做料理摊只收 ¥2 打包保鲜费）。'));
          } else {
            const ul = el('ul', 'lf-list');
            for (const ds of dishes) {
              const li = el('li');
              const tPill = el('span', 'lf-chip ' + (ds.tier === 'chef' ? 'info' : 'good'), ds.tier === 'chef' ? '厨师招牌' : '家常简食');
              tPill.style.marginRight = '6px';
              li.append(tPill, document.createTextNode(`${ds.name} ×${ds.qty}`), el('span', 'id', `饱+${ds.foodGain} 娱+${ds.funGain}`));
              ul.append(li);
            }
            dishCol.append(ul);
          }
          splitBox.append(panCol, dishCol);
          pantryCard.append(splitBox);

          /* 5. 鱼市街与成交入账 */
          stallCard.innerHTML = '';
          stallCard.append(el('h3', null, '鱼市街 · 摊位与成交入账'));
          const bd = d.bulletin || [];
          if (bd.length) stallCard.append(el('div', 'lf-board-strip', `《街口黑板报》 ${bd.join('；')}`));

          const recordMap = new Map((d.stallRecords || []).map((r) => [r.id, r]));
          const os = d.otherStalls || [];
          const otherErrands = os.filter((st) => st.kind === 'errand');
          const otherGoods = os.filter((st) => st.kind !== 'errand');
          if (otherErrands.length) {
            stallCard.append(el('div', 'lf-subh', `街坊农牧委托 · 让大肥鱼帮忙干活挣零花钱（${otherErrands.length}）`));
            for (const st of otherErrands) stallCard.append(renderStallRow(st, true, recordMap));
            stallCard.append(el('p', 'lf-note-line', '在对话里对它说「接鱼市街最短的那份农牧委托」或报出上面的 16 位委托编号即可认领（不扣钱、不占今天正式打工额度）。'));
          }
          if (!otherGoods.length) {
            if (!otherErrands.length) {
              stallCard.append(el('p', 'lf-muted', '街坊这会儿还没摆出摊子或委托（或未连接城服务器）。'));
            }
          } else {
            stallCard.append(el('div', 'lf-subh', `街坊在售（${otherGoods.length}）`));
            for (const st of otherGoods) stallCard.append(renderStallRow(st, true, recordMap));
          }

          const split = el('div', 'lf-mkt-split');
          const mineCol = el('div', null);
          mineCol.append(el('div', 'lf-subh', '我的在架摊位'));
          const ms = d.myStalls || [];
          if (!ms.length) mineCol.append(el('p', 'lf-muted', '暂无在架摊位（每人最多挂 3 摊，3 天有效）。'));
          else for (const st of ms) mineCol.append(renderStallRow(st, false, recordMap));

          const dealCol = el('div', null);
          const un = Number(d.unseenDeals || 0);
          dealCol.append(el('div', 'lf-subh', un > 0 ? `成交入账回执（未读 ${un}）` : '成交入账回执'));
          dealCol.append(renderDealsList(d.deals || []));
          split.append(mineCol, dealCol);
          stallCard.append(split);
        };

        const load = () => ctx.invoke('snapshot').then(render).catch((e) => {
          sub.textContent = (e && e.message) ? e.message : '读取失败';
        });
        reload.addEventListener('click', () => {
          msg.textContent = '刷新中…';
          load().then(() => { msg.textContent = '已刷新 ✓'; }).catch(() => { msg.textContent = '刷新失败'; });
        });
        await load();
        const loop = () => ctx.timeout(() => load().finally(loop), 30_000);
        loop();
      },
    },

    diary: {
      async mount(ctx) {
        ensureStyle(ctx.root);
        const app = el('div', 'lf');
        ctx.root.append(app);

        const head = el('div', 'lf-head');
        head.append(el('h1', 'lf-town', '日记与时间轴'));
        const ver = el('span', 'lf-ver', '');
        head.append(ver);
        const sub = el('p', 'lf-sub', '读取中…');
        const dirLine = el('p', 'lf-dir', '');
        const notice = el('div', 'lf-note');
        notice.hidden = true;

        const tlCard = el('div', 'lf-card');
        const wrap = el('div', 'lf-diary-wrap');
        const listBox = el('div', 'lf-dlist');
        const viewBox = el('article', 'lf-dview');
        wrap.append(listBox, viewBox);

        const ledgerCard = el('div', 'lf-card');
        const foot = el('div', 'lf-foot');
        const reload = el('button', 'lf-btn', '刷新');
        reload.type = 'button';
        foot.append(reload);

        app.append(head, sub, dirLine, notice, tlCard, wrap, ledgerCard, foot);

        let selectedDate = '';
        let ledgerTab = 'today';
        let lastResp = null;

        const showEntry = (d) => {
          viewBox.innerHTML = '';
          if (!d) {
            viewBox.append(el('p', 'lf-muted', '还没有生活日记（晚上或对她说「写日记」时会记录）。'));
            return;
          }
          selectedDate = d.dateKey;
          viewBox.append(el('h2', null, `${d.dateKey} · ${d.town || '兰州'}`));
          const meta = [d.street, d.weather, d.summary].filter(Boolean).join(' · ');
          if (meta) viewBox.append(el('p', 'lf-dmeta', meta));
          for (const para of String(d.body || '').split(/\n{2,}/)) {
            const p = para.trim();
            if (p) viewBox.append(el('p', 'lf-dp', p));
          }
        };

        const render = (r) => {
          if (!r) return;
          lastResp = r;
          ver.textContent = r.version ? `· v${r.version}` : '';
          const statusNow = r.asleep
            ? `在睡（约余 ${r.asleep.hoursLeft}h）`
            : (r.activity ? `正在「${r.activity.label}」（剩 ${r.activity.minutesLeft}m）` : '空闲');
          const parts = [
            `${r.today || ''} ${r.dayPart || ''} ${r.clock || ''}`.trim(),
            r.solarTerm?.name ? `节气·${r.solarTerm.name}` : '',
            r.streetWindow ? `${r.streetWindow.place}${r.streetWindow.label}` : '',
            statusNow,
          ].filter(Boolean);
          sub.textContent = parts.join(' · ') || '生活日记与一日时间轴';

          dirLine.textContent = r.dir ? `日记目录：${r.dir}` : '';
          notice.hidden = true;
          if (r.problem) {
            notice.hidden = false;
            notice.textContent = r.problem;
          } else if (r.inTrip) {
            notice.hidden = false;
            notice.textContent = '旅行途中记录写入旅行日记，回家后恢复写入生活日记。';
          }

          /* 1. 一日时间轴（合并原 day 页签，不再与下面重复） */
          tlCard.innerHTML = '';
          const tList = (r.todayTellable && r.todayTellable.length) ? r.todayTellable : (r.recentTellable || r.tellable || []);
          tlCard.append(el('h3', null, (r.todayTellable && r.todayTellable.length) ? '今日时间轴' : '近期经历时间轴（今日暂无）'));
          if (!tList.length) {
            tlCard.append(el('p', 'lf-muted', '暂无经历片段。'));
          } else {
            const ul = el('ul', 'lf-list');
            for (const it of tList) {
              const li = el('li');
              li.append(document.createTextNode(it.text || ''));
              if (it.at) li.append(el('span', 'id', fmtLocal(it.at, 'mdhm')));
              ul.append(li);
            }
            tlCard.append(ul);
          }

          /* 2. 第一人称生活日记 */
          const days = r.days || [];
          listBox.innerHTML = '';
          if (!days.length) showEntry(null);
          else {
            const active = days.find((x) => x.dateKey === selectedDate) || days[0];
            for (const d of days) {
              const btn = el('button', 'lf-ditem');
              btn.type = 'button';
              if (d.dateKey === active.dateKey) btn.dataset.on = '1';
              btn.append(el('span', 'd', d.dateKey), el('span', 'c', d.town || '兰州'));
              btn.addEventListener('click', () => {
                for (const ch of listBox.children) if (ch.dataset) delete ch.dataset.on;
                btn.dataset.on = '1';
                showEntry(d);
              });
              listBox.append(btn);
            }
            showEntry(active);
          }

          /* 3. 合并收支流水（支持今日 / 近期切换，不重复渲染两遍） */
          ledgerCard.innerHTML = '';
          const lHead = el('div', 'lf-mkt-head');
          const todayL = r.todayLedger || [];
          const recentL = r.ledger || [];
          lHead.append(el('h3', null, '收支流水'));
          const lTabs = el('div', 'lf-tabs');
          lTabs.style.marginBottom = '0';
          for (const [lid, llab] of [['today', `今日 (${todayL.length})`], ['recent', `近期 (${recentL.length})`]]) {
            const tb = el('button', 'lf-btn sm lf-tab', llab);
            tb.type = 'button';
            if (ledgerTab === lid) tb.dataset.on = '1';
            tb.addEventListener('click', () => { ledgerTab = lid; render(lastResp); });
            lTabs.append(tb);
          }
          lHead.append(lTabs);
          ledgerCard.append(lHead);

          const lShow = ledgerTab === 'today'
            ? (todayL.length ? todayL : recentL)
            : recentL;
          if (!lShow.length) {
            ledgerCard.append(el('p', 'lf-muted', '暂无收支流水。'));
          } else {
            if (ledgerTab === 'today' && !todayL.length) {
              ledgerCard.append(el('p', 'lf-note-line', '今日暂无流水，暂展示近期记录：'));
            }
            const ul = el('ul', 'lf-list');
            for (const e of lShow) {
              const li = el('li');
              const sign = e.kind === 'income' ? '+' : '-';
              li.append(document.createTextNode(`${sign}¥${e.amount} · ${e.note || e.source}${e.payee ? `（${e.payee}）` : ''}`));
              if (e.ts) li.append(el('span', 'id', fmtLocal(e.ts, 'mdhm')));
              ul.append(li);
            }
            ledgerCard.append(ul);
          }
        };

        const load = () => ctx.invoke('list').then(render).catch((e) => {
          dirLine.textContent = (e && e.message) ? e.message : '读取失败';
        });
        reload.addEventListener('click', load);
        await load();
        const loop = () => ctx.timeout(() => load().finally(loop), 25_000);
        loop();
      },
    },

    library: {
      async mount(ctx) {
        ensureStyle(ctx.root);
        const app = el('div', 'lf');
        ctx.root.append(app);

        const CAT_LABELS = { characters: '人物', outfits: '服饰', scenes: '场景', props: '道具' };
        const head = el('div', 'lf-head');
        head.append(el('h1', 'lf-town', '素材库与留影'));
        const dirLine = el('div', 'lf-dir', '');

        const policyCard = el('div', 'lf-card');
        policyCard.append(el('h3', null, '留影策略'));
        const pRow = el('div', 'lf-form-row');
        pRow.style.marginBottom = '0';
        const policySel = document.createElement('select');
        policySel.className = 'lf-select';
        for (const [val, lab] of [['off', '静默（不主动拍）'], ['milestone', '重要时刻（推荐）'], ['active', '积极留影']]) {
          const op = document.createElement('option');
          op.value = val;
          op.textContent = lab;
          policySel.append(op);
        }
        const cdInput = document.createElement('input');
        cdInput.type = 'number';
        cdInput.min = '0';
        cdInput.max = '1440';
        cdInput.className = 'lf-input';
        cdInput.style.flex = '0 0 90px';
        cdInput.placeholder = '冷却分钟';
        const pSaveBtn = el('button', 'lf-btn', '保存');
        pSaveBtn.type = 'button';
        const pMsg = el('span', 'lf-msg', '');
        pRow.append(policySel, document.createTextNode('冷却(m)：'), cdInput, pSaveBtn, pMsg);
        policyCard.append(pRow);

        const tabs = el('div', 'lf-tabs');
        let curCat = 'characters';
        let lastState = { entries: [], settings: { policy: 'milestone', cooldownMin: 60 }, dir: '' };

        const formFold = el('details', 'lf-card lf-fold');
        const formTitle = el('summary', null, '添加或编辑条目');
        const formBody = el('div', null);
        const fRow = el('div', 'lf-form-row');
        const nameIn = document.createElement('input');
        nameIn.className = 'lf-input';
        nameIn.placeholder = '名称（如：街角咖啡馆）';
        const aliasIn = document.createElement('input');
        aliasIn.className = 'lf-input';
        aliasIn.placeholder = '别名，逗号分隔（可选）';
        const tagIn = document.createElement('input');
        tagIn.className = 'lf-input';
        tagIn.placeholder = '标签，逗号分隔（可选）';
        fRow.append(nameIn, aliasIn, tagIn);
        const appIn = document.createElement('textarea');
        appIn.className = 'lf-textarea';
        appIn.placeholder = '外观/场景/物品画面描述（会拼进生图提示词）';
        const dropZone = el('div', 'lf-drop', '点击选择或拖入 1-4 张参考图（可选）');
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.multiple = true;
        fileInput.hidden = true;
        const previewBox = el('div', 'lf-lib-thumbs');
        previewBox.style.marginBottom = '7px';
        let pendingDataUrls = [];
        let editingId = '';
        const btnRow = el('div', 'lf-form-row');
        btnRow.style.marginBottom = '0';
        const submitBtn = el('button', 'lf-btn', '保存到素材库');
        submitBtn.type = 'button';
        const resetBtn = el('button', 'lf-btn', '清空');
        resetBtn.type = 'button';
        const fMsg = el('span', 'lf-msg', '');
        btnRow.append(submitBtn, resetBtn, fMsg);
        formBody.append(fRow, appIn, dropZone, fileInput, previewBox, btnRow);
        formFold.append(formTitle, formBody);

        const grid = el('div', 'lf-lib-grid');
        app.append(head, dirLine, policyCard, tabs, formFold, grid);

        const readImages = (files) => {
          const picked = Array.from(files || []).filter((f) => /^image\//.test(f.type)).slice(0, 4);
          if (!picked.length) return;
          Promise.all(picked.map((f) => new Promise((res) => {
            const fr = new FileReader();
            fr.onload = () => res(typeof fr.result === 'string' ? fr.result : '');
            fr.onerror = () => res('');
            fr.readAsDataURL(f);
          }))).then((urls) => {
            pendingDataUrls = urls.filter(Boolean);
            previewBox.innerHTML = '';
            for (const u of pendingDataUrls) {
              const img = document.createElement('img');
              img.src = u;
              previewBox.append(img);
            }
          });
        };
        dropZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => readImages(fileInput.files));
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('over'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
        dropZone.addEventListener('drop', (e) => {
          e.preventDefault();
          dropZone.classList.remove('over');
          readImages(e.dataTransfer && e.dataTransfer.files);
        });

        const resetForm = () => {
          editingId = '';
          nameIn.value = '';
          aliasIn.value = '';
          tagIn.value = '';
          appIn.value = '';
          pendingDataUrls = [];
          previewBox.innerHTML = '';
          formTitle.textContent = `+ 在「${CAT_LABELS[curCat]}」添加条目`;
        };
        resetBtn.addEventListener('click', () => { resetForm(); fMsg.textContent = ''; });

        const render = (r) => {
          lastState = r || lastState;
          dirLine.textContent = lastState.dir ? `目录：${lastState.dir}` : '';
          if (lastState.settings) {
            policySel.value = lastState.settings.policy || 'milestone';
            cdInput.value = String(lastState.settings.cooldownMin ?? 60);
          }
          tabs.innerHTML = '';
          for (const cat of Object.keys(CAT_LABELS)) {
            const count = (lastState.entries || []).filter((x) => x.category === cat).length;
            const tb = el('button', 'lf-btn lf-tab', `${CAT_LABELS[cat]} (${count})`);
            tb.type = 'button';
            if (cat === curCat) tb.dataset.on = '1';
            tb.addEventListener('click', () => { curCat = cat; resetForm(); render(lastState); });
            tabs.append(tb);
          }
          formTitle.textContent = editingId
            ? `编辑「${CAT_LABELS[curCat]}」：${editingId}`
            : `+ 在「${CAT_LABELS[curCat]}」添加条目`;

          grid.innerHTML = '';
          const items = (lastState.entries || []).filter((x) => x.category === curCat);
          if (!items.length) {
            formFold.open = true;
            grid.append(el('p', 'lf-muted', '暂无条目，可在上方展开后添加。'));
            return;
          }
          for (const it of items) {
            const card = el('div', 'lf-lib-card');
            const top = el('div', 'top');
            top.append(el('span', 'nm', it.name || it.id), el('span', 'alias', it.id));
            card.append(top);
            if (it.aliases && it.aliases.length) card.append(el('div', 'alias', `别名：${it.aliases.join('、')}`));
            card.append(el('div', 'desc', it.appearance || '暂无画面描述'));
            if (it.imagePreviews && it.imagePreviews.length) {
              const thumbs = el('div', 'lf-lib-thumbs');
              for (const src of it.imagePreviews) {
                const img = document.createElement('img');
                img.src = src;
                thumbs.append(img);
              }
              card.append(thumbs);
            }
            const actRow = el('div', 'lf-form-row');
            actRow.style.marginTop = 'auto';
            actRow.style.marginBottom = '0';
            const editBtn = el('button', 'lf-btn', '编辑');
            editBtn.type = 'button';
            editBtn.addEventListener('click', () => {
              editingId = it.id;
              nameIn.value = it.name || '';
              aliasIn.value = (it.aliases || []).join(', ');
              tagIn.value = (it.tags || []).join(', ');
              appIn.value = it.appearance || '';
              pendingDataUrls = [];
              previewBox.innerHTML = '';
              formTitle.textContent = `编辑「${CAT_LABELS[curCat]}」：${editingId}`;
              formFold.open = true;
            });
            const delBtn = el('button', 'lf-btn', '删除');
            delBtn.type = 'button';
            delBtn.addEventListener('click', () => {
              ctx.invoke('delete', [{ category: curCat, id: it.id }]).then((nr) => {
                fMsg.textContent = `已删除 ${it.name}`;
                render(nr);
              }).catch((e) => { fMsg.textContent = (e && e.message) || '删除失败'; });
            });
            actRow.append(editBtn, delBtn);
            card.append(actRow);
            grid.append(card);
          }
        };

        pSaveBtn.addEventListener('click', () => {
          pMsg.textContent = '保存中…';
          ctx.invoke('savePolicy', [{ policy: policySel.value, cooldownMin: Number(cdInput.value) || 0 }])
            .then((nr) => { pMsg.textContent = '已保存 ✓'; render(nr); })
            .catch((e) => { pMsg.textContent = (e && e.message) || '保存失败'; });
        });

        submitBtn.addEventListener('click', () => {
          const nm = nameIn.value.trim();
          if (!nm) { fMsg.textContent = '请填写条目名称'; return; }
          fMsg.textContent = '保存中…';
          ctx.invoke('upsert', [{
            id: editingId || undefined,
            category: curCat,
            name: nm,
            aliases: aliasIn.value,
            tags: tagIn.value,
            appearance: appIn.value,
            imageDataUrls: pendingDataUrls.length ? pendingDataUrls : undefined,
          }]).then((nr) => {
            fMsg.textContent = '已保存 ✓';
            resetForm();
            formFold.open = false;
            render(nr);
          }).catch((e) => { fMsg.textContent = (e && e.message) || '保存失败'; });
        });

        await ctx.invoke('list').then(render).catch((e) => {
          dirLine.textContent = (e && e.message) ? e.message : '读取失败';
        });
      },
    },
  },
};
