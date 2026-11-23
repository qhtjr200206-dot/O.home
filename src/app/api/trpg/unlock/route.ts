// TRPG 로그 비밀번호 보호 — 서버 검증 (v2.0 보안 재설계).
//
// 기존 구현은 비밀번호가 걸리면 본문 문서의 Firestore 권한을 강제로 public으로 바꿔서
// "클라이언트가 비밀번호를 확인하는 척"만 했다 — 실제로는 비밀번호 없이도 DB를 직접 조회하면
// 전부 읽혔다. 여기서는 Admin SDK로 Firestore 규칙을 우회해 서버에서만 비밀번호(salt+hash)를
// 비교하고, 통과한 요청에만 본문을 내려준다. 큰 본문(Storage의 private-trpg/ 경로)은 응답에
// 바이트를 직접 싣지 않고 — Vercel 서버리스 함수의 응답 용량 한도(약 4.5MB)에 걸리므로 —
// 짧게 유효한 signed URL만 돌려주고, 브라우저가 Storage에서 바로 받아 간다.
//
// 비밀번호 없이도 통과하는 경로는 trpgAccess.ts의 readableWithoutPassword — 화면과 같은 판정이다.
// 비밀번호가 걸린 로그는 관리자와 연동 자관의 상대방만 비밀번호 없이 받는다. 걸리지 않은 로그는
// 공개범위대로(전체공개 / member 로그인 회원 / 관리자) — 본문만 비공개 Storage에 있다는 이유로
// 원래 열람 권한이 있던 사람이 못 보는 일이 없게 한다.
import { NextRequest, NextResponse } from 'next/server';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { readableWithoutPassword, type LogViewer, type LogVisibility } from '@/lib/trpgAccess';

export const runtime = 'nodejs';

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

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

interface LogDoc { passwordHash?: string; passwordSalt?: string; visibility?: LogVisibility; relId?: string }
interface BodyDoc { body?: string; bodyId?: string; bodyHtml?: boolean; originalFileId?: string; originalName?: string }

/** 연동 자관의 상대방인지 — 자관 멤버 캐릭터 중 하나라도 이 회원에게 권한(grants)을 줬는지.
 *  화면의 isRelPartner(로그 상세)와 같은 판정이다. 잠금 캐릭터는 grants가 공개 문서에 없어 해당하지 않는다 */
async function isRelPartner(db: Firestore, relId: string | undefined, uid: string): Promise<boolean> {
  if (!relId) return false;
  const rel = await db.collection('relations').doc(relId).get();
  const members = ((rel.data()?.data ?? {}) as { members?: { charId?: string }[] }).members ?? [];
  const ids = members.map(m => m.charId).filter((x): x is string => typeof x === 'string' && !!x);
  if (!ids.length) return false;
  const chars = await db.getAll(...ids.map(cid => db.collection('characters').doc(cid)));
  return chars.some(c => {
    const grants = ((c.data()?.data ?? {}) as { grants?: { userId?: string }[] }).grants ?? [];
    return grants.some(g => g.userId === uid);
  });
}

