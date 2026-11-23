'use client';
// 도구 > 로그 편집기 (/tools/log-editor) — 코코포리아 로그의 판정을 보기 좋게 정리해 내보낸다.
// 화면은 src/components/logEditor/LogEditor.tsx, 해석·변환은 src/lib/logEditor/.
import { PageTitle, EditableDesc } from '@/components/ui/PageText';
import { LogEditor } from '@/components/logEditor/LogEditor';

export default function LogEditorPage() {
  return (
    <section className="page" style={{ maxWidth: 1480 }}>
      <div className="page-head">
        <PageTitle>LOG EDITOR</PageTitle>
        <EditableDesc k="log-editor-desc" def="세션 로그의 판정을 한눈에 — 판정 이름 · 보너스/페널티 · 결과, 누르면 펼쳐 보기" />
      </div>
      <LogEditor />
    </section>
  );
}
