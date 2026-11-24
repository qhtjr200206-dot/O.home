// 도트 캐릭터 래스터라이저 — DOM·React 없이 브라우저, Node 스크립트, 마을 게임에서 함께 쓴다.
//
// v2.1 (사용자 요청 "도트 캐릭터 너무 밤티" → 레퍼런스: 머리가 몸의 2/3쯤 되는 작은 SD 도트):
//  · 예전 128×128 고해상도 도형 그리기를 버리고, 32×32 원본 격자에 한 칸씩 찍은 SD 도트를 4배로 키운다.
//    큰 격자에 매끈한 도형을 그리면 "도트"가 아니라 뭉개진 일러스트처럼 보였다 — 작은 격자, 굵은 외곽선,
//    큰 눈, 짧은 몸이 레퍼런스의 핵심이다.
//  · 머리는 앞머리(16)와 뒷머리(단발 20 + 장발 20)를 따로 고른다 (사용자 요청).
//  · 출력은 예전과 같은 128×128 버퍼(0xRRGGBBAA)라 마을·SVG·서버 코드는 그대로 쓴다.
// 그림은 전부 이 저장소에서 직접 찍었다 (외부 에셋 없음 — docs/pixel-avatar-research.md).

export interface PixelAvatarData {
  /** 예전(v2.0) 머리 번호 0..23 — back/front가 없을 때만 그 둘로 바꿔 읽는다 */
  hair?: number;
  /** 뒷머리 0..39 (0–19 단발, 20–39 장발) */
  back?: number;
  /** 앞머리 0..15 */
  front?: number;
  face: number;
  body: number;
  hairColor: string;
  skinColor: string;
  bodyColor: string;
  eyeColor?: string;
}

/** 출력 버퍼 한 변 (원본 32칸 × 4배) */
export const PIXEL_AVATAR_SIZE = 128;
/** 원본 격자 한 변 */
export const PIXEL_GRID = 32;
/** 표정·몸 종류 수 */
export const PIXEL_STYLE_COUNT = 24;
export const BACK_HAIR_COUNT = 40;
export const SHORT_HAIR_COUNT = 20;
export const FRONT_HAIR_COUNT = 16;
export const DEFAULT_EYE_COLOR = '#5a3d6e';
export const DEFAULT_PIXEL_AVATAR: PixelAvatarData = {
  back: 2, front: 0, face: 0, body: 0,
  hairColor: '#554050', skinColor: '#f2cdb4', bodyColor: '#647a9a',
};

export const BACK_HAIR_NAMES = [
  // 단발 0–19
  '숏컷', '투블럭', '보브', '일자 단발', '울프컷', '레이어드 단발', '곱슬 단발', '아프로', '바가지', '짧은 포니테일',
  '똥머리 단발', '반묶음 단발', '바깥 뻗침', 'C컬 단발', '짧은 양갈래', '삐침 숏', '더벅머리', '짧은 땋은머리', '고양이귀 단발', '올백 숏',
  // 장발 20–39
  '긴 생머리', '허리 아래 생머리', '웨이브 장발', '트윈테일', '낮은 트윈테일', '포니테일', '사이드테일', '양갈래 땋은머리', '한 갈래 땋은머리', '히메컷 장발',
  '드릴 트윈테일', '반묶음 장발', '똥머리 장발', '경단 머리', '곱슬 장발', '레이어드 장발', '낮은 포니테일', '리본 장발', '여우귀 장발', '부스스 장발',
] as const;
export const FRONT_HAIR_NAMES = [
  '일자 앞머리', '시스루 뱅', '5:5 가르마', '옆으로 넘긴', '뾰족 앞머리', '깐 이마', '한쪽 눈 가림', '세 갈래',
  'M자 앞머리', '짧은 처피 뱅', '7:3 가르마', '더듬이 앞머리', '바람머리+아호게', '히메 앞머리', '커튼 뱅', '헝클어진 앞머리',
] as const;
/** 예전(v2.0) 머리 이름 — 옛 데이터 해석용 */
export const HAIR_STYLE_NAMES = [
  '숏컷', '보브', '롱 스트레이트', '트윈테일', '포니테일', '똥머리', '곱슬', '삐침머리',
  '웨이브 장발', '투블럭', '양갈래 땋은머리', '히메컷', '울프컷', '올백', '사이드테일', '더벅머리',
  '고양이귀', '반묶음', '드레드', '아프로', '베레모', '리본 롱', '바가지', '모히칸',
] as const;
/** 예전 머리 번호 → [뒷머리, 앞머리] — 저장된 캐릭터가 비슷한 모양으로 이어지게 */
const LEGACY_HAIR: readonly (readonly [number, number])[] = [
  [0, 9], [2, 0], [20, 0], [23, 0], [25, 3], [10, 2], [6, 15], [15, 4],
  [22, 14], [1, 3], [27, 0], [29, 13], [4, 15], [19, 5], [26, 10], [16, 6],
  [18, 0], [31, 2], [39, 15], [7, 9], [3, 0], [37, 1], [8, 0], [15, 5],
];
export const FACE_STYLE_NAMES = [
  '기본 미소', '웃음 ^^', '놀람', '화남', '울음', '윙크', '졸림', '무표정',
  '부끄러움', '메롱', '고양이입', '결의', '걱정', '반짝눈', '실눈', '하트눈',
  '식은땀', '시무룩', '득의양양', '멍함', '째려봄', '하품', '안경', '반창고',
] as const;
export const BODY_STYLE_NAMES = [
  '티셔츠', '후드티', '세일러 교복', '정장', '원피스', '한복', '갑옷', '마법사 로브',
  '우주복', '멜빵', '앞치마', '트렌치코트', '체육복', '터틀넥 스웨터', '셔츠+조끼', '드레스',
  '파일럿 재킷', '의사 가운', '탱크톱', '망토', '군복', '파자마', '점프수트', '스카프+재킷',
] as const;

/** '#RGB' / '#RRGGBB' (대소문자 무관) → '#rrggbb', 그 밖은 null */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (/^#[\da-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[\da-f]{3}$/i.test(v)) return ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase();
  return null;
}

const indexOr = (value: unknown, count: number): number | null => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < count ? n : null;
};
/** 옛 데이터에도 안전한 번호: 0..count-1 정수(또는 정수 문자열), 아니면 0 */
export function normalizeStyleIndex(value: unknown, count = PIXEL_STYLE_COUNT): number {
  return indexOr(value, count) ?? 0;
}

export function normalizePixelAvatar(value: unknown): Required<PixelAvatarData> {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof PixelAvatarData, unknown>>;
  const legacy = indexOr(v.hair, HAIR_STYLE_NAMES.length);
  const fromLegacy = legacy === null ? null : LEGACY_HAIR[legacy];
  return {
    hair: legacy ?? 0,
    back: indexOr(v.back, BACK_HAIR_COUNT) ?? fromLegacy?.[0] ?? DEFAULT_PIXEL_AVATAR.back!,
    front: indexOr(v.front, FRONT_HAIR_COUNT) ?? fromLegacy?.[1] ?? DEFAULT_PIXEL_AVATAR.front!,
    face: normalizeStyleIndex(v.face),
    body: normalizeStyleIndex(v.body),
    hairColor: normalizeHexColor(v.hairColor) ?? DEFAULT_PIXEL_AVATAR.hairColor,
    skinColor: normalizeHexColor(v.skinColor) ?? DEFAULT_PIXEL_AVATAR.skinColor,
    bodyColor: normalizeHexColor(v.bodyColor) ?? DEFAULT_PIXEL_AVATAR.bodyColor,
    eyeColor: normalizeHexColor(v.eyeColor) ?? DEFAULT_EYE_COLOR,
  };
}

/* ------------------------------------------------------------------ 색 */

const rgba = (r: number, g: number, b: number) => ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
const hex = (h: string) => rgba(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));

