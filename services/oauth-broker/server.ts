/**
 * Minimal OAuth broker for desktop clients that need a confidential client secret
 * (notably Bitbucket Cloud authorization-code flow).
 *
 * Deploy separately. The desktop app should open the system browser to
 * /oauth/start?provider=...&state=...&redirect_uri=... and receive the callback via a loopback
 * redirect or custom protocol that exchanges the code here for tokens.
 *
 * This service intentionally does not store long-lived user tokens; it only brokers the code
 * exchange so the client secret never ships in the app. It binds to 127.0.0.1 unless HOST is set,
 * sends no CORS headers (it is called by the desktop app, not by web pages), requires the caller's
 * `state`, and caps request bodies. It is not wired into the desktop app yet — add PKCE when it is.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { URL } from 'url'

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const MAX_BODY_BYTES = 16 * 1024

const CLIENTS = {
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    clientId: process.env.GITHUB_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || ''
  },
  gitlab: {
    authorize: 'https://gitlab.com/oauth/authorize',
    token: 'https://gitlab.com/oauth/token',
    clientId: process.env.GITLAB_CLIENT_ID || '',
    clientSecret: process.env.GITLAB_CLIENT_SECRET || ''
  },
  bitbucket: {
    authorize: 'https://bitbucket.org/site/oauth2/authorize',
    token: 'https://bitbucket.org/site/oauth2/access_token',
    clientId: process.env.BITBUCKET_CLIENT_ID || '',
    clientSecret: process.env.BITBUCKET_CLIENT_SECRET || ''
  }
} as const

type Provider = keyof typeof CLIENTS

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CLIENTS, value)
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = typeof body === 'string' ? body : JSON.stringify(body, null, 2)
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json',
    'Cache-Control': 'no-store'
  })
  res.end(payload)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.from(chunk)
    size += buf.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'request body too large')
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)

  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, { ok: true })
    return
  }

  if (req.method === 'GET' && url.pathname === '/oauth/start') {
    const provider = url.searchParams.get('provider')
    const redirectUri = url.searchParams.get('redirect_uri')
    const state = url.searchParams.get('state')
    if (!isProvider(provider) || !CLIENTS[provider].clientId || !redirectUri || !state) {
      throw new HttpError(400, 'a configured provider, redirect_uri and state are required')
    }
    const client = CLIENTS[provider]
    const auth = new URL(client.authorize)
    auth.searchParams.set('client_id', client.clientId)
    auth.searchParams.set('redirect_uri', redirectUri)
    auth.searchParams.set('response_type', 'code')
    auth.searchParams.set('state', state)
    if (provider === 'github') auth.searchParams.set('scope', 'repo read:user')
    if (provider === 'gitlab') auth.searchParams.set('scope', 'read_api read_repository write_repository')
    res.writeHead(302, { Location: auth.toString(), 'Cache-Control': 'no-store' })
    res.end()
    return
  }

  if (req.method === 'POST' && url.pathname === '/oauth/exchange') {
    let body: { provider?: unknown; code?: unknown; redirect_uri?: unknown }
    try {
      body = JSON.parse((await readBody(req)) || '{}')
    } catch (err) {
      if (err instanceof HttpError) throw err
      throw new HttpError(400, 'request body must be JSON')
    }
    const { provider, code, redirect_uri: redirectUri } = body
    if (
      !isProvider(provider) ||
      !CLIENTS[provider].clientSecret ||
      typeof code !== 'string' ||
      typeof redirectUri !== 'string'
    ) {
      throw new HttpError(400, 'a configured provider, code and redirect_uri are required')
    }
    const client = CLIENTS[provider]
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: client.clientId,
      client_secret: client.clientSecret
    })
    let tokenRes: Response
    try {
      tokenRes = await fetch(client.token, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: form.toString(),
        signal: AbortSignal.timeout(15_000)
      })
    } catch {
      throw new HttpError(502, 'token endpoint unreachable')
    }
    let json: unknown
    try {
      json = await tokenRes.json()
    } catch {
      throw new HttpError(502, 'token endpoint returned invalid JSON')
    }
    send(res, tokenRes.status, json)
    return
  }

  send(res, 404, { error: 'not found' })
}

const server = createServer((req, res) => {
  // One bad request must never take the broker down.
  handle(req, res).catch((err: unknown) => {
    const status = err instanceof HttpError ? err.status : 500
    const message = err instanceof HttpError ? err.message : 'internal error'
    if (!res.headersSent) send(res, status, { error: message })
    else res.end()
  })
})

server.listen(PORT, HOST, () => {
  console.log(`OAuth broker listening on http://${HOST}:${PORT}`)
})
