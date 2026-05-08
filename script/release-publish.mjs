import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import semver from 'semver'

const RELEASE_BRANCH = 'action-release'
const RELEASE_MARKER_FILE = '.release.json'
const RELEASE_FILES = ['action.yml', 'README.md', 'LICENSE', 'badges', 'dist']

class CommandRunner {
  run(command, args, options = {}) {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    if (options.allowFailure) {
      return result
    }

    if (result.status !== 0) {
      const renderedArgs = [command, ...args].join(' ')
      throw new Error(
        [`Command failed: ${renderedArgs}`, result.stdout?.trim(), result.stderr?.trim()]
          .filter((line) => Boolean(line))
          .join('\n'),
      )
    }

    return result
  }

  git(args, options = {}) {
    return this.run('git', args, options)
  }

  npm(args, options = {}) {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    return this.run(npmCommand, args, options)
  }
}

class ReleaseContextReader {
  constructor(repoRoot, commandRunner) {
    this.repoRoot = repoRoot
    this.commandRunner = commandRunner
  }

  async read() {
    const packageJson = JSON.parse(await readFile(join(this.repoRoot, 'package.json'), 'utf8'))

    const version = packageJson.version
    if (!semver.valid(version)) {
      throw new Error(`package.json version is not a valid semantic version: ${version}`)
    }

    const sourceCommit = this.commandRunner.git(['rev-parse', 'HEAD'], { cwd: this.repoRoot }).stdout.trim()

    return {
      version,
      tag: `v${version}`,
      majorTag: `v${semver.major(version)}`,
      sourceCommit,
      sourceRef: process.env.GITHUB_REF ?? 'refs/heads/main',
      builtAt: Math.floor(Date.now() / 1000),
    }
  }
}

class GitTagResolver {
  constructor(repoRoot, commandRunner) {
    this.repoRoot = repoRoot
    this.commandRunner = commandRunner
  }

  fetchTags() {
    this.commandRunner.git(['fetch', '--tags', 'origin'], { cwd: this.repoRoot })
  }

  hasRemoteTag(tag) {
    const result = this.commandRunner.git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], { cwd: this.repoRoot })

    return result.stdout.trim().length > 0
  }

  listSemverVersions(tagPattern) {
    const tagOutput = this.commandRunner.git(['tag', '--list', tagPattern], { cwd: this.repoRoot }).stdout.trim()

    return tagOutput
      .split('\n')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .map((tag) => tag.replace(/^v/, ''))
      .filter((tag) => semver.valid(tag))
  }

  resolveMajorTagTarget(version) {
    const major = semver.major(version)
    const versions = this.listSemverVersions(`v${major}.*.*`)

    versions.push(version)

    const maxVersion = semver.maxSatisfying(versions, `${major}.x`)
    if (!maxVersion) {
      throw new Error(`Unable to resolve max satisfying version for major ${major}`)
    }

    return `v${maxVersion}`
  }

  resolveLatestTag(version) {
    const versions = this.listSemverVersions('v*.*.*')
    versions.push(version)

    const latestVersion = semver.rsort(versions)[0]
    if (!latestVersion) {
      throw new Error('Unable to resolve latest release version from tags')
    }

    return `v${latestVersion}`
  }
}

class ReleaseArtifactBuilder {
  constructor(repoRoot, commandRunner) {
    this.repoRoot = repoRoot
    this.commandRunner = commandRunner
  }

  buildAndSmokeCheck(context) {
    this.commandRunner.npm(['run', 'test'], { cwd: this.repoRoot })
    this.commandRunner.npm(['run', 'badge:make:all'], {
      cwd: this.repoRoot,
      env: {
        BADGE_SOURCE_SHA: context.sourceCommit,
        BADGE_TEST_STATUS: 'passing',
        BADGE_VERSION: context.version,
      },
    })
    this.commandRunner.npm(['run', 'package'], { cwd: this.repoRoot })
    this.commandRunner.npm(['run', 'smoke:release'], { cwd: this.repoRoot })
  }
}

class ReleaseWorktreePublisher {
  constructor(repoRoot, commandRunner) {
    this.repoRoot = repoRoot
    this.commandRunner = commandRunner
  }

