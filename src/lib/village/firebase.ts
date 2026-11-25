// 마을 서버의 Firebase 연결과 HTTP 계약. 자격 증명은 서버 환경변수에만 있고 절대 기록하지 않는다.
// 운영에서는 배포된 Firestore 규칙이 저장소의 규칙 파일(village_* 컬렉션을 클라이언트에 열지 않는 규칙)과
// 같을 때만 동작한다 — 확인할 수 없으면 503으로 닫힌다(fail closed).
import { readFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { assertCharacterRulesReady } from '@/lib/characterLockRules';
import { resolveCharacterDatabase } from '@/lib/characterLockConfig';
import {
  VillageError, act, changePassword, createRoom, deleteRoom, joinRoom, listRooms, myControls, roomState, type Ctx,
} from './server';

const APP = 'ohome-village';
const emulator = () => process.env.NODE_ENV !== 'production' && process.env.VILLAGE_EMULATOR === '1' && !!process.env.FIRESTORE_EMULATOR_HOST && !process.env.VERCEL;
let testKey: Buffer | null = null;

function app(): { app: App; key: Buffer } {
  // Admin SDK는 이 변수가 있으면 서명 없는 Auth 토큰을 허용한다.
  if (!emulator() && (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST)) {
    throw new VillageError('마을 서버의 에뮬레이터 설정이 올바르지 않습니다', 503);
  }
  const existing = getApps().find(a => a.name === APP);
  if (emulator()) {
    testKey ??= randomBytes(32);
    return { app: existing ?? initializeApp({ projectId: process.env.VILLAGE_EMULATOR_PROJECT || 'demo-ohome' }, APP), key: testKey };
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new VillageError('마을 서버가 아직 설정되지 않았습니다', 503);
  const service = JSON.parse(raw) as ServiceAccount & { project_id?: string; private_key?: string };
  if (!service.project_id || !service.private_key) throw new VillageError('마을 서버가 아직 설정되지 않았습니다', 503);
  // 방 세션 서명 키 — 별도 비밀이 있으면 그것을, 없으면 서비스 계정 비공개 키에서 파생한다
  const secret = process.env.VILLAGE_SESSION_SECRET || service.private_key;
  const key = createHmac('sha256', 'ohome-village-session-v1').update(secret).digest();
  return { app: existing ?? initializeApp({ credential: cert(service), projectId: service.project_id }, APP), key };
}

type PublicConfig = { kind?: string; projectId?: string; databaseId?: string } | null;
function publicConfig(): PublicConfig {
  try {
    const c = JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'ohome.config.json'), 'utf8'));
    return c && typeof c === 'object' ? c : null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new VillageError('공개 설정을 읽지 못했습니다', 503);
  }
}

let rulesOkUntil = 0;
async function context(): Promise<Ctx> {
  const { app: a, key } = app();
  if (emulator()) return { db: getFirestore(a), key };
  const config = publicConfig();
  if (config && config.kind && config.kind !== 'firebase') throw new VillageError('마을은 Firebase 연결에서만 지원합니다', 503);
  const projectId = config?.projectId ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId || a.options.projectId !== projectId) throw new VillageError('마을 서버 설정이 맞지 않습니다', 503);
  let databaseId: string | undefined;
  try { databaseId = resolveCharacterDatabase(process.env, config); } catch { throw new VillageError('마을 서버 설정이 맞지 않습니다', 503); }
  if (Date.now() > rulesOkUntil) {
    // 배포된 규칙이 저장소 규칙 파일 중 하나와 정확히 같아야 한다(둘 다 village_* 직접 접근을 막는다)
    const token = await a.options.credential?.getAccessToken().catch(() => null);
    let ok = false;
    for (const file of ['firestore.production.rules', 'firestore.rules']) {
      if (ok || !token?.access_token) break;
      try {
        const expectedRules = readFileSync(path.join(process.cwd(), 'firebase', file), 'utf8');
        await assertCharacterRulesReady({ projectId, databaseId: databaseId || '(default)', token: token.access_token, expectedRules, fetcher: fetch });
        ok = true;
      } catch { /* 다음 파일 확인 */ }
    }
    if (!ok) throw new VillageError('보안 규칙을 확인할 수 없어 마을을 잠시 닫았습니다', 503);
    rulesOkUntil = Date.now() + 10 * 60 * 1000;
  }
  return { db: databaseId ? getFirestore(a, databaseId) : getFirestore(a), key };
}
/* 요청 속도 제한(서버 인스턴스 메모리) — DB 읽기 증폭과 비밀번호 해시(scrypt) CPU 증폭을 줄인다.
 * 로그인 사용자는 uid, 아니면 플랫폼이 넣어 주는 접속 주소(Vercel에서만 신뢰)로 센다. */
