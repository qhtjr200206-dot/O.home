'use client';
// 도구 > 로그 편집기 — 세션 로그(코코포리아 zip/html)를 읽어 판정이 잘 보이는 로그로 다시 만든다.
// 파일은 브라우저 밖으로 나가지 않는다 — 읽기·변환·인장 교체·미리보기·내려받기 모두 이 화면 안에서 끝난다.
// 판정 해석은 src/lib/logEditor/dice.ts, 결과 HTML은 render.ts, 인장 줄이기는 images.ts.
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { KInput, KSelect, KToggle } from '@/components/ui/Kit';
import { ColorField } from '@/components/ui/ColorField';
import { useFonts, fontCssUrl } from '@/lib/fontStore';
import { parseLog, pickDefaultFile, type ParsedLog } from '@/lib/logEditor/parse';
import { buildLogHtml, rollStats, visibleMessages, type RenderOptions, type SpeakerStyle } from '@/lib/logEditor/render';
import {
  AVATAR_PRESETS, PRESET_ORDER, byteSize, fmtBytes, shrinkAll, shrinkImage, type AvatarPreset,
} from '@/lib/logEditor/images';
import s from './logEditor.module.css';

interface SourceFile { name: string; size: number; read: () => Promise<string> }

const LOG_EXT = /\.(html?|txt|log)$/i;
/** 내보내기 용량 목표 (사용자 요청 — 2MB 이하) */
const SIZE_LIMIT = 2 * 1024 * 1024;

/** zip이면 안의 로그 파일들, 아니면 그 파일 하나 */
async function openFiles(file: File): Promise<SourceFile[]> {
  if (/\.zip$/i.test(file.name) || file.type.includes('zip')) {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(file);
    const out: SourceFile[] = [];
    zip.forEach((path, entry) => {
      if (entry.dir || !LOG_EXT.test(path) || path.startsWith('__MACOSX')) return;
      const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
      out.push({ name: path.split('/').pop() ?? path, size, read: () => entry.async('string') });
    });
    return out;
  }
  return [{ name: file.name, size: file.size, read: () => file.text() }];
}

/** 화자 이름 — 공백·한글 채움 문자(ㅤ)만 있는 이름은 「이름 없음」 */
const nameOf = (n: string) => (n.replace(/[\s\u3164\u200b]/g, '') ? n.trim() : '(이름 없음)');

/** 화면에 보일 제목 — 끝의 채널 표시([메인]·[すべて])는 뗀다 */
const cleanTitle = (t: string) => t.replace(/\s*\[[^\]]*\]\s*$/, '').trim() || t;

/** 이름만 보고 GM일 것 같은 화자 */
const looksGm = (n: string) => /^(gm|kp|keeper|진행|게임\s*마스터|키퍼)$/i.test(n.trim());

/** 편집기에서 다루는 화자 설정 — 폰트는 id로 들고 있다가 내보낼 때 family·CSS 주소로 푼다 */
type SpeakerEdit = Omit<SpeakerStyle, 'font'> & { fontId?: string };

interface ViewOpts {
  showTime: boolean; showAvatar: boolean; hideEmpty: boolean; group: boolean;
  theme: 'dark' | 'light'; rollsOnly: boolean; expandRolls: boolean; gmAsSystem: boolean;
}
const DEFAULT_VIEW: ViewOpts = {
  showTime: true, showAvatar: true, hideEmpty: true, group: true,
  theme: 'dark', rollsOnly: false, expandRolls: false, gmAsSystem: false,
};

/** 이 로그에 대해 고친 내용 — 같은 로그를 다시 열면 이어서 (이 브라우저에만) */
interface Saved {
  channels?: string[]; view?: ViewOpts; hidden?: string[]; speakers?: Record<string, SpeakerEdit>;
  replaced?: Record<number, string>; preset?: AvatarPreset; fit?: boolean; title?: string;
}
const saveKey = (t: string) => `ohome.logeditor.v1:${t}`;

/** 내보낼 수 있는 폰트 — HTML에 <link>로 실을 수 있는 것만 (업로드한 폰트 파일은 HTML 밖이라 빠진다) */
interface ExportFont { id: string; name: string; family: string; css: string }
const PRETENDARD_CSS = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css';

