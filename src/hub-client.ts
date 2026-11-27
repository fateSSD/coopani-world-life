/**
 * Coopanion Hub v1.1 客户端适配器。
 *
 * 严格遵循蓝图 §3.1 与 §5：
 * - 统一读写 `<dataDir>/coopanion-hub-auth.json`（临时文件 + rename 原子落盘）；
 * - 首次公开认领探测 `meet-uid.txt` → `life-town-uid.txt` 作为 `legacyUid`，遇 `409` 严禁另建新号；
 * - 所有鉴权走 `Authorization: Bearer <token>`，绝不使用 `?key=`；
 * - 支持 `ETag` / `If-None-Match` (`304`)、写接口必带 `Idempotency-Key` / `clientMsgId`。
 */

import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUILTIN_TOWN,
  normStreetProfiles,
  STALL_CATEGORY_LABEL,
  type StallCategory,
  type StallEffects,
  type TownStall,
  type TownView,
  normStallEffects,
} from './bridge.ts';
import { normHubUrl } from './config.ts';

export const HUB_AUTH_FILENAME = 'coopanion-hub-auth.json';

export interface HubAuthRecord {
  schema: 1;
  hubUrl: string;
  petId: string;
  token: string;
  legacyUid?: string | null;
  displayName: string;
  updatedAt: string;
}

export interface HubRequestResult<T> {
  ok: boolean;
  status: number;
  notModified?: boolean;
  etag?: string;
  data?: T;
  errorCode?: string;
  errorMessage?: string;
  retryAfter?: number;
}

export interface HubAuthFailureEvent {
  hubUrl: string;
  token: string;
  status: number;
  code: string;
  message: string;
}

const authFailureListeners = new Set<(ev: HubAuthFailureEvent) => void>();

/** 注册 Hub 运行期 401/403 致命鉴权错误监听器，返回取消订阅函数。 */
export function onHubAuthFailure(listener: (ev: HubAuthFailureEvent) => void): () => void {
  authFailureListeners.add(listener);
  return () => { authFailureListeners.delete(listener); };
}

function notifyAuthFailure(ev: HubAuthFailureEvent): void {
  for (const fn of authFailureListeners) {
    try { fn(ev); } catch { /* 监听器异常不得影响请求主流程 */ }
  }
}

export interface HubTownSummary {
  id: string;
  name: string;
  ownerPetId: string | null;
  notice: string;
  buffs: Record<string, number>;
  shipping: { base_fee?: number; per_extra_qty?: number };
  metaVersion: number;
  residentCount: number;
}

export interface HubTownMeta {
  id: string;
  name: string;
  notice: string;
  buffs: Record<string, number>;
  shipping: { base_fee?: number; per_extra_qty?: number };
  metaVersion: number;
  etag?: string;
  streetIdByName: Record<string, string>;
  streetNameById: Record<string, string>;
}

export interface HubCatalogItem {
  code: string;
  extId: string;
  townId: string | null;
  isSpecialty: boolean;
  kind: string;
  name: string;
  basePrice: number;
  maxPrice: number;
  effects: Record<string, unknown>;
  meta: Record<string, unknown>;
  catalogVer: number;
}

export interface HubCatalogJob {
  code: string;
  extId: string;
  townId: string | null;
  tier: string;
  domain: string;
  title: string;
  payMin: number;
  payMax: number;
  durationMin: number;
  requirements: Record<string, unknown>;
  rewards: Record<string, unknown>;
  catalogVer: number;
}

export interface HubResident {
  petId: string;
  displayName: string;
  avatarTag: string;
  street: string;
  lastActiveAt: string;
}

export interface HubOrder {
  id: string;
  listingId: string;
  sellerTownId: string;
  buyerTownId: string | null;
  isCrossTown: boolean;
  makerPetId: string;
  makerName?: string;
  takerPetId: string;
  takerName?: string;
  itemCode: string | null;
  itemName: string;
  qty: number;
  unitPrice: number;
  itemSubtotal: number;
  shippingFee: number;
  buyerTotal: number;
  effectsSnapshot: Record<string, unknown>;
  buyerNote: string;
  settledAt: string | null;
  createdAt: string;
}

export interface HubInboxEvent {
  id: number;
  sourceExt: string;
  eventType: string;
  refId: string;
  payload: Record<string, unknown>;
  expiresAt: string;
  createdAt: string;
}

export interface HubRelation {
  targetPetId: string;
  displayName: string;
  avatarTag: string;
  relType: 'acquaintance' | 'friend' | 'blocked';
  aliasNote: string;
  intimacy: number;
  updatedAt: string;
}

export interface HubConversation {
  id: string;
  kind: string;
  title: string;
  peer: { petId: string; displayName: string; avatarTag: string } | null;
  lastReadMsgId: number;
  unreadCount: number;
  lastMessage: {
    id: number;
    senderPetId: string | null;
    body: string | null;
    createdAt: string | null;
  } | null;
}

export interface HubMessage {
  id: number;
  senderPetId: string;
  msgType: 'text' | 'postcard' | 'gift_note' | 'system';
  body: string;
  meta: Record<string, unknown>;
  clientMsgId: string;
  createdAt: string;
}

export function hubAuthFilePath(dataDir: string): string {
  return join(dataDir, HUB_AUTH_FILENAME);
}

