import { toTimestamp } from './productionIntervals';

export function isMissingRelationError(error, relationName = '') {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  const status = Number(error.status || 0);
  const haystack = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
  const relation = String(relationName || '').toLowerCase();
  const relationMentioned = relation ? haystack.includes(relation) : true;
  return relationMentioned && (status === 404 || code === 'PGRST205' || code === '42P01');
}

function sortByTimeAsc(items, key = 'started_at') {
  return [...items].sort((left, right) => {
    const leftTime = toTimestamp(left?.[key]) || 0;
    const rightTime = toTimestamp(right?.[key]) || 0;
    return leftTime - rightTime;
  });
}

export function mapRuntimeOrder(row) {
  if (!row) return null;

  return {
    ...row,
    source_order_id: row.id,
    status: row.status || row.persisted_status || 'AGUARDANDO',
    started_at: row.started_at || null,
    started_by: row.started_by || row.active_session_started_by || null,
    restarted_at: row.restarted_at || null,
    restarted_by: row.restarted_by || null,
    interrupted_at: row.interrupted_at || null,
    interrupted_by: row.interrupted_by || null,
    finalized_at: row.finalized_at || null,
    finalized_by: row.finalized_by || null,
    loweff_started_at: row.loweff_started_at || null,
    loweff_ended_at: row.loweff_ended_at || null,
    loweff_notes: row.loweff_notes || null,
    loweff_reason: row.loweff_reason || null,
    active_session_id: row.active_session_id || null,
    active_session_started_at: row.active_session_started_at || null,
    active_stop_started_at: row.active_stop_started_at || null,
    active_stop_reason: row.active_stop_reason || null,
    active_stop_notes: row.active_stop_notes || null,
    session_count: Number(row.session_count || 0),
  };
}

function buildSessionStatus(session, openStops, openLowEffLogs) {
  if (!session?.ended_at) {
    if (openStops.length) return 'PARADA';
    if (openLowEffLogs.length) return 'BAIXA_EFICIENCIA';
    return 'PRODUZINDO';
  }

  if (session.end_reason === 'FINALIZED') return 'FINALIZADA';
  if (session.end_reason === 'TRANSFERRED') return 'TRANSFERIDA';
  if (session.end_reason === 'QUEUED') return 'AGUARDANDO';
  return 'ENCERRADA';
}

