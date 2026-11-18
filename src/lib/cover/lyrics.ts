// 가사 파일 읽기·쓰기 — LRC([mm:ss.xx]) 와 일반 txt.
// 그리기(현재 줄 강조·앞뒤 줄 흐림)는 render.ts가 맡고, 여기는 데이터만 다룬다.
import type { LyricLine } from './types';

const TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META = /^\[(ti|ar|al|by|offset|length|re|ve|au|#):(.*)\]\s*$/i;

export interface ParsedLyrics {
  lines: LyricLine[];
  /** 타임스탬프가 하나라도 있었는지 — false면 txt(싱크 필요) */
  synced: boolean;
  meta: { title?: string; artist?: string };
}

/** LRC 또는 txt 문자열 → 줄 목록. LRC는 시간순 정렬, 한 줄 여러 태그·[offset:] 지원 */
export function parseLyrics(src: string): ParsedLyrics {
  const text = src.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows = text.split('\n');
  const meta: ParsedLyrics['meta'] = {};
  let offset = 0;
  const timed: LyricLine[] = [];
  const plain: string[] = [];
  for (const row of rows) {
    const m = row.trim().match(META);
    if (m) {
      const k = m[1].toLowerCase(); const v = m[2].trim();
      if (k === 'ti') meta.title = v;
      else if (k === 'ar') meta.artist = v;
      else if (k === 'offset') offset = (parseInt(v, 10) || 0) / 1000;
      continue;
    }
    TAG.lastIndex = 0;
    const times: number[] = [];
    let mt: RegExpExecArray | null;
    let last = 0;
    while ((mt = TAG.exec(row))) {
      const frac = mt[3] ? parseInt(mt[3], 10) / Math.pow(10, mt[3].length) : 0;
      times.push(parseInt(mt[1], 10) * 60 + parseInt(mt[2], 10) + frac);
      last = TAG.lastIndex;
    }
    if (times.length) {
      // 단어별 타임태그(<00:01.00>)는 지운다
      const body = row.slice(last).replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
      times.forEach(t => timed.push({ time: Math.max(0, t - offset), text: body }));
    } else if (row.trim()) {
      plain.push(row.trim());
    }
  }
  if (timed.length) {
    timed.sort((a, b) => a.time - b.time);
    return { lines: timed, synced: true, meta };
  }
  return { lines: plain.map(t => ({ time: NaN, text: t })), synced: false, meta };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 초 → LRC 태그 [mm:ss.xx] */
export function lrcTag(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const cs = Math.round((s - m * 60) * 100);
  const ss = Math.floor(cs / 100);
  return `[${pad(m)}:${pad(ss)}.${pad(cs % 100)}]`;
}

/** 줄 목록 → LRC 문자열 (시간 없는 줄은 건너뜀) */
export function toLRC(lines: LyricLine[], meta?: { title?: string; artist?: string }): string {
  const head: string[] = [];
  if (meta?.title) head.push(`[ti:${meta.title}]`);
  if (meta?.artist) head.push(`[ar:${meta.artist}]`);
  const body = lines
    .filter(l => isFinite(l.time))
    .slice()
    .sort((a, b) => a.time - b.time)
    .map(l => `${lrcTag(l.time)}${l.text}`);
  return [...head, ...body].join('\n') + '\n';
}

/** time 시점의 현재 줄 번호 (-1 = 첫 줄 전). 시간 없는 가사면 -1 */
export function lineIndexAt(lines: LyricLine[], time: number): number {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = lines[mid].time;
    if (!isFinite(t)) return -1;
    if (t <= time) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export const isSynced = (lines: LyricLine[]) => lines.length > 0 && lines.every(l => isFinite(l.time));
