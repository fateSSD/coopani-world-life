import type { WorldDefinition } from 'cortico/world.ts';
import { LIFE_DEFAULTS, LIFE_ID, type LifeConfigSection } from './config.ts';
import { LIFE_DESCRIBE, LifeWorld } from './world.ts';

export const LIFE: WorldDefinition<LifeConfigSection> = {
  id: LIFE_ID,
  label: '模拟鱼生',
  defaults: () => structuredClone(LIFE_DEFAULTS()),
  // cfg 是**活引用**，不要展开成 {...ctx.cfg} —— 展开了热改就不生效了。
  create: (ctx) => new LifeWorld({
    cfg: ctx.cfg,
    dataDir: ctx.dataDir,
    botName: ctx.botName,
  }),
  describe: LIFE_DESCRIBE,
};
