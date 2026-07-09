import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Cash-counter/' : '/',
  plugins: [
    react(),
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
