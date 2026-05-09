import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'

const README_PATH = 'README.md'
const BADGES_START_MARKER = '<!-- badges:start -->'
const BADGES_END_MARKER = '<!-- badges:end -->'

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })

  if (result.status !== 0) {
    const renderedArgs = ['git', ...args].join(' ')
    throw new Error(
      [`Command failed: ${renderedArgs}`, result.stdout?.trim(), result.stderr?.trim()]
        .filter((line) => Boolean(line))
        .join('\n'),
    )
  }

  return result.stdout
}

function hasStagedReadme() {
  const result = spawnSync('git', ['diff', '--name-only', '--cached', '--', README_PATH], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    return false
  }

  return result.stdout.trim().length > 0
}

function extractBadgeBlock(content) {
  const start = content.indexOf(BADGES_START_MARKER)
  const end = content.indexOf(BADGES_END_MARKER)

  if (start < 0 || end < 0 || end < start) {
    return null
  }

  const blockEnd = end + BADGES_END_MARKER.length
  return {
    start,
    end: blockEnd,
    content: content.slice(start, blockEnd),
  }
}

async function restoreReadmeBadgeBlockFromHead() {
  const currentReadme = await readFile(README_PATH, 'utf8')
  const currentBlock = extractBadgeBlock(currentReadme)
  if (!currentBlock) {
    return
  }

  let headReadme
  try {
    headReadme = runGit(['show', `HEAD:${README_PATH}`])
  } catch {
    return
  }

  const headBlock = extractBadgeBlock(headReadme)
  if (!headBlock) {
    return
  }

  const updatedReadme = `${currentReadme.slice(0, currentBlock.start)}${headBlock.content}${currentReadme.slice(currentBlock.end)}`

  if (updatedReadme !== currentReadme) {
    await writeFile(README_PATH, updatedReadme, 'utf8')
    return true
  }

  return false
}

async function main() {
  if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') {
    return
  }

  const readmeWasStaged = hasStagedReadme()
  runGit(['restore', '--staged', '--worktree', '--', 'badges'])
  runGit(['clean', '-f', '--', 'badges'])
  const didUpdateReadmeBadgeBlock = await restoreReadmeBadgeBlockFromHead()

  if (readmeWasStaged && didUpdateReadmeBadgeBlock) {
    runGit(['add', '--', README_PATH])
  }
}

await main()
