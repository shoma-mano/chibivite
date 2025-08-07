const fs = require('node:fs')
const path = require('node:path')

const indexPath = path.resolve(__dirname, '../dist/index.d.ts')
const content = fs.readFileSync(indexPath, 'utf-8')
fs.writeFileSync(indexPath, `${content}\nimport '../importMeta'`)
