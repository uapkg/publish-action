# @uapkg/publish-action

TypeScript GitHub Action that submits a UAPKG publish request to a registry
repository by creating or reusing a GitHub issue.

This action does not publish packages directly.

## Scope

This action is only responsible for:

1. Reading publish metadata from `uapkg.json`.
2. Resolving the release tag/ref.
3. Verifying exactly one publishable release asset exists.
4. Creating or reusing a registry issue.
5. Returning issue details as outputs.

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
2. `github.event.release.tag_name`
3. `github.ref_name` when `github.ref_type == tag`
4. Fail

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

This action appends a markdown summary to `GITHUB_STEP_SUMMARY`.

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

Bundle the action:

```bash
npm run bundle
```

The bundled output in `dist/` is generated code and should be refreshed after
source changes.
