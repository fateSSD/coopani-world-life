/*
 * 模拟鱼生面板（1.2.1 精简版，原生 ES module，零打包直跑）。
 */

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
    fbWhy: '仅复制脱敏版本号与当前状态，点右侧链接可粘贴至 Issue。',
    who: '此刻概览',
    visits: '陪伴天数',
    visitDays: '近 7 天 {n} 天',
    noVisit: '近 7 天暂无',
    visitsHint: '含今日以内',
    job: '当前营生',
    certs: '证书',
    knowledge: '见识',
    knowledgeHint: '影响考证胜算，读书或高阶工作涨',
    fitness: '体质',
    fitnessHint: '运动/体力活涨，加快睡眠回精',
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
    moveNote: '换房押二付一（老房子押金不退）；与 life_move 共用同一本账。',
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
    fbWhy: 'Copies sanitized version & state, then paste into GitHub Issue.',
    who: 'Overview',
    visits: 'Visits',
    visitDays: '{n}d / 7d',
    noVisit: '0d / 7d',
    visitsHint: 'recent 7 days',
    job: 'Doing',
    certs: 'Certs',
    knowledge: 'Knowledge',
    knowledgeHint: 'decides exam pass chance',
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
    moveNote: 'Two months deposit upfront; same books as life_move.',
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

