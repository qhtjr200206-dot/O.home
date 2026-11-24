'use client';

import React, { useId, useMemo, useState } from 'react';
import {
  BACK_HAIR_COUNT, BACK_HAIR_NAMES, BODY_STYLE_NAMES, DEFAULT_EYE_COLOR, DEFAULT_PIXEL_AVATAR, FACE_STYLE_NAMES, FRONT_HAIR_COUNT,
  FRONT_HAIR_NAMES, PIXEL_AVATAR_SIZE, PIXEL_STYLE_COUNT, SHORT_HAIR_COUNT,
  normalizeHexColor, normalizePixelAvatar, pixelAvatarLabel, pixelAvatarPixels, type PixelAvatarData,
} from './pixelAvatarArt';

// Rendering lives in the DOM-free ./pixelAvatarArt module (128 × 128 native
// grid). Server code and the village game should import it from there; these
// re-exports keep existing imports of this file working.
export type { PixelAvatarData } from './pixelAvatarArt';
export {
  DEFAULT_PIXEL_AVATAR, PIXEL_AVATAR_SIZE, HAIR_STYLE_NAMES, BACK_HAIR_NAMES, FRONT_HAIR_NAMES, FACE_STYLE_NAMES, BODY_STYLE_NAMES,
  normalizeHexColor, normalizePixelAvatar, pixelAvatarPixels, pixelAvatarRGBA,
} from './pixelAvatarArt';

/** One <path> per colour, built from horizontal pixel runs of the buffer. */
function svgPaths(pixels: Uint32Array) {
  const runs = new Map<number, string[]>();
  for (let y = 0; y < PIXEL_AVATAR_SIZE; y++) {
    for (let x = 0; x < PIXEL_AVATAR_SIZE;) {
      const c = pixels[y * PIXEL_AVATAR_SIZE + x];
      let w = 1;
      while (x + w < PIXEL_AVATAR_SIZE && pixels[y * PIXEL_AVATAR_SIZE + x + w] === c) w++;
      if (c) { let r = runs.get(c); if (!r) runs.set(c, r = []); r.push(`M${x} ${y}h${w}v1h-${w}z`); }
      x += w;
    }
  }
  return [...runs].map(([c, d]) => ({ fill: '#' + (c >>> 8).toString(16).padStart(6, '0'), d: d.join('') }));
}

export function PixelAvatar({ value, size = 120 }: { value: PixelAvatarData; size?: number }) {
  const v = normalizePixelAvatar(value);
  const key = [v.back, v.front, v.face, v.body, v.hairColor, v.skinColor, v.bodyColor, v.eyeColor].join('|');
  const paths = useMemo(() => svgPaths(pixelAvatarPixels(v).pixels), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = pixelAvatarLabel(v);
  return <svg role="img" aria-label={label} viewBox={`0 0 ${PIXEL_AVATAR_SIZE} ${PIXEL_AVATAR_SIZE}`} width={size} height={size} shapeRendering="crispEdges"
    style={{ imageRendering: 'pixelated', flexShrink: 0, maxWidth: '100%', height: 'auto' }}>
    {paths.map(p => <path key={p.fill} fill={p.fill} d={p.d} />)}
  </svg>;
}

const parseHexInput = (text: string) => normalizeHexColor(text.trim().startsWith('#') ? text : '#' + text.trim());

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  // While typing, keep the raw draft; valid values apply immediately.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const invalid = draft !== null && parseHexInput(draft) === null;
  return <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
    <label htmlFor={id + 'c'} style={{ minWidth: 48 }}>{label}</label>
    <input id={id + 'c'} type="color" aria-label={`${label} 선택`} value={value}
      onChange={e => { setDraft(null); onChange(e.target.value.toLowerCase()); }}
      style={{ width: 44, height: 32, padding: 0, border: '1px solid var(--line, #ccc)', borderRadius: 6, background: 'none' }} />
    <input type="text" aria-label={`${label} HEX`} value={text} maxLength={7} spellCheck={false} autoComplete="off"
      aria-invalid={invalid} aria-describedby={invalid ? id + 'e' : undefined} style={{ width: '8ch', fontFamily: 'monospace' }}
      onChange={e => { const next = e.target.value; setDraft(next); const ok = parseHexInput(next); if (ok) onChange(ok); }}
      onBlur={() => setDraft(null)} />
    {invalid && <small id={id + 'e'} role="alert" style={{ flexBasis: '100%', color: 'var(--danger, #c0392b)' }}>
      {label}: #RGB 또는 #RRGGBB 형식의 16진수로 입력해 주세요 (예: #3a7 또는 #33AA77). 미리보기는 마지막 유효 색상을 유지합니다.
    </small>}
  </div>;
}

