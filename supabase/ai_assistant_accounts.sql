begin;

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

create table if not exists public.ai_credit_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  monthly_credits integer not null default 1000 check (monthly_credits >= 0),
  monthly_used integer not null default 0 check (monthly_used >= 0),
  purchased_credits integer not null default 0 check (purchased_credits >= 0),
  cycle_start date not null default date_trunc('month', current_date)::date,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,
  kind text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id)
);

create index if not exists ai_credit_transactions_user_created_idx
  on public.ai_credit_transactions (user_id, created_at desc);

alter table public.ai_user_preferences enable row level security;
alter table public.ai_credit_accounts enable row level security;
alter table public.ai_credit_transactions enable row level security;

drop policy if exists ai_preferences_own_read on public.ai_user_preferences;
create policy ai_preferences_own_read on public.ai_user_preferences
  for select to authenticated using (auth.uid() = user_id or (auth.jwt() ->> 'email') = 'nfe@savantiplasticos.com.br');

drop policy if exists ai_preferences_own_write on public.ai_user_preferences;
create policy ai_preferences_own_write on public.ai_user_preferences
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists ai_preferences_own_update on public.ai_user_preferences;
create policy ai_preferences_own_update on public.ai_user_preferences
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists ai_credit_accounts_read on public.ai_credit_accounts;
create policy ai_credit_accounts_read on public.ai_credit_accounts
  for select to authenticated using (auth.uid() = user_id or (auth.jwt() ->> 'email') = 'nfe@savantiplasticos.com.br');

drop policy if exists ai_credit_accounts_admin_update on public.ai_credit_accounts;
create policy ai_credit_accounts_admin_update on public.ai_credit_accounts
  for update to authenticated using ((auth.jwt() ->> 'email') = 'nfe@savantiplasticos.com.br')
  with check ((auth.jwt() ->> 'email') = 'nfe@savantiplasticos.com.br');

drop policy if exists ai_credit_accounts_admin_insert on public.ai_credit_accounts;
create policy ai_credit_accounts_admin_insert on public.ai_credit_accounts
  for insert to authenticated with check ((auth.jwt() ->> 'email') = 'nfe@savantiplasticos.com.br');

drop policy if exists ai_credit_transactions_read on public.ai_credit_transactions;
create policy ai_credit_transactions_read on public.ai_credit_transactions
  for select to authenticated using (auth.uid() = user_id or (auth.jwt() ->> 'email') = 'nfe@savantiplasticos.com.br');

drop policy if exists ai_credit_transactions_admin_insert on public.ai_credit_transactions;
create policy ai_credit_transactions_admin_insert on public.ai_credit_transactions
  for insert to authenticated with check ((auth.jwt() ->> 'email') = 'nfe@savantiplasticos.com.br');

drop function if exists public.consume_ai_credit(uuid);
create or replace function public.consume_ai_credit(p_user_id uuid)
returns table (
  allowed boolean,
  is_admin boolean,
  monthly_remaining integer,
  purchased_remaining integer,
  available_credits integer,
  monthly_limit integer,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  account public.ai_credit_accounts%rowtype;
  current_cycle date := date_trunc('month', current_date)::date;
  monthly_left integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not_authorized';
  end if;

  if lower(coalesce(auth.jwt() ->> 'email', '')) = 'nfe@savantiplasticos.com.br' then
    return query select true, true, 0, 0, -1, -1, 'admin_unlimited';
    return;
  end if;

  insert into public.ai_credit_accounts (user_id, email)
  values (p_user_id, coalesce(auth.jwt() ->> 'email', ''))
  on conflict (user_id) do update set email = excluded.email;

  select * into account from public.ai_credit_accounts where user_id = p_user_id for update;

  if account.cycle_start < current_cycle then
    update public.ai_credit_accounts
      set monthly_used = 0, cycle_start = current_cycle, updated_at = now()
      where user_id = p_user_id;
    account.monthly_used := 0;
    account.cycle_start := current_cycle;
  end if;

  monthly_left := greatest(0, account.monthly_credits - account.monthly_used);
  if monthly_left > 0 then
    update public.ai_credit_accounts
      set monthly_used = monthly_used + 1, updated_at = now()
      where user_id = p_user_id;
    insert into public.ai_credit_transactions (user_id, amount, kind, description)
      values (p_user_id, -1, 'monthly_usage', 'Pergunta ao Ícaro');
  elsif account.purchased_credits > 0 then
    update public.ai_credit_accounts
      set purchased_credits = purchased_credits - 1, updated_at = now()
      where user_id = p_user_id;
    insert into public.ai_credit_transactions (user_id, amount, kind, description)
      values (p_user_id, -1, 'purchased_usage', 'Pergunta ao Ícaro');
  else
    return query select false, false, 0, 0, 0, account.monthly_credits, 'credits_exhausted';
    return;
  end if;

  return query select true, false,
    greatest(0, account.monthly_credits - account.monthly_used - case when monthly_left > 0 then 1 else 0 end),
    account.purchased_credits - case when monthly_left > 0 then 0 else 1 end,
    greatest(0, account.monthly_credits - account.monthly_used - case when monthly_left > 0 then 1 else 0 end) + account.purchased_credits - case when monthly_left > 0 then 0 else 1 end,
    account.monthly_credits,
    'ok';
end;
$$;

grant execute on function public.consume_ai_credit(uuid) to authenticated;

commit;
