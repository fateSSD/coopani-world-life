/**
 * 生活日记 —— 以第一人称记录她在家过日子的每一天、流水与经历。
 *
 * 沿用 journey 验证过的五条铁律：
 * 1. 按月存储（YYYY-MM.md），frontmatter + 正文，新的在最上面；
 * 2. 探测可写必须真写探针文件再删（不信 accessSync）；
 * 3. 改目录不搬迁旧文件，读取时合并自定义目录与本机兜底目录；
 * 4. 识别同步盘冲突副本（2026-11-电脑名.md），同一天取 mtime 更新者；
 * 5. `problem`（不可写错误）与 `notice`（正常提示）分开。
 */
import {
  mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export interface LifeDiaryEntry {
  readonly dateKey: string;
  readonly townName: string;
  readonly street?: string;
  readonly weather?: string;
  /** 当日收支或经历摘要（可选）。 */
  readonly summary?: string;
  readonly body: string;
}

export interface DiaryHealth {
  readonly dir: string;
  readonly ok: boolean;
  readonly problem: string | null;
  readonly notice: string | null;
}

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})(?:[-_ ].*)?\.md$/;
const MONTH_FILE = /^(\d{4}-\d{2})(?:[-_ ][^\d].*)?\.md$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const ENTRY_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/gm;

const monthTitle = (monthKey: string): string => {
  const [y, m] = monthKey.split('-');
  return `# ${y} 年 ${Number(m)} 月 · 生活日记\n`;
};

function kvs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function frontmatter(e: LifeDiaryEntry): string {
  const lines = [
    '---',
    `date: ${e.dateKey}`,
    `town: ${e.townName}`,
  ];
  if (e.street) lines.push(`street: ${e.street}`);
  if (e.weather) lines.push(`weather: ${e.weather}`);
  if (e.summary) lines.push(`summary: ${e.summary}`);
  lines.push('---', '');
  return lines.join('\n');
}

function renderEntry(e: LifeDiaryEntry): string {
  return `${frontmatter(e)}${e.body.trim()}\n`;
}

function entryOf(meta: Record<string, string>, body: string, dateKey: string): LifeDiaryEntry {
  return {
    dateKey,
    townName: meta.town || '芦花塘',
    street: meta.street || undefined,
    weather: meta.weather || undefined,
    summary: meta.summary || undefined,
    body: body.trim(),
  };
}

export function parseLifeDiaryFile(text: string): LifeDiaryEntry[] {
  const hits: { start: number; end: number; meta: Record<string, string>; date: string }[] = [];
  ENTRY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENTRY_RE.exec(text))) {
    const meta = kvs(m[1]);
    if (!DATE_KEY.test(meta.date ?? '')) {
      ENTRY_RE.lastIndex = m.index + 1;
      continue;
    }
    hits.push({ start: m.index, end: m.index + m[0].length, meta, date: meta.date });
  }
  return hits.map((h, i) => {
    const stop = i + 1 < hits.length ? hits[i + 1].start : text.length;
    return entryOf(h.meta, text.slice(h.end, stop), h.date);
  });
}

interface MonthFiles {
  main: string | null;
  all: { path: string; mtime: number }[];
}

export class LifeDiaryStore {
  private readonly local: string;
  private dir = '';
  private configured = '';
  private health: DiaryHealth;
  private cacheKey = '';
  private cache = new Map<string, LifeDiaryEntry>();

  constructor(dataDir: string) {
    this.local = join(dataDir, 'life-diary');
    this.dir = this.local;
    this.health = { dir: this.local, ok: true, problem: null, notice: null };
  }

  configure(diaryDir: string): DiaryHealth {
    const want = String(diaryDir ?? '').trim();
    if (!want) {
      this.configured = '';
      this.dir = this.local;
      this.health = { dir: this.local, ok: true, problem: null, notice: null };
      this.ensure(this.local);
      return this.health;
    }
    if (want === this.configured && this.dir === want && this.health.ok) {
      return this.health;
    }
    this.configured = want;

    const probe = this.probeWritable(want);
    if (probe) {
      this.dir = this.local;
      this.ensure(this.local);
      this.health = {
        dir: this.local,
        ok: false,
        problem: `生活日记目录用不了（${probe}），先存本机了：${want}`,
        notice: null,
      };
      return this.health;
    }
    this.dir = want;
    this.ensure(want);
    const empty = this.count() === 0;
    this.health = {
      dir: want,
      ok: true,
      problem: null,
      notice: empty ? `生活日记目录已切到：${want}` : null,
    };
    return this.health;
  }

  get current(): DiaryHealth {
    return this.health;
  }

  private probeWritable(dir: string): string | null {
    try {
      mkdirSync(dir, { recursive: true });
      const probe = join(dir, `.probe-${process.pid}.tmp`);
      writeFileSync(probe, 'ok', 'utf8');
      rmSync(probe, { force: true });
      return null;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (code === 'ENOENT') return '路径不存在，或者盘没连上';
      if (code === 'EACCES' || code === 'EPERM') return '没有写入权限';
      if (code === 'ENOSPC') return '磁盘满了';
      return e instanceof Error ? e.message : String(e);
    }
  }

  private ensure(dir: string): void {
    try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  }

  private safeNames(dir: string): string[] {
    try { return readdirSync(dir); } catch { return []; }
  }

