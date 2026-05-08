import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PublishMetadataReader } from '../src/services/PublishMetadataReader.js'

describe('PublishMetadataReader', () => {
  const envSnapshot = { ...process.env }

  beforeEach(() => {
    process.env = { ...envSnapshot }
    process.env.GITHUB_REPOSITORY = 'org/source-repo'
  })

  afterAll(() => {
    process.env = envSnapshot
  })

  it('reads package metadata from uapkg.json', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'publish-action-metadata-'))

    try {
      const manifestPath = join(directory, 'uapkg.json')
      await writeFile(
        manifestPath,
        JSON.stringify({
          name: 'my-package',
          version: '1.2.0',
          kind: 'plugin',
        }),
        'utf8',
      )

      const reader = new PublishMetadataReader(undefined, () => directory)
      const result = await reader.read('uapkg.json', 'v1.2.0')

      expect(result.ok).toBe(true)
      if (!result.ok) {
        return
      }

      expect(result.value.packageName).toBe('my-package')
      expect(result.value.packageVersion).toBe('1.2.0')
      expect(result.value.packageSource).toBe('org/source-repo')
      expect(result.value.releaseTag).toBe('v1.2.0')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('fails when manifest file name is not uapkg.json', async () => {
    const reader = new PublishMetadataReader()
    const result = await reader.read('manifest.json', 'v1.0.0')

    expect(result.ok).toBe(false)
  })

  it('fails when manifest reader returns diagnostics', async () => {
    const reader = new PublishMetadataReader(
      {
        async read() {
          return {
            ok: false as const,
            diagnostics: [
              {
                level: 'error' as const,
                code: 'MANIFEST_READ_ERROR',
                message: 'Manifest read failed',
                data: {
                  filePath: 'uapkg.json',
                  reason: 'missing file',
                },
              },
            ],
          }
        },
      } as never,
      () => process.cwd(),
    )

    const result = await reader.read('uapkg.json', 'v1.0.0')

    expect(result.ok).toBe(false)
  })

  it('fails when GITHUB_REPOSITORY is missing', async () => {
    delete process.env.GITHUB_REPOSITORY

    const reader = new PublishMetadataReader(
      {
        async read() {
          return {
            ok: true as const,
            value: {
              name: 'my-package',
              version: '1.2.0',
              kind: 'plugin' as const,
            },
            diagnostics: [],
          }
        },
      } as never,
      () => process.cwd(),
    )

    const result = await reader.read('uapkg.json', 'v1.0.0')

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }

    expect(result.diagnostics[0]?.code).toBe('PUBLISH_ACTION_SOURCE_MISSING')
  })
})
