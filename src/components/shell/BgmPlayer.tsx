'use client';
// BGM 미니 플레이어 (4.1) — 유튜브 IFrame API, 화면은 숨기고 자체 컨트롤만 표시
// 기본 위치 오른쪽 아래 · 곡 리스트 팝업 (v1.9) · 페이지 이동에도 유지(레이아웃 상주)
// 브라우저 정책상 소리 재생은 사용자의 첫 클릭부터 시작
// 페이지 테마곡 (페어 테마곡) — 페이지가 useBgm().setPageTrack으로 곡을 넘기면 재생목록 대신 그 곡으로
// 바꿨다가(소리를 줄였다 키우는 페이드), 페이지를 나가면 듣던 곡·위치로 돌아간다
import React, { useEffect, useRef, useState } from 'react';
import { useBgm, BgmTrack } from '@/lib/bgmStore';

/** 흐르는 글씨 — 재생 중이고 글자가 넘칠 때만 무한 스크롤, 평소엔 말줄임.
 *  넘침 판정은 숨김 측정용 스팬으로 — 마운트 직후(레이아웃·폰트 확정 전) 1회 측정만 하면
 *  짧은 제목도 흐르는 글씨로 오판되는 버그가 있어 ResizeObserver로 계속 재측정 */
function Marquee({ text, active, className }: { text: string; active: boolean; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const measRef = useRef<HTMLSpanElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const box = boxRef.current, meas = measRef.current;
    if (!box || !meas) return;
    const m = () => setOver(meas.scrollWidth > box.clientWidth + 1);
    m();
    const ro = new ResizeObserver(m);
    ro.observe(box);
    ro.observe(meas);
    return () => ro.disconnect();
  }, [text]);
  const run = active && over;
  return (
    <div ref={boxRef} className={`mq ${className ?? ''} ${run ? 'run' : ''}`} style={{ position: 'relative' }}>
      <span ref={measRef} aria-hidden
        style={{ position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
        {text}
      </span>
      {run ? <span className="mq-in"><span>{text}</span><span>{text}</span></span> : text}
    </div>
  );
}

/* 최소한의 YT IFrame API 타입 */
type YTLoad = string | { videoId: string; startSeconds?: number };
interface YTPlayer {
  loadVideoById: (v: YTLoad) => void;
  cueVideoById: (v: YTLoad) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  setVolume: (v: number) => void;
  getCurrentTime: () => number;
  destroy: () => void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayer; PlayerState: { ENDED: number } };
    onYouTubeIframeAPIReady?: () => void;
  }
}

// 곡 목록 픽토그램 (리스트 줄 + 음표) — 색은 CSS에서 currentColor(--bgm-ic) 연동
const ListIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M21 15V6" />
    <circle cx="18.5" cy="15.5" r="2.5" />
    <path d="M16 6H3" /><path d="M12 12H3" /><path d="M12 18H3" />
  </svg>
);