function parseHubAuthEntry(raw: any): HubAuthRecord | null {
  if (
    raw
    && raw.schema === 1
    && typeof raw.hubUrl === 'string' && normHubUrl(raw.hubUrl)
    && typeof raw.petId === 'string' && raw.petId.trim()
    && typeof raw.token === 'string' && raw.token.trim()
  ) {
    return {
      schema: 1,
      hubUrl: normHubUrl(raw.hubUrl),
      petId: raw.petId.trim(),
      token: raw.token.trim(),
      legacyUid: typeof raw.legacyUid === 'string' && raw.legacyUid.trim() ? raw.legacyUid.trim() : null,
      displayName: typeof raw.displayName === 'string' ? raw.displayName : '大肥鱼',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    };
  }
  return null;
}

/** 读取共享 Hub 身份凭据（传 targetHubUrl 时优先匹配顶层与 byHub 多服缓存）。 */
export function readHubAuth(dataDir: string, targetHubUrl?: string): HubAuthRecord | null {
  if (!dataDir) return null;
  try {
    const raw = JSON.parse(readFileSync(hubAuthFilePath(dataDir), 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    const top = parseHubAuthEntry(raw);
    const want = targetHubUrl ? normHubUrl(targetHubUrl) : '';
    if (!want) return top;
    if (top && top.hubUrl === want) return top;
    const byHub = (raw as any).byHub;
    if (byHub && typeof byHub === 'object') {
      const hit = parseHubAuthEntry(byHub[want]);
      if (hit && hit.hubUrl === want) return hit;
    }
  } catch { /* 文件不存在或损坏 */ }
  return null;
}

/** 原子写入共享 Hub 身份凭据（随机后缀 tmp + rename，并保留 byHub 多服凭据防切服丢失旧 Token）。 */
export function writeHubAuthAtomic(dataDir: string, rec: HubAuthRecord): void {
  if (!dataDir) return;
  mkdirSync(dataDir, { recursive: true });
  const fp = hubAuthFilePath(dataDir);
  const byHub: Record<string, HubAuthRecord> = {};
  try {
    const prevRaw = JSON.parse(readFileSync(fp, 'utf8'));
    const prevTop = parseHubAuthEntry(prevRaw);
    if (prevTop) byHub[prevTop.hubUrl] = prevTop;
    if (prevRaw && typeof prevRaw === 'object' && prevRaw.byHub && typeof prevRaw.byHub === 'object') {
      for (const [k, v] of Object.entries(prevRaw.byHub)) {
        const entry = parseHubAuthEntry(v);
        if (entry) byHub[normHubUrl(k) || entry.hubUrl] = entry;
      }
    }
  } catch { /* ignore */ }
  const normRec: HubAuthRecord = { ...rec, hubUrl: normHubUrl(rec.hubUrl) };
  byHub[normRec.hubUrl] = normRec;
  const payload = { ...normRec, byHub };
  const tmp = `${fp}.tmp.${process.pid}.${Date.now().toString(36)}.${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    renameSync(tmp, fp);
  } catch (err) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * 只读探测老服 UID（按序检查 `meet-uid.txt` → `life-town-uid.txt`）。
 * 绝不自行造新 uid，未建过老服 uid 时返回 undefined（避免盲传空值）。
 */
export function probeLegacyUid(dataDir: string): string | undefined {
  if (!dataDir) return undefined;
  for (const name of ['meet-uid.txt', 'life-town-uid.txt']) {
    try {
      const raw = readFileSync(join(dataDir, name), 'utf8').trim();
      if (/^[a-f0-9]{16,64}$/i.test(raw)) return raw;
    } catch { /* 继续找下一份 */ }
  }
  return undefined;
}

/** 统一 Hub HTTP 请求封装（Bearer 鉴权 + 超时控制 + 错误码提取）。 */
export async function hubRequest<T = any>(
  hubUrl: string,
  path: string,
  opts: {
    method?: string;
    token?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<HubRequestResult<T>> {
  const root = normHubUrl(hubUrl);
  if (!root) {
    return { ok: false, status: 0, errorCode: 'NO_HUB_URL', errorMessage: '未配置 Hub v1 服务地址' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 4000);
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(opts.headers ?? {}),
  };
  if (opts.token) {
    headers.authorization = `Bearer ${opts.token}`;
  }
  let rawBody: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    rawBody = JSON.stringify(opts.body);
  }
  try {
    const res = await fetch(`${root}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: rawBody,
      cache: 'no-store',
      signal: ctrl.signal,
    });
    const etag = res.headers.get('etag') ?? undefined;
    const retryAfterRaw = res.headers.get('retry-after');
    const retryAfter = retryAfterRaw && Number.isFinite(Number(retryAfterRaw)) ? Number(retryAfterRaw) : undefined;
    if (res.status === 304) {
      return { ok: true, status: 304, notModified: true, etag };
    }
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json || json.ok === false) {
      const errCode = typeof json?.error?.code === 'string' ? json.error.code : `HTTP_${res.status}`;
      const errMsg = typeof json?.error?.message === 'string' ? json.error.message : `Hub 返回 HTTP ${res.status}`;
      if (
        opts.token
        && (res.status === 401 || (res.status === 403 && (errCode === 'ACCOUNT_BANNED' || errCode === 'RENAME_REQUIRED')))
      ) {
        notifyAuthFailure({
          hubUrl: root,
          token: opts.token,
          status: res.status,
          code: errCode,
          message: errMsg,
        });
      }
      return {
        ok: false,
        status: res.status,
        etag,
        errorCode: errCode,
        errorMessage: errMsg,
        ...(retryAfter !== undefined ? { retryAfter } : {}),
      };
    }
    return {
      ok: true,
      status: res.status,
      etag,
      data: (json.data ?? json) as T,
    };
  } catch (e) {
    const isAbort = (e as Error)?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      errorCode: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR',
      errorMessage: isAbort ? 'Hub v1 连接超时' : ((e as Error)?.message || 'Hub v1 网络不可达'),
    };
  } finally {
    clearTimeout(timer);
  }
}