function toHsl(c: number): [number, number, number] {
  const r = (c >>> 24) / 255, g = ((c >>> 16) & 255) / 255, b = ((c >>> 8) & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number) {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgba(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
}
const hueToward = (h: number, target: number, amt: number) => {
  const d = ((target - h + 540) % 360) - 180;
  return h + Math.sign(d) * Math.min(Math.abs(d), amt);
};
function mix(a: number, b: number, t: number) {
  const ch = (s: number) => Math.round(((a >>> s) & 255) * (1 - t) + ((b >>> s) & 255) * t);
  return rgba(ch(24), ch(16), ch(8));
}

/**
 * 색 하나 → [_, 밝은면, 기본, 그림자, 깊은 그림자, 외곽선].
 * 명도를 0.17~0.86으로 묶어 검정·흰색도 명암과 외곽선이 남는다. 그림자는 파랑 쪽, 밝은면은 노랑 쪽으로
 * 색조를 옮긴다 (hue shifting). 외곽선은 순검정이 아니라 그 색의 아주 어두운 버전 — 레퍼런스의 파란 머리
 * 외곽선이 짙은 남색인 것처럼.
 */
function makeRamp(color: number, soft = 1): number[] {
  const [h, s, l] = toHsl(color);
  const L = Math.max(0.17, Math.min(0.86, l));
  const mid = L === l ? color : fromHsl(h, s, L);
  return [0,
    fromHsl(hueToward(h, 55, 8), s * 0.95, Math.min(0.95, L + 0.12)),
    mid,
    fromHsl(hueToward(h, 255, 10 * soft), Math.min(1, s * 1.05 + 0.04 * soft), Math.max(L * 0.66, L - 0.13 * soft)),
    fromHsl(hueToward(h, 255, 16), Math.min(1, s * 1.1 + 0.06), Math.max(L * 0.42, L - 0.26)),
    fromHsl(hueToward(h, 255, 20), Math.min(0.9, s * 0.9 + 0.12), Math.min(0.2, Math.max(0.07, L * 0.3))),
  ];
}
const flat = (c: number, line = c) => [0, c, c, c, c, line];
const accentOf = (c: number) => { const [h, s] = toHsl(c); return fromHsl(h + 150, Math.max(0.5, Math.min(0.75, s)), 0.6); };
const darkerOf = (c: number) => { const [h, s, l] = toHsl(c); return fromHsl(h, s * 0.85, Math.max(0.18, l - 0.2)); };

/* ------------------------------------------------------------------ 재질 */

// 재질 번호 (0 = 비어 있음)
const HAIR = 1, SKIN = 2, EYE = 3, WHITE = 4, LINE = 5, MOUTH = 6, BLUSH = 7, CLOTH = 8, CLOTH2 = 9,
  LIGHT = 10, ACCENT = 11, SHOE = 12, METAL = 13, PANTS = 14, TEAR = 15, HEART = 16, GOLD = 17;
// 층 — 뒤에서 앞으로. 앞 층과 맞닿은 뒤 층 픽셀이 앞 층의 외곽선이 된다
const Z_BACK = 1, Z_LEGS = 2, Z_BODY = 3, Z_ARMS = 4, Z_HEAD = 5, Z_FRONT = 6, Z_TOP = 7;
// 톤 — 램프 번호
const T_HI = 1, T_BASE = 2, T_SHADE = 3, T_DEEP = 4;
/** 눈동자 가운데 반사광 — 눈 램프에만 있다 (6번째 칸) */
const T_GLINT = 6;
/** 머리 하이라이트를 감싸는 색 — 기본보다 채도만 살짝 낮다 (머리 램프 7번째 칸) */
const T_SOFT = 7;

const N = PIXEL_GRID;

class Grid {
  mat = new Uint8Array(N * N);
  z = new Uint8Array(N * N);
  tone = new Uint8Array(N * N);
  layer = 0;
  set(x: number, y: number, m: number, t = T_BASE) {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    const i = y * N + x;
    this.mat[i] = m; this.z[i] = this.layer; this.tone[i] = t;
  }
  at(x: number, y: number) { return x < 0 || y < 0 || x >= N || y >= N ? 0 : this.mat[y * N + x]; }
  clear(x: number, y: number) { if (x >= 0 && y >= 0 && x < N && y < N) { const i = y * N + x; this.mat[i] = 0; this.z[i] = 0; } }
  /** 좌우 대칭으로 한 점 */
  sym(x: number, y: number, m: number, t = T_BASE) { this.set(x, y, m, t); this.set(N - 1 - x, y, m, t); }
  /** 가로줄 x0..x1 (포함) */
  row(y: number, x0: number, x1: number, m: number, t = T_BASE) { for (let x = x0; x <= x1; x++) this.set(x, y, m, t); }
  /** 대칭 가로줄: x0..(31-x0) 전체 */
  span(y: number, x0: number, m: number, t = T_BASE) { this.row(y, x0, N - 1 - x0, m, t); }
  rect(x0: number, y0: number, x1: number, y1: number, m: number, t = T_BASE) { for (let y = y0; y <= y1; y++) this.row(y, x0, x1, m, t); }
  /** 문자 그림 찍기. 키에 없는 글자는 건너뛴다. mirror면 좌우 반대편에도 */
  draw(x0: number, y0: number, rows: readonly string[], key: Record<string, readonly [number, number]>, mirror = false) {
    rows.forEach((r, dy) => {
      for (let dx = 0; dx < r.length; dx++) {
        const k = key[r[dx]];
        if (!k) continue;
        this.set(x0 + dx, y0 + dy, k[0], k[1]);
        if (mirror) this.set(N - 1 - (x0 + dx), y0 + dy, k[0], k[1]);
      }
    });
  }
}

/* ------------------------------------------------------------------ 머리 */

/** 뒷머리 기본 판 — top..bottom 행, 가장 바깥 열 x0. 끝 모양으로 단발/장발 느낌을 낸다 */
function backBase(g: Grid, x0: number, top: number, bottom: number,
  end: 'round' | 'flat' | 'jag' | 'flip' | 'curl' | 'point' = 'round', wave = 0) {
  const long = bottom - top >= 14;
  for (let y = top; y <= bottom; y++) {
    let x = y === top ? x0 + 4 : y === top + 1 ? x0 + 2 : y === top + 2 ? x0 + 1 : x0;
    if (wave && y > top + 4) x += ((y + wave) >> 1) & 1 ? 0 : 1;
    let xl = x, xr = x;
    // 긴 머리는 정직한 직선을 피한다 (v2.1 사용자 피드백): 어깨쯤에서 한 칸 부풀었다가 끝으로 갈수록 모이고,
    // 좌우가 서로 다른 행에서 한 칸씩 들고 나 머리 다발이 갈라진 느낌을 낸다
    if (long && y > top + 4 && y < bottom - 1) {
      const t = (y - top) / (bottom - top);
      const bulge = t > 0.38 && t < 0.72 ? -1 : t >= 0.86 ? 1 : 0;
      // 한 줄짜리 홈은 파인 것처럼 보여서 두 줄씩 들고 난다
      const yy = y >> 1;
      xl += bulge + ((yy * 5) % 7 === 3 ? 1 : 0);
      xr += bulge + ((yy * 3) % 7 === 5 ? 1 : 0);
    }
    if (y === bottom) {
      if (end === 'round' || end === 'curl') { xl += 1; xr += 1; }
      if (end === 'point') { xl += 3; xr += 3; }
    }
    if (y === bottom - 1 && end === 'point') { xl += 1; xr += 1; }
    if (end === 'flip' && y >= bottom - 1) { xl -= 1; xr -= 1; }
    if (long && y >= bottom - 1 && end !== 'point') { xl += 1; xr += 1; }
    g.row(y, xl, N - 1 - xr, HAIR);
    // 긴 일자 끝도 가지런한 직선이 되지 않게 — 맨 끝 줄은 다발 사이를 한 칸씩 비운다
    if (long && y === bottom && (end === 'flat' || end === 'round')) for (let k = xl + 3; k < N - 2 - xr; k += 5) { g.clear(k, y); g.clear(k + 1, y); }
  }
  // 머리끝을 두 칸 간격으로 한 칸 더 내려 결을 낸다 (긴 머리는 간격을 들쭉날쭉하게)
  // 뾰족한 끝 한 칸은 허용하되, 그 사이는 두 칸 이상 비운다 (한 칸 홈 금지)
  if (end === 'jag') for (let x = x0, i = 0; x < N / 2; x += long ? 3 + (i++ % 2) : 3) g.sym(x, bottom + 1, HAIR);
  shadeBack(g, top + 3, bottom + 1);
}

/**
 * 뒷머리는 앞머리보다 한 톤 어둡게 (깊이감) — 왼쪽 바깥 한 줄만 기본 톤으로 남겨 좌상단 빛을 받게 하고,
 * 오른쪽 바깥 줄은 더 어둡게. 넓은 장발이 한 색 덩어리로 보이던 문제 (v2.1).
 */
function shadeBack(g: Grid, y0: number, y1: number) {
  for (let y = y0; y <= y1; y++) {
    let first = -1, last = -1;
    for (let x = 0; x < N; x++) if (g.at(x, y) === HAIR && g.z[y * N + x] === Z_BACK) { if (first < 0) first = x; last = x; }
    if (first < 0) continue;
    for (let x = first; x <= last; x++) {
      if (g.at(x, y) !== HAIR || g.z[y * N + x] !== Z_BACK) continue;
      g.tone[y * N + x] = x === first || (x === first + 1 && y % 5 === 1) ? T_BASE : x === last ? T_DEEP : T_SHADE;
    }
  }
}

/** 머리 묶은 끈 (보색) */
const tie = (g: Grid, x: number, y: number, w = 2) => { const l = g.layer; g.layer = Z_TOP; g.row(y, x, x + w - 1, ACCENT); g.layer = l; };

/** 세로로 늘어진 머리 다발 — 폭 w, drift행마다 dir쪽으로 1칸 */
function strand(g: Grid, x: number, y0: number, y1: number, w: number, dir: -1 | 0 | 1, drift = 4) {
  const out = x < N / 2 ? -1 : 1;
  for (let y = y0; y <= y1; y++) {
    // 긴 다발은 바깥으로 살짝 휘었다 돌아오게 — 곧은 막대처럼 보이지 않게 (v2.1 사용자 피드백)
    const k = y - y0, sway = y1 - y0 >= 8 && k > 2 && y < y1 - 1 ? ((k + 2) % 9 < 4 ? out : 0) : 0;
    const sx = x + dir * Math.floor(k / drift) + sway;
    if (y === y1) g.row(y, sx + (w > 1 ? 1 : 0), sx + w - 1, HAIR);
    else g.row(y, sx, sx + w - 1, HAIR);
  }
}
/** 땋은머리 — 두 칸 폭, 마디마다 엇갈린 그림자 */
function braid(g: Grid, x: number, y0: number, y1: number) {
  for (let y = y0; y <= y1; y++) {
    const odd = (y - y0) & 1;
    g.set(x, y, HAIR, odd ? T_SHADE : T_BASE);
    g.set(x + 1, y, HAIR, odd ? T_BASE : T_SHADE);
  }
  g.set(x, y1 + 1, HAIR, T_SHADE);
  tie(g, x, y1 - 1);
}
/** 드릴(소라) — 세 칸 폭, 사선 그림자 */
function drill(g: Grid, x: number, y0: number, y1: number) {
  for (let y = y0; y <= y1; y++) {
    const k = (y - y0) % 3, narrow = y > y1 - 2;
    for (let i = 0; i < (narrow ? 2 : 3); i++) g.set(x + i + (narrow ? 1 : 0), y, HAIR, i === k ? T_SHADE : i === (k + 2) % 3 ? T_HI : T_BASE);
  }
}
/** 둥근 경단 (r=1 → 3×3, r=2 → 5×4) */
function bun(g: Grid, cx: number, cy: number, r: number) {
  if (r <= 1) { g.set(cx, cy - 1, HAIR); g.row(cy, cx - 1, cx + 1, HAIR); g.row(cy + 1, cx - 1, cx + 1, HAIR); return; }
  g.row(cy - 2, cx - 1, cx + 1, HAIR); g.row(cy - 1, cx - 2, cx + 2, HAIR); g.row(cy, cx - 2, cx + 2, HAIR); g.row(cy + 1, cx - 1, cx + 1, HAIR);
  g.set(cx - 1, cy - 1, HAIR, T_HI);
}
/** 동물 귀 — fox면 더 높고 뾰족 */
function ears(g: Grid, fox: boolean) {
  const rows = fox
    ? ['..h....', '..hh...', '.hah...', '.haah..', 'haaah..', 'hhhhh..']
    : ['.h.....', '.hh....', 'hahh...', 'haah...', 'hhhh...'];
  g.draw(fox ? 7 : 8, fox ? 0 : 1, rows, { h: [HAIR, T_BASE], a: [ACCENT, T_HI] }, true);
}
/** 리본 (5×3) */
function ribbon(g: Grid, x: number, y: number) {
  const l = g.layer; g.layer = Z_TOP;
  g.draw(x, y, ['aa.aa', 'aaAaa', 'a...a'], { a: [ACCENT, T_BASE], A: [ACCENT, T_SHADE] });
  g.layer = l;
}

type BackFn = (g: Grid) => void;
const BACKS: BackFn[] = [
  // ---- 단발 ----
  g => { backBase(g, 7, 4, 12, 'round'); },                                                   // 0 숏컷
  g => { backBase(g, 8, 3, 10, 'flat'); g.span(2, 11, HAIR); },                               // 1 투블럭 — 윗머리 볼륨
  g => { backBase(g, 6, 4, 18, 'curl'); },                                                    // 2 보브
  g => { backBase(g, 6, 4, 19, 'flat'); },                                                    // 3 일자 단발
  g => { backBase(g, 6, 4, 19, 'jag'); g.sym(5, 14, HAIR); g.sym(5, 17, HAIR); g.sym(4, 18, HAIR); }, // 4 울프컷
  g => { backBase(g, 6, 4, 17, 'jag'); g.sym(5, 12, HAIR); g.sym(5, 15, HAIR); },              // 5 레이어드 단발
  g => { backBase(g, 5, 4, 17, 'round', 1); g.sym(4, 10, HAIR); g.sym(4, 14, HAIR); },         // 6 곱슬 단발
  g => { for (let y = 0; y <= 20; y++) { const d = (y - 9.5) / 11; const hw = Math.round(13.2 * Math.sqrt(Math.max(0, 1 - d * d))); if (hw > 0) g.row(y, 16 - hw, 15 + hw, HAIR); } shadeBack(g, 3, 20); }, // 7 아프로
  g => { backBase(g, 5, 3, 13, 'flat'); },                                                    // 8 바가지
  g => { backBase(g, 7, 4, 12); strand(g, 23, 4, 14, 3, 1, 5); tie(g, 23, 5); },             // 9 짧은 포니테일
  g => { backBase(g, 7, 4, 13); bun(g, 15, 2, 2); bun(g, 16, 2, 2); tie(g, 14, 4, 4); },      // 10 똥머리 단발
  g => { backBase(g, 6, 4, 17, 'round'); bun(g, 16, 2, 1); tie(g, 15, 3, 3); },               // 11 반묶음 단발
  g => { backBase(g, 6, 4, 16, 'flip'); g.sym(4, 16, HAIR); },                                // 12 바깥 뻗침
  g => { backBase(g, 6, 4, 17, 'curl'); g.sym(5, 13, HAIR); g.sym(5, 14, HAIR); g.sym(5, 15, HAIR); }, // 13 C컬 단발
  g => { backBase(g, 7, 4, 12); strand(g, 4, 9, 17, 3, -1, 6); tie(g, 4, 9, 3); strand(g, 25, 9, 17, 3, 1, 6); tie(g, 25, 9, 3); }, // 14 짧은 양갈래
  g => { backBase(g, 7, 3, 12, 'jag'); g.draw(4, 0, ['....h.h', '...hhhh', '.hhh...', '..h....', 'hhh....', '.hh....', '...h...', '.hh....'], { h: [HAIR, T_BASE] }, true); }, // 15 삐침 숏
  g => { backBase(g, 5, 3, 15, 'jag', 1); g.sym(4, 8, HAIR); g.sym(4, 12, HAIR); },          // 16 더벅머리
  g => { backBase(g, 7, 4, 13); braid(g, 5, 11, 20); },                                      // 17 짧은 땋은머리
  g => { backBase(g, 6, 4, 17, 'curl'); ears(g, false); },                                    // 18 고양이귀 단발
  g => { backBase(g, 7, 2, 11, 'flat'); g.span(1, 10, HAIR); g.span(0, 12, HAIR); },          // 19 올백 숏
  // ---- 장발 ----
  g => { backBase(g, 6, 4, 27, 'flat'); },                                                    // 20 긴 생머리
  g => { backBase(g, 6, 4, 29, 'point'); g.sym(5, 20, HAIR); g.sym(5, 25, HAIR); },           // 21 허리 아래 생머리
  g => { backBase(g, 5, 4, 26, 'jag', 1); },                                                  // 22 웨이브 장발
  g => { backBase(g, 7, 4, 13); strand(g, 3, 4, 26, 3, -1, 9); tie(g, 4, 5, 2); strand(g, 26, 4, 26, 3, 1, 9); tie(g, 26, 5, 2); }, // 23 트윈테일
  g => { backBase(g, 6, 4, 16); strand(g, 4, 14, 27, 3, 0); tie(g, 4, 15, 3); strand(g, 25, 14, 27, 3, 0); tie(g, 25, 15, 3); }, // 24 낮은 트윈테일
  g => { backBase(g, 7, 4, 12); g.row(2, 17, 21, HAIR); g.row(3, 19, 24, HAIR); strand(g, 23, 4, 25, 3, 1, 10); tie(g, 22, 3, 2); }, // 25 포니테일
  g => { backBase(g, 7, 4, 13); strand(g, 3, 6, 25, 3, -1, 12); tie(g, 4, 7, 3); },          // 26 사이드테일
  g => { backBase(g, 7, 4, 15); braid(g, 5, 14, 27); braid(g, 25, 14, 27); },                // 27 양갈래 땋은머리
  g => { backBase(g, 7, 4, 15); g.layer = Z_ARMS + 1; braid(g, 20, 19, 28); g.layer = Z_BACK; }, // 28 한 갈래 땋은머리 (어깨 앞으로)
  g => { backBase(g, 5, 4, 28, 'flat'); },                                                    // 29 히메컷 장발
  g => { backBase(g, 7, 4, 13); drill(g, 3, 7, 24); drill(g, 26, 7, 24); tie(g, 4, 6, 3); tie(g, 25, 6, 3); }, // 30 드릴 트윈테일
  g => { backBase(g, 6, 4, 25, 'jag'); bun(g, 16, 2, 1); ribbon(g, 13, 0); },                // 31 반묶음 장발
  g => { backBase(g, 6, 4, 26, 'flat'); bun(g, 15, 1, 2); bun(g, 16, 1, 2); tie(g, 14, 3, 4); }, // 32 똥머리 장발
  g => { backBase(g, 7, 4, 13); bun(g, 8, 3, 2); bun(g, 23, 3, 2); strand(g, 5, 6, 25, 2, -1, 12); strand(g, 25, 6, 25, 2, 1, 12); }, // 33 경단 머리
  g => { backBase(g, 4, 4, 26, 'round', 1); g.sym(3, 12, HAIR); g.sym(3, 17, HAIR); g.sym(3, 22, HAIR); }, // 34 곱슬 장발
  g => { backBase(g, 6, 4, 25, 'jag'); g.sym(5, 14, HAIR); g.sym(5, 19, HAIR); g.sym(4, 20, HAIR); }, // 35 레이어드 장발
  g => { backBase(g, 7, 4, 15); g.layer = Z_ARMS + 1; strand(g, 20, 18, 27, 2, 0); g.layer = Z_BACK; tie(g, 20, 19, 2); }, // 36 낮은 포니테일 (어깨 앞)
  g => { backBase(g, 6, 4, 27, 'flat'); ribbon(g, 19, 1); },                                  // 37 리본 장발
  g => { backBase(g, 6, 4, 27, 'jag'); ears(g, true); },                                      // 38 여우귀 장발
  g => { backBase(g, 4, 3, 28, 'jag', 1); g.sym(3, 9, HAIR); g.sym(2, 14, HAIR); g.sym(3, 20, HAIR); }, // 39 부스스 장발
];

/** 앞머리 정의 — fringe: 얼굴 칸(x 9..22)별 머리 끝 행. 7개면 왼쪽 절반(좌우 대칭), 14개면 전체 */
interface Front { fringe: readonly number[]; side: number | readonly [number, number]; lock?: number; hime?: boolean; ahoge?: boolean; tuft?: boolean; part?: number }
const FRONTS: Front[] = [
  { fringe: [12, 11, 11, 11, 11, 11, 11], side: 13 },                                   // 0 일자
  { fringe: [13, 13, 10, 10, 12, 12, 9], side: 14 },                                    // 1 시스루
  { fringe: [13, 12, 11, 10, 9, 8, 6], side: 15, part: 15 },                            // 2 5:5
  { fringe: [10, 9, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 15], side: [12, 16] },    // 3 옆으로 넘긴
  { fringe: [12, 12, 10, 10, 12, 12, 10], side: 13, tuft: true },                       // 4 뾰족
  { fringe: [9, 8, 7, 7, 6, 6, 6], side: 12 },                                          // 5 깐 이마
  { fringe: [11, 10, 10, 10, 10, 11, 12, 13, 14, 15, 16, 17, 17, 17], side: [13, 18] }, // 6 한쪽 눈 가림
  { fringe: [13, 11, 11, 12, 12, 9, 9], side: 14 },                                     // 7 세 갈래
  { fringe: [12, 11, 10, 10, 11, 12, 10], side: 13 },                                   // 8 M자
  { fringe: [10, 9, 9, 9, 9, 9, 9], side: 12 },                                         // 9 짧은 처피
  { fringe: [11, 10, 8, 6, 8, 9, 10, 10, 11, 11, 12, 12, 13, 14], side: [13, 15], part: 12 }, // 10 7:3
  { fringe: [12, 11, 11, 10, 11, 10, 11], side: 13, lock: 21 },                         // 11 더듬이
  { fringe: [12, 11, 11, 10, 10, 11, 10], side: 14, ahoge: true },                      // 12 바람머리+아호게
  { fringe: [11, 11, 11, 11, 11, 11, 11], side: 18, hime: true },                       // 13 히메
  { fringe: [15, 13, 12, 11, 10, 9, 8], side: 17, part: 15 },                           // 14 커튼
  { fringe: [12, 12, 10, 10, 13, 13, 11], side: 14, tuft: true },                       // 15 헝클어진
];

function drawFront(g: Grid, f: Front) {
  const fr = [...(f.fringe.length === 14 ? f.fringe : [...f.fringe, ...[...f.fringe].reverse()])];
  // 양옆보다 짧은 한 칸짜리 기둥은 이마에 파인 홈처럼 보인다 → 옆 높이에 맞춘다 (v2.1 연속성 규칙)
  for (let i = 1; i < fr.length - 1; i++) if (fr[i] < fr[i - 1] && fr[i] < fr[i + 1]) fr[i] = Math.min(fr[i - 1], fr[i + 1]);
  const [sl, sr] = typeof f.side === 'number' ? [f.side, f.side] : f.side;
  // 정수리 — 둥근 모자처럼
  g.row(3, 12, 19, HAIR); g.row(4, 10, 21, HAIR); g.row(5, 9, 22, HAIR); g.row(6, 8, 23, HAIR);
  for (let y = 7; y < N; y++) {
    // 옆머리는 끝으로 갈수록 가늘게 (바깥 줄이 두 칸 먼저 끝난다)
    if (y <= sl) { g.set(8, y, HAIR); if (y <= sl - 2) g.set(7, y, HAIR); }
    if (y <= sr) { g.set(23, y, HAIR); if (y <= sr - 2) g.set(24, y, HAIR); }
    for (let x = 9; x <= 22; x++) if (y <= fr[x - 9]) g.set(x, y, HAIR);
  }
  if (f.hime) for (let y = 12; y <= sl; y++) { g.set(9, y, HAIR); g.set(22, y, HAIR); }
  if (f.lock) for (let y = sl; y <= f.lock; y++) { g.set(8, y, HAIR); g.set(23, y, HAIR); if (y < f.lock - 1) { g.set(9, y, HAIR); g.set(22, y, HAIR); } }
  if (f.part !== undefined) for (let y = 3; y <= 5; y++) g.set(f.part, y, HAIR, T_SHADE);
  // 삐친 머리는 끝만 한 칸, 밑동은 넓게 이어지게 (띄엄띄엄 찍힌 점처럼 보이지 않게 — v2.1 피드백)
  if (f.tuft) g.draw(12, 0, ['h....h..', 'hh...hh.', 'hhh..hhh'], { h: [HAIR, T_BASE] });
  if (f.ahoge) g.draw(15, 0, ['..hh', '.h..', '.h..'], { h: [HAIR, T_BASE] });
  hairShine(g);
}

/**
 * 머리 광택 (v2.1 사용자 지정 스타일 — 스킬 ohome-pixel-chibi):
 * 하이라이트 점을 머리 둥근 모양을 따라 호(弧)로 찍고 — 가운데가 높고 양옆이 내려간다 —
 * 각 점을 주변보다 살짝 채도만 낮은 색(T_SOFT)으로 감싼다. 일자 띠는 "너무 일자고 은은하지 않다"는
 * 피드백을 받아 버렸다. 좌상단 광원이라 왼쪽 점이 더 많다.
 */
// 하이라이트는 떨어진 점이 아니라 머리 곡선을 따라 이어진 짧은 호 두 개 (v2.1 피드백 — 점점이 떨어진 건 보기 안 좋다)
const SHINE_DOTS: readonly (readonly [number, number])[] = [[10, 8], [11, 7], [12, 7], [13, 6], [14, 6], [18, 6], [19, 6], [20, 7]];
function hairShine(g: Grid) {
  const front = (x: number, y: number) => g.at(x, y) === HAIR && g.z[y * N + x] === Z_FRONT;
  const dots = SHINE_DOTS.filter(([x, y]) => front(x, y));
  for (const [x, y] of dots) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      // 대각선 아래 두 칸은 비워 둥근 후광처럼 — 네모 테두리로 보이지 않게
      if (dy === 1 && dx !== 0) continue;
      if ((dx || dy) && front(xx, yy) && g.tone[yy * N + xx] === T_BASE) g.tone[yy * N + xx] = T_SOFT;
    }
  }
  for (const [x, y] of dots) g.tone[y * N + x] = T_HI;
}

