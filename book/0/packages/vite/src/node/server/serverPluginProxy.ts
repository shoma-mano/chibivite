import { ServerPlugin } from '.'
import { URL } from 'url'
// @ts-ignore
import debug from 'debug'
// @ts-ignore
import proxy from 'koa-proxies'

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
    opts.logs = (ctx, target) => {
      debugLog(
        `${ctx.req.method} ${(ctx.req as any).oldPath} proxy to -> ${new URL(
          ctx.req.url!,
          target
        )}`
      )
    }
    app.use(proxy(path, opts))
  })
}
