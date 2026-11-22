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

export interface LifeConfigSection extends WorldSection {
  /**
   * 她住在哪座城。留空 = 内置的兰州（南滨河路 / 张掖路 / 皋兰路 / 雁滩路）。
   *
   * 2026-11-15 加：原来只有「服务器」和「内置」两条路，用户填不了自己想让她住的城。
   * 现在按 journey 那套来 —— **本机填的优先，服务器是覆盖**。
   */
  homeCity: string;
  /** 她住的那座城由哪台服务器定。填了 = 覆盖上面那座（支持单个 URL 或逗号/换行分隔多台，留位置兼容 F1 联邦）。 */
  townUrl: string | string[];
  /** 她多久检查一次自己。**和「掉得快慢」无关**，只影响提醒的准时程度。 */
  tickMs: number;
  /** 阈值提醒的密度。 */
  notify: 'off' | 'once' | 'always';
  /** 生活日记保存目录。留空 = 存在本机 dataDir/life-diary；填了 = 存到指定目录（如同步盘）。 */
  diaryDir: string;
  /** 四分类参考素材库保存目录。留空 = 存在本机 dataDir/image-library；填了 = 存到指定目录。 */
  libraryDir: string;
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
  townUrl: '',
  tickMs: 60_000,
  notify: 'once',
  diaryDir: '',
  libraryDir: '',
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
            + '\n若下面填了服务器地址，这一栏会被服务器统一城名覆盖。',
          'x-hot': true,
        },
        'worlds.life.townUrl': {
          type: 'string',
          title: '同城服务器地址',
          description: '填你的服务器域名（如 https://cooppetsjourney.top），支持逗号或换行填多个备选地址。'
            + '\n填了：同步城名/街规与《街口黑板报》，可在鱼市街买菜、挂摊卖货；留空：纯本地单机过日子，不发网络请求。'
            + '\n管理城名与看全城鱼数，打开服务器的 /pets/life 页面。',
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
      },
    },
  }];
}
