import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeBadge } from 'badge-maker'
import ci from 'ci-info'

const BADGES_DIR = 'badges'
const README_PATH = 'README.md'
const BADGES_START_MARKER = '<!-- badges:start -->'
const BADGES_END_MARKER = '<!-- badges:end -->'
const DEFAULT_REPOSITORY = process.env.BADGE_REPOSITORY ?? 'uapkg/publish-action'
const ALLOW_LOCAL_BADGE_MUTATION = process.env.BADGE_ALLOW_LOCAL === 'true'

function shouldMutateBadgeFiles() {
  return ci.GITHUB_ACTIONS || ALLOW_LOCAL_BADGE_MUTATION
}

function assertBadgeMutationAllowed(mode) {
  if (shouldMutateBadgeFiles()) {
    return
  }

  console.log(`Skipping badge mutation for mode '${mode}' outside GitHub Actions.`)
  console.log('Set BADGE_ALLOW_LOCAL=true to explicitly allow local badge updates.')
  process.exit(0)
}

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

async function makeCoverageBadge() {
  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const result = spawnSync(npxCommand, ['make-coverage-badge', '--output-path', './badges/coverage.svg'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${npxCommand} make-coverage-badge --output-path ./badges/coverage.svg`,
        result.stdout?.trim(),
        result.stderr?.trim(),
      ]
        .filter((line) => Boolean(line))
        .join('\n'),
    )
  }

  if (result.stdout.trim().length > 0) {
    console.log(result.stdout.trim())
  }
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

async function updateReadmeBadgeLinks() {
  const version = process.env.BADGE_VERSION ?? (await getPackageVersion())
  const sourceSha = process.env.BADGE_SOURCE_SHA ?? getCurrentShortSha()

  const testWorkflowUrl = `https://github.com/${DEFAULT_REPOSITORY}/actions/workflows/test.yml`
  const releaseUrl = `https://github.com/${DEFAULT_REPOSITORY}/releases/tag/v${version}`
  const sourceTreeUrl = `https://github.com/${DEFAULT_REPOSITORY}/tree/${sourceSha}`

  const badgeBlock = [
    BADGES_START_MARKER,
    `[![Test](${testWorkflowUrl}/badge.svg)](${testWorkflowUrl})`,
    `[![Coverage](./badges/coverage.svg)](${testWorkflowUrl})`,
    `[![Version](./badges/version.svg)](${releaseUrl})`,
    `[![Source SHA](./badges/source-sha.svg)](${sourceTreeUrl})`,
    BADGES_END_MARKER,
  ].join('\n')

  const readme = await readFile(README_PATH, 'utf8')
  const escapedStart = BADGES_START_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedEnd = BADGES_END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blockPattern = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`)

  if (!blockPattern.test(readme)) {
    throw new Error(`README badge markers not found in ${README_PATH}`)
  }

  const updatedReadme = readme.replace(blockPattern, badgeBlock)
  await writeFile(README_PATH, `${updatedReadme.endsWith('\n') ? updatedReadme : `${updatedReadme}\n`}`, 'utf8')
}

const mode = process.argv[2]

switch (mode) {
  case 'coverage':
    assertBadgeMutationAllowed(mode)
    await makeCoverageBadge()
    break
  case 'version':
    assertBadgeMutationAllowed(mode)
    await makeVersionBadge()
    break
  case 'test':
    assertBadgeMutationAllowed(mode)
    await makeTestBadge()
    break
  case 'sha':
    assertBadgeMutationAllowed(mode)
    await makeShaBadge()
    break
  case 'links':
    assertBadgeMutationAllowed(mode)
    await updateReadmeBadgeLinks()
    break
  default:
    throw new Error(`Unsupported badge mode: ${mode}. Expected one of: coverage, version, test, sha, links.`)
}
