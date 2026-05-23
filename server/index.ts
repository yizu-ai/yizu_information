import 'dotenv/config'

import { createServer as createViteServer } from 'vite'

import { createApp } from './app'

const port = Number(process.env.PORT ?? 18765)
const app = createApp()

const vite = await createViteServer({
  appType: 'spa',
  server: {
    middlewareMode: true,
    watch: {
      ignored: ['**/data/**'],
    },
  },
})

app.use(vite.middlewares)

app.listen(port, () => {
  console.log(`Daily report is running at http://localhost:${port}`)
})
