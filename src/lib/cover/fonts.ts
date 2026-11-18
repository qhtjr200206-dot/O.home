// 커버 메이커 폰트 6종 — 전부 웹 배포 가능한 무료 폰트(SIL OFL 1.1)만 쓴다.
// 이 PC에 깔린 폰트는 라이선스를 알 수 없어 쓰지 않는다.
//
// 캔버스는 아직 받지 않은 폰트를 대체 폰트로 그려 버린다 → 렌더·내보내기 전에 loadCoverFont를 await.
// 구글 폰트·Pretendard는 글자 범위별(unicode-range)로 쪼개져 있어서, 실제로 그릴 글자(sample)를
// 넘겨야 그 조각까지 받아진다.
import type { FontId } from './types';

export interface CoverFont {
  id: FontId;
  /** 화면 표시 이름 */
  label: string;
  /** 실제 폰트 이름 */
  name: string;
  /** CSS font-family 스택 (첫 항목이 주 폰트) */
  family: string;
  license: string;
  /** 폰트 CSS 주소 */
  css: string;
  /** 실제로 있는 굵기 — 없는 굵기를 달라고 하면 가까운 것으로 (가짜 굵게 방지) */
  weights: number[];
  /** 같은 px에서 눈에 보이는 크기를 맞추는 배율 (손글씨처럼 작게 보이는 폰트 보정) */
  scale: number;
  /** 미리보기 문구 */
  sample: string;
}

const G = (q: string) => `https://fonts.googleapis.com/css2?${q}&display=swap`;

export const FONTS: CoverFont[] = [
  {
    id: 'basic', label: '기본', name: 'Pretendard',
    family: '"Pretendard Variable", Pretendard, "Noto Sans KR", sans-serif',
    license: 'SIL OFL 1.1',
    css: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css',
    weights: [300, 400, 500, 600, 700, 800, 900], scale: 1, sample: '오늘의 플레이리스트',
  },
  {
    id: 'cute', label: '귀여운', name: 'Jua',
    family: '"Jua", "Pretendard Variable", sans-serif',
    license: 'SIL OFL 1.1', css: G('family=Jua'),
    weights: [400], scale: 1.02, sample: '말랑한 오후',
  },
  {
    id: 'hand', label: '손글씨', name: 'Nanum Pen Script',
    family: '"Nanum Pen Script", "Pretendard Variable", cursive',
    license: 'SIL OFL 1.1', css: G('family=Nanum+Pen+Script'),
    weights: [400], scale: 1.32, sample: '너에게 쓰는 노래',
  },
  {
    id: 'sf', label: 'SF', name: 'Orbitron + Do Hyeon',
    // 라틴·숫자는 Orbitron, 한글은 Do Hyeon이 받는다 (Orbitron에는 한글이 없다)
    family: '"Orbitron", "Do Hyeon", sans-serif',
    license: 'SIL OFL 1.1', css: G('family=Orbitron:wght@400;500;700;900&family=Do+Hyeon'),
    weights: [400, 500, 700, 900], scale: 0.96, sample: 'NEON 2099 신호',
  },
  {
    id: 'oriental', label: '동양풍', name: 'Song Myung',
    family: '"Song Myung", "Noto Serif KR", serif',
    license: 'SIL OFL 1.1', css: G('family=Song+Myung'),
    weights: [400], scale: 1.04, sample: '달빛 아래 노래',
  },
  {
    id: 'retro', label: '레트로', name: 'Galmuri11',
    family: 'Galmuri11, "Pretendard Variable", monospace',
    license: 'SIL OFL 1.1', css: 'https://cdn.jsdelivr.net/npm/galmuri@2.40.3/dist/galmuri.css',
    weights: [400, 700], scale: 0.94, sample: 'PLAY 픽셀 테이프',
  },
];

/** 시간·숫자 표시용 고정폭 (OFL) */
export const MONO_FAMILY = '"Space Mono", ui-monospace, monospace';
const MONO_CSS = G('family=Space+Mono:wght@400;700');

const byId = (id: FontId) => FONTS.find(f => f.id === id) ?? FONTS[0];

export function fontFamily(id: FontId): string {
  return byId(id).family;
}

/** 없는 굵기는 가장 가까운 실제 굵기로 */
export function snapWeight(id: FontId, w: number): number {
  const ws = byId(id).weights;
  return ws.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a), ws[0]);
}

/** 캔버스 ctx.font 문자열 — 폰트별 크기 보정·굵기 맞춤 포함 */
export function fontCss(id: FontId, px: number, weight = 400): string {
  const f = byId(id);
  return `${snapWeight(id, weight)} ${Math.max(1, px * f.scale).toFixed(2)}px ${f.family}`;
}

/* ---------- 로드 ---------- */

const linked = new Map<string, Promise<void>>();

function linkCss(href: string): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const hit = linked.get(href);
  if (hit) return hit;
  const p = new Promise<void>(resolve => {
    const el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = href;
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve();
    el.onerror = () => resolve();   // 실패해도 대체 폰트로 계속
    document.head.appendChild(el);
  });
  linked.set(href, p);
  return p;
}

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<void>(r => setTimeout(r, ms))]);

/** 스택에서 실제 웹폰트 이름만 (generic·시스템 대체 제외) */
const webFamilies = (family: string) =>
  family.split(',').map(s => s.trim())
    .filter(s => !/^(serif|sans-serif|monospace|cursive|ui-monospace)$/.test(s) && !/Noto|^Pretendard$/.test(s));

/** 폰트 CSS를 붙이고 sample 글자에 필요한 조각까지 실제로 받아질 때까지 기다린다 (최대 약 8초) */
export async function loadCoverFont(id: FontId, sample: string): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.fonts) return;
  const f = byId(id);
  const text = (sample || '') + f.sample + 'ABCabc0123:';
  // 긴 가사는 글자 종류만 남긴다 (load의 text 인자는 필요한 조각을 고르는 데만 쓰인다)
  const uniq = Array.from(new Set(Array.from(text))).join('');
  const css = [f.css, MONO_CSS];
  // 다른 폰트 스택이 대체로 Pretendard를 쓰므로 함께 붙인다
  if (f.id !== 'basic') css.push(FONTS[0].css);
  await withTimeout(Promise.all(css.map(linkCss)), 6000);
  const jobs: Promise<unknown>[] = [];
  for (const fam of webFamilies(f.family).slice(0, 2)) {
    for (const w of f.weights) jobs.push(document.fonts.load(`${w} 48px ${fam}`, uniq).catch(() => null));
  }
  for (const w of [400, 700]) jobs.push(document.fonts.load(`${w} 48px "Space Mono"`, '0123456789:-/').catch(() => null));
  await withTimeout(Promise.all(jobs), 8000);
}

/** 폰트 고르기 화면용 — 6종 미리보기 문구만 미리 받아 둔다 */
export function preloadFontPreviews(): Promise<void[]> {
  return Promise.all(FONTS.map(f => loadCoverFont(f.id, f.label + f.sample)));
}
