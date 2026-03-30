begin;

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create or replace function public.production_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

do $$
declare
  v_order_id_type text;
  v_machine_id_type text;
begin
  if to_regclass('public.orders') is null then
    raise exception 'Tabela public.orders nao encontrada. Execute esta migration somente no banco do quadro de producao.';
  end if;

  select format_type(a.atttypid, a.atttypmod)
    into v_order_id_type
  from pg_attribute a
  where a.attrelid = 'public.orders'::regclass
    and a.attname = 'id'
    and not a.attisdropped;

  select format_type(a.atttypid, a.atttypmod)
    into v_machine_id_type
  from pg_attribute a
  where a.attrelid = 'public.orders'::regclass
    and a.attname = 'machine_id'
    and not a.attisdropped;

  execute format(
    $sql$
      create table if not exists public.order_machine_sessions (
        id uuid primary key default gen_random_uuid(),
        order_id %1$s not null references public.orders(id) on delete cascade,
        machine_id %2$s not null,
        started_at timestamptz not null,
        ended_at timestamptz,
        started_by text,
        ended_by text,
        end_reason text,
        created_at timestamptz not null default timezone('utc', now()),
        updated_at timestamptz not null default timezone('utc', now())
      )
    $sql$,
    v_order_id_type,
    v_machine_id_type
  );
end;
$$;

alter table public.order_machine_sessions
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now()),
  add column if not exists started_by text,
  add column if not exists ended_by text,
  add column if not exists end_reason text,
  add column if not exists ended_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_machine_sessions_valid_window_ck'
      and conrelid = 'public.order_machine_sessions'::regclass
  ) then
    alter table public.order_machine_sessions
      add constraint order_machine_sessions_valid_window_ck
      check (ended_at is null or ended_at >= started_at);
  end if;
end;
$$;

alter table public.machine_stops
  add column if not exists session_id uuid references public.order_machine_sessions(id) on delete set null,
  add column if not exists ended_at timestamptz,
  add column if not exists created_by text,
  add column if not exists closed_by text,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

update public.machine_stops
set ended_at = coalesce(ended_at, resumed_at),
    created_by = coalesce(created_by, started_by),
    closed_by = coalesce(closed_by, resumed_by),
    updated_at = coalesce(updated_at, timezone('utc', now()));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'machine_stops_valid_window_ck'
      and conrelid = 'public.machine_stops'::regclass
  ) then
    alter table public.machine_stops
      add constraint machine_stops_valid_window_ck
      check (ended_at is null or ended_at >= started_at);
  end if;
end;
$$;

alter table public.low_efficiency_logs
  add column if not exists session_id uuid references public.order_machine_sessions(id) on delete set null,
  add column if not exists reason text,
  add column if not exists created_by text,
  add column if not exists closed_by text,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

update public.low_efficiency_logs
set created_by = coalesce(created_by, started_by),
    closed_by = coalesce(closed_by, ended_by),
    updated_at = coalesce(updated_at, timezone('utc', now()));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'low_efficiency_logs_valid_window_ck'
      and conrelid = 'public.low_efficiency_logs'::regclass
  ) then
    alter table public.low_efficiency_logs
      add constraint low_efficiency_logs_valid_window_ck
      check (ended_at is null or ended_at >= started_at);
  end if;
end;
$$;

create or replace function public.production_normalize_machine_stop()
returns trigger
language plpgsql
as $$
declare
  v_session record;
begin
  new.created_at := coalesce(new.created_at, timezone('utc', now()));
  new.updated_at := timezone('utc', now());
  new.ended_at := coalesce(new.ended_at, new.resumed_at);
  new.created_by := coalesce(new.created_by, new.started_by);
  new.closed_by := coalesce(new.closed_by, new.resumed_by);
  new.resumed_at := coalesce(new.resumed_at, new.ended_at);
  new.started_by := coalesce(new.started_by, new.created_by);
  new.resumed_by := coalesce(new.resumed_by, new.closed_by);

  if new.ended_at is not null and new.ended_at < new.started_at then
    raise exception 'Parada com intervalo invalido: ended_at < started_at';
  end if;

  if new.session_id is not null then
    select s.id, s.order_id, s.machine_id
      into v_session
    from public.order_machine_sessions s
    where s.id = new.session_id;

    if not found then
      raise exception 'Sessao % nao encontrada para machine_stops', new.session_id;
    end if;

    if new.order_id is null then
      new.order_id := v_session.order_id;
    elsif new.order_id is distinct from v_session.order_id then
      raise exception 'order_id divergente da sessao na parada';
    end if;

    if new.machine_id is null then
      new.machine_id := v_session.machine_id;
    elsif new.machine_id is distinct from v_session.machine_id then
      raise exception 'machine_id divergente da sessao na parada';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.production_normalize_low_efficiency()
