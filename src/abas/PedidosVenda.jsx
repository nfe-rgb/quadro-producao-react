import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import '../styles/pedidos-venda.css'

const createLine = () => ({
  key: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  code: '',
  description: '',
  color: '',
  quantity: '',
  unitValue: '',
  ipiPercent: '0',
})

const formatMoney = (value) => Number(value || 0).toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const formatQuantity = (value) => Number(value || 0).toLocaleString('pt-BR', {
  maximumFractionDigits: 3,
})

const formatDate = (value) => {
  if (!value) return '-'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

const numberValue = (value) => {
  const parsed = Number(String(value ?? '').replace(',', '.').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

const lineTotal = (line, quantity = line.quantity) => {
  const unitValue = line.unitValue ?? line.unit_value
  const ipiPercent = line.ipiPercent ?? line.ipi_percent
  return numberValue(quantity) * numberValue(unitValue) * (1 + numberValue(ipiPercent) / 100)
}

export default function PedidosVenda() {
  const [salesOrders, setSalesOrders] = useState([])
  const [catalog, setCatalog] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [header, setHeader] = useState({
    identifier: '',
    customerOrderNumber: '',
    customer: '',
    deliveryDate: '',
  })
  const [lines, setLines] = useState([createLine()])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    const [ordersResult, catalogResult] = await Promise.all([
      supabase
        .from('sales_orders')
        .select('id, identifier, customer_order_number, customer, delivery_date, created_at, items:sales_order_items(id, code, description, color, quantity, unit_value, ipi_percent, invoiced_quantity, total_with_ipi)')
        .order('created_at', { ascending: false }),
      supabase
        .from('items')
        .select('code, description, color, unit_value')
        .like('code', '5%')
        .order('code', { ascending: true })
        .limit(2000),
    ])

    if (ordersResult.error) {
      setError(`Não foi possível carregar os pedidos: ${ordersResult.error.message}`)
      setSalesOrders([])
    } else {
      const itemIds = (ordersResult.data || []).flatMap((order) => (order.items || []).map((item) => item.id))
      let generatedOps = {}
      if (itemIds.length) {
        const { data, error: opError } = await supabase
          .from('orders')
          .select('code, sales_order_item_id')
          .in('sales_order_item_id', itemIds)
        if (opError) {
          setError(`Pedidos carregados, mas não foi possível consultar as O.P. vinculadas: ${opError.message}`)
        } else {
          generatedOps = Object.fromEntries((data || []).map((order) => [order.sales_order_item_id, order.code]))
        }
      }

      const openOrders = (ordersResult.data || []).map((order) => ({
        ...order,
        items: (order.items || [])
          .map((item) => ({ ...item, generatedOp: generatedOps[item.id] || '' }))
          .filter((item) => numberValue(item.quantity) - numberValue(item.invoiced_quantity) > 0),
      })).filter((order) => order.items.length > 0)
      setSalesOrders(openOrders)
    }

    if (catalogResult.error) {
      setError((current) => current || `Não foi possível carregar os produtos: ${catalogResult.error.message}`)
      setCatalog([])
    } else {
      setCatalog(catalogResult.data || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function updateLine(key, patch) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line))
  }

  function selectCatalogItem(key, code) {
    const item = catalog.find((entry) => entry.code === code)
    updateLine(key, item ? {
      code: item.code,
      description: item.description || '',
      color: item.color || '',
      unitValue: item.unit_value == null ? '' : String(item.unit_value),
    } : { code: '', description: '', color: '', unitValue: '' })
  }

  function resetForm() {
    setHeader({ identifier: '', customerOrderNumber: '', customer: '', deliveryDate: '' })
    setLines([createLine()])
    setShowForm(false)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const normalizedLines = lines.map((line) => ({
      ...line,
      quantity: numberValue(line.quantity),
      unitValue: numberValue(line.unitValue),
      ipiPercent: numberValue(line.ipiPercent),
    }))

    if (!header.identifier.trim() || !header.customerOrderNumber.trim() || !header.customer.trim() || !header.deliveryDate) {
      setError('Preencha o identificador, pedido do cliente, cliente e prazo de entrega.')
      return
    }
    if (!normalizedLines.length || normalizedLines.some((line) => !line.code || line.quantity <= 0 || line.unitValue < 0 || line.ipiPercent < 0)) {
      setError('Cada item precisa de produto, quantidade maior que zero e valores válidos.')
      return
    }

    setSaving(true)
    setError('')
    const { data: createdOrder, error: orderError } = await supabase
      .from('sales_orders')
      .insert({
        identifier: header.identifier.trim(),
        customer_order_number: header.customerOrderNumber.trim(),
        customer: header.customer.trim(),
        delivery_date: header.deliveryDate,
      })
      .select('id')
      .single()

    if (orderError) {
      setError(orderError.code === '23505'
        ? 'Já existe um pedido com esse identificador interno.'
        : `Não foi possível salvar o pedido: ${orderError.message}`)
      setSaving(false)
      return
    }

    const { error: linesError } = await supabase
      .from('sales_order_items')
      .insert(normalizedLines.map((line) => ({
        sales_order_id: createdOrder.id,
        code: line.code,
        description: line.description,
        color: line.color.trim() || null,
        quantity: line.quantity,
        unit_value: line.unitValue,
        ipi_percent: line.ipiPercent,
      })))

    if (linesError) {
      await supabase.from('sales_orders').delete().eq('id', createdOrder.id)
      setError(`Não foi possível salvar os itens do pedido: ${linesError.message}`)
      setSaving(false)
      return
    }

    await loadData()
    setSaving(false)
    resetForm()
  }

  return (
    <main className="sales-orders-page">
      <header className="sales-orders-header">
        <div>
          <h2>Pedidos de venda</h2>
          <p>Pedidos com quantidade ainda não faturada</p>
        </div>
        {!showForm ? (
          <button className="btn primary" type="button" onClick={() => { setError(''); setShowForm(true) }}>
            Novo pedido
          </button>
        ) : (
          <button className="btn" type="button" onClick={resetForm} disabled={saving}>
            Voltar ao relatório
          </button>
        )}
      </header>

      {error && <div className="sales-orders-error" role="alert">{error}</div>}

      {showForm ? (
        <form className="sales-orders-form" onSubmit={handleSubmit}>
          <section className="sales-orders-fields">
            <label>
              <span>Número do pedido interno (Identificador)</span>
              <input autoFocus required value={header.identifier} onChange={(event) => setHeader((current) => ({ ...current, identifier: event.target.value }))} />
            </label>
            <label>
              <span>Número do pedido do cliente</span>
              <input required value={header.customerOrderNumber} onChange={(event) => setHeader((current) => ({ ...current, customerOrderNumber: event.target.value }))} />
            </label>
            <label>
              <span>Cliente</span>
              <input required value={header.customer} onChange={(event) => setHeader((current) => ({ ...current, customer: event.target.value }))} />
            </label>
            <label>
              <span>Prazo de entrega</span>
              <input type="date" required value={header.deliveryDate} onChange={(event) => setHeader((current) => ({ ...current, deliveryDate: event.target.value }))} />
            </label>
          </section>

          <div className="sales-orders-line-head">
            <h3>Itens do pedido</h3>
            <button className="btn" type="button" onClick={() => setLines((current) => [...current, createLine()])}>Adicionar item</button>
          </div>
          <div className="sales-orders-table-wrap">
            <table className="sales-orders-table sales-orders-edit-table">
              <thead>
                <tr>
                  <th>O.P. gerada</th><th>Código - descrição</th><th>Cor</th><th>Quantidade</th><th>Valor unitário</th><th>IPI %</th><th>Total c/ IPI</th><th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key}>
                    <td className="sales-orders-pending-op">Aguardando</td>
                    <td>
                      <select required value={line.code} onChange={(event) => selectCatalogItem(line.key, event.target.value)}>
                        <option value="">Selecionar produto</option>
                        {catalog.map((item) => <option key={item.code} value={item.code}>{item.code} - {item.description}</option>)}
                      </select>
                    </td>
                    <td><input value={line.color} onChange={(event) => updateLine(line.key, { color: event.target.value })} /></td>
                    <td><input type="number" min="0.001" step="any" required value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></td>
                    <td><input type="number" min="0" step="any" required value={line.unitValue} onChange={(event) => updateLine(line.key, { unitValue: event.target.value })} /></td>
                    <td><input type="number" min="0" step="any" value={line.ipiPercent} onChange={(event) => updateLine(line.key, { ipiPercent: event.target.value })} /></td>
                    <td className="sales-orders-total">{formatMoney(lineTotal(line))}</td>
                    <td><button className="sales-orders-remove" type="button" aria-label="Remover item" title="Remover item" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!catalog.length && !loading && <p className="sales-orders-hint">Nenhum produto acabado (código iniciado por 5) disponível no cadastro.</p>}
          <footer className="sales-orders-form-actions">
            <button className="btn primary" type="submit" disabled={saving || loading}>{saving ? 'Salvando...' : 'Salvar pedido'}</button>
          </footer>
        </form>
      ) : (
        <section className="sales-orders-report">
          <div className="sales-orders-table-wrap">
            <table className="sales-orders-table">
              <thead>
                <tr>
                  <th>Identificador</th><th>Pedido cliente</th><th>Cliente</th><th>Prazo</th><th>O.P. gerada</th><th>Código - descrição</th><th>Cor</th><th>Qtd. pedida</th><th>Saldo aberto</th><th>Valor unitário</th><th>IPI %</th><th>Total aberto c/ IPI</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="12" className="sales-orders-empty">Carregando pedidos...</td></tr>
                ) : salesOrders.length ? salesOrders.flatMap((order) => order.items.map((item) => {
                  const balance = numberValue(item.quantity) - numberValue(item.invoiced_quantity)
                  return (
                    <tr key={item.id}>
                      <td className="sales-orders-identifier">{order.identifier}</td>
                      <td>{order.customer_order_number}</td>
                      <td>{order.customer}</td>
                      <td>{formatDate(order.delivery_date)}</td>
                      <td>{item.generatedOp || <span className="sales-orders-pending-op">Pendente</span>}</td>
                      <td>{item.code} - {item.description}</td>
                      <td>{item.color || '-'}</td>
                      <td>{formatQuantity(item.quantity)}</td>
                      <td className="sales-orders-balance">{formatQuantity(balance)}</td>
                      <td>{formatMoney(item.unit_value)}</td>
                      <td>{formatQuantity(item.ipi_percent)}%</td>
                      <td>{formatMoney(lineTotal(item, balance))}</td>
                    </tr>
                  )
                })) : (
                  <tr><td colSpan="12" className="sales-orders-empty">Nenhum pedido com saldo em aberto.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  )
}