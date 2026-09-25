import { createClient } from '@supabase/supabase-js'
import { assertAiAssistantAdmin } from './ai-assistant-auth.js'

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const ZONE = 'America/Sao_Paulo'
const MAX_TOOL_ROWS = Number(process.env.AI_ASSISTANT_MAX_TOOL_ROWS || 2000)
const CACHE_TTL_MS = Number(process.env.AI_ASSISTANT_CACHE_TTL_MS || 60_000)
const EXPECTED_PRODUCTION_RATE = Number(process.env.AI_EXPECTED_PRODUCTION_RATE || 0.85)
const cache = new Map()

function text(value) {
  return String(value ?? '').trim()
}

function lower(value) {
  return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function toNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function nowInBrazil() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: ZONE }))
}

function dateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function hoursBetween(startValue, endValue) {
  const start = Date.parse(startValue || '')
  const end = Date.parse(endValue || '')
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  return (end - start) / 36e5
}

function startOfDay(date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function endOfDay(date) {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfWeek(date) {
  const next = startOfDay(date)
  const day = next.getDay() || 7
  next.setDate(next.getDate() - day + 1)
  return next
}

function startOfMonth(date) {
  const next = startOfDay(date)
  next.setDate(1)
  return next
}
function endOfMonth(date) {
  const next = startOfMonth(date)
  next.setMonth(next.getMonth() + 1)
  return new Date(next.getTime() - 1)
}

function toIso(date) {
  return date.toISOString()
}

function previousPeriod(period) {
  const start = new Date(period.start)
  const end = new Date(period.end)
  const duration = end.getTime() - start.getTime()
  const previousEnd = new Date(start.getTime() - 1)
  const previousStart = new Date(previousEnd.getTime() - duration)
  return {
    label: `periodo anterior a ${period.label}`,
    start: toIso(previousStart),
    end: toIso(previousEnd),
    startDate: dateKey(previousStart),
    endDate: dateKey(previousEnd),
  }
}

function endOfWeek(date) {
  return endOfDay(addDays(startOfWeek(date), 6))
}

function getShiftWindowsForDay(dateInput) {
  const base = new Date(dateInput)
  base.setHours(0, 0, 0, 0)
  const dayOfWeek = base.getDay()
  const windows = []

  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    windows.push([new Date(base).setHours(5, 0, 0, 0), new Date(base).setHours(13, 30, 0, 0)])
    windows.push([new Date(base).setHours(13, 30, 0, 0), new Date(base).setHours(22, 0, 0, 0)])
    windows.push([new Date(base).setHours(22, 0, 0, 0), new Date(base).setHours(29, 0, 0, 0)])
  } else if (dayOfWeek === 6) {
    windows.push([new Date(base).setHours(5, 0, 0, 0), new Date(base).setHours(9, 0, 0, 0)])
    windows.push([new Date(base).setHours(9, 0, 0, 0), new Date(base).setHours(13, 0, 0, 0)])
  } else if (dayOfWeek === 0) {
    const sundayWindowStart = new Date(base)
    sundayWindowStart.setHours(23, 0, 0, 0)
    const sundayWindowEnd = new Date(sundayWindowStart)
    sundayWindowEnd.setHours(29, 0, 0, 0)
    windows.push([sundayWindowStart.getTime(), sundayWindowEnd.getTime()])
  }

  return windows.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
}

export function getProductionWindowHours(startInput, endInput) {
  const startMs = Date.parse(startInput)
  const endMs = Date.parse(endInput)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0

  return getProductionIntervals(startMs, endMs).reduce((total, [intervalStart, intervalEnd]) => total + (intervalEnd - intervalStart), 0) / 36e5
}

function getProductionIntervals(startInput, endInput) {
  const startMs = typeof startInput === 'number' ? startInput : Date.parse(startInput)
  const endMs = typeof endInput === 'number' ? endInput : Date.parse(endInput)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return []

  const intervals = []
  const cursor = new Date(startMs)
  const end = new Date(endMs)
  const dayCursor = new Date(cursor)
  dayCursor.setHours(0, 0, 0, 0)

  while (dayCursor <= end) {
    for (const [windowStart, windowEnd] of getShiftWindowsForDay(dayCursor)) {
      const windowStartMs = Math.max(windowStart, startMs)
      const windowEndMs = Math.min(windowEnd, endMs)
      if (windowEndMs > windowStartMs) {
        intervals.push([windowStartMs, windowEndMs])
      }
    }
    dayCursor.setDate(dayCursor.getDate() + 1)
  }

  return intervals
}

function intersectInterval(left, right) {
  const start = Math.max(left[0], right[0])
  const end = Math.min(left[1], right[1])
  return end > start ? [start, end] : null
}

function mergeIntervals(intervals) {
  const sorted = intervals.filter((interval) => interval?.[1] > interval?.[0]).sort((left, right) => left[0] - right[0])
  const merged = []
  for (const interval of sorted) {
    const previous = merged[merged.length - 1]
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1])
    else merged.push([...interval])
  }
  return merged
}

function subtractIntervals(baseIntervals, excludedIntervals) {
  const excluded = mergeIntervals(excludedIntervals)
  return baseIntervals.flatMap(([baseStart, baseEnd]) => {
    const pieces = []
    let cursor = baseStart
    for (const [excludedStart, excludedEnd] of excluded) {
      if (excludedEnd <= cursor || excludedStart >= baseEnd) continue
      if (excludedStart > cursor) pieces.push([cursor, Math.min(excludedStart, baseEnd)])
      cursor = Math.max(cursor, excludedEnd)
      if (cursor >= baseEnd) break
    }
    if (cursor < baseEnd) pieces.push([cursor, baseEnd])
    return pieces
  })
}

function sumIntervals(intervals) {
  return intervals.reduce((total, [start, end]) => total + Math.max(0, end - start), 0)
}

function projectionPeriodFromPreset(preset) {
  const now = nowInBrazil()
  if (preset === 'ate_fim_dia') {
    return {
      label: 'de agora ate o fim do dia',
      start: toIso(now),
      end: toIso(endOfDay(now)),
      startDate: dateKey(now),
      endDate: dateKey(endOfDay(now)),
    }
  }

  if (preset === 'ate_fim_semana') {
    const end = endOfWeek(now)
    return {
      label: 'de agora ate o fim da semana',
      start: toIso(now),
      end: toIso(end),
      startDate: dateKey(now),
      endDate: dateKey(end),
    }
  }

  if (preset === 'ate_concluir_fila') {
    const end = addDays(now, 60)
    return {
      label: 'ate concluir a fila',
      start: toIso(now),
      end: toIso(end),
      startDate: dateKey(now),
      endDate: dateKey(end),
      openEnded: true,
    }
  }

  return periodFromPreset(preset || 'hoje_ate_agora')
}

function isPeriodComplete(period) {
  const end = Date.parse(period?.end || '')
  return Number.isFinite(end) ? end <= Date.now() : false
}

function buildMetric({ metric, value, unit, entity = null, period, source, description }) {
  return {
    metric,
    value,
    unit,
    entity,
    period_start: period?.start || null,
    period_end: period?.end || null,
    reference_time: new Date().toISOString(),
    period_complete: isPeriodComplete(period),
    source,
    description,
  }
}

function buildSemanticValidation({ entityType, entity, metric, unit, period = null, scope, source, suitableFor = [], notSuitableFor = [], notes = [] }) {
  return {
    entityType,
    entity,
    metric,
    unit,
    period_start: period?.start || null,
    period_end: period?.end || null,
    period_complete: period ? isPeriodComplete(period) : null,
    scope,
    source,
    suitableFor,
    notSuitableFor,
    notes,
  }
}

function getOrderPriority(order) {
  const status = lower(order?.status)
  if (status.includes('produzindo')) return 0
  if (status.includes('baixa')) return 1
  if (status.includes('parada')) return 2
  return 3
}

function compareCapacityOrders(left, right) {
  const priorityDiff = getOrderPriority(left) - getOrderPriority(right)
  if (priorityDiff !== 0) return priorityDiff

  const leftPos = Number.isFinite(Number(left?.pos)) ? Number(left.pos) : 999999
  const rightPos = Number.isFinite(Number(right?.pos)) ? Number(right.pos) : 999999
  if (leftPos !== rightPos) return leftPos - rightPos

  return (Date.parse(left?.created_at || '') || 0) - (Date.parse(right?.created_at || '') || 0)
}

function chooseCapacityOrders(openOrders) {
  const byMachine = new Map()
  for (const order of [...(openOrders || [])].sort(compareCapacityOrders)) {
    const machineId = text(order.machineId)
    if (!machineId || byMachine.has(machineId)) continue
    byMachine.set(machineId, order)
  }
  return Array.from(byMachine.values())
}

function buildSupabaseClient(req) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Supabase nao configurado no backend.')

  const token = text(req.headers.authorization).replace(/^Bearer\s+/i, '')
  if (!token) {
    const error = new Error('Sessao ausente. Faca login novamente.')
    error.statusCode = 401
    throw error
  }

  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function selectLimited(query, limit = MAX_TOOL_ROWS) {
  const { data, error } = await query.limit(limit)
  if (error) throw error
  return data || []
}

function groupSum(rows, keyGetter, valueGetter) {
  const map = new Map()
  for (const row of rows || []) {
    const key = keyGetter(row) || 'NAO_INFORMADO'
    map.set(key, (map.get(key) || 0) + toNumber(valueGetter(row)))
  }
  return Array.from(map.entries())
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value)
}

function top(rows, count = 10) {
  return rows.slice(0, count)
}

function extractProductCode(product) {
  return text(product).split('-')[0]?.trim() || ''
}

function normalizeOrderCode(value) {
  return text(value).replace(/^O\.?P\.?\s*/i, '').trim()
}

function mergeRowsById(rows) {
  const map = new Map()
  const withoutId = []
  for (const row of rows || []) {
    const id = text(row?.id)
    if (id) map.set(id, row)
    else withoutId.push(row)
  }
  return [...map.values(), ...withoutId]
}

async function fetchItemsByCodes(supabase, codes) {
  const cleanCodes = Array.from(new Set((codes || []).map(text).filter(Boolean)))
  if (!cleanCodes.length) return new Map()
  const rows = await selectLimited(
    supabase
      .from('items')
      .select('code, description, unit_value, cycle_seconds, cavities')
      .in('code', cleanCodes),
    5000
  )
  return new Map(rows.map((item) => [text(item.code), item]))
}

async function fetchProductionRowsForOrders(supabase, orders, period = null) {
  const orderCodes = Array.from(new Set((orders || []).map((order) => text(order.code)).filter(Boolean)))
  const empty = { data: [], error: null }

  function applyPeriod(query) {
    if (!period?.start || !period?.end) return query
    return query.gte('created_at', period.start).lte('created_at', period.end)
  }

  const [scansByCode, entriesByCode] = await Promise.all([
    orderCodes.length
      ? applyPeriod(supabase.from('production_scans').select('id, created_at, order_id, op_code, machine_id, qty_pieces').in('op_code', orderCodes))
      : Promise.resolve(empty),
    orderCodes.length
      ? applyPeriod(supabase.from('injection_production_entries').select('id, created_at, entry_date, order_id, order_code, machine_id, product, good_qty').in('order_code', orderCodes))
      : Promise.resolve(empty),
  ])

  if (scansByCode.error) throw scansByCode.error
  if (entriesByCode.error) throw entriesByCode.error
  return {
    scans: mergeRowsById(scansByCode.data || []),
    entries: mergeRowsById(entriesByCode.data || []),
  }
}

function summarizeProductionRows(scans, entries) {
  const scanPieces = (scans || []).reduce((sum, row) => sum + toNumber(row.qty_pieces), 0)
  const manualPieces = (entries || []).reduce((sum, row) => sum + toNumber(row.good_qty), 0)
  return {
    totalPieces: scanPieces + manualPieces,
    scanPieces,
    manualPieces,
    scanRecords: (scans || []).length,
    manualRecords: (entries || []).length,
  }
}

function durationHours(startValue, endValue, fallbackEnd, rangeStart, rangeEnd = fallbackEnd) {
  const start = Date.parse(startValue || '')
  const end = Date.parse(endValue || '') || Date.parse(fallbackEnd || '')
  const clampStart = Date.parse(rangeStart || '')
  const clampEnd = Date.parse(rangeEnd || fallbackEnd || '')
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  const safeStart = Number.isFinite(clampStart) ? Math.max(start, clampStart) : start
  const safeEnd = Number.isFinite(clampEnd) ? Math.min(end, clampEnd) : end
  if (safeEnd <= safeStart) return 0
  return (safeEnd - safeStart) / 36e5
}

function cacheKey(name, args, userId) {
  return `${userId || 'anon'}:${name}:${JSON.stringify(args)}`
}

async function cachedTool(name, args, userId, fn) {
  const key = cacheKey(name, args, userId)
  const cached = cache.get(key)
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return { ...cached.value, cached: true }
  }
  const value = await fn()
  cache.set(key, { createdAt: Date.now(), value })
  return value
}

async function fetchProductionSummary(supabase, period, filters = {}, userId) {
  return cachedTool('consultar_producao', { period, filters }, userId, async () => {
    const machineId = filters.machineId || null
    let scansQuery = supabase
      .from('production_scans')
      .select('id, created_at, order_id, op_code, machine_id, qty_pieces')
      .gte('created_at', period.start)
      .lte('created_at', period.end)
      .order('created_at', { ascending: false })
    let entriesQuery = supabase
      .from('injection_production_entries')
      .select('id, created_at, entry_date, order_id, order_code, machine_id, product, good_qty')
      .gte('created_at', period.start)
      .lte('created_at', period.end)
      .order('created_at', { ascending: false })

    if (machineId) {
      scansQuery = scansQuery.eq('machine_id', machineId)
      entriesQuery = entriesQuery.eq('machine_id', machineId)
    }

    const [scans, entries] = await Promise.all([
      selectLimited(scansQuery),
      selectLimited(entriesQuery),
    ])

    const scanPieces = scans.reduce((sum, row) => sum + toNumber(row.qty_pieces), 0)
    const manualPieces = entries.reduce((sum, row) => sum + toNumber(row.good_qty), 0)
    const byMachineMap = new Map()

    for (const row of scans) {
      const key = text(row.machine_id) || 'NAO_INFORMADO'
      const current = byMachineMap.get(key) || { machineId: key, pieces: 0, scanPieces: 0, manualPieces: 0, records: 0 }
      current.pieces += toNumber(row.qty_pieces)
      current.scanPieces += toNumber(row.qty_pieces)
      current.records += 1
      byMachineMap.set(key, current)
    }
    for (const row of entries) {
      const key = text(row.machine_id) || 'NAO_INFORMADO'
      const current = byMachineMap.get(key) || { machineId: key, pieces: 0, scanPieces: 0, manualPieces: 0, records: 0 }
      current.pieces += toNumber(row.good_qty)
      current.manualPieces += toNumber(row.good_qty)
      current.records += 1
      byMachineMap.set(key, current)
    }

    const byMachine = Array.from(byMachineMap.values()).sort((a, b) => b.pieces - a.pieces)
    return {
      tool: 'consultar_producao',
      period,
      filters,
      result: {
        semanticValidation: [buildSemanticValidation({
          entityType: machineId ? 'maquina' : 'conjunto_maquinas',
          entity: machineId || 'todas_as_maquinas',
          metric: 'producao_realizada',
          unit: 'pecas',
          period,
          scope: 'producao_apontada_no_intervalo',
          source: 'production_scans + injection_production_entries',
          suitableFor: ['responder quantidade produzida no periodo', 'calcular valor produzido quando combinado com valor unitario correto'],
          notSuitableFor: ['calcular saldo de uma OP especifica sem filtrar a OP', 'concluir acima/abaixo do esperado sem referencia comparavel'],
          notes: ['Se a pergunta citar uma OP, produto ou lote especifico, use ferramenta especifica antes de responder.'],
        })],
        metrics: [buildMetric({
          metric: 'producao_realizada',
          value: scanPieces + manualPieces,
          unit: 'pecas',
          entity: machineId || 'todas_as_maquinas',
          period,
          source: 'production_scans + injection_production_entries',
          description: 'Producao realizada no intervalo consultado. E um dado parcial se period_complete=false.',
        })],
        totalPieces: scanPieces + manualPieces,
        scanPieces,
        manualPieces,
        scanRecords: scans.length,
        manualRecords: entries.length,
        byMachine: top(byMachine, 20),
        limitApplied: scans.length >= MAX_TOOL_ROWS || entries.length >= MAX_TOOL_ROWS,
      },
      sources: [`production_scans - ${period.label}`, `injection_production_entries - ${period.label}`],
    }
  })
}