/* ------------------------------------------------------------------ 얼굴 */

const FACE_KEY: Record<string, readonly [number, number]> = {
  k: [LINE, T_BASE], w: [WHITE, T_BASE], e: [EYE, T_BASE], d: [EYE, T_SHADE], h: [EYE, T_HI], g: [EYE, T_GLINT],
  m: [MOUTH, T_BASE], M: [MOUTH, T_SHADE], b: [BLUSH, T_BASE], s: [SKIN, T_SHADE], t: [TEAR, T_BASE], r: [HEART, T_BASE],
};
/** 눈: 왼쪽 눈 기준 x 9..12, y 13..17 (오른쪽은 좌우 반전). 입: x 13..18, y 18..20 */
interface Face { eye: readonly string[]; eyeR?: readonly string[]; mouth: readonly string[]; blush?: boolean; extra?: (g: Grid) => void }
// 큰 눈 (레퍼런스처럼 세로로 긴 3×4): 위 속눈썹 + 바깥 꼬리, 위는 짙게·아래로 갈수록 밝게.
// 안광은 흰 점 대신 눈동자 밑에 밝은 눈 색을 깐다 (v2.1 사용자 요청 — 흰색은 최대한 쓰지 않는다)
// v2.1 사용자 피드백: 눈이 너무 크고 눈빛이 없어 보인다 → 홍채 3×3으로 줄이고, 가운데에 흰색에 가까운
// 밝은 눈 색(g)을 한 칸 넣어 동공 반사를 표현한다. 순백은 쓰지 않는다.
const EYE_OPEN = ['....', 'kkkk', '.dgd', '.eee', '.hhh'];
// 반짝이는 눈은 반사광을 늘리지 않고, 한 칸 띄운 아래(또는 대각선)에 반짝임을 한 점 더 찍는다
const FACES: Face[] = [
  { eye: EYE_OPEN, mouth: ['......', '..mm..'], blush: true },                                   // 0 기본 미소
  { eye: ['....', '....', '..k.', '.k.k', 'k...'], mouth: ['..kk..', '..mm..'], blush: true },    // 1 웃음 ^^
  { eye: ['....', '.kkk', '..d.', '..e.', '....'], mouth: ['..kk..', '.k..k.', '..kk..'] },       // 2 놀람
  { eye: ['k...', '.kkk', '.dgd', '.hhh', '....'], mouth: ['......', '..kk..', '.k..k.'] },       // 3 화남
  { eye: ['....', '....', 'kkkk', '.t..', '.t..'], mouth: ['......', '..kk..', '.k..k.'], extra: g => { g.sym(10, 18, TEAR); g.sym(10, 19, TEAR); } }, // 4 울음
  { eye: EYE_OPEN, eyeR: ['....', '....', 'kkk.', '...k', '....'], mouth: ['.k..k.', '..kk..'], blush: true }, // 5 윙크
  { eye: ['....', '....', '.kkk', '.ddd', '.hhh'], mouth: ['......', '...k..'] },                 // 6 졸림
  { eye: ['....', '.kkk', '.ddd', '.ege', '.hhh'], mouth: ['......', '..kk..'] },                  // 7 무표정
  { eye: EYE_OPEN, mouth: ['......', '..kk..'], extra: g => { for (const x of [9, 10, 11]) g.sym(x, 18, BLUSH); g.sym(10, 19, BLUSH); } }, // 8 부끄러움
  { eye: EYE_OPEN, eyeR: ['....', '...k', '.kk.', '...k', '....'], mouth: ['..kk..', '..mm..', '...m..'], blush: true }, // 9 메롱
  { eye: EYE_OPEN, mouth: ['......', 'k.kk.k', '.k..k.'], blush: true },                           // 10 고양이입
  { eye: ['k...', '.kkk', '.dgd', '.eee', '.hhh'], mouth: ['......', '.kkkk.'] },                   // 11 결의
  { eye: ['...k', '..k.', '.kkk', '.dgd', '.hhh'], mouth: ['......', '..kk..', '.k..k.'] },         // 12 걱정
  { eye: ['....', 'kkkk', '.dgd', '.eee', '.hgh'], mouth: ['..kk..', '..mm..'], blush: true },      // 13 반짝눈
  { eye: ['....', '....', '.kkk', '....', '....'], mouth: ['......', '..mm..'], blush: true },      // 14 실눈
  { eye: ['....', '.r.r', '.rrr', '..r.', '....'], mouth: ['..kk..', '..mm..'], blush: true },      // 15 하트눈
  { eye: EYE_OPEN, mouth: ['......', '..kk..'], extra: g => { g.layer = Z_TOP; g.draw(23, 8, ['.t', 'tt', 'tt'], FACE_KEY); g.layer = Z_HEAD; } }, // 16 식은땀
  { eye: ['....', '....', '.kkk', '.ddd', '.eee'], mouth: ['......', '..kk..', '.k..k.'] },         // 17 시무룩
  { eye: ['....', '....', 'kkkk', '.eee', '....'], mouth: ['....k.', '.kkk..'] },                    // 18 득의양양
  { eye: ['....', '....', '..k.', '..k.', '....'], mouth: ['......', '..k...'] },                    // 19 멍함
  { eye: ['....', '....', 'kkkk', '.ddd', '....'], mouth: ['......', '..kk..'] },                    // 20 째려봄
  { eye: ['....', '.k..', '..kk', '.k..', '....'], mouth: ['..kk..', '.kmmk.', '..kk..'], extra: g => { g.set(9, 17, TEAR); } }, // 21 하품
  { eye: EYE_OPEN, mouth: ['......', '..mm..'], extra: g => { g.layer = Z_TOP; g.draw(8, 13, ['kkkkk', 'k...k', 'k...k', 'k...k', 'kkkkk'], FACE_KEY, true); g.row(14, 13, 18, LINE); g.layer = Z_HEAD; } }, // 22 안경
  { eye: EYE_OPEN, mouth: ['......', '..mm..'], blush: true, extra: g => { g.layer = Z_TOP; g.draw(19, 18, ['lll', 'lLl'], { l: [LIGHT, T_BASE], L: [LIGHT, T_SHADE] }); g.layer = Z_HEAD; } }, // 23 반창고
];

