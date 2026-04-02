import { DateTime } from 'luxon'

export const SHIFT_ZONE = 'America/Sao_Paulo'
export const SHIFT_POLICY_CHANGE_DATE = '2026-03-30'
export const SCHEDULED_STOP_REASON = 'PARADA PROGRAMADA'
export const ACTIVE_SHIFT_KEYS = ['1', '2']
export const ACTIVE_TURNOS = [
  { key: '1', label: 'Turno 1' },
  { key: '2', label: 'Turno 2' },
]

const LEGACY_WEEKDAY_SHIFTS = [
  { shiftKey: '1', label: 'Turno 1', startHour: 5, startMinute: 15, endHour: 13, endMinute: 45 },
  { shiftKey: '2', label: 'Turno 2', startHour: 13, startMinute: 45, endHour: 22, endMinute: 15 },
  { shiftKey: '3', label: 'Turno 3', startHour: 22, startMinute: 15, endHour: 5, endMinute: 15 },
]

const LEGACY_SATURDAY_SHIFTS = [
  { shiftKey: '1', label: 'Turno 1', startHour: 5, startMinute: 15, endHour: 9, endMinute: 15 },
  { shiftKey: '2', label: 'Turno 2', startHour: 9, startMinute: 15, endHour: 13, endMinute: 15 },
]

const LEGACY_SUNDAY_SHIFTS = [
  { shiftKey: '3', label: 'Turno 3', startHour: 23, startMinute: 15, endHour: 5, endMinute: 15 },
]

const CURRENT_WEEKDAY_SHIFTS = [
  { shiftKey: '1', label: 'Turno 1', startHour: 5, startMinute: 0, endHour: 13, endMinute: 30 },
  { shiftKey: '2', label: 'Turno 2', startHour: 13, startMinute: 30, endHour: 22, endMinute: 0 },
]

const CURRENT_SATURDAY_SHIFTS = [
  { shiftKey: '1', label: 'Turno 1', startHour: 5, startMinute: 0, endHour: 9, endMinute: 0 },
  { shiftKey: '2', label: 'Turno 2', startHour: 9, startMinute: 0, endHour: 13, endMinute: 0 },
]

function toShiftDateTime(dateInput = null) {
  if (!dateInput) return DateTime.now().setZone(SHIFT_ZONE)

  if (DateTime.isDateTime(dateInput)) {
    return dateInput.setZone(SHIFT_ZONE)
  }

  if (dateInput instanceof Date) {
    return DateTime.fromJSDate(dateInput).setZone(SHIFT_ZONE)
  }

  if (typeof dateInput === 'number') {
    return DateTime.fromMillis(dateInput, { zone: SHIFT_ZONE })
  }

  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim()
    if (!trimmed) return DateTime.now().setZone(SHIFT_ZONE)

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return DateTime.fromISO(trimmed, { zone: SHIFT_ZONE }).startOf('day')
    }

    const parsed = DateTime.fromISO(trimmed, { setZone: true })
    if (parsed.isValid) return parsed.setZone(SHIFT_ZONE)
  }

  return DateTime.now().setZone(SHIFT_ZONE)
}

function isLegacyPolicy(dateTime, preserveLegacy = true) {
  if (!preserveLegacy) return false
  const effectiveDate = DateTime.fromISO(SHIFT_POLICY_CHANGE_DATE, { zone: SHIFT_ZONE }).startOf('day')
  return dateTime < effectiveDate
}

function getShiftDefinitions(dateInput, { preserveLegacy = true } = {}) {
  const dateTime = toShiftDateTime(dateInput)
  const weekday = dateTime.weekday % 7
  const legacyPolicy = isLegacyPolicy(dateTime, preserveLegacy)

  if (legacyPolicy) {
    if (weekday >= 1 && weekday <= 5) return LEGACY_WEEKDAY_SHIFTS
    if (weekday === 6) return LEGACY_SATURDAY_SHIFTS
    if (weekday === 0) return LEGACY_SUNDAY_SHIFTS
    return []
  }

  if (weekday >= 1 && weekday <= 5) return CURRENT_WEEKDAY_SHIFTS
  if (weekday === 6) return CURRENT_SATURDAY_SHIFTS
  return []
}

export function normalizeShiftKey(value) {
  const normalized = String(value ?? '').trim()
  return normalized === '1' || normalized === '2' || normalized === '3' ? normalized : null
}

