import type { Statement } from '@babel/types'
import { parse as _parse } from '@babel/parser'

export function parse(source: string): Statement[] {
  return _parse(source, {
    sourceType: 'module',
    plugins: [
      // required for import.meta.hot
      'importMeta',
      // by default we enable proposals slated for ES2020.
      // full list at https://babeljs.io/docs/en/next/babel-parser#plugins
      // this should be kept in async with @vue/compiler-core's support range
      'bigInt',
      'optionalChaining',
      'nullishCoalescingOperator',
    ],
  }).program.body
}