async function fetchStopSummary(supabase, period, filters = {}, userId) {
  return cachedTool('consultar_paradas', { period, filters }, userId, async () => {
    const machineId = filters.machineId || null
    let query = supabase
      .from('machine_stops')
      .select('id, order_id, machine_id, reason, started_at, resumed_at')
      .lt('started_at', period.end)
      .or(`resumed_at.gte.${period.start},resumed_at.is.null`)
      .order('started_at', { ascending: false })
    if (machineId) query = query.eq('machine_id', machineId)
    const rows = await selectLimited(query)
    const enriched = rows.map((row) => ({
      machineId: text(row.machine_id) || 'NAO_INFORMADO',
      reason: text(row.reason) || 'NAO_INFORMADO',
      hours: durationHours(row.started_at, row.resumed_at, period.end, period.start, period.end),
    }))
    const totalStopHours = enriched.reduce((sum, row) => sum + row.hours, 0)
    return {
      tool: 'consultar_paradas',
      period,
      filters,
      result: {
        metrics: [buildMetric({
          metric: 'tempo_parado',
          value: Number(totalStopHours.toFixed(2)),
          unit: 'horas',
          entity: machineId || 'todas_as_maquinas',
          period,
          source: 'machine_stops',
          description: 'Tempo de parada sobreposto ao intervalo consultado, agrupavel por maquina e motivo.',
        })],
        totalStopHours: Number(totalStopHours.toFixed(2)),
        stopEvents: rows.length,
        byMachine: top(groupSum(enriched, (row) => row.machineId, (row) => row.hours), 20),
        byReason: top(groupSum(enriched, (row) => row.reason, (row) => row.hours), 20),
        limitApplied: rows.length >= MAX_TOOL_ROWS,
      },
      sources: [`machine_stops - ${period.label}`],
    }
  })
}

async function fetchScrapSummary(supabase, period, filters = {}, userId) {
  return cachedTool('consultar_refugos', { period, filters }, userId, async () => {
    const machineId = filters.machineId || null
    let query = supabase
      .from('scrap_logs')
      .select('id, created_at, order_id, op_code, machine_id, qty, reason')
      .gte('created_at', period.start)
      .lte('created_at', period.end)
      .order('created_at', { ascending: false })
    if (machineId) query = query.eq('machine_id', machineId)
    const rows = await selectLimited(query)
    const orderIds = Array.from(new Set(rows.map((row) => text(row.order_id)).filter(Boolean)))
    const orderRows = orderIds.length
      ? await selectLimited(supabase.from('orders').select('id, code').in('id', orderIds), 5000)
      : []
    const orderCodeById = new Map(orderRows.map((order) => [text(order.id), text(order.code)]))
    const totalScrap = rows.reduce((sum, row) => sum + toNumber(row.qty), 0)
    const scrapByOrder = new Map()
    for (const row of rows) {
      const orderCode = text(row.op_code) || orderCodeById.get(text(row.order_id)) || text(row.order_id) || 'SEM_OP'
      const current = scrapByOrder.get(orderCode) || { orderCode, pieces: 0, events: 0, machineId: text(row.machine_id) }
      current.pieces += toNumber(row.qty)
      current.events += 1
      scrapByOrder.set(orderCode, current)
    }
    const byOrder = Array.from(scrapByOrder.values()).sort((left, right) => right.pieces - left.pieces)
    return {
      tool: 'consultar_refugos',
      period,
      filters,
      result: {
        metrics: [buildMetric({
          metric: 'refugo_registrado',
          value: totalScrap,
          unit: 'pecas',
          entity: machineId || 'todas_as_maquinas',
          period,
          source: 'scrap_logs',
          description: 'Quantidade absoluta de refugo. Nao classifica se esta alto ou baixo sem referencia comparavel.',
        })],
        totalScrap,
        scrapEvents: rows.length,
        byMachine: top(groupSum(rows, (row) => text(row.machine_id), (row) => row.qty), 20),
        byReason: top(groupSum(rows, (row) => text(row.reason), (row) => row.qty), 20),
        byOrder: top(byOrder, 20),
        highestScrapOrder: byOrder[0] || null,
        byProduct: top(groupSum(rows, (row) => text(row.op_code), (row) => row.qty), 20),
        limitApplied: rows.length >= MAX_TOOL_ROWS,
      },
      sources: [`scrap_logs - ${period.label}`],
    }
  })
}

async function fetchOeeSummary(supabase, period, filters = {}, userId) {
  return cachedTool('consultar_oee', { period, filters }, userId, async () => {
    const machineId = filters.machineId || null
    let sessionsQuery = supabase
      .from('order_machine_sessions')
      .select('id, order_id, machine_id, started_at, ended_at')
      .lt('started_at', period.end)
      .or(`ended_at.gte.${period.start},ended_at.is.null`)
    let stopsQuery = supabase
      .from('machine_stops')
      .select('id, order_id, machine_id, started_at, resumed_at, reason')
      .lt('started_at', period.end)
      .or(`resumed_at.gte.${period.start},resumed_at.is.null`)
    let scansQuery = supabase
      .from('production_scans')
      .select('order_id, machine_id, qty_pieces')
      .gte('created_at', period.start)
      .lte('created_at', period.end)
    let entriesQuery = supabase
      .from('injection_production_entries')
      .select('order_id, machine_id, good_qty')
      .gte('created_at', period.start)
      .lte('created_at', period.end)
    let scrapsQuery = supabase
      .from('scrap_logs')
      .select('order_id, machine_id, qty')
      .gte('created_at', period.start)
      .lte('created_at', period.end)
    if (machineId) {
      sessionsQuery = sessionsQuery.eq('machine_id', machineId)
      stopsQuery = stopsQuery.eq('machine_id', machineId)
      scansQuery = scansQuery.eq('machine_id', machineId)
      entriesQuery = entriesQuery.eq('machine_id', machineId)
      scrapsQuery = scrapsQuery.eq('machine_id', machineId)
    }

    const [sessions, stops, scans, entries, scraps] = await Promise.all([
      selectLimited(sessionsQuery, 5000),
      selectLimited(stopsQuery, 5000),
      selectLimited(scansQuery, 5000),
      selectLimited(entriesQuery, 5000),
      selectLimited(scrapsQuery, 5000),
    ])
    const orderIds = Array.from(new Set([...sessions, ...scans, ...entries, ...scraps].map((row) => text(row.order_id)).filter(Boolean)))
    const orders = orderIds.length
      ? await selectLimited(supabase.from('orders').select('id, machine_id, product').in('id', orderIds), 5000)
      : []
    const items = await selectLimited(supabase.from('items').select('code, cycle_seconds, cavities').limit(5000), 5000)
    const orderById = new Map(orders.map((order) => [text(order.id), order]))
    const itemByCode = new Map(items.map((item) => [text(item.code), item]))
    const plannedIntervals = getProductionIntervals(period.start, period.end)
    const machineIds = new Set([
      ...sessions.map((row) => text(row.machine_id)),
      ...scans.map((row) => text(row.machine_id)),
      ...entries.map((row) => text(row.machine_id)),
      ...scraps.map((row) => text(row.machine_id)),
    ].filter(Boolean))
    const byMachine = []

    for (const currentMachineId of machineIds) {
      const machineSessions = sessions.filter((row) => text(row.machine_id) === currentMachineId)
      const loadedIntervals = mergeIntervals(machineSessions.flatMap((session) => {
        const start = Date.parse(session.started_at)
        const end = Date.parse(session.ended_at || period.end)
        if (!Number.isFinite(start) || !Number.isFinite(end)) return []
        return plannedIntervals.map((interval) => intersectInterval(interval, [Math.max(start, Date.parse(period.start)), Math.min(end, Date.parse(period.end))])).filter(Boolean)
      }))
      const stopIntervals = stops.filter((row) => text(row.machine_id) === currentMachineId && lower(row.reason) !== 'parada programada').flatMap((stop) => {
        const start = Date.parse(stop.started_at)
        const end = Date.parse(stop.resumed_at || period.end)
        if (!Number.isFinite(start) || !Number.isFinite(end)) return []
        return loadedIntervals.map((interval) => intersectInterval(interval, [start, end])).filter(Boolean)
      })
      const runtimeIntervals = subtractIntervals(loadedIntervals, stopIntervals)
      let idealPieces = 0
      const periodStartMs = Date.parse(period.start)
      const periodEndMs = Date.parse(period.end)
      const orderedSessions = [...machineSessions].sort((left, right) => (Date.parse(left.started_at) || 0) - (Date.parse(right.started_at) || 0))
      for (const [sessionIndex, session] of orderedSessions.entries()) {
        const order = orderById.get(text(session.order_id))
        const productCode = extractProductCode(order?.product)
        const item = itemByCode.get(productCode) || {}
        const cycleSeconds = toNumber(item.cycle_seconds)
        const cavities = toNumber(item.cavities)
        const piecesPerHour = cycleSeconds > 0 && cavities > 0 ? (3600 / cycleSeconds) * cavities : 0
        const start = Date.parse(session.started_at)
        const end = Date.parse(session.ended_at || period.end)
        if (piecesPerHour <= 0 || !Number.isFinite(start) || !Number.isFinite(end)) continue
        const effectiveStart = sessionIndex === 0 ? periodStartMs : Math.max(start, periodStartMs)
        const effectiveEnd = Math.min(end, periodEndMs)
        if (Number.isFinite(effectiveStart) && Number.isFinite(effectiveEnd) && effectiveEnd > effectiveStart) {
          idealPieces += ((effectiveEnd - effectiveStart) / 36e5) * piecesPerHour
        }
      }
      const goodPieces = scans.filter((row) => text(row.machine_id) === currentMachineId).reduce((sum, row) => sum + toNumber(row.qty_pieces), 0)
        + entries.filter((row) => text(row.machine_id) === currentMachineId).reduce((sum, row) => sum + toNumber(row.good_qty), 0)
      const scrapPieces = scraps.filter((row) => text(row.machine_id) === currentMachineId).reduce((sum, row) => sum + toNumber(row.qty), 0)
      const loadedHours = sumIntervals(loadedIntervals) / 36e5
      const stopHours = sumIntervals(stopIntervals) / 36e5
      const runtimeHours = sumIntervals(runtimeIntervals) / 36e5
      const actualPieces = goodPieces + scrapPieces
      const availability = loadedHours > 0 ? Math.max(0, (loadedHours - stopHours) / loadedHours) : null
      const performance = idealPieces > 0 ? Math.max(0, actualPieces / idealPieces) : null
      const quality = actualPieces > 0 ? Math.max(0, goodPieces / actualPieces) : 1
      const oee = availability != null && performance != null ? Math.min(1, availability) * Math.min(1, performance) * Math.min(1, quality) : null
      byMachine.push({ machineId: currentMachineId, oeePercent: oee == null ? null : Number((Math.min(1, oee) * 100).toFixed(2)), availabilityPercent: availability == null ? null : Number((Math.min(1, availability) * 100).toFixed(2)), performancePercent: performance == null ? null : Number((Math.min(1, performance) * 100).toFixed(2)), qualityPercent: Number((Math.min(1, quality) * 100).toFixed(2)), loadedHours: Number(loadedHours.toFixed(2)), stopHours: Number(stopHours.toFixed(2)), runtimeHours: Number(runtimeHours.toFixed(2)), actualPieces, goodPieces, scrapPieces, idealPieces: Number(idealPieces.toFixed(0)) })
    }

    const selected = machineId ? byMachine.filter((item) => item.machineId === machineId) : byMachine
    const totals = selected.reduce((total, item) => ({ loadedHours: total.loadedHours + item.loadedHours, stopHours: total.stopHours + item.stopHours, idealPieces: total.idealPieces + item.idealPieces, actualPieces: total.actualPieces + item.actualPieces, goodPieces: total.goodPieces + item.goodPieces, scrapPieces: total.scrapPieces + item.scrapPieces }), { loadedHours: 0, stopHours: 0, idealPieces: 0, actualPieces: 0, goodPieces: 0, scrapPieces: 0 })
    const availability = totals.loadedHours > 0 ? (totals.loadedHours - totals.stopHours) / totals.loadedHours : null
    const performance = totals.idealPieces > 0 ? totals.actualPieces / totals.idealPieces : null
    const quality = totals.actualPieces > 0 ? totals.goodPieces / totals.actualPieces : 1
    const oee = availability != null && performance != null ? Math.min(1, availability) * Math.min(1, performance) * Math.min(1, quality) : null
    return { tool: 'consultar_oee', period, filters, result: { oeePercent: oee == null ? null : Number((Math.min(1, oee) * 100).toFixed(2)), availabilityPercent: availability == null ? null : Number((Math.min(1, availability) * 100).toFixed(2)), performancePercent: performance == null ? null : Number((Math.min(1, performance) * 100).toFixed(2)), qualityPercent: Number((Math.min(1, quality) * 100).toFixed(2)), actualPieces: totals.actualPieces, goodPieces: totals.goodPieces, scrapPieces: totals.scrapPieces, idealPieces: Number(totals.idealPieces.toFixed(0)), loadedHours: Number(totals.loadedHours.toFixed(2)), stopHours: Number(totals.stopHours.toFixed(2)), byMachine: top(selected, 50), metrics: [{ metric: 'oee', value: oee == null ? null : Number((Math.min(1, oee) * 100).toFixed(2)), unit: 'percentual', entity: machineId || 'todas_as_maquinas', period_start: period.start, period_end: period.end, description: 'OEE calculado por disponibilidade, performance e qualidade no intervalo solicitado.' }] }, sources: ['order_machine_sessions', 'machine_stops', 'production_scans', 'injection_production_entries', 'scrap_logs', 'items'] }
  })
}

