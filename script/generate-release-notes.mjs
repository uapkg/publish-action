import { readFile, writeFile } from 'node:fs/promises'

const RELEASE_METADATA_PATH = '.release.json'
const CHANGELOG_PATH = 'CHANGELOG.md'
const RELEASE_NOTES_PATH = '.release-notes.md'

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractVersionSection(changelogContent, version) {
  const lines = changelogContent.split('\n')
  const versionHeadingPattern = new RegExp(`^##\\s+${escapeRegExp(version)}(?:\\s|$)`)
  const anyVersionHeadingPattern = /^##\s+\d+\.\d+\.\d+(?:\s|$)/

  const startIndex = lines.findIndex((line) => versionHeadingPattern.test(line))
  if (startIndex < 0) {
    return null
  }

  let endIndex = lines.length
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (anyVersionHeadingPattern.test(lines[index])) {
      endIndex = index
      break
    }
  }

  return lines.slice(startIndex, endIndex).join('\n').trim()
}

async function main() {
  const metadataRaw = await readFile(RELEASE_METADATA_PATH, 'utf8')
  const metadata = JSON.parse(metadataRaw)

  const tag = metadata.tag
  const version = String(tag).replace(/^v/, '')
  const sourceCommit = metadata.sourceCommit
  const repository = process.env.GITHUB_REPOSITORY ?? 'uapkg/publish-action'

  const changelog = await readFile(CHANGELOG_PATH, 'utf8')
  const changelogSection = extractVersionSection(changelog, version)

  if (!changelogSection) {
    throw new Error(`Could not find changelog section for version ${version} in ${CHANGELOG_PATH}`)
  }

  const badgeBaseUrl = `https://raw.githubusercontent.com/${repository}/${tag}/badges`
  const versionBadge = `[![Version](${badgeBaseUrl}/version.svg)](https://github.com/${repository}/releases/tag/${tag})`
  const sourceShaBadge = `[![Source SHA](${badgeBaseUrl}/source-sha.svg)](https://github.com/${repository}/tree/${sourceCommit})`

  const releaseNotes = [versionBadge, sourceShaBadge, '', changelogSection, ''].join('\n')
  await writeFile(RELEASE_NOTES_PATH, releaseNotes, 'utf8')
}

await main()
