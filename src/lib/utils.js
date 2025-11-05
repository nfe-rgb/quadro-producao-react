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

// Converte data/hora local digitada -> ISO UTC
export function localDateTimeToISO(dateStr, timeStr) {
  const [Y,M,D] = dateStr.split('-').map(Number)
  const [h,m] = timeStr.split(':').map(Number)
  const local = new Date(Y, M-1, D, h, m, 0)
  return local.toISOString()
}

// Util: a ordem JÁ iniciou produção?
export function jaIniciou(ordem) { return Boolean(ordem?.started_at) }

export function fmtDuracao(startIso, endIso){
  if(!startIso || !endIso) return '-'
  const sec = Math.max(0, Math.floor((new Date(endIso) - new Date(startIso))/1000))
  const h = String(Math.floor(sec/3600)).padStart(2,'0')
  const m = String(Math.floor((sec%3600)/60)).padStart(2,'0')
  const s = String(sec%60).padStart(2,'0')
  return `${h}:${m}:${s}`
}
