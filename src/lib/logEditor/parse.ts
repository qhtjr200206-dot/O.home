// 로그 편집기 — 세션 로그 파일 읽기.
//
// 지원 형식
//  · 코코포리아 새 내보내기: <article class="message" data-channel="main"> … (zip 안의 [메인]/[すべて] 등)
//    아바타는 <style>의 .avatar-image-N { background-image:url("data:…") } 로 들어 있다
//  · 코코포리아 옛 내보내기: <p style="color:#…"><span> [main]</span><span>이름</span> :<span>본문</span></p>
//    판정 결과가 본문 한 줄에 같이 붙어 있다 (splitInlineRoll)
//  · 일반 텍스트: [main] 이름 : 본문
//
// DOMParser 대신 정규식으로 읽는다 — 몇 MB짜리 로그도 빠르고, Node 테스트에서도 그대로 돈다.
// 이 파일은 같은 폴더의 dice.ts만 import한다.
import { parseRoll, splitInlineRoll, type RollInfo } from './dice';

export interface LogMessage {
  id: number;
  channel: string;
  /** 채널 표시 이름 ([잡담] → 잡담). main은 「메인」 */
  channelName: string;
  speaker: string;
  color: string;
  /** 아바타 번호 (ParsedLog.avatars의 키) */
  avatar?: number;
  /** ISO 시각 */
  time?: string;
  /** 시스템 메시지 (화자 없이 가운데에 뜨는 줄) */
  system: boolean;
  text: string;
  roll?: RollInfo;
}

export interface ParsedLog {
  title: string;
  format: 'ccfolia' | 'ccfolia-classic' | 'text';
  messages: LogMessage[];
  /** 아바타 번호 → data: URL */
  avatars: Record<number, string>;
  channels: { id: string; name: string; count: number }[];
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*|#39);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENT[e.toLowerCase()] ?? all;
  });
}

/** 태그를 걷어 낸 본문 — <br>은 줄바꿈으로 */
export function htmlToText(s: string): string {
  return decodeEntities(s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
}

const CHANNEL_NAMES: Record<string, string> = { main: '메인', other: '잡담', info: '정보' };

function finish(title: string, format: ParsedLog['format'], messages: LogMessage[], avatars: Record<number, string>): ParsedLog {
  const map = new Map<string, { id: string; name: string; count: number }>();
  for (const m of messages) {
    const c = map.get(m.channel) ?? { id: m.channel, name: m.channelName, count: 0 };
    c.count++;
    map.set(m.channel, c);
  }
  const channels = [...map.values()].sort((a, b) => (a.id === 'main' ? -1 : b.id === 'main' ? 1 : b.count - a.count));
  return { title, format, messages, avatars, channels };
}

/** 채널 id → 이름. 로그가 붙여 둔 이름([잡담])이 있으면 그것을 기억해 둔다 */
function channelNamer() {
  const known = new Map<string, string>();
  return (id: string, label?: string) => {
    if (label) known.set(id, label);
    return known.get(id) ?? CHANNEL_NAMES[id] ?? id;
  };
}

function parseCcfolia(html: string): ParsedLog {
  const title = htmlToText(/<h1 class="log-title">([\s\S]*?)<\/h1>/.exec(html)?.[1]
    ?? /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? '').trim();
  const avatars: Record<number, string> = {};
  for (const m of html.matchAll(/\.avatar-image-(\d+)\s*\{\s*background-image:\s*url\("?(data:[^")]+)"?\)/g)) {
    avatars[Number(m[1])] = m[2];
  }
  const nameOf = channelNamer();
  const messages: LogMessage[] = [];
  for (const m of html.matchAll(/<article class="message([^"]*)"([^>]*)>([\s\S]*?)<\/article>/g)) {
    const cls = m[1];
    const channel = /data-channel="([^"]*)"/.exec(m[2])?.[1] ?? 'main';
    const body = m[3];
    const sp = /<span class="speaker"(?: style="--speaker-color:([^";]*)")?>([\s\S]*?)<\/span>/.exec(body);
    const text = htmlToText(/<div class="message-text">([\s\S]*?)<\/div>/.exec(body)?.[1] ?? '');
    const rr = /<span class="roll-result([^"]*)">([\s\S]*?)<\/span>/.exec(body);
    const av = /avatar-image-(\d+)/.exec(body);
    const cn = /<span class="channel-name">\[?([^<\]]*)\]?<\/span>/.exec(body);
    const msg: LogMessage = {
      id: messages.length,
      channel, channelName: nameOf(channel, cn ? decodeEntities(cn[1]).trim() : undefined),
      speaker: sp ? htmlToText(sp[2]).trim() : '',
      color: sp?.[1]?.trim() || '#888888',
      avatar: av ? Number(av[1]) : undefined,
      time: /<time[^>]*datetime="([^"]*)"/.exec(body)?.[1],
      system: /\bsystem\b/.test(cls),
      text,
    };
    if (rr) {
      const roll = parseRoll(text, htmlToText(rr[2]), rr[1].trim());
      if (roll) { msg.roll = roll; }
      else msg.text = `${text}\n${htmlToText(rr[2])}`.trim();
    }
    messages.push(msg);
  }
  // 채널 이름은 뒤쪽 메시지에서야 붙기도 한다 — 다 읽은 뒤 한 번 더 맞춘다
  for (const msg of messages) msg.channelName = nameOf(msg.channel);
  return finish(title, 'ccfolia', messages, avatars);
}