export function BgmPlayer() {
  const { state, pageTrack } = useBgm();
  const { tracks, settings } = state;
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [volume, setVolume] = useState(settings.volume);
  // 접기 상태 — 방문자별 기억 (4.1)
  const [folded, setFolded] = useState(false);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);       // onReady 이후에만 playVideo가 실제 동작 (그 전엔 무시됨)
  const startedRef = useRef(false);     // 한 번이라도 실제 재생 시작됨 — 첫 재생은 loadVideoById 경로 필수
  /* 소리를 내고 있어야 하는 상태 — 사용자가 멈췄거나 아직 안 틀었으면 false.
     유튜브는 곡을 바꾸는 순간 잠깐 「미시작(-1)」을 보내 playing이 흔들리므로, 테마곡 전환 때
     「틀어 둘지」는 이 값으로 판단한다 (사용자가 멈춰 둔 BGM을 멋대로 켜지 않기) */
  const wantPlayRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const volRef = useRef<HTMLDivElement>(null);
  const idxRef = useRef(0);
  idxRef.current = idx;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  /* ---- 페이지 테마곡 ---- */
  const [ov, setOv] = useState<BgmTrack | null>(null);      // 지금 플레이어에 걸린 테마곡
  const ovRef = useRef<BgmTrack | null>(null);
  // 이 페이지에서 사용자가 재생목록 곡을 직접 골라 테마곡을 끈 경우 — 그 곡 id (페이지를 나가면 풀림)
  const [offVid, setOffVid] = useState<string | null>(null);
  const resumeRef = useRef<{ idx: number; t: number } | null>(null);  // 테마곡 전에 듣던 곡·위치
  const startAtRef = useRef(0);         // 다음 loadCur의 시작 위치 (멈춘 채 전환했을 때 위치 보존)
  const fadeRef = useRef<number | null>(null);

  const track = ov ?? tracks[idx] ?? tracks[0];
  const hasAny = tracks.length > 0 || !!pageTrack;
  /** 지금 재생해야 할 영상 — 테마곡이 걸려 있으면 그것, 아니면 재생목록의 현재 곡 */
  const curVid = () => ovRef.current?.videoId ?? (tracks[idxRef.current] ?? tracks[0])?.videoId;

  const stopFade = () => {
    if (fadeRef.current !== null) { clearInterval(fadeRef.current); fadeRef.current = null; }
  };
  /** 플레이어 볼륨을 from→to로 서서히 (YT 플레이어 하나라 겹치는 크로스페이드 대신 줄였다 키우기) */
  const fadeVol = (from: number, to: number, ms: number, done?: () => void) => {
    stopFade();
    const p = playerRef.current;
    if (!p) { done?.(); return; }
    const steps = Math.max(1, Math.round(ms / 40));
    let i = 0;
    fadeRef.current = window.setInterval(() => {
      i++;
      try { p.setVolume(Math.round(from + (to - from) * (i / steps))); } catch { /* 파괴됨 */ }
      if (i >= steps) { stopFade(); done?.(); }
    }, 40);
  };

  useEffect(() => { setVolume(settings.volume); playerRef.current?.setVolume(settings.volume); }, [settings.volume]);

  useEffect(() => {
    try { setFolded(localStorage.getItem('ohome.bgm.fold') === '1'); } catch { /* 무시 */ }
  }, []);
  const setFold = (v: boolean) => {
    setFolded(v);
    setListOpen(false);
    try { localStorage.setItem('ohome.bgm.fold', v ? '1' : '0'); } catch { /* 무시 */ }
  };

  // YT API 로드 + 플레이어 생성 — 재생목록이 비어 있어도 페이지 테마곡이 있으면 만든다
  useEffect(() => {
    if (!settings.enabled || !hasAny) return;
    let cancelled = false;
    const create = () => {
      if (cancelled || !holderRef.current || playerRef.current) return;
      playerRef.current = new window.YT!.Player(holderRef.current, {
        width: 0, height: 0,
        videoId: curVid(),
        playerVars: { controls: 0, disablekb: 1 },
        events: {
          onReady: () => {
            readyRef.current = true;
            // 자동 재생이 무장된 상태(첫 상호작용이 플레이어 준비보다 먼저)면 바로 시작
            if (armedRef.current) {
              armedRef.current = false;
              loadCurRef.current();
            } else {
              // 준비 전에 테마곡 전환이 있었으면 지금 곡을 걸어 둔다 (소리는 내지 않음)
              const v = curVid();
              if (v) playerRef.current?.cueVideoById({ videoId: v, startSeconds: startAtRef.current });
            }
          },
          onStateChange: (e: { data: number }) => {
            // 1=재생, 2=일시정지, 0=종료 — 버퍼링(3)·큐(5) 같은 과도 상태는 무시
            if (e.data === 0) {
              endedRef.current(); // 곡 종료 → 반복/다음 곡 (셔플 지원)
            } else if (e.data === 1) {
              startedRef.current = true;
              setPlaying(true);
            } else if (e.data === 2) {
              setPlaying(false);
            } else if (e.data === -1) {
              // 미시작(재생이 정책에 막힌 경우 포함) — "재생 중인 척" 하지 않기
              // (정상 시작 시에도 -1→3→1로 지나가므로 잠깐 ▶로 보였다가 1에서 복구됨)
              setPlaying(false);
              startedRef.current = false;
            }
          },
        },
      });
    };
    if (window.YT?.Player) create();
    else {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); create(); };
      if (!document.getElementById('yt-iframe-api')) {
        const s = document.createElement('script');
        s.id = 'yt-iframe-api';
        s.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(s);
      }
    }
    return () => {
      cancelled = true;
      readyRef.current = false;
      stopFade();
      playerRef.current?.destroy();
      playerRef.current = null;
      startedRef.current = false;
      setPlaying(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.enabled, hasAny]);

  /** 현재 곡(테마곡 또는 재생목록 곡)을 불러와 재생 — 첫 재생도 반드시 이 경로
   *  (큐만 된 첫 영상의 playVideo()가 무시되는 유튜브 IFrame 이슈 회피) */
  const loadCur = () => {
    const p = playerRef.current;
    const vid = curVid();
    if (!p || !vid) return;
    stopFade();
    const start = startAtRef.current;
    startAtRef.current = 0;
    startedRef.current = true;
    wantPlayRef.current = true;
    p.loadVideoById({ videoId: vid, startSeconds: start });
    p.setVolume(volumeRef.current);
    p.playVideo();
    setPlaying(true); // 버튼 즉시 반영 (이벤트는 보정용)
  };
  const loadCurRef = useRef(loadCur);
  loadCurRef.current = loadCur;

  /** 재생목록 i번 곡 재생 */
  const playIdx = (i: number) => {
    setIdx(i);
    idxRef.current = i;
    startAtRef.current = 0;
    if (tracks[i] && playerRef.current) loadCur();
  };

  /** 곡 전환 (테마곡 들어가기/나오기) — 틀고 있었으면 소리를 줄였다가 바꾸고 다시 키운다.
   *  멈춰 있었거나 아직 안 틀었으면 소리를 내지 않고 다음에 틀 곡만 바꿔 둔다 */
  const switchTo = (videoId: string, start: number) => {
    const p = playerRef.current;
    if (!p || !readyRef.current) { startAtRef.current = start; return; }   // onReady에서 걸어 둔다
    if (wantPlayRef.current && startedRef.current) {
      fadeVol(volumeRef.current, 0, 450, () => {
        startedRef.current = true;
        p.loadVideoById({ videoId, startSeconds: start });
        p.playVideo();
        fadeVol(0, volumeRef.current, 800);
      });
    } else if (wantPlayRef.current) {
      // 재생을 시작하던 참(아직 소리 전) — 페이드 없이 바로 새 곡으로
      startAtRef.current = start;
      loadCur();
    } else {
      stopFade();
      startAtRef.current = start;
      startedRef.current = false;           // 다음 ▶는 loadCur 경로
      p.cueVideoById({ videoId, startSeconds: start });
      p.setVolume(volumeRef.current);
    }
  };

  // 페이지 테마곡 걸기/풀기
  useEffect(() => { if (!pageTrack) setOffVid(null); }, [pageTrack]);
  const want = pageTrack && pageTrack.videoId !== offVid ? pageTrack : null;
  useEffect(() => {
    const cur = ovRef.current;
    if ((want?.videoId ?? null) === (cur?.videoId ?? null)) {
      if (want && want !== cur) { ovRef.current = want; setOv(want); }   // 제목만 바뀜
      return;
    }
    if (want && !cur) {
      // 재생목록에서 테마곡으로 — 돌아올 자리를 기억
      let t = startAtRef.current;
      try { if (startedRef.current && readyRef.current && playerRef.current) t = playerRef.current.getCurrentTime() || 0; } catch { /* 무시 */ }
      resumeRef.current = { idx: idxRef.current, t };
    }
    ovRef.current = want;
    setOv(want);
    if (want) { switchTo(want.videoId, 0); return; }
    // 테마곡에서 재생목록으로 — 듣던 곡·위치로 복귀
    const r = resumeRef.current;
    resumeRef.current = null;
    const back = tracks[r?.idx ?? idxRef.current] ?? tracks[0];
    if (back) switchTo(back.videoId, r?.t ?? 0);
    else {
      // 재생목록이 비어 있음 — 플레이어도 곧 사라진다. 소리만 정리
      stopFade();
      try { playerRef.current?.pauseVideo(); } catch { /* 무시 */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want?.videoId, want?.title]);

  /** 재생목록 다음 곡 (곡 종료·다음 버튼 공통) */
  const advance = () => {
    if (tracks.length === 0) return;
    const cur = idxRef.current;
    let n: number;
    if (settings.shuffle && tracks.length > 1) {
      do { n = Math.floor(Math.random() * tracks.length); } while (n === cur);
    } else {
      n = cur + 1;
      if (n >= tracks.length) {
        if (!settings.repeat) { wantPlayRef.current = false; setPlaying(false); return; }
        n = 0;
      }
    }
    playIdx(n);
  };
  /** 곡이 끝남 — 테마곡이면 반복 설정대로 다시, 아니면 재생목록 다음 곡 */
  const onEnded = () => {
    if (ovRef.current) {
      if (settings.repeat) loadCur();
      else { wantPlayRef.current = false; setPlaying(false); }
      return;
    }
    advance();
  };
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;

  /** 사용자가 재생목록 곡을 직접 고름 — 이 페이지의 테마곡은 끈다 (나갔다 오면 다시 켜짐) */
  const dropOv = () => {
    if (!ovRef.current) return;
    setOffVid(ovRef.current.videoId);
    ovRef.current = null;
    setOv(null);
    resumeRef.current = null;
  };
  const pick = (i: number) => { dropOv(); playIdx(i); };
  const next = () => {
    if (tracks.length === 0) return;
    if (ovRef.current) { dropOv(); playIdx((idxRef.current + 1) % tracks.length); return; }
    advance();
  };
  const prev = () => {
    if (tracks.length === 0) return;
    pick((idxRef.current - 1 + tracks.length) % tracks.length);
  };
  /** 목록에서 테마곡을 다시 고름 — 끈 것을 풀고 바로 재생 */
  const pickTheme = () => {
    if (!pageTrack) return;
    if (ovRef.current) { if (!playing) togglePlay(); return; }
    wantPlayRef.current = true;
    startedRef.current = startedRef.current && playing;
    setOffVid(null);
  };

  // 입장 자동 재생 (4.1) — 브라우저 정책상 완전 자동재생은 불가하므로
  // 방문자의 "첫 상호작용(클릭/키)"과 동시에 재생을 시작 (1회만)
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const armedRef = useRef(false);
  useEffect(() => {
    if (!settings.autoplay || !settings.enabled || !hasAny) return;
    const fire = (ev: Event) => {
      remove();
      // 플레이어 자체를 조작하는 클릭(재생/이전/다음 등)은 버튼 핸들러에 맡김 —
      // 여기서 먼저 재생을 시작하면 곧이어 오는 버튼 click이 "일시정지"로 뒤집힘
      if (rootRef.current?.contains(ev.target as Node)) return;
      if (playingRef.current) return;
      if (readyRef.current && playerRef.current) {
        // 첫 재생은 loadVideoById 경로 (큐 상태 playVideo 무시 이슈 회피)
        loadCurRef.current();
      } else {
        // 플레이어 준비 전(onReady 이전)에는 재생 명령이 무시됨 — 준비되는 즉시 재생하도록 무장
        armedRef.current = true;
        wantPlayRef.current = true;
      }
    };
    const remove = () => {
      window.removeEventListener('pointerdown', fire, true);
      window.removeEventListener('keydown', fire, true);
    };
    window.addEventListener('pointerdown', fire, true);
    window.addEventListener('keydown', fire, true);
    return remove;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoplay, settings.enabled, hasAny]);

  const togglePlay = () => {
    if (!playerRef.current) return;
    if (playing) {
      stopFade();
      wantPlayRef.current = false;          // 사용자가 멈춤 — 테마곡 전환 때도 다시 켜지 않는다
      playerRef.current.pauseVideo();
      setPlaying(false); // 버튼 즉시 반영
    } else if (!readyRef.current) {
      armedRef.current = true; // 준비 전이면 무장 — onReady에서 즉시 재생
      wantPlayRef.current = true;
    } else if (!startedRef.current) {
      loadCur(); // 첫 재생 — 큐 상태 playVideo 무시 이슈 회피
    } else {
      // 일시정지 후 재개 — 위치 유지를 위해 playVideo
      wantPlayRef.current = true;
      playerRef.current.setVolume(volume);
      playerRef.current.playVideo();
      setPlaying(true);
    }
  };

  const onVolDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const set = (clientX: number) => {
      const r = volRef.current!.getBoundingClientRect();
      const v = Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * 100);
      stopFade();
      setVolume(v);
      playerRef.current?.setVolume(v);
    };
    set(e.clientX);
    const mv = (ev: PointerEvent) => set(ev.clientX);
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  useEffect(() => () => stopFade(), []);

  if (!settings.enabled || !hasAny) return null;

  return (
    <div
      ref={rootRef}
      className={`bgm ${folded ? 'folded' : ''} ${settings.position === 'bl' ? 'bgm-left' : ''}`}
      style={settings.position === 'bl' ? { right: 'auto', left: 20 } : undefined}
      onClick={() => { if (folded) setFold(false); }}
      data-tip={folded ? '펼치기' : undefined}
    >
      {/* 숨겨진 유튜브 플레이어 */}
      <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}>
        <div ref={holderRef} />
      </div>
      <div className="disc" style={{ animationPlayState: playing ? 'running' : 'paused' }} />
      <div className="title">
        {/* 흐르는 글씨는 제목만 — 설명은 항상 말줄임 (정신없지 않게) */}
        <Marquee className="tt" text={track?.title ?? ''} active={playing} />
        {track?.desc && <div className="mq">{track.desc}</div>}
      </div>
      <div className="ctrl">
        <button onClick={prev} data-tip="이전" disabled={tracks.length === 0}>◂◂</button>
        <button onClick={togglePlay} data-tip={playing ? '일시정지' : '재생'}>{playing ? '❚❚' : '▶'}</button>
        <button onClick={next} data-tip="다음" disabled={tracks.length === 0}>▸▸</button>
        <button className="lst" data-tip="BGM 리스트" onClick={e => { e.stopPropagation(); setListOpen(o => !o); }}>
          <ListIcon />
        </button>
      </div>
      <div className="vol" ref={volRef} onPointerDown={onVolDrag} data-tip={`볼륨 ${volume}`}>
        <i style={{ width: `${volume}%` }} />
      </div>
      {/* 접기 — 디스크만 남김 (4.1) · 화살표는 접히는 방향(화면 가장자리 쪽) */}
      <button className="fold-btn" data-tip="접기" onClick={e => { e.stopPropagation(); setFold(true); }}>
        {settings.position === 'bl' ? '«' : '»'}
      </button>
      {/* 곡 목록 팝업 (v1.9) — 바깥 클릭 시 닫힘 */}
      {listOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: -1 }} onClick={() => setListOpen(false)} />
          <div className="bgm-list on">
            <div className="h">BGM LIST</div>
            {/* 이 페이지의 테마곡 — 재생목록 곡을 골라 꺼 두었으면 여기서 다시 켠다 */}
            {pageTrack && (
              <div className={`it ${ov ? 'on' : ''}`} onClick={() => { pickTheme(); setListOpen(false); }}>
                <b>♪ {pageTrack.title}</b><small>이 페이지 테마곡</small>
              </div>
            )}
            {tracks.map((t, i) => (
              <div key={t.id} className={`it ${!ov && i === idx ? 'on' : ''}`}
                onClick={() => { pick(i); setListOpen(false); }}>
                <b>{t.title}</b><small>{t.desc}</small>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
