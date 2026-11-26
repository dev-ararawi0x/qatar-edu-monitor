import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function listFiles(directory, extensionPattern = /\.(ts|tsx)$/) {
  const entries = []
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    const stat = statSync(path)
    if (stat.isDirectory()) entries.push(...listFiles(path, extensionPattern))
    else if (extensionPattern.test(name)) entries.push(path)
  }
  return entries
}

function importsOf(file) {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(/(?:import|export)\s+(?:[^'";]+\s+from\s+)?['"]([^'"]+)['"]/g)].map(
    (match) => match[1],
  )
}

const failures = []

for (const file of listFiles('packages/domain/src')) {
  for (const specifier of importsOf(file)) {
    if (
      specifier.startsWith('@hallili/db') ||
      specifier.startsWith('@hallili/integrations') ||
      specifier.startsWith('@tanstack') ||
      specifier === 'drizzle-orm' ||
      specifier.startsWith('better-auth')
    ) {
      failures.push(`${file}: domain must not import infrastructure/framework (${specifier})`)
    }
  }
}

for (const file of listFiles('apps/worker/src')) {
  const source = readFileSync(file, 'utf8').toLowerCase()
  if (
    source.includes('submission') ||
    source.includes('final-submit') ||
    source.includes('/finish/')
  ) {
    failures.push(`${file}: worker must not import or reference final-submission capability`)
  }
}

for (const file of listFiles('apps/web/src/routes')) {
  for (const specifier of importsOf(file)) {
    if (specifier.startsWith('@hallili/db') || specifier.startsWith('@hallili/integrations')) {
      failures.push(
        `${file}: route files must not import infrastructure adapters directly (${specifier})`,
      )
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('Architecture dependency checks passed.')
