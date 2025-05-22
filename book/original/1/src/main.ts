import type { Server } from 'node:http'
import fs from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import connect from 'connect'
import serveStatic from 'serve-static'

// ESM の __dirname 相当の実装
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface ServerOptions {
  port?: number
  root?: string
}

/**
 * Mini Viteサーバーを作成する
 */
function createServer(options: ServerOptions = {}): Server {
  const {
    port = 3002,
    root = __dirname,
  } = options

  const app = connect()

  // 静的ファイルの提供
  app.use(serveStatic(resolve(root)))

  // ルートパスへのリクエストを index.html にリダイレクト
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

  // 404ハンドラー
  app.use((req, res) => {
    res.statusCode = 404
    res.end(`Not found: ${req.url}`)
  })

  return app.listen(port, () => {
    console.log(`Mini Vite server running at http://localhost:${port}`)
    console.log(`Serving files from: ${root}`)
  })
}

/**
 * アプリケーションのエントリーポイント
 */
async function main() {
  // サーバーを起動
  createServer({
    port: 3002,
    root: __dirname,
  })
}

// アプリケーションを実行
main().catch((err) => {
  console.error('Error starting server:', err)
  process.exit(1)
})
