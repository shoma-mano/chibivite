// resolve-from.ts (ESM形式、type: "module" or .mjs)
import type { ParsedUrlQuery } from 'node:querystring'
import type { Context } from '../server'
import { createRequire } from 'node:module'
import path from 'node:path'
import qs from 'node:querystring'
import slash from 'slash'
import { supportedExts } from '../resolver'

const require = createRequire(import.meta.url)
const resolve = require('resolve')

const isRunningWithYarnPnp = false

export function resolveFrom(root: string, id: string) {
  return resolve.sync(id, {
    basedir: root,
    extensions: supportedExts,
    preserveSymlinks: isRunningWithYarnPnp || false,
  })
}

export const queryRE = /\?.*$/
export const hashRE = /#.*$/

export function cleanUrl(url: string) {
  return url.replace(hashRE, '').replace(queryRE, '')
}

export function parseWithQuery(id: string): {
  path: string
  query: ParsedUrlQuery
} {
  const queryMatch = id.match(queryRE)
  if (queryMatch) {
    return {
      path: slash(cleanUrl(id)),
      query: qs.parse(queryMatch[0].slice(1)),
    }
  }
  return {
    path: id,
    query: {},
  }
}

const externalRE = /^(https?:)?\/\//
export const isExternalUrl = (url: string) => externalRE.test(url)

const imageRE = /\.(png|jpe?g|gif|svg|ico|webp)(\?.*)?$/
const mediaRE = /\.(mp4|webm|ogg|mp3|wav|flac|aac)(\?.*)?$/
const fontsRE = /\.(woff2?|eot|ttf|otf)(\?.*)?$/i

/**
 * Check if a file is a static asset that vite can process.
 */
export function isStaticAsset(file: string) {
  return imageRE.test(file) || mediaRE.test(file) || fontsRE.test(file)
}

/**
 * Check if a request is an import from js instead of a native resource request
 * i.e. differentiate
 * `import('/style.css')`
 * from
 * `<link rel="stylesheet" href="/style.css">`
 *
 * The ?import query is injected by serverPluginModuleRewrite.
 */
export function isImportRequest(ctx: Context): boolean {
  return ctx.query.import != null
}

export function parseNodeModuleId(id: string) {
  const parts = id.split('/')
  let scope = ''
  let name = ''
  let inPkgPath = ''
  if (id.startsWith('@'))
    scope = parts.shift()!
  name = parts.shift()!
  inPkgPath = parts.join('/')
  return {
    scope,
    name,
    inPkgPath,
  }
}
