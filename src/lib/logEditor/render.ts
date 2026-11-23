// 로그 편집기 — 보기 좋은 로그 HTML 만들기.
//
// 결과물은 스크립트 없는 HTML 한 장이다 — 내려받아 그대로 열어도, TRPG 로그 백업에 올려도
// (샌드박스 iframe) 똑같이 보인다. 판정은 <details>로 접었다 펼친다(스크립트 없이 동작).
//
// 판정 카드 (사용자 요청 — 「중요한 건 판정 결과」):
//   접힌 상태  ●  민첩성   [페널티 1]                 실패   88/80
//   펼친 상태  목표치·어려움·극단 / 굴린 주사위 / 1~100 막대 위 위치 / 원문
// 판정 이름 · 보너스/페널티(0이면 숨김) · 결과가 가장 먼저 눈에 들어오게 한다.
//
// 이 파일은 같은 폴더의 dice.ts·parse.ts(타입)만 import한다 — Node 테스트에서 그대로 돈다.
import { TIER_LABEL, isSuccessTier, type RollInfo, type RollTier } from './dice';
import type { LogMessage, ParsedLog } from './parse';

export interface RenderOptions {
  title: string;
  /** 보여 줄 채널 id */
  channels: string[];
  showTime: boolean;
  showAvatar: boolean;
  /** 내용 없는 메시지(빈 줄·이름표만 있는 것) 숨김 */
  hideEmpty: boolean;
  /** 같은 화자가 이어 말하면 이름·아바타를 한 번만 */
  group: boolean;
  theme: 'dark' | 'light';
  /** 판정·굴림만 */
  rollsOnly: boolean;
  /** 판정 카드를 펼친 채로 */
  expandRolls: boolean;
  hiddenSpeakers: string[];
}

