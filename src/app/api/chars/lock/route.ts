import { characterLockHandlers } from '@/lib/characterLockFirebase';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = characterLockHandlers.lock;
