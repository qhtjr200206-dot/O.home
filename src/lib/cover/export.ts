// [media 담당] 내보내기 — 전부 브라우저 안에서 (서버 업로드 없음)
//
// - PNG: renderFrame 한 장
// - MP4: 1순위 WebCodecs + mediabunny (실시간보다 빠른 오프라인 렌더, 오디오 포함)
//        2순위 MediaRecorder 실시간 녹화 (mp4 가능하면 mp4, 아니면 webm + note)
// - GIF: gifenc (축소 렌더, 샘플 프레임 기반 글로벌 팔레트)
// 비주얼라이저 데이터는 OfflineAudioContext + AnalyserNode(미리보기와 같은 fftSize/smoothing)로
// 프레임 시각마다 suspend → getByte*Data 로 얻는다.
// 무거운 라이브러리(mediabunny, gifenc)는 함수 안에서 동적 import.
import type { ExportInput, ExportProgress, ExportResult, GifExportOptions, Ratio, VideoExportOptions, Palette, LyricLine } from './types';
import { RATIO_SIZE } from './types';
import { makeFrame, renderFrame, VIZ_MAX_BIN, VIZ_WAVE_SAMPLES } from './render';
import { loadCoverFont } from './fonts';
import { paletteFor } from './tone';
import { FFT_SIZE, SMOOTHING, rmsLevel, smoothLevel } from './audio';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function abortError(): Error {
  try { return new DOMException('내보내기를 취소했습니다', 'AbortError'); }
  catch { const e = new Error('내보내기를 취소했습니다'); e.name = 'AbortError'; return e; }
}
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }

/** UI 양보 — setTimeout은 백그라운드 탭에서 1초로 늘어나므로 MessageChannel 사용 */
function yieldUI(): Promise<void> {
  return new Promise(resolve => {
    if (typeof MessageChannel === 'undefined') { setTimeout(resolve, 0); return; }
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
    ch.port2.postMessage(0);
  });
}

function imageSize(img: ExportInput['image']): [number, number] {
  if (!img) return [0, 0];
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return [img.naturalWidth, img.naturalHeight];
  return [(img as ImageBitmap).width, (img as ImageBitmap).height];
}

function videoSize(ratio: Ratio, scale: number): [number, number] {
  const [w, h] = RATIO_SIZE[ratio] ?? RATIO_SIZE['1:1'];
  const s = isFinite(scale) && scale > 0 ? scale : 1;
  return [even(w * s), even(h * s)];
}

async function prepareFont(input: ExportInput) {
  const s = input.settings;
  const sample = [s.title, s.artist, s.phrase, ...input.lyrics.map(l => l.text), '0123456789:'].join('\n');
  try { await loadCoverFont(s.font, sample); } catch { /* 폰트 실패 → 대체 폰트로라도 그린다 */ }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** 공통 프레임 컨텍스트 */
interface Scene {
  input: ExportInput;
  palette: Palette;
  imageW: number; imageH: number;
  lyrics: LyricLine[];
}
function scene(input: ExportInput): Scene {
  const [imageW, imageH] = imageSize(input.image);
  return { input, palette: paletteFor(input.settings), imageW, imageH, lyrics: input.lyrics };
}
function drawAt(ctx: CanvasRenderingContext2D, sc: Scene, w: number, h: number, time: number, playing: boolean,
  spectrum: Uint8Array | null, waveform: Uint8Array | null, level: number) {
  const f = makeFrame({
    settings: sc.input.settings, width: w, height: h, time, duration: sc.input.duration, playing,
    image: sc.input.image, imageW: sc.imageW, imageH: sc.imageH, lyrics: sc.lyrics,
    spectrum, waveform, level, palette: sc.palette,
  });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, w, h);
  renderFrame(ctx, f);
}

// ───────────────────────── 오프라인 오디오 분석 ─────────────────────────

/** 프레임별 분석 결과. 메모리 절약: 스펙트럼은 비주얼라이저가 읽는 앞쪽 VIZ_MAX_BIN개, 파형은 앞쪽 1024개만 */
interface Analysis {
  n: number;
  spec: Uint8Array;  // n × SB
  wave: Uint8Array;  // n × WB
  level: Float32Array;
}
const SB = VIZ_MAX_BIN;
const WB = VIZ_WAVE_SAMPLES;

