/**
 * Host half of dsh-ws-scrcpy-web.
 *
 * Talks to a ws-scrcpy-web service purely over its own HTTP/WebSocket APIs.
 * It does NOT spawn any local process, does NOT read a local adb, and does NOT
 * depend on the service running on this machine. The service may live on any
 * host (including a Linux/ARM server); only `baseUrl` matters.
 *
 * Service APIs used (all reached through `baseUrl`):
 *   GET  /api/whoami          -> app, pid, installMode, version  (liveness)
 *   GET  /                     -> per-launch ws_scrcpy_token cookie (session)
 *   WS   /?action=multiplex    -> "GTRC" channel -> {"type":"devicelist",...}
 *
 * The protected admin API (/api/dependencies, /api/devices POST, ...) is never
 * called. The panel is rendered by the Client half; `open_screen` only returns
 * a standalone stream URL and never claims the picture is displayed.
 *
 * The service base URL is editable from the panel's More menu. This Host
 * persists it through the sanctioned configEditor API (never by writing the
 * profile patch itself) and keeps `current` in sync for this process.
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineTool } from './define-tool.js'

export const inject = ['tools', 'webServer', 'connection', 'configEditor']

const DEFAULT_BASE_URL = 'http://localhost:6902'
const ICON_PATH = fileURLToPath(new URL('./favicon.png', import.meta.url))
const PROBE_TIMEOUT_MS = 4000
const DEVICE_TIMEOUT_MS = 8000
const MAX_MESSAGE = 1024 * 1024

/** Resolve the configured service base URL with a safe default. */
function baseUrlOf(config) {
  const raw = typeof config?.baseUrl === 'string' && config.baseUrl.trim() !== '' ? config.baseUrl.trim() : DEFAULT_BASE_URL
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`Invalid ws-scrcpy base URL: ${raw}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('ws-scrcpy base URL must use http:// or https://')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('ws-scrcpy base URL must not embed a username or password')
  }
  return raw.replace(/\/+$/, '')
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

/** GET a bounded JSON document with a timeout. */
async function fetchJson(url, timeoutMs = PROBE_TIMEOUT_MS) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`)
  return await response.json()
}

/** Probe service liveness using only the anonymously accessible /api/whoami. */
async function probe(config) {
  const base = baseUrlOf(config)
  try {
    const who = await fetchJson(`${base}/api/whoami`)
    const app = typeof who?.app === 'string' ? who.app : null
    if (app !== 'ws-scrcpy-web') {
      return {
        online: false,
        url: base,
        app,
        pid: typeof who?.pid === 'number' ? who.pid : null,
        installMode: typeof who?.installMode === 'string' ? who.installMode : null,
        version: typeof who?.version === 'string' ? who.version : null,
        detail: app === null ? 'Unexpected /api/whoami response' : `Unexpected service: ${app}`,
      }
    }
    return {
      online: true,
      url: base,
      app,
      pid: typeof who?.pid === 'number' ? who.pid : null,
      installMode: typeof who?.installMode === 'string' ? who.installMode : null,
      version: typeof who?.version === 'string' ? who.version : null,
      detail: 'GET /api/whoami responded successfully',
    }
  } catch (error) {
    return {
      online: false,
      url: base,
      app: null,
      pid: null,
      installMode: null,
      version: null,
      detail: errorText(error),
    }
  }
}

/** ws-scrcpy multiplex frame: CreateChannel (type 4). */
function createChannelFrame(channelId, code) {
  const data = new TextEncoder().encode(code)
  const buf = new Uint8Array(5 + data.length)
  const view = new DataView(buf.buffer)
  view.setUint8(0, 4) // CreateChannel
  view.setUint32(1, channelId, true)
  buf.set(data, 5)
  return buf
}

