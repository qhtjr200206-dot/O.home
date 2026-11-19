'use client';
// 콘텐츠 저장 계층 (v2.0) — 백엔드 어댑터(Supabase/Firebase)에 그대로 넘긴다.
//
// 앱 전체는 "목록 배열을 통째로 바꿔 저장"하는 방식(useLocalList)이다.
// 그 호출부 86곳을 건드리지 않으면서 DB는 항목 1개 = 행/문서 1개로 두기 위해,
// 저장 시점에 이전/새 배열을 비교해 바뀐 것만 보낸다(어댑터의 syncList).
//
// 자관(relations)만은 여기서 한 번 더 가공한다 — 비공개(잠금) 자관을 공개 껍데기와
// 비공개 문서(rel_secrets)로 나눠 저장하고, 읽을 때 다시 합친다 (relLock.ts).
import { backend, COLLECTION_OF } from './backend';
import type { ListItem } from './backend';
import { REL_SECRET_COLL, REL_LOCK_EVT, mergeRels, openedAnswers, splitRels } from './relLock';
import type { Relation } from './charStore';
import { CHAR_LOCK_EVT, mergeCharacterReads, ensureNoLockedWrites, clearOpenedCharacters } from './charLockClient';

export { COLLECTION_OF as TABLE_OF };

const REL_COLL = 'relations';
const QA_COLL = 'qa_answers';

export async function fetchList<T extends ListItem>(coll: string): Promise<T[]> {
  const be = backend();
  if (!be) return [];
  const rows = await be.fetchList<T>(coll);
  if (coll === 'characters') {
    const pub = rows as unknown as Parameters<typeof mergeCharacterReads>[0];
    if (!pub.some(c => c.locked)) return mergeCharacterReads(pub, []) as unknown as T[];
    let secretReadFailed = false;
    const sec = await be.fetchList<ListItem>('char_secrets').catch(() => { secretReadFailed = true; return [] as ListItem[]; });
    return mergeCharacterReads(pub, sec as unknown as Parameters<typeof mergeCharacterReads>[1], secretReadFailed) as unknown as T[];
  }
  if (coll === REL_COLL) {
    const pub = rows as unknown as Relation[];
    if (!pub.some(r => r.locked)) return rows;
    // 비공개 문서는 관리자·작성자만 읽힌다 (방문자에게는 빈 목록). 못 읽으면(권한 없음·규칙
    // 미적용·일시 오류) 껍데기 그대로 둔다. 로그인 여부를 미리 거르지 않는다 — 새로고침 직후엔
    // 로그인 복원이 끝나기 전이라 currentUserId가 비어 있을 수 있다
    const sec = await be.fetchList<ListItem>(REL_SECRET_COLL).catch(() => [] as ListItem[]);
    return mergeRels(pub, sec) as unknown as T[];
  }
  if (coll === QA_COLL) {
    // 이 탭에서 비밀번호로 연 자관의 답변 — 'private'라 목록 조회로는 안 온다
    const extra = openedAnswers();
    if (!extra.length) return rows;
    const seen = new Set(rows.map(r => r.id));
    return [...rows, ...(extra as unknown as T[]).filter(a => !seen.has(a.id))];
  }
  return rows;
}

export async function syncList<T extends ListItem>(
  coll: string, prev: T[], next: T[], uid: string | null,
): Promise<void> {
  const be = backend();
  if (!be) return;
  if (coll === 'characters') ensureNoLockedWrites(prev, next);
  if (coll !== REL_COLL) { await be.syncList(coll, prev, next, uid); return; }

  const a = splitRels(prev as unknown as Relation[]);
  const b = splitRels(next as unknown as Relation[]);
  const real = (rows: ListItem[]) => rows.filter(r => !r.keep);
  // 순서가 중요하다 — 어느 단계에서 실패해도 내용이 사라지지 않게:
  //  1) 비공개 문서 쓰기(새로 잠금·내용 수정)  2) 공개 문서  3) 더는 필요 없는 비공개 문서 지우기.
  // 1)이 거부되면(보안 규칙 미적용 등) 공개 문서를 껍데기로 바꾸지 않고 그대로 멈춘다.
  const nextIds = new Set(b.sec.map(s => s.id));
  const mid = [...b.sec, ...a.sec.filter(s => !nextIds.has(s.id))];
  const prevReal = real(a.sec);
  const midReal = real(mid);
  if (prevReal.length || midReal.length) await be.syncList(REL_SECRET_COLL, prevReal, midReal, uid);
  await be.syncList(REL_COLL, a.pub, b.pub, uid);
  // 지울 것: 자관이 지워졌거나(자리표시 포함) 잠금을 푼 것
  const gone = mid.filter(s => !nextIds.has(s.id)).map(s => ({ id: s.id }));
  if (gone.length) await be.syncList(REL_SECRET_COLL, gone, [], uid);
}

export function subscribeTable(coll: string, onChange: () => void): () => void {
  const be = backend();
  const off = be ? be.subscribe(coll, () => {
    if (coll === 'characters') clearOpenedCharacters(false);
    onChange();
  }) : () => { /* 로컬 모드 */ };
  if (coll === 'characters') {
    window.addEventListener(CHAR_LOCK_EVT, onChange);
    return () => { off(); window.removeEventListener(CHAR_LOCK_EVT, onChange); };
  }
  if (coll !== REL_COLL && coll !== QA_COLL) return off;
  // 잠금을 풀었거나 잠금 설정이 바뀌면 자관·답변 목록을 다시 읽는다 (relLock.ts)
  const h = () => onChange();
  window.addEventListener(REL_LOCK_EVT, h);
  return () => { off(); window.removeEventListener(REL_LOCK_EVT, h); };
}

/* ---------- 사이트 설정 (테마·메뉴·폰트·메인 위젯 등 key/value) ---------- */

export async function fetchSetting<T>(key: string): Promise<T | null> {
  const be = backend();
  return be ? be.fetchSetting<T>(key) : null;
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  const be = backend();
  if (be) await be.saveSetting(key, value);
}

export async function fetchAllSettings(): Promise<Record<string, unknown>> {
  const be = backend();
  return be ? be.fetchAllSettings() : {};
}
