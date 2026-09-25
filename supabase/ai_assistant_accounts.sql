begin;

drop function if exists public.consume_ai_credit(uuid);
drop table if exists public.ai_credit_transactions cascade;
drop table if exists public.ai_credit_accounts cascade;

create table if not exists public.ai_user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  tone_style text not null default 'padrao',
  nickname text,
  characteristics text,
  memory_enabled boolean not null default true,
  memory_summary text,
  updated_at timestamptz not null default now(),
  constraint ai_user_preferences_tone_check check (tone_style in ('padrao', 'franco', 'profissional', 'amigavel', 'diferentao', 'eficiente', 'cinico'))
);

create table if not exists public.ai_assistant_messages (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_assistant_messages_user_created_idx
  on public.ai_assistant_messages (user_id, created_at asc);

alter table public.ai_user_preferences enable row level security;
alter table public.ai_assistant_messages enable row level security;

create or replace function public.is_ai_assistant_admin()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = any (array[
    'nfe@savantiplasticos.com.br',
    'savanti@savantiplasticos.com.br',
    'suporte@savantiplasticos.com.br',
    'adm@savantiplasticos.com.br',
    'comercial@savantiplasticos.com.br'
  ]::text[]);
$$;

grant execute on function public.is_ai_assistant_admin() to authenticated;

drop policy if exists ai_preferences_own_read on public.ai_user_preferences;
create policy ai_preferences_own_read on public.ai_user_preferences
  for select to authenticated using (auth.uid() = user_id or public.is_ai_assistant_admin());

drop policy if exists ai_preferences_own_write on public.ai_user_preferences;
create policy ai_preferences_own_write on public.ai_user_preferences
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists ai_preferences_own_update on public.ai_user_preferences;
create policy ai_preferences_own_update on public.ai_user_preferences
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists ai_assistant_messages_own_read on public.ai_assistant_messages;
create policy ai_assistant_messages_own_read on public.ai_assistant_messages
  for select to authenticated using (auth.uid() = user_id and public.is_ai_assistant_admin());

drop policy if exists ai_assistant_messages_own_insert on public.ai_assistant_messages;
create policy ai_assistant_messages_own_insert on public.ai_assistant_messages
  for insert to authenticated with check (auth.uid() = user_id and public.is_ai_assistant_admin());

drop policy if exists ai_assistant_messages_own_delete on public.ai_assistant_messages;
create policy ai_assistant_messages_own_delete on public.ai_assistant_messages
  for delete to authenticated using (auth.uid() = user_id and public.is_ai_assistant_admin());

commit;
