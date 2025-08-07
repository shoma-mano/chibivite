import type {
  CompilerOptions,
  SFCBlock,
  SFCDescriptor,
  SFCStyleBlock,
  SFCStyleCompileOptions,
  SFCStyleCompileResults,
  SFCTemplateBlock,
} from '@vue/compiler-sfc'
import type { Context, ServerPlugin } from '.'
import type { InternalResolver } from '../resolver'
import type { SourceMap } from './serverPluginSourceMap'
import path from 'node:path'
import qs from 'node:querystring'
import chalk from 'chalk'
// @ts-ignore
import debug from 'debug'
// @ts-ignore
import getEtag from 'etag'
import hash_sum from 'hash-sum'
import LRUCache from 'lru-cache'
import MagicString from 'magic-string'
import { transform } from '../esbuildService'
import {
  cachedRead,
  cleanUrl,
  resolveFrom,
  watchFileIfOutOfRoot,
} from '../utils'
import { parse } from '../utils/babelParse'
import { compileCss, rewriteCssUrls } from '../utils/cssUtils'
import { resolveCompiler, resolveVue } from '../utils/resolveVue'
import { codegenCss } from './serverPluginCss'
import { debugHmr, ensureMapEntry, importerMap } from './serverPluginHmr'
import { resolveImport } from './serverPluginModuleRewrite'
import { seenUrls } from './serverPluginServeStatic'
import { mergeSourceMap } from './serverPluginSourceMap'

const debugLog = debug('vite:sfc')

export const srcImportMap = new Map()

interface CacheEntry {
  descriptor?: SFCDescriptor
  template?: ResultWithMap
  script?: ResultWithMap
  styles: SFCStyleCompileResults[]
  customs: string[]
}

interface ResultWithMap {
  code: string
  map: SourceMap | null | undefined
}

export const vueCache = new LRUCache<string, CacheEntry>({
  max: 65535,
})