function drawFace(g: Grid, f: Face) {
  g.draw(9, 13, f.eye, FACE_KEY);
  // 오른쪽 눈: 따로 없으면 왼쪽을 좌우 반전
  g.draw(19, 13, f.eyeR ?? f.eye.map(r => [...r].reverse().join('')), FACE_KEY);
  g.draw(13, 18, f.mouth, FACE_KEY);
  if (f.blush) { g.sym(9, 18, BLUSH); g.sym(10, 18, BLUSH); }
  f.extra?.(g);
}

function drawHead(g: Grid) {
  g.row(8, 10, 21, SKIN);
  for (let y = 9; y <= 18; y++) g.row(y, 9, 22, SKIN);
  g.row(19, 10, 21, SKIN); g.row(20, 11, 20, SKIN); g.row(21, 13, 18, SKIN);
  // 귀 — 옆머리가 짧으면 보인다
  g.sym(8, 14, SKIN); g.sym(8, 15, SKIN, T_SHADE);
}

/* ------------------------------------------------------------------ 몸 */

interface Outfit {
  top: number; sleeve: 'long' | 'short' | 'none' | 'puff' | 'wide'; sleeveMat?: number;
  bottom: 'pants' | 'shorts' | 'skirt' | 'long'; bottomMat?: number; leg?: number; shoe?: number;
  /** 몸통 위 꾸밈 */
  deco?: (g: Grid) => void;
  /** 팔 위에 얹는 것 (망토, 어깨 갑옷, 견장, 목도리) */
  over?: (g: Grid) => void;
}
// 몸 격자: 어깨 y22 x13..18, 몸통 y23..26 x12..19, 팔 x10..11 / 20..21, 다리 y27..29 x13..14 / 17..18, 신발 y30
// 머리(x9..22)보다 좁게 — 레퍼런스처럼 몸은 머리 폭의 70% 남짓
const OUTFITS: Outfit[] = [
  { top: CLOTH, sleeve: 'short', bottom: 'pants', bottomMat: PANTS, deco: g => { g.row(24, 15, 16, LIGHT); g.set(15, 25, LIGHT); } }, // 0 티셔츠
  { top: CLOTH, sleeve: 'long', bottom: 'pants', bottomMat: PANTS, deco: g => { g.set(14, 23, LIGHT); g.set(17, 23, LIGHT); g.set(14, 24, LIGHT); g.set(17, 24, LIGHT); g.row(25, 14, 17, CLOTH2); }, over: g => { g.row(22, 12, 13, CLOTH2); g.row(22, 18, 19, CLOTH2); } }, // 1 후드티
  { top: LIGHT, sleeve: 'long', bottom: 'skirt', bottomMat: CLOTH, deco: g => { g.row(22, 13, 18, CLOTH); g.row(23, 12, 14, CLOTH); g.row(23, 17, 19, CLOTH); g.row(24, 15, 16, ACCENT); g.set(14, 24, ACCENT); g.set(17, 24, ACCENT); } }, // 2 세일러
  { top: CLOTH, sleeve: 'long', bottom: 'pants', bottomMat: CLOTH, deco: g => { g.row(22, 14, 17, LIGHT); g.row(23, 15, 16, LIGHT); g.set(15, 23, ACCENT); g.row(24, 15, 16, ACCENT); g.set(15, 25, ACCENT); } }, // 3 정장
  { top: CLOTH, sleeve: 'puff', bottom: 'skirt', bottomMat: CLOTH, deco: g => { g.row(22, 14, 17, LIGHT); g.row(25, 12, 19, CLOTH2); } }, // 4 원피스
  { top: LIGHT, sleeve: 'wide', bottom: 'long', bottomMat: CLOTH, deco: g => { g.row(24, 12, 19, CLOTH); g.row(25, 12, 19, CLOTH); g.row(23, 15, 16, ACCENT); g.set(16, 24, ACCENT); g.set(17, 25, ACCENT); } }, // 5 한복
  { top: METAL, sleeve: 'long', bottom: 'pants', bottomMat: CLOTH2, shoe: METAL, deco: g => { g.rect(14, 23, 17, 24, CLOTH); g.row(26, 12, 19, CLOTH2); g.row(26, 15, 16, GOLD); }, over: g => { g.draw(9, 22, ['mmm', 'mMm'], { m: [METAL, T_BASE], M: [METAL, T_SHADE] }, true); } }, // 6 갑옷
  { top: CLOTH, sleeve: 'wide', bottom: 'long', bottomMat: CLOTH, deco: g => { g.row(22, 14, 17, CLOTH2); g.row(25, 12, 19, ACCENT); g.row(23, 15, 16, GOLD); g.rect(15, 26, 16, 29, CLOTH2); } }, // 7 마법사 로브
  { top: LIGHT, sleeve: 'long', bottom: 'pants', bottomMat: LIGHT, shoe: CLOTH2, deco: g => { g.rect(14, 23, 17, 25, CLOTH); g.set(15, 24, ACCENT); g.set(16, 24, GOLD); g.row(22, 13, 18, METAL); g.row(27, 12, 19, CLOTH); } }, // 8 우주복
  { top: LIGHT, sleeve: 'short', bottom: 'pants', bottomMat: CLOTH, deco: g => { g.rect(13, 24, 18, 26, CLOTH); g.rect(13, 22, 13, 23, CLOTH); g.rect(18, 22, 18, 23, CLOTH); g.set(14, 24, GOLD); g.set(17, 24, GOLD); } }, // 9 멜빵
  { top: CLOTH, sleeve: 'puff', bottom: 'skirt', bottomMat: CLOTH, deco: g => { g.rect(14, 23, 17, 28, LIGHT); g.row(22, 14, 17, LIGHT); } }, // 10 앞치마
  { top: CLOTH, sleeve: 'long', bottom: 'skirt', bottomMat: CLOTH, leg: PANTS, deco: g => { g.row(25, 12, 19, CLOTH2); g.set(15, 25, GOLD); g.set(14, 23, CLOTH2); g.set(17, 23, CLOTH2); g.row(22, 14, 17, LIGHT); g.set(15, 27, CLOTH2); g.set(15, 28, CLOTH2); }, over: g => { g.row(22, 12, 13, CLOTH2); g.row(22, 18, 19, CLOTH2); } }, // 11 트렌치코트
  { top: CLOTH, sleeve: 'long', bottom: 'pants', bottomMat: CLOTH, shoe: LIGHT, deco: g => { g.row(22, 14, 17, LIGHT); for (let y = 23; y <= 26; y++) g.set(15, y, LIGHT); g.set(13, 28, LIGHT); g.set(18, 28, LIGHT); g.set(13, 29, LIGHT); g.set(18, 29, LIGHT); }, over: g => { for (let y = 23; y <= 25; y++) { g.set(10, y, LIGHT); g.set(21, y, LIGHT); } } }, // 12 체육복
  { top: CLOTH, sleeve: 'long', bottom: 'pants', bottomMat: PANTS, deco: g => { g.row(24, 13, 18, CLOTH, T_HI); g.row(26, 13, 18, CLOTH, T_HI); }, over: g => { g.row(21, 13, 18, CLOTH); g.row(22, 13, 18, CLOTH, T_SHADE); } }, // 13 터틀넥
  { top: LIGHT, sleeve: 'long', bottom: 'pants', bottomMat: PANTS, deco: g => { g.rect(12, 23, 19, 26, CLOTH); g.row(23, 14, 17, LIGHT); g.row(24, 15, 16, LIGHT); g.set(15, 25, GOLD); g.set(15, 26, GOLD); g.row(22, 15, 16, ACCENT); } }, // 14 셔츠+조끼
  { top: CLOTH, sleeve: 'puff', bottom: 'long', bottomMat: CLOTH, deco: g => { g.row(22, 14, 17, LIGHT); g.row(24, 12, 19, ACCENT); g.row(25, 15, 16, ACCENT); g.row(29, 10, 21, LIGHT); } }, // 15 드레스
  { top: CLOTH, sleeve: 'long', bottom: 'pants', bottomMat: PANTS, deco: g => { for (let y = 23; y <= 26; y++) g.set(16, y, METAL); g.set(13, 24, CLOTH2); g.set(18, 24, CLOTH2); }, over: g => { g.row(21, 12, 14, LIGHT); g.row(21, 17, 19, LIGHT); g.row(22, 12, 14, LIGHT); g.row(22, 17, 19, LIGHT); } }, // 16 파일럿 재킷
  { top: LIGHT, sleeve: 'long', bottom: 'skirt', bottomMat: LIGHT, leg: PANTS, deco: g => { g.rect(14, 22, 17, 26, CLOTH); g.row(22, 15, 16, LIGHT); g.set(13, 24, CLOTH2); }, over: g => { g.set(18, 23, METAL); g.set(18, 24, METAL); } }, // 17 의사 가운
  { top: CLOTH, sleeve: 'none', bottom: 'shorts', bottomMat: PANTS, deco: g => { g.row(22, 14, 17, SKIN); } }, // 18 탱크톱
  { top: CLOTH2, sleeve: 'long', bottom: 'pants', bottomMat: CLOTH2, over: g => { g.row(22, 10, 21, CLOTH); for (let y = 23; y <= 28; y++) { g.row(y, 9, 12, CLOTH); g.row(y, 19, 22, CLOTH); } g.row(29, 10, 12, CLOTH, T_SHADE); g.row(29, 19, 21, CLOTH, T_SHADE); g.row(22, 15, 16, GOLD); } }, // 19 망토
  { top: CLOTH, sleeve: 'long', bottom: 'pants', bottomMat: CLOTH, shoe: CLOTH2, deco: g => { g.row(22, 14, 17, CLOTH2); g.row(25, 12, 19, CLOTH2); g.set(15, 25, GOLD); g.set(13, 23, GOLD); g.set(18, 23, GOLD); g.row(29, 13, 14, CLOTH2); g.row(29, 17, 18, CLOTH2); }, over: g => { g.row(22, 10, 11, GOLD); g.row(22, 20, 21, GOLD); } }, // 20 군복
  { top: CLOTH, sleeve: 'long', bottom: 'pants', bottomMat: CLOTH, shoe: LIGHT, deco: g => { for (const [x, y] of [[13, 23], [15, 24], [18, 23], [13, 26], [17, 26], [14, 28], [18, 29]]) g.set(x, y, LIGHT); g.row(22, 14, 17, LIGHT); } }, // 21 파자마
  { top: CLOTH, sleeve: 'short', bottom: 'pants', bottomMat: CLOTH, deco: g => { for (let y = 22; y <= 26; y++) g.set(15, y, METAL); g.row(26, 12, 19, CLOTH2); g.set(13, 23, CLOTH2); g.set(18, 23, CLOTH2); } }, // 22 점프수트
  { top: CLOTH, sleeve: 'long', bottom: 'pants', bottomMat: PANTS, deco: g => { g.rect(14, 23, 17, 26, LIGHT); }, over: g => { g.row(21, 13, 18, ACCENT); g.row(22, 12, 19, ACCENT); g.rect(17, 23, 18, 26, ACCENT); g.set(17, 27, ACCENT, T_SHADE); } }, // 23 스카프+재킷
];