/** 분석 결과에서 i번째 프레임 데이터를 렌더러가 기대하는 모양(1024 / 2048)으로 꺼낸다 (배열 재사용) */
class FrameData {
  spectrum = new Uint8Array(FFT_SIZE / 2);
  waveform = new Uint8Array(FFT_SIZE).fill(128);
  constructor(private a: Analysis | null) {}
  get has() { return !!this.a; }
  load(i: number): number {
    const a = this.a;
    if (!a) return 0;
    const k = clamp(i, 0, a.n - 1);
    this.spectrum.set(a.spec.subarray(k * SB, k * SB + SB), 0);
    this.waveform.set(a.wave.subarray(k * WB, k * WB + WB), 0);
    return a.level[k];
  }
}

/** times(오름차순, 초)마다 AnalyserNode 값을 읽는다. 오디오 범위 밖 시각은 무음(0) */
async function analyzeOffline(buffer: AudioBuffer, times: number[], fps: number, signal?: AbortSignal,
  onRatio?: (r: number) => void): Promise<Analysis> {
  const n = times.length;
  const out: Analysis = { n, spec: new Uint8Array(n * SB), wave: new Uint8Array(n * WB).fill(128), level: new Float32Array(n) };
  if (!n) return out;
  const OAC: typeof OfflineAudioContext | undefined =
    typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext
      : (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OAC) return out;
  const sr = buffer.sampleRate;
  const PRE = 0.5; // 스무딩 예열
  const segStart = Math.max(0, times[0] - PRE);
  const lastAudio = Math.min(buffer.duration, times[n - 1] + 0.05);
  if (lastAudio <= segStart + 0.01) return out;
  const length = Math.ceil((lastAudio - segStart) * sr) + 256;
  const oac = new OAC(1, length, sr);
  const an = oac.createAnalyser();
  an.fftSize = FFT_SIZE;
  an.smoothingTimeConstant = SMOOTHING;
  const src = oac.createBufferSource();
  src.buffer = buffer;
  src.connect(an);
  an.connect(oac.destination);
  src.start(0, segStart);

  const specTmp = new Uint8Array(FFT_SIZE / 2);
  const waveTmp = new Uint8Array(FFT_SIZE);
  const ctxDur = length / sr;
  const Q = 128 / sr; // suspend 정밀도 (렌더 퀀텀)
  const quant = (rel: number) => Math.max(1, Math.round(rel / Q)) * Q;
  let aborted = false;
  let level = 0;
  const dt = 1 / Math.max(1, fps);

  // 예열 시각 (저장 안 함)
  const scheduled = new Set<number>();
  for (let t = segStart + dt; t < times[0] - dt * 0.5; t += dt) {
    const q = quant(t - segStart);
    const key = Math.round(q / Q);
    if (q >= ctxDur - Q || scheduled.has(key)) continue;
    scheduled.add(key);
    oac.suspend(q).then(() => {
      if (!aborted) { an.getByteFrequencyData(specTmp); an.getByteTimeDomainData(waveTmp); level = smoothLevel(level, rmsLevel(waveTmp), dt); }
      oac.resume();
    });
  }
  // 프레임 시각 → 같은 퀀텀끼리 묶기
  const groups = new Map<number, number[]>();
  const order: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = times[i];
    if (t > lastAudio) continue; // 무음 (기본값 그대로)
    const q = quant(t - segStart);
    if (q >= ctxDur - Q) continue;
    const key = Math.round(q / Q);
    if (scheduled.has(key) && !groups.has(key)) continue; // 예열과 겹침 (거의 없음)
    let g = groups.get(key);
    if (!g) { g = []; groups.set(key, g); order.push(key); scheduled.add(key); }
    g.push(i);
  }
  let done = 0;
  const total = order.length;
  for (const key of order) {
    const idxs = groups.get(key)!;
    oac.suspend(key * Q).then(() => {
      if (!aborted) {
        if (signal?.aborted) aborted = true;
        else {
          an.getByteFrequencyData(specTmp);
          an.getByteTimeDomainData(waveTmp);
          level = smoothLevel(level, rmsLevel(waveTmp), dt);
          for (const i of idxs) {
            out.spec.set(specTmp.subarray(0, SB), i * SB);
            out.wave.set(waveTmp.subarray(0, WB), i * WB);
            out.level[i] = level;
          }
          done++;
          if (onRatio && (done & 15) === 0) onRatio(done / total);
        }
      }
      oac.resume();
    });
  }
  await oac.startRendering();
  if (aborted || signal?.aborted) throw abortError();
  onRatio?.(1);
  return out;
}

