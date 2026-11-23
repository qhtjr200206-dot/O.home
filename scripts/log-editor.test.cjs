// 로그 편집기 — 판정 해석·로그 읽기 테스트.
// 실행: node scripts/log-editor.test.cjs [로그 파일 …]
//   파일을 주면 그 로그도 읽어서 판정 통계를 찍는다 (실제 로그 확인용).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

/** src/lib/logEditor/*.ts 를 CommonJS로 바꿔 불러온다 — 같은 폴더의 상대 import도 처리 */
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = new Module(file, module);
  mod.filename = file;
  mod.paths = module.paths;
  cache.set(file, mod);
  const req = (spec) => (spec.startsWith('.') ? load(path.resolve(path.dirname(file), `${spec}.ts`)) : require(spec));
  new Function('exports', 'require', 'module', '__filename', '__dirname', compiled)(mod.exports, req, mod, file, path.dirname(file));
  return mod.exports;
}
const dir = path.join(__dirname, '../src/lib/logEditor');
const { parseRoll, splitInlineRoll, tierOf } = load(path.join(dir, 'dice.ts'));
const { parseLog, pickDefaultFile } = load(path.join(dir, 'parse.ts'));
const { buildLogHtml, rollStats } = load(path.join(dir, 'render.ts'));

/* ---------- 판정 ---------- */
let r = parseRoll('CC<=80 민첩성', '(1D100<=80) 보너스, 페널티 주사위[0] ＞ 88 ＞ 88 ＞ 실패');
assert.equal(r.kind, 'check');
assert.equal(r.label, '민첩성');
assert.equal(r.bonus, 0);
assert.equal(r.tier, 'failure');
assert.equal(r.target, 80);
assert.deepEqual(r.dice, [88]);
assert.equal(r.value, '88');

r = parseRoll('CC(-1)<=80 [민첩성]', '(1D100<=80) 보너스, 페널티 주사위[-1] ＞ 88, 34 ＞ 88 ＞ 실패');
assert.equal(r.label, '민첩성');
assert.equal(r.bonus, -1);
assert.deepEqual(r.dice, [88, 34]);
assert.equal(r.value, '88');

r = parseRoll('CC(2)<=60 관찰력', '(1D100<=60) 보너스, 페널티 주사위[2] ＞ 45, 05, 25 ＞ 05 ＞ 극단적 성공');
assert.equal(r.bonus, 2);
assert.equal(r.tier, 'extreme');

// 결과에 보너스 표기가 없으면 명령에서
assert.equal(parseRoll('CC(-1)<=50 듣기', '(1D100<=50) ＞ 70 ＞ 실패').bonus, -1);

assert.equal(parseRoll('CC<=55 행운', '(1D100<=55) 보너스, 페널티 주사위[0] ＞ 100 ＞ 100 ＞ 대실패').tier, 'fumble');
assert.equal(parseRoll('CC<=55 행운', '(1D100<=55) 보너스, 페널티 주사위[0] ＞ 1 ＞ 1 ＞ 대성공').tier, 'critical');
assert.equal(parseRoll('CC<=48 이성', '(1D100<=48) 보너스, 페널티 주사위[0] ＞ 16 ＞ 16 ＞ 어려운 성공').tier, 'hard');
assert.equal(parseRoll('CC<=50 사격', '(1D100<=50) 보너스, 페널티 주사위[0] ＞ 37 ＞ 37 ＞ 보통 성공').tier, 'regular');
assert.equal(parseRoll('CCB<=55 目星', '(1D100<=55) ＞ 23 ＞ 成功').tier, 'success');
assert.equal(parseRoll('CCB<=55 目星', '(1D100<=55) ＞ 99 ＞ 致命的失敗').tier, 'fumble');
assert.equal(tierOf('イクストリーム成功'), 'extreme');

// 이름이 앞에 온 경우
assert.equal(parseRoll('민첩성 CC<=80', '(1D100<=80) ＞ 12 ＞ 성공').label, '민첩성');