function drawBody(g: Grid, o: Outfit) {
  const legMat = o.leg ?? SKIN, shoe = o.shoe ?? SHOE, bm = o.bottomMat ?? o.top;
  // 다리·신발
  g.layer = Z_LEGS;
  g.rect(13, 27, 14, 29, legMat); g.rect(17, 27, 18, 29, legMat);
  g.row(30, 12, 14, shoe); g.row(30, 17, 19, shoe);
  // 몸통
  g.layer = Z_BODY;
  g.row(22, 13, 18, o.top);
  g.rect(12, 23, 19, 26, o.top);
  switch (o.bottom) {
    case 'pants': g.row(27, 12, 19, bm); g.rect(13, 28, 14, 29, bm); g.rect(17, 28, 18, 29, bm); break;
    case 'shorts': g.row(27, 12, 19, bm); g.row(28, 13, 14, bm); g.row(28, 17, 18, bm); break;
    case 'skirt': g.row(26, 12, 19, bm); g.row(27, 11, 20, bm); g.row(28, 11, 20, bm); break;
    case 'long': g.row(26, 12, 19, bm); g.row(27, 11, 20, bm); g.row(28, 11, 20, bm); g.row(29, 10, 21, bm); break;
  }
  o.deco?.(g);
  // 팔 — 몸통 앞
  g.layer = Z_ARMS;
  const sm = o.sleeveMat ?? o.top;
  for (const s of [0, 1]) {
    const put = (x: number, y: number, m: number) => g.set(s ? N - 1 - x : x, y, m);
    switch (o.sleeve) {
      case 'long': put(12, 22, sm); for (let y = 23; y <= 25; y++) { put(10, y, sm); put(11, y, sm); } put(11, 22, sm); break;
      case 'short': put(11, 22, sm); put(12, 22, sm); put(10, 23, sm); put(11, 23, sm); for (let y = 24; y <= 25; y++) { put(10, y, SKIN); put(11, y, SKIN); } break;
      case 'none': put(12, 22, SKIN); for (let y = 23; y <= 25; y++) { put(10, y, SKIN); put(11, y, SKIN); } break;
      case 'puff': put(10, 22, sm); put(11, 22, sm); put(12, 22, sm); put(9, 23, sm); put(10, 23, sm); put(11, 23, sm); for (let y = 24; y <= 25; y++) { put(10, y, SKIN); put(11, y, SKIN); } break;
      case 'wide': put(11, 22, sm); put(12, 22, sm); for (let y = 23; y <= 26; y++) { put(9, y, sm); put(10, y, sm); put(11, y, sm); } break;
    }
    if (o.sleeve === 'wide') { put(10, 27, SKIN); put(11, 27, SKIN); } else { put(10, 26, SKIN); put(11, 26, SKIN); }
  }
  if (o.over) { g.layer = Z_ARMS + 1; o.over(g); }
}

