/**
 * 오늘의 시 (사용자 요청) — 자관(페어) 정보를 보고 Gemini가 어울리는 **실존 시**의 짧은 구절과
 * 제목·시인·색을 골라 준다. 이 파일은 화면과 서버(/api/rels/poem)가 함께 쓰는 타입·정리 함수만 둔다.
 *
 *  · Gemini 호출·키·캐시·횟수 제한은 전부 서버(src/lib/relPoemServer.ts)에서만
 *  · 「오늘의」 = 한국 시간 날짜 + 자관 + 자관 내용 요약(다이제스트) 기준으로 하루 한 번
 *  · 저작권 — 시 전문은 싣지 않는다. 구절은 최대 4행·160자로 서버가 잘라 낸다
 */
import type { Character, Relation } from './charStore';

export interface RelPoem {
  /** 고른 구절 — 원문 그대로 1~4행 (\n으로 행 구분) */
  line: string;
  title: string;
  poet: string;
  /** 카드 강조색 #rrggbb */
  color: string;
  colorName?: string;
  /** 왜 이 페어에 어울리는지 한두 문장 */
  reason?: string;
  /** 외국 시를 한국어 번역으로 실었는지 */
  translated?: boolean;
  /** Google 검색 grounding 출처 (있을 때만) */
  sources?: { url: string; title?: string }[];
  /** 검색으로 확인을 거쳤는지 (검색 호출·출처가 있었는지) */
  grounded?: boolean;
  model?: string;
  /** 한국 시간 YYYY-MM-DD */
  date: string;
}

/** Gemini에 넘기는 페어 정보 — 화면이 만들고 서버가 다시 길이를 자른다 */
export interface PoemContext {
  name: string;
  kind?: 'pair' | 'multi';
  catchphrase?: string;
  cp?: string;
  members: { name: string; sub?: string; quote?: string; desc?: string; keywords?: string[] }[];
  timeline?: string[];
}

export type PoemResponse =
  | { status: 'ok'; poem: RelPoem; cached: boolean }
  | { status: 'disabled' }
  | { status: 'error'; error: string };

/** 한국 시간 날짜 (YYYY-MM-DD) — 서버(UTC)와 브라우저가 같은 「오늘」을 쓰게 */
export function kstDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const clip = (v: unknown, n: number): string =>
  (typeof v === 'string' ? v : '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** 화면 → 서버로 보낼 페어 정보. 원본(base) 내용만 쓴다 — AU마다 따로 뽑으면 하루에 여러 편이 된다 */
export function buildPoemContext(rel: Relation, chars: Character[]): PoemContext {
  const byId = new Map(chars.map(c => [c.id, c]));
  return normalizeContext({
    name: rel.name,
    kind: rel.kind ?? (rel.members.length === 2 ? 'pair' : 'multi'),
    catchphrase: rel.catchphrase,
    cp: rel.cp,
    members: rel.members.map(m => {
      const c = byId.get(m.charId);
      return { name: c?.name ?? '', sub: c?.sub, quote: m.quote, desc: m.desc, keywords: m.keywords };
    }),
    timeline: rel.timeline.map(t => [t.era, t.desc].filter(Boolean).join(' — ')),
  });
}

/** 길이·개수 제한 — 서버는 화면이 보낸 값을 믿지 않고 이걸 다시 통과시킨다 */
export function normalizeContext(raw: unknown): PoemContext {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const members = (Array.isArray(o.members) ? o.members : []).slice(0, 6).map(m => {
    const x = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
    const keywords = (Array.isArray(x.keywords) ? x.keywords : []).slice(0, 8).map(k => clip(k, 20)).filter(Boolean);
    return {
      name: clip(x.name, 40),
      ...(clip(x.sub, 60) ? { sub: clip(x.sub, 60) } : {}),
      ...(clip(x.quote, 120) ? { quote: clip(x.quote, 120) } : {}),
      ...(clip(x.desc, 300) ? { desc: clip(x.desc, 300) } : {}),
      ...(keywords.length ? { keywords } : {}),
    };
  }).filter(m => m.name || m.desc || m.quote);
  const timeline = (Array.isArray(o.timeline) ? o.timeline : []).slice(0, 6).map(t => clip(t, 160)).filter(Boolean);
  const kind = o.kind === 'pair' || o.kind === 'multi' ? o.kind : undefined;
  return {
    name: clip(o.name, 60),
    ...(kind ? { kind } : {}),
    ...(clip(o.catchphrase, 160) ? { catchphrase: clip(o.catchphrase, 160) } : {}),
    ...(clip(o.cp, 10) ? { cp: clip(o.cp, 10) } : {}),
    members,
    ...(timeline.length ? { timeline } : {}),
  };
}

/** 내용이 비어 시를 고를 근거가 없는지 */
export const contextIsEmpty = (c: PoemContext) =>
  !c.name && !c.catchphrase && c.members.length === 0 && !c.timeline?.length;

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const POEM_FALLBACK_COLOR = '#8a7f70';

/** 모델 출력 정리 — 구절은 최대 4행·160자 (전문 금지), 색은 #rrggbb만 */
export function cleanPoem(raw: unknown, extra: Pick<RelPoem, 'date'> & Partial<RelPoem>): RelPoem | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const lines = (typeof o.line === 'string' ? o.line : '')
    .replace(/\r/g, '').split('\n').map(s => s.replace(/<[^>]*>/g, '').trim()).filter(Boolean).slice(0, 4);
  let line = lines.join('\n');
  if (line.length > 160) line = `${line.slice(0, 158).trimEnd()}…`;
  const title = clip(o.title, 60);
  const poet = clip(o.poet, 40);
  if (!line || !title || !poet) return null;
  const color = typeof o.color === 'string' && HEX_RE.test(o.color.trim()) ? o.color.trim().toLowerCase() : POEM_FALLBACK_COLOR;
  return {
    line, title, poet, color,
    ...(clip(o.colorName, 20) ? { colorName: clip(o.colorName, 20) } : {}),
    ...(clip(o.reason, 160) ? { reason: clip(o.reason, 160) } : {}),
    ...(o.translated === true ? { translated: true } : {}),
    ...extra,
  };
}
