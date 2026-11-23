// 로그 편집기 (도구 > 로그 편집기) — 주사위 판정 해석.
//
// 코코포리아(BCDice) 로그의 판정 한 줄을 「판정 이름 · 보너스/페널티 · 결과」로 나눈다.
// 판정에서 가장 중요한 건 결과라서(사용자 요청), 접힌 상태에서는 이 세 가지만 보여 주고
// 목표치·굴린 값·원문은 펼쳤을 때 보여 준다.
//
//   CC<=80 민첩성
//   (1D100<=80) 보너스, 페널티 주사위[0] ＞ 88 ＞ 88 ＞ 실패
//   → { label: '민첩성', bonus: 0, tier: 'failure', target: 80, dice: [88], value: '88' }
//
// 이 파일은 아무것도 import하지 않는다 — Node 테스트(scripts/log-editor.test.cjs)에서 그대로 불러 쓴다.

export type RollTier = 'critical' | 'extreme' | 'hard' | 'regular' | 'success' | 'failure' | 'fumble';

export interface RollInfo {
  /** check = 성공/실패가 있는 판정 · dice = 단순 굴림 · choice = 고르기 */
  kind: 'check' | 'dice' | 'choice';
  /** 판정 이름 (민첩성 등) — 없으면 빈 문자열 */
  label: string;
  /** 원문 명령 (CC<=80 민첩성) */
  command: string;
  /** 원문 결과 ((1D100<=80) … ＞ 실패) */
  result: string;
  /** 굴린 식 ((1D100<=80) → 1D100<=80) */
  expr: string;
  target?: number;
  /** 보너스(+)·페널티(−) 주사위 개수 — 0이면 표시하지 않는다 */
  bonus: number;
  /** 굴린 값들 (보너스·페널티 주사위가 있으면 여러 개) */
  dice: number[];
  /** 최종 값 */
  value: string;
  /** 결과 문구 원문 (실패, 어려운 성공 …) */
  outcome: string;
  tier?: RollTier;
}

/** 결과 문구 → 단계. 위에서부터 먼저 맞는 것 (「대실패」가 「실패」보다 먼저여야 한다) */
const TIERS: [RegExp, RollTier][] = [
  [/대실패|펌블|致命的失敗|ファンブル|fumble/i, 'fumble'],
  [/대성공|결정적\s*성공|크리티컬|決定的成功|クリティカル|critical/i, 'critical'],
  [/극단적\s*성공|イクストリーム成功|extreme/i, 'extreme'],
  [/어려운\s*성공|ハード成功|hard\s*success|스페셜|スペシャル|special/i, 'hard'],
  [/보통\s*성공|レギュラー成功|regular/i, 'regular'],
  [/실패|失敗|failure|fail/i, 'failure'],
  [/성공|成功|success/i, 'success'],
];

export function tierOf(text: string): RollTier | undefined {
  for (const [re, t] of TIERS) if (re.test(text)) return t;
  return undefined;
}

/** 단계 이름 (화면 표시용) */
export const TIER_LABEL: Record<RollTier, string> = {
  critical: '대성공', extreme: '극단적 성공', hard: '어려운 성공', regular: '보통 성공',
  success: '성공', failure: '실패', fumble: '대실패',
};

export const isSuccessTier = (t?: RollTier) => !!t && t !== 'failure' && t !== 'fumble';

/** BCDice 결과 구분자 — 전각 ＞ 가 기본, 일부 도구는 반각 > 나 → 를 쓴다 */
const SEP = /\s*(?:＞|→|\s>\s)\s*/;

const BONUS_RE = /(?:보너스[\s,，・·]*페널티\s*주사위|ボーナス・ペナルティダイス|bonus\s*\/?\s*penalty\s*dice)\s*\[\s*([+-]?\d+)\s*\]/i;