/* ------------------------------------------------------------------ 합성 */

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const CLOTHLIKE = new Set([HAIR, CLOTH, CLOTH2, LIGHT, ACCENT, PANTS, METAL, SHOE, GOLD]);

/**
 * 연속성 정리 (v2.1 사용자 규칙 — 스킬 ohome-pixel-chibi): 머리카락에
 *  · 사방이 비어 홀로 떨어진 한 칸은 지우고 (뾰족한 끝처럼 한쪽이라도 이어진 칸은 남긴다)
 *  · 좌우나 위아래가 머리카락인 한 칸짜리 빈 홈은 메운다 — 파인 것처럼 보인다.
 */
function tidyHair(g: Grid) {
  const { mat, z, tone } = g;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (mat[i] === HAIR) {
        let any = false;
        for (let dy = -1; dy <= 1 && !any; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && g.at(x + dx, y + dy) === HAIR) { any = true; break; }
        if (!any) g.clear(x, y);
        continue;
      }
      if (mat[i]) continue;
      const h = g.at(x - 1, y) === HAIR && g.at(x + 1, y) === HAIR, v = g.at(x, y - 1) === HAIR && g.at(x, y + 1) === HAIR;
      if (!h && !v) continue;
      const j = h ? i - 1 : i - N;
      mat[i] = HAIR; z[i] = Math.min(z[j], h ? z[i + 1] : z[i + N]); tone[i] = T_BASE;
    }
  }
}

