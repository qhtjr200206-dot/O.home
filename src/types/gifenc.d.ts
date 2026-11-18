// gifenc 1.0.x 타입 선언 (패키지에 타입이 없음) — node_modules/gifenc/README.md 기준
declare module 'gifenc' {
  export type GifColorFormat = 'rgb565' | 'rgb444' | 'rgba4444';
  /** [r,g,b] 또는 [r,g,b,a] 배열들 */
  export type GifPalette = number[][];

  export interface QuantizeOptions {
    format?: GifColorFormat;
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  export interface WriteFrameOptions {
    palette?: GifPalette;
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    /** 프레임 지연(ms) — 내부에서 1/100초로 반올림 */
    delay?: number;
    /** 0 = 무한 반복, -1 = 한 번 */
    repeat?: number;
    colorDepth?: number;
    dispose?: number;
  }

  export interface GifStream {
    writeByte(b: number): void;
    writeBytes(data: ArrayLike<number>, offset?: number, byteLength?: number): void;
  }

  export interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    writeHeader(): void;
    reset(): void;
    readonly buffer: ArrayBuffer;
    readonly stream: GifStream;
  }

  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GifEncoderInstance;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: QuantizeOptions): GifPalette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: GifPalette, format?: GifColorFormat): Uint8Array;
  export function nearestColorIndex(palette: GifPalette, pixel: number[]): number;
  export function nearestColorIndexWithDistance(palette: GifPalette, pixel: number[]): [number, number];
  export function nearestColor(palette: GifPalette, pixel: number[]): number[];
  export function prequantize(rgba: Uint8Array | Uint8ClampedArray, opts?: { roundRGB?: number; roundAlpha?: number; oneBitAlpha?: boolean | number }): void;
  export function snapColorsToPalette(palette: GifPalette, knownColors: number[][], threshold?: number): void;

  const gifenc: {
    GIFEncoder: typeof GIFEncoder;
    quantize: typeof quantize;
    applyPalette: typeof applyPalette;
  };
  export default gifenc;
}
