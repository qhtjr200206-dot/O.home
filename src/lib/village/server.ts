// 마을 서버 로직 — Admin SDK(Firestore)로만 저장소에 닿는다. 클라이언트 SDK는 보안 규칙상
// village_* 컬렉션에 아무 권한이 없다(isContent 목록에 없음 → 기본 거부).
// 이 파일은 Firestore 인스턴스와 서명 키를 주입받으므로 에뮬레이터에서 그대로 공격 시험을 돌릴 수 있다.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  FieldValue, type DocumentData, type DocumentReference, type DocumentSnapshot, type Firestore, type Transaction,
} from 'firebase-admin/firestore';
import { generateVillageMap, terrainFlags, walkable, type VillageMap } from './map';
import { hashRoomPassword, verifyRoomPassword } from './password';
import { CATCH, MEMORY, catchReplay, memoryDeck, memoryScore } from './games';
import { simulate, type WakeMark } from './sim';
import {
  GIFTS, LIMITS, MINIGAMES, cleanText, parseCreateRoom, passwordProblem, validDocId, validRoomId,
  type ActorOverride, type RoomActor, type RoomEvent, type RoomSummary, type RoomView,
} from './types';
import type { PixelAvatarData } from '@/components/chars/PixelAvatar';

export class VillageError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const fail = (message: string, status: number): never => { throw new VillageError(message, status); };

export const ROOMS = 'village_rooms';
export const SLOTS = 'village_owner_slots';
export const TRIES = 'village_join_tries';
const CLEANUP = 'village_cleanup';
const SESSION_MS = 12 * 3600 * 1000;
const TRY_WINDOW = 15 * 60 * 1000;
/** 계정당 15분 동안 틀릴 수 있는 횟수(평상시) */
const MAX_USER_FAILS = 8;
/** 방 전체 실패가 이만큼 쌓이면 '보호 모드' — 정답 입장은 절대 막지 않고, 계정당 허용 오답 수만 줄인다 */
const ROOM_GUARD_FAILS = 24;
const GUARDED_USER_FAILS = 3;
const GAME_TTL = 15 * 60 * 1000;
const RATE: Record<'move' | 'talk' | 'game', { window: number; max: number }> = {
  move: { window: 60_000, max: 90 },
  talk: { window: 60_000, max: 12 },
  game: { window: 60_000, max: 20 },
};

type Row = Record<string, unknown>;
const rec = (x: unknown): x is Row => !!x && typeof x === 'object' && !Array.isArray(x);
export interface Ctx {
  db: Firestore;
  key: Buffer;
  now?: () => number;
}
const now = (c: Ctx) => (c.now ? c.now() : Date.now());
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/* ---------------- 권한 원본: 기존 O.home 규칙과 같은 판정 ---------------- */
async function isAdmin(db: Firestore, uid: string | null, tx?: Transaction): Promise<boolean> {
  if (!uid) return false;
  const ref = db.collection('meta').doc('owner');
  const snap = tx ? await tx.get(ref) : await ref.get();
  const o = snap.data();
  return !!snap.exists && !!o && (o.uid === uid || (Array.isArray(o.admins) && o.admins.includes(uid)));
}
/** 콘텐츠 문서 열람 가능 여부 — firestore 규칙의 read와 같은 기준 */
function readable(doc: DocumentData | undefined, uid: string | null, admin: boolean) {
  if (!doc) return false;
  return doc.visibility === 'public' || (doc.visibility === 'member' && !!uid) || (!!uid && doc.authorId === uid) || admin;
}

/* ---------------- 방 캐릭터 = 원본 캐릭터 문서와 계속 연결 ----------------
 * 방을 만들 때 캐릭터 문서의 생성 시각(createTime, 서버가 정하고 위조 불가)을 기록한다. 이후 모든 표시·조작은
 * 지금 문서가 '같은 문서'(생성 시각 일치)이고 방 주인이 여전히 볼 수 있을 때만 인정한다.
 * → 삭제된 id를 다른 사람이 다시 만들어도 사칭할 수 없고, 비공개로 바뀐 캐릭터는 방에서 사라진다.
 * 같은 문서 안의 작성자·권한 변경(사이트 규칙상 작성자 본인·관리자만 가능)은 사이트와 똑같이 즉시 따른다. */
const createKey = (snap: DocumentSnapshot) => (snap.createTime ? `${snap.createTime.seconds}:${snap.createTime.nanoseconds}` : '');
function identityMatches(room: DocumentData, actorId: string, snap: DocumentSnapshot): boolean {
  const doc = snap.data();
  const identity = Array.isArray(room.identities) ? room.identities.find((v: unknown) => rec(v) && v.id === actorId) : undefined;
  return !!snap.exists && !!doc && rec(doc.data) && rec(identity) && typeof doc.authorId === 'string' && !!doc.authorId &&
    !!snap.createTime && identity.created === createKey(snap);
}
/** 방에 보일 수 있는 캐릭터: 전체·멤버 공개만. 방은 여럿이 함께 보는 공간이라 '나만보기' 캐릭터는
 *  방 주인·관리자의 것이라도 넣을 수 없고, 나중에 비공개로 바뀌면 모든 방에서 바로 숨긴다(데이터 격리). */
function placeable(doc: DocumentData | undefined): boolean {
  return !!doc && (doc.visibility === 'public' || doc.visibility === 'member');
}
function charLive(room: DocumentData, actorId: string, snap: DocumentSnapshot): boolean {
  return identityMatches(room, actorId, snap) && placeable(snap.data());
}
/** 방 주인이 방을 만들 때 '이 방에서 조작해도 된다'고 고른 권한 회원(uid) 목록 */
function allowedControllers(room: DocumentData, actorId: string): string[] {
  const identity = Array.isArray(room.identities) ? room.identities.find((v: unknown) => rec(v) && v.id === actorId) : undefined;
  return rec(identity) && Array.isArray(identity.allow) ? identity.allow.filter((u: unknown): u is string => typeof u === 'string') : [];
}
const grantHolders = (grants: unknown): string[] => (Array.isArray(grants) ? grants : [])
  .filter(g => rec(g) && typeof g.userId === 'string' && (g.level === 'play' || g.level === 'edit')).map(g => (g as Row).userId as string);
