import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execFileSync } from 'node:child_process'

function getBuildCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() || 'dev'
  } catch {
    return 'dev'
  }
}

function getJstBuildDate() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export default defineConfig({
  base: '/one-hand-typing-trainer/',
  define: {
    __BUILD_COMMIT__: JSON.stringify(getBuildCommit()),
    __BUILD_DATE__: JSON.stringify(getJstBuildDate()),
  },
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
  },
})
