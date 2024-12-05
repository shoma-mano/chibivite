import path from 'path'
import chalk from 'chalk'
import { transform as _transform, TransformOptions, Message } from 'esbuild'
import { SharedConfig } from './config'
import { cleanUrl } from './utils'

const debug = require('debug')('vite:esbuild')

export const tjsxRE = /\.(tsx?|jsx)$/

export const vueJsxPublicPath = '/vite/jsx'

export const vueJsxFilePath = path.resolve(__dirname, 'vueJsxCompat.js')

const JsxPresets: Record<
  string,
  Pick<TransformOptions, 'jsxFactory' | 'jsxFragment'>
> = {
  vue: { jsxFactory: 'jsx', jsxFragment: 'Fragment' },
  preact: { jsxFactory: 'h', jsxFragment: 'Fragment' },
  react: {} // use esbuild default
}

export function resolveJsxOptions(options: SharedConfig['jsx'] = 'vue') {
  if (typeof options === 'string') {
    if (!(options in JsxPresets)) {
      console.error(`[vite] unknown jsx preset: '${options}'.`)
    }
    return JsxPresets[options] || {}
  } else if (options) {
    return {
      jsxFactory: options.factory,
      jsxFragment: options.fragment
    }
  }
}

const sourceMapRE = /\/\/# sourceMappingURL.*/

// transform used in server plugins with a more friendly API
export const transform = async (
  src: string,
  request: string,
  options: TransformOptions = {},
  jsxOption?: SharedConfig['jsx']
) => {
  const file = cleanUrl(request)
  options = {
    ...options,
    loader: options.loader || (path.extname(file).slice(1) as any),
    sourcemap: true,
    sourcefile: request, // ensure source file name contains full query
    target: 'es2019'
  }
  try {
    const result = await _transform(src, options)
    if (result.warnings.length) {
      console.error(`[vite] warnings while transforming ${file} with esbuild:`)
      result.warnings.forEach((m) => printMessage(m, src))
    }

    let code = (result.code || '').replace(sourceMapRE, '')

    // if transpiling (j|t)sx file, inject the imports for the jsx helper and
    // Fragment.
    if (file.endsWith('x')) {
      if (!jsxOption || jsxOption === 'vue') {
        code +=
          `\nimport { jsx } from '${vueJsxPublicPath}'` +
          `\nimport { Fragment } from 'vue'`
      }
      if (jsxOption === 'preact') {
        code += `\nimport { h, Fragment } from 'preact'`
      }
    }

    return {
      code,
      map: result.map
    }
  } catch (e) {
    console.error(
      chalk.red(`[vite] error while transforming ${file} with esbuild:`)
    )
    if (e.errors) {
      e.errors.forEach((m: Message) => printMessage(m, src))
    } else {
      console.error(e)
    }
    debug(`options used: `, options)
    return {
      code: '',
      map: undefined
    }
  }
}

function printMessage(m: Message, code: string) {
  console.error(chalk.yellow(m.text))
  if (m.location) {
    const lines = code.split(/\r?\n/g)
    const line = Number(m.location.line)
    const column = Number(m.location.column)
    const offset =
      lines
        .slice(0, line - 1)
        .map((l) => l.length)
        .reduce((total, l) => total + l + 1, 0) + column
    console.error(
      require('@vue/compiler-core').generateCodeFrame(code, offset, offset + 1)
    )
  }
}
