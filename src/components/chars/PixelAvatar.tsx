'use client';

import React from 'react';

export interface PixelAvatarData {
  hair: number;
  face: number;
  body: number;
  hairColor: string;
  skinColor: string;
  bodyColor: string;
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

export function PixelAvatar({ value, size = 120 }: { value: PixelAvatarData; size?: number }) {
  const rects: React.ReactNode[] = [];
  const draw = (rows: string[], y: number, colors: Record<string, string>, x = 0) => rows.forEach((row, dy) =>
    [...row].forEach((pixel, dx) => { if (colors[pixel]) rects.push(<rect key={`${y}-${x}-${dy}-${dx}-${rects.length}`} x={x + dx} y={y + dy} width="1" height="1" fill={colors[pixel]} />); }));
  draw(['....SSSSSSSS....','...SSSSSSSSSS...','..SSSSSSSSSSSS..','..SSSSSSSSSSSS..','..SSSSSSSSSSSS..','...SSSSSSSSSS...','....SSSSSSSS....','.....SSSSSS.....'], 3, { S: value.skinColor });
  draw(bodies[value.body] ?? bodies[0], 11, { B: value.bodyColor, W: '#f4eee7' });
  draw(hair[value.hair] ?? hair[0], 0, { H: value.hairColor });
  draw(faces[value.face] ?? faces[0], 6, { E: '#302b36', M: '#a45b60' }, 1);
  return <svg role="img" aria-label="도트 캐릭터" viewBox="0 0 16 20" width={size * 0.8} height={size} shapeRendering="crispEdges" style={{ imageRendering: 'pixelated', flexShrink: 0 }}>{rects}</svg>;
}

export function PixelAvatarEditor({ value, onChange }: { value?: PixelAvatarData; onChange: (v: PixelAvatarData | undefined) => void }) {
  const v = value ?? DEFAULT_PIXEL_AVATAR;
  return <div style={{ display: 'grid', gap: 10, color: 'var(--ink)' }}>
    <label className="k-label">도트 캐릭터</label>
    {!value ? <button type="button" className="btn btn-ghost" onClick={() => onChange({ ...DEFAULT_PIXEL_AVATAR })}>도트 캐릭터 만들기</button> : <>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <PixelAvatar value={v} />
        <div style={{ display: 'grid', gap: 8 }}>
          {([['hair', '머리'], ['face', '표정'], ['body', '몸']] as const).map(([key, label]) => <label key={key}>{label} <select value={v[key]} onChange={e => onChange({ ...v, [key]: Number(e.target.value) })}>{[0, 1, 2].map(n => <option key={n} value={n}>{label} {n + 1}</option>)}</select></label>)}
          {([['hairColor', '머리색'], ['skinColor', '피부색'], ['bodyColor', '옷 색']] as const).map(([key, label]) => <label key={key}>{label} <input type="color" value={v[key]} onChange={e => onChange({ ...v, [key]: e.target.value })} /></label>)}
        </div>
      </div>
      <button type="button" className="btn btn-ghost" onClick={() => onChange(undefined)}>도트 캐릭터 지우기</button>
      <small>프로필의 SAVE를 눌러야 저장됩니다.</small>
    </>}
  </div>;
}
