/*
 * 「她此刻」面板。
 *
 * 原生 ES module，不打包 —— 宿主按 URL import 这个文件，浏览器直接跑。
 * 契约只有一条：default 导出 { panels: { <panelId>: { mount(ctx) } } }。
 *
 * ## 为什么这一页只读
 *
 * 这里的每一条都是「她的」，不是「他的」。放一个「让她吃饭」的按钮很方便，
 * 但方便的东西会被优先使用 —— 于是没人会等她自己判断，那套放权就散了。
 * 她想做什么，在对话里跟她说。
 *
 * ## 为什么不引框架
 *
 * 这一页画的东西不到三百行。为空这一个面板引一个运行时，换来的是迟早要处理的
 * 一次版本冲突，而收益是零。
 */

const TEXT = {
  zh: {
    loading: '读她的日子…',
    empty: '还没读到。',
    helpTitle: '三盏状态灯说明',
    helpOn: '绿',
    helpOnDesc: '连接与运行正常。',
    helpOff: '灰',
    helpOffDesc: '未启用（比如没装旅行扩展或未填同城地址），不是报错。',
    helpErr: '红',
    helpErrDesc: '已配置但异常，悬停看具体原因。',
    helpHint: '依次代表：过日子 · 本城服务器 · 旅行同步。',
    fbLead: '问题反馈与需求建议',
    fbBug: '复制诊断信息',
    fbWant: '复制状态（提建议）',
    fbOpenBug: '开 Issues 报 bug ↗',
    fbOpenWant: '开 Issues 提需求 ↗',
    fbCopied: '已复制 ✓',
    fbAddr: '仓库：',
    fbWhy: '先复制脱敏后的版本与状态，再点右侧链接粘进 Issue 正文。',
    who: '她是谁',
    visits: '他来过',
    visitDays: '这几天 {n} 天',
    noVisit: '这几天没来',
    visitsHint: '最近 7 天',
    pending: '悬着的事',
    noPending: '没什么悬着的。',
    pledges: '说好了',
    noPledge: '没有说好要做的事。',
    overdueTag: '到期没做',
    job: '在做什么',
    certs: '手上的证',
    noCert: '还没有证',
    knowledge: '见识',
    knowledgeHint: '考证能不能过看它，读书涨',
    fitness: '体质',
    fitnessHint: '锻炼、体力活或旅途步行骑行涨，加快回精',
    wishes: '想去哪',
    noWish: '还没记下想去的地方。',
    verSelf: 'v{v}',
    verNew: 'v{v} → v{new}',
    verHint: '新版本 {new} 已经在市场上了',
    noJob: '没在做事',
    home: '住在哪',
    rent: '租的',
    own: '买下的',
    money: '手上有',
    goals: '目标',
    moves: '住处 · 搬过去',
    streetsTitle: '本城街道 · 换条街住',
    moveStreetTo: '搬去这条街',
    streetMoveNote: '换街不收押金，不同街道有各自的街景介绍与属性增益/减益（仅在本城生效）；与 `life_move` 共用同一本账。',
    livingHere: '现在住这儿',
    moveTo: '搬过去',
    cantMove: '钱不够',
    moving: '搬…',
    moveNote: '押二付一（老房子押金退不回）；与她自主调用 `life_move` 共用同一本账。',
    noGoal: '还没给自己定目标。',
    left: '还差 ¥{n}',
    canNow: '够攒了，去办吧',
    achieved: '已经做到了',
    vitals: '五条',
    asleep: '在睡',
    asleepLeft: '还有 {h} 小时（醒来精力约 {e}）',
    acting: '正在做：{label}',
    actingLeft: '还剩 {m} 分钟（{p}%）',
    cond: '身上',
    mood: '心里',
    none: '没什么特别的',
    habits: '她的常态',
    watches: '在留意',
    wants: '想买什么',
    gifts: '你留下的',
    ledger: '最近流水',
    noneYet: '还没给自己定过什么。',
    town: '住',
    server: '读服务器',
    townOwn: '你自己填的',
    builtin: '内置',
    noJourney: '没装旅行扩展 —— 不知道她在哪座城，日子照过。',
    onRoad: '在路上，往 {to} 去（出发地 {from}）',
    stale: '旅行那边 {n} 分钟没更新了',
    clockGap: '她那边的钟比你{n}',
    faster: '快',
    slower: '慢',
    reload: '重读城设定',
    recoveredBak: '主档坏了，现在是上一份备份里的她。',
    recoveredFresh: '从零开始：没有找到她的旧档。',
  },
  en: {
    loading: 'Reading her day…',
    empty: 'Nothing yet.',
    helpTitle: 'What do the three dots next to the extension name mean?',
    helpOn: 'Green',
    helpOnDesc: 'last time worked. Normal.',
    helpOff: 'Grey',
    helpOffDesc: 'not enabled — that is not a fault. Nothing to do.',
    helpErr: 'Red',
    helpErrDesc: 'configured but not working. Hover the dot for the reason and the fix.',
    helpHint: 'The three are: daily life (is time still passing for her), town (did the name load from your server), travel (do we know what city she is in).',
    fbLead: 'A bug, or something you want her to do?',
    fbBug: 'Copy diagnostics',
    fbWant: 'Copy diagnostics (feature request)',
    fbOpenBug: 'Open an issue ↗',
    fbOpenWant: 'Request a feature ↗',
    fbCopied: 'copied — just paste it',
    fbAddr: 'Repo: ',
    fbWhy: 'The button only copies the version and current state to your clipboard '
      + '(no identifying info). Use the link to open a GitHub issue and paste it in the body.',
    who: 'Who she is',
    visits: 'You came by',
    visitDays: '{n} days',
    noVisit: 'not this week',
    visitsHint: 'last 7 days',
    pending: 'Undecided',
    noPending: 'Nothing pending.',
    pledges: 'Promised',
    noPledge: 'Nothing promised yet.',
    overdueTag: 'overdue',
    job: 'Doing',
    certs: 'Certificates',
    noCert: 'no certificates yet',
    knowledge: 'Knowledge',
    knowledgeHint: 'it decides whether a certificate exam passes',
    fitness: 'Fitness',
    fitnessHint: 'builds from workouts/physical jobs, speeds up sleep recovery',
    wishes: 'Want to go',
    noWish: 'No place on her list yet.',
    verSelf: 'v{v}',
    verNew: 'v{v} → v{new}',
    verHint: 'Version {new} is out',
    noJob: 'not working',
    home: 'Lives in',
    rent: 'rented',
    own: 'owned',
    money: 'Cash',
    goals: 'Goals',
    moves: 'Housing · move',
    streetsTitle: 'Streets · move street',
    moveStreetTo: 'Move street',
    streetMoveNote: 'Changing streets costs no deposit; each street has its own intro and stat modifiers while in town (same as life_move).',
    livingHere: 'living here',
    moveTo: 'Move in',
    cantMove: 'not enough',
    moving: 'moving…',
    moveNote: 'Two months deposit, paid upfront. The old deposit does not come back. '
      + 'This moves her; she can move herself too (life_move), on the same books.',
    noGoal: 'No goal set yet.',
    left: '¥{n} to go',
    canNow: 'enough — go do it',
    achieved: 'achieved',
    vitals: 'Needs',
    asleep: 'Asleep',
    asleepLeft: 'about {h}h left (energy ~{e} on waking)',
    acting: 'Doing: {label}',
    actingLeft: '{m} min left ({p}%)',
    cond: 'Body',
    mood: 'Mood',
    none: 'nothing unusual',
    habits: 'Her habits',
    watches: 'Watching',
    wants: 'Want to buy',
    noneYet: 'She has not set anything for herself yet.',
    town: 'Lives in',
    server: 'from server',
    townOwn: 'yours',
    builtin: 'built in',
    noJourney: 'Travel extension not installed — unknown city, life goes on.',
    onRoad: 'On the road to {to} (from {from})',
    stale: 'Travel data stale for {n} min',
    clockGap: 'Her clock is {n} ahead/behind',
    faster: 'ahead',
    slower: 'behind',
    reload: 'Reload town',
    recoveredBak: 'Main save was broken; this is her from the backup.',
    recoveredFresh: 'Starting fresh: no previous save found.',
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

/** 统一把 ISO 时刻格式化成兰州本机时区（Asia/Shanghai），避免 UTC+8 晚上显示成早 8 小时。 */
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

/**
 * 样式只注入一次。
 *
 * 宿主切页签时会反复 mount，每次都 append 一段 `<style>` 会让 DOM 越堆越多 ——
 * 不报错，只是越用越慢，而没人会想到是样式表堆了两百份。
 */
const STYLE_ID = 'life-panel-style';
function ensureStyle(root) {
  const doc = root.ownerDocument || document;
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
.lf { color: #1b1e24; font: 14px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
.lf * { box-sizing: border-box; }
.lf-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
.lf-town { font-size: 19px; font-weight: 650; margin: 0; }
.lf-tag { font-size: 11.5px; padding: 1px 7px; border-radius: 999px;
  background: #eef2f7; color: #6b7280; border: 1px solid #e5e7eb; }
/* 版本徽章：平常就是个附注（浅灰、无底），知道有新版才变成实心胶囊。 */
.lf-ver { font-size: 11px; color: #9ca3af; letter-spacing: .2px; }
.lf-ver[data-new="1"] { padding: 1px 7px; border-radius: 999px;
  background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; font-weight: 600; }
.lf-sub { color: #6b7280; font-size: 12.5px; margin: 0 0 16px; }
.lf-note { margin: 0 0 14px; padding: 8px 11px; border-radius: 8px;
  background: #fdf8ec; border: 1px solid #ecd9b6; color: #7a5b1c; font-size: 12.5px; }

.lf-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
  padding: 14px 16px; margin-bottom: 12px; }
.lf-card h3 { font-size: 12.5px; font-weight: 600; color: #6b7280;
  margin: 0 0 10px; letter-spacing: .02em; }

.lf-vital { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; }
.lf-vital:last-child { margin-bottom: 0; }
.lf-vital .k { flex: 0 0 42px; font-size: 13px; color: #374151; }
.lf-vital .track { flex: 1 1 auto; height: 9px; border-radius: 999px;
  background: #eef0f3; overflow: hidden; }
.lf-vital .fill { height: 100%; border-radius: 999px; transition: width .3s ease; }
.lf-vital .n { flex: 0 0 34px; text-align: right; font-size: 13px;
  font-variant-numeric: tabular-nums; color: #6b7280; }
.lf-vital.low .k { color: #c0392b; font-weight: 600; }
.lf-vital.low .n { color: #c0392b; }

.lf-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.lf-chip { font-size: 12.5px; padding: 3px 9px; border-radius: 999px;
  background: #f4f6f8; border: 1px solid #e5e7eb; color: #374151; }
.lf-chip.bad { background: #fdeceb; border-color: #f0cfcb; color: #c0392b; }
.lf-chip.good { background: #eaf5ee; border-color: #cbe7d6; color: #2f855a; }
.lf-muted { color: #9ca3af; font-size: 13px; }

/*
 * 「她是谁」那三格：在做什么、住哪儿、手上有多少钱。
 *
 * 用三格并排而不是一段话 —— 这三样是**同时要看的**，
 * 写成一句话（「她租在城中村，做搬货的活，手上有 3120 元」）读起来像自我介绍，
 * 不像仪表盘。而这一页的第二功能就是「扫一眼」。
 */
.lf-stats { display: flex; flex-wrap: wrap; gap: 10px; }
.lf-stat { flex: 1 1 150px; min-width: 130px; padding: 9px 11px;
  border: 1px solid #eef0f3; border-radius: 9px; background: #fbfcfd; }
.lf-stat .lab { font-size: 11.5px; color: #9ca3af; display: block; margin-bottom: 3px; }
.lf-stat .val { font-size: 15px; font-weight: 600; color: #1b1e24;
  font-variant-numeric: tabular-nums; word-break: break-word; }
.lf-stat .sub2 { font-size: 11.5px; color: #6b7280; margin-top: 2px; }
.lf-stat.money .val { color: #1a6b4a; }

/* 目标那条进度。有进度条才叫目标，没有的是一个愿望清单。 */
.lf-goal { margin-bottom: 10px; }
.lf-goal:last-child { margin-bottom: 0; }
.lf-goal .top { display: flex; justify-content: space-between; align-items: baseline;
  font-size: 13px; color: #374151; margin-bottom: 5px; gap: 10px; }
.lf-goal .left { flex: 0 0 auto; color: #6b7280; font-size: 12.5px;
  font-variant-numeric: tabular-nums; }
.lf-goal .track { height: 8px; border-radius: 999px; background: #eef0f3; overflow: hidden; }
.lf-goal .fill { height: 100%; border-radius: 999px; background: #2f6fed; transition: width .3s ease; }

/*
 * 住处四档那一列。
 *
 * 每行都**先把价说清**（每月多少、押几个月、还差多少），按钮才在右边。
 * 反过来（先按钮、点了才说钱不够）是最难受的一种：人点了个能点的东西，
 * 结果被告知不行。
 */
.lf-move { display: flex; align-items: center; gap: 10px; padding: 7px 0;
  border-bottom: 1px dashed #f0f1f3; }
.lf-move:last-child { border-bottom: 0; }
.lf-move .nm { flex: 0 0 76px; font-size: 13px; color: #374151; font-weight: 600; }
.lf-move.now .nm { color: #2f6fed; }
.lf-move .cost { flex: 1 1 auto; font-size: 12px; color: #6b7280; line-height: 1.5; }
.lf-move .cost b { color: #374151; font-weight: 600; font-variant-numeric: tabular-nums; }
.lf-move .cost .short { color: #c0392b; }
.lf-move .btnbox { flex: 0 0 auto; }
.lf-move .nowtag { font-size: 12px; color: #2f6fed; }
.lf-move .dep { font-size: 12px; color: #6b7280; }
.lf-note-line { margin: 10px 0 0; font-size: 11.5px; color: #9ca3af; line-height: 1.7; }
.lf-st-box { margin-top: 14px; padding-top: 12px; border-top: 1px solid #eef0f3; }
.lf-st-box h4 { font-size: 12.5px; font-weight: 600; color: #6b7280; margin: 0 0 8px; }
.lf-st-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px dashed #f0f1f3; }
.lf-st-row:last-child { border-bottom: 0; }
.lf-st-row.now .st-nm { color: #2f6fed; }
.lf-st-info { flex: 1 1 auto; min-width: 0; }
.lf-st-info .st-nm { font-size: 13px; font-weight: 600; color: #374151; }
.lf-st-info .st-desc { font-size: 12px; color: #6b7280; margin-top: 2px; line-height: 1.5; }
.lf-st-info .lf-chips { margin-top: 5px; }

/*
 * 「灯怎么看」那一块。
 *
 * 灯在**扩展名旁边**（宿主画的），不在这个面板里 —— 所以用户在界面上看到灰点、
 * 想知道是什么意思时，得有个地方能查。默认折叠：不占地方，但要找得到。
 */
.lf-help { margin-top: 12px; font-size: 12.5px; color: #374151; }
.lf-help summary { cursor: pointer; color: #2f6fed; font-size: 12.5px; padding: 4px 0; }
.lf-help summary:hover { text-decoration: underline; }
.lf-help ul { margin: 8px 0 0; padding-left: 18px; line-height: 1.9; }
.lf-help li b { color: #1b1e24; }
.lf-help .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
  margin-right: 5px; vertical-align: middle; }

/*
 * 底部反馈栏。
 *
 * ## 为什么不是 mailto:
 *
 * 宿主的 setWindowOpenHandler 只对 http(s) 调 shell.openExternal，其余一律 deny ——
 * **mailto 点下去是静默无事发生，比没有按钮更糟**（旅行扩展踩过，自己也踩过）。
 *
 * 所以：按钮只做「把诊断信息复制到剪贴板」，旁边给一个 https 的链接去 Issues。
 * 复制 + 打开是两个动作，用户点两下，比一个点了没反应的按钮可靠。
 */
.lf-fb { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
  padding: 13px 16px; margin-top: 12px; }
.lf-fb .lead { margin: 0 0 9px; font-size: 13px; color: #374151; }
.lf-fb .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.lf-fb .why { margin: 8px 0 0; font-size: 11.5px; color: #9ca3af; line-height: 1.6; }
.lf-fb .addr { display: flex; align-items: center; gap: 8px; margin-top: 8px;
  font-size: 11.5px; color: #6b7280; flex-wrap: wrap; }
.lf-fb .addr code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-size: 11px; }
.lf-fb a.lf-btn { text-decoration: none; display: inline-block; }

.lf-cols { display: flex; flex-wrap: wrap; gap: 12px; }
.lf-cols > .lf-card { flex: 1 1 210px; margin-bottom: 0; }
.lf-list { margin: 0; padding: 0; list-style: none; }
.lf-list li { font-size: 13px; padding: 5px 0; border-bottom: 1px dashed #f0f1f3; color: #374151; }
.lf-list li:last-child { border-bottom: 0; }
.lf-list .id { color: #b0b5bd; font-size: 11.5px; margin-left: 6px;
  font-family: ui-monospace, Consolas, monospace; }
.lf-btn { font: inherit; font-size: 12.5px; padding: 5px 11px; border-radius: 7px;
  border: 1px solid #e5e7eb; background: #fff; color: #1b1e24; cursor: pointer; }
.lf-btn:hover { background: #f7f8fa; }
.lf-foot { margin-top: 14px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.lf-msg { font-size: 12.5px; color: #6b7280; }

.lf-diary-wrap { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.lf-dlist { flex: 0 0 180px; display: flex; flex-direction: column; gap: 6px; }
.lf-ditem { text-align: left; padding: 8px 10px; border-radius: 8px; border: 1px solid #e5e7eb;
  background: #fff; cursor: pointer; font: inherit; color: #1b1e24; }
.lf-ditem:hover { background: #f7f8fa; }
.lf-ditem[data-on="1"] { border-color: #2f6fed; background: #f0f5ff; }
.lf-ditem .d { font-size: 12.5px; font-weight: 600; display: block; }
.lf-ditem .c { font-size: 11.5px; color: #6b7280; }
.lf-dview { flex: 1 1 280px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; }
.lf-dview h2 { margin: 0 0 4px; font-size: 16px; }
.lf-dmeta { margin: 0 0 12px; font-size: 12px; color: #6b7280; }
.lf-dp { margin: 0 0 10px; font-size: 13.5px; line-height: 1.75; color: #1f2937; white-space: pre-wrap; }
.lf-dp:last-child { margin-bottom: 0; }
.lf-dir { font-size: 11.5px; color: #9ca3af; word-break: break-all; margin: 4px 0 12px; }
.lf-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.lf-tab[data-on="1"] { border-color: #2f6fed; background: #f0f5ff; color: #1d4ed8; font-weight: 600; }
.lf-lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.lf-lib-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 9px; padding: 11px 12px; display: flex; flex-direction: column; gap: 6px; }
.lf-lib-card .top { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
.lf-lib-card .nm { font-size: 14px; font-weight: 600; }
.lf-lib-card .alias { font-size: 11.5px; color: #6b7280; }
.lf-lib-card .desc { font-size: 12.5px; color: #374151; line-height: 1.5; }
.lf-lib-thumbs { display: flex; gap: 6px; flex-wrap: wrap; }
.lf-lib-thumbs img { width: 52px; height: 52px; object-fit: cover; border-radius: 6px; border: 1px solid #e5e7eb; }
.lf-form-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
.lf-input, .lf-textarea, .lf-select { font: inherit; font-size: 12.5px; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; color: #1b1e24; }
.lf-input { flex: 1 1 160px; }
.lf-textarea { width: 100%; box-sizing: border-box; min-height: 60px; resize: vertical; margin-bottom: 8px; }
.lf-drop { border: 1.5px dashed #cbd5e1; border-radius: 8px; padding: 10px; font-size: 12px; color: #64748b; text-align: center; cursor: pointer; margin-bottom: 8px; background: #f8fafc; }
.lf-drop.over { border-color: #2f6fed; background: #eff6ff; color: #1d4ed8; }
`;
  doc.head.append(s);
}

function colorOf(v) {
  if (v < 30) return '#c0392b';
  if (v < 60) return '#d69e2e';
  return '#2f855a';
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
        /*
         * 版本徽章（2026-11-15，照 journey 那套）。
         * 报障第一句永远是「我这是不是最新版」，两边都得猜 —— 所以写在她名字后面。
         */
        const ver = el('span', 'lf-ver', '');
        head.append(town, tag, ver);
        const sub = el('p', 'lf-sub', t(lang, 'loading'));
        const note = el('div', 'lf-note');
        note.hidden = true;
        const whoCard = el('div', 'lf-card');
        const jobCard = el('div', 'lf-card');
        const vitalsCard = el('div', 'lf-card');
        const goalCard = el('div', 'lf-card');
        const moveCard = el('div', 'lf-card');
        const bodyCard = el('div', 'lf-card');
        const moodCard = el('div', 'lf-card');
        bodyCard.append(el('h3', null, t(lang, 'cond')));
        moodCard.append(el('h3', null, t(lang, 'mood')));
        /* 身上和心里并排：它们是同一类东西（当下），分两行反而显得各占一张卡。 */
        const moodRow = el('div', 'lf-cols');
        moodRow.append(bodyCard, moodCard);
        const cols = el('div', 'lf-cols');
        const habits = el('div', 'lf-card');
        const watches = el('div', 'lf-card');
        const wants = el('div', 'lf-card');
        const wishCard = el('div', 'lf-card');
        const pendingCard = el('div', 'lf-card');
        const pledgeCard = el('div', 'lf-card');
        const giftsCard = el('div', 'lf-card');
        habits.append(el('h3', null, t(lang, 'habits')));
        watches.append(el('h3', null, t(lang, 'watches')));
        wants.append(el('h3', null, t(lang, 'wants')));
        cols.append(habits, watches, wants, wishCard, pendingCard, pledgeCard, giftsCard);
        const helpBox = el('details', 'lf-help');
        const fbBox = el('section', 'lf-fb');
        const foot = el('div', 'lf-foot');
        const reload = el('button', 'lf-btn', t(lang, 'reload'));
        const msg = el('span', 'lf-msg', '');
        foot.append(reload, msg);

        app.append(head, sub, note, whoCard, jobCard, vitalsCard, goalCard, moveCard, moodRow, cols, helpBox, fbBox, foot);

        const drawVitals = (vitals, low, asleep, activity) => {
          vitalsCard.innerHTML = '';
          vitalsCard.append(el('h3', null, t(lang, 'vitals')));
          /*
           * 「在睡」或「正在做什么」要写在五条上面，和状态文本对齐。
           */
          if (asleep) {
            vitalsCard.append(el('p', 'lf-muted',
              `${t(lang, 'asleep')} · ${t(lang, 'asleepLeft', { h: asleep.hoursLeft, e: asleep.energyAtWake })}`));
          } else if (activity) {
            const pct = Math.round((Number(activity.progress) || 0) * 100);
            const row = el('div', 'lf-goal');
            row.style.marginBottom = '10px';
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
            const k = el('span', 'k', it.label || key);
            const track = el('div', 'track');
            const fill = el('div', 'fill');
            fill.style.width = Math.max(2, Math.min(100, v)) + '%';
            fill.style.background = colorOf(v);
            track.append(fill);
            const n = el('span', 'n', String(v));
            row.append(k, track, n);
            vitalsCard.append(row);
          }
        };

        /**
         * 「她是谁」：在做什么、住哪儿、手上有多少钱。
         *
         * `home.staying` 是**此刻在哪儿**（可能在外地住店），`home.tier` 是**房子是哪一档**。
         * 两个都写出来，因为「在新小区有房」和「现在住在新小区」不是一回事 ——
         * 她这会儿可能在大理的旅馆里。出差住店那一格单独一行小字，不混进档位。
         */
        /*
         * 在做什么。原来这一格只藏在「她是谁」那段文字里 —— 一眼看不出她今天有没有活干、
         * 一天挣多少、手上有几张证。2026-11-15 Mr.Q：「职业的容器也得加进去。」
         */
        const drawJob = (d) => {
          jobCard.innerHTML = '';
          jobCard.append(el('h3', null, t(lang, 'job')));
          const jb = d.job || {};
          if (!jb.what) {
            jobCard.append(el('p', 'lf-muted', t(lang, 'noJob')));
          } else {
            const box = el('div', 'lf-chips');
            box.append(el('span', 'lf-chip',
              `${jb.what}　¥${jb.daily}/天　${jb.days} 天工`));
            jobCard.append(box);
          }
          const certs = jb.certs || [];
          jobCard.append(el('p', 'lf-muted',
            certs.length ? `${t(lang, 'certs')}：${certs.join('、')}` : t(lang, 'noCert')));
          /*
           * 见识（2026-11-17）。它是考证通过率的唯一变量 —— 面板上看不到，
           * 用户就只能从「她考砸了」倒推，而那是猜。
           */
          const kn = typeof d.knowledge === 'number' ? d.knowledge : 0;
          jobCard.append(el('p', 'lf-muted',
            `${t(lang, 'knowledge')}：${kn}　·　${t(lang, 'knowledgeHint')}`));
          const ft = typeof d.fitness === 'number' ? d.fitness : 25;
          jobCard.append(el('p', 'lf-muted',
            `${t(lang, 'fitness')}：${ft}　·　${t(lang, 'fitnessHint')}`));

          const skills = d.skills || {};
          const labels = d.skillLabels || {};
          const skKeys = Object.keys(skills).filter((k) => Number(skills[k]) > 0);
          if (skKeys.length) {
            const skRow = el('div', 'lf-chips');
            skRow.style.marginTop = '6px';
            for (const k of skKeys) {
              skRow.append(el('span', 'lf-chip', `${labels[k] || k} ${Math.round(Number(skills[k]))}`));
            }
            jobCard.append(skRow);
          }
          const gear = d.gear || [];
          const eqCat = d.equipCatalog || [];
          if (gear.length) {
            const gNames = gear.map((id) => {
              const hit = eqCat.find((e) => e.id === id);
              return hit ? hit.name : id;
            });
            jobCard.append(el('p', 'lf-muted', `已备家伙：${gNames.join('、')}`));
          }
          if (d.shift) {
            jobCard.append(el('p', 'lf-muted', `正在跑单班：${d.shift.label}（${d.shift.minutes}分钟）`));
          }
          if (d.freshVeg) {
            jobCard.append(el('p', 'lf-muted', '菜篮状态：刚从早市带回鲜蔬，下厨更香'));
          }
        };

        const drawWho = (d) => {
          whoCard.innerHTML = '';
          whoCard.append(el('h3', null, t(lang, 'who')));
          const box = el('div', 'lf-stats');

          const job = d.job || {};
          const jobCell = el('div', 'lf-stat');
          jobCell.append(el('span', 'lab', t(lang, 'job')));
          jobCell.append(el('div', 'val', job.what || t(lang, 'noJob')));
          if (job.what) {
            jobCell.append(el('div', 'sub2',
              `顶一天 ${job.daily} 元　·　出过 ${job.days} 天工`));
          } else {
            jobCell.append(el('div', 'sub2', `顶一天能挣 ${job.daily || 0} 元`));
          }

          const home = d.home || {};
          const homeCell = el('div', 'lf-stat');
          homeCell.append(el('span', 'lab', t(lang, 'home')));
          homeCell.append(el('div', 'val',
            `${home.tierLabel || '—'}　${home.tenure === 'own' ? t(lang, 'own') : t(lang, 'rent')}`));
          /* 此刻在哪 —— 住店/在路上要说得出来。 */
          homeCell.append(el('div', 'sub2', home.staying || ''));
          homeCell.append(el('div', 'sub2', `每月 ${home.monthly || 0} 元`));

          const money = d.money || {};
          const moneyCell = el('div', 'lf-stat money');
          moneyCell.append(el('span', 'lab', t(lang, 'money')));
          moneyCell.append(el('div', 'val', `¥ ${Number(money.cash || 0).toLocaleString('zh-CN')}`));
          moneyCell.append(el('div', 'sub2',
            `进 ${Number(money.earned || 0).toLocaleString('zh-CN')}　出 ${Number(money.spent || 0).toLocaleString('zh-CN')}`));

          /*
           * 第四格：他这几天来过几天。
           *
           * 这一格是这个面板上**唯一关于他的**东西，而它恰恰是「陪伴」这件事的
           * 最小证据 —— 她一个人过得好不好是一栏，她记不记得你来过是另一栏。
           */
          const visitCell = el('div', 'lf-stat');
          visitCell.append(el('span', 'lab', t(lang, 'visits')));
          visitCell.append(el('div', 'val',
            d.visitedDays > 0 ? t(lang, 'visitDays', { n: d.visitedDays }) : t(lang, 'noVisit')));
          visitCell.append(el('div', 'sub2', t(lang, 'visitsHint')));

          box.append(jobCell, homeCell, moneyCell, visitCell);
          whoCard.append(box);
        };

        /** 目标。带进度条 —— 没有进度的那叫清单。 */
        const drawGoals = (d) => {
          goalCard.innerHTML = '';
          goalCard.append(el('h3', null, t(lang, 'goals')));
          const gs = d.goals || [];
          if (!gs.length) {
            goalCard.append(el('p', 'lf-muted', t(lang, 'noGoal')));
            return;
          }
          for (const g of gs) {
            const row = el('div', 'lf-goal');
            const top = el('div', 'top');
            top.append(el('span', null, g.what || ''));
            top.append(el('span', 'left',
              g.done ? t(lang, 'achieved')
                : (g.left > 0 ? t(lang, 'left', { n: Number(g.left).toLocaleString('zh-CN') }) : t(lang, 'canNow'))));
            const track = el('div', 'track');
            const fill = el('div', 'fill');
            fill.style.width = Math.max(1, Math.min(100, Math.round((g.ratio || 0) * 100))) + '%';
            if (g.done || g.left <= 0) fill.style.background = '#2f855a';
            track.append(fill);
            row.append(top, track);
            goalCard.append(row);
          }
        };

        /**
         * 住处四档 + 搬过去。
         *
         * 这一页唯一的**写**操作。原则写在 `panelInvoke` 的注释里：
         * 它之所以被允许，是因为她自己也有 `life_move`（走同一个 `applyMove`），
         * 而且价先说清、按钮旁写明「这是你替她搬」。
         */
        let moveTip = null; // { text, err, until }
        const drawMoves = (d) => {
          moveCard.innerHTML = '';
          moveCard.append(el('h3', null, t(lang, 'moves')));
          const qs = d.moveQuotes || [];
          if (!qs.length) {
            moveCard.append(el('p', 'lf-muted', t(lang, 'none')));
            return;
          }
          const busyHint = d.asleep
            ? '她正在睡觉，醒来后再搬'
            : (d.activity ? `她正在「${d.activity.label}」，还剩 ${d.activity.minutesLeft} 分钟，停下来或做完后再搬` : '');
          for (const q of qs) {
            const row = el('div', 'lf-move' + (q.current ? ' now' : ''));
            row.append(el('span', 'nm', q.label));

            const cost = el('div', 'cost');
            cost.append(el('b', null, `每月 ${q.monthly}`));
            cost.append(document.createTextNode(`　押 ${q.deposit}（两个月）`));
            if (!q.current && !q.ok) {
              const sh = el('span', 'short', `　还差 ${Number(q.short).toLocaleString('zh-CN')}`);
              cost.append(sh);
            }
            row.append(cost);

            const box = el('div', 'btnbox');
            if (q.current) {
              box.append(el('span', 'nowtag', t(lang, 'livingHere')));
            } else {
              const b = el('button', 'lf-btn', q.ok ? t(lang, 'moveTo') : t(lang, 'cantMove'));
              b.type = 'button';
              b.disabled = !q.ok || Boolean(busyHint);
              if (busyHint && q.ok) b.title = busyHint;
              b.setAttribute('data-move', q.tier);
              box.append(b);
            }
            row.append(box);
            moveCard.append(row);
          }
          if (busyHint) {
            const p = el('p', 'lf-note-line', busyHint);
            p.style.color = '#b45309';
            moveCard.append(p);
          }
          if (moveTip && moveTip.until > Date.now()) {
            const p = el('p', 'lf-note-line', moveTip.text);
            p.style.color = moveTip.err ? '#c0392b' : '#2f855a';
            p.style.fontWeight = '600';
            moveCard.append(p);
          }
          moveCard.append(el('p', 'lf-note-line', t(lang, 'moveNote')));

          const sqs = d.streetQuotes || [];
          if (sqs.length) {
            const stBox = el('div', 'lf-st-box');
            stBox.append(el('h4', null, t(lang, 'streetsTitle')));
            const MOD_LAB = { food: '饱腹', energy: '精力', clean: '清爽', fun: '娱乐', social: '社交', know: '见识', work: '工钱' };
            for (const sq of sqs) {
              const row = el('div', 'lf-st-row' + (sq.current ? ' now' : ''));
              const info = el('div', 'lf-st-info');
              info.append(el('div', 'st-nm', sq.name || ''));
              if (sq.desc) info.append(el('div', 'st-desc', sq.desc));
              const mods = sq.mods || {};
              const modKeys = Object.keys(MOD_LAB).filter((k) => Number(mods[k]) !== 0 && Number.isFinite(Number(mods[k])));
              if (modKeys.length) {
                const chips = el('div', 'lf-chips');
                for (const k of modKeys) {
                  const val = Math.round(Number(mods[k]));
                  chips.append(el('span', 'lf-chip ' + (val > 0 ? 'good' : 'bad'), `${MOD_LAB[k]} ${val > 0 ? '+' + val : val}%`));
                }
                info.append(chips);
              }
              const btnBox = el('div', 'btnbox');
              if (sq.current) {
                btnBox.append(el('span', 'nowtag', t(lang, 'livingHere')));
              } else {
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
            moveCard.append(stBox);
          }
        };

        /**
         * 悬着的事。
         *
         * **不画「未完成」的红点、不显示进度、不催**（方案 §2.7）。
         * 它只是把她卡在哪儿摆出来 —— 卡点本身就是内容，不是缺陷。
         */
        const drawPending = (d) => {
          pendingCard.innerHTML = '';
          pendingCard.append(el('h3', null, t(lang, 'pending')));
          const items = d.pending || [];
          if (!items.length) {
            pendingCard.append(el('p', 'lf-muted', t(lang, 'noPending')));
            return;
          }
          const ul = el('ul', 'lf-list');
          for (const x of items) {
            const li = el('li');
            li.append(document.createTextNode(x.what || ''));
            const tail = x.blocked === 'money' && x.cost > 0
              ? `卡在${x.blockedLabel} ${x.cost} 元` : `卡在${x.blockedLabel}`;
            li.append(el('div', 'uid', tail));
            ul.append(li);
          }
          pendingCard.append(ul);
        };

        /** 说好了的事。**到期没做的单独标红** —— 她欠着的，得看得见。 */
        const drawPledges = (d) => {
          pledgeCard.innerHTML = '';
          pledgeCard.append(el('h3', null, t(lang, 'pledges')));
          const wait = d.pledges || [];
          const late = d.overdue || [];
          if (!wait.length && !late.length) {
            pledgeCard.append(el('p', 'lf-muted', t(lang, 'noPledge')));
            return;
          }
          const ul = el('ul', 'lf-list');
          for (const x of wait) {
            const li = el('li');
            li.append(document.createTextNode(x.what || ''));
            if (x.to) li.append(el('span', 'id', `对 ${x.to}`));
            ul.append(li);
          }
          for (const x of late) {
            const li = el('li');
            const b = el('span', null, x.what || '');
            b.style.color = '#c0392b';
            li.append(b);
            li.append(el('span', 'id', t(lang, 'overdueTag')));
            ul.append(li);
          }
          pledgeCard.append(ul);
        };

        const drawList = (card, title, items, render) => {
          card.innerHTML = '';
          card.append(el('h3', null, title));
          if (!items || !items.length) {
            card.append(el('p', 'lf-muted', t(lang, 'noneYet')));
            return;
          }
          const ul = el('ul', 'lf-list');
          for (const it of items) {
            const li = el('li');
            li.append(document.createTextNode(render(it)));
            const id = el('span', 'id', it.id || '');
            li.append(id);
            ul.append(li);
          }
          card.append(ul);
        };

        const render = (d) => {
          if (!d) return;
          town.textContent = d.town.name || '—';
          /* 三档：服务器的城 / 你自己填的城 / 内置的兰州。 */
          tag.textContent = t(lang,
            d.town.source === 'server' ? 'server' : d.town.source === 'own' ? 'townOwn' : 'builtin');
          const bits = [];
          bits.push(`${d.dayPart} ${d.clock}`);
          if (d.solarTerm && d.solarTerm.name) bits.push(d.solarTerm.name);
          if (d.weather && d.weather.sky) bits.push(d.weather.sky);
          if (d.streetWindow && d.streetWindow.label) bits.push(`${d.streetWindow.place}${d.streetWindow.label}`);
          if (d.street) bits.push(d.street);
          sub.textContent = bits.join('　·　');

          note.hidden = true;
          note.textContent = '';
          if (!d.journey.installed) {
            note.hidden = false;
            note.textContent = t(lang, 'noJourney');
          } else if (d.journey.phase === 'traveling') {
            note.hidden = false;
            const seatBit = d.journey.seat ? `（${d.journey.seat}）` : '';
            note.textContent = t(lang, 'onRoad', { to: d.journey.to || '?', from: d.journey.city || '?' }) + seatBit;
          } else if (d.journey.tripWork && d.journey.tripWork.gig) {
            note.hidden = false;
            note.textContent = `在当地打工补贴路费：${d.journey.tripWork.gig}`;
          } else if (d.journey.restUntil) {
            note.hidden = false;
            note.textContent = `在落脚点休整中（约至 ${fmtLocal(d.journey.restUntil, 'mdhm')}）`;
          }
          if (d.bulletin && d.bulletin.length) {
            note.hidden = false;
            note.textContent = (note.textContent ? note.textContent + '　·　' : '')
              + `街口黑板：${d.bulletin[0]}`;
          }

          if (d.recovered === 'bak') {
            note.hidden = false;
            note.textContent = (note.textContent ? note.textContent + '　·　' : '') + t(lang, 'recoveredBak');
          } else if (d.recovered === 'fresh' && d.town.custom) {
            /* 新档但服务器读过城设定 —— 说明是重装或换机，值得说一句。 */
            note.hidden = false;
            note.textContent = (note.textContent ? note.textContent + '　·　' : '') + t(lang, 'recoveredFresh');
          }

          if (!fbBox.childElementCount) drawFeedback(d);
          /*
           * 版本徽章。`data-new` 同时是样式开关和可测标记 ——
           * 有新版才实心，不知道就只写自己的版本（不写「已是最新」）。
           */
          const hasNew = Boolean(d.versionOutdated && d.latestVersion);
          ver.dataset.new = hasNew ? '1' : '0';
          ver.textContent = hasNew
            ? t(lang, 'verNew', { v: d.version || '', new: d.latestVersion })
            : `· ${t(lang, 'verSelf', { v: d.version || '' })}`;
          ver.title = hasNew
            ? t(lang, 'verHint', { v: d.version || '', new: d.latestVersion }) : '';

          drawWho(d);
          drawJob(d);
          drawVitals(d.vitals, d.low, d.asleep, d.activity);
          drawGoals(d);
          drawMoves(d);

          bodyCard.innerHTML = '';
          bodyCard.append(el('h3', null, t(lang, 'cond')));
          const conds = d.conditions || [];
          if (!conds.length) {
            bodyCard.append(el('p', 'lf-muted', t(lang, 'none')));
          } else {
            const box = el('div', 'lf-chips');
            for (const c of conds) box.append(el('span', 'lf-chip bad', c.text || c.id));
            bodyCard.append(box);
          }

          moodCard.innerHTML = '';
          moodCard.append(el('h3', null, t(lang, 'mood')));
          const moods = d.moodlets || [];
          if (!moods.length) {
            moodCard.append(el('p', 'lf-muted', t(lang, 'none')));
          } else {
            const box = el('div', 'lf-chips');
            for (const m of moods) {
              box.append(el('span', 'lf-chip ' + (m.kind === 'bad' ? 'bad' : 'good'), m.text || ''));
            }
            moodCard.append(box);
          }

          const whenLabel = { morning: '早上', noon: '中午', afternoon: '下午', evening: '傍晚', night: '夜里' };
          drawList(habits, t(lang, 'habits'), d.habits,
            (h) => `${whenLabel[h.when] || ''}　${h.what}`);
          drawList(watches, t(lang, 'watches'), d.watches, (w) => w.what);
          /*
           * 「想买什么」原来是「想要」。
           *
           * 两者在这里其实是同一个池子（`life_want` 记的），但**给他看的时候
           * 要叫「想买什么」** —— 他关心的就是这一格。而她那边叫「想要」，
           * 因为对她来说不一定是钱的事。同一个东西，两个说法，各按各的用途。
           */
          drawPending(d);
          drawPledges(d);
          /*
           * 想买什么 / 想去哪：同一个池子（`life_want`），两种东西。
           * 给他看的时候分开两栏 —— 他关心的「下一趟她想去哪」和「她想买什么」不是一件事。
           */
          const allWants = d.wants || [];
          drawList(wants, t(lang, 'wants'), allWants.filter((w) => w.kind !== 'place'),
            (w) => `${w.what}${w.scale === 'big' ? '（得攒一攒）' : ''}`);
          drawList(wishCard, t(lang, 'wishes'), allWants.filter((w) => w.kind === 'place'),
            (w) => w.what);
          drawList(giftsCard, t(lang, 'gifts'), d.gifts || [],
            (g) => `${g.what}（${g.from || '他'}）`);
        };

        /** 复制到剪贴板。宿主的 webview 里 clipboard API 未必有，要有降级。 */
        const copyText = (text) => {
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              return navigator.clipboard.writeText(text);
            }
          } catch (e) { /* 落到下面 */ }
          try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.append(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
          } catch (e) { /* 复制不了就算了 */ }
          return Promise.resolve();
        };

        /**
         * 反馈栏。**只画一次** —— 内容里没有会变的东西（版本和仓库是常量），
         * 跟着 30 秒刷新重画一遍是白费。
         */
        const drawFeedback = (d) => {
          const fb = d.feedback;
          if (!fb || !fb.repo) { fbBox.remove(); return; }
          fbBox.innerHTML = '';
          fbBox.append(el('p', 'lead', t(lang, 'fbLead')));

          const row = el('div', 'row');
          for (const kind of ['bug', 'want']) {
            const btn = el('button', 'lf-btn', t(lang, kind === 'bug' ? 'fbBug' : 'fbWant'));
            btn.type = 'button';
            btn.addEventListener('click', () => {
              /* 复制之后给个即时反馈，否则点了像没反应 —— 而那正是这套东西要避免的 */
              copyText(fb.digest).then(() => {
                const old = btn.textContent;
                btn.textContent = t(lang, 'fbCopied');
                setTimeout(() => { btn.textContent = old; }, 1800);
              });
            });
            row.append(btn);
          }
          /*
           * 两条 https 链接 —— 这是唯一能真的点出去的一类。
           * `issues/new` 带预填 title，正文让他粘（诊断信息已经复制好了）。
           */
          for (const kind of ['bug', 'want']) {
            const a = el('a', 'lf-btn', t(lang, kind === 'bug' ? 'fbOpenBug' : 'fbOpenWant'));
            a.href = fb.repo + '/issues/new?title=' + encodeURIComponent(
              (kind === 'bug' ? '[bug] ' : '[want] ') + 'v' + fb.version);
            a.target = '_blank';
            a.rel = 'noreferrer';
            row.append(a);
          }
          fbBox.append(row);

          const addr = el('div', 'addr');
          addr.append(el('span', null, t(lang, 'fbAddr')));
          addr.append(el('code', null, fb.repo));
          fbBox.append(addr);
          fbBox.append(el('p', 'why', t(lang, 'fbWhy')));
        };

        /*
         * 灯的说明。**只画一次** —— 它是静态的。
         *
         * 为什么需要这一块：那三盏灯是宿主画在扩展名旁边的，鼠标悬停能看到原因，
         * 但**没人知道要悬停**。用户看到灰点，第一反应是「是不是坏了」，
         * 而灰的多数情况恰恰是「没启用，不用管」。
         */
        const drawHelp = () => {
          helpBox.append(el('summary', null, t(lang, 'helpTitle')));
          const ul = el('ul');
          const item = (color, key, desc) => {
            const li = el('li');
            const dot = el('span', 'dot');
            dot.style.background = color;
            li.append(dot);
            li.append(el('b', null, t(lang, key)));
            li.append(document.createTextNode('　' + t(lang, desc)));
            return li;
          };
          ul.append(item('#2f855a', 'helpOn', 'helpOnDesc'));
          ul.append(item('#9ca3af', 'helpOff', 'helpOffDesc'));
          ul.append(item('#c0392b', 'helpErr', 'helpErrDesc'));
          helpBox.append(ul);
          helpBox.append(el('p', 'lf-muted', t(lang, 'helpHint')));
        };

        const load = () => ctx.invoke('snapshot').then(render).catch((e) => {
          sub.textContent = t(lang, 'empty');
          msg.textContent = (e && e.message) ? e.message : '读取失败';
        });

        /*
         * 搬家按钮：委托在卡片上，**不给每个按钮单独绑**。
         * 这一排按钮每次重画都会重建，逐个绑就是每刷一次多绑一遍，
         * 表现是「点一下搬三次」。
         */
        moveCard.addEventListener('click', (ev) => {
          const b = ev.target && ev.target.closest ? ev.target.closest('button[data-move], button[data-move-street]') : null;
          if (!b || b.disabled) return;
          const tier = b.getAttribute('data-move');
          const street = b.getAttribute('data-move-street');
          b.disabled = true;
          b.textContent = t(lang, 'moving');
          msg.textContent = '';
          const payload = street ? { street } : { tier };
          ctx.invoke('move', [payload])
            .then((r) => {
              if (r && r.ok === false && r.reason) {
                moveTip = { text: r.reason, err: true, until: Date.now() + 5000 };
                msg.textContent = r.reason;
              } else {
                moveTip = { text: '搬过去了 ✓', err: false, until: Date.now() + 4000 };
              }
              render(r);
            })
            .catch((e) => {
              const errText = (e && e.message) || '没搬成';
              moveTip = { text: errText, err: true, until: Date.now() + 5000 };
              msg.textContent = errText;
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

        /*
         * 30 秒自己刷一次。
         *
         * 面板开着的时候她在过日子，数字在动 —— 不刷的话，用户看到的是
         * 「打开的这一刻」的静态快照，然后以为她不会饿。
         * 用 `ctx.timeout` 而不是裸 setTimeout：宿主切走页面时它会连带清掉，
         * 裸定时器会在后台一直跑，跑一整天没人发现。
         */
        const loop = () => {
          ctx.timeout(() => {
            load().finally(loop);
          }, 30_000);
        };
        loop();
      },
    },
    day: {
      async mount(ctx) {
        ensureStyle(ctx.root);
        const app = el('div', 'lf');
        ctx.root.append(app);

        const head = el('div', 'lf-head');
        const title = el('h1', null, '一天 · 时间轴');
        const ver = el('span', 'lf-ver', '');
        head.append(title, ver);
        const sub = el('p', 'lf-sub', '读取中…');
        const nowCard = el('div', 'lf-card');
        const tlCard = el('div', 'lf-card');
        const ledgerCard = el('div', 'lf-card');
        const foot = el('div', 'lf-foot');
        const reload = el('button', 'lf-btn', '刷新');
        reload.type = 'button';
        foot.append(reload);
        app.append(head, sub, nowCard, tlCard, ledgerCard, foot);

        const render = (d) => {
          if (!d) return;
          ver.textContent = d.version ? `· v${d.version}` : '';
          const win = d.streetWindow ? ` · ${d.streetWindow.place}${d.streetWindow.label}` : '';
          const term = d.solarTerm ? ` · ${d.solarTerm.name}` : '';
          sub.textContent = `${d.today || ''} ${d.dayPart || ''} ${d.clock || ''}${term}${win}`;

          nowCard.innerHTML = '';
          nowCard.append(el('h3', null, '此刻状态'));
          if (d.asleep) {
            nowCard.append(el('p', 'lf-muted', `正在睡，预计还有 ${d.asleep.hoursLeft} 小时`));
          } else if (d.activity) {
            nowCard.append(el('p', 'lf-muted',
              `正在「${d.activity.label}」，已过 ${Math.round((d.activity.progress || 0) * 100)}%，还剩 ${d.activity.minutesLeft} 分钟`));
          } else {
            nowCard.append(el('p', 'lf-muted', '这会儿空闲着。'));
          }
          if (d.weather && d.weather.seasonNote) {
            nowCard.append(el('p', 'lf-note-line', `物候：${d.weather.sky || ''} · ${d.weather.seasonNote}`));
          }

          tlCard.innerHTML = '';
          const list = (d.todayTellable && d.todayTellable.length) ? d.todayTellable : (d.recentTellable || []);
          const tlTitle = (d.todayTellable && d.todayTellable.length) ? '今天经历的事' : '最近经历（今日尚无新记）';
          tlCard.append(el('h3', null, tlTitle));
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
          const lTitle = (d.todayLedger && d.todayLedger.length) ? '今日流水' : '最近流水';
          ledgerCard.append(el('h3', null, lTitle));
          if (!lList.length) {
            ledgerCard.append(el('p', 'lf-muted', '暂无收支流水。'));
          } else {
            const ul = el('ul', 'lf-list');
            for (const e of lList) {
              const li = el('li');
              const sign = e.kind === 'income' ? '+' : '-';
              li.append(document.createTextNode(`${sign}${e.amount}　${e.note || e.source}${e.payee ? `（${e.payee}）` : ''}`));
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
        head.append(el('h1', null, '她惦记的'));
        const sub = el('p', 'lf-sub', '常态规律、在留意的事、想买与想去、悬着未决与说好的约定。');
        const goalsCard = el('div', 'lf-card');
        const cols = el('div', 'lf-cols');
        const habitsCard = el('div', 'lf-card');
        const watchesCard = el('div', 'lf-card');
        const buyCard = el('div', 'lf-card');
        const placeCard = el('div', 'lf-card');
        const pendCard = el('div', 'lf-card');
        const pledgeCard = el('div', 'lf-card');
        cols.append(habitsCard, watchesCard, buyCard, placeCard, pendCard, pledgeCard);
        app.append(head, sub, goalsCard, cols);

        const drawSec = (card, title, items, fmt) => {
          card.innerHTML = '';
          card.append(el('h3', null, title));
          if (!items || !items.length) {
            card.append(el('p', 'lf-muted', '暂无。'));
            return;
          }
          const ul = el('ul', 'lf-list');
          for (const it of items) {
            const li = el('li');
            li.append(document.createTextNode(fmt(it)));
            if (it.id) li.append(el('span', 'id', it.id));
            ul.append(li);
          }
          card.append(ul);
        };

        const render = (d) => {
          if (!d) return;
          goalsCard.innerHTML = '';
          goalsCard.append(el('h3', null, '个人目标'));
          const gs = d.goals || [];
          if (!gs.length) {
            goalsCard.append(el('p', 'lf-muted', '暂未定下目标。'));
          } else {
            for (const g of gs) {
              const row = el('div', 'lf-goal');
              const top = el('div', 'top');
              top.append(el('span', null, g.what || ''));
              top.append(el('span', 'left', g.done ? '已达成' : (g.left > 0 ? `还差 ${g.left}` : '钱够了')));
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
          drawSec(habitsCard, '常态规律', d.habits, (h) => `${whenLabel[h.when] || ''}　${h.what}`);
          drawSec(watchesCard, '在留意的事', d.watches, (w) => w.what);
          const wantsAll = d.wants || [];
          drawSec(buyCard, '想买 / 想办', wantsAll.filter((w) => w.kind !== 'place'),
            (w) => `${w.what}${w.scale === 'big' ? '（得攒）' : ''}`);
          drawSec(placeCard, '想去的地方', wantsAll.filter((w) => w.kind === 'place'), (w) => w.what);
          drawSec(pendCard, '悬着未决', d.pending,
            (p) => `${p.what}（卡在${p.blockedLabel || p.blocked}${p.cost ? ` ${p.cost}元` : ''}）`);
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
        head.append(el('h1', null, '你和它'));
        const sub = el('p', 'lf-sub', '来访记录、留下的物件、两地对齐、街口黑板及我的鱼市街摊位（只列事实不打分）。');
        const cols = el('div', 'lf-cols');
        const visitsCard = el('div', 'lf-card');
        const giftsCard = el('div', 'lf-card');
        const bridgeCard = el('div', 'lf-card');
        const boardCard = el('div', 'lf-card');
        const stallsCard = el('div', 'lf-card');
        const dealsCard = el('div', 'lf-card');
        cols.append(visitsCard, giftsCard, bridgeCard, boardCard, stallsCard, dealsCard);
        app.append(head, sub, cols);

        const render = (d) => {
          if (!d) return;
          visitsCard.innerHTML = '';
          visitsCard.append(el('h3', null, '最近陪伴'));
          visitsCard.append(el('p', 'lf-muted',
            d.visitedDays > 0 ? `近 7 天你来过 ${d.visitedDays} 天` : '近 7 天暂无来访记录'));
          const pr = d.presence || [];
          if (pr.length) {
            const box = el('div', 'lf-chips');
            for (const day of pr.slice().reverse()) {
              const label = typeof day === 'string' ? day : (day && day.date ? String(day.date) : '');
              if (!label) continue;
              const chip = el('span', 'lf-chip', label);
              if (day && typeof day === 'object' && (day.firstAt || day.lastAt)) {
                const f = day.firstAt ? fmtLocal(day.firstAt, 'hm') : '';
                const l = day.lastAt ? fmtLocal(day.lastAt, 'hm') : '';
                chip.title = f && l && f !== l ? `首次 ${f} · 最近 ${l}` : (l || f);
              }
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
          bridgeCard.append(el('h3', null, '生活 × 旅行对齐'));
          const j = d.journey || {};
          if (!j.installed) {
            bridgeCard.append(el('p', 'lf-muted', '未安装旅行扩展。'));
          } else {
            const ul = el('ul', 'lf-list');
            const rows = [
              `常住母港：${j.homeName || d.town?.name || '兰州'}`,
              `旅行状态：${j.phase || 'home'}${j.city ? `（${j.city}）` : ''}`,
              j.seat ? `当前舱位：${j.seat}${j.seatMult && j.seatMult !== 1 ? `（票价 ×${j.seatMult}）` : ''}` : '',
              j.tripWork ? `旅途打工：${j.tripWork.gig}` : '',
              j.restUntil ? `旅途休整至：${fmtLocal(j.restUntil, 'mdhm')}` : '',
              (j.partyWith && j.partyWith.length) ? `当前结伴同行（已 ${j.partyDays || 0} 天）：${j.partyWith.join('、')}` : '',
            ].filter(Boolean);
            for (const text of rows) {
              const li = el('li');
              li.textContent = text;
              ul.append(li);
            }
            bridgeCard.append(ul);
          }

          const fmtEffects = (fx) => {
            if (!fx || typeof fx !== 'object') return '';
            const map = { food: '饱腹', energy: '精力', clean: '清洁', fun: '娱乐', social: '社交', knowledge: '见识', fitness: '体质' };
            const parts = [];
            for (const [k, label] of Object.entries(map)) {
              const v = Math.round(Number(fx[k] || 0));
              if (v > 0) parts.push(`${label}+${v}`);
            }
            return parts.join('/');
          };

          boardCard.innerHTML = '';
          boardCard.append(el('h3', null, '《街口黑板报》'));
          const bd = d.bulletin || [];
          const os = d.otherStalls || [];
          if (!bd.length && !os.length) {
            boardCard.append(el('p', 'lf-muted', '黑板报这会儿还是空的（连同城服务器后会同步）。'));
          } else {
            if (bd.length) {
              const ul = el('ul', 'lf-list');
              for (const line of bd) {
                const li = el('li');
                li.textContent = line;
                ul.append(li);
              }
              boardCard.append(ul);
            }
            if (os.length) {
              boardCard.append(el('p', 'lf-muted', '鱼市街街坊在售摊位：'));
              const ul = el('ul', 'lf-list');
              for (const st of os) {
                const li = el('li');
                const fx = fmtEffects(st.effects) || '饱腹+36/娱乐+12/社交+18';
                li.textContent = `${st.seller} · ${st.item} · ${st.price}元（剩 ${st.stock} 份 · ${fx}${st.freshVeg ? ' · 鲜蔬' : ''}）`;
                ul.append(li);
              }
              boardCard.append(ul);
            }
          }

          stallsCard.innerHTML = '';
          stallsCard.append(el('h3', null, '我在鱼市街的摊位'));
          const ms = d.myStalls || [];
          if (!ms.length) {
            stallsCard.append(el('p', 'lf-muted', '这会儿鱼市街还没有你挂着的摊子。'));
          } else {
            const ul = el('ul', 'lf-list');
            for (const st of ms) {
              const li = el('li');
              const fx = fmtEffects(st.effects);
              li.textContent = `${st.item} · ${st.price}元（剩 ${st.stock} 份${st.freshVeg ? ' · 鲜蔬' : ''}${fx ? ` · ${fx}` : ''}）`;
              ul.append(li);
            }
            stallsCard.append(ul);
          }

          dealsCard.innerHTML = '';
          const un = Number(d.unseenDeals || 0);
          dealsCard.append(el('h3', null, un > 0 ? `鱼市街成交回执（未读 ${un}）` : '鱼市街成交回执'));
          const ds = d.deals || [];
          if (!ds.length) {
            dealsCard.append(el('p', 'lf-muted', '最近没有成交回执。'));
          } else {
            const ul = el('ul', 'lf-list');
            for (const dl of ds) {
              const li = el('li');
              li.append(document.createTextNode(`${dl.seen ? '' : '[新] '}${dl.buyerPet} 买走 ${dl.qty} 份「${dl.item}」`));
              if (dl.at) li.append(el('span', 'id', fmtLocal(dl.at, 'mdhm')));
              ul.append(li);
            }
            dealsCard.append(ul);
          }
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
        app.append(head);

        const dirLine = el('p', 'lf-dir', '读取中…');
        const notice = el('div', 'lf-note');
        notice.hidden = true;
        app.append(dirLine, notice);

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
            viewBox.append(el('p', 'lf-muted', '还没有写过生活日记 —— 晚上她会根据今天做过的事与最近流水，用第一人称写一篇（也可直接对她说「写一下今天的生活日记」）。'));
            return;
          }
          selectedDate = d.dateKey;
          viewBox.append(el('h2', null, `${d.dateKey} · ${d.town || '兰州'}`));
          const meta = [d.street, d.weather, d.summary].filter(Boolean).join('　·　');
          if (meta) viewBox.append(el('p', 'lf-dmeta', meta));
          for (const para of String(d.body || '').split(/\n{2,}/)) {
            const p = para.trim();
            if (p) viewBox.append(el('p', 'lf-dp', p));
          }
        };

        const render = (r) => {
          if (!r) return;
          dirLine.textContent = r.dir ? `保存目录：${r.dir}（可在设置「生活日记保存目录」修改）` : '';
          notice.hidden = true;
          if (r.problem) {
            notice.hidden = false;
            notice.textContent = r.problem;
          } else if (r.inTrip) {
            notice.hidden = false;
            notice.textContent = '她目前正在旅行扩展的旅途中 —— 在外面期间会写旅行日记，回到家后恢复写生活日记。';
          }

          const days = r.days || [];
          listBox.innerHTML = '';
          if (!days.length) {
            showEntry(null);
          } else {
            let active = days.find((x) => x.dateKey === selectedDate) || days[0];
            for (const d of days) {
              const btn = el('button', 'lf-ditem');
              btn.type = 'button';
              if (d.dateKey === active.dateKey) btn.dataset.on = '1';
              btn.append(el('span', 'd', d.dateKey));
              btn.append(el('span', 'c', d.town || '兰州'));
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
          if (!ledger.length) {
            ledgerCard.append(el('p', 'lf-muted', '暂无收支流水。'));
          } else {
            const ul = el('ul', 'lf-list');
            for (const e of ledger) {
              const li = el('li');
              const sign = e.kind === 'income' ? '+' : '-';
              const day = e.ts ? fmtLocal(e.ts, 'md') : '';
              li.append(document.createTextNode(`${sign}${e.amount}　${e.note || e.source}${e.payee ? `（${e.payee}）` : ''}`));
              if (day) li.append(el('span', 'id', day));
              ul.append(li);
            }
            ledgerCard.append(ul);
          }

          eventsCard.innerHTML = '';
          eventsCard.append(el('h3', null, '最近经历'));
          const tells = r.tellable || [];
          if (!tells.length) {
            eventsCard.append(el('p', 'lf-muted', '暂无经历片段。'));
          } else {
            const ul = el('ul', 'lf-list');
            for (const it of tells) {
              const li = el('li');
              const day = it.at ? fmtLocal(it.at, 'md') : '';
              li.append(document.createTextNode(it.text || ''));
              if (day) li.append(el('span', 'id', day));
              ul.append(li);
            }
            eventsCard.append(ul);
          }
        };

        const load = () => ctx.invoke('list').then(render).catch((e) => {
          dirLine.textContent = (e && e.message) ? e.message : '读取失败';
        });
        await load();

        const loop = () => {
          ctx.timeout(() => {
            load().finally(loop);
          }, 30_000);
        };
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
        head.append(el('h1', null, '素材库与留影'));
        const sub = el('p', 'lf-sub', '管理人物、服饰、场景、道具参考图，并设置跨扩展自动留影策略。');
        const dirLine = el('div', 'lf-dir', '');

        /* ---- 留影策略设置卡 ---- */
        const policyCard = el('div', 'lf-card');
        policyCard.append(el('h3', null, '留影策略与主动冷却'));
        const pRow = el('div', 'lf-form-row');
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
        cdInput.style.flex = '0 0 110px';
        cdInput.placeholder = '冷却分钟';
        const pSaveBtn = el('button', 'lf-btn', '保存设置');
        pSaveBtn.type = 'button';
        const pMsg = el('span', 'lf-msg', '');
        pRow.append(policySel, document.createTextNode('冷却（分钟）：'), cdInput, pSaveBtn, pMsg);
        policyCard.append(pRow);

        /* ---- 分类标签栏 ---- */
        const tabs = el('div', 'lf-tabs');
        let curCat = 'characters';
        let lastState = { entries: [], settings: { policy: 'milestone', cooldownMin: 60 }, dir: '' };

        /* ---- 新建 / 编辑卡片 ---- */
        const formCard = el('div', 'lf-card');
        const formTitle = el('h3', null, '添加或更新条目');
        const fRow = el('div', 'lf-form-row');
        const nameIn = document.createElement('input');
        nameIn.className = 'lf-input';
        nameIn.placeholder = '名称（如：街角咖啡馆 / 居家服）';
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
        previewBox.style.marginBottom = '8px';
        let pendingDataUrls = [];
        let editingId = '';
        const btnRow = el('div', 'lf-form-row');
        const submitBtn = el('button', 'lf-btn', '保存到素材库');
        submitBtn.type = 'button';
        const resetBtn = el('button', 'lf-btn', '清空重填');
        resetBtn.type = 'button';
        const fMsg = el('span', 'lf-msg', '');
        btnRow.append(submitBtn, resetBtn, fMsg);
        formCard.append(formTitle, fRow, appIn, dropZone, fileInput, previewBox, btnRow);

        const grid = el('div', 'lf-lib-grid');
        app.append(head, sub, dirLine, policyCard, tabs, formCard, grid);

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
          formTitle.textContent = `在「${CAT_LABELS[curCat]}」下添加或更新条目`;
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
            tb.addEventListener('click', () => {
              curCat = cat;
              resetForm();
              render(lastState);
            });
            tabs.append(tb);
          }
          formTitle.textContent = editingId
            ? `编辑「${CAT_LABELS[curCat]}」条目（${editingId}）`
            : `在「${CAT_LABELS[curCat]}」下添加或更新条目`;

          grid.innerHTML = '';
          const items = (lastState.entries || []).filter((x) => x.category === curCat);
          if (!items.length) {
            grid.append(el('p', 'lf-muted', '当前分类暂无条目，在上方填写保存即可。'));
            return;
          }
          for (const it of items) {
            const card = el('div', 'lf-lib-card');
            const top = el('div', 'top');
            top.append(el('span', 'nm', it.name || it.id));
            top.append(el('span', 'alias', it.id));
            card.append(top);
            if (it.aliases && it.aliases.length) {
              card.append(el('div', 'alias', `别名：${it.aliases.join('、')}`));
            }
            card.append(el('div', 'desc', it.appearance || '暂无外观描述'));
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
              formTitle.textContent = `编辑「${CAT_LABELS[curCat]}」条目（${editingId}）`;
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
            render(nr);
          }).catch((e) => { fMsg.textContent = (e && e.message) || '保存失败'; });
        });

        await ctx.invoke('list').then(render).catch((e) => {
          dirLine.textContent = (e && e.message) || '读取失败';
        });
      },
    },
  },
};
