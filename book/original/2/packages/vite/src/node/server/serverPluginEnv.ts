import type { ServerPlugin } from '.'

export const envPublicPath = '/vite/env'

export const envPlugin: ServerPlugin = ({ app, config }) => {
  const mode = config.mode || 'development'
  const env = JSON.stringify({
    ...config.env,
    BASE_URL: '/',
    MODE: mode,
    DEV: mode === 'development',
    PROD: mode === 'production',
  })

  app.use((req, res, next) => {
    const path = req.url?.split('?')[0] || ''
    if (path === envPublicPath) {
      res.setHeader('Content-Type', 'application/javascript')
      res.end(`export default ${env}`)
      return
    }
    return next()
  })
}
