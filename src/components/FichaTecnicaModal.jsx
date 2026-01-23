// src/components/FichaTecnicaModal.jsx
import { useEffect, useMemo, useState } from 'react'
import FichaTemplateNissei from './FichaTemplateNissei'
import { fetchItemByCode, fetchSheets, createRevision } from '../lib/techSheetService'
import '../styles/ficha.css'

function safeParseJSON(text) {
  try {
    return JSON.parse(text)
  } catch (_) {
    return null
  }
}

function materialFromParams(params) {
  try {
    const parsed = JSON.parse(params || '{}')
    return parsed?.cliente?.material || ''
  } catch (_) {
    return ''
  }
}

function firstMaterialFromRevisions(revs) {
  if (!Array.isArray(revs)) return ''
  for (const rev of revs) {
    const mat = materialFromParams(rev?.parameters)
    if (mat) return mat
  }
  return ''
}

function moldeFromParams(params) {
  try {
    const parsed = JSON.parse(params || '{}')
    return parsed?.cabecalho?.molde || ''
  } catch (_) {
    return ''
  }
}

function sheetDisplayDescription(sheet) {
  const latestParams = sheet.revisions?.[0]?.parameters
  const mat = materialFromParams(latestParams) || firstMaterialFromRevisions(sheet.revisions)
  const molde = moldeFromParams(latestParams)

  const code = sheet.item_code || ''
  const base = String(sheet.description || '').trim()

  let composed = base
  if (!composed && (code || molde)) {
    composed = [code, molde].filter(Boolean).join(' - ')
  } else if (composed && molde && composed === code) {
    composed = [code, molde].filter(Boolean).join(' - ')
  }

  if (composed && molde && !composed.toLowerCase().includes(molde.toLowerCase())) {
    const withMolde = [code || composed, molde].filter(Boolean).join(' - ')
    composed = withMolde
  }

  if (composed && mat && !composed.toLowerCase().includes(mat.toLowerCase())) {
    composed = `${composed} • ${mat}`
  } else if (!composed && mat) {
    composed = [code, mat].filter(Boolean).join(' - ')
  }

  return composed || code || 'Sem descrição'
}

