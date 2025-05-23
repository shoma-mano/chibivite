import { resolve } from 'node:path'
import { jsPlugin } from './plugins/jsPlugin.js'

const config = {
  alias: {
    'alias': '/alias/aliased',
    '/@alias/': resolve(import.meta.dirname, 'alias/aliased-dir'),
  },
  jsx: 'preact',
  minify: false,
  serviceWorker: !!process.env.USE_SW,
  plugins: [jsPlugin],
  // vueCustomBlockTransforms: { i18n: i18nTransform },
  optimizeDeps: {
    exclude: ['bootstrap', 'rewrite-unoptimized-test-package'],
    link: ['optimize-linked'],
  },
  cssPreprocessOptions: {
    modifyVars: {
      'preprocess-custom-color': 'green',
    },
  },
}

export default config
