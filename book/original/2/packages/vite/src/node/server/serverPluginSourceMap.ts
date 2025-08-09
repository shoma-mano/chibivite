import type { ServerPlugin } from '.'
import merge from 'merge-source-map'

export interface SourceMap {
  version: number | string
  file: string
  sources: string[]
  sourcesContent: string[]
  names: string[]
  mappings: string
}

export function mergeSourceMap(
  oldMap: SourceMap | null | undefined,
  newMap: SourceMap,
): SourceMap {
  if (!oldMap) {
    return newMap
  }
  // merge-source-map will overwrite original sources if newMap also has
  // sourcesContent
  newMap.sourcesContent = []
  return merge(oldMap, newMap) as SourceMap
}

function genSourceMapString(map: SourceMap | string | undefined) {
  if (typeof map !== 'string') {
    map = JSON.stringify(map)
  }
  return `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(
    map,
  ).toString('base64')}`
}

export const sourceMapPlugin: ServerPlugin = ({ app }) => {
  app.use((req: any, res: any, next: any) => {
    console.log(`Handling request for ${req.url}`)
    const originalEnd = res.end
    // res.end = function (chunk: any, encoding?: any, callback?: any) {
    //   if (typeof chunk === 'string' && req.map) {
    //     chunk += genSourceMapString(req.map)
    //   }
    //   return originalEnd.call(res, chunk, encoding, callback)
    // }

    next()
  })
}
