begin;

create table if not exists public.production_migration_review_queue (
  id uuid primary key default gen_random_uuid(),
  issue_type text not null,
  severity text not null default 'warn',
  order_id text,
  machine_id text,
  source_table text,
  source_record_id text,
  details jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists trg_production_migration_review_queue_touch_updated_at on public.production_migration_review_queue;
create trigger trg_production_migration_review_queue_touch_updated_at
before update on public.production_migration_review_queue
for each row
execute function public.production_touch_updated_at();

create index if not exists idx_production_migration_review_queue_open
  on public.production_migration_review_queue (resolved, severity, created_at desc);

create or replace function public.production_push_review_issue(
  p_issue_type text,
  p_severity text,
  p_order_id text,
  p_machine_id text,
  p_source_table text,
  p_source_record_id text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
as $$
begin
  insert into public.production_migration_review_queue (
    issue_type,
    severity,
    order_id,
    machine_id,
    source_table,
    source_record_id,
    details
  ) values (
    p_issue_type,
    coalesce(nullif(p_severity, ''), 'warn'),
    nullif(p_order_id, ''),
    nullif(p_machine_id, ''),
    nullif(p_source_table, ''),
    nullif(p_source_record_id, ''),
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

create or replace function public.production_audit_legacy_data()
returns jsonb
language plpgsql
as $$
declare
  v_count integer := 0;
begin
  delete from public.production_migration_review_queue where resolved = false;

  insert into public.production_migration_review_queue (issue_type, severity, order_id, machine_id, source_table, source_record_id, details)
  select
    'OPEN_STOP_DUPLICATE',
    'err',
    st.order_id::text,
    st.machine_id::text,
    'machine_stops',
    st.id::text,
    jsonb_build_object('started_at', st.started_at, 'reason', st.reason)
  from (
    select st.*, row_number() over (partition by st.machine_id order by st.started_at desc, st.id desc) as rn
    from public.machine_stops st
    where st.ended_at is null
  ) st
  where st.rn > 1;

  insert into public.production_migration_review_queue (issue_type, severity, order_id, machine_id, source_table, source_record_id, details)
  select
    'OPEN_LOW_EFF_DUPLICATE',
    'err',
    le.order_id::text,
    le.machine_id::text,
    'low_efficiency_logs',
    le.id::text,
    jsonb_build_object('started_at', le.started_at, 'session_id', le.session_id)
  from (
    select le.*, row_number() over (partition by coalesce(le.session_id::text, le.order_id::text) order by le.started_at desc, le.id desc) as rn
    from public.low_efficiency_logs le
    where le.ended_at is null
  ) le
  where le.rn > 1;

  insert into public.production_migration_review_queue (issue_type, severity, order_id, machine_id, source_table, source_record_id, details)
  select
    'OPEN_SESSION_DUPLICATE',
    'err',
    s.order_id::text,
    s.machine_id::text,
    'order_machine_sessions',
    s.id::text,
    jsonb_build_object('started_at', s.started_at, 'end_reason', s.end_reason)
  from (
    select s.*, row_number() over (partition by s.order_id order by s.started_at desc, s.id desc) as rn
    from public.order_machine_sessions s
    where s.ended_at is null
  ) s
  where s.rn > 1;

  insert into public.production_migration_review_queue (issue_type, severity, order_id, machine_id, source_table, source_record_id, details)
  select
    'ORDER_MACHINE_DIVERGENCE',
    'warn',
    o.id::text,
    o.machine_id::text,
    'orders',
    o.id::text,
    jsonb_build_object('machines_detected', machine_ids)
  from (
    select
      o.id,
      o.machine_id,
      array_remove(array_agg(distinct st.machine_id::text), null) || array_remove(array_agg(distinct le.machine_id::text), null) as machine_ids
    from public.orders o
    left join public.machine_stops st on st.order_id = o.id
    left join public.low_efficiency_logs le on le.order_id = o.id
    group by o.id, o.machine_id
  ) o
  where cardinality(o.machine_ids) > 0
    and exists (
      select 1
      from unnest(o.machine_ids) as detected(machine_id)
      where detected.machine_id is distinct from o.machine_id::text
    );

  insert into public.production_migration_review_queue (issue_type, severity, order_id, machine_id, source_table, source_record_id, details)
  select
    'INVALID_STOP_WINDOW',
    'err',
    st.order_id::text,
    st.machine_id::text,
    'machine_stops',
    st.id::text,
    jsonb_build_object('started_at', st.started_at, 'ended_at', st.ended_at)
  from public.machine_stops st
  where st.ended_at is not null
    and st.ended_at < st.started_at;

  insert into public.production_migration_review_queue (issue_type, severity, order_id, machine_id, source_table, source_record_id, details)
  select
    'INVALID_LOW_EFF_WINDOW',
    'err',
    le.order_id::text,
    le.machine_id::text,
    'low_efficiency_logs',
    le.id::text,
    jsonb_build_object('started_at', le.started_at, 'ended_at', le.ended_at)
  from public.low_efficiency_logs le
  where le.ended_at is not null
    and le.ended_at < le.started_at;

  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'review_items', (select count(*) from public.production_migration_review_queue where resolved = false)
  );
end;
$$;

create or replace function public.production_backfill_sessions_from_legacy(
  p_actor text default 'migration'
)
returns jsonb
language plpgsql
as $$
declare
  v_inserted integer := 0;
  v_linked_stops integer := 0;
  v_linked_low integer := 0;
begin
  insert into public.order_machine_sessions (
    order_id,
    machine_id,
    started_at,
    ended_at,
    started_by,
    ended_by,
    end_reason
  )
  select
    o.id,
    o.machine_id,
    o.started_at,
    case
      when o.restarted_at is not null then coalesce(o.interrupted_at, o.restarted_at, o.finalized_at)
      when o.interrupted_at is not null then o.interrupted_at
      when o.finalized_at is not null then o.finalized_at
      else null
    end as ended_at,
    coalesce(o.started_by, p_actor),
    case
      when o.restarted_at is not null then coalesce(o.interrupted_by, p_actor)
      when o.interrupted_at is not null then coalesce(o.interrupted_by, p_actor)
      when o.finalized_at is not null then coalesce(o.finalized_by, p_actor)
      else null
    end as ended_by,
    case
      when o.restarted_at is not null then 'INTERRUPTED'
      when o.interrupted_at is not null then 'INTERRUPTED'
      when o.finalized_at is not null then 'FINALIZED'
      else null
    end as end_reason
  from public.orders o
  where o.started_at is not null
    and not exists (
      select 1
      from public.order_machine_sessions s
      where s.order_id = o.id
    );
  get diagnostics v_inserted = row_count;

  insert into public.order_machine_sessions (
    order_id,
    machine_id,
    started_at,
    ended_at,
    started_by,
    ended_by,
    end_reason
  )
  select
    o.id,
    o.machine_id,
    o.restarted_at,
    o.finalized_at,
    coalesce(o.restarted_by, p_actor),
    coalesce(o.finalized_by, p_actor),
    case when o.finalized_at is not null then 'FINALIZED' else null end
  from public.orders o
  where o.restarted_at is not null
    and exists (
      select 1
      from public.order_machine_sessions s
      where s.order_id = o.id
        and s.started_at = o.started_at
    )
    and not exists (
      select 1
      from public.order_machine_sessions s
      where s.order_id = o.id
        and s.started_at = o.restarted_at
    );
  get diagnostics v_inserted = v_inserted + row_count;

  insert into public.order_machine_sessions (
    order_id,
    machine_id,
    started_at,
    ended_at,
    started_by,
    ended_by,
    end_reason
  )
  select
    base.order_id,
    base.machine_id,
    base.started_at,
    base.ended_at,
    p_actor,
    p_actor,
    case when base.ended_at is not null then 'INFERRED' else null end
  from (
    select
      st.order_id,
      st.machine_id,
      min(st.started_at) as started_at,
      max(st.ended_at) as ended_at
    from public.machine_stops st
    where st.order_id is not null
    group by st.order_id, st.machine_id
  ) base
  where not exists (
    select 1
    from public.order_machine_sessions s
    where s.order_id = base.order_id
      and s.machine_id = base.machine_id
  );
  get diagnostics v_inserted = v_inserted + row_count;

  update public.machine_stops st
     set session_id = match.session_id
    from (
      select distinct on (st.id)
        st.id as stop_id,
        s.id as session_id
      from public.machine_stops st
      join public.order_machine_sessions s
        on s.order_id = st.order_id
       and s.machine_id = st.machine_id
       and s.started_at <= st.started_at
       and coalesce(s.ended_at, 'infinity'::timestamptz) >= st.started_at
      where st.session_id is null
      order by st.id, s.started_at desc, s.id desc
    ) match
   where st.id = match.stop_id;
  get diagnostics v_linked_stops = row_count;

  update public.low_efficiency_logs le
     set session_id = match.session_id
    from (
      select distinct on (le.id)
        le.id as low_id,
        s.id as session_id
      from public.low_efficiency_logs le
      join public.order_machine_sessions s
        on s.order_id = le.order_id
       and s.machine_id = le.machine_id
       and s.started_at <= le.started_at
       and coalesce(s.ended_at, 'infinity'::timestamptz) >= le.started_at
      where le.session_id is null
      order by le.id, s.started_at desc, s.id desc
    ) match
   where le.id = match.low_id;
  get diagnostics v_linked_low = row_count;

  return jsonb_build_object(
    'sessions_inserted', v_inserted,
    'stops_linked', v_linked_stops,
    'low_efficiency_linked', v_linked_low
  );
end;
$$;

create or replace function public.production_cleanup_open_duplicates(
  p_effective_at timestamptz default timezone('utc', now()),
  p_actor text default 'migration'
)
returns jsonb
language plpgsql
as $$
declare
  v_closed_sessions integer := 0;
  v_closed_stops integer := 0;
  v_closed_low integer := 0;
begin
  with duplicates as (
    select id
    from (
      select s.id, row_number() over (partition by s.order_id order by s.started_at desc, s.id desc) as rn
      from public.order_machine_sessions s
      where s.ended_at is null
    ) x
    where x.rn > 1
  )
  update public.order_machine_sessions s
     set ended_at = coalesce(s.ended_at, p_effective_at),
         ended_by = coalesce(s.ended_by, p_actor),
         end_reason = coalesce(s.end_reason, 'SANITIZED_DUPLICATE'),
         updated_at = timezone('utc', now())
    from duplicates d
   where s.id = d.id;
  get diagnostics v_closed_sessions = row_count;

  with duplicates as (
    select id
    from (
      select st.id, row_number() over (partition by st.machine_id order by st.started_at desc, st.id desc) as rn
      from public.machine_stops st
      where st.ended_at is null
    ) x
    where x.rn > 1
  )
  update public.machine_stops st
     set ended_at = coalesce(st.ended_at, p_effective_at),
         closed_by = coalesce(st.closed_by, p_actor),
         resumed_at = coalesce(st.resumed_at, p_effective_at),
         resumed_by = coalesce(st.resumed_by, p_actor),
         updated_at = timezone('utc', now())
    from duplicates d
   where st.id = d.id;
  get diagnostics v_closed_stops = row_count;

  with duplicates as (
    select id
    from (
      select le.id, row_number() over (partition by coalesce(le.session_id::text, le.order_id::text) order by le.started_at desc, le.id desc) as rn
      from public.low_efficiency_logs le
      where le.ended_at is null
    ) x
    where x.rn > 1
  )
  update public.low_efficiency_logs le
     set ended_at = coalesce(le.ended_at, p_effective_at),
         closed_by = coalesce(le.closed_by, p_actor),
         ended_by = coalesce(le.ended_by, p_actor),
         updated_at = timezone('utc', now())
    from duplicates d
   where le.id = d.id;
  get diagnostics v_closed_low = row_count;

  return jsonb_build_object(
    'sessions_closed', v_closed_sessions,
    'stops_closed', v_closed_stops,
    'low_efficiency_closed', v_closed_low
  );
end;
$$;

create or replace function public.production_guard_session_overlap()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from public.order_machine_sessions s
    where s.id <> coalesce(new.id, gen_random_uuid())
      and s.order_id = new.order_id
      and tstzrange(s.started_at, coalesce(s.ended_at, 'infinity'::timestamptz), '[)') &&
          tstzrange(new.started_at, coalesce(new.ended_at, 'infinity'::timestamptz), '[)')
  ) then
    raise exception 'Sobreposicao de sessao detectada para a ordem %', new.order_id;
  end if;

  if exists (
    select 1
    from public.order_machine_sessions s
    where s.id <> coalesce(new.id, gen_random_uuid())
      and s.machine_id = new.machine_id
      and tstzrange(s.started_at, coalesce(s.ended_at, 'infinity'::timestamptz), '[)') &&
          tstzrange(new.started_at, coalesce(new.ended_at, 'infinity'::timestamptz), '[)')
  ) then
    raise exception 'Sobreposicao de sessao detectada para a maquina %', new.machine_id;
  end if;

  return new;
end;
$$;

create or replace function public.production_guard_stop_overlap()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from public.machine_stops st
    where st.id <> coalesce(new.id, gen_random_uuid())
      and st.machine_id = new.machine_id
      and tstzrange(st.started_at, coalesce(st.ended_at, 'infinity'::timestamptz), '[)') &&
          tstzrange(new.started_at, coalesce(new.ended_at, 'infinity'::timestamptz), '[)')
  ) then
    raise exception 'Sobreposicao de parada detectada para a maquina %', new.machine_id;
  end if;

  return new;
