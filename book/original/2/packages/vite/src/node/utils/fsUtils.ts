import type { HMRWatcher } from '../server/serverPluginHmr'
import path from 'node:path'
import { Readable } from 'node:stream'
// @ts-ignore
import getETag from 'etag'
import fs from 'fs-extra'
import LRUCache from 'lru-cache'
// @ts-ignore
import mime from 'mime-types'
import { seenUrls } from '../server/serverPluginServeStatic'

interface CacheEntry {
  lastModified: number
  etag: string
  content: Buffer
}

const fsReadCache = new LRUCache<string, CacheEntry>({
  max: 10000,
})

/**
 * Read a file with in-memory cache.
 * Also sets appropriate headers and body on the request/response.
 * This is exposed on middleware context as `req.read` with the `req` already
 * bound, so it can be used as `req.read(file)`.
 */
export async function cachedRead(
  ctx: any,
  file: string,
): Promise<Buffer> {
  const lastModified = fs.statSync(file).mtimeMs
  const cached = fsReadCache.get(file)
  if (ctx && ctx.res) {
    ctx.res.setHeader('Cache-Control', 'no-cache')
    ctx.res.setHeader('Content-Type', mime.lookup(path.extname(file)) || 'application/octet-stream')
  }
  if (cached && cached.lastModified === lastModified) {
    if (ctx && ctx.res) {
      // a private marker in case the user ticks "disable cache" during dev
      ctx.__notModified = true
      ctx.etag = cached.etag
      ctx.lastModified = new Date(cached.lastModified)
      const ifNoneMatch = ctx.headers['if-none-match']
      if (
        ctx.__serviceWorker !== true
        && ifNoneMatch === cached.etag
        && seenUrls.has(ctx.url)
      ) {
        ctx.res.statusCode = 304
      }
      seenUrls.add(ctx.url)
      ctx.body = cached.content
      if (ctx.res && !ctx.res.headersSent) {
        ctx.res.setHeader('ETag', cached.etag)
        ctx.res.setHeader('Last-Modified', new Date(cached.lastModified).toUTCString())
      }
    }
    return cached.content
  }
  // #395 some file is an binary file, eg. font
  const content = await fs.readFile(file)
  const etag = getETag(content)
  fsReadCache.set(file, {
    content,
    etag,
    lastModified,
  })
  if (ctx) {
    ctx.etag = etag
    ctx.lastModified = new Date(lastModified)
    ctx.body = content
    if (ctx.res) {
      ctx.res.statusCode = 200
      if (!ctx.res.headersSent) {
        ctx.res.setHeader('ETag', etag)
        ctx.res.setHeader('Last-Modified', new Date(lastModified).toUTCString())
      }
    }

    // watch the file if it's out of root.
    const { root, watcher } = ctx
    watchFileIfOutOfRoot(watcher, root, file)
  }
  return content
}

/**
 * Read already set body and normalize it into a string.
 * Useful in post-processing middlewares.
 */
export async function readBody(
  stream: Readable | Buffer | string | null,
): Promise<string | null> {
  if (stream instanceof Readable) {
    return new Promise((resolve, reject) => {
      let res = ''
      stream
        .on('data', chunk => (res += chunk))
        .on('error', reject)
        .on('end', () => {
          resolve(res)
        })
    })
  }
  else {
    return !stream || typeof stream === 'string' ? stream : stream.toString()
  }
}

export function lookupFile(
  dir: string,
  formats: string[],
  pathOnly = false,
): string | undefined {
  for (const format of formats) {
    const fullPath = path.join(dir, format)
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return pathOnly ? fullPath : fs.readFileSync(fullPath, 'utf-8')
    }
  }
  const parentDir = path.dirname(dir)
  if (parentDir !== dir) {
    return lookupFile(parentDir, formats, pathOnly)
  }
}

/**
 * Files under root are watched by default, but with user aliases we can still
 * serve files out of root. Add such files to the watcher (if not node_modules)
 */
export function watchFileIfOutOfRoot(
  watcher: HMRWatcher,
  root: string,
  file: string,
) {
  if (!file.startsWith(root) && !/node_modules/.test(file)) {
    watcher.add(file)
  }
}
