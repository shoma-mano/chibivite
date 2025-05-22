import fs from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import connect from 'connect'
import serveStatic from 'serve-static'

// ESM の __dirname 相当の実装
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = connect()
const port = 3002

// 静的ファイルの提供
app.use(serveStatic(resolve(__dirname)))

// ルートパスへのリクエストを index.html にリダイレクト
app.use('/', (req, res, next) => {
  if (req.url === '/') {
    const indexPath = resolve(__dirname, 'index.html')
    fs.readFile(indexPath, 'utf-8', (err, content) => {
      if (err) {
        res.statusCode = 500
        res.end(`Error loading index.html: ${err.message}`)
        return
      }

      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html')
      res.end(content)
    })
  }
  else {
    next()
  }
})

// 404ハンドラー
app.use((req, res) => {
  res.statusCode = 404
  res.end(`Not found: ${req.url}`)
})

// サーバー起動
app.listen(port, () => {
  console.log(`Mini Vite server running at http://localhost:${port}`)
  console.log(`Serving files from: ${__dirname}`)
})
