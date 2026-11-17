/**
 * Client half of dsh-ws-scrcpy-web.
 *
 * Renders one global sidebar entry and one keyed `main` panel. The panel stays
 * inside the shell's allocated main area: the root is a normal flow flex column
 * with height:100% — no absolute positioning and no append to document.body.
 *
 * The main panel probes the service status first. When the service is online it
 * mounts the ws-scrcpy console in a webview guest (Desktop) or iframe (Web).
 * When it is offline or unreachable, a friendly guidance page is shown instead
 * of a blank frame, with the configured address and a link to the ⋮ settings.
 * The sidebar entry and panel title use the product name "安卓设备台".
 */
window.__ModuleLoader__.load({
  id: 'dsh-ws-scrcpy-web',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const PANEL_ID = 'dsh-ws-scrcpy-web'
    const API = 'dsh-ws-scrcpy-web/api/'

    const COPY = {
      en: {
        panelTitle: 'Android device console',
        sidebarLabel: 'Android devices',
        goHome: 'Device list',
        refresh: 'Reload',
        more: 'More',
        serviceTitle: 'Service address',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        saveFailed: 'Save failed',
        addressRequired: 'Address required',
        loadFailed: 'Could not load the console',
        retry: 'Retry',
        checking: 'Checking service…',
        offlineTitle: 'Device console is offline',
        offlineDetail: 'The ws-scrcpy-web service is not reachable at the address below. Start the service, or set the correct address in the ⋮ menu, then retry.',
        offlineAddress: 'Service address',
        openSettings: 'Set address',
        recheck: 'Recheck',
        deviceHint: 'This plugin manages a pool of Android devices through the service; no local adb is needed.',
      },
      zh: {
        panelTitle: '安卓设备台',
        sidebarLabel: '安卓设备台',
        goHome: '设备列表',
        refresh: '重新加载',
        more: '更多',
        serviceTitle: '服务地址',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        saveFailed: '保存失败',
        addressRequired: '请填写地址',
        loadFailed: '控制台加载失败',
        retry: '重试',
        checking: '正在检测服务…',
        offlineTitle: '设备控制台未连接',
        offlineDetail: '下面的地址暂时无法访问 ws-scrcpy-web 服务。请确认服务已启动,或在 ⋮ 菜单中填写正确地址后重试。',
        offlineAddress: '服务地址',
        openSettings: '设置地址',
        recheck: '重新检测',
        deviceHint: '本插件通过该服务集中管理多台安卓设备,无需本机安装 adb。',
      },
    }

    function currentCopy(ctx) {
      let zh = false
      try {
        const locale = ctx.get('locale')
        const id = typeof locale?.getLocale === 'function' ? locale.getLocale()?.id : undefined
        if (typeof id === 'string' && id !== '') zh = id.toLowerCase().startsWith('zh')
      } catch {}
      if (!zh && typeof navigator !== 'undefined') zh = String(navigator.language ?? '').toLowerCase().startsWith('zh')
      return zh ? COPY.zh : COPY.en
    }

    function styles(ctx) {
      const css = [
        '.wsc-root{height:100%;min-height:0;display:flex;flex-direction:column;box-sizing:border-box;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);line-height:1.5}',
        '.wsc-head{flex:none;position:relative;display:flex;align-items:center;gap:8px;height:42px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
        '.wsc-headicon{width:22px;height:22px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:6px;overflow:hidden}',
        '.wsc-headicon img{width:100%;height:100%;object-fit:contain;display:block}',
        '.wsc-title{font-weight:600;font-size:13px}',
        '.wsc-spacer{flex:1;min-width:0}',
        '.wsc-ib{flex:none;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
        '.wsc-ib:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
        '.wsc-menu{position:absolute;right:10px;top:40px;z-index:20;min-width:240px;max-width:340px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 28px rgba(0,0,0,.25);font-size:11px;color:var(--dsw-alias-label-secondary)}',
        '.wsc-menu h4{margin:0 0 8px;font-size:12px;color:var(--dsw-alias-label-primary)}',
        '.wsc-row{display:flex;gap:6px;align-items:center}',
        '.wsc-btn{flex:none;padding:6px 10px;font:inherit;font-size:11px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}',
        '.wsc-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
        '.wsc-btn:disabled{opacity:.5;cursor:default}',
        '.wsc-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}',
        '.wsc-input{width:100%;min-width:0;height:30px;box-sizing:border-box;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;outline:none}',
        '.wsc-input:focus{border-color:var(--dsw-alias-brand-primary)}',
        '.wsc-kv{display:grid;grid-template-columns:56px 1fr;gap:4px 8px;align-items:baseline;margin-bottom:8px}',
        '.wsc-code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}',
        '.wsc-check{padding:5px 7px;border-radius:6px;background:var(--dsw-alias-bg-layer-2)}',
        '.wsc-check b{color:var(--dsw-alias-label-primary);font-weight:500}',
        '.wsc-hint{font-size:10px;opacity:.8;line-height:1.5}',
        '.wsc-err{margin:10px;padding:10px 12px;border-radius:8px;font-size:12px;line-height:1.6;color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2);border-left:2px solid var(--dsw-alias-state-error-primary)}',
        '.wsc-body{flex:1;min-height:0;display:flex;flex-direction:column}',
        '.wsc-frame-wrap{flex:1;min-height:0;display:flex;flex-direction:column}',
        '.wsc-frame{flex:1;min-height:0;width:100%;border:0;background:#fff}',
        '.wsc-empty{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto}',
        '.wsc-empty-card{width:100%;max-width:460px;display:flex;flex-direction:column;gap:12px}',
        '.wsc-empty-icon{width:44px;height:44px;border-radius:11px;background:var(--dsw-alias-bg-layer-2);display:flex;align-items:center;justify-content:center;overflow:hidden}',
        '.wsc-empty-icon img{width:28px;height:28px;object-fit:contain}',
        '.wsc-empty-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.wsc-empty-detail{font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary)}',
        '.wsc-empty-addr{display:flex;align-items:center;gap:7px;padding:8px 10px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);font-size:11px;color:var(--dsw-alias-label-secondary)}',
        '.wsc-empty-addr b{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-primary);font-weight:500;overflow-wrap:anywhere}',
        '.wsc-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}',
        '.wsc-dot.off{background:var(--dsw-alias-state-error-primary)}',
        '.wsc-dot.on{background:var(--dsw-alias-state-success-primary)}',
        '.wsc-empty-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}',
        '.wsc-empty-foot{font-size:10px;line-height:1.6;opacity:.75}',
      ].join('')
      // The `styles` builtin is not exposed as a ctx service in this runtime;
      // inject a package-tagged stylesheet into <head> with a real disposer.
      return ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.wscConsole = ''
        tag.textContent = css
        document.head.appendChild(tag)
        return () => { tag.remove() }
      }, 'dsh-ws-scrcpy-web: styles')
    }

    function apiUrl(route) {
      return new URL(API + route, document.baseURI).href
    }

    function iconUrl() {
      return new URL('dsh-ws-scrcpy-web/icon.png', document.baseURI).href
    }

    async function apiGet(route, signal) {
      const response = await fetch(apiUrl(route), { credentials: 'include', signal })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
      return body
    }

    async function apiPost(route, payload) {
      const response = await fetch(apiUrl(route), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
      return body
    }

    /** The authenticated Desktop browser bridge (dsh-app://app only). */
    function desktopBridge() {
      const d = globalThis.dshDesktop
      if (d === undefined || d.protocolVersion !== 1) return undefined
      const b = d.browser
      if (b === undefined || typeof b.acquire !== 'function' || typeof b.release !== 'function') return undefined
      return b
    }

    /**
     * Guest frame for the ws-scrcpy console.
     *
     * On Desktop (<webview> guest), navigation is handled by the shell's own
     * browser bridge, so the page loads as an independent guest and is NOT
     * subject to the host document's iframe X-Frame-Options/CSP framing rules.
     * On the Web carrier, fall back to a plain cross-origin iframe.
     */
    function GuestFrame({ url, onLoaded, onError }) {
      const hostRef = React.useRef(null)
      const bridge = desktopBridge()

      React.useEffect(() => {
        const host = hostRef.current
        if (host === null || host === undefined) return undefined
        let cancelled = false
        const element = document.createElement(bridge ? 'webview' : 'iframe')
        element.className = 'wsc-frame'
        let lease

        if (bridge) {
          element.setAttribute('allowpopups', '')
          // dom-ready fires for EVERY document, including the target page. Only
          // the lease bootstrap document may trigger the first load; calling
          // loadURL again here creates an infinite reload loop (white screen).
          let bootstrapped = false
          element.addEventListener('dom-ready', () => {
            if (cancelled || bootstrapped) return
            const current = element.getURL()
            if (typeof current === 'string' && !current.startsWith('about:blank#')) return
            bootstrapped = true
            try { element.loadURL(url) } catch (cause) { onError(cause instanceof Error ? cause.message : String(cause)) }
          })
          element.addEventListener('did-stop-loading', () => { if (!cancelled) onLoaded() })
          element.addEventListener('did-fail-load', (event) => {
            if (cancelled || event?.isMainFrame === false || event?.errorCode === -3) return
            onError(`load error ${event?.errorCode ?? '?'}: ${event?.errorDescription ?? ''}`)
          })
          const start = async () => {
            let reservation
            try {
              reservation = await bridge.acquire(`wsc:${url}`)
            } catch (cause) {
              if (!cancelled) onError(cause instanceof Error ? cause.message : String(cause))
              return
            }
            if (cancelled || reservation === undefined || reservation === null) {
              if (reservation?.lease !== undefined) void bridge.release(reservation.lease)
              return
            }
            lease = reservation.lease
            element.setAttribute('name', reservation.lease)
            element.setAttribute('partition', reservation.partition)
            element.setAttribute('src', `about:blank#${reservation.lease}`)
            host.appendChild(element)
          }
          void start()
          return () => {
            cancelled = true
            element.remove()
            if (lease !== undefined) void bridge.release(lease)
          }
        }

        element.setAttribute('src', url)
        element.addEventListener('load', () => { if (!cancelled) onLoaded() })
        element.addEventListener('error', () => { if (!cancelled) onError('iframe load failed') })
        host.appendChild(element)
        return () => { cancelled = true; element.remove() }
      }, [url])

      return h('div', { className: 'wsc-frame-wrap', ref: hostRef })
    }

    const DEFAULT_BASE = 'http://localhost:6902'

    function IconBtn({ label, onClick, children, active }) {
      return h('button', {
        type: 'button', className: 'wsc-ib', title: label, 'aria-label': label,
        onClick, style: active ? { color: 'var(--dsw-alias-brand-primary)' } : undefined,
      }, children)
    }

    function MoreIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': true },
        h('circle', { cx: 8, cy: 3, r: 1.3 }), h('circle', { cx: 8, cy: 8, r: 1.3 }), h('circle', { cx: 8, cy: 13, r: 1.3 }))
    }
    function HomeIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
        h('path', { d: 'M2.5 7.2 8 2.5l5.5 4.7' }), h('path', { d: 'M4 6.6V13h8V6.6' }))
    }
    function ReloadIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': true },
        h('path', { d: 'M13 8a5 5 0 1 1-1.5-3.5' }), h('path', { d: 'M13 2v3h-3' }))
    }

    function createPanel(ctx, t) {
      return function WsScrcpyWebPanel() {
        const [config, setConfig] = useState(null)
        const [frameUrl, setFrameUrl] = useState(`${DEFAULT_BASE}/`)
        const [frameKey, setFrameKey] = useState(0)
        const [frameError, setFrameError] = useState('')
        const [menuOpen, setMenuOpen] = useState(false)
        const [baseInput, setBaseInput] = useState(DEFAULT_BASE)
        const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error
        const [saveMsg, setSaveMsg] = useState('')
        // checking | online | offline — decides whether the guest mounts at all.
        const [serviceState, setServiceState] = useState('checking')
        const [offlineDetail, setOfflineDetail] = useState('')
        const unmounted = useRef(false)

        useEffect(() => {
          unmounted.current = false
          return () => { unmounted.current = true }
        }, [])

        /** Probe the service; mounts the console only when it answers. */
        const probeService = useCallback(async (base) => {
          setServiceState('checking')
          setOfflineDetail('')
          try {
            const status = await apiGet('status')
            if (unmounted.current) return
            if (status?.online === true) {
              setServiceState('online')
              setFrameUrl(`${base}/`)
              setFrameKey((value) => value + 1)
            } else {
              setServiceState('offline')
              setOfflineDetail(String(status?.detail ?? ''))
            }
          } catch (error) {
            if (unmounted.current) return
            setServiceState('offline')
            setOfflineDetail(error instanceof Error ? error.message : String(error))
          }
        }, [])

        useEffect(() => {
          apiGet('config').then((next) => {
            if (unmounted.current) return
            const base = String(next?.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '')
            setConfig(next)
            setBaseInput(base)
            void probeService(base)
          }).catch((error) => {
            if (unmounted.current) return
            setServiceState('offline')
            setOfflineDetail(error instanceof Error ? error.message : String(error))
          })
        }, [probeService])

        const base = String(config?.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '')

        const goHome = useCallback(() => {
          setFrameError('')
          if (serviceState === 'online') {
            setFrameUrl(`${base}/`)
            setFrameKey((value) => value + 1)
          } else {
            void probeService(base)
          }
        }, [base, serviceState, probeService])

        const reload = useCallback(() => {
          setFrameError('')
          if (serviceState === 'online') {
            setFrameKey((value) => value + 1)
          } else {
            void probeService(base)
          }
        }, [base, serviceState, probeService])

        const saveBaseUrl = useCallback(async () => {
          const raw = baseInput.trim()
          if (raw === '') { setSaveState('error'); setSaveMsg(t('addressRequired')); return }
          setSaveState('saving')
          setSaveMsg('')
          try {
            const result = await apiPost('config', { baseUrl: raw })
            if (unmounted.current) return
            const nextBase = String(result?.baseUrl ?? raw).replace(/\/+$/, '')
            setConfig({ ...(config ?? {}), baseUrl: nextBase })
            setBaseInput(nextBase)
            // Re-probe the new address rather than assuming it is reachable.
            void probeService(nextBase)
            if (result?.ok === true) {
              setSaveState('saved')
              setSaveMsg(result?.note ?? t('saved'))
            } else {
              setSaveState('error')
              setSaveMsg(result?.error ?? t('saveFailed'))
            }
          } catch (error) {
            if (unmounted.current) return
            setSaveState('error')
            setSaveMsg(error instanceof Error ? error.message : String(error))
          }
        }, [baseInput, config, probeService, t])

        const saveColor = saveState === 'error' ? 'var(--dsw-alias-state-error-primary)'
          : saveState === 'saved' ? 'var(--dsw-alias-state-success-primary)'
          : 'var(--dsw-alias-label-secondary)'

        return h('div', { className: 'wsc-root' }, [
          h('header', { key: 'head', className: 'wsc-head' }, [
            h('span', { key: 'icon', className: 'wsc-headicon' }, h('img', { src: iconUrl(), alt: '' })),
            h('span', { key: 'title', className: 'wsc-title' }, t('panelTitle')),
            h('span', { key: 'spacer', className: 'wsc-spacer' }),
            h(IconBtn, { key: 'home', label: t('goHome'), onClick: goHome }, h(HomeIcon)),
            h(IconBtn, { key: 'reload', label: t('refresh'), onClick: reload }, h(ReloadIcon)),
            h(IconBtn, { key: 'more', label: t('more'), onClick: () => setMenuOpen((v) => !v), active: menuOpen }, h(MoreIcon)),
            menuOpen
              ? h('div', { key: 'menu', className: 'wsc-menu', onClick: (e) => e.stopPropagation() }, [
                h('h4', { key: 'mh' }, t('serviceTitle')),
                h('div', { key: 'row', className: 'wsc-row' }, [
                  h('input', {
                    key: 'input', className: 'wsc-input', value: baseInput, spellCheck: false,
                    placeholder: 'http://localhost:6902', 'aria-label': t('serviceTitle'),
                    onChange: (event) => { setBaseInput(event.target.value); setSaveState('idle'); setSaveMsg('') },
                    onKeyDown: (event) => { if (event.key === 'Enter') void saveBaseUrl() },
                  }),
                  h('button', {
                    key: 'save', type: 'button', className: 'wsc-btn wsc-primary',
                    disabled: saveState === 'saving',
                    onClick: () => void saveBaseUrl(),
                  }, saveState === 'saving' ? t('saving') : t('save')),
                ]),
                saveMsg ? h('div', { key: 'msg', className: 'wsc-hint', style: { color: saveColor } }, saveMsg) : null,
              ])
              : null,
          ]),
          h('div', { key: 'body', className: 'wsc-body' }, [
            serviceState === 'online'
              ? h(React.Fragment, { key: 'online' }, [
                h(GuestFrame, {
                  key: `frame-${frameKey}`,
                  url: frameUrl,
                  onLoaded: () => setFrameError(''),
                  onError: (message) => setFrameError(typeof message === 'string' ? message : t('loadFailed')),
                }),
                frameError ? h('div', { key: 'frameErr', className: 'wsc-err', role: 'alert' },
                  `${frameError} `,
                  h('button', { type: 'button', className: 'wsc-ib', onClick: reload }, t('retry'))) : null,
              ])
              : h('div', { key: 'empty', className: 'wsc-empty' },
                h('section', { className: 'wsc-empty-card', role: 'status', 'aria-live': 'polite' }, [
                  h('span', { key: 'icon', className: 'wsc-empty-icon' },
                    h('img', { src: iconUrl(), alt: '' })),
                  h('div', { key: 'title', className: 'wsc-empty-title' },
                    serviceState === 'checking' ? t('checking') : t('offlineTitle')),
                  serviceState === 'offline'
                    ? h('div', { key: 'detail', className: 'wsc-empty-detail' }, t('offlineDetail'))
                    : null,
                  serviceState === 'offline' && offlineDetail
                    ? h('div', { key: 'reason', className: 'wsc-empty-foot' }, offlineDetail)
                    : null,
                  h('div', { key: 'address', className: 'wsc-empty-addr' }, [
                    h('i', { key: 'dot', className: `wsc-dot ${serviceState === 'offline' ? 'off' : ''}` }),
                    h('span', { key: 'label' }, `${t('offlineAddress')}:`),
                    h('b', { key: 'value' }, base),
                  ]),
                  serviceState === 'offline'
                    ? h('div', { key: 'actions', className: 'wsc-empty-actions' }, [
                      h('button', {
                        key: 'settings', type: 'button', className: 'wsc-btn wsc-primary',
                        onClick: () => setMenuOpen(true),
                      }, t('openSettings')),
                      h('button', {
                        key: 'retry', type: 'button', className: 'wsc-btn',
                        onClick: () => { void probeService(base) },
                      }, t('recheck')),
                    ])
                    : null,
                  serviceState === 'offline'
                    ? h('div', { key: 'foot', className: 'wsc-empty-foot' }, t('deviceHint'))
                    : null,
                ])),
          ]),
        ])
      }
    }

    function createSidebarIcon(t) {
      return function SidebarIcon(props) {
        const size = props?.size ?? 20
        return h('img', {
          src: iconUrl(), alt: '', width: size, height: size,
          style: { display: 'block', objectFit: 'contain' },
        })
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const t0 = currentCopy(ctx)
        const t = (key) => t0[key] ?? key
        const disposeStyles = styles(ctx)

        const disposeSidebar = ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 64,
          label: () => t('sidebarLabel'),
        }, createSidebarIcon(t))), 'dsh-ws-scrcpy-web: sidebar entry')

        const disposeMain = ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, createPanel(ctx, t))), 'dsh-ws-scrcpy-web: main panel')

        return () => {
          disposeMain()
          disposeSidebar()
          disposeStyles()
        }
      },
    }
  },
})