function safeAvatar(v: unknown): PixelAvatarData | null {
  if (!rec(v)) return null;
  const n = (x: unknown) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) < 64 ? x as number : 0);
  const col = (x: unknown) => (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x) ? x : undefined);
  // 앞머리·뒷머리(back 0..39, front 0..15)도 그대로 넘긴다 — 빼면 마을에서만 머리 모양이 기본값으로 돌아간다
  // (v2.0 사용자 요청 — 도트 머리 파츠 분리). 값이 없거나 범위 밖이면 넣지 않아 기존 hair 그림을 쓴다.
  const opt = (x: unknown, max: number) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) < max ? x as number : undefined);
  const back = opt(v.back, 40), front = opt(v.front, 16);
  return {
    hair: n(v.hair), face: n(v.face), body: n(v.body),
    hairColor: col(v.hairColor) ?? '#554050', skinColor: col(v.skinColor) ?? '#edbd9f', bodyColor: col(v.bodyColor) ?? '#647a9a',
    ...(col(v.eyeColor) ? { eyeColor: col(v.eyeColor) } : {}),
    ...(back !== undefined ? { back } : {}),
    ...(front !== undefined ? { front } : {}),
  } as PixelAvatarData;
}
/** 캐릭터 문서의 지금 이름·색·도트(잠긴 캐릭터는 도트 비공개) */
function charLook(doc: DocumentData) {
  const d: Row = rec(doc.data) ? doc.data : {};
  return {
    name: String(d.name ?? '이름 없음').slice(0, LIMITS.name),
    color: typeof d.color === 'string' && /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : '#8a7f99',
    avatar: d.locked === true ? null : safeAvatar(d.pixelAvatar),
  };
}

const liveCache = new Map<string, { at: number; actors: RoomActor[] }>();
/** 방에 보여 줄 배우 목록 — 캐릭터는 원본 문서의 최신 외형으로, 끊긴 캐릭터는 뺀다(짧게 캐시) */
async function liveActors(c: Ctx, room: DocumentData): Promise<RoomActor[]> {
  const all = (room.actors as RoomActor[] | undefined) ?? [];
  const key = `${room.instance}`;
  const hit = liveCache.get(key);
  if (hit && now(c) - hit.at >= 0 && now(c) - hit.at < 4000) return hit.actors;
  const chars = all.filter(a => a.kind === 'char' && validDocId(a.id));
  const snaps = chars.length ? await c.db.getAll(...chars.map(a => c.db.collection('characters').doc(a.id))) : [];
  const byId = new Map(snaps.map(s => [s.id, s]));
  const out: RoomActor[] = [];
  for (const a of all) {
    if (a.kind === 'npc') { out.push(a); continue; }
    const snap = byId.get(a.id);
    if (!snap || !charLive(room, a.id, snap)) continue;
    out.push({ ...a, ...charLook(snap.data()!) });
  }
  if (liveCache.size > 500) liveCache.clear();
  liveCache.set(key, { at: now(c), actors: out });
  return out;
}

/* ---------------- 방 세션 토큰(HMAC) ---------------- */
interface Session { r: string; i: string; v: number; u: string; e: number }
const b64 = (b: Buffer) => b.toString('base64url');
export function signSession(key: Buffer, s: Session): string {
  const body = b64(Buffer.from(JSON.stringify(s)));
  return `${body}.${b64(createHmac('sha256', key).update(body).digest())}`;
}
export function readSession(key: Buffer, token: unknown): Session | null {
  if (typeof token !== 'string' || token.length > 1000) return null;
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined) return null;
  const want = createHmac('sha256', key).update(body).digest();
  let got: Buffer;
  try { got = Buffer.from(mac, 'base64url'); } catch { return null; }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Session;
    if (!validRoomId(s.r) || typeof s.i !== 'string' || !Number.isSafeInteger(s.v) || typeof s.u !== 'string' || !Number.isSafeInteger(s.e)) return null;
    return s;
  } catch { return null; }
}

/** 토큰 서명·만료·방 인스턴스·비밀번호 버전·로그인 사용자 일치를 모두 확인하고 최신 방 문서를 돌려준다 */
async function authorize(c: Ctx, roomId: unknown, token: unknown, uid: string | null, tx?: Transaction) {
  if (!validRoomId(roomId)) fail('잘못된 방입니다', 400);
  const s = readSession(c.key, token);
  if (!s || s.r !== roomId || s.e <= now(c)) fail('방에 다시 들어와 주세요', 401);
  // 방 세션은 로그인한 계정에만 발급된다. 익명(u='') 토큰이나 다른 계정의 토큰은 받지 않는다.
  if (!s!.u || !uid || s!.u !== uid) fail('방에 다시 들어와 주세요', 401);
  const ref = c.db.collection(ROOMS).doc(roomId as string);
  const snap = tx ? await tx.get(ref) : await ref.get();
  const room = snap.data();
  if (!snap.exists || !room || room.status !== 'active' || room.instance !== s!.i || room.passwordVersion !== s!.v) fail('방이 없거나 비밀번호가 바뀌었습니다', 401);
  return { ref, room: room!, session: s! };
}

