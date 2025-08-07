import type { ServerPlugin } from '.'
import fs from 'node:fs'
import path from 'node:path'
import chalk from 'chalk'
// @ts-ignore
import debug from 'debug'
// @ts-ignore
import koaEtag from 'koa-etag'
import send from 'koa-send'
// @ts-ignore
import koaStatic from 'koa-static'
import { isStaticAsset } from '../utils'

const debugLog = debug('vite:history')

export const seenUrls = new Set()

export const serveStaticPlugin: ServerPlugin = ({
  root,
  app,
  resolver,
  config,
}) => {
  app.use(async (ctx, next) => {
    // short circuit requests that have already been explicitly handled
    if (ctx.body || ctx.status !== 404) {
      return
    }

    // warn non-root references to assets under /public/
    if (ctx.path.startsWith('/public/') && isStaticAsset(ctx.path)) {
      console.error(
        chalk.yellow(
          `[vite] files in the public directory are served at the root path.\n`
          + `  ${chalk.blue(ctx.path)} should be changed to ${chalk.blue(
            ctx.path.replace(/^\/public\//, '/'),
          )}.`,
        ),
      )
    }

    // handle possible user request -> file aliases
    const expectsHtml
      = ctx.headers.accept && ctx.headers.accept.includes('text/html')
    if (!expectsHtml) {
      const filePath = resolver.requestToFile(ctx.path)
      if (
        filePath !== ctx.path
        && fs.existsSync(filePath)
        && fs.statSync(filePath).isFile()
      ) {
        await ctx.read(filePath)
      }
    }
    return next()
  })

  if (!config.serviceWorker) {
    app.use(async (ctx, next) => {
      await next()
      // the first request to the server should never 304
      if (seenUrls.has(ctx.url) && ctx.fresh) {
        ctx.status = 304
      }
      seenUrls.add(ctx.url)
    })
  }
  app.use(koaEtag())
  app.use(koaStatic(root))
  app.use(koaStatic(path.join(root, 'public')))

  // history API fallback
  app.use(async (ctx, next) => {
    if (ctx.status !== 404) {
      return next()
    }

    if (ctx.method !== 'GET') {
      debugLog(`not redirecting ${ctx.url} (not GET)`)
      return next()
    }

    const accept = ctx.headers && ctx.headers.accept
    if (typeof accept !== 'string') {
      debugLog(`not redirecting ${ctx.url} (no headers.accept)`)
      return next()
    }

    if (accept.includes('application/json')) {
      debugLog(`not redirecting ${ctx.url} (json)`)
      return next()
    }

    if (!accept.includes('text/html')) {
      debugLog(`not redirecting ${ctx.url} (not accepting html)`)
      return next()
    }

    debugLog(`redirecting ${ctx.url} to /index.html`)
    try {
      await send(ctx, `index.html`, { root })
    }
    catch (e) {
      ctx.url = '/index.html'
      ctx.status = 404
      return next()
    }
  })
}
