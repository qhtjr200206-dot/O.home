// 비공개(잠금) 자관 열기 — 서버 검증 (Firebase 판). Supabase 판은 DB 함수 unlock_relation()이 같은 일을 한다.
//
// 잠금 자관은 공개 목록 문서(relations/{id})에 커버·제목만 있고, 나머지 내용과 비밀번호 검증값은
// 비공개 문서(rel_secrets/{id}, visibility 'private')에 있다 — 보안 규칙상 관리자·작성자만 읽는다.
// 여기서는 Admin SDK로 그 문서를 읽어 **서버에서만** 비밀번호를 비교하고, 맞을 때만 내용을 내준다.
//
//  · 평문 비밀번호는 저장하지 않는다 (salt + 반복 SHA-256, src/lib/relLockHash.ts)
//  · 대입 공격 늦추기: (IP, 자관)별로 15분에 8번 틀리면 잠시 막는다 — 기록은 rel_unlock_tries
//    컬렉션(Admin SDK 전용, 보안 규칙상 클라이언트는 접근 불가)
//  · 공개범위가 '멤버공개'면 로그인 토큰도 있어야 하고, '나만보기'는 비밀번호로 열지 않는다
import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { relLockHash } from '@/lib/relLockHash';

export const runtime = 'nodejs';

const MAX_FAILS = 8;
const WINDOW_MS = 15 * 60 * 1000;

function adminApp() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON 환경변수가 없습니다');
  const svc = JSON.parse(raw);
  return initializeApp({
    credential: cert(svc),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${svc.project_id}.appspot.com`,
  });
}

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

interface SecretDoc { rel?: Record<string, unknown>; lockHash?: string; lockSalt?: string; lockIter?: number }

export async function POST(req: NextRequest) {
  // Firestore 오류 등 예상 못 한 실패도 빈 500이 아니라 알 수 있는 응답으로
  try { return await unlock(req); } catch (e) {
    console.error('[rels/unlock] 실패', e);
    return json({ error: '잠시 뒤 다시 시도해 주세요' }, 500);
  }
}

async function unlock(req: NextRequest) {
  let payload: { id?: unknown; password?: unknown };
  try { payload = await req.json(); } catch { return json({ error: '잘못된 요청입니다' }, 400); }
  const id = typeof payload.id === 'string' ? payload.id : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  // Firestore 문서 id로 쓸 수 없는 값(경로 구분자·'.'/'..'·__예약__)은 미리 거른다
  if (!id || id.length > 200 || id.includes('/') || id === '.' || id === '..' || /^__.*__$/.test(id)) {
    return json({ error: '잘못된 요청입니다' }, 400);
  }
  if (!password.trim() || password.length > 200) return json({ error: '비밀번호를 입력해 주세요' }, 400);

  try { adminApp(); } catch (e) {
    console.error('[rels/unlock] admin init 실패', e);
    return json({ error: '서버 설정 오류' }, 500);
  }
  const db = getFirestore();

  // 시도 횟수 — IP는 해시로만 남긴다
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const triesRef = db.collection('rel_unlock_tries').doc(createHash('sha256').update(`${ip}|${id}`).digest('hex'));
  const now = Date.now();
  const tries = (await triesRef.get()).data() as { fails?: number; since?: number } | undefined;
  const inWindow = !!tries?.since && now - tries.since < WINDOW_MS;
  if (inWindow && (tries?.fails ?? 0) >= MAX_FAILS) {
    return json({ error: '비밀번호를 너무 많이 틀렸습니다 — 잠시 뒤 다시 시도해 주세요' }, 429);
  }

  // 공개 목록 문서 — 공개범위 확인 (실제 값은 data 안, 최상위 visibility는 저장 시 계산된 값)
  const pubSnap = await db.collection('relations').doc(id).get();
  if (!pubSnap.exists) return json({ error: '자관을 찾을 수 없습니다' }, 404);
  const top = pubSnap.data() as { visibility?: string; data?: { locked?: boolean } };
  if (!top.data?.locked) return json({ error: '잠긴 자관이 아닙니다' }, 400);
  if (top.visibility === 'private') return json({ error: '열람 권한이 없습니다' }, 403);
  if (top.visibility === 'member') {
    const h = req.headers.get('authorization');
    let ok = false;
    if (h?.startsWith('Bearer ')) {
      try { await getAuth().verifyIdToken(h.slice(7)); ok = true; } catch { /* 아래에서 거부 */ }
    }
    if (!ok) return json({ error: '멤버공개 자관입니다 — 로그인한 뒤 열 수 있습니다' }, 401);
  }

  const secSnap = await db.collection('rel_secrets').doc(id).get();
  const sec = (secSnap.exists ? secSnap.data()?.data : undefined) as SecretDoc | undefined;
  if (!sec?.rel || !sec.lockHash || !sec.lockSalt) {
    console.error('[rels/unlock] 비공개 문서 없음', { id });
    return json({ error: '잠금 정보를 찾을 수 없습니다' }, 404);
  }

  const got = Buffer.from(await relLockHash(password, sec.lockSalt, sec.lockIter), 'utf8');
  const want = Buffer.from(sec.lockHash, 'utf8');
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    await triesRef.set(inWindow
      ? { fails: FieldValue.increment(1), since: tries!.since }
      : { fails: 1, since: now });
    return json({ error: '비밀번호가 올바르지 않습니다' }, 401);
  }
  if (tries) await triesRef.delete().catch(() => { /* 무시 */ });

  // 이 자관의 문답 답변 — 잠금 자관의 답변은 'private'로 저장돼 목록 조회로는 안 온다
  const ans = await db.collection('qa_answers').where('data.relId', '==', id).get()
    .catch(() => null);
  const answers = (ans?.docs ?? []).map(d => ({ ...((d.data().data ?? {}) as Record<string, unknown>), id: d.id }));

  return json({ rel: { ...sec.rel, id }, answers });
}