const HUB_AUTH_LOCK_FILENAME = 'coopanion-hub-auth.lock';
const HUB_AUTH_LOCK_STALE_MS = 15_000;
const HUB_AUTH_LOCK_WAIT_MS = 5_000;

async function withHubAuthLock<T>(dataDir: string, fn: () => Promise<T>): Promise<T> {
  if (!dataDir) return fn();
  try {
    mkdirSync(dataDir, { recursive: true });
  } catch {
    return fn();
  }
  const lockPath = join(dataDir, HUB_AUTH_LOCK_FILENAME);
  const deadline = Date.now() + HUB_AUTH_LOCK_WAIT_MS;
  let acquired = false;
  while (Date.now() < deadline) {
    try {
      const fd = openSync(lockPath, 'wx');
      try { writeFileSync(fd, `${process.pid}\n`, 'utf8'); } catch { /* ignore */ }
      closeSync(fd);
      acquired = true;
      break;
    } catch (e: any) {
      if (e?.code !== 'EEXIST') break;
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > HUB_AUTH_LOCK_STALE_MS) {
          unlinkSync(lockPath);
          continue;
        }
      } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  try {
    return await fn();
  } finally {
    if (acquired) {
      try { unlinkSync(lockPath); } catch { /* ignore */ }
    }
  }
}

/**
 * 保证本机持有一份针对 `hubUrl` 的有效身份凭据。
 * - 若 `<dataDir>/coopanion-hub-auth.json` 已存在且匹配同一 `hubUrl`，直接复用；
 * - 若无凭据，则带 `legacyUid`（若有）调 `POST /v1/core/pets/register`（持跨扩展文件锁防冷启动竞争）；
 * - 遇 `409 LEGACY_UID_CLAIMED` 诚实报错停下，绝不抛弃 `legacyUid` 另建新号。
 */
export async function ensureHubAuth(opts: {
  hubUrl: string;
  dataDir: string;
  displayName: string;
  bio?: string;
  timeoutMs?: number;
  conflictRetryDelaysMs?: readonly number[];
}): Promise<{ ok: boolean; auth?: HubAuthRecord; created?: boolean; code?: string; reason?: string }> {
  const root = normHubUrl(opts.hubUrl);
  if (!root) return { ok: false, code: 'NO_HUB_URL', reason: '未配置 Hub 服务地址' };

  const existing = readHubAuth(opts.dataDir, root);
  if (existing && existing.hubUrl === root) {
    return { ok: true, auth: existing, created: false };
  }

  return withHubAuthLock(opts.dataDir, async () => {
    const racedBefore = readHubAuth(opts.dataDir, root);
    if (racedBefore && racedBefore.hubUrl === root) {
      return { ok: true, auth: racedBefore, created: false };
    }

    const legacyUid = probeLegacyUid(opts.dataDir);
    const res = await hubRequest<{
      petId: string;
      displayName: string;
      legacyUid: string | null;
      token: string;
    }>(root, '/v1/core/pets/register', {
      method: 'POST',
      body: {
        displayName: (opts.displayName || '大肥鱼').slice(0, 32),
        ...(legacyUid ? { legacyUid } : {}),
        ...(opts.bio ? { bio: opts.bio.slice(0, 300) } : {}),
      },
      timeoutMs: opts.timeoutMs ?? 5000,
    });

    if (!res.ok || !res.data?.petId || !res.data?.token) {
      if (res.errorCode === 'LEGACY_UID_CLAIMED') {
        // 双扩展并发首次启动时，可能一方刚完成认领写盘，另一方紧随其后吃到 409；轮询重读共享凭据自愈
        const delays = opts.conflictRetryDelaysMs ?? [0, 150, 350, 750];
        for (const ms of delays) {
          if (ms > 0) await new Promise((r) => setTimeout(r, ms));
          const raced = readHubAuth(opts.dataDir, root);
          if (raced && raced.hubUrl === root) {
            return { ok: true, auth: raced, created: false };
          }
        }
        return {
          ok: false,
          code: 'LEGACY_UID_CLAIMED',
          reason: `老服 uid（${legacyUid?.slice(0, 8)}…）已被 Hub v1 认领，且本机缺少 coopanion-hub-auth.json；请联系总服管理员通过 tokens/reset 核实找回，绝不重复建号。`,
        };
      }
      return {
        ok: false,
        code: res.errorCode || 'REGISTER_FAILED',
        reason: res.errorMessage || 'Hub 身份注册失败',
      };
    }

    const rec: HubAuthRecord = {
      schema: 1,
      hubUrl: root,
      petId: res.data.petId,
      token: res.data.token,
      legacyUid: res.data.legacyUid ?? legacyUid ?? null,
      displayName: res.data.displayName || opts.displayName || '大肥鱼',
      updatedAt: new Date().toISOString(),
    };
    try {
      writeHubAuthAtomic(opts.dataDir, rec);
    } catch (e) {
      return {
        ok: false,
        code: 'AUTH_WRITE_FAILED',
        reason: `Hub 身份写入本机失败（${e instanceof Error ? e.message : String(e)}）`,
      };
    }
    return { ok: true, auth: rec, created: true };
  });
}

export async function hubListTowns(hubUrl: string, timeoutMs = 4000): Promise<{
  ok: boolean;
  towns: HubTownSummary[];
  reason?: string;
}> {
  const res = await hubRequest<{ towns: HubTownSummary[] }>(hubUrl, '/v1/towns', { timeoutMs });
  if (!res.ok || !res.data) {
    return { ok: false, towns: [], reason: res.errorMessage };
  }
  return {
    ok: true,
    towns: Array.isArray(res.data.towns) ? res.data.towns : [],
  };
}

