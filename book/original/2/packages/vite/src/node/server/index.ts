import type { Buffer } from 'node:buffer'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Connect } from '../../../types/connect'
import type { ServerConfig } from '../config'
import type { InternalResolver } from '../resolver'
import type { HMRWatcher } from './serverPluginHmr'
import type { SourceMap } from './serverPluginSourceMap'
import http from 'node:http'
import process from 'node:process'
import chokidar from 'chokidar'
import connect from 'connect'
import * as optimizer from '../optimizer'
import { createResolver } from '../resolver'
import { createServerTransformPlugin } from '../transform'
import { cachedRead } from '../utils'
import { assetPathPlugin } from './serverPluginAssets'
import { cssPlugin } from './serverPluginCss'
import { envPlugin } from './serverPluginEnv'
import { esbuildPlugin } from './serverPluginEsbuild'
import { hmrPlugin } from './serverPluginHmr'
import { htmlRewritePlugin } from './serverPluginHtml'
import { jsonPlugin } from './serverPluginJson'
import { moduleResolvePlugin } from './serverPluginModuleResolve'
import { moduleRewritePlugin } from './serverPluginModuleRewrite'
import { proxyPlugin } from './serverPluginProxy'
import { serveStaticPlugin } from './serverPluginServeStatic'
import { serviceWorkerPlugin } from './serverPluginServiceWorker'
import { sourceMapPlugin } from './serverPluginSourceMap'
import { vuePlugin } from './serverPluginVue'
import { wasmPlugin } from './serverPluginWasm'
import { webWorkerPlugin } from './serverPluginWebWorker'

export { rewriteImports } from './serverPluginModuleRewrite'

export type ServerPlugin = (ctx: ServerPluginContext) => void

export interface ServerPluginContext {
  root: string
  app: Connect.Server
  server: Server
  watcher: HMRWatcher
  resolver: InternalResolver
  config: ServerConfig & { __path?: string }
}

export interface Context {
  root: string
  server: Server
  watcher: HMRWatcher
  resolver: InternalResolver
  config: ServerConfig & { __path?: string }
  read: (filePath: string) => Promise<Buffer | string>
  map?: SourceMap | null
  body?: any
  status?: number
  url?: string
  path?: string
  query?: any
  headers?: any
  fresh?: boolean
  method?: string
  req?: IncomingMessage
  res?: ServerResponse
}

export interface Response extends ServerResponse {
  statusCode: number
}

export function createServer(config: ServerConfig): Server {
  const {
    root = process.cwd(),
    configureServer = [],
    resolvers = [],
    alias = {},
    transforms = [],
    vueCustomBlockTransforms = {},
    optimizeDeps = {},
  } = config

  const app = connect()
  const server = http.createServer(app)
  const watcher = chokidar.watch(root, {
    ignored: [/\bnode_modules\b/, /\b\.git\b/],
  }) as HMRWatcher
  const resolver = createResolver(root, resolvers, alias)

  const context: ServerPluginContext = {
    root,
    app,
    server,
    watcher,
    resolver,
    config,
  }

  // attach server context to request
  app.use((req: any, res: any, next: any) => {
    console.log(`Request URL: ${req.url}`)
    Object.assign(req, context)
    req.path = req.url?.split('?')[0]
    req.query = new URLSearchParams(req.url?.split('?')[1] || '')
    res.statusCode = 200
    next()
  })

  const resolvedPlugins = [
    // early middleware
    envPlugin,
    moduleResolvePlugin,
    proxyPlugin,
    serviceWorkerPlugin,
    hmrPlugin,
    // HTML should be handled before static files
    // user plugins
    ...(Array.isArray(configureServer) ? configureServer : [configureServer]),
    ...(transforms.length || Object.keys(vueCustomBlockTransforms).length
      ? [createServerTransformPlugin(transforms, vueCustomBlockTransforms)]
      : []),
    vuePlugin,
    cssPlugin,
    esbuildPlugin,
    jsonPlugin,
    assetPathPlugin,
    webWorkerPlugin,
    wasmPlugin,
    // static files should come after HTML processing
    serveStaticPlugin,
    htmlRewritePlugin,

    // rewrite and source map plugins take highest priority and should be run
    // after all other middlewares have finished
    sourceMapPlugin,
    moduleRewritePlugin,
  ]
  resolvedPlugins.forEach(m => m(context))

  const listen = server.listen.bind(server)
  server.listen = (async (...args: any[]) => {
    if (optimizeDeps.auto !== false) {
      await optimizer.optimizeDeps(config)
    }
    return listen(...args)
  }) as any

  return server
}
