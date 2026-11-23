// Pixel avatar checks: part counts, native 128×128 buffer, per-style pixel
// differences, legacy data, colour application, determinism, SVG/editor output.
// `node scripts/test-pixel-avatar.cjs --sheets <dir>` also writes PNG contact
// sheets (all 72 styles + colour extremes) for visual review.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const ts = require('typescript');

// Load the TypeScript sources directly (no build step, no .next usage).
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (mod, filename) => {
    const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    mod._compile(out, filename);
  };
}
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const art = require('../src/components/chars/pixelAvatarArt.ts');
const ui = require('../src/components/chars/PixelAvatar.tsx');
const { pixelAvatarPixels, PIXEL_AVATAR_SIZE, HAIR_STYLE_NAMES, FACE_STYLE_NAMES, BODY_STYLE_NAMES } = art;
const base = ui.DEFAULT_PIXEL_AVATAR;

const px = v => pixelAvatarPixels(v).pixels;
const diffCount = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
const same = (a, b) => diffCount(a, b) === 0;

// 1. Native grid size and exported API.
assert.equal(PIXEL_AVATAR_SIZE, 128);
const first = pixelAvatarPixels(base);
assert.equal(first.width, 128); assert.equal(first.height, 128);
assert.ok(first.pixels instanceof Uint32Array); assert.equal(first.pixels.length, 128 * 128);
assert.ok(first.pixels.some(c => c === 0), 'has transparent background');
assert.ok(first.pixels.every(c => c === 0 || (c & 255) === 255), 'pixels are opaque or fully transparent');
assert.strictEqual(ui.pixelAvatarPixels, pixelAvatarPixels, 'PixelAvatar.tsx re-exports pixelAvatarPixels');
assert.equal(ui.PIXEL_AVATAR_SIZE, 128);
first.pixels[0] = 123; assert.equal(px(base)[0], 0, 'callers get a copy, cache is not mutable');
console.log('Buffer: 128×128 Uint32Array (0xRRGGBBAA, transparent = 0)');

// 2. Style counts and pairwise visual separation.
const names = { hair: HAIR_STYLE_NAMES, face: FACE_STYLE_NAMES, body: BODY_STYLE_NAMES };
// Minimum differing pixels between any two styles of the same part (canvas = 16,384 px).
// Faces only occupy the ~50×30 px area around the eyes/mouth, so their bar is lower.
const MIN_DIFF = { hair: 300, face: 180, body: 300 };
const similarityFailures = [];
for (const part of ['hair', 'face', 'body']) {
  assert.equal(names[part].length, 24, `${part} names`);
  assert.equal(new Set(names[part]).size, 24, `${part} names unique`);
  const imgs = names[part].map((_, n) => px({ ...base, [part]: n }));
  const pairs = [];
  for (let a = 0; a < 24; a++) for (let b = a + 1; b < 24; b++) pairs.push({ n: diffCount(imgs[a], imgs[b]), a, b });
  pairs.sort((x, y) => x.n - y.n);
  const closest = pairs[0];
  console.log(`${part}: 24 styles; closest pairs ${pairs.slice(0, 3).map(q => `${q.a}·${names[part][q.a]}/${q.b}·${names[part][q.b]}=${q.n}px`).join(', ')} (min ${MIN_DIFF[part]})`);
  // Reported at the end so --sheets still renders the review images.
  if (closest.n < MIN_DIFF[part]) similarityFailures.push(`${part} ${closest.a}/${closest.b} too similar: ${closest.n} px`);
}

// 3. Legacy / malformed data never throws and falls back to defaults.
const legacy = [{}, { hair: '3', face: '2', body: '1' }, { ...base, hair: -1 }, { ...base, face: 99 }, { ...base, body: 1.5 },
  { ...base, hairColor: 'red' }, { ...base, skinColor: '#12' }, { ...base, bodyColor: null }, { ...base, eyeColor: '#GGGGGG' }, null, undefined];
for (const v of legacy) { const r = pixelAvatarPixels(v); assert.equal(r.pixels.length, 16384); }
assert.ok(same(px({}), px(base)), 'empty object → defaults');
assert.ok(same(px({ hair: '3', face: '2', body: '1', hairColor: base.hairColor, skinColor: base.skinColor, bodyColor: base.bodyColor }), px({ ...base, hair: 3, face: 2, body: 1 })), 'numeric string index');
for (const part of ['hair', 'face', 'body']) for (const bad of [-1, 24, 99, 1.5, NaN, 'x', null]) assert.ok(same(px({ ...base, [part]: bad }), px(base)), `${part}=${bad}`);
for (const key of ['hairColor', 'skinColor', 'bodyColor', 'eyeColor']) for (const bad of ['invalid', '#12', '#12345g', '', 123]) assert.ok(same(px({ ...base, [key]: bad }), px(base)), `${key}=${bad}`);
assert.ok(same(px({ ...base, hairColor: '#ABC' }), px({ ...base, hairColor: '#aabbcc' })), '#RGB shorthand');
assert.ok(same(px({ ...base, hairColor: '#A0B0C0' }), px({ ...base, hairColor: '#a0b0c0' })), 'case-insensitive');
assert.equal(art.normalizeHexColor(' #AbC '), '#aabbcc'); assert.equal(art.normalizeHexColor('#12345'), null);
console.log('Legacy data ({}, string index, -1, 24, 99, 1.5, bad HEX, null): rendered with safe fallbacks');

