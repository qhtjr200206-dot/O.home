// 마을 경제 규칙 — 순수 함수(가져오기 없음). 서버(server.ts)가 이 규칙으로만 재화·경험치를 계산하고,
// 화면은 같은 규칙으로 레벨·경험치 막대를 그린다. 숫자는 docs/village-gdd.md 2~4장을 따른다.
// (v3 사용자 요청 — "선물과 집 꾸미기 아이템은 재화를 모아서 산다", "게임 기획과 레벨링을 먼저 제대로")

export type EconEra = 'past' | 'modern' | 'sf';

/** 화폐 이름은 시대마다 다르고 값은 공통 정수다 (기획서 2.1) */
export const CURRENCY: Record<EconEra, { name: string; icon: string }> = {
  past: { name: '냥', icon: '🪙' },
  modern: { name: '코인', icon: '🪙' },
  sf: { name: '크레딧', icon: '💠' },
};

/* ---------------- 레벨 ---------------- */
export const MAX_LEVEL = 20;
/** 레벨 L에 닿는 데 필요한 누적 경험치 — need(L) = round(50 × (L−1)^1.8) (기획서 3장) */
export function need(level: number): number {
  if (!(level > 1)) return 0;
  return Math.round(50 * Math.pow(Math.min(level, MAX_LEVEL) - 1, 1.8));
}
export function levelOf(exp: number): number {
  let lv = 1;
  while (lv < MAX_LEVEL && exp >= need(lv + 1)) lv++;
  return lv;
}
/** 경험치 막대용 — 지금 레벨 안에서 얼마나 찼는지 */
export function levelProgress(exp: number): { level: number; into: number; span: number; frac: number } {
  const level = levelOf(exp);
  if (level >= MAX_LEVEL) return { level, into: 0, span: 0, frac: 1 };
  const into = exp - need(level), span = need(level + 1) - need(level);
  return { level, into, span, frac: span ? Math.max(0, Math.min(1, into / span)) : 1 };
}
/** 칭호 — L15 '마을 터줏대감', L20 '마을의 전설' (기획서 3장) */
export function titleOf(level: number): string {
  return level >= 20 ? '마을의 전설' : level >= 15 ? '마을 터줏대감' : '';
}

/* ---------------- 획득처와 하루 한도 (한국 시각 하루) ---------------- */
export type DailyKind = 'attend' | 'game' | 'talk' | 'wake' | 'gather';
export const DAILY_KINDS: DailyKind[] = ['attend', 'game', 'talk', 'wake', 'gather'];
/** 활동별 하루 재화 한도. 미니게임 두 종은 합산 150 */
export const DAILY_CAP: Record<DailyKind, number> = { attend: 30, game: 150, talk: 20, wake: 15, gather: 60 };
export const REWARD = {
  attend: { coins: 30, exp: 20 },
  talk: { coins: 2, exp: 2 },
  wake: { coins: 3, exp: 3 },
  /** 채집 경험치는 한 번에 8 (재화는 채집표) */
  gatherExp: 8,
};
/** 채집은 장소마다 캐릭터별 2시간 쿨다운 — 클릭 한 번이면 끝나는 대신 자주 못 한다 */
export const GATHER_COOLDOWN_MS = 2 * 3600 * 1000;
/** 별 줍기 ⌊점수/2⌋ (최대 30), 짝 맞추기 ⌊점수/40⌋ (최대 25). 경험치는 같은 값 */
export const catchCoins = (score: number) => Math.max(0, Math.min(30, Math.floor((Number(score) || 0) / 2)));
export const memoryCoins = (score: number) => Math.max(0, Math.min(25, Math.floor((Number(score) || 0) / 40)));
/** 선물 주기 — 주는 쪽 경험치는 가격의 10% (재화는 없음: 되팔기·선물 돌리기로 돈을 찍지 못하게) */
export const giftExp = (price: number) => Math.round(Math.max(0, price) * 0.1);

/** 한국 시각 날짜 'YYYY-MM-DD' — 하루 한도가 바뀌는 기준 */
export function kstDay(t: number): string {
  const d = new Date(t + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/* ---------------- 지갑 문서 (econ/{배우 id}) ---------------- */
export interface EconDoc {
  actor: string;
  coins: number;
  exp: number;
  /** 가방 — 상품 id → 개수 */
  inv: Record<string, number>;
  day: string;
  daily: Record<DailyKind, number>;
  /** 장소 id → 마지막 채집 시각(서버 시각) */
  gatherAt: Record<string, number>;
  /** 한 번 받아서 공개된 '좋아하는 선물' id */
  liked: string[];
}
export const INV_MAX_EACH = 99;
export const INV_MAX_KINDS = 200;
const int = (v: unknown, max = 1e9) => (Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v as number))) : 0);
const recOf = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** 저장된 지갑을 믿을 수 있는 모양으로 정리한다. 날짜가 바뀌었으면 하루 한도를 0으로 되돌린다 */
export function normalizeEcon(raw: unknown, actor: string, day: string): EconDoc {
  const r = recOf(raw);
  const inv: Record<string, number> = {};
  for (const [k, v] of Object.entries(recOf(r.inv)).slice(0, INV_MAX_KINDS)) {
    const n = int(v, INV_MAX_EACH);
    if (n > 0 && /^[a-z0-9:-]{1,40}$/.test(k)) inv[k] = n;
  }
  const gatherAt: Record<string, number> = {};
  for (const [k, v] of Object.entries(recOf(r.gatherAt)).slice(0, 40)) if (Number.isFinite(v)) gatherAt[k] = v as number;
  const sameDay = r.day === day;
  const d = recOf(r.daily);
  const daily = Object.fromEntries(DAILY_KINDS.map(k => [k, sameDay ? int(d[k], 100000) : 0])) as Record<DailyKind, number>;
  const liked = Array.isArray(r.liked) ? Array.from(new Set(r.liked.filter((x): x is string => typeof x === 'string' && x.length <= 40))).slice(0, 12) : [];
  return { actor, coins: int(r.coins), exp: int(r.exp), inv, day, daily, gatherAt, liked };
}

