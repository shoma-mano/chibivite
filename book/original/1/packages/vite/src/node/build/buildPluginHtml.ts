import type {
  AttributeNode,
  NodeTransform,
  parse as Parse,
  TextNode,
  transform as Transform,
} from '@vue/compiler-dom'
import type { OutputChunk, Plugin, RollupOutput } from 'rollup'
import type { InternalResolver } from '../resolver'
import path from 'node:path'
import {
  NodeTypes,
  parse,
  transform,
} from '@vue/compiler-dom'
import fs from 'fs-extra'
import MagicString from 'magic-string'
import { cleanUrl, isExternalUrl, isStaticAsset } from '../utils/pathUtils'
import { resolveAsset } from './buildPluginAsset'

export async function createBuildHtmlPlugin(root: string, indexPath: string | null, publicBasePath: string, assetsDir: string, inlineLimit: number, resolver: InternalResolver, shouldPreload: ((chunk: OutputChunk) => boolean) | null) {
  if (!indexPath || !fs.existsSync(indexPath)) {
    return {
      renderIndex: (...args: any[]) => '',
      htmlPlugin: null,
    }
  }

  const rawHtml = await fs.readFile(indexPath, 'utf-8')
  let { html: processedHtml, js } = await compileHtml(
    root,
    rawHtml,
    publicBasePath,
    assetsDir,
    inlineLimit,
    resolver,
  )

  const htmlPlugin: Plugin = {
    name: 'vite:html',
    async load(id) {
      if (id === indexPath) {
        return js
      }
    },
  }

  const injectCSS = (html: string, filename: string) => {
    const tag = `<link rel="stylesheet" href="${publicBasePath}${path.posix.join(
      assetsDir,
      filename,
    )}">`
    if (/<\/head>/.test(html)) {
      return html.replace(/<\/head>/, `${tag}\n</head>`)
    }
    else {
      return `${tag}\n${html}`
    }
  }

  const injectScript = (html: string, filename: string) => {
    filename = isExternalUrl(filename)
      ? filename
      : `${publicBasePath}${path.posix.join(assetsDir, filename)}`
    const tag = `<script type="module" src="${filename}"></script>`
    if (/<\/body>/.test(html)) {
      return html.replace(/<\/body>/, `${tag}\n</body>`)
    }
    else {
      return `${html}\n${tag}`
    }
  }

  const injectPreload = (html: string, filename: string) => {
    filename = isExternalUrl(filename)
      ? filename
      : `${publicBasePath}${path.posix.join(assetsDir, filename)}`
    const tag = `<link rel="modulepreload" href="${filename}" />`
    if (/<\/head>/.test(html)) {
      return html.replace(/<\/head>/, `${tag}\n</head>`)
    }
    else {
      return `${tag}\n${html}`
    }
  }

  const renderIndex = (
    bundleOutput: RollupOutput['output'],
    cssFileName: string,
  ) => {
    // inject css link
    processedHtml = injectCSS(processedHtml, cssFileName)
    // inject js entry chunks
    for (const chunk of bundleOutput) {
      if (chunk.type === 'chunk') {
        if (chunk.isEntry) {
          processedHtml = injectScript(processedHtml, chunk.fileName)
        }
        else if (shouldPreload && shouldPreload(chunk)) {
          processedHtml = injectPreload(processedHtml, chunk.fileName)
        }
      }
    }
    return processedHtml
  }

  return {
    renderIndex,
    htmlPlugin,
  }
}

// this extends the config in @vue/compiler-sfc with <link href>
const assetAttrsConfig: Record<string, string[]> = {
  link: ['href'],
  video: ['src', 'poster'],
  source: ['src'],
  img: ['src'],
  image: ['xlink:href', 'href'],
  use: ['xlink:href', 'href'],
}

// compile index.html to a JS module, importing referenced assets
// and scripts
async function compileHtml(root: string, html: string, publicBasePath: string, assetsDir: string, inlineLimit: number, resolver: InternalResolver) {
  // @vue/compiler-core doesn't like lowercase doctypes
  html = html.replace(/<!doctype\s/i, '<!DOCTYPE ')
  const ast = (parse as typeof Parse)(html)

  let js = ''
  const s = new MagicString(html)
  const assetUrls: AttributeNode[] = []
  const viteHtmlTransform: NodeTransform = (node) => {
    if (node.type === NodeTypes.ELEMENT) {
      if (node.tag === 'script') {
        let shouldRemove = true
        const srcAttr = node.props.find(
          p => p.type === NodeTypes.ATTRIBUTE && p.name === 'src',
        ) as AttributeNode
        if (srcAttr && srcAttr.value) {
          if (!isExternalUrl(srcAttr.value.content)) {
            // <script type="module" src="..."/>
            // add it as an import
            js += `\nimport ${JSON.stringify(srcAttr.value.content)}`
          }
          else {
            shouldRemove = false
          }
        }
        else if (node.children.length) {
          // <script type="module">...</script>
          // add its content
          // TODO: if there are multiple inline module scripts on the page,
          // they should technically be turned into separate modules, but
          // it's hard to imagine any reason for anyone to do that.
          js += `\n${(node.children[0] as TextNode).content.trim()}\n`
        }
        if (shouldRemove) {
          // remove the script tag from the html. we are going to inject new
          // ones in the end.
          s.remove(node.loc.start.offset, node.loc.end.offset)
        }
      }
      // For asset references in index.html, also generate an import
      // statement for each - this will be handled by the asset plugin
      const assetAttrs = assetAttrsConfig[node.tag]
      if (assetAttrs) {
        for (const p of node.props) {
          if (
            p.type === NodeTypes.ATTRIBUTE
            && p.value
            && assetAttrs.includes(p.name)
            && !isExternalUrl(p.value.content)
          ) {
            const url = cleanUrl(p.value.content)
            js += `\nimport ${JSON.stringify(url)}`
            if (isStaticAsset(url)) {
              assetUrls.push(p)
            }
          }
        }
      }
    }
  }

  ;(transform as typeof Transform)(ast, {
    nodeTransforms: [viteHtmlTransform],
  })

  // for each encountered asset url, rewrite original html so that it
  // references the post-build location.
  for (const attr of assetUrls) {
    const value = attr.value!
    const { url } = await resolveAsset(
      resolver.requestToFile(value.content),
      root,
      publicBasePath,
      assetsDir,
      inlineLimit,
    )
    s.overwrite(value.loc.start.offset, value.loc.end.offset, `"${url}"`)
  }

  return {
    html: s.toString(),
    js,
  }
}
