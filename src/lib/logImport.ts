// 외부 TRPG 툴(차파챗 등) → TRPG LOG 바로 보내기
// 툴 쪽에서 `/trpg?import=<툴이름>` 을 새 창으로 열면, 이 페이지가 opener에게 준비 신호를 보내고
// opener가 postMessage로 HTML 로그를 넘겨 준다. 받은 내용은 「로그 등록」 모달을 미리 채우는 데만 쓰고
// 실제 저장은 관리자가 ADD를 눌러야 일어난다 — 자동 저장 없음.

/** 로그를 보내도 되는 사이트 — 그 외 출처의 메시지는 무시한다.
 *  더 늘리려면 Vercel 환경변수 NEXT_PUBLIC_LOG_IMPORT_ORIGINS 에 쉼표로 적는다 */
const DEFAULT_ORIGINS = [
  'https://play.chuuns.com', 'http://play.chuuns.com',
  'https://chuun.dothome.co.kr', 'http://chuun.dothome.co.kr',
];

export function allowedImportOrigins(): string[] {
  const extra = (process.env.NEXT_PUBLIC_LOG_IMPORT_ORIGINS || '')
    .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
  return [...DEFAULT_ORIGINS, ...extra];
}

export type ImportedLog = {
  source: string;      // 보낸 툴 이름 (예: chapachat)
  origin: string;      // 보낸 사이트
  html: string;        // 로그 본문 (HTML 문서 통째)
  fileName: string;    // 원본 파일로 보관할 이름
  title?: string;
  date?: string;       // YYYY-MM-DD
  withText?: string;   // 참가자
};

/** 관리자 로그인 전에 받았을 때를 대비해 잠깐 보관 — 로그인하고 다시 열면 이어서 등록 */
const PENDING_KEY = 'ohome.logImport.pending';

export function savePendingImport(p: ImportedLog) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* 용량 초과 등 — 무시 */ }
}
export function takePendingImport(): ImportedLog | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY);
    return JSON.parse(raw) as ImportedLog;
  } catch { return null; }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);

/**
 * 이 창이 `?import=` 로 열렸으면 opener에게 준비 신호를 계속 보내다가 로그가 오면 onLog를 부른다.
 * 정리 함수를 돌려준다. opener가 없거나 import 파라미터가 없으면 아무것도 안 한다.
 */
export function listenForLogImport(onLog: (p: ImportedLog) => void): () => void {
  const source = new URLSearchParams(window.location.search).get('import');
  const opener = window.opener as Window | null;
  if (!source || !opener) return () => {};
  const allowed = allowedImportOrigins();
  let done = false;

  const onMsg = (e: MessageEvent) => {
    if (done || e.source !== opener || !allowed.includes(e.origin)) return;
    const d = e.data as Record<string, unknown> | null;
    if (!d || d.type !== 'ohome:import-log' || typeof d.html !== 'string' || !d.html) return;
    done = true;
    clearInterval(timer);
    // 받았다고 알려 줘야 보낸 쪽이 재전송을 멈춘다
    try { opener.postMessage({ type: 'ohome:import-ok' }, e.origin); } catch { /* 무시 */ }
    const date = str(d.date, 10);
    onLog({
      source, origin: e.origin,
      html: d.html,
      fileName: str(d.fileName, 200) || `${source}_log.html`,
      title: str(d.title, 200),
      date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
      withText: str(d.withText, 500),
    });
  };
  window.addEventListener('message', onMsg);
  // 준비 신호에는 데이터가 없으므로 대상 출처를 가리지 않는다 — 보내는 쪽이 출처를 확인한다
  const ping = () => { try { opener.postMessage({ type: 'ohome:import-ready' }, '*'); } catch { /* 무시 */ } };
  ping();
  const timer = setInterval(() => { if (!done) ping(); }, 700);
  const stop = setTimeout(() => clearInterval(timer), 120_000);
  return () => { done = true; clearInterval(timer); clearTimeout(stop); window.removeEventListener('message', onMsg); };
}
