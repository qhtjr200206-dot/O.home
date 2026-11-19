'use client';
/**
 * 비공개(잠금) 자관 (사용자 요청) — 목록에는 다른 자관과 똑같이 보이지만, 커버를 누르면
 * 비밀번호를 물어보고 맞아야 들어간다.
 *
 * **화면에서 가리는 것만으로 끝내지 않는다.** 서버 모드에서는 저장할 때 한 자관을 둘로 나눈다:
 *
 *   relations/{id}    — 공개 목록 문서. 커버(썸네일)·제목·주소·공개범위만 남긴 「껍데기」
 *   rel_secrets/{id}  — 나머지 전부 + 비밀번호 검증값(salt+반복 해시). 늘 'private'로 저장 →
 *                       보안 규칙상 관리자·작성자만 직접 읽는다
 *
 * 방문자는 껍데기만 받으므로 DB를 직접 조회해도 본문·이미지 주소·멤버가 나오지 않는다.
 * 비밀번호를 넣으면 서버(Firebase: /api/rels/unlock · Supabase: unlock_relation RPC)가
 * 검증값과 비교하고, 맞을 때만 내용을 돌려준다. 받은 내용은 이 탭의 메모리에만 둔다
 * (새로고침하면 다시 잠긴다 — 저장소에 남기지 않음).
 *
 * 화면 코드는 예전처럼 「자관 목록」 하나만 다룬다 — 나누기·합치기는 db.ts가 이 파일의
 * splitRels / mergeRels로 저장·조회 시점에 한다.
 */
import { backend, isServerMode } from './backend';
import type { ListItem, RelUnlockResult } from './backend/types';
import type { QaAnswerRow, Relation } from './charStore';
import { normLockPw, relLockHash } from './relLockHash';

export const REL_SECRET_COLL = 'rel_secrets';
/** 잠금을 풀었거나 잠금 설정이 바뀌었을 때 — 자관·답변 목록을 다시 읽게 한다 (db.ts subscribeTable) */
export const REL_LOCK_EVT = 'ohome-rel-lock';

/* ---------- 껍데기 / 비공개 문서 ---------- */

/** 공개 목록 문서에 남길 껍데기 — 커버·제목만. 나머지 필드는 화면이 깨지지 않게 빈 값 */
export function relStub(r: Relation): Relation {
  return {
    id: r.id,
    ...(r.slug ? { slug: r.slug } : {}),
    name: r.name,
    catchphrase: '',
    ...(r.kind ? { kind: r.kind } : {}),
    ...(r.thumbId ? { thumbId: r.thumbId } : {}),
    ...(r.thumbCrop ? { thumbCrop: r.thumbCrop } : {}),
    thumbClass: r.thumbClass ?? '',
    visibility: r.visibility,
    members: [],
    illustMode: 'one',
    aus: [],
    timeline: [],
    questions: [],
    locked: true,
    lockStub: true,
  };
}

/** 비공개 문서 한 건 — 자관 전체(잠금 필드 제외) + 검증값 */
interface SecretRow extends ListItem {
  rel?: Relation;
  lockHash?: string;
  lockSalt?: string;
  lockIter?: number;
  visibility?: string;
  /** 내용을 못 받은 껍데기 자리 — 저장하지 않는 비교용 자리표시 (아래 splitRels) */
  keep?: boolean;
}

const stripLock = (r: Relation): Relation => {
  const { locked: _l, lockStub: _s, lockHash: _h, lockSalt: _a, lockIter: _i, ...rest } = r;
  void _l; void _s; void _h; void _a; void _i;
  return rest as Relation;
};

/**
 * 저장 직전 — 화면의 자관 목록을 「공개 목록 문서」와 「비공개 문서」로 나눈다.
 *
 * 비공개 문서는 **검증값(lockHash)을 가진 항목에서만** 만든다. 검증값이 없는 잠금 항목은
 * 내용을 서버에서 못 받은 껍데기이거나(방문자·일시 오류) 비밀번호로 연 사본이다 — 그걸로
 * 비공개 문서를 덮어쓰면 진짜 내용이 지워지므로 `keep` 자리표시만 둔다. 자리표시는 앞뒤가
 * 같아 diff에 걸리지 않고, 자관을 지웠을 때만 「삭제」로 잡혀 비공개 문서도 함께 지워진다.
 */