/* 鱼市街单行紧凑摊位清单 */
.lf-board-strip { font-size: 12px; padding: 6px 9px; border-radius: 7px; background: #fdf8ec; border: 1px solid #ecd9b6; color: #7a5b1c; margin-bottom: 8px; }
.lf-stall { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px dashed #f0f1f3; }
.lf-stall:last-child { border-bottom: 0; }
.lf-stall-l { flex: 1 1 auto; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.lf-stall-l .nm { font-weight: 600; color: #1f2937; font-size: 13px; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.lf-stall-l .seller { font-size: 11.5px; color: #94a3b8; }
.lf-fx-pill { font-size: 11px; padding: 1px 6px; border-radius: 5px; background: #f1f5f9; color: #475569; white-space: nowrap; }
.lf-veg-pill { font-size: 11px; padding: 1px 6px; border-radius: 5px; background: #eaf5ee; color: #2f855a; white-space: nowrap; }
.lf-stall-r { flex: 0 0 auto; font-size: 12px; font-variant-numeric: tabular-nums; color: #475569; white-space: nowrap; }
.lf-stall-r b { color: #1a6b4a; font-weight: 600; margin-right: 4px; }
.lf-mkt-split { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #eef0f3; }
.lf-subh { font-size: 11.5px; font-weight: 600; color: #6b7280; margin: 0 0 6px; }

.lf-list { margin: 0; padding: 0; list-style: none; }
.lf-list li { font-size: 12.5px; padding: 4px 0; border-bottom: 1px dashed #f0f1f3; color: #374151; }
.lf-list li:last-child { border-bottom: 0; }
.lf-list .id { color: #b0b5bd; font-size: 11px; margin-left: 6px; font-family: ui-monospace, Consolas, monospace; }
.lf-btn { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid #e5e7eb; background: #fff; color: #1b1e24; cursor: pointer; text-decoration: none; display: inline-block; }
.lf-btn:hover { background: #f7f8fa; }
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

const copyText = (text) => {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  } catch { /* fallback */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  } catch { /* ignore */ }
  return Promise.resolve();
};

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
          if (d.freshVeg) subRow.append(el('span', 'lf-chip good', '带鲜蔬（下厨更香）'));
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
            cost.append(el('b', null, `¥${q.monthly}/月`));
            cost.append(document.createTextNode(` · 押 ${q.deposit}`));
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
          fbBox.append(addr, el('p', 'lf-note-line', t(lang, 'fbWhy')));
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
          if (d.solarTerm && d.solarTerm.name) bits.push(d.solarTerm.name);
          if (d.weather && d.weather.sky) bits.push(d.weather.sky);
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

    day: {
      async mount(ctx) {
        ensureStyle(ctx.root);
        const app = el('div', 'lf');
        ctx.root.append(app);

        const head = el('div', 'lf-head');
        const title = el('h1', 'lf-town', '一天 · 时间轴');
        const ver = el('span', 'lf-ver', '');
        head.append(title, ver);
        const sub = el('p', 'lf-sub', '读取中…');
        const tlCard = el('div', 'lf-card');
        const ledgerCard = el('div', 'lf-card');
        const foot = el('div', 'lf-foot');
        const reload = el('button', 'lf-btn', '刷新');
        reload.type = 'button';
        foot.append(reload);
        app.append(head, sub, tlCard, ledgerCard, foot);

        const render = (d) => {
          if (!d) return;
          ver.textContent = d.version ? `· v${d.version}` : '';
          const statusNow = d.asleep
            ? `在睡（约余 ${d.asleep.hoursLeft}h）`
            : (d.activity ? `正在「${d.activity.label}」（剩 ${d.activity.minutesLeft}m）` : '空闲');
          const parts = [
            `${d.today || ''} ${d.dayPart || ''} ${d.clock || ''}`.trim(),
            d.solarTerm?.name,
            d.streetWindow ? `${d.streetWindow.place}${d.streetWindow.label}` : '',
            statusNow,
          ].filter(Boolean);
          sub.textContent = parts.join(' · ');

          tlCard.innerHTML = '';
          const list = (d.todayTellable && d.todayTellable.length) ? d.todayTellable : (d.recentTellable || []);
          tlCard.append(el('h3', null, (d.todayTellable && d.todayTellable.length) ? '今天经历' : '近期经历（今日暂无）'));
          if (!list.length) {
            tlCard.append(el('p', 'lf-muted', '暂无记录。'));
          } else {
            const ul = el('ul', 'lf-list');
            for (const it of list) {
              const li = el('li');
              li.append(document.createTextNode(it.text || ''));
              li.append(el('span', 'id', fmtLocal(it.at, 'mdhm')));
              ul.append(li);
            }
            tlCard.append(ul);
          }

          ledgerCard.innerHTML = '';
          const lList = (d.todayLedger && d.todayLedger.length) ? d.todayLedger : (d.ledger || []);
          ledgerCard.append(el('h3', null, (d.todayLedger && d.todayLedger.length) ? '今日流水' : '近期流水'));
          if (!lList.length) {
            ledgerCard.append(el('p', 'lf-muted', '暂无收支流水。'));
          } else {
            const ul = el('ul', 'lf-list');
            for (const e of lList) {
              const li = el('li');
              const sign = e.kind === 'income' ? '+' : '-';
              li.append(document.createTextNode(`${sign}¥${e.amount} · ${e.note || e.source}${e.payee ? `（${e.payee}）` : ''}`));
              if (e.ts) li.append(el('span', 'id', fmtLocal(e.ts, 'mdhm')));
              ul.append(li);
            }
            ledgerCard.append(ul);
          }
        };

        const load = () => ctx.invoke('snapshot').then(render).catch(() => {});
        reload.addEventListener('click', load);
        await load();
        const loop = () => ctx.timeout(() => load().finally(loop), 20_000);
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

        const marketCard = el('div', 'lf-card');
        app.append(head, cols, marketCard);

        const renderStallRow = (st, showSeller) => {
          const row = el('div', 'lf-stall');
          if (st.note) row.title = `摊主吆喝：${st.note}`;
          const left = el('div', 'lf-stall-l');
          left.append(el('span', 'nm', st.item));
          if (showSeller && st.seller) left.append(el('span', 'seller', st.seller));
          if (st.freshVeg) left.append(el('span', 'lf-veg-pill', '鲜蔬'));
          const fx = resolveStallEffects(st.effects, st.price);
          const pill = el('span', 'lf-fx-pill', fmtEffectsText(fx, true));
          pill.title = fmtEffectsText(fx, false);
          left.append(pill);

          const right = el('div', 'lf-stall-r');
          right.append(el('b', null, `¥${st.price}`), document.createTextNode(`×${st.stock}`));
          row.append(left, right);
          return row;
        };

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

          marketCard.innerHTML = '';
          marketCard.append(el('h3', null, '鱼市街'));
          const bd = d.bulletin || [];
          if (bd.length) {
            marketCard.append(el('div', 'lf-board-strip', `《街口黑板报》 ${bd.join('；')}`));
          }

          const os = d.otherStalls || [];
          if (!os.length) {
            marketCard.append(el('p', 'lf-muted', '街坊这会儿还没摆出摊子。'));
          } else {
            marketCard.append(el('div', 'lf-subh', `街坊在售（${os.length}）`));
            for (const st of os) marketCard.append(renderStallRow(st, true));
          }

          const split = el('div', 'lf-mkt-split');
          const mineCol = el('div', null);
          mineCol.append(el('div', 'lf-subh', '我的摊位'));
          const ms = d.myStalls || [];
          if (!ms.length) mineCol.append(el('p', 'lf-muted', '暂无在架摊位。'));
          else for (const st of ms) mineCol.append(renderStallRow(st, false));

          const dealCol = el('div', null);
          const un = Number(d.unseenDeals || 0);
          dealCol.append(el('div', 'lf-subh', un > 0 ? `成交回执（未读 ${un}）` : '成交回执'));
          const ds = d.deals || [];
          if (!ds.length) dealCol.append(el('p', 'lf-muted', '最近没有成交回执。'));
          else {
            const ul = el('ul', 'lf-list');
            for (const dl of ds) {
              const li = el('li');
              li.append(document.createTextNode(`${dl.seen ? '' : '[新] '}${dl.buyerPet} 买走 ${dl.qty} 份「${dl.item}」`));
              if (dl.at) li.append(el('span', 'id', fmtLocal(dl.at, 'mdhm')));
              ul.append(li);
            }
            dealCol.append(ul);
          }
          split.append(mineCol, dealCol);
          marketCard.append(split);
        };

        const load = () => ctx.invoke('snapshot').then(render).catch(() => {});
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
        head.append(el('h1', 'lf-town', '生活日记与流水'));
        const dirLine = el('p', 'lf-dir', '读取中…');
        const notice = el('div', 'lf-note');
        notice.hidden = true;
        app.append(head, dirLine, notice);

        const wrap = el('div', 'lf-diary-wrap');
        const listBox = el('div', 'lf-dlist');
        const viewBox = el('article', 'lf-dview');
        wrap.append(listBox, viewBox);
        app.append(wrap);

        const cols = el('div', 'lf-cols');
        const ledgerCard = el('div', 'lf-card');
        const eventsCard = el('div', 'lf-card');
        cols.append(ledgerCard, eventsCard);
        app.append(cols);

        let selectedDate = '';
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
          dirLine.textContent = r.dir ? `目录：${r.dir}` : '';
          notice.hidden = true;
          if (r.problem) {
            notice.hidden = false;
            notice.textContent = r.problem;
          } else if (r.inTrip) {
            notice.hidden = false;
            notice.textContent = '旅行途中记录写入旅行日记，回家后恢复写入生活日记。';
          }

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

          ledgerCard.innerHTML = '';
          ledgerCard.append(el('h3', null, '最近流水'));
          const ledger = r.ledger || [];
          if (!ledger.length) ledgerCard.append(el('p', 'lf-muted', '暂无收支流水。'));
          else {
            const ul = el('ul', 'lf-list');
            for (const e of ledger) {
              const li = el('li');
              const sign = e.kind === 'income' ? '+' : '-';
              li.append(document.createTextNode(`${sign}¥${e.amount} · ${e.note || e.source}${e.payee ? `（${e.payee}）` : ''}`));
              if (e.ts) li.append(el('span', 'id', fmtLocal(e.ts, 'md')));
              ul.append(li);
            }
            ledgerCard.append(ul);
          }

          eventsCard.innerHTML = '';
          eventsCard.append(el('h3', null, '最近经历'));
          const tells = r.tellable || [];
          if (!tells.length) eventsCard.append(el('p', 'lf-muted', '暂无经历片段。'));
          else {
            const ul = el('ul', 'lf-list');
            for (const it of tells) {
              const li = el('li');
              li.append(document.createTextNode(it.text || ''));
              if (it.at) li.append(el('span', 'id', fmtLocal(it.at, 'md')));
              ul.append(li);
            }
            eventsCard.append(ul);
          }
        };

        const load = () => ctx.invoke('list').then(render).catch((e) => {
          dirLine.textContent = (e && e.message) ? e.message : '读取失败';
        });
        await load();
        const loop = () => ctx.timeout(() => load().finally(loop), 30_000);
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
