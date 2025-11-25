// src/App.jsx
import React, { useEffect, useMemo, useState } from 'react'
import { DndContext, useSensor, useSensors, MouseSensor, TouchSensor } from '@dnd-kit/core'
import { useLocation } from 'react-router-dom';

import { MAQUINAS } from './lib/constants'
import CadastroItens from './abas/CadastroItens'
import Login from './abas/Login'
import Painel from './abas/Painel'
import Lista from './abas/Lista'
import NovaOrdem from './abas/NovaOrdem'
import Registro from './abas/Registro'
import Pet01 from './pages/Pet01'
import Pet02 from './pages/Pet02'
import Pet03 from './pages/Pet03'
import Pet04 from './pages/Pet04'

import useOrders from './hooks/useOrders'
import useAuthAdmin from './hooks/useAuthAdmin'
import GlobalModals from './components/GlobalModals'

export default function App(){
  const [tab,setTab] = useState('painel')
  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 5 }})
  const touchSensor = useSensor(TouchSensor, { pressDelay: 150, activationConstraint: { distance: 5 }})
  const sensors = useSensors(mouseSensor, touchSensor)

  const [form,setForm] = useState({
    code:'', customer:'', product:'', color:'', qty:'', boxes:'', standard:'', due_date:'', notes:'', machine_id:'P1'
  })

  // modals state (local UI)
  const [editando,setEditando] = useState(null)
  const [finalizando,setFinalizando] = useState(null)
  const [confirmData, setConfirmData] = useState({por:'', data:'', hora:''})

  const [startModal, setStartModal]   = useState(null)
  const [stopModal, setStopModal]     = useState(null)
  const [resumeModal, setResumeModal] = useState(null)
  const [lowEffModal, setLowEffModal] = useState(null)
  const [lowEffEndModal, setLowEffEndModal] = useState(null)

  const [tick, setTick] = useState(0)
  useEffect(()=>{ const id=setInterval(()=>setTick(t=>t+1),1000); return ()=>clearInterval(id) },[])

  const { authUser, authChecked, isAdmin } = useAuthAdmin()

  const {
    ordens, finalizadas, paradas,
    fetchOrdensAbertas, fetchOrdensFinalizadas, fetchParadas,
    criarOrdem, atualizar, enviarParaFila, finalizar,
    confirmarInicio, confirmarParada, confirmarRetomada, confirmarBaixaEf, confirmarEncerrarBaixaEf,
    ativosPorMaquina, registroGrupos, lastFinalizadoPorMaquina, onStatusChange
  } = useOrders()

  useEffect(()=>{
    const now = new Date()
    setConfirmData({ por:'', data: now.toISOString().slice(0,10), hora: now.toTimeString().slice(0,5) })
  },[finalizando?.id])

  const location = useLocation();

  // central handler: recebe instrução do hook onStatusChange e abre modais localmente
  async function handleStatusChange(ordem, targetStatus){
    const res = await onStatusChange(ordem, targetStatus)
    if (!res) return
    if (res.action === 'alert') {
      alert(res.message)
      return
    }
    if (res.action === 'openLowEffModal') {
      setLowEffModal(res.payload); return
    }
    if (res.action === 'openLowEffEndModal') {
      setLowEffEndModal(res.payload); return
    }
    if (res.action === 'openStopModal') {
      setStopModal(res.payload); return
    }
    if (res.action === 'openResumeModal') {
      setResumeModal(res.payload); return
    }
    return
  }

  // pet pages quick-return (mantive comportamento)
  if (location && location.pathname === '/pet-01') {
    const ativosP1 = ordens.filter(o => o.machine_id === 'P1' && !o.finalized).sort((a,b)=>(a.pos??999)-(b.pos??999))
    return (
      <>
        <Pet01
          registroGrupos={registroGrupos}
          ativosP1={ativosP1}
          tick={tick}
          onStatusChange={handleStatusChange}
          setStartModal={setStartModal}
          setStopModal={setStopModal}
          setLowEffModal={setLowEffModal}
          setResumeModal={setResumeModal}
          setFinalizando={setFinalizando}
          setEditando={setEditando}
        />
        <GlobalModals
          editando={editando} setEditando={setEditando}
          finalizando={finalizando} setFinalizando={setFinalizando} confirmData={confirmData} setConfirmData={setConfirmData}
          startModal={startModal} setStartModal={setStartModal}
          stopModal={stopModal} setStopModal={setStopModal}
          resumeModal={resumeModal} setResumeModal={setResumeModal}
          lowEffModal={lowEffModal} setLowEffModal={setLowEffModal}
          lowEffEndModal={lowEffEndModal} setLowEffEndModal={setLowEffEndModal}
          onUpdateOrder={atualizar}
          onFinalize={finalizar}
          onConfirmStart={confirmarInicio}
          onConfirmStop={confirmarParada}
          onConfirmResume={confirmarRetomada}
          onConfirmLowEffStart={confirmarBaixaEf}
          onConfirmLowEffEnd={confirmarEncerrarBaixaEf}
        />
      </>
    );
  }

    if (location && location.pathname === '/pet-02') {
    const ativosP2 = ordens.filter(o => o.machine_id === 'P2' && !o.finalized).sort((a,b)=>(a.pos??999)-(b.pos??999))
    return (
      <>
        <Pet02
          registroGrupos={registroGrupos}
          ativosP2={ativosP2}
          tick={tick}
          onStatusChange={handleStatusChange}
          setStartModal={setStartModal}
          setStopModal={setStopModal}
          setLowEffModal={setLowEffModal}
          setResumeModal={setResumeModal}
          setFinalizando={setFinalizando}
          setEditando={setEditando}
        />
        <GlobalModals
          editando={editando} setEditando={setEditando}
          finalizando={finalizando} setFinalizando={setFinalizando} confirmData={confirmData} setConfirmData={setConfirmData}
          startModal={startModal} setStartModal={setStartModal}
          stopModal={stopModal} setStopModal={setStopModal}
          resumeModal={resumeModal} setResumeModal={setResumeModal}
          lowEffModal={lowEffModal} setLowEffModal={setLowEffModal}
          lowEffEndModal={lowEffEndModal} setLowEffEndModal={setLowEffEndModal}
          onUpdateOrder={atualizar}
          onFinalize={finalizar}
          onConfirmStart={confirmarInicio}
          onConfirmStop={confirmarParada}
          onConfirmResume={confirmarRetomada}
          onConfirmLowEffStart={confirmarBaixaEf}
          onConfirmLowEffEnd={confirmarEncerrarBaixaEf}
        />
      </>
    );
  }

    if (location && location.pathname === '/pet-03') {
    const ativosP3 = ordens.filter(o => o.machine_id === 'P3' && !o.finalized).sort((a,b)=>(a.pos??999)-(b.pos??999))
    return (
      <>
        <Pet03
          registroGrupos={registroGrupos}
          ativosP3={ativosP3}
          tick={tick}
          onStatusChange={handleStatusChange}
          setStartModal={setStartModal}
          setStopModal={setStopModal}
          setLowEffModal={setLowEffModal}
          setResumeModal={setResumeModal}
          setFinalizando={setFinalizando}
          setEditando={setEditando}
        />
        <GlobalModals
          editando={editando} setEditando={setEditando}
          finalizando={finalizando} setFinalizando={setFinalizando} confirmData={confirmData} setConfirmData={setConfirmData}
          startModal={startModal} setStartModal={setStartModal}
          stopModal={stopModal} setStopModal={setStopModal}
          resumeModal={resumeModal} setResumeModal={setResumeModal}
          lowEffModal={lowEffModal} setLowEffModal={setLowEffModal}
          lowEffEndModal={lowEffEndModal} setLowEffEndModal={setLowEffEndModal}
          onUpdateOrder={atualizar}
          onFinalize={finalizar}
          onConfirmStart={confirmarInicio}
          onConfirmStop={confirmarParada}
          onConfirmResume={confirmarRetomada}
          onConfirmLowEffStart={confirmarBaixaEf}
          onConfirmLowEffEnd={confirmarEncerrarBaixaEf}
        />
      </>
    );
  }

      if (location && location.pathname === '/pet-04') {
    const ativosP4 = ordens.filter(o => o.machine_id === 'P4' && !o.finalized).sort((a,b)=>(a.pos??999)-(b.pos??999))
    return (
      <>
        <Pet04
          registroGrupos={registroGrupos}
          ativosP4={ativosP4}
          tick={tick}
          onStatusChange={handleStatusChange}
          setStartModal={setStartModal}
          setStopModal={setStopModal}
          setLowEffModal={setLowEffModal}
          setResumeModal={setResumeModal}
          setFinalizando={setFinalizando}
          setEditando={setEditando}
        />
        <GlobalModals
          editando={editando} setEditando={setEditando}
          finalizando={finalizando} setFinalizando={setFinalizando} confirmData={confirmData} setConfirmData={setConfirmData}
          startModal={startModal} setStartModal={setStartModal}
          stopModal={stopModal} setStopModal={setStopModal}
          resumeModal={resumeModal} setResumeModal={setResumeModal}
          lowEffModal={lowEffModal} setLowEffModal={setLowEffModal}
          lowEffEndModal={lowEffEndModal} setLowEffEndModal={setLowEffEndModal}
          onUpdateOrder={atualizar}
          onFinalize={finalizar}
          onConfirmStart={confirmarInicio}
          onConfirmStop={confirmarParada}
          onConfirmResume={confirmarRetomada}
          onConfirmLowEffStart={confirmarBaixaEf}
          onConfirmLowEffEnd={confirmarEncerrarBaixaEf}
        />
      </>
    );
  }


  const [openSet, setOpenSet] = useState(()=>new Set())
  function toggleOpen(id){ setOpenSet(prev=>{ const n=new Set(prev); if(n.has(id)) n.delete(id); else n.add(id); return n }) }

  return (
    <div className={`app ${tab === 'painel' ? 'has-meta' : ''}`}>


{/* mostre a barra de marca apenas quando não estivermos no painel */}
{tab !== 'painel' && (
  <div className="brand-bar">
    <img src="/Logotipo Savanti.png" alt="Savanti Plásticos" className="brand-logo"
         onError={(e)=>{ e.currentTarget.src='/savanti-logo.png'; }}/>
    <div className="brand-titles">
      <h1 className="brand-title">Painel de Produção</h1>
      <div className="brand-sub">Savanti Plásticos • Controle de Ordens</div>
    </div>
  </div>
)}

      <div className="tabs">
        <button className={`tabbtn ${tab==='painel'?'active':''}`} onClick={()=>setTab('painel')}>Painel</button>
        <button className={`tabbtn ${tab==='lista'?'active':''}`} onClick={()=>setTab('lista')}>Lista</button>
        <button className={`tabbtn ${tab==='nova'?'active':''}`} onClick={()=>setTab('nova')}>Nova Ordem</button>
        <button className={`tabbtn ${tab==='registro'?'active':''}`} onClick={()=>setTab('registro')}>Registro</button>
      </div>

      {tab === 'login' && <Login />}

      {tab === 'admin-itens' && (
        authChecked ? (
          isAdmin ? (
            <CadastroItens />
          ) : (
            <div style={{ padding: 24 }}>
              <h3>Não encontrado</h3>
              <p>Esta página não está disponível.</p>
            </div>
          )
        ) : (
          <div style={{ padding: 16 }}>
            <small>Verificando permissões…</small>
          </div>
        )
      )}

      {tab === 'painel' && (
        <Painel
          ativosPorMaquina={ativosPorMaquina}
          paradas={paradas}
          tick={tick}
          onStatusChange={handleStatusChange}
          setStartModal={setStartModal}
          setFinalizando={setFinalizando}
          lastFinalizadoPorMaquina={lastFinalizadoPorMaquina}
          onScanned={fetchOrdensAbertas}
        />
      )}

      {tab === 'lista' && (
        <Lista
          ativosPorMaquina={ativosPorMaquina}
          sensors={sensors}
          onStatusChange={handleStatusChange}
          setStartModal={setStartModal}
          setEditando={setEditando}
          setFinalizando={setFinalizando}
          enviarParaFila={enviarParaFila}
          refreshOrdens={fetchOrdensAbertas}
        />
      )}

      {tab === 'nova' && (
        <NovaOrdem form={form} setForm={setForm} criarOrdem={() => criarOrdem(form, setForm, setTab)} />
      )}

      {tab === 'registro' && (
        <Registro registroGrupos={registroGrupos} openSet={openSet} toggleOpen={toggleOpen} />
      )}

      {/* Modais centralizados */}
      <GlobalModals
        editando={editando} setEditando={setEditando}
        finalizando={finalizando} setFinalizando={setFinalizando} confirmData={confirmData} setConfirmData={setConfirmData}
        startModal={startModal} setStartModal={setStartModal}
        stopModal={stopModal} setStopModal={setStopModal}
        resumeModal={resumeModal} setResumeModal={setResumeModal}
        lowEffModal={lowEffModal} setLowEffModal={setLowEffModal}
        lowEffEndModal={lowEffEndModal} setLowEffEndModal={setLowEffEndModal}
        onUpdateOrder={atualizar}
        onFinalize={finalizar}
        onConfirmStart={confirmarInicio}
        onConfirmStop={confirmarParada}
        onConfirmResume={confirmarRetomada}
        onConfirmLowEffStart={confirmarBaixaEf}
        onConfirmLowEffEnd={confirmarEncerrarBaixaEf}
      />
    </div>
  )
}
