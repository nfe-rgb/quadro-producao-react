import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import Modal from '../components/Modal'
import { MAQUINAS } from '../lib/constants'
import {
  ACTIVE_TURNOS,
  SHIFT_ZONE,
  getShiftLabel,
  getShiftWindowsInRange,
} from '../lib/shifts'
import {
  intersectIntervals,
  mapRecordsToIntervals,
  mergeIntervals,
  subtractIntervals,
  sumIntervals,
} from '../lib/productionIntervals'
import { isMissingRelationError } from '../lib/productionRuntime'
import { supabase } from '../lib/supabaseClient'
import { fmtDateTime } from '../lib/utils'

const DATE_PRESET_OPTIONS = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'month', label: 'Este mês' },
  { value: 'custom', label: 'Intervalo personalizado' },
]

const ALL_MACHINES = '__ALL_MACHINES__'
const ALL_SHIFTS = '__ALL_SHIFTS__'

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatPieces(value) {
  return toNumber(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function formatCurrency(value) {
  return toNumber(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`
}

function formatHours(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}h`
}

function formatDurationMs(ms) {
  const totalMs = Math.max(0, toNumber(ms))
  const hours = Math.floor(totalMs / 3600000)
  const minutes = Math.floor((totalMs % 3600000) / 60000)
  return `${hours}h ${String(minutes).padStart(2, '0')}min`
}

function formatDateTimeOrDash(value) {
  return value ? fmtDateTime(value) : '—'
}

function normalizeMachineId(value) {
  return String(value || '').trim().toUpperCase()
}

function extractItemCodeFromOrderProduct(product) {
  if (!product) return ''
  return String(product).split('-')[0]?.trim() || ''
}

function parsePiecesPerBox(value) {
  if (value == null) return 0
  const digitsOnly = String(value).replace(/[^0-9]/g, '')
  if (!digitsOnly) return 0
  return parseInt(digitsOnly, 10)
}

function getPiecesPerHour(item) {
  const cycleSeconds = toNumber(item?.cycle_seconds)
  const cavities = toNumber(item?.cavities)
  if (cycleSeconds <= 0 || cavities <= 0) return 0
  return (3600 / cycleSeconds) * cavities
}

function sortByTsAsc(items, field) {
  return [...(items || [])].sort((left, right) => {
    const leftTs = new Date(left?.[field] || 0).getTime()
    const rightTs = new Date(right?.[field] || 0).getTime()
    return leftTs - rightTs
  })
}

function resolveRangeEnd(dateTime) {
  const now = DateTime.now().setZone(SHIFT_ZONE)
  if (!dateTime || !dateTime.isValid) return now
  if (dateTime.hasSame(now, 'day')) return now
  return dateTime.endOf('day')
}

function getRangeForPreset(preset, customStart, customEnd) {
  const now = DateTime.now().setZone(SHIFT_ZONE)

  if (preset === 'yesterday') {
    const base = now.minus({ days: 1 }).startOf('day')
    return { start: base, end: base.endOf('day') }
  }

  if (preset === 'month') {
    return { start: now.startOf('month'), end: now }
  }

  if (preset === 'custom') {
    const start = DateTime.fromISO(customStart || now.toISODate(), { zone: SHIFT_ZONE }).startOf('day')
    const endBase = DateTime.fromISO(customEnd || customStart || now.toISODate(), { zone: SHIFT_ZONE })
    const end = resolveRangeEnd(endBase)
    if (!start.isValid || !end.isValid) {
      return { start: now.startOf('day'), end: now }
    }
    return end < start ? { start, end: resolveRangeEnd(start) } : { start, end }
  }

  return { start: now.startOf('day'), end: now }
}

function getRecordValue(record, ordersById, itemsByCode, quantityField) {
  const order = ordersById[String(record?.order_id || '')]
  const product = record?.product || order?.product || ''
  const itemCode = extractItemCodeFromOrderProduct(product)
  const unitValue = itemCode ? toNumber(itemsByCode[itemCode]?.unit_value) : 0
  const quantity = toNumber(record?.[quantityField])
  return {
    itemCode,
    unitValue,
    quantity,
    totalValue: quantity * unitValue,
    order,
  }
}

function buildOverlapRecords(records, {
  rangeStartMs,
  rangeEndMs,
  allowedIntervals,
  startKey = 'started_at',
  endKey = 'ended_at',
}) {
  return sortByTsAsc(
    (records || [])
      .map((record) => {
        const intervals = intersectIntervals(
          mapRecordsToIntervals([
            {
              ...record,
              [endKey]: record?.[endKey] || null,
            },
          ], {
            startKey,
            endKey,
            rangeStartMs,
            rangeEndMs,
            fallbackEndMs: rangeEndMs,
          }),
          allowedIntervals
        )

        if (!intervals.length) return null
        return {
          ...record,
          filteredMs: sumIntervals(intervals),
        }
      })
      .filter(Boolean),
    startKey
  )
}

export default function RastreioResumoPeriodo() {
  const todayIso = DateTime.now().setZone(SHIFT_ZONE).toISODate()
  const [datePreset, setDatePreset] = useState('today')
  const [customStart, setCustomStart] = useState(todayIso)
  const [customEnd, setCustomEnd] = useState(todayIso)
  const [machineFilter, setMachineFilter] = useState(ALL_MACHINES)
  const [shiftFilter, setShiftFilter] = useState(ALL_SHIFTS)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState('')
  const [summaryDataset, setSummaryDataset] = useState({
    scans: [],
    scraps: [],
    stops: [],
    manualEntries: [],
    sessions: [],
    lowEffLogs: [],
    ordersById: {},
    itemsByCode: {},
  })
  const [detailMachineId, setDetailMachineId] = useState('')

  const range = useMemo(
    () => getRangeForPreset(datePreset, customStart, customEnd),
    [datePreset, customStart, customEnd]
  )

  const activeShiftKeys = useMemo(
    () => (shiftFilter === ALL_SHIFTS ? ACTIVE_TURNOS.map((shift) => shift.key) : [shiftFilter]),
    [shiftFilter]
  )

  const visibleMachines = useMemo(
    () => (machineFilter === ALL_MACHINES ? MAQUINAS : [machineFilter]),
    [machineFilter]
  )

  const loadSummary = useCallback(async () => {
    if (!range?.start || !range?.end) return

    const startIso = range.start.toUTC().toISO()
    const endIso = range.end.toUTC().toISO()
    const scopedMachine = machineFilter === ALL_MACHINES ? '' : machineFilter

    setSummaryLoading(true)
    setSummaryError('')

    try {
      let scansQuery = supabase
        .from('production_scans')
        .select('id, order_id, machine_id, created_at, qty_pieces, shift, scanned_box, code, op_code')
        .gte('created_at', startIso)
        .lt('created_at', endIso)
      let scrapsQuery = supabase
        .from('scrap_logs')
        .select('id, order_id, machine_id, created_at, qty, reason, operator, shift, op_code')
        .gte('created_at', startIso)
        .lt('created_at', endIso)
      let manualQuery = supabase
        .from('injection_production_entries')
        .select('id, order_id, machine_id, created_at, good_qty, product, shift')
        .gte('created_at', startIso)
        .lt('created_at', endIso)
      let stopsQuery = supabase
        .from('machine_stops')
        .select('id, order_id, machine_id, session_id, started_at, resumed_at, reason, notes, started_by')
        .lt('started_at', endIso)
      let sessionsQuery = supabase
        .from('order_machine_sessions')
        .select('id, order_id, machine_id, started_at, ended_at, started_by, ended_by, end_reason')
        .lt('started_at', endIso)
      let lowEffQuery = supabase
        .from('low_efficiency_logs')
        .select('id, order_id, machine_id, session_id, started_at, ended_at, reason, notes, started_by, ended_by')
        .lt('started_at', endIso)

      if (scopedMachine) {
        scansQuery = scansQuery.eq('machine_id', scopedMachine)
        scrapsQuery = scrapsQuery.eq('machine_id', scopedMachine)
        manualQuery = manualQuery.eq('machine_id', scopedMachine)
        stopsQuery = stopsQuery.eq('machine_id', scopedMachine)
        sessionsQuery = sessionsQuery.eq('machine_id', scopedMachine)
        lowEffQuery = lowEffQuery.eq('machine_id', scopedMachine)
      }

      if (shiftFilter !== ALL_SHIFTS) {
        scansQuery = scansQuery.eq('shift', shiftFilter)
        scrapsQuery = scrapsQuery.eq('shift', shiftFilter)
        manualQuery = manualQuery.eq('shift', shiftFilter)
      }

      stopsQuery = stopsQuery.or(`resumed_at.gte.${startIso},resumed_at.is.null`)
      sessionsQuery = sessionsQuery.or(`ended_at.gte.${startIso},ended_at.is.null`)
      lowEffQuery = lowEffQuery.or(`ended_at.gte.${startIso},ended_at.is.null`)

      const [
        scansRes,
        scrapsRes,
        manualRes,
        rawStopsRes,
        rawSessionsRes,
        rawLowEffRes,
      ] = await Promise.all([
        scansQuery,
        scrapsQuery,
        manualQuery,
        stopsQuery,
        sessionsQuery,
        lowEffQuery,
      ])

      if (scansRes.error) throw scansRes.error
      if (scrapsRes.error) throw scrapsRes.error
      if (manualRes.error) throw manualRes.error
      if (rawStopsRes.error) throw rawStopsRes.error

      const sessionsRes = isMissingRelationError(rawSessionsRes.error, 'order_machine_sessions')
        ? { data: [], error: null }
        : rawSessionsRes
      const lowEffRes = isMissingRelationError(rawLowEffRes.error, 'low_efficiency_logs')
        ? { data: [], error: null }
        : rawLowEffRes

      if (sessionsRes.error) throw sessionsRes.error
      if (lowEffRes.error) throw lowEffRes.error

      const orderIds = Array.from(
        new Set(
          [
            ...(scansRes.data || []),
            ...(scrapsRes.data || []),
            ...(manualRes.data || []),
            ...(rawStopsRes.data || []),
            ...(sessionsRes.data || []),
            ...(lowEffRes.data || []),
          ]
            .map((record) => (record?.order_id != null ? String(record.order_id) : ''))
            .filter(Boolean)
        )
      )

      let ordersById = {}
      if (orderIds.length) {
        const { data: ordersData, error: ordersErr } = await supabase
          .from('orders')
          .select('id, code, customer, product, standard, machine_id, status, finalized, created_at, updated_at, finalized_at')
          .in('id', orderIds)

        if (ordersErr) throw ordersErr

        ordersById = (ordersData || []).reduce((acc, order) => {
          acc[String(order.id)] = order
          return acc
        }, {})
      }

      const productCodes = Array.from(
        new Set(
          Object.values(ordersById)
            .map((order) => extractItemCodeFromOrderProduct(order?.product))
            .filter(Boolean)
        )
      )

      let itemsByCode = {}
      if (productCodes.length) {
        const { data: itemsData, error: itemsErr } = await supabase
          .from('items')
          .select('code, description, unit_value, cycle_seconds, cavities')
          .in('code', productCodes)

        if (itemsErr) throw itemsErr

        itemsByCode = (itemsData || []).reduce((acc, item) => {
          const key = String(item?.code || '').trim()
          if (key) acc[key] = item
          return acc
        }, {})
      }

      setSummaryDataset({
        scans: scansRes.data || [],
        scraps: scrapsRes.data || [],
        stops: (rawStopsRes.data || []).map((stop) => ({
          ...stop,
          ended_at: stop?.resumed_at || null,
        })),
        manualEntries: manualRes.data || [],
        sessions: sessionsRes.data || [],
        lowEffLogs: lowEffRes.data || [],
        ordersById,
        itemsByCode,
      })
    } catch (err) {
      console.warn('Falha ao carregar resumo do período.', err)
      setSummaryError('Não foi possível carregar o resumo do período agora. Tente novamente em instantes.')
      setSummaryDataset({
        scans: [],
        scraps: [],
        stops: [],
        manualEntries: [],
        sessions: [],
        lowEffLogs: [],
        ordersById: {},
        itemsByCode: {},
      })
    } finally {
      setSummaryLoading(false)
    }
  }, [machineFilter, range, shiftFilter])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  const summary = useMemo(() => {
    const rangeStartMs = range.start.toMillis()
    const rangeEndMs = range.end.toMillis()
    const allowedIntervals = shiftFilter === ALL_SHIFTS
      ? [[rangeStartMs, rangeEndMs]]
      : getShiftWindowsInRange(range.start, range.end, {
          shiftKeys: activeShiftKeys,
        })

    const rows = []
    const detailsByMachine = {}

    for (const machineId of visibleMachines) {
      const machineScans = sortByTsAsc(
        summaryDataset.scans.filter((record) => normalizeMachineId(record?.machine_id) === machineId),
        'created_at'
      )
      const machineManualEntries = sortByTsAsc(
        summaryDataset.manualEntries.filter((record) => normalizeMachineId(record?.machine_id) === machineId),
        'created_at'
      )
      const machineScraps = sortByTsAsc(
        summaryDataset.scraps.filter((record) => normalizeMachineId(record?.machine_id) === machineId),
        'created_at'
      )
      const machineStops = buildOverlapRecords(
        summaryDataset.stops.filter((record) => normalizeMachineId(record?.machine_id) === machineId),
        {
          rangeStartMs,
          rangeEndMs,
          allowedIntervals,
          startKey: 'started_at',
          endKey: 'ended_at',
        }
      )
      const machineSessions = buildOverlapRecords(
        summaryDataset.sessions.filter((record) => normalizeMachineId(record?.machine_id) === machineId),
        {
          rangeStartMs,
          rangeEndMs,
          allowedIntervals,
          startKey: 'started_at',
          endKey: 'ended_at',
        }
      )
      const machineLowEffLogs = buildOverlapRecords(
        summaryDataset.lowEffLogs.filter((record) => normalizeMachineId(record?.machine_id) === machineId),
        {
          rangeStartMs,
          rangeEndMs,
          allowedIntervals,
          startKey: 'started_at',
          endKey: 'ended_at',
        }
      )

      let goodPieces = 0
      let producedValue = 0
      let scrapPieces = 0
      let scrapValue = 0
      let idealPieces = 0
      const missingTargets = new Set()

      for (const scan of machineScans) {
        const fallbackPieces = parsePiecesPerBox(summaryDataset.ordersById[String(scan?.order_id || '')]?.standard)
        const pieces = toNumber(scan?.qty_pieces) || fallbackPieces
        const valueMeta = getRecordValue(
          { ...scan, qty_pieces: pieces },
          summaryDataset.ordersById,
          summaryDataset.itemsByCode,
          'qty_pieces'
        )
        goodPieces += pieces
        producedValue += valueMeta.totalValue
      }

      for (const manualEntry of machineManualEntries) {
        const valueMeta = getRecordValue(
          manualEntry,
          summaryDataset.ordersById,
          summaryDataset.itemsByCode,
          'good_qty'
        )
        goodPieces += valueMeta.quantity
        producedValue += valueMeta.totalValue
      }

      for (const scrap of machineScraps) {
        const valueMeta = getRecordValue(
          scrap,
          summaryDataset.ordersById,
          summaryDataset.itemsByCode,
          'qty'
        )
        scrapPieces += valueMeta.quantity
        scrapValue += valueMeta.totalValue
      }

      const mergedStopIntervals = mergeIntervals(
        machineStops.flatMap((record) =>
          intersectIntervals(
            mapRecordsToIntervals([record], {
              rangeStartMs,
              rangeEndMs,
              startKey: 'started_at',
              endKey: 'ended_at',
              fallbackEndMs: rangeEndMs,
            }),
            allowedIntervals
          )
        )
      )

      const mergedLowEffIntervals = mergeIntervals(
        machineLowEffLogs.flatMap((record) =>
          intersectIntervals(
            mapRecordsToIntervals([record], {
              rangeStartMs,
              rangeEndMs,
              startKey: 'started_at',
              endKey: 'ended_at',
              fallbackEndMs: rangeEndMs,
            }),
            allowedIntervals
          )
        )
      )

      const loadedIntervals = mergeIntervals(
        machineSessions.flatMap((record) =>
          intersectIntervals(
            mapRecordsToIntervals([record], {
              rangeStartMs,
              rangeEndMs,
              startKey: 'started_at',
              endKey: 'ended_at',
              fallbackEndMs: rangeEndMs,
            }),
            allowedIntervals
          )
        )
      )

      for (const session of machineSessions) {
        const order = summaryDataset.ordersById[String(session?.order_id || '')]
        const itemCode = extractItemCodeFromOrderProduct(order?.product)
        const itemMeta = itemCode ? summaryDataset.itemsByCode[itemCode] : null
        const piecesPerHour = getPiecesPerHour(itemMeta)
        if (piecesPerHour <= 0) {
          if (itemCode) missingTargets.add(itemCode)
          continue
        }

        const sessionIntervals = intersectIntervals(
          mapRecordsToIntervals([session], {
            rangeStartMs,
            rangeEndMs,
            startKey: 'started_at',
            endKey: 'ended_at',
            fallbackEndMs: rangeEndMs,
          }),
          allowedIntervals
        )
        const stopInsideSession = intersectIntervals(mergedStopIntervals, sessionIntervals)
        const lowEffInsideSession = intersectIntervals(mergedLowEffIntervals, sessionIntervals)
        const effectiveStopIntervals = subtractIntervals(stopInsideSession, lowEffInsideSession)
        const effectiveLowEffIntervals = subtractIntervals(lowEffInsideSession, stopInsideSession)
        const runtimeIntervals = subtractIntervals(
          sessionIntervals,
          mergeIntervals([...effectiveStopIntervals, ...effectiveLowEffIntervals])
        )
        idealPieces += (sumIntervals(runtimeIntervals) / 1000 / 60 / 60) * piecesPerHour
      }

      const actualPieces = goodPieces + scrapPieces
      const loadedMs = sumIntervals(loadedIntervals)
      const stopIntervals = subtractIntervals(
        intersectIntervals(mergedStopIntervals, loadedIntervals),
        intersectIntervals(mergedLowEffIntervals, loadedIntervals)
      )
      const lowEffIntervals = subtractIntervals(
        intersectIntervals(mergedLowEffIntervals, loadedIntervals),
        intersectIntervals(mergedStopIntervals, loadedIntervals)
      )
      const stopMs = sumIntervals(stopIntervals)
      const lowEffMs = sumIntervals(lowEffIntervals)
      const productiveIntervals = subtractIntervals(loadedIntervals, mergeIntervals([...stopIntervals, ...lowEffIntervals]))
      const runtimeMs = sumIntervals(productiveIntervals)
      const firstProductionAt = productiveIntervals.length
        ? new Date(productiveIntervals[0][0]).toISOString()
        : (loadedIntervals.length ? new Date(loadedIntervals[0][0]).toISOString() : null)
      const availability = loadedMs > 0 ? Math.max(0, (loadedMs - stopMs - lowEffMs) / loadedMs) : null
      const performance = idealPieces > 0 ? Math.max(0, actualPieces / idealPieces) : null
      const quality = actualPieces > 0 ? Math.max(0, goodPieces / actualPieces) : 1
      const oee = availability != null && performance != null
        ? Math.min(1, availability) * Math.min(1, performance) * Math.min(1, quality)
        : null
      const scrapPercent = actualPieces > 0 ? (scrapPieces / actualPieces) * 100 : 0

      const relatedOrders = Array.from(
        new Set(
          [
            ...machineScans.map((record) => String(record?.order_id || '')),
            ...machineManualEntries.map((record) => String(record?.order_id || '')),
            ...machineScraps.map((record) => String(record?.order_id || '')),
            ...machineStops.map((record) => String(record?.order_id || '')),
            ...machineSessions.map((record) => String(record?.order_id || '')),
            ...machineLowEffLogs.map((record) => String(record?.order_id || '')),
          ].filter(Boolean)
        )
      )
        .map((orderId) => summaryDataset.ordersById[orderId])
        .filter(Boolean)

      const row = {
        machineId,
        goodPieces,
        producedValue,
        scrapPieces,
        scrapValue,
        scrapPercent,
        oeePercent: oee == null ? null : Math.min(100, oee * 100),
        availabilityPercent: availability == null ? null : Math.min(100, availability * 100),
        performancePercent: performance == null ? null : Math.min(100, performance * 100),
        qualityPercent: quality == null ? null : Math.min(100, quality * 100),
        stopHours: stopMs / 1000 / 60 / 60,
        lowEffHours: lowEffMs / 1000 / 60 / 60,
        runtimeHours: runtimeMs / 1000 / 60 / 60,
        loadedHours: loadedMs / 1000 / 60 / 60,
        firstProductionAt,
        idealPieces,
        actualPieces,
        scanBoxes: machineScans.length,
        manualEntriesCount: machineManualEntries.length,
        transferCount: machineSessions.filter((session) => String(session?.end_reason || '').toUpperCase() === 'TRANSFERRED').length,
        missingTargets: Array.from(missingTargets),
      }

      rows.push(row)
      detailsByMachine[machineId] = {
        ...row,
        scans: machineScans,
        manualEntries: machineManualEntries,
        scraps: machineScraps,
        stops: machineStops,
        sessions: machineSessions,
        lowEffLogs: machineLowEffLogs,
        orders: relatedOrders,
      }
    }

    return {
      rows,
      detailsByMachine,
      totals: rows.reduce(
        (acc, row) => ({
          goodPieces: acc.goodPieces + row.goodPieces,
          producedValue: acc.producedValue + row.producedValue,
          scrapPieces: acc.scrapPieces + row.scrapPieces,
          scrapValue: acc.scrapValue + row.scrapValue,
          stopHours: acc.stopHours + row.stopHours,
          lowEffHours: acc.lowEffHours + row.lowEffHours,
          actualPieces: acc.actualPieces + row.actualPieces,
        }),
        { goodPieces: 0, producedValue: 0, scrapPieces: 0, scrapValue: 0, stopHours: 0, lowEffHours: 0, actualPieces: 0 }
      ),
    }
  }, [activeShiftKeys, range, shiftFilter, summaryDataset, visibleMachines])

  const detail = detailMachineId ? summary.detailsByMachine[detailMachineId] : null
  const rangeLabel = useMemo(() => {
    const startText = range.start.toFormat('dd/MM/yyyy HH:mm')
    const endText = range.end.toFormat('dd/MM/yyyy HH:mm')
    const machineText = machineFilter === ALL_MACHINES ? 'Todas as máquinas' : machineFilter
    const shiftText = shiftFilter === ALL_SHIFTS ? 'Todos os turnos' : getShiftLabel(shiftFilter)
    return `${startText} • ${endText} • ${machineText} • ${shiftText}`
  }, [machineFilter, range, shiftFilter])

  return (
    <div className="rastreio-summary-view">
      <div className="rastreio-header">
        <div>
          <h2 style={{ margin: 0 }}>Resumo do Período</h2>
          <div style={{ color: '#475569', fontSize: 13 }}>
            Produção, refugo, valor, OEE e horas paradas por máquina no recorte selecionado.
          </div>
        </div>
        {summaryLoading && (
          <div className="loading-dots" aria-label="Carregando resumo do período">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      <div className="rastreio-filter-bar">
        <div className="rastreio-filter-group">
          <label>Data</label>
          <select value={datePreset} onChange={(e) => setDatePreset(e.target.value)}>
            {DATE_PRESET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        {datePreset === 'custom' && (
          <>
            <div className="rastreio-filter-group">
              <label>Início</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
            </div>
            <div className="rastreio-filter-group">
              <label>Fim</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </div>
          </>
        )}

        <div className="rastreio-filter-group">
          <label>Máquina</label>
          <select value={machineFilter} onChange={(e) => setMachineFilter(e.target.value)}>
            <option value={ALL_MACHINES}>Todas</option>
            {MAQUINAS.map((machine) => (
              <option key={machine} value={machine}>{machine}</option>
            ))}
          </select>
        </div>

        <div className="rastreio-filter-group">
          <label>Turno</label>
          <select value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)}>
            <option value={ALL_SHIFTS}>Todos</option>
            {ACTIVE_TURNOS.map((shift) => (
              <option key={shift.key} value={shift.key}>{shift.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="rastreio-summary-highlights">
        <div className="rastreio-summary-highlight-card good">
          <span>Peças boas</span>
          <strong>{formatPieces(summary.totals.goodPieces)}</strong>
          <small>{formatCurrency(summary.totals.producedValue)}</small>
        </div>
        <div className="rastreio-summary-highlight-card scrap">
          <span>Refugo</span>
          <strong>{formatPieces(summary.totals.scrapPieces)}</strong>
          <small>
            {formatCurrency(summary.totals.scrapValue)}
            {' • '}
            {formatPercent(summary.totals.actualPieces > 0 ? (summary.totals.scrapPieces / summary.totals.actualPieces) * 100 : 0)}
          </small>
        </div>
        <div className="rastreio-summary-highlight-card neutral">
          <span>Horas paradas</span>
          <strong>{formatHours(summary.totals.stopHours)}</strong>
          <small>Baixa eficiência {formatHours(summary.totals.lowEffHours)}</small>
        </div>
      </div>

      {summaryError && <div className="error-box">{summaryError}</div>}

      <div className="rastreio-summary-table-wrap">
        <table className="rastreio-summary-table">
          <thead>
            <tr>
              <th>Máquina</th>
              <th>Peças boas</th>
              <th>Valor produzido</th>
              <th>Refugo</th>
              <th>Valor refugo</th>
              <th>% Refugo</th>
              <th>OEE</th>
              <th>Horas paradas</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <tr
                key={row.machineId}
                className="rastreio-summary-row"
                onClick={() => setDetailMachineId(row.machineId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setDetailMachineId(row.machineId)
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <td>
                  <div className="rastreio-summary-machine">{row.machineId}</div>
                </td>
                <td>
                  <span className="rastreio-summary-pill good">{formatPieces(row.goodPieces)}</span>
                </td>
                <td>{formatCurrency(row.producedValue)}</td>
                <td>
                  <span className="rastreio-summary-pill scrap">{formatPieces(row.scrapPieces)}</span>
                </td>
                <td>{formatCurrency(row.scrapValue)}</td>
                <td>{formatPercent(row.scrapPercent)}</td>
                <td>
                  <span className={`rastreio-summary-pill ${
                    row.oeePercent == null
                      ? 'neutral'
                      : row.oeePercent >= 85
                        ? 'good'
                        : row.oeePercent >= 60
                          ? 'warn'
                          : 'scrap'
                  }`}
                  >
                    {formatPercent(row.oeePercent)}
                  </span>
                </td>
                <td>{formatHours(row.stopHours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!summaryLoading && summary.rows.length === 0 && (
        <div className="empty-state">Nenhum dado encontrado para o período selecionado.</div>
      )}

      <Modal
        open={!!detail}
        onClose={() => setDetailMachineId('')}
        title={detail ? `Máquina ${detail.machineId} • Resumo do período` : ''}
        modalClassName="rastreio-summary-modal-shell"
      >
        {detail ? (
          <div className="rastreio-summary-modal-content">
            <div className="rastreio-summary-detail-note">{rangeLabel}</div>

            <div className="rastreio-summary-highlights">
              <div className="rastreio-summary-highlight-card good">
                <span>Peças boas</span>
                <strong>{formatPieces(detail.goodPieces)}</strong>
                <small>{formatCurrency(detail.producedValue)}</small>
              </div>
              <div className="rastreio-summary-highlight-card scrap">
                <span>Refugo</span>
                <strong>{formatPieces(detail.scrapPieces)}</strong>
                <small>{formatCurrency(detail.scrapValue)} {' • '} {formatPercent(detail.scrapPercent)}</small>
              </div>
              <div className="rastreio-summary-highlight-card neutral">
                <span>OEE</span>
                <strong>{formatPercent(detail.oeePercent)}</strong>
                <small>Paradas {formatHours(detail.stopHours)} • Baixa eficiência {formatHours(detail.lowEffHours)}</small>
              </div>
              <div className="rastreio-summary-highlight-card neutral">
                <span>Hora de início</span>
                <strong>{formatDateTimeOrDash(detail.firstProductionAt)}</strong>
                <small>Primeiro início de produção no recorte</small>
              </div>
              <div className="rastreio-summary-highlight-card neutral">
                <span>Transferências</span>
                <strong>{detail.transferCount}</strong>
                <small>Sessões encerradas por troca de máquina</small>
              </div>
            </div>

            <div className="rastreio-summary-kpis">
              <div className="rastreio-card">
                <span>Disponibilidade</span>
                <strong>{formatPercent(detail.availabilityPercent)}</strong>
              </div>
              <div className="rastreio-card">
                <span>Performance</span>
                <strong>{formatPercent(detail.performancePercent)}</strong>
              </div>
              <div className="rastreio-card">
                <span>Qualidade</span>
                <strong>{formatPercent(detail.qualityPercent)}</strong>
              </div>
              <div className="rastreio-card">
                <span>Tempo carregado</span>
                <strong>{formatHours(detail.loadedHours)}</strong>
              </div>
              <div className="rastreio-card">
                <span>Tempo produtivo</span>
                <strong>{formatHours(detail.runtimeHours)}</strong>
              </div>
              <div className="rastreio-card">
                <span>Baixa eficiência</span>
                <strong>{formatHours(detail.lowEffHours)}</strong>
              </div>
              <div className="rastreio-card">
                <span>Peças ideais</span>
                <strong>{formatPieces(detail.idealPieces)}</strong>
              </div>
            </div>

            {detail.orders.length > 0 && (
              <div className="panel-box">
                <h3 className="panel-title">Ordens impactadas no período</h3>
                <div className="rastreio-order-chip-list">
                  {detail.orders.map((ord) => (
                    <div key={String(ord.id)} className="rastreio-order-chip">
                      <strong>O.S {ord.code || 'N/A'}</strong>
                      <span>{ord.product || 'Sem produto'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail.missingTargets.length > 0 && (
              <div className="error-box">
                OEE parcial: cadastre ciclo e cavidades para os itens {detail.missingTargets.join(', ')}.
              </div>
            )}

            <div className="rastreio-detail-grid">
              <div className="panel-box">
                <h3 className="panel-title">Apontamentos de produção</h3>
                {detail.scans.length === 0 && detail.manualEntries.length === 0 ? (
                  <div className="empty-state">Nenhum apontamento de produção no recorte.</div>
                ) : (
                  <div className="rastreio-detail-stack">
                    {detail.scans.length > 0 && (
                      <div>
                        <div className="rastreio-section-subtitle">Bipagens</div>
                        <div className="rastreio-summary-table-wrap compact">
                          <table className="rastreio-summary-table compact">
                            <thead>
                              <tr>
                                <th>Data</th>
                                <th>O.S</th>
                                <th>Caixa</th>
                                <th>Peças</th>
                                <th>Turno</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.scans.map((scan) => {
                                const order = summaryDataset.ordersById[String(scan.order_id || '')]
                                const pieces = toNumber(scan.qty_pieces) || parsePiecesPerBox(order?.standard)
                                return (
                                  <tr key={`scan-${scan.id}`}>
                                    <td>{fmtDateTime(scan.created_at)}</td>
                                    <td>{order?.code || scan.op_code || 'N/A'}</td>
                                    <td>{String(scan.scanned_box || '0').padStart(3, '0')}</td>
                                    <td>{formatPieces(pieces)}</td>
                                    <td>{scan.shift || 'N/A'}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {detail.manualEntries.length > 0 && (
                      <div>
                        <div className="rastreio-section-subtitle">Produção manual</div>
                        <div className="rastreio-summary-table-wrap compact">
                          <table className="rastreio-summary-table compact">
                            <thead>
                              <tr>
                                <th>Data</th>
                                <th>O.S</th>
                                <th>Peças</th>
                                <th>Turno</th>
                                <th>Produto</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.manualEntries.map((entry) => {
                                const order = summaryDataset.ordersById[String(entry.order_id || '')]
                                return (
                                  <tr key={`manual-${entry.id}`}>
                                    <td>{fmtDateTime(entry.created_at)}</td>
                                    <td>{order?.code || 'N/A'}</td>
                                    <td>{formatPieces(entry.good_qty)}</td>
                                    <td>{entry.shift || 'N/A'}</td>
                                    <td>{entry.product || order?.product || 'N/A'}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="panel-box">
                <h3 className="panel-title">Apontamentos de paradas</h3>
                {detail.stops.length === 0 ? (
                  <div className="empty-state">Nenhuma parada no recorte filtrado.</div>
                ) : (
                  <div className="rastreio-summary-table-wrap compact">
                    <table className="rastreio-summary-table compact">
                      <thead>
                        <tr>
                          <th>Início</th>
                          <th>Fim</th>
                          <th>Duração no recorte</th>
                          <th>Motivo</th>
                          <th>Operador</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.stops.map((stop) => (
                          <tr key={`stop-${stop.id}`}>
                            <td>{fmtDateTime(stop.started_at)}</td>
                            <td>{stop.resumed_at || stop.ended_at ? fmtDateTime(stop.resumed_at || stop.ended_at) : 'Em aberto'}</td>
                            <td>{formatDurationMs(stop.filteredMs)}</td>
                            <td>{stop.reason || 'N/A'}</td>
                            <td>{stop.started_by || 'N/A'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="rastreio-detail-grid">
              <div className="panel-box">
                <h3 className="panel-title">Refugo detalhado</h3>
                {detail.scraps.length === 0 ? (
                  <div className="empty-state">Nenhum refugo no recorte filtrado.</div>
                ) : (
                  <div className="rastreio-summary-table-wrap compact">
                    <table className="rastreio-summary-table compact">
                      <thead>
                        <tr>
                          <th>Data</th>
                          <th>O.S</th>
                          <th>Peças</th>
                          <th>Valor</th>
                          <th>Motivo</th>
                          <th>Operador</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.scraps.map((scrap) => {
                          const order = summaryDataset.ordersById[String(scrap.order_id || '')]
                          const valueMeta = getRecordValue(scrap, summaryDataset.ordersById, summaryDataset.itemsByCode, 'qty')
                          return (
                            <tr key={`scrap-${scrap.id}`}>
                              <td>{fmtDateTime(scrap.created_at)}</td>
                              <td>{order?.code || scrap.op_code || 'N/A'}</td>
                              <td>{formatPieces(scrap.qty)}</td>
                              <td>{formatCurrency(valueMeta.totalValue)}</td>
                              <td>{scrap.reason || 'N/A'}</td>
                              <td>{scrap.operator || 'N/A'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="panel-box">
                <h3 className="panel-title">Outras informações relevantes</h3>
                {detail.lowEffLogs.length === 0 && detail.sessions.length === 0 ? (
                  <div className="empty-state">Nenhum evento adicional encontrado no recorte.</div>
                ) : (
                  <div className="rastreio-detail-stack">
                    {detail.lowEffLogs.length > 0 && (
                      <div>
                        <div className="rastreio-section-subtitle">Baixa eficiência</div>
                        <div className="rastreio-summary-table-wrap compact">
                          <table className="rastreio-summary-table compact">
                            <thead>
                              <tr>
                                <th>Início</th>
                                <th>Fim</th>
                                <th>Duração</th>
                                <th>Motivo</th>
                                <th>Observação</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.lowEffLogs.map((event) => (
                                <tr key={`low-${event.id}`}>
                                  <td>{fmtDateTime(event.started_at)}</td>
                                  <td>{event.ended_at ? fmtDateTime(event.ended_at) : 'Em aberto'}</td>
                                  <td>{formatDurationMs(event.filteredMs)}</td>
                                  <td>{event.reason || 'N/A'}</td>
                                  <td>{event.notes || 'N/A'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {detail.sessions.length > 0 && (
                      <div>
                        <div className="rastreio-section-subtitle">Sessões de produção</div>
                        <div className="rastreio-summary-table-wrap compact">
                          <table className="rastreio-summary-table compact">
                            <thead>
                              <tr>
                                <th>Início</th>
                                <th>Fim</th>
                                <th>Duração no recorte</th>
                                <th>O.S</th>
                                <th>Encerramento</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.sessions.map((session) => {
                                const order = summaryDataset.ordersById[String(session.order_id || '')]
                                return (
                                  <tr key={`session-${session.id}`}>
                                    <td>{fmtDateTime(session.started_at)}</td>
                                    <td>{session.ended_at ? fmtDateTime(session.ended_at) : 'Em aberto'}</td>
                                    <td>{formatDurationMs(session.filteredMs)}</td>
                                    <td>{order?.code || 'N/A'}</td>
                                    <td>{session.end_reason || 'Em andamento'}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