export default function FichaTecnicaModal({ machineId, itemCode, open, onClose, forceTableLayout = false }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [editingSheet, setEditingSheet] = useState(null)
  const [revForm, setRevForm] = useState({ parameters: '', author: '' })
  const [revItemMeta, setRevItemMeta] = useState(null)
  const [revTemplateKey, setRevTemplateKey] = useState(0)
  const [revSaving, setRevSaving] = useState(false)

  // Memoize parsed params per sheet to avoid regenerating objects every render (prevents effect loops)
  const parsedById = useMemo(() => {
    const map = new Map()
    list.forEach((sheet) => {
      const params = sheet.revisions?.[0]?.parameters
      map.set(sheet.id, safeParseJSON(params))
    })
    return map
  }, [list])

  function renderStructured(data) {
    if (!data || typeof data !== 'object') {
      return <pre>{typeof data === 'string' ? data : JSON.stringify(data, null, 2)}</pre>
    }

    const cab = data.cabecalho || {}
    const cli = data.cliente || {}
    const sup = data.suprimentoAgua || {}
    const pneu = data.pneumatica || {}
    const ctrl = data.controleInjecao || {}
    const pos = data.posicaoInjecao || {}
    const tempsL = data.tempsLeft || []
    const tempsR = data.tempsRight || []
    const molde = data.moldeValores || []
    const obs = data.observacoes

    return (
      <div className="ficha-structured-view">
        <div className="ficha-grid">
          <div><strong>Molde</strong><div>{cab.molde || '—'}</div></div>
          <div><strong>Cod. Item</strong><div>{cab.codItem || '—'}</div></div>
          <div><strong>Peso do Produto</strong><div>{cab.pesoProduto || '—'}</div></div>
          <div><strong>Tempo de Ciclo</strong><div>{cab.tempoCiclo || '—'}</div></div>
          <div><strong>Número de Cavidades</strong><div>{cab.numCavidades || '—'}</div></div>
          <div><strong>Checado por</strong><div>{cab.checadoPor || '—'}</div></div>
        </div>

        <div className="ficha-grid ficha-grid-2cols" style={{ marginTop: 12 }}>
          <div>
            <h4>Material Utilizado</h4>
            <div><strong>Material</strong><div>{cli.material || '—'}</div></div>
            <div><strong>Cor / Pigmento</strong><div>{cli.corPigmento || '—'}</div></div>
            <div><strong>Tempo dosagem pigmento</strong><div>{cli.tempoDosagem || '—'}</div></div>
            <div><strong>Velocidade dosagem</strong><div>{cli.velocidadeDosagem || '—'}</div></div>
            <div><strong>% aplicação</strong><div>{cli.aplicacao || '—'}</div></div>
          </div>
          <div>
            <h4>Suprimento / Pneumática</h4>
            <div><strong>Temp. Água</strong><div>{sup.tempAgua || '—'}</div></div>
            <div><strong>Pressão ar Sopro</strong><div>{pneu.arSopro || '—'}</div></div>
            <div><strong>Pressão ar Operação</strong><div>{pneu.arOperacao || '—'}</div></div>
          </div>
        </div>

        <div className="ficha-grid ficha-grid-2cols" style={{ marginTop: 12 }}>
          <div>
            <h4>Controle Injeção</h4>
            <div><strong>Pressão Injeção</strong><div>{ctrl.pressaoInjecao || '—'}</div></div>
            <div><strong>Pressão Recalque</strong><div>{ctrl.pressaoRecalque || '—'}</div></div>
            <div><strong>Contrapressão</strong><div>{ctrl.contrapressao || '—'}</div></div>
            <div><strong>Velocidade Injeção</strong><div>{ctrl.velocidadeInjecao || '—'}</div></div>
          </div>
          <div>
            <h4>Posição Injeção</h4>
            <div><strong>Carga</strong><div>{pos.carga || '—'}</div></div>
            <div><strong>Recalque</strong><div>{pos.recalque || '—'}</div></div>
          </div>
        </div>

        <div className="ficha-grid ficha-grid-2cols" style={{ marginTop: 12 }}>
          <div>
            <h4>Temperatura Lado A</h4>
            {tempsL.map((t) => (
              <div key={t.label} className="ficha-row-inline">
                <span>{t.label}</span>
                <span>{t.pv || '—'}</span>
              </div>
            ))}
          </div>
          <div>
            <h4>Temperatura Lado B</h4>
            {tempsR.map((t) => (
              <div key={t.label} className="ficha-row-inline">
                <span>{t.label}</span>
                <span>{t.pv || '—'}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <h4>Dados do Molde</h4>
          <div className="ficha-molde-grid">
            <div className="ficha-molde-header">
              <span>Injeção</span>
              <span>Sopro</span>
              <span>Condicionamento</span>
              <span>Opcional</span>
            </div>
            {(molde || []).map((row, idx) => (
              <div key={`molde-${idx}`} className="ficha-molde-row">
                <div>
                  <div className="muted">{row.injecao || '—'}</div>
                  <div>{row.injValor || '—'}</div>
                </div>
                <div>
                  <div className="muted">{row.sopro || '—'}</div>
                  <div>{row.soproVal || '—'}</div>
                </div>
                <div>
                  <div className="muted">{row.cond || '—'}</div>
                  <div>{row.condVal || '—'}</div>
                </div>
                <div>
                  <div className="muted">{row.opc || '—'}</div>
                  <div>{row.opcVal || '—'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <h4>Observações</h4>
          <div>{obs || '—'}</div>
        </div>
      </div>
    )
  }

  function buildDiffText(previous, current) {
    const prevObj = safeParseJSON(previous)
    const currObj = safeParseJSON(current)
    if (prevObj && currObj && typeof prevObj === 'object' && typeof currObj === 'object') {
      const keys = Array.from(new Set([...Object.keys(prevObj), ...Object.keys(currObj)]))
      const changes = []
      keys.forEach((k) => {
        const beforeVal = prevObj[k]
        const afterVal = currObj[k]
        if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
          changes.push(`- ${k}: ${JSON.stringify(beforeVal ?? '—')} -> ${JSON.stringify(afterVal ?? '—')}`)
        }
      })
      if (changes.length === 0) return 'Sem alterações nos parâmetros.'
      return `Alterações:\n${changes.join('\n')}`
    }
    return 'Parâmetros técnicos atualizados.'
  }

  useEffect(() => {
    if (!open) return
    async function load() {
      setLoading(true)
      const data = await fetchSheets({ machineId, itemCode })
      setList(data)
      setSelected(null)
      setEditingSheet(null)
      setRevForm({ parameters: '', author: '' })
      setRevItemMeta(null)
      setLoading(false)
    }
    load()
  }, [open, machineId, itemCode])

  useEffect(() => {
    let active = true
    async function loadMeta() {
      if (!editingSheet?.item_code) {
        if (active) setRevItemMeta(null)
        return
      }
      const data = await fetchItemByCode(editingSheet.item_code)
      if (!active) return
      setRevItemMeta(data)
    }
    loadMeta()
    return () => { active = false }
  }, [editingSheet])

  async function handleSaveRevision(sheet) {
    if (revSaving) return
    if (!revForm.parameters) {
      alert('Gere os parâmetros técnicos pelo formulário estruturado antes de salvar a revisão.')
      return
    }
    if (!revForm.author) {
      alert('Informe o responsável pela alteração.')
      return
    }
    const ok = window.confirm('Confirmar salvamento da revisão?')
    if (!ok) return
    setRevSaving(true)
    try {
      const latest = sheet.revisions?.[0]
      const diffText = buildDiffText(latest?.parameters, revForm.parameters)
      const updated = await createRevision({
        sheetId: sheet.id,
        machineId: sheet.machine_id,
        itemCode: sheet.item_code,
        description: sheet.description,
        parameters: revForm.parameters,
        author: revForm.author,
        changes: diffText,
      })

      let merged = null
      setList((prev) => {
        const idx = prev.findIndex((s) => String(s.id) === String(sheet.id))
        if (idx === -1) return prev
        const copy = [...prev]
        merged = {
          ...prev[idx],
          description: updated.description || prev[idx].description,
          revisions: [updated.revisions?.[0], ...(prev[idx].revisions || [])],
        }
        copy[idx] = merged
        return copy
      })
      if (merged) {
        setSelected((cur) => (cur?.id === sheet.id ? merged : cur))
      }
      try {
        const refreshed = await fetchSheets({ machineId, itemCode })
        if (Array.isArray(refreshed) && refreshed.length) {
          setList(refreshed)
          setSelected(null)
        }
      } catch (fetchErr) {
        console.warn('handleSaveRevision: falha ao refazer fetchSheets, mantendo lista local', fetchErr)
      }
      setEditingSheet(null)
    } catch (err) {
      console.warn('handleSaveRevision (modal) falhou', err)
      alert('Falha ao salvar revisão. Verifique conexão/permissões e tente novamente.')
    } finally {
      setRevSaving(false)
    }
  }

  function parseParams(params) {
    try {
      const obj = JSON.parse(params || '{}')
      if (obj && typeof obj === 'object') return obj
    } catch (_) {}
    return null
  }

  function startEditing(sheet) {
    const latestParams = sheet.revisions?.[0]?.parameters
    const parsed = parseParams(latestParams)
    const prevAuthor = revForm.author || ''
    setEditingSheet(sheet)
    setSelected(sheet)
    setRevForm({ parameters: parsed ? JSON.stringify(parsed, null, 2) : latestParams || '', author: prevAuthor })
    setRevTemplateKey((k) => k + 1)
  }

  function renderSheet(sheet) {
    const isOpen = selected?.id === sheet.id
    const parsedSheet = parsedById.get(sheet.id) || null
    const hasStructured = Boolean(parsedSheet)
    const displayDesc = sheetDisplayDescription(sheet)
    return (
      <div key={sheet.id} className={`ficha-rev-card ${isOpen ? 'active' : ''}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <div>
            <div className="ficha-chip">Rev {sheet.revisions?.[0]?.revision ?? 0}</div>
            <div className="ficha-desc">{displayDesc}</div>
            <div className="muted">Última em {new Date(sheet.revisions?.[0]?.created_at || sheet.created_at).toLocaleString('pt-BR')} • {sheet.revisions?.[0]?.author || 'N/I'}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              className={`btn ${editingSheet?.id === sheet.id ? 'primary' : 'ghost'}`}
              style={editingSheet?.id === sheet.id ? { background: '#ffb703', color: '#1a1a1a' } : undefined}
              onClick={() => {
                if (editingSheet?.id === sheet.id) {
                  setEditingSheet(null)
                  setRevForm({ parameters: '', author: '' })
                  setRevTemplateKey((k) => k + 1)
                  return
                }
                startEditing(sheet)
              }}
              aria-label="Alterar ficha"
              title="Alterar ficha"
            >
              ✎
            </button>
            <button
              className="btn ghost"
              onClick={() => setSelected((cur) => (cur?.id === sheet.id ? null : sheet))}
              aria-label={isOpen ? 'Recolher ficha' : 'Expandir ficha'}
            >
              {isOpen ? '▲' : '▼'}
            </button>
          </div>
        </div>
        {isOpen && editingSheet?.id !== sheet.id && hasStructured && (
          <div style={{ marginTop: 4 }}>{renderStructured(parsedSheet)}</div>
        )}
        {isOpen && editingSheet?.id !== sheet.id && !hasStructured && (
          <div style={{ marginTop: 4 }}>
            <div className="ficha-block-title" style={{ marginTop: 6 }}>Parâmetros técnicos</div>
            <pre>{sheet.revisions?.[0]?.parameters || '—'}</pre>
            <div className="ficha-block-title" style={{ marginTop: 8 }}>Observações</div>
            <pre>{sheet.revisions?.[0]?.observations || '—'}</pre>
          </div>
        )}
        {editingSheet?.id === sheet.id && (
          <div className="ficha-rev-form" style={{ marginTop: 10 }}>
            <FichaTemplateNissei
              key={revTemplateKey}
              initialItemCode={sheet.item_code}
              initialData={parsedSheet}
              onGenerate={(payload) => {
                setRevForm((v) => ({ ...v, parameters: JSON.stringify(payload || {}, null, 2) }))
              }}
              prefill={{
                molde: revItemMeta?.description,
                codItem: sheet.item_code,
                pesoProduto: revItemMeta?.part_weight_g,
                tempoCiclo: revItemMeta?.cycle_seconds,
                numCavidades: revItemMeta?.cavities,
                material: revItemMeta?.resin,
                corPigmento: revItemMeta?.color,
              }}
            />
            <label style={{ marginTop: 8 }}>Responsável</label>
            <input
              value={revForm.author}
              onChange={(e) => setRevForm((v) => ({ ...v, author: e.target.value }))}
              placeholder="Quem editou"
            />
            <div className="ficha-form-actions" style={{ marginTop: 10 }}>
              <button
                className="btn ghost"
                onClick={() => {
                  setEditingSheet(null)
                  setRevForm({ parameters: '', author: '' })
                  setRevTemplateKey((k) => k + 1)
                }}
              >
                Cancelar
              </button>
              <button className="btn primary" disabled={revSaving} onClick={() => handleSaveRevision(sheet)}>
                {revSaving ? 'Salvando...' : 'Salvar revisão'}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (!open) return null

  return (
    <div className="pet01-modal-bg" role="dialog" aria-modal>
      <div className="pet01-modal" style={{ maxWidth: 720, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h3>Ficha Técnica • Máquina {machineId} • Item {itemCode || 'N/A'}</h3>
          <button className="btn ghost" onClick={onClose}>Fechar</button>
        </div>

        {loading && <div className="muted" style={{ marginTop: 8 }}>Carregando fichas...</div>}
        {!loading && list.length === 0 && (
          <div className="muted" style={{ marginTop: 8 }}>Nenhuma ficha para este item nesta máquina.</div>
        )}

        {!loading && list.length > 0 && (
          <div className="ficha-history" style={{ marginTop: 8 }}>
            {list.map(renderSheet)}
          </div>
        )}
      </div>
    </div>
  )
}