function compose(g: Grid, ramps: number[][]): Uint32Array {
  tidyHair(g);
  const { mat, z } = g;
  const tone = Uint8Array.from(g.tone);
  // 1. 명암 — 좌상단 광원. 아래 가장자리와 오른쪽 절반의 오른쪽 가장자리는 그림자
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, m = mat[i];
    if (!m || tone[i] !== T_BASE) continue;
    const below = y + 1 < N ? i + N : -1, right = x + 1 < N ? i + 1 : -1, left = x > 0 ? i - 1 : -1;
    const edgeB = below < 0 || mat[below] !== m || z[below] !== z[i];
    const edgeR = right < 0 || mat[right] !== m || z[right] !== z[i];
    if (CLOTHLIKE.has(m)) {
      if (edgeB || (edgeR && x >= 16)) tone[i] = T_SHADE;
      // 앞머리 다발 끝 — 옆 칸보다 길게 내려온 칸
      else if (m === HAIR && z[i] === Z_FRONT && y >= 9 && ((left >= 0 && mat[left] !== HAIR) || (right >= 0 && mat[right] !== HAIR))) tone[i] = T_SHADE;
    } else if (m === SKIN && edgeR && x >= 20 && y >= 9) tone[i] = T_SHADE;
  }
  // 2. 안쪽 선 — 앞 층과 맞닿은 뒤 층 픽셀은 앞 층의 외곽선 색 (머리카락 밑 피부는 그림자만)
  const outMat = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (!mat[i]) continue;
    let best = -1;
    for (const [dx, dy] of N4) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      const j = yy * N + xx;
      if (mat[j] && z[j] > z[i] && (best < 0 || z[j] > z[best])) best = j;
    }
    if (best < 0) continue;
    if (mat[i] === SKIN && mat[best] === HAIR) { tone[i] = T_SHADE; continue; }
    if (z[i] === Z_HEAD && mat[i] !== SKIN) continue; // 눈·입은 그대로
    if (mat[best] === TEAR || mat[best] === LINE) continue;
    outMat[i] = mat[best];
  }
  // 3. 바깥 외곽선 — 빈 칸이 무언가와 맞닿으면 가장 앞 층 재질의 외곽선 색
  const out = new Uint32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const m = mat[i];
    if (!m) continue;
    out[i] = outMat[i] ? ramps[outMat[i]][5] : ramps[m][tone[i]];
    // 머리카락 세로 그라데이션 (v2.1 사용자 요청): 정수리 → 머리끝으로 갈수록 깊은 그림자 색 쪽으로.
    // 도트답게 3행씩 끊어 단계로 바꾼다 (매끈한 그라데이션은 뭉개 보인다). 광택 띠·하이라이트는 단계만 따라 어두워진다
    if (m === HAIR && !outMat[i]) {
      const y = (i / N) | 0, step = Math.max(0, Math.min(5, Math.floor((y - 6) / 3)));
      if (step) out[i] = mix(out[i], ramps[HAIR][4], step * 0.12);
    }
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (mat[i]) continue;
    let best = -1;
    for (const [dx, dy] of N4) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      const j = yy * N + xx;
      if (mat[j] && (best < 0 || z[j] > z[best])) best = j;
    }
    if (best >= 0) out[i] = ramps[mat[best]][5];
  }
  return out;
}