export function buildRegistroGroups(runtimeOrders, sessions, stops, lowEffLogs) {
  const ordersById = new Map((runtimeOrders || []).map((order) => [String(order.id), order]));
  const stopsBySessionId = new Map();
  const lowEffBySessionId = new Map();
  const sessionsByOrderId = new Map();
  const stopsByOrderId = new Map();
  const lowEffByOrderId = new Map();

  for (const stop of stops || []) {
    const sessionKey = stop?.session_id ? String(stop.session_id) : null;
    if (!sessionKey) continue;
    if (!stopsBySessionId.has(sessionKey)) stopsBySessionId.set(sessionKey, []);
    stopsBySessionId.get(sessionKey).push(stop);
  }

  for (const stop of stops || []) {
    const orderKey = stop?.order_id != null ? String(stop.order_id) : null;
    if (!orderKey) continue;
    if (!stopsByOrderId.has(orderKey)) stopsByOrderId.set(orderKey, []);
    stopsByOrderId.get(orderKey).push(stop);
  }

  for (const event of lowEffLogs || []) {
    const sessionKey = event?.session_id ? String(event.session_id) : null;
    if (!sessionKey) continue;
    if (!lowEffBySessionId.has(sessionKey)) lowEffBySessionId.set(sessionKey, []);
    lowEffBySessionId.get(sessionKey).push(event);
  }

  for (const event of lowEffLogs || []) {
    const orderKey = event?.order_id != null ? String(event.order_id) : null;
    if (!orderKey) continue;
    if (!lowEffByOrderId.has(orderKey)) lowEffByOrderId.set(orderKey, []);
    lowEffByOrderId.get(orderKey).push(event);
  }

  for (const session of sessions || []) {
    const orderKey = session?.order_id != null ? String(session.order_id) : null;
    if (!orderKey) continue;
    if (!sessionsByOrderId.has(orderKey)) sessionsByOrderId.set(orderKey, []);
    sessionsByOrderId.get(orderKey).push(session);
  }

  const groups = [];
  const groupedOrderIds = new Set();

  for (const [orderId, orderSessions] of sessionsByOrderId.entries()) {
    groupedOrderIds.add(orderId);
    const runtimeOrder = ordersById.get(orderId);
    const sortedSessions = sortByTimeAsc(orderSessions);

    sortedSessions.forEach((session, index) => {
      const sessionKey = String(session.id);
      const sessionStops = sortByTimeAsc(stopsBySessionId.get(sessionKey) || []);
      const sessionLowEffLogs = sortByTimeAsc(lowEffBySessionId.get(sessionKey) || []);
      const openStops = sessionStops.filter((stop) => !stop?.ended_at && !stop?.resumed_at);
      const openLowEffLogs = sessionLowEffLogs.filter((event) => !event?.ended_at);
      const fakeId = `${orderId}:${sessionKey}`;
      const startedAt = session.started_at || runtimeOrder?.started_at || null;
      const finalizedAt = session.end_reason === 'FINALIZED' ? session.ended_at || runtimeOrder?.finalized_at || null : null;
      const interruptedAt = session.end_reason && session.end_reason !== 'FINALIZED' ? session.ended_at || null : null;

      groups.push({
        id: fakeId,
        orderId,
        session,
        sessionIndex: index + 1,
        sessions: [session],
        stops: sessionStops,
        lowEffLogs: sessionLowEffLogs,
        ordem: {
          ...(runtimeOrder || {}),
          id: fakeId,
          source_order_id: orderId,
          machine_id: session.machine_id || runtimeOrder?.machine_id || null,
          started_at: startedAt,
          started_by: session.started_by || runtimeOrder?.started_by || null,
          restarted_at: index > 0 ? session.started_at : null,
          restarted_by: index > 0 ? session.started_by || null : null,
          interrupted_at: interruptedAt,
          interrupted_by: interruptedAt ? session.ended_by || null : null,
          finalized_at: finalizedAt,
          finalized_by: finalizedAt ? session.ended_by || runtimeOrder?.finalized_by || null : null,
          status: buildSessionStatus(session, openStops, openLowEffLogs),
          loweff_started_at: openLowEffLogs[0]?.started_at || null,
          loweff_ended_at: openLowEffLogs[0]?.ended_at || null,
          loweff_notes: openLowEffLogs[0]?.notes || null,
          loweff_reason: openLowEffLogs[0]?.reason || null,
        },
      });
    });
  }

  for (const runtimeOrder of runtimeOrders || []) {
    const orderId = runtimeOrder?.source_order_id != null ? String(runtimeOrder.source_order_id) : String(runtimeOrder?.id || '');
    if (!orderId || groupedOrderIds.has(orderId)) continue;

    groups.push({
      id: `legacy:${orderId}`,
      orderId,
      session: null,
      sessionIndex: 1,
      sessions: [],
      stops: sortByTimeAsc(stopsByOrderId.get(orderId) || []),
      lowEffLogs: sortByTimeAsc(lowEffByOrderId.get(orderId) || []),
      ordem: {
        ...runtimeOrder,
        id: `legacy:${orderId}`,
        source_order_id: orderId,
      },
    });
  }

  groups.sort((left, right) => {
    const leftTime = toTimestamp(left?.ordem?.finalized_at || left?.ordem?.interrupted_at || left?.ordem?.started_at) || 0;
    const rightTime = toTimestamp(right?.ordem?.finalized_at || right?.ordem?.interrupted_at || right?.ordem?.started_at) || 0;
    return rightTime - leftTime;
  });

  return groups;
}

export function mapStopsForUi(stops) {
  return (stops || []).map((stop) => ({
    ...stop,
    ended_at: stop.ended_at || stop.resumed_at || null,
    resumed_at: stop.resumed_at || stop.ended_at || null,
    created_by: stop.created_by || stop.started_by || null,
    closed_by: stop.closed_by || stop.resumed_by || null,
    started_by: stop.started_by || stop.created_by || null,
    resumed_by: stop.resumed_by || stop.closed_by || null,
  }));
}

export function mapLowEffLogsForUi(events) {
  return (events || []).map((event) => ({
    ...event,
    created_by: event.created_by || event.started_by || null,
    closed_by: event.closed_by || event.ended_by || null,
    started_by: event.started_by || event.created_by || null,
    ended_by: event.ended_by || event.closed_by || null,
  }));
}