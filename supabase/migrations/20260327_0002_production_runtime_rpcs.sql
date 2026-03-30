  begin;

  create or replace function public.production_get_active_session(p_order_id text)
  returns public.order_machine_sessions
  language plpgsql
  stable
  as $$
  declare
    v_session public.order_machine_sessions;
  begin
    select s.*
      into v_session
    from public.order_machine_sessions s
    where s.order_id::text = p_order_id
      and s.ended_at is null
    order by s.started_at desc, s.id desc
    limit 1;

    return v_session;
  end;
  $$;

  create or replace function public.production_sanitize_open_state(
    p_order_id text default null,
    p_machine_id text default null,
    p_effective_at timestamptz default timezone('utc', now()),
    p_actor text default null,
    p_reason text default 'SANITIZED',
    p_close_session boolean default false
  )
  returns jsonb
  language plpgsql
  as $$
  declare
    v_closed_stops integer := 0;
    v_closed_low integer := 0;
    v_closed_sessions integer := 0;
  begin
    update public.machine_stops st
      set ended_at = coalesce(st.ended_at, p_effective_at),
          closed_by = coalesce(nullif(p_actor, ''), st.closed_by),
          resumed_at = coalesce(st.resumed_at, p_effective_at),
          resumed_by = coalesce(nullif(p_actor, ''), st.resumed_by),
          updated_at = timezone('utc', now())
    where st.ended_at is null
      and (
        (p_order_id is not null and st.order_id::text = p_order_id)
        or (p_machine_id is not null and st.machine_id::text = p_machine_id)
      );
    get diagnostics v_closed_stops = row_count;

    update public.low_efficiency_logs le
      set ended_at = coalesce(le.ended_at, p_effective_at),
          closed_by = coalesce(nullif(p_actor, ''), le.closed_by),
          ended_by = coalesce(nullif(p_actor, ''), le.ended_by),
          updated_at = timezone('utc', now())
    where le.ended_at is null
      and (
        (p_order_id is not null and le.order_id::text = p_order_id)
        or (p_machine_id is not null and le.machine_id::text = p_machine_id)
      );
    get diagnostics v_closed_low = row_count;

    if p_close_session then
      update public.order_machine_sessions s
        set ended_at = coalesce(s.ended_at, p_effective_at),
            ended_by = coalesce(nullif(p_actor, ''), s.ended_by),
            end_reason = coalesce(nullif(p_reason, ''), s.end_reason, 'SANITIZED'),
            updated_at = timezone('utc', now())
      where s.ended_at is null
        and (
          (p_order_id is not null and s.order_id::text = p_order_id)
          or (p_machine_id is not null and s.machine_id::text = p_machine_id)
        );
      get diagnostics v_closed_sessions = row_count;
    end if;

    return jsonb_build_object(
      'closed_stops', v_closed_stops,
      'closed_low_efficiency', v_closed_low,
      'closed_sessions', v_closed_sessions,
      'effective_at', p_effective_at
    );
  end;
  $$;

  create or replace function public.production_start_order(
    p_order_id text,
    p_started_at timestamptz,
    p_actor text default null,
    p_machine_id text default null
  )
  returns jsonb
  language plpgsql
  as $$
  declare
    v_order public.orders;
    v_machine text;
    v_session_id uuid;
    v_active_session public.order_machine_sessions;
  begin
    select *
      into v_order
    from public.orders o
    where o.id::text = p_order_id
    for update;

    if not found then
      raise exception 'Ordem % nao encontrada', p_order_id;
    end if;

    if coalesce(v_order.finalized, false) then
      raise exception 'Nao e possivel iniciar uma ordem finalizada';
    end if;

    v_active_session := public.production_get_active_session(p_order_id);

    if v_active_session.id is not null then
      raise exception 'Ja existe sessao ativa para a ordem %', p_order_id;
    end if;

    v_machine := coalesce(nullif(p_machine_id, ''), v_order.machine_id::text);

    insert into public.order_machine_sessions (
      order_id,
      machine_id,
      started_at,
      started_by
    )
    select
      v_order.id,
      v_machine::text,
      p_started_at,
      nullif(p_actor, '')
    returning id into v_session_id;

    update public.orders
      set machine_id = v_machine,
          status = 'PRODUZINDO',
          finalized = false
    where id = v_order.id;

    return jsonb_build_object(
      'order_id', v_order.id,
      'session_id', v_session_id,
      'machine_id', v_machine,
      'status', 'PRODUZINDO'
    );
  end;
  $$;

  create or replace function public.production_stop_order(
    p_order_id text,
    p_started_at timestamptz,
    p_actor text,
    p_reason text,
    p_notes text default null
  )
  returns jsonb
  language plpgsql
  as $$
  declare
    v_session public.order_machine_sessions;
    v_existing_stop uuid;
    v_stop_id uuid;
  begin
    v_session := public.production_get_active_session(p_order_id);

    if v_session.id is null then
      raise exception 'Nao existe sessao ativa para registrar parada na ordem %', p_order_id;
    end if;

    select st.id
      into v_existing_stop
    from public.machine_stops st
    where st.machine_id::text = v_session.machine_id::text
      and st.ended_at is null
    order by st.started_at desc, st.id desc
    limit 1;

    if v_existing_stop is not null then
      raise exception 'Ja existe uma parada aberta para a maquina %', v_session.machine_id;
    end if;

    update public.low_efficiency_logs le
      set ended_at = coalesce(le.ended_at, p_started_at),
          closed_by = coalesce(nullif(p_actor, ''), le.closed_by),
          ended_by = coalesce(nullif(p_actor, ''), le.ended_by),
          updated_at = timezone('utc', now())
    where le.session_id = v_session.id
      and le.ended_at is null;

    insert into public.machine_stops (
      order_id,
      machine_id,
      session_id,
      started_at,
      ended_at,
      reason,
      notes,
      created_by,
      closed_by,
      started_by,
      resumed_by,
      resumed_at
    ) values (
      v_session.order_id,
      v_session.machine_id,
      v_session.id,
      p_started_at,
      null,
      p_reason,
      p_notes,
      nullif(p_actor, ''),
      null,
      nullif(p_actor, ''),
      null,
      null
    )
    returning id into v_stop_id;

    update public.orders
      set status = 'PARADA'
    where id = v_session.order_id;

    return jsonb_build_object(
      'order_id', v_session.order_id,
      'session_id', v_session.id,
      'stop_id', v_stop_id,
      'status', 'PARADA'
    );
  end;
  $$;

  create or replace function public.production_resume_order(
    p_order_id text,
    p_resumed_at timestamptz,
    p_actor text,
    p_target_status text default 'PRODUZINDO'
  )
  returns jsonb
  language plpgsql
  as $$
  declare
    v_session public.order_machine_sessions;
  begin
    v_session := public.production_get_active_session(p_order_id);

    if v_session.id is null then
      raise exception 'Nao existe sessao ativa para retomar a ordem %', p_order_id;
    end if;

    update public.machine_stops st
      set ended_at = coalesce(st.ended_at, p_resumed_at),
          closed_by = coalesce(nullif(p_actor, ''), st.closed_by),
          resumed_at = coalesce(st.resumed_at, p_resumed_at),
          resumed_by = coalesce(nullif(p_actor, ''), st.resumed_by),
          updated_at = timezone('utc', now())
    where st.session_id = v_session.id
      and st.ended_at is null;

    update public.orders
      set status = coalesce(nullif(p_target_status, ''), 'PRODUZINDO')
    where id = v_session.order_id;

    return jsonb_build_object(
      'order_id', v_session.order_id,
      'session_id', v_session.id,
      'status', coalesce(nullif(p_target_status, ''), 'PRODUZINDO')
    );
  end;
  $$;

  create or replace function public.production_enter_low_efficiency(
    p_order_id text,
    p_started_at timestamptz,
    p_actor text,
    p_reason text default null,
    p_notes text default null
  )
  returns jsonb
  language plpgsql
  as $$
  declare
    v_session public.order_machine_sessions;
    v_existing_event uuid;
    v_event_id uuid;
  begin
    v_session := public.production_get_active_session(p_order_id);

    if v_session.id is null then
      raise exception 'Nao existe sessao ativa para registrar baixa eficiencia na ordem %', p_order_id;
    end if;

    update public.machine_stops st
      set ended_at = coalesce(st.ended_at, p_started_at),
          closed_by = coalesce(nullif(p_actor, ''), st.closed_by),
          resumed_at = coalesce(st.resumed_at, p_started_at),
          resumed_by = coalesce(nullif(p_actor, ''), st.resumed_by),
          updated_at = timezone('utc', now())
    where st.session_id = v_session.id
      and st.ended_at is null;

    select le.id
      into v_existing_event
    from public.low_efficiency_logs le
    where le.session_id = v_session.id
      and le.ended_at is null
    order by le.started_at desc, le.id desc
    limit 1;

    if v_existing_event is not null then
      raise exception 'Ja existe baixa eficiencia aberta para a sessao %', v_session.id;
    end if;

    insert into public.low_efficiency_logs (
      order_id,
      machine_id,
      session_id,
      started_at,
      ended_at,
      reason,
      notes,
      created_by,
      closed_by,
      started_by,
      ended_by
    ) values (
      v_session.order_id,
      v_session.machine_id,
      v_session.id,
      p_started_at,
      null,
      p_reason,
      p_notes,
      nullif(p_actor, ''),
      null,
      nullif(p_actor, ''),
      null
    )
    returning id into v_event_id;

    update public.orders
      set status = 'BAIXA_EFICIENCIA'
    where id = v_session.order_id;

    return jsonb_build_object(
      'order_id', v_session.order_id,
      'session_id', v_session.id,
      'low_efficiency_id', v_event_id,
      'status', 'BAIXA_EFICIENCIA'
    );
  end;
  $$;

  create or replace function public.production_exit_low_efficiency(
    p_order_id text,
    p_ended_at timestamptz,
    p_actor text,
    p_target_status text default 'PRODUZINDO'
  )
  returns jsonb
  language plpgsql
  as $$
  declare
    v_session public.order_machine_sessions;
  begin
    v_session := public.production_get_active_session(p_order_id);

    if v_session.id is null then
      raise exception 'Nao existe sessao ativa para encerrar baixa eficiencia na ordem %', p_order_id;
    end if;

    update public.low_efficiency_logs le
      set ended_at = coalesce(le.ended_at, p_ended_at),
          closed_by = coalesce(nullif(p_actor, ''), le.closed_by),
          ended_by = coalesce(nullif(p_actor, ''), le.ended_by),
          updated_at = timezone('utc', now())
    where le.session_id = v_session.id
      and le.ended_at is null;

    update public.orders
      set status = coalesce(nullif(p_target_status, ''), 'PRODUZINDO')
    where id = v_session.order_id;

    return jsonb_build_object(
      'order_id', v_session.order_id,
      'session_id', v_session.id,
      'status', coalesce(nullif(p_target_status, ''), 'PRODUZINDO')
    );
  end;
  $$;

  create or replace function public.production_finalize_order(
    p_order_id text,
    p_finalized_at timestamptz,
    p_actor text
  )
  returns jsonb
  language plpgsql
  as $$
  declare
    v_order public.orders;
  begin
    select *
      into v_order
    from public.orders o
    where o.id::text = p_order_id
    for update;

    if not found then
      raise exception 'Ordem % nao encontrada', p_order_id;
    end if;

    perform public.production_sanitize_open_state(
      p_order_id => p_order_id,
      p_machine_id => v_order.machine_id::text,
      p_effective_at => p_finalized_at,
      p_actor => p_actor,
      p_reason => 'FINALIZED',
      p_close_session => true
    );

    update public.orders
      set status = 'FINALIZADA',
          finalized = true,
          finalized_at = p_finalized_at,
          finalized_by = nullif(p_actor, '')
    where id = v_order.id;

    return jsonb_build_object(
      'order_id', v_order.id,
      'status', 'FINALIZADA',
      'finalized_at', p_finalized_at
    );
  end;
  $$;

  create or replace function public.production_move_order_machine(
    p_order_id text,
    p_target_machine text,
    p_effective_at timestamptz default timezone('utc', now()),
    p_actor text default null,
    p_insert_at integer default null
  )
  returns jsonb
  language plpgsql
  as $$
  declare
    v_order public.orders;
    v_active_session public.order_machine_sessions;
    v_target_pos integer;
    v_current_max integer;
    v_new_session uuid;
  begin
    select *
      into v_order
    from public.orders o
    where o.id::text = p_order_id
    for update;

    if not found then
      raise exception 'Ordem % nao encontrada', p_order_id;
    end if;

    if nullif(p_target_machine, '') is null then
      raise exception 'Maquina de destino obrigatoria';
    end if;

    v_active_session := public.production_get_active_session(p_order_id);

    if v_active_session.id is not null then
      perform public.production_sanitize_open_state(
        p_order_id => p_order_id,
        p_machine_id => v_active_session.machine_id::text,
        p_effective_at => p_effective_at,
        p_actor => p_actor,
        p_reason => 'TRANSFERRED',
        p_close_session => true
      );
    end if;

    select coalesce(max(o.pos), -1)
      into v_current_max
    from public.orders o
    where o.machine_id::text = p_target_machine
      and coalesce(o.finalized, false) = false
      and o.id::text <> p_order_id;

    v_target_pos := coalesce(p_insert_at, v_current_max + 1);

    update public.orders
      set machine_id = p_target_machine,
          pos = v_target_pos,
          status = case when v_active_session.id is not null then 'PRODUZINDO' else coalesce(status, 'AGUARDANDO') end,
          finalized = false
    where id = v_order.id;

    if v_active_session.id is not null then
      insert into public.order_machine_sessions (
        order_id,
        machine_id,
        started_at,
        started_by
      ) values (
        v_order.id,
        p_target_machine,
        p_effective_at,
        nullif(p_actor, '')
      )
      returning id into v_new_session;
    end if;

    return jsonb_build_object(
      'order_id', v_order.id,
      'target_machine', p_target_machine,
      'pos', v_target_pos,
      'session_id', v_new_session,
      'status', case when v_active_session.id is not null then 'PRODUZINDO' else coalesce(v_order.status, 'AGUARDANDO') end
    );
  end;
  $$;

  create or replace function public.production_send_to_queue(
    p_order_id text,
    p_promoted_order_id text,
    p_effective_at timestamptz default timezone('utc', now()),
    p_actor text default null
  )
  returns jsonb
  language plpgsql
  as $$
  declare
    v_order public.orders;
    v_promoted public.orders;
    v_active_session public.order_machine_sessions;
    v_ids text[];
    v_id text;
    v_idx integer := 0;
    v_tail_pos integer := 0;
  begin
    select *
      into v_order
    from public.orders o
    where o.id::text = p_order_id
    for update;

    if not found then
      raise exception 'Ordem % nao encontrada', p_order_id;
    end if;

    select *
      into v_promoted
    from public.orders o
    where o.id::text = p_promoted_order_id
    for update;

    if not found then
      raise exception 'Ordem promovida % nao encontrada', p_promoted_order_id;
    end if;

    if v_promoted.machine_id::text <> v_order.machine_id::text then
      raise exception 'A ordem promovida precisa estar na mesma maquina da ordem atual';
    end if;

    v_active_session := public.production_get_active_session(p_order_id);
    if v_active_session.id is not null then
      perform public.production_sanitize_open_state(
        p_order_id => p_order_id,
        p_machine_id => v_order.machine_id::text,
        p_effective_at => p_effective_at,
        p_actor => p_actor,
        p_reason => 'QUEUED',
        p_close_session => true
      );
    else
      perform public.production_sanitize_open_state(
        p_order_id => p_order_id,
        p_machine_id => v_order.machine_id::text,
        p_effective_at => p_effective_at,
        p_actor => p_actor,
        p_reason => 'QUEUED',
        p_close_session => false
      );
    end if;

    select array_agg(o.id::text order by coalesce(o.pos, 999999), o.created_at, o.id::text)
      into v_ids
    from public.orders o
    where o.machine_id = v_order.machine_id
      and coalesce(o.finalized, false) = false;

    if v_ids is null or array_length(v_ids, 1) is null or array_length(v_ids, 1) < 2 then
      raise exception 'Nao ha fila suficiente para enviar a ordem para o fim';
    end if;

    v_idx := 0;
    foreach v_id in array v_ids loop
      v_idx := v_idx + 1;
      update public.orders
        set pos = 1000000 + v_idx
      where id::text = v_id;
    end loop;

    update public.orders
      set pos = 0,
          status = 'AGUARDANDO'
    where id = v_promoted.id;

    v_tail_pos := 1;
    foreach v_id in array v_ids loop
      if v_id in (p_order_id, p_promoted_order_id) then
        continue;
      end if;

      update public.orders
        set pos = v_tail_pos
      where id::text = v_id;
      v_tail_pos := v_tail_pos + 1;
    end loop;

    update public.orders
      set pos = v_tail_pos,
          status = 'AGUARDANDO'
    where id = v_order.id;

    return jsonb_build_object(
      'queued_order_id', v_order.id,
      'promoted_order_id', v_promoted.id,
      'machine_id', v_order.machine_id,
      'queued_position', v_tail_pos
    );
  end;
  $$;

  commit;