// 단순 굴림·고르기
r = parseRoll('1d3', '(1D3) ＞ 3');
assert.equal(r.kind, 'dice');
assert.equal(r.value, '3');
r = parseRoll('5*3D6', '(5*3D6) ＞ 5*9[2,5,2] ＞ 45');
assert.equal(r.kind, 'dice');
assert.equal(r.value, '45');
assert.deepEqual(r.dice, [2, 5, 2]);
r = parseRoll('2D6+3 피해', '(2D6+3) ＞ 7[3,4]+3 ＞ 10');
assert.equal(r.label, '피해');
assert.equal(r.value, '10');
r = parseRoll('choice 죽인다 살린다', '(choice 죽인다 살린다) ＞ 죽인다');
assert.equal(r.kind, 'choice');
assert.equal(r.value, '죽인다');
// 선택지에 「성공」이 들어가도 판정으로 오인하지 않는다
assert.equal(parseRoll('choice 성공 실패', '(choice 성공 실패) ＞ 실패').kind, 'choice');

assert.equal(parseRoll('그냥 말', '안녕하세요'), null);

// 본문에 붙은 판정 (옛 코코포리아)
assert.deepEqual(
  splitInlineRoll('CC<=55  이성 (1D100<=55) 보너스, 페널티 주사위[0] ＞ 90 ＞ 90 ＞ 실패'),
  ['CC<=55  이성', '(1D100<=55) 보너스, 페널티 주사위[0] ＞ 90 ＞ 90 ＞ 실패'],
);
assert.equal(splitInlineRoll('CC(1)<=80 민첩 (1D100<=80) 보너스, 페널티 주사위[1] ＞ 3, 50 ＞ 3 ＞ 극단적 성공')[0], 'CC(1)<=80 민첩');
assert.equal(splitInlineRoll('(웃는다) 그래요'), null);

/* ---------- 로그 읽기 ---------- */
const v2 = `<!DOCTYPE html><html><head><title>t</title><style>
.avatar-image-0 { background-image: url("data:image/png;base64,AAA"); }
</style></head><body><main class="message-list"><h1 class="log-title">[테스트] 세션 [메인]</h1>
<article class="message" data-channel="main"><span class="avatar avatar-image-0" aria-hidden="true"></span>
<div class="message-content"><div class="message-header"><span class="speaker" style="--speaker-color:#3f51b5">벽람</span>
<time class="timestamp" datetime="2026-10-17T05:39:31.803Z">…</time></div>
<div class="message-text">CC&lt;=80  민첩성</div>
<span class="roll-result failure">(1D100&lt;=80) 보너스, 페널티 주사위[0] ＞ 88 ＞ 88 ＞ 실패</span></div></article>
<article class="message system" data-channel="main"><div class="message-text">&lt;生計無策&gt;</div></article>
<article class="message" data-channel="other"><span class="avatar-spacer" aria-hidden="true"></span>
<div class="message-content"><div class="message-header"><span class="speaker" style="--speaker-color:#888888">홍이경</span>
<span class="channel-name">[잡담]</span></div><div class="message-text">퍽
줄바꿈</div></div></article>
</main></body></html>`;
let log = parseLog(v2, 'x.html');
assert.equal(log.format, 'ccfolia');
assert.equal(log.title, '[테스트] 세션 [메인]');
assert.equal(log.messages.length, 3);
assert.equal(log.messages[0].speaker, '벽람');
assert.equal(log.messages[0].color, '#3f51b5');
assert.equal(log.messages[0].avatar, 0);
assert.equal(log.messages[0].roll.label, '민첩성');
assert.equal(log.messages[0].roll.tier, 'failure');
assert.equal(log.messages[1].system, true);
assert.equal(log.messages[1].text, '<生計無策>');
assert.equal(log.messages[2].channelName, '잡담');
assert.equal(log.messages[2].text, '퍽\n줄바꿈');
assert.equal(log.avatars[0], 'data:image/png;base64,AAA');
assert.deepEqual(log.channels.map(c => c.id), ['main', 'other']);

const classic = `<html><head><title>ccfolia - logs</title></head><body>
<p style="color:#ba3b2f;">
  <span> [main]</span>
  <span>하규서</span> :
  <span>
    CC&lt;=55  이성 (1D100&lt;=55) 보너스, 페널티 주사위[0] ＞ 90 ＞ 90 ＞ 실패
  </span>
</p>
<p style="color:#888888;">
  <span> [main]</span>
  <span>GM</span> :
  <span>
    평화로운 어느 가을날<br>둘째 줄
  </span>
</p></body></html>`;
log = parseLog(classic, '바이올렛[main].html');
assert.equal(log.format, 'ccfolia-classic');
assert.equal(log.title, '바이올렛[main]');
assert.equal(log.messages.length, 2);
assert.equal(log.messages[0].roll.label, '이성');
assert.equal(log.messages[0].text, 'CC<=55  이성');
assert.equal(log.messages[1].text, '평화로운 어느 가을날\n둘째 줄');

