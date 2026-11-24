// 마을(웹게임) 공용 타입과 입력 검증 — 브라우저와 서버가 함께 쓴다. 비밀 값은 여기 두지 않는다.
import type { PixelAvatarData } from '@/components/chars/PixelAvatar';
import type { VillageEra } from './map';

export type { VillageEra };
export type Personality = 'lively' | 'calm' | 'shy' | 'curious' | 'lazy';
export const PERSONALITIES: { id: Personality; label: string }[] = [
  { id: 'lively', label: '활발함 — 여기저기 돌아다니고 자주 말을 건다' },
  { id: 'calm', label: '차분함 — 좋아하는 장소에 오래 머문다' },
  { id: 'shy', label: '수줍음 — 사람이 적은 곳을 찾고 말수가 적다' },
  { id: 'curious', label: '호기심 — 처음 가 보는 장소를 고른다' },
  { id: 'lazy', label: '느긋함 — 집과 광장 근처에서 쉰다' },
];
export const ERAS: { id: VillageEra; label: string; channel: string; verb: string }[] = [
  { id: 'past', label: '과거 (편지)', channel: '편지', verb: '편지를 보냈다' },
  { id: 'modern', label: '현대 (폰)', channel: '폰', verb: '메시지를 보냈다' },
  { id: 'sf', label: 'SF (무전)', channel: '무전', verb: '무전을 보냈다' },
];
export const GIFTS: Record<VillageEra, { id: string; label: string; icon: string }[]> = {
  past: [
    { id: 'flower', label: '들꽃 다발', icon: '🌼' }, { id: 'tea', label: '찻잎', icon: '🍵' },
    { id: 'rice-cake', label: '떡', icon: '🍡' }, { id: 'hairpin', label: '비녀', icon: '📍' },
    { id: 'book', label: '낡은 책', icon: '📖' },
  ],
  modern: [
    { id: 'coffee', label: '커피', icon: '☕' }, { id: 'cake', label: '조각 케이크', icon: '🍰' },
    { id: 'bouquet', label: '꽃다발', icon: '💐' }, { id: 'ticket', label: '영화표', icon: '🎟️' },
    { id: 'plush', label: '인형', icon: '🧸' },
  ],
  sf: [
    { id: 'battery', label: '에너지 셀', icon: '🔋' }, { id: 'chip', label: '데이터 칩', icon: '💾' },
    { id: 'ration', label: '우주 식량', icon: '🥫' }, { id: 'crystal', label: '성간 크리스탈', icon: '💎' },
    { id: 'drone', label: '소형 드론', icon: '🛸' },
  ],
};
export const MINIGAMES = [
  { id: 'catch', label: '별 줍기', max: 60 },
  { id: 'memory', label: '짝 맞추기', max: 1000 },
] as const;
export type MinigameId = typeof MINIGAMES[number]['id'];

export interface RoomPlace { id: string; name: string }
export interface RoomActor {
  id: string;            // 캐릭터 id 또는 'npc:<n>'
  kind: 'char' | 'npc';
  name: string;
  color: string;
  avatar: PixelAvatarData | null;
  personality: Personality;
  home: string;          // 장소 id ('' = 광장)
  lines: string[];       // 미리 입력해 둔 대사
  role?: string;         // NPC 역할
}
/** 비밀번호 확인 뒤에만 내려가는 방 내용 */
export interface RoomView {
  id: string;
  instance: string;
  name: string;
  era: VillageEra;
  worldview: string;
  seed: string;
  places: RoomPlace[];
  actors: RoomActor[];
  isOwner: boolean;
  createdAt: number;
}
export interface ActorOverride { id: string; x: number; y: number; at: number; by: string }
export interface RoomEvent {
  id: string;
  type: 'message' | 'gift' | 'game' | 'wake';   // wake: from이 to를 깨웠다(from === to면 스스로 일어남)
  from: string;
  to?: string;
  text?: string;
  item?: string;
  game?: MinigameId;
  score?: number;
  at: number;
}
export interface RoomSummary { id: string; name: string; era: VillageEra; mine: boolean; createdAt: number }

export const LIMITS = {
  name: 40, worldview: 600, places: 12, placeName: 24, actors: 12, npcs: 8, lines: 8, line: 80,
  role: 24, message: 300, passwordMin: 8, passwordMax: 64,
};

/** 제어 문자는 공백으로, 양방향 재배치·zero-width 문자는 지운다(표시 위조 방지). 메시지 본문과 같은 기준 */
export const cleanText = (v: string) => v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '');
const str = (v: unknown, max: number) => typeof v === 'string' ? cleanText(v).trim().slice(0, max) : '';
const isPersonality = (v: unknown): v is Personality => PERSONALITIES.some(p => p.id === v);

export interface CreateRoomInput {
  name: string;
  era: VillageEra;
  worldview: string;
  password: string;
  relId: string;
  places: RoomPlace[];
  /** 이 방에서 이 캐릭터를 조작해도 되는 권한 회원 uid(방 주인이 고름). 서버가 지금 권한이 있는 사람만 남긴다 */
  chars: { id: string; personality: Personality; home: string; lines: string[]; allow: string[] }[];
  npcs: { name: string; role: string; personality: Personality; home: string; lines: string[] }[];
}