export async function hubGetTown(
  hubUrl: string,
  townId: string,
  opts: { etag?: string; timeoutMs?: number } = {},
): Promise<{
  ok: boolean;
  notModified?: boolean;
  etag?: string;
  townView?: TownView;
  meta?: HubTownMeta;
  status: number;
  reason?: string;
}> {
  const id = String(townId || '').trim() || 'lanzhou-reedpond';
  const headers: Record<string, string> = {};
  if (opts.etag) headers['if-none-match'] = opts.etag;

  const res = await hubRequest<{
    id: string;
    name: string;
    originDesc: string;
    notice: string;
    rules: string[];
    streets: Array<string | { id?: string; name?: string; desc?: string; mods?: Record<string, unknown> }>;
    buffs?: Record<string, number>;
    shipping?: { base_fee?: number; per_extra_qty?: number };
    metaVersion?: number;
  }>(hubUrl, `/v1/towns/${encodeURIComponent(id)}`, {
    headers,
    timeoutMs: opts.timeoutMs ?? 4000,
  });

  if (res.notModified) {
    return { ok: true, notModified: true, etag: res.etag ?? opts.etag, status: 304 };
  }
  if (!res.ok || !res.data) {
    return { ok: false, status: res.status, reason: res.errorMessage };
  }

  const rawStreets = Array.isArray(res.data.streets) ? res.data.streets : [];
  const streetIdByName: Record<string, string> = {};
  const streetNameById: Record<string, string> = {};
  for (const s of rawStreets) {
    if (s && typeof s === 'object') {
      const sid = typeof s.id === 'string' ? s.id.trim() : '';
      const sname = typeof s.name === 'string' ? s.name.trim() : sid;
      if (sname) {
        if (sid) {
          streetIdByName[sname] = sid;
          streetNameById[sid] = sname;
        } else {
          streetIdByName[sname] = sname;
          streetNameById[sname] = sname;
        }
      }
    } else if (typeof s === 'string' && s.trim()) {
      const name = s.trim();
      streetIdByName[name] = name;
      streetNameById[name] = name;
    }
  }

  const profiles = normStreetProfiles(
    rawStreets.map((s) => (typeof s === 'string' ? s : String(s?.name || s?.id || ''))).filter(Boolean),
    rawStreets,
  );
  const streetNames = profiles.map((p) => p.name);
  const rules = Array.isArray(res.data.rules) ? res.data.rules.filter((x) => typeof x === 'string') : [];
  const buffs = res.data.buffs && typeof res.data.buffs === 'object' ? res.data.buffs : {};
  const shipping = res.data.shipping && typeof res.data.shipping === 'object' ? res.data.shipping : {};
  const metaVersion = Number(res.data.metaVersion ?? 1) || 1;

  const townView: TownView = {
    id: res.data.id || id,
    name: res.data.name || BUILTIN_TOWN.name,
    origin: typeof res.data.originDesc === 'string' ? res.data.originDesc : '',
    streets: streetNames.length ? streetNames : BUILTIN_TOWN.streets.slice(),
    streetProfiles: profiles,
    rules: rules.length ? rules : BUILTIN_TOWN.rules.slice(),
    custom: true,
    source: 'server',
    notice: typeof res.data.notice === 'string' ? res.data.notice : '',
    buffs,
    shipping,
    metaVersion,
    hubMode: true,
  };
  const meta: HubTownMeta = {
    id: townView.id,
    name: townView.name,
    notice: townView.notice ?? '',
    buffs,
    shipping,
    metaVersion,
    etag: res.etag ?? `"${metaVersion}"`,
    streetIdByName,
    streetNameById,
  };
  return {
    ok: true,
    notModified: false,
    etag: meta.etag,
    townView,
    meta,
    status: res.status,
  };
}

export async function hubJoinTown(
  hubUrl: string,
  token: string,
  townId: string,
  street: string,
  timeoutMs = 4000,
): Promise<{
  ok: boolean;
  townId?: string;
  townName?: string;
  street?: string;
  streetName?: string;
  reason?: string;
}> {
  const res = await hubRequest<{
    townId: string;
    townName: string;
    street: string;
    streetName: string;
  }>(hubUrl, `/v1/towns/${encodeURIComponent(townId)}/join`, {
    method: 'POST',
    token,
    body: { street },
    timeoutMs,
  });
  if (!res.ok || !res.data) {
    return { ok: false, reason: res.errorMessage };
  }
  return {
    ok: true,
    townId: res.data.townId,
    townName: res.data.townName,
    street: res.data.street,
    streetName: res.data.streetName,
  };
}

export async function hubGetResidents(
  hubUrl: string,
  token: string,
  townId: string,
  opts: { street?: string; limit?: number; timeoutMs?: number } = {},
): Promise<{ ok: boolean; residents: HubResident[]; reason?: string }> {
  const q = new URLSearchParams();
  if (opts.street) q.set('street', opts.street);
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();
  const res = await hubRequest<{ residents: HubResident[] }>(
    hubUrl,
    `/v1/towns/${encodeURIComponent(townId)}/residents${qs ? `?${qs}` : ''}`,
    { token, timeoutMs: opts.timeoutMs ?? 4000 },
  );
  if (!res.ok || !res.data) return { ok: false, residents: [], reason: res.errorMessage };
  return { ok: true, residents: Array.isArray(res.data.residents) ? res.data.residents : [] };
}