async function fetchMachineSituationSummary(supabase, period, filters = {}, userId) {
  return cachedTool('consultar_situacao_maquina', { period, filters }, userId, async () => {
    const machineId = filters.machineId
    if (!machineId) throw new Error('Informe a maquina para consultar a situacao operacional.')
    const { data: orders, error } = await supabase
      .from('production_orders_runtime_v')
      .select('id, code, machine_id, product, status, qty, active_session_id, active_session_started_at, active_stop_started_at, active_stop_reason, active_stop_notes, loweff_started_at, loweff_ended_at, loweff_reason, loweff_notes, pos')
      .eq('machine_id', machineId)
      .eq('finalized', false)
      .order('pos', { ascending: true })
      .limit(20)
    if (error) throw error

    const production = await fetchProductionSummary(supabase, period, { machineId }, userId)
    const current = orders?.find((order) => order.active_session_id || order.loweff_started_at || order.active_stop_started_at) || orders?.[0] || null
    let state = 'sem_programacao'
    let stateLabel = 'Sem programação'
    if (current?.loweff_started_at && !current?.loweff_ended_at) {
      state = 'baixa_eficiencia'
      stateLabel = 'Baixa eficiência'
    } else if (current?.active_stop_started_at) {
      state = 'parada'
      stateLabel = 'Parada'
    } else if (current?.active_session_id) {
      state = 'produzindo'
      stateLabel = 'Produzindo'
    } else if (current) {
      state = 'aguardando'
      stateLabel = 'Aguardando'
    }

    return {
      tool: 'consultar_situacao_maquina',
      period,
      filters,
      result: {
        machineId,
        state,
        stateLabel,
        order: current ? { code: text(current.code), product: text(current.product), status: text(current.status) } : null,
        lowEfficiency: state === 'baixa_eficiencia'
          ? { reason: text(current.loweff_reason), notes: text(current.loweff_notes), startedAt: current.loweff_started_at }
          : null,
        activeStop: state === 'parada'
          ? { reason: text(current.active_stop_reason), notes: text(current.active_stop_notes), startedAt: current.active_stop_started_at }
          : null,
        productionTodayPieces: production.result.totalPieces,
        openOrders: orders?.length || 0,
        metrics: [{ metric: 'situacao_maquina', value: stateLabel, unit: 'status', entity: machineId, period_start: period.start, period_end: period.end, description: 'Estado operacional atual da maquina conforme runtime da O.P. e apontamentos ativos.' }],
      },
      sources: ['production_orders_runtime_v', 'production_scans', 'injection_production_entries'],
    }
  })
}

async function fetchCapacitySummary(supabase, period, filters = {}, userId) {
  return cachedTool('consultar_capacidade', { period, filters }, userId, async () => {
    const machineId = filters.machineId || null
    let ordersQuery = supabase
      .from('orders')
      .select('id, machine_id, code, product, qty, standard, unit_value, status, pos, finalized, created_at, finalized_at')
      .eq('finalized', false)
      .order('pos', { ascending: true })
      .order('created_at', { ascending: true })
    if (machineId) ordersQuery = ordersQuery.eq('machine_id', machineId)

    const [orders, items, production] = await Promise.all([
      selectLimited(ordersQuery, 500),
      selectLimited(supabase.from('items').select('code, cycle_seconds, cavities, unit_value').limit(5000), 5000),
      fetchProductionSummary(supabase, period, filters, userId),
    ])

    const productionValue = await fetchProductionValueSummary(supabase, period, filters, userId)

    const productionRows = await fetchProductionRowsForOrders(supabase, orders)
    const producedByOrder = new Map()
    const ordersById = new Map(orders.map((order) => [text(order.id), order]))
    const ordersByCode = new Map(orders.map((order) => [text(order.code), order]))
    const registerProduced = (order, pieces) => {
      const orderId = text(order?.id)
      if (!orderId) return
      producedByOrder.set(orderId, (producedByOrder.get(orderId) || 0) + toNumber(pieces))
    }
    for (const row of productionRows.scans) {
      registerProduced(ordersById.get(text(row.order_id)) || ordersByCode.get(text(row.op_code)), row.qty_pieces)
    }
    for (const row of productionRows.entries) {
      registerProduced(ordersById.get(text(row.order_id)) || ordersByCode.get(text(row.order_code)), row.good_qty)
    }

    const itemByCode = new Map((items || []).map((item) => [text(item.code), item]))
    const openOrders = orders.map((order) => {
      const productCode = text(order.product).split('-')[0]?.trim()
      const item = itemByCode.get(productCode) || {}
      const cycleSeconds = toNumber(item.cycle_seconds)
      const cavities = toNumber(item.cavities)
      const nominalPiecesPerHour = cycleSeconds > 0 && cavities > 0 ? (3600 / cycleSeconds) * cavities : 0
      return {
        id: text(order.id),
        machineId: text(order.machine_id),
        code: text(order.code),
        qty: toNumber(order.qty),
        producedQty: toNumber(producedByOrder.get(text(order.id))),
        status: text(order.status),
        pos: toNumber(order.pos),
        productCode,
        cycleSeconds,
        cavities,
        unitValue: toNumber(order.unit_value) > 0 ? toNumber(order.unit_value) : toNumber(item.unit_value),
        nominalPiecesPerHour: Number(nominalPiecesPerHour.toFixed(2)),
      }
    })
    const machines = Array.from(new Set(openOrders.map((order) => order.machineId).filter(Boolean)))
    const machineQueues = new Map()
    for (const order of openOrders) {
      const machineKey = text(order.machineId)
      if (!machineKey) continue
      if (!machineQueues.has(machineKey)) machineQueues.set(machineKey, [])
      machineQueues.get(machineKey).push(order)
    }

    const now = Date.now()
    const nowDate = nowInBrazil()
    const periodStartMs = Date.parse(period.start)
    const periodEndMs = Date.parse(period.end)
    const effectiveWindowStartMs = Number.isFinite(periodStartMs) ? Math.max(now, periodStartMs) : now
    const effectiveWindowEndMs = Number.isFinite(periodEndMs) ? periodEndMs : now
    const workingHoursInPeriod = getProductionWindowHours(new Date(effectiveWindowStartMs).toISOString(), new Date(effectiveWindowEndMs).toISOString())
    const elapsedHours = Math.max(0, (Math.min(now, effectiveWindowEndMs) - effectiveWindowStartMs) / 36e5)
    const remainingHours = Math.max(0, workingHoursInPeriod - elapsedHours)
    const capacityPeriod = {
      start: period.start || toIso(startOfDay(nowDate)),
      end: period.end || toIso(endOfDay(nowDate)),
    }
    const availableHours = Number(Math.max(0, workingHoursInPeriod).toFixed(2))
    const capacityByMachine = []
    const producedValueByMachine = new Map((productionValue.result.byMachine || []).map((item) => [text(item.machineId), toNumber(item.value)]))
    const producedPiecesByMachine = new Map((production.result.byMachine || []).map((item) => [text(item.machineId), toNumber(item.pieces)]))
    let nominalPiecesPerHour = 0
    let remainingCapacityPieces = 0
    let remainingCapacityValue = 0
    const capacityByOrder = []
    const productionIntervals = getProductionIntervals(effectiveWindowStartMs, effectiveWindowEndMs)

    for (const [machineKey, machineOrders] of machineQueues.entries()) {
      const sortedOrders = [...machineOrders].sort(compareCapacityOrders)
      let intervalIndex = 0
      let cursorMs = productionIntervals[0]?.[0] || effectiveWindowEndMs
      let machineNominal = 0
      let machineCapacityPieces = 0
      let machineCapacityValue = 0

      for (const order of sortedOrders) {
        const expectedPiecesPerHour = toNumber(order.nominalPiecesPerHour) * EXPECTED_PRODUCTION_RATE
        if (expectedPiecesPerHour <= 0) continue

        machineNominal += toNumber(order.nominalPiecesPerHour)
        const remainingOrderPieces = Math.max(0, toNumber(order.qty) - toNumber(order.producedQty))
        if (remainingOrderPieces <= 0) continue

        let projectedPiecesForOrder = 0
        let orderStartMs = null
        let orderEndMs = null
        let orderCursorMs = cursorMs
        const pauses = []

        while (remainingOrderPieces > projectedPiecesForOrder && intervalIndex < productionIntervals.length) {
          const [intervalStartMs, intervalEndMs] = productionIntervals[intervalIndex]
          orderCursorMs = Math.max(orderCursorMs, intervalStartMs)
          if (orderCursorMs >= intervalEndMs) {
            intervalIndex += 1
            continue
          }

          if (orderStartMs == null) orderStartMs = orderCursorMs
          const availableHours = (intervalEndMs - orderCursorMs) / 36e5
          const piecesInInterval = Math.min(
            remainingOrderPieces - projectedPiecesForOrder,
            Math.floor(expectedPiecesPerHour * availableHours),
          )
          if (piecesInInterval <= 0) {
            intervalIndex += 1
            orderCursorMs = productionIntervals[intervalIndex]?.[0] || effectiveWindowEndMs
            continue
          }

          projectedPiecesForOrder += piecesInInterval
          orderCursorMs += (piecesInInterval / expectedPiecesPerHour) * 36e5
          if (projectedPiecesForOrder >= remainingOrderPieces) {
            orderEndMs = orderCursorMs
            break
          }

          intervalIndex += 1
          const nextIntervalStartMs = productionIntervals[intervalIndex]?.[0]
          if (nextIntervalStartMs == null) break
          const pauseStartDate = new Date(orderCursorMs)
          const pauseEndDate = new Date(nextIntervalStartMs)
          const pauseReason = [pauseStartDate.getDay(), pauseEndDate.getDay()].some((day) => day === 0 || day === 6)
            ? 'fim de semana'
            : 'fora do turno produtivo'
          pauses.push({ start: toIso(pauseStartDate), end: toIso(pauseEndDate), reason: pauseReason })
          orderCursorMs = nextIntervalStartMs
        }

        if (projectedPiecesForOrder <= 0) break

        machineCapacityPieces += projectedPiecesForOrder
        machineCapacityValue += projectedPiecesForOrder * toNumber(order.unitValue)
        cursorMs = orderCursorMs
        capacityByOrder.push({
          machineId: machineKey,
          orderCode: order.code,
          productCode: order.productCode,
          nominalPiecesPerHour: Number(toNumber(order.nominalPiecesPerHour).toFixed(2)),
          expectedPiecesPerHour: Number(expectedPiecesPerHour.toFixed(2)),
          efficiency: EXPECTED_PRODUCTION_RATE,
          plannedPieces: toNumber(order.qty),
          producedPiecesBeforePeriod: toNumber(order.producedQty),
          remainingPiecesBeforeProjection: remainingOrderPieces,
          projectedPieces: projectedPiecesForOrder,
          remainingPiecesAfterProjection: remainingOrderPieces - projectedPiecesForOrder,
          unitValue: Number(toNumber(order.unitValue).toFixed(4)),
          projectedValue: Number((projectedPiecesForOrder * toNumber(order.unitValue)).toFixed(2)),
          startsAt: orderStartMs == null ? null : toIso(new Date(orderStartMs)),
          finishesAt: orderEndMs == null ? null : toIso(new Date(orderEndMs)),
          pauses,
        })
      }

      if (machineNominal > 0) {
        nominalPiecesPerHour += machineNominal
      }
      remainingCapacityPieces += machineCapacityPieces
      remainingCapacityValue += machineCapacityValue
      capacityByMachine.push({
        machineId: machineKey,
        nominalPiecesPerHour: Number(machineNominal.toFixed(2)),
        remainingCapacityPieces: machineCapacityPieces,
        remainingCapacityValue: Number(machineCapacityValue.toFixed(2)),
        producedPieces: Number((producedPiecesByMachine.get(machineKey) || 0).toFixed(0)),
        producedValue: Number((producedValueByMachine.get(machineKey) || 0).toFixed(2)),
        projectedTotalPieces: Number(((producedPiecesByMachine.get(machineKey) || 0) + machineCapacityPieces).toFixed(0)),
        projectedTotalValue: Number(((producedValueByMachine.get(machineKey) || 0) + machineCapacityValue).toFixed(2)),
        dailyCapacityValue: Number(((producedValueByMachine.get(machineKey) || 0) + machineCapacityValue).toFixed(2)),
      })
    }

    const capacityMachineIds = new Set(capacityByMachine.map((item) => item.machineId))
    for (const item of productionValue.result.byMachine || []) {
      const productionMachineId = text(item.machineId)
      if (!productionMachineId || capacityMachineIds.has(productionMachineId)) continue
      capacityByMachine.push({
        machineId: productionMachineId,
        nominalPiecesPerHour: 0,
        remainingCapacityPieces: 0,
        remainingCapacityValue: 0,
        producedPieces: Number((producedPiecesByMachine.get(productionMachineId) || 0).toFixed(0)),
        producedValue: Number(toNumber(item.value).toFixed(2)),
        projectedTotalPieces: Number((producedPiecesByMachine.get(productionMachineId) || 0).toFixed(0)),
        projectedTotalValue: Number(toNumber(item.value).toFixed(2)),
        dailyCapacityValue: Number(toNumber(item.value).toFixed(2)),
      })
    }

    const capacityOrders = chooseCapacityOrders(openOrders)
    const producedValue = toNumber(productionValue.result.totalValue)
    const dailyCapacityPieces = Number((production.result.totalPieces + remainingCapacityPieces).toFixed(0))
    const dailyCapacityValue = Number((producedValue + remainingCapacityValue).toFixed(2))
    const remainingCapacityPiecesRounded = Number(remainingCapacityPieces.toFixed(0))
    const projectedTotalPieces = dailyCapacityPieces
    const projectedRemainingValue = Number(remainingCapacityValue.toFixed(2))
    const projectedTotalValueApprox = dailyCapacityValue

    return {
      tool: 'consultar_capacidade',
      period,
      filters,
      result: {
        semanticValidation: [buildSemanticValidation({
          entityType: machineId ? 'maquina' : 'conjunto_maquinas',
          entity: machineId || 'todas_as_maquinas',
          metric: 'capacidade_esperada_diaria',
          unit: 'pecas',
          period: capacityPeriod,
          scope: 'capacidade_esperada_do_periodo',
          source: 'fila sequencial da maquina + items.cycle_seconds + items.cavities + valor unitario',
          suitableFor: ['responder capacidade esperada do periodo', 'simular meta, programacao e valor esperado quando combinado com a fila da maquina'],
          notSuitableFor: ['substituir producao realizada', 'comparar diretamente com o que ja foi produzido sem ajustar o periodo', 'calcular saldo de OP especifica sem considerar a OP em questao'],
          notes: ['Capacidade esperada considera somente a fila sequencial que cabe no periodo informado, horas produtivas disponiveis, meta aplicada e valor esperado.'],
        })],
        metrics: [
          buildMetric({
            metric: 'capacidade_esperada_diaria',
            value: dailyCapacityPieces,
            unit: 'pecas',
            entity: machineId || 'todas_as_maquinas',
            period: capacityPeriod,
            source: 'fila sequencial da maquina + items.cycle_seconds + items.cavities',
            description: 'Capacidade esperada do periodo, conforme fila sequencial da maquina, meta aplicada e horas produtivas disponiveis.',
          }),
          buildMetric({
            metric: 'valor_esperado_diario',
            value: Number(dailyCapacityValue.toFixed(2)),
            unit: 'BRL',
            entity: machineId || 'todas_as_maquinas',
            period: capacityPeriod,
            source: 'fila sequencial da maquina + items.unit_value',
            description: 'Valor esperado da capacidade do periodo, com base na fila da maquina, meta aplicada e valor unitario do produto.',
          }),
        ],
        comparisonSafety: {
          canCompareWithPartialProduction: false,
          reason: 'Capacidade diaria cobre o periodo completo; producao parcial so e comparavel com referencia do mesmo intervalo.',
        },
        programmedMachines: machines.length,
        openOrders: openOrders.length,
        selectedCapacityOrders: capacityOrders,
        capacityByOrder: top(capacityByOrder, 200),
        backlogOpenPieces: openOrders.reduce((sum, order) => sum + order.qty, 0),
        nominalPiecesPerHour: Number(nominalPiecesPerHour.toFixed(2)),
        availableHours,
        dailyCapacityPieces,
        dailyCapacityValue,
        producedValue: Number(producedValue.toFixed(2)),
        remainingCapacityPieces: remainingCapacityPiecesRounded,
        remainingCapacityValue: projectedRemainingValue,
        elapsedHours: Number(elapsedHours.toFixed(2)),
        remainingHours: Number(remainingHours.toFixed(2)),
        projectedTotalPieces,
        projectedRemainingValue: Number(projectedRemainingValue.toFixed(2)),
        projectedTotalValueApprox: Number(projectedTotalValueApprox.toFixed(2)),
        productionSoFarPieces: production.result.totalPieces,
        capacityByMachine: top(capacityByMachine, 20),
        byMachine: top(groupSum(capacityOrders, (row) => row.machineId, (row) => row.nominalPiecesPerHour), 20),
      },
      sources: ['orders abertas', 'items - cycle_seconds/cavities', ...production.sources],
    }
  })
}

