'use client';
import type { Character } from './charStore';

export const CHAR_LOCK_EVT = 'ohome-char-lock';
const opened = new Map<string, { character: Character; lockVersion: string }>();
let generation = 0;
export function clearOpenedCharacters(notify = true) {
  generation += 1;
  opened.clear();
  if (notify) notifyCharLockChanged();
}
export const openedCharacter = (id: string) => opened.get(id)?.character;
export function notifyCharLockChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHAR_LOCK_EVT));
}
export function forgetOpenedCharacter(id: string) { opened.delete(id); }

type PublicChar = Partial<Character> & {id: string; locked?: boolean; lockStub?: boolean; lockVersion?: string};
type SecretRow = {id: string; character?: Character};
export function charactersWithEditableGrants<T extends Partial<Character> & {locked?: boolean}>(characters: T[]): T[] {
  return characters.filter(c => !c.locked && c.grants?.some(g => g.level === 'edit'));
}
/** Locked records must never be written to the public collection by legacy list saves. */
export function ensureNoLockedWrites(prev: PublicChar[], next: PublicChar[]) {
  const before = new Map(prev.map(c => [c.id, c]));
  const after = new Map(next.map(c => [c.id, c]));
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(id), b = after.get(id);
    if ((a?.locked || b?.locked) && JSON.stringify(a) !== JSON.stringify(b)) {
      throw new Error('잠긴 캐릭터는 먼저 잠금을 해제한 뒤 수정하거나 삭제해 주세요.');
    }
  }
}
export function mergeCharacterReads(pub: PublicChar[], sec: SecretRow[], secretReadFailed = false): PublicChar[] {
  const secrets = new Map(sec.filter(s => s.character).map(s => [s.id, s.character!]));
  return pub.map(c => {
    if (!c.locked) { opened.delete(c.id); return c; }
    const cached = opened.get(c.id);
    if (cached && (!c.lockVersion || c.lockVersion !== cached.lockVersion)) opened.delete(c.id);
    const content = secrets.get(c.id) ?? opened.get(c.id)?.character;
    if (!content) return {sub: '', color: '', colors: [], specs: [], tabs: [], basicHtml: '', ...c, lockStub: true, ...(secretReadFailed ? {lockSecretError: true} : {})};
    const {lockHash: _h, lockSalt: _s, lockIter: _i, ...safe} = content as Character & {lockHash?: string; lockSalt?: string; lockIter?: number};
    void _h; void _s; void _i;
    return {...safe, ...c, lockStub: false, ...(secretReadFailed ? {lockSecretError: true} : {})};
  });
}

export async function openCharacter(id: string, password: string, token?: string | null): Promise<{ok: true} | {ok: false; error: string}> {
  if (!password.trim()) return {ok: false, error: '비밀번호를 입력해 주세요'};
  const started = generation;
  try {
    const res = await fetch('/api/chars/unlock', {method: 'POST', headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}, body: JSON.stringify({id, password})});
    const data = await res.json();
    if (started !== generation) return {ok: false, error: '접근 상태가 바뀌었습니다. 다시 시도해 주세요'};
    if (!res.ok) return {ok: false, error: typeof data.error === 'string' ? data.error : '열지 못했습니다'};
    if (!data.char || data.char.id !== id || typeof data.lockVersion !== 'string' || !data.lockVersion) return {ok: false, error: '서버 응답이 올바르지 않습니다'};
    const {lockHash: _h, lockSalt: _s, lockIter: _i, ...safe} = data.char;
    void _h; void _s; void _i;
    opened.set(id, {character: safe as Character, lockVersion: data.lockVersion});
    notifyCharLockChanged();
    return {ok: true};
  } catch { return {ok: false, error: '서버에 연결하지 못했습니다'}; }
}