function view(id: string, room: DocumentData, uid: string | null, actors: RoomActor[]): RoomView {
  // 방 주인의 uid는 내려보내지 않는다 — 지금 사용자가 주인인지만 알려 준다
  return {
    id, instance: room.instance, name: room.name, era: room.era, worldview: room.worldview ?? '', seed: room.seed,
    places: room.places ?? [], actors, isOwner: !!uid && room.ownerUid === uid, createdAt: room.createdAt,
  };
}
const mapCache = new Map<string, VillageMap>();
function mapOf(room: DocumentData): VillageMap {
  const k = `${room.instance}`;
  let m = mapCache.get(k);
  if (!m) {
    m = generateVillageMap(room.seed, room.era, room.places ?? []);
    if (mapCache.size > 200) mapCache.clear();
    mapCache.set(k, m);
  }
  return m;
}

/* ---------------- 목록 ---------------- */
export async function listRooms(c: Ctx, uid: string | null): Promise<RoomSummary[]> {
  const snap = await c.db.collection(ROOMS).orderBy('createdAt', 'desc').limit(200).get();
  return snap.docs.filter(d => d.data().status === 'active').map(d => {
    const r = d.data();
    return { id: d.id, name: String(r.name ?? ''), era: r.era, createdAt: Number(r.createdAt) || 0, mine: !!uid && r.ownerUid === uid };
  });
}

/* ---------------- 생성: 가입자 동시 1개, 관리자 무제한 — 사용자 슬롯 문서로 직렬화 ---------------- */
const NPC_COLORS = ['#7a8b99', '#9a7b6a', '#6f8f72', '#8d7aa3', '#a58a5a', '#5f8c95', '#a06f7d', '#6c7a9e'];

export async function createRoom(c: Ctx, uid: string, raw: unknown): Promise<{ roomId: string; token: string }> {
  if (!uid) fail('로그인이 필요합니다', 401);
  let input: ReturnType<typeof parseCreateRoom>;
  try { input = parseCreateRoom(raw); } catch (e) { return fail((e as Error).message, 400); }
  if (input!.chars.some(ch => ch.id.startsWith('npc:'))) fail('예약된 캐릭터 id입니다', 400);
  // 비싼 비밀번호 해시 전에 가볍게 한도를 확인한다(최종 판정은 아래 트랜잭션)
  if (!(await isAdmin(c.db, uid)) && !(await c.db.collection(ROOMS).where('ownerUid', '==', uid).limit(1).get()).empty) {
    fail('이미 만든 방이 있습니다 — 그 방을 삭제하면 다시 만들 수 있어요', 409);
  }
  const pwHash = await hashRoomPassword(input!.password);
  const roomId = randomBytes(15).toString('base64').replace(/[^A-Za-z0-9]/g, '').padEnd(20, 'x').slice(0, 20);
  const instance = randomBytes(16).toString('hex');
  const flags = terrainFlags(input!.worldview);
  const seed = createHash('sha256').update(`${input!.worldview}|${input!.name}|${randomBytes(8).toString('hex')}`).digest('hex').slice(0, 16) + (flags ? `~${flags}` : '');
  const t = now(c);
  const slotRef = c.db.collection(SLOTS).doc(uid);
  const roomRef = c.db.collection(ROOMS).doc(roomId);
  await c.db.runTransaction(async tx => {
    // 관리자 판정·자관·캐릭터 권한·보유 방 수를 모두 같은 트랜잭션에서 읽는다. 그 사이 캐릭터가 비공개로
    // 바뀌거나 관리자에서 내려가면 트랜잭션이 충돌해 다시 판정된다. 슬롯 문서를 항상 써서 같은 사용자의
    // 동시 생성·삭제도 직렬화된다.
    const adminNow = await isAdmin(c.db, uid, tx);
    // 자관에 적힌 캐릭터 대사(멤버 quote) — 남의 캐릭터에는 이 원문 대사만 넣을 수 있다
    const relQuotes = new Map<string, string>();
    if (input!.relId) {
      const rel = await tx.get(c.db.collection('relations').doc(input!.relId));
      if (!rel.exists || !readable(rel.data(), uid, adminNow)) fail('고를 수 없는 자관입니다', 403);
      const members = rec(rel.data()?.data) && Array.isArray(rel.data()!.data.members) ? rel.data()!.data.members : [];
      for (const m of members) if (rec(m) && typeof m.charId === 'string' && typeof m.quote === 'string') relQuotes.set(m.charId, m.quote.trim());
    }
    const snaps = await Promise.all(input!.chars.map(ch => tx.get(c.db.collection('characters').doc(ch.id))));
    const actors: RoomActor[] = [];
    const identities: { id: string; authorId: string; created: string; allow: string[] }[] = [];
    input!.chars.forEach((ch, i) => {
      const snap = snaps[i];
      const doc = snap.data();
      // 전체·멤버 공개 캐릭터만 — 비공개 캐릭터를 방에 복제해 남에게 보여 주지 못한다(관리자·작성자도 같음)
      if (snap.exists && doc && !placeable(doc) && rec(doc.data) && (doc.authorId === uid || adminNow)) fail('나만보기 캐릭터는 마을에 넣을 수 없습니다 — 공개 범위를 바꿔 주세요', 403);
      if (!snap.exists || !placeable(doc) || !rec(doc?.data)) fail('고를 수 없는 캐릭터가 있습니다', 403);
      if (typeof doc!.authorId !== 'string' || !doc!.authorId || !snap.createTime) fail('캐릭터 원본을 확인할 수 없습니다', 403);
      // 권한 회원의 조작은 방 주인이 이 방에서 허락한 사람만(지금 권한이 있는 사람 중에서).
      // 캐릭터 문서의 작성자 표시는 사이트 규칙상 위조될 수 있으므로, 남이 몰래 심은 권한이 방 주인 모르게 생기지 않게 한다.
      const holders = new Set(grantHolders((doc!.data as Row).grants));
      identities.push({ id: ch.id, authorId: doc!.authorId, created: createKey(snap), allow: ch.allow.filter(u => holders.has(u)) });
      // 대사를 지어 넣을 수 있는 것은 작성자·편집 권한자·관리자뿐. 그 밖에는 자관에 적힌 그 캐릭터의 원문 대사만 남긴다(사칭 방지)
      const d = doc!.data as Row;
      const canScript = adminNow || doc!.authorId === uid || (d.locked !== true && Array.isArray(d.grants) &&
        d.grants.some(g => rec(g) && g.userId === uid && g.level === 'edit'));
      const lines = canScript ? ch.lines : ch.lines.filter(l => !!relQuotes.get(ch.id) && l === relQuotes.get(ch.id));
      actors.push({ id: ch.id, kind: 'char', ...charLook(doc!), personality: ch.personality, home: ch.home, lines });
    });
    input!.npcs.forEach((n, i) => actors.push({
      id: `npc:${i}`, kind: 'npc', name: n.name, role: n.role, color: NPC_COLORS[i % NPC_COLORS.length],
      avatar: null, personality: n.personality, home: n.home, lines: n.lines,
    }));
    const slot = await tx.get(slotRef);
    const owned = await tx.get(c.db.collection(ROOMS).where('ownerUid', '==', uid).limit(adminNow ? 1 : 5));
    if (!adminNow && owned.size >= 1) fail('이미 만든 방이 있습니다 — 그 방을 삭제하면 다시 만들 수 있어요', 409);
    tx.set(slotRef, { uid, rooms: (Number(slot.data()?.rooms) || 0) + 1, updatedAt: t });
    tx.create(roomRef, {
      name: input!.name, era: input!.era, worldview: input!.worldview, relId: input!.relId || null,
      places: input!.places, actors, identities, seed, instance, ownerUid: uid, status: 'active', passwordVersion: 1, pwHash,
      createdAt: t, updatedAt: t,
    });
  });
  return { roomId, token: signSession(c.key, { r: roomId, i: instance, v: 1, u: uid, e: t + SESSION_MS }) };
}

