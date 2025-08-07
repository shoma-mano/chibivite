import type { Plugin } from 'rollup'
import type { InternalResolver } from '../resolver'
import debu from 'debug'
import fs from 'fs-extra'
import { resolveVue } from '../utils/resolveVue'

const debug = debu('vite:build:resolve')

export function createBuildResolvePlugin(root: string, resolver: InternalResolver): Plugin {
  return {
    name: 'vite:resolve',
    async resolveId(id, importer) {
      const original = id
      id = resolver.alias(id) || id
      if (id === 'vue' || id.startsWith('@vue/')) {
        const vuePaths = resolveVue(root)
        if (id in vuePaths) {
          return (vuePaths as any)[id]
        }
      }
      if (id.startsWith('/') && !id.startsWith(root)) {
        const resolved = resolver.requestToFile(id)
        if (fs.existsSync(resolved)) {
          debug(id, `-->`, resolved)
          return resolved
        }
      }
      // fallback to node-resolve because alias
      if (id !== original) {
        const resolved = await this.resolve(id, importer, { skipSelf: true })
        return resolved || { id }
      }
    },
  }
}