const READ_LIMIT: Record<string, number> = { list: 30, state: 90, controls: 30, join: 20, health: 30, create: 15, password: 15, delete: 15, act: 300 };
const hits = new Map<string, { since: number; n: number }>();
function readLimited(op: string, uid: string | null, req: Request): boolean {
  const max = READ_LIMIT[op];
  if (!max) return false;
  const ip = process.env.VERCEL ? (req.headers.get('x-vercel-forwarded-for') ?? req.headers.get('x-real-ip') ?? '').split(',')[0].trim() : '';
  const key = `${op}|${uid ?? `ip:${ip || 'local'}`}`;
  const t = Date.now();
  const h = hits.get(key);
  if (!h || t - h.since > 60_000) {
    if (hits.size > 5000) hits.clear();
    hits.set(key, { since: t, n: 1 });
    return false;
  }
  h.n++;
  return h.n > max;
}

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { 'cache-control': 'no-store, private', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' },
});
async function body(req: Request): Promise<Record<string, unknown> | null> {
  try {
    if (Number(req.headers.get('content-length') ?? 0) > 32_768) return null;
    if (!req.body) return null;
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 32_768) { void reader.cancel().catch(() => {}); return null; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const o = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch { return null; }
}

export async function handleVillage(req: Request): Promise<Response> {
  const b = await body(req);
  if (!b || typeof b.op !== 'string') return json({ error: '잘못된 요청입니다' }, 400);
  try {
    const c = await context();
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
    let uid: string | null = null;
    if (bearer) {
      try { uid = (await getAuth(app().app).verifyIdToken(bearer, true)).uid; }
      catch { return json({ error: '로그인 정보가 만료되었습니다 — 다시 로그인해 주세요' }, 401); }
    }
    if (readLimited(b.op, uid, req)) return json({ error: '요청이 너무 잦습니다 — 잠시 뒤 다시 시도해 주세요' }, 429);
    const need = () => { if (!uid) throw new VillageError('로그인이 필요합니다', 401); return uid; };
    switch (b.op) {
      case 'health': return json({ ok: true });
      case 'list': return json({ rooms: await listRooms(c, uid) });
      case 'create': return json(await createRoom(c, need(), b.room));
      case 'delete': await deleteRoom(c, need(), b.roomId); return json({ ok: true });
      case 'join': return json(await joinRoom(c, b.roomId, b.password, need()));
      case 'state': return json(await roomState(c, b.roomId, b.token, uid, b.since, b.econ));
      case 'controls': return json({ actors: await myControls(c, b.roomId, b.token, uid) });
      case 'act': return json(await act(c, b.roomId, b.token, uid, b.action));
      case 'password': return json(await changePassword(c, need(), b.roomId, b.password));
      default: return json({ error: '잘못된 요청입니다' }, 400);
    }
  } catch (e) {
    if (e instanceof VillageError) return json({ error: e.message }, e.status);
    // 같은 데이터에 동시에 몰린 트랜잭션이 재시도 끝에 실패한 경우 — 아무것도 기록되지 않았다
    const code = (e as { code?: unknown })?.code;
    if (code === 10 || code === 'aborted' || code === 'ABORTED' || /Transaction is invalid or closed/.test(String((e as Error)?.message))) return json({ error: '요청이 몰렸습니다 — 잠시 뒤 다시 시도해 주세요' }, 409);
    console.error('[village] 처리 실패', (e as Error)?.name, (e as { code?: unknown })?.code, String((e as Error)?.message).slice(0, 160));
    return json({ error: '서버에서 처리하지 못했습니다' }, 500);
  }
}