export function LogEditor() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const { fonts } = useFonts();
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [fileIdx, setFileIdx] = useState(0);
  const [log, setLog] = useState<ParsedLog | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [title, setTitle] = useState('');
  const [channels, setChannels] = useState<string[]>([]);
  const [view, setView] = useState(DEFAULT_VIEW);
  const [hidden, setHidden] = useState<string[]>([]);
  const [speakers, setSpeakers] = useState<Record<string, SpeakerEdit>>({});
  const [replaced, setReplaced] = useState<Record<number, string>>({});
  const [preset, setPreset] = useState<AvatarPreset>('normal');
  const [fit, setFit] = useState(true);
  const [avatars, setAvatars] = useState<Record<number, string> | null>(null);
  const [openSp, setOpenSp] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const swapRef = useRef<HTMLInputElement>(null);
  const swapIdx = useRef<number | null>(null);

  const exportFonts: ExportFont[] = useMemo(() => {
    const out: ExportFont[] = [];
    for (const f of fonts) {
      if (f.id === 'default') out.push({ id: f.id, name: '기본 (프리텐다드)', family: '"Pretendard Variable", Pretendard, sans-serif', css: PRETENDARD_CSS });
      else if (f.id === 'serif') out.push({ id: f.id, name: '기본 세리프 (Noto Serif KR)', family: '"Noto Serif KR", serif', css: 'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;700&display=swap' });
      else {
        const css = fontCssUrl(f);
        if (css && /^https:\/\//.test(css)) out.push({ id: f.id, name: f.name, family: f.family, css });
      }
    }
    return out;
  }, [fonts]);

  const load = useCallback(async (list: SourceFile[], idx: number) => {
    setBusy(true);
    try {
      const text = await list[idx].read();
      const p = parseLog(text, list[idx].name);
      if (!p.messages.length) { toast('이 파일에서 로그를 찾지 못했습니다 — 코코포리아 HTML 로그(zip)를 올려 주세요'); return; }
      let saved: Saved = {};
      try { saved = JSON.parse(localStorage.getItem(saveKey(p.title)) || '{}') as Saved; } catch { /* 없음 */ }
      const ids = new Set(p.channels.map(c => c.id));
      setLog(p);
      setFileIdx(idx);
      setTitle(saved.title ?? cleanTitle(p.title));
      // 기본은 메인 채널만 — 잡담까지 섞이면 판정 흐름이 묻힌다. 메인이 없으면 전부
      const ch = saved.channels?.filter(c => ids.has(c));
      setChannels(ch?.length ? ch : p.channels.some(c => c.id === 'main') ? ['main'] : p.channels.map(c => c.id));
      setView({ ...DEFAULT_VIEW, ...saved.view });
      setHidden(saved.hidden ?? []);
      const sp: Record<string, SpeakerEdit> = { ...saved.speakers };
      if (!saved.speakers) for (const m of p.messages) if (looksGm(m.speaker)) sp[m.speaker] = { ...sp[m.speaker], gm: true };
      setSpeakers(sp);
      setReplaced(saved.replaced ?? {});
      setPreset(saved.preset ?? 'normal');
      setFit(saved.fit ?? true);
      setOpenSp(null);
    } catch {
      toast('파일을 읽지 못했습니다');
    } finally { setBusy(false); }
  }, [toast]);

  const onFile = async (file?: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const list = await openFiles(file);
      if (!list.length) { toast('zip 안에 로그 파일(.html)이 없습니다'); setBusy(false); return; }
      setFiles(list);
      await load(list, pickDefaultFile(list.map(f => f.name), list.map(f => f.size)));
    } catch {
      toast('파일을 열지 못했습니다'); setBusy(false);
    }
  };

  // 고친 내용 저장 (이 브라우저에만) — 교체한 인장도 줄인 상태라 작다. 가득 차면 인장만 빼고
  useEffect(() => {
    if (!log) return;
    const t = setTimeout(() => {
      const data: Saved = { channels, view, hidden, speakers, replaced, preset, fit, title };
      try { localStorage.setItem(saveKey(log.title), JSON.stringify(data)); }
      catch {
        try { localStorage.setItem(saveKey(log.title), JSON.stringify({ ...data, replaced: {} })); } catch { /* 무시 */ }
      }
    }, 400);
    return () => clearTimeout(t);
  }, [log, channels, view, hidden, speakers, replaced, preset, fit, title]);

  /** 인장 원본 — 교체한 사진이 있으면 그것 */
  const avatarSources = useMemo(() => {
    if (!log) return {} as Record<number, string>;
    return { ...log.avatars, ...replaced };
  }, [log, replaced]);

  // 고른 화질로 인장을 줄여 둔다 (미리보기·용량 계산 모두 이것으로)
  useEffect(() => {
    let alive = true;
    setAvatars(null);
    const p = AVATAR_PRESETS[preset];
    shrinkAll(avatarSources, p.size, p.quality).then(a => { if (alive) setAvatars(a); });
    return () => { alive = false; };
  }, [avatarSources, preset]);

  const fontById = useMemo(() => new Map(exportFonts.map(f => [f.id, f])), [exportFonts]);
  const renderOpts = useCallback((av: Record<number, string> | null): RenderOptions => {
    const styles: Record<string, SpeakerStyle> = {};
    const links = new Set<string>();
    for (const [name, sp] of Object.entries(speakers)) {
      const f = sp.fontId ? fontById.get(sp.fontId) : undefined;
      if (f) links.add(f.css);
      styles[name] = { color: sp.color, bg: sp.bg, gm: sp.gm, font: f?.family };
    }
    return {
      ...view, title: title || '세션 로그', channels, hiddenSpeakers: hidden,
      speakers: styles, avatars: av ?? log?.avatars, fontLinks: [...links],
    };
  }, [view, title, channels, hidden, speakers, fontById, log]);

  const opts = useMemo(() => renderOpts(avatars), [renderOpts, avatars]);
  const deferred = useDeferredValue(opts);
  const html = useMemo(() => (log ? buildLogHtml(log, deferred) : ''), [log, deferred]);
  const size = useMemo(() => (html ? byteSize(html) : 0), [html]);
  const shown = useMemo(() => (log ? visibleMessages(log, opts) : []), [log, opts]);
  const stats = useMemo(() => rollStats(shown), [shown]);

  /** 화자 목록 — 고른 채널에서 말한 사람, 많이 말한 순. 그 사람이 쓴 인장 번호도 */
  const people = useMemo(() => {
    if (!log) return [];
    const ch = new Set(channels);
    const m = new Map<string, { name: string; color: string; count: number; av: Map<number, number> }>();
    for (const x of log.messages) {
      if (x.system || !ch.has(x.channel)) continue;
      const k = m.get(x.speaker) ?? { name: x.speaker, color: x.color, count: 0, av: new Map() };
      k.count++;
      if (x.avatar !== undefined && log.avatars[x.avatar]) k.av.set(x.avatar, (k.av.get(x.avatar) ?? 0) + 1);
      m.set(x.speaker, k);
    }
    return [...m.values()].sort((a, b) => b.count - a.count)
      .map(p => ({ ...p, avatars: [...p.av.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i) }))
      // 이름이 비어 보이는 화자가 여럿이면(공백 · ㅤ 등) 번호로 구분한다
      .map((p, _, all) => {
        const label = nameOf(p.name);
        const same = all.filter(q => nameOf(q.name) === label);
        return { ...p, label: same.length > 1 ? `${label} ${same.indexOf(p) + 1}` : label };
      });
  }, [log, channels]);

  const setV = <K extends keyof ViewOpts>(k: K, v: ViewOpts[K]) => setView(o => ({ ...o, [k]: v }));
  const setSp = (name: string, patch: Partial<SpeakerEdit>) =>
    setSpeakers(all => ({ ...all, [name]: { ...all[name], ...patch } }));
  const toggleIn = (arr: string[], v: string) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  const hasGm = Object.values(speakers).some(x => x.gm);

  /* ---------- 인장 교체 ---------- */
  const pickSwap = (idx: number) => { swapIdx.current = idx; swapRef.current?.click(); };
  const onSwap = async (file?: File | null) => {
    const idx = swapIdx.current;
    if (!file || idx === null) return;
    if (!file.type.startsWith('image/')) { toast('이미지 파일을 골라 주세요'); return; }
    try {
      // 보관은 넉넉한 크기로 — 실제 내보내기 크기는 화질 단계가 정한다
      const url = await shrinkImage(file, 256, 0.92);
      setReplaced(r => ({ ...r, [idx]: url }));
    } catch { toast('이미지를 읽지 못했습니다'); }
    if (swapRef.current) swapRef.current.value = '';
  };

  /* ---------- 내보내기 ---------- */
  const fileName = `${(title || 'log').replace(/[\\/:*?"<>|]+/g, '_')}.html`;
  /** 내보낼 HTML — 「2MB 이하로 맞추기」가 켜져 있으면 인장 화질을 한 단계씩 낮춰 본다 */
  const buildForExport = async (): Promise<{ html: string; preset: AvatarPreset }> => {
    const first = avatars ?? await shrinkAll(avatarSources, AVATAR_PRESETS[preset].size, AVATAR_PRESETS[preset].quality);
    let cur = preset;
    let out = buildLogHtml(log!, renderOpts(first));
    if (!fit || byteSize(out) <= SIZE_LIMIT || !view.showAvatar) return { html: out, preset: cur };
    for (const p of PRESET_ORDER.slice(PRESET_ORDER.indexOf(preset) + 1)) {
      const av = await shrinkAll(avatarSources, AVATAR_PRESETS[p].size, AVATAR_PRESETS[p].quality);
      out = buildLogHtml(log!, renderOpts(av));
      cur = p;
      if (byteSize(out) <= SIZE_LIMIT) break;
    }
    return { html: out, preset: cur };
  };
  const reportSize = (out: string, used: AvatarPreset) => {
    const n = byteSize(out);
    if (fit && n > SIZE_LIMIT) toast(`${fmtBytes(n)} — 대화가 많아 2MB를 넘습니다. 채널을 줄이거나 빈 메시지를 숨겨 보세요`);
    else if (used !== preset) toast(`${fmtBytes(n)} — 2MB에 맞추려고 인장을 「${AVATAR_PRESETS[used].label}」 화질로 줄였습니다`);
    else toast(`${fmtBytes(n)}로 내보냈습니다`);
  };

  const download = async () => {
    setExporting(true);
    try {
      const { html: out, preset: used } = await buildForExport();
      const url = URL.createObjectURL(new Blob([out], { type: 'text/html;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = fileName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      reportSize(out, used);
    } finally { setExporting(false); }
  };

  /* TRPG 로그 백업으로 보내기 — /trpg?import= 창을 열고, 그쪽이 준비됐다고 알리면 보낸다
     (logImport.ts의 외부 툴 연동을 그대로 쓴다 — 실제 저장은 그 창에서 관리자가 ADD를 눌러야) */
  const sendToTrpg = async () => {
    const w = window.open('/trpg?import=log-editor', '_blank');
    if (!w) { toast('새 창이 차단됐습니다 — 팝업을 허용해 주세요'); return; }
    setExporting(true);
    const { html: out, preset: used } = await buildForExport().finally(() => setExporting(false));
    reportSize(out, used);
    const payload = {
      type: 'ohome:import-log', html: out, fileName, title: title || undefined,
      date: log!.messages.find(m => m.time)?.time?.slice(0, 10),
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== w || e.origin !== window.location.origin) return;
      const t = (e.data as { type?: string } | null)?.type;
      if (t === 'ohome:import-ready') w.postMessage(payload, window.location.origin);
      if (t === 'ohome:import-ok') window.removeEventListener('message', onMsg);
    };
    window.addEventListener('message', onMsg);
    setTimeout(() => window.removeEventListener('message', onMsg), 120_000);
  };

  if (!log) {
    return (
      <div
        className={`${s.drop} ${drag ? s.dragOn : ''}`}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files[0]); }}
        onClick={() => inputRef.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
      >
        <input ref={inputRef} type="file" accept=".zip,.html,.htm,.txt" hidden onChange={e => onFile(e.target.files?.[0])} />
        <div className={s.dropIc}>{busy ? <span className={s.spin} /> : '⇪'}</div>
        <b>{busy ? '읽는 중…' : '로그 파일을 끌어다 놓거나 눌러서 고르세요'}</b>
        <p>코코포리아 HTML 로그 · zip 그대로 · 옛 코코포리아 로그 · 텍스트 로그</p>
        <div className={s.dropDemo} aria-hidden="true">
          <span className={s.demoNm}>민첩성</span><span className={s.demoPen}>페널티 1</span>
          <span className={s.demoOut}>실패</span><span className={s.demoNum}>88/80</span>
        </div>
        <small>판정은 「이름 · 보너스/페널티 · 결과」만 먼저 보이고, 누르면 목표치와 굴린 값이 펼쳐집니다.
          파일은 이 브라우저 밖으로 나가지 않습니다.</small>
      </div>
    );
  }

  const fontOptions = [{ value: '', label: '기본' }, ...exportFonts.map(f => ({ value: f.id, label: f.name }))];
  const avUrl = (i: number) => avatars?.[i] ?? avatarSources[i];

  return (
    <div className={s.studio}>
      <input ref={swapRef} type="file" accept="image/*" hidden onChange={e => onSwap(e.target.files?.[0])} />
      {/* ---------- 왼쪽: 설정 ---------- */}
      <aside className={s.side}>
        <section className={s.card}>
          <div className={s.cardHead}>
            <h3>파일</h3>
            <button className={s.link} onClick={() => { setLog(null); setFiles([]); }}>다른 파일</button>
          </div>
          {files.length > 1 && (
            <div className={s.files}>
              {files.map((f, i) => (
                <button key={f.name} className={`${s.fileBtn} ${i === fileIdx ? s.on : ''}`} onClick={() => load(files, i)} disabled={busy}
                  title={f.name}>
                  {/\[([^\]]+)\]\.[a-z]+$/i.exec(f.name)?.[1] ?? f.name}
                </button>
              ))}
            </div>
          )}
          <label className={s.lb}>제목</label>
          <KInput value={title} onChange={e => setTitle(e.target.value)} placeholder="세션 로그" />
          <label className={s.lb}>채널</label>
          <div className={s.chips}>
            {log.channels.map(c => (
              <button key={c.id} className={`${s.chip} ${channels.includes(c.id) ? s.on : ''}`}
                onClick={() => setChannels(ch => (ch.includes(c.id) && ch.length === 1 ? ch : toggleIn(ch, c.id)))}>
                {c.name}<em>{c.count.toLocaleString('ko-KR')}</em>
              </button>
            ))}
          </div>
        </section>

        <section className={s.card}>
          <h3>화자 <small>눌러서 꾸미기</small></h3>
          <div className={s.people}>
            {people.map(p => {
              const sp = speakers[p.name] ?? {};
              const off = hidden.includes(p.name);
              const open = openSp === p.name;
              const sample = log.messages.find(m => m.speaker === p.name && !m.roll && m.text.trim())?.text.slice(0, 40) ?? '대사 미리보기';
              return (
                <div key={p.name || '_'} className={`${s.person} ${open ? s.open : ''} ${off ? s.off : ''}`}>
                  <button className={s.personRow} onClick={() => setOpenSp(open ? null : p.name)}>
                    {p.avatars[0] !== undefined
                      ? <span className={s.pAv} style={{ backgroundImage: `url("${avUrl(p.avatars[0])}")` }} />
                      : <span className={s.pDot} style={{ background: p.color }} />}
                    <span className={s.pName}>{p.label}</span>
                    {sp.gm && <span className={s.gmTag}>GM</span>}
                    {(sp.color || sp.bg || sp.fontId) && <span className={s.styled} title="꾸밈 있음" />}
                    <em>{p.count.toLocaleString('ko-KR')}</em>
                    <span className={s.caret} />
                  </button>
                  {open && (
                    <div className={s.personEdit}>
                      <div className={s.pills}>
                        <button className={sp.gm ? s.on : ''} onClick={() => setSp(p.name, { gm: !sp.gm })}>GM</button>
                        <button className={off ? s.on : ''} onClick={() => setHidden(h => toggleIn(h, p.name))}>숨기기</button>
                      </div>
                      {/* 말풍선 미리보기 — 고른 글자색·배경·폰트가 바로 보이게 */}
                      <div className={`${s.bubblePrev} ${view.theme === 'light' ? s.light : ''}`}>
                        <span style={{
                          color: sp.color || undefined, background: sp.bg || undefined,
                          fontFamily: sp.fontId ? fontById.get(sp.fontId)?.family : undefined,
                          padding: sp.bg ? '5px 11px' : undefined,
                        }}>{sample}</span>
                      </div>
                      <div className={s.field}>
                        <span>글자색</span>
                        <ColorField value={sp.color || (view.theme === 'dark' ? '#e9eaee' : '#1f2126')} onChange={v => setSp(p.name, { color: v })} />
                        {sp.color && <button className={s.reset} onClick={() => setSp(p.name, { color: undefined })}>기본</button>}
                      </div>
                      <div className={s.field}>
                        <span>배경색</span>
                        <ColorField value={sp.bg || (view.theme === 'dark' ? '#2a2d33' : '#ffffff')} onChange={v => setSp(p.name, { bg: v })} />
                        {sp.bg && <button className={s.reset} onClick={() => setSp(p.name, { bg: undefined })}>없음</button>}
                      </div>
                      <div className={s.field}>
                        <span>폰트</span>
                        <KSelect options={fontOptions} value={sp.fontId ?? ''} onChange={v => setSp(p.name, { fontId: v || undefined })} minWidth={150} />
                      </div>
                      {p.avatars.length > 0 && (
                        <>
                          <div className={s.subLb}>인장 <small>눌러서 사진으로 바꾸기</small></div>
                          <div className={s.avGrid}>
                            {p.avatars.map(i => (
                              <div key={i} className={`${s.avCell} ${replaced[i] ? s.swapped : ''}`}>
                                <button className={s.avBtn} onClick={() => pickSwap(i)} title="사진으로 바꾸기"
                                  style={{ backgroundImage: `url("${avUrl(i)}")` }} />
                                {replaced[i] && (
                                  <button className={s.avReset} title="원래 인장으로"
                                    onClick={() => setReplaced(r => { const n = { ...r }; delete n[i]; return n; })}>×</button>
                                )}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className={s.card}>
          <h3>보기</h3>
          <div className={s.seg}>
            {(['dark', 'light'] as const).map(t => (
              <button key={t} className={view.theme === t ? s.on : ''} onClick={() => setV('theme', t)}>
                {t === 'dark' ? '다크' : '라이트'}
              </button>
            ))}
          </div>
          <div className={s.toggles}>
            <KToggle label="판정·굴림만 보기" checked={view.rollsOnly} onChange={v => setV('rollsOnly', v)} />
            <KToggle label="판정 펼쳐 두기" checked={view.expandRolls} onChange={v => setV('expandRolls', v)} />
            <KToggle label="GM을 시스템 메시지처럼" checked={view.gmAsSystem} onChange={v => setV('gmAsSystem', v)} />
            {view.gmAsSystem && !hasGm && <p className={s.warn}>화자 목록에서 GM을 먼저 지정해 주세요</p>}
            <KToggle label="같은 화자 묶기" checked={view.group} onChange={v => setV('group', v)} />
            <KToggle label="인장" checked={view.showAvatar} onChange={v => setV('showAvatar', v)} />
            <KToggle label="시각" checked={view.showTime} onChange={v => setV('showTime', v)} />
            <KToggle label="빈 메시지 숨기기" checked={view.hideEmpty} onChange={v => setV('hideEmpty', v)} />
          </div>
        </section>

        <section className={s.card}>
          <h3>내보내기</h3>
          <label className={s.lb}>인장 화질</label>
          <div className={s.seg4}>
            {PRESET_ORDER.map(p => (
              <button key={p} className={preset === p ? s.on : ''} onClick={() => setPreset(p)}
                title={`${AVATAR_PRESETS[p].size}px`}>{AVATAR_PRESETS[p].label}</button>
            ))}
          </div>
          <div className={s.toggles} style={{ marginTop: 10 }}>
            <KToggle label="2MB 이하로 맞추기" checked={fit} onChange={setFit} />
          </div>
          <div className={s.sizeRow}>
            <span>예상 용량</span>
            <b className={size > SIZE_LIMIT ? s.over : ''}>{avatars ? fmtBytes(size) : '계산 중…'}</b>
          </div>
          <div className={s.sizeBar}><span style={{ width: `${Math.min(100, (size / SIZE_LIMIT) * 100)}%` }} className={size > SIZE_LIMIT ? s.over : ''} /></div>
          {size > SIZE_LIMIT && fit && <p className={s.note}>내보낼 때 인장 화질을 낮춰 맞춥니다. 그래도 넘으면 채널을 줄여 주세요.</p>}
          <div className={s.actions}>
            <button className="btn btn-dark" onClick={download} disabled={exporting || !avatars}>{exporting ? '만드는 중…' : 'HTML 내려받기'}</button>
            {isAdmin && <button className="btn btn-ghost" onClick={sendToTrpg} disabled={exporting || !avatars} title="로그 백업의 등록 창을 열어 이 로그를 채워 둡니다">로그 백업에 등록</button>}
          </div>
          <p className={s.note}>스크립트 없는 HTML 한 장 · 인장은 파일 안에 들어가고 서버에는 올라가지 않습니다.</p>
        </section>
      </aside>

      {/* ---------- 미리보기 ---------- */}
      <div className={s.previewWrap}>
        <div className={s.previewBar}>
          <span>미리보기</span>
          <span className={s.dim}>
            메시지 {shown.length.toLocaleString('ko-KR')}
            {stats.total ? <> · 판정 {stats.total} · <i className={s.okTxt}>성공 {stats.ok}</i> · <i className={s.ngTxt}>실패 {stats.fail}</i></> : null}
          </span>
        </div>
        {/* 스크립트 없는 HTML — 내용은 전부 이스케이프돼 있다 */}
        <iframe className={s.preview} sandbox="allow-same-origin" srcDoc={html} title="로그 미리보기" />
      </div>
    </div>
  );
}