async function fetchPlannedVsActualSummary(supabase, period, filters = {}, userId) {
  return cachedTool('consultar_planejado_realizado', { period, filters }, userId, async () => {
    const [production, capacity] = await Promise.all([
      fetchProductionSummary(supabase, period, filters, userId),
      fetchCapacitySummary(supabase, period, filters, userId),
    ])

    const actualPieces = toNumber(production.result.totalPieces)
    const nominalPiecesPerHour = toNumber(capacity.result.nominalPiecesPerHour)
    const sameIntervalHours = Number(hoursBetween(period.start, period.end).toFixed(2))
    const theoreticalSameIntervalPieces = Number((nominalPiecesPerHour * sameIntervalHours).toFixed(0))
    const expectedPieces = Number((nominalPiecesPerHour * EXPECTED_PRODUCTION_RATE * sameIntervalHours).toFixed(0))
    const difference = actualPieces - expectedPieces
    const differencePercent = expectedPieces > 0 ? Number(((difference / expectedPieces) * 100).toFixed(2)) : null
    const entity = filters.machineId || 'todas_as_maquinas'

    return {
      tool: 'consultar_planejado_realizado',
      period,
      filters,
      result: {
        semanticValidation: [buildSemanticValidation({
          entityType: filters.machineId ? 'maquina' : 'conjunto_maquinas',
          entity,
          metric: 'planejado_vs_realizado_mesmo_intervalo',
          unit: 'pecas',
          period,
          scope: 'comparacao_mesmo_intervalo',
          source: 'production_scans + injection_production_entries + regra 85% da capacidade nominal',
          suitableFor: ['avaliar acima/abaixo do esperado para o mesmo intervalo'],
          notSuitableFor: ['comparar periodo parcial com periodo completo', 'atribuir causa da diferenca sem investigar paradas/refugo'],
          notes: ['A referencia esperada usa a regra configurada: pecas/hora x eficiencia x horas do mesmo intervalo.'],
        })],
        metrics: [
          buildMetric({
            metric: 'producao_realizada',
            value: actualPieces,
            unit: 'pecas',
            entity,
            period,
            source: 'production_scans + injection_production_entries',
            description: 'Producao realizada no mesmo intervalo solicitado.',
          }),
          buildMetric({
            metric: 'planejado_esperado_mesmo_intervalo',
            value: expectedPieces,
            unit: 'pecas',
            entity,
            period,
            source: 'items.cycle_seconds + items.cavities + AI_EXPECTED_PRODUCTION_RATE',
            description: `Meta esperada para o mesmo intervalo calculada por pecas/hora x ${Math.round(EXPECTED_PRODUCTION_RATE * 100)}%.`,
          }),
        ],
        actual: {
          metric: 'producao_realizada',
          value: actualPieces,
          unit: 'pecas',
          period_start: period.start,
          period_end: period.end,
        },
        expected: {
          metric: 'planejado_esperado_mesmo_intervalo',
          value: expectedPieces,
          unit: 'pecas',
          period_start: period.start,
          period_end: period.end,
          rate: EXPECTED_PRODUCTION_RATE,
          nominalPiecesPerHour,
          hours: sameIntervalHours,
        },
        difference,
        difference_percent: differencePercent,
        comparable: expectedPieces > 0,
        comparison_basis: `Meta esperada = pecas/hora x ${Math.round(EXPECTED_PRODUCTION_RATE * 100)}% x horas do mesmo intervalo.`,
        reason: expectedPieces > 0 ? null : 'Nao foi possivel calcular esperado porque falta taxa nominal de pecas/hora ou horas validas no intervalo.',
        availableReference: {
          metric: 'capacidade_esperada_mesmo_intervalo',
          value: theoreticalSameIntervalPieces,
          unit: 'pecas',
          comparableAsExpected: false,
          description: 'Capacidade esperada do mesmo intervalo antes do fator de meta aplicada.',
        },
      },
      sources: [...production.sources, ...capacity.sources],
    }
  })
}

async function fetchProductionOrderSummary(supabase, orderCode, userId) {
  const code = normalizeOrderCode(orderCode)
  return cachedTool('consultar_ordem_producao', { code }, userId, async () => {
    if (!code) throw new Error('Codigo da O.P. ausente.')

    const orders = await selectLimited(
      supabase
        .from('orders')
        .select('id, machine_id, code, product, qty, boxes, standard, unit_value, status, pos, finalized, finalized_at, created_at, updated_at')
        .eq('code', code)
        .order('created_at', { ascending: false }),
      20
    )

    const { scans, entries } = await fetchProductionRowsForOrders(supabase, orders)
    const production = summarizeProductionRows(scans, entries)
    const productCodes = orders.map((order) => extractProductCode(order.product)).filter(Boolean)
    const itemsByCode = await fetchItemsByCodes(supabase, productCodes)
    const primaryOrder = orders[0] || null
    const productCode = extractProductCode(primaryOrder?.product)
    const item = itemsByCode.get(productCode) || {}
    const unitValue = toNumber(primaryOrder?.unit_value) > 0 ? toNumber(primaryOrder.unit_value) : toNumber(item.unit_value)
    const plannedPieces = orders.reduce((sum, order) => sum + toNumber(order.qty), 0)
    const remainingPieces = Math.max(0, plannedPieces - production.totalPieces)

    return {
      tool: 'consultar_ordem_producao',
      period: null,
      filters: { orderCode: code },
      result: {
        semanticValidation: [buildSemanticValidation({
          entityType: 'op',
          entity: `OP ${code}`,
          metric: 'saldo_op',
          unit: 'pecas',
          period: null,
          scope: 'ordem_producao_especifica',
          source: 'orders.qty - producao da mesma OP por order_id/op_code/order_code',
          suitableFor: ['responder quanto falta produzir da OP', 'responder produzido da OP', 'calcular valor restante da OP'],
          notSuitableFor: ['avaliar desempenho temporal sem janela e referencia', 'responder producao geral da maquina'],
          notes: ['Para saldo de OP, nao use capacidade, meta temporal ou producao agregada geral.'],
        })],
        found: orders.length > 0,
        orderCode: code,
        orders: orders.map((order) => ({
          id: order.id,
          code: order.code,
          machineId: order.machine_id,
          product: order.product,
          qty: toNumber(order.qty),
          boxes: toNumber(order.boxes),
          standard: order.standard,
          unitValue: toNumber(order.unit_value) > 0 ? toNumber(order.unit_value) : toNumber(item.unit_value),
          status: order.status,
          pos: order.pos,
          finalized: !!order.finalized,
          finalizedAt: order.finalized_at,
        })),
        productCode,
        unitValue,
        plannedPieces,
        producedPieces: production.totalPieces,
        remainingPieces,
        producedValue: Number((production.totalPieces * unitValue).toFixed(2)),
        remainingValue: Number((remainingPieces * unitValue).toFixed(2)),
        plannedValue: Number((plannedPieces * unitValue).toFixed(2)),
        production,
        metrics: [
          buildMetric({
            metric: 'producao_op',
            value: production.totalPieces,
            unit: 'pecas',
            entity: `OP ${code}`,
            period: null,
            source: 'production_scans + injection_production_entries',
            description: 'Pecas produzidas/apontadas para a O.P. especifica, casando por order_id e codigo da O.P.',
          }),
          buildMetric({
            metric: 'saldo_op',
            value: remainingPieces,
            unit: 'pecas',
            entity: `OP ${code}`,
            period: null,
            source: 'orders.qty - producao_op',
            description: 'Saldo estimado da O.P. com base na quantidade planejada da ordem menos producao apontada.',
          }),
        ],
      },
      sources: [`orders.code=${code}`, 'production_scans', 'injection_production_entries', 'items.unit_value'],
    }
  })
}

async function fetchMachineOrdersSummary(supabase, machineId, userId) {
  const normalizedMachine = normalizeMachineId(machineId)
  return cachedTool('consultar_ordens_maquina', { machineId: normalizedMachine }, userId, async () => {
    if (!normalizedMachine) throw new Error('Maquina invalida ou ausente.')

    const orders = await selectLimited(
      supabase
        .from('orders')
        .select('id, machine_id, code, product, qty, boxes, standard, status, pos, finalized, finalized_at, created_at, updated_at')
        .eq('machine_id', normalizedMachine)
        .eq('finalized', false)
        .order('pos', { ascending: true })
        .order('created_at', { ascending: true }),
      500
    )

    const productCodes = orders.map((order) => extractProductCode(order.product)).filter(Boolean)
    const itemsByCode = await fetchItemsByCodes(supabase, productCodes)
    const enrichedOrders = orders.map((order) => {
      const productCode = extractProductCode(order.product)
      const item = itemsByCode.get(productCode) || {}
      const unitValue = toNumber(order.unit_value) > 0 ? toNumber(order.unit_value) : toNumber(item.unit_value)
      const qty = toNumber(order.qty)
      return {
        id: order.id,
        code: order.code,
        machineId: order.machine_id,
        product: order.product,
        productCode,
        qty,
        boxes: toNumber(order.boxes),
        standard: order.standard,
        status: order.status,
        pos: order.pos,
        unitValue,
        orderValue: Number((qty * unitValue).toFixed(2)),
      }
    })
    const byStatus = groupSum(enrichedOrders, (order) => text(order.status) || 'SEM_STATUS', () => 1)
    const totalPieces = enrichedOrders.reduce((sum, order) => sum + order.qty, 0)
    const totalValue = enrichedOrders.reduce((sum, order) => sum + order.orderValue, 0)

    return {
      tool: 'consultar_ordens_maquina',
      period: null,
      filters: { machineId: normalizedMachine },
      result: {
        semanticValidation: [buildSemanticValidation({
          entityType: 'maquina',
          entity: normalizedMachine,
          metric: 'ops_abertas_maquina',
          unit: 'ordens',
          period: null,
          scope: 'fila_aberta_da_maquina',
          source: 'orders.finalized=false por machine_id',
          suitableFor: ['responder quantas OPs estao lancadas/abertas na maquina', 'responder pecas planejadas na fila da maquina'],
          notSuitableFor: ['responder producao realizada', 'concluir atraso sem comparar realizado vs esperado'],
          notes: ['Pecas lancadas em OPs nao sao pecas produzidas.'],
        })],
        machineId: normalizedMachine,
        openOrdersCount: enrichedOrders.length,
        totalPlannedPieces: totalPieces,
        totalPlannedValue: Number(totalValue.toFixed(2)),
        byStatus,
        orders: top(enrichedOrders, 50),
        metrics: [
          buildMetric({
            metric: 'ops_abertas_maquina',
            value: enrichedOrders.length,
            unit: 'ordens',
            entity: normalizedMachine,
            period: null,
            source: 'orders',
            description: 'Quantidade de O.Ps abertas/lancadas para a maquina informada.',
          }),
          buildMetric({
            metric: 'pecas_lancadas_maquina',
            value: totalPieces,
            unit: 'pecas',
            entity: normalizedMachine,
            period: null,
            source: 'orders.qty',
            description: 'Soma das quantidades das O.Ps abertas da maquina. Nao representa producao realizada.',
          }),
        ],
      },
      sources: [`orders.machine_id=${normalizedMachine}`, 'items.unit_value'],
    }
  })
}