/* ---------------- 삭제: 방 문서 삭제와 슬롯 해제를 한 트랜잭션에 ---------------- */
export async function deleteRoom(c: Ctx, uid: string, roomId: unknown): Promise<void> {
  if (!uid) fail('로그인이 필요합니다', 401);
  if (!validRoomId(roomId)) fail('잘못된 방입니다', 400);
  const roomRef = c.db.collection(ROOMS).doc(roomId as string);
  const cleanupRef = c.db.collection(CLEANUP).doc(roomId as string);
  await c.db.runTransaction(async tx => {
    const adminNow = await isAdmin(c.db, uid, tx);
    const snap = await tx.get(roomRef);
    const room = snap.data();
    if (!snap.exists || !room) {
      const pending = (await tx.get(cleanupRef)).data();
      if (!pending) fail('방을 찾을 수 없습니다', 404);
      if (pending!.ownerUid !== uid && !adminNow) fail('방을 만든 사람이나 관리자만 삭제할 수 있습니다', 403);
      return;
    }
    if (room!.ownerUid !== uid && !adminNow) fail('방을 만든 사람이나 관리자만 삭제할 수 있습니다', 403);
    const slotRef = c.db.collection(SLOTS).doc(String(room!.ownerUid));
    const slot = await tx.get(slotRef);
    tx.set(slotRef, { uid: room!.ownerUid, rooms: Math.max(0, (Number(slot.data()?.rooms) || 0) - 1), updatedAt: now(c) });
    // 방 문서가 사라지는 순간 모든 세션 토큰이 무효가 된다(authorize가 매번 방 문서를 읽는다).
    tx.set(cleanupRef, { ownerUid: room!.ownerUid, createdAt: now(c) });
    tx.delete(roomRef);
  });
  liveCache.clear();
  // 실패 시 대기 문서를 남기고 503을 반환한다. 동일 방 삭제 요청으로 안전하게 재시도 가능.
  try {
    await c.db.recursiveDelete(roomRef);
    for (;;) {
      const batch = await c.db.collection(TRIES).where('room', '==', roomId).limit(400).get();
      if (batch.empty) break;
      const writer = c.db.batch();
      batch.docs.forEach(doc => writer.delete(doc.ref));
      await writer.commit();
    }
    await cleanupRef.delete();
  } catch {
    fail('방은 닫혔지만 정리가 남았습니다 — 삭제를 다시 요청해 주세요', 503);
  }
}

/* ---------------- 입장: 비밀번호 + 원자적 시도 제한 ----------------
 * - 로그인 필수. 시도 횟수는 '계정+방' 단위로 센다(요청 헤더의 IP는 믿지 않는다).
 * - 방 전체 실패 수는 정답 입장을 막는 데 쓰지 않는다(누구나 방을 잠그는 DoS 방지). 계정 나이 등으로 정답을 거절하지도 않는다.
 *   대신 많이 쌓이면 보호 모드: 계정당 허용 오답 수를 8회에서 3회로 줄인다.
 * - 방 주인과 관리자는 시도 제한을 받지 않는다(남이 주인을 쫓아낼 수 없다). */
