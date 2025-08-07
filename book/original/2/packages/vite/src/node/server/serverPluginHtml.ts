import type { ServerPlugin } from './index'
import fs from 'node:fs'
import path from 'node:path'
import chalk from 'chalk'
import debu from 'debug'
import { init as initLexer } from 'es-module-lexer'
import LRUCache from 'lru-cache'
import slash from 'slash'
import { cleanUrl, injectScriptToHtml, readBody } from '../utils'
import { rewriteImports } from './index'

import {
  debugHmr,
  ensureMapEntry,
  hmrClientPublicPath,
  importerMap,
} from './serverPluginHmr'

const debug = debu('vite:rewrite')

const rewriteHtmlPluginCache = new LRUCache({ max: 20 })

export const htmlRewritePlugin: ServerPlugin = ({
  root,
  app,
  watcher,
  resolver,
  config,
}) => {
  const devInjectionCode
    = `\n<script type="module">\n`
    // import hmr client first to establish connection
      + `import "${hmrClientPublicPath}"\n`
    // inject process.env.NODE_ENV
    // since some ESM builds expect these to be replaced by the bundler
      + `window.process = { env: { NODE_ENV: ${JSON.stringify(
        config.mode || 'development',
      )} }}\n`
      + `</script>\n`

  const scriptRE = /(<script\b[^>]*>)([\s\S]*?)<\/script>/g
  const srcRE = /\bsrc=(?:"([^"]+)"|'([^']+)'|([^'"\s]+)\b)/

  async function rewriteHtml(importer: string, html: string) {
    await initLexer
    html = html!.replace(scriptRE, (matched, openTag, script) => {
      if (script) {
        return `${openTag}${rewriteImports(
          root,
          script,
          importer,
          resolver,
        )}</script>`
      }
      else {
        const srcAttr = openTag.match(srcRE)
        if (srcAttr) {
          // register script as a import dep for hmr
          const importee = resolver.normalizePublicPath(
            cleanUrl(slash(path.resolve('/', srcAttr[1] || srcAttr[2]))),
          )
          debugHmr(`        ${importer} imports ${importee}`)
          ensureMapEntry(importerMap, importee).add(importer)
        }
        return matched
      }
    })
    return injectScriptToHtml(html, devInjectionCode)
  }

  app.use((req, res, next) => {
    (async () => {
      const url = req.url || ''
      const pathname = url.split('?')[0]

      console.log('htmlRewritePlugin: processing request', url)
      // Handle direct HTML file requests
      if (pathname.endsWith('.html') && req.headers.accept?.includes('text/html')) {
        const htmlPath = path.join(root, pathname)

        if (fs.existsSync(htmlPath)) {
          try {
            const html = fs.readFileSync(htmlPath, 'utf-8')
            const importer = pathname

            if (rewriteHtmlPluginCache.has(html)) {
              debug(`${importer}: serving from cache`)
              const rewritten = rewriteHtmlPluginCache.get(html)
              res.setHeader('Content-Type', 'text/html')
              res.end(rewritten)
              return
            }
            else {
              const rewritten = await rewriteHtml(importer, html)
              rewriteHtmlPluginCache.set(html, rewritten)
              res.setHeader('Content-Type', 'text/html')
              res.end(rewritten)
              return
            }
          }
          catch (error) {
            console.error(`Error processing HTML file ${htmlPath}:`, error)
            return next()
          }
        }
      }

      // Response interception for HTML content from other middlewares
      const originalEnd = res.end
      res.end = async function (chunk: any, encoding?: any, callback?: any) {
        if (res.statusCode === 304) {
          return originalEnd.call(res, chunk, encoding, callback)
        }

        const contentType = res.getHeader('content-type')
        const isHtml = contentType && contentType.toString().includes('html')

        if (isHtml && req.body) {
          const importer = req.url?.split('?')[0] || ''
          const html = await readBody(req.body)
          if (rewriteHtmlPluginCache.has(html)) {
            debug(`${importer}: serving from cache`)
            const rewritten = rewriteHtmlPluginCache.get(html)
            return originalEnd.call(res, rewritten, encoding, callback)
          }
          else {
            if (!html) {
              return originalEnd.call(res, chunk, encoding, callback)
            }
            const rewritten = await rewriteHtml(importer, html)
            rewriteHtmlPluginCache.set(html, rewritten)
            return originalEnd.call(res, rewritten, encoding, callback)
          }
        }

        return originalEnd.call(res, chunk, encoding, callback)
      }

      next()
    })().catch(next)
  })

  watcher.on('change', (file) => {
    const path = resolver.fileToRequest(file)
    if (path.endsWith('.html')) {
      debug(`${path}: cache busted`)
      watcher.send({
        type: 'full-reload',
        path,
        timestamp: Date.now(),
      })
      console.log(`${chalk.green(`[vite] `)} ${path} page reloaded.`)
    }
  })
}
