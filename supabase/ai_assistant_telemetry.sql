create table if not exists public.ai_assistant_telemetry (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  question text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  cached_tokens integer,
  tool_call_count integer not null default 0,
  response_ms integer,
  estimated_cost_usd numeric(12, 6),
  intent text
);

alter table public.ai_assistant_telemetry enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_assistant_telemetry'
      and policyname = 'ai telemetry insert own'
  ) then
    create policy "ai telemetry insert own"
    on public.ai_assistant_telemetry
    for insert
    to authenticated
    with check (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_assistant_telemetry'
      and policyname = 'ai telemetry read own'
  ) then
    create policy "ai telemetry read own"
    on public.ai_assistant_telemetry
    for select
    to authenticated
    using (auth.uid() = user_id);
  end if;
end $$;

create index if not exists ai_assistant_telemetry_created_at_idx
on public.ai_assistant_telemetry (created_at desc);

create index if not exists ai_assistant_telemetry_user_created_idx
on public.ai_assistant_telemetry (user_id, created_at desc);