export const vuePlugin: ServerPlugin = ({
  root,
  app,
  resolver,
  watcher,
  config,
}) => {
  const etagCacheCheck = (req: any, res: any, body: any) => {
    const etag = getEtag(body)
    res.setHeader('ETag', etag)
    // only add 304 tag check if not using service worker to cache user code
    if (!config.serviceWorker) {
      const url = req.url || ''
      const ifNoneMatch = req.headers['if-none-match']
      if (seenUrls.has(url) && etag === ifNoneMatch) {
        res.statusCode = 304
      }
      else {
        res.statusCode = 200
      }
      seenUrls.add(url)
    }
  }

  app.use(async (req: any, res: any, next: any) => {
    console.log('vuePlugin: processing request', req.url)
    const url = req.url || ''
    const path = url.split('?')[0]
    const query = new URLSearchParams(url.split('?')[1] || '')

    if (!path.endsWith('.vue') && !req.vue) {
      return next()
    }

    const publicPath = path
    let filePath = resolver.requestToFile(publicPath)

    // upstream plugins could've already read the file
    const descriptor = await parseSFC(root, filePath, req.body)
    if (!descriptor) {
      debugLog(`${url} - 404`)
      res.statusCode = 404
      res.end('Not found')
      return
    }

    const queryType = query.get('type')
    if (!queryType) {
      // watch potentially out of root vue file since we do a custom read here
      watchFileIfOutOfRoot(watcher, root, filePath)

      if (descriptor.script && descriptor.script.src) {
        filePath = await resolveSrcImport(
          root,
          descriptor.script,
          { path: publicPath, url, body: req.body, read: async (file: string) => await cachedRead(null, file) },
          resolver,
        )
      }
      res.setHeader('Content-Type', 'application/javascript')
      const { code, map } = await compileSFCMain(
        descriptor,
        filePath,
        publicPath,
      )
      req.map = map
      etagCacheCheck(req, res, code)
      res.end(code)
      return
    }

    if (queryType === 'template') {
      const templateBlock = descriptor.template!
      if (templateBlock.src) {
        filePath = await resolveSrcImport(root, templateBlock, { path: publicPath, url, body: req.body, read: async (file: string) => await cachedRead(null, file) }, resolver)
      }
      res.setHeader('Content-Type', 'application/javascript')
      const { code, map } = compileSFCTemplate(
        root,
        templateBlock,
        filePath,
        publicPath,
        descriptor.styles.some(s => s.scoped),
        config.vueCompilerOptions,
      )
      req.map = map
      etagCacheCheck(req, res, code)
      res.end(code)
      return
    }

    if (queryType === 'style') {
      const index = Number(query.get('index'))
      const styleBlock = descriptor.styles[index]
      if (styleBlock.src) {
        filePath = await resolveSrcImport(root, styleBlock, { path: publicPath, url, body: req.body, read: async (file: string) => await cachedRead(null, file) }, resolver)
      }
      const id = hash_sum(publicPath)
      const result = await compileSFCStyle(
        root,
        styleBlock,
        index,
        filePath,
        publicPath,
        config.cssPreprocessOptions,
      )
      res.setHeader('Content-Type', 'application/javascript')
      const code = codegenCss(`${id}-${index}`, result.code, result.modules)
      etagCacheCheck(req, res, code)
      res.end(code)
      return
    }

    if (queryType === 'custom') {
      const index = Number(query.get('index'))
      const customBlock = descriptor.customBlocks[index]
      if (customBlock.src) {
        filePath = await resolveSrcImport(root, customBlock, { path: publicPath, url, body: req.body, read: async (file: string) => await cachedRead(null, file) }, resolver)
      }
      const result = resolveCustomBlock(
        customBlock,
        index,
        filePath,
        publicPath,
      )
      res.setHeader('Content-Type', 'application/javascript')
      etagCacheCheck(req, res, result)
      res.end(result)
    }
  })

  const handleVueReload = (watcher.handleVueReload = async (
    filePath: string,
    timestamp: number = Date.now(),
    content?: string,
  ) => {
    const publicPath = resolver.fileToRequest(filePath)
    const cacheEntry = vueCache.get(filePath)
    const { send } = watcher

    debugHmr(`busting Vue cache for ${filePath}`)
    vueCache.del(filePath)

    const descriptor = await parseSFC(root, filePath, content)
    if (!descriptor) {
      // read failed
      return
    }

    const prevDescriptor = cacheEntry && cacheEntry.descriptor
    if (!prevDescriptor) {
      // the file has never been accessed yet
      debugHmr(`no existing descriptor found for ${filePath}`)
      return
    }

    // check which part of the file changed
    let needRerender = false

    const sendReload = () => {
      send({
        type: 'vue-reload',
        path: publicPath,
        timestamp,
      })
      console.log(
        `${chalk.green(`[vite:hmr] `)
        }${path.relative(root, filePath)} updated. (reload)`,
      )
    }

    if (!isEqualBlock(descriptor.script, prevDescriptor.script)) {
      return sendReload()
    }

    if (!isEqualBlock(descriptor.template, prevDescriptor.template)) {
      needRerender = true
    }

    let didUpdateStyle = false
    const styleId = hash_sum(publicPath)
    const prevStyles = prevDescriptor.styles || []
    const nextStyles = descriptor.styles || []

    // css modules update causes a reload because the $style object is changed
    // and it may be used in JS. It also needs to trigger a vue-style-update
    // event so the client busts the sw cache.
    if (
      prevStyles.some(s => s.module != null)
      || nextStyles.some(s => s.module != null)
    ) {
      return sendReload()
    }

    // force reload if scoped status has changed
    if (prevStyles.some(s => s.scoped) !== nextStyles.some(s => s.scoped)) {
      return sendReload()
    }

    // only need to update styles if not reloading, since reload forces
    // style updates as well.
    nextStyles.forEach((_, i) => {
      if (!prevStyles[i] || !isEqualBlock(prevStyles[i], nextStyles[i])) {
        didUpdateStyle = true
        send({
          type: 'style-update',
          path: `${publicPath}?type=style&index=${i}`,
          timestamp,
        })
      }
    })

    // stale styles always need to be removed
    prevStyles.slice(nextStyles.length).forEach((_, i) => {
      didUpdateStyle = true
      send({
        type: 'style-remove',
        path: publicPath,
        id: `${styleId}-${i + nextStyles.length}`,
        timestamp,
      })
    })

    const prevCustoms = prevDescriptor.customBlocks || []
    const nextCustoms = descriptor.customBlocks || []

    // custom blocks update causes a reload
    // because the custom block contents is changed and it may be used in JS.
    if (
      nextCustoms.some(
        (_, i) =>
          !prevCustoms[i] || !isEqualBlock(prevCustoms[i], nextCustoms[i]),
      )
    ) {
      return sendReload()
    }

    if (needRerender) {
      send({
        type: 'vue-rerender',
        path: publicPath,
        timestamp,
      })
    }

    const updateType = []
    if (needRerender) {
      updateType.push(`template`)
    }
    if (didUpdateStyle) {
      updateType.push(`style`)
    }
    if (updateType.length) {
      console.log(
        `${chalk.green(`[vite:hmr] `)
        }${path.relative(root, filePath)} updated. (${updateType.join(
          ' & ',
        )})`,
      )
    }
  })

  watcher.on('change', (file) => {
    if (file.endsWith('.vue')) {
      handleVueReload(file)
    }
  })
}