export const esc = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** CSS 색 값으로 안전한 것만 (style 속성에 넣으므로) */
const safeColor = (c: string) => (/^#[0-9a-f]{3,8}$|^rgba?\([\d\s.,%]+\)$/i.test(c.trim()) ? c.trim() : '#888888');

/** 표시할 메시지 고르기 — 편집기 화면의 통계도 같은 기준을 쓴다 */
export function visibleMessages(log: ParsedLog, o: Pick<RenderOptions, 'channels' | 'hideEmpty' | 'rollsOnly' | 'hiddenSpeakers'>): LogMessage[] {
  const ch = new Set(o.channels);
  const hidden = new Set(o.hiddenSpeakers);
  return log.messages.filter(m => ch.has(m.channel)
    && !hidden.has(m.speaker)
    && (!o.rollsOnly || !!m.roll)
    && (!o.hideEmpty || !!m.roll || m.text.trim() !== ''));
}

const TIER_ICON: Record<RollTier, string> = {
  critical: '✦', extreme: '◆', hard: '◆', regular: '●', success: '●', failure: '✕', fumble: '✖',
};

function fmtTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 보너스/페널티 뱃지 — 0이면 아무것도 */
function bonusBadge(n: number): string {
  if (!n) return '';
  return n > 0
    ? `<span class="bp bonus">보너스 ${n}</span>`
    : `<span class="bp penalty">페널티 ${-n}</span>`;
}

/** 1~100 막대 — 목표치 기준 극단(1/5)·어려움(1/2)·보통 구간 위에 굴린 값 표시 */
function rollBar(r: RollInfo): string {
  const t = r.target;
  const v = Number(r.value);
  if (!t || !Number.isFinite(v) || t <= 0 || t > 100 || v < 1 || v > 100) return '';
  const pct = (n: number) => `${Math.max(0, Math.min(100, n)).toFixed(2)}%`;
  const ex = Math.floor(t / 5);
  const hd = Math.floor(t / 2);
  const others = r.dice.filter((d, i) => !(d === v && r.dice.indexOf(v) === i) && d >= 1 && d <= 100);
  return `<div class="bar" aria-hidden="true">
<span class="z ex" style="width:${pct(ex)}"></span><span class="z hd" style="left:${pct(ex)};width:${pct(hd - ex)}"></span><span class="z rg" style="left:${pct(hd)};width:${pct(t - hd)}"></span>
${others.map(d => `<i class="ghost" style="left:${pct(d - 0.5)}"></i>`).join('')}<i class="mark" style="left:${pct(v - 0.5)}"><b>${v}</b></i>
</div><div class="bar-scale"><span>1</span><span style="left:${pct(ex)}">${ex}</span><span style="left:${pct(hd)}">${hd}</span><span style="left:${pct(t)}">${t}</span><span class="end">100</span></div>`;
}

function rollCard(r: RollInfo, open: boolean): string {
  const o = open ? ' open' : '';
  if (r.kind === 'choice') {
    return `<details class="roll choice"${o}><summary><span class="ic">⇄</span><span class="nm">선택</span><span class="out">${esc(r.value)}</span><span class="cv"></span></summary>
<div class="rb"><div class="row"><span class="k">선택지</span><span class="v">${esc(r.expr)}</span></div><div class="raw">${esc(r.command)}<br>${esc(r.result)}</div></div></details>`;
  }
  if (r.kind === 'dice') {
    return `<details class="roll dice"${o}><summary><span class="ic">⚄</span><span class="nm">${esc(r.label || r.expr)}</span>${bonusBadge(r.bonus)}<span class="out">${esc(r.value)}</span><span class="cv"></span></summary>
<div class="rb"><div class="row"><span class="k">식</span><span class="v mono">${esc(r.expr)}</span></div>${r.outcome ? `<div class="row"><span class="k">계산</span><span class="v mono">${esc(r.outcome)}</span></div>` : ''}<div class="raw">${esc(r.command)}<br>${esc(r.result)}</div></div></details>`;
  }
  const tier = r.tier ?? 'failure';
  const ok = isSuccessTier(tier);
  const name = r.label || '판정';
  const t = r.target;
  const thresholds = t ? `<div class="th"><span><em>목표</em>${t}</span><span><em>어려움</em>${Math.floor(t / 2)}</span><span><em>극단</em>${Math.floor(t / 5)}</span></div>` : '';
  const dice = r.dice.length > 1
    ? `<div class="row"><span class="k">굴림</span><span class="v">${r.dice.map(d => `<span class="die${String(d) === r.value || Number(d) === Number(r.value) ? ' used' : ''}">${d}</span>`).join('')}<small>${r.bonus > 0 ? '보너스 — 낮은 값 채택' : '페널티 — 높은 값 채택'}</small></span></div>`
    : '';
  return `<details class="roll check t-${tier} ${ok ? 'ok' : 'ng'}"${o}><summary><span class="ic">${TIER_ICON[tier]}</span><span class="nm">${esc(name)}</span>${bonusBadge(r.bonus)}<span class="out">${esc(TIER_LABEL[tier])}</span><span class="num">${esc(r.value)}${t ? `<small>/${t}</small>` : ''}</span><span class="cv"></span></summary>
<div class="rb">${thresholds}${rollBar(r)}${dice}<div class="raw">${esc(r.command)}<br>${esc(r.result)}</div></div></details>`;
}

const CSS = `
:root{--bg:#111214;--bg2:#17181b;--card:#1c1e22;--line:rgba(255,255,255,.07);--line2:rgba(255,255,255,.13);--ink:#e9eaee;--sub:#a3a6ad;--faint:#6d7078;
--ok:#5aa9ff;--ok-bg:rgba(90,169,255,.12);--crit:#f0c25a;--crit-bg:rgba(240,194,90,.14);--ng:#ef5d70;--ng-bg:rgba(239,93,112,.11);--fum:#ff3b5c;--fum-bg:rgba(255,59,92,.18);
--pen:#ff9d5c;--pen-bg:rgba(255,157,92,.14);--bon:#4fd1a5;--bon-bg:rgba(79,209,165,.14);--sys:#8d9099}
.light{--bg:#f6f5f2;--bg2:#efede8;--card:#fff;--line:rgba(0,0,0,.07);--line2:rgba(0,0,0,.14);--ink:#1f2126;--sub:#5d6168;--faint:#9a9da4;
--ok:#1f6fd1;--ok-bg:rgba(31,111,209,.09);--crit:#b07d0a;--crit-bg:rgba(214,160,30,.14);--ng:#c8364b;--ng-bg:rgba(200,54,75,.08);--fum:#b3132f;--fum-bg:rgba(179,19,47,.12);
--pen:#c2600f;--pen-bg:rgba(194,96,15,.1);--bon:#0f8a63;--bon-bg:rgba(15,138,99,.1);--sys:#7b7f87}
*{box-sizing:border-box;margin:0;padding:0}
html{background:var(--bg)}
body{background:var(--bg);color:var(--ink);font:15px/1.7 Pretendard,"Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;letter-spacing:-.005em;-webkit-font-smoothing:antialiased}
.wrap{max-width:860px;margin:0 auto;padding:44px 22px 80px}
header.lh{margin-bottom:28px;padding-bottom:22px;border-bottom:1px solid var(--line2)}
.lh h1{font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1.35}
.lh .meta{margin-top:8px;color:var(--faint);font-size:12.5px;display:flex;flex-wrap:wrap;gap:6px 14px}
.lh .tally{margin-top:14px;display:flex;flex-wrap:wrap;gap:6px}
.lh .tally span{font-size:12px;padding:3px 10px;border-radius:99px;background:var(--bg2);color:var(--sub);border:1px solid var(--line)}
.lh .tally b{font-weight:700;margin-left:4px}
.msg{display:grid;grid-template-columns:40px minmax(0,1fr);column-gap:13px;padding:7px 0}
.msg.first{padding-top:16px}
.msg.noav{grid-template-columns:minmax(0,1fr)}
.av{width:40px;height:40px;border-radius:11px;background:var(--bg2) center/cover no-repeat;box-shadow:inset 0 0 0 1px var(--line)}
.av.sp{background:none;box-shadow:none;height:0}
.hd{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:1px}
.who{font-weight:700;font-size:14px;color:var(--c)}
.tm{color:var(--faint);font-size:11.5px}
.chn{font-size:10.5px;color:var(--sub);border:1px solid var(--line2);border-radius:5px;padding:0 6px;line-height:17px}
.tx{white-space:pre-wrap;overflow-wrap:anywhere}
.cmd{color:var(--faint);font-size:12.5px;white-space:pre-wrap}
.sys{margin:18px 0;padding:12px 16px;text-align:center;color:var(--sys);white-space:pre-wrap;font-size:14px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.sys+.sys{margin-top:-19px;border-top:0}
/* ---- 판정 카드 ---- */
.roll{margin:5px 0 3px;border-radius:12px;background:var(--card);border:1px solid var(--line2);overflow:hidden;max-width:560px}
.roll summary{list-style:none;display:flex;align-items:center;gap:9px;padding:9px 12px 9px 11px;cursor:pointer;user-select:none}
.roll summary::-webkit-details-marker{display:none}
.roll .ic{width:26px;height:26px;flex:none;border-radius:8px;display:grid;place-items:center;font-size:12px;background:var(--bg2);color:var(--sub)}
.roll .nm{font-weight:700;font-size:14.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bp{flex:none;font-size:11.5px;font-weight:700;padding:1px 8px;border-radius:99px;line-height:19px}
.bp.penalty{color:var(--pen);background:var(--pen-bg)}
.bp.bonus{color:var(--bon);background:var(--bon-bg)}
.roll .out{margin-left:auto;flex:none;font-weight:800;font-size:14.5px;letter-spacing:-.01em}
.roll .num{flex:none;color:var(--faint);font-size:12px;font-variant-numeric:tabular-nums;min-width:44px;text-align:right}
.roll .num small{font-size:11px;opacity:.75}
.roll .cv{flex:none;width:8px;height:8px;border-right:1.6px solid var(--faint);border-bottom:1.6px solid var(--faint);transform:rotate(45deg) translateY(-2px);transition:transform .18s;margin-left:2px}
.roll[open] .cv{transform:rotate(225deg) translate(-2px,0)}
.roll.ok{border-color:color-mix(in srgb,var(--ok) 35%,transparent)}
.roll.ok .ic{background:var(--ok-bg);color:var(--ok)} .roll.ok .out{color:var(--ok)}
.roll.t-critical{border-color:color-mix(in srgb,var(--crit) 55%,transparent);background:linear-gradient(90deg,var(--crit-bg),var(--card) 60%)}
.roll.t-critical .ic{background:var(--crit-bg);color:var(--crit)} .roll.t-critical .out{color:var(--crit)}
.roll.t-extreme .out,.roll.t-hard .out{text-shadow:0 0 18px color-mix(in srgb,var(--ok) 45%,transparent)}
.roll.ng{border-color:color-mix(in srgb,var(--ng) 30%,transparent)}
.roll.ng .ic{background:var(--ng-bg);color:var(--ng)} .roll.ng .out{color:var(--ng)}
.roll.t-fumble{border-color:color-mix(in srgb,var(--fum) 60%,transparent);background:linear-gradient(90deg,var(--fum-bg),var(--card) 60%)}
.roll.t-fumble .ic{background:var(--fum);color:#fff} .roll.t-fumble .out{color:var(--fum)}
.roll.dice .out,.roll.choice .out{color:var(--ink);font-weight:800}
.rb{padding:4px 14px 14px 46px;border-top:1px dashed var(--line2);display:grid;gap:10px}
.th{display:flex;gap:16px;font-variant-numeric:tabular-nums;padding-top:8px}
.th span{font-weight:700;font-size:15px}
.th em{font-style:normal;font-weight:500;font-size:11px;color:var(--faint);margin-right:5px}
.bar{position:relative;height:10px;border-radius:99px;background:var(--bg2);margin-top:16px;box-shadow:inset 0 0 0 1px var(--line)}
.bar .z{position:absolute;top:0;bottom:0;left:0}
.bar .z.ex{background:color-mix(in srgb,var(--ok) 70%,transparent);border-radius:99px 0 0 99px}
.bar .z.hd{background:color-mix(in srgb,var(--ok) 45%,transparent)}
.bar .z.rg{background:color-mix(in srgb,var(--ok) 22%,transparent)}
.bar i{position:absolute;top:-5px;width:2px;height:20px;border-radius:2px;transform:translateX(-1px)}
.bar i.mark{background:var(--ink)}
.bar i.mark b{position:absolute;bottom:22px;left:50%;transform:translateX(-50%);font-size:11px;font-weight:800;font-style:normal;background:var(--ink);color:var(--bg);padding:0 6px;border-radius:6px;line-height:17px}
.bar i.ghost{background:var(--faint);opacity:.55}
.bar-scale{position:relative;height:14px;font-size:10px;color:var(--faint);font-variant-numeric:tabular-nums}
.bar-scale span{position:absolute;transform:translateX(-50%)}
.bar-scale span:first-child{transform:none}
.bar-scale .end{right:0;transform:none}
.row{display:flex;gap:12px;align-items:baseline}
.row .k{flex:none;width:44px;font-size:11px;color:var(--faint)}
.row .v{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.row small{color:var(--faint);font-size:11px;margin-left:4px}
.mono,.raw{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.die{min-width:30px;text-align:center;padding:1px 6px;border-radius:7px;border:1px solid var(--line2);color:var(--faint);font-variant-numeric:tabular-nums;text-decoration:line-through}
.die.used{color:var(--ink);text-decoration:none;font-weight:800;border-color:var(--ink)}
.raw{font-size:11.5px;color:var(--faint);line-height:1.6;overflow-wrap:anywhere;background:var(--bg2);border-radius:8px;padding:8px 10px}
footer{margin-top:48px;color:var(--faint);font-size:11px;text-align:center}
@media (max-width:560px){.wrap{padding:28px 14px 60px}.msg{grid-template-columns:32px minmax(0,1fr);column-gap:10px}.av{width:32px;height:32px;border-radius:9px}.rb{padding-left:14px}.roll .num{display:none}}
`;

export interface RollStats {
  total: number;
  ok: number;
  fail: number;
  crit: number;
  fumble: number;
  bySpeaker: { speaker: string; color: string; total: number; ok: number; fail: number; crit: number; fumble: number }[];
}

export function rollStats(messages: LogMessage[]): RollStats {
  const st: RollStats = { total: 0, ok: 0, fail: 0, crit: 0, fumble: 0, bySpeaker: [] };
  const by = new Map<string, RollStats['bySpeaker'][number]>();
  for (const m of messages) {
    if (m.roll?.kind !== 'check') continue;
    const t = m.roll.tier;
    const s = by.get(m.speaker) ?? { speaker: m.speaker, color: m.color, total: 0, ok: 0, fail: 0, crit: 0, fumble: 0 };
    for (const x of [st, s]) {
      x.total++;
      if (isSuccessTier(t)) x.ok++; else x.fail++;
      if (t === 'critical') x.crit++;
      if (t === 'fumble') x.fumble++;
    }
    by.set(m.speaker, s);
  }
  st.bySpeaker = [...by.values()].sort((a, b) => b.total - a.total);
  return st;
}

/** 내보낼 HTML 문서 전체 */
export function buildLogHtml(log: ParsedLog, o: RenderOptions): string {
  const msgs = visibleMessages(log, o);
  const multi = o.channels.length > 1;
  const avatarCss = o.showAvatar
    ? Object.entries(log.avatars)
      .filter(([n]) => msgs.some(m => m.avatar === Number(n)))
      .map(([n, url]) => (/^data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+$/i.test(url) ? `.a${n}{background-image:url("${url}")}` : ''))
      .join('\n')
    : '';
  const st = rollStats(msgs);
  const times = msgs.map(m => m.time).filter(Boolean) as string[];
  const span = times.length ? `${fmtTime(times[0]).slice(0, 10)} – ${fmtTime(times[times.length - 1]).slice(0, 10)}` : '';
  const out: string[] = [];
  let prev: LogMessage | null = null;
  for (const m of msgs) {
    if (m.system) {
      out.push(`<div class="sys">${esc(m.text)}</div>`);
      prev = null;
      continue;
    }
    const cont = o.group && !!prev && prev.speaker === m.speaker && prev.avatar === m.avatar && prev.channel === m.channel;
    const av = !o.showAvatar ? '' : (!cont && m.avatar !== undefined && log.avatars[m.avatar])
      ? `<span class="av a${m.avatar}"></span>` : '<span class="av sp"></span>';
    const head = cont ? '' : `<div class="hd"><span class="who" style="--c:${safeColor(m.color)}">${esc(m.speaker || '　')}</span>${multi && m.channel !== 'main' ? `<span class="chn">${esc(m.channelName)}</span>` : ''}${o.showTime && m.time ? `<span class="tm">${fmtTime(m.time)}</span>` : ''}</div>`;
    let body: string;
    if (m.roll) {
      // 판정 명령(CC<=80 민첩성)은 카드에 이름으로 들어가므로 따로 보여 주지 않는다
      body = rollCard(m.roll, o.expandRolls);
    } else body = `<div class="tx">${esc(m.text)}</div>`;
    out.push(`<div class="msg${cont ? '' : ' first'}${o.showAvatar ? '' : ' noav'}" id="m${m.id}">${av}<div>${head}${body}</div></div>`);
    prev = m;
  }
  const tally = st.total
    ? `<div class="tally"><span>판정<b>${st.total}</b></span><span>성공<b>${st.ok}</b></span><span>실패<b>${st.fail}</b></span>${st.crit ? `<span>대성공<b>${st.crit}</b></span>` : ''}${st.fumble ? `<span>대실패<b>${st.fumble}</b></span>` : ''}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="ko" class="${o.theme === 'light' ? 'light' : 'dark'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<style>${CSS}
${avatarCss}</style></head>
<body><div class="wrap">
<header class="lh"><h1>${esc(o.title)}</h1><div class="meta">${span ? `<span>${span}</span>` : ''}<span>메시지 ${msgs.length.toLocaleString('ko-KR')}</span></div>${tally}</header>
${out.join('\n')}
<footer>O.HOME 로그 편집기</footer>
</div></body></html>`;
}
