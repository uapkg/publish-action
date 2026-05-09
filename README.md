# @uapkg/publish-action

<!-- badges:start -->
[![Test](https://github.com/uapkg/publish-action/actions/workflows/test.yml/badge.svg)](https://github.com/uapkg/publish-action/actions/workflows/test.yml)
[![Coverage](./badges/coverage.svg)](https://github.com/uapkg/publish-action/actions/workflows/test.yml)
[![Version](./badges/version.svg)](https://github.com/uapkg/publish-action/releases/tag/v1.0.2)
[![Source SHA](./badges/source-sha.svg)](https://github.com/uapkg/publish-action/tree/7eeb4f61a15e)
<!-- badges:end -->

TypeScript GitHub Action that submits a UAPKG publish request to a registry
repository by creating or reusing a GitHub issue.

This action does not publish packages directly.

## Scope

This action is only responsible for:

1. Reading publish metadata from `uapkg.json`.
1. Resolving the release tag/ref.
1. Verifying exactly one publishable release asset exists.
1. Creating or reusing a registry issue.
1. Returning issue details as outputs.

The registry bot owns validation and actual publishing.

## Inputs

### `token`

- Required: `true`
- GitHub token used to search/create issues in the target registry repository.

### `registry-repo`

- Required: `false`
- Default: `uapkg/registry`
- Target registry repository in `owner/name` form.

### `manifest-path`

- Required: `false`
- Default: `uapkg.json`
- Path to the package manifest.

### `release-tag`

- Required: `false`
- Explicit release tag/ref to publish.

Release resolution order:

1. Explicit `release-tag`
1. `github.event.release.tag_name`
1. `github.ref_name` when `github.ref_type == tag`
1. Fail

### `existing-request-policy`

- Required: `false`
- Default: `reuse-existing`
- Allowed values:
  - `create-new`
  - `reuse-existing`
  - `fail-if-existing`

Behavior:

- `create-new`: always create a new issue.
- `reuse-existing`: find an open matching issue by token user; reuse if found,
  otherwise create.
- `fail-if-existing`: same lookup as `reuse-existing`, but fail if found.

## Outputs

- `issue-number`: registry issue number
- `issue-url`: registry issue URL
- `issue-state`: `created` or `existing`
- `package-name`: package name from `uapkg.json`
- `package-version`: package version from `uapkg.json`
- `package-source`: package source in `owner/repo` form (from
  `GITHUB_REPOSITORY`)
- `release-tag`: resolved release tag/ref

## Release Asset Discovery

Before creating or reusing a publish request, the action checks release assets
for the resolved release tag in the source repository.

Accepted asset names:

- `package.tgz`
- `<package-name>.tgz`
- `<package-name>@<package-version>.tgz`

Rules:

- No matching asset: fail.
- More than one matching asset: fail (ambiguous).
- Asset content is not downloaded or validated.

## Issue Identity

Canonical issue title:

`[publish] <package-name>@<package-version>`

Issue body:

```md
### Package Name

my-package

### Version

1.2.0

### Source

org/repo

### Ref

v1.2.0
```

Existing issue lookup uses open issues authored by the token user.

## Job Summary

This action appends a Markdown summary to `GITHUB_STEP_SUMMARY`.

- It does not overwrite prior step summaries.
- It includes success/failure status, package/ref context, issue details, and
  diagnostic counts.

GitHub uploads one summary per step and then aggregates all step summaries into
the job summary view.

## Example Usage

```yaml
name: Publish UAPKG

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read

    steps:
      - uses: actions/checkout@v4

      - name: Submit UAPKG publish request
        id: publish
        uses: uapkg/publish-action@v1
        with:
          token: ${{ secrets.UAPKG_PUBLISH_TOKEN }}

      - name: Print publish issue
        run: echo "Issue URL: ${{ steps.publish.outputs.issue-url }}"
```

## Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm run test
```

Lint the repository:

```bash
npm run lint
```

Fix lint issues where possible:

```bash
npm run lint:fix
```

Check formatting:

```bash
npm run format:check
```

Write formatting fixes:

```bash
npm run format:write
```

Linting and formatting stack:

- Biome for JavaScript, TypeScript, JSON, and related files.
- `actionlint` for GitHub Actions workflows.
- Prettier with default settings for YAML (`*.yml`, `*.yaml`).

Husky pre-commit hook runs `npm run lint` locally.

Bundle the action:

```bash
npm run bundle
```

Run release smoke checks:

```bash
npm run smoke:release
```

## Release Process

This repository uses Changesets to automate release pull requests and publishing.

Create a changeset for release-worthy changes:

```bash
npm run changeset
```

When changesets are merged to `main`, the release workflow:

1. Opens or updates a release PR with version bumps.
1. Publishes a release after that PR is merged.
1. Runs tests and regenerates release badges (`coverage`, `version`, `test`, and `source-sha`).
1. Builds `dist/index.js` and `dist/index.js.map`.
1. Runs release smoke checks.
1. Creates an orphan-branch release commit (`action-release`) with:
  - `action.yml`
  - `badges/`
  - `dist/`
  - `README.md`
  - `LICENSE`
  - `.release.json` metadata
1. Updates `badges/` on `main` only when the published version is the semver-latest release.
1. Pushes:
  - immutable tag `vX.Y.Z`
  - mutable major tag `vX` (semver-max target for that major)
1. Creates a GitHub release using `softprops/action-gh-release`.

`dist/` is intentionally not tracked on `main`.

Source maps are always generated for release bundles.
