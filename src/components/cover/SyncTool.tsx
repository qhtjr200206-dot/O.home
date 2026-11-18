'use client';
// 가사 싱크 도구 — 노래를 틀어 두고 줄이 시작될 때마다 탭(스페이스)으로 시각을 찍는다.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CoverAudio } from '@/lib/cover/audio';
import type { LyricLine } from '@/lib/cover/types';
import { toLRC } from '@/lib/cover/lyrics';
import css from './cover.module.css';

const fmt = (t: number) => {
  if (!isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};

export function downloadText(text: string, name: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function SyncTool({ audio, texts, meta, fileBase, onApply, onClose }: {
  audio: CoverAudio;
  texts: string[];
  meta: { title?: string; artist?: string };
  fileBase: string;
  onApply: (lines: LyricLine[]) => void;
  onClose: () => void;
}) {
  const [stamps, setStamps] = useState<number[]>(() => texts.map(() => NaN));
  const [idx, setIdx] = useState(0);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    const tick = () => { setNow(audio.time); setPlaying(audio.playing); raf.current = requestAnimationFrame(tick); };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [audio]);

  const tap = useCallback(() => {
    if (idx >= texts.length) return;
    if (!audio.playing) void audio.play();
    const t = audio.time;
    setStamps(s => { const n = s.slice(); n[idx] = t; return n; });
    setIdx(i => i + 1);
  }, [audio, idx, texts.length]);

  const undo = useCallback(() => {
    if (idx <= 0) return;
    const back = idx - 1;
    setStamps(s => { const n = s.slice(); n[back] = NaN; return n; });
    setIdx(back);
    // 직전 줄 조금 앞으로 되감아 다시 찍을 수 있게
    const prev = back > 0 ? stamps[back - 1] : 0;
    audio.seek(Math.max(0, (isFinite(prev) ? prev : 0) - 0.5));
  }, [audio, idx, stamps]);

  const restart = () => {
    setStamps(texts.map(() => NaN)); setIdx(0); audio.seek(0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement | null;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
      if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); tap(); }
      else if (e.key === 'Backspace') { e.preventDefault(); undo(); }
      else if (e.key === 'Escape') { onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tap, undo, onClose]);

  const done = idx >= texts.length;
  const lines: LyricLine[] = texts.map((t, i) => ({ time: stamps[i], text: t }));
  const view = [-2, -1, 0, 1, 2, 3].map(d => idx + d).filter(i => i >= 0 && i < texts.length);

  return (
    <div className={css.modalBack} role="dialog" aria-modal="true" aria-label="가사 싱크 도구">
      <div className={`${css.modal} ${css.modalWide}`}>
        <div className={css.rowBetween}>
          <h2 className={css.modalTitle}>가사 싱크 맞추기</h2>
          <span className={css.badge}>{Math.min(idx, texts.length)} / {texts.length}줄</span>
        </div>
        <p className={css.hint}>
          노래를 재생하고, 각 줄이 <b>시작되는 순간</b> <span className={css.kbd}>Space</span> 또는 아래 큰 버튼을 누르세요.
          잘못 찍었으면 <span className={css.kbd}>Backspace</span>로 한 줄 되돌립니다.
        </p>
        <div className={css.sync}>
          <div className={css.syncLines}>
            {view.map(i => (
              <div key={i} className={`${css.syncLine} ${i < idx ? css.syncDone : ''} ${i === idx ? css.syncNext : ''}`}>
                <span className={css.lyricTime}>{i < idx ? fmt(stamps[i]) : i === idx ? '다음 ▸' : ''}</span>
                <b>{texts[i]}</b>
              </div>
            ))}
            {done && <div className={`${css.syncLine} ${css.syncNext}`}><span className={css.lyricTime}>완료</span><b>모든 줄을 찍었습니다</b></div>}
          </div>
          <div className={css.transport}>
            <button className={css.playBtn} onClick={() => (audio.playing ? audio.pause() : void audio.play())} aria-label={playing ? '일시정지' : '재생'}>
              {playing ? <svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                : <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>}
            </button>
            <span className={css.time}>{fmt(now)}</span>
            <input className={`${css.range} ${css.seek}`} type="range" min={0} max={audio.duration || 1} step={0.01} value={now}
              onChange={e => audio.seek(Number(e.target.value))} aria-label="재생 위치" />
          </div>
          <button className={css.tapBtn} onClick={tap} disabled={done}>
            {done ? '다 찍었습니다' : '지금 이 줄 시작!'}
            <small>{done ? '아래에서 적용하세요' : texts[idx]}</small>
          </button>
          <div className={css.row} style={{ flexWrap: 'wrap' }}>
            <button className={css.btn} onClick={undo} disabled={idx === 0}>한 줄 되돌리기</button>
            <button className={css.btn} onClick={restart}>처음부터</button>
            <span style={{ flex: 1 }} />
            <button className={css.btn} disabled={!done} onClick={() => downloadText(toLRC(lines, meta), `${fileBase}.lrc`)}>LRC 내려받기</button>
          </div>
        </div>
        <div className={css.modalFoot}>
          <button className={`${css.btn} ${css.btnGhost}`} onClick={() => { audio.pause(); onClose(); }}>닫기</button>
          <button className={`${css.btn} ${css.btnPrimary}`} disabled={!done} onClick={() => { audio.pause(); onApply(lines); }}>싱크 적용</button>
        </div>
      </div>
    </div>
  );
}