export async function hubPutExtProfile(
  hubUrl: string,
  token: string,
  extId: string,
  body: { schemaVer: number; summaryText: string; payload: Record<string, unknown> },
  timeoutMs = 4000,
): Promise<{ ok: boolean; reason?: string }> {
  const res = await hubRequest(hubUrl, `/v1/core/pets/me/ext/${encodeURIComponent(extId)}`, {
    method: 'PUT',
    token,
    body,
    timeoutMs,
  });
  return res.ok ? { ok: true } : { ok: false, reason: res.errorMessage };
}

export async function hubGetCatalogSnapshot(
  hubUrl: string,
  opts: { ext?: string; townId?: string; etag?: string; token?: string; timeoutMs?: number } = {},
): Promise<{
  ok: boolean;
  notModified?: boolean;
  etag?: string;
  version?: number;
  items?: HubCatalogItem[];
  jobs?: HubCatalogJob[];
  reason?: string;
}> {
  const q = new URLSearchParams({ ext: opts.ext ?? 'life' });
  if (opts.townId) q.set('town_id', opts.townId);
  const headers: Record<string, string> = {};
  if (opts.etag) headers['if-none-match'] = opts.etag;

  const res = await hubRequest<{
    version: number;
    items: HubCatalogItem[];
    jobs: HubCatalogJob[];
  }>(hubUrl, `/v1/core/catalog/snapshot?${q.toString()}`, {
    token: opts.token,
    headers,
    timeoutMs: opts.timeoutMs ?? 4000,
  });
  if (res.notModified) {
    return { ok: true, notModified: true, etag: res.etag ?? opts.etag };
  }
  if (!res.ok || !res.data) {
    return { ok: false, reason: res.errorMessage };
  }
  return {
    ok: true,
    etag: res.etag,
    version: res.data.version,
    items: Array.isArray(res.data.items) ? res.data.items : [],
    jobs: Array.isArray(res.data.jobs) ? res.data.jobs : [],
  };
}

export async function hubListListings(
  hubUrl: string,
  token: string,
  opts: { townId?: string; category?: string; specialtyOnly?: boolean; limit?: number; timeoutMs?: number } = {},
): Promise<{ ok: boolean; buyerTownId: string | null; stalls: TownStall[]; reason?: string }> {
  const q = new URLSearchParams();
  if (opts.townId) q.set('town_id', opts.townId);
  if (opts.category) q.set('category', opts.category);
  if (opts.specialtyOnly) q.set('specialty_only', '1');
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();

  const res = await hubRequest<{
    buyerTownId: string | null;
    listings: Array<{
      id: string;
      townId: string;
      townName: string;
      sellerPetId: string;
      sellerName: string;
      isMine: boolean;
      category: string;
      itemCode: string | null;
      isSpecialty: boolean;
      itemName: string;
      unitPrice: number;
      stockTotal: number;
      stockLeft: number;
      isCrossTown: boolean;
      estimatedShippingFee: number;
      effects: Record<string, unknown>;
      meta: Record<string, unknown>;
      expiresAt: string;
    }>;
  }>(hubUrl, `/v1/market/listings${qs ? `?${qs}` : ''}`, {
    token,
    timeoutMs: opts.timeoutMs ?? 4000,
  });
  if (!res.ok || !res.data) {
    return { ok: false, buyerTownId: null, stalls: [], reason: res.errorMessage };
  }
  const stalls: TownStall[] = (res.data.listings ?? []).map((x) => {
    const rawCat = typeof x.category === 'string' ? x.category : '';
    const category = rawCat in STALL_CATEGORY_LABEL ? (rawCat as StallCategory) : undefined;
    const price = Math.round(Number(x.unitPrice) || 1);
    const effects = normStallEffects(x.effects, price);
    const meta = x.meta && typeof x.meta === 'object' ? x.meta : {};
    return {
      id: x.id,
      seller: x.sellerName || '街坊',
      kind: 'goods',
      item: x.itemName,
      price,
      stock: Math.round(Number(x.stockLeft) || 0),
      freshVeg: Boolean((meta as any).freshVeg) || category === 'produce',
      ...(category ? { category } : {}),
      ...(typeof (meta as any).note === 'string' && (meta as any).note ? { note: (meta as any).note } : {}),
      ...(effects ? { effects } : {}),
      townId: x.townId,
      townName: x.townName,
      sellerPetId: x.sellerPetId,
      isMine: Boolean(x.isMine),
      isCrossTown: Boolean(x.isCrossTown),
      estimatedShippingFee: Math.max(0, Math.round(Number(x.estimatedShippingFee) || 0)),
      isSpecialty: Boolean(x.isSpecialty),
      ...(x.itemCode ? { itemCode: x.itemCode } : {}),
      expiresAt: x.expiresAt,
    };
  });
  return { ok: true, buyerTownId: res.data.buyerTownId ?? null, stalls };
}

