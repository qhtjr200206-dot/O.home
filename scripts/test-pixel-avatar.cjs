const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const file = path.resolve(__dirname, '../src/components/chars/PixelAvatar.tsx');
const source = fs.readFileSync(file, 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = new Module(file, module);
mod.filename = file;
mod.paths = Module._nodeModulePaths(path.dirname(file));
mod._compile(compiled, file);
const { PixelAvatar, PixelAvatarEditor, DEFAULT_PIXEL_AVATAR: base } = mod.exports;

// Rasterize the actual SVG rectangles in paint order, so overdraw doesn't create false differences.
function pixels(value) {
  const svg = PixelAvatar({ value });
  const canvas = Array.from({ length: 40 }, () => Array(32).fill(''));
  for (const rect of svg.props.children) {
    const { x, y, width, height, fill } = rect.props;
    for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) {
      if (yy >= 0 && yy < 40 && xx >= 0 && xx < 32) canvas[yy][xx] = fill;
    }
  }
  return JSON.stringify(canvas);
}
for (const part of ['hair', 'face', 'body']) {
  const images = new Set(Array.from({ length: 24 }, (_, n) => pixels({ ...base, [part]: n })));
  assert.ok(images.size >= 20, `${part}: only ${images.size} visibly different styles`);
  console.log(`${part}: ${images.size} distinct rendered styles`);
}
for (const part of ['hair', 'face', 'body']) {
  assert.equal(pixels({ ...base, [part]: 100 }), pixels(base));
  assert.equal(pixels({ ...base, [part]: -1 }), pixels(base));
  assert.equal(pixels({ ...base, [part]: 1.5 }), pixels(base));
}
assert.equal(pixels(base), pixels({ ...base, eyeColor: '#302b36' }));
assert.notEqual(pixels(base), pixels({ ...base, eyeColor: '#123456' }));
assert.equal(pixels(base), pixels({ ...base, eyeColor: 'invalid' }));
for (let i = 0; i < 3; i++) {
  const svg = PixelAvatar({ value: { ...base, hair: i, face: i, body: i }, size: 100 });
  assert.equal(svg.props.viewBox, '0 0 32 40');
  assert.equal(svg.props.width, 80);
  assert.ok(svg.props.children.some(rect => rect.props.fill === '#302b36'));
}
const editor = renderToStaticMarkup(React.createElement(PixelAvatarEditor, { value: base, onChange() {} }));
assert.equal((editor.match(/<option /g) || []).length, 72);
assert.equal((editor.match(/type="color"/g) || []).length, 4);
assert.equal((editor.match(/type="text"/g) || []).length, 4);
assert.match(editor, /눈 색 HEX/);
assert.match(editor, /눈 색 선택/);
assert.match(renderToStaticMarkup(React.createElement(PixelAvatarEditor, { onChange() {} })), /도트 캐릭터 만들기/);
console.log('Legacy data, invalid indices, eye color, dimensions and labeled editor controls: passed');
