-- Execute este script no SQL Editor do Supabase depois de criar a tabela
-- public.scheduled_machine_stops e depois de instalar a extensao pg_cron.
--
-- Objetivo:
-- 1. abrir as paradas programadas automaticamente no horario exato;
-- 2. fechar as paradas no horario exato;
-- 3. vincular a parada apenas a ordem que estava no painel no momento da abertura;
-- 4. nao criar parada fantasma quando a maquina estiver sem programacao;
-- 5. fechar paradas vencidas mesmo que o job exato atrase ou falhe.

begin;

create or replace function public.open_scheduled_machine_stops_snapshot(
  p_started_at timestamptz,
  p_expected_end_at timestamptz,
  p_notes text default 'Parada programada automática via pg_cron'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_machine_id text;
  v_order_id text;
  v_event_key text;
begin
  if p_started_at is null or p_expected_end_at is null or p_expected_end_at <= p_started_at then
    raise exception 'Janela invalida para abertura de parada programada';
  end if;

  for v_machine_id in
    select unnest(array['P1','P2','P3','P4','I1','I2','I3','I4','I5','I6'])
  loop
    select o.id::text
      into v_order_id
    from public.orders o
    where upper(coalesce(o.machine_id, '')) = v_machine_id
      and coalesce(o.finalized, false) = false
    order by coalesce(o.pos, 999999), o.created_at asc, o.id asc
    limit 1;

    if v_order_id is null then
      continue;
    end if;

    v_event_key := v_machine_id || '::' || to_char(p_started_at at time zone 'UTC', 'YYYYMMDDHH24MISS');

    insert into public.scheduled_machine_stops (
      event_key,
      machine_id,
      order_id,
      reason,
      notes,
      started_at,
      expected_end_at,
      ended_at,
      started_by,
      ended_by
    )
    values (
      v_event_key,
      v_machine_id,
      v_order_id,
      'PARADA PROGRAMADA',
      p_notes,
      p_started_at,
      p_expected_end_at,
      null,
      'SISTEMA',
      null
    )
    on conflict (event_key)
    do update
      set expected_end_at = excluded.expected_end_at,
          reason = excluded.reason,
          notes = excluded.notes;
  end loop;
end;
$$;

create or replace function public.close_due_scheduled_machine_stops(p_now timestamptz default timezone('utc', now()))
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.scheduled_machine_stops
     set ended_at = coalesce(ended_at, expected_end_at),
         ended_by = coalesce(ended_by, 'SISTEMA')
   where ended_at is null
     and expected_end_at <= coalesce(p_now, timezone('utc', now()));
end;
$$;

create or replace function public.sync_scheduled_machine_stops(p_now timestamptz default timezone('utc', now()))
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, timezone('utc', now()));
  v_now_br timestamp := timezone('America/Sao_Paulo', v_now);
  v_today_br date := v_now_br::date;
  v_candidate_date date;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_weekday integer;
  v_saturday date;
begin
  perform public.close_due_scheduled_machine_stops(v_now);

  for v_candidate_date in
    select generate_series(v_today_br - 1, v_today_br, interval '1 day')::date
  loop
    v_weekday := extract(isodow from v_candidate_date);

    if v_weekday between 1 and 5 then
      v_window_start := (v_candidate_date + time '22:00') at time zone 'America/Sao_Paulo';
      v_window_end := ((v_candidate_date + 1) + time '05:00') at time zone 'America/Sao_Paulo';

      if v_now >= v_window_start and v_now < v_window_end then
        perform public.open_scheduled_machine_stops_snapshot(
          v_window_start,
          v_window_end,
          'Parada programada automática via pg_cron - noturna'
        );
      end if;
    end if;
  end loop;

  v_weekday := extract(isodow from v_today_br);
  v_saturday := case
    when v_weekday = 6 then v_today_br
    when v_weekday = 7 then v_today_br - 1
    when v_weekday = 1 then v_today_br - 2
    else null
  end;

  if v_saturday is not null then
    v_window_start := (v_saturday + time '13:00') at time zone 'America/Sao_Paulo';
    v_window_end := ((v_saturday + 2) + time '05:00') at time zone 'America/Sao_Paulo';

    if v_now >= v_window_start and v_now < v_window_end then
      perform public.open_scheduled_machine_stops_snapshot(
        v_window_start,
        v_window_end,
        'Parada programada automática via pg_cron - fim de semana'
      );
    end if;
  end if;

  perform public.close_due_scheduled_machine_stops(v_now);