export async function joinRoom(c: Ctx, roomId: unknown, password: unknown, uid: string | null):
  Promise<{ token: string; room: RoomView }> {
  if (!uid) fail('로그인이 필요합니다', 401);
  if (!validRoomId(roomId)) fail('잘못된 방입니다', 400);
  if (typeof password !== 'string' || !password || password.length > LIMITS.passwordMax) fail('비밀번호를 입력해 주세요', 400);
  const id = roomId as string;
  const roomRef = c.db.collection(ROOMS).doc(id);
  const userRef = c.db.collection(TRIES).doc(sha(`u|${uid}|${id}`));
  const roomTryRef = c.db.collection(TRIES).doc(sha(`r|${id}`));
  const t = now(c);
  const live = (d: DocumentData | undefined) => (d && typeof d.since === 'number' && t - d.since < TRY_WINDOW ? d : null);
  const admin = await isAdmin(c.db, uid);
  const roomFails = Number(live((await roomTryRef.get()).data())?.fails) || 0;
  const guarded = roomFails >= ROOM_GUARD_FAILS;
  // 1) 시도 예약: 비밀번호를 검사하기 '전에' 시도 횟수를 커밋한다. 병렬 요청이 트랜잭션 경합으로
  //    실패하면 검사 자체를 하지 않으므로, 기록되지 않은 공짜 시도가 생기지 않는다(fail closed).
  const room = await c.db.runTransaction(async tx => {
    const snap = await tx.get(roomRef);
    const mine = await tx.get(userRef);
    const r = snap.data();
    if (!snap.exists || !r || r.status !== 'active') fail('방을 찾을 수 없습니다', 404);
    const exempt = admin || r!.ownerUid === uid;
    const d = live(mine.data());
    const fails = Number(d?.fails) || 0;
    if (!exempt && fails >= (guarded ? GUARDED_USER_FAILS : MAX_USER_FAILS)) fail('비밀번호를 너무 많이 틀렸습니다 — 15분 뒤 다시 시도해 주세요', 429);
    tx.set(userRef, { since: d ? d.since : t, fails: fails + 1, room: id, expireAt: new Date((d ? d.since : t) + TRY_WINDOW) });
    return { ...r!, exempt } as DocumentData & { exempt: boolean };
  });
  // 2) 검사. 틀리면 예약한 시도가 그대로 실패 기록으로 남고, 방 전체 실패 수도 올라간다(주인·관리자의 오타는 제외).
  if (!(await verifyRoomPassword(password, room.pwHash))) {
    if (!room.exempt) await bumpRoomFails(roomTryRef, id, t).catch(() => undefined);
    fail('비밀번호가 올바르지 않습니다', 401);
  }
  // 3) 맞으면 예약한 1회를 돌려준다(정상 사용자가 여러 탭을 열어도 잠기지 않게). 자기 예약만 되돌린다.
  await c.db.runTransaction(async tx => {
    const d = (await tx.get(userRef)).data();
    if (d && typeof d.fails === 'number' && d.fails > 0) tx.update(userRef, { fails: d.fails - 1 });
  }).catch(() => undefined);
  // 검증 중 방이 삭제되거나 비밀번호가 바뀌었을 수 있다. 최신 상태를 다시 확인한 뒤에만 내용을 반환한다.
  const token = signSession(c.key, { r: id, i: room.instance, v: room.passwordVersion, u: uid!, e: t + SESSION_MS });
  const current = await authorize(c, id, token, uid);
  return { token, room: view(id, current.room, uid, await liveActors(c, current.room)) };
}
/** 방 전체 실패 수 — 경합 없는 증가(정상 입장 경로는 이 문서를 쓰지 않는다) */
async function bumpRoomFails(ref: DocumentReference, roomId: string, t: number) {
  const d = (await ref.get()).data();
  if (d && typeof d.since === 'number' && t - d.since < TRY_WINDOW) await ref.update({ fails: FieldValue.increment(1) });
  else await ref.set({ since: t, fails: 1, room: roomId, expireAt: new Date(t + TRY_WINDOW) });
}

/* ---------------- 상태 조회(폴링) ---------------- */
export async function roomState(c: Ctx, roomId: unknown, token: unknown, uid: string | null, since: unknown) {
  const { ref, room } = await authorize(c, roomId, token, uid);
  const after = typeof since === 'number' && Number.isFinite(since) && since > 0 ? since : 0;
  const [pos, ev, scores, actors, wakeDocs] = await Promise.all([
    ref.collection('pos').get(),
    after ? ref.collection('events').where('at', '>', after).orderBy('at').limit(60).get()
      : ref.collection('events').orderBy('at', 'desc').limit(60).get(),
    ref.collection('scores').get(),
    liveActors(c, room),
    ref.collection('wake').get(),
  ]);
  const ids = new Set(actors.map(a => a.id));
  const events = ev.docs.map(d => ({ id: d.id, ...d.data() }) as RoomEvent & { actorUid?: string });
  if (!after) events.reverse();
  return {
    room: view(ref.id, room, uid, actors),
    overrides: pos.docs.filter(d => ids.has(d.id)).map(d => ({ id: d.id, x: d.data().x, y: d.data().y, at: d.data().at, by: '' }) as ActorOverride),
    events: events.map(({ actorUid: _u, ...e }) => { void _u; return e; }),
    scores: scores.docs.filter(d => ids.has(d.data().actor)).map(d => ({ actor: d.data().actor, game: d.data().game, best: d.data().best })),
    wakes: wakeMarks(wakeDocs.docs, ids),
    serverTime: now(c),
  };
}

/** 깨우기 문서(wake/{배우 id}) → 시뮬레이션이 쓰는 표시. 방에 없는 배우·이상한 값은 버린다 */
function wakeMarks(docs: { id: string; data: () => DocumentData }[], ids: Set<string>): WakeMark[] {
  return docs.filter(d => ids.has(d.id) && Number.isFinite(d.data().at)).map(d => ({ id: d.id, at: Number(d.data().at) }));
}

