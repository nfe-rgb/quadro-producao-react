import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fmtDateTime } from '../lib/utils'
import '../styles/estoque.css'

const TABS = [
  { id: 'inventario', label: 'Inventário' },
  { id: 'requisicao', label: 'Requisição' },
  { id: 'retorno', label: 'Retorno' },
  { id: 'compras', label: 'Compras' },
]

export default function Estoque() {
  const [tab, setTab] = useState('inventario')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchItems()
  }, [])

  async function fetchItems() {
    setLoading(true)
    setError('')
    try {
      const { data, error: queryError } = await supabase
        .from('items')
        .select('*')
        .order('code', { ascending: true })

      if (queryError) throw queryError
      setItems(data || [])
    } catch (err) {
      setItems([])
      setError(err?.message || 'Não foi possível carregar os insumos.')
    } finally {
      setLoading(false)
    }
  }

  const inventoryRows = useMemo(() => {
    const list = Array.isArray(items) ? items : []

    return list
      .filter((item) => {
        const code = String(item?.code || '').trim()
        if (!code) return false
        return !code.startsWith('5')
      })
      .map((item) => {
        const stockValue = item.estoque ?? item.stock ?? item.estoque_atual ?? null
        const minValue = item.estoque_minimo ?? item.minimo ?? item.min_stock ?? null
        const stockNum = Number(stockValue)
        const minNum = Number(minValue)
        const hasStock = Number.isFinite(stockNum)
        const hasMin = Number.isFinite(minNum)
        const status = hasStock && hasMin
          ? (stockNum <= minNum ? 'Baixo' : 'OK')
          : '-'

        return {
        id: item.id,
        itemCode: item.code,
        product: item.description,
        client: item.cliente || item.client || '-',
        stock: hasStock ? stockNum : '-',
        min: hasMin ? minNum : '-',
        status,
        updatedAt: item.created_at ? fmtDateTime(item.created_at) : '-',
        }
      })
  }, [items])

  return (
    <div className="estoque-page">
      <div className="estoque-header">
        <div>
          <h2 className="estoque-title">Controle de Insumos</h2>
          <p className="estoque-sub">Inventário, requisição, retorno e compras.</p>
        </div>
      </div>

      <div className="estoque-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`estoque-tabbtn ${tab === item.id ? 'active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'inventario' && (
        <div className="estoque-card">
          <div className="estoque-card-head">
            <h3>Inventário</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="pill">{inventoryRows.length} insumos</span>
              <button className="btn ghost" onClick={fetchItems} disabled={loading}>
                {loading ? 'Atualizando…' : 'Atualizar'}
              </button>
            </div>
          </div>
          {error && <div className="estoque-alert">{error}</div>}
          <div className="estoque-table-wrap">
            <table className="estoque-table">
              <thead>
                <tr>
                  <th>Cod Item</th>
                  <th>Produto</th>
                  <th>Cliente</th>
                  <th>Estoque</th>
                  <th>Mínimo</th>
                  <th>Situação</th>
                  <th>Última atualização</th>
                </tr>
              </thead>
              <tbody>
                {inventoryRows.length === 0 && (
                  <tr>
                    <td colSpan="7" className="estoque-empty">
                      {loading ? 'Carregando insumos…' : 'Nenhum insumo encontrado no cadastro de itens.'}
                    </td>
                  </tr>
                )}
                {inventoryRows.map((row) => (
                  <tr key={row.id || row.itemCode}>
                    <td>{row.itemCode || '-'}</td>
                    <td>{row.product || '-'}</td>
                    <td>{row.client || '-'}</td>
                    <td>{row.stock ?? '-'}</td>
                    <td>{row.min ?? '-'}</td>
                    <td>{row.status || '-'}</td>
                    <td>{row.updatedAt || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'requisicao' && (
        <div className="estoque-card">
          <div className="estoque-card-head">
            <h3>Requisição</h3>
          </div>
          <div className="estoque-empty">Em breve.</div>
        </div>
      )}

      {tab === 'retorno' && (
        <div className="estoque-card">
          <div className="estoque-card-head">
            <h3>Retorno</h3>
          </div>
          <div className="estoque-empty">Em breve.</div>
        </div>
      )}

      {tab === 'compras' && (
        <div className="estoque-card">
          <div className="estoque-card-head">
            <h3>Compras</h3>
          </div>
          <div className="estoque-empty">Em breve.</div>
        </div>
      )}
    </div>
  )
}
