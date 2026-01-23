// src/lib/techSheetService.js
// Camada de serviço para fichas técnicas (máquina + item + revisões)
// Hoje grava em Supabase se as tabelas existirem; se falhar, usa localStorage como fallback.

import { supabase } from './supabaseClient'

const STORAGE_KEY = 'tech-sheets-v1'
const TABLE_SHEETS = 'tech_sheets'
const TABLE_REVISIONS = 'tech_sheet_revisions'
const TABLE_ITEMS = 'items'
let supabaseTablesMissing = false

function isMissingTableError(err) {
  const msg = (err?.message || '').toLowerCase()
  const code = (err?.code || '').toLowerCase()
  return code === 'pgrst205' || msg.includes('could not find the table')
}

function readLocal() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch (_) {
    return []
  }
}

function writeLocal(list) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list || []))
  } catch (_) {}
}

function buildSheetResponse(sheet, revisions) {
  return {
    id: sheet.id,
    machine_id: sheet.machine_id,
    item_code: sheet.item_code,
    description: sheet.description || '',
    created_at: sheet.created_at || new Date().toISOString(),
    revisions: (revisions || []).sort((a, b) => Number(b.revision || 0) - Number(a.revision || 0)),
  }
}

async function fetchFromSupabase(machineId, itemCode) {
  const filters = []
  if (machineId) filters.push(['machine_id', machineId])
  if (itemCode) filters.push(['item_code', itemCode])

  let query = supabase.from(TABLE_SHEETS).select('*')
  filters.forEach(([col, val]) => {
    query = query.eq(col, val)
  })
  const { data: sheets, error: errSheets } = await query.order('created_at', { ascending: false })
  if (errSheets) throw errSheets
  if (!Array.isArray(sheets) || sheets.length === 0) return []

  const ids = sheets.map((s) => s.id).filter(Boolean)
  const { data: revs, error: errRevs } = await supabase
    .from(TABLE_REVISIONS)
    .select('*')
    .in('sheet_id', ids)
    .order('revision', { ascending: false })

  if (errRevs) throw errRevs

  const revBySheet = revs?.reduce((acc, r) => {
    const key = r.sheet_id
    acc[key] = acc[key] || []
    acc[key].push(r)
    return acc
  }, {}) || {}

  return sheets.map((s) => buildSheetResponse(s, revBySheet[s.id] || []))
}

function fetchFromLocal(machineId, itemCode) {
  const base = readLocal()
  return base
    .filter((s) => !machineId || s.machine_id === machineId)
    .filter((s) => !itemCode || String(s.item_code || '').toUpperCase() === String(itemCode).toUpperCase())
    .map((s) => buildSheetResponse(s, s.revisions || []))
}

export async function fetchSheets({ machineId, itemCode }) {
  if (supabaseTablesMissing) return fetchFromLocal(machineId, itemCode)
  try {
    return await fetchFromSupabase(machineId, itemCode)
  } catch (err) {
    if (isMissingTableError(err)) {
      supabaseTablesMissing = true
      console.warn('techSheetService: tabela tech_sheets ausente, usando armazenamento local.')
    } else {
      console.warn('techSheetService: fallback local (fetch)', err)
    }
    return fetchFromLocal(machineId, itemCode)
  }
}

export async function fetchItemByCode(code) {
  if (!code) return null
  try {
    const { data, error } = await supabase
      .from(TABLE_ITEMS)
      .select('code, description, color, cycle_seconds, cavities, part_weight_g, resin')
      .eq('code', code)
      .maybeSingle()
    if (error) throw error
    return data || null
  } catch (err) {
    console.warn('techSheetService: falha ao buscar item', err)
    return null
  }
}

