import React, { useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fmtDateTime, fmtDuracao } from '../lib/utils'
import '../styles/rastreio.css'

const formatPieces = (val) => {
  const nRaw = Number(val)
  const n = Number.isFinite(nRaw) ? nRaw : 0
  // Se a origem vier em milhares (ex.: 1,26) converte para unidades.
  const scaled = n > 0 && n < 10 ? n * 1000 : n
  return scaled.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
const formatMs = (ms) => {
  const totalMs = Math.max(0, Number(ms) || 0)
  const h = Math.floor(totalMs / 3600000)
  const m = Math.floor((totalMs % 3600000) / 60000)
  return `${h}h ${String(m).padStart(2, '0')}min`
}

export default function Rastreio() {
  const [osCode, setOsCode] = useState('')
  const [order, setOrder] = useState(null)
  const [scans, setScans] = useState([])
  const [scraps, setScraps] = useState([])
  const [stops, setStops] = useState([])
  const [manualEntries, setManualEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSearch(e) {
    e?.preventDefault?.()
    const code = osCode.trim()
    if (!code) {
      setError('Informe a O.S. para rastrear.')
      return
    }

    setLoading(true)
    setError('')
    setOrder(null)
    setScans([])
    setScraps([])
    setStops([])
    setManualEntries([])

    try {
      const { data: ord, error: ordErr } = await supabase
        .from('orders')
        .select('*')
        .eq('code', code)
        .maybeSingle()

      if (ordErr) {
        throw ordErr
      }

      if (!ord) {
        setError('Nenhuma O.S. encontrada com esse código.')
        return
      }

      setOrder(ord)

      const [scanRes, scrapRes, stopRes, manualRes] = await Promise.all([
        supabase
          .from('production_scans')
          .select('*')
          .eq('order_id', ord.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('scrap_logs')
          .select('*')
          .eq('order_id', ord.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('machine_stops')
          .select('*')
          .eq('order_id', ord.id)
          .order('started_at', { ascending: true }),
        supabase
          .from('injection_production_entries')
          .select('*')
          .eq('order_id', ord.id)
          .order('created_at', { ascending: true }),
      ])

      setScans(scanRes?.data || [])
      setScraps(scrapRes?.data || [])
      setStops(stopRes?.data || [])
      setManualEntries(manualRes?.data || [])
    } catch (err) {
      console.warn('Falha ao rastrear O.S.', err)
      setError('Não foi possível carregar os dados agora. Tente novamente em instantes.')
    } finally {
      setLoading(false)
    }
  }

  const totals = useMemo(() => {
    const totalScanPcs = scans.reduce((acc, s) => acc + Number(s.qty_pieces || 0), 0)
    const totalManualPcs = manualEntries.reduce((acc, m) => acc + Number(m.good_qty || 0), 0)
    const totalScrap = scraps.reduce((acc, s) => acc + Number(s.qty || 0), 0)
    const stopMs = stops.reduce((acc, st) => {
      if (!st?.started_at) return acc
      const ini = new Date(st.started_at).getTime()
      const fim = st.resumed_at ? new Date(st.resumed_at).getTime() : Date.now()
      if (!Number.isFinite(ini) || !Number.isFinite(fim)) return acc
      return acc + Math.max(0, fim - ini)
    }, 0)
    return {
      totalScanPcs,
      totalManualPcs,
      totalProduced: totalScanPcs + totalManualPcs,
      totalScrap,
      stopMs,
      stopCount: stops.length,
    }
  }, [scans, manualEntries, scraps, stops])

  const timeline = useMemo(() => {
    const events = []
    stops.forEach((st) => {
      if (!st?.started_at) return
      events.push({ type: 'stop', ts: st.started_at, key: `stop-${st.id}`, data: st })
    })
    scans.forEach((sc) => {
      if (!sc?.created_at) return
      events.push({ type: 'scan', ts: sc.created_at, key: `scan-${sc.id}`, data: sc })
    })
    manualEntries.forEach((m) => {
      if (!m?.created_at) return
      events.push({ type: 'manual', ts: m.created_at, key: `manual-${m.id}`, data: m })
    })
    scraps.forEach((sr) => {
      if (!sr?.created_at) return
      events.push({ type: 'scrap', ts: sr.created_at, key: `scrap-${sr.id}`, data: sr })
    })

    return events
      .filter((ev) => ev.ts)
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
  }, [stops, scans, manualEntries, scraps])

  return (
    <div className="rastreio-page">
      <div className="rastreio-header">
        <div>
          <h2 style={{ margin: 0 }}>Rastreio de O.S</h2>
          <div style={{ color: '#475569', fontSize: 13 }}>Agrupado por O.S • Paradas, produção e refugo em um só lugar.</div>
        </div>
        {loading && (
          <div className="loading-dots" aria-label="Carregando">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      <form className="rastreio-form" onSubmit={handleSearch}>
        <input
          type="text"
          value={osCode}
          onChange={(e) => setOsCode(e.target.value)}
          placeholder="Digite o código da O.S (ex: 753)"
          aria-label="Código da O.S"
        />
        <button type="submit" disabled={loading}>{loading ? 'Buscando…' : 'Pesquisar'}</button>
        {order && <div className="rastreio-status">O.S selecionada: <strong>{order.code}</strong></div>}
      </form>

      {error && <div className="error-box">{error}</div>}

      {order ? (
        <>
          <div className="rastreio-cards">
            <div className="rastreio-card">
              <span>Cliente</span>
              <strong>{order.customer || 'N/A'}</strong>
            </div>
            <div className="rastreio-card">
              <span>Produto</span>
              <strong>{order.product || 'N/A'}</strong>
            </div>
            <div className="rastreio-card">
              <span>Máquina</span>
              <strong>{order.machine_id || 'N/A'}</strong>
            </div>
            <div className="rastreio-card">
              <span>Status</span>
              <strong>{order.finalized ? 'Finalizada' : (order.status || 'N/A')}</strong>
            </div>
            <div className="rastreio-card">
              <span>Qtd. planejada</span>
              <strong>{formatPieces(order.qty)}</strong>
            </div>
            <div className="rastreio-card">
              <span>Caixas previstas</span>
              <strong>{order.boxes || 'N/A'}</strong>
            </div>
            <div className="rastreio-card">
              <span>Peças/caixa (padrão)</span>
              <strong>{formatPieces(order.standard)}</strong>
            </div>
            <div className="rastreio-card">
              <span>Última atualização</span>
              <strong>{fmtDateTime(order.updated_at || order.finalized_at || order.started_at || order.created_at)}</strong>
            </div>
          </div>

          <div className="rastreio-grid">
            <div className="panel-box">
              <h3 className="panel-title">Resumo rápido</h3>
              <div className="rastreio-cards" style={{ marginTop: 8 }}>
                <div className="rastreio-card">
                  <span>Produção (bipagens)</span>
                  <strong>{formatPieces(totals.totalScanPcs)} pcs</strong>
                </div>
                <div className="rastreio-card">
                  <span>Produção manual</span>
                  <strong>{formatPieces(totals.totalManualPcs)} pcs</strong>
                </div>
                <div className="rastreio-card">
                  <span>Total produzido</span>
                  <strong>{formatPieces(totals.totalProduced)} pcs</strong>
                </div>
                <div className="rastreio-card">
                  <span>Refugo</span>
                  <strong>{formatPieces(totals.totalScrap)} pcs</strong>
                </div>
                <div className="rastreio-card">
                  <span>Paradas (qtd)</span>
                  <strong>{totals.stopCount}</strong>
                </div>
                <div className="rastreio-card">
                  <span>Paradas (tempo)</span>
                  <strong>{formatMs(totals.stopMs)}</strong>
                </div>
              </div>
            </div>

            <div className="panel-box">
              <h3 className="panel-title">Linha do tempo da O.S</h3>
              {timeline.length === 0 ? (
                <div className="empty-state">Nenhum evento encontrado para esta O.S.</div>
              ) : (
                <div className="trace-list">
                  {timeline.map((ev) => {
                    if (ev.type === 'stop') {
                      const st = ev.data || {}
                      return (
                        <div className="trace-item" key={ev.key}>
                          <div className="trace-head">
                            <span className="trace-date">{fmtDateTime(ev.ts)}</span>
                            <span className="badge badge-stop">Parada</span>
                          </div>
                          <div className="trace-info">
                            <div>
                              <label>Motivo</label>
                              <strong>{st.reason || 'N/A'}</strong>
                            </div>
                            <div>
                              <label>Operador</label>
                              <strong>{st.started_by || 'N/A'}</strong>
                            </div>
                            <div>
                              <label>Duração</label>
                              <strong>{fmtDuracao(st.started_at, st.resumed_at || new Date().toISOString())}</strong>
                            </div>
                            <div>
                              <label>Observação</label>
                              <strong>{st.notes || 'N/A'}</strong>
                            </div>
                          </div>
                        </div>
                      )
                    }

                    if (ev.type === 'scan') {
                      const sc = ev.data || {}
                      return (
                        <div className="trace-item" key={ev.key}>
                          <div className="trace-head">
                            <span className="trace-date">{fmtDateTime(ev.ts)}</span>
                            <span className="badge badge-scan">Bipagem</span>
                          </div>
                          <div className="trace-info">
                            <div>
                              <label>Caixa</label>
                              <strong>{String(sc.scanned_box || '0').padStart(3, '0')}</strong>
                            </div>
                            <div>
                              <label>Peças na caixa</label>
                              <strong>{formatPieces(sc.qty_pieces || order?.standard)}</strong>
                            </div>
                            <div>
                              <label>Máquina / Turno</label>
                              <strong>{sc.machine_id || 'N/A'} • {sc.shift || 'N/A'}</strong>
                            </div>
                            <div>
                              <label>Código lido</label>
                              <strong>{sc.code || sc.op_code || 'N/A'}</strong>
                            </div>
                          </div>
                        </div>
                      )
                    }

                    if (ev.type === 'manual') {
                      const m = ev.data || {}
                      return (
                        <div className="trace-item" key={ev.key}>
                          <div className="trace-head">
                            <span className="trace-date">{fmtDateTime(ev.ts)}</span>
                            <span className="badge badge-manual">Prod. manual</span>
                          </div>
                          <div className="trace-info">
                            <div>
                              <label>Quantidade</label>
                              <strong>{formatPieces(m.good_qty)}</strong>
                            </div>
                            <div>
                              <label>Máquina / Turno</label>
                              <strong>{m.machine_id || 'N/A'} • {m.shift || 'N/A'}</strong>
                            </div>
                            <div>
                              <label>Produto</label>
                              <strong>{m.product || 'N/A'}</strong>
                            </div>
                          </div>
                        </div>
                      )
                    }

                    if (ev.type === 'scrap') {
                      const sr = ev.data || {}
                      return (
                        <div className="trace-item" key={ev.key}>
                          <div className="trace-head">
                            <span className="trace-date">{fmtDateTime(ev.ts)}</span>
                            <span className="badge badge-scrap">Refugo</span>
                          </div>
                          <div className="trace-info">
                            <div>
                              <label>Quantidade</label>
                              <strong>{formatPieces(sr.qty)}</strong>
                            </div>
                            <div>
                              <label>Motivo</label>
                              <strong>{sr.reason || 'N/A'}</strong>
                            </div>
                            <div>
                              <label>Operador</label>
                              <strong>{sr.operator || 'N/A'}</strong>
                            </div>
                            <div>
                              <label>Máquina / Turno</label>
                              <strong>{sr.machine_id || 'N/A'} • {sr.shift || 'N/A'}</strong>
                            </div>
                          </div>
                        </div>
                      )
                    }

                    return null
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="empty-state">Pesquise a O.S para ver paradas, bipagens, produção manual e refugos em um só painel.</div>
      )}
    </div>
  )
}
