// CU Schedule — 只读分享的最小后端。
//
// 单一职责：把一次「导出为只读课表」的选择存进内存，换一个短 id；别人拿这个 id
// 就能取回同一份实例（供 /#v=<id> 只读视图渲染 / 导出 / 手机查看）。
//
// 存储：进程内 Map，1 天 TTL（过期即删，另有定时清扫）。重启即清空——这正是
// 「内存存储、有效期一天」的语义，不追求持久化。无第三方依赖，纯 Node http。
//
// 路由：
//   POST /api/share      body=JSON 实例 → { id }
//   GET  /api/share/:id  → { data } | 404
//   GET  /api/health     → { ok:true, count }

import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'

const PORT = Number(process.env.SHARE_PORT ?? process.env.PORT ?? 8787)
const TTL_MS = 24 * 60 * 60 * 1000 // 1 天
const MAX_BODY = 256 * 1024 // 256KB 上限，防滥用
const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789' // 去掉易混字符

/** @type {Map<string, { data: unknown; expires: number }>} */
const store = new Map()

function makeId(length = 9) {
  const bytes = randomBytes(length)
  let id = ''
  for (let i = 0; i < length; i += 1) id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length]
  return id
}

function sweep() {
  const now = Date.now()
  for (const [id, entry] of store) if (entry.expires <= now) store.delete(id)
}
setInterval(sweep, 60 * 60 * 1000).unref()

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {})
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sweep()
    sendJson(res, 200, { ok: true, count: store.size })
    return
  }

  // GET /api/share/:id
  const getMatch = url.pathname.match(/^\/api\/share\/([A-Za-z0-9]+)$/)
  if (req.method === 'GET' && getMatch) {
    const entry = store.get(getMatch[1])
    if (!entry || entry.expires <= Date.now()) {
      store.delete(getMatch[1])
      sendJson(res, 404, { error: 'not_found' })
      return
    }
    sendJson(res, 200, { data: entry.data, expiresAt: entry.expires })
    return
  }

  // POST /api/share
  if (req.method === 'POST' && url.pathname === '/api/share') {
    try {
      const raw = await readBody(req)
      const data = JSON.parse(raw)
      if (typeof data !== 'object' || data === null) {
        sendJson(res, 400, { error: 'invalid_body' })
        return
      }
      let id = makeId()
      while (store.has(id)) id = makeId()
      const expires = Date.now() + TTL_MS
      store.set(id, { data, expires })
      sendJson(res, 201, { id, expiresAt: expires })
    } catch (cause) {
      sendJson(res, cause instanceof Error && cause.message === 'payload too large' ? 413 : 400, {
        error: 'bad_request',
      })
    }
    return
  }

  sendJson(res, 404, { error: 'not_found' })
})

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[share] listening on :${PORT}`)
})