async function nextRevisionSupabase(sheetId) {
  const { data, error } = await supabase
    .from(TABLE_REVISIONS)
    .select('revision')
    .eq('sheet_id', sheetId)
    .order('revision', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  const prev = Number(data?.revision || 0)
  return prev + 1
}

function nextRevisionLocal(sheetId) {
  const list = readLocal()
  const sheet = list.find((s) => String(s.id) === String(sheetId))
  if (!sheet) return 1
  const top = (sheet.revisions || []).reduce((max, r) => Math.max(max, Number(r.revision || 0)), 0)
  return top + 1
}

export async function createSheetWithRevision({ machineId, itemCode, description, parameters, observations, author }) {
  const now = new Date().toISOString()
  const revisionPayload = {
    revision: 0,
    parameters: parameters || '',
    observations: observations || '',
    author: author || 'Desconhecido',
    changes: 'Criação da ficha técnica',
    created_at: now,
  }

  try {
    if (supabaseTablesMissing) throw new Error('skip supabase: missing table')
    const { data: sheetRow, error: sheetErr } = await supabase
      .from(TABLE_SHEETS)
      .insert([{ machine_id: machineId, item_code: itemCode, description: description || '', created_at: now }])
      .select('*')
      .maybeSingle()

    if (sheetErr) throw sheetErr
    if (!sheetRow?.id) throw new Error('Sheet insert sem id')

    const { data: revRow, error: revErr } = await supabase
      .from(TABLE_REVISIONS)
      .insert([{ ...revisionPayload, sheet_id: sheetRow.id }])
      .select('*')
      .maybeSingle()

    if (revErr) throw revErr

    return buildSheetResponse(sheetRow, [revRow])
  } catch (err) {
    if (isMissingTableError(err)) {
      supabaseTablesMissing = true
      console.warn('techSheetService: tabela tech_sheets ausente, salvando apenas localmente.')
    } else {
      console.warn('techSheetService: fallback local (create)', err)
    }
    const list = readLocal()
    const sheetId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const sheet = {
      id: sheetId,
      machine_id: machineId,
      item_code: itemCode,
      description: description || '',
      created_at: now,
      revisions: [revisionPayload],
    }
    list.unshift(sheet)
    writeLocal(list)
    return sheet
  }
}

export async function createRevision({ sheetId, machineId, itemCode, description, parameters, observations, author, changes }) {
  const now = new Date().toISOString()
  try {
    if (supabaseTablesMissing) throw new Error('skip supabase: missing table')

    // Fetch sheet first to ensure we have a base row even if later update fails
    const { data: baseSheet, error: fetchErr } = await supabase
      .from(TABLE_SHEETS)
      .select('*')
      .eq('id', sheetId)
      .maybeSingle()
    if (fetchErr) throw fetchErr
    if (!baseSheet?.id) throw new Error('Sheet not found before creating revision')

    const revNum = await nextRevisionSupabase(sheetId)
    const payload = {
      sheet_id: sheetId,
      revision: revNum,
      parameters: parameters || '',
      observations: observations || '',
      author: author || 'Desconhecido',
      changes: changes || 'Atualização de ficha',
      created_at: now,
    }
    const { data: revRow, error: revErr } = await supabase
      .from(TABLE_REVISIONS)
      .insert([payload])
      .select('*')
      .maybeSingle()
    if (revErr) throw revErr

    // Update description only when changed; ignore empty returns to avoid 406 breaking flow
    if (description && description !== baseSheet.description) {
      const { error: sheetErr } = await supabase
        .from(TABLE_SHEETS)
        .update({ description })
        .eq('id', sheetId)
      if (sheetErr && !isMissingTableError(sheetErr)) {
        console.warn('techSheetService: update description falhou', sheetErr)
      }
    }

    if (!revRow?.id) throw new Error('Revision insert returned empty row')

    return buildSheetResponse({ ...baseSheet, description: description || baseSheet.description }, [revRow])
  } catch (err) {
    if (isMissingTableError(err)) {
      supabaseTablesMissing = true
      console.warn('techSheetService: tabela tech_sheets ausente, revisões apenas local.')
    } else {
      console.warn('techSheetService: fallback local (revision)', err)
    }
    const list = readLocal()
    const idx = list.findIndex((s) => String(s.id) === String(sheetId))
    const sheet = idx === -1
      ? {
          id: sheetId,
          machine_id: machineId,
          item_code: itemCode,
          description: description || '',
          created_at: now,
          revisions: [],
        }
      : list[idx]
    const revNum = nextRevisionLocal(sheetId)
    const rev = {
      revision: revNum,
      parameters: parameters || '',
      observations: observations || '',
      author: author || 'Desconhecido',
      changes: changes || 'Atualização de ficha',
      created_at: now,
    }
    const updated = {
      ...sheet,
      description: description || sheet.description,
      revisions: [rev, ...(sheet.revisions || [])],
    }
    if (idx === -1) {
      list.unshift(updated)
    } else {
      list[idx] = updated
    }
    writeLocal(list)
    return updated
  }
}

export async function deleteSheet(sheetId) {
  try {
    const { error: revErr } = await supabase.from(TABLE_REVISIONS).delete().eq('sheet_id', sheetId)
    if (revErr) throw revErr
    const { error: sheetErr } = await supabase.from(TABLE_SHEETS).delete().eq('id', sheetId)
    if (sheetErr) throw sheetErr
    return true
  } catch (err) {
    if (isMissingTableError(err)) {
      supabaseTablesMissing = true
      console.warn('techSheetService: tabela ausente, removendo apenas localmente.')
      const list = readLocal().filter((s) => String(s.id) !== String(sheetId))
      writeLocal(list)
      return true
    }
    console.warn('techSheetService: delete falhou no supabase', err)
    throw err
  }
}
