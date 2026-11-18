// 플레이리스트 커버 메이커 (/cover) — 모듈 사이의 공용 계약.
//
// 화면(fe) · 테마(design) · 렌더/오디오/내보내기(media)가 이 파일의 모양만 보고 각자 작업한다.
// 필드를 바꾸면 세 쪽이 다 깨지므로, 추가는 자유롭게 하되 이름·의미 변경은 하지 않는다.
//
// 좌표 원칙: 캔버스 크기는 미리보기(작게)와 내보내기(1080 기준)가 다르다.
// 테마는 항상 `f.u`(= 짧은 변 / 1080) 단위로 그린다 → 해상도와 무관하게 같은 그림이 나온다.

export type Ratio = '1:1' | '4:5' | '9:16' | '16:9';
/** 내보내기 기준 크기 (px) */
export const RATIO_SIZE: Record<Ratio, [number, number]> = {
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '9:16': [1080, 1920],
  '16:9': [1920, 1080],
};

export type ThemeId = 'vinyl' | 'minimal' | 'film' | 'cassette' | 'player' | 'polaroid' | 'neon' | 'magazine';
export type FontId = 'basic' | 'cute' | 'hand' | 'sf' | 'oriental' | 'retro';
/** 오디오 반응 비주얼라이저 — none 포함 5가지 */
export type VisualizerId = 'none' | 'bars' | 'wave' | 'radial' | 'dots';
/** 전체 미세 움직임 */
export type MotionId = 'none' | 'sway' | 'breathe' | 'kenburns';
/** 사진 배치 — cover: 한쪽(또는 테마가 정한 자리)에 커버 / background: 전체 화면 배경 */
export type BackgroundStyle = 'clear' | 'gradient' | 'frost' | 'blur';
export type PhotoLayout = 'cover' | 'background';
/** 실제로 그려지는 톤 */
export type Tone = 'dark' | 'light';
/** 사용자 설정 톤 — auto = 테마 원래 톤 (사진 '전체 배경' 배치일 때는 dark) */
export type ToneSetting = 'auto' | Tone;

export interface CoverSettings {
  v: 1;
  theme: ThemeId;
  ratio: Ratio;
  font: FontId;
  /** 포인트색 #rrggbb */
  accent: string;
  photoLayout: PhotoLayout;
  visualizer: VisualizerId;
  /** 비주얼라이저 민감도 0.5 ~ 2 */
  vizGain: number;
  motion: MotionId;
  /** 움직임 세기 0 ~ 1 */
  motionStrength: number;
  showLyrics: boolean;
  /** 현재 줄 앞뒤 줄을 흐리게 보여 줄지 */
  lyricContext: boolean;
  /** 앞뒤로 몇 줄씩 (1 ~ 3) */
  lyricContextLines: number;
  showProgress: boolean;
  /** 배경 사진 어둡게 0 ~ 1 (background 배치 또는 테마 배경에 사진을 깔 때) */
  bgStyle: BackgroundStyle;
  bgStrength: number;
  /** 구 매거진 전체 배경의 선명한 렌더링을 보존한다. 사용자가 배경 처리를 변경하면 해제. */
  legacyMagazineBackground?: boolean;
  bgDim: number;
  /** 배경 사진 흐림 0 ~ 1 (테마가 실제 px로 환산) */
  bgBlur: number;
  /** 다크/라이트 전환 (auto = 테마 기본) */
  tone: ToneSetting;
  /** 배경색 #rrggbb — 빈 문자열이면 테마 기본. 값이 있으면 이 색이 바탕이 되고 톤은 이 색의 밝기로 정해진다 */
  bgColor: string;
  title: string;
  artist: string;
  /** 문구 1개 (짧은 한 줄 소개·인용) */
  phrase: string;
}