/* ------------------------------------------------------------------ 공개 */

const cache = new Map<string, Uint32Array>();
const SCALE = PIXEL_AVATAR_SIZE / N;

function renderGrid(v: Required<PixelAvatarData>): Uint32Array {
  const g = new Grid();
  g.layer = Z_BACK; BACKS[v.back](g);
  drawBody(g, OUTFITS[v.body]);
  g.layer = Z_HEAD; drawHead(g); drawFace(g, FACES[v.face]);
  g.layer = Z_FRONT; drawFront(g, FRONTS[v.front]);
  const body = hex(v.bodyColor), skin = hex(v.skinColor);
  const skinRamp = makeRamp(skin, 0.72);
  const ramps: number[][] = [];
  const hairRamp = makeRamp(hex(v.hairColor));
  { const [h, s2, l] = toHsl(hairRamp[2]); hairRamp[T_SOFT] = fromHsl(h, s2 * 0.72, Math.min(0.9, l + 0.03)); }
  ramps[HAIR] = hairRamp;
  ramps[SKIN] = skinRamp;
  // 눈 밝은면은 한 단계 더 밝게 — 흰 점 없이 이것이 안광 역할을 한다
  const eyeRamp = makeRamp(hex(v.eyeColor));
  { const [h, s2, l] = toHsl(eyeRamp[2]); eyeRamp[1] = fromHsl(hueToward(h, 55, 12), Math.min(1, s2 * 1.05), Math.min(0.9, Math.max(l + 0.24, 0.55))); }
  eyeRamp[T_GLINT] = mix(eyeRamp[1], 0xffffffff, 0.72);
  ramps[EYE] = eyeRamp;
  ramps[WHITE] = [0, 0xffffffff, 0xffffffff, hex('#dfe6f2'), hex('#c4cddc'), hex('#5a6070')];
  ramps[LINE] = flat(hex('#2b1f2e'), hex('#1e1622'));
  ramps[MOUTH] = makeRamp(hex('#c4505e'));
  ramps[BLUSH] = flat(mix(skin, hex('#ff7f95'), 0.3), skinRamp[5]);
  ramps[CLOTH] = makeRamp(body);
  ramps[CLOTH2] = makeRamp(darkerOf(body));
  ramps[LIGHT] = makeRamp(hex('#f3efe8'));
  ramps[ACCENT] = makeRamp(accentOf(body));
  ramps[SHOE] = makeRamp(hex('#5d4239'));
  ramps[METAL] = makeRamp(hex('#b4bfcc'));
  ramps[PANTS] = makeRamp(hex('#46506e'));
  ramps[TEAR] = makeRamp(hex('#86d0f5'));
  ramps[HEART] = makeRamp(hex('#ff5c82'));
  ramps[GOLD] = makeRamp(hex('#e8b84a'));
  return compose(g, ramps);
}

/**
 * 128×128 RGBA 버퍼로 그린다. pixels[y * width + x] = 0xRRGGBBAA (빨강이 상위 바이트, 알파가 하위 바이트),
 * 투명은 0. 32×32 원본 한 칸이 4×4 블록. 같은 입력이면 늘 같은 결과.
 */
export function pixelAvatarPixels(value: PixelAvatarData): { width: number; height: number; pixels: Uint32Array } {
  const v = normalizePixelAvatar(value);
  const key = [v.back, v.front, v.face, v.body, v.hairColor, v.skinColor, v.bodyColor, v.eyeColor].join('|');
  let px = cache.get(key);
  if (!px) {
    const small = renderGrid(v);
    px = new Uint32Array(PIXEL_AVATAR_SIZE * PIXEL_AVATAR_SIZE);
    for (let y = 0; y < PIXEL_AVATAR_SIZE; y++) for (let x = 0; x < PIXEL_AVATAR_SIZE; x++) px[y * PIXEL_AVATAR_SIZE + x] = small[Math.floor(y / SCALE) * N + Math.floor(x / SCALE)];
    if (cache.size > 160) cache.delete(cache.keys().next().value as string);
    cache.set(key, px);
  }
  return { width: PIXEL_AVATAR_SIZE, height: PIXEL_AVATAR_SIZE, pixels: new Uint32Array(px) };
}

/** 32×32 원본 그대로 (작게 그릴 때 정수 배율로 쓰기 좋다) */
export function pixelAvatarGrid(value: PixelAvatarData): { width: number; height: number; pixels: Uint32Array } {
  const { pixels } = pixelAvatarPixels(value);
  const out = new Uint32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[y * N + x] = pixels[y * SCALE * PIXEL_AVATAR_SIZE + x * SCALE];
  return { width: N, height: N, pixels: out };
}

/** 같은 그림을 RGBA 바이트로 (ImageData 순서 R, G, B, A) */
export function pixelAvatarRGBA(value: PixelAvatarData): Uint8ClampedArray {
  const { pixels } = pixelAvatarPixels(value);
  const out = new Uint8ClampedArray(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) {
    const c = pixels[i];
    out[i * 4] = c >>> 24; out[i * 4 + 1] = (c >>> 16) & 255; out[i * 4 + 2] = (c >>> 8) & 255; out[i * 4 + 3] = c & 255;
  }
  return out;
}

/** 접근성 라벨 */
export function pixelAvatarLabel(value: PixelAvatarData): string {
  const v = normalizePixelAvatar(value);
  return `도트 캐릭터: ${BACK_HAIR_NAMES[v.back]}, ${FRONT_HAIR_NAMES[v.front]}, ${FACE_STYLE_NAMES[v.face]}, ${BODY_STYLE_NAMES[v.body]}`;
}