log = parseLog('[main] GM : 시작합니다\n이어지는 줄\n[main] 벽람 : CC<=50 듣기 (1D100<=50) ＞ 12 ＞ 성공', 'a.txt');
assert.equal(log.format, 'text');
assert.equal(log.messages.length, 2);
assert.equal(log.messages[0].text, '시작합니다\n이어지는 줄');
assert.equal(log.messages[1].roll.tier, 'success');

assert.equal(pickDefaultFile(['a[메인].html', 'a[すべて].html'], [1, 2]), 1);
assert.equal(pickDefaultFile(['a[잡담].html', 'a[메인].html'], [9, 1]), 1);

/* ---------- 내보내기 ---------- */
log = parseLog(v2, 'x.html');
const html = buildLogHtml(log, { title: '세션 <제목>', channels: ['main', 'other'], showTime: true, showAvatar: true,
  hideEmpty: true, group: true, theme: 'dark', rollsOnly: false, expandRolls: false, hiddenSpeakers: [] });
assert.ok(html.startsWith('<!DOCTYPE html>'));
assert.ok(html.includes('세션 &lt;제목&gt;'), '제목은 이스케이프');
assert.ok(html.includes('<details class="roll'), '판정은 접히는 카드');
assert.ok(html.includes('민첩성'));
assert.ok(html.includes('실패'));
assert.ok(!html.includes('페널티 1'), '페널티 0이면 표시하지 않음');
assert.ok(html.includes('data:image/png;base64,AAA'));
assert.ok(!/<script/i.test(html), '내보낸 로그에는 스크립트가 없다');
const noAvatar = buildLogHtml(log, { title: 't', channels: ['main'], showTime: false, showAvatar: false,
  hideEmpty: true, group: true, theme: 'light', rollsOnly: false, expandRolls: true, hiddenSpeakers: [] });
assert.ok(!noAvatar.includes('base64,AAA'));
assert.ok(!noAvatar.includes('홍이경'), '고르지 않은 채널은 빠진다');
assert.ok(noAvatar.includes('<details class="roll') && noAvatar.includes(' open>'), '펼친 채로 내보내기');
const pen = parseLog(v2.replace('주사위[0] ＞ 88 ＞', '주사위[-1] ＞ 88, 34 ＞'), 'x.html');
assert.ok(buildLogHtml(pen, { title: 't', channels: ['main'], showTime: false, showAvatar: false, hideEmpty: true,
  group: true, theme: 'dark', rollsOnly: true, expandRolls: false, hiddenSpeakers: [] }).includes('페널티 1'));

const st = rollStats(parseLog(v2, 'x.html').messages);
assert.equal(st.total, 1);
assert.equal(st.bySpeaker[0].speaker, '벽람');
assert.equal(st.bySpeaker[0].fail, 1);

/* ---------- 실제 로그 (인자로 준 파일) ---------- */
for (const f of process.argv.slice(2)) {
  const t0 = Date.now();
  const p = parseLog(fs.readFileSync(f, 'utf8'), path.basename(f));
  const rolls = p.messages.filter(m => m.roll);
  const checks = rolls.filter(m => m.roll.kind === 'check');
  const unnamed = checks.filter(m => !m.roll.label);
  const tiers = {};
  checks.forEach(m => { tiers[m.roll.tier] = (tiers[m.roll.tier] || 0) + 1; });
  console.log(`${path.basename(f)} — ${p.format} · 메시지 ${p.messages.length} · 판정 ${checks.length} · 굴림 ${rolls.length - checks.length} · 이름 없는 판정 ${unnamed.length} · ${Date.now() - t0}ms`);
  console.log('  결과:', JSON.stringify(tiers), '채널:', p.channels.map(c => `${c.name}(${c.count})`).join(' '));
  const out = buildLogHtml(p, { title: p.title, channels: p.channels.map(c => c.id), showTime: true, showAvatar: true,
    hideEmpty: true, group: true, theme: 'dark', rollsOnly: false, expandRolls: false, hiddenSpeakers: [] });
  console.log(`  내보내기 ${(out.length / 1024).toFixed(0)}KB`);
  unnamed.slice(0, 3).forEach(m => console.log('  이름 없음:', m.roll.command, '|', m.roll.result));
}

console.log('log-editor: all tests passed');
