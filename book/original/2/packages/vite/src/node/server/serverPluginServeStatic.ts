import type { ServerPlugin } from '.'
import fs from 'node:fs'
import path from 'node:path'
import chalk from 'chalk'
// @ts-ignore
import debug from 'debug'
// @ts-ignore
import etag from 'etag'
// @ts-ignore
import sirv from 'sirv'
import { isStaticAsset } from '../utils'

const debugLog = debug('vite:history')

export const seenUrls = new Set()

export const serveStaticPlugin: ServerPlugin = ({
  root,
  app,
  resolver,
  config,
}) => {
  app.use((req, _res, next) => {
    console.log('serveStaticPlugin: processing request', req.url)
    // short circuit requests that have already been explicitly handled
    // if (req.body || res.statusCode !== 404) {
    //   console.log('serveStaticPlugin: already handled', req.url, req.body)
    //   return res.end()
    // }

    const pathname = req.path || req.url?.split('?')[0] || ''

    // warn non-root references to assets under /public/
    if (pathname.startsWith('/public/') && isStaticAsset(pathname)) {
      console.error(
        chalk.yellow(
          `[vite] files in the public directory are served at the root path.\n`
          + `  ${chalk.blue(pathname)} should be changed to ${chalk.blue(
            pathname.replace(/^\/public\//, '/'),
          )}.`,
        ),
      )
    }

    // handle possible user request -> file aliases
    const expectsHtml
      = req.headers.accept && req.headers.accept.includes('text/html')
    if (!expectsHtml) {
      console.log('serveStaticPlugin: not expecting HTML', pathname)
      const filePath = resolver.requestToFile(pathname)
      if (
        filePath !== pathname
        && fs.existsSync(filePath)
        && fs.statSync(filePath).isFile()
      ) {
        req.read(filePath).then((content: any) => {
          req.body = content
          next()
        })
        return
      }
    }
    next()
  })

  if (!config.serviceWorker) {
    app.use((req: any, res: any, next: any) => {
      const originalEnd = res.end
      res.end = function (...args: any[]) {
        // the first request to the server should never 304
        if (seenUrls.has(req.url)) {
          const etagValue = etag(args[0] || '')
          res.setHeader('ETag', etagValue)
          if (req.headers['if-none-match'] === etagValue) {
            res.statusCode = 304
            return originalEnd.call(res)
          }
        }
        seenUrls.add(req.url)
        return originalEnd.apply(res, args)
      }
      next()
    })
  }

  // Serve static files
  const serveStatic = sirv(root, { dev: true, etag: true, extensions: [] })
  const servePublic = sirv(path.join(root, 'public'), { dev: true, etag: true, extensions: [] })

  app.use((req: any, res: any, next: any) => {
    serveStatic(req, res, () => {
      servePublic(req, res, next)
    })
  })

  // history API fallback
  app.use((req: any, res: any, next: any) => {
    if (req.method !== 'GET') {
      debugLog(`not redirecting ${req.url} (not GET)`)
      return next()
    }

    const accept = req.headers && req.headers.accept
    if (typeof accept !== 'string') {
      debugLog(`not redirecting ${req.url} (no headers.accept)`)
      return next()
    }

    if (accept.includes('application/json')) {
      debugLog(`not redirecting ${req.url} (json)`)
      return next()
    }

    if (!accept.includes('text/html')) {
      debugLog(`not redirecting ${req.url} (not accepting html)`)
      return next()
    }

    debugLog(`redirecting ${req.url} to /index.html`)
    // Set the URL to /index.html and continue to the next middleware
    // The HTML plugin will handle the transformation
    req.url = '/index.html'
    req.path = '/index.html'
    next()
  })
}
