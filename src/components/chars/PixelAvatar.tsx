'use client';

import React, { useEffect, useState } from 'react';

export interface PixelAvatarData {
  hair: number;
  face: number;
  body: number;
  hairColor: string;
  skinColor: string;
  bodyColor: string;
  eyeColor?: string;
}

export const DEFAULT_PIXEL_AVATAR: PixelAvatarData = {
  hair: 0, face: 0, body: 0,
  hairColor: '#554050', skinColor: '#edbd9f', bodyColor: '#647a9a',
};

// 직접 그린 16×20 도트 파츠. 각 문자는 하나의 픽셀이다.
const hair = [
  ['....HHHHHHHH....','...HHHHHHHHHH...','..HHHHHHHHHHHH..','..HHH......HHH..','..HH........HH..'],
  ['....HHHHHHHH....','...HHHHHHHHHH...','..HHHHHHHHHHHH..','..HHHHHH...HHH..','..HHH.......HH..'],
  ['....HHHHHHHH....','...HHHHHHHHHH...','..HHHHHHHHHHHH..','..HHH......HHH..','..HH........HH..','..HH........HH..','..HH........HH..','..HH........HH..'],
];
const faces = [
  ['....E....E....','..............','......M.......'],
  ['....EE..EE....','..............','.....MMM......'],
  ['....E....E....','..............','.....M.M......','......M.......'],
];
const bodies = [
  ['.....BBBBBB.....','....BBBBBBBB....','...BBBBBBBBBB...','...BBBBBBBBBB...','...BBBBBBBBBB...','....BB....BB....','....BB....BB....'],
  ['.....BBBBBB.....','....BBWWWWBB....','...BBWWWWWWBB...','...BBWWWWWWBB...','...BBBBBBBBBB...','....BB....BB....','....BB....BB....'],
  ['.....BBBBBB.....','....BBBBBBBB....','...BBBWBBWBBB...','...BBBWBBWBBB...','...BBBBBBBBBB...','....BB....BB....','....BB....BB....'],
];

const STYLE_COUNT = 24;
const DEFAULT_EYE = '#302b36';
const validColor = (value: unknown, fallback: string) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
const styleIndex = (value: number) => Number.isInteger(value) && value >= 0 && value < STYLE_COUNT ? value : 0;

export function PixelAvatar({ value, size = 120 }: { value: PixelAvatarData; size?: number }) {
  const rects: React.ReactNode[] = [];
  const add = (x: number, y: number, width: number, height: number, fill: string) => rects.push(<rect key={rects.length} x={x} y={y} width={width} height={height} fill={fill} />);
  const draw = (rows: string[], y: number, colors: Record<string, string>, x = 0) => rows.forEach((row, dy) =>
    [...row].forEach((pixel, dx) => { if (colors[pixel]) add((x + dx) * 2, (y + dy) * 2, 2, 2, colors[pixel]); }));
  const h = styleIndex(value.hair), f = styleIndex(value.face), b = styleIndex(value.body);
  const hc = validColor(value.hairColor, DEFAULT_PIXEL_AVATAR.hairColor), sc = validColor(value.skinColor, DEFAULT_PIXEL_AVATAR.skinColor);
  const bc = validColor(value.bodyColor, DEFAULT_PIXEL_AVATAR.bodyColor), ec = validColor(value.eyeColor, DEFAULT_EYE);
  const white = '#f4eee7', mouth = '#a45b60';
  draw(['....SSSSSSSS....','...SSSSSSSSSS...','..SSSSSSSSSSSS..','..SSSSSSSSSSSS..','..SSSSSSSSSSSS..','...SSSSSSSSSS...','....SSSSSSSS....','.....SSSSSS.....'], 3, { S: sc });
  if (b < 3) draw(bodies[b], 11, { B: bc, W: white });
  else {
    const shape = Math.floor((b - 3) / 3), detail = (b - 3) % 3;
    add(10, 22, 12, 2, bc); add(8 - shape % 2, 24, 16 + 2 * (shape % 2), 8, bc);
    add(8, 32, 6 + shape % 3, 4, bc); add(18 - shape % 3, 32, 6 + shape % 3, 4, bc);
    if (shape === 1 || shape === 5) add(10, 32, 12, 4, bc);
    if (shape === 2 || shape === 6) { add(6, 25, 2, 7, bc); add(24, 25, 2, 7, bc); }
    if (shape === 3 || shape === 5) { add(12, 36, 3, 2, bc); add(17, 36, 3, 2, bc); }
    if (shape === 4 || shape === 6) add(9, 29, 14, 2, white);
    if (detail === 0) { add(13, 23, 2, 3, white); add(17, 23, 2, 3, white); }
    if (detail === 1) { add(15, 24, 2, 6, white); add(12, 28, 8, 1, white); }
    if (detail === 2) { add(11, 26, 10, 2, white); add(14, 29, 4, 2, white); }
  }
  if (h < 3) draw(hair[h], 0, { H: hc });
  else {
    const cut = Math.floor((h - 3) / 3), fringe = (h - 3) % 3;
    add(8, 0, 16, 2, hc); add(6, 2, 20, 3, hc); add(4, 5, 24, 2, hc);
    add(4, 7, 4, 3 + cut * 2, hc); add(24, 7, 4, 3 + cut * 2, hc);
    if (cut === 1 || cut === 4) { add(2, 9, 3, 7, hc); add(27, 9, 3, 7, hc); }
    if (cut === 2 || cut === 5) { add(2, 1, 5, 4, hc); add(25, 1, 5, 4, hc); }
    if (cut === 3 || cut === 6) { add(10, 0, 3, 3, sc); add(19, 0, 3, 3, sc); }
    if (fringe === 0) add(8, 7, 9, 3, hc);
    if (fringe === 1) { add(14, 7, 10, 3, hc); add(20, 10, 4, 2, hc); }
    if (fringe === 2) { add(8, 7, 5, 2, hc); add(19, 7, 5, 2, hc); }
  }
  if (f < 3) draw(faces[f], 6, { E: ec, M: mouth }, 1);
  else {
    const eyes = Math.floor((f - 3) / 3), expression = (f - 3) % 3;
    const widths = [2, 3, 4, 3, 2, 4, 3], heights = [2, 2, 2, 3, 3, 1, 1];
    add(10, 12, widths[eyes], heights[eyes], ec); add(22 - widths[eyes], 12, widths[eyes], heights[eyes], ec);
    if (eyes === 3 || eyes === 4) { add(11, 12, 1, 1, white); add(20, 12, 1, 1, white); }
    if (eyes === 5) { add(9, 11, 1, 1, ec); add(22, 11, 1, 1, ec); }
    if (eyes === 6) { add(10, 11, 2, 1, ec); add(20, 13, 2, 1, ec); }
    if (expression === 0) add(15, 18, 2, 1, mouth);
    if (expression === 1) { add(13, 17, 1, 1, mouth); add(14, 18, 4, 1, mouth); add(18, 17, 1, 1, mouth); }
    if (expression === 2) { add(14, 17, 4, 2, mouth); add(15, 19, 2, 1, mouth); }
  }
  return <svg role="img" aria-label="도트 캐릭터" viewBox="0 0 32 40" width={size * 0.8} height={size} shapeRendering="crispEdges" style={{ imageRendering: 'pixelated', flexShrink: 0 }}>{rects}</svg>;
}

