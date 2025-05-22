import type { Plugin } from 'rollup'
import type { InternalResolver } from '../resolver'
import path from 'node:path'
import { init, parse } from 'es-module-lexer'
import MagicString from 'magic-string'
import { isStaticAsset } from '../utils'
import { isCSSRequest } from '../utils/cssUtils'

const isAsset = (id: string) => isCSSRequest(id) || isStaticAsset(id)

export const depAssetExternalPlugin: Plugin = {
  name: 'vite:optimize-dep-assets-external',
  resolveId(id) {
    if (isAsset(id)) {
      return {
        id,
        external: true,
      }
    }
  },
}

export function createDepAssetPlugin(resolver: InternalResolver): Plugin {
  return {
    name: 'vite:optimize-dep-assets',
    async transform(code, id) {
      if (id.endsWith('.js')) {
        await init
        const [imports] = parse(code)
        if (imports.length) {
          let s: MagicString | undefined
          for (let i = 0; i < imports.length; i++) {
            const { s: start, e: end, d: dynamicIndex } = imports[i]
            if (dynamicIndex === -1) {
              const importee = code.slice(start, end)
              if (isAsset(importee)) {
                // replace css/asset imports to deep imports to their original
                // location
                s = s || new MagicString(code)
                const deepPath = resolver.fileToRequest(
                  path.resolve(path.dirname(id), importee),
                )
                s.overwrite(start, end, deepPath)
              }
            }
            else {
              // ignore dynamic import
            }
          }
          if (s) {
            return s.toString()
          }
        }
      }
      return null
    },
  }
}