  async publish(context, majorTargetTag, latestTag, isLatestRelease) {
    const worktreePath = await mkdtemp(join(tmpdir(), 'publish-action-release-'))

    this.commandRunner.git(['worktree', 'add', '--detach', worktreePath], {
      cwd: this.repoRoot,
    })

    try {
      this.commandRunner.git(['checkout', '--orphan', RELEASE_BRANCH], {
        cwd: worktreePath,
      })

      this.commandRunner.git(['rm', '-rf', '.'], {
        cwd: worktreePath,
        allowFailure: true,
      })

      for (const file of RELEASE_FILES) {
        await cp(join(this.repoRoot, file), join(worktreePath, file), {
          recursive: true,
        })
      }

      const releaseMetadata = {
        version: context.version,
        sourceCommit: context.sourceCommit,
        sourceRef: context.sourceRef,
        builtAt: context.builtAt,
        isLatestRelease,
        latestTag,
        tag: context.tag,
        majorTag: context.majorTag,
        majorTagTarget: majorTargetTag,
        releaseBranch: RELEASE_BRANCH,
      }

      await writeFile(join(worktreePath, '.release.json'), `${JSON.stringify(releaseMetadata, null, 2)}\n`, 'utf8')

      this.commandRunner.git(['add', ...RELEASE_FILES, '.release.json'], {
        cwd: worktreePath,
      })

      this.commandRunner.git(['commit', '-m', `release: ${context.tag}`], {
        cwd: worktreePath,
      })

      this.commandRunner.git(['tag', '-a', context.tag, '-m', `${context.tag} release`], {
        cwd: worktreePath,
      })

      this.commandRunner.git(['push', 'origin', `${RELEASE_BRANCH}:${RELEASE_BRANCH}`, '--force'], {
        cwd: worktreePath,
      })

      this.commandRunner.git(['push', 'origin', context.tag], { cwd: worktreePath })

      const majorTargetCommit = this.commandRunner
        .git(['rev-list', '-n', '1', majorTargetTag], {
          cwd: worktreePath,
        })
        .stdout.trim()

      this.commandRunner.git(
        ['tag', '-fa', context.majorTag, majorTargetCommit, '-m', `sync ${context.majorTag} to ${majorTargetTag}`],
        { cwd: worktreePath },
      )

      this.commandRunner.git(['push', 'origin', context.majorTag, '--force'], {
        cwd: worktreePath,
      })

      return {
        ...releaseMetadata,
      }
    } finally {
      this.commandRunner.git(['worktree', 'remove', worktreePath, '--force'], {
        cwd: this.repoRoot,
        allowFailure: true,
      })

      await rm(worktreePath, { recursive: true, force: true })
    }
  }
}

class ReleasePublisher {
  constructor(repoRoot) {
    this.repoRoot = repoRoot
    this.commandRunner = new CommandRunner()
    this.contextReader = new ReleaseContextReader(repoRoot, this.commandRunner)
    this.tagResolver = new GitTagResolver(repoRoot, this.commandRunner)
    this.builder = new ReleaseArtifactBuilder(repoRoot, this.commandRunner)
    this.worktreePublisher = new ReleaseWorktreePublisher(repoRoot, this.commandRunner)
  }

  async publish() {
    const markerPath = join(this.repoRoot, RELEASE_MARKER_FILE)
    await rm(markerPath, { force: true })

    const context = await this.contextReader.read()

    this.tagResolver.fetchTags()

    if (this.tagResolver.hasRemoteTag(context.tag)) {
      console.log(`No release needed. ${context.tag} already exists on origin.`)
      return
    }

    const latestTag = this.tagResolver.resolveLatestTag(context.version)
    const isLatestRelease = latestTag === context.tag

    this.builder.buildAndSmokeCheck(context)

    this.tagResolver.fetchTags()
    const majorTargetTag = this.tagResolver.resolveMajorTagTarget(context.version)

    const releaseInfo = await this.worktreePublisher.publish(context, majorTargetTag, latestTag, isLatestRelease)

    await writeFile(markerPath, `${JSON.stringify(releaseInfo, null, 2)}\n`, 'utf8')

    console.log(
      `Published ${context.tag}. Latest release: ${isLatestRelease}. Mutable tag ${context.majorTag} now points to ${majorTargetTag}.`,
    )
  }
}

const repoRoot = resolve(process.cwd())
const publisher = new ReleasePublisher(repoRoot)
await publisher.publish()
