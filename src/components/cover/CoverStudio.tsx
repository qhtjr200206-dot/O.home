'use client';
// 커버 메이커 스튜디오 — 왼쪽 미리보기(실제 렌더러로 그린 캔버스), 오른쪽 설정 패널.
// 파일은 전부 이 브라우저 안에서만 다룬다 (서버 업로드 없음).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import {
  DEFAULT_SETTINGS, RATIO_SIZE, type CoverSettings, type LyricLine, type Ratio, type ThemeId, type FontId,
  type VisualizerId, type MotionId, type ExportInput, type ExportResult,
} from '@/lib/cover/types';
import { makeFrame, renderFrame } from '@/lib/cover/render';
import { CoverAudio } from '@/lib/cover/audio';
import { THEMES, getTheme } from '@/lib/cover/themes';
import { FONTS, loadCoverFont, preloadFontPreviews } from '@/lib/cover/fonts';
import { derivePalette, extractColors } from '@/lib/cover/color';
import { parseLyrics, toLRC, lineIndexAt, isSynced } from '@/lib/cover/lyrics';
import { exportPNG, exportMP4, exportGIF, mp4Support } from '@/lib/cover/export';
import {
  listPresets, savePreset, renamePreset, deletePreset, presetsToJson, importPresetsJson, loadLast, saveLast, type CoverPreset,
} from '@/lib/cover/presets';
import { SyncTool, downloadText } from './SyncTool';
import { useCoverInviteStatus } from './CoverInviteRow';
import { setCoverInvite } from '@/lib/cover/gate';
import css from './cover.module.css';

type Tab = 'file' | 'text' | 'theme' | 'style' | 'lyrics' | 'export' | 'preset';
const TABS: { id: Tab; label: string }[] = [
  { id: 'file', label: '파일' }, { id: 'text', label: '글자' }, { id: 'theme', label: '테마' },
  { id: 'style', label: '스타일' }, { id: 'lyrics', label: '가사' }, { id: 'export', label: '내보내기' }, { id: 'preset', label: '프리셋' },
];

interface Photo { bmp: ImageBitmap; w: number; h: number; name: string; url: string }

const fmt = (t: number) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'cover';
const MAX_SIDE = 2048;

/* ---------- 아이콘 (선 SVG) ---------- */
const I = {
  image: <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></svg>,
  music: <svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>,
  text: <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h13" /></svg>,
  x: <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>,
  lock: <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>,
  down: <svg viewBox="0 0 24 24"><path d="M12 4v12m0 0-5-5m5 5 5-5M5 20h14" /></svg>,
  key: <svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9m-3 3 3 3" /></svg>,
};

/* ---------- 작은 부품 ---------- */
function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; t: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className={css.seg} role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button key={o.v} type="button" role="radio" aria-checked={value === o.v}
          className={`${css.segBtn} ${value === o.v ? css.segOn : ''}`} onClick={() => onChange(o.v)}>{o.t}</button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className={css.switch}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} aria-label={label} />
      <span className={css.switchTrack} />
    </label>
  );
}

function Slider({ label, value, min, max, step, onChange, show }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; show?: string }) {
  return (
    <div className={css.field}>
      <div className={css.fieldLabel}><span>{label}</span><span className={css.count}>{show ?? value}</span></div>
      <input className={css.range} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} aria-label={label} />
    </div>
  );
}

/** 테마 카드 썸네일 — 실제 렌더러로 정지 프레임 한 장 */
function ThemeThumb({ id, settings, photo, lyrics, time, ver }: { id: ThemeId; settings: CoverSettings; photo: Photo | null; lyrics: LyricLine[]; time: number; ver: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const c = ref.current; if (!c) return;
      const [rw, rh] = RATIO_SIZE[settings.ratio];
      const k = 340 / Math.max(rw, rh);
      c.width = Math.round(rw * k); c.height = Math.round(rh * k);
      const ctx = c.getContext('2d'); if (!ctx) return;
      const s = { ...settings, theme: id, motion: 'none' as MotionId };
      renderFrame(ctx, makeFrame({
        settings: s, width: c.width, height: c.height, time, duration: 30, playing: false,
        image: photo?.bmp ?? null, imageW: photo?.w ?? 0, imageH: photo?.h ?? 0, lyrics,
        spectrum: null, waveform: null, level: 0, palette: derivePalette(s.accent),
      }));
    }, 260);
    return () => clearTimeout(t);
  }, [id, settings, photo, lyrics, time, ver]);
  return <canvas ref={ref} className={css.thumb} />;
}

/* ====================================================================== */

