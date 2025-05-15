import type { DefaultContext, DefaultState } from 'koa'
import type { RequestListener, Server } from 'node:http'
import type { ServerOptions } from 'node:https'
import type { ServerConfig } from '../config'
import type { InternalResolver } from '../resolver'
import type { HMRWatcher } from './serverPluginHmr'
import type { SourceMap } from './serverPluginSourceMap'
import http from 'node:http2'
import path from 'node:path'
import chokidar from 'chokidar'
import fs from 'fs-extra'
import Koa from 'koa'
import * as optimizer from '../optimizer'
import { createResolver } from '../resolver'
import { createServerTransformPlugin } from '../transform'
import { cachedRead } from '../utils'
import { createCertificate } from '../utils/createCertificate'
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
  app: Koa<State, Context>
  server: Server
  watcher: HMRWatcher
  resolver: InternalResolver
  config: ServerConfig & { __path?: string }
}

export interface State extends DefaultState {}

export type Context = DefaultContext &
  ServerPluginContext & {
    read: (filePath: string) => Promise<Buffer | string>
    map?: SourceMap | null
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

  const app = new Koa<State, Context>()
  const server = resolveServer(config, app.callback())
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

  // attach server context to koa context
  app.use((ctx, next) => {
    Object.assign(ctx, context)
    ctx.read = cachedRead.bind(null, ctx)
    return next()
  })

  const resolvedPlugins = [
    // rewrite and source map plugins take highest priority and should be run
    // after all other middlewares have finished
    sourceMapPlugin,
    moduleRewritePlugin,
    htmlRewritePlugin,
    // user plugins
    ...(Array.isArray(configureServer) ? configureServer : [configureServer]),
    envPlugin,
    moduleResolvePlugin,
    proxyPlugin,
    serviceWorkerPlugin,
    hmrPlugin,
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
    serveStaticPlugin,
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

function resolveServer(
  { https = false, httpsOptions = {} }: ServerConfig,
  requestListener: RequestListener,
) {
  if (https) {
    return http.createSecureServer(
      {
        ...resolveHttpsConfig(httpsOptions),
        allowHTTP1: true,
      },
      requestListener,
    )
  }
  else {
    return http.createServer(requestListener)
  }
}

function resolveHttpsConfig(httpsOption: ServerOptions) {
  const { ca, cert, key, pfx } = httpsOption
  Object.assign(httpsOption, {
    ca: readFileIfExists(ca),
    cert: readFileIfExists(cert),
    key: readFileIfExists(key),
    pfx: readFileIfExists(pfx),
  })
  if (!httpsOption.key || !httpsOption.cert) {
    httpsOption.cert = httpsOption.key = createCertificate()
  }
  return httpsOption
}

function readFileIfExists(value?: string | Buffer | any) {
  if (value && !Buffer.isBuffer(value)) {
    try {
      return fs.readFileSync(path.resolve(value as string))
    }
    catch (e) {
      return value
    }
  }
  return value
}