function ColorField({ label, value, fallback, onChange }: { label: string; value?: string; fallback: string; onChange: (value: string) => void }) {
  const safe = validColor(value, fallback);
  const [text, setText] = useState(safe);
  useEffect(() => { setText(safe); }, [safe]);
  return <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
    <legend>{label}</legend>
    <label>{label} 선택 <input type="color" value={safe} onChange={e => onChange(e.target.value)} /></label>{' '}
    <label>{label} HEX <input type="text" value={text} maxLength={7} spellCheck={false} aria-invalid={text !== '' && !/^#[\da-f]{6}$/i.test(text)} onChange={e => { const next = e.target.value; setText(next); if (/^#[\da-f]{6}$/i.test(next)) onChange(next); }} onBlur={() => setText(safe)} /></label>
  </fieldset>;
}

export function PixelAvatarEditor({ value, onChange }: { value?: PixelAvatarData; onChange: (v: PixelAvatarData | undefined) => void }) {
  const v = value ?? DEFAULT_PIXEL_AVATAR;
  return <div style={{ display: 'grid', gap: 10, color: 'var(--ink)' }}>
    <span className="k-label">도트 캐릭터</span>
    {!value ? <button type="button" className="btn btn-ghost" onClick={() => onChange({ ...DEFAULT_PIXEL_AVATAR })}>도트 캐릭터 만들기</button> : <>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <PixelAvatar value={v} />
        <div style={{ display: 'grid', gap: 8 }}>
          {([['hair', '머리'], ['face', '표정'], ['body', '몸']] as const).map(([key, label]) => <label key={key}>{label} <select value={styleIndex(v[key])} onChange={e => onChange({ ...v, [key]: Number(e.target.value) })}>{Array.from({ length: STYLE_COUNT }, (_, n) => <option key={n} value={n}>{label} {n + 1}</option>)}</select></label>)}
          {([['hairColor', '머리색', DEFAULT_PIXEL_AVATAR.hairColor], ['skinColor', '피부색', DEFAULT_PIXEL_AVATAR.skinColor], ['bodyColor', '옷 색', DEFAULT_PIXEL_AVATAR.bodyColor], ['eyeColor', '눈 색', DEFAULT_EYE]] as const).map(([key, label, fallback]) => <ColorField key={key} label={label} value={v[key]} fallback={fallback} onChange={color => onChange({ ...v, [key]: color })} />)}
        </div>
      </div>
      <button type="button" className="btn btn-ghost" onClick={() => onChange(undefined)}>도트 캐릭터 지우기</button>
      <small>프로필의 SAVE를 눌러야 저장됩니다.</small>
    </>}
  </div>;
}
