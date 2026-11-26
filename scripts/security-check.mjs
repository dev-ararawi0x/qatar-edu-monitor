import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

function files(directory) {
  const out = []
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules' || name === '.tanstack' || name === 'dist') continue
    const path = join(directory, name)
    const stat = statSync(path)
    if (stat.isDirectory()) out.push(...files(path))
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(path)
  }
  return out
}

const failures = []
for (const file of files('apps/worker/src')) {
  const source = readFileSync(file, 'utf8').toLowerCase()
  if (source.includes('/finish/') || source.includes('final-submit') || source.includes('submitquizfinish')) {
    failures.push(`${file}: worker contains forbidden final-action capability`)
  }
}
for (const file of files('apps/web/src')) {
  const source = readFileSync(file, 'utf8')
  if (/sk-[A-Za-z0-9_-]{16,}|AIza[0-Za-z0-9_-]{20,}|-----BEGIN (RSA |EC )?PRIVATE KEY-----/.test(source)) {
    failures.push(`${file}: possible embedded secret material`)
  }
}
for (const file of files('packages/integrations/src')) {
  const source = readFileSync(file, 'utf8')
  if (/console\.(log|info|warn|error)\([^)]*(cookie|token|secret|apikey|api_key)/i.test(source)) {
    failures.push(`${file}: sensitive value appears in a log call`)
  }
}
const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n')
if (tracked.some((file) => /(^|\/)\.env($|\.)/.test(file) && !file.endsWith('.example'))) {
  failures.push('a non-example dotenv file is tracked by git')
}
if (tracked.some((file) => file.includes('apps/api/'))) {
  failures.push('a second API application is present; TanStack Start must remain the only HTTP backend')
}
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('Security invariant checks passed.')
