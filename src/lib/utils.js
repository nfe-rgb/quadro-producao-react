// Determina o turno atual com base no horário e dia da semana
export function getTurnoAtual(date = new Date()) {
  const dia = date.getDay(); // 0=Dom, 1=Seg, ..., 6=Sáb
  const hora = date.getHours();
  const min = date.getMinutes();
  const minutos = hora * 60 + min;

  // Domingo
  if (dia === 0) {
    // 23:00 às 23:59 Turno 3
    if (minutos >= 23 * 60) return 3;
    // 00:00 às 04:59 Turno 3 (continuação)
    if (minutos < 5 * 60) return 3;
    // 05:00 às 22:59 = Hora Extra
    return 'HE';
  }
  // Segunda a Sexta
  if (dia >= 1 && dia <= 5) {
    if (minutos >= 5 * 60 && minutos < 13 * 60 + 30) return 1;
    if (minutos >= 13 * 60 + 30 && minutos < 22 * 60) return 2;
    // 22:00 às 23:59 Turno 3
    if (minutos >= 22 * 60) return 3;
    // 00:00 às 04:59 Turno 3 (continuação)
    if (minutos < 5 * 60) return 3;
  }
  // Sábado
  if (dia === 6) {
    if (minutos >= 5 * 60 && minutos < 9 * 60) return 1;
    if (minutos >= 9 * 60 && minutos < 13 * 60) return 2;
    // 13:00 às 23:59 = Hora Extra
    if (minutos >= 13 * 60) return 'HE';
    // 00:00 às 04:59 = Fora de turno (considerar HE)
    if (minutos < 5 * 60) return 'HE';
  }
  // Fora de qualquer turno (deve ser HE)
  return 'HE';
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
