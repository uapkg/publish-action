# @uapkg/publish-action

<!-- badges:start -->
[![Test](https://github.com/uapkg/publish-action/actions/workflows/test.yml/badge.svg)](https://github.com/uapkg/publish-action/actions/workflows/test.yml)
[![Coverage](./badges/coverage.svg)](https://github.com/uapkg/publish-action/actions/workflows/test.yml)
[![Version](./badges/version.svg)](https://github.com/uapkg/publish-action/releases/tag/v1.0.4)
[![Source SHA](./badges/source-sha.svg)](https://github.com/uapkg/publish-action/tree/58bfc618e7bc705c50cc381d7a209b05783a648b)
<!-- badges:end -->

GitHub Action for publishing an existing UAPKG package with a configured
GitHub Actions OIDC trusted-publisher rule.

The action has no token or password input. It obtains a short-lived GitHub
Actions identity token for the fixed `uapkg` audience and exchanges it with
the pinned UAPKG control plane. A rejected OIDC identity fails the action;
there is no fallback to a stored credential.

## Security model

This action:

1. Reads the package name and version from `uapkg.json`.
1. Resolves a GitHub Release tag.
1. Exchanges `core.getIDToken('uapkg')` for a short-lived UAPKG OIDC session.
1. Submits only the GitHub Release repository, tag, asset name, and manifest
   path to the UAPKG control plane.
1. Waits for the registry request to reach a terminal state, unless detached.

The submission idempotency key is a non-secret hash of `GITHUB_RUN_ID`,
`GITHUB_JOB`, and the exact publish coordinates. Re-running the same workflow
run can therefore reconcile an ambiguous network result without creating a
second request; changing the coordinates produces a different key.

The action does not download or validate the release asset, calculate or
submit a digest, upload package content, create a GitHub issue, or mutate a
registry repository. The server uses the UAPKG GitHub User App installation
to resolve and pin the release, commit, tree, asset, GitHub-provided digest,
and manifest before authorizing publication.

Trusted publishing is exact-package-only. The package must already exist and
have a matching trusted-publisher rule. Initial package publication is a human
workflow and cannot be bootstrapped by this action.

## Prerequisites

- Create the package through an attended UAPKG publication.
- Install the UAPKG GitHub User App on the source repository.
- Configure a GitHub Actions trusted-publisher rule for the exact registry,
  package, repository identity, workflow, and applicable ref/environment/event
  policy.
- Grant the workflow `id-token: write`. `contents: read` is normally also
  needed by `actions/checkout`.

No UAPKG token is stored in GitHub secrets.

## Inputs

### `registry-id`

- Required: `true`
- Canonical UUID of the target UAPKG registry.

This is a non-secret stable identifier, not a registry alias or Git repository.

### `manifest-path`

- Required: `false`
- Default: `uapkg.json`
- Repository-relative path to the package manifest.

The path must remain inside the repository and end in `uapkg.json`.

### `release-tag`

- Required: `false`
- GitHub Release tag to publish.

Resolution order:

1. Explicit `release-tag`.
1. `github.event.release.tag_name`.
1. `github.ref_name` when `github.ref_type == tag`.
1. `v<version>` when the manifest version is valid SemVer.

### `asset`

- Required: `false`
- Default: `package.tgz`
- Exact GitHub Release asset name.

This is a coordinate only. The UAPKG server resolves and verifies the asset.

### `detach`

- Required: `false`
- Default: `false`
- When `true`, return after the request is accepted for processing.

The default polls the request to a terminal result. The action succeeds only
for `accepted`; `failed`, `timed_out`, and `finalization_failed` fail the step.

## Outputs

- `request-id`: UAPKG registry request identifier.
- `request-status`: last observed request status.
- `package-name`: package name from `uapkg.json`.
- `package-version`: package version from `uapkg.json`.
- `package-source`: source repository from `GITHUB_REPOSITORY`.
- `release-tag`: resolved GitHub Release tag.

## Example

```yaml
name: Publish UAPKG package

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write

    steps:
      - uses: actions/checkout@v4

      - name: Publish existing package
        id: publish
        uses: uapkg/publish-action@v2
        with:
          registry-id: 11111111-1111-4111-8111-111111111111

      - name: Print request
        env:
          REQUEST_ID: ${{ steps.publish.outputs.request-id }}
          REQUEST_STATUS: ${{ steps.publish.outputs.request-status }}
        run: echo "$REQUEST_ID finished as $REQUEST_STATUS"
```

## Development

Install dependencies and run the complete validation:

```bash
npm install
npm run format:check
npm run lint
npm run typecheck
npm test
npm run package
```

`npm run package` bundles `src/index.ts` to `dist/index.js` for the action
runtime. This repository uses Changesets for release versioning.
