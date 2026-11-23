// TRPG 로그 열람 정책 — 화면(로그 상세·등록·수정)과 서버(/api/trpg/unlock)가 같은 판정을 쓴다.
//
// 비밀번호가 걸린 로그는 **관리자와 연동 자관의 상대방만** 비밀번호 없이 연다. 그 밖의 사람은
// 공개범위(전체공개·멤버공개)와 상관없이 비밀번호를 입력해야 한다. 예전에는 공개범위를 충족하면
// 비밀번호를 건너뛰었고, 본문 문서도 로그의 공개범위를 그대로 따랐다. 그래서 목록에 표시된
// 멤버공개 로그는 로그인 회원이면 비밀번호 없이 열렸다 (v2.0 사용자 제보).
//
// 이 파일은 아무것도 import하지 않는다 — Node 테스트(scripts/trpg-access.test.cjs)와 서버 라우트에서
// 그대로 불러 쓰기 위해서다.

export type LogVisibility = 'public' | 'member' | 'private';

export interface LogAccessFields {
  visibility: LogVisibility;
  passwordHash?: string;
}

export interface LogViewer {
  isAdmin: boolean;
  /** 연동 자관의 멤버 캐릭터에 권한이 부여된 회원 (v1.9 — 비밀번호 없이 열람) */
  isRelPartner: boolean;
  signedIn: boolean;
}

/** 비밀번호가 실제로 걸려 있는지 */
export const hasLogPassword = (l: Pick<LogAccessFields, 'passwordHash'>) => !!l.passwordHash;

/**
 * 비밀번호 없이 열람할 수 있는지.
 * `serverUnlock` — 서버가 비밀번호를 확인해 본문을 내줄 수 있는지(Firebase 서버 모드).
 * 그럴 수 없는 백엔드에서 비밀번호를 강제하면 아무도 본문을 못 열게 되므로 예전 판정을 유지한다.
 */
export function readableWithoutPassword(l: LogAccessFields, who: LogViewer, serverUnlock: boolean): boolean {
  if (who.isAdmin || who.isRelPartner) return true;
  if (hasLogPassword(l) && serverUnlock) return false;
  return l.visibility === 'public' || (l.visibility === 'member' && who.signedIn);
}

/**
 * 본문 문서(trpg_log_bodies)에 저장할 공개범위.
 * 비밀번호가 걸리면 `private` — 관리자만 DB에서 직접 읽고, 나머지는 /api/trpg/unlock의 확인을 거친다.
 */
export function logBodyVisibility(l: LogAccessFields, serverUnlock: boolean): LogVisibility {
  return hasLogPassword(l) && serverUnlock ? 'private' : l.visibility;
}

/** 큰 본문·원본 파일을 비공개 저장소(private-trpg/)에 둘지 — 비밀번호가 걸리면 공개범위와 무관하게 */
export const keepLogFilesPrivate = (l: Pick<LogAccessFields, 'passwordHash'>) => hasLogPassword(l);

/** 공개 다운로드 주소(https://…)인지 — 비밀번호 로그로 바뀌면 비공개 저장소로 옮겨야 한다 */
export const isPublicFileRef = (ref?: string) => typeof ref === 'string' && /^https?:/.test(ref);