// A quarter of the 13,824 style combinations render with head and body present.
let combos = 0;
for (let hair = 0; hair < 24; hair++) for (let face = 0; face < 24; face++) for (let body = 0; body < 24; body++) {
  if ((hair + face + body) % 4) continue;
  const p = px({ ...base, hair, face, body }); combos++;
  assert.ok(p[45 * 128 + 64] !== 0 && p[100 * 128 + 64] !== 0, `combo ${hair}/${face}/${body} has head and body`);
}
console.log(`${combos} sampled style combinations: head and body pixels present`);

// 4. Colour changes land in the matching region.
const region = (v, key, color) => {
  const a = px(v), b = px({ ...v, [key]: color }); let n = 0, top = 128, bottom = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { n++; const y = i >> 7; top = Math.min(top, y); bottom = Math.max(bottom, y); }
  return { n, top, bottom };
};
const hairR = region(base, 'hairColor', '#2060d0'), skinR = region(base, 'skinColor', '#6b4430'), bodyR = region(base, 'bodyColor', '#d04040'), eyeR = region(base, 'eyeColor', '#20a050');
console.log(`Colour regions: hair ${hairR.n}px (rows ${hairR.top}-${hairR.bottom}), skin ${skinR.n}px, body ${bodyR.n}px (rows ${bodyR.top}-${bodyR.bottom}), eyes ${eyeR.n}px (rows ${eyeR.top}-${eyeR.bottom})`);
assert.ok(hairR.n > 1500 && hairR.top < 20, 'hair colour'); assert.ok(skinR.n > 1200, 'skin colour');
assert.ok(bodyR.n > 1000 && bodyR.top >= 60, 'body colour stays below the head'); assert.ok(eyeR.n > 40 && eyeR.top >= 40 && eyeR.bottom <= 62, 'eye colour stays in the eyes');
// Extreme colours keep at least 4 distinct tones in the hair.
for (const hc of ['#000000', '#ffffff']) {
  const v = { ...base, hairColor: hc }, a = px(v), b = px({ ...v, hairColor: '#ff0000' });
  const tones = new Set(); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) tones.add(a[i]);
  assert.ok(tones.size >= 4, `${hc} hair keeps ${tones.size} tones`);
}
{ // eye colour equal to the skin is still readable (dark pupil ring/lash pixels inside the eye box)
  const v = { ...base, eyeColor: base.skinColor }, a = px(v);
  let dark = 0; for (let y = 46; y < 60; y++) for (let x = 46; x < 60; x++) { const c = a[y * 128 + x]; const l = (c >>> 24) + ((c >>> 16) & 255) + ((c >>> 8) & 255); if (c && l < 300) dark++; }
  assert.ok(dark > 25, 'eye readable when eye colour = skin colour: ' + dark);
}

// 5. Determinism and speed.
assert.ok(same(px({ ...base, hair: 7, face: 5, body: 9 }), px({ ...base, hair: 7, face: 5, body: 9 })));
let slow = 0; const t0 = process.hrtime.bigint();
for (let i = 0; i < 72; i++) { const s = process.hrtime.bigint(); pixelAvatarPixels({ ...base, hair: i % 24, face: (i * 5) % 24, body: (i * 7) % 24, hairColor: '#' + (0x100000 + i * 9973).toString(16).slice(-6) }); slow = Math.max(slow, Number(process.hrtime.bigint() - s) / 1e6); }
console.log(`Determinism ok; uncached render avg ${(Number(process.hrtime.bigint() - t0) / 1e6 / 72).toFixed(2)} ms, max ${slow.toFixed(2)} ms`);

// 6. SVG output equals the buffer, square size.
const parseSvg = html => {
  const grid = new Uint32Array(16384);
  for (const m of html.matchAll(/<path fill="#([0-9a-f]{6})" d="([^"]+)"/g)) {
    const c = ((parseInt(m[1], 16) << 8) | 255) >>> 0;
    for (const r of m[2].matchAll(/M(\d+) (\d+)h(\d+)/g)) for (let x = +r[1]; x < +r[1] + +r[3]; x++) grid[+r[2] * 128 + x] = c;
  }
  return grid;
};
for (const v of [base, { ...base, hair: 19, face: 13, body: 15 }, { ...base, hair: 23, face: 22, body: 8, hairColor: '#000', skinColor: '#5a3825' }]) {
  const html = renderToStaticMarkup(React.createElement(ui.PixelAvatar, { value: v, size: 90 }));
  assert.match(html, /width="90" height="90"/); assert.match(html, /viewBox="0 0 128 128"/);
  assert.ok(same(parseSvg(html), px(v)), 'SVG matches pixel buffer');
}
assert.match(renderToStaticMarkup(React.createElement(ui.PixelAvatar, { value: {} })), /viewBox="0 0 128 128"/);

