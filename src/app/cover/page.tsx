'use client';
// 플레이리스트 커버 메이커 (/cover) — 초대 코드제 하위 도구.
// 사진·가사·노래로 커버를 만들고 PNG/MP4/GIF로 내보낸다. 파일은 브라우저 밖으로 나가지 않는다.
import { CoverGate } from '@/components/cover/CoverGate';
import { CoverStudio } from '@/components/cover/CoverStudio';

export default function CoverPage() {
  return (
    <CoverGate>
      <CoverStudio />
    </CoverGate>
  );
}