function parseClassic(html: string): ParsedLog {
  const title = htmlToText(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? '').replace(/^ccfolia\s*-\s*logs$/i, '').trim();
  const nameOf = channelNamer();
  const messages: LogMessage[] = [];
  const re = /<p[^>]*?(?:style="color:\s*([^;"]*);?")?[^>]*>\s*<span>\s*\[([^\]]*)\]\s*<\/span>\s*<span>([\s\S]*?)<\/span>\s*:\s*<span>([\s\S]*?)<\/span>\s*<\/p>/g;
  for (const m of html.matchAll(re)) {
    const channel = m[2].trim() || 'main';
    const raw = htmlToText(m[4]).replace(/^\s+|\s+$/g, '');
    const msg: LogMessage = {
      id: messages.length, channel, channelName: nameOf(channel),
      speaker: htmlToText(m[3]).trim(), color: (m[1] || '#888888').trim(),
      system: false, text: raw,
    };
    const split = splitInlineRoll(raw);
    if (split) {
      const roll = parseRoll(split[0], split[1]);
      if (roll) { msg.roll = roll; msg.text = split[0]; }
    }
    messages.push(msg);
  }
  return finish(title, 'ccfolia-classic', messages, {});
}

function parseText(text: string, fileTitle: string): ParsedLog {
  const nameOf = channelNamer();
  const messages: LogMessage[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*\[([^\]]+)\]\s*([^:：]{1,40}?)\s*[:：]\s?(.*)$/.exec(line);
    if (m) {
      const raw = m[3];
      const msg: LogMessage = {
        id: messages.length, channel: m[1].trim(), channelName: nameOf(m[1].trim()),
        speaker: m[2].trim(), color: '#888888', system: false, text: raw,
      };
      const split = splitInlineRoll(raw);
      if (split) {
        const roll = parseRoll(split[0], split[1]);
        if (roll) { msg.roll = roll; msg.text = split[0]; }
      }
      messages.push(msg);
    } else if (messages.length && line.trim()) {
      // 이어지는 줄 — 앞 메시지에 붙인다
      messages[messages.length - 1].text += `\n${line}`;
    }
  }
  return finish(fileTitle, 'text', messages, {});
}

/** 로그 파일 한 개 해석. 알아볼 수 없으면 메시지가 빈 결과 */
export function parseLog(content: string, fileName = ''): ParsedLog {
  const base = fileName.replace(/\.[^.]+$/, '');
  if (/<article class="message/.test(content)) {
    const p = parseCcfolia(content);
    return p.title ? p : { ...p, title: base };
  }
  if (/<p[^>]*>\s*<span>\s*\[[^\]]*\]\s*<\/span>/.test(content)) {
    const p = parseClassic(content);
    return p.title ? p : { ...p, title: base };
  }
  return parseText(/<[a-z][\s\S]*>/i.test(content) ? htmlToText(content) : content, base);
}

/** zip 안에 여러 채널 파일이 있을 때 기본으로 고를 것 — 전체([すべて]/[all]/[전체]) > 메인 > 가장 큰 것 */
export function pickDefaultFile(names: string[], sizes: number[]): number {
  const all = names.findIndex(n => /\[(すべて|all|전체)\]/i.test(n));
  if (all >= 0) return all;
  const main = names.findIndex(n => /\[(main|메인|メイン)\]/i.test(n));
  if (main >= 0) return main;
  let best = 0;
  sizes.forEach((s, i) => { if (s > sizes[best]) best = i; });
  return best;
}