function frameTimes(start: number, count: number, fps: number): number[] {
  const t: number[] = new Array(count);
  for (let i = 0; i < count; i++) t[i] = start + i / fps;
  return t;
}

/** AudioBuffer의 [s, e) 구간 복사 */
function sliceAudio(buf: AudioBuffer, s: number, e: number): AudioBuffer | null {
  const sr = buf.sampleRate;
  const a = clamp(Math.floor(s * sr), 0, buf.length);
  const b = clamp(Math.floor(e * sr), 0, buf.length);
  if (b - a < 2) return null;
  const out = new AudioBuffer({ length: b - a, numberOfChannels: buf.numberOfChannels, sampleRate: sr });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b), c);
  return out;
}

function videoBitrate(w: number, h: number, fps: number): number {
  const px = (w * h) / (1080 * 1920);
  return Math.round((4e6 + 4e6 * Math.min(1.2, px)) * Math.sqrt(clamp(fps, 10, 60) / 30)); // 1080²≈6.3M, 1080×1920≈8M
}

// ───────────────────────── PNG ─────────────────────────

/** 현재 시점 한 장 (1080 기준 해상도) */
export async function exportPNG(input: ExportInput, time: number): Promise<ExportResult> {
  await prepareFont(input);
  const [w, h] = videoSize(input.settings.ratio, 1);
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const sc = scene(input);
  const t = Math.max(0, isFinite(time) ? time : 0);
  let fd: FrameData = new FrameData(null);
  if (input.audio && t < input.audio.duration) {
    try { fd = new FrameData(await analyzeOffline(input.audio, [t], 30)); } catch { /* 분석 실패 → 대기 애니메이션 */ }
  }
  const level = fd.load(0);
  drawAt(ctx, sc, w, h, t, false, fd.has ? fd.spectrum : null, fd.has ? fd.waveform : null, level);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('PNG를 만들 수 없습니다'))), 'image/png'));
  return { blob, mime: 'image/png', ext: 'png' };
}

// ───────────────────────── MP4 ─────────────────────────

const VIDEO_CODECS = ['avc', 'vp9', 'av1'] as const;

function forceRecorder(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { __coverForceRecorder?: boolean }).__coverForceRecorder;
}