function isEqualBlock(a: SFCBlock | null, b: SFCBlock | null) {
  if (!a && !b)
    return true
  if (!a || !b)
    return false
  // src imports will trigger their own updates
  if (a.src && b.src && a.src === b.src)
    return true
  if (a.content !== b.content)
    return false
  const keysA = Object.keys(a.attrs)
  const keysB = Object.keys(b.attrs)
  if (keysA.length !== keysB.length) {
    return false
  }
  return keysA.every(key => a.attrs[key] === b.attrs[key])
}

async function resolveSrcImport(
  root: string,
  block: SFCBlock,
  ctx: Context,
  resolver: InternalResolver,
) {
  const importer = ctx.path
  const importee = cleanUrl(resolveImport(root, importer, block.src!, resolver))
  const filePath = resolver.requestToFile(importee)
  block.content = (await ctx.read(filePath)).toString()

  // register HMR import relationship
  debugHmr(`        ${importer} imports ${importee}`)
  ensureMapEntry(importerMap, importee).add(ctx.path)
  srcImportMap.set(filePath, ctx.url)
  return filePath
}

async function parseSFC(
  root: string,
  filePath: string,
  content?: string | Buffer,
): Promise<SFCDescriptor | undefined> {
  let cached = vueCache.get(filePath)
  if (cached && cached.descriptor) {
    debugLog(`${filePath} parse cache hit`)
    return cached.descriptor
  }

  if (!content) {
    try {
      content = await cachedRead(null, filePath)
    }
    catch (e) {
      return
    }
  }

  if (typeof content !== 'string') {
    content = content.toString()
  }

  const start = Date.now()
  const { parse, generateCodeFrame } = resolveCompiler(root)
  const { descriptor, errors } = parse(content, {
    filename: filePath,
    sourceMap: true,
  })

  if (errors.length) {
    console.error(chalk.red(`\n[vite] SFC parse error: `))
    errors.forEach((e) => {
      const locString = e.loc
        ? `:${e.loc.start.line}:${e.loc.start.column}`
        : ``
      console.error(chalk.underline(filePath + locString))
      console.error(chalk.yellow(e.message))
      if (e.loc) {
        console.error(
          `${generateCodeFrame(
            content as string,
            e.loc.start.offset,
            e.loc.end.offset,
          )}\n`,
        )
      }
    })
  }

  cached = cached || { styles: [], customs: [] }
  cached.descriptor = descriptor
  vueCache.set(filePath, cached)
  debugLog(`${filePath} parsed in ${Date.now() - start}ms.`)
  return descriptor
}

const defaultExportRE = /((?:^|\n|;)\s*)export default/

