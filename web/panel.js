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
    helpTitle: '扩展名旁边那三盏灯怎么看？',
    helpOn: '绿',
    helpOnDesc: '上一次是好的，正常。',
    helpOff: '灰',
    helpOffDesc: '没启用，不是坏了 —— 比如没装旅行扩展。不用管。',
    helpErr: '红',
    helpErrDesc: '配好了但用不了，要去处理。原因和怎么办，鼠标停在灯上能看到。',
    helpHint: '三盏灯分别是：过日子（她还在正常流逝时间吗）、本城（城名从你的服务器读到了吗）、旅行（知道她在哪座城吗）。',
    fbLead: '有 bug，或者想让她能干什么？',
    fbBug: '复制诊断信息',
    fbWant: '复制诊断信息（想加东西）',
    fbOpenBug: '开 Issues 报 bug ↗',
    fbOpenWant: '开 Issues 提需求 ↗',
    fbCopied: '已复制，粘过去就行',
    fbAddr: '仓库：',
    fbWhy: '按钮只负责把版本和当前状态复制到剪贴板（不带任何身份信息）。'
      + '点右边的链接去 GitHub 开一条，把复制的内容粘在正文里 —— 这样一眼能看出是哪个版本、什么状态。',
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
    livingHere: '现在住这儿',
    moveTo: '搬过去',
    cantMove: '钱不够',
    moving: '搬…',
    moveNote: '搬家要押两个月，一次付清。老房子的押金退不回来 —— 结清水电、赔墙上的钉子。'
      + '这是你替她搬；她自己也会搬（life_move），走的是同一套账。',
    noGoal: '还没给自己定目标。',
    left: '还差 ¥{n}',
    canNow: '够攒了，去办吧',
    achieved: '已经做到了',
    vitals: '五条',
    asleep: '在睡',
    asleepLeft: '还有 {h} 小时（醒来精力约 {e}）',
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
        const ledgerCard = el('div', 'lf-card');
        habits.append(el('h3', null, t(lang, 'habits')));
        watches.append(el('h3', null, t(lang, 'watches')));
        wants.append(el('h3', null, t(lang, 'wants')));
        cols.append(habits, watches, wants, wishCard, pendingCard, pledgeCard, giftsCard, ledgerCard);
        const helpBox = el('details', 'lf-help');
        const fbBox = el('section', 'lf-fb');
        const foot = el('div', 'lf-foot');
        const reload = el('button', 'lf-btn', t(lang, 'reload'));
        const msg = el('span', 'lf-msg', '');
        foot.append(reload, msg);

        app.append(head, sub, note, whoCard, jobCard, vitalsCard, goalCard, moveCard, moodRow, cols, helpBox, fbBox, foot);

        const drawVitals = (vitals, low, asleep) => {
          vitalsCard.innerHTML = '';
          vitalsCard.append(el('h3', null, t(lang, 'vitals')));
          /*
           * 「在睡」要写在五条上面。
           *
           * 不写的话，面板跟她读到的状态一样 —— 看着五条正常，以为她醒着，
           * 然后奇怪为什么「出门」她不去。这是「世界里有这个状态、面板上读不到」。
           */
          if (asleep) {
            vitalsCard.append(el('p', 'lf-muted',
              `${t(lang, 'asleep')} · ${t(lang, 'asleepLeft', { h: asleep.hoursLeft, e: asleep.energyAtWake })}`));
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
        const drawMoves = (d) => {
          moveCard.innerHTML = '';
          moveCard.append(el('h3', null, t(lang, 'moves')));
          const qs = d.moveQuotes || [];
          if (!qs.length) {
            moveCard.append(el('p', 'lf-muted', t(lang, 'none')));
            return;
          }
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
              b.disabled = !q.ok;
              b.setAttribute('data-move', q.tier);
              box.append(b);
            }
            row.append(box);
            moveCard.append(row);
          }
          moveCard.append(el('p', 'lf-note-line', t(lang, 'moveNote')));
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
          /* 三档：服务器的城 / 你自己填的城 / 内置的芦花塘。 */
          tag.textContent = t(lang,
            d.town.source === 'server' ? 'server' : d.town.source === 'own' ? 'townOwn' : 'builtin');
          const bits = [];
          bits.push(`${d.dayPart} ${d.clock}`);
          if (d.weather && d.weather.sky) bits.push(d.weather.sky);
          if (d.street) bits.push(d.street);
          sub.textContent = bits.join('　·　');

          note.hidden = true;
          if (!d.journey.installed) {
            note.hidden = false;
            note.textContent = t(lang, 'noJourney');
          } else if (d.journey.phase === 'traveling') {
            note.hidden = false;
            note.textContent = t(lang, 'onRoad', { to: d.journey.to || '?', from: d.journey.city || '?' });
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
          drawVitals(d.vitals, d.low, d.asleep);
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
          drawList(ledgerCard, t(lang, 'ledger'), (d.ledger || []).slice(0, 12),
            (e) => `${e.kind === 'income' ? '+' : '-'}${e.amount}　${e.note || e.source}（${e.payee || ''}）`);
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
          const b = ev.target && ev.target.closest ? ev.target.closest('button[data-move]') : null;
          if (!b || b.disabled) return;
          const tier = b.getAttribute('data-move');
          b.disabled = true;
          b.textContent = t(lang, 'moving');
          msg.textContent = '';
          ctx.invoke('move', { tier })
            .then((r) => {
              render(r);
              if (r && r.ok === false && r.reason) msg.textContent = r.reason;
            })
            .catch((e) => { msg.textContent = (e && e.message) || '没搬成'; })
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
  },
};