// 7. Editor markup: labelled selects with names, colour pickers + HEX fields, nav buttons.
const editor = renderToStaticMarkup(React.createElement(ui.PixelAvatarEditor, { value: base, onChange() {} }));
assert.equal((editor.match(/<option /g) || []).length, 72);
assert.match(editor, /머리 4 · 트윈테일/); assert.match(editor, /표정 2 · 웃음 \^\^/); assert.match(editor, /몸 1 · 티셔츠/);
assert.equal((editor.match(/type="color"/g) || []).length, 4);
assert.equal((editor.match(/type="text"/g) || []).length, 4);
for (const l of ['머리색', '눈 색', '피부색', '옷 색']) { assert.match(editor, new RegExp(`${l} 선택`)); assert.match(editor, new RegExp(`${l} HEX`)); }
assert.equal((editor.match(/aria-label="(이전|다음) (머리|표정|몸)/g) || []).length, 6, 'prev/next buttons');
assert.match(renderToStaticMarkup(React.createElement(ui.PixelAvatarEditor, { onChange() {} })), /도트 캐릭터 만들기/);
assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(ui.PixelAvatarEditor, { value: { hair: 'x', face: 99, body: -2, hairColor: 'bad' }, onChange() {} })));
console.log('SVG == buffer, square size, editor labels/colour fields/prev-next: passed');

// ---------------------------------------------------------------- sheets
const sheetDir = process.argv.includes('--sheets') ? process.argv[process.argv.indexOf('--sheets') + 1] : null;
if (sheetDir) {
  fs.mkdirSync(sheetDir, { recursive: true });
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const png = (w, h, rgb) => {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  };
  const FONT = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
  const sheet = (file, items, cols, scale) => {
    const tile = 128 * scale + 8, rows = Math.ceil(items.length / cols), w = cols * tile, h = rows * tile, rgb = Buffer.alloc(w * h * 3, 0xf0);
    items.forEach((v, n) => {
      const ox = (n % cols) * tile + 4, oy = Math.floor(n / cols) * tile + 4, p = px(v);
      for (let y = 0; y < 128 * scale; y++) for (let x = 0; x < 128 * scale; x++) {
        const c = p[Math.floor(y / scale) * 128 + Math.floor(x / scale)], o = ((oy + y) * w + ox + x) * 3;
        const bg = ((x >> 4) + (y >> 4)) & 1 ? 0xc9 : 0xd8;
        rgb[o] = c ? c >>> 24 : bg; rgb[o + 1] = c ? (c >>> 16) & 255 : bg; rgb[o + 2] = c ? (c >>> 8) & 255 : bg + 12;
      }
      String(n).split('').forEach((d, di) => { for (let i = 0; i < 15; i++) if (FONT[+d][i] === '1') for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 3; xx++) { const o = ((oy + 2 + Math.floor(i / 3) * 3 + yy) * w + ox + 2 + di * 12 + (i % 3) * 3 + xx) * 3; rgb[o] = 200; rgb[o + 1] = 20; rgb[o + 2] = 40; } });
    });
    fs.writeFileSync(path.join(sheetDir, file), png(w, h, rgb));
  };
  const range = f => Array.from({ length: 24 }, (_, n) => f(n));
  sheet('hair.png', range(n => ({ ...base, hair: n })), 6, 2);
  sheet('face.png', range(n => ({ ...base, face: n })), 6, 2);
  sheet('body.png', range(n => ({ ...base, body: n })), 6, 2);
  sheet('all72.png', [...range(n => ({ ...base, hair: n })), ...range(n => ({ ...base, face: n })), ...range(n => ({ ...base, body: n }))], 12, 1);
  const extremes = [
    { hairColor: '#000000', skinColor: '#f6dcc8', eyeColor: '#000000', bodyColor: '#000000' },
    { hairColor: '#ffffff', skinColor: '#fff4ec', eyeColor: '#ffffff', bodyColor: '#ffffff' },
    { hairColor: '#1a1a1a', skinColor: '#5a3825', eyeColor: '#5a3825', bodyColor: '#e8c040' },
    { hairColor: '#f2e6c8', skinColor: '#ffe8d8', eyeColor: '#ffe8d8', bodyColor: '#2050c0' },
    { hairColor: '#ff3080', skinColor: '#8d5a3b', eyeColor: '#30c0ff', bodyColor: '#30a050' },
    { hairColor: '#3050ff', skinColor: '#c88a64', eyeColor: '#c88a64', bodyColor: '#7030a0' },
  ];
  sheet('colors.png', extremes.flatMap((c, i) => [{ ...base, ...c, hair: i * 4, face: i * 3, body: i * 4 }, { ...base, ...c, hair: i * 4 + 2, face: i * 3 + 1, body: i * 4 + 2 }]), 6, 2);
  sheet('mix.png', range(n => ({ ...base, hair: n, face: (n * 7) % 24, body: (n * 5) % 24 })), 6, 2);
  console.log('Sheets written to', sheetDir);
}
assert.deepEqual(similarityFailures, [], 'style pairs below the difference threshold');
console.log('All pixel avatar checks passed');
