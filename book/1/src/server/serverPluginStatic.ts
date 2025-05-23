import type { Plugin } from '.'
import { resolve } from 'node:path'
import serveStatic from 'serve-static'

// 静的ファイル配信プラグイン
export const staticFilePlugin: Plugin = {
  name: 'static-file',
  configureServer({ app, root }) {
    console.log('Configuring static file plugin')
    app.use(serveStatic(resolve(root)))
  },
}