/* ---------------- 캐릭터 조작 권한 — 매 명령 신선하게 재조회 ---------------- */
async function controllable(c: Ctx, uid: string, room: DocumentData, actorId: string, admin: boolean, tx?: Transaction): Promise<boolean> {
  const actor = (room.actors as RoomActor[] | undefined)?.find(a => a.id === actorId);
  if (!actor) return false;
  if (actor.kind === 'npc') return admin || room.ownerUid === uid;          // NPC는 방 주인이 움직인다
  if (!validDocId(actor.id)) return false;
  const charRef = c.db.collection('characters').doc(actor.id);
  const snap = tx ? await tx.get(charRef) : await charRef.get();
  // 원본과 다른 문서(삭제 후 재생성·작성자 변경)이거나 방에서 숨겨진 캐릭터는 관리자도 조작할 수 없다
  if (!charLive(room, actor.id, snap)) return false;
  if (admin) return true;
  const doc = snap.data()!;
  if (doc.authorId === uid) return true;
  // 잠긴 캐릭터의 권한은 관리자만 쓰는 char_secrets에 있다(규칙상 위조 불가) — 그대로 따른다.
  // 그 밖의 권한은 문서에 있는 grants 중 방 주인이 방을 만들 때 허락한 회원만 인정한다.
  if (rec(doc.data) && doc.data.locked === true) {
    const secRef = c.db.collection('char_secrets').doc(actor.id);
    const sec = (tx ? await tx.get(secRef) : await secRef.get()).data();
    return grantHolders(rec(sec?.data) && rec(sec.data.character) ? sec.data.character.grants : undefined).includes(uid);
  }
  return allowedControllers(room, actor.id).includes(uid) && grantHolders(rec(doc.data) ? doc.data.grants : undefined).includes(uid);
}
export async function myControls(c: Ctx, roomId: unknown, token: unknown, uid: string | null): Promise<string[]> {
  const { room } = await authorize(c, roomId, token, uid);
  if (!uid) return [];
  const admin = await isAdmin(c.db, uid);
  const out: string[] = [];
  for (const a of (room.actors as RoomActor[]) ?? []) if (await controllable(c, uid, room, a.id, admin)) out.push(a.id);
  return out;
}

/* ---------------- 행동: 이동·선물·메시지·미니게임·조작 해제 ---------------- */
export type ActResult = {
  ok: true; gameId?: string; seed?: string; score?: number;
  /** 짝 맞추기: 방금 뒤집은 카드 그림, 짝이 맞았는지, 판이 끝났는지 */
  icon?: string; match?: boolean; done?: boolean;
};