const RECORDER_TYPES = [
  'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
function pickRecorderType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  // 검증용: window.__coverForceWebm = true 면 webm 경로 강제
  const noMp4 = typeof window !== 'undefined' && !!(window as unknown as { __coverForceWebm?: boolean }).__coverForceWebm;
  return RECORDER_TYPES.find(t => (!noMp4 || !t.startsWith('video/mp4')) && MediaRecorder.isTypeSupported(t)) ?? null;
}
function canCapture(): boolean {
  return typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

async function webCodecsVideoCodec(w: number, h: number, fps: number) {
  if (typeof VideoEncoder === 'undefined') return null;
  const mb = await import('mediabunny');
  const quality = new mb.Quality({ bitrate: videoBitrate(w, h, fps) });
  return mb.getFirstEncodableVideoCodec([...VIDEO_CODECS], { width: w, height: h, quality, frameRate: fps });
}

/** 이 브라우저에서 MP4 내보내기가 되는지와 방식 */
export async function mp4Support(): Promise<{ ok: boolean; method: 'webcodecs' | 'recorder-mp4' | 'recorder-webm' | 'none'; note?: string }> {
  if (typeof window === 'undefined') return { ok: false, method: 'none' };
  if (!forceRecorder()) {
    try {
      const codec = await webCodecsVideoCodec(1080, 1920, 30);
      if (codec) return { ok: true, method: 'webcodecs', note: codec === 'avc' ? undefined : `H.264 대신 ${codec.toUpperCase()}로 인코딩합니다 (일부 플레이어에서 재생이 안 될 수 있습니다)` };
    } catch { /* 폴백 확인 */ }
  }
  if (canCapture()) {
    const t = pickRecorderType();
    if (t?.startsWith('video/mp4')) return { ok: true, method: 'recorder-mp4', note: '실시간 녹화 방식이라 구간 길이만큼 시간이 걸립니다 (탭을 열어 두세요)' };
    if (t) return { ok: true, method: 'recorder-webm', note: '이 브라우저는 MP4 인코딩을 지원하지 않아 WebM으로 저장합니다 (실시간 녹화)' };
  }
  return { ok: false, method: 'none', note: '이 브라우저는 영상 내보내기를 지원하지 않습니다' };
}

export async function exportMP4(input: ExportInput, opts: VideoExportOptions): Promise<ExportResult> {
  checkAbort(opts.signal);
  const fps = clamp(Math.round(opts.fps || 30), 1, 60);
  const [w, h] = videoSize(input.settings.ratio, opts.scale);
  const start = Math.max(0, opts.start || 0);
  const end = Math.max(start + 1 / fps, isFinite(opts.end) ? opts.end : start + 10);
  await prepareFont(input);
  let codec: string | null = null;
  if (!forceRecorder()) {
    try { codec = await webCodecsVideoCodec(w, h, fps); } catch { codec = null; }
  }
  if (codec) return exportWebCodecs(input, opts, { w, h, fps, start, end, codec });
  if (canCapture() && pickRecorderType()) return exportRecorder(input, opts, { w, h, fps, start, end });
  throw new Error('이 브라우저는 영상 내보내기를 지원하지 않습니다');
}

interface VidParams { w: number; h: number; fps: number; start: number; end: number }

/** 하드웨어 인코더가 캔버스 RGB 프레임을 거부하는 환경(일부 Windows GPU·헤드리스)이 있어
 *  실패하면 소프트웨어 인코더로 다시 시도한다. 성공한 설정은 기억해 다음부터 바로 쓴다. */
let preferredHw: HardwareAcceleration | null = null;

async function exportWebCodecs(input: ExportInput, opts: VideoExportOptions, p: VidParams & { codec: string }): Promise<ExportResult> {
  const { fps, start, end } = p;
  const signal = opts.signal;
  const prog = (phase: ExportProgress['phase'], ratio: number) => opts.onProgress?.({ phase, ratio: clamp(ratio, 0, 1) });
  const n = Math.max(1, Math.round((end - start) * fps));
  const times = frameTimes(start, n, fps);

  // 1) 오디오 분석 (한 번만 — 인코더 재시도 때 재사용)
  prog('분석', 0);
  let analysis: Analysis | null = null;
  if (input.audio && start < input.audio.duration) {
    analysis = await analyzeOffline(input.audio, times, fps, signal, r => prog('분석', r));
  }
  prog('분석', 1);
  checkAbort(signal);

  const tries: HardwareAcceleration[] = preferredHw ? [preferredHw] : ['no-preference', 'prefer-software'];
  let lastErr: unknown = null;
  for (const hw of tries) {
    try {
      const r = await encodeWebCodecs(input, opts, p, times, analysis, hw);
      preferredHw = hw;
      return r;
    } catch (e) {
      if (signal?.aborted || (e as Error)?.name === 'AbortError') throw abortError();
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('영상 인코딩에 실패했습니다');
}

async function encodeWebCodecs(input: ExportInput, opts: VideoExportOptions, p: VidParams & { codec: string },
  times: number[], analysis: Analysis | null, hw: HardwareAcceleration): Promise<ExportResult> {
  const mb = await import('mediabunny');
  const { w, h, fps, start, end } = p;
  const signal = opts.signal;
  const prog = (phase: ExportProgress['phase'], ratio: number) => opts.onProgress?.({ phase, ratio: clamp(ratio, 0, 1) });
  const n = times.length;
  const dur = n / fps;

  // 2) 출력 준비
  const bitrate = videoBitrate(w, h, fps);
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
  const videoSource = new mb.CanvasSource(canvas, {
    codec: p.codec as 'avc',
    quality: new mb.Quality({ bitrate }),
    keyFrameInterval: 2,
    latencyMode: 'quality',
    hardwareAcceleration: hw,
  });
  output.addVideoTrack(videoSource, { frameRate: fps });

  let audioSource: InstanceType<typeof mb.AudioBufferSource> | null = null;
  let audioSeg: AudioBuffer | null = null;
  let note: string | undefined = p.codec !== 'avc' ? `H.264를 쓸 수 없어 ${p.codec.toUpperCase()}로 인코딩했습니다` : undefined;
  if (input.audio) {
    audioSeg = sliceAudio(input.audio, start, Math.min(end, start + dur));
    if (audioSeg) {
      const aq = new mb.Quality({ bitrate: 192_000 });
      const acodec = await mb.getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: audioSeg.numberOfChannels, sampleRate: audioSeg.sampleRate, quality: aq });
      if (acodec) {
        audioSource = new mb.AudioBufferSource({ codec: acodec, quality: aq });
        output.addAudioTrack(audioSource);
      } else {
        note = (note ? note + ' · ' : '') + '이 브라우저는 오디오 인코딩(AAC/Opus)을 지원하지 않아 소리 없이 저장했습니다';
        audioSeg = null;
      }
    }
  }

  let started = false;
  try {
    await output.start();
    started = true;
    const fd = new FrameData(analysis);
    const sc = scene(input);
    // 오디오는 1초 조각으로 비디오와 나란히 넣는다 (먹서 인터리빙·메모리)
    let audioCursor = 0;
    const audioLen = audioSeg ? audioSeg.duration : 0;
    const pushAudioUntil = async (t: number) => {
      if (!audioSource || !audioSeg) return;
      while (audioCursor < audioLen && audioCursor < t) {
        const next = Math.min(audioLen, audioCursor + 1);
        const piece = sliceAudio(audioSeg, audioCursor, next);
        audioCursor = next;
        if (piece) await audioSource.add(piece);
      }
    };
    let lastYield = performance.now();
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) throw abortError();
      const level = fd.load(i);
      drawAt(ctx, sc, w, h, times[i], true, fd.has ? fd.spectrum : null, fd.has ? fd.waveform : null, level);
      await videoSource.add(i / fps, 1 / fps);
      await pushAudioUntil((i + 1) / fps + 0.5);
      if (performance.now() - lastYield > 40) {
        prog('렌더', (i + 1) / n);
        await yieldUI();
        lastYield = performance.now();
      }
    }
    await pushAudioUntil(Infinity);
    prog('렌더', 1);
    prog('마무리', 0);
    videoSource.close();
    audioSource?.close();
    await output.finalize();
    prog('마무리', 1);
    const buf = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
    if (!buf) throw new Error('영상 데이터를 만들지 못했습니다');
    return { blob: new Blob([buf], { type: 'video/mp4' }), mime: 'video/mp4', ext: 'mp4', note };
  } catch (e) {
    if (started) { try { await output.cancel(); } catch { /* */ } }
    if (signal?.aborted) throw abortError();
    throw e;
  }
}

