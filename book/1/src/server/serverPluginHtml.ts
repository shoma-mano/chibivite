import type { Plugin } from '.'
import fs from 'node:fs'
import { resolve } from 'node:path'

// HTMLファイル配信プラグイン
export const htmlPlugin: Plugin = {
  name: 'html',
  configureServer({ app, root }) {
    console.log('Configuring HTML plugin')
    app.use('/', (req, res, next) => {
      if (req.url === '/') {
        const indexPath = resolve(root, 'index.html')
        fs.readFile(indexPath, 'utf-8', (err, content) => {
          if (err) {
            res.statusCode = 500
            res.end(`Error loading index.html: ${err.message}`)
            return
          }

          res.statusCode = 200
          res.setHeader('Content-Type', 'text/html')
          res.end(content)
        })
      }
      else {
        next()
      }
    })
  },
}
