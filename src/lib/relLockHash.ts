// 비공개(잠금) 자관 비밀번호 검증값 — 브라우저(설정 저장)와 서버(/api/rels/unlock, Node)가 같이 쓴다.
// 'use client'를 붙이지 않는다: 서버 라우트에서도 import 해야 한다. Web Crypto(globalThis.crypto)는
// 브라우저와 Node 18+ 양쪽에 있다.
//
// 방식: salt를 붙여 SHA-256을 iter번 반복 (h1 = H(salt:pw), hN = H(salt + hN-1)).
// Supabase에서는 같은 계산을 SQL 함수(rel_lock_hash)로 한다 — PBKDF2는 Postgres에 기본으로 없어서
// 양쪽에서 똑같이 만들 수 있는 반복 해시를 골랐다. 검증값은 비공개 문서에만 두므로(목록 문서에 없음)
// 반복 횟수는 오프라인 대입을 늦추는 2차 방어선이다.

export const REL_LOCK_ITER = 5000;

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(s: string): Promise<string> {
  return hex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/** 입력값 다듬기 — 앞뒤 공백은 무시 (TRPG 로그 비밀번호와 같은 규칙) */
export const normLockPw = (pw: string) => pw.trim();

export async function relLockHash(pw: string, salt: string, iter: number = REL_LOCK_ITER): Promise<string> {
  let h = await sha256Hex(`${salt}:${normLockPw(pw)}`);
  const n = Math.max(1, Math.min(200000, Math.floor(iter) || 1));
  for (let i = 1; i < n; i += 1) h = await sha256Hex(salt + h);
  return h;
}

/** 새 salt (16바이트 랜덤, hex) */
export function newLockSalt(): string {
  const a = new Uint8Array(16);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
}