async function compileSFCMain(
  descriptor: SFCDescriptor,
  filePath: string,
  publicPath: string,
): Promise<ResultWithMap> {
  let cached = vueCache.get(filePath)
  if (cached && cached.script) {
    return cached.script
  }

  const id = hash_sum(publicPath)
  let code = ``
  if (descriptor.script) {
    let content = descriptor.script.content
    if (descriptor.script.lang === 'ts') {
      const { code, map } = await transform(content, publicPath, {
        loader: 'ts',
      })
      content = code
      descriptor.script.map = mergeSourceMap(
        descriptor.script.map as SourceMap,
        JSON.parse(map!),
      ) as SourceMap & { version: string }
    }
    // rewrite export default.
    // fast path: simple regex replacement to avoid full-blown babel parse.
    let replaced = content.replace(defaultExportRE, '$1const __script =')
    // if the script somehow still contains `default export`, it probably has
    // multi-line comments or template strings. fallback to a full parse.
    if (defaultExportRE.test(replaced)) {
      replaced = rewriteDefaultExport(content)
    }
    code += replaced
  }
  else {
    code += `const __script = {}`
  }

  let hasScoped = false
  let hasCSSModules = false
  if (descriptor.styles) {
    descriptor.styles.forEach((s, i) => {
      const styleRequest = `${publicPath}?type=style&index=${i}`
      if (s.scoped)
        hasScoped = true
      if (s.module) {
        if (!hasCSSModules) {
          code += `\nconst __cssModules = __script.__cssModules = {}`
          hasCSSModules = true
        }
        const styleVar = `__style${i}`
        const moduleName = typeof s.module === 'string' ? s.module : '$style'
        code += `\nimport ${styleVar} from ${JSON.stringify(
          `${styleRequest}&module`,
        )}`
        code += `\n__cssModules[${JSON.stringify(moduleName)}] = ${styleVar}`
      }
      else {
        code += `\nimport ${JSON.stringify(styleRequest)}`
      }
    })
    if (hasScoped) {
      code += `\n__script.__scopeId = "data-v-${id}"`
    }
  }

  if (descriptor.customBlocks) {
    descriptor.customBlocks.forEach((c, i) => {
      const attrsQuery = attrsToQuery(c.attrs, c.lang)
      const blockTypeQuery = `&blockType=${qs.escape(c.type)}`
      const customRequest
        = `${publicPath}?type=custom&index=${i}${blockTypeQuery}${attrsQuery}`
      const customVar = `block${i}`
      code += `\nimport ${customVar} from ${JSON.stringify(customRequest)}\n`
      code += `if (typeof ${customVar} === 'function') ${customVar}(__script)\n`
    })
  }

  if (descriptor.template) {
    const templateRequest = `${publicPath}?type=template`
    code += `\nimport { render as __render } from ${JSON.stringify(
      templateRequest,
    )}`
    code += `\n__script.render = __render`
  }
  code += `\n__script.__hmrId = ${JSON.stringify(publicPath)}`
  code += `\n__script.__file = ${JSON.stringify(filePath)}`
  code += `\nexport default __script`

  const result: ResultWithMap = {
    code,
    map: descriptor.script && (descriptor.script.map as SourceMap),
  }

  cached = cached || { styles: [], customs: [] }
  cached.script = result
  vueCache.set(filePath, cached)
  return result
}

function compileSFCTemplate(
  root: string,
  template: SFCTemplateBlock,
  filePath: string,
  publicPath: string,
  scoped: boolean,
  userOptions: CompilerOptions | undefined,
): ResultWithMap {
  let cached = vueCache.get(filePath)
  if (cached && cached.template) {
    debug(`${publicPath} template cache hit`)
    return cached.template
  }

  const start = Date.now()
  const { compileTemplate, generateCodeFrame } = resolveCompiler(root)
  const { code, map, errors } = compileTemplate({
    source: template.content,
    filename: filePath,
    inMap: template.map,
    transformAssetUrls: {
      base: path.posix.dirname(publicPath),
    },
    compilerOptions: {
      ...userOptions,
      scopeId: scoped ? `data-v-${hash_sum(publicPath)}` : null,
      runtimeModuleName: resolveVue(root).isLocal
        ? // in local mode, vue would have been optimized so must be referenced
      // with .js postfix
        '/@modules/vue.js'
        : '/@modules/vue',
    },
    preprocessLang: template.lang,
    preprocessCustomRequire: (id: string) => require(resolveFrom(root, id)),
  })

  if (errors.length) {
    console.error(chalk.red(`\n[vite] SFC template compilation error: `))
    errors.forEach((e) => {
      if (typeof e === 'string') {
        console.error(e)
      }
      else {
        const locString = e.loc
          ? `:${e.loc.start.line}:${e.loc.start.column}`
          : ``
        console.error(chalk.underline(filePath + locString))
        console.error(chalk.yellow(e.message))
        if (e.loc) {
          const original = template.map!.sourcesContent![0]
          console.error(
            `${generateCodeFrame(original, e.loc.start.offset, e.loc.end.offset)
            }\n`,
          )
        }
      }
    })
  }

  const result = {
    code,
    map: map as SourceMap,
  }

  cached = cached || { styles: [], customs: [] }
  cached.template = result
  vueCache.set(filePath, cached)

  debug(`${publicPath} template compiled in ${Date.now() - start}ms.`)
  return result
}

