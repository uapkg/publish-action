import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeBadge } from 'badge-maker'

const BADGES_DIR = 'badges'

function getCurrentShortSha() {
  const result = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    return 'unknown'
  }

  const value = result.stdout.trim()
  return value.length > 0 ? value : 'unknown'
}

async function getPackageVersion() {
  const raw = await readFile('package.json', 'utf8')
  const packageJson = JSON.parse(raw)
  return packageJson.version
}

async function writeSvgBadge(fileName, label, message, color) {
  await mkdir(BADGES_DIR, { recursive: true })

  const svg = makeBadge({
    label,
    message,
    color,
    style: 'flat',
  })

  await writeFile(join(BADGES_DIR, fileName), `${svg}\n`, 'utf8')
}

async function makeVersionBadge() {
  const version = process.env.BADGE_VERSION ?? (await getPackageVersion())
  await writeSvgBadge('version.svg', 'version', `v${version}`, 'blue')
}

async function makeTestBadge() {
  const status = (process.env.BADGE_TEST_STATUS ?? 'passing').toLowerCase()
  const color = status === 'passing' ? 'brightgreen' : 'red'
  await writeSvgBadge('test.svg', 'tests', status, color)
}

async function makeShaBadge() {
  const sourceSha = process.env.BADGE_SOURCE_SHA ?? getCurrentShortSha()
  const shortSha = sourceSha.slice(0, 12)
  await writeSvgBadge('source-sha.svg', 'source', shortSha, 'lightgrey')
}

const mode = process.argv[2]

switch (mode) {
  case 'version':
    await makeVersionBadge()
    break
  case 'test':
    await makeTestBadge()
    break
  case 'sha':
    await makeShaBadge()
    break
  default:
    throw new Error(`Unsupported badge mode: ${mode}. Expected one of: version, test, sha.`)
}
