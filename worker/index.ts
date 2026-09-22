type Env = {
  MEDIA: any
  ASSETS: { fetch(request: Request): Promise<Response> }
}

const SUPABASE_URL = 'https://ldtfzvvmjsarkxrchrqx.supabase.co'
const SUPABASE_KEY = 'sb_publishable_r3apEbRySSbhOSyx9URW7A_8aQDV5dN'
const MAX_CHAT_IMAGE_BYTES = 15 * 1024 * 1024
const AUTH_CACHE_TTL_MS = 60_000
const authCache = new Map<string, { memberId: string; expires: number }>()

function bearer(request: Request) {
  const header = request.headers.get('authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

function cookieToken(request: Request) {
  const cookie = request.headers.get('cookie') || ''
  const match = cookie.match(/(?:^|;\s*)fn_media=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

async function familyMember(request: Request, allowCookie = true) {
  const token = bearer(request) || (allowCookie ? cookieToken(request) : '')
  if (!token) return null

  const cached = authCache.get(token)
  if (cached && cached.expires > Date.now()) return { memberId: cached.memberId, token }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/current_family_member_id`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: '{}'
  })
  if (!response.ok) return null

  const memberId = await response.json().catch(() => null)
  if (typeof memberId !== 'string' || !memberId) return null

  if (authCache.size > 200) authCache.clear()
  authCache.set(token, { memberId, expires: Date.now() + AUTH_CACHE_TTL_MS })
  return { memberId, token }
}

function mediaKey(url: URL) {
  const prefix = '/api/media/object/'
  if (!url.pathname.startsWith(prefix)) return ''
  try { return decodeURIComponent(url.pathname.slice(prefix.length)) } catch { return '' }
}

function validChatKey(key: string) {
  return /^chat\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpe?g|png|webp|heic)$/i.test(key)
}

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  })
}

async function handleMedia(request: Request, env: Env) {
  const url = new URL(request.url)

  if (url.pathname === '/api/media/status' && request.method === 'GET') {
    return json({ storage: 'cloudflare-r2', ready: !!env.MEDIA })
  }

  if (url.pathname === '/api/media/session' && request.method === 'POST') {
    const family = await familyMember(request, false)
    if (!family) return json({ error: 'unauthorized' }, 401)
    return json(
      { ok: true, member_id: family.memberId },
      200,
      { 'set-cookie': `fn_media=${encodeURIComponent(family.token)}; Path=/api/media/; HttpOnly; Secure; SameSite=Strict; Max-Age=3300` }
    )
  }

  const key = mediaKey(url)
  if (!key || !validChatKey(key)) return json({ error: 'invalid_media_key' }, 400)

  const family = await familyMember(request)
  if (!family) return json({ error: 'unauthorized' }, 401)

  const ownerId = key.split('/')[1]

  if (request.method === 'PUT') {
    if (ownerId !== family.memberId) return json({ error: 'forbidden' }, 403)
    const contentType = request.headers.get('content-type') || 'application/octet-stream'
    if (!contentType.startsWith('image/')) return json({ error: 'invalid_content_type' }, 415)
    const body = await request.arrayBuffer()
    if (!body.byteLength || body.byteLength > MAX_CHAT_IMAGE_BYTES) return json({ error: 'invalid_size' }, 413)
    await env.MEDIA.put(key, body, {
      httpMetadata: { contentType },
      customMetadata: { ownerId: family.memberId, scope: 'chat' }
    })
    return json({ ok: true, key, size: body.byteLength })
  }

  if (request.method === 'DELETE') {
    if (ownerId !== family.memberId) return json({ error: 'forbidden' }, 403)
    await env.MEDIA.delete(key)
    return new Response(null, { status: 204 })
  }

  if (request.method === 'GET') {
    const object = await env.MEDIA.get(key)
    if (!object) return new Response('Not found', { status: 404 })
    const headers = new Headers()
    object.writeHttpMetadata(headers)
    headers.set('etag', object.httpEtag)
    headers.set('cache-control', 'private, max-age=3600')
    headers.set('x-content-type-options', 'nosniff')
    return new Response(object.body, { status: 200, headers })
  }

  return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, PUT, DELETE' } })
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/media/')) return handleMedia(request, env)
    return env.ASSETS.fetch(request)
  }
}
