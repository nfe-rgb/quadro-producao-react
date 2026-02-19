// src/App.jsx
import React, { useEffect, useState } from 'react'
import { DndContext, useSensor, useSensors, MouseSensor, TouchSensor } from '@dnd-kit/core'
import { useLocation } from 'react-router-dom';

import { MAQUINAS } from './lib/constants'
import CadastroItens from './abas/CadastroItens'
import Login from './abas/Login'
import Painel from './abas/Painel'
import Lista from './abas/Lista'
import NovaOrdem from './abas/NovaOrdem'
import Registro from './abas/Registro'
import Estoque from './abas/Estoque'
import Rastreio from './abas/Rastreio'
import Gestao from './abas/Gestao'
import PainelTV from './abas/PainelTV'
import Pet01 from './pages/Pet01'
import Pet02 from './pages/Pet02'
import Pet03 from './pages/Pet03'
import Ficha from './pages/Ficha'
import Prioridade from './pages/Prioridade'
import useOrders from './hooks/useOrders'
import useAuthAdmin from './hooks/useAuthAdmin'
import GlobalModals from './components/GlobalModals'
import Apontamento from './abas/Apontamento'
import { DateTime } from 'luxon';
import { supabase } from './lib/supabaseClient'

export default function App(){
  const [tab,setTab] = useState('login')
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

  const [openSet, setOpenSet] = useState(()=>new Set())
  function toggleOpen(id){ setOpenSet(prev=>{ const n=new Set(prev); if(n.has(id)) n.delete(id); else n.add(id); return n }) }

  // prioridades por máquina (persistidas no Supabase)
  const [machinePriorities, setMachinePriorities] = useState({})
  const [prioritiesLoading, setPrioritiesLoading] = useState(false)

  const { authUser, authChecked, isAdmin, accessLevel, isMendes, isStockOnlyAccess } = useAuthAdmin()
  const hasEstoqueAccess = !!authUser && (accessLevel === 2 || accessLevel === 3 || isMendes)
  const hasGestaoAccess = !!authUser && !isMendes && !isStockOnlyAccess && (accessLevel === 1 || accessLevel === 2)

  const {
    ordens, paradas,
    fetchOrdensAbertas,
    criarOrdem, atualizar, enviarParaFila, finalizar,
    confirmarInicio, confirmarParada, confirmarRetomada, confirmarBaixaEf, confirmarEncerrarBaixaEf,
    ativosPorMaquina, registroGrupos, lastFinalizadoPorMaquina, onStatusChange
  } = useOrders()

  useEffect(()=>{
     const nowBR = DateTime.now().setZone('America/Sao_Paulo')
    setConfirmData({
    por: '',
    data: nowBR.toISODate(),       // 'YYYY-MM-DD' correto para <input type="date">
    hora: nowBR.toFormat('HH:mm')  // 'HH:mm' correto para <input type="time">
    })
  }, [finalizando?.id])

  const location = useLocation();

  // Busca prioridades do Supabase
  useEffect(() => {
    async function loadPriorities() {
      setPrioritiesLoading(true)
      try {
        const { data, error } = await supabase
          .from('machine_priorities')
          .select('machine_id, priority')
          .order('machine_id', { ascending: true })

        if (!error && Array.isArray(data)) {
          const mapped = {}
          data.forEach((row) => {
            const key = String(row.machine_id || '').toUpperCase()
            const val = row.priority == null ? null : Number(row.priority)
            if (key) mapped[key] = Number.isFinite(val) ? val : null
          })
          setMachinePriorities(mapped)
        } else if (error) {
          console.warn('Falha ao carregar prioridades:', error)
        }
      } catch (err) {
        console.warn('Erro ao buscar prioridades:', err)
      } finally {
        setPrioritiesLoading(false)
      }
    }

    loadPriorities()

    // assinatura realtime para refletir atualizações
    const channel = supabase
      .channel('machine-priorities')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'machine_priorities' },
        (payload) => {
          const row = payload.new || payload.old
          if (!row) return
          setMachinePriorities((prev) => {
            const next = { ...prev }
            if (payload.eventType === 'DELETE') {
              delete next[String(row.machine_id || '').toUpperCase()]
            } else {
              const key = String(row.machine_id || '').toUpperCase()
              const val = row.priority == null ? null : Number(row.priority)
              if (key) next[key] = Number.isFinite(val) ? val : null
            }
            return next
          })
        }
      )
      .subscribe()

    return () => {
      try {
        supabase.removeChannel(channel)
      } catch (err) {
        console.warn('Falha ao remover canal de prioridades:', err)
      }
    }
  }, [])

  async function handlePriorityChange(machineId, priorityValue) {
    const userEmail = String(authUser?.email || '').toLowerCase();
    if (userEmail !== 'nfe@savantiplasticos.com.br') {
      alert('Apenas o e-mail autorizado pode alterar prioridades.');
      return;
    }
    try {
      const val = priorityValue === '' || priorityValue == null ? null : Number(priorityValue)
      const payload = {
        machine_id: machineId,
        priority: val,
        updated_by: authUser?.email || null,
      }
      const { data, error } = await supabase.from('machine_priorities').upsert(payload).select()
      if (error) {
        alert('Não foi possível salvar a prioridade agora.')
        console.warn('Erro ao salvar prioridade:', error)
        return
      }
      if (data && data[0]) {
        const key = String(machineId || '').toUpperCase()
        const valNum = data[0].priority == null ? null : Number(data[0].priority)
        setMachinePriorities((prev) => ({ ...prev, [key]: Number.isFinite(valNum) ? valNum : null }))
      }
    } catch (err) {
      alert('Erro ao salvar prioridade.')
      console.warn('Erro ao salvar prioridade:', err)
    }
  }

  // Atalhos de teclado: Ctrl+L (Login) e Ctrl+I (Cadastro Itens)
  useEffect(() => {
    const onKey = (e) => {
      const ctrl = e.ctrlKey || e.metaKey; // permitir Cmd no Mac
      if (!ctrl) return;
      const key = String(e.key).toLowerCase();
      if (key === 'l') {
        e.preventDefault();
        setTab('login');
      } else if (key === 'i') {
        e.preventDefault();
        setTab('admin-itens');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  useEffect(() => {
    if (!authChecked) return
    if (!authUser && tab !== 'login') {
      setTab('login')
      return
    }
    if (!authUser) return

    if (isMendes) {
      if (tab !== 'estoque' && tab !== 'login') {
        setTab('estoque')
      }
      if (tab === 'login') {
        setTab('estoque')
      }
      return
    }

    if (tab === 'login') {
      setTab('painel')
      return
    }

    if (tab === 'estoque' && accessLevel !== 2 && accessLevel !== 3) {
      setTab('painel')
      return
    }

    if (tab === 'gestao' && isStockOnlyAccess) {
      setTab('painel')
    }
  }, [authChecked, authUser, tab, isMendes, accessLevel, isStockOnlyAccess])

  async function handleSignOut() {
    try {
      await supabase.auth.signOut()
    } catch (err) {
      console.warn('Falha ao encerrar sessão:', err)
    } finally {
      setTab('login')
    }
  }

  function handleLoginSuccess(user) {
    if (!user) return
    setTab('painel')
  }

  // pet pages quick-return (mantive comportamento)
  // rota de login para acesso via celular (/login)
  if (location && location.pathname === '/login') {
    return (
      <div className="app">
        <div className="brand-bar">
          <img src="/Logotipo Savanti.png" alt="Savanti Plásticos" className="brand-logo"
               onError={(e)=>{ e.currentTarget.src='/savanti-logo.png'; }}/>
          <div className="brand-titles">
            <h1 className="brand-title">Painel de Produção</h1>
            <div className="brand-sub">Savanti Plásticos • Acesso Admin</div>
          </div>
        </div>
        <Login />
      </div>
    )
  }

  if (location && location.pathname === '/ficha') {
    return (
      <div className="app">
        <div className="brand-bar">
          <img src="/Logotipo Savanti.png" alt="Savanti Plásticos" className="brand-logo"
               onError={(e)=>{ e.currentTarget.src='/savanti-logo.png'; }}/>
          <div className="brand-titles">
            <h1 className="brand-title">Painel de Produção</h1>
            <div className="brand-sub">Savanti Plásticos • Ficha Técnica Digital</div>
          </div>
        </div>
        <Ficha />
      </div>
    )
  }

  if (location && location.pathname === '/indicadores') {
    return (
      <div className="app">
        <div className="brand-bar">
          <img src="/Logotipo Savanti.png" alt="Savanti Plásticos" className="brand-logo"
               onError={(e)=>{ e.currentTarget.src='/savanti-logo.png'; }}/>
          <div className="brand-titles">
            <h1 className="brand-title">Painel de Produção</h1>
            <div className="brand-sub">Savanti Plásticos • Indicadores por Setor</div>
          </div>
        </div>
        <Indicadores />
      </div>
    )
  }
  if (location && location.pathname === '/pet-01') {
    const ativosP1 = ordens.filter(o => o.machine_id === 'P1' && !o.finalized).sort((a,b)=>(a.pos??999)-(b.pos??999))
    return (
      <>
        <Pet01
          registroGrupos={registroGrupos}
          ativosP1={ativosP1}
          tick={tick}
          paradas={paradas}
          onStatusChange={handleStatusChange}
          setStartModal={setStartModal}
          setStopModal={setStopModal}
          setLowEffModal={setLowEffModal}
          setLowEffEndModal={setLowEffEndModal}
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

  if (location && location.pathname === '/prioridade') {
    return (
      <div className="app">
        <Prioridade
          machinePriorities={machinePriorities}
          onChangePriority={handlePriorityChange}
          loading={prioritiesLoading}
          authUser={authUser}
        />
      </div>
    )
  }

  if (location && String(location.pathname || '').toLowerCase() === '/tv') {
    return (
      <div className="app" style={{ padding: 0 }}>
        <PainelTV
          ativosPorMaquina={ativosPorMaquina}
          paradas={paradas}
          tick={tick}
          lastFinalizadoPorMaquina={lastFinalizadoPorMaquina}
        />
      </div>
    )
  }

    if (location && location.pathname === '/pet-02') {
    const ativosP2 = ordens.filter(o => o.machine_id === 'P2' && !o.finalized).sort((a,b)=>(a.pos??999)-(b.pos??999))
    return (
      <>
        <Pet02
          registroGrupos={registroGrupos}
          ativosP2={ativosP2}
          tick={tick}
          paradas={paradas}
          onStatusChange={handleStatusChange}
          setStartModal={setStartModal}
          setStopModal={setStopModal}
          setLowEffModal={setLowEffModal}
          setLowEffEndModal={setLowEffEndModal}
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
          paradas={paradas}
          onStatusChange={handleStatusChange}
          setStartModal={setStartModal}
          setStopModal={setStopModal}
          setLowEffModal={setLowEffModal}
          setLowEffEndModal={setLowEffEndModal}
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
    const ativosP4 = ordens.filter(o => o.machine_id === 'p4' && !o.finalized).sort((a,b)=>(a.pos??999)-(b.pos??999))
    return (
      <>
        <Pet04
          registroGrupos={registroGrupos}
          ativosP4={ativosP4}
          tick={tick}
          paradas={paradas}
          onStatusChange={handleStatusChange}
          setStartModal={setStartModal}
          setStopModal={setStopModal}
          setLowEffModal={setLowEffModal}
          setLowEffEndModal={setLowEffEndModal}
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

  // controle de abas e renderização

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

      {authUser && tab !== 'login' && (
        <div className="tabs">
          {isMendes ? (
            <>
              <button className={`tabbtn ${tab==='estoque'?'active':''}`} onClick={()=>setTab('estoque')}>Estoque</button>
              <button className="tabbtn" onClick={handleSignOut}>Sair</button>
            </>
          ) : (
            <>
              <button className={`tabbtn ${tab==='painel'?'active':''}`} onClick={()=>setTab('painel')}>Painel</button>
              <button className={`tabbtn ${tab==='lista'?'active':''}`} onClick={()=>setTab('lista')}>Lista</button>
              {isAdmin && (
                <button className={`tabbtn ${tab==='nova'?'active':''}`} onClick={()=>setTab('nova')}>Nova Ordem</button>
              )}
              <button className={`tabbtn ${tab==='registro'?'active':''}`} onClick={()=>setTab('registro')}>Paradas</button>
              <button className={`tabbtn ${tab==='rastreio'?'active':''}`} onClick={()=>setTab('rastreio')}>Rastreio</button>
              {authUser && (accessLevel === 2 || accessLevel === 3) && (
                <button className={`tabbtn ${tab==='estoque'?'active':''}`} onClick={()=>setTab('estoque')}>Estoque</button>
              )}
              <button className={`tabbtn ${tab==='apontamento'?'active':''}`} onClick={()=>setTab('apontamento')}>Apontamento</button>
              {hasGestaoAccess && (
                <button className={`tabbtn ${tab==='gestao'?'active':''}`} onClick={()=>setTab('gestao')}>Gestão</button>
              )}
              <button className="tabbtn" onClick={handleSignOut}>Sair</button>
            </>
          )}
        </div>
      )}

      {tab === 'login' && (
        <Login
          onAuthenticated={handleLoginSuccess}
          authenticatedTitle="Acesso liberado"
          authenticatedDescription="Clique em Continuar para abrir seu ambiente."
          showAdminShortcut={false}
        />
      )}

      {tab === 'admin-itens' && (
        authChecked ? (
          isAdmin ? (
            <CadastroItens />
          ) : (
            <div style={{ padding: 24 }}>
              <h2>Acesso Negado</h2>
              <p>Esta página não está disponível.</p>
            </div>
          )
        ) : (
          <div style={{ padding: 16 }}>
            <small>Verificando permissões…</small>
          </div>
        )
      )}

      {tab === 'painel' && !isMendes && (
        <Painel
          ativosPorMaquina={ativosPorMaquina}
          paradas={paradas}
          tick={tick}
          onStatusChange={handleStatusChange}
          setStartModal={setStartModal}
          setFinalizando={setFinalizando}
          lastFinalizadoPorMaquina={lastFinalizadoPorMaquina}
          onScanned={fetchOrdensAbertas}
          authUser={authUser}
          machinePriorities={machinePriorities}
        />
      )}

      {tab === 'lista' && !isMendes && (
        <Lista
          ativosPorMaquina={ativosPorMaquina}
          sensors={sensors}
          onStatusChange={handleStatusChange}
          setStartModal={setStartModal}
          setEditando={setEditando}
          setFinalizando={setFinalizando}
          enviarParaFila={enviarParaFila}
          refreshOrdens={fetchOrdensAbertas}
          isAdmin={isAdmin}
        />
      )}

      {tab === 'nova' && accessLevel === 2 && !isMendes && (
        isAdmin ? (
          <NovaOrdem form={form} setForm={setForm} criarOrdem={() => criarOrdem(form, setForm, setTab)} />
        ) : (
          <div style={{ padding: 24 }}>
            <h2>Acesso Negado</h2>
            <p>Esta página não está disponível.</p>
          </div>
        )
      )}

      {tab === 'registro' && !isMendes && (
        <Registro registroGrupos={registroGrupos} openSet={openSet} toggleOpen={toggleOpen} isAdmin={isAdmin} />
      )}

      {tab === 'rastreio' && !isMendes && (
        <Rastreio />
      )}

      {tab === 'estoque' && hasEstoqueAccess && (
        <Estoque
          readOnly={isMendes}
          allowedClient={isMendes ? 'Mendes' : ''}
        />
      )}

      {tab === 'apontamento' && !isMendes && (
        <Apontamento isAdmin={isAdmin} />
      )}

      {tab === 'gestao' && !isMendes && (
        hasGestaoAccess ? (
          <Gestao />
        ) : (
          <div style={{ padding: 24 }}>
            <h2>Acesso Negado</h2>
            <p>Esta página não está disponível.</p>
          </div>
        )
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
