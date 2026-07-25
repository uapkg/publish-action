---
"@uapkg/publish-action": major
---

Replace the legacy GitHub-token and registry-issue workflow with UAPKG trusted
publishing. The action now exchanges a GitHub Actions OIDC token, submits
server-verified GitHub Release coordinates, and waits for the UAPKG registry
request by default. Stable workflow-and-coordinate idempotency keys reconcile
ambiguous submissions across reruns without persisting a credential.
