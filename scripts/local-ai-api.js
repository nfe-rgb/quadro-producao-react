import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import aiAssistantHandler from '../api/ai-assistant.js'
import aiAssistantAccountHandler from '../api/ai-assistant-account.js'
import aiAssistantTtsHandler from '../api/ai-assistant-tts.js'

const PORT = Number(process.env.LOCAL_AI_API_PORT || 3001)

function loadEnvFile(fileName, { override = false } = {}) {
  const filePath = resolve(process.cwd(), fileName)
  if (!existsSync(filePath)) return

  const content = readFileSync(filePath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    const rawValue = trimmed.slice(separatorIndex + 1).trim()
    const value = rawValue.replace(/^['"]|['"]$/g, '')
    if (key && (override || process.env[key] == null)) process.env[key] = value
  }
}

loadEnvFile('.env')
loadEnvFile('.env.local', { override: true })

function readRequestBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1024 * 1024) {
        req.destroy()
        rejectBody(new Error('Payload muito grande.'))
      }
    })
    req.on('end', () => {
      if (!body) {
        resolveBody({})
        return
      }
      try {
        resolveBody(JSON.parse(body))
      } catch {
        rejectBody(new Error('JSON invalido.'))
      }
    })
    req.on('error', rejectBody)
  })
}

function createResponseAdapter(res) {
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value
      res.setHeader(name, value)
    },
    status(code) {
      this.statusCode = code
      res.statusCode = code
      return this
    },
    json(payload) {
      if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.statusCode = this.statusCode
      res.end(JSON.stringify(payload))
    },
    end(payload) {
      res.statusCode = this.statusCode
      res.end(payload)
    },
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`)

  const handler = url.pathname === '/api/ai-assistant'
    ? aiAssistantHandler
    : url.pathname === '/api/ai-assistant-account'
      ? aiAssistantAccountHandler
      : url.pathname === '/api/ai-assistant-tts'
        ? aiAssistantTtsHandler
      : null

  if (!handler) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'Rota local nao encontrada.' }))
    return
  }

  try {
    req.body = await readRequestBody(req)
    await handler(req, createResponseAdapter(res))
  } catch (error) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: error?.message || 'Falha no servidor local da IA.' }))
  }
})

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`Porta ${PORT} ja esta em uso. A API local provavelmente ja esta rodando; mantenha apenas um npm run dev:api aberto.`)
    process.exit(1)
  }

  console.error('Falha ao iniciar a API local da IA:', error)
  process.exit(1)
})

server.listen(PORT, () => {
  console.log(`Assistente IA local ouvindo em http://localhost:${PORT}/api/ai-assistant`)
  console.log(`OpenAI: ${process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY carregada' : 'OPENAI_API_KEY ausente'} | Modelo: ${process.env.OPENAI_MODEL || 'gpt-4o-mini'}`)
})