export const DEFAULT_SETTINGS: CoverSettings = {
  v: 1,
  theme: 'vinyl',
  ratio: '1:1',
  font: 'basic',
  accent: '#d9a441',
  photoLayout: 'cover',
  visualizer: 'bars',
  vizGain: 1,
  motion: 'breathe',
  motionStrength: 0.5,
  showLyrics: true,
  lyricContext: true,
  lyricContextLines: 1,
  showProgress: true,
  bgStyle: 'gradient',
  bgStrength: 0.6,
  bgDim: 0.45,
  bgBlur: 0.5,
  tone: 'auto',
  bgColor: '',
  title: '',
  artist: '',
  phrase: '',
};

/** 저장값을 읽을 때 빠진 필드·이상값을 기본값으로 메운다 (프리셋·JSON 가져오기 공용) */
export function normalizeSettings(raw: unknown): CoverSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<CoverSettings>;
  const d = DEFAULT_SETTINGS;
  const pick = <K extends keyof CoverSettings>(k: K, ok: (v: unknown) => boolean): CoverSettings[K] =>
    (ok(o[k]) ? o[k] : d[k]) as CoverSettings[K];
  const inList = (list: readonly string[]) => (v: unknown) => typeof v === 'string' && list.includes(v);
  const num = (min: number, max: number) => (v: unknown) => typeof v === 'number' && isFinite(v) && v >= min && v <= max;
  const bool = (v: unknown) => typeof v === 'boolean';
  const str = (max: number) => (v: unknown) => typeof v === 'string' && v.length <= max;
  return {
    v: 1,
    theme: pick('theme', inList(['vinyl', 'minimal', 'film', 'cassette', 'player', 'polaroid', 'neon', 'magazine'])),
    ratio: pick('ratio', inList(Object.keys(RATIO_SIZE))),
    font: pick('font', inList(['basic', 'cute', 'hand', 'sf', 'oriental', 'retro'])),
    accent: pick('accent', v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)),
    photoLayout: pick('photoLayout', inList(['cover', 'background'])),
    visualizer: pick('visualizer', inList(['none', 'bars', 'wave', 'radial', 'dots'])),
    vizGain: pick('vizGain', num(0.5, 2)),
    motion: pick('motion', inList(['none', 'sway', 'breathe', 'kenburns'])),
    motionStrength: pick('motionStrength', num(0, 1)),
    showLyrics: pick('showLyrics', bool),
    lyricContext: pick('lyricContext', bool),
    lyricContextLines: pick('lyricContextLines', v => num(1, 3)(v) && Number.isInteger(v)),
    showProgress: pick('showProgress', bool),
    bgStyle: o.bgStyle === undefined && o.photoLayout === 'background' ? 'blur' : pick('bgStyle', inList(['clear', 'gradient', 'frost', 'blur'])),
    bgStrength: pick('bgStrength', num(0, 1)),
    bgDim: pick('bgDim', num(0, 1)),
    // 설정값은 보존하고 구 매거진의 선명한 배경만 렌더링에서 재현한다.
    legacyMagazineBackground: o.legacyMagazineBackground === true || (o.bgStyle === undefined && o.photoLayout === 'background' && o.theme === 'magazine'),
    bgBlur: pick('bgBlur', num(0, 1)),
    tone: pick('tone', inList(['auto', 'dark', 'light'])),
    // 소문자로 통일 (#ABCDEF로 저장된 값도 받는다)
    bgColor: (typeof o.bgColor === 'string' && /^#[0-9a-f]{6}$/i.test(o.bgColor) ? o.bgColor.toLowerCase() : ''),
    title: pick('title', str(200)),
    artist: pick('artist', str(200)),
    phrase: pick('phrase', str(300)),
  };
}

/** 가사 한 줄. time = 초. 타임스탬프가 없는 txt는 time = NaN (싱크 전) */
export interface LyricLine { time: number; text: string }

export interface Rect { x: number; y: number; w: number; h: number }

