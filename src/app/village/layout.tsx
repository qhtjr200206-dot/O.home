import type { Metadata } from 'next';
import './village.css';

// 마을(웹게임) — 방 내용은 비밀번호 뒤에 있으므로 검색에 노출하지 않는다
export const metadata: Metadata = {
  title: '마을',
  robots: { index: false, follow: false },
};

export default function VillageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
