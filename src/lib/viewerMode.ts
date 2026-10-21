'use client';
// 보는 사람별 다크/라이트 (v2.1 사용자 요청 — 「다크모드 온오프를 프로필에 넣어 유저들이 마음대로」)
// 사이트 테마(관리자 설정)는 그대로 두고, **이 브라우저에서만** 다크/라이트 중 하나로 덮어쓴다.
// 서버 설정 저장소(setSetting)는 모두에게 공유되므로 쓰지 않고 localStorage에만 둔다.
// null = 사이트 기본 테마를 따름.
import { useEffect, useState } from 'react';

export type ViewerMode = 'dark' | 'light';

const KEY = 'ohome.viewerMode.v1';
/** 첫 페인트 전에 적용할 변수 맵 — layout.tsx 인라인 스크립트가 사이트 맵보다 우선해서 읽는다 */
export const VIEWER_CSS_KEY = 'ohome.viewerCss.v1';
const EVT = 'ohome-viewer-mode';

export function getViewerMode(): ViewerMode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch { return null; }
}

export function setViewerMode(m: ViewerMode | null) {
  try {
    if (m) localStorage.setItem(KEY, m);
    else { localStorage.removeItem(KEY); localStorage.removeItem(VIEWER_CSS_KEY); }
  } catch { /* 무시 — 이번 화면에서만 적용 */ }
  window.dispatchEvent(new Event(EVT));
}

export function useViewerMode(): ViewerMode | null {
  const [m, setM] = useState<ViewerMode | null>(null);
  useEffect(() => {
    const read = () => setM(getViewerMode());
    read();
    window.addEventListener(EVT, read);
    window.addEventListener('storage', read);   // 다른 탭에서 바꾼 것도 따라감
    return () => { window.removeEventListener(EVT, read); window.removeEventListener('storage', read); };
  }, []);
  return m;
}
