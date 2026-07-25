import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PublishMetadataReader } from '../src/services/PublishMetadataReader.js'

describe('PublishMetadataReader', () => {
  const envSnapshot = { ...process.env }

  beforeEach(() => {
    process.env = { ...envSnapshot, GITHUB_REPOSITORY: 'org/source-repo' }
  })

  afterAll(() => {
    process.env = envSnapshot
  })

  it('reads package coordinates from a repository-relative manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'publish-action-metadata-'))
    try {
      await writeFile(
        join(directory, 'uapkg.json'),
        JSON.stringify({ name: 'my-package', version: '1.2.0', kind: 'plugin' }),
        'utf8',
      )

      const result = await new PublishMetadataReader(undefined, () => directory).read('uapkg.json')
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value).toEqual({
        packageName: 'my-package',
        packageVersion: '1.2.0',
        packageSource: 'org/source-repo',
        manifestPath: 'uapkg.json',
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each([
    '../uapkg.json',
    'package/../uapkg.json',
    '/workspace/uapkg.json',
    'C:/workspace/uapkg.json',
    'manifest.json',
    'package\\uapkg.json',
  ])('rejects unsafe manifest path %s', async (manifestPath) => {
    const result = await new PublishMetadataReader().read(manifestPath)
    expect(result.ok).toBe(false)
  })

  it('fails when manifest validation fails', async () => {
    const reader = new PublishMetadataReader({
      async read() {
        return {
          ok: false as const,
          diagnostics: [
            {
              level: 'error' as const,
              code: 'MANIFEST_READ_ERROR',
              message: 'Manifest read failed',
              data: { filePath: 'uapkg.json', reason: 'missing file' },
            },
          ],
        }
      },
    } as never)
    expect((await reader.read('uapkg.json')).ok).toBe(false)
  })

  it('rejects a missing or malformed GitHub repository identity', async () => {
    delete process.env.GITHUB_REPOSITORY
    const reader = new PublishMetadataReader({
      async read() {
        return {
          ok: true as const,
          value: { name: 'my-package', version: '1.2.0', kind: 'plugin' as const },
          diagnostics: [],
        }
      },
    } as never)

    const result = await reader.read('uapkg.json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics[0]?.code).toBe('PUBLISH_ACTION_SOURCE_INVALID')
  })
})
