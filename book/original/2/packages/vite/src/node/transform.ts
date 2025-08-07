import type { Plugin as RollupPlugin } from 'rollup'
import type { ServerPlugin } from './server'
import type { SourceMap } from './server/serverPluginSourceMap'
import { mergeSourceMap } from './server/serverPluginSourceMap'
import { parseWithQuery, readBody } from './utils'

type ParsedQuery = Record<string, string | string[] | undefined>

interface TransformTestContext {
  /**
   * Full specifier of the transformed module, including query parameters
   */
  id: string
  /**
   * Path without query (use this to check for file extensions)
   */
  path: string
  /**
   * Parsed query object
   */
  query: ParsedQuery
  /**
   * Indicates whether this is a request made by js import(), or natively by
   * the browser (e.g. `<img src="...">`).
   */
  isImport: boolean
  isBuild: boolean
}

export interface TransformContext extends TransformTestContext {
  code: string
}

export interface TransformResult {
  code: string
  map?: SourceMap
}

export type TransformFn = (
  ctx: TransformContext
) => string | TransformResult | Promise<string | TransformResult>

export interface Transform {
  test: (ctx: TransformTestContext) => boolean
  transform: TransformFn
}

export type CustomBlockTransform = TransformFn

export function createServerTransformPlugin(
  transforms: Transform[],
  customBlockTransforms: Record<string, CustomBlockTransform>,
): ServerPlugin {
  return ({ app }) => {
    if (!transforms.length && !Object.keys(customBlockTransforms).length) {
      return
    }

    app.use((req: any, res: any, next: any) => {
      const originalEnd = res.end
      res.end = async function(chunk: any, encoding?: any, callback?: any) {
        if (!req.body) {
          return originalEnd.call(res, chunk, encoding, callback)
        }

        const url = req.url || ''
        const path = url.split('?')[0]
        const query = Object.fromEntries(new URLSearchParams(url.split('?')[1] || ''))
        const isImport = new URLSearchParams(url.split('?')[1] || '').has('import')
      const isBuild = false
      let code: string = ''

      for (const t of transforms) {
        const transformContext: TransformTestContext = {
          id: url,
          path,
          query,
          isImport,
          isBuild,
        }
        if (t.test(transformContext)) {
          code = code || (await readBody(req.body))!
          const result = await t.transform({
            ...transformContext,
            code,
          })
          if (typeof result === 'string') {
            code = result
          }
          else {
            code = result.code
            if (result.map) {
              req.map = mergeSourceMap(req.map, result.map)
            }
          }
          res.setHeader('Content-Type', 'application/javascript')
          req.body = code
        }
      }

      // custom blocks
      if (path.endsWith('vue') && query.type === 'custom') {
        const t = customBlockTransforms[query.blockType]
        if (t) {
          res.setHeader('Content-Type', 'application/javascript')
          code = code || (await readBody(req.body))!
          req.body = await t({
            code,
            id: url,
            path,
            query,
            isImport,
            isBuild,
          })
        }
      }
      
      return originalEnd.call(res, req.body || chunk, encoding, callback)
      }
      
      next()
    })
  }
}

export function createBuildJsTransformPlugin(
  transforms: Transform[],
  customBlockTransforms: Record<string, CustomBlockTransform>,
): RollupPlugin {
  return {
    name: 'vite:transforms',
    async transform(code, id) {
      const { path, query } = parseWithQuery(id)
      let transformed: string = code
      let map: SourceMap | null = null

      const runTransform = async (t: TransformFn, ctx: TransformContext) => {
        const result = await t(ctx)
        if (typeof result === 'string') {
          transformed = result
        }
        else {
          transformed = result.code
          if (result.map) {
            map = mergeSourceMap(map, result.map)
          }
        }
      }

      for (const t of transforms) {
        const transformContext: TransformContext = {
          code: transformed,
          id,
          path,
          query,
          isImport: true,
          isBuild: true,
        }
        if (t.test(transformContext)) {
          await runTransform(t.transform, transformContext)
        }
      }

      // custom blocks
      if (query.vue != null && typeof query.type === 'string') {
        const t = customBlockTransforms[query.type]
        if (t) {
          // normalize lang since rollup-plugin-vue appends it as .xxx
          const normalizedQuery: Record<string, string> = {}
          for (const key in query) {
            if (key.startsWith(`lang.`)) {
              normalizedQuery.lang = key.slice(5)
            }
            else {
              normalizedQuery[key] = query[key] as string
            }
          }
          await runTransform(t, {
            code: transformed,
            id,
            path,
            query: normalizedQuery,
            isImport: true,
            isBuild: true,
          })
        }
      }

      return {
        code: transformed,
        map,
      }
    },
  }
}
