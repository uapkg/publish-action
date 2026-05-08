import { readFile, stat } from 'node:fs/promises'

const MINIMUM_BUNDLE_BYTES = 500 * 1024

class SmokeCheckRunner {
  constructor(checks) {
    this.checks = checks
  }

  async run() {
    const failures = []

    for (const check of this.checks) {
      try {
        const message = await check.run()
        console.log(`PASS ${check.label}: ${message}`)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        failures.push(`${check.label}: ${detail}`)
      }
    }

    if (failures.length > 0) {
      throw new Error(`Release smoke checks failed:\n${failures.join('\n')}`)
    }
  }
}

class MinimumBundleSizeCheck {
  constructor(filePath, minimumBytes) {
    this.filePath = filePath
    this.minimumBytes = minimumBytes
    this.label = `${filePath} minimum size`
  }

  async run() {
    const file = await stat(this.filePath)

    if (file.size <= this.minimumBytes) {
      throw new Error(`${this.filePath} is ${file.size} bytes, expected more than ${this.minimumBytes} bytes`)
    }

    return `${file.size} bytes`
  }
}

class ActionEntrypointCheck {
  constructor(actionYamlPath) {
    this.actionYamlPath = actionYamlPath
    this.label = 'action.yml runtime entrypoint'
  }

  async run() {
    const actionYaml = await readFile(this.actionYamlPath, 'utf8')

    const entrypointMatch = /^\s*main:\s*(.+)\s*$/m.exec(actionYaml)
    if (!entrypointMatch) {
      throw new Error('runs.main was not found in action.yml')
    }

    const entrypoint = entrypointMatch[1].trim()
    if (entrypoint !== 'dist/index.js') {
      throw new Error(`runs.main must be dist/index.js, received ${entrypoint}`)
    }

    await stat(entrypoint)
    return `${entrypoint} exists`
  }
}

const checks = [
  new MinimumBundleSizeCheck('dist/index.js', MINIMUM_BUNDLE_BYTES),
  new MinimumBundleSizeCheck('dist/index.js.map', MINIMUM_BUNDLE_BYTES),
  new ActionEntrypointCheck('action.yml'),
]

await new SmokeCheckRunner(checks).run()
