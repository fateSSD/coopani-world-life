/**
 * 四分类共享素材库（目录即库）+ 三档留影策略与冷却设置。
 *
 * 目录约定：
 *   <dataDir>/image-library/
 *     settings.json
 *     .seeded
 *     characters/<id>/entry.json + ref-*.png
 *     outfits/<id>/entry.json + ref-*.png
 *     scenes/<id>/entry.json + ref-*.png
 *     props/<id>/entry.json + ref-*.png
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { extname, join } from 'node:path';

export type LibraryCategory = 'characters' | 'outfits' | 'scenes' | 'props';
export const LIBRARY_CATEGORIES: LibraryCategory[] = ['characters', 'outfits', 'scenes', 'props'];

export const LIBRARY_CATEGORY_LABEL: Record<LibraryCategory, string> = {
  characters: '人物',
  outfits: '服饰',
  scenes: '场景',
  props: '道具',
};

export interface LibraryEntry {
  id: string;
  category: LibraryCategory;
  name: string;
  aliases: string[];
  tags: string[];
  appearance: string;
  images: string[];
  imagePreviews?: string[];
  updatedAt: string;
}

export type PhotoPolicyMode = 'off' | 'milestone' | 'active';

export interface LibrarySettings {
  policy: PhotoPolicyMode;
  cooldownMin: number;
  lastShotAt: string;
}

const DEFAULT_SETTINGS: LibrarySettings = {
  policy: 'milestone',
  cooldownMin: 60,
  lastShotAt: '',
};

const POLICY_LABEL: Record<PhotoPolicyMode, string> = {
  off: '静默',
  milestone: '重要时刻',
  active: '积极留影',
};

const normList = (v?: string[] | string): string[] => {
  if (!v) return [];
  const raw = Array.isArray(v) ? v : String(v).split(/[,，、\n]/);
  return [...new Set(raw.map((s) => String(s).trim()).filter(Boolean))];
};

const slugId = (name: string): string => {
  const ascii = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (ascii.length >= 2) return ascii.slice(0, 40);
  return `entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
};

const mimeToExt = (mime: string): string => {
  const m = mime.toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  if (m.includes('webp')) return '.webp';
  return '.png';
};

const extToMime = (file: string): string => {
  const e = extname(file).toLowerCase();
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.webp') return 'image/webp';
  return 'image/png';
};

const atomicWriteJson = (file: string, data: unknown): void => {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, file);
};

export class ImageLibrary {
  private readonly defaultRootDir: string;
  public rootDir: string;
  private settingsFile: string;
  private seededFile: string;

  constructor(dataDir: string, libraryDir = '') {
    this.defaultRootDir = join(dataDir, 'image-library');
    this.rootDir = this.defaultRootDir;
    this.settingsFile = join(this.rootDir, 'settings.json');
    this.seededFile = join(this.rootDir, '.seeded');
    this.configure(libraryDir);
  }

  /**
   * 切换素材库根目录（留空回退默认 `<dataDir>/image-library`）。
   * 若目标目录创建失败，保留当前可用目录并返回错误信息，避免把扩展搞挂。
   */
  configure(libraryDir = ''): { dir: string; problem: string | null } {
    const want = String(libraryDir ?? '').trim();
    const target = want || this.defaultRootDir;
    try {
      mkdirSync(target, { recursive: true });
      for (const cat of LIBRARY_CATEGORIES) {
        mkdirSync(join(target, cat), { recursive: true });
      }
      this.rootDir = target;
      this.settingsFile = join(target, 'settings.json');
      this.seededFile = join(target, '.seeded');
      this.seedDefaultsIfNeeded();
      return { dir: this.rootDir, problem: null };
    } catch (e) {
      return { dir: this.rootDir, problem: `素材库目录不可用（${(e as Error).message}），暂沿用 ${this.rootDir}` };
    }
  }

  private seedDefaultsIfNeeded(): void {
    if (existsSync(this.seededFile)) return;
    const seeds: Array<{
      category: LibraryCategory;
      id: string;
      name: string;
      aliases: string[];
      tags: string[];
      appearance: string;
    }> = [
      {
        category: 'characters',
        id: 'big-fish',
        name: '大肥鱼',
        aliases: ['肥鱼', '小鱼'],
        tags: ['主角'],
        appearance: '蓝白配色的可爱二次元少女大肥鱼，眼神灵动，带着标志性鱼尾发饰',
      },
      {
        category: 'outfits',
        id: 'home-knit',
        name: '居家服',
        aliases: ['舒适居家服', '浅色针织衫', '居家便装', '居家服系围裙'],
        tags: ['居家'],
        appearance: '米白色宽松软糯针织开衫配居家短裤，舒适自然',
      },
      {
        category: 'outfits',
        id: 'casual-out',
        name: '日常便装',
        aliases: ['出门逛街装', '出门便装', '得体日常装', '轻松外出装', '休闲毛衣或风衣', '文艺外套', '休闲外套'],
        tags: ['出门'],
        appearance: '浅卡其色风衣配百褶裙与小皮鞋，清爽干净的日常外出穿搭',
      },
      {
        category: 'outfits',
        id: 'sportswear',
        name: '运动速干装与跑鞋',
        aliases: ['运动服'],
        tags: ['运动'],
        appearance: '轻便透气运动短T恤配运动短裤与慢跑鞋',
      },
      {
        category: 'outfits',
        id: 'sleepwear',
        name: '睡衣',
        aliases: ['浴袍或宽松睡衣', '宽松浴服'],
        tags: ['休息'],
        appearance: '浅蓝色棉质宽松睡衣，领口柔和',
      },
      {
        category: 'scenes',
        id: 'reed-pond',
        name: '芦花塘木栈道',
        aliases: ['望水坡水边', '望水坡长椅', '塘边草坪', '塘边跑道'],
        tags: ['户外', '芦花塘'],
        appearance: '水边木栈道与成片芦苇荡，水面泛着微光，远处有水鸟与游鸭',
      },
      {
        category: 'scenes',
        id: 'corner-cafe',
        name: '街角咖啡馆',
        aliases: ['临水茶室', '街角小店或茶馆'],
        tags: ['休闲', '饮品'],
        appearance: '木质暖光街角咖啡馆，靠窗原木小桌，阳光透过玻璃窗洒在桌面',
      },
      {
        category: 'scenes',
        id: 'home-room',
        name: '家里书桌旁',
        aliases: ['自家厨房', '家里餐桌', '家里客厅与书桌', '家里沙发或床边', '卧室床铺'],
        tags: ['家里'],
        appearance: '温馨整洁的小屋室内，木质书桌与暖黄台灯，窗边挂着浅色窗帘',
      },
      {
        category: 'props',
        id: 'coffee-book',
        name: '手冲咖啡和书',
        aliases: ['书本与笔记本', '热茶和小点心'],
        tags: ['饮品', '阅读'],
        appearance: '陶瓷马克杯装着热咖啡，旁边摊开一本纸质书与钢笔',
      },
      {
        category: 'props',
        id: 'sketchbook',
        name: '画板与水彩笔',
        aliases: ['展览导览单'],
        tags: ['艺术'],
        appearance: '木质便携画板夹着水彩纸，旁边放着便携水彩盒与画笔',
      },
    ];

    const nowIso = new Date().toISOString();
    for (const s of seeds) {
      const dir = join(this.rootDir, s.category, s.id);
      if (existsSync(join(dir, 'entry.json'))) continue;
      mkdirSync(dir, { recursive: true });
      const entry: LibraryEntry = {
        id: s.id,
        category: s.category,
        name: s.name,
        aliases: s.aliases,
        tags: s.tags,
        appearance: s.appearance,
        images: [],
        updatedAt: nowIso,
      };
      atomicWriteJson(join(dir, 'entry.json'), entry);
    }
    if (!existsSync(this.settingsFile)) {
      atomicWriteJson(this.settingsFile, { ...DEFAULT_SETTINGS });
    }
    writeFileSync(this.seededFile, nowIso, 'utf8');
  }

  private readEntry(category: LibraryCategory, id: string, includePreviews: boolean): LibraryEntry | null {
    const dir = join(this.rootDir, category, id);
    const file = join(dir, 'entry.json');
    if (!existsSync(file)) return null;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      const images: string[] = Array.isArray(raw.images)
        ? raw.images.filter((x: unknown) => typeof x === 'string' && !x.includes('..') && existsSync(join(dir, x)))
        : [];
      const entry: LibraryEntry = {
        id: String(raw.id || id),
        category,
        name: String(raw.name || id),
        aliases: Array.isArray(raw.aliases) ? raw.aliases.map(String) : [],
        tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
        appearance: String(raw.appearance || ''),
        images,
        updatedAt: String(raw.updatedAt || ''),
      };
      if (includePreviews && images.length) {
        entry.imagePreviews = images.slice(0, 2).map((img) => {
          try {
            const buf = readFileSync(join(dir, img));
            return `data:${extToMime(img)};base64,${buf.toString('base64')}`;
          } catch {
            return '';
          }
        }).filter(Boolean);
      }
      return entry;
    } catch {
      return null;
    }
  }

  list(category?: LibraryCategory, includePreviews = false): LibraryEntry[] {
    const cats = category ? [category] : LIBRARY_CATEGORIES;
    const out: LibraryEntry[] = [];
    for (const cat of cats) {
      const catDir = join(this.rootDir, cat);
      if (!existsSync(catDir)) continue;
      let dirs: string[] = [];
      try {
        dirs = readdirSync(catDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort();
      } catch {
        dirs = [];
      }
      for (const id of dirs) {
        const e = this.readEntry(cat, id, includePreviews);
        if (e) out.push(e);
      }
    }
    return out;
  }

  search(query: string, category?: LibraryCategory): LibraryEntry[] {
    const q = String(query || '').trim().toLowerCase();
    const all = this.list(category, false);
    if (!q) return all;
    return all.filter((e) =>
      e.id.toLowerCase().includes(q)
      || e.name.toLowerCase().includes(q)
      || e.aliases.some((a) => a.toLowerCase().includes(q))
      || e.tags.some((t) => t.toLowerCase().includes(q))
      || e.appearance.toLowerCase().includes(q));
  }

  matchByHint(category: LibraryCategory, hint?: string | null): LibraryEntry | null {
    const h = String(hint || '').trim();
    if (!h) return null;
    const entries = this.list(category, false);
    const exact = entries.find((e) => e.name === h || e.aliases.includes(h));
    if (exact) return exact;
    const hl = h.toLowerCase();
    return entries.find((e) =>
      e.name.toLowerCase().includes(hl)
      || hl.includes(e.name.toLowerCase())
      || e.aliases.some((a) => a.toLowerCase().includes(hl) || hl.includes(a.toLowerCase()))) ?? null;
  }

  composeVisualPrompt(act: {
    label: string;
    scene?: string | null;
    outfitHint?: string | null;
    props?: string | null;
  }): string {
    const parts: string[] = [];
    if (act.scene) {
      const m = this.matchByHint('scenes', act.scene);
      parts.push(m?.appearance ? `场景：${act.scene}（${m.appearance}）` : `场景：${act.scene}`);
    }
    if (act.outfitHint) {
      const m = this.matchByHint('outfits', act.outfitHint);
      parts.push(m?.appearance ? `穿着：${act.outfitHint}（${m.appearance}）` : `穿着：${act.outfitHint}`);
    }
    if (act.props) {
      const m = this.matchByHint('props', act.props);
      parts.push(m?.appearance ? `手边：${act.props}（${m.appearance}）` : `手边：${act.props}`);
    }
    if (!parts.length && act.label) {
      parts.push(act.label);
    }
    return parts.join('；');
  }

  upsert(input: {
    id?: string;
    category: LibraryCategory;
    name: string;
    aliases?: string[] | string;
    tags?: string[] | string;
    appearance: string;
    imageDataUrls?: string[];
  }): LibraryEntry {
    const cat = LIBRARY_CATEGORIES.includes(input.category) ? input.category : 'props';
    const name = String(input.name || '').trim() || '未命名条目';
    const safeId = String(input.id || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '') || slugId(name);
    const dir = join(this.rootDir, cat, safeId);
    mkdirSync(dir, { recursive: true });

    const existing = this.readEntry(cat, safeId, false);
    const savedImages: string[] = existing ? [...existing.images] : [];

    if (Array.isArray(input.imageDataUrls) && input.imageDataUrls.length) {
      const urls = input.imageDataUrls.slice(0, 4);
      const nextImages: string[] = [];
      let idx = 1;
      for (const u of urls) {
        const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(String(u || '').trim());
        if (!m) continue;
        const ext = mimeToExt(m[1]);
        const fname = `ref-${idx}${ext}`;
        idx++;
        try {
          writeFileSync(join(dir, fname), Buffer.from(m[2], 'base64'));
          nextImages.push(fname);
        } catch {
          // 忽略单张坏图解码错误
        }
      }
      if (nextImages.length) {
        savedImages.splice(0, savedImages.length, ...nextImages);
      }
    }

    const entry: LibraryEntry = {
      id: safeId,
      category: cat,
      name,
      aliases: normList(input.aliases),
      tags: normList(input.tags),
      appearance: String(input.appearance || '').trim(),
      images: savedImages,
      updatedAt: new Date().toISOString(),
    };
    atomicWriteJson(join(dir, 'entry.json'), entry);
    return entry;
  }

  remove(category: LibraryCategory, id: string): boolean {
    if (!LIBRARY_CATEGORIES.includes(category)) return false;
    const safeId = String(id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeId) return false;
    const dir = join(this.rootDir, category, safeId);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  }

  getSettings(): LibrarySettings {
    if (!existsSync(this.settingsFile)) return { ...DEFAULT_SETTINGS };
    try {
      const raw = JSON.parse(readFileSync(this.settingsFile, 'utf8'));
      const policy: PhotoPolicyMode =
        raw.policy === 'off' || raw.policy === 'milestone' || raw.policy === 'active'
          ? raw.policy
          : DEFAULT_SETTINGS.policy;
      const cd = Number(raw.cooldownMin);
      const cooldownMin = Number.isFinite(cd) && cd >= 0 ? Math.min(1440, Math.round(cd)) : DEFAULT_SETTINGS.cooldownMin;
      return {
        policy,
        cooldownMin,
        lastShotAt: typeof raw.lastShotAt === 'string' ? raw.lastShotAt : '',
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  saveSettings(patch: Partial<LibrarySettings>): LibrarySettings {
    const cur = this.getSettings();
    const policy: PhotoPolicyMode =
      patch.policy === 'off' || patch.policy === 'milestone' || patch.policy === 'active'
        ? patch.policy
        : cur.policy;
    const cd = patch.cooldownMin !== undefined ? Number(patch.cooldownMin) : cur.cooldownMin;
    const cooldownMin = Number.isFinite(cd) && cd >= 0 ? Math.min(1440, Math.round(cd)) : cur.cooldownMin;
    const next: LibrarySettings = {
      policy,
      cooldownMin,
      lastShotAt: typeof patch.lastShotAt === 'string' ? patch.lastShotAt : cur.lastShotAt,
    };
    atomicWriteJson(this.settingsFile, next);
    return next;
  }

  summaryLine(): string {
    const counts = LIBRARY_CATEGORIES.map((c) => `${LIBRARY_CATEGORY_LABEL[c]} ${this.list(c).length}`);
    const st = this.getSettings();
    return `${counts.join(' · ')}（留影策略：${POLICY_LABEL[st.policy]} / 冷却 ${st.cooldownMin}m）`;
  }
}