/**
 * 보상 주기 — 하루 한도를 넘는 만큼은 잘라낸다. 재화가 잘리면 경험치도 같은 비율로 준다.
 * kind가 null이면 한도 없는 경험치(선물 주기). 지갑 e를 바꾸고 실제로 준 값을 돌려준다.
 */
export function grant(e: EconDoc, kind: DailyKind | null, coins: number, exp: number): { coins: number; exp: number } {
  coins = int(coins); exp = int(exp);
  if (!kind) { e.exp += exp; return { coins: 0, exp }; }
  const room = Math.max(0, DAILY_CAP[kind] - e.daily[kind]);
  const got = Math.min(coins, room);
  const gotExp = coins > 0 ? Math.floor(exp * got / coins) : 0;
  e.daily[kind] += got;
  e.coins += got;
  e.exp += gotExp;
  return { coins: got, exp: gotExp };
}
export const dailyLeft = (e: EconDoc, kind: DailyKind) => Math.max(0, DAILY_CAP[kind] - e.daily[kind]);

/* ---------------- 채집표 (기획서 2.4) ---------------- */
export type GatherPlaceKind = 'sea' | 'river' | 'lake' | 'forest' | 'mountain' | 'field' | 'garden';
export const GATHER: Record<GatherPlaceKind, { label: string; icon: string; min: number; max: number }> = {
  sea: { label: '조개 줍기', icon: '🐚', min: 8, max: 14 },
  river: { label: '물고기 낚기', icon: '🎣', min: 9, max: 13 },
  lake: { label: '물고기 낚기', icon: '🎣', min: 9, max: 13 },
  forest: { label: '열매·버섯 따기', icon: '🍄', min: 8, max: 12 },
  mountain: { label: '열매·버섯 따기', icon: '🍄', min: 8, max: 12 },
  field: { label: '채소 캐기', icon: '🥕', min: 10, max: 12 },
  garden: { label: '꽃 모으기', icon: '🌸', min: 8, max: 12 },
};
export const isGatherKind = (k: unknown): k is GatherPlaceKind => typeof k === 'string' && k in GATHER;

/** 결정적 난수 0..1 (FNV-1a + mulberry). 보안용이 아니라 '모두가 같은 값'을 얻기 위한 것 */
export function hash01(text: string): number {
  let s = 2166136261;
  for (const ch of text) s = Math.imul(s ^ ch.codePointAt(0)!, 16777619) >>> 0;
  s = (s + 0x6d2b79f5) >>> 0;
  let n = Math.imul(s ^ (s >>> 15), s | 1);
  n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
  return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
}
/** 채집량 — 시드는 '방 시드|배우|장소|2시간 블록'. 같은 블록에서는 다시 눌러도 같은 값이다 */
export function gatherRoll(seed: string, actor: string, place: string, t: number, kind: GatherPlaceKind): number {
  const g = GATHER[kind];
  const block = Math.floor(t / GATHER_COOLDOWN_MS);
  return g.min + Math.floor(hash01(`${seed}|${actor}|${place}|${block}`) * (g.max - g.min + 1));
}

/* ---------------- 호감도 (기획서 4장) ---------------- */
export const BOND_TIERS = [
  { min: 0, label: '낯선 사이', hearts: 0 },
  { min: 20, label: '아는 사이', hearts: 1 },
  { min: 60, label: '친구', hearts: 2 },
  { min: 140, label: '단짝', hearts: 3 },
  { min: 300, label: '소중한 사이', hearts: 4 },
] as const;
export function bondTier(pts: number) {
  let t: (typeof BOND_TIERS)[number] = BOND_TIERS[0];
  for (const x of BOND_TIERS) if (pts >= x.min) t = x;
  return t;
}
/** 두 배우 사이 호감도 문서 키 — 방향 없이 정렬해 하나만 둔다 */
// Canonical tuple: delimiters inside actor IDs cannot alias another pair.
export const bondKey = (a: string, b: string) => JSON.stringify(a < b ? [a, b] : [b, a]);
/** 대화(말 걸기·편지) +1, 하루 그 쌍당 5까지 */
export const TALK_BOND_DAILY = 5;
/** 선물 +(가격 ÷ 10, 최소 2), 좋아하는 선물이면 ×2 */
export const giftBondPts = (price: number, liked: boolean) => Math.max(2, Math.floor(price / 10)) * (liked ? 2 : 1);
/** 친구 이상 — 자율 행동에서 같이 어울릴 확률이 오른다 */
export const FRIEND_PTS = 60;

/** 배우마다 좋아하는 선물 2개 — 시드 기반 결정적 선택(서버·화면이 같은 값을 얻는다) */
export function favoriteGifts(seed: string, actor: string, giftIds: string[]): string[] {
  if (giftIds.length < 2) return [...giftIds];
  const order = giftIds.map(id => ({ id, r: hash01(`${seed}|like|${actor}|${id}`) })).sort((a, b) => a.r - b.r);
  return [order[0].id, order[1].id];
}
