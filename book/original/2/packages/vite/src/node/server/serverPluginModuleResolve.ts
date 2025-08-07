import type { ServerPlugin } from '.'
import path from 'node:path'
import { URL } from 'node:url'
import chalk from 'chalk'
import debu from 'debug'
import fs from 'fs-extra'
import { resolveNodeModuleFile, resolveOptimizedModule } from '../resolver'
import { resolveVue } from '../utils'

const debug = debu('vite:resolve')

export const moduleIdToFileMap = new Map()
export const moduleFileToIdMap = new Map()

export const moduleRE = /^\/@modules\//

function getDebugPath(root: string, p: string) {
  const relative = path.relative(root, p)
  return relative.startsWith('..') ? p : relative
}

// plugin for resolving /@modules/:id requests.
export const moduleResolvePlugin: ServerPlugin = ({ root, app, resolver }) => {
  const vueResolved = resolveVue(root)

  app.use((req: any, res: any, next: any) => {
    (async () => {
      const path = req.url?.split('?')[0] || ''
      if (!moduleRE.test(path)) {
        console.log('moduleResolvePlugin: not a module request', path)
        return next()
      }

      // path maybe contain encode chars
      const id = decodeURIComponent(path.replace(moduleRE, ''))
      res.setHeader('Content-Type', 'application/javascript')

      const serve = async (id: string, file: string, type: string) => {
        moduleIdToFileMap.set(id, file)
        moduleFileToIdMap.set(file, path)
        debug(`(${type}) ${id} -> ${getDebugPath(root, file)}`)

        try {
          const content = await fs.readFile(file)
          res.end(content)
        }
        catch (error) {
          res.statusCode = 404
          res.end(`File not found: ${file}`)
        }
      }

      // special handling for vue runtime in case it's not installed
      if (!vueResolved.isLocal && id in vueResolved) {
        return serve(id, (vueResolved as any)[id], 'non-local vue')
      }

      // already resolved and cached
      const cachedPath = moduleIdToFileMap.get(id)
      if (cachedPath) {
        return serve(id, cachedPath, 'cached')
      }

      // resolve from vite optimized modules
      const optimized = resolveOptimizedModule(root, id)
      if (optimized) {
        return serve(id, optimized, 'optimized')
      }

      const referer = req.headers.referer
      let importer: string | undefined
      // this is a map file request from browser dev tool
      const isMapFile = path.endsWith('.map')
      if (referer) {
        importer = new URL(referer).pathname
      }
      else if (isMapFile) {
      // for some reason Chrome doesn't provide referer for source map requests.
      // do our best to reverse-infer the importer.
        importer = path.replace(/\.map$/, '')
      }

      const importerFilePath = importer ? resolver.requestToFile(importer) : root
      const nodeModulePath = resolveNodeModuleFile(importerFilePath, id)
      if (nodeModulePath) {
        return serve(id, nodeModulePath, 'node_modules')
      }

      if (isMapFile && importer) {
      // the resolveNodeModuleFile doesn't work with linked pkg
      // our last try: infer from the dir of importer
        const inferMapPath = path.join(
          path.dirname(importerFilePath),
          path.basename(path),
        )
        if (fs.existsSync(inferMapPath)) {
          return serve(id, inferMapPath, 'map file in linked pkg')
        }
      }

      console.error(
        chalk.red(
          `[vite] Failed to resolve module import "${id}". `
          + `(imported by ${importer || 'unknown'})`,
        ),
      )
      res.statusCode = 404
      res.end(`Module not found: ${id}`)
    })().catch(next)
  })
}