export async function POST(req: NextRequest) {
  let payload: { id?: string; password?: string; want?: 'body' | 'original' };
  try { payload = await req.json(); } catch { return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 }); }
  const id = payload.id;
  if (!id) return NextResponse.json({ error: 'id가 필요합니다' }, { status: 400 });

  try { adminApp(); } catch (e) {
    console.error('[trpg/unlock] admin init 실패', e);
    return NextResponse.json({ error: '서버 설정 오류' }, { status: 500 });
  }
  const db = getFirestore();

  // 이 앱은 실제 필드를 전부 data 아래에 한 번 감싸서 저장한다(firebaseBackend.ts의 syncList:
  // { data: item, authorId, visibility, sort, ... }) — 클라이언트는 fetchList가 data를 다시
  // 풀어서 쓰지만, 여기서는 Admin SDK로 문서를 직접 읽으므로 그 풀어주는 과정을 직접 해야 한다.
  // (최상위 visibility는 listHidden 등에 따라 느슨해질 수 있어 실제 접근권한 판정에는 쓰지 않는다 —
  // 진짜 값은 항상 data.visibility 쪽이다)
  const logSnap = await db.collection('trpg_logs').doc(id).get();
  if (!logSnap.exists) return NextResponse.json({ error: '찾을 수 없습니다' }, { status: 404 });
  const log = (logSnap.data()?.data ?? {}) as LogDoc;

  // 비밀번호 없이 통과하는 경로 — 화면과 같은 판정(trpgAccess.ts). 비밀번호가 걸린 로그는
  // 관리자와 연동 자관의 상대방만, 걸리지 않은 로그는 공개범위(전체공개 / member 로그인 회원)대로
  let viewer: LogViewer = { isAdmin: false, isRelPartner: false, signedIn: false };
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const decoded = await getAuth().verifyIdToken(authHeader.slice(7));
      const owner = await db.doc('meta/owner').get();
      const o = owner.data() as { uid?: string; admins?: string[] } | undefined;
      const isAdmin = !!o && (o.uid === decoded.uid || !!o.admins?.includes(decoded.uid));
      viewer = { isAdmin, signedIn: true, isRelPartner: !isAdmin && await isRelPartner(db, log.relId, decoded.uid) };
    } catch { /* 토큰이 유효하지 않으면 비밀번호 경로로 */ }
  }
  const allowedWithoutPassword = readableWithoutPassword(
    { visibility: log.visibility ?? 'private', passwordHash: log.passwordHash }, viewer, true);

  if (!allowedWithoutPassword) {
    const password = payload.password;
    if (!log.passwordHash || !log.passwordSalt) {
      console.error('[trpg/unlock] 403 — 이 로그에 passwordHash/passwordSalt가 없음', { id });
      return NextResponse.json({ error: '열람 권한이 없습니다' }, { status: 403 });
    }
    if (!password || (await sha256Hex(log.passwordSalt + password)) !== log.passwordHash) {
      console.error('[trpg/unlock] 401 — 비밀번호 불일치', { id, gotPassword: !!password });
      return NextResponse.json({ error: '비밀번호가 올바르지 않습니다' }, { status: 401 });
    }
  }

  const bodySnap = await db.collection('trpg_log_bodies').doc(id).get();
  const bd = (bodySnap.exists ? bodySnap.data()?.data : {}) as BodyDoc;

  // want:'original' — 백업용 원본 파일(원본 바이트) 요청. 그 외(기본)는 렌더용 본문 텍스트.
  const ref = payload.want === 'original' ? bd.originalFileId : bd.bodyId;
  const bodyHtml = bd.bodyHtml ?? null;
  const originalName = bd.originalName;

  if (payload.want !== 'original' && bd.body) return NextResponse.json({ body: bd.body, bodyHtml });
  if (!ref) return NextResponse.json({ body: '', bodyHtml, originalName });

  // 서버가 큰 본문을 받아서 응답에 그대로 실어 보내면 Vercel 함수 응답 용량 한도(약 4.5MB)에
  // 걸린다 — 비공개(private-trpg/)든 기존 공개 URL이든, 바이트는 항상 브라우저가 Storage에서
  // 직접 받게 하고 서버는 "어디서 받으면 되는지"만 알려준다 (버킷 CORS는 이미 열어 둠).
  if (/^https?:/.test(ref)) {
    return payload.want === 'original'
      ? NextResponse.json({ originalUrl: ref, originalName })
      : NextResponse.json({ signedUrl: ref, bodyHtml });
  }

  // private-trpg/ 경로 — 10분짜리 signed URL만 발급
  try {
    const [signedUrl] = await getStorage().bucket().file(ref).getSignedUrl({
      action: 'read',
      expires: Date.now() + 10 * 60 * 1000,
    });
    return payload.want === 'original'
      ? NextResponse.json({ originalUrl: signedUrl, originalName })
      : NextResponse.json({ signedUrl, bodyHtml });
  } catch (e) {
    console.error('[trpg/unlock] signed url 발급 실패', e);
    return NextResponse.json({ error: '본문을 불러오지 못했습니다' }, { status: 502 });
  }
}