// 앞머리·뒷머리를 따로 고른다 (v2.1 사용자 요청) — 뒷머리는 단발 20 / 장발 20 묶음으로
type PartKey = 'back' | 'front' | 'face' | 'body';
const PARTS: readonly { key: PartKey; label: string; count: number; groups: readonly { label?: string; from: number; names: readonly string[] }[] }[] = [
  { key: 'back', label: '뒷머리', count: BACK_HAIR_COUNT, groups: [
    { label: '단발', from: 0, names: BACK_HAIR_NAMES.slice(0, SHORT_HAIR_COUNT) },
    { label: '장발', from: SHORT_HAIR_COUNT, names: BACK_HAIR_NAMES.slice(SHORT_HAIR_COUNT) },
  ] },
  { key: 'front', label: '앞머리', count: FRONT_HAIR_COUNT, groups: [{ from: 0, names: FRONT_HAIR_NAMES }] },
  { key: 'face', label: '표정', count: PIXEL_STYLE_COUNT, groups: [{ from: 0, names: FACE_STYLE_NAMES }] },
  { key: 'body', label: '옷', count: PIXEL_STYLE_COUNT, groups: [{ from: 0, names: BODY_STYLE_NAMES }] },
];
const COLORS = [['hairColor', '머리색'], ['eyeColor', '눈 색'], ['skinColor', '피부색'], ['bodyColor', '옷 색']] as const;

export function PixelAvatarEditor({ value, onChange }: { value?: PixelAvatarData; onChange: (v: PixelAvatarData | undefined) => void }) {
  const id = useId();
  const v = normalizePixelAvatar(value ?? DEFAULT_PIXEL_AVATAR);
  const step = (key: PartKey, count: number, d: number) => onChange({ ...v, [key]: (v[key] + d + count) % count });
  const btn: React.CSSProperties = { minWidth: 36, minHeight: 36, padding: '0 8px' };
  // minWidth 0 everywhere: lets the parent grid shrink us so rows wrap on 390px phones.
  return <div style={{ display: 'grid', gap: 10, color: 'var(--ink)', minWidth: 0 }}>
    <span className="k-label">도트 캐릭터</span>
    {!value ? <button type="button" className="btn btn-ghost" onClick={() => onChange({ ...DEFAULT_PIXEL_AVATAR, eyeColor: DEFAULT_EYE_COLOR })}>도트 캐릭터 만들기</button> : <>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start', minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', maxWidth: '100%', minWidth: 0 }}>
          <div style={{ background: 'repeating-conic-gradient(#0000000d 0 25%, transparent 0 50%) 0 0 / 32px 32px', borderRadius: 8, maxWidth: '100%' }}>
            <PixelAvatar value={v} size={256} />
          </div>
          <figure style={{ margin: 0, display: 'grid', justifyItems: 'center', gap: 2 }}>
            <PixelAvatar value={v} size={64} />
            <figcaption style={{ fontSize: 11, color: 'var(--faint)' }}>실제 크기 (원본 32×32 도트)</figcaption>
          </figure>
        </div>
        <div style={{ display: 'grid', gap: 8, flex: '1 1 260px', minWidth: 0 }}>
          {PARTS.map(({ key, label, count, groups }) => <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <label htmlFor={id + key} style={{ minWidth: 44 }}>{label}</label>
            <button type="button" className="btn btn-ghost" style={btn} aria-label={`이전 ${label}`} onClick={() => step(key, count, -1)}>‹</button>
            <select id={id + key} value={v[key]} onChange={e => onChange({ ...v, [key]: Number(e.target.value) })} style={{ flex: '1 1 140px', minWidth: 0, minHeight: 36 }}>
              {groups.map(gr => {
                const opts = gr.names.map((name, n) => <option key={gr.from + n} value={gr.from + n}>{gr.label ?? label} {n + 1} · {name}</option>);
                return gr.label ? <optgroup key={gr.label} label={gr.label}>{opts}</optgroup> : opts;
              })}
            </select>
            <button type="button" className="btn btn-ghost" style={btn} aria-label={`다음 ${label}`} onClick={() => step(key, count, 1)}>›</button>
          </div>)}
          {COLORS.map(([key, label]) => <ColorField key={key} label={label} value={v[key]} onChange={color => onChange({ ...v, [key]: color })} />)}
        </div>
      </div>
      <button type="button" className="btn btn-ghost" onClick={() => onChange(undefined)}>도트 캐릭터 지우기</button>
      <small>프로필의 SAVE를 눌러야 저장됩니다.</small>
    </>}
  </div>;
}
