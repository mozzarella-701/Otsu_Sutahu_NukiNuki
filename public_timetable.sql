-- 公開時刻表データ保存用（Supabase SQL Editorで1回実行）
create table if not exists public.public_timetable (
  id integer primary key default 1 check (id = 1),
  source_filename text not null,
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id),
  data jsonb not null
);

alter table public.public_timetable enable row level security;

drop policy if exists "approved users can read public timetable" on public.public_timetable;
create policy "approved users can read public timetable"
on public.public_timetable for select
to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.approved = true and p.disabled = false
));

drop policy if exists "admins can insert public timetable" on public.public_timetable;
create policy "admins can insert public timetable"
on public.public_timetable for insert
to authenticated
with check (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'admin' and p.approved = true and p.disabled = false
));

drop policy if exists "admins can update public timetable" on public.public_timetable;
create policy "admins can update public timetable"
on public.public_timetable for update
to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'admin' and p.approved = true and p.disabled = false
))
with check (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'admin' and p.approved = true and p.disabled = false
));
