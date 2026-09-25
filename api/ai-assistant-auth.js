import { ADMIN_EMAILS } from '../src/lib/constants.js'

function text(value) {
  return String(value ?? '').trim()
}

const ADMIN_EMAIL_SET = new Set((ADMIN_EMAILS || []).map((email) => text(email).toLowerCase()).filter(Boolean))

export function isAiAssistantAdmin(user) {
  return ADMIN_EMAIL_SET.has(text(user?.email).toLowerCase())
}

export function assertAiAssistantAdmin(user) {
  if (isAiAssistantAdmin(user)) return
  const error = new Error('Ícaro disponível apenas para administradores.')
  error.statusCode = 403
  throw error
}