/** Obtain the per-launch session cookie from the service's own home page. */
async function obtainSessionCookie(base, signal) {
  const timer = AbortSignal.timeout(PROBE_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([timer, signal]) : timer
  const response = await fetch(`${base}/`, { signal: combined, redirect: 'manual' })
  const setCookie = response.headers.get('set-cookie') ?? ''
  const match = /ws_scrcpy_token=([^;]+)/.exec(setCookie)
  if (match === null) throw new Error('service did not issue a ws_scrcpy_token cookie')
  return `ws_scrcpy_token=${match[1]}`
}

/**
 * Read the service's live device list over its own WebSocket. No local adb,
 * no local process: the result is exactly what the service sees, which is the
 * right source of truth for generating a stream URL from that service.
 */
function serviceDevices(config, signal) {
  return new Promise((resolve, reject) => {
    const base = baseUrlOf(config)
    obtainSessionCookie(base, signal).then((cookie) => {
      let settled = false
      let ws
      const finish = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        try { ws?.close() } catch {}
        fn(value)
      }
      const onAbort = () => finish(reject, new Error('device query was cancelled'))
      if (signal?.aborted) { reject(new Error('device query was cancelled')); return }
      signal?.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => finish(reject, new Error(`device query timed out after ${DEVICE_TIMEOUT_MS} ms`)), DEVICE_TIMEOUT_MS)

      const wsUrl = new URL('/', base)
      wsUrl.protocol = base.startsWith('https:') ? 'wss:' : 'ws:'
      wsUrl.searchParams.set('action', 'multiplex')
      try {
        ws = new WebSocket(wsUrl.toString(), { headers: { Cookie: cookie, Origin: base } })
      } catch (error) {
        finish(reject, new Error(`Cannot open service WebSocket: ${errorText(error)}`))
        return
      }

      const parseFrame = (ab) => {
        const bytes = ab instanceof Uint8Array ? ab : new Uint8Array(ab)
        if (bytes.length < 5) return null
        const type = bytes[0]
        if (type !== 32) return null // RawStringData
        const payload = bytes.slice(5)
        if (payload.length > MAX_MESSAGE) return null
        try { return JSON.parse(new TextDecoder().decode(payload)) } catch { return null }
      }

      ws.addEventListener('open', () => {
        try { ws.send(createChannelFrame(1, 'GTRC')) } catch (error) { finish(reject, errorText(error)) }
      })
      ws.addEventListener('message', async (event) => {
        let ab
        if (event.data instanceof ArrayBuffer) ab = event.data
        else if (typeof Blob !== 'undefined' && event.data instanceof Blob) ab = await event.data.arrayBuffer()
        else if (event.data instanceof Uint8Array) ab = event.data.buffer
        if (ab === undefined) return
        const msg = parseFrame(ab)
        if (msg === null || msg?.type !== 'devicelist') return
        const list = Array.isArray(msg?.data?.list) ? msg.data.list : []
        const devices = list.map((item) => ({
          serial: typeof item?.udid === 'string' ? item.udid : '',
          state: typeof item?.state === 'string' ? item.state : 'unknown',
          model: typeof item?.['ro.product.model'] === 'string' ? item['ro.product.model'] : null,
          manufacturer: typeof item?.['ro.product.manufacturer'] === 'string' ? item['ro.product.manufacturer'] : null,
          deviceKind: typeof item?.deviceKind === 'string' ? item.deviceKind : null,
        })).filter((device) => device.serial !== '')
        const tracker = typeof msg?.data?.name === 'string' ? msg.data.name : null
        finish(resolve, { baseUrl: base, tracker, devices })
      })
      ws.addEventListener('error', () => finish(reject, new Error('service WebSocket error while querying devices')))
      ws.addEventListener('close', () => finish(reject, new Error('service WebSocket closed before a device list arrived')))
    }).catch((error) => reject(new Error(`Cannot query service devices: ${errorText(error)}`)))
  })
}

/** Service-side environment summary. Everything comes from the service. */
async function environment(config, signal) {
  const service = await probe(config)
  let devices = []
  let deviceDetail = ''
  try {
    const result = await serviceDevices(config, signal)
    devices = result.devices
    deviceDetail = `service websocket device list; ${devices.length} device(s)`
  } catch (error) {
    deviceDetail = errorText(error)
  }
  const checks = [
    {
      name: 'ws-scrcpy service',
      status: service.online ? 'online' : 'offline',
      version: service.version ?? undefined,
      detail: service.detail,
    },
    {
      name: 'Service device list',
      status: deviceDetail.startsWith('service websocket') ? 'available' : 'unavailable',
      count: devices.filter((device) => device.state === 'device').length,
      detail: deviceDetail,
    },
  ]
  return { url: service.url, service, checks, devices }
}

