-- Execute este script no SQL Editor do Supabase.
-- Objetivo: permitir que qualquer pessoa no site registre o responsável do turno,
-- incluindo sessões anônimas criadas pelo frontend.

begin;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.shift_responsibles to anon, authenticated;

alter table public.shift_responsibles enable row level security;

drop policy if exists shift_responsibles_select_public on public.shift_responsibles;
create policy shift_responsibles_select_public
on public.shift_responsibles
for select
to anon, authenticated
using (true);

drop policy if exists shift_responsibles_insert_public on public.shift_responsibles;
create policy shift_responsibles_insert_public
on public.shift_responsibles
for insert
to anon, authenticated
with check (true);

drop policy if exists shift_responsibles_update_public on public.shift_responsibles;
create policy shift_responsibles_update_public
on public.shift_responsibles
for update
to anon, authenticated
using (true)
with check (true);

commit;

-- Se o frontend estiver usando signInAnonymously(), confirme tambem no painel do Supabase:
-- Authentication > Providers > Anonymous Sign-Ins > Enabled.