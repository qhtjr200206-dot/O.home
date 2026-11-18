// [media 담당] 오디오 재생·분석 (Web Audio AnalyserNode)
//
// 사용 순서 (화면 쪽)
//   const audio = new CoverAudio();
//   await audio.load(file);          // 디코딩 → audio.buffer (내보내기에 그대로 넘김)
//   button.onclick = () => audio.play();   // 사용자 제스처 안에서 (AudioContext resume)
//   rAF 루프: const s = audio.sample(); makeFrame({ ..., time: audio.time, playing: audio.playing, ...s })
//   audio.seek(t) / audio.pause() / audio.onEnded = () => ...
//   언마운트: audio.dispose()

export interface AudioSample { spectrum: Uint8Array | null; waveform: Uint8Array | null; level: number }

/** 분석 설정 — 내보내기(OfflineAudioContext)도 같은 값을 쓴다 */
export const FFT_SIZE = 2048;
export const SMOOTHING = 0.8;

/** 시간영역 파형(0~255) → RMS 기반 0~1 음량 */
export function rmsLevel(wave: Uint8Array, count = wave.length): number {
  let sum = 0;
  const n = Math.min(count, wave.length);
  for (let i = 0; i < n; i++) { const v = (wave[i] - 128) / 128; sum += v * v; }
  const rms = Math.sqrt(sum / Math.max(1, n));
  return Math.min(1, rms * 3.2);
}

/** 음량 부드럽게 — 올라갈 때 빠르게, 내려갈 때 천천히. dt(초)로 프레임레이트와 무관하게 */
export function smoothLevel(prev: number, target: number, dt: number): number {
  const k = target > prev ? 1 - Math.exp(-dt / 0.05) : 1 - Math.exp(-dt / 0.25);
  return prev + (target - prev) * k;
}

type AC = typeof AudioContext;
function audioContextCtor(): AC | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AC; webkitAudioContext?: AC };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** 옛 사파리의 콜백형 decodeAudioData도 받는다 */
export function decodeAudio(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, err => reject(err ?? new Error('오디오를 읽을 수 없습니다')));
    if (p && typeof (p as Promise<AudioBuffer>).then === 'function') (p as Promise<AudioBuffer>).then(resolve, reject);
  });
}

export class CoverAudio {
  buffer: AudioBuffer | null = null;
  /** 곡 끝 콜백 */
  onEnded: (() => void) | null = null;

  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  /** 정지 중 위치(초) */
  private offset = 0;
  /** 재생 시작 시점의 ctx.currentTime - offset */
  private startedAt = 0;
  private _playing = false;
  private _volume = 1;
  private spec = new Uint8Array(FFT_SIZE / 2);
  private wave = new Uint8Array(FFT_SIZE);
  private level = 0;
  private lastSample = 0;
  private loadToken = 0;

  get duration(): number { return this.buffer?.duration ?? 0; }
  get playing(): boolean { return this._playing; }
  get time(): number {
    if (this._playing && this.ctx) return Math.min(this.duration, Math.max(0, this.ctx.currentTime - this.startedAt));
    return this.offset;
  }
  get volume(): number { return this._volume; }
  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.02);
  }
  /** 녹화 폴백 등에서 같은 컨텍스트가 필요할 때 */
  get context(): AudioContext | null { return this.ctx; }

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const Ctor = audioContextCtor();
    if (!Ctor) throw new Error('이 브라우저는 Web Audio를 지원하지 않습니다');
    const ctx = new Ctor();
    const gain = ctx.createGain();
    gain.gain.value = this._volume;
    const an = ctx.createAnalyser();
    an.fftSize = FFT_SIZE;
    an.smoothingTimeConstant = SMOOTHING;
    gain.connect(an);
    an.connect(ctx.destination);
    this.ctx = ctx; this.gain = gain; this.analyser = an;
    return ctx;
  }

  /** 파일 디코딩 (AudioBuffer 보관). 재생 중이면 멈추고 처음으로 */
  async load(file: Blob): Promise<void> {
    const token = ++this.loadToken;
    this.stopSource();
    this._playing = false;
    this.offset = 0;
    const ctx = this.ensure();
    const data = await file.arrayBuffer();
    const buf = await decodeAudio(ctx, data);
    if (token !== this.loadToken) return; // 그 사이 다른 파일이 들어옴
    this.buffer = buf;
    this.offset = 0;
    this.level = 0;
  }

  /** 오디오 지우기 */
  clear(): void {
    this.stopSource();
    this._playing = false;
    this.buffer = null;
    this.offset = 0;
  }

  async play(): Promise<void> {
    if (!this.buffer) return;
    const ctx = this.ensure();
    if (ctx.state !== 'running') { try { await ctx.resume(); } catch { /* 제스처 없음 */ } }
    if (this._playing) return;
    if (this.offset >= this.duration - 0.01) this.offset = 0;
    this.startSource(this.offset);
  }

  pause(): void {
    if (!this._playing) return;
    this.offset = this.time;
    this.stopSource();
    this._playing = false;
  }

  toggle(): Promise<void> | void { return this._playing ? this.pause() : this.play(); }

  /** 정지 중에도 time에 반영 */
  seek(t: number): void {
    const d = this.duration;
    const v = Math.max(0, Math.min(isFinite(t) ? t : 0, d || 0));
    if (this._playing) { this.stopSource(); this.startSource(v); }
    else this.offset = v;
  }

  private startSource(at: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain!);
    src.onended = () => {
      if (this.source !== src) return; // 수동 정지·seek로 교체된 소스
      this.source = null;
      this._playing = false;
      this.offset = this.duration;
      this.onEnded?.();
    };
    src.start(0, at);
    this.source = src;
    this.startedAt = ctx.currentTime - at;
    this._playing = true;
  }

  private stopSource() {
    const s = this.source;
    this.source = null;
    if (s) {
      s.onended = null;
      try { s.stop(); } catch { /* 이미 멈춤 */ }
      try { s.disconnect(); } catch { /* */ }
    }
  }

  /** 매 프레임 호출 — 분석 데이터 (배열은 재사용되므로 보관하려면 복사) */
  sample(): AudioSample {
    if (!this.buffer || !this.analyser) return { spectrum: null, waveform: null, level: 0 };
    this.analyser.getByteFrequencyData(this.spec);
    this.analyser.getByteTimeDomainData(this.wave);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = this.lastSample ? Math.min(0.2, (now - this.lastSample) / 1000) : 1 / 60;
    this.lastSample = now;
    this.level = smoothLevel(this.level, this._playing ? rmsLevel(this.wave) : 0, dt);
    return { spectrum: this.spec, waveform: this.wave, level: this.level };
  }

  dispose(): void {
    this.loadToken++;
    this.stopSource();
    this._playing = false;
    this.onEnded = null;
    const ctx = this.ctx;
    this.ctx = null; this.gain = null; this.analyser = null;
    if (ctx) ctx.close().catch(() => {});
  }
}
