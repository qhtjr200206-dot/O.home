// 톤(다크/라이트)·배경색 → 프레임 팔레트. 미리보기·썸네일·PNG/MP4/GIF가 모두 이 함수 하나로 팔레트를 만든다.
import type { CoverSettings, Palette, Tone } from './types';
import { derivePalette, guardSurface, surfacePalette, toneOf } from './color';
import { getTheme } from './themes';

/** 설정에서 실제 톤 — 배경색이 있으면 그 밝기, 없으면 tone 설정, auto면 테마 원래 톤(사진 전체 배경은 dark) */
export function resolveTone(s: CoverSettings): Tone {
  if (s.bgColor) return toneOf(s.bgColor);
  if (s.tone !== 'auto') return s.tone;
  if (s.photoLayout === 'background') return 'dark';
  return getTheme(s.theme).baseTone;
}

/** 사진 위 덮개 기본색 (배경색 미지정) */
const DIM: Record<Tone, string> = { dark: '#000000', light: '#ffffff' };

export function paletteFor(s: CoverSettings): Palette {
  const ap = derivePalette(s.accent);
  const tone = resolveTone(s);
  const custom = !!s.bgColor;
  const dim = custom ? s.bgColor : DIM[tone];
  // 사진 전체 배경이면 글자가 놓이는 바탕 = 덮개 색
  // 테마 기본 바탕은 guardSurface로 명도·포인트색 틴트를 보정한다 (라이트는 충분히 밝게)
  const bg = s.photoLayout === 'background' ? dim : custom ? s.bgColor : guardSurface(getTheme(s.theme).toneBg(tone, ap), tone);
  return surfacePalette(ap, tone, bg, custom, dim);
}
