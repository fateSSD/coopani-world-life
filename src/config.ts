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
   * 她住在哪座城。留空 = 内置的芦花塘（早市街 / 灶前巷 / 望水坡）。
   *
   * 2026-11-15 加：原来只有「服务器」和「内置」两条路，用户填不了自己想让她住的城。
   * 现在按 journey 那套来 —— **本机填的优先，服务器是覆盖**。
   */
  homeCity: string;
  /** 她住的那座城由哪台服务器定。填了 = 覆盖上面那座（所有人同一座城）。 */
  townUrl: string;
  /** 她多久检查一次自己。**和「掉得快慢」无关**，只影响提醒的准时程度。 */
  tickMs: number;
  /** 阈值提醒的密度。 */
  notify: 'off' | 'once' | 'always';
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
          description: '填一座真实的城 —— 北京、成都、兰州都行。'
            + '\n填了之后：她住在这座城，出门、逛街、找活都在这儿。街名留空就由她自己走着看。'
            + '\n\n留空：用内置的「芦花塘」（早市街 / 灶前巷 / 望水坡 + 四条城规），一个网络请求都不发。'
            + '\n\n⚠ 下面那栏「由谁来定」填了服务器地址的话，这一栏会被服务器上的城名覆盖 —— '
            + '服务器是给「大家都住同一座城」用的。',
          'x-hot': true,
        },
        'worlds.life.townUrl': {
          type: 'string',
          title: '她住的那座城，由谁来定',
          /*
           * 原来这一栏叫「本城服务器地址」、描述写「管着「她住的那座城」的服务器」。
           * 用户直接问「本城服务器又是什么意思」。那不是他不懂技术 ——
           * 是我用一个名词解释了另一个名词。现在改成「填什么 / 填了会怎样 / 不填会怎样」。
           */
          description: '填你自己那台 Coopani 服务器的网址，也就是你能打开 /pets 管理页的那个域名。'
            + '\n例如 https://cooppetsjourney.top'
            + '\n\n填了之后：城名、街名、城规都从服务器读。你在管理页改完，这边下次检查就跟着变 ——'
            + '所有装了这个扩展的鱼看到的是同一座城。'
            + '\n\n留空：不用服务器，就用上面「她住的那座城」那一栏 —— 那一栏也空着才是内置的芦花塘。'
            + '\n\n改城名的地方，就是那个服务器的 /pets 页面里的「本城」页签。'
            + '\n\n想让她在旅行扩展里也属于这座城：去旅行扩展的设置里，把「从哪儿出发」填成这个城名。'
            + '填了之后她的日记、照片地点、足迹都会写这个名字，而她其实还在那座地理城市里 —— '
            + '足迹是永久数据，写上了洗不掉。不填就还是原来的城市，这边照常过日子。',
          'x-hot': true,
        },
        'worlds.life.tickMs': {
          type: 'integer',
          title: '她多久检查一次自己',
          /*
           * 原来说明写「衰减按真实时间算，这个只决定她多久醒一次」。
           * 用户反问「多久看一次是什么意思」—— 问题在**没把两件事分开讲**：
           * 「掉得快慢」和「多久算一次」。它们最容易被当成一回事，而它们完全无关。
           */
          description: '她的五条需求**按真实时间一直在掉，关机也照样掉**，掉得快慢跟这一项没有关系。'
            + '\n\n这一项只决定她多久检查一次「是不是该提醒了」。60 秒足够。'
            + '\n\n调小 → 她查得更勤，提醒更准时，多耗一点点电。'
            + '\n调大 → 她查得更少，提醒会晚一点，最长晚这么久。'
            + '\n\n**不会**因为她少检查就不掉，也**不会**因为你调小就掉得更快。',
          minimum: 15_000,
          maximum: 600_000,
          'x-suffix': '毫秒',
          'x-hot': true,
        },
        'worlds.life.notify': {
          type: 'string',
          title: '阈值提醒',
          enum: ['off', 'once', 'always'],
          enumNames: ['不提醒', '一天一次', '每次都提醒'],
          description: '饿了、困了、脏了、闷了、孤单了 —— 掉到 30 以下时，她会不会自己开口说一句。'
            + '\n\n「一天一次」= 同一条需求一天最多提一次（推荐）。'
            + '\n「每次都提醒」会在她一直饿着的时候反复说，通常太吵。',
          'x-hot': true,
        },
      },
    },
  }];
}
