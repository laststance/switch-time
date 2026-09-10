/// <reference types="node" />
// Static server for the Playwright run: `expo serve` has no catch-all for `web.output: single`, so this mirrors
// App Platform's `catchall_document: index.html` and its `/api` route (.do/app.yaml): `/api/*` is piped to the API
// on :8080, so the export runs with the production `API_ORIGIN` of `''` (one origin). Usage: node scripts/serve-spa.mts [port]
import { createReadStream, existsSync, statSync } from 'node:fs'
import {
  createServer,
  type IncomingMessage,
  request,
  type ServerResponse,
} from 'node:http'
import { extname, join, normalize } from 'node:path'

const root = join(import.meta.dirname, '../dist')
const port = Number(process.argv[2] ?? 8081)
// Where playwright.config.ts boots (or reuses) the API bundle.
const api = { host: 'localhost', port: 8080 }
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

// Forwards one `/api/*` request verbatim (query string included) under the API's own Host, as the ingress does;
// Set-Cookie comes back as an array, which writeHead passes through, so the Better Auth cookie lands on this origin.
function proxy(req: IncomingMessage, res: ServerResponse) {
  const upstream = request(
    {
      ...api,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: `${api.host}:${api.port}` },
    },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(res)
    },
  )
  // A cold or crashed API must not take the static server down with it.
  upstream.on('error', () => res.writeHead(502).end())
  req.pipe(upstream)
}

// The file under dist for a URL; unknown or directory paths are client-side routes and get the app shell.
// normalize() folds `..`, so nothing above dist is reachable. The pathname is not percent-decoded: every exported name is
// plain ASCII, and decodeURIComponent would throw on a malformed `%` and take the server down.
function fileFor(url: string) {
  const file = join(root, normalize(new URL(url, 'http://localhost').pathname))
  return existsSync(file) && !statSync(file).isDirectory()
    ? file
    : join(root, 'index.html')
}

createServer((req, res) => {
  const url = String(req.url)
  if (url.startsWith('/api/')) return proxy(req, res)
  const file = fileFor(url)
  res.writeHead(200, {
    'content-type': types[extname(file)] ?? 'application/octet-stream',
  })
  createReadStream(file).pipe(res)
}).listen(port, () => {
  console.log(`serving ${root} on http://localhost:${port}`)
})
