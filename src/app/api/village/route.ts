// 마을(웹게임) API — 모든 방 데이터는 이 서버 경로를 거쳐서만 오간다 (src/lib/village/firebase.ts)
import { handleVillage } from '@/lib/village/firebase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = handleVillage;
