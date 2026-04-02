-- Execute este script no SQL Editor do Supabase.
-- Objetivo: persistir as paradas programadas automáticas em tabela própria,
-- sem conflitar com a regra atual de uma parada aberta por máquina em machine_stops.

begin;

create table if not exists public.scheduled_machine_stops (
  event_key text primary key,
  machine_id text not null,
  order_id text null,
  reason text not null default 'PARADA PROGRAMADA',
  notes text null,
  started_at timestamptz not null,
  expected_end_at timestamptz not null,
  ended_at timestamptz null,
  started_by text null default 'SISTEMA',
  ended_by text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint scheduled_machine_stops_expected_end_check check (expected_end_at > started_at),
  constraint scheduled_machine_stops_ended_check check (ended_at is null or ended_at >= started_at)
);

create index if not exists scheduled_machine_stops_machine_started_idx
  on public.scheduled_machine_stops (machine_id, started_at desc);

create index if not exists scheduled_machine_stops_order_started_idx
  on public.scheduled_machine_stops (order_id, started_at desc);

create index if not exists scheduled_machine_stops_open_idx
  on public.scheduled_machine_stops (expected_end_at)
  where ended_at is null;

create or replace function public.scheduled_machine_stops_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists scheduled_machine_stops_touch_updated_at on public.scheduled_machine_stops;

create trigger scheduled_machine_stops_touch_updated_at
before update on public.scheduled_machine_stops
for each row
execute function public.scheduled_machine_stops_touch_updated_at();

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.scheduled_machine_stops to anon, authenticated;
alter table public.scheduled_machine_stops disable row level security;

commit;

-- Opcional para automação 100% no banco:
-- 1. habilite a extensão pg_cron no projeto Supabase;
-- 2. crie jobs chamando uma rotina própria de abertura/fechamento desses eventos.
-- O frontend deste repositório já faz a sincronização best-effort quando a aplicação está aberta.