export async function hubCreateListing(
  hubUrl: string,
  token: string,
  payload: {
    townId: string;
    category: StallCategory;
    itemCode?: string | null;
    itemName: string;
    unitPrice: number;
    stockTotal: number;
    freshVeg?: boolean;
    note?: string;
    effects?: StallEffects;
  },
  timeoutMs = 4000,
): Promise<{
  ok: boolean;
  id?: string;
  townId?: string;
  itemName?: string;
  unitPrice?: number;
  stockTotal?: number;
  expiresAt?: string;
  reason?: string;
}> {
  const res = await hubRequest<{
    id: string;
    townId: string;
    itemName: string;
    unitPrice: number;
    stockTotal: number;
    expiresAt: string;
  }>(hubUrl, '/v1/market/listings', {
    method: 'POST',
    token,
    body: {
      townId: payload.townId,
      side: 'sell',
      category: payload.category,
      ...(payload.itemCode ? { itemCode: payload.itemCode } : {}),
      itemName: payload.itemName,
      unitPrice: Math.round(payload.unitPrice),
      stockTotal: Math.round(payload.stockTotal),
      effects: payload.effects ?? {},
      meta: {
        freshVeg: Boolean(payload.freshVeg),
        ...(payload.note ? { note: payload.note } : {}),
      },
    },
    timeoutMs,
  });
  if (!res.ok || !res.data) {
    if (res.errorCode === 'STALL_LIMIT_REACHED') {
      return { ok: false, reason: '你在鱼市街同时在架的摊位已经满 3 个了，先等卖完或下架再挂。' };
    }
    return { ok: false, reason: res.errorMessage };
  }
  return {
    ok: true,
    id: res.data.id,
    townId: res.data.townId,
    itemName: res.data.itemName,
    unitPrice: res.data.unitPrice,
    stockTotal: res.data.stockTotal,
    expiresAt: res.data.expiresAt,
  };
}

export async function hubCancelListing(
  hubUrl: string,
  token: string,
  listingId: string,
  timeoutMs = 4000,
): Promise<{ ok: boolean; reason?: string }> {
  const res = await hubRequest(hubUrl, `/v1/market/listings/${encodeURIComponent(listingId)}`, {
    method: 'DELETE',
    token,
    timeoutMs,
  });
  return res.ok ? { ok: true } : { ok: false, reason: res.errorMessage };
}

export async function hubTradeListing(
  hubUrl: string,
  token: string,
  listingId: string,
  opts: { qty?: number; note?: string; idempotencyKey: string; timeoutMs?: number },
): Promise<{
  ok: boolean;
  order?: {
    id: string;
    listingId: string;
    sellerTownId: string;
    buyerTownId: string | null;
    isCrossTown: boolean;
    sellerPetId: string;
    itemCode: string | null;
    itemName: string;
    qty: number;
    unitPrice: number;
    itemSubtotal: number;
    shippingFee: number;
    buyerTotal: number;
    effectsSnapshot: Record<string, unknown>;
  };
  errorCode?: string;
  reason?: string;
}> {
  const res = await hubRequest<any>(hubUrl, `/v1/market/listings/${encodeURIComponent(listingId)}/trade`, {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': opts.idempotencyKey },
    body: {
      qty: opts.qty ?? 1,
      note: opts.note ?? '',
    },
    timeoutMs: opts.timeoutMs ?? 4500,
  });
  if (!res.ok || !res.data) {
    const codeMap: Record<string, string> = {
      PAIR_LIMIT: '今天已经和这位街坊成交过两单了，明天再来逛吧。',
      SELF_TRADE_FORBIDDEN: '不能买自己挂在鱼市街上的摊货哦。',
      INSUFFICIENT_STOCK: res.errorMessage || '摊位库存不够了。',
      LISTING_NOT_OPEN: '这个摊位刚刚卖光或下架了。',
    };
    return {
      ok: false,
      errorCode: res.errorCode,
      reason: (res.errorCode && codeMap[res.errorCode]) || res.errorMessage || '买摊没成功。',
    };
  }
  return { ok: true, order: res.data };
}

export async function hubListOrders(
  hubUrl: string,
  token: string,
  opts: { role?: 'maker' | 'taker'; unsettled?: boolean; limit?: number; timeoutMs?: number } = {},
): Promise<{ ok: boolean; orders: HubOrder[]; reason?: string }> {
  const q = new URLSearchParams();
  if (opts.role) q.set('role', opts.role);
  if (opts.unsettled) q.set('unsettled', '1');
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();

  const res = await hubRequest<{ orders: HubOrder[] }>(hubUrl, `/v1/market/orders${qs ? `?${qs}` : ''}`, {
    token,
    timeoutMs: opts.timeoutMs ?? 4000,
  });
  if (!res.ok || !res.data) return { ok: false, orders: [], reason: res.errorMessage };
  return { ok: true, orders: Array.isArray(res.data.orders) ? res.data.orders : [] };
}

export async function hubSettleOrders(
  hubUrl: string,
  token: string,
  orderIds: readonly string[],
  timeoutMs = 4000,
): Promise<{ ok: boolean; settledIds: string[]; reason?: string }> {
  if (!orderIds.length) return { ok: true, settledIds: [] };
  const res = await hubRequest<{ settledIds: string[] }>(hubUrl, '/v1/market/orders/settle', {
    method: 'POST',
    token,
    body: { orderIds: orderIds.slice(0, 50) },
    timeoutMs,
  });
  if (!res.ok || !res.data) return { ok: false, settledIds: [], reason: res.errorMessage };
  return { ok: true, settledIds: Array.isArray(res.data.settledIds) ? res.data.settledIds : [] };
}

export async function hubListErrands(
  hubUrl: string,
  token: string,
  opts: { kind?: string; limit?: number; timeoutMs?: number } = {},
): Promise<{ ok: boolean; townId: string | null; errands: TownStall[]; reason?: string }> {
  const q = new URLSearchParams();
  if (opts.kind) q.set('kind', opts.kind);
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();

  const res = await hubRequest<{
    townId: string | null;
    errands: Array<{
      id: string;
      townId: string;
      requesterPetId: string;
      requesterName: string;
      errandKind: string;
      title: string;
      rewardPrice: number;
      estMinutes: number;
      expiresAt: string;
    }>;
  }>(hubUrl, `/v1/errands${qs ? `?${qs}` : ''}`, {
    token,
    timeoutMs: opts.timeoutMs ?? 4000,
  });
  if (!res.ok || !res.data) {
    return { ok: false, townId: null, errands: [], reason: res.errorMessage };
  }
  const errands: TownStall[] = (res.data.errands ?? [])
    .filter((e) => opts.kind || e.errandKind === 'farm_care' || e.errandKind === 'farm_full')
    .map((e) => ({
      id: e.id,
      seller: e.requesterName || '同城街坊',
      kind: 'errand',
      item: e.title,
      price: Math.round(Number(e.rewardPrice) || 1),
      stock: 1,
      freshVeg: false,
      townId: e.townId,
      sellerPetId: e.requesterPetId,
      isMine: false,
      estMinutes: e.estMinutes,
      errandKind: e.errandKind,
      expiresAt: e.expiresAt,
    }));
  return { ok: true, townId: res.data.townId ?? null, errands };
}

