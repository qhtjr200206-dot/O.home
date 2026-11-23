// 미니게임 규칙 — 순수 함수. 클라이언트는 점수를 신고하지 않는다.
// 별 줍기: 브라우저가 이 규칙으로 판을 그리고, 서버가 같은 규칙으로 입력을 재생해 점수를 계산한다.
// 짝 맞추기: 카드 배치(memoryDeck)는 서버에서만 만들고 보관한다(src/lib/village/server.ts memoryFlip).
import { seededRandom, type VillageEra } from './map';

/* ---------------- 별 줍기: 고정 50ms 틱, 20초 = 400틱 ---------------- */
export const CATCH = { W: 300, H: 360, TICK_MS: 50, TICKS: 400, BASKET_MIN: 20, BASKET_MAX: 280, MAX_SCORE: 60 } as const;
export interface CatchItem { x: number; y: number; v: number; bad: boolean }
export interface CatchState { tick: number; score: number; items: CatchItem[]; spawn: number; next: () => number }

export function catchStart(seed: string): CatchState {
  return { tick: 0, score: 0, items: [], spawn: 0, next: seededRandom(`catch|${seed}`) };
}
/** 한 틱 진행. basket = 이 틱의 바구니 x(정수, 20~280) */
export function catchStep(s: CatchState, basket: number): void {
  const dt = CATCH.TICK_MS;
  const elapsed = s.tick * dt / 1000;
  s.spawn -= dt;
  if (s.spawn <= 0) {
    const r = s.next;
    s.items.push({ x: 15 + r() * (CATCH.W - 30), y: -10, v: 0.09 + r() * 0.12 + elapsed * 0.004, bad: r() < 0.18 });
    s.spawn = 380 + r() * 300;
  }
  for (let i = s.items.length - 1; i >= 0; i--) {
    const it = s.items[i];
    it.y += it.v * dt;
    if (it.y > CATCH.H - 40 && it.y < CATCH.H - 14 && Math.abs(it.x - basket) < 26) {
      s.score = Math.max(0, s.score + (it.bad ? -2 : 1));
      s.items.splice(i, 1);
    } else if (it.y > CATCH.H + 10) s.items.splice(i, 1);
  }
  s.tick++;
}
/** 서버 재생 — 입력이 규칙에 맞지 않으면 null */
export function catchReplay(seed: string, xs: unknown): number | null {
  if (!Array.isArray(xs) || xs.length !== CATCH.TICKS) return null;
  const s = catchStart(seed);
  for (const x of xs) {
    if (!Number.isInteger(x) || x < CATCH.BASKET_MIN || x > CATCH.BASKET_MAX) return null;
    catchStep(s, x);
  }
  return Math.min(CATCH.MAX_SCORE, s.score);
}

/* ---------------- 짝 맞추기: 서버가 비밀 시드로 섞은 16장을 보관하고, 뒤집을 때마다 한 장씩만 알려 준다 ---------------- */
export const MEMORY = { PAIRS: 8, MAX_FLIPS: 240, PAIR_MS: 500, MAX_SCORE: 1000 } as const;
const MEMORY_ICONS: Record<VillageEra, string[]> = {
  past: ['🌼', '🍵', '🍡', '📍', '📖', '🍀', '🎵', '🌙'],
  modern: ['☕', '🍰', '💐', '🎟️', '🧸', '🍀', '🎵', '🌙'],
  sf: ['🔋', '💾', '🥫', '💎', '🛸', '🍀', '🎵', '🌙'],
};
export function memoryDeck(seed: string, era: VillageEra): string[] {
  const icons = MEMORY_ICONS[era] ?? MEMORY_ICONS.modern;
  const deck = [...icons, ...icons];
  const r = seededRandom(`memory|${seed}`);
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}
/** 점수 — 시간은 서버가 잰 값만 쓴다 */
export function memoryScore(moves: number, elapsedMs: number): number {
  return Math.max(0, Math.min(MEMORY.MAX_SCORE, Math.round(MEMORY.MAX_SCORE - (moves - MEMORY.PAIRS) * 25 - (elapsedMs / 1000) * 4)));
}