async function compileSFCStyle(
  root: string,
  style: SFCStyleBlock,
  index: number,
  filePath: string,
  publicPath: string,
  preprocessOptions: SFCStyleCompileOptions['preprocessOptions'],
): Promise<SFCStyleCompileResults> {
  let cached = vueCache.get(filePath)
  const cachedEntry = cached && cached.styles && cached.styles[index]
  if (cachedEntry) {
    debug(`${publicPath} style cache hit`)
    return cachedEntry
  }

  const start = Date.now()

  const { generateCodeFrame } = resolveCompiler(root)
  const result = (await compileCss(root, publicPath, {
    source: style.content,
    filename: `${filePath}?type=style&index=${index}`,
    id: ``, // will be computed in compileCss
    scoped: style.scoped != null,
    modules: style.module != null,
    preprocessLang: style.lang as SFCStyleCompileOptions['preprocessLang'],
    preprocessOptions,
  })) as SFCStyleCompileResults

  if (result.errors.length) {
    console.error(chalk.red(`\n[vite] SFC style compilation error: `))
    result.errors.forEach((e: any) => {
      if (typeof e === 'string') {
        console.error(e)
      }
      else {
        const lineOffset = style.loc.start.line - 1
        if (e.line && e.column) {
          console.log(
            chalk.underline(`${filePath}:${e.line + lineOffset}:${e.column}`),
          )
        }
        else {
          console.log(chalk.underline(filePath))
        }
        const filePathRE = new RegExp(
          `.*${
            path.basename(filePath).replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')
          }(:\\d+:\\d+:\\s*)?`,
        )
        const cleanMsg = e.message.replace(filePathRE, '')
        console.error(chalk.yellow(cleanMsg))
        if (e.line && e.column && cleanMsg.split(/\n/g).length === 1) {
          const original = style.map!.sourcesContent![0]
          const offset
            = original
              .split(/\r?\n/g)
              .slice(0, e.line + lineOffset - 1)
              .map(l => l.length)
              .reduce((total, l) => total + l + 1, 0)
              + e.column
              - 1`${console.error(generateCodeFrame(original, offset, offset + 1))}\n`
        }
      }
    })
  }

  result.code = await rewriteCssUrls(result.code, publicPath)

  cached = cached || { styles: [], customs: [] }
  cached.styles[index] = result
  vueCache.set(filePath, cached)

  debug(`${publicPath} style compiled in ${Date.now() - start}ms`)
  return result
}

function resolveCustomBlock(
  custom: SFCBlock,
  index: number,
  filePath: string,
  publicPath: string,
): string {
  let cached = vueCache.get(filePath)
  const cachedEntry = cached && cached.customs && cached.customs[index]
  if (cachedEntry) {
    debug(`${publicPath} custom block cache hit`)
    return cachedEntry
  }

  const result = custom.content
  cached = cached || { styles: [], customs: [] }
  cached.customs[index] = result
  vueCache.set(filePath, cached)
  return result
}

// these are built-in query parameters so should be ignored
// if the user happen to add them as attrs
const ignoreList = ['id', 'index', 'src', 'type']

function attrsToQuery(attrs: SFCBlock['attrs'], langFallback?: string): string {
  let query = ``
  for (const name in attrs) {
    const value = attrs[name]
    if (!ignoreList.includes(name)) {
      query += `&${qs.escape(name)}=${value ? qs.escape(String(value)) : ``}`
    }
  }
  if (langFallback && !(`lang` in attrs)) {
    query += `&lang=${langFallback}`
  }
  return query
}

function rewriteDefaultExport(code: string): string {
  const s = new MagicString(code)
  const ast = parse(code)
  ast.forEach((node) => {
    if (node.type === 'ExportDefaultDeclaration') {
      s.overwrite(node.start!, node.declaration.start!, `const __script = `)
    }
  })
  const ret = s.toString()
  return ret
}