  private months(dir: string): Map<string, MonthFiles> {
    const out = new Map<string, MonthFiles>();
    for (const name of this.safeNames(dir)) {
      const m = MONTH_FILE.exec(name);
      if (!m) continue;
      const path = join(dir, name);
      let mtime = 0;
      try { mtime = statSync(path).mtimeMs; } catch { continue; }
      const cur = out.get(m[1]) ?? { main: null, all: [] };
      cur.all.push({ path, mtime });
      if (name === `${m[1]}.md`) cur.main = path;
      out.set(m[1], cur);
    }
    for (const v of out.values()) v.all.sort((a, b) => b.mtime - a.mtime);
    return out;
  }

  private fingerprint(dir: string): string {
    const bits: string[] = [];
    for (const name of this.safeNames(dir).sort()) {
      if (!MONTH_FILE.test(name) && !DAY_FILE.test(name)) continue;
      try {
        const st = statSync(join(dir, name));
        bits.push(`${name}:${st.mtimeMs}:${st.size}`);
      } catch { /* ignore */ }
    }
    return bits.join('|');
  }

  private allEntries(): Map<string, LifeDiaryEntry> {
    const key = `${this.fingerprint(this.dir)}#${this.fingerprint(this.local)}`;
    if (key === this.cacheKey) return this.cache;

    const merged = new Map<string, LifeDiaryEntry>();
    const stamps = new Map<string, number>();
    for (const dir of this.dir === this.local ? [this.local] : [this.dir, this.local]) {
      for (const [, files] of this.months(dir)) {
        for (const f of files.all) {
          let entries: LifeDiaryEntry[];
          try { entries = parseLifeDiaryFile(readFileSync(f.path, 'utf8')); } catch { continue; }
          for (const e of entries) {
            const seen = stamps.get(e.dateKey) ?? -1;
            if (f.mtime <= seen) continue;
            merged.set(e.dateKey, e);
            stamps.set(e.dateKey, f.mtime);
          }
        }
      }
      for (const name of this.safeNames(dir)) {
        if (!DAY_FILE.test(name)) continue;
        const path = join(dir, name);
        let mtime = 0;
        try { mtime = statSync(path).mtimeMs; } catch { continue; }
        let entries: LifeDiaryEntry[];
        try { entries = parseLifeDiaryFile(readFileSync(path, 'utf8')); } catch { continue; }
        for (const e of entries) {
          const seen = stamps.get(e.dateKey) ?? -1;
          if (mtime <= seen) continue;
          merged.set(e.dateKey, e);
          stamps.set(e.dateKey, mtime);
        }
      }
    }
    this.cacheKey = key;
    this.cache = merged;
    return merged;
  }

  private readMonthFile(file: string): { days: Map<string, LifeDiaryEntry>; ok: boolean; raw: string } {
    let raw = '';
    try {
      raw = readFileSync(file, 'utf8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      return { days: new Map(), ok: code === 'ENOENT', raw: '' };
    }
    const days = new Map<string, LifeDiaryEntry>();
    for (const e of parseLifeDiaryFile(raw)) days.set(e.dateKey, e);
    return { days, ok: true, raw };
  }

  private writeMonthFile(file: string, monthKey: string, days: Map<string, LifeDiaryEntry>): boolean {
    const sorted = [...days.values()].sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
    const text = `${monthTitle(monthKey)}\n${sorted.map(renderEntry).join('\n')}`;
    try {
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, text, 'utf8');
      renameSync(tmp, file);
      return true;
    } catch {
      return false;
    }
  }

  write(entry: LifeDiaryEntry): { path: string; problem: string | null } {
    const monthKey = entry.dateKey.slice(0, 7);
    const targets = [this.dir];
    if (this.dir !== this.local) targets.push(this.local);
    let lastErr: string | null = null;
    for (const dir of targets) {
      try {
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `${monthKey}.md`);
        const cur = this.readMonthFile(file);
        if (!cur.ok) throw new Error('这个月的文件读不出来，先不覆盖');
        const days = cur.days;
        if (cur.raw.trim() && days.size === 0) {
          const bakDir = join(dir, '_bak');
          mkdirSync(bakDir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          writeFileSync(join(bakDir, `${monthKey}-unreadable-${stamp}.md`), cur.raw, 'utf8');
        }
        const old = days.get(entry.dateKey);
        const next = renderEntry(entry);
        if (old && renderEntry(old).trim() !== next.trim()) {
          const bakDir = join(dir, '_bak');
          mkdirSync(bakDir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          writeFileSync(join(bakDir, `${entry.dateKey}-${stamp}.md`), renderEntry(old), 'utf8');
        }
        days.set(entry.dateKey, entry);
        if (!this.writeMonthFile(file, monthKey, days)) throw new Error('月文件写不进去');
        this.cacheKey = '';
        return {
          path: file,
          problem: dir === this.dir ? null : `日记没写进配置的目录，存到本机了：${lastErr ?? ''}`,
        };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    return { path: '', problem: `日记写不进去：${lastErr ?? '原因不明'}` };
  }

  read(dateKey: string): LifeDiaryEntry | null {
    return this.allEntries().get(dateKey) ?? null;
  }

  recent(n: number): LifeDiaryEntry[] {
    const dates = [...this.allEntries().keys()].sort().slice(-Math.max(1, n));
    return dates.map((d) => this.read(d)).filter((x): x is LifeDiaryEntry => !!x);
  }

  month(monthKey: string): LifeDiaryEntry[] {
    if (!/^[0-9]{4}-[0-9]{2}$/.test(monthKey)) return [];
    return [...this.allEntries().values()]
      .filter((e) => e.dateKey.startsWith(monthKey))
      .sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
  }

  count(): number {
    return this.allEntries().size;
  }
}