export async function hubCreateErrand(
  hubUrl: string,
  token: string,
  payload: {
    townId: string;
    errandKind: 'farm_care' | 'farm_full' | 'delivery' | 'custom';
    title: string;
    rewardPrice: number;
    estMinutes: number;
    payload?: Record<string, unknown>;
  },
  timeoutMs = 4000,
): Promise<{ ok: boolean; id?: string; expiresAt?: string; reason?: string }> {
  const res = await hubRequest<{ id: string; expiresAt: string }>(hubUrl, '/v1/errands', {
    method: 'POST',
    token,
    body: {
      townId: payload.townId,
      errandKind: payload.errandKind,
      title: payload.title,
      rewardPrice: Math.round(payload.rewardPrice),
      estMinutes: Math.max(5, Math.min(480, Math.round(payload.estMinutes))),
      payload: payload.payload ?? {},
    },
    timeoutMs,
  });
  if (!res.ok || !res.data) return { ok: false, reason: res.errorMessage };
  return { ok: true, id: res.data.id, expiresAt: res.data.expiresAt };
}

export async function hubClaimErrand(
  hubUrl: string,
  token: string,
  errandId: string,
  idempotencyKey: string,
  timeoutMs = 4000,
): Promise<{
  ok: boolean;
  errand?: {
    id: string;
    townId: string;
    errandKind: string;
    title: string;
    rewardPrice: number;
    estMinutes: number;
    status: string;
  };
  errorCode?: string;
  reason?: string;
}> {
  const res = await hubRequest<any>(hubUrl, `/v1/errands/${encodeURIComponent(errandId)}/claim`, {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': idempotencyKey },
    body: {},
    timeoutMs,
  });
  if (!res.ok || !res.data) {
    return {
      ok: false,
      errorCode: res.errorCode,
      reason: res.errorMessage || '没抢到这单同城委托。',
    };
  }
  return { ok: true, errand: res.data };
}

export async function hubCancelErrand(
  hubUrl: string,
  token: string,
  errandId: string,
  timeoutMs = 4000,
): Promise<{ ok: boolean; reason?: string }> {
  const res = await hubRequest(hubUrl, `/v1/errands/${encodeURIComponent(errandId)}/cancel`, {
    method: 'POST',
    token,
    body: {},
    timeoutMs,
  });
  return res.ok ? { ok: true } : { ok: false, reason: res.errorMessage };
}

export async function hubSyncInbox(
  hubUrl: string,
  token: string,
  opts: { sourceExt?: string; afterId?: number; limit?: number; timeoutMs?: number } = {},
): Promise<{ ok: boolean; events: HubInboxEvent[]; nextAfterId: number; reason?: string }> {
  const q = new URLSearchParams({
    source_ext: opts.sourceExt ?? 'life,core',
    after_id: String(Math.max(0, opts.afterId ?? 0)),
    limit: String(opts.limit ?? 50),
  });
  const res = await hubRequest<{ events: HubInboxEvent[]; nextAfterId: number }>(
    hubUrl,
    `/v1/inbox/sync?${q.toString()}`,
    { token, timeoutMs: opts.timeoutMs ?? 4000 },
  );
  if (!res.ok || !res.data) {
    return { ok: false, events: [], nextAfterId: opts.afterId ?? 0, reason: res.errorMessage };
  }
  return {
    ok: true,
    events: Array.isArray(res.data.events) ? res.data.events : [],
    nextAfterId: Number(res.data.nextAfterId ?? opts.afterId ?? 0) || 0,
  };
}

export async function hubAckInbox(
  hubUrl: string,
  token: string,
  eventIds: readonly number[],
  timeoutMs = 4000,
): Promise<{ ok: boolean; ackedCount: number; reason?: string }> {
  if (!eventIds.length) return { ok: true, ackedCount: 0 };
  const res = await hubRequest<{ ackedCount: number }>(hubUrl, '/v1/inbox/ack', {
    method: 'POST',
    token,
    body: { eventIds: eventIds.slice(0, 200) },
    timeoutMs,
  });
  if (!res.ok || !res.data) return { ok: false, ackedCount: 0, reason: res.errorMessage };
  return { ok: true, ackedCount: Number(res.data.ackedCount ?? 0) };
}

export async function hubListRelations(
  hubUrl: string,
  token: string,
  timeoutMs = 4000,
): Promise<{ ok: boolean; relations: HubRelation[]; reason?: string }> {
  const res = await hubRequest<{ relations: HubRelation[] }>(hubUrl, '/v1/social/relations', { token, timeoutMs });
  if (!res.ok || !res.data) return { ok: false, relations: [], reason: res.errorMessage };
  return { ok: true, relations: Array.isArray(res.data.relations) ? res.data.relations : [] };
}

