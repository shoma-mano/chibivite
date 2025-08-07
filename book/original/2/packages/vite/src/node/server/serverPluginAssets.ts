import type { ServerPlugin } from '.'
import { isStaticAsset } from '../utils'

export const assetPathPlugin: ServerPlugin = ({ app }) => {
  app.use((req: any, res: any, next: any) => {
    const url = req.url || ''
    const path = url.split('?')[0]
    const query = new URLSearchParams(url.split('?')[1] || '')

    if (isStaticAsset(path) && query.has('import')) {
      res.setHeader('Content-Type', 'application/javascript')
      res.end(`export default ${JSON.stringify(path)}`)
      return
    }
    next()
  })
}
