// 사진 여러 장 전환 — 시각 t에서 어느 사진(a)에서 어느 사진(b)으로 얼마나(p) 넘어가는지.
// 결정적(같은 t → 같은 값)이라 미리보기·PNG·MP4·GIF가 같은 장면을 그린다.
import type { PhotoTransition } from './types';

export interface SlideState {
  /** 지금 사진 번호 */
  a: number;
  /** 다음 사진 번호 (p > 0일 때만 의미) */
  b: number;
  /** 전환 진행 0 ~ 1 (이미 이징 적용) */
  p: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** 한 장당 시간 — seconds > 0이면 그 값, 0이면 곡 길이를 장수로 나눈 값 */
export function slidePeriod(n: number, duration: number, seconds: number): number {
  if (seconds > 0) return seconds;
  return Math.max(0.01, (isFinite(duration) && duration > 0 ? duration : 30) / Math.max(1, n));
}

/**
 * - 직접 시간(seconds > 0): 순서대로 돌고 마지막 다음엔 첫 장으로 (반복)
 * - 곡 길이에 맞춤(0): 곡 동안 한 바퀴, 마지막 장은 끝까지 유지
 * 전환은 각 구간 끝 쪽에서 일어난다 (첫 장은 0초부터 온전히 보인다).
 */
export function slideAt(t: number, n: number, duration: number, seconds: number, kind: PhotoTransition): SlideState {
  if (n <= 1) return { a: 0, b: 0, p: 0 };
  const per = slidePeriod(n, duration, seconds);
  const time = isFinite(t) && t > 0 ? t : 0;
  const loop = seconds > 0;
  const k = Math.floor(time / per);
  if (!loop && k >= n - 1) return { a: n - 1, b: n - 1, p: 0 };
  const a = k % n, b = (a + 1) % n;
  const T = kind === 'cut' ? 0 : Math.min(1.2, per * 0.35);
  const local = time - k * per;
  if (T <= 0 || local < per - T) return { a, b, p: 0 };
  return { a, b, p: easeInOut(Math.min(1, (local - (per - T)) / T)) };
}
