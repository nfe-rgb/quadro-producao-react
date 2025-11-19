// src/App.jsx
import { useState } from 'react'
import { DndContext, useSensor, useSensors, MouseSensor, TouchSensor } from '@dnd-kit/core'
import { Routes, Route, useLocation } from 'react-router-dom'

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

export default function App(){
  const location = useLocation()
  const [tab,setTab] = useState('painel')
  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 5 }})
  const touchSensor = useSensor(TouchSensor, { pressDelay: 150, activationConstraint: { distance: 5 }})
  const sensors = useSensors(mouseSensor, touchSensor)

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

  // small route special-case like original
  if (location.pathname === '/pet-01') {
    return <Pet01 registroGrupos={registroGrupos} />
  }

  return (
    <div className="app">
      <BrandBar />
      <Tabs tab={tab} setTab={setTab} />

      {tab === 'login' && <Login />}

      {tab === 'admin-itens' && (
        /* keep your auth logic in a small wrapper or move to useAuth; for brevity left out here */
        <CadastroItens />
      )}

      {tab === 'painel' && (
        <Painel
          ativosPorMaquina={ativosPorMaquina}
          paradas={paradas}
          tick={tick}
          onStatusChange={(ordem, target) => { /* delegate to your existing onStatusChange logic OR export that function */ }}
          setStartModal={setStartModal}
          setFinalizando={setFinalizando}
          lastFinalizadoPorMaquina={lastFinalizadoPorMaquina}
        />
      )}

      {tab === 'lista' && (
        <Lista
          ativosPorMaquina={ativosPorMaquina}
          sensors={sensors}
          onStatusChange={(...args)=>{}}
          setStartModal={setStartModal}
          setEditando={setEditando}
          setFinalizando={setFinalizando}
          enviarParaFila={enviarParaFila}
          refreshOrdens={fetchOrdensAbertas}
        />
      )}

      {tab === 'nova' && (
        <NovaOrdem /* passe props necessários (form,setForm,criarOrdem) */ />
      )}

      {tab === 'registro' && (
        <Registro registroGrupos={registroGrupos} /* openSet, toggleOpen etc */ />
      )}

      {/* Modais - injetam a lógica do hook */}
      <StartModal startModal={startModal} setStartModal={setStartModal} confirmarInicio={confirmarInicio} />
      <StopModal stopModal={stopModal} setStopModal={setStopModal} confirmarParada={confirmarParada} />
      <LowEffModal lowEffModal={lowEffModal} setLowEffModal={setLowEffModal} confirmarBaixaEf={confirmarBaixaEf} />
      <FinalizeModal finalizando={finalizando} setFinalizando={setFinalizando} confirmData={confirmData} setConfirmData={setConfirmData} finalizar={finalizar} />

      <Apontamento tab={tab} ordens={ordens} ativosPorMaquina={ativosPorMaquina} finalizar={finalizar} />
    </div>
  )
}
