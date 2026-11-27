import type { ConfigGroup } from 'cortico/core/config-schema.ts';
import type { WorldSection } from 'cortico/world.ts';

/**
 * worldId。
 *
 * ⚠ 这个名字要同时对上三处，任何一处不一致都是**静默不加载**：
 *   `data/extensions/world-owners.json` 的键、`config.json` 的 `worlds.life`、
 *   以及这里。包名是 `coopani-world-life`，按 `coopani-world-` 剥前缀得 `life`，
 *   两者一致 —— 但别拿这条当规律，炉石那个包名是 `cortico-world-` 开头而目录是
 *   `coopani-world-`。以包里声明的 id 为准。
 */
export const LIFE_ID = 'life';

export type WeatherMode = 'auto' | 'external' | 'builtin';

export type WeatherSky = '晴' | '多云' | '小雨' | '起风';

export interface ExternalWeatherOverride {
  sky: WeatherSky;
  source?: string;
  rawWeather?: string;
  temperature?: number;
}

export function skyFromExternal(text: string): WeatherSky {
  const s = String(text || '').trim();
  if (/雨|雷|阵雨|毛毛雨/.test(s)) return '小雨';
  if (/雪|雾|阴/.test(s)) return '多云';
  if (/风|沙|霾/.test(s)) return '起风';
  if (/晴/.test(s)) return '晴';
  return '多云';
}

export function normWeatherUrl(raw: unknown): string {
  return String(raw || '').trim().replace(/\/+$/, '').replace(/\/now$/i, '').replace(/\/+$/, '');
}

export function normHubUrl(raw: unknown): string {
  return String(raw || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(?:v1|health)$/i, '')
    .replace(/\/+$/, '');
}

export function clampWeatherTimeoutMs(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 2500;
  return Math.max(500, Math.min(3000, Math.round(n)));
}

export interface LifeConfigSection extends WorldSection {
  /**
   * 她住在哪座城。留空 = 内置的兰州（南滨河路 / 张掖路 / 皋兰路 / 雁滩路）。
   *
   * 2026-11-15 加：原来只有「服务器」和「内置」两条路，用户填不了自己想让她住的城。
   * 现在按 journey 那套来 —— **本机填的优先，服务器是覆盖**。
   */
  homeCity: string;
  /** 多城联机总服 Hub v1 根地址（如 `https://hub.cooppetsjourney.top`）。留空 = 退回老服 `townUrl` 或单机。 */
  hubUrl: string;
  /** 接入 Hub v1 时默认定居的城镇 ID（如 `lanzhou-reedpond` / `beijing`）。 */
  hubTownId: string;
  /** 她住的那座城由哪台服务器定。填了 = 覆盖上面那座（支持单个 URL 或逗号/换行分隔多台，留位置兼容 F1 联邦）。 */
  townUrl: string | string[];
  /** 天气模式：auto（有外部地址优先、失败静默回退内置）/ external（外部优先、失联兜底并红灯提示）/ builtin（仅内置）。 */
  weatherMode: WeatherMode;
  /** 外部天气服务根地址（不带 `/now`，如 `http://127.0.0.1:7791`；留空不发请求）。 */
  weatherUrl: string;
  /** 外部天气请求超时（毫秒，默认 2500，上限 3000）。 */
  weatherTimeoutMs: number;
  /** 她多久检查一次自己。**和「掉得快慢」无关**，只影响提醒的准时程度。 */
  tickMs: number;
  /** 阈值提醒的密度。 */
  notify: 'off' | 'once' | 'always';
  /** 生活日记保存目录。留空 = 存在本机 dataDir/life-diary；填了 = 存到指定目录（如同步盘）。 */
  diaryDir: string;
  /** 四分类参考素材库保存目录。留空 = 存在本机 dataDir/image-library；填了 = 存到指定目录。 */
  libraryDir: string;
  /** 面板每日零花钱赠与软上限（元/天；0 = 不限，默认 500）。 */
  dailyGiftCap: number;
}

