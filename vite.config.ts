import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import http from 'node:http'
import https from 'node:https'

/** Forwards /__pinelabs-api → Pine Labs cloud (X-Pinelabs-Target header). Dev/preview only. */
function pinelabsApiProxy(): Plugin {
  const handler = (
    req: import('http').IncomingMessage,
    res: import('http').ServerResponse,
    next: () => void,
  ) => {
    if (req.url !== '/__pinelabs-api' || req.method !== 'POST') {
      next()
      return
    }

    const target = String(req.headers['x-pinelabs-target'] ?? '').replace(/\/+$/, '')
    if (!target || !/^https?:\/\//i.test(target)) {
      res.statusCode = 400
      res.end('Missing or invalid X-Pinelabs-Target header')
      return
    }

    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      let parsed: URL
      try {
        parsed = new URL(target)
      } catch {
        res.statusCode = 400
        res.end('Invalid Pine Labs URL')
        return
      }

      const lib = parsed.protocol === 'https:' ? https : http
      const proxyReq = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname + parsed.search || '/',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': body.length,
          },
        },
        (proxyRes) => {
          const out: Buffer[] = []
          proxyRes.on('data', (c) => out.push(c))
          proxyRes.on('end', () => {
            res.statusCode = proxyRes.statusCode ?? 502
            res.setHeader('Content-Type', proxyRes.headers['content-type'] ?? 'application/json')
            res.end(Buffer.concat(out))
          })
        },
      )
      proxyReq.on('error', (err) => {
        res.statusCode = 502
        res.end(err.message)
      })
      proxyReq.write(body)
      proxyReq.end()
    })
  }

  return {
    name: 'pinelabs-api-proxy',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}

/** Forwards /__tally-api → Tally HTTP server (X-Tally-Target header). Dev/preview only. */
function tallyApiProxy(): Plugin {
  const handler = (
    req: import('http').IncomingMessage,
    res: import('http').ServerResponse,
    next: () => void,
  ) => {
    if (req.url !== '/__tally-api' || req.method !== 'POST') {
      next()
      return
    }

    const target = String(req.headers['x-tally-target'] ?? '').replace(/\/+$/, '')
    if (!target || !/^https?:\/\//i.test(target)) {
      res.statusCode = 400
      res.end('Missing or invalid X-Tally-Target header')
      return
    }

    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      let parsed: URL
      try {
        parsed = new URL(target)
      } catch {
        res.statusCode = 400
        res.end('Invalid Tally URL')
        return
      }

      const lib = parsed.protocol === 'https:' ? https : http
      const proxyReq = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname + parsed.search || '/',
          method: 'POST',
          headers: { 'Content-Type': 'text/xml', 'Content-Length': body.length },
        },
        (proxyRes) => {
          const out: Buffer[] = []
          proxyRes.on('data', (c) => out.push(c))
          proxyRes.on('end', () => {
            res.statusCode = proxyRes.statusCode ?? 502
            res.end(Buffer.concat(out))
          })
        },
      )
      proxyReq.on('error', (err) => {
        res.statusCode = 502
        res.end(err.message)
      })
      proxyReq.write(body)
      proxyReq.end()
    })
  }

  return {
    name: 'tally-api-proxy',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Cash-counter/' : '/',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/firebase')) return 'firebase'
          if (id.includes('node_modules/xlsx')) return 'xlsx'
          if (
            id.includes('node_modules/react') ||
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/scheduler')
          ) {
            return 'vendor'
          }
        },
      },
    },
  },
  plugins: [
    react(),
    pinelabsApiProxy(),
    tallyApiProxy(),
    {
      name: 'html-cache-bust',
      transformIndexHtml(html) {
        if (command !== 'build') return html
        return html.replace(
          '<head>',
          `<head>
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
    <meta http-equiv="Pragma" content="no-cache" />
    <meta http-equiv="Expires" content="0" />
    <!-- build ${new Date().toISOString()} -->`,
        )
      },
    },
  ],
}))