export async function act(c: Ctx, roomId: unknown, token: unknown, uid: string | null, raw: unknown): Promise<ActResult> {
  if (!uid) fail('캐릭터를 움직이려면 로그인해 주세요', 401);
  if (!rec(raw) || typeof raw.type !== 'string' || typeof raw.actor !== 'string') fail('잘못된 요청입니다', 400);
  const a = raw as Row;
  const actorId = String(a.actor);
  const { ref, room } = await authorize(c, roomId, token, uid);
  const admin = await isAdmin(c.db, uid);
  if (!(await controllable(c, uid!, room, actorId, admin))) fail('이 캐릭터를 움직일 권한이 없습니다', 403);
  // 깨우기는 말 걸기와 같은 한도(분당 12회)를 쓴다 — 남의 캐릭터를 계속 깨워 소식란을 도배하지 못하게
  const kind = a.type === 'move' || a.type === 'release' ? 'move' : a.type === 'game' || a.type === 'gameStart' ? 'game' : 'talk';
  if (a.type === 'gameFlip') return memoryFlip(c, roomId, token, uid!, actorId, a, now(c));
  const t = now(c);
  let write: (tx: Transaction) => void = () => undefined;
  let result: ActResult = { ok: true };
  let check: (tx: Transaction, current: DocumentData) => Promise<void> = async () => undefined;
  if (a.type === 'move') {
    const map = mapOf(room);
    if (!Number.isInteger(a.x) || !Number.isInteger(a.y) || !walkable(map.tiles[a.y as number]?.[a.x as number])) fail('갈 수 없는 곳입니다', 400);
    write = tx => tx.set(ref.collection('pos').doc(actorId), { x: a.x, y: a.y, at: t, by: uid });
  } else if (a.type === 'release') {
    write = tx => tx.delete(ref.collection('pos').doc(actorId));
  } else if (a.type === 'gift' || a.type === 'message') {
    const visible = await liveActors(c, room);
    if (typeof a.to !== 'string' || a.to === actorId || !visible.some(x => x.id === a.to)) fail('받는 캐릭터를 골라 주세요', 400);
    if (a.type === 'gift' && !GIFTS[room.era as keyof typeof GIFTS]?.some(g => g.id === a.item)) fail('이 세계관에 없는 선물입니다', 400);
    const text = typeof a.text === 'string' ? cleanText(a.text).trim() : '';
    if (a.type === 'message' && (!text || text.length > LIMITS.message)) fail(`내용은 1~${LIMITS.message}자로 적어 주세요`, 400);
    const ev = a.type === 'gift' ? { type: 'gift', from: actorId, to: a.to, item: a.item } : { type: 'message', from: actorId, to: a.to, text };
    write = tx => tx.set(ref.collection('events').doc(), { ...ev, at: t, actorUid: uid });
  } else if (a.type === 'wake') {
    // 깨우기 (v2.0 사용자 요청 — 자는 캐릭터도 깨워서 상호작용). 내가 조작할 수 있는 캐릭터(actor)가
    // 방 안의 자는 캐릭터(to, 자기 자신도 가능)를 깨운다. 자는지는 서버가 지금 시각·조작 위치·깨우기 기록으로
    // 모든 접속자와 같은 시뮬레이션을 돌려 판정한다(클라이언트가 보낸 상태는 믿지 않는다).
    const visible = await liveActors(c, room);
    if (typeof a.to !== 'string' || !visible.some(x => x.id === a.to)) fail('깨울 캐릭터를 골라 주세요', 400);
    const target = a.to as string;
    check = async tx => {
      const [pos, wakes] = await Promise.all([tx.get(ref.collection('pos')), tx.get(ref.collection('wake'))]);
      const ids = new Set(visible.map(x => x.id));
      const overrides = pos.docs.filter(d => ids.has(d.id)).map(d => ({ id: d.id, x: d.data().x, y: d.data().y, at: d.data().at, by: '' }));
      const frame = simulate(mapOf(room), room.seed, visible, overrides, t, wakeMarks(wakes.docs, ids)).find(f => f.id === target);
      if (!frame?.sleeping) fail('지금 깨어 있는 캐릭터입니다', 409);
    };
    write = tx => {
      tx.set(ref.collection('wake').doc(target), { at: t, by: actorId });
      tx.set(ref.collection('events').doc(), { type: 'wake', from: actorId, to: target, at: t, actorUid: uid });
    };
  } else if (a.type === 'gameStart') {
    // 판 시작 — 서버가 판을 정하고 시작 시각을 기록한다. 점수는 서버가 계산한다.
    //  · 별 줍기: 시드를 내려 주고, 끝나면 400틱 입력을 받아 같은 규칙으로 재생한다.
    //  · 짝 맞추기: 카드 배치는 서버에만 두고 뒤집을 때마다 그 카드만 알려 준다(gameFlip).
    const g = MINIGAMES.find(x => x.id === a.game);
    if (!g) fail('없는 미니게임입니다', 400);
    const gameRef = ref.collection('games').doc();
    const seed = randomBytes(12).toString('hex');
    const doc = g!.id === 'memory'
      ? { uid, actor: actorId, game: 'memory', deck: memoryDeck(seed, room.era), open: -1, matched: [], moves: 0, flips: 0, at: t, last: t, expireAt: new Date(t + GAME_TTL) }
      : { uid, actor: actorId, game: 'catch', seed, at: t, expireAt: new Date(t + GAME_TTL) };
    result = g!.id === 'memory' ? { ok: true, gameId: gameRef.id } : { ok: true, gameId: gameRef.id, seed };
    // 끝내지 않은 내 이전 판은 지운다(판 문서가 쌓이지 않게)
    check = async tx => {
      const mine = await tx.get(ref.collection('games').where('uid', '==', uid).limit(20));
      mine.docs.forEach(d => tx.delete(d.ref));
    };
    write = tx => tx.set(gameRef, doc);
  } else if (a.type === 'game') {
    // 별 줍기 제출 — 점수는 받지 않는다. 판 시드·서버가 잰 시간·플레이 입력을 같은 규칙으로 재생해 서버가 계산한다.
    if (a.game !== 'catch' || typeof a.gameId !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(a.gameId)) fail('점수가 올바르지 않습니다', 400);
    const g = MINIGAMES.find(x => x.id === 'catch')!;
    const gameRef = ref.collection('games').doc(a.gameId as string);
    const sref = ref.collection('scores').doc(sha(`${actorId}|${g.id}`).slice(0, 40));
    check = async tx => {
      const gs = (await tx.get(gameRef)).data();
      const cur = await tx.get(sref);
      // 한 판은 시작한 사람·캐릭터·게임으로 한 번만 제출할 수 있다
      if (!gs || gs.uid !== uid || gs.actor !== actorId || gs.game !== g.id || typeof gs.seed !== 'string' || typeof gs.at !== 'number') fail('끝난 판이거나 다른 사람의 판입니다', 400);
      const elapsed = t - gs!.at;
      if (elapsed > GAME_TTL) fail('너무 오래된 판입니다 — 다시 시작해 주세요', 400);
      if (elapsed < CATCH.TICKS * CATCH.TICK_MS - 1500) fail('판이 끝나기 전에 제출할 수 없습니다', 400);
      const score = catchReplay(gs!.seed, a.input);
      if (score === null || score < 0 || score > g.max) fail('점수가 올바르지 않습니다', 400);
      result = { ok: true, score: score! };
      tx.delete(gameRef);
      tx.set(ref.collection('events').doc(), { type: 'game', from: actorId, game: g.id, score, at: t, actorUid: uid });
      if (!cur.exists || (Number(cur.data()?.best) || 0) < score!) tx.set(sref, { actor: actorId, game: g.id, best: score, at: t });
    };
  } else {
    return fail('알 수 없는 행동입니다', 400);
  }
  await c.db.runTransaction(async tx => {
    // 방이 그 사이 삭제되거나 비밀번호가 바뀌었으면 쓰지 않는다. 권한도 트랜잭션 안에서 다시 확인한다.
    const current = await authorize(c, roomId, token, uid, tx);
    const adminNow = await isAdmin(c.db, uid, tx);
    if (!(await controllable(c, uid!, current.room, actorId, adminNow, tx))) fail('이 캐릭터를 움직일 권한이 없습니다', 403);
    const lim = await rateCheck(tx, ref, uid!, kind, t);
    await check(tx, current.room);
    lim();
    write(tx);
  });
  return result;
}

