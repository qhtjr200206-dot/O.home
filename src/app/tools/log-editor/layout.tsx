import type { Metadata } from 'next';

export const metadata: Metadata = { title: '로그 편집기' };

export default function LogEditorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
