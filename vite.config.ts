// Vite 与 Vitest 联合配置：启用 React 与 Tailwind CSS 插件，忽略 data 目录监听并配置 @ 路径别名
import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      ignored: ['**/data/**'],
    },
  },
  test: {
    exclude: ['node_modules/**', 'dist/**', 'tmp/**', 'tmp-cjs/**', 'tmp-tsc-node/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