export function CoverStudio() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('file');
  const [settings, setSettings] = useState<CoverSettings>(DEFAULT_SETTINGS);
  const [loadedLast, setLoadedLast] = useState(false);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [palette, setPaletteChips] = useState<string[]>([]);
  const [accentTouched, setAccentTouched] = useState(false);
  const [audio] = useState(() => new CoverAudio());
  const [audioName, setAudioName] = useState('');
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioDur, setAudioDur] = useState(0);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [lyricName, setLyricName] = useState('');
  const [lyricText, setLyricText] = useState('');
  const [syncOpen, setSyncOpen] = useState(false);
  const [uiTime, setUiTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fontVer, setFontVer] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const set = useCallback(<K extends keyof CoverSettings>(k: K, v: CoverSettings[K]) => setSettings(s => ({ ...s, [k]: v })), []);

  // 마지막 작업 설정 복원 → 이후 바뀔 때마다 자동 저장
  useEffect(() => { const l = loadLast(); if (l) { setSettings(l); setAccentTouched(true); } setLoadedLast(true); }, []);
  useEffect(() => {
    if (!loadedLast) return;
    const t = setTimeout(() => saveLast(settings), 400);
    return () => clearTimeout(t);
  }, [settings, loadedLast]);

  const duration = useMemo(() => {
    if (audioDur > 0) return audioDur;
    const last = [...lyrics].reverse().find(l => isFinite(l.time));
    return last ? last.time + 5 : 30;
  }, [audioDur, lyrics]);

  /* ---------- 오디오 없을 때 쓰는 시계 ---------- */
  const clock = useRef({ playing: false, start: 0, offset: 0 });
  const getTime = useCallback(() => {
    if (audio.buffer) return audio.time;
    const c = clock.current;
    if (!c.playing) return c.offset;
    const t = c.offset + (performance.now() - c.start) / 1000;
    return t % Math.max(1, duration);
  }, [audio, duration]);
  const isPlaying = () => (audio.buffer ? audio.playing : clock.current.playing);
  const play = useCallback(() => {
    if (audio.buffer) { void audio.play(); return; }
    const c = clock.current;
    if (!c.playing) { c.playing = true; c.start = performance.now(); }
  }, [audio]);
  const pause = useCallback(() => {
    if (audio.buffer) { audio.pause(); return; }
    const c = clock.current;
    if (c.playing) { c.offset = getTime(); c.playing = false; }
  }, [audio, getTime]);
  const seek = useCallback((t: number) => {
    if (audio.buffer) { audio.seek(t); return; }
    const c = clock.current;
    c.offset = Math.max(0, Math.min(duration, t)); c.start = performance.now();
  }, [audio, duration]);
  const toggle = useCallback(() => (isPlaying() ? pause() : play()), [pause, play]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { audio.dispose(); }, [audio]);
  useEffect(() => { audio.onEnded = () => setPlaying(false); }, [audio]);

  /* ---------- 미리보기 캔버스 ---------- */
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current; if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const [rw, rh] = RATIO_SIZE[settings.ratio];
      const aw = r.width - 40, ah = r.height - 40;
      const w = Math.max(80, Math.min(aw, (ah * rw) / rh));
      setBox({ w: Math.floor(w), h: Math.floor((w * rh) / rw) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [settings.ratio]);

  // 렌더 루프가 늘 최신 값을 보게
  const live = useRef({ settings, photo, lyrics, duration, dirty: true });
  live.current = { ...live.current, settings, photo, lyrics, duration };
  useEffect(() => { live.current.dirty = true; }, [settings, photo, lyrics, duration, box, fontVer]);

  useEffect(() => {
    const c = canvasRef.current; if (!c || !box.w) return;
    const [rw] = RATIO_SIZE[settings.ratio];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const k = Math.min(1, (box.w * dpr) / rw);
    const [w, h] = RATIO_SIZE[settings.ratio];
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    live.current.dirty = true;
  }, [box, settings.ratio]);

  /** 지금 프레임 한 장 그리기 — rAF 루프와 「멈춘 상태에서 설정이 바뀜」 양쪽에서 쓴다 */
  const draw = useCallback((): number | null => {
    const c = canvasRef.current; if (!c || !c.width) return null;
    const ctx = c.getContext('2d'); if (!ctx) return null;
    const L = live.current;
    L.dirty = false;
    const run = isPlaying();
    const time = getTime();
    const smp = audio.buffer ? audio.sample() : { spectrum: null, waveform: null, level: 0 };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    renderFrame(ctx, makeFrame({
      settings: L.settings, width: c.width, height: c.height, time, duration: L.duration, playing: run,
      image: L.photo?.bmp ?? null, imageW: L.photo?.w ?? 0, imageH: L.photo?.h ?? 0, lyrics: L.lyrics,
      spectrum: smp.spectrum, waveform: smp.waveform, level: smp.level, palette: derivePalette(L.settings.accent),
    }));
    return time;
  }, [audio, getTime]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let raf = 0, lastDraw = 0, lastUi = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const run = isPlaying();
      // 멈춰 있으면 바뀐 게 있을 때(또는 0.5초마다)만 다시 그린다
      if (!run && !live.current.dirty && ts - lastDraw < 500) return;
      lastDraw = ts;
      const time = draw();
      if (time != null && ts - lastUi > 120) { lastUi = ts; setUiTime(time); setPlaying(run); }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]); // eslint-disable-line react-hooks/exhaustive-deps

  // 탭이 가려져 rAF가 멈춰 있어도 설정을 바꾸면 미리보기는 갱신되게
  useEffect(() => {
    const t = setTimeout(() => { if (!isPlaying()) draw(); }, 30);
    return () => clearTimeout(t);
  }, [draw, settings, photo, lyrics, duration, box, fontVer]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- 폰트: 실제 그릴 글자까지 받아진 뒤 다시 그림 ---------- */
  const allText = useMemo(() => [settings.title, settings.artist, settings.phrase, ...lyrics.map(l => l.text)].join(''), [settings.title, settings.artist, settings.phrase, lyrics]);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      void loadCoverFont(settings.font, allText).then(() => { if (alive) setFontVer(v => v + 1); });
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [settings.font, allText]);
  useEffect(() => { void loadCoverFont('basic', '커버 메이커'); }, []);
  useEffect(() => { if (tab === 'style') void preloadFontPreviews().then(() => setFontVer(v => v + 1)); }, [tab]);

  // 스페이스 = 재생/일시정지 (입력 중·싱크 도구에서는 제외)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (syncOpen || inviteOpen) return;
      const tg = e.target as HTMLElement | null;
      if (tg && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(tg.tagName) || tg.isContentEditable)) return;
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, syncOpen, inviteOpen]);

  /* ---------- 파일 ---------- */
  const loadPhoto = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast('이미지 파일이 아닙니다'); return; }
    if (file.size > 60 * 1024 * 1024) { toast('사진이 너무 큽니다 (60MB 이하)'); return; }
    try {
      let bmp = await createImageBitmap(file);
      const big = Math.max(bmp.width, bmp.height);
      if (big > MAX_SIDE) {
        const k = MAX_SIDE / big;
        const small = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' });
        bmp.close(); bmp = small;
      }
      if (photo) { URL.revokeObjectURL(photo.url); photo.bmp.close(); }
      setPhoto({ bmp, w: bmp.width, h: bmp.height, name: file.name, url: URL.createObjectURL(file) });
      const chips = extractColors(bmp, 5);
      setPaletteChips(chips);
      if (chips[0] && !accentTouched) set('accent', chips[0]);
    } catch {
      toast('사진을 열 수 없습니다 (지원하지 않는 형식)');
    }
  };
  const loadAudio = async (file: File) => {
    if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|webm)$/i.test(file.name)) { toast('오디오 파일이 아닙니다'); return; }
    if (file.size > 300 * 1024 * 1024) { toast('오디오 파일이 너무 큽니다 (300MB 이하)'); return; }
    setAudioBusy(true);
    try {
      pause();
      await audio.load(file);
      setAudioName(file.name);
      setAudioDur(audio.duration);
      clock.current = { playing: false, start: 0, offset: 0 };
    } catch {
      toast('오디오를 읽을 수 없습니다 (이 브라우저가 지원하지 않는 형식일 수 있습니다)');
    } finally { setAudioBusy(false); }
  };
  const applyLyricText = (text: string, name?: string) => {
    const p = parseLyrics(text);
    setLyrics(p.lines);
    setLyricText(text);
    if (name !== undefined) setLyricName(name);
    setSettings(s => ({ ...s, title: s.title || p.meta.title || '', artist: s.artist || p.meta.artist || '' }));
    return p;
  };
  const loadLyricFile = async (file: File) => {
    if (file.size > 512 * 1024) { toast('가사 파일이 너무 큽니다'); return; }
    const text = await file.text();
    const p = applyLyricText(text, file.name);
    toast(p.synced ? `LRC ${p.lines.length}줄 — 싱크 그대로 사용합니다` : `가사 ${p.lines.length}줄 — 싱크가 없어 「가사」 탭에서 맞출 수 있습니다`);
  };
  const routeFile = (file: File) => {
    if (file.type.startsWith('image/')) return loadPhoto(file);
    if (file.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(file.name)) return loadAudio(file);
    if (/\.(lrc|txt)$/i.test(file.name) || file.type.startsWith('text/')) return loadLyricFile(file);
    toast(`알 수 없는 파일: ${file.name}`);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    Array.from(e.dataTransfer.files).slice(0, 3).forEach(f => void routeFile(f));
  };

  /* ---------- 내보내기 ---------- */
  const [support, setSupport] = useState<{ ok: boolean; method: string; note?: string } | null>(null);
  useEffect(() => { if (tab === 'export' && !support) void mp4Support().then(setSupport); }, [tab, support]);
  const [job, setJob] = useState<{ kind: string; phase: string; ratio: number } | null>(null);
  const [jobErr, setJobErr] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const [mp4Opt, setMp4Opt] = useState({ start: 0, end: 0, scale: 1 });
  const [gifOpt, setGifOpt] = useState({ start: 0, end: 8, maxSide: 540, fps: 12 });
  useEffect(() => { setMp4Opt(o => ({ ...o, start: 0, end: Math.round(duration * 10) / 10 })); setGifOpt(o => ({ ...o, start: 0, end: Math.min(8, Math.round(duration * 10) / 10) })); }, [duration]);

  const fileBase = `${safeName(settings.title || 'cover')}_${getTheme(settings.theme).name.replace(/\s+/g, '')}`;
  const exportInput = (): ExportInput => ({ settings, image: photo?.bmp ?? null, lyrics, audio: audio.buffer, duration });
  const save = (r: ExportResult) => {
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${fileBase}.${r.ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    if (r.note) toast(r.note);
  };
  const run = async (kind: 'PNG' | 'MP4' | 'GIF') => {
    if (job) return;
    pause();
    setJobErr('');
    const ac = new AbortController();
    abortRef.current = ac;
    setJob({ kind, phase: '준비', ratio: 0 });
    const onProgress = (p: { phase: string; ratio: number }) => setJob({ kind, phase: p.phase, ratio: p.ratio });
    try {
      let r: ExportResult;
      if (kind === 'PNG') r = await exportPNG(exportInput(), getTime());
      else if (kind === 'MP4') {
        const end = Math.min(duration, Math.max(mp4Opt.start + 0.5, mp4Opt.end || duration));
        r = await exportMP4(exportInput(), { start: Math.max(0, mp4Opt.start), end, fps: 30, scale: mp4Opt.scale, onProgress, signal: ac.signal });
      } else {
        const end = Math.max(gifOpt.start + 0.5, Math.min(gifOpt.end, gifOpt.start + 30));
        r = await exportGIF(exportInput(), { start: Math.max(0, gifOpt.start), end, fps: gifOpt.fps, maxSide: gifOpt.maxSide, onProgress, signal: ac.signal });
      }
      save(r);
      toast(`${kind} 저장 완료 (${(r.blob.size / 1024 / 1024).toFixed(1)}MB)`);
    } catch (e) {
      const err = e as Error;
      if (err?.name === 'AbortError') toast('내보내기를 취소했습니다');
      else { setJobErr(err?.message || '내보내기에 실패했습니다'); console.error('[cover] export', e); }
    } finally {
      setJob(null); abortRef.current = null;
    }
  };

  /* ---------- 프리셋 ---------- */
  const [presets, setPresets] = useState<CoverPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [delId, setDelId] = useState<string | null>(null);
  useEffect(() => { setPresets(listPresets()); }, []);
  const importRef = useRef<HTMLInputElement>(null);
  const exists = presets.some(p => p.name === presetName.trim());

  /* ---------- 화면 ---------- */
  const accentOn = derivePalette(settings.accent).onAccent;
  const rootStyle = { '--cv-accent': settings.accent, '--cv-on-accent': accentOn } as React.CSSProperties;
  const curIdx = lineIndexAt(lyrics, uiTime);
  const synced = isSynced(lyrics);
  const theme = getTheme(settings.theme);
  // 썸네일은 재생 위치를 따라가지 않는다 (재생 중 계속 다시 그리면 디바운스가 끝나지 않는다) — 둘째 가사 줄 시점
  const thumbTime = useMemo(() => {
    const t = lyrics.filter(l => isFinite(l.time)).map(l => l.time);
    return t.length > 1 ? t[1] + 0.6 : t.length ? t[0] + 0.6 : 8;
  }, [lyrics]);

  return (
    <div className={css.root} style={rootStyle} onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false); }} onDrop={onDrop}>
      <header className={css.head}>
        <div className={css.brand}>
          <span className={css.brandMark}>Cover<i>·</i>Studio</span>
          <span className={css.brandSub}>사진·가사·노래로 만드는 플레이리스트 커버</span>
        </div>
        <span className={css.headSpace} />
        <span className={css.privacy}>{I.lock}파일은 이 브라우저 안에서만 처리되며 서버로 올라가지 않습니다</span>
        {isAdmin && <button className={`${css.btn} ${css.btnGhost}`} onClick={() => setInviteOpen(true)}>{I.key}초대 코드</button>}
      </header>

      <div className={css.body}>
        <div className={css.stageCol}>
          <div className={css.stage} ref={stageRef}>
            <canvas ref={canvasRef} className={css.canvas} style={{ width: box.w, height: box.h }} aria-label="커버 미리보기" />
            {dragOver && <div className={css.dropHint}>사진 · 오디오 · 가사 파일을 놓으세요</div>}
          </div>
          <div className={css.transport}>
            <button className={css.playBtn} onClick={toggle} aria-label={playing ? '일시정지' : '재생'}>
              {playing ? <svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                : <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>}
            </button>
            <span className={css.time}>{fmt(uiTime)} / {fmt(duration)}</span>
            <input className={`${css.range} ${css.seek}`} type="range" min={0} max={duration} step={0.05} value={Math.min(uiTime, duration)}
              onChange={e => { seek(Number(e.target.value)); live.current.dirty = true; }} aria-label="재생 위치" />
            {!audio.buffer && <span className={css.transportNote}>오디오 없음 · 미리보기 시계</span>}
          </div>
        </div>

        <aside className={css.panel}>
          <nav className={css.tabs} role="tablist" aria-label="설정">
            {TABS.map(t => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={`${css.tab} ${tab === t.id ? css.tabOn : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </nav>

          {tab === 'file' && (
            <div className={css.pane}>
              <section className={css.sec}>
                <div className={css.secHead}><span className={css.secTitle}>사진</span><span className={css.secAside}>JPG · PNG · WEBP</span></div>
                <FileDrop accept="image/*" icon={photo ? <img src={photo.url} alt="" /> : I.image} name={photo?.name} meta={photo ? `${photo.w}×${photo.h}` : '커버 또는 배경으로 쓸 사진'}
                  onFile={f => void loadPhoto(f)} onClear={photo ? () => { URL.revokeObjectURL(photo.url); photo.bmp.close(); setPhoto(null); setPaletteChips([]); } : undefined} />
                <Seg label="사진 배치" value={settings.photoLayout} onChange={v => set('photoLayout', v)}
                  options={[{ v: 'cover', t: '커버형 (한쪽에 사진)' }, { v: 'background', t: '전체 배경' }]} />
              </section>
              <section className={css.sec}>
                <div className={css.secHead}><span className={css.secTitle}>노래</span><span className={css.secAside}>MP3 · M4A · WAV · OGG</span></div>
                <FileDrop accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.opus" icon={I.music} name={audioName || undefined}
                  meta={audioBusy ? '읽는 중…' : audioName ? `${fmt(audioDur)} · 비주얼라이저·싱크에 사용` : '비주얼라이저와 가사 싱크, 영상 소리에 쓰입니다'}
                  onFile={f => void loadAudio(f)} onClear={audioName ? () => { audio.clear(); setAudioName(''); setAudioDur(0); } : undefined} />
              </section>
              <section className={css.sec}>
                <div className={css.secHead}><span className={css.secTitle}>가사</span><span className={css.secAside}>LRC(싱크) · TXT</span></div>
                <FileDrop accept=".lrc,.txt,text/plain" icon={I.text} name={lyricName || undefined}
                  meta={lyrics.length ? `${lyrics.length}줄 · ${synced ? '싱크 있음' : '싱크 없음'}` : 'LRC는 그대로, TXT는 「가사」 탭에서 싱크'}
                  onFile={f => void loadLyricFile(f)} onClear={lyrics.length ? () => { setLyrics([]); setLyricName(''); setLyricText(''); } : undefined} />
              </section>
              <p className={css.hint}>파일을 미리보기 위로 끌어다 놓아도 됩니다. 모든 처리는 이 브라우저 안에서만 이루어집니다.</p>
            </div>
          )}

          {tab === 'text' && (
            <div className={css.pane}>
              <TextField label="제목" max={80} value={settings.title} onChange={v => set('title', v)} placeholder="노래 제목" />
              <TextField label="가수" max={80} value={settings.artist} onChange={v => set('artist', v)} placeholder="아티스트" />
              <TextField label="문구" max={120} value={settings.phrase} onChange={v => set('phrase', v)} placeholder="한 줄 소개 · 플레이리스트 이름 · 인용" />
              <p className={css.hint}>문구는 테마마다 다른 자리(플레이리스트 이름, 인용문, 메모 등)에 들어갑니다.</p>
            </div>
          )}

          {tab === 'theme' && (
            <div className={css.pane}>
              <div className={css.themeGrid}>
                {THEMES.map(t => (
                  <button key={t.id} className={`${css.themeCard} ${settings.theme === t.id ? css.themeOn : ''}`} aria-pressed={settings.theme === t.id}
                    onClick={() => set('theme', t.id)}>
                    <div className={css.thumbBox}><ThemeThumb id={t.id} settings={settings} photo={photo} lyrics={lyrics} time={thumbTime} ver={fontVer} /></div>
                    <span className={css.themeName}>{t.name}</span>
                    <span className={css.themeDesc}>{t.desc}</span>
                  </button>
                ))}
              </div>
              {theme.suggestedAccent && theme.suggestedAccent !== settings.accent && (
                <div className={css.rowBetween}>
                  <span className={css.labelSub}>이 테마 추천 포인트색</span>
                  <button className={css.btn} onClick={() => { set('accent', theme.suggestedAccent!); setAccentTouched(true); }}>
                    <span className={css.dot} style={{ background: theme.suggestedAccent }} />적용
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'style' && (
            <div className={css.pane}>
              <section className={css.sec}>
                <span className={css.secTitle}>비율</span>
                <Seg<Ratio> label="비율" value={settings.ratio} onChange={v => set('ratio', v)}
                  options={[{ v: '1:1', t: '1:1' }, { v: '4:5', t: '4:5' }, { v: '9:16', t: '9:16' }, { v: '16:9', t: '16:9' }]} />
              </section>
              <section className={css.sec}>
                <span className={css.secTitle}>포인트색</span>
                <div className={css.colorRow}>
                  <label className={css.colorWell} style={{ background: settings.accent }}>
                    <input type="color" value={settings.accent} onChange={e => { set('accent', e.target.value); setAccentTouched(true); }} aria-label="포인트색 고르기" />
                  </label>
                  <HexInput value={settings.accent} onChange={v => { set('accent', v); setAccentTouched(true); }} />
                </div>
                {palette.length > 0 ? (
                  <>
                    <span className={css.labelSub}>사진에서 뽑은 추천색</span>
                    <div className={css.chips}>
                      {palette.map(c => (
                        <button key={c} className={`${css.chip} ${c === settings.accent ? css.chipOn : ''}`} style={{ background: c }} aria-label={`추천색 ${c}`}
                          onClick={() => { set('accent', c); setAccentTouched(true); }} />
                      ))}
                    </div>
                  </>
                ) : <p className={css.hint}>사진을 올리면 사진에서 어울리는 색을 뽑아 추천합니다.</p>}
              </section>
              <section className={css.sec}>
                <span className={css.secTitle}>폰트</span>
                <div className={css.fontGrid}>
                  {FONTS.map(f => (
                    <button key={f.id} className={`${css.fontBtn} ${settings.font === f.id ? css.fontOn : ''}`} aria-pressed={settings.font === f.id} onClick={() => set('font', f.id as FontId)}>
                      <span className={css.fontSample} style={{ fontFamily: f.family, fontSize: 20 * f.scale }}>{f.label}</span>
                      <span className={css.fontLabel}>{f.name}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section className={css.sec}>
                <span className={css.secTitle}>비주얼라이저</span>
                <Seg<VisualizerId> label="비주얼라이저" value={settings.visualizer} onChange={v => set('visualizer', v)}
                  options={[{ v: 'none', t: '없음' }, { v: 'bars', t: '막대' }, { v: 'wave', t: '파형' }, { v: 'radial', t: '원형' }, { v: 'dots', t: '도트' }]} />
                {settings.visualizer !== 'none' && <Slider label="민감도" value={settings.vizGain} min={0.5} max={2} step={0.05} onChange={v => set('vizGain', v)} show={`${settings.vizGain.toFixed(2)}×`} />}
              </section>
              <section className={css.sec}>
                <span className={css.secTitle}>움직임</span>
                <Seg<MotionId> label="움직임" value={settings.motion} onChange={v => set('motion', v)}
                  options={[{ v: 'none', t: '없음' }, { v: 'sway', t: '흔들림' }, { v: 'breathe', t: '브리딩' }, { v: 'kenburns', t: '켄 번즈' }]} />
                {settings.motion !== 'none' && <Slider label="세기" value={settings.motionStrength} min={0.1} max={1} step={0.05} onChange={v => set('motionStrength', v)} show={`${Math.round(settings.motionStrength * 100)}%`} />}
              </section>
              <section className={css.sec}>
                <span className={css.secTitle}>배경 사진</span>
                <Slider label="어둡게" value={settings.bgDim} min={0} max={0.9} step={0.05} onChange={v => set('bgDim', v)} show={`${Math.round(settings.bgDim * 100)}%`} />
                <Slider label="흐림" value={settings.bgBlur} min={0} max={1} step={0.05} onChange={v => set('bgBlur', v)} show={`${Math.round(settings.bgBlur * 100)}%`} />
                <p className={css.hint}>「전체 배경」 배치와 일부 테마의 배경에 적용됩니다.</p>
              </section>
              <section className={css.sec}>
                <div className={css.rowBetween}><span className={css.label}>진행 막대·시간 표시</span><Switch label="진행 막대 표시" checked={settings.showProgress} onChange={v => set('showProgress', v)} /></div>
              </section>
            </div>
          )}

          {tab === 'lyrics' && (
            <div className={css.pane}>
              <section className={css.sec}>
                <div className={css.rowBetween}>
                  <span className={css.label}>가사 표시</span>
                  <Switch label="가사 표시" checked={settings.showLyrics} onChange={v => set('showLyrics', v)} />
                </div>
                <div className={css.rowBetween}>
                  <span className={css.label}>앞뒤 줄 흐리게 보기</span>
                  <Switch label="앞뒤 줄 흐리게 보기" checked={settings.lyricContext} onChange={v => set('lyricContext', v)} />
                </div>
                {settings.lyricContext && (
                  <Seg<string> label="앞뒤 줄 수" value={String(settings.lyricContextLines)} onChange={v => set('lyricContextLines', Number(v))}
                    options={[{ v: '1', t: '앞뒤 1줄' }, { v: '2', t: '2줄' }, { v: '3', t: '3줄' }]} />
                )}
              </section>
              <section className={css.sec}>
                <div className={css.secHead}>
                  <span className={css.secTitle}>가사 · {lyrics.length}줄</span>
                  {lyrics.length > 0 && <span className={`${css.badge} ${synced ? css.badgeOk : css.badgeWarn}`}>{synced ? '싱크 있음' : '싱크 필요'}</span>}
                </div>
                {lyrics.length > 0 ? (
                  <div className={css.lyricList}>
                    {lyrics.map((l, i) => (
                      <button key={i} className={`${css.lyricItem} ${i === curIdx ? css.lyricCur : ''}`} disabled={!isFinite(l.time)}
                        onClick={() => { if (isFinite(l.time)) { seek(l.time); live.current.dirty = true; } }}>
                        <span className={css.lyricTime}>{isFinite(l.time) ? fmt(l.time) : '—'}</span><span>{l.text}</span>
                      </button>
                    ))}
                  </div>
                ) : <div className={css.empty}>가사 파일을 올리거나 아래에 붙여 넣으세요</div>}
                <div className={css.grid2}>
                  <button className={`${css.btn} ${css.btnPrimary}`} disabled={!lyrics.length || !audio.buffer} onClick={() => { pause(); setSyncOpen(true); }}>
                    {synced ? '싱크 다시 맞추기' : '싱크 맞추기'}
                  </button>
                  <button className={css.btn} disabled={!synced} onClick={() => downloadText(toLRC(lyrics, { title: settings.title, artist: settings.artist }), `${fileBase}.lrc`)}>{I.down}LRC 내려받기</button>
                </div>
                {!audio.buffer && lyrics.length > 0 && <p className={css.hint}>싱크를 맞추려면 「파일」 탭에서 노래를 먼저 올려 주세요.</p>}
              </section>
              <section className={css.sec}>
                <span className={css.secTitle}>직접 입력 · 붙여 넣기</span>
                <textarea className={css.textarea} value={lyricText} onChange={e => setLyricText(e.target.value)}
                  placeholder={'한 줄에 한 소절씩 (LRC 형식 [00:12.30] 도 가능)'} aria-label="가사 직접 입력" />
                <button className={css.btn} disabled={!lyricText.trim()} onClick={() => { const p = applyLyricText(lyricText, lyricName || '직접 입력'); toast(`가사 ${p.lines.length}줄 적용`); }}>가사 적용</button>
              </section>
            </div>
          )}

          {tab === 'export' && (
            <div className={css.pane}>
              {jobErr && <div className={css.err} role="alert">{jobErr}</div>}
              {job && (
                <div className={css.exportCard}>
                  <div className={css.exportHead}><span className={css.exportName}>{job.kind} 만드는 중</span><span className={css.exportMeta}>{job.phase} · {Math.round(job.ratio * 100)}%</span></div>
                  <div className={css.progressTrack}><div className={css.progressFill} style={{ width: `${Math.round(job.ratio * 100)}%` }} /></div>
                  <button className={`${css.btn} ${css.btnDanger}`} onClick={() => abortRef.current?.abort()} disabled={job.kind === 'PNG'}>취소</button>
                </div>
              )}
              <div className={css.exportCard}>
                <div className={css.exportHead}><span className={css.exportName}>PNG</span><span className={css.exportMeta}>{RATIO_SIZE[settings.ratio].join('×')} · 지금 화면 한 장</span></div>
                <button className={`${css.btn} ${css.btnPrimary}`} disabled={!!job} onClick={() => void run('PNG')}>{I.down}PNG 저장</button>
              </div>
              <div className={css.exportCard}>
                <div className={css.exportHead}><span className={css.exportName}>MP4</span><span className={css.exportMeta}>30fps · {audio.buffer ? '소리 포함' : '무음'}</span></div>
                <div className={css.grid2}>
                  <NumField label="시작(초)" value={mp4Opt.start} max={duration} onChange={v => setMp4Opt(o => ({ ...o, start: v }))} />
                  <NumField label="끝(초)" value={mp4Opt.end} max={duration} onChange={v => setMp4Opt(o => ({ ...o, end: v }))} />
                </div>
                <Seg<string> label="해상도" value={String(mp4Opt.scale)} onChange={v => setMp4Opt(o => ({ ...o, scale: Number(v) }))}
                  options={[{ v: '1', t: `1080 (${RATIO_SIZE[settings.ratio].join('×')})` }, { v: '0.6667', t: '720' }]} />
                {support && <p className={css.hint}>{support.ok ? (support.method === 'webcodecs' ? '이 브라우저는 빠른 MP4 인코딩(WebCodecs)을 지원합니다 — 곡 길이보다 빨리 끝납니다.' : support.note || '실시간 녹화 방식 — 구간 길이만큼 걸립니다.') : (support.note || '이 브라우저에서는 영상 내보내기를 할 수 없습니다.')}</p>}
                <button className={`${css.btn} ${css.btnPrimary}`} disabled={!!job || (support !== null && !support.ok)} onClick={() => void run('MP4')}>{I.down}MP4 저장 ({fmt(Math.max(0, (mp4Opt.end || duration) - mp4Opt.start))})</button>
              </div>
              <div className={css.exportCard}>
                <div className={css.exportHead}><span className={css.exportName}>GIF</span><span className={css.exportMeta}>최대 30초 · 소리 없음</span></div>
                <div className={css.grid2}>
                  <NumField label="시작(초)" value={gifOpt.start} max={duration} onChange={v => setGifOpt(o => ({ ...o, start: v }))} />
                  <NumField label="끝(초)" value={gifOpt.end} max={duration} onChange={v => setGifOpt(o => ({ ...o, end: v }))} />
                </div>
                <Seg<string> label="GIF 크기" value={String(gifOpt.maxSide)} onChange={v => setGifOpt(o => ({ ...o, maxSide: Number(v) }))}
                  options={[{ v: '360', t: '360px' }, { v: '540', t: '540px' }, { v: '720', t: '720px' }]} />
                <Seg<string> label="GIF 프레임" value={String(gifOpt.fps)} onChange={v => setGifOpt(o => ({ ...o, fps: Number(v) }))}
                  options={[{ v: '10', t: '10fps' }, { v: '12', t: '12fps' }, { v: '15', t: '15fps' }]} />
                <button className={`${css.btn} ${css.btnPrimary}`} disabled={!!job} onClick={() => void run('GIF')}>{I.down}GIF 저장</button>
              </div>
              <p className={css.hint}>파일은 브라우저 안에서만 만들어지며 서버로 올라가지 않습니다. 긴 곡의 1080 영상은 메모리를 많이 쓰니 휴대폰에서는 720을 권합니다.</p>
            </div>
          )}

          {tab === 'preset' && (
            <div className={css.pane}>
              <section className={css.sec}>
                <span className={css.secTitle}>지금 설정 저장</span>
                <div className={css.row}>
                  <input className={css.input} value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="프리셋 이름" maxLength={60} aria-label="프리셋 이름" />
                  <button className={`${css.btn} ${css.btnPrimary}`} disabled={!presetName.trim()} onClick={() => {
                    try { setPresets(savePreset(presetName, settings)); toast(exists ? '프리셋을 덮어썼습니다' : '프리셋을 저장했습니다'); setPresetName(''); }
                    catch (e) { toast((e as Error).message); }
                  }}>{exists ? '덮어쓰기' : '저장'}</button>
                </div>
                {exists && <p className={css.hint}>같은 이름의 프리셋이 있습니다 — 저장하면 덮어씁니다.</p>}
                <p className={css.hint}>테마·폰트·색·비율·가사 표시·글자 같은 설정만 저장합니다. 사진·노래·가사 파일은 담기지 않습니다(이 기기 브라우저에 보관).</p>
              </section>
              <section className={css.sec}>
                <div className={css.secHead}><span className={css.secTitle}>저장된 프리셋 · {presets.length}</span></div>
                {presets.length ? (
                  <div className={css.presetList}>
                    {presets.map(p => (
                      <div key={p.id} className={css.presetItem}>
                        <span className={css.dot} style={{ background: p.settings.accent }} />
                        {editId === p.id ? (
                          <input className={css.input} value={editName} autoFocus onChange={e => setEditName(e.target.value)} aria-label="새 이름"
                            onKeyDown={e => {
                              if (e.key === 'Enter') { try { setPresets(renamePreset(p.id, editName)); setEditId(null); } catch (er) { toast((er as Error).message); } }
                              if (e.key === 'Escape') setEditId(null);
                            }} />
                        ) : (
                          <span className={css.presetName} title={p.name}>{p.name}<br /><span className={css.presetMeta}>{getTheme(p.settings.theme).name} · {FONTS.find(f => f.id === p.settings.font)?.label} · {p.settings.ratio}</span></span>
                        )}
                        {delId === p.id ? (
                          <>
                            <button className={`${css.btn} ${css.btnDanger}`} onClick={() => { setPresets(deletePreset(p.id)); setDelId(null); toast('삭제했습니다'); }}>삭제 확인</button>
                            <button className={`${css.btn} ${css.btnGhost}`} onClick={() => setDelId(null)}>취소</button>
                          </>
                        ) : editId === p.id ? (
                          <button className={css.btn} onClick={() => { try { setPresets(renamePreset(p.id, editName)); setEditId(null); } catch (er) { toast((er as Error).message); } }}>확인</button>
                        ) : (
                          <>
                            <button className={css.btn} onClick={() => { setSettings(p.settings); setAccentTouched(true); toast(`「${p.name}」 불러옴`); }}>불러오기</button>
                            <button className={`${css.btn} ${css.btnGhost}`} onClick={() => { setEditId(p.id); setEditName(p.name); }} aria-label="이름 바꾸기">이름</button>
                            <button className={`${css.btn} ${css.btnGhost}`} onClick={() => downloadText(presetsToJson([p]), `${safeName(p.name)}.cover.json`, 'application/json')} aria-label="JSON으로 내보내기">JSON</button>
                            <button className={`${css.btn} ${css.btnGhost} ${css.btnDanger}`} onClick={() => setDelId(p.id)} aria-label="삭제">{I.x}</button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ) : <div className={css.empty}>아직 저장한 프리셋이 없습니다</div>}
              </section>
              <section className={css.sec}>
                <span className={css.secTitle}>JSON 백업</span>
                <div className={css.grid2}>
                  <button className={css.btn} disabled={!presets.length} onClick={() => downloadText(presetsToJson(presets), 'cover-presets.json', 'application/json')}>{I.down}전체 내보내기</button>
                  <button className={css.btn} onClick={() => importRef.current?.click()}>가져오기</button>
                </div>
                <input ref={importRef} type="file" accept=".json,application/json" className={css.fileInput} onChange={async e => {
                  const f = e.target.files?.[0]; e.target.value = '';
                  if (!f) return;
                  try { const r = importPresetsJson(await f.text()); setPresets(r.list); toast(`프리셋 ${r.added}개를 가져왔습니다`); }
                  catch (er) { toast((er as Error).message); }
                }} />
              </section>
            </div>
          )}
        </aside>
      </div>

      {syncOpen && (
        <SyncTool audio={audio} texts={lyrics.map(l => l.text)} meta={{ title: settings.title, artist: settings.artist }} fileBase={fileBase}
          onClose={() => setSyncOpen(false)}
          onApply={lines => { setLyrics(lines); setLyricText(toLRC(lines, { title: settings.title, artist: settings.artist })); setSyncOpen(false); toast('싱크를 적용했습니다'); }} />
      )}
      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} toast={toast} />}
    </div>
  );
}

/* ---------- 부품들 ---------- */

function FileDrop({ accept, icon, name, meta, onFile, onClear }: { accept: string; icon: React.ReactNode; name?: string; meta: string; onFile: (f: File) => void; onClear?: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className={`${css.drop} ${name ? css.dropFilled : ''}`} role="button" tabIndex={0}
      onClick={() => ref.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ref.current?.click(); } }}>
      <span className={css.dropIcon}>{icon}</span>
      <span className={css.dropText}>
        <span className={css.dropName}>{name || '파일 선택'}</span>
        <span className={css.dropMeta}>{meta}</span>
      </span>
      {onClear && <button className={css.x} onClick={e => { e.stopPropagation(); onClear(); }} aria-label="지우기">{I.x}</button>}
      <input ref={ref} type="file" accept={accept} className={css.fileInput} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
    </div>
  );
}

function TextField({ label, value, onChange, placeholder, max }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; max: number }) {
  return (
    <label className={css.field}>
      <span className={css.fieldLabel}><span>{label}</span><span className={css.count}>{value.length}/{max}</span></span>
      <input className={css.input} value={value} maxLength={max} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </label>
  );
}

function NumField({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className={css.field}>
      <span className={css.fieldLabel}><span>{label}</span><span className={css.count}>{fmt(value)}</span></span>
      <input className={css.input} type="number" min={0} max={Math.ceil(max)} step={0.1} value={value}
        onChange={e => { const v = Number(e.target.value); if (isFinite(v)) onChange(Math.max(0, Math.min(Math.ceil(max), v))); }} />
    </label>
  );
}

function HexInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input className={`${css.input} ${css.hexInput}`} value={v} maxLength={7} aria-label="포인트색 HEX"
      onChange={e => {
        const t = e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value;
        setV(t);
        if (/^#[0-9a-f]{6}$/i.test(t)) onChange(t.toLowerCase());
      }} />
  );
}

function InviteModal({ onClose, toast }: { onClose: () => void; toast: (t: string) => void }) {
  const status = useCoverInviteStatus();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className={css.modalBack} role="dialog" aria-modal="true" aria-label="초대 코드" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={css.modal}>
        <h2 className={css.modalTitle}>커버 메이커 초대 코드</h2>
        <p className={css.hint}>관리자가 아닌 사람은 이 코드를 입력해야 들어올 수 있습니다. 회원 가입코드와는 별개이며, 바꾸면 이미 들어온 사람도 새 코드를 다시 입력해야 합니다.</p>
        <span className={css.badge}>{status}</span>
        <input className={css.input} value={code} onChange={e => setCode(e.target.value)} placeholder="새 코드 (4자 이상, 6자 이상 권장)" autoComplete="off" maxLength={64} autoFocus aria-label="새 초대 코드" />
        <div className={css.modalFoot}>
          <button className={`${css.btn} ${css.btnGhost}`} onClick={onClose}>닫기</button>
          <button className={`${css.btn} ${css.btnPrimary}`} disabled={busy || code.trim().length < 4} onClick={async () => {
            setBusy(true);
            try { await setCoverInvite(code); toast('초대 코드를 바꿨습니다'); onClose(); }
            catch (e) { toast((e as Error).message); }
            finally { setBusy(false); }
          }}>저장</button>
        </div>
      </div>
    </div>
  );
}
