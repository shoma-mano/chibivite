import type { Connect } from '../../../types/connect'
import path from 'node:path'
import debug from 'debug'
import sirv from 'sirv'

const debugLog = debug('vite:history')

export const seenUrls = new Set()
const sirvOptions = { dev: true, etag: true, extensions: [] }

export function serveStaticMiddleware(
  dir: string,
): Connect.NextHandleFunction {
  const serve = sirv(dir, sirvOptions)

  return (req, res, next) => {
    const url = req.url!

    // only serve the file if it's not an html request
    // so that html requests can fallthrough to our html middleware for
    // special processing
    if (path.extname(url) === '.html') {
      return next()
    }

    // apply aliases to static requests as well
    // let redirected: string | undefined
    // for (const { find, replacement } of config.resolve.alias) {
    //   const matches
    //     = typeof find === 'string' ? url.startsWith(find) : find.test(url)
    //   if (matches) {
    //     redirected = url.replace(find, replacement)
    //     break
    //   }
    // }
    // if (redirected) {
    //   // dir is pre-normalized to posix style
    //   if (redirected.startsWith(dir)) {
    //     redirected = redirected.slice(dir.length)
    //   }
    //   req.url = redirected
    // }

    serve(req, res, next)
  }
}