export function splitRels(items: Relation[]): { pub: ListItem[]; sec: SecretRow[] } {
  const pub: ListItem[] = [];
  const sec: SecretRow[] = [];
  items.forEach(r => {
    if (!r.locked) { pub.push(r as unknown as ListItem); return; }
    pub.push(relStub(r) as unknown as ListItem);
    if (r.lockHash && r.lockSalt && !r.lockStub) {
      sec.push({
        id: r.id, rel: stripLock(r), lockHash: r.lockHash, lockSalt: r.lockSalt,
        lockIter: r.lockIter, visibility: 'private',
      });
    } else {
      sec.push({ id: r.id, keep: true });
    }
  });
  return { pub, sec };
}

/* ---------- 이 탭에서 비밀번호로 연 자관 (메모리에만) ---------- */

const opened = new Map<string, { rel: Relation; answers: QaAnswerRow[] }>();

export const isOpenedHere = (id: string) => opened.has(id);
export const openedAnswers = (): QaAnswerRow[] => [...opened.values()].flatMap(o => o.answers);

/** 조회 직후 — 껍데기에 비공개 문서(관리자·작성자) 또는 이 탭에서 연 내용을 합친다 */
export function mergeRels(pub: Relation[], sec: SecretRow[]): Relation[] {
  if (!pub.some(r => r.locked)) return pub;
  const byId = new Map(sec.filter(s => s.rel && s.lockHash).map(s => [s.id, s]));
  return pub.map(r => {
    if (!r.locked) return r;
    const s = byId.get(r.id);
    if (s?.rel) {
      return {
        ...s.rel, id: r.id, visibility: r.visibility, locked: true,
        lockHash: s.lockHash, lockSalt: s.lockSalt, lockIter: s.lockIter,
      };
    }
    const o = opened.get(r.id);
    if (o) return { ...stripLock(o.rel), id: r.id, visibility: r.visibility, locked: true };
    return { ...r, lockStub: true };
  });
}

/** 이 자관을 열려면 비밀번호가 필요한가 */
export function needsUnlock(r: Relation, isAdmin: boolean): boolean {
  if (!r.locked) return false;
  if (r.lockStub) return true;                 // 서버가 껍데기만 줬다
  if (opened.has(r.id)) return false;
  if (isServerMode()) return false;            // 내용이 왔다 = 관리자·작성자
  return !isAdmin;                             // 브라우저 저장 모드 — 관리자 외에는 묻는다
}

const notify = () => {
  try { window.dispatchEvent(new CustomEvent(REL_LOCK_EVT)); } catch { /* 무시 */ }
};
export const notifyRelLockChanged = notify;

/** 비밀번호로 열기 — 검증은 서버에서. 통과하면 이 탭 메모리에 담고 목록을 다시 읽게 한다 */
export async function unlockRel(rel: Relation, password: string): Promise<RelUnlockResult> {
  if (!password.trim()) return { ok: false, error: '비밀번호를 입력해 주세요' };
  const be = backend();
  if (!be) {
    // 브라우저 저장 모드 — 서버가 없으니 이 브라우저 안에서 비교한다(원래 데이터도 이 브라우저에만 있다)
    if (!rel.lockHash || !rel.lockSalt) return { ok: false, error: '잠금 정보가 없습니다' };
    const h = await relLockHash(password, rel.lockSalt, rel.lockIter);
    if (h !== rel.lockHash) return { ok: false, error: '비밀번호가 올바르지 않습니다', status: 401 };
    opened.set(rel.id, { rel, answers: [] });
    notify();
    return { ok: true, rel: rel as unknown as ListItem, answers: [] };
  }
  if (!be.unlockRel) return { ok: false, error: '이 서버 연결은 잠금 자관 열기를 지원하지 않습니다' };
  const r = await be.unlockRel(rel.id, normLockPw(password));
  if (r.ok) {
    opened.set(rel.id, {
      rel: { ...(r.rel as unknown as Relation), id: rel.id },
      answers: (r.answers as unknown as QaAnswerRow[]).filter(a => a && a.relId === rel.id),
    });
    notify();
  }
  return r;
}
