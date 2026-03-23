import { useEffect, useMemo, useState } from 'react'
import Modal from '../components/Modal'
import { supabase } from '../lib/supabaseClient'
import { fmtDateTime } from '../lib/utils'
import '../styles/gerenciamento-avancado.css'

const SECTIONS = [
  { key: 'orders', label: 'Ordens de Produção' },
  { key: 'machine_stops', label: 'Paradas de Máquina' },
  { key: 'items', label: 'Produtos' },
  { key: 'production_scans', label: 'Bipagens' },
  { key: 'injection_entries', label: 'Apontamentos de Produção' },
  { key: 'scrap_logs', label: 'Apontamentos de Refugo' },
]

function text(v) {
  return String(v ?? '').trim()
}

function toLower(v) {
  return text(v).toLowerCase()
}

function matchesQuery(row, query, fields) {
  if (!query) return true
  const q = toLower(query)
  return fields.some((field) => toLower(row?.[field]).includes(q))
}

function toInputDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day}T${hh}:${mm}`
}

function localDateTimeToIso(value) {
  if (!value) return null
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return null
  return d.toISOString()
}

function formatError(err, fallback) {
  if (!err) return fallback
  const msg = text(err.message || err.details || err.hint)
  return msg || fallback
}

function BoolBadge({ value }) {
  return (
    <span className={`ga-badge ${value ? 'ok' : 'muted'}`}>
      {value ? 'Sim' : 'Não'}
    </span>
  )
}

export default function GerenciamentoAvancado() {
  const [activeSection, setActiveSection] = useState('orders')

  const [feedback, setFeedback] = useState({ type: 'ok', msg: '' })

  const [orders, setOrders] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState('')
  const [ordersQuery, setOrdersQuery] = useState('')
  const [ordersFinalizedFilter, setOrdersFinalizedFilter] = useState('all')

  const [stops, setStops] = useState([])
  const [stopsLoading, setStopsLoading] = useState(false)
  const [stopsError, setStopsError] = useState('')
  const [stopsQuery, setStopsQuery] = useState('')

  const [items, setItems] = useState([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState('')
  const [itemsQuery, setItemsQuery] = useState('')

  const [scans, setScans] = useState([])
  const [scansLoading, setScansLoading] = useState(false)
  const [scansError, setScansError] = useState('')
  const [scansQuery, setScansQuery] = useState('')

  const [entries, setEntries] = useState([])
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [entriesError, setEntriesError] = useState('')
  const [entriesQuery, setEntriesQuery] = useState('')

  const [scraps, setScraps] = useState([])
  const [scrapsLoading, setScrapsLoading] = useState(false)
  const [scrapsError, setScrapsError] = useState('')
  const [scrapsQuery, setScrapsQuery] = useState('')

  const [confirmDelete, setConfirmDelete] = useState({
    open: false,
    type: '',
    id: null,
    title: '',
    details: [],
    busy: false,
  })

  const [editModal, setEditModal] = useState({ open: false, type: '', id: null, form: {}, busy: false })

  function pushFeedback(msg, type = 'ok') {
    setFeedback({ type, msg })
    window.clearTimeout(pushFeedback._t)
    pushFeedback._t = window.setTimeout(() => {
      setFeedback((prev) => ({ ...prev, msg: '' }))
    }, 3500)
  }

  async function loadOrders() {
    setOrdersLoading(true)
    setOrdersError('')
    const { data, error } = await supabase
      .from('orders')
      .select('id, code, product, customer, machine_id, status, finalized, created_at, started_at, interrupted_at, restarted_at, finalized_at')
      .order('created_at', { ascending: false })
      .limit(1000)

    if (error) {
      setOrdersError(formatError(error, 'Falha ao carregar ordens.'))
      setOrders([])
    } else {
      setOrders(data || [])
    }
    setOrdersLoading(false)
  }

  async function loadStops() {
    setStopsLoading(true)
    setStopsError('')
    const { data, error } = await supabase
      .from('machine_stops')
      .select('id, order_id, machine_id, reason, notes, started_by, resumed_by, started_at, resumed_at')
      .order('started_at', { ascending: false })
      .limit(1000)

    if (error) {
      setStopsError(formatError(error, 'Falha ao carregar paradas.'))
      setStops([])
    } else {
      setStops(data || [])
    }
    setStopsLoading(false)
  }

  async function loadItems() {
    setItemsLoading(true)
    setItemsError('')
    const { data, error } = await supabase
      .from('items')
      .select('id, code, description, color, resin, unit_value, item_type, created_at')
      .order('code', { ascending: true })
      .limit(1500)

    if (error) {
      setItemsError(formatError(error, 'Falha ao carregar produtos.'))
      setItems([])
    } else {
      setItems(data || [])
    }
    setItemsLoading(false)
  }

  async function loadScans() {
    setScansLoading(true)
    setScansError('')
    const { data, error } = await supabase
      .from('production_scans')
      .select('id, created_at, order_id, op_code, machine_id, shift, scanned_box, qty_pieces, code')
      .order('created_at', { ascending: false })
      .limit(1500)

    if (error) {
      setScansError(formatError(error, 'Falha ao carregar bipagens.'))
      setScans([])
    } else {
      setScans(data || [])
    }
    setScansLoading(false)
  }

  async function loadEntries() {
    setEntriesLoading(true)
    setEntriesError('')
    const { data, error } = await supabase
      .from('injection_production_entries')
      .select('id, created_at, entry_date, order_id, order_code, machine_id, shift, product, good_qty')
      .order('created_at', { ascending: false })
      .limit(1500)

    if (error) {
      setEntriesError(formatError(error, 'Falha ao carregar apontamentos de produção.'))
      setEntries([])
    } else {
      setEntries(data || [])
    }
    setEntriesLoading(false)
  }

  async function loadScraps() {
    setScrapsLoading(true)
    setScrapsError('')
    const { data, error } = await supabase
      .from('scrap_logs')
      .select('id, created_at, order_id, op_code, machine_id, shift, operator, qty, reason')
      .order('created_at', { ascending: false })
      .limit(1500)

    if (error) {
      setScrapsError(formatError(error, 'Falha ao carregar apontamentos de refugo.'))
      setScraps([])
    } else {
      setScraps(data || [])
    }
    setScrapsLoading(false)
  }

  useEffect(() => {
    loadOrders()
    loadStops()
    loadItems()
    loadScans()
    loadEntries()
    loadScraps()
  }, [])

  const filteredOrders = useMemo(
    () => orders
      .filter((row) => {
        if (ordersFinalizedFilter === 'finalized') return !!row.finalized
        if (ordersFinalizedFilter === 'open') return !row.finalized
        return true
      })
      .filter((row) => matchesQuery(row, ordersQuery, ['code', 'product', 'customer', 'machine_id', 'status'])),
    [orders, ordersQuery, ordersFinalizedFilter]
  )

  const filteredStops = useMemo(
    () => stops.filter((row) => matchesQuery(row, stopsQuery, ['order_id', 'machine_id', 'reason', 'notes', 'started_by', 'resumed_by'])),
    [stops, stopsQuery]
  )

  const filteredItems = useMemo(
    () => items.filter((row) => matchesQuery(row, itemsQuery, ['code', 'description', 'color', 'resin', 'item_type'])),
    [items, itemsQuery]
  )

  const filteredScans = useMemo(
    () => scans.filter((row) => matchesQuery(row, scansQuery, ['order_id', 'op_code', 'machine_id', 'shift', 'scanned_box', 'code'])),
    [scans, scansQuery]
  )

  const filteredEntries = useMemo(
    () => entries.filter((row) => matchesQuery(row, entriesQuery, ['order_id', 'order_code', 'machine_id', 'shift', 'product'])),
    [entries, entriesQuery]
  )

  const filteredScraps = useMemo(
    () => scraps.filter((row) => matchesQuery(row, scrapsQuery, ['order_id', 'op_code', 'machine_id', 'shift', 'operator', 'reason'])),
    [scraps, scrapsQuery]
  )

  function openDeleteModal(type, row) {
    if (!row?.id) return

    let title = 'Confirmar exclusão'
    let details = [`ID: ${row.id}`]

    if (type === 'orders') {
      title = 'Excluir Ordem de Produção'
      details = [
        `O.P: ${row.code || '-'}`,
        `Produto: ${row.product || '-'}`,
        `Máquina: ${row.machine_id || '-'}`,
      ]
    } else if (type === 'machine_stops') {
      title = 'Excluir Parada de Máquina'
      details = [
        `Ordem ID: ${row.order_id || '-'}`,
        `Máquina: ${row.machine_id || '-'}`,
        `Motivo: ${row.reason || '-'}`,
      ]
    } else if (type === 'items') {
      title = 'Excluir Produto Cadastrado'
      details = [
        `Código: ${row.code || '-'}`,
        `Descrição: ${row.description || '-'}`,
      ]
    } else if (type === 'production_scans') {
      title = 'Excluir Bipagem'
      details = [
        `OP Code: ${row.op_code || '-'}`,
        `Máquina: ${row.machine_id || '-'}`,
        `Caixa: ${row.scanned_box || '-'}`,
      ]
    } else if (type === 'injection_entries') {
      title = 'Excluir Apontamento de Produção'
      details = [
        `Order ID: ${row.order_id || '-'}`,
        `OP Code: ${row.order_code || '-'}`,
        `Máquina: ${row.machine_id || '-'}`,
      ]
    } else if (type === 'scrap_logs') {
      title = 'Excluir Apontamento de Refugo'
      details = [
        `Order ID: ${row.order_id || '-'}`,
        `Máquina: ${row.machine_id || '-'}`,
        `Motivo: ${row.reason || '-'}`,
      ]
    }

    setConfirmDelete({
      open: true,
      type,
      id: row.id,
      title,
      details,
      busy: false,
    })
  }

  async function confirmDeleteRecord() {
    if (!confirmDelete.id || !confirmDelete.type) return

    setConfirmDelete((prev) => ({ ...prev, busy: true }))

    const tableMap = {
      orders: 'orders',
      machine_stops: 'machine_stops',
      items: 'items',
      production_scans: 'production_scans',
      injection_entries: 'injection_production_entries',
      scrap_logs: 'scrap_logs',
    }

    const table = tableMap[confirmDelete.type]
    const { error } = await supabase.from(table).delete().eq('id', confirmDelete.id)

    if (error) {
      pushFeedback(formatError(error, 'Não foi possível excluir este registro.'), 'err')
      setConfirmDelete((prev) => ({ ...prev, busy: false }))
      return
    }

    setConfirmDelete({ open: false, type: '', id: null, title: '', details: [], busy: false })

    if (confirmDelete.type === 'orders') await loadOrders()
    if (confirmDelete.type === 'machine_stops') await loadStops()
    if (confirmDelete.type === 'items') await loadItems()
    if (confirmDelete.type === 'production_scans') await loadScans()
    if (confirmDelete.type === 'injection_entries') await loadEntries()
    if (confirmDelete.type === 'scrap_logs') await loadScraps()

    pushFeedback('Registro excluído com sucesso.', 'ok')
  }

  function openEditModal(type, row) {
    if (!row?.id) return

    if (type === 'machine_stops') {
      setEditModal({
        open: true,
        type,
        id: row.id,
        busy: false,
        form: {
          machine_id: text(row.machine_id),
          reason: text(row.reason),
          notes: text(row.notes),
          started_at: toInputDateTime(row.started_at),
          resumed_at: toInputDateTime(row.resumed_at),
        },
      })
      return
    }

    if (type === 'injection_entries') {
      setEditModal({
        open: true,
        type,
        id: row.id,
        busy: false,
        form: {
          machine_id: text(row.machine_id),
          shift: text(row.shift),
          product: text(row.product),
          good_qty: String(row.good_qty ?? ''),
          created_at: toInputDateTime(row.created_at),
          entry_date: text(row.entry_date),
        },
      })
      return
    }

    if (type === 'order_milestones') {
      setEditModal({
        open: true,
        type,
        id: row.id,
        busy: false,
        form: {
          code: text(row.code),
          started_at: toInputDateTime(row.started_at),
          interrupted_at: toInputDateTime(row.interrupted_at),
          finalized_at: toInputDateTime(row.finalized_at),
          restarted_at: toInputDateTime(row.restarted_at),
        },
      })
      return
    }

    if (type === 'scrap_logs') {
      setEditModal({
        open: true,
        type,
        id: row.id,
        busy: false,
        form: {
          machine_id: text(row.machine_id),
          shift: text(row.shift),
          operator: text(row.operator),
          qty: String(row.qty ?? ''),
          reason: text(row.reason),
          created_at: toInputDateTime(row.created_at),
        },
      })
    }
  }

  async function saveEdition() {
    if (!editModal.open || !editModal.id || !editModal.type) return

    setEditModal((prev) => ({ ...prev, busy: true }))

    if (editModal.type === 'machine_stops') {
      const payload = {
        machine_id: text(editModal.form.machine_id) || null,
        reason: text(editModal.form.reason) || null,
        notes: text(editModal.form.notes) || null,
        started_at: localDateTimeToIso(editModal.form.started_at),
        resumed_at: localDateTimeToIso(editModal.form.resumed_at),
      }

      if (!payload.started_at) {
        pushFeedback('Data/hora de início da parada é obrigatória.', 'err')
        setEditModal((prev) => ({ ...prev, busy: false }))
        return
      }

      const { error } = await supabase.from('machine_stops').update(payload).eq('id', editModal.id)

      if (error) {
        pushFeedback(formatError(error, 'Não foi possível atualizar a parada.'), 'err')
        setEditModal((prev) => ({ ...prev, busy: false }))
        return
      }

      setEditModal({ open: false, type: '', id: null, form: {}, busy: false })
      await loadStops()
      pushFeedback('Parada atualizada com sucesso.', 'ok')
      return
    }

    if (editModal.type === 'injection_entries') {
      const qty = Number(editModal.form.good_qty)
      const payload = {
        machine_id: text(editModal.form.machine_id) || null,
        shift: text(editModal.form.shift) || null,
        product: text(editModal.form.product) || null,
        good_qty: Number.isFinite(qty) ? qty : null,
        created_at: localDateTimeToIso(editModal.form.created_at),
        entry_date: text(editModal.form.entry_date) || null,
      }

      const { error } = await supabase.from('injection_production_entries').update(payload).eq('id', editModal.id)

      if (error) {
        pushFeedback(formatError(error, 'Não foi possível atualizar o apontamento de produção.'), 'err')
        setEditModal((prev) => ({ ...prev, busy: false }))
        return
      }

      setEditModal({ open: false, type: '', id: null, form: {}, busy: false })
      await loadEntries()
      pushFeedback('Apontamento de produção atualizado com sucesso.', 'ok')
      return
    }

    if (editModal.type === 'scrap_logs') {
      const qty = Number(editModal.form.qty)
      const payload = {
        machine_id: text(editModal.form.machine_id) || null,
        shift: text(editModal.form.shift) || null,
        operator: text(editModal.form.operator) || null,
        qty: Number.isFinite(qty) ? qty : null,
        reason: text(editModal.form.reason) || null,
        created_at: localDateTimeToIso(editModal.form.created_at),
      }

      const { error } = await supabase.from('scrap_logs').update(payload).eq('id', editModal.id)

      if (error) {
        pushFeedback(formatError(error, 'Não foi possível atualizar o apontamento de refugo.'), 'err')
        setEditModal((prev) => ({ ...prev, busy: false }))
        return
      }

      setEditModal({ open: false, type: '', id: null, form: {}, busy: false })
      await loadScraps()
      pushFeedback('Apontamento de refugo atualizado com sucesso.', 'ok')
      return
    }

    if (editModal.type === 'order_milestones') {
      const payload = {
        started_at: localDateTimeToIso(editModal.form.started_at),
        interrupted_at: localDateTimeToIso(editModal.form.interrupted_at),
        restarted_at: localDateTimeToIso(editModal.form.restarted_at),
        finalized_at: localDateTimeToIso(editModal.form.finalized_at),
      }

      const { error } = await supabase.from('orders').update(payload).eq('id', editModal.id)

      if (error) {
        pushFeedback(formatError(error, 'Não foi possível atualizar os eventos da O.P.'), 'err')
        setEditModal((prev) => ({ ...prev, busy: false }))
        return
      }

      setEditModal({ open: false, type: '', id: null, form: {}, busy: false })
      await loadOrders()
      pushFeedback('Eventos da O.P atualizados com sucesso.', 'ok')
    }
  }

  async function clearOrderMilestone(fieldName, fieldLabel) {
    if (!editModal?.id) return

    const confirmed = window.confirm(`Tem certeza que deseja excluir o evento de ${fieldLabel} desta O.P?`)
    if (!confirmed) return

    setEditModal((prev) => ({ ...prev, busy: true }))

    const { error } = await supabase.from('orders').update({ [fieldName]: null }).eq('id', editModal.id)

    if (error) {
      pushFeedback(formatError(error, `Não foi possível excluir o evento de ${fieldLabel}.`), 'err')
      setEditModal((prev) => ({ ...prev, busy: false }))
      return
    }

    setEditModal((prev) => ({
      ...prev,
      busy: false,
      form: {
        ...prev.form,
        [fieldName]: '',
      },
    }))

    await loadOrders()
    pushFeedback(`Evento de ${fieldLabel} excluído com sucesso.`, 'ok')
  }

  function renderFeedback() {
    if (!feedback.msg) return null
    return (
      <div className={`ga-feedback ${feedback.type === 'err' ? 'err' : 'ok'}`}>
        {feedback.msg}
      </div>
    )
  }

  function renderOrders() {
    return (
      <section className="card ga-section">
        <div className="ga-head">
          <h3>Ordens de Produção</h3>
          <button className="btn" onClick={loadOrders} disabled={ordersLoading}>Atualizar</button>
        </div>
        <div className="ga-order-filters">
          <label className="label">
            Mostrar ordens finalizadas
            <select
              className="select"
              value={ordersFinalizedFilter}
              onChange={(e) => setOrdersFinalizedFilter(e.target.value)}
            >
              <option value="all">Todas</option>
              <option value="open">Somente não finalizadas</option>
              <option value="finalized">Somente finalizadas</option>
            </select>
          </label>
        </div>
        <input
          className="input"
          placeholder="Buscar por O.P., produto, cliente, status ou máquina"
          value={ordersQuery}
          onChange={(e) => setOrdersQuery(e.target.value)}
        />
        {ordersError && <div className="ga-error">{ordersError}</div>}
        {ordersLoading ? <div className="muted ga-loading">Carregando ordens...</div> : null}
        <div className="ga-table-wrap">
          <table className="ga-table">
            <thead>
              <tr>
                <th>O.P.</th>
                <th>Produto</th>
                <th>Cliente</th>
                <th>Máquina</th>
                <th>Status</th>
                <th>Finalizada</th>
                <th>Início</th>
                <th>Interrupção</th>
                <th>Fim</th>
                <th>Criada</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((row) => (
                <tr key={row.id}>
                  <td>{row.code || '-'}</td>
                  <td>{row.product || '-'}</td>
                  <td>{row.customer || '-'}</td>
                  <td>{row.machine_id || '-'}</td>
                  <td>{row.status || '-'}</td>
                  <td><BoolBadge value={!!row.finalized} /></td>
                  <td>{fmtDateTime(row.started_at)}</td>
                  <td>{fmtDateTime(row.interrupted_at)}</td>
                  <td>{fmtDateTime(row.finalized_at)}</td>
                  <td>{fmtDateTime(row.created_at)}</td>
                  <td className="ga-actions">
                    <button className="btn" onClick={() => openEditModal('order_milestones', row)}>Editar eventos O.P</button>
                    <button className="btn" onClick={() => openDeleteModal('orders', row)}>Excluir</button>
                  </td>
                </tr>
              ))}
              {!ordersLoading && filteredOrders.length === 0 ? (
                <tr><td colSpan={11} className="ga-empty">Nenhuma ordem encontrada.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    )
  }

  function renderStops() {
    return (
      <section className="card ga-section">
        <div className="ga-head">
          <h3>Paradas de Máquina</h3>
          <button className="btn" onClick={loadStops} disabled={stopsLoading}>Atualizar</button>
        </div>
        <input
          className="input"
          placeholder="Buscar por order_id, máquina, motivo, observação ou operador"
          value={stopsQuery}
          onChange={(e) => setStopsQuery(e.target.value)}
        />
        {stopsError && <div className="ga-error">{stopsError}</div>}
        {stopsLoading ? <div className="muted ga-loading">Carregando paradas...</div> : null}
        <div className="ga-table-wrap">
          <table className="ga-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Order ID</th>
                <th>Máquina</th>
                <th>Motivo</th>
                <th>Início</th>
                <th>Fim</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredStops.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.order_id || '-'}</td>
                  <td>{row.machine_id || '-'}</td>
                  <td>{row.reason || '-'}</td>
                  <td>{fmtDateTime(row.started_at)}</td>
                  <td>{fmtDateTime(row.resumed_at)}</td>
                  <td className="ga-actions">
                    <button className="btn" onClick={() => openEditModal('machine_stops', row)}>Editar</button>
                    <button className="btn" onClick={() => openDeleteModal('machine_stops', row)}>Excluir</button>
                  </td>
                </tr>
              ))}
              {!stopsLoading && filteredStops.length === 0 ? (
                <tr><td colSpan={7} className="ga-empty">Nenhuma parada encontrada.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    )
  }

  function renderItems() {
    return (
      <section className="card ga-section">
        <div className="ga-head">
          <h3>Produtos Cadastrados</h3>
          <button className="btn" onClick={loadItems} disabled={itemsLoading}>Atualizar</button>
        </div>
        <input
          className="input"
          placeholder="Buscar por código, descrição, cor, resina ou tipo"
          value={itemsQuery}
          onChange={(e) => setItemsQuery(e.target.value)}
        />
        {itemsError && <div className="ga-error">{itemsError}</div>}
        {itemsLoading ? <div className="muted ga-loading">Carregando produtos...</div> : null}
        <div className="ga-table-wrap">
          <table className="ga-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>Cor</th>
                <th>Resina</th>
                <th>Tipo</th>
                <th>Valor Unitário</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((row) => (
                <tr key={row.id}>
                  <td>{row.code || '-'}</td>
                  <td>{row.description || '-'}</td>
                  <td>{row.color || '-'}</td>
                  <td>{row.resin || '-'}</td>
                  <td>{row.item_type || '-'}</td>
                  <td>{row.unit_value ?? '-'}</td>
                  <td>
                    <button className="btn" onClick={() => openDeleteModal('items', row)}>Excluir</button>
                  </td>
                </tr>
              ))}
              {!itemsLoading && filteredItems.length === 0 ? (
                <tr><td colSpan={7} className="ga-empty">Nenhum produto encontrado.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    )
  }

  function renderScans() {
    return (
      <section className="card ga-section">
        <div className="ga-head">
          <h3>Bipagens de Produção</h3>
          <button className="btn" onClick={loadScans} disabled={scansLoading}>Atualizar</button>
        </div>
        <input
          className="input"
          placeholder="Buscar por order_id, op_code, máquina, turno, caixa ou código"
          value={scansQuery}
          onChange={(e) => setScansQuery(e.target.value)}
        />
        {scansError && <div className="ga-error">{scansError}</div>}
        {scansLoading ? <div className="muted ga-loading">Carregando bipagens...</div> : null}
        <div className="ga-table-wrap">
          <table className="ga-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Data</th>
                <th>Order ID</th>
                <th>OP Code</th>
                <th>Máquina</th>
                <th>Turno</th>
                <th>Caixa</th>
                <th>Peças</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredScans.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{fmtDateTime(row.created_at)}</td>
                  <td>{row.order_id || '-'}</td>
                  <td>{row.op_code || '-'}</td>
                  <td>{row.machine_id || '-'}</td>
                  <td>{row.shift || '-'}</td>
                  <td>{row.scanned_box || '-'}</td>
                  <td>{row.qty_pieces ?? '-'}</td>
                  <td>
                    <button className="btn" onClick={() => openDeleteModal('production_scans', row)}>Excluir</button>
                  </td>
                </tr>
              ))}
              {!scansLoading && filteredScans.length === 0 ? (
                <tr><td colSpan={9} className="ga-empty">Nenhuma bipagem encontrada.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    )
  }

  function renderEntries() {
    return (
      <section className="card ga-section">
        <div className="ga-head">
          <h3>Apontamentos de Produção</h3>
          <button className="btn" onClick={loadEntries} disabled={entriesLoading}>Atualizar</button>
        </div>
        <input
          className="input"
          placeholder="Buscar por order_id, op_code, produto, máquina ou turno"
          value={entriesQuery}
          onChange={(e) => setEntriesQuery(e.target.value)}
        />
        {entriesError && <div className="ga-error">{entriesError}</div>}
        {entriesLoading ? <div className="muted ga-loading">Carregando apontamentos de produção...</div> : null}
        <div className="ga-table-wrap">
          <table className="ga-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Data</th>
                <th>Entry Date</th>
                <th>Order ID</th>
                <th>OP Code</th>
                <th>Produto</th>
                <th>Máquina</th>
                <th>Turno</th>
                <th>Peças Boas</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{fmtDateTime(row.created_at)}</td>
                  <td>{row.entry_date || '-'}</td>
                  <td>{row.order_id || '-'}</td>
                  <td>{row.order_code || '-'}</td>
                  <td>{row.product || '-'}</td>
                  <td>{row.machine_id || '-'}</td>
                  <td>{row.shift || '-'}</td>
                  <td>{row.good_qty ?? '-'}</td>
                  <td className="ga-actions">
                    <button className="btn" onClick={() => openEditModal('injection_entries', row)}>Editar</button>
                    <button className="btn" onClick={() => openDeleteModal('injection_entries', row)}>Excluir</button>
                  </td>
                </tr>
              ))}
              {!entriesLoading && filteredEntries.length === 0 ? (
                <tr><td colSpan={10} className="ga-empty">Nenhum apontamento de produção encontrado.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    )
  }

  function renderScraps() {
    return (
      <section className="card ga-section">
        <div className="ga-head">
          <h3>Apontamentos de Refugo</h3>
          <button className="btn" onClick={loadScraps} disabled={scrapsLoading}>Atualizar</button>
        </div>
        <input
          className="input"
          placeholder="Buscar por order_id, máquina, turno, operador ou motivo"
          value={scrapsQuery}
          onChange={(e) => setScrapsQuery(e.target.value)}
        />
        {scrapsError && <div className="ga-error">{scrapsError}</div>}
        {scrapsLoading ? <div className="muted ga-loading">Carregando apontamentos de refugo...</div> : null}
        <div className="ga-table-wrap">
          <table className="ga-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Data</th>
                <th>Order ID</th>
                <th>OP Code</th>
                <th>Máquina</th>
                <th>Turno</th>
                <th>Operador</th>
                <th>Quantidade</th>
                <th>Motivo</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredScraps.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{fmtDateTime(row.created_at)}</td>
                  <td>{row.order_id || '-'}</td>
                  <td>{row.op_code || '-'}</td>
                  <td>{row.machine_id || '-'}</td>
                  <td>{row.shift || '-'}</td>
                  <td>{row.operator || '-'}</td>
                  <td>{row.qty ?? '-'}</td>
                  <td>{row.reason || '-'}</td>
                  <td className="ga-actions">
                    <button className="btn" onClick={() => openEditModal('scrap_logs', row)}>Editar</button>
                    <button className="btn" onClick={() => openDeleteModal('scrap_logs', row)}>Excluir</button>
                  </td>
                </tr>
              ))}
              {!scrapsLoading && filteredScraps.length === 0 ? (
                <tr><td colSpan={10} className="ga-empty">Nenhum apontamento de refugo encontrado.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    )
  }

  return (
    <div className="ga-page">
      <div className="card ga-intro">
        <div>
          <h2 style={{ margin: 0 }}>Administração</h2>
          <p className="muted ga-subtitle">Área gerencial para alterações e exclusões com confirmação obrigatória.</p>
        </div>
      </div>

      {renderFeedback()}

      <div className="tabs ga-section-tabs">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            className={`tabbtn ${activeSection === s.key ? 'active' : ''}`}
            onClick={() => setActiveSection(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {activeSection === 'orders' && renderOrders()}
      {activeSection === 'machine_stops' && renderStops()}
      {activeSection === 'items' && renderItems()}
      {activeSection === 'production_scans' && renderScans()}
      {activeSection === 'injection_entries' && renderEntries()}
      {activeSection === 'scrap_logs' && renderScraps()}

      <Modal open={confirmDelete.open} onClose={() => setConfirmDelete({ open: false, type: '', id: null, title: '', details: [], busy: false })} title={confirmDelete.title} closeOnBackdrop={!confirmDelete.busy}>
        <p>Tem certeza que deseja excluir este registro?</p>
        <div className="ga-confirm-details">
          {confirmDelete.details.map((d) => (<div key={d}>{d}</div>))}
        </div>
        <div className="ga-modal-actions">
          <button className="btn" onClick={() => setConfirmDelete({ open: false, type: '', id: null, title: '', details: [], busy: false })} disabled={confirmDelete.busy}>Cancelar</button>
          <button className="btn primary" onClick={confirmDeleteRecord} disabled={confirmDelete.busy}>
            {confirmDelete.busy ? 'Excluindo...' : 'Confirmar exclusão'}
          </button>
        </div>
      </Modal>

      <Modal open={editModal.open} onClose={() => setEditModal({ open: false, type: '', id: null, form: {}, busy: false })} title="Editar registro" closeOnBackdrop={!editModal.busy}>
        {editModal.type === 'machine_stops' && (
          <div className="ga-form-grid">
            <label className="label">Máquina
              <input className="input" value={editModal.form.machine_id || ''} onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, machine_id: e.target.value } }))} />
            </label>
            <label className="label">Motivo
              <input className="input" value={editModal.form.reason || ''} onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, reason: e.target.value } }))} />
            </label>
            <label className="label">Início
              <input className="input" type="datetime-local" value={editModal.form.started_at || ''} onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, started_at: e.target.value } }))} />
            </label>
            <label className="label">Fim
              <input className="input" type="datetime-local" value={editModal.form.resumed_at || ''} onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, resumed_at: e.target.value } }))} />
            </label>
            <label className="label ga-col-span">Observações
              <textarea className="input ga-textarea" value={editModal.form.notes || ''} onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, notes: e.target.value } }))} />
            </label>
          </div>
        )}

        {editModal.type === 'injection_entries' && (
          <div className="ga-form-grid">
            <label className="label">Máquina
              <input className="input" value={editModal.form.machine_id || ''} onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, machine_id: e.target.value } }))} />
            </label>
            <label className="label">Turno
              <input className="input" value={editModal.form.shift || ''} onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, shift: e.target.value } }))} />
            </label>
            <label className="label">Data
              <input className="input" type="datetime-local" value={editModal.form.created_at || ''} onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, created_at: e.target.value } }))} />
            </label>
            <label className="label">Entry Date
              <input className="input" type="date" value={editModal.form.entry_date || ''} onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, entry_date: e.target.value } }))} />
            </label>
            <label className="label">Peças Boas
              <input className="input" type="number" value={editModal.form.good_qty || ''} onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, good_qty: e.target.value } }))} />
            </label>
            <label className="label ga-col-span">Produto
              <input className="input" value={editModal.form.product || ''} onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, product: e.target.value } }))} />
            </label>
          </div>
        )}

        {editModal.type === 'scrap_logs' && (
          <div className="ga-form-grid">
            <label className="label">Máquina
              <input className="input" value={editModal.form.machine_id || ''} onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, machine_id: e.target.value } }))} />
            </label>
            <label className="label">Turno
              <input className="input" value={editModal.form.shift || ''} onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, shift: e.target.value } }))} />
            </label>
            <label className="label">Operador
              <input className="input" value={editModal.form.operator || ''} onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, operator: e.target.value } }))} />
            </label>
            <label className="label">Quantidade
              <input className="input" type="number" value={editModal.form.qty || ''} onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, qty: e.target.value } }))} />
            </label>
            <label className="label">Data
              <input className="input" type="datetime-local" value={editModal.form.created_at || ''} onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, created_at: e.target.value } }))} />
            </label>
            <label className="label ga-col-span">Motivo
              <input className="input" value={editModal.form.reason || ''} onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, reason: e.target.value } }))} />
            </label>
          </div>
        )}

        {editModal.type === 'order_milestones' && (
          <div className="ga-form-grid">
            <label className="label ga-col-span">O.P
              <input className="input" value={editModal.form.code || ''} disabled />
            </label>

            <label className="label">Início da O.P
              <input
                className="input"
                type="datetime-local"
                value={editModal.form.started_at || ''}
                onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, started_at: e.target.value } }))}
              />
            </label>

            <label className="label">Interrupção da O.P
              <input
                className="input"
                type="datetime-local"
                value={editModal.form.interrupted_at || ''}
                onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, interrupted_at: e.target.value } }))}
              />
            </label>

            <label className="label">Retomada da O.P
              <input
                className="input"
                type="datetime-local"
                value={editModal.form.restarted_at || ''}
                onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, restarted_at: e.target.value } }))}
              />
            </label>

            <label className="label">Fim da O.P
              <input
                className="input"
                type="datetime-local"
                value={editModal.form.finalized_at || ''}
                onChange={(e) => setEditModal((prev) => ({ ...prev, form: { ...prev.form, finalized_at: e.target.value } }))}
              />
            </label>

            <div className="ga-col-span ga-milestone-clear-wrap">
              <button className="btn" onClick={() => clearOrderMilestone('started_at', 'início')} disabled={editModal.busy}>Excluir início</button>
              <button className="btn" onClick={() => clearOrderMilestone('interrupted_at', 'interrupção')} disabled={editModal.busy}>Excluir interrupção</button>
              <button className="btn" onClick={() => clearOrderMilestone('restarted_at', 'retomada')} disabled={editModal.busy}>Excluir retomada</button>
              <button className="btn" onClick={() => clearOrderMilestone('finalized_at', 'fim')} disabled={editModal.busy}>Excluir fim</button>
            </div>
          </div>
        )}

        <div className="ga-modal-actions">
          <button className="btn" onClick={() => setEditModal({ open: false, type: '', id: null, form: {}, busy: false })} disabled={editModal.busy}>Cancelar</button>
          <button className="btn primary" onClick={saveEdition} disabled={editModal.busy}>
            {editModal.busy ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