/** 일정 간격 콜백. 탭이 가려지면 메인 스레드 타이머는 1초로 늘어나므로 워커 타이머를 쓴다
 *  (워커를 못 만들면 setInterval). 반환값 = 정지 함수 */
function startTicker(ms: number, cb: () => void): () => void {
  let fallback: ReturnType<typeof setInterval> | null = null;
  const useInterval = () => { if (!fallback) fallback = setInterval(cb, ms); };
  let worker: Worker | null = null;
  try {
    const code = 'let id=0;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = () => cb();
    worker.onerror = () => { worker?.terminate(); worker = null; useInterval(); }; // CSP 등
    worker.postMessage(Math.max(4, ms));
  } catch {
    worker = null;
    useInterval();
  }
  return () => {
    if (worker) { worker.terminate(); worker = null; }
    if (fallback) { clearInterval(fallback); fallback = null; }
  };
}

/** 2순위: 실시간 녹화 (canvas.captureStream + 오디오 재생을 MediaStreamDestination으로) */
async function exportRecorder(input: ExportInput, opts: VideoExportOptions, p: VidParams): Promise<ExportResult> {
  const { w, h, fps, start, end } = p;
  const signal = opts.signal;
  const prog = (phase: string, ratio: number) => opts.onProgress?.({ phase, ratio: clamp(ratio, 0, 1) });
  const type = pickRecorderType()!;
  const isMp4 = type.startsWith('video/mp4');
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
  const sc = scene(input);
  const dur = end - start;
  const stream = canvas.captureStream(fps);

  let actx: AudioContext | null = null;
  let src: AudioBufferSourceNode | null = null;
  let an: AnalyserNode | null = null;
  const spec = new Uint8Array(FFT_SIZE / 2), wave = new Uint8Array(FFT_SIZE);
  if (input.audio && start < input.audio.duration) {
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    actx = new Ctor({ sampleRate: input.audio.sampleRate });
    an = actx.createAnalyser();
    an.fftSize = FFT_SIZE; an.smoothingTimeConstant = SMOOTHING;
    const dest = actx.createMediaStreamDestination();
    src = actx.createBufferSource();
    src.buffer = input.audio;
    src.connect(an); an.connect(dest);
    dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  }
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: videoBitrate(w, h, fps), audioBitsPerSecond: 192_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>(res => { rec.onstop = () => res(); });

  let level = 0;
  const draw = (t: number, dt: number) => {
    let s: Uint8Array | null = null, wv: Uint8Array | null = null;
    if (an) { an.getByteFrequencyData(spec); an.getByteTimeDomainData(wave); s = spec; wv = wave; level = smoothLevel(level, rmsLevel(wave), dt); }
    drawAt(ctx, sc, w, h, t, true, s, wv, level);
  };
  const cleanup = () => {
    try { src?.stop(); } catch { /* */ }
    stream.getTracks().forEach(t => t.stop());
    actx?.close().catch(() => {});
  };

  let muted = false;
  try {
    draw(start, 1 / fps);
    if (actx) {
      // 사용자 제스처가 없으면 resume()이 끝나지 않는다 → 1.5초만 기다리고, 안 되면 소리 없이 시계는 performance.now로
      const ok = await Promise.race([
        actx.resume().then(() => true, () => false),
        new Promise<boolean>(r => setTimeout(() => r(false), 1500)),
      ]);
      if (!ok || actx.state !== 'running') {
        muted = true;
        stream.getAudioTracks().forEach(t => { stream.removeTrack(t); t.stop(); });
        actx.close().catch(() => {});
        actx = null; src = null; an = null;
      }
    }
    checkAbort(signal);
    rec.start(500);
    const clock0 = actx ? actx.currentTime + 0.05 : performance.now() / 1000;
    if (actx && src) src.start(clock0, start);
    const now = () => (actx ? actx.currentTime : performance.now() / 1000) - clock0;
    let last = 0;
    await new Promise<void>((resolve, reject) => {
      let stop = () => {};
      const tick = () => {
        if (signal?.aborted) { stop(); reject(abortError()); return; }
        const c = now();
        if (c >= dur) { stop(); resolve(); return; }
        const t = start + Math.max(0, c);
        draw(t, Math.max(1 / 120, c - last));
        last = c;
        prog('렌더', c / dur);
      };
      stop = startTicker(1000 / fps, tick);
      tick();
    });
    draw(end, 1 / fps);
    prog('마무리', 0);
    rec.stop();
    await stopped;
    cleanup();
    prog('마무리', 1);
    const mime = isMp4 ? 'video/mp4' : 'video/webm';
    let note = isMp4 ? '실시간 녹화 방식으로 저장했습니다' : '이 브라우저는 MP4 인코딩을 지원하지 않아 WebM으로 저장했습니다';
    if (muted) note += ' · 브라우저가 오디오 재생을 막아 소리 없이 저장했습니다 (화면을 한 번 누른 뒤 다시 시도하세요)';
    return { blob: new Blob(chunks, { type: mime }), mime, ext: isMp4 ? 'mp4' : 'webm', note };
  } catch (e) {
    try { if (rec.state !== 'inactive') rec.stop(); } catch { /* */ }
    cleanup();
    throw e;
  }
}