/** 명령의 첫 토큰이 주사위 식인지 (CC<=80, CC(1)<=80, CCB<=55, 1d100<=50, 2D6+3, CBR(70,60), SC1/1d3, choice …) */
const EXPR_TOKEN = /^(?:s?(?:cc|ccb|cbr|res|rsa|sc|choice|d66)\b|s?cc[b]?\(|s?\d*d\d+|s?\d+\*\d*d\d+|[\d(]+.*[dD]\d+)/i;

function cleanLabel(s: string): string {
  return s
    .replace(/^[\s:：·・\-–—]+|[\s:：·・\-–—]+$/g, '')
    .replace(/^[【\[「『(（]\s*(.*?)\s*[】\]」』)）]$/, '$1')
    .trim();
}

/** 명령 문자열 → [식, 판정 이름] */
function splitCommand(command: string): [string, string] {
  const tokens = command.trim().split(/\s+/);
  if (!tokens[0]) return ['', ''];
  if (EXPR_TOKEN.test(tokens[0])) {
    // choice는 뒤의 항목들이 이름이 아니라 선택지다
    if (/^s?choice/i.test(tokens[0])) return [command.trim(), ''];
    return [tokens[0], cleanLabel(tokens.slice(1).join(' '))];
  }
  // 「민첩성 CC<=80」처럼 이름이 앞에 온 경우
  const i = tokens.findIndex(t => EXPR_TOKEN.test(t));
  if (i > 0) return [tokens[i], cleanLabel([...tokens.slice(0, i), ...tokens.slice(i + 1)].join(' '))];
  return [tokens[0], cleanLabel(tokens.slice(1).join(' '))];
}

const nums = (s: string) => (s.match(/-?\d+/g) ?? []).map(Number);

/**
 * 판정 한 건 해석. 결과가 주사위 결과처럼 생기지 않았으면 null.
 * @param command 메시지 본문 (CC<=80 민첩성)
 * @param result  주사위 결과 ((1D100<=80) … ＞ 실패)
 * @param hint    로그가 붙여 둔 결과 분류(success/failure/critical/fumble) — 문구로 못 알아낼 때만 쓴다
 */
export function parseRoll(command: string, result: string, hint?: string): RollInfo | null {
  const res = result.trim();
  const m = /^\(([^()]*(?:\([^()]*\)[^()]*)*)\)([\s\S]*)$/.exec(res);
  if (!m) return null;
  const expr = m[1].trim();
  const parts = res.split(SEP).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const [cmdExpr, label] = splitCommand(command);

  // 고르기
  if (/^s?choice/i.test(expr) || /^s?choice/i.test(cmdExpr)) {
    const options = expr.replace(/^s?choice\s*/i, '').replace(/^\[|\]$/g, '');
    return {
      kind: 'choice', label: '', command: command.trim(), result: res, expr: options,
      bonus: 0, dice: [], value: parts[parts.length - 1], outcome: '',
    };
  }

  const bm = BONUS_RE.exec(res);
  let bonus = bm ? Number(bm[1]) : 0;
  if (!bm) {
    // 결과에 없으면 명령에서 — CC(1)<=80 / CC(-1)<=80
    const cm = /^s?cc[b]?\(\s*([+-]?\d+)\s*\)/i.exec(cmdExpr);
    if (cm) bonus = Number(cm[1]);
  }
  const tm = /<=\s*(\d+)/.exec(expr) ?? /<=\s*(\d+)/.exec(cmdExpr);
  const target = tm ? Number(tm[1]) : undefined;

  const last = parts[parts.length - 1];
  // 결과 문구로 먼저 판단하고, 문구가 숫자뿐일 때만 로그의 분류(hint)를 빌린다
  const tier = tierOf(last) ?? (hint && !/^[\d\s,+-]+$/.test(last) ? tierOf(hint) : undefined);

  if (tier) {
    // 판정: (식) [보너스…] ＞ 굴린 값들 ＞ 최종 값 ＞ 결과
    const middle = parts.slice(1, -1);
    const value = middle.length ? middle[middle.length - 1] : '';
    const dice = middle.length > 1 ? nums(middle[0]) : nums(value);
    return {
      kind: 'check', label, command: command.trim(), result: res, expr, target,
      bonus, dice, value, outcome: last, tier,
    };
  }

  // 단순 굴림: (2D6) ＞ 5[2,3] ＞ 5
  const value = last;
  const breakdown = parts.length > 2 ? parts[parts.length - 2] : '';
  const inner = /\[([^\]]*)\]/.exec(breakdown);
  return {
    kind: 'dice', label, command: command.trim(), result: res, expr, target,
    bonus, dice: inner ? nums(inner[1]) : [], value, outcome: breakdown,
  };
}

/**
 * 판정이 본문 한 줄에 같이 붙어 있는 로그(옛 코코포리아 내보내기)를 나눈다.
 *   "CC<=55  이성 (1D100<=55) 보너스, 페널티 주사위[0] ＞ 90 ＞ 90 ＞ 실패"
 *   → ["CC<=55  이성", "(1D100<=55) 보너스, … ＞ 실패"]
 * 결과처럼 보이는 부분이 없으면 null.
 */
export function splitInlineRoll(text: string): [string, string] | null {
  const t = text.trim();
  // 공백 뒤에 오는 「(식)」 중에서 뒤에 ＞ 가 이어지는 첫 번째 — CC(1)<=80 처럼 붙은 괄호는 제외된다
  const re = /\s(\((?:[^()]|\([^()]*\))*\))\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const rest = t.slice(m.index).trim();
    if (/＞|→/.test(rest) && /[dD]\d|choice/i.test(m[1])) return [t.slice(0, m.index).trim(), rest];
  }
  return null;
}