async function fetchProductionValueSummary(supabase, period, filters = {}, userId) {
  return cachedTool('consultar_valorizacao_producao', { period, filters }, userId, async () => {
    const machineId = filters.machineId || null
    let ordersQuery = supabase
      .from('orders')
      .select('id, machine_id, code, product, qty, unit_value, status, finalized, created_at')
      .order('created_at', { ascending: false })
      .limit(2000)
    if (machineId) ordersQuery = ordersQuery.eq('machine_id', machineId)
    const orders = await selectLimited(ordersQuery, 2000)
    const { scans, entries } = await fetchProductionRowsForOrders(supabase, orders, period)
    const productCodes = orders.map((order) => extractProductCode(order.product)).filter(Boolean)
    const itemsByCode = await fetchItemsByCodes(supabase, productCodes)
    const ordersById = new Map(orders.map((order) => [text(order.id), order]))
    const ordersByCode = new Map(orders.map((order) => [text(order.code), order]))
    const byProduct = new Map()
    const byMachine = new Map()

    function addValue({ order, pieces, machineId }) {
      const productCode = extractProductCode(order?.product)
      const item = itemsByCode.get(productCode) || {}
      const unitValue = toNumber(order?.unit_value) > 0 ? toNumber(order.unit_value) : toNumber(item.unit_value)
      const current = byProduct.get(productCode || 'NAO_INFORMADO') || { productCode: productCode || 'NAO_INFORMADO', pieces: 0, value: 0, unitValue }
      current.pieces += toNumber(pieces)
      current.value += toNumber(pieces) * unitValue
      current.unitValue = unitValue
      byProduct.set(current.productCode, current)
      const currentMachineId = text(order?.machine_id) || text(machineId) || 'NAO_INFORMADO'
      const machine = byMachine.get(currentMachineId) || { machineId: currentMachineId, pieces: 0, value: 0 }
      machine.pieces += toNumber(pieces)
      machine.value += toNumber(pieces) * unitValue
      byMachine.set(currentMachineId, machine)
    }

    for (const scan of scans) {
      const order = ordersById.get(text(scan.order_id)) || ordersByCode.get(text(scan.op_code))
      addValue({ order, machineId: scan.machine_id, pieces: toNumber(scan.qty_pieces) })
    }
    for (const entry of entries) {
      const order = ordersById.get(text(entry.order_id)) || ordersByCode.get(text(entry.order_code)) || { product: entry.product }
      addValue({ order, machineId: entry.machine_id, pieces: toNumber(entry.good_qty) })
    }

    const products = Array.from(byProduct.values()).map((item) => ({ ...item, value: Number(item.value.toFixed(2)) })).sort((a, b) => b.value - a.value)
    const machines = Array.from(byMachine.values()).map((item) => ({ ...item, value: Number(item.value.toFixed(2)) })).sort((a, b) => b.value - a.value)
    const totalPieces = products.reduce((sum, item) => sum + item.pieces, 0)
    const totalValue = products.reduce((sum, item) => sum + item.value, 0)

    return {
      tool: 'consultar_valorizacao_producao',
      period,
      filters,
      result: {
        semanticValidation: [buildSemanticValidation({
          entityType: machineId ? 'maquina' : 'conjunto_maquinas',
          entity: machineId || 'todas_as_maquinas',
          metric: 'valor_producao_realizada',
          unit: 'BRL',
          period,
          scope: 'valor_da_producao_realizada_no_intervalo',
          source: 'production_scans + injection_production_entries + items.unit_value',
          suitableFor: ['responder valor produzido/faturamento realizado no periodo'],
          notSuitableFor: ['responder valor planejado da carteira', 'responder capacidade financeira futura sem projetar_producao'],
          notes: ['Valor produzido considera somente apontamentos realizados no periodo.'],
        })],
        totalPieces,
        totalValue: Number(totalValue.toFixed(2)),
        byProduct: top(products, 20),
        byMachine: top(machines, 20),
        metrics: [buildMetric({
          metric: 'valor_producao_realizada',
          value: Number(totalValue.toFixed(2)),
          unit: 'BRL',
          entity: machineId || 'todas_as_maquinas',
          period,
          source: 'production_scans + injection_production_entries + items.unit_value',
          description: 'Valor estimado da producao realizada no periodo usando valor unitario do cadastro de itens.',
        })],
      },
      sources: ['production_scans', 'injection_production_entries', 'orders', 'items.unit_value'],
    }
  })
}

async function fetchProductionProjection(supabase, args = {}, userId) {
  const machineId = normalizeMachineId(args.maquina_id)
  const targetOpCode = normalizeOrderCode(args.op_alvo)
  const projectionType = text(args.tipo) || 'projecao'
  const requestedPeriod = text(args.periodo) || 'ate_fim_dia'
  const targetRequiresQueueReach = !!targetOpCode && ['inicio_op', 'termino_op', 'tempo_ate_op'].includes(projectionType)
  const effectivePeriodPreset = projectionType === 'linha_tempo' || targetRequiresQueueReach ? 'ate_concluir_fila' : requestedPeriod
  const efficiencyRaw = Number(args.eficiencia)
  const efficiency = Number.isFinite(efficiencyRaw) && efficiencyRaw > 0 && efficiencyRaw <= 1
    ? efficiencyRaw
    : EXPECTED_PRODUCTION_RATE
  const opCodes = Array.isArray(args.codigos_op)
    ? Array.from(new Set(args.codigos_op.map(normalizeOrderCode).filter(Boolean)))
    : []
  const period = projectionPeriodFromPreset(effectivePeriodPreset)
  const shouldFilterSpecificOps = opCodes.length && !targetOpCode && projectionType !== 'linha_tempo' && !machineId

  return cachedTool('projetar_producao', { machineId, targetOpCode, opCodes, requestedPeriod, effectivePeriodPreset, period, efficiency, projectionType }, userId, async () => {
    let query = supabase
      .from('orders')
      .select('id, machine_id, code, product, qty, boxes, standard, status, pos, finalized, finalized_at, created_at, updated_at')
      .eq('finalized', false)
      .order('machine_id', { ascending: true })
      .order('pos', { ascending: true })
      .order('created_at', { ascending: true })

    if (machineId) query = query.eq('machine_id', machineId)
    if (shouldFilterSpecificOps) query = query.in('code', opCodes)

    const orders = await selectLimited(query, 1000)
    const productCodes = orders.map((order) => extractProductCode(order.product)).filter(Boolean)
    const itemsByCode = await fetchItemsByCodes(supabase, productCodes)
    const { scans, entries } = await fetchProductionRowsForOrders(supabase, orders)
    const productionByOrder = new Map()

    function registerProduced(orderKey, pieces) {
      if (!orderKey) return
      productionByOrder.set(orderKey, (productionByOrder.get(orderKey) || 0) + toNumber(pieces))
    }

    const ordersById = new Map(orders.map((order) => [text(order.id), order]))
    const ordersByCode = new Map(orders.map((order) => [text(order.code), order]))
    for (const scan of scans) {
      const order = ordersById.get(text(scan.order_id)) || ordersByCode.get(text(scan.op_code))
      registerProduced(text(order?.id), scan.qty_pieces)
    }
    for (const entry of entries) {
      const order = ordersById.get(text(entry.order_id)) || ordersByCode.get(text(entry.order_code))
      registerProduced(text(order?.id), entry.good_qty)
    }

    const projectionStartMs = Date.parse(period.start)
    const projectionEndMs = Date.parse(period.end)
    const hasValidWindow = Number.isFinite(projectionStartMs) && Number.isFinite(projectionEndMs) && projectionEndMs > projectionStartMs
    const machines = new Map()

    for (const order of orders) {
      const currentMachineId = text(order.machine_id) || 'SEM_MAQUINA'
      if (!machines.has(currentMachineId)) machines.set(currentMachineId, [])
      machines.get(currentMachineId).push(order)
    }

    const machineResults = []
    let targetProjection = null
    const validationIssues = []
    let totalProjectedPieces = 0
    let totalProjectedValue = 0
    let totalProducedPieces = 0
    let totalRemainingPieces = 0

    for (const [currentMachineId, machineOrders] of machines.entries()) {
      let cursorMs = projectionStartMs
      const projectedOrders = []
      let queueBlockedBeforeNextOrder = false

      for (const order of machineOrders.sort(compareCapacityOrders)) {
        const productCode = extractProductCode(order.product)
        const item = itemsByCode.get(productCode) || {}
        const cycleSeconds = toNumber(item.cycle_seconds)
        const cavities = toNumber(item.cavities)
        const unitValue = toNumber(item.unit_value)
        const theoreticalPiecesPerHour = cycleSeconds > 0 && cavities > 0 ? (3600 / cycleSeconds) * cavities : 0
        const projectedPiecesPerHour = theoreticalPiecesPerHour * efficiency
        const producedPieces = toNumber(productionByOrder.get(text(order.id)))
        const plannedPieces = toNumber(order.qty)
        const remainingPieces = Math.max(0, plannedPieces - producedPieces)
        totalProducedPieces += producedPieces
        totalRemainingPieces += remainingPieces

        let projectedPieces = 0
        let projectedValue = 0
        let startsAt = Number.isFinite(cursorMs) && !queueBlockedBeforeNextOrder ? new Date(cursorMs).toISOString() : null
        let finishesAt = null
        let consumesWindow = false
        const missingTechnicalData = remainingPieces > 0 && !(cycleSeconds > 0 && cavities > 0)

        if (remainingPieces <= 0) {
          finishesAt = startsAt
        }

        if (missingTechnicalData) {
          validationIssues.push({
            code: order.code,
            machineId: currentMachineId,
            issue: 'missing_cycle_or_cavities',
            message: 'OP sem ciclo ou cavidades validos; nao foi possivel projetar tempo de producao.',
          })
        }

        if (!queueBlockedBeforeNextOrder && remainingPieces > 0 && projectedPiecesPerHour > 0 && hasValidWindow && cursorMs < projectionEndMs) {
          const availableHours = (projectionEndMs - cursorMs) / 36e5
          const possiblePieces = Math.floor(projectedPiecesPerHour * availableHours)
          projectedPieces = Math.min(remainingPieces, Math.max(0, possiblePieces))
          projectedValue = projectedPieces * unitValue
          const hoursToProduceProjected = projectedPieces / projectedPiecesPerHour
          const projectedEndMs = cursorMs + hoursToProduceProjected * 36e5
          finishesAt = projectedPieces >= remainingPieces ? new Date(projectedEndMs).toISOString() : null
          consumesWindow = projectedPieces < remainingPieces
          cursorMs = projectedPieces >= remainingPieces ? projectedEndMs : projectionEndMs
          if (projectedPieces < remainingPieces) queueBlockedBeforeNextOrder = true
        } else if (remainingPieces > 0 && missingTechnicalData) {
          queueBlockedBeforeNextOrder = true
        }

        totalProjectedPieces += projectedPieces
        totalProjectedValue += projectedValue

        const projectedOrder = {
          orderId: order.id,
          code: order.code,
          machineId: currentMachineId,
          product: order.product,
          productCode,
          status: order.status,
          pos: order.pos,
          plannedPieces,
          producedPieces,
          remainingPieces,
          cycleSeconds,
          cavities,
          unitValue,
          theoreticalPiecesPerHour: Number(theoreticalPiecesPerHour.toFixed(2)),
          efficiency,
          projectedPiecesPerHour: Number(projectedPiecesPerHour.toFixed(2)),
          projectedPieces,
          projectedValue: Number(projectedValue.toFixed(2)),
          startsAt,
          finishesAt,
          fullyProjectedInWindow: projectedPieces >= remainingPieces,
          consumesWindow,
          startsWithinWindow: !!startsAt,
          blockedByPreviousOrder: !startsAt && queueBlockedBeforeNextOrder,
          missingTechnicalData,
          isTarget: targetOpCode ? text(order.code) === targetOpCode : false,
        }

        projectedOrders.push(projectedOrder)

        if (projectedOrder.isTarget) {
          const targetStartMs = Date.parse(projectedOrder.startsAt || '')
          const previousOrders = projectedOrders
            .filter((item) => !item.isTarget)
            .map((item) => ({
              code: item.code,
              startsAt: item.startsAt,
              finishesAt: item.finishesAt,
              remainingPieces: item.remainingPieces,
              projectedPiecesPerHour: item.projectedPiecesPerHour,
              fullyProjectedInWindow: item.fullyProjectedInWindow,
              missingTechnicalData: item.missingTechnicalData,
            }))
          const blockingPreviousOrder = previousOrders.find((item) => item.remainingPieces > 0 && (!item.finishesAt || item.missingTechnicalData)) || null
          targetProjection = {
            ...projectedOrder,
            found: true,
            requested: targetOpCode,
            queuePosition: projectedOrders.length,
            previousOrdersConsidered: previousOrders,
            previousOrdersConsideredCount: previousOrders.length,
            queueValidation: {
              consideredPreviousOrders: true,
              valid: !blockingPreviousOrder,
              blockingPreviousOrder,
              message: blockingPreviousOrder
                ? `Nao foi possivel validar totalmente o inicio da OP alvo porque a OP anterior ${blockingPreviousOrder.code} nao teve termino projetado valido.`
                : 'Inicio da OP alvo calculado a partir do termino projetado da OP imediatamente anterior na fila.',
            },
            startsInHours: Number.isFinite(targetStartMs) ? Number(((targetStartMs - projectionStartMs) / 36e5).toFixed(2)) : null,
            canDetermineStart: !!projectedOrder.startsAt && !projectedOrder.missingTechnicalData && !blockingPreviousOrder,
            canDetermineFinish: !!projectedOrder.finishesAt,
            reason: projectedOrder.missingTechnicalData
              ? 'OP alvo esta na fila, mas esta sem ciclo/cavidades validos.'
              : blockingPreviousOrder
                ? `OP anterior ${blockingPreviousOrder.code} nao termina dentro da janela ou esta sem dados tecnicos; por isso o inicio da OP alvo nao pode ser confirmado nessa janela.`
                : projectedOrder.startsAt
                  ? (projectedOrder.finishesAt ? null : 'OP alvo inicia na janela, mas nao termina dentro da janela projetada.')
                  : 'OP alvo nao inicia dentro da janela projetada.',
          }
        }

        if (hasValidWindow && cursorMs >= projectionEndMs) {
          continue
        }
      }

      machineResults.push({
        machineId: currentMachineId,
        orders: projectedOrders,
        projectedPieces: projectedOrders.reduce((sum, order) => sum + order.projectedPieces, 0),
        projectedValue: Number(projectedOrders.reduce((sum, order) => sum + order.projectedValue, 0).toFixed(2)),
        queueFinishAt: projectedOrders.length ? projectedOrders[projectedOrders.length - 1].finishesAt : null,
      })
    }

    if (targetOpCode && !targetProjection) {
      validationIssues.push({
        code: targetOpCode,
        issue: 'target_op_not_found_in_queue',
        message: machineId
          ? `OP alvo ${targetOpCode} nao foi encontrada na fila aberta da maquina ${machineId}.`
          : `OP alvo ${targetOpCode} nao foi encontrada na fila aberta consultada.`,
      })
      targetProjection = {
        found: false,
        requested: targetOpCode,
        reason: machineId
          ? `OP alvo ${targetOpCode} nao esta na fila aberta da maquina ${machineId}.`
          : `OP alvo ${targetOpCode} nao foi encontrada na fila aberta consultada.`,
      }
    }

    return {
      tool: 'projetar_producao',
      period,
      filters: { machineId, opCodes, targetOpCode, requestedPeriod, effectivePeriodPreset, efficiency, projectionType },
      result: {
        semanticValidation: [buildSemanticValidation({
          entityType: machineId ? 'maquina' : opCodes.length ? 'op' : 'conjunto_maquinas',
          entity: machineId || (opCodes.length ? `OPs ${opCodes.join(', ')}` : 'todas_as_maquinas'),
          metric: 'projecao_producao_possivel',
          unit: 'pecas',
          period,
          scope: 'simulacao_sequencial_na_janela',
          source: 'orders + producao apontada + items.cycle_seconds/cavities/unit_value',
          suitableFor: ['responder previsao de producao futura', 'responder quando terminam OPs', 'projetar valor futuro na janela'],
          notSuitableFor: ['responder producao ja realizada sozinha', 'substituir apontamento real quando a pergunta pede realizado'],
          notes: ['Usa MIN(saldo da OP, capacidade disponivel na janela) e avanca para a proxima OP somente quando a anterior termina.'],
        })],
        efficiency,
        windowStart: period.start,
        windowEnd: period.end,
        requestedPeriod,
        effectivePeriodPreset,
        targetRequiresQueueReach,
        openEnded: !!period.openEnded,
        totalProducedPieces,
        totalRemainingPieces,
        projectedPieces: totalProjectedPieces,
        projectedValue: Number(totalProjectedValue.toFixed(2)),
        projectedTotalPieces: totalProducedPieces + totalProjectedPieces,
        targetProjection,
        validationIssues,
        machines: machineResults,
        metrics: [
          buildMetric({
            metric: 'projecao_producao_possivel',
            value: totalProjectedPieces,
            unit: 'pecas',
            entity: machineId || (opCodes.length ? `OPs ${opCodes.join(', ')}` : 'todas_as_maquinas'),
            period,
            source: 'orders + production_scans + injection_production_entries + items.cycle_seconds/cavities/unit_value',
            description: 'Projecao deterministica: MIN(saldo da OP, capacidade disponivel na janela), simulando OPs sequencialmente por maquina.',
          }),
          buildMetric({
            metric: 'valor_projetado_producao_possivel',
            value: Number(totalProjectedValue.toFixed(2)),
            unit: 'BRL',
            entity: machineId || (opCodes.length ? `OPs ${opCodes.join(', ')}` : 'todas_as_maquinas'),
            period,
            source: 'items.unit_value',
            description: 'Valor projetado da producao possivel na janela, usando valor unitario de cada OP/produto.',
          }),
        ],
      },
      sources: ['orders', 'production_scans', 'injection_production_entries', 'items'],
    }
  })
}

