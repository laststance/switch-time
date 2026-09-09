/// <reference types="node" />
// Static server for the Playwright run: `expo serve` has no catch-all for `web.output: single`, so this mirrors
// App Platform's `catchall_document: index.html` (.do/app.yaml). Usage: node scripts/serve-spa.mts [port]
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const root = join(import.meta.dirname, '../dist')
const port = Number(process.argv[2] ?? 8081)
const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
}

createServer((req, res) => {
  // normalize() folds `..`, so nothing above dist is reachable.
  const pathname = decodeURIComponent(
    new URL(String(req.url), 'http://localhost').pathname,
  )
  let file = join(root, normalize(pathname))
  // Unknown or directory paths are client-side routes: hand them the app shell.
  if (!existsSync(file) || statSync(file).isDirectory())
    file = join(root, 'index.html')
  res.writeHead(200, {
    'content-type': types[extname(file)] ?? 'application/octet-stream',
  })
  createReadStream(file).pipe(res)
}).listen(port, () => {
  console.log(`serving ${root} on http://localhost:${port}`)
})
