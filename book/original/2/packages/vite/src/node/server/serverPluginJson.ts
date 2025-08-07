import type { ServerPlugin } from '.'
import { readBody } from '../utils'

export const jsonPlugin: ServerPlugin = ({ app }) => {
  app.use((req: any, res: any, next: any) => {
    const originalEnd = res.end
    res.end = async function(chunk: any, encoding?: any, callback?: any) {
      const url = req.url || ''
      const path = url.split('?')[0]
      
      // handle .json imports
      // note req.body could be null if upstream set status to 304
      const query = new URLSearchParams(url.split('?')[1] || '')
      if (path.endsWith('.json') && query.has('import') && req.body) {
        res.setHeader('Content-Type', 'application/javascript')
        const content = `export default ${await readBody(req.body)}`
        return originalEnd.call(res, content, encoding, callback)
      }
      
      return originalEnd.call(res, chunk, encoding, callback)
    }
    
    next()
  })
}