export function getShiftLabel(shift) {
  const normalized = normalizeShiftKey(shift)
  if (normalized === '1') return 'Turno 1'
  if (normalized === '2') return 'Turno 2'
  if (normalized === '3') return 'Turno 3'
  return 'Sem programacao'
}

export function getShiftWindowsForDay(dateInput, options = {}) {
  const base = toShiftDateTime(dateInput).startOf('day')
  const definitions = getShiftDefinitions(base, options)

  return definitions.map((definition) => {
    const start = base.set({
      hour: definition.startHour,
      minute: definition.startMinute,
      second: 0,
      millisecond: 0,
    })
    let end = base.set({
      hour: definition.endHour,
      minute: definition.endMinute,
      second: 0,
      millisecond: 0,
    })
    if (end <= start) end = end.plus({ days: 1 })

    return {
      shiftKey: definition.shiftKey,
      label: definition.label,
      start,
      end,
    }
  })
}

export function getShiftWindowAt(dateInput = null, options = {}) {
  const dateTime = toShiftDateTime(dateInput)
  const windows = [
    ...getShiftWindowsForDay(dateTime.minus({ days: 1 }), options),
    ...getShiftWindowsForDay(dateTime, options),
  ]
  return windows.find((window) => dateTime >= window.start && dateTime < window.end) || null
}

export function getTurnoAtual(dateInput = null, options = {}) {
  return getShiftWindowAt(dateInput, options)?.shiftKey || null
}

function getScheduledStopWindowsForDay(dateInput, { preserveLegacy = true } = {}) {
  const base = toShiftDateTime(dateInput).startOf('day')
  if (isLegacyPolicy(base, preserveLegacy)) return []

  if (base.weekday >= 1 && base.weekday <= 5) {
    return [{
      reason: SCHEDULED_STOP_REASON,
      start: base.set({ hour: 22, minute: 0, second: 0, millisecond: 0 }),
      end: base.plus({ days: 1 }).set({ hour: 5, minute: 0, second: 0, millisecond: 0 }),
    }]
  }

  if (base.weekday === 6) {
    return [{
      reason: SCHEDULED_STOP_REASON,
      start: base.set({ hour: 13, minute: 0, second: 0, millisecond: 0 }),
      end: base.plus({ days: 2 }).set({ hour: 5, minute: 0, second: 0, millisecond: 0 }),
    }]
  }

  return []
}

export function getScheduledStopWindowAt(dateInput = null, options = {}) {
  const dateTime = toShiftDateTime(dateInput)
  const windows = [
    ...getScheduledStopWindowsForDay(dateTime.minus({ days: 2 }), options),
    ...getScheduledStopWindowsForDay(dateTime.minus({ days: 1 }), options),
    ...getScheduledStopWindowsForDay(dateTime, options),
  ]

  return windows.find((window) => dateTime >= window.start && dateTime < window.end) || null
}

export function isScheduledStopActive(dateInput = null, options = {}) {
  return !!getScheduledStopWindowAt(dateInput, options)
}

export function getShiftWindowsInRange(startInput, endInput, {
  preserveLegacy = true,
  shiftKeys = null,
  setupMinutes = 0,
} = {}) {
  const start = toShiftDateTime(startInput)
  const end = toShiftDateTime(endInput)
  if (!start.isValid || !end.isValid || end <= start) return []

  const allowedShiftKeys = Array.isArray(shiftKeys)
    ? new Set(shiftKeys.map((value) => String(value)))
    : null

  const intervals = []
  let cursor = start.startOf('day').minus({ days: 1 })
  const lastDay = end.startOf('day')

  while (cursor <= lastDay) {
    const windows = getShiftWindowsForDay(cursor, { preserveLegacy })

    for (const window of windows) {
      if (allowedShiftKeys && !allowedShiftKeys.has(window.shiftKey)) continue

      const durationMinutes = Math.max(0, Math.floor(window.end.diff(window.start, 'minutes').minutes))
      const shiftStart = window.start.plus({ minutes: Math.min(setupMinutes, durationMinutes) })
      const intervalStart = Math.max(shiftStart.toMillis(), start.toMillis())
      const intervalEnd = Math.min(window.end.toMillis(), end.toMillis())

      if (intervalEnd > intervalStart) {
        intervals.push([intervalStart, intervalEnd])
      }
    }

    cursor = cursor.plus({ days: 1 })
  }

  return intervals
}