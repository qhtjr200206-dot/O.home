'use client';
// 커버 메이커 초대 코드 — 회원 가입코드(ohome.invite.v1)와 별개.
//
// 사이트 설정(site_settings)은 누구나 읽을 수 있는 공개 테이블이라 **코드 원문은 저장하지 않는다.**
// 관리자가 정한 코드의 SHA-256만 서버 공유 설정에 두고, 방문자가 입력한 코드를 같은 방식으로 해시해 비교한다.
// 통과한 기기는 입력한 코드를 자기 브라우저에 기억하고, 열 때마다 그 코드의 해시가 지금 설정과 같은지 본다
// → 관리자가 코드를 바꾸면 다시 묻는다. (공개된 해시를 그대로 「통과 표시」로 쓰면 해시를 복사해 넣는 것만으로
//    통과되므로, 기기에는 해시가 아니라 코드 자체를 둔다 — 코드를 모르면 위조할 수 없다.)
//
// 한계: 커버 메이커는 서버 데이터가 없는 순수 클라이언트 도구라 이 게이트는 「화면 입장」을 막는 것이다.
// 짧은 코드는 해시만 보고도 추측해 볼 수 있으니 관리자에게 6자 이상을 권한다.
import { getSetting, setSetting } from '@/lib/settingStore';

export const COVER_INVITE_KEY = 'ohome.coverinvite.v1';
const PASS_KEY = 'ohome.coverpass.v1';
const SALT = 'ohome-cover:';

export interface CoverInvite { hash: string; at: string }

export async function hashCoverCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(SALT + code.trim());
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 지금 설정된 초대 코드 정보 (없으면 null) */
export function coverInvite(): CoverInvite | null {
  const v = getSetting<CoverInvite | null>(COVER_INVITE_KEY, null);
  return v && typeof v === 'object' && typeof v.hash === 'string' && /^[0-9a-f]{64}$/.test(v.hash) ? v : null;
}

export function coverInviteHash(): string | null { return coverInvite()?.hash ?? null; }
export function hasCoverInvite(): boolean { return !!coverInviteHash(); }

/** 관리자 — 새 코드 저장 (서버 공유 설정). 관리자 본인 기기도 바로 통과 상태로 */
export async function setCoverInvite(code: string): Promise<void> {
  const c = code.trim();
  if (c.length < 4) throw new Error('초대 코드는 4자 이상으로 정해 주세요');
  const hash = await hashCoverCode(c);
  setSetting(COVER_INVITE_KEY, { hash, at: new Date().toISOString() } satisfies CoverInvite);
  rememberPass(c);
}

function rememberPass(code: string) {
  try { localStorage.setItem(PASS_KEY, code.trim()); } catch { /* 무시 */ }
}

/** 방문자 — 코드 확인. 맞으면 이 기기에 기억 */
export async function checkCoverCode(code: string): Promise<boolean> {
  const cur = coverInviteHash();
  if (!cur || !code.trim()) return false;
  const h = await hashCoverCode(code);
  if (h !== cur) return false;
  rememberPass(code);
  return true;
}

/** 이 기기가 지금 코드로 통과한 적이 있는지 (기억해 둔 코드의 해시 = 현재 설정) */
export async function coverPassValid(): Promise<boolean> {
  const cur = coverInviteHash();
  if (!cur) return false;
  let saved: string | null = null;
  try { saved = localStorage.getItem(PASS_KEY); } catch { return false; }
  if (!saved) return false;
  try { return (await hashCoverCode(saved)) === cur; } catch { return false; }
}

export function clearCoverPass(): void {
  try { localStorage.removeItem(PASS_KEY); } catch { /* 무시 */ }
}
