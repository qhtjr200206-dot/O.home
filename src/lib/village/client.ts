'use client';
// 마을 API 클라이언트 — 로그인 토큰(있으면)과 방 세션 토큰을 붙여 /api/village 로 보낸다.
import { backend } from '@/lib/backend';

export class VillageApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function villageApi<T>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
  const be = backend();
  const idToken = (await be?.authToken?.().catch(() => null)) ?? null;
  let res: Response;
  try {
    res = await fetch('/api/village', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(idToken ? { authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify({ op, ...payload }),
      cache: 'no-store',
    });
  } catch {
    throw new VillageApiError('서버에 연결하지 못했습니다', 0);
  }
  const data = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new VillageApiError(data.error ?? '처리하지 못했습니다', res.status);
  return data;
}

// 방 세션 토큰은 탭 단위(sessionStorage)로만 둔다 — 탭을 닫으면 다시 비밀번호를 묻는다
const KEY = (roomId: string) => `ohome.village.token.${roomId}`;
export const roomToken = {
  get: (roomId: string) => { try { return sessionStorage.getItem(KEY(roomId)); } catch { return null; } },
  set: (roomId: string, token: string) => { try { sessionStorage.setItem(KEY(roomId), token); } catch { /* 무시 */ } },
  clear: (roomId: string) => { try { sessionStorage.removeItem(KEY(roomId)); } catch { /* 무시 */ } },
};
