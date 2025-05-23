import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import fs from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import connect from 'connect'
import serveStatic from 'serve-static'

// ESM の __dirname 相当の実装
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// プラグインの型定義
export interface Plugin {
  name: string
  // プラグインの設定を行うハンドラ
  configureServer?: (server: ServerContext) => void | Promise<void>
}

// サーバーのコンテキスト型
export interface ServerContext {
  app: ReturnType<typeof connect>
  root: string
  // プラグインからアクセスできる共有データ
  data: Record<string, any>
}

interface ServerOptions {
  port?: number
  root?: string
  plugins?: Plugin[]
}

/**
 * Mini Viteサーバーを作成する
 */
function createServer(options: ServerOptions = {}): Server {
  const {
    port = 3002,
    root = __dirname,
    plugins = [],
  } = options

  const app = connect()

  // サーバーコンテキストを作成
  const serverContext: ServerContext = {
    app,
    root,
    data: {},
  }

  // プラグインを適用
  const applyPlugins = async () => {
    console.log(`Applying ${plugins.length} plugins...`)
    for (const plugin of plugins) {
      console.log(`Applying plugin: ${plugin.name}`)
      if (plugin.configureServer) {
        await plugin.configureServer(serverContext)
      }
    }
  }

  // 404ハンドラー（常に最後に配置）
  const notFoundHandler = (req: IncomingMessage, res: ServerResponse) => {
    res.statusCode = 404
    res.end(`Not found: ${req.url}`)
  }

  // サーバーの起動
  const startServer = async () => {
    // プラグインを適用
    await applyPlugins()

    // 最後に404ハンドラーを追加
    app.use(notFoundHandler)

    return app.listen(port, () => {
      console.log(`Mini Vite server running at http://localhost:${port}`)
      console.log(`Serving files from: ${root}`)
    })
  }

  return startServer() as unknown as Server
}

// 静的ファイル配信プラグイン
const staticFilePlugin: Plugin = {
  name: 'static-file',
  configureServer({ app, root }) {
    console.log('Configuring static file plugin')
    app.use(serveStatic(resolve(root)))
  },
}

// HTMLファイル配信プラグイン
const htmlPlugin: Plugin = {
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

/**
 * アプリケーションのエントリーポイント
 */
async function main() {
  // サーバーを起動
  createServer({
    port: 3002,
    root: __dirname,
    plugins: [
      staticFilePlugin,
      htmlPlugin,
    ],
  })
}

// アプリケーションを実行
main().catch((err) => {
  console.error('Error starting server:', err)
  process.exit(1)
})