returns trigger
language plpgsql
as $$
declare
  v_session record;
begin
  new.created_at := coalesce(new.created_at, timezone('utc', now()));
  new.updated_at := timezone('utc', now());
  new.created_by := coalesce(new.created_by, new.started_by);
  new.closed_by := coalesce(new.closed_by, new.ended_by);
  new.started_by := coalesce(new.started_by, new.created_by);
  new.ended_by := coalesce(new.ended_by, new.closed_by);

  if new.ended_at is not null and new.ended_at < new.started_at then
    raise exception 'Baixa eficiencia com intervalo invalido: ended_at < started_at';
  end if;

  if new.session_id is not null then
    select s.id, s.order_id, s.machine_id
      into v_session
    from public.order_machine_sessions s
    where s.id = new.session_id;

    if not found then
      raise exception 'Sessao % nao encontrada para low_efficiency_logs', new.session_id;
    end if;

    if new.order_id is null then
      new.order_id := v_session.order_id;
    elsif new.order_id is distinct from v_session.order_id then
      raise exception 'order_id divergente da sessao na baixa eficiencia';
    end if;

    if new.machine_id is null then
      new.machine_id := v_session.machine_id;
    elsif new.machine_id is distinct from v_session.machine_id then
      raise exception 'machine_id divergente da sessao na baixa eficiencia';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_machine_sessions_touch_updated_at on public.order_machine_sessions;
create trigger trg_order_machine_sessions_touch_updated_at
before update on public.order_machine_sessions
for each row
execute function public.production_touch_updated_at();

drop trigger if exists trg_machine_stops_normalize on public.machine_stops;
create trigger trg_machine_stops_normalize
before insert or update on public.machine_stops
for each row
execute function public.production_normalize_machine_stop();

drop trigger if exists trg_low_efficiency_logs_normalize on public.low_efficiency_logs;
create trigger trg_low_efficiency_logs_normalize
before insert or update on public.low_efficiency_logs
for each row
execute function public.production_normalize_low_efficiency();

create index if not exists idx_order_machine_sessions_order_started_at
  on public.order_machine_sessions (order_id, started_at desc);

create index if not exists idx_order_machine_sessions_machine_started_at
  on public.order_machine_sessions (machine_id, started_at desc);

create index if not exists idx_order_machine_sessions_open_order
  on public.order_machine_sessions (order_id)
  where ended_at is null;

create index if not exists idx_order_machine_sessions_open_machine
  on public.order_machine_sessions (machine_id)
  where ended_at is null;

create index if not exists idx_machine_stops_order_started_at
  on public.machine_stops (order_id, started_at desc);

create index if not exists idx_machine_stops_machine_started_at
  on public.machine_stops (machine_id, started_at desc);

create index if not exists idx_machine_stops_session_started_at
  on public.machine_stops (session_id, started_at desc);

create index if not exists idx_machine_stops_open_machine
  on public.machine_stops (machine_id)
  where ended_at is null;

create index if not exists idx_low_efficiency_logs_order_started_at
  on public.low_efficiency_logs (order_id, started_at desc);

create index if not exists idx_low_efficiency_logs_machine_started_at
  on public.low_efficiency_logs (machine_id, started_at desc);

create index if not exists idx_low_efficiency_logs_session_started_at
  on public.low_efficiency_logs (session_id, started_at desc);

create index if not exists idx_low_efficiency_logs_open_session
  on public.low_efficiency_logs (session_id)
  where ended_at is null;

do $$
declare
  v_order_cols text;
