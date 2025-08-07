import type { Plugin } from 'rollup'
import type { DepOptimizationOptions } from '.'
import chalk from 'chalk'
// @ts-ignore
import isbuiltin from 'isbuiltin'
import { lookupFile } from '../utils'

export function createBuiltInBailPlugin(allowList: DepOptimizationOptions['allowNodeBuiltins']): Plugin {
  return {
    name: 'vite:node-built-in-bail',
    resolveId(id, importer) {
      if (isbuiltin(id)) {
        let importingDep
        if (importer) {
          const pkg = JSON.parse(lookupFile(importer, ['package.json']) || `{}`)
          if (pkg.name) {
            importingDep = pkg.name
          }
        }
        if (importingDep && allowList && allowList.includes(importingDep)) {
          return null
        }
        const dep = importingDep
          ? `Dependency ${chalk.yellow(importingDep)}`
          : `A dependency`
        throw new Error(
          `${dep} is attempting to import Node built-in module ${chalk.yellow(
            id,
          )}.\n`
          + `This will not work in a browser environment.\n`
          + `Imported by: ${chalk.gray(importer)}`,
        )
      }
      return null
    },
  }
}
