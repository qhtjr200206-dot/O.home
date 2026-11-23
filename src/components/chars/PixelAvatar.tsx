'use client';

import React, { useId, useMemo, useState } from 'react';
import {
  BODY_STYLE_NAMES, DEFAULT_EYE_COLOR, DEFAULT_PIXEL_AVATAR, FACE_STYLE_NAMES, HAIR_STYLE_NAMES, PIXEL_AVATAR_SIZE, PIXEL_STYLE_COUNT,
  normalizeHexColor, normalizePixelAvatar, pixelAvatarPixels, type PixelAvatarData,
} from './pixelAvatarArt';

// Rendering lives in the DOM-free ./pixelAvatarArt module (128 × 128 native
// grid). Server code and the village game should import it from there; these
// re-exports keep existing imports of this file working.
export type { PixelAvatarData } from './pixelAvatarArt';
export {
  DEFAULT_PIXEL_AVATAR, PIXEL_AVATAR_SIZE, HAIR_STYLE_NAMES, FACE_STYLE_NAMES, BODY_STYLE_NAMES,
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
  const key = [v.hair, v.face, v.body, v.hairColor, v.skinColor, v.bodyColor, v.eyeColor].join('|');
  const paths = useMemo(() => svgPaths(pixelAvatarPixels(v).pixels), [key]);
  const label = `도트 캐릭터: ${HAIR_STYLE_NAMES[v.hair]}, ${FACE_STYLE_NAMES[v.face]}, ${BODY_STYLE_NAMES[v.body]}`;
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

const PARTS = [['hair', '머리', HAIR_STYLE_NAMES], ['face', '표정', FACE_STYLE_NAMES], ['body', '몸', BODY_STYLE_NAMES]] as const;
const COLORS = [['hairColor', '머리색'], ['eyeColor', '눈 색'], ['skinColor', '피부색'], ['bodyColor', '옷 색']] as const;

export function PixelAvatarEditor({ value, onChange }: { value?: PixelAvatarData; onChange: (v: PixelAvatarData | undefined) => void }) {
  const id = useId();
  const v = normalizePixelAvatar(value ?? DEFAULT_PIXEL_AVATAR);
  const step = (key: 'hair' | 'face' | 'body', d: number) => onChange({ ...v, [key]: (v[key] + d + PIXEL_STYLE_COUNT) % PIXEL_STYLE_COUNT });
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
            <PixelAvatar value={v} size={PIXEL_AVATAR_SIZE} />
            <figcaption style={{ fontSize: 11, color: 'var(--faint)' }}>원본 128×128 (1배)</figcaption>
          </figure>
        </div>
        <div style={{ display: 'grid', gap: 8, flex: '1 1 260px', minWidth: 0 }}>
          {PARTS.map(([key, label, names]) => <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <label htmlFor={id + key} style={{ minWidth: 32 }}>{label}</label>
            <button type="button" className="btn btn-ghost" style={btn} aria-label={`이전 ${label}`} onClick={() => step(key, -1)}>‹</button>
            <select id={id + key} value={v[key]} onChange={e => onChange({ ...v, [key]: Number(e.target.value) })} style={{ flex: '1 1 140px', minWidth: 0, minHeight: 36 }}>
              {names.map((name, n) => <option key={n} value={n}>{label} {n + 1} · {name}</option>)}
            </select>
            <button type="button" className="btn btn-ghost" style={btn} aria-label={`다음 ${label}`} onClick={() => step(key, 1)}>›</button>
          </div>)}
          {COLORS.map(([key, label]) => <ColorField key={key} label={label} value={v[key]} onChange={color => onChange({ ...v, [key]: color })} />)}
        </div>
      </div>
      <button type="button" className="btn btn-ghost" onClick={() => onChange(undefined)}>도트 캐릭터 지우기</button>
      <small>프로필의 SAVE를 눌러야 저장됩니다.</small>
    </>}
  </div>;
}
