// src/App.jsx
import { useState } from 'react'
import { DndContext, useSensor, useSensors, MouseSensor, TouchSensor } from '@dnd-kit/core'
import { useLocation } from 'react-router-dom'

import useOrders from './hooks/useOrders'
import BrandBar from './components/BrandBar'
import Tabs from './components/Tabs'

import CadastroItens from './abas/CadastroItens'
import Login from './abas/Login'
import Painel from './abas/Painel'
import Lista from './abas/Lista'
import NovaOrdem from './abas/NovaOrdem'
import Registro from './abas/Registro'
import Apontamento from './feature/Apontamento.jsx'
import Pet01 from './routes/Pet01'

// modais
import StartModal from './components/Modals/StartModal'
import StopModal from './components/Modals/StopModal'
import LowEffModal from './components/Modals/LowEffModal'
import FinalizeModal from './components/Modals/FinalizeModal'

import { jaIniciou } from './lib/utils'

export default function App(){
  const location = useLocation()
  const [tab,setTab] = useState('painel')

  // DnD sensors (passados para Lista)
  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 5 }})
  const touchSensor = useSensor(TouchSensor, { pressDelay: 150, activationConstraint: { distance: 5 }})
  const sensors = useSensors(mouseSensor, touchSensor)

  // Hook centralizando ordens / ações
  const {
    ordens, finalizadas, paradas, tick,
    editando, setEditando, finalizando, setFinalizando,
    startModal, setStartModal, stopModal, setStopModal, resumeModal, setResumeModal,
    lowEffModal, setLowEffModal, lowEffEndModal, setLowEffEndModal,
    fetchOrdensAbertas, fetchOrdensFinalizadas, fetchParadas,
    criarOrdem, atualizar, setStatus, confirmarInicio, confirmarParada, confirmarRetomada,
    confirmarBaixaEf, confirmarEncerrarBaixaEf, finalizar, enviarParaFila,
    ativosPorMaquina, lastFinalizadoPorMaquina, registroGrupos,
    confirmData, setConfirmData,
  } = useOrders()

  // ======= Form local (passado para NovaOrdem) - evita `form` undefined =======
  const [form, setForm] = useState({
    code:'', customer:'', product:'', color:'', qty:'', boxes:'', standard:'', due_date:'', notes:'', machine_id:'P1'
  })

  // Wrapper defensivo para criarOrdem (algumas versões do hook esperam receber form,setForm,setTab)
  async function handleCriarOrdem(...args) {
    if (typeof criarOrdem === 'function') {
      try {
        // tenta chamar a função com os parâmetros esperados (se ela os usar, ótimo; se ignorar, também ok)
        return await criarOrdem(form, setForm, setTab, ...args)
      } catch (err) {
        console.error('Erro em criarOrdem:', err)
        alert('Erro ao criar ordem: ' + (err?.message || String(err)))
      }
    } else {
      console.warn('criarOrdem não definida (hook).')
      // fallback simples: limpa o form para não travar a UI
      setForm({ code:'', customer:'', product:'', color:'', qty:'', boxes:'', standard:'', due_date:'', notes:'', machine_id:'P1' })
    }
  }

  // rota /pet-01 (caso queira visual tablet isolado)
  if (location.pathname === '/pet-01') {
    return <Pet01 registroGrupos={registroGrupos} />
  }

  // ========================= onStatusChange (reimpl. compatível com o original) =========================
  // Essa função abre modais conforme a transição desejada ou chama setStatus quando é uma mudança simples.
  function onStatusChange(ordem, targetStatus){
    const atual = ordem.status

    // não permite voltar para AGUARDANDO após iniciar
    if (jaIniciou(ordem) && targetStatus === 'AGUARDANDO') {
      alert('Após iniciar a produção, não é permitido voltar para "Aguardando".')
      return
    }

    // Entrando em BAIXA_EFICIENCIA -> abre modal de início de baixa eficiência
    if (targetStatus === 'BAIXA_EFICIENCIA' && atual !== 'BAIXA_EFICIENCIA') {
      const now = new Date()
      setLowEffModal({
        ordem,
        operador: '',
        obs: '',
        data: now.toISOString().slice(0,10),
        hora: now.toTimeString().slice(0,5),
      })
      return
    }

    // Saindo de BAIXA_EFICIENCIA -> se retornando à PRODUZINDO, abre modal para encerrar baixa ef.
    if (atual === 'BAIXA_EFICIENCIA' && targetStatus === 'PRODUZINDO') {
      const now = new Date()
      setLowEffEndModal({
        ordem,
        targetStatus: 'PRODUZINDO',
        operador: '',
        data: now.toISOString().slice(0,10),
        hora: now.toTimeString().slice(0,5),
      })
      return
    }

    // Saindo de BAIXA_EFICIENCIA -> indo para PARADA: abrir modal de parada e marcar que deve encerrar baixa ef. no mesmo instante
    if (atual === 'BAIXA_EFICIENCIA' && targetStatus === 'PARADA') {
      const now = new Date()
      setStopModal({
        ordem,
        operador:'', motivo: undefined, obs:'',
        data: now.toISOString().slice(0,10),
        hora: now.toTimeString().slice(0,5),
        endLowEffAtStopStart: true,
      })
      return
    }

    // Entrando em PARADA (de qualquer outro estado que não BAIXA_EFICIENCIA) -> abrir modal de parada
    if (targetStatus === 'PARADA' && atual !== 'PARADA') {
      const now = new Date()
      setStopModal({ ordem, operador:'', motivo: undefined, obs:'', data: now.toISOString().slice(0,10), hora: now.toTimeString().slice(0,5) })
      return
    }

    // Saindo de PARADA (inclui caso de baixa eficiência)
    if (atual === 'PARADA' && targetStatus !== 'PARADA') {
      const now = new Date()
      // Se destino é BAIXA_EFICIENCIA, abrimos o modal de BAIXA_EFICIENCIA — a confirmação cuidará de encerrar a parada
      if (targetStatus === 'BAIXA_EFICIENCIA') {
        setLowEffModal({
          ordem,
          operador: '',
          obs: '',
          data: now.toISOString().slice(0,10),
          hora: now.toTimeString().slice(0,5),
        })
        return
      }
      // Caso padrão: abre modal de retomada (resume)
      setResumeModal({ ordem, operador:'', data: now.toISOString().slice(0,10), hora: now.toTimeString().slice(0,5), targetStatus })
      return
    }

    // Caso padrão: aplica a mudança sem confirmar
    setStatus(ordem, targetStatus)
  }

  // ========================= Render =========================
  return (
    <div className="app">
      <BrandBar />
      <Tabs tab={tab} setTab={setTab} />

      {/* Login (rota oculta) */}
      {tab === 'login' && <Login />}

      {/* Admin itens (rota oculta) */}
      {tab === 'admin-itens' && (
        <CadastroItens />
      )}

      {/* Painel */}
      {tab === 'painel' && (
        <Painel
          ativosPorMaquina={ativosPorMaquina}
          paradas={paradas}
          tick={tick}
          onStatusChange={onStatusChange}
          setStartModal={setStartModal}
          setFinalizando={setFinalizando}
          lastFinalizadoPorMaquina={lastFinalizadoPorMaquina}
        />
      )}

      {/* Lista */}
      {tab === 'lista' && (
        <Lista
          ativosPorMaquina={ativosPorMaquina}
          sensors={sensors}
          onStatusChange={onStatusChange}
          setStartModal={setStartModal}
          setEditando={setEditando}
          setFinalizando={setFinalizando}
          enviarParaFila={enviarParaFila}
          refreshOrdens={fetchOrdensAbertas}
        />
      )}

      {/* Nova Ordem */}
      {tab === 'nova' && (
        <NovaOrdem form={form} setForm={setForm} criarOrdem={handleCriarOrdem} setTab={setTab} />
      )}

      {/* Registro */}
      {tab === 'registro' && (
        <Registro registroGrupos={registroGrupos} />
      )}

      {/* Modais */}
      <StartModal startModal={startModal} setStartModal={setStartModal} confirmarInicio={confirmarInicio} />
      <StopModal stopModal={stopModal} setStopModal={setStopModal} confirmarParada={confirmarParada} />
      <LowEffModal lowEffModal={lowEffModal} setLowEffModal={setLowEffModal} confirmarBaixaEf={confirmarBaixaEf} />
      <FinalizeModal finalizando={finalizando} setFinalizando={setFinalizando} confirmData={confirmData} setConfirmData={setConfirmData} finalizar={finalizar} />

    </div>
  )
}
