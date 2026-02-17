// src/abas/Lista.jsx
import { useEffect, useMemo, useState } from 'react'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import FilaSortableItem from '../components/FilaSortableItem'
import Etiqueta from '../components/Etiqueta'
import Modal from '../components/Modal'
import { MAQUINAS, STATUS } from '../lib/constants'
import { statusClass, jaIniciou } from '../lib/utils'
import { supabase } from '../lib/supabaseClient.js' // ✅ ESM correto
import { DateTime } from 'luxon';

export default function Lista({
  ativosPorMaquina,
  sensors,
  onStatusChange,
  setStartModal,
  setEditando,
  setFinalizando,
  enviarParaFila,     // agora vamos chamar com { operador, data, hora }
  refreshOrdens,      // opcional
  isAdmin = false,
}) {
  const [itemTechByCode, setItemTechByCode] = useState({})

  // 🔶 Modal de confirmação "Enviar para fila / interromper"
  const [confirmInt, setConfirmInt] = useState(null)
  // confirmInt = { ordem, operador, data, hora }

  const toNumber = (value) => {
    if (value === null || value === undefined) return 0
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0

    const raw = String(value).trim()
    if (!raw) return 0

    const normalized = raw
      .replace(/\.(?=\d{3}(\D|$))/g, '')
      .replace(',', '.')
      .replace(/[^\d.-]/g, '')

    const num = Number(normalized)
    return Number.isFinite(num) ? num : 0
  }

  const activeItemCodes = useMemo(() => {
    const codes = new Set()

    MAQUINAS.forEach((m) => {
      const ativa = (ativosPorMaquina[m] || [])[0]
      const productRaw = String(ativa?.product || '').trim()
      if (!productRaw) return

      const productCode = productRaw.split('-')[0]?.trim()
      if (productCode) codes.add(productCode)
    })

    return Array.from(codes)
  }, [ativosPorMaquina])

  useEffect(() => {
    let cancelled = false

    const carregarTechItems = async () => {
      if (!activeItemCodes.length) {
        setItemTechByCode({})
        return
      }

      const { data, error } = await supabase
        .from('items')
        .select('code, cycle_seconds, cavities')
        .in('code', activeItemCodes)

      if (error) {
        console.warn('Falha ao carregar ciclo/cavidades dos itens:', error)
        return
      }

      if (cancelled) return

      const mapped = {}
      ;(data || []).forEach((item) => {
        const code = String(item?.code || '').trim()
        if (!code) return
        mapped[code] = {
          cycleSeconds: Number(item?.cycle_seconds || 0),
          cavities: Number(item?.cavities || 0),
        }
      })

      setItemTechByCode(mapped)
    }

    carregarTechItems()

    return () => {
      cancelled = true
    }
  }, [activeItemCodes])

  const abrirModalInterromper = (ordem) => {
    const nowBr = DateTime.now().setZone("America/Sao_Paulo");
    setConfirmInt({
      ordem,
      operador: "",
      data: nowBr.toISODate(), 
      hora: nowBr.toFormat("HH:mm"),
    })
  }

  const confirmarInterromper = async () => {
    const { ordem, operador, data, hora } = confirmInt || {}
    if (!operador || !data || !hora) { alert('Preencha operador, data e hora.'); return }
    try {
      // 🔁 chama a função do App já com operador/data/hora
      await enviarParaFila(ordem, { operador, data, hora })
      setConfirmInt(null)
      if (typeof refreshOrdens === 'function') {
        setTimeout(() => refreshOrdens(), 400)
      }
    } catch (e) {
      console.error(e)
      alert('Falha ao interromper/mandar para fila.')
    }
  }

  const moverNaFila = async (machineCode, e) => {
    try {
      const activeId = e?.active?.id
      const overId   = e?.over?.id
      if (!activeId || !overId || activeId === overId) return

      const lista = ativosPorMaquina[machineCode] || []
      const fila  = lista.slice(1)

      const curIndex  = fila.findIndex(i => i.id === activeId)
      const overIndex = fila.findIndex(i => i.id === overId)
      if (curIndex < 0 || overIndex < 0) return

      const nova = [...fila]
      const [moved] = nova.splice(curIndex, 1)
      nova.splice(overIndex, 0, moved)

      const ids = nova.map(i => String(i.id));
await supabase.rpc('reorder_machine_queue', {
  p_machine: machineCode,
  p_ids: ids,
});

      const { error } = await supabase.rpc('reorder_machine_queue', {
        p_machine: machineCode,
        p_ids: ids,
      })
      if (error) throw error

      if (typeof refreshOrdens === 'function') {
        setTimeout(() => refreshOrdens(), 500) // dá tempo do Realtime chegar
      }
    } catch (err) {
      console.error('Reordenação falhou:', err)
      alert('Falha ao reordenar a fila. Detalhes no console.')
    }
  }

  return (
    <>
      <div className="grid">
        <div className="tablehead"><div>MÁQUINA</div><div>PAINEL</div><div>FILA</div></div>

        {MAQUINAS .map((m) => {
          const lista = ativosPorMaquina[m] || []
          const ativa = lista[0] || null
          const fila  = lista.slice(1)
          const opCode = ativa?.code || ativa?.o?.code || ativa?.op_code || ""
          // lidas / saldo: usar mesma lógica do Painel
          const lidas = Number(ativa?.scanned_count || 0)
          const saldo = ativa ? Math.max(0, (Number(ativa.boxes) || 0) - lidas) : 0

          const productCode = String(ativa?.product || '').split('-')[0]?.trim()
          const itemTech = productCode ? itemTechByCode[productCode] : null
          const cycleSeconds = Number(itemTech?.cycleSeconds || 0)
          const cavities = Number(itemTech?.cavities || 0)

          const totalBoxes = toNumber(ativa?.boxes)
          const totalPieces = toNumber(ativa?.qty)
          const piecesPerBox = totalBoxes > 0 ? (totalPieces / totalBoxes) : 0
          const saldoPieces = saldo > 0 && piecesPerBox > 0 ? (saldo * piecesPerBox) : 0

          const piecesPerHour = cycleSeconds > 0 && cavities > 0
            ? (3600 / cycleSeconds) * cavities
            : 0

          const remainingHours = piecesPerHour > 0 && saldoPieces > 0
            ? (saldoPieces / piecesPerHour)
            : 0

          const previsaoFim = remainingHours > 0
            ? DateTime.now().setZone('America/Sao_Paulo').plus({ seconds: Math.round(remainingHours * 3600) })
            : null

          return (
            <div className="tableline" key={m}>
              <div className="cell-machine"><span className="badge">{m}</span></div>

              <div className="cell-painel">
                {ativa ? (
                  <div className={statusClass(ativa.status)}>
                    {opCode && (
                      <div className="hdr-right op-inline" style={{ marginBottom: 4, textAlign: 'left' }}>
                        O.P - {opCode}
                      </div>
                    )}
                    <Etiqueta
                      o={ativa}
                      variant="painel"
                      lidasCaixas={["P1","P2","P3"].includes(m) ? lidas : undefined}
                      saldoCaixas={["P1","P2","P3"].includes(m) ? saldo : undefined}
                    />
                    {previsaoFim && (
                      <div className="small" style={{ marginTop: 8 }}>
                        <b>Fim de O.P previsto:</b> {previsaoFim.toFormat('dd/LL/yyyy - HH:mm')}
                      </div>
                    )}
                    <div className="sep"></div>

                    <div className="grid2">
                      <div>
                        <div className="label">Situação (só painel)</div>
                        <select
                          className="select"
                          value={ativa.status}
                          onChange={e => onStatusChange(ativa, e.target.value)}
                          disabled={ativa.status === 'AGUARDANDO'}
                        >
                          {STATUS
                            .filter(s => (jaIniciou(ativa) ? s !== 'AGUARDANDO' : true))
                            .map(s => (
                              <option key={s} value={s}>
                                {s==='AGUARDANDO'?'Aguardando'
                                  : s==='PRODUZINDO'?'Produzindo'
                                  : s==='BAIXA_EFICIENCIA'?'Baixa Eficiência'
                                  : 'Parada'}
                              </option>
                            ))}
                        </select>
                      </div>

                      <div className="flex" style={{ justifyContent:'flex-end', gap:8 }}>
                        {ativa.status === 'AGUARDANDO' ? (
                          <>
                            <button className="btn" onClick={()=>{
                              const nowBr = DateTime.now().setZone("America/Sao_Paulo");
                              setStartModal({
                                ordem: ativa,
                                operador: "",
                                data: nowBr.toISODate(), 
                                hora: nowBr.toFormat("HH:mm"),
                              })
                            }}>Iniciar Produção</button>
                            {isAdmin && (
                              <button className="btn" onClick={() => setEditando(ativa)}>Editar</button>
                            )}
                            {/* 🚚 agora abre modal de confirmação */}
                            <button className="btn" onClick={() => abrirModalInterromper(ativa)}>Enviar para fila</button>
                          </>
                        ) : (
                          <>
                            <button className="btn" onClick={() => setFinalizando(ativa)}>Finalizar</button>
                            {isAdmin && (
                              <button className="btn" onClick={() => setEditando(ativa)}>Editar</button>
                            )}
                            {/* 🚚 agora abre modal de confirmação */}
                            <button className="btn" onClick={() => abrirModalInterromper(ativa)}>Enviar para fila</button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="muted">Sem Programação</div>
                )}
              </div>

              <div className="cell-fila">
                {fila.length === 0 ? (
                  <div className="fila"><div className="muted">Sem itens na fila</div></div>
                ) : isAdmin ? (
                  <DndContext
                    sensors={sensors}
                    onDragEnd={(e) => moverNaFila(m, e)}
                    collisionDetection={closestCenter}
                  >
                    <SortableContext items={fila.map(f => f.id)} strategy={horizontalListSortingStrategy}>
                      <div className="fila">
                        {fila.map(f => (
                          <FilaSortableItem
                            key={f.id}
                            ordem={f}
                            onEdit={() => setEditando(f)}
                            etiquetaVariant="fila"
                            highlightInterrompida={f.status === 'AGUARDANDO' && !!f.interrupted_at}
                            canReorder={true}
                            canEdit={isAdmin}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                ) : (
                  <div className="fila">
                    {fila.map(f => (
                      <FilaSortableItem
                        key={f.id}
                        ordem={f}
                        onEdit={() => setEditando(f)}
                        etiquetaVariant="fila"
                        highlightInterrompida={f.status === 'AGUARDANDO' && !!f.interrupted_at}
                        canReorder={false}
                        canEdit={false}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 🔶 Modal de confirmação de interrupção */}
      <Modal
        open={!!confirmInt}
        onClose={() => setConfirmInt(null)}
        title={confirmInt ? `Tem certeza que deseja interromper a produção?` : ''}
      >
        {confirmInt && (
          <div className="grid">
            <div><div className="label">Operador *</div>
              <input className="input" value={confirmInt.operador}
                     onChange={e=>setConfirmInt(v=>({...v, operador:e.target.value}))}
                     placeholder="Nome do operador"/>
            </div>
            <div className="grid2">
              <div><div className="label">Data *</div>
                <input type="date" className="input" value={confirmInt.data}
                       onChange={e=>setConfirmInt(v=>({...v, data:e.target.value}))}/>
              </div>
              <div><div className="label">Hora *</div>
                <input type="time" className="input" value={confirmInt.hora}
                       onChange={e=>setConfirmInt(v=>({...v, hora:e.target.value}))}/>
              </div>
            </div>
            <div className="sep"></div>
            <div className="flex" style={{justifyContent:'flex-end', gap:8}}>
              <button className="btn ghost" onClick={()=>setConfirmInt(null)}>Cancelar</button>
              <button className="btn primary" onClick={confirmarInterromper}>Confirmar</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
