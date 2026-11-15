/**
 * 包入口：默认导出 WorldDefinition。
 * 装载器按 `package.json` 的 `cortico.kind === 'world'` 认它。
 */
import { LIFE } from './definition.ts';

export default LIFE;
export { LIFE };
export { LifeWorld, LIFE_DESCRIBE } from './world.ts';
export { LIFE_DEFAULTS, LIFE_ID, lifeConfigGroups, type LifeConfigSection } from './config.ts';
export { BUILTIN_TOWN, readJourney, readTown } from './bridge.ts';
