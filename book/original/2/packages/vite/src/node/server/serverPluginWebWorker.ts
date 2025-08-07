import type { ServerPlugin } from '.'

export const webWorkerPlugin: ServerPlugin = ({ app }) => {
  app.use((req: any, res: any, next: any) => {
    const url = req.url || ''
    const path = url.split('?')[0]
    const query = new URLSearchParams(url.split('?')[1] || '')
    
    if (query.get('worker') != null) {
      res.setHeader('Content-Type', 'application/javascript')
      res.end(`export default function WrappedWorker() {
        return new Worker(${JSON.stringify(path)}, { type: 'module' })
      }`)
      return
    }
    next()
  })
}
