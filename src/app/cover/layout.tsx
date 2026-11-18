import type { Metadata } from 'next';

// 커버 메이커 — 초대 코드제 도구라 검색에 노출하지 않는다
export const metadata: Metadata = {
  title: '커버 메이커',
  robots: { index: false, follow: false },
};

export default function CoverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
