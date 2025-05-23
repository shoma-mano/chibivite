import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import fs from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import connect from 'connect'
import serveStatic from 'serve-static'
import { htmlPlugin } from './serverPluginHtml'
import { staticFilePlugin } from './serverPluginStatic'

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
export async function createServer(options: ServerOptions = {}): Server {
  const {
    port = 3002,
    root = __dirname,
  } = options

  const app = connect()

  // サーバーコンテキストを作成
  const serverContext: ServerContext = {
    app,
    root,
    data: {},
  }

  // プラグインを適用
  const plugins: Plugin[] = [
    htmlPlugin,
    staticFilePlugin,
  ]
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

  // プラグインを適用
  await applyPlugins()

  // 最後に404ハンドラーを追加
  app.use(notFoundHandler)

  return startServer() as unknown as Server
}