export function parseTownUrls(raw: string | readonly string[] | undefined | null): string[] {
  const arr = Array.isArray(raw) ? raw : String(raw || '').split(/[\n,]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const u = String(item || '').trim().replace(/\/+$/, '').replace(/\/town\/info$/, '');
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

export const LIFE_DEFAULTS = (): LifeConfigSection => ({
  /*
   * 默认关闭。这是宿主的硬规矩：装上一个扩展不等于答应它开始过日子。
   * 用户第一次打开这个世界，她才第一次开始饿。
   */
  enabled: false,
  homeCity: '',
  hubUrl: '',
  hubTownId: 'lanzhou-reedpond',
  townUrl: '',
  weatherMode: 'auto',
  weatherUrl: '',
  weatherTimeoutMs: 2500,
  tickMs: 60_000,
  notify: 'once',
  diaryDir: '',
  libraryDir: '',
  dailyGiftCap: 500,
});

export function lifeConfigGroups(): ConfigGroup[] {
  return [{
    id: 'life.main',
    owner: `world:${LIFE_ID}`,
    schema: {
      type: 'object',
      title: '模拟鱼生',
      properties: {
        /*
         * ⚠ 键必须是从 config.json 根开始的**完整点分路径**。
         * 写成裸名 `townUrl`，设置页保存时会落到 config.json 顶层，
         * 而 World 读的是 `worlds.life.townUrl` —— 配了等于没配，还不报错。
         */
        'worlds.life.homeCity': {
          type: 'string',
          title: '她住的那座城',
          description: '填一座真实城市（如北京、成都），日常出门与打工就落在这儿；留空则用内置的「兰州」。'
            + '\n若下面填了 Hub v1 或旧服服务器地址，这一栏会被服务器统一城名覆盖。',
          'x-hot': true,
        },
        'worlds.life.hubUrl': {
          type: 'string',
          title: '多城联机总服地址 (Hub v1)',
          description: '填入 Hub v1 服务根地址（如 https://hub.cooppetsjourney.top）即开启多城联机：'
            + '\n支持在兰州 / 北京等开放城市间自由迁居、跨城鱼市街买摊与快递费结算、同城农牧代管、鱼间私信，以及动态城市特产与行业加成。'
            + '\n留空随时回滚老服 townUrl 或纯本地单机过日子。',
          'x-hot': true,
        },
        'worlds.life.hubTownId': {
          type: 'string',
          title: 'Hub 默认定居城市 ID',
          description: '接入 Hub v1 时默认落户哪座城，常用 lanzhou-reedpond（兰州）或 beijing（北京）。'
            + '\n也可在「她此刻」面板直接一键迁居其他开放城市，迁城后会自动同步。',
          'x-hot': true,
        },
        'worlds.life.townUrl': {
          type: 'string',
          title: '同城服务器地址（老服兼容）',
          description: '仅在留空 Hub v1 地址时生效（老服兼容与回滚通道），支持逗号或换行填多个备选地址（如 https://cooppetsjourney.top）。'
            + '\n填了：同步城名/街规与《街口黑板报》，可在鱼市街买菜、挂摊卖货；两项皆留空：纯本地单机过日子，不发网络请求。',
          'x-hot': true,
        },
        'worlds.life.weatherMode': {
          type: 'string',
          title: '天气来源模式',
          enum: ['auto', 'external', 'builtin'],
          enumNames: ['自动（有外部地址优先，失败回退内置）', '外部优先（失联时兜底并红灯提示）', '仅用内置'],
          description: '决定天气晴雨从哪里拿：推荐保持「自动」，配了外部天气地址就用真实天气，没配或连不上时静默回退内置节气天气。',
          'x-hot': true,
        },
        'worlds.life.weatherUrl': {
          type: 'string',
          title: '外部天气服务地址',
          description: '外部天气服务根地址，不带 /now（例如 http://127.0.0.1:7791）。'
            + '\n留空时不发任何网络请求；每 10 分钟最多同步一次，不拖慢检查间隔。',
          'x-hot': true,
        },
        'worlds.life.weatherTimeoutMs': {
          type: 'integer',
          title: '外部天气超时',
          description: '请求外部天气服务的超时上限，建议 2500 毫秒，最高不超过 3000 毫秒。',
          minimum: 500,
          maximum: 3000,
          'x-suffix': '毫秒',
          'x-hot': true,
        },
        'worlds.life.tickMs': {
          type: 'integer',
          title: '检查间隔',
          description: '五条需求按真实时间持续衰减，关机也照算；这里只控制每隔多久检查一次是否需要提醒，默认 60 秒即可。',
          minimum: 15_000,
          maximum: 600_000,
          'x-suffix': '毫秒',
          'x-hot': true,
        },
        'worlds.life.notify': {
          type: 'string',
          title: '低值提醒',
          enum: ['off', 'once', 'always'],
          enumNames: ['不提醒', '一天一次', '每次都提醒'],
          description: '饱腹、精力等五条需求掉到 30 以下时是否开口提醒（推荐「一天一次」，避免一直催）。',
          'x-hot': true,
        },
        'worlds.life.diaryDir': {
          type: 'string',
          title: '生活日记目录',
          description: '留空存在本机默认目录（life-diary）；填写路径可存到网盘或自定义文件夹，立即生效。',
          'x-hot': true,
        },
        'worlds.life.libraryDir': {
          type: 'string',
          title: '素材库目录',
          description: '留空存在本机默认目录（image-library）；填写路径可指定四分类外观参考图的存储位置，不会删除旧目录原文件。',
          'x-hot': true,
        },
        'worlds.life.dailyGiftCap': {
          type: 'integer',
          title: '每日零花钱赠与上限',
          description: '面板「给点零花钱」的每日软上限（元/天）。默认 500，调高可放宽，设为 0 则不限制。',
          minimum: 0,
          maximum: 100000,
          default: 500,
          'x-suffix': '元/天',
          'x-hot': true,
        },
      },
    },
  }];
}
