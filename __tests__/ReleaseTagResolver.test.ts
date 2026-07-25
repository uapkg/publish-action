import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ReleaseTagResolver } from '../src/services/ReleaseTagResolver.js'

describe('ReleaseTagResolver', () => {
  const envSnapshot = { ...process.env }

  beforeEach(() => {
    process.env = { ...envSnapshot }
    delete process.env.GITHUB_EVENT_PATH
    delete process.env.GITHUB_REF_TYPE
    delete process.env.GITHUB_REF_NAME
  })

  afterAll(() => {
    process.env = envSnapshot
  })

  it('prefers explicit release-tag input', async () => {
    const resolver = new ReleaseTagResolver()
    const result = await resolver.resolve('v1.2.3', '9.9.9')

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.value).toBe('v1.2.3')
  })

  it('resolves release tag from release event payload', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'publish-action-'))

    try {
      const eventPath = join(directory, 'event.json')
      await writeFile(eventPath, JSON.stringify({ release: { tag_name: 'v9.0.0' } }), 'utf8')

      process.env.GITHUB_EVENT_PATH = eventPath

      const resolver = new ReleaseTagResolver()
      const result = await resolver.resolve(undefined, '1.2.3')

      expect(result.ok).toBe(true)
      if (!result.ok) {
        return
      }

      expect(result.value).toBe('v9.0.0')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('falls back to tag ref metadata', async () => {
    process.env.GITHUB_REF_TYPE = 'tag'
    process.env.GITHUB_REF_NAME = 'v2.3.4'

    const resolver = new ReleaseTagResolver()
    const result = await resolver.resolve(undefined, '1.2.3')

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.value).toBe('v2.3.4')
  })

  it('falls back to v-prefixed manifest SemVer', async () => {
    const resolver = new ReleaseTagResolver()
    const result = await resolver.resolve(undefined, '1.2.3-beta.1')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('v1.2.3-beta.1')
  })

  it('fails when no release tag source exists and manifest version is unsuitable', async () => {
    const resolver = new ReleaseTagResolver()
    const result = await resolver.resolve(undefined, 'not-semver')

    expect(result.ok).toBe(false)
  })

  it('adds a warning when event payload file cannot be read', async () => {
    process.env.GITHUB_EVENT_PATH = join(tmpdir(), 'publish-action-event-does-not-exist.json')

    const resolver = new ReleaseTagResolver()
    const result = await resolver.resolve(undefined, 'not-semver')

    expect(result.ok).toBe(false)
    expect(result.diagnostics.some((d) => (d.code as string) === 'PUBLISH_ACTION_EVENT_PAYLOAD_READ_WARNING')).toBe(
      true,
    )
  })

  it('adds a warning when event payload is invalid json', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'publish-action-bad-json-'))

    try {
      const eventPath = join(directory, 'event.json')
      await writeFile(eventPath, '{invalid-json', 'utf8')
      process.env.GITHUB_EVENT_PATH = eventPath

      const resolver = new ReleaseTagResolver()
      const result = await resolver.resolve(undefined, 'not-semver')

      expect(result.ok).toBe(false)
      expect(result.diagnostics.some((d) => (d.code as string) === 'PUBLISH_ACTION_EVENT_PAYLOAD_PARSE_WARNING')).toBe(
        true,
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