/** 신뢰하지 않는 입력을 정규화한다. 문제가 있으면 오류 문구를 던진다. */
export function parseCreateRoom(raw: unknown): CreateRoomInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('잘못된 요청입니다');
  const o = raw as Record<string, unknown>;
  const name = str(o.name, LIMITS.name);
  if (!name) throw new Error('방 이름을 입력해 주세요');
  if (!ERAS.some(e => e.id === o.era)) throw new Error('세계관 시대를 골라 주세요');
  const era = o.era as VillageEra;
  const worldview = str(o.worldview, LIMITS.worldview);
  const problem = passwordProblem(o.password);
  if (problem) throw new Error(problem);
  const relId = str(o.relId, 200);
  if (relId && !validDocId(relId)) throw new Error('잘못된 자관입니다');
  const rawPlaces = Array.isArray(o.places) ? o.places : [];
  if (rawPlaces.length > LIMITS.places) throw new Error(`주요 장소는 ${LIMITS.places}곳까지입니다`);
  const places: RoomPlace[] = [];
  rawPlaces.forEach((p, i) => {
    const n = str(typeof p === 'string' ? p : (p as { name?: unknown })?.name, LIMITS.placeName);
    if (n && !places.some(x => x.name === n)) places.push({ id: `p${i}`, name: n });
  });
  const placeIds = new Set(places.map(p => p.id));
  const home = (v: unknown) => typeof v === 'string' && placeIds.has(v) ? v : '';
  const lines = (v: unknown) => (Array.isArray(v) ? v : []).slice(0, LIMITS.lines).map(l => str(l, LIMITS.line)).filter(Boolean);
  const rawChars = Array.isArray(o.chars) ? o.chars : [];
  if (rawChars.length > LIMITS.actors) throw new Error(`캐릭터는 ${LIMITS.actors}명까지입니다`);
  const chars: CreateRoomInput['chars'] = [];
  for (const c of rawChars) {
    const r = (c ?? {}) as Record<string, unknown>;
    if (!validDocId(r.id)) throw new Error('잘못된 캐릭터입니다');
    if (chars.some(x => x.id === r.id)) continue;
    const allow = [...new Set((Array.isArray(r.allow) ? r.allow : []).filter((u): u is string => typeof u === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(u)))].slice(0, 20);
    chars.push({ id: r.id, personality: isPersonality(r.personality) ? r.personality : 'calm', home: home(r.home), lines: lines(r.lines), allow });
  }
  if (!chars.length) throw new Error('캐릭터를 한 명 이상 골라 주세요');
  const rawNpcs = Array.isArray(o.npcs) ? o.npcs : [];
  if (rawNpcs.length > LIMITS.npcs) throw new Error(`NPC는 ${LIMITS.npcs}명까지입니다`);
  const npcs: CreateRoomInput['npcs'] = [];
  for (const n of rawNpcs) {
    const r = (n ?? {}) as Record<string, unknown>;
    const nm = str(r.name, LIMITS.name);
    if (!nm) continue;
    npcs.push({ name: nm, role: str(r.role, LIMITS.role), personality: isPersonality(r.personality) ? r.personality : 'calm', home: home(r.home), lines: lines(r.lines) });
  }
  return { name, era, worldview, password: o.password as string, relId, places, chars, npcs };
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', '12345678', '123456789', '1234567890', '87654321', 'qwerty12', 'qwertyui',
  'qwerty123', '1q2w3e4r', '1q2w3e4r5t', 'abcd1234', 'abc12345', 'asdf1234', 'iloveyou', 'sunshine', 'princess', 'football',
  'baseball', 'superman', 'trustno1', 'letmein1', 'welcome1', 'admin123', 'qwer1234', 'zxcv1234', 'aaaa1111', 'a1234567',
]);
/** 방 비밀번호 규칙 — 8~64자, 같은 글자 반복·숫자만 9자 이하·흔한 비밀번호 거부. 문제가 없으면 null */
export function passwordProblem(p: unknown): string | null {
  if (typeof p !== 'string' || p.length < LIMITS.passwordMin || p.length > LIMITS.passwordMax) {
    return `방 비밀번호는 ${LIMITS.passwordMin}~${LIMITS.passwordMax}자로 정해 주세요`;
  }
  if (/^(.)\1*$/.test(p) || (/^\d+$/.test(p) && p.length < 10) || COMMON_PASSWORDS.has(p.toLowerCase())) {
    return '너무 쉬운 비밀번호입니다 — 숫자만 쓰려면 10자 이상, 아니면 글자와 숫자를 섞어 주세요';
  }
  return null;
}

export function validDocId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 200 && !id.includes('/') && id !== '.' && id !== '..' && !/^__.*__$/.test(id);
}
export const validRoomId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9]{20}$/.test(id);

/** 한국어 조사 — 받침 유무로 고른다. josa('하루','이/가') → '하루가' */
export function josa(word: string, pair: '이/가' | '을/를' | '은/는' | '와/과' | '으로/로'): string {
  const ch = word.trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  const has = code >= 0 && code <= 11171 ? code % 28 !== 0 : false;
  const rieul = code >= 0 && code <= 11171 && code % 28 === 8;
  const [a, b] = pair.split('/');
  if (pair === '으로/로') return word + (has && !rieul ? a : b);
  if (pair === '와/과') return word + (has ? b : a);
  return word + (has ? a : b);
}