end;
$$;

create or replace function public.production_guard_low_eff_overlap()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from public.low_efficiency_logs le
    where le.id <> coalesce(new.id, gen_random_uuid())
      and coalesce(le.session_id::text, le.order_id::text) = coalesce(new.session_id::text, new.order_id::text)
      and tstzrange(le.started_at, coalesce(le.ended_at, 'infinity'::timestamptz), '[)') &&
          tstzrange(new.started_at, coalesce(new.ended_at, 'infinity'::timestamptz), '[)')
  ) then
    raise exception 'Sobreposicao de baixa eficiencia detectada para a sessao/evento %', coalesce(new.session_id::text, new.order_id::text);
  end if;

  return new;
end;
$$;

select public.production_audit_legacy_data();
select public.production_backfill_sessions_from_legacy();
select public.production_cleanup_open_duplicates();
select public.production_audit_legacy_data();

create unique index if not exists uq_order_machine_sessions_one_open_order
  on public.order_machine_sessions (order_id)
  where ended_at is null;

create unique index if not exists uq_order_machine_sessions_one_open_machine
  on public.order_machine_sessions (machine_id)
  where ended_at is null;

create unique index if not exists uq_machine_stops_one_open_machine
  on public.machine_stops (machine_id)
  where ended_at is null;

create unique index if not exists uq_low_efficiency_logs_one_open_session
  on public.low_efficiency_logs (session_id)
  where ended_at is null and session_id is not null;

drop trigger if exists trg_order_machine_sessions_guard_overlap on public.order_machine_sessions;
create trigger trg_order_machine_sessions_guard_overlap
before insert or update on public.order_machine_sessions
for each row
execute function public.production_guard_session_overlap();

drop trigger if exists trg_machine_stops_guard_overlap on public.machine_stops;
create trigger trg_machine_stops_guard_overlap
before insert or update on public.machine_stops
for each row
execute function public.production_guard_stop_overlap();

drop trigger if exists trg_low_efficiency_logs_guard_overlap on public.low_efficiency_logs;
create trigger trg_low_efficiency_logs_guard_overlap
before insert or update on public.low_efficiency_logs
for each row
execute function public.production_guard_low_eff_overlap();

commit;