/** Exact standalone stream page for one device (ws-scrcpy /embed.html). */
function streamDeepLink(base, udid) {
  return `${base}/embed.html?device=${encodeURIComponent(udid)}`
}

function writeJson(res, status, body) {
  if (res.writableEnded) return
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

const textRender = (fn) => (_args, value) => [{ type: 'text', text: fn(value) }]

/** Read a bounded JSON request body (for config POST). */
async function readJsonBody(req, limit = 16 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  if (size === 0) return undefined
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return undefined }
}

/** Validate a user-supplied base URL; returns the canonical form or throws. */
function validateBaseUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') throw new Error('Service address must not be empty')
  const candidate = { baseUrl: raw }
  return baseUrlOf(candidate)
}

export function apply(ctx, config) {
  let current = { ...(config ?? {}) }
  const configEditor = ctx.get('configEditor')

  /** Find this plugin's own loader entry for config persistence. */
  function ownEntry() {
    try {
      const direct = ctx.fiber?.entry
      if (direct !== undefined && typeof direct?.options?.id === 'string' && direct.options.id !== '') return direct
    } catch {}
    try {
      const self = ctx.fiber
      for (const entry of ctx.loader?.entries?.() ?? []) {
        if (entry?.fiber === self) return entry
        if (entry?.options?.name === 'dsh-ws-scrcpy-web') return entry
      }
    } catch {}
    return undefined
  }

  /** Persist baseUrl through the sanctioned configEditor; never write the patch ourselves. */
  async function saveBaseUrl(raw) {
    const value = validateBaseUrl(raw)
    const entry = ownEntry()
    if (entry === undefined || configEditor === undefined) {
      current = { ...current, baseUrl: value }
      return { ok: false, appliedInMemory: true, baseUrl: value, error: 'No writable config layer in this profile; change lasts only until restart' }
    }
    try {
      await configEditor.edit(entry, (existing) => ({ ...existing, baseUrl: value }))
      current = { ...current, baseUrl: value }
      return { ok: true, appliedInMemory: true, baseUrl: value, note: 'Saved. The plugin row will restart to apply the new address; reload the panel afterwards.' }
    } catch (error) {
      return { ok: false, appliedInMemory: false, baseUrl: baseUrlOf(current), error: errorText(error) }
    }
  }

  // Serve the same favicon used by the plugin page, so the panel and sidebar
  // show one consistent icon instead of a hand-drawn SVG.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-ws-scrcpy-web/icon.png',
    handler: async (_req, res) => {
      try {
        const bytes = await readFile(ICON_PATH)
        res.writeHead(200, {
          'content-type': 'image/png',
          'cache-control': 'public, max-age=3600',
          'content-length': bytes.length,
        })
        res.end(bytes)
      } catch (error) {
        res.writeHead(404, { 'cache-control': 'no-store' })
        res.end(errorText(error))
      }
    },
  }), 'dsh-ws-scrcpy-web: favicon route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-ws-scrcpy-web/api',
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'cache-control': 'no-store' })
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      try {
        if (pathname === '/dsh-ws-scrcpy-web/api/config') {
          if (req.method === 'GET') {
            writeJson(res, 200, {
              baseUrl: baseUrlOf(current),
              writable: entryWritable(),
            })
            return
          }
          if (req.method === 'POST') {
            const body = await readJsonBody(req)
            if (body === undefined || typeof body !== 'object' || typeof body.baseUrl !== 'string') {
              writeJson(res, 400, { ok: false, error: 'A JSON body with "baseUrl" is required' })
              return
            }
            try {
              writeJson(res, 200, await saveBaseUrl(body.baseUrl))
            } catch (error) {
              writeJson(res, 400, { ok: false, error: errorText(error) })
            }
            return
          }
          writeJson(res, 405, { error: 'GET or POST required' })
          return
        }
        if (req.method !== 'GET') {
          writeJson(res, 405, { error: 'GET required' })
          return
        }
        if (pathname === '/dsh-ws-scrcpy-web/api/status') {
          writeJson(res, 200, await probe(current))
          return
        }
        if (pathname === '/dsh-ws-scrcpy-web/api/environment') {
          writeJson(res, 200, await environment(current, req.signal))
          return
        }
        if (pathname === '/dsh-ws-scrcpy-web/api/devices') {
          writeJson(res, 200, await serviceDevices(current, req.signal))
          return
        }
        writeJson(res, 404, { error: 'not found' })
      } catch (error) {
        writeJson(res, 502, { error: errorText(error) })
      }
    },
  }), 'dsh-ws-scrcpy-web: API routes (config read/write + read-only service data)')

  function entryWritable() {
    const entry = ownEntry()
    return entry !== undefined && configEditor !== undefined
  }

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'ws_device',
    description:
      'Device bridge to a ws-scrcpy-web Android mirroring service (Android Power Tools). '
      + 'The service may be local or remote; the plugin only needs its base URL and never uses a local adb. '
      + 'Actions: "status" probes the service via /api/whoami and returns version; '
      + '"environment" summarizes service health and its live device list (all data comes from the service); '
      + '"devices" lists the devices the SERVICE sees, with serial, state and model; '
      + '"open_screen" validates one exact device serial and returns the URL of the STANDALONE stream page '
      + '(/embed.html?device=<serial>): video only, no console shell or device list. '
      + 'open_screen does NOT display the stream by itself: hand the returned URL to the user. '
      + 'Set the service address from the ws-scrcpy-web panel\'s More (⋮) menu; it persists via configEditor. '
      + 'Never claim the picture is already showing.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['status', 'environment', 'devices', 'open_screen'],
        description: 'status, environment, devices, or open_screen.',
      },
      deviceId: {
        type: 'string',
        description: 'Exact device serial for open_screen, e.g. "127.0.0.1:7555" or "emulator-5554".',
      },
      udid: {
        type: 'string',
        description: 'Alias for deviceId. If both are given they must match.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          action: { type: 'string' },
          online: { type: 'boolean' },
          url: { type: 'string' },
          baseUrl: { type: 'string' },
          version: { type: 'string' },
          pid: { type: 'number' },
          installMode: { type: 'string' },
          detail: { type: 'string' },
          tracker: { type: 'string' },
          checks: { type: 'array', items: { type: 'object' } },
          devices: { type: 'array', items: { type: 'object' } },
          deviceId: { type: 'string' },
          deepLink: { type: 'string' },
          displayState: { type: 'string', enum: ['not_displayed'] },
          candidates: { type: 'array', items: { type: 'object' } },
        },
      },
      render: textRender((value) => {
        if (value.action === 'open_screen') {
          return value.deviceId
            ? `Standalone stream URL for ${value.deviceId}: ${value.deepLink}\nVideo-only page (no console). Not opened automatically — give this URL to the user.`
            : `No exact device id given. Candidates: ${JSON.stringify(value.candidates ?? [])}`
        }
        return JSON.stringify(value, null, 2)
      }),
    },
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const action = String(args.action ?? '')
      if (action === 'status') return { action, ...await probe(current) }
      if (action === 'environment') return { action, ...await environment(current, exec.signal) }
      if (action === 'devices') return { action, ...await serviceDevices(current, exec.signal) }
      if (action === 'open_screen') {
        const a = typeof args.deviceId === 'string' ? args.deviceId.trim() : ''
        const b = typeof args.udid === 'string' ? args.udid.trim() : ''
        if (a !== '' && b !== '' && a !== b) throw new Error('deviceId and udid disagree; pass a single exact device serial')
        const udid = a !== '' ? a : b
        const base = baseUrlOf(current)
        if (udid === '') {
          let candidates = []
          try {
            candidates = (await serviceDevices(current, exec.signal)).devices
              .filter((device) => device.state === 'device')
              .map((device) => ({ serial: device.serial, model: device.model }))
          } catch {}
          return {
            action,
            deviceId: null,
            deepLink: null,
            displayState: 'not_displayed',
            detail: 'No device serial supplied. Choose one exact serial from candidates, or run `ws_device devices`.',
            candidates,
          }
        }
        if (/[\r\n\t]/.test(udid) || udid.length > 256) throw new Error('Invalid device serial')
        return {
          action,
          deviceId: udid,
          deepLink: streamDeepLink(base, udid),
          displayState: 'not_displayed',
          detail: 'Standalone video-only stream URL prepared (/embed.html?device=<serial>). It is not opened automatically; give the URL to the user.',
        }
      }
      throw new Error(`Unknown action "${action}"`)
    },
  })), 'dsh-ws-scrcpy-web: ws_device tool')
}
