import type { ServerPlugin } from '.'
// @ts-ignore
import debug from 'debug'
// @ts-ignore
import { createProxyMiddleware } from 'http-proxy-middleware'

export const proxyPlugin: ServerPlugin = ({ app, config }) => {
  if (!config.proxy) {
    return
  }

  const debugLog = debug('vite:proxy')
  const options = config.proxy
  Object.keys(options).forEach((path) => {
    let opts = options[path]
    if (typeof opts === 'string') {
      opts = { target: opts }
    }
    
    const proxyOptions = {
      ...opts,
      logLevel: debugLog.enabled ? 'debug' : 'silent',
      onProxyReq: (_proxyReq: any, req: any) => {
        debugLog(
          `${req.method} ${req.url} proxy to -> ${opts.target}${req.url}`,
        )
      }
    }
    
    app.use(path, (req: any, res: any, next: any) => {
      const middleware = createProxyMiddleware(proxyOptions)
      middleware(req, res, next)
    })
  })
}
