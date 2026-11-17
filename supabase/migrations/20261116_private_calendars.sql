-- Uni & Turni: personal state with owner-enforced RLS (Supabase).
-- Created for Authenticated accounts only. NEVER put the secret/service-role key in web files.
create table if not exists public.private_calendars (
  user_id uuid primary key references auth.users(id) on delete cascade,
  document jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  constraint private_calendars_document_object check (jsonb_typeof(document) = 'object'),
  constraint private_calendars_document_size check (octet_length(document::text) < 2097152)
);
alter table public.private_calendars enable row level security;
revoke all on table public.private_calendars from public, anon, authenticated;
grant select, insert, update, delete on table public.private_calendars to authenticated;
-- Explicit per-operation policies. auth.uid() is the authenticated JWT subject.
create policy "own calendar select" on public.private_calendars
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own calendar insert" on public.private_calendars
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own calendar update" on public.private_calendars
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "own calendar delete" on public.private_calendars
  for delete to authenticated using ((select auth.uid()) = user_id);
