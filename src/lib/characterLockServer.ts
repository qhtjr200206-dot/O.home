// Server-only character lock operations. The transaction reads current server data;
// callers never submit a profile, preventing stale clients from restoring old content.
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Firestore, DocumentData } from 'firebase-admin/firestore';

const scrypt = promisify(scryptCallback);
const WINDOW = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const PUBLIC_KEYS = ['id', 'name', 'own', 'visibility', 'slug', 'secId', 'thumbId', 'thumbCrop', 'thumbClass'] as const;
const LOCK_KEYS = ['locked', 'lockStub', 'lockHash', 'lockSalt', 'lockIter', 'lockAlgorithm', 'lockVersion'];

type Row = Record<string, unknown>;
export class CharacterLockError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const fail = (message: string, status: number): never => { throw new CharacterLockError(message, status); };
export function validCharacterId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 200 && !id.includes('/') && id !== '.' && id !== '..' && !/^__.*__$/.test(id);
}
export function validPassword(p: unknown): p is string {
  return typeof p === 'string' && p.trim().length >= 4 && p.length <= 200;
}
const record = (x: unknown): x is Row => !!x && typeof x === 'object' && !Array.isArray(x);
const strip = (row: Row): Row => Object.fromEntries(Object.entries(row).filter(([key]) => !LOCK_KEYS.includes(key)));
async function hashPassword(password: string, salt: string): Promise<string> {
  return (await scrypt(password.trim(), salt, 64) as Buffer).toString('hex');
}

/** Admin authorization and all data movement happen in a single Firestore transaction. */
export async function changeCharacterLock(db: Firestore, uid: string, id: string, action: 'lock' | 'unlock' | 'changePassword', password?: string): Promise<void> {
  if (!uid || !validCharacterId(id)) fail('잘못된 요청입니다', 400);
  if (!['lock', 'unlock', 'changePassword'].includes(action)) fail('잘못된 요청입니다', 400);
  if (action !== 'unlock' && !validPassword(password)) fail('비밀번호는 4자 이상 200자 이하여야 합니다', 400);
  const salt = action === 'unlock' ? '' : randomBytes(16).toString('hex');
  const hash = action === 'unlock' ? '' : await hashPassword(password!, salt);
  const version = action === 'unlock' ? '' : randomBytes(16).toString('hex');
  const ownerRef = db.collection('meta').doc('owner');
  const publicRef = db.collection('characters').doc(id);
  const secretRef = db.collection('char_secrets').doc(id);
  await db.runTransaction(async tx => {
    const ownerSnap = await tx.get(ownerRef);
    const owner = ownerSnap.data();
    if (!ownerSnap.exists || !(owner?.uid === uid || (Array.isArray(owner?.admins) && owner.admins.includes(uid)))) fail('관리자 권한이 필요합니다', 403);
    const pubSnap = await tx.get(publicRef);
    const secSnap = await tx.get(secretRef);
    if (!pubSnap.exists) fail('캐릭터를 찾을 수 없습니다', 404);
    const pub = pubSnap.data()!;
    if (!record(pub.data)) fail('캐릭터 데이터가 올바르지 않습니다', 409);
    const locked = pub.data.locked === true;
    const sec = secSnap.data();
    if (action === 'lock') {
      if (locked || secSnap.exists) fail('이미 잠겨 있거나 기존 비밀 문서가 있습니다', 409);
      const character = strip(pub.data);
      const stub: Row = {};
      for (const key of PUBLIC_KEYS) if (character[key] !== undefined) stub[key] = character[key];
      stub.id = id; stub.locked = true; stub.lockStub = true; stub.lockVersion = version;
      // Store the old wrapper too: restore unknown metadata instead of silently losing it.
      tx.set(secretRef, { data: { id, character, lockHash: hash, lockSalt: salt, lockAlgorithm: 'scrypt-v1', original: pub }, visibility: 'private', authorId: uid, sort: pub.sort ?? 0, updatedAt: Date.now() });
      tx.set(publicRef, { data: stub, authorId: pub.authorId ?? null, visibility: pub.visibility ?? 'private', sort: pub.sort ?? 0, editorIds: [], updatedAt: Date.now() });
      return;
    }
    if (!locked || !secSnap.exists || !record(sec?.data) || !record(sec.data.character) || !record(sec.data.original) || sec.data.lockAlgorithm !== 'scrypt-v1') fail('잠금 비밀 문서를 안전하게 복구할 수 없습니다', 409);
    const secret = sec!;
    const secretData = secret.data as DocumentData;
    if (action === 'changePassword') {
      tx.set(secretRef, { ...secret, data: { ...secretData, lockHash: hash, lockSalt: salt }, updatedAt: Date.now() });
      tx.set(publicRef, { ...pub, data: { ...pub.data, lockVersion: version }, updatedAt: Date.now() });
      return;
    }
    const restored = strip(secretData.character as Row);
    // Public metadata may have been edited while locked. Never resurrect stale public values.
    for (const key of PUBLIC_KEYS) {
      if (pub.data[key] === undefined) delete restored[key]; else restored[key] = pub.data[key];
    }
    restored.id = id;
    tx.set(publicRef, { ...secretData.original, data: restored, authorId: pub.authorId ?? null, visibility: pub.visibility ?? 'private', sort: pub.sort ?? 0, updatedAt: Date.now() });
    tx.delete(secretRef);
  });
}

