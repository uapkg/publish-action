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
    const result = await resolver.resolve('v1.2.3')

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
      await writeFile(
        eventPath,
        JSON.stringify({ release: { tag_name: 'v9.0.0' } }),
        'utf8'
      )

      process.env.GITHUB_EVENT_PATH = eventPath

      const resolver = new ReleaseTagResolver()
      const result = await resolver.resolve()

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
    const result = await resolver.resolve()

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.value).toBe('v2.3.4')
  })

  it('fails when no release tag source exists', async () => {
    const resolver = new ReleaseTagResolver()
    const result = await resolver.resolve()

    expect(result.ok).toBe(false)
  })
})