/** 포인트색만으로 정해지는 부분 — 테마의 toneBg가 받는다 */
export interface AccentPalette {
  accent: string;        // 원색
  accentSoft: string;    // 배경에 깔 옅은 톤
  accentDeep: string;    // 어두운 톤
  onAccent: string;      // 포인트색 위 글자색 (#fff 또는 진한 색)
  isDark: boolean;       // 포인트색 자체가 어두운지
}

/**
 * 프레임 팔레트 — tone.ts의 paletteFor(settings)가 만든다 (포인트색 + 톤 + 배경색).
 * 테마는 하드코딩 색 대신 이 값을 쓴다. ink/inkSoft는 단색 바탕 기준이며 사진 위 대비는 사진에 따라 달라진다.
 */
export interface Palette extends AccentPalette {
  /** 실제 톤 (auto·배경색 반영 후) */
  tone: Tone;
  /** 사용자가 배경색을 지정했는지 (true면 bg = 그 색) */
  bgCustom: boolean;
  /** 바탕색. 사진 전체 배경 배치면 사진 위에 덮는 색(= dim)과 같다 */
  bg: string;
  /** 바탕에서 한 단계 떨어진 면 (카드·패널·띠) */
  bgAlt: string;
  /** 본문 글자 — 가능한 경우 bg 대비 ≥ 7 (중간 밝기는 최대 대비 선택) */
  ink: string;
  /** 보조 글자 — bg 대비 ≥ 4.5 */
  inkSoft: string;
  /** 흐린 장식 (트랙·눈금 등, 대비 요구 없음) */
  inkFaint: string;
  /** 구분선 */
  line: string;
  /** bg 위에서 읽히는 포인트색 (대비 ≥ 3) — 포인트색 글자·아이콘용 */
  accentInk: string;
  /** 그림자 색 (#rrggbb, 투명도는 쓰는 쪽이 alpha()로) */
  shadow: string;
  /** 사진 어둡게(bgDim) 오버레이 색 — dark: 검정 계열, light: 흰색 계열, 배경색 지정 시 그 색 */
  dim: string;
}

/** 한 프레임을 그리는 데 필요한 모든 것 — 미리보기·PNG·MP4·GIF가 같은 값을 넣는다 */
export interface FrameState {
  settings: CoverSettings;
  /** 캔버스 실제 px */
  width: number;
  height: number;
  /** 단위 = min(width, height) / 1080 */
  u: number;
  /** 재생 위치(초) */
  time: number;
  /** 곡 길이(초). 오디오가 없으면 가사 끝 + 여유 또는 30 */
  duration: number;
  playing: boolean;
  /** 사진 (없으면 null — 테마가 자리 표시를 그린다) */
  image: CanvasImageSource | null;
  imageW: number;
  imageH: number;
  lyrics: LyricLine[];
  /** 주파수 데이터 0~255, 길이 = analyser.frequencyBinCount (fftSize 2048 → 1024). 오디오 없으면 null */
  spectrum: Uint8Array | null;
  /** 시간영역 파형 0~255 (128 = 0), 길이 = fftSize. 오디오 없으면 null */
  waveform: Uint8Array | null;
  /** 현재 음량 0~1 (부드럽게 처리된 값) */
  level: number;
  palette: Palette;
}

/** 움직임 변환 — render.ts의 motionAt이 계산 */
export interface MotionState { scale: number; dx: number; dy: number; rot: number }

export interface LyricStyle {
  align: 'left' | 'center' | 'right';
  /** 현재 줄 글자 크기(px, 이미 u 곱한 값) */
  size: number;
  /** 앞뒤 줄 크기 비율 (기본 0.72) */
  contextScale?: number;
  weight?: number;
  color: string;
  /** 앞뒤 줄 색 (기본 color에 투명도) */
  dimColor?: string;
  lineHeight?: number;   // 배수, 기본 1.5
  /** 글자 그림자/광채 */
  glow?: string;
  shadow?: string;
  /** 줄 바꿈 허용 최대 줄 수 (현재 줄 기준, 기본 2) */
  maxWrap?: number;
  /** 대문자 변환 등 테마 장식 */
  letterSpacing?: number;
}

