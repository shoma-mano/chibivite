import type { ServerPlugin } from '.'
import {
  resolveJsxOptions,
  tjsxRE,
  transform,
  vueJsxFilePath,
  vueJsxPublicPath,
} from '../esbuildService'
import { readBody } from '../utils'

export const esbuildPlugin: ServerPlugin = ({ app, config }) => {
  const jsxConfig = resolveJsxOptions(config.jsx)

  app.use((req: any, res: any, next: any) => {
    console.log('esbuildPlugin: processing request', req.url)
    const url = req.url || ''
    const path = url.split('?')[0]

    // intercept and return vue jsx helper import
    if (path === vueJsxPublicPath) {
      res.setHeader('Content-Type', 'application/javascript')
      const fs = require('node:fs')
      const content = fs.readFileSync(vueJsxFilePath, 'utf-8')
      res.end(content)
      return
    }

    const originalEnd = res.end
    res.end = async function (chunk: any, encoding?: any, callback?: any) {
      if (req.body && tjsxRE.test(path)) {
        res.setHeader('Content-Type', 'application/javascript')
        const src = await readBody(req.body)
        const { code, map } = await transform(
          src!,
          url,
          jsxConfig,
          config.jsx,
        )
        if (map) {
          req.map = JSON.parse(map)
        }
        return originalEnd.call(res, code, encoding, callback)
      }

      return originalEnd.call(res, chunk, encoding, callback)
    }

    next()
  })
}