begin
  select string_agg(format('o.%I', c.column_name), ', ' order by c.ordinal_position)
    into v_order_cols
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'orders'
    and c.column_name not in (
      'status',
      'started_at',
      'started_by',
      'restarted_at',
      'restarted_by',
      'interrupted_at',
      'interrupted_by',
      'loweff_started_at',
      'loweff_ended_at',
      'loweff_by',
      'loweff_notes',
      'finalized_at',
      'finalized_by'
    );

  execute format(
    $sql$
      create or replace view public.production_orders_runtime_v as
      with session_ranked as (
        select
          s.*,
          row_number() over (partition by s.order_id order by s.started_at asc, s.id asc) as session_seq,
          row_number() over (partition by s.order_id order by s.started_at desc, s.id desc) as reverse_seq,
          row_number() over (
            partition by s.order_id
            order by coalesce(s.ended_at, s.started_at) desc, s.id desc
          ) as ended_seq
        from public.order_machine_sessions s
      ),
      session_rollup as (
        select
          s.order_id,
          min(s.started_at) as first_started_at,
          max(s.started_at) filter (where s.session_seq > 1) as restarted_at,
          max(s.started_by) filter (where s.session_seq = 1) as started_by,
          max(s.started_by) filter (where s.session_seq > 1 and s.reverse_seq = 1) as restarted_by,
          max(s.ended_at) filter (where s.end_reason is distinct from 'FINALIZED') as interrupted_at,
          max(s.ended_by) filter (where s.end_reason is distinct from 'FINALIZED' and s.ended_seq = 1) as interrupted_by,
          max(s.ended_at) filter (where s.end_reason = 'FINALIZED') as finalized_at,
          max(s.ended_by) filter (where s.end_reason = 'FINALIZED' and s.ended_seq = 1) as finalized_by,
          count(*) as session_count
        from session_ranked s
        group by s.order_id
      ),
      open_sessions as (
        select distinct on (s.order_id)
          s.order_id,
          s.id as active_session_id,
          s.machine_id as active_machine_id,
          s.started_at as active_session_started_at,
          s.started_by as active_session_started_by
        from public.order_machine_sessions s
        where s.ended_at is null
        order by s.order_id, s.started_at desc, s.id desc
      ),
      open_stops as (
        select distinct on (st.order_id)
          st.order_id,
          st.id as active_stop_id,
          st.session_id,
          st.started_at as active_stop_started_at,
          st.reason as active_stop_reason,
          st.notes as active_stop_notes
        from public.machine_stops st
        where st.ended_at is null
        order by st.order_id, st.started_at desc, st.id desc
      ),
      open_low as (
        select distinct on (le.order_id)
          le.order_id,
          le.id as active_low_efficiency_id,
          le.session_id,
          le.started_at as loweff_started_at,
          le.ended_at as loweff_ended_at,
          le.reason as loweff_reason,
          le.notes as loweff_notes,
          le.created_by as loweff_created_by
        from public.low_efficiency_logs le
        where le.ended_at is null
        order by le.order_id, le.started_at desc, le.id desc
      )
      select
        %1$s,
        o.status as persisted_status,
        case
          when coalesce(o.finalized, false) then 'FINALIZADA'
          when os.active_stop_id is not null then 'PARADA'
          when ol.active_low_efficiency_id is not null then 'BAIXA_EFICIENCIA'
          when sess.active_session_id is not null then 'PRODUZINDO'
          when sr.first_started_at is not null then 'AGUARDANDO'
          else coalesce(o.status, 'AGUARDANDO')
        end as status,
        sr.first_started_at as started_at,
        sr.started_by as started_by,
        sr.restarted_at as restarted_at,
        sr.restarted_by as restarted_by,
        sr.interrupted_at as interrupted_at,
        sr.interrupted_by as interrupted_by,
        coalesce(o.finalized_at, sr.finalized_at) as finalized_at,
        coalesce(o.finalized_by, sr.finalized_by) as finalized_by,
        ol.loweff_started_at,
        ol.loweff_ended_at,
        ol.loweff_reason,
        ol.loweff_notes,
        sess.active_session_id,
        sess.active_machine_id,
        sess.active_session_started_at,
        sess.active_session_started_by,
        os.active_stop_id,
        os.active_stop_started_at,
        os.active_stop_reason,
        os.active_stop_notes,
        sr.session_count
      from public.orders o
      left join session_rollup sr
        on sr.order_id = o.id
      left join open_sessions sess
        on sess.order_id = o.id
      left join open_stops os
        on os.order_id = o.id
      left join open_low ol
        on ol.order_id = o.id
    $sql$,
    v_order_cols
  );
end;
$$;

create or replace view public.production_session_timeline_v as
select
  s.id,
  s.order_id,
  s.machine_id,
  s.started_at,
  s.ended_at,
  s.started_by,
  s.ended_by,
  s.end_reason,
  s.created_at,
  s.updated_at,
  o.code,
  o.customer,
  o.product,
  o.color,
  o.qty,
  o.boxes,
  o.standard,
  o.notes,
  o.due_date,
  o.finalized
from public.order_machine_sessions s
join public.orders o
  on o.id = s.order_id;

comment on table public.order_machine_sessions is 'Sessao normalizada de producao por maquina. Cada inicio/retomada abre uma sessao e cada interrupcao/transicao encerra a sessao atual.';
comment on view public.production_orders_runtime_v is 'Read model unico do runtime de producao. Entrega o estado atual e campos derivados para o frontend sem depender do historico comprimido em orders.';
comment on view public.production_session_timeline_v is 'Timeline normalizada por sessao, usada para historico, auditoria e migracao gradual do frontend.';

commit;