import type { ServerPlugin } from '.'

export const wasmPlugin: ServerPlugin = ({ app }) => {
  app.use((req: any, res: any, next: any) => {
    const url = req.url || ''
    const path = url.split('?')[0]
    
    const query = new URLSearchParams(url.split('?')[1] || '')
    if (path.endsWith('.wasm') && query.has('import')) {
      res.setHeader('Content-Type', 'application/javascript')
      res.end(`export default (opts = {}) => {
        return WebAssembly.instantiateStreaming(fetch(${JSON.stringify(
          path,
        )}), opts)
          .then(obj => obj.instance.exports)
      }`)
      return
    }
    next()
  })
}
