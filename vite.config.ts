import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync, statSync } from 'fs'
import { extname, join } from 'path'
import { fileURLToPath } from 'url'

const root = fileURLToPath(new URL('.', import.meta.url))

const mimeTypes: Record<string, string> = {
  '.js': 'application/javascript',
  '.wasm': 'application/wasm',
  '.ktx2': 'image/ktx2',
  '.atlas': 'text/plain',
  '.skel': 'application/octet-stream',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'serve-local-dirs',
      configureServer(server) {
        for (const dir of ['cc', 'highs']) {
          server.middlewares.use(`/${dir}`, (req, res, next) => {
            const filePath = join(root, dir, req.url ?? '/')
            if (existsSync(filePath) && statSync(filePath).isFile()) {
              res.setHeader('Content-Type', mimeTypes[extname(filePath)] ?? 'application/octet-stream')
              createReadStream(filePath).pipe(res)
            } else {
              next()
            }
          })
        }
      },
    },
  ],
})