// ───────────────────────── GIF ─────────────────────────

export async function exportGIF(input: ExportInput, opts: GifExportOptions): Promise<ExportResult> {
  checkAbort(opts.signal);
  const signal = opts.signal;
  const prog = (phase: string, ratio: number) => opts.onProgress?.({ phase, ratio: clamp(ratio, 0, 1) });
  const mod = await import('gifenc');
  const lib = (typeof mod.GIFEncoder === 'function' ? mod : mod.default) as typeof mod;
  const { GIFEncoder, quantize, applyPalette } = lib;

  const fps = clamp(Math.round(opts.fps || 12), 1, 20);
  const maxSide = clamp(Math.round(opts.maxSide || 540), 64, 1920);
  const [bw, bh] = RATIO_SIZE[input.settings.ratio] ?? RATIO_SIZE['1:1'];
  const k = maxSide / Math.max(bw, bh);
  const w = even(bw * k), h = even(bh * k);
  const start = Math.max(0, opts.start || 0);
  let end = Math.max(start + 1 / fps, isFinite(opts.end) ? opts.end : start + 5);
  let note: string | undefined;
  if (end - start > 30) { end = start + 30; note = 'GIF는 최대 30초까지라 앞 30초만 저장했습니다'; }
  const n = Math.max(1, Math.round((end - start) * fps));
  const times = frameTimes(start, n, fps);

  await prepareFont(input);
  prog('분석', 0);
  let analysis: Analysis | null = null;
  if (input.audio && start < input.audio.duration) analysis = await analyzeOffline(input.audio, times, fps, signal, r => prog('분석', r));
  prog('분석', 1);
  checkAbort(signal);

  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false }) as CanvasRenderingContext2D;
  const sc = scene(input);
  const fd = new FrameData(analysis);
  const render = (i: number) => {
    const level = fd.load(i);
    drawAt(ctx, sc, w, h, times[i], true, fd.has ? fd.spectrum : null, fd.has ? fd.waveform : null, level);
    return ctx.getImageData(0, 0, w, h).data;
  };

  // 글로벌 팔레트: 고르게 뽑은 샘플 프레임들의 픽셀을 모아 한 번 양자화 → 프레임 간 색 깜빡임 없음, 빠름
  const S = Math.min(n, 8);
  const per = Math.floor(240_000 / S); // 샘플 픽셀 수 상한
  const pool = new Uint8Array(per * S * 4);
  let filled = 0;
  for (let j = 0; j < S; j++) {
    const i = S === 1 ? 0 : Math.round((j * (n - 1)) / (S - 1));
    const data = render(i);
    const px = data.length / 4;
    const step = Math.max(1, Math.floor(px / per));
    for (let q = 0; q < px && filled < pool.length; q += step) {
      const o = q * 4;
      pool[filled] = data[o]; pool[filled + 1] = data[o + 1]; pool[filled + 2] = data[o + 2]; pool[filled + 3] = 255;
      filled += 4;
    }
    await yieldUI();
    checkAbort(signal);
  }
  const palette = quantize(pool.subarray(0, filled), 256, { format: 'rgb565' });

  const gif = GIFEncoder({ initialCapacity: w * h * Math.min(n, 64) });
  let lastYield = performance.now();
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) throw abortError();
    const data = render(i);
    const index = applyPalette(data, palette, 'rgb565');
    // 지연은 1/100초 단위 — 누적 반올림으로 전체 길이가 정확하게 (12fps → 8,8,9,8,8,9…)
    const cs = Math.round(((i + 1) * 100) / fps) - Math.round((i * 100) / fps);
    gif.writeFrame(index, w, h, i === 0 ? { palette, delay: cs * 10, repeat: 0 } : { delay: cs * 10 });
    if (performance.now() - lastYield > 30) {
      prog('렌더', (i + 1) / n);
      await yieldUI();
      lastYield = performance.now();
    }
  }
  prog('마무리', 0);
  gif.finish();
  const bytes = gif.bytes();
  prog('마무리', 1);
  return { blob: new Blob([bytes as BlobPart], { type: 'image/gif' }), mime: 'image/gif', ext: 'gif', note };
}
