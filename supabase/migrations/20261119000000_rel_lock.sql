-- ============================================================
-- O.HOME 업데이트 — 비공개(잠금) 자관 (Supabase 판)
-- Supabase → SQL Editor 에 붙여넣고 [Run]. 여러 번 실행해도 안전합니다.
-- 기존 테이블·데이터는 건드리지 않습니다 (새 테이블 2개 + 함수만 추가).
--
--   rel_secrets       잠금 자관의 내용 + 비밀번호 검증값(salt + 반복 SHA-256). 행은 늘 'private' —
--                     공통 RLS로 관리자·작성자만 직접 읽는다. 공개 목록(relations)에는 커버·제목만 남는다.
--   rel_unlock_tries  비밀번호 대입 늦추기용 실패 기록 — 정책 없음(= 클라이언트 접근 불가),
--                     아래 security definer 함수만 쓴다.
--   unlock_relation() 비밀번호를 DB 안에서 확인하고, 맞을 때만 내용과 답변을 돌려준다.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ── 1. 잠금 자관 내용 (다른 콘텐츠 테이블과 같은 모양·같은 정책) ──
create table if not exists public.rel_secrets (
  id          text primary key,
  data        jsonb not null default '{}'::jsonb,
  author_id   uuid references auth.users(id) on delete set null,
  visibility  text not null default 'private',
  sort        double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.rel_secrets add column if not exists editor_ids text[] not null default '{}'::text[];
alter table public.rel_secrets enable row level security;
create index if not exists rel_secrets_sort_idx on public.rel_secrets (sort);

drop policy if exists "read" on public.rel_secrets;
create policy "read" on public.rel_secrets for select using (
  visibility = 'public'
  or (visibility = 'member' and auth.uid() is not null)
  or author_id = auth.uid()
  or public.is_admin()
);
drop policy if exists "insert" on public.rel_secrets;
create policy "insert" on public.rel_secrets for insert to authenticated with check (true);
drop policy if exists "update" on public.rel_secrets;
create policy "update" on public.rel_secrets for update to authenticated
  using (author_id = auth.uid() or public.is_admin() or auth.uid()::text = any(editor_ids));
drop policy if exists "delete" on public.rel_secrets;
create policy "delete" on public.rel_secrets for delete to authenticated
  using (author_id = auth.uid() or public.is_admin() or auth.uid()::text = any(editor_ids));

-- ── 2. 실패 기록 (정책 없음 = anon/authenticated 접근 불가) ──
create table if not exists public.rel_unlock_tries (
  key    text primary key,
  fails  int not null default 0,
  since  timestamptz not null default now()
);
alter table public.rel_unlock_tries enable row level security;
revoke all on public.rel_unlock_tries from anon, authenticated;

-- ── 3. 검증값 계산 — src/lib/relLockHash.ts 와 같은 계산 ──
--   h1 = sha256hex(salt || ':' || trim(pw)),  hN = sha256hex(salt || hN-1)
create or replace function public.rel_lock_hash(p_pw text, p_salt text, p_iter int)
returns text language plpgsql immutable set search_path = public, extensions as $$
declare h text; i int; n int := greatest(1, least(200000, coalesce(p_iter, 1)));
begin
  h := encode(digest(p_salt || ':' || btrim(p_pw), 'sha256'), 'hex');
  for i in 2..n loop
    h := encode(digest(p_salt || h, 'sha256'), 'hex');
  end loop;
  return h;
end $$;
revoke all on function public.rel_lock_hash(text, text, int) from public, anon, authenticated;

-- ── 4. 잠금 자관 열기 ──
-- 오류는 raise 하지 않고 {error, status}로 돌려준다 — raise 하면 실패 기록(update)까지 되돌려져
-- 대입 제한이 동작하지 않는다.
create or replace function public.unlock_relation(p_id text, p_password text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  pub   public.relations%rowtype;
  sec   public.rel_secrets%rowtype;
  who   text;
  k     text;
  t     public.rel_unlock_tries%rowtype;
  ans   jsonb;
begin
  if p_id is null or p_password is null or btrim(p_password) = '' or length(p_password) > 200 then
    return jsonb_build_object('error', '비밀번호를 입력해 주세요', 'status', 400);
  end if;

  who := coalesce(auth.uid()::text,
    split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1),
    '');
  k := encode(digest(who || '|' || p_id, 'sha256'), 'hex');
  select * into t from public.rel_unlock_tries where key = k;
  if found and t.since > now() - interval '15 minutes' and t.fails >= 8 then
    return jsonb_build_object('error', '비밀번호를 너무 많이 틀렸습니다 — 잠시 뒤 다시 시도해 주세요', 'status', 429);
  end if;

  select * into pub from public.relations where id = p_id;
  if not found then
    return jsonb_build_object('error', '자관을 찾을 수 없습니다', 'status', 404);
  end if;
  if coalesce((pub.data ->> 'locked')::boolean, false) is not true then
    return jsonb_build_object('error', '잠긴 자관이 아닙니다', 'status', 400);
  end if;
  if pub.visibility = 'private' then
    return jsonb_build_object('error', '열람 권한이 없습니다', 'status', 403);
  end if;
  if pub.visibility = 'member' and auth.uid() is null then
    return jsonb_build_object('error', '멤버공개 자관입니다 — 로그인한 뒤 열 수 있습니다', 'status', 401);
  end if;

  select * into sec from public.rel_secrets where id = p_id;
  if not found or sec.data -> 'rel' is null or coalesce(sec.data ->> 'lockHash', '') = '' then
    return jsonb_build_object('error', '잠금 정보를 찾을 수 없습니다', 'status', 404);
  end if;

  if public.rel_lock_hash(p_password, sec.data ->> 'lockSalt', coalesce((sec.data ->> 'lockIter')::int, 1))
     is distinct from sec.data ->> 'lockHash' then
    insert into public.rel_unlock_tries as x (key, fails, since) values (k, 1, now())
      on conflict (key) do update set
        fails = case when x.since > now() - interval '15 minutes' then x.fails + 1 else 1 end,
        since = case when x.since > now() - interval '15 minutes' then x.since else now() end;
    return jsonb_build_object('error', '비밀번호가 올바르지 않습니다', 'status', 401);
  end if;

  delete from public.rel_unlock_tries where key = k;
  select coalesce(jsonb_agg(q.data || jsonb_build_object('id', q.id)), '[]'::jsonb) into ans
    from public.qa_answers q where q.data ->> 'relId' = p_id;
  return jsonb_build_object('rel', (sec.data -> 'rel') || jsonb_build_object('id', p_id), 'answers', ans);
end $$;
revoke all on function public.unlock_relation(text, text) from public;
grant execute on function public.unlock_relation(text, text) to anon, authenticated;

-- ── 5. 스키마 캐시 갱신 ──
notify pgrst, 'reload schema';