export async function hubSetRelation(
  hubUrl: string,
  token: string,
  targetPetId: string,
  relType: 'acquaintance' | 'friend' | 'blocked',
  aliasNote?: string,
  timeoutMs = 4000,
): Promise<{ ok: boolean; reason?: string }> {
  const res = await hubRequest(hubUrl, `/v1/social/relations/${encodeURIComponent(targetPetId)}`, {
    method: 'PUT',
    token,
    body: { relType, ...(aliasNote !== undefined ? { aliasNote } : {}) },
    timeoutMs,
  });
  return res.ok ? { ok: true } : { ok: false, reason: res.errorMessage };
}

export async function hubOpenDirectConversation(
  hubUrl: string,
  token: string,
  targetPetId: string,
  timeoutMs = 4000,
): Promise<{ ok: boolean; id?: string; reason?: string }> {
  const res = await hubRequest<{ id: string }>(hubUrl, '/v1/social/conversations/direct', {
    method: 'POST',
    token,
    body: { targetPetId },
    timeoutMs,
  });
  if (!res.ok || !res.data) return { ok: false, reason: res.errorMessage };
  return { ok: true, id: res.data.id };
}

export async function hubListConversations(
  hubUrl: string,
  token: string,
  timeoutMs = 4000,
): Promise<{ ok: boolean; conversations: HubConversation[]; reason?: string }> {
  const res = await hubRequest<{ conversations: HubConversation[] }>(hubUrl, '/v1/social/conversations', {
    token,
    timeoutMs,
  });
  if (!res.ok || !res.data) return { ok: false, conversations: [], reason: res.errorMessage };
  return { ok: true, conversations: Array.isArray(res.data.conversations) ? res.data.conversations : [] };
}

export async function hubGetMessages(
  hubUrl: string,
  token: string,
  conversationId: string,
  opts: { afterId?: number; beforeId?: number; limit?: number; timeoutMs?: number } = {},
): Promise<{ ok: boolean; lastReadMsgId: number; messages: HubMessage[]; reason?: string }> {
  const q = new URLSearchParams();
  if (opts.afterId) q.set('after_id', String(opts.afterId));
  if (opts.beforeId) q.set('before_id', String(opts.beforeId));
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();

  const res = await hubRequest<{ lastReadMsgId: number; messages: HubMessage[] }>(
    hubUrl,
    `/v1/social/conversations/${encodeURIComponent(conversationId)}/messages${qs ? `?${qs}` : ''}`,
    { token, timeoutMs: opts.timeoutMs ?? 4000 },
  );
  if (!res.ok || !res.data) return { ok: false, lastReadMsgId: 0, messages: [], reason: res.errorMessage };
  return {
    ok: true,
    lastReadMsgId: Number(res.data.lastReadMsgId ?? 0),
    messages: Array.isArray(res.data.messages) ? res.data.messages : [],
  };
}

export async function hubSendMessage(
  hubUrl: string,
  token: string,
  conversationId: string,
  payload: { body: string; msgType?: 'text' | 'postcard' | 'gift_note'; clientMsgId: string },
  timeoutMs = 4000,
): Promise<{ ok: boolean; message?: HubMessage; reason?: string }> {
  const res = await hubRequest<HubMessage>(
    hubUrl,
    `/v1/social/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: 'POST',
      token,
      body: {
        msgType: payload.msgType ?? 'text',
        body: payload.body,
        meta: {},
        clientMsgId: payload.clientMsgId,
      },
      timeoutMs,
    },
  );
  if (!res.ok || !res.data) return { ok: false, reason: res.errorMessage };
  return { ok: true, message: res.data };
}

export async function hubMarkConversationRead(
  hubUrl: string,
  token: string,
  conversationId: string,
  lastReadMsgId?: number,
  timeoutMs = 4000,
): Promise<{ ok: boolean; lastReadMsgId?: number; reason?: string }> {
  const res = await hubRequest<{ lastReadMsgId: number }>(
    hubUrl,
    `/v1/social/conversations/${encodeURIComponent(conversationId)}/read`,
    {
      method: 'POST',
      token,
      body: lastReadMsgId !== undefined ? { lastReadMsgId } : {},
      timeoutMs,
    },
  );
  if (!res.ok || !res.data) return { ok: false, reason: res.errorMessage };
  return { ok: true, lastReadMsgId: Number(res.data.lastReadMsgId ?? 0) };
}

export async function hubGetMe(
  hubUrl: string,
  token: string,
  timeoutMs = 4000,
): Promise<{
  ok: boolean;
  petId?: string;
  residency?: { townId: string; townName: string; street: string } | null;
  reason?: string;
}> {
  const res = await hubRequest<{
    petId: string;
    residency: { townId: string; townName: string; street: string } | null;
  }>(hubUrl, '/v1/core/pets/me', { token, timeoutMs });
  if (!res.ok || !res.data) return { ok: false, reason: res.errorMessage };
  return {
    ok: true,
    petId: res.data.petId,
    residency: res.data.residency ?? null,
  };
}

export interface HubCompanion {
  petId: string;
  displayName: string;
  avatarTag: string;
  source: string;
  lastAt: string;
}

export async function hubListCompanions(
  hubUrl: string,
  token: string,
  limit = 50,
  timeoutMs = 4000,
): Promise<{ ok: boolean; companions: HubCompanion[]; reason?: string }> {
  const res = await hubRequest<{ companions: HubCompanion[] }>(
    hubUrl,
    `/v1/social/companions?limit=${Math.max(1, Math.min(100, limit))}`,
    { token, timeoutMs },
  );
  if (!res.ok || !res.data) return { ok: false, companions: [], reason: res.errorMessage };
  return { ok: true, companions: Array.isArray(res.data.companions) ? res.data.companions : [] };
}