/** 짝 맞추기 한 장 뒤집기 — 판 문서(서버 전용)에 진행 상태가 있다. 클라이언트는 뒤집은 카드의 그림만 알게 된다. */
async function memoryFlip(c: Ctx, roomId: unknown, token: unknown, uid: string, actorId: string, a: Row, t: number): Promise<ActResult> {
  if (typeof a.gameId !== 'string' || !/^[A-Za-z0-9]{1,40}$/.test(a.gameId) || !Number.isInteger(a.card)) fail('잘못된 카드입니다', 400);
  const card = a.card as number;
  let result: ActResult = { ok: true };
  await c.db.runTransaction(async tx => {
    const { ref, room } = await authorize(c, roomId, token, uid, tx);
    const adminNow = await isAdmin(c.db, uid, tx);
    if (!(await controllable(c, uid, room, actorId, adminNow, tx))) fail('이 캐릭터를 움직일 권한이 없습니다', 403);
    const gameRef = ref.collection('games').doc(a.gameId as string);
    const sref = ref.collection('scores').doc(sha(`${actorId}|memory`).slice(0, 40));
    const gs = (await tx.get(gameRef)).data();
    const cur = await tx.get(sref);
    if (!gs || gs.uid !== uid || gs.actor !== actorId || gs.game !== 'memory' || !Array.isArray(gs.deck) || typeof gs.at !== 'number') fail('끝난 판이거나 다른 사람의 판입니다', 400);
    if (t - gs!.at > GAME_TTL) fail('너무 오래된 판입니다 — 다시 시작해 주세요', 400);
    const deck = gs!.deck as string[];
    const matched = Array.isArray(gs!.matched) ? (gs!.matched as number[]) : [];
    const open = Number.isInteger(gs!.open) ? (gs!.open as number) : -1;
    const flips = (Number(gs!.flips) || 0) + 1;
    if (card < 0 || card >= deck.length || matched.includes(card) || card === open) fail('뒤집을 수 없는 카드입니다', 400);
    if (flips > MEMORY.MAX_FLIPS) fail('판이 너무 길어졌습니다 — 다시 시작해 주세요', 400);
    // 두 장을 보여 주는 시간(PAIR_MS) 동안은 다음 짝을 뒤집을 수 없다 — 사람 화면과 같은 속도 제한
    if (open < 0 && (Number(gs!.moves) || 0) > 0 && typeof gs!.last === 'number' && t - gs!.last < MEMORY.PAIR_MS - 100) fail('너무 빠릅니다 — 카드를 확인한 뒤 뒤집어 주세요', 429);
    if (open < 0) {
      tx.update(gameRef, { open: card, flips, last: t });
      result = { ok: true, icon: deck[card] };
      return;
    }
    const moves = (Number(gs!.moves) || 0) + 1;
    const match = deck[card] === deck[open];
    const nextMatched = match ? [...matched, open, card] : matched;
    if (nextMatched.length < deck.length) {
      tx.update(gameRef, { open: -1, matched: nextMatched, moves, flips, last: t });
      result = { ok: true, icon: deck[card], match };
      return;
    }
    // 다 맞췄다 — 서버가 잰 시간과 시도 횟수로 점수를 매기고 판을 닫는다
    const score = memoryScore(moves, t - gs!.at);
    tx.delete(gameRef);
    tx.set(ref.collection('events').doc(), { type: 'game', from: actorId, game: 'memory', score, at: t, actorUid: uid });
    if (!cur.exists || (Number(cur.data()?.best) || 0) < score) tx.set(sref, { actor: actorId, game: 'memory', best: score, at: t });
    result = { ok: true, icon: deck[card], match, done: true, score };
  });
  return result;
}

async function rateCheck(tx: Transaction, room: DocumentReference, uid: string, kind: keyof typeof RATE, t: number) {
  const r = room.collection('limits').doc(sha(`${uid}|${kind}`).slice(0, 40));
  const snap = await tx.get(r);
  const d = snap.data();
  const active = d && typeof d.since === 'number' && t - d.since < RATE[kind].window;
  const n = active ? Number(d!.n) || 0 : 0;
  if (n >= RATE[kind].max) fail('너무 빠릅니다 — 잠시 뒤 다시 해 주세요', 429);
  return () => tx.set(r, { since: active ? d!.since : t, n: n + 1 });
}

/* ---------------- 비밀번호 변경(방 주인·관리자) — 기존 세션 모두 폐기 ---------------- */
export async function changePassword(c: Ctx, uid: string, roomId: unknown, password: unknown): Promise<{ token: string }> {
  if (!uid) fail('로그인이 필요합니다', 401);
  if (!validRoomId(roomId)) fail('잘못된 방입니다', 400);
  const problem = passwordProblem(password);
  if (problem) fail(problem, 400);
  const ref = c.db.collection(ROOMS).doc(roomId as string);
  const before = (await ref.get()).data();
  // 비싼 해시 계산 전에 가볍게 권한부터 확인한다(최종 판정은 아래 트랜잭션)
  if (!before || before.status !== 'active') fail('방을 찾을 수 없습니다', 404);
  if (before!.ownerUid !== uid && !(await isAdmin(c.db, uid))) fail('방을 만든 사람이나 관리자만 바꿀 수 있습니다', 403);
  if (await verifyRoomPassword(password, before!.pwHash)) {
    // 자동 완성으로 같은 비밀번호가 들어가 모두가 쫓겨나는 일을 막는다
    fail('지금 비밀번호와 같습니다 — 다른 비밀번호를 입력해 주세요', 400);
  }
  const pwHash = await hashRoomPassword(password as string);
  return c.db.runTransaction(async tx => {
    const adminNow = await isAdmin(c.db, uid, tx);
    const snap = await tx.get(ref);
    const room = snap.data();
    if (!snap.exists || !room || room.status !== 'active') fail('방을 찾을 수 없습니다', 404);
    if (room!.ownerUid !== uid && !adminNow) fail('방을 만든 사람이나 관리자만 바꿀 수 있습니다', 403);
    const v = (Number(room!.passwordVersion) || 1) + 1;
    tx.update(ref, { pwHash, passwordVersion: v, updatedAt: now(c) });
    return { token: signSession(c.key, { r: roomId as string, i: room!.instance, v, u: uid, e: now(c) + SESSION_MS }) };
  });
}