end;
$$;

comment on function public.open_scheduled_machine_stops_snapshot(timestamptz, timestamptz, text)
is 'Abre paradas programadas apenas para as ordens que estavam no painel no instante exato da abertura.';

comment on function public.close_due_scheduled_machine_stops(timestamptz)
is 'Fecha paradas programadas cujo horario previsto de retorno ja foi atingido.';

comment on function public.sync_scheduled_machine_stops(timestamptz)
is 'Sincroniza abertura e fechamento de paradas programadas usando o horario de Sao Paulo e corrige execucoes perdidas do cron.';

do $$
declare
  v_job_name text;
begin
  foreach v_job_name in array array[
    'scheduled_machine_stops_sync_every_minute',
    'scheduled_machine_stops_open_weekday_night',
    'scheduled_machine_stops_close_weekday_night',
    'scheduled_machine_stops_open_saturday',
    'scheduled_machine_stops_close_monday'
  ]
  loop
    if exists (
      select 1
      from cron.job
      where jobname = v_job_name
    ) then
      perform cron.unschedule(v_job_name);
    end if;
  end loop;
exception
  when undefined_table then
    null;
end
$$;

select cron.schedule(
  'scheduled_machine_stops_sync_every_minute',
  '* * * * *',
  $$select public.sync_scheduled_machine_stops();$$
);

-- Os schedules abaixo usam UTC/GMT, que e o padrao do pg_cron quando cron.timezone nao foi alterado.
select cron.schedule(
  'scheduled_machine_stops_open_weekday_night',
  '0 1 * * 2-6',
  $$
  select public.open_scheduled_machine_stops_snapshot(
    timezone('America/Sao_Paulo', timezone('utc', now()))::date + time '22:00' at time zone 'America/Sao_Paulo',
    (timezone('America/Sao_Paulo', timezone('utc', now()))::date + 1 + time '05:00') at time zone 'America/Sao_Paulo',
    'Parada programada automática via pg_cron - noturna'
  );
  $$
);

select cron.schedule(
  'scheduled_machine_stops_close_weekday_night',
  '0 8 * * 2-6',
  $$select public.close_due_scheduled_machine_stops();$$
);

select cron.schedule(
  'scheduled_machine_stops_open_saturday',
  '0 16 * * 6',
  $$
  select public.open_scheduled_machine_stops_snapshot(
    timezone('America/Sao_Paulo', timezone('utc', now()))::date + time '13:00' at time zone 'America/Sao_Paulo',
    (timezone('America/Sao_Paulo', timezone('utc', now()))::date + 2 + time '05:00') at time zone 'America/Sao_Paulo',
    'Parada programada automática via pg_cron - fim de semana'
  );
  $$
);

select cron.schedule(
  'scheduled_machine_stops_close_monday',
  '0 8 * * 1',
  $$select public.close_due_scheduled_machine_stops();$$
);

select public.close_due_scheduled_machine_stops();

commit;

-- Execucao manual para teste imediato:
-- select public.open_scheduled_machine_stops_snapshot(
--   '2026-04-03 22:00:00-03'::timestamptz,
--   '2026-04-04 05:00:00-03'::timestamptz,
--   'Teste parada noturna'
-- );
-- select public.close_due_scheduled_machine_stops();
--
-- Consultas uteis:
-- select * from public.scheduled_machine_stops order by started_at desc, machine_id;
-- select jobid, jobname, schedule, command from cron.job where jobname like 'scheduled_machine_stops_%';
-- select jobid, job_pid, status, return_message, start_time, end_time from cron.job_run_details order by start_time desc limit 20;