export interface VizStyle {
  /** 지정 안 하면 settings.visualizer */
  kind?: VisualizerId;
  color: string;
  color2?: string;
  /** 선 두께(px) */
  thickness?: number;
  /** radial일 때 안쪽 반지름 비율 (0~1, rect 짧은 변 절반 기준) */
  innerRadius?: number;
  /** 막대·점 개수 힌트 */
  count?: number;
  /** 대칭(가운데서 위아래로) */
  mirror?: boolean;
  glow?: number;
  alpha?: number;
}

/** 렌더러가 테마에게 빌려주는 도구 */
export interface RenderKit {
  /** 선택한 폰트의 CSS font-family 스택 */
  family: string;
  /** 보조(시간·숫자) 폰트 스택 — fonts.ts의 MONO_FAMILY */
  mono: string;
  /** `${weight} ${px}px ${family}` 만들기 */
  font: (px: number, weight?: number, family?: string) => string;
  motion: MotionState;
  /** 사진을 rect에 object-fit: cover로 그린다. 켄 번즈·브리딩 움직임이 사진 안쪽에 적용된다.
   *  radius: 모서리 둥글기(px). 사진이 없으면 포인트색 기반 자리 표시를 그린다 */
  drawPhoto: (ctx: CanvasRenderingContext2D, rect: Rect, opts?: { radius?: number; blur?: number; dim?: number; grayscale?: boolean }) => void;
  drawLyrics: (ctx: CanvasRenderingContext2D, rect: Rect, style: LyricStyle) => void;
  drawVisualizer: (ctx: CanvasRenderingContext2D, rect: Rect, style: VizStyle) => void;
  /** 긴 글자를 maxW에 맞게 … 처리 */
  fitText: (ctx: CanvasRenderingContext2D, text: string, maxW: number) => string;
  /** 0~1 진행률 */
  progress: number;
  /** m:ss */
  fmtTime: (sec: number) => string;
}

export interface ThemeDef {
  id: ThemeId;
  /** 화면 표시 이름 (한국어) */
  name: string;
  /** 한 줄 설명 */
  desc: string;
  /** 테마가 어울리는 기본 포인트색 (테마 고를 때 추천) */
  suggestedAccent?: string;
  /** 테마 원래 톤 (tone: 'auto'일 때) */
  baseTone: Tone;
  /** 톤별 바탕 대표색 — 배경색을 지정하지 않았을 때 palette.bg가 되고, ink 등이 이 색 기준으로 계산된다 */
  toneBg: (tone: Tone, p: AccentPalette) => string;
  /** 배경 — 움직임 변환 바깥 (가장자리가 비지 않게 화면을 꽉 채운다) */
  background: (ctx: CanvasRenderingContext2D, f: FrameState, kit: RenderKit) => void;
  /** 전경 — render.ts가 sway/breathe 변환을 걸고 부른다 */
  foreground: (ctx: CanvasRenderingContext2D, f: FrameState, kit: RenderKit) => void;
}

/** 내보내기 입력 */
export interface ExportInput {
  settings: CoverSettings;
  image: ImageBitmap | HTMLImageElement | null;
  lyrics: LyricLine[];
  /** 디코딩된 오디오 (없으면 무음 영상) */
  audio: AudioBuffer | null;
  duration: number;
}

export interface ExportProgress { phase: string; ratio: number }

export interface VideoExportOptions {
  start: number;
  end: number;
  fps: number;
  /** 짧은 변 기준 해상도 배율 (1 = 1080, 0.667 = 720) */
  scale: number;
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
}

export interface GifExportOptions {
  start: number;
  end: number;
  fps: number;
  /** 긴 변 최대 px (기본 540) */
  maxSide: number;
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
}

export interface ExportResult { blob: Blob; mime: string; ext: string; note?: string }
