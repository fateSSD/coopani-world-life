/**
 * 版本检查的缓存文件必须**每个包一份**（2026-11-17，Mr.Q 抓到的）。
 *
 * ## 现场
 *
 * 面板角标显示「v0.16.5 → v1.12.3」—— 左边是模拟鱼生，右边那个 1.12.3
 * 是**环游世界**的版本号，life 从来没有 1.12.x。
 *
 * 根因：这个 `data` 目录是**所有扩展共用**的，而两边各自实现了一份版本检查，
 * 缓存却都写死成 `version-check.json`。谁最后查谁覆盖 ——
 * 22:33 环游世界重启时写进了 1.12.3，模拟鱼生读到就以为自己是那个版本。
 *
 * ## 这条守什么
 *
 * **两个包共用同一个 dataDir 时，缓存文件必须是两份。** 撞在一起不只是显示错版本，
 * 还会让「要不要更新」的判断整个失真 —— 一个包提示用户升级到另一个包的版本。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { VersionCheck } = await import('../src/version-check.ts');

/** 一个不联网的假 fetch：永远说「最新是 1.0.0」。 */
const fakeFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ latest: '1.0.0' }),
});

test('两个包共用 dataDir，缓存文件是两份', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vc-'));

  const life = new VersionCheck({
    dataDir: dir, current: '1.0.0', pkg: 'coopani-world-life', fetchImpl: fakeFetch,
  });
  const journey = new VersionCheck({
    dataDir: dir, current: '1.0.0', pkg: 'coopani-world-journey', fetchImpl: fakeFetch,
  });

  await life.refresh(true);
  await journey.refresh(true);

  const files = readdirSync(dir).filter((f) => f.startsWith('version-check'));
  assert.equal(
    files.length, 2,
    `两个包写了同一份缓存（一共只有 ${files.length} 个文件：${files.join(', ')}）`,
  );
  /* 旧的共用文件名不该再被新建出来。 */
  assert.equal(existsSync(join(dir, 'version-check.json')), false,
    '还在写老的共用文件名 version-check.json');
});

test('两个包各自的缓存互不覆盖', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vc2-'));

  /* life 查到 9.9.9，journey 查到 1.0.0 —— 必须各读各的。 */
  const life = new VersionCheck({
    dataDir: dir, current: '1.0.0', pkg: 'coopani-world-life',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ latest: '9.9.9' }) }),
  });
  await life.refresh(true);

  const journey = new VersionCheck({
    dataDir: dir, current: '1.0.0', pkg: 'coopani-world-journey', fetchImpl: fakeFetch,
  });
  await journey.refresh(true);

  assert.equal(life.state().latest, '9.9.9', 'life 的缓存被 journey 覆盖了');
  assert.equal(journey.state().latest, '1.0.0');

  /* 重新构造一遍（模拟重启），两边读回来还是各自的。 */
  const life2 = new VersionCheck({ dataDir: dir, current: '1.0.0', pkg: 'coopani-world-life' });
  const journey2 = new VersionCheck({ dataDir: dir, current: '1.0.0', pkg: 'coopani-world-journey' });
  assert.equal(life2.state().latest, '9.9.9');
  assert.equal(journey2.state().latest, '1.0.0');
});
