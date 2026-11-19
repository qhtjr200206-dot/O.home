// 테마 목록 — 테마마다 레이아웃·질감이 확실히 다르다 (그리기 공용 도구는 _paint.ts)
import type { ThemeDef, ThemeId } from '../types';
import { vinyl } from './vinyl';
import { minimal } from './minimal';
import { film } from './film';
import { cassette } from './cassette';
import { player } from './player';
import { polaroid } from './polaroid';
import { neon } from './neon';
import { magazine } from './magazine';
import { youtube } from './youtube';
import { clean } from './clean';
import { half } from './half';

// 새 테마는 뒤에 붙인다 (저장된 프리셋은 id로 찾으므로 순서와 무관)
export const THEMES: ThemeDef[] = [vinyl, minimal, film, cassette, player, polaroid, neon, magazine, youtube, clean, half];

export function getTheme(id: ThemeId): ThemeDef {
  return THEMES.find(t => t.id === id) ?? THEMES[0];
}