export type OpenResult = { ok: true; character: Row } | { ok: false; error: string; status: number };
/** Password checks and rate-limit writes are transactional, including concurrent attempts. */
export async function openCharacter(db: Firestore, id: string, password: string, authenticated: boolean, client: string): Promise<OpenResult> {
  if (!validCharacterId(id) || typeof password !== 'string' || !password.trim() || password.length > 200) return { ok: false, error: '잘못된 요청입니다', status: 400 };
  const pubRef = db.collection('characters').doc(id);
  const secRef = db.collection('char_secrets').doc(id);
  const key = createHash('sha256').update(`${client}|${id}`).digest('hex');
  const triesRef = db.collection('char_unlock_tries').doc(key);
  return db.runTransaction(async tx => {
    const pubSnap = await tx.get(pubRef);
    const secSnap = await tx.get(secRef);
    const triesSnap = await tx.get(triesRef);
    if (!pubSnap.exists) return { ok: false, error: '캐릭터를 찾을 수 없습니다', status: 404 };
    const pub = pubSnap.data()!;
    if (!record(pub.data) || pub.data.locked !== true) return { ok: false, error: '잠긴 캐릭터가 아닙니다', status: 400 };
    if (pub.visibility !== 'public' && !(pub.visibility === 'member' && authenticated)) return { ok: false, error: '열람 권한이 없습니다', status: 403 };
    const now = Date.now();
    const tries = triesSnap.data();
    const active = typeof tries?.since === 'number' && now - tries.since < WINDOW;
    if (active && typeof tries?.fails === 'number' && tries.fails >= MAX_FAILURES) return { ok: false, error: '너무 많은 시도입니다. 잠시 뒤 다시 시도해 주세요', status: 429 };
    const sec = secSnap.data()?.data;
    if (!record(sec) || !record(sec.character) || sec.lockAlgorithm !== 'scrypt-v1' || typeof sec.lockSalt !== 'string' || !/^[a-f0-9]{32}$/.test(sec.lockSalt) || typeof sec.lockHash !== 'string' || !/^[a-f0-9]{128}$/.test(sec.lockHash)) return { ok: false, error: '잠금 정보를 찾을 수 없습니다', status: 409 };
    const got = Buffer.from(await hashPassword(password, sec.lockSalt), 'hex');
    const want = Buffer.from(sec.lockHash, 'hex');
    if (!timingSafeEqual(got, want)) {
      tx.set(triesRef, { since: active ? tries!.since : now, fails: active ? (Number(tries!.fails) || 0) + 1 : 1 });
      return { ok: false, error: '비밀번호가 올바르지 않습니다', status: 401 };
    }
    if (triesSnap.exists) tx.delete(triesRef);
    return { ok: true, character: { ...strip(sec.character), id } };
  });
}
