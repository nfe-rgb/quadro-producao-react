import { DateTime } from "luxon";
import { getTurnoAtual as resolveTurnoAtual } from './shifts';

// Retorna 1, 2, 3 ou null quando estiver sem programacao.
// Aceita: nothing (usa agora), ISO string, JS Date, ou Luxon DateTime
export function getTurnoAtual(dateInput = null) {
  return resolveTurnoAtual(dateInput);
}

// src/lib/utils.js
export function statusClass(s){
  if(s==='AGUARDANDO') return 'card gray'
  if(s==='PRODUZINDO') return 'card green'
  if(s==='BAIXA_EFICIENCIA') return 'card yellow'
  if(s==='PARADA') return 'card red'
  return 'card'
}

export function fmtDateTime(ts) {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    const dia = d.toLocaleDateString('pt-BR')
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    return `${dia} ${hora}`
  } catch { return ts }
}

export function formatHHMMSS(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds || 0))
  const h = String(Math.floor(sec / 3600)).padStart(2, '0')
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0')
  const s = String(sec % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

export function fmtElapsedSince(startIso, currentTimeMs = Date.now()) {
  if (!startIso) return null
  const startMs = new Date(startIso).getTime()
  if (!Number.isFinite(startMs)) return null
  return formatHHMMSS(Math.floor((currentTimeMs - startMs) / 1000))
}

export function getProductionStartedAt(ordem) {
  return ordem?.active_session_started_at || ordem?.restarted_at || ordem?.started_at || null
}

// Converte data/hora local digitada -> ISO UTC
export function localDateTimeToISO(dateStr, timeStr) {
  const [Y, M, D] = String(dateStr).split('-').map(Number);
  const [h, m] = String(timeStr).split(':').map(Number);
  // Constrói o horário no fuso de São Paulo, preservando o horário digitado
  const dtBr = DateTime.fromObject(
    { year: Y, month: M, day: D, hour: h, minute: m, second: 0 },
    { zone: 'America/Sao_Paulo' }
  );
  // Retorna ISO com offset (-03:00), evitando virar o dia ao converter
  return dtBr.toISO();
}

// Util: a ordem JÁ iniciou produção?
export function jaIniciou(ordem) { return Boolean(ordem?.started_at) }

export function fmtDuracao(startIso, endIso){
  if(!startIso || !endIso) return '-'
  const sec = Math.max(0, Math.floor((new Date(endIso) - new Date(startIso))/1000))
  return formatHHMMSS(sec)
}
