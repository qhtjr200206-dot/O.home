'use client';
// 도구 > 로그 편집기 — 세션 로그(코코포리아 zip/html)를 읽어 판정이 잘 보이는 로그로 다시 만든다.
// 파일은 브라우저 밖으로 나가지 않는다 — 읽기·변환·미리보기·내려받기 모두 이 화면 안에서 끝난다.
// 판정 해석은 src/lib/logEditor/dice.ts, 결과 HTML은 render.ts (스크립트 없는 HTML 한 장).
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { KInput, KToggle } from '@/components/ui/Kit';
import { parseLog, pickDefaultFile, type ParsedLog } from '@/lib/logEditor/parse';
import { buildLogHtml, rollStats, visibleMessages, type RenderOptions } from '@/lib/logEditor/render';
import { TIER_LABEL, isSuccessTier } from '@/lib/logEditor/dice';
import s from './logEditor.module.css';

interface SourceFile { name: string; size: number; read: () => Promise<string> }

const LOG_EXT = /\.(html?|txt|log)$/i;

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

const DEFAULT_OPTS: Omit<RenderOptions, 'title' | 'channels'> = {
  showTime: true, showAvatar: true, hideEmpty: true, group: true,
  theme: 'dark', rollsOnly: false, expandRolls: false, hiddenSpeakers: [],
};

export function LogEditor() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [fileIdx, setFileIdx] = useState(0);
  const [log, setLog] = useState<ParsedLog | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [title, setTitle] = useState('');
  const [channels, setChannels] = useState<string[]>([]);
  const [opts, setOpts] = useState(DEFAULT_OPTS);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (list: SourceFile[], idx: number) => {
    setBusy(true);
    try {
      const text = await list[idx].read();
      const p = parseLog(text, list[idx].name);
      if (!p.messages.length) { toast('이 파일에서 로그를 찾지 못했습니다 — 코코포리아 HTML 로그(zip)를 올려 주세요'); return; }
      setLog(p);
      setFileIdx(idx);
      setTitle(cleanTitle(p.title));
      // 기본은 메인 채널만 — 잡담까지 섞이면 판정 흐름이 묻힌다. 메인이 없으면 전부
      setChannels(p.channels.some(c => c.id === 'main') ? ['main'] : p.channels.map(c => c.id));
      setOpts(o => ({ ...o, hiddenSpeakers: [] }));
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

  const renderOpts: RenderOptions = useMemo(() => ({ ...opts, title: title || '세션 로그', channels }), [opts, title, channels]);
  const deferred = useDeferredValue(renderOpts);
  const html = useMemo(() => (log ? buildLogHtml(log, deferred) : ''), [log, deferred]);
  const shown = useMemo(() => (log ? visibleMessages(log, renderOpts) : []), [log, renderOpts]);
  const stats = useMemo(() => rollStats(shown), [shown]);
  const checks = useMemo(() => shown.filter(m => m.roll?.kind === 'check'), [shown]);
  const speakers = useMemo(() => {
    if (!log) return [];
    const ch = new Set(channels);
    const m = new Map<string, { name: string; color: string; count: number }>();
    for (const x of log.messages) {
      if (x.system || !ch.has(x.channel)) continue;
      const k = m.get(x.speaker) ?? { name: x.speaker, color: x.color, count: 0 };
      k.count++;
      m.set(x.speaker, k);
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [log, channels]);

  const set = <K extends keyof typeof DEFAULT_OPTS>(k: K, v: (typeof DEFAULT_OPTS)[K]) => setOpts(o => ({ ...o, [k]: v }));
  const toggleIn = (arr: string[], v: string) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  /** 미리보기에서 그 판정으로 — iframe은 스크립트 없이 같은 출처로만 열어 두어 바깥에서 스크롤한다 */
  const jumpTo = (id: number) => {
    const win = frameRef.current?.contentWindow;
    const doc = frameRef.current?.contentDocument;
    const el = doc?.getElementById(`m${id}`);
    if (!el || !win || !doc) return;
    const d = el.querySelector('details');
    if (d) d.open = true;
    // scrollIntoView는 바깥 페이지까지 같이 굴려서(사이드 목록이 밀린다) iframe 안에서만 직접 옮긴다
    const top = el.getBoundingClientRect().top + (doc.scrollingElement?.scrollTop ?? 0) - win.innerHeight / 3;
    win.scrollTo({ top, behavior: 'auto' });
    el.animate?.([{ background: 'rgba(255,200,80,.18)' }, { background: 'transparent' }], { duration: 1400 });
  };

  const fileName = `${(title || 'log').replace(/[\\/:*?"<>|]+/g, '_')}.html`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([buildLogHtml(log!, renderOpts)], { type: 'text/html;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  /* TRPG 로그 백업으로 보내기 — /trpg?import= 창을 열고, 그쪽이 준비됐다고 알리면 보낸다
     (logImport.ts의 외부 툴 연동을 그대로 쓴다 — 실제 저장은 그 창에서 관리자가 ADD를 눌러야) */
  const sendToTrpg = () => {
    const w = window.open('/trpg?import=log-editor', '_blank');
    if (!w) { toast('새 창이 차단됐습니다 — 팝업을 허용해 주세요'); return; }
    const payload = {
      type: 'ohome:import-log',
      html: buildLogHtml(log!, renderOpts),
      fileName,
      title: title || undefined,
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

  // 다른 파일을 올리면 미리보기를 맨 위로
  useEffect(() => { frameRef.current?.contentWindow?.scrollTo(0, 0); }, [log]);

  const pct = stats.total ? Math.round((stats.ok / stats.total) * 100) : 0;

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

  return (
    <div className={s.studio}>
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
        </section>

        <section className={s.card}>
          <h3>채널</h3>
          <div className={s.chips}>
            {log.channels.map(c => (
              <button key={c.id} className={`${s.chip} ${channels.includes(c.id) ? s.on : ''}`}
                onClick={() => setChannels(ch => (ch.includes(c.id) && ch.length === 1 ? ch : toggleIn(ch, c.id)))}>
                {c.name}<em>{c.count.toLocaleString('ko-KR')}</em>
              </button>
            ))}
          </div>
          <h3 className={s.mt}>화자 <small>눌러서 숨기기</small></h3>
          <div className={s.chips}>
            {speakers.map(sp => (
              <button key={sp.name || '(이름 없음)'} className={`${s.chip} ${opts.hiddenSpeakers.includes(sp.name) ? s.off : s.on}`}
                onClick={() => set('hiddenSpeakers', toggleIn(opts.hiddenSpeakers, sp.name))}>
                <i style={{ background: sp.color }} />{nameOf(sp.name)}<em>{sp.count}</em>
              </button>
            ))}
          </div>
        </section>

        <section className={s.card}>
          <h3>보기</h3>
          <div className={s.seg}>
            {(['dark', 'light'] as const).map(t => (
              <button key={t} className={opts.theme === t ? s.on : ''} onClick={() => set('theme', t)}>
                {t === 'dark' ? '다크' : '라이트'}
              </button>
            ))}
          </div>
          <div className={s.toggles}>
            <KToggle label="판정·굴림만 보기" checked={opts.rollsOnly} onChange={v => set('rollsOnly', v)} />
            <KToggle label="판정 펼쳐 두기" checked={opts.expandRolls} onChange={v => set('expandRolls', v)} />
            <KToggle label="같은 화자 묶기" checked={opts.group} onChange={v => set('group', v)} />
            <KToggle label="아바타" checked={opts.showAvatar} onChange={v => set('showAvatar', v)} />
            <KToggle label="시각" checked={opts.showTime} onChange={v => set('showTime', v)} />
            <KToggle label="빈 메시지 숨기기" checked={opts.hideEmpty} onChange={v => set('hideEmpty', v)} />
          </div>
        </section>

        <section className={s.card}>
          <h3>내보내기</h3>
          <div className={s.actions}>
            <button className="btn btn-dark" onClick={download}>HTML 내려받기</button>
            {isAdmin && <button className="btn btn-ghost" onClick={sendToTrpg} title="로그 백업의 등록 창을 열어 이 로그를 채워 둡니다">로그 백업에 등록</button>}
          </div>
          <p className={s.note}>스크립트 없는 HTML 한 장입니다. 판정은 눌러서 펼칩니다.</p>
        </section>
      </aside>

      {/* ---------- 가운데: 미리보기 ---------- */}
      <div className={s.previewWrap}>
        <div className={s.previewBar}>
          <span>미리보기</span>
          <span className={s.dim}>메시지 {shown.length.toLocaleString('ko-KR')}</span>
        </div>
        {/* 스크립트 없이 같은 출처로만 — 바깥(판정 목록)에서 스크롤·펼치기를 할 수 있게. 내용은 전부 이스케이프돼 있다 */}
        <iframe ref={frameRef} className={s.preview} sandbox="allow-same-origin" srcDoc={html} title="로그 미리보기" />
      </div>

      {/* ---------- 오른쪽: 판정 ---------- */}
      <aside className={s.rolls}>
        <section className={s.card}>
          <h3>판정 {stats.total}</h3>
          {stats.total ? (
            <>
              <div className={s.rate}>
                <div className={s.rateBar}><span style={{ width: `${pct}%` }} /></div>
                <div className={s.rateNum}><b>{pct}%</b> 성공 · {stats.ok} / {stats.fail}
                  {stats.crit ? <em className={s.crit}> 대성공 {stats.crit}</em> : null}
                  {stats.fumble ? <em className={s.fum}> 대실패 {stats.fumble}</em> : null}</div>
              </div>
              <div className={s.who}>
                {stats.bySpeaker.map(b => (
                  <div key={b.speaker} className={s.whoRow}>
                    <i style={{ background: b.color }} /><span>{nameOf(b.speaker)}</span>
                    <b>{b.ok}<small>/{b.total}</small></b>
                  </div>
                ))}
              </div>
            </>
          ) : <p className={s.note}>판정이 없습니다</p>}
        </section>
        <div className={s.rollList}>
          {checks.map(m => {
            const r = m.roll!;
            const ok = isSuccessTier(r.tier);
            return (
              <button key={m.id} className={`${s.rollItem} ${ok ? s.ok : s.ng} ${r.tier === 'critical' ? s.critItem : ''} ${r.tier === 'fumble' ? s.fumItem : ''}`}
                onClick={() => jumpTo(m.id)} title={`${r.command}\n${r.result}`}>
                <span className={s.riName}>{r.label || '판정'}</span>
                {r.bonus !== 0 && <span className={r.bonus > 0 ? s.riBon : s.riPen}>{r.bonus > 0 ? `보너스 ${r.bonus}` : `페널티 ${-r.bonus}`}</span>}
                <span className={s.riOut}>{TIER_LABEL[r.tier ?? 'failure']}</span>
                <span className={s.riWho}>{m.speaker.trim()}</span>
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
