/**
 * Minimal OAuth broker for desktop clients that need a confidential client secret
 * (notably Bitbucket Cloud authorization-code flow).
 *
 * Deploy separately. The desktop app should open the system browser to
 * /oauth/start?provider=...&state=... and receive the callback via a loopback
 * redirect or custom protocol that exchanges the code here for tokens.
 *
 * This service intentionally does not store long-lived user tokens; it only
 * brokers the code exchange so the client secret never ships in the app.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { URL } from 'url'

const PORT = Number(process.env.PORT || 8787)
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

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = typeof body === 'string' ? body : JSON.stringify(body, null, 2)
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json',
    'Access-Control-Allow-Origin': '*'
  })
  res.end(payload)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)

  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, { ok: true })
    return
  }

  if (req.method === 'GET' && url.pathname === '/oauth/start') {
    const provider = url.searchParams.get('provider') as Provider
    const redirectUri = url.searchParams.get('redirect_uri')
    const state = url.searchParams.get('state') || crypto.randomUUID()
    const client = CLIENTS[provider]
    if (!client?.clientId || !redirectUri) {
      send(res, 400, 'provider, client id, and redirect_uri required')
      return
    }
    const auth = new URL(client.authorize)
    auth.searchParams.set('client_id', client.clientId)
    auth.searchParams.set('redirect_uri', redirectUri)
    auth.searchParams.set('response_type', 'code')
    auth.searchParams.set('state', state)
    if (provider === 'github') auth.searchParams.set('scope', 'repo read:user')
    if (provider === 'gitlab') auth.searchParams.set('scope', 'read_api read_repository write_repository')
    res.writeHead(302, { Location: auth.toString() })
    res.end()
    return
  }

  if (req.method === 'POST' && url.pathname === '/oauth/exchange') {
    const raw = await readBody(req)
    const body = JSON.parse(raw || '{}') as {
      provider?: Provider
      code?: string
      redirect_uri?: string
    }
    const client = body.provider ? CLIENTS[body.provider] : undefined
    if (!client?.clientSecret || !body.code || !body.redirect_uri) {
      send(res, 400, { error: 'provider, code, redirect_uri required' })
      return
    }
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: body.code,
      redirect_uri: body.redirect_uri,
      client_id: client.clientId,
      client_secret: client.clientSecret
    })
    const tokenRes = await fetch(client.token, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString()
    })
    const json = await tokenRes.json()
    send(res, tokenRes.status, json)
    return
  }

  send(res, 404, { error: 'not found' })
})

server.listen(PORT, () => {
  console.log(`OAuth broker listening on http://127.0.0.1:${PORT}`)
})
