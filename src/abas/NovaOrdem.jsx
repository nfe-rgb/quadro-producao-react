// src/abas/NovaOrdem.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { MAQUINAS } from '../lib/constants'
import Modal from '../components/Modal'

export default function NovaOrdem({ form, setForm, criarOrdem, setTab }) {
  // ====== Busca de itens ligada ao campo "Produto" ======
  const [qProd, setQProd] = useState(form.product || '') // espelho do campo Produto
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [pickedItem, setPickedItem] = useState(null)
  const [openList, setOpenList] = useState(false)
  const [checkingItemCode, setCheckingItemCode] = useState(false)
  const [missingItemModal, setMissingItemModal] = useState({ open: false, code: '' })
  const debRef = useRef(null)
  const listRef = useRef(null)

  // mantém qProd sincronizado quando a tela monta
  useEffect(() => { setQProd(form.product || '') }, []) // ao montar

  // Debounce de busca conforme digita no Produto
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current)

    const term = (qProd || '').trim()
    if (!term) {
      setSuggestions([])
      setOpenList(false)
      setPickedItem(null)
      return
    }

    debRef.current = setTimeout(async () => {
      await fetchByProductTerm(term)
    }, 250)

    return () => { if (debRef.current) clearTimeout(debRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qProd])

  async function fetchByProductTerm(term) {
    setLoading(true); setErr(null)

    // Se usuário digitar no padrão "CODE - DESC", tenta extrair CODE (antes do hífen)
    const codeGuess = term.split('-')[0]?.trim()

    // Monta filtro OR: code ILIKE %term% OR description ILIKE %term%
    // (se codeGuess existir e for "limpo", também tenta ILIKE por ele)
    const ors = [
      `code.ilike.%${escapeLike(term)}%`,
      `description.ilike.%${escapeLike(term)}%`,
    ]
    if (codeGuess && codeGuess.length >= 2) {
      ors.unshift(`code.ilike.%${escapeLike(codeGuess)}%`)
    }

    const { data, error } = await supabase
      .from('items')
      .select('id, code, description, color, cycle_seconds, cavities, part_weight_g, unit_value, resin')
      .or(ors.join(','))
      .order('code', { ascending: true })
      .limit(12)

    setLoading(false)
    if (error) { setErr(error.message); setSuggestions([]); setOpenList(false); return }

    setSuggestions(data || [])
    setOpenList((data || []).length > 0)

    // Auto-match se digitou exatamente o code ou "code - desc"
    const exact = (data || []).find(it => isExactProductMatch(term, it))
    if (exact) applyItem(exact, { keepUserColorIfDifferent: false })
  }

  function isExactProductMatch(term, it) {
    const t = String(term || '').toLowerCase().trim()
    const code = String(it.code || '').toLowerCase().trim()
    const desc = String(it.description || '').toLowerCase().trim()
    return t === code || t === `${code} - ${desc}`.toLowerCase()
  }

  function escapeLike(s) {
    return String(s).replace(/[%_]/g, m => '\\' + m)
  }

  function pickSuggestion(item) {
    setOpenList(false)
    applyItem(item)
  }

  function applyItem(item, opts = {}) {
    setPickedItem(item)
    setQProd(`${item.code} - ${item.description}`)
    setForm(f => ({
      ...f,
      product: `${item.code} - ${item.description}`,
      color: (opts.keepUserColorIfDifferent && f.color && f.color !== '' && f.color !== item.color)
        ? f.color
        : (item.color || '')
    }))
  }

  async function handleCreateOrder() {
    const term = String(qProd || '').trim()
    if (!term) {
      criarOrdem(form, setForm, setTab)
      return
    }

    if (pickedItem && isExactProductMatch(term, pickedItem)) {
      criarOrdem(form, setForm, setTab)
      return
    }

    const codeGuess = term.split('-')[0]?.trim()
    if (!codeGuess) {
      criarOrdem(form, setForm, setTab)
      return
    }

    setCheckingItemCode(true)
    try {
      const { data, error } = await supabase
        .from('items')
        .select('id, code, description, color, cycle_seconds, cavities, part_weight_g, unit_value, resin')
        .eq('code', codeGuess)
        .maybeSingle()

      if (error) {
        setErr(error.message || 'Não foi possível validar o código do item.')
        return
      }

      if (!data) {
        setMissingItemModal({ open: true, code: codeGuess })
        return
      }

      const nextProduct = `${data.code} - ${data.description}`
      const nextColor = (form.color && form.color !== '' && form.color !== data.color)
        ? form.color
        : (data.color || '')
      const nextForm = {
        ...form,
        product: nextProduct,
        color: nextColor,
      }

      setPickedItem(data)
      setQProd(nextProduct)
      setForm(nextForm)
      criarOrdem(nextForm, setForm, setTab)
    } finally {
      setCheckingItemCode(false)
    }
  }

  // fecha a lista ao clicar fora
  useEffect(() => {
    function onDocClick(e) {
      if (!listRef.current) return
      if (!listRef.current.contains(e.target)) setOpenList(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  // pílulas técnicas (somente leitura)
  const techPills = useMemo(() => {
    if (!pickedItem) return []
    const it = pickedItem
    return [
      ['Ciclo (s)', it.cycle_seconds],
      ['Cavidades', it.cavities],
      ['Peso (g)', it.part_weight_g],
      ['Valor (R$)', it.unit_value],
      ['Resina', it.resin],
    ].filter(([, v]) => v !== null && v !== undefined && v !== '')
  }, [pickedItem])

  return (
    <div className="grid" style={{ maxWidth: 900 }}>
      <div className="card">
        <div className="grid2">
          {/* Número O.P (independente do cadastro de itens) */}
          <div>
            <div className="label">Número O.P</div>
            <input
              className="input"
              value={form.code}
              onChange={e=>setForm(f=>({...f, code:e.target.value}))}
              placeholder="Ex.: 1015"
            />
          </div>

          {/* Máquina */}
          <div>
            <div className="label">Máquina</div>
            <select
              className="select"
              value={form.machine_id}
              onChange={e=>setForm(f=>({...f, machine_id:e.target.value}))}
            >
              {MAQUINAS.map(m=><option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Cliente */}
          <div>
            <div className="label">Cliente</div>
            <input
              className="input"
              value={form.customer}
              onChange={e=>setForm(f=>({...f, customer:e.target.value}))}
            />
          </div>

          {/* Produto (com busca por itens) */}
          <div style={{ position: 'relative' }} ref={listRef}>
            <div className="label">Produto</div>
            <input
              className="input"
              value={qProd}
              onChange={(e) => {
                const val = e.target.value
                setQProd(val)
                setForm(f => ({ ...f, product: val }))
                setPickedItem(null) // reseta até confirmar
              }}
              onFocus={() => { if (suggestions.length) setOpenList(true) }}
              placeholder='Ex.: "500009 - FRASCO PET 200 ML RT R24/410"'
              autoComplete="off"
            />
            {openList && (
              <div
                style={{
                  position: 'absolute',
                  zIndex: 10,
                  left: 0,
                  right: 0,
                  top: '100%',
                  background: '#fff',
                  border: '1px solid #ddd',
                  borderRadius: 10,
                  marginTop: 6,
                  maxHeight: 240,
                  overflowY: 'auto',
                  boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
                }}
              >
                {loading && <div style={ddItemMuted}>buscando…</div>}
                {!loading && !suggestions.length && <div style={ddItemMuted}>sem resultados</div>}
                {!loading && suggestions.map(it => (
                  <div key={it.id} style={ddItem} onMouseDown={() => pickSuggestion(it)}>
                    <div style={{ fontWeight: 700 }}>{it.code}</div>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>
                      {it.description}{it.color ? ` • ${it.color}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {err && <div style={{ color: '#b00020', fontSize: 12, marginTop: 6 }}>Erro: {err}</div>}
          </div>

          {/* Cor (auto-preenchida, mas editável) */}
          <div>
            <div className="label">Cor</div>
            <input
              className="input"
              value={form.color}
              onChange={e=>setForm(f=>({...f, color:e.target.value}))}
              placeholder="Ex.: Natural, Azul, Vermelho"
            />
          </div>

          {/* Restante dos campos */}
          <div><div className="label">Quantidade</div><input className="input" value={form.qty} onChange={e=>setForm(f=>({...f, qty:e.target.value}))}/></div>
          <div><div className="label">Volumes</div><input className="input" value={form.boxes} onChange={e=>setForm(f=>({...f, boxes:e.target.value}))}/></div>
          <div><div className="label">Padrão</div><input className="input" value={form.standard} onChange={e=>setForm(f=>({...f, standard:e.target.value}))}/></div>
          <div><div className="label">Prazo de Entrega</div><input type="date" className="input" value={form.due_date} onChange={e=>setForm(f=>({...f, due_date:e.target.value}))}/></div>
          <div><div className="label">Observações</div><input className="input" value={form.notes} onChange={e=>setForm(f=>({...f, notes:e.target.value}))}/></div>
        </div>

        {/* Pílulas técnicas do item selecionado (somente leitura) */}
        {pickedItem && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {techPills.map(([k, v]) => (
              <span key={k} style={pill}>{k}: <b style={{ marginLeft: 6 }}>{String(v)}</b></span>
            ))}
          </div>
        )}

        <div className="sep"></div>
        <button className="btn primary" onClick={handleCreateOrder} disabled={checkingItemCode}>
          {checkingItemCode ? 'Validando item…' : 'Adicionar'}
        </button>
      </div>

      <Modal
        open={missingItemModal.open}
        onClose={() => setMissingItemModal({ open: false, code: '' })}
        title="Item não cadastrado"
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <p style={{ margin: 0 }}>
            O código <b>{missingItemModal.code || '-'}</b> ainda não foi cadastrado na base de itens.
          </p>
          <p style={{ margin: 0 }}>
            Por favor, avisar o responsável para realizar o cadastro antes de criar a O.P.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn primary" onClick={() => setMissingItemModal({ open: false, code: '' })}>
              Entendi
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/* ===== estilos locais da dropdown/pílulas ===== */
const ddItem = {
  padding: '10px 12px',
  borderBottom: '1px solid #eee',
  cursor: 'pointer',
}
const ddItemMuted = {
  padding: '10px 12px',
  opacity: 0.7,
}
const pill = {
  padding: '6px 10px',
  border: '1px solid #ddd',
  borderRadius: 999,
  fontSize: 12,
  background: '#fafafa',
}
