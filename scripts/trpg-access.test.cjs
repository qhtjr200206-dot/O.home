// TRPG 로그 비밀번호 정책 — 공개범위·목록 표시와 상관없이 비밀번호가 적용되는지 확인한다.
// 실행: node scripts/trpg-access.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

const file = path.join(__dirname, '../src/lib/trpgAccess.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = new Module(file, module);
mod.filename = file;
mod.paths = module.paths;
mod._compile(compiled, file);
const { readableWithoutPassword, logBodyVisibility, keepLogFilesPrivate, isPublicFileRef } = mod.exports;

const anon = { isAdmin: false, isRelPartner: false, signedIn: false };
const member = { isAdmin: false, isRelPartner: false, signedIn: true };
const partner = { isAdmin: false, isRelPartner: true, signedIn: true };
const admin = { isAdmin: true, isRelPartner: false, signedIn: true };
const PW = 'hash';

// 비밀번호가 걸리면 공개범위와 상관없이 관리자·연동 자관 상대방만 바로 연다
for (const visibility of ['public', 'member', 'private']) {
  const log = { visibility, passwordHash: PW };
  assert.equal(readableWithoutPassword(log, anon, true), false, `${visibility}+비밀번호: 비로그인`);
  assert.equal(readableWithoutPassword(log, member, true), false, `${visibility}+비밀번호: 로그인 회원`);
  assert.equal(readableWithoutPassword(log, partner, true), true, `${visibility}+비밀번호: 연동 자관 상대방`);
  assert.equal(readableWithoutPassword(log, admin, true), true, `${visibility}+비밀번호: 관리자`);
  assert.equal(logBodyVisibility(log, true), 'private', `${visibility}+비밀번호: 본문 문서는 비공개`);
  assert.equal(keepLogFilesPrivate(log), true, `${visibility}+비밀번호: 파일은 비공개 저장소`);
}

// 비밀번호가 없으면 예전과 같다 — 공개범위대로
assert.equal(readableWithoutPassword({ visibility: 'public' }, anon, true), true);
assert.equal(readableWithoutPassword({ visibility: 'member' }, anon, true), false);
assert.equal(readableWithoutPassword({ visibility: 'member' }, member, true), true);
assert.equal(readableWithoutPassword({ visibility: 'private' }, member, true), false);
assert.equal(readableWithoutPassword({ visibility: 'private' }, admin, true), true);
for (const visibility of ['public', 'member', 'private']) {
  assert.equal(logBodyVisibility({ visibility }, true), visibility);
  assert.equal(keepLogFilesPrivate({ visibility }), false);
}

// 서버 확인을 못 하는 백엔드에서는 비밀번호를 강제하지 않는다 (강제하면 아무도 못 연다)
assert.equal(readableWithoutPassword({ visibility: 'member', passwordHash: PW }, member, false), true);
assert.equal(logBodyVisibility({ visibility: 'member', passwordHash: PW }, false), 'member');

assert.equal(isPublicFileRef('https://firebasestorage.googleapis.com/x'), true);
assert.equal(isPublicFileRef('private-trpg/abc.txt'), false);
assert.equal(isPublicFileRef(undefined), false);

console.log('trpg-access: all tests passed');
