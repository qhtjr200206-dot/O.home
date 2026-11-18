'use client';
// 커버 메이커 프리셋 — 이 기기(localStorage)에만 보관. 사이트 설정(SETTING_KEYS)에 넣지 않는다.
// 프리셋에는 디자인·글자 설정(CoverSettings)만 담는다 — 사진·오디오·가사는 개인 파일이고 용량이 커서 제외.
import { normalizeSettings, type CoverSettings } from './types';

const KEY = 'ohome.cover.presets.v1';
const LAST_KEY = 'ohome.cover.last.v1';

export interface CoverPreset { id: string; name: string; settings: CoverSettings; at: string }

export function listPresets(): CoverPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(p => p && typeof p.name === 'string' && typeof p.id === 'string')
      .map(p => ({ id: p.id, name: p.name.slice(0, 60), settings: normalizeSettings(p.settings), at: String(p.at ?? '') }));
  } catch { return []; }
}

function save(list: CoverPreset[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { throw new Error('브라우저 저장 공간이 부족합니다'); }
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** 같은 이름이 있으면 덮어쓴다 (확인은 화면에서) */
export function savePreset(name: string, settings: CoverSettings): CoverPreset[] {
  const n = name.trim().slice(0, 60);
  if (!n) throw new Error('프리셋 이름을 입력해 주세요');
  const list = listPresets();
  const at = new Date().toISOString();
  const i = list.findIndex(p => p.name === n);
  if (i >= 0) list[i] = { ...list[i], settings: normalizeSettings(settings), at };
  else list.unshift({ id: newId(), name: n, settings: normalizeSettings(settings), at });
  save(list);
  return list;
}

export function renamePreset(id: string, name: string): CoverPreset[] {
  const n = name.trim().slice(0, 60);
  if (!n) throw new Error('이름을 입력해 주세요');
  const list = listPresets();
  if (list.some(p => p.name === n && p.id !== id)) throw new Error('같은 이름의 프리셋이 있습니다');
  const p = list.find(x => x.id === id);
  if (p) p.name = n;
  save(list);
  return list;
}

export function deletePreset(id: string): CoverPreset[] {
  const list = listPresets().filter(p => p.id !== id);
  save(list);
  return list;
}

/* ---------- JSON 내보내기·가져오기 ---------- */

const FORMAT = 'ohome-cover-presets';

export function presetsToJson(list: CoverPreset[]): string {
  return JSON.stringify({ format: FORMAT, version: 1, presets: list.map(p => ({ name: p.name, settings: p.settings, at: p.at })) }, null, 2);
}

/** 가져오기 — 이름이 겹치면 「이름 (2)」로. 들어온 개수를 돌려준다 */
export function importPresetsJson(text: string): { list: CoverPreset[]; added: number } {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('JSON 파일을 읽을 수 없습니다'); }
  const d = data as { format?: string; presets?: unknown; settings?: unknown; name?: unknown };
  let items: { name: string; settings: unknown }[] = [];
  if (d && d.format === FORMAT && Array.isArray(d.presets)) {
    items = (d.presets as { name?: unknown; settings?: unknown }[])
      .filter(p => p && typeof p.name === 'string' && p.settings && typeof p.settings === 'object')
      .map(p => ({ name: String(p.name), settings: p.settings }));
  } else if (d && typeof d === 'object' && 'settings' in d && d.settings && typeof d.settings === 'object') {
    items = [{ name: typeof d.name === 'string' ? d.name : '가져온 프리셋', settings: d.settings }];
  }
  if (!items.length) throw new Error('커버 메이커 프리셋 파일이 아닙니다');
  const list = listPresets();
  const names = new Set(list.map(p => p.name));
  for (const it of items.slice(0, 200)) {
    let n = it.name.trim().slice(0, 50) || '가져온 프리셋';
    if (names.has(n)) { let k = 2; while (names.has(`${n} (${k})`)) k++; n = `${n} (${k})`; }
    names.add(n);
    list.push({ id: newId(), name: n, settings: normalizeSettings(it.settings), at: new Date().toISOString() });
  }
  save(list);
  return { list, added: Math.min(items.length, 200) };
}

/* ---------- 마지막 작업 설정 자동 저장 ---------- */

export function loadLast(): CoverSettings | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function saveLast(s: CoverSettings) {
  try { localStorage.setItem(LAST_KEY, JSON.stringify(s)); } catch { /* 무시 */ }
}
