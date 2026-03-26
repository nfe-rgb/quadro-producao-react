import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  buildTestCameraUrl,
  createPairCode,
  getTestCameraChannelName,
  normalizePairCode,
} from '../lib/testeCamera'
import '../styles/teste-camera.css'

const CHANNEL_STATUS_LABEL = {
  SUBSCRIBED: 'Sessao pronta. Aguarde o celular conectar.',
  CLOSED: 'Canal encerrado.',
  TIMED_OUT: 'Tempo de conexao esgotado.',
  CHANNEL_ERROR: 'Erro no canal realtime.',
}

function formatClock(value) {
  if (!value) return 'aguardando leitura'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'aguardando leitura'
  return parsed.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function averageConfidence(detections = []) {
  if (!Array.isArray(detections) || detections.length === 0) return 'sem leitura'
  const total = detections.reduce((sum, item) => sum + Number(item?.score || 0), 0)
  return `${Math.round((total / detections.length) * 100)}%`
}

function buildLogEntry(text, tone = 'neutral') {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    tone,
    at: new Date().toISOString(),
  }
}

export default function Teste() {
  const [pairCode, setPairCode] = useState(() => createPairCode())
  const [channelState, setChannelState] = useState('Gerando sessao de teste...')
  const [mobileInfo, setMobileInfo] = useState(null)
  const [lastDetection, setLastDetection] = useState(null)
  const [previewImage, setPreviewImage] = useState('')
  const [copiedState, setCopiedState] = useState('')
  const [sessionLog, setSessionLog] = useState(() => [
    buildLogEntry('Sessao criada. Gere o codigo e conecte o celular pelo /site/camera.', 'accent'),
  ])

  const safePairCode = useMemo(() => normalizePairCode(pairCode), [pairCode])
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const mobileUrl = useMemo(() => buildTestCameraUrl(origin, safePairCode), [origin, safePairCode])

  useEffect(() => {
    if (!safePairCode) return undefined

    setMobileInfo(null)
    setLastDetection(null)
    setPreviewImage('')
    setChannelState('Aguardando o celular entrar no canal...')
    setSessionLog([
      buildLogEntry(`Sessao ${safePairCode} pronta. Abra o modo camera no celular e informe este codigo.`, 'accent'),
    ])

    let active = true
    const appendLog = (text, tone = 'neutral') => {
      setSessionLog((previous) => [buildLogEntry(text, tone), ...previous].slice(0, 8))
    }

    const channel = supabase
      .channel(getTestCameraChannelName(safePairCode), { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'device' }, ({ payload }) => {
        if (!active) return
        setMobileInfo(payload || null)
        appendLog(
          payload?.deviceName
            ? `Celular conectado: ${payload.deviceName}.`
            : 'Celular conectado a esta sessao.',
          'success'
        )
      })
      .on('broadcast', { event: 'status' }, ({ payload }) => {
        if (!active || !payload?.message) return
        setChannelState(payload.message)
        appendLog(payload.message, payload?.tone || 'neutral')
      })
      .on('broadcast', { event: 'detection' }, ({ payload }) => {
        if (!active || !payload) return
        setLastDetection(payload)
        if (payload.preview) setPreviewImage(payload.preview)
        setChannelState('Contagem em tempo real ativa.')
      })
      .on('broadcast', { event: 'preview' }, ({ payload }) => {
        if (!active || !payload?.image) return
        setPreviewImage(payload.image)
      })

    channel.subscribe(async (status) => {
      if (!active) return
      const label = CHANNEL_STATUS_LABEL[status] || `Estado do canal: ${status}`
      setChannelState(label)
      if (status === 'SUBSCRIBED') {
        appendLog('Sessao pronta. Aguarde a conexao do celular.', 'accent')
        await channel.send({
          type: 'broadcast',
          event: 'host-ready',
          payload: { pairCode: safePairCode, at: new Date().toISOString() },
        })
      }
    })

    return () => {
      active = false
      try {
        supabase.removeChannel(channel)
      } catch (error) {
        console.warn('Falha ao remover canal de teste:', error)
      }
    }
  }, [safePairCode])

  useEffect(() => {
    if (!copiedState) return undefined
    const timer = window.setTimeout(() => setCopiedState(''), 1800)
    return () => window.clearTimeout(timer)
  }, [copiedState])

  async function handleCopy(value, label) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopiedState(label)
    } catch (error) {
      console.warn('Falha ao copiar texto:', error)
      setCopiedState('falha')
    }
  }

  function handleRotateCode() {
    setPairCode(createPairCode())
    setCopiedState('')
  }

  const count = Number(lastDetection?.count || 0)
  const serialCount = Number(lastDetection?.serialCount || 0)
  const detections = Array.isArray(lastDetection?.detections) ? lastDetection.detections : []
  const detectionClasses = lastDetection?.classes && typeof lastDetection.classes === 'object'
    ? Object.entries(lastDetection.classes)
    : []

  return (
    <div className="teste-shell">
      <div className="teste-backdrop teste-backdrop-a" />
      <div className="teste-backdrop teste-backdrop-b" />

      <main className="teste-layout">
        <section className="teste-card teste-hero-card">
          <span className="teste-eyebrow">Laboratorio de visao</span>
          <h1>Rota limpa para validar novos fluxos do sistema</h1>
          <p>
            Esta sessao cria um codigo temporario, conecta o celular por Supabase Realtime e
            recebe a contagem em tempo real processada no navegador do proprio aparelho.
          </p>

          <div className="teste-code-panel">
            <div>
              <span className="teste-label">Codigo da sessao</span>
              <strong className="teste-code">{safePairCode}</strong>
            </div>

            <div className="teste-actions-inline">
              <button className="teste-btn teste-btn-primary" onClick={() => handleCopy(safePairCode, 'codigo')}>
                {copiedState === 'codigo' ? 'Codigo copiado' : 'Copiar codigo'}
              </button>
              <button className="teste-btn teste-btn-secondary" onClick={() => handleCopy(mobileUrl, 'link')}>
                {copiedState === 'link' ? 'Link copiado' : 'Copiar link'}
              </button>
              <button className="teste-btn teste-btn-ghost" onClick={handleRotateCode}>
                Gerar novo codigo
              </button>
            </div>
          </div>

          <div className="teste-link-box">
            <span className="teste-label">Entrada do celular</span>
            <a href={mobileUrl} target="_blank" rel="noreferrer">
              {mobileUrl}
            </a>
          </div>

          <div className="teste-steps">
            <div>
              <strong>1</strong>
              <span>Abra esta rota no desktop: /teste.</span>
            </div>
            <div>
              <strong>2</strong>
              <span>No celular, abra o link acima ou entre em /site/camera e digite o codigo.</span>
            </div>
            <div>
              <strong>3</strong>
              <span>Ative a camera, inicie a IA e acompanhe a contagem aqui.</span>
            </div>
          </div>
        </section>

        <section className="teste-card teste-preview-card">
          <div className="teste-preview-header">
            <div>
              <span className="teste-label">Status do canal</span>
              <strong>{channelState}</strong>
            </div>
            <span className={`teste-pill ${mobileInfo ? 'is-online' : 'is-offline'}`}>
              {mobileInfo ? 'Celular conectado' : 'Aguardando celular'}
            </span>
          </div>

          <div className="teste-preview-stage">
            {previewImage ? (
              <img src={previewImage} alt="Quadro enviado pela camera" className="teste-preview-image" />
            ) : (
              <div className="teste-preview-empty">
                <strong>Nenhum quadro recebido ainda</strong>
                <span>Assim que a camera iniciar, o ultimo frame processado aparece aqui.</span>
              </div>
            )}
          </div>

          <div className="teste-device-grid">
            <div>
              <span className="teste-label">Dispositivo</span>
              <strong>{mobileInfo?.deviceName || 'nao conectado'}</strong>
            </div>
            <div>
              <span className="teste-label">Tela</span>
              <strong>{mobileInfo?.screenLabel || 'nao informado'}</strong>
            </div>
            <div>
              <span className="teste-label">Ultima atualizacao</span>
              <strong>{formatClock(lastDetection?.at)}</strong>
            </div>
          </div>
        </section>

        <section className="teste-stat-grid">
          <article className="teste-card teste-stat-card">
            <span className="teste-label">Contagem seriada</span>
            <strong className="teste-stat-number">{serialCount}</strong>
            <small>Total acumulado por passagem na janela superior de leitura</small>
          </article>

          <article className="teste-card teste-stat-card">
            <span className="teste-label">Quantidade atual</span>
            <strong>{count}</strong>
            <small>Objetos visiveis no ultimo ciclo</small>
          </article>

          <article className="teste-card teste-stat-card">
            <span className="teste-label">Perfil de leitura</span>
            <strong>Queda rapida</strong>
            <small>Contagem por movimento e cruzamento da linha central</small>
          </article>

          <article className="teste-card teste-stat-card">
            <span className="teste-label">Sinal medio</span>
            <strong>{averageConfidence(detections)}</strong>
            <small>Intensidade media dos pontos detectados no ultimo ciclo</small>
          </article>

          <article className="teste-card teste-stat-card">
            <span className="teste-label">Modo de contagem</span>
            <strong>{lastDetection?.countMode === 'serie' ? 'Serie por passagem' : 'Instantaneo'}</strong>
            <small>Leitura acumulada por entrada na janela superior de leitura</small>
          </article>

          <article className="teste-card teste-stat-card">
            <span className="teste-label">Motor usado</span>
            <strong>Movimento rapido</strong>
            <small>Leitura focada em queda de pecas em serie</small>
          </article>

          <article className="teste-card teste-stat-card">
            <span className="teste-label">Filtro de estabilidade</span>
            <strong>{Number(count) === 0 && Number(serialCount) > 0 ? 'Atento' : 'Ativo'}</strong>
            <small>Quadros com tremida excessiva da camera sao descartados</small>
          </article>
        </section>

        <section className="teste-card">
          <div className="teste-section-header">
            <div>
              <span className="teste-label">Classes detectadas</span>
              <strong>Resumo da ultima leitura</strong>
            </div>
          </div>

          {detectionClasses.length ? (
            <div className="teste-chip-wrap">
              {detectionClasses.map(([className, total]) => (
                <span className="teste-chip" key={className}>
                  {className} <strong>{total}</strong>
                </span>
              ))}
            </div>
          ) : (
            <p className="teste-muted">Ainda nao houve deteccao publicada pelo celular.</p>
          )}

          {detections.length ? (
            <div className="teste-table">
              {detections.slice(0, 10).map((item, index) => (
                <div className="teste-table-row" key={`${item.className || item.class}-${index}`}>
                  <span>{item.className || item.class}</span>
                  <span>{Math.round(Number(item.score || 0) * 100)}%</span>
                  <span>
                    {Array.isArray(item.bbox) ? item.bbox.join(', ') : 'sem box'}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="teste-card teste-log-card">
          <div className="teste-section-header">
            <div>
              <span className="teste-label">Log da sessao</span>
              <strong>Eventos recentes</strong>
            </div>
          </div>

          <div className="teste-log-list">
            {sessionLog.map((entry) => (
              <div className={`teste-log-item tone-${entry.tone}`} key={entry.id}>
                <span>{entry.text}</span>
                <small>{formatClock(entry.at)}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="teste-card teste-note-card">
          <span className="teste-label">Limite atual do prototipo</span>
          <p>
            Este modo foi otimizado para velocidade de queda, nao para classificacao de objetos.
            Para reduzir falso positivo, o celular precisa ficar firme, a area de leitura deve conter
            apenas a queda das pecas e sombras ou reflexos fortes nao devem cruzar a linha central.
          </p>
        </section>
      </main>
    </div>
  )
}