function compactToolResults(toolResults) {
  return toolResults.map(({ tool, period, filters, result, cached }) => ({ tool, period, filters, result, cached: !!cached }))
}

function buildSources(toolResults) {
  return Array.from(new Set(toolResults.flatMap((item) => item.sources || []))).slice(0, 12)
}

const ASSISTANT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'consultar_producao',
      description: 'Consulta producao agregada em pecas por periodo e opcionalmente por maquina.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          periodo: { type: 'string', enum: ['hoje_ate_agora', 'hoje_completo', 'ontem', 'esta_semana', 'este_mes', 'ultimas_24h', 'ultimos_30_dias'] },
          maquina_id: { type: 'string', description: 'Opcional. Ex: P1, P2, I4.' },
        },
        required: ['periodo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_capacidade',
      description: 'Calcula a capacidade esperada do periodo e o valor esperado usando fila sequencial, ciclo, cavidades, horas produtivas e valor unitario.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          periodo: { type: 'string', enum: ['hoje_ate_agora', 'hoje_completo', 'ontem', 'esta_semana', 'este_mes', 'ate_fim_mes'] },
          maquina_id: { type: 'string', description: 'Opcional. Ex: P1, P2, I4. Omitir para todas as maquinas.' },
        },
        required: ['periodo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_paradas',
      description: 'Consulta paradas agregadas por maquina e motivo em horas.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          periodo: { type: 'string', enum: ['hoje_ate_agora', 'hoje_completo', 'ontem', 'esta_semana', 'este_mes', 'ultimas_24h', 'ultimos_30_dias'] },
          maquina_id: { type: 'string', description: 'Opcional. Ex: P1, P2, I4.' },
        },
        required: ['periodo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_refugos',
      description: 'Consulta refugos agregados por maquina, motivo e produto/O.P.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          periodo: { type: 'string', enum: ['hoje_ate_agora', 'hoje_completo', 'ontem', 'esta_semana', 'este_mes', 'ultimas_24h', 'ultimos_30_dias'] },
          maquina_id: { type: 'string', description: 'Opcional. Ex: P1, P2, I4.' },
        },
        required: ['periodo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_oee',
      description: 'Calcula o OEE do periodo por disponibilidade, performance e qualidade, com detalhamento por maquina.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          periodo: { type: 'string', enum: ['hoje_ate_agora', 'hoje_completo', 'ontem', 'esta_semana', 'este_mes'] },
          maquina_id: { type: 'string', description: 'Opcional. Ex: P1, P2, I4.' },
        },
        required: ['periodo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_situacao_maquina',
      description: 'Consulta o estado operacional atual da maquina: sem programacao, parada, produzindo, aguardando ou baixa eficiencia.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          periodo: { type: 'string', enum: ['hoje_ate_agora'] },
          maquina_id: { type: 'string', description: 'Obrigatorio. Ex: P1, P2, I4.' },
        },
        required: ['periodo', 'maquina_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'comparar_producao_periodo_anterior',
      description: 'Compara producao agregada do periodo solicitado contra periodo anterior equivalente.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          periodo: { type: 'string', enum: ['hoje_ate_agora', 'ontem', 'esta_semana', 'este_mes', 'ultimas_24h', 'ultimos_30_dias'] },
          maquina_id: { type: 'string', description: 'Opcional. Ex: P1, P2, I4.' },
        },
        required: ['periodo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_planejado_realizado',
      description: 'Verifica se ha referencia comparavel de planejado/esperado contra realizado no mesmo intervalo. Retorna comparable=false se nao houver planejado suficiente.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          periodo: { type: 'string', enum: ['hoje_ate_agora', 'hoje_completo', 'ontem', 'esta_semana', 'este_mes', 'ultimas_24h', 'ultimos_30_dias'] },
          maquina_id: { type: 'string', description: 'Opcional. Ex: P1, P2, I4.' },
        },
        required: ['periodo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_ordem_producao',
      description: 'Consulta uma O.P. especifica por codigo, incluindo quantidade planejada, produzido, saldo a produzir, valor unitario e valores totais.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          codigo_op: { type: 'string', description: 'Codigo da O.P. Ex: 2147.' },
        },
        required: ['codigo_op'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_ordens_maquina',
      description: 'Consulta O.Ps abertas/lancadas de uma maquina, com contagem, pecas lancadas e valor planejado.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          maquina_id: { type: 'string', description: 'Maquina. Ex: P1, P2, I4.' },
        },
        required: ['maquina_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_valorizacao_producao',
      description: 'Calcula valor da producao realizada no periodo usando valor unitario do cadastro de itens.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          periodo: { type: 'string', enum: ['hoje_ate_agora', 'hoje_completo', 'ontem', 'esta_semana', 'este_mes', 'ultimas_24h', 'ultimos_30_dias'] },
          maquina_id: { type: 'string', description: 'Opcional. Ex: P1, P2, I4.' },
        },
        required: ['periodo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'projetar_producao',
      description: 'Projeta producao futura de forma deterministica, simulando OPs sequencialmente por maquina com ciclo, cavidades, saldo, valor unitario e eficiencia.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          periodo: { type: 'string', enum: ['ate_fim_dia', 'ate_fim_semana', 'ate_concluir_fila', 'hoje_completo', 'esta_semana'] },
          maquina_id: { type: 'string', description: 'Opcional. Ex: P1, P2, I4. Omitir para todas as maquinas.' },
          op_alvo: { type: 'string', description: 'Opcional. Codigo da OP alvo para localizar inicio/termino na fila. Ex: 2132.' },
          tipo: { type: 'string', enum: ['linha_tempo', 'inicio_op', 'termino_op', 'tempo_ate_op', 'projecao'], description: 'Tipo de projeção desejada.' },
          codigos_op: { type: 'array', items: { type: 'string' }, description: 'Opcional. Lista de codigos de OP para projetar.' },
          eficiencia: { type: 'number', description: 'Opcional. Eficiencia entre 0 e 1. Padrao 0.85.' },
        },
        required: ['periodo'],
      },
    },
  },
]

