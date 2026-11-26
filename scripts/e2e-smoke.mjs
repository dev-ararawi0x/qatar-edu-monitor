import { spawn } from 'node:child_process'

const port = Number(process.env.E2E_PORT ?? 4317)
const base = `http://127.0.0.1:${port}`
const env = {
  ...process.env,
  PORT: String(port),
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://hallili:hallili@localhost:5432/hallili',
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'e2e-smoke-secret-e2e-smoke-secret',
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? base,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
}
const child = spawn(process.execPath, ['apps/web/.output/server/index.mjs'], { env, stdio: 'ignore' })
let output = ''
function stop() { if (!child.killed) child.kill('SIGTERM') }
process.on('exit', stop)
async function waitReady() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/v1/health`)
      if (response.ok) return
    } catch { /* retry until deadline */ }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`web server did not become ready\n${output}`)
}
async function expectStatus(path, expected) {
  const response = await fetch(`${base}${path}`)
  if (response.status !== expected) throw new Error(`${path}: expected ${expected}, received ${response.status}`)
  return response
}
try {
  await waitReady()
  const health = await expectStatus('/api/v1/health', 200)
  const healthBody = await health.json()
  if (healthBody.status !== 'ok') throw new Error('health payload did not report ok')
  for (const path of ['/api/v1/lms-connection', '/api/v1/jobs', '/api/v1/metrics']) {
    const response = await expectStatus(path, 401)
    const body = await response.json()
    if (body.error?.code !== 'UNAUTHENTICATED') throw new Error(`${path}: missing stable unauthenticated envelope`)
  }
  console.log('E2E smoke security checks passed.')
  child.kill('SIGKILL')
  process.exit(0)
} finally {
  stop()
}