function parseToolArguments(rawArguments) {
  try {
    const parsed = rawArguments ? JSON.parse(rawArguments) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeMachineId(value) {
  const normalized = text(value).toUpperCase().replace(/\s+/g, '')
  return /^[PI]\d{1,2}$/.test(normalized) ? normalized : null
}

function periodFromPreset(preset) {
  const now = nowInBrazil()
  let start = startOfDay(now)
  let end = now
  let label = 'hoje ate agora'

  if (preset === 'hoje_completo') {
    end = endOfDay(now)
    label = 'hoje completo'
  } else if (preset === 'ontem') {
    const yesterday = addDays(now, -1)
    start = startOfDay(yesterday)
    end = endOfDay(yesterday)
    label = 'ontem'
  } else if (preset === 'esta_semana') {
    start = startOfWeek(now)
    label = 'esta semana ate agora'
  } else if (preset === 'este_mes') {
    start = startOfMonth(now)
    label = 'este mes ate agora'
  } else if (preset === 'ultimas_24h') {
    start = addDays(now, -1)
    label = 'ultimas 24 horas'
  } else if (preset === 'ultimos_30_dias') {
    start = startOfDay(addDays(now, -29))
    end = now
    label = 'ultimos 30 dias'
  } else if (preset === 'ate_fim_mes') {
    start = now
    end = endOfMonth(now)
    label = 'de agora ate o fim do mes'
  }

  return {
    label,
    start: toIso(start),
    end: toIso(end),
    startDate: dateKey(start),
    endDate: dateKey(end),
  }
}

function customPeriodFromArgs(args = {}) {
  const startDate = text(args.data_inicio)
  const endDate = text(args.data_fim)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null
  const start = new Date(`${startDate}T00:00:00-03:00`)
  const end = new Date(`${endDate}T23:59:59.999-03:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null
  return {
    label: `periodo personalizado ${startDate} a ${endDate}`,
    start: toIso(start),
    end: toIso(end),
    startDate,
    endDate,
    custom: true,
  }
}

function normalizeToolRequest(name, args = {}) {
  const requestedPeriod = text(args.periodo) || 'hoje_ate_agora'
  const period = requestedPeriod === 'personalizado' ? (customPeriodFromArgs(args) || periodFromPreset('hoje_ate_agora')) : periodFromPreset(requestedPeriod)
  const machineId = normalizeMachineId(args.maquina_id)
  return {
    name,
    args: {
      periodo: requestedPeriod,
      maquina_id: machineId,
      data_inicio: period.custom ? period.startDate : null,
      data_fim: period.custom ? period.endDate : null,
    },
    period,
    filters: machineId ? { machineId } : {},
  }
}

function buildToolCacheKey(name, args) {
  return `${name}:${JSON.stringify(args || {})}`
}

function findKnownToolResult(knownToolResults, name, args) {
  const key = buildToolCacheKey(name, args)
  return (knownToolResults || []).find((item) => item?.cacheKey === key) || null
}

function applyReportContextToToolArgs(name, args = {}, reportContext = {}) {
  if (!reportContext?.enabled) return args
  const next = { ...args }
  const periodPreset = text(reportContext.periodPreset)
  if (periodPreset === 'today') next.periodo = name === 'projetar_producao' ? 'ate_fim_dia' : 'hoje_completo'
  else if (periodPreset === 'week') next.periodo = name === 'projetar_producao' ? 'ate_fim_semana' : 'esta_semana'
  else if (periodPreset === 'month') next.periodo = name === 'projetar_producao' ? 'ate_fim_mes' : 'este_mes'
  else if (periodPreset === 'custom' && reportContext.startDate && reportContext.endDate && name !== 'projetar_producao') {
    next.periodo = 'personalizado'
    next.data_inicio = reportContext.startDate
    next.data_fim = reportContext.endDate
  }

  const machineId = normalizeMachineId(reportContext.machineId)
  if (machineId && name !== 'consultar_ordem_producao') next.maquina_id = machineId

  const opCode = normalizeOrderCode(reportContext.orderCode)
  if (opCode && name === 'consultar_ordem_producao') next.codigo_op = opCode
  if (opCode && name === 'projetar_producao') next.op_alvo = opCode

  return next
}

async function executeAssistantTool({ name, rawArgs, supabase, userId, knownToolResults }) {
  const normalized = normalizeToolRequest(name, rawArgs)
  const effectiveArgs = name === 'consultar_ordem_producao'
    ? { codigo_op: normalizeOrderCode(rawArgs.codigo_op) }
    : name === 'consultar_ordens_maquina'
      ? { maquina_id: normalizeMachineId(rawArgs.maquina_id) }
      : name === 'projetar_producao'
        ? {
            periodo: text(rawArgs.periodo) || 'ate_fim_dia',
            maquina_id: normalizeMachineId(rawArgs.maquina_id),
            op_alvo: normalizeOrderCode(rawArgs.op_alvo),
            tipo: text(rawArgs.tipo) || 'projecao',
            codigos_op: Array.isArray(rawArgs.codigos_op) ? rawArgs.codigos_op.map(normalizeOrderCode).filter(Boolean) : [],
            eficiencia: Number.isFinite(Number(rawArgs.eficiencia)) ? Number(rawArgs.eficiencia) : EXPECTED_PRODUCTION_RATE,
          }
        : normalized.args
  const cacheKey = buildToolCacheKey(name, effectiveArgs)
  const known = findKnownToolResult(knownToolResults, name, effectiveArgs)
  if (known) return { ...known, cachedFromConversation: true, cacheKey }

  let result
  if (name === 'consultar_producao') {
    result = await fetchProductionSummary(supabase, normalized.period, normalized.filters, userId)
  } else if (name === 'consultar_capacidade') {
    result = await fetchCapacitySummary(supabase, normalized.period, normalized.filters, userId)
  } else if (name === 'consultar_paradas') {
    result = await fetchStopSummary(supabase, normalized.period, normalized.filters, userId)
  } else if (name === 'consultar_refugos') {
    result = await fetchScrapSummary(supabase, normalized.period, normalized.filters, userId)
  } else if (name === 'consultar_oee') {
    result = await fetchOeeSummary(supabase, normalized.period, normalized.filters, userId)
  } else if (name === 'consultar_situacao_maquina') {
    result = await fetchMachineSituationSummary(supabase, normalized.period, normalized.filters, userId)
  } else if (name === 'comparar_producao_periodo_anterior') {
    const current = await fetchProductionSummary(supabase, normalized.period, normalized.filters, userId)
    const previous = await fetchProductionSummary(supabase, previousPeriod(normalized.period), normalized.filters, userId)
    result = {
      tool: name,
      period: normalized.period,
      filters: normalized.filters,
      result: {
        atual: current.result,
        anterior: previous.result,
        deltaPieces: toNumber(current.result.totalPieces) - toNumber(previous.result.totalPieces),
      },
      sources: [...current.sources, ...previous.sources],
    }
  } else if (name === 'consultar_planejado_realizado') {
    result = await fetchPlannedVsActualSummary(supabase, normalized.period, normalized.filters, userId)
  } else if (name === 'consultar_ordem_producao') {
    result = await fetchProductionOrderSummary(supabase, effectiveArgs.codigo_op, userId)
  } else if (name === 'consultar_ordens_maquina') {
    result = await fetchMachineOrdersSummary(supabase, effectiveArgs.maquina_id, userId)
  } else if (name === 'consultar_valorizacao_producao') {
    result = await fetchProductionValueSummary(supabase, normalized.period, normalized.filters, userId)
  } else if (name === 'projetar_producao') {
    result = await fetchProductionProjection(supabase, effectiveArgs, userId)
  } else {
    throw new Error(`Ferramenta nao permitida: ${name}`)
  }

  return {
    ...result,
    cacheKey,
    consultedAt: new Date().toISOString(),
    mutable: ['consultar_producao', 'consultar_capacidade', 'consultar_paradas', 'consultar_refugos', 'consultar_oee', 'consultar_situacao_maquina', 'consultar_planejado_realizado', 'comparar_producao_periodo_anterior', 'consultar_ordem_producao', 'consultar_ordens_maquina', 'consultar_valorizacao_producao', 'projetar_producao'].includes(name),
    validForMs: CACHE_TTL_MS,
  }
}

function estimateCost(usage) {
  if (!usage) return null
  const input = toNumber(usage.prompt_tokens)
  const output = toNumber(usage.completion_tokens)
  return Number(((input / 1_000_000) * 0.15 + (output / 1_000_000) * 0.6).toFixed(6))
}

async function writeTelemetry(supabase, payload) {
  try {
    await supabase.from('ai_assistant_telemetry').insert([payload])
  } catch (error) {
    console.warn('Falha ao registrar telemetria da IA:', error?.message || error)
  }
}

async function fetchAiPreferences(supabase, userId) {
  const { data, error } = await supabase.from('ai_user_preferences').select('tone_style, nickname, characteristics, memory_enabled, memory_summary').eq('user_id', userId).maybeSingle()
  if (error) {
    console.warn('Preferencias do Ícaro indisponíveis; usando padrões:', error.message)
    return { tone_style: 'padrao', nickname: '', characteristics: '', memory_enabled: true, memory_summary: '' }
  }
  return data || { tone_style: 'padrao', nickname: '', characteristics: '', memory_enabled: true, memory_summary: '' }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Metodo nao permitido.' })
    return
  }

  const startedAt = Date.now()
  try {
    const supabase = buildSupabaseClient(req)
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData?.user) {
      res.status(401).json({ error: 'Sessao invalida. Faca login novamente.' })
      return
    }
    assertAiAssistantAdmin(userData.user)

    const body = req.body || {}
    const question = text(body.question)
    if (!question) {
      res.status(400).json({ error: 'Pergunta vazia.' })
      return
    }

    const preferences = await fetchAiPreferences(supabase, userData.user.id)
    const activeContext = body.activeContext || {}
    const answerResult = await orchestrateWithOpenAI({
      question,
      historySummary: body.historySummary,
      activeContext,
      preferences,
      supabase,
      userId: userData.user.id,
      reportContext: body.reportContext || null,
    })

    const toolResults = answerResult.toolResults || []
    const sources = buildSources(toolResults)
    const previousToolResults = Array.isArray(activeContext?.toolResults) ? activeContext.toolResults : []
    const nextToolResults = [...previousToolResults, ...toolResults]
      .filter((item) => item?.cacheKey && item?.result)
      .slice(-12)
    const responsePayload = {
      answer: answerResult.answer,
      sources,
      toolCalls: compactToolResults(toolResults),
      model: answerResult.model || MODEL,
      usage: answerResult.usage,
      fallback: !!answerResult.fallback,
      fallbackReason: answerResult.fallbackReason || null,
      machineProjection: answerResult.machineProjection || null,
      activeContext: {
        summary: answerResult.answer,
        toolResults: nextToolResults,
      },
    }

    await writeTelemetry(supabase, {
      user_id: userData.user.id,
      question,
      model: responsePayload.model,
      input_tokens: answerResult.usage?.prompt_tokens ?? null,
      output_tokens: answerResult.usage?.completion_tokens ?? null,
      cached_tokens: answerResult.usage?.prompt_tokens_details?.cached_tokens ?? null,
      tool_call_count: toolResults.length,
      response_ms: Date.now() - startedAt,
      estimated_cost_usd: estimateCost(answerResult.usage),
      intent: 'GPT_TOOL_ORCHESTRATION',
    })

    res.status(200).json(responsePayload)
  } catch (error) {
    const status = error?.statusCode || 500
    console.error('AI assistant failed:', error)
    res.status(status).json({ error: error?.message || 'Falha ao consultar assistente.' })
  }
}

async function callOpenAI(payload) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const responseText = await response.text()
  let json = null
  try {
    json = responseText ? JSON.parse(responseText) : null
  } catch {
    json = { error: { message: responseText || 'Resposta vazia da OpenAI.' } }
  }

  if (!response.ok) {
    const error = new Error(json?.error?.message || `OpenAI retornou HTTP ${response.status}.`)
    error.openAIResponse = json
    throw error
  }

  return json
}

function buildAssistantSystemPrompt() {
  return [
    'Seu nome e Icaro, assistente de IA integrado ao sistema da empresa, nao apenas uma interface de consulta.',
    'Icaro significa Inteligencia para Controle e Analise de Resultados e Operacoes.',
    'Converse em portugues brasileiro natural, informal e profissional, como um colega de trabalho que conhece bem o sistema e os dados.',
    'Respeite as preferencias_do_usuario recebidas no contexto: adapte o tom solicitado, use o apelido quando informado e considere caracteristicas/memoria somente quando memoria_ativada estiver true.',
    'Evite linguagem artificial ou formal demais, como: como posso assisti-lo, como posso auxilia-lo, estou a sua disposicao, sera um prazer ajuda-lo, como posso ser util hoje.',
    'Prefira respostas naturais como: tudo bem, claro, posso verificar isso, encontrei o seguinte, quer que eu de uma olhada.',
    'Nao encerre toda resposta oferecendo ajuda genericamente e nao transforme toda interacao em atendimento ao cliente.',
    'Se o usuario apenas cumprimentar, agradecer ou conversar casualmente, responda normalmente sem tentar redirecionar para producao.',
    'Se o usuario comentar sobre sua linguagem ou sobre uma resposta anterior, entenda como comentario conversacional e adapte o estilo, sem consultar ferramentas.',
    'Interprete cada mensagem considerando as mensagens imediatamente anteriores; nao trate cada mensagem como interacao independente.',
    'Antes de responder, classifique mentalmente se a mensagem atual e resposta ao que voce perguntou, continuacao do assunto, correcao/comentario sobre sua resposta, nova pergunta ou mudanca de assunto.',
    'Quando o usuario responder a uma pergunta sua, reconheca a resposta e prossiga; nao faca novamente a mesma pergunta nem uma variacao dela.',
    'Evite loops sociais: se ja houve cumprimento, nao cumprimente novamente a cada mensagem e nao prolongue conversa casual com perguntas genericas.',
    'Nao pergunte e por ai, como estao as coisas, quais as novidades ou como posso ajudar apenas para manter conversa.',
    'Uma resposta curta e melhor do que criar conversa artificial. Mantenha continuidade sem repetir informacoes ou perguntas ja resolvidas.',
    'As mensagens anteriores do assistente tambem fazem parte do contexto; antes de perguntar algo, verifique se o usuario ja respondeu.',
    'Quando o assunto envolver dados de producao, mantenha precisao tecnica, mas explique de forma simples e natural.',
    'Seu objetivo tecnico e responder com dados reais do sistema, mantendo o banco/backend como fonte da verdade.',
    'Antes de responder: entenda a pergunta e o historico; verifique quais dados ja existem; confirme se sao atuais, do mesmo escopo, periodo e unidade; identifique o que falta; chame ferramentas somente se necessario.',
    'Antes de fazer calculos, comparacoes ou conclusoes, valide semanticamente se os dados sao os dados certos para aquela conta: entidade, metrica, periodo, unidade, escopo e origem.',
    'Use o campo semanticValidation retornado pelas ferramentas para decidir se um dado e adequado. Um dado existir no banco ou permitir uma conta matematica nao significa que seja semanticamente correto.',
    'Se os dados retornados forem incompativeis, ambiguos ou insuficientes, busque a ferramenta correta. Se ainda nao for possivel validar, diga que nao ha informacao suficiente em vez de forcar conclusao.',
    'Exemplo: para quanto falta da OP 2147, use quantidade total da OP 2147 menos producao da OP 2147; nunca substitua por capacidade, meta temporal ou producao agregada geral.',
    'Quando a pergunta citar entidade especifica como OP, O.P., maquina, produto ou lote, priorize ferramentas que consultem diretamente aquela entidade antes de usar agregados gerais.',
    'Para perguntas sobre saldo, faltante, produzido ou valor de uma O.P. especifica, use consultar_ordem_producao.',
    'Para perguntas sobre O.Ps lancadas, abertas, aguardando ou fila de uma maquina, use consultar_ordens_maquina.',
    'Para perguntas sobre valor unitario, valor produzido, faturamento produzido ou valorizacao da producao, use consultar_valorizacao_producao ou consultar_ordem_producao quando houver O.P. especifica.',
    'Para perguntas que contenham capacidade, faturamento ou valor projetado ate o fim do dia, use consultar_capacidade; nunca use apenas consultar_valorizacao_producao. O faturamento projetado ate o fim do dia e o valor realizado no periodo mais o valor esperado restante ate 23:59, calculado por fila sequencial, pecas por hora, horas produtivas e valor unitario.',
    'Para perguntas sobre previsao, projecao, termino, quanto sera produzido ate uma data, fim do dia, fim da semana ou quando acabam as OPs, use projetar_producao. Nao estime projecoes mentalmente.',
    'Para linha do tempo de maquina, inicio/termino de OP alvo ou tempo ate uma OP, use projetar_producao em uma unica chamada com maquina_id, op_alvo e tipo apropriado. Nao consulte cada OP individualmente.',
    'Quando pedirem a linha do tempo das OPs de uma maquina, use projetar_producao com tipo linha_tempo e periodo ate_concluir_fila. Responda cada OP em ordem com inicio e fim esperados; nao responda apenas com a lista de OPs.',
    'Quando o usuario perguntar somente quando uma OP vai iniciar, use tipo inicio_op e periodo ate_concluir_fila; responda prioritariamente o horario de inicio; nao adicione termino, valorizacao ou outros dados se nao forem necessarios.',
    'Para inicio de OP futura, valide targetProjection.queueValidation e previousOrdersConsidered; o inicio da OP alvo deve vir do termino projetado da OP imediatamente anterior.',
    'Ao usar projetar_producao, explique que o calculo considera OPs em sequencia, saldo restante, ciclo, cavidades, valor unitario e eficiencia aplicada.',
    'Saudacoes ou conversa social devem ser respondidas sem ferramentas.',
    'Perguntas de memoria como quantas eram mesmo ou o que voce falou antes devem usar o historico/contexto, nao novas consultas.',
    'Nunca gere SQL, nunca peca credenciais, nunca invente dados ausentes e nunca use suas respostas anteriores como fonte mais forte que ferramentas atuais.',
    'Nunca trate capacidade, programacao, meta, planejado, esperado e realizado como conceitos equivalentes.',
    'Nunca compare producao parcial com capacidade/meta/programacao de periodo completo para concluir desempenho.',
    'Para dizer acima/abaixo/dentro do esperado, atrasado, adiantado, bom, ruim, normal ou anormal, exija referencia comparavel: mesma entidade, periodo, unidade, escopo e base de comparacao.',
    `Para esperado/planejado ate agora, use consultar_planejado_realizado; a regra configurada e pecas/hora x ${Math.round(EXPECTED_PRODUCTION_RATE * 100)}% x horas do mesmo intervalo.`,
    'Se consultar_planejado_realizado retornar comparable=false, informe que os dados nao permitem essa conclusao e explique brevemente a referencia disponivel.',
    'Capacidade esperada do periodo significa a programacao, meta e valor esperado do intervalo solicitado com base na fila sequencial da maquina, ciclo, cavidades, horas produtivas disponiveis e valor unitario. Nunca use o termo teorica/teorico para esse calculo. Nao e producao realizada e nao deve ser confundida com o que ja foi entregue.',
    'Se o usuario pedir detalhamento, explicacao passo a passo, como chegou ao valor, sequencia por O.P., fila sequencial ou "detalhe o calculo", responda em ordem de producao, mostrando: O.P., taxa nominal, eficiencia aplicada, saldo restante ja descontando o que ja foi produzido na O.P. atual, tempo disponivel ate o fim do periodo, corte de fim de semana e valor parcial da O.P. O total final deve ser apresentado como soma acumulada das O.P.s que cabem dentro do intervalo especificado, nunca como um valor solto sem o raciocinio.',
    'Regras obrigatorias para capacidade/faturamento: 1) nunca use o total da fila como se fosse o total produzivel no periodo; 2) descontar a producao ja realizada antes de calcular o saldo restante; 3) limitar o calculo ao intervalo real solicitado (ex.: 23/09/2026 ate 30/09/2026 23:59); 4) aplicar apenas o tempo produtivo valido do periodo, incluindo o corte de fim de semana; 5) somar so a parcela que cabe dentro do periodo e na sequencia da fila; 6) nunca ignorar o fim de semana ou a data final do periodo.',
    'Na explicacao detalhada de capacidade, use o campo capacityByOrder retornado por consultar_capacidade como fonte dos horarios e valores por O.P. Mostre startsAt, finishesAt, pauses, expectedPiecesPerHour, producedPiecesBeforePeriod, remainingPiecesBeforeProjection, projectedPieces e projectedValue. Se finishesAt for nulo, diga que a O.P. nao termina no periodo e informe apenas o valor parcial projetado; nao invente inicio, fim, parada ou quantidade.',
    'Para comparacoes historicas em periodo em andamento, prefira periodos equivalentes, nao dia completo contra dia parcial.',
    'Para refugo, nao classifique alto/baixo por quantidade absoluta; use taxa, meta ou historico comparavel quando existir. Quando perguntarem qual O.P. gerou mais refugo, use highestScrapOrder ou o primeiro item de byOrder retornado por consultar_refugos; responda o orderCode e a quantidade de pecas, nunca o nome da maquina como se fosse o numero da O.P. Em perguntas de continuidade como "qual o numero dessa O.P.?", recupere esse mesmo campo do resultado anterior antes de fazer nova interpretacao.',
    'Para perguntas sobre OEE, use consultar_oee com periodo hoje_ate_agora quando o usuario disser "hoje", "ate agora" ou nao informar outro periodo. Informe OEE, disponibilidade, performance e qualidade, deixando claro quando algum componente nao puder ser calculado por falta de sessoes ou metas. Na performance do OEE use a taxa nominal (3600 dividido pelo ciclo, multiplicado pelas cavidades), sem aplicar os 85% de meta da capacidade, multiplicada pelo tempo transcorrido no periodo; disponibilidade e qualidade sao componentes separados. Nao responda que nao tem acesso se a ferramenta retornar dados.',
    'Quando o usuario perguntar a situacao, status ou estado de uma maquina, use consultar_situacao_maquina. Situacao significa exatamente: sem programacao, parada, produzindo, aguardando ou baixa eficiencia. Se houver baixa eficiencia ativa, responda que a maquina esta em baixa eficiencia produzindo e inclua a observacao do apontamento, como cavidades abertas/fechadas; nao responda apenas com producao ou horas de parada.',
    'Ao receber por que, como assim, tem certeza ou contestacao, reavalie a evidencia e corrija conclusoes anteriores se necessario.',
    'Diferencie internamente fato, calculo, interpretacao e hipotese; nunca apresente hipotese como fato.',
    'Nao superconsulte: pergunta simples pede ferramenta simples; investigacao causal deve ser progressiva.',
    'Responda em portugues do Brasil, direto, natural, com no maximo 4 linhas curtas, salvo pedido de detalhe. Nao liste fontes, tabelas ou JSON.',
    `Data atual: ${dateKey(nowInBrazil())}. Fuso operacional: ${ZONE}.`,
  ].join(' ')
}

function isCapacityValueQuestion(question) {
  const normalized = lower(question)
  const asksValue = normalized.includes('r$') || normalized.includes('valor') || normalized.includes('reais')
  const asksRealized = normalized.includes('produzido') || normalized.includes('realizado')
  return normalized.includes('capacidade') && asksValue && !asksRealized
}

export function isProjectedRevenueQuestion(question) {
  const normalized = lower(question)
  const asksRevenue = normalized.includes('faturamento') || normalized.includes('valor') || normalized.includes('r$')
  const asksFuture = /(ate o fim do dia|fim do dia|ate o final do dia|projec|meta|capacidade|restante)/.test(normalized)
  const asksRealized = normalized.includes('produzido') || normalized.includes('realizado')
  return asksRevenue && asksFuture && !asksRealized
}

export function isEndOfDayProjectionQuestion(question) {
  const normalized = lower(question)
  return isProjectedRevenueQuestion(question) && /(fim do dia|final do dia)/.test(normalized)
}

function isTotalCapacityQuestion(question) {
  const normalized = lower(question)
  return isCapacityValueQuestion(question) && /(total|todas as maquinas|todas maquinas|geral)/.test(normalized)
}
export function isEndOfMonthCapacityQuestion(question) {
  const normalized = lower(question)
  return isCapacityValueQuestion(question) && /(fim do mes|final do mes|ate o fim deste mes|ate o final deste mes)/.test(normalized)
}

function isOeeQuestion(question) {
  return /\boee\b/.test(lower(question))
}

function isMachineSituationQuestion(question) {
  const normalized = lower(question)
  return /(situacao|status|estado)/.test(normalized) && !!machineFromQuestion(question)
}

function isMachineProjectionDetailQuestion(question) {
  const normalized = lower(question)
  return normalized.includes('projec') && /(por maquina|por maquinas|cada maquina|maquinas)/.test(normalized)
}

function machineSortOrder(machineId) {
  const match = text(machineId).toUpperCase().match(/^([PI])(\d+)$/)
  if (!match) return 999
  return (match[1] === 'P' ? 0 : 100) + Number(match[2])
}

function buildMachineProjectionAnswer(result) {
  const capacity = result?.result || result || {}
  const rows = [...(capacity.capacityByMachine || [])].sort((left, right) => machineSortOrder(left.machineId) - machineSortOrder(right.machineId))
  if (!rows.length) return 'Não encontrei máquinas com capacidade projetada para hoje.'
  const lines = [
    'Projeção de faturamento por máquina para hoje:',
    `**Total projetado hoje:** ${formatBrl(capacity.dailyCapacityValue)} para ${Number(capacity.dailyCapacityPieces || 0).toLocaleString('pt-BR')} peças.`,
    'A tabela abaixo combina o realizado no período com a capacidade restante da fila até 23:59, em ordem P1–P4 e depois I1–I7.',
  ]
  return lines.join('\n')
}

function buildMachineSituationAnswer(result) {
  const summary = result?.result || {}
  const pieces = Number(summary.productionTodayPieces || 0).toLocaleString('pt-BR')
  const orderCode = summary.order?.code ? ` na O.P. ${summary.order.code}` : ''
  if (summary.state === 'baixa_eficiencia') {
    const detail = summary.lowEfficiency?.notes || summary.lowEfficiency?.reason || 'baixa eficiência registrada'
    return `A máquina ${summary.machineId} está em baixa eficiência, produzindo${orderCode}, com ${pieces} peças produzidas hoje. Apontamento: ${detail}.`
  }
  if (summary.state === 'parada') {
    const detail = summary.activeStop?.reason || summary.activeStop?.notes || 'parada registrada'
    return `A máquina ${summary.machineId} está parada${orderCode}, com ${pieces} peças produzidas hoje. Motivo: ${detail}.`
  }
  if (summary.state === 'produzindo') return `A máquina ${summary.machineId} está produzindo${orderCode} e já produziu ${pieces} peças hoje.`
  if (summary.state === 'aguardando') return `A máquina ${summary.machineId} está aguardando programação, com ${pieces} peças produzidas hoje.`
  return `A máquina ${summary.machineId} está sem programação no momento, com ${pieces} peças produzidas hoje.`
}

function formatBrl(value) {
  return toNumber(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function buildProjectedRevenueAnswer(result) {
  const summary = result?.result || {}
  const value = summary.dailyCapacityValue ?? summary.projectedTotalValueApprox
  const pieces = summary.dailyCapacityPieces ?? summary.projectedTotalPieces
  if (value == null) return 'Nao foi possivel calcular a projecao de faturamento com os dados disponiveis.'
  const piecesText = Number.isFinite(Number(pieces)) ? ` considerando aproximadamente ${Number(pieces).toLocaleString('pt-BR')} pecas` : ''
  return `A projecao de faturamento para hoje e de ${formatBrl(value)}${piecesText}. O valor soma o faturamento realizado no periodo com a capacidade restante da fila ate 23:59, usando as pecas por hora, a eficiencia de capacidade e o valor unitario.`
}

function isTimelineQuestion(question) {
  const normalized = lower(question)
  return normalized.includes('linha do tempo') || normalized.includes('inicio e fim') || normalized.includes('início e fim')
}

export function isDetailedCapacityExplanationQuestion(question) {
  const normalized = lower(question)
  const mentionsCapacityOrValue = /(capacidade|faturamento|valor|r\$|lucro|receita)/.test(normalized)
  const asksForDetail = /(detalh|explica|como chegou|passo a passo|sequenc|fila sequencial|por op|ordem da fila|por ordem)/.test(normalized)
  return mentionsCapacityOrValue && asksForDetail
}

function machineFromQuestion(question) {
  const match = text(question).toUpperCase().match(/\b[PI]\s*\d{1,2}\b/)
  return normalizeMachineId(match?.[0] || '')
}

async function orchestrateWithOpenAI({ question, historySummary, activeContext, preferences, supabase, userId, reportContext }) {
  const knownToolResults = Array.isArray(activeContext?.toolResults) ? activeContext.toolResults.slice(-12) : []
  if (isMachineProjectionDetailQuestion(question)) {
    const directResult = await executeAssistantTool({ name: 'consultar_capacidade', rawArgs: { periodo: 'hoje_completo', maquina_id: null }, supabase, userId, knownToolResults })
    const capacity = directResult?.result || directResult || {}
    return { answer: buildMachineProjectionAnswer(directResult), machineProjection: capacity.capacityByMachine || [], model: 'deterministic-capacity-by-machine', usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, elapsedMs: 0, fallback: false, fallbackReason: null, toolResults: [directResult] }
  }
  if (isMachineSituationQuestion(question)) {
    const directResult = await executeAssistantTool({
      name: 'consultar_situacao_maquina',
      rawArgs: { periodo: 'hoje_ate_agora', maquina_id: machineFromQuestion(question) },
      supabase,
      userId,
      knownToolResults,
    })
    return {
      answer: buildMachineSituationAnswer(directResult),
      model: 'deterministic-machine-status',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      elapsedMs: 0,
      fallback: false,
      fallbackReason: null,
      toolResults: [directResult],
    }
  }
  if (isProjectedRevenueQuestion(question)) {
    const directResult = await executeAssistantTool({
      name: 'consultar_capacidade',
      rawArgs: {
        periodo: isEndOfMonthCapacityQuestion(question) ? 'ate_fim_mes' : 'hoje_completo',
        maquina_id: machineFromQuestion(question),
      },
      supabase,
      userId,
      knownToolResults,
    })
    return {
      answer: buildProjectedRevenueAnswer(directResult),
      model: 'deterministic-capacity',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      elapsedMs: 0,
      fallback: false,
      fallbackReason: null,
      toolResults: [directResult],
    }
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      answer: 'A chave OPENAI_API_KEY nao esta carregada no backend. Reinicie a API local e confira o .env.local.',
      model: MODEL,
      usage: null,
      fallback: true,
      fallbackReason: 'OPENAI_API_KEY ausente no processo do backend.',
      toolResults: [],
    }
  }

  const detailedCapacityRequest = isDetailedCapacityExplanationQuestion(question)
  const additionalInstructions = detailedCapacityRequest ? [
    'IMPORTANTE: o usuario pediu explicacao detalhada do calculo. Responda em formato sequencial por O.P., cobrindo taxa nominal, eficiencia aplicada, saldo restante, horas disponiveis, limite do fim de semana e valor parcial por O.P., terminando com o total acumulado ate o fim do periodo.',
    'Nao responda apenas com um numero final sem o caminho de calculo. Se houver fim de semana, explique como o tempo produtivo foi truncado.',
  ] : []
  const messages = [
    { role: 'system', content: buildAssistantSystemPrompt() },
    {
      role: 'user',
      content: JSON.stringify({
        pergunta: question,
        resumo_conversa: historySummary || null,
        preferencias_do_usuario: {
          estilo_tom: preferences?.tone_style || 'padrao',
          apelido: preferences?.nickname || null,
          caracteristicas: preferences?.characteristics || null,
          memoria_ativada: preferences?.memory_enabled !== false,
          memoria_resumida: preferences?.memory_enabled !== false ? (preferences?.memory_summary || null) : null,
        },
        instrucoes_adicionais: additionalInstructions,
        contexto_recente: {
          resumo: activeContext?.summary || null,
          ferramentas_disponiveis_em_contexto: knownToolResults.map((item) => ({
            cacheKey: item.cacheKey,
            consultedAt: item.consultedAt || null,
            mutable: item.mutable ?? true,
            validForMs: item.validForMs || CACHE_TTL_MS,
            tool: item.result?.tool,
            period: item.result?.period,
            filters: item.result?.filters,
            result: item.result?.result,
          })),
        },
      }),
    },
  ]

  const toolResults = []
  const forceCapacityValue = isCapacityValueQuestion(question) || isProjectedRevenueQuestion(question)
  const forceProjectedRevenue = isProjectedRevenueQuestion(question)
  const forceEndOfDayProjection = isEndOfDayProjectionQuestion(question)
  const forceTotalCapacity = isTotalCapacityQuestion(question)
  const forceEndOfMonthCapacity = isEndOfMonthCapacityQuestion(question)
  const forceOee = isOeeQuestion(question)
  const forceTimeline = isTimelineQuestion(question)
  const timelineMachineId = machineFromQuestion(question)
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  const started = Date.now()

  for (let step = 0; step < 6; step += 1) {
    const json = await callOpenAI({
      model: MODEL,
      temperature: 0.2,
      messages,
      tools: ASSISTANT_TOOLS,
      tool_choice: 'auto',
    })

    usage = {
      prompt_tokens: usage.prompt_tokens + toNumber(json?.usage?.prompt_tokens),
      completion_tokens: usage.completion_tokens + toNumber(json?.usage?.completion_tokens),
      total_tokens: usage.total_tokens + toNumber(json?.usage?.total_tokens),
    }

    const message = json?.choices?.[0]?.message || {}
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []

    if (!toolCalls.length) {
      return {
        answer: text(message.content) || 'Nao consegui montar uma resposta com os dados disponiveis.',
        model: json?.model || MODEL,
        usage,
        elapsedMs: Date.now() - started,
        fallback: false,
        fallbackReason: null,
        toolResults,
      }
    }

    messages.push(message)

    for (const toolCall of toolCalls) {
      const requestedName = toolCall?.function?.name
      const requestedArgs = parseToolArguments(toolCall?.function?.arguments)
      const name = forceOee
        ? 'consultar_oee'
        : forceProjectedRevenue
          ? 'consultar_capacidade'
        : forceTimeline
          ? 'projetar_producao'
        : forceCapacityValue && ['consultar_valorizacao_producao', 'consultar_producao'].includes(requestedName)
          ? 'consultar_capacidade'
          : requestedName
      const rawArgs = forceOee
        ? { periodo: requestedArgs.periodo || 'hoje_ate_agora', maquina_id: requestedArgs.maquina_id || machineFromQuestion(question) }
        : forceProjectedRevenue
          ? { periodo: forceEndOfMonthCapacity ? 'ate_fim_mes' : (forceEndOfDayProjection || lower(question).includes('hoje') ? 'hoje_completo' : (requestedArgs.periodo || 'este_mes')), maquina_id: requestedArgs.maquina_id || machineFromQuestion(question) }
        : forceTimeline
          ? {
            periodo: 'ate_concluir_fila',
            maquina_id: timelineMachineId || normalizeMachineId(requestedArgs.maquina_id),
            tipo: 'linha_tempo',
            op_alvo: normalizeOrderCode(requestedArgs.op_alvo),
            codigos_op: [],
            eficiencia: Number.isFinite(Number(requestedArgs.eficiencia)) ? Number(requestedArgs.eficiencia) : EXPECTED_PRODUCTION_RATE,
          }
        : name === 'consultar_capacidade' && forceEndOfMonthCapacity
          ? { periodo: 'ate_fim_mes', maquina_id: requestedArgs.maquina_id || machineFromQuestion(question) }
          : name === 'consultar_capacidade' && forceEndOfDayProjection
            ? { periodo: 'hoje_completo', maquina_id: requestedArgs.maquina_id || machineFromQuestion(question) }
          : name === 'consultar_capacidade' && forceTotalCapacity
            ? { periodo: requestedArgs.periodo || 'hoje_ate_agora', maquina_id: null }
            : requestedArgs
      const result = await executeAssistantTool({ name, rawArgs: applyReportContextToToolArgs(name, rawArgs, reportContext), supabase, userId, knownToolResults: [...knownToolResults, ...toolResults] })
      toolResults.push({ ...result, requestedTool: requestedName })
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(compactToolResults([result])[0]),
      })
    }
  }

  const finalJson = await callOpenAI({
    model: MODEL,
    temperature: 0.2,
    messages: [
      ...messages,
      {
        role: 'user',
        content: [
          'Voce atingiu o limite de chamadas de ferramentas nesta rodada.',
          'Nao chame mais ferramentas.',
          'Responda agora usando somente os dados ja retornados pelas ferramentas e o contexto da conversa.',
          'Se algum dado indispensavel ainda faltar, diga isso de forma direta e sem pedir para o usuario refinar genericamente.',
        ].join(' '),
      },
    ],
  })

  usage = {
    prompt_tokens: usage.prompt_tokens + toNumber(finalJson?.usage?.prompt_tokens),
    completion_tokens: usage.completion_tokens + toNumber(finalJson?.usage?.completion_tokens),
    total_tokens: usage.total_tokens + toNumber(finalJson?.usage?.total_tokens),
  }

  const finalAnswer = text(finalJson?.choices?.[0]?.message?.content)

  return {
    answer: finalAnswer || 'Consegui consultar alguns dados, mas ainda falta uma referência suficiente para fechar a conclusão com segurança.',
    model: finalJson?.model || MODEL,
    usage,
    elapsedMs: Date.now() - started,
    fallback: !finalAnswer,
    fallbackReason: finalAnswer ? null : 'Limite de chamadas de ferramentas atingido e resposta final veio vazia.',
    toolResults,
  }
}