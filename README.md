# Small MCP

Small MCP is a deliberately narrow GitHub policy proxy for AI-assisted repository work.

Its purpose is not to recreate a general GitHub integration. It exposes only the minimum GitHub-backed capabilities needed to drive a repository's existing deterministic development toolchain while making direct repository bypass structurally unavailable.

## Security model

The intended deployment model is:

```text
ChatGPT
   |
   v
Small MCP
   |
   +-- submit planning-only toolchain request
   +-- inspect canonical toolchain telemetry/evidence
   +-- read an exact path granted by toolchain evidence
   |
   v
GitHub API
   |
   v
Repository toolchain -> FilePatcher -> validation
```

For the boundary to be meaningful, the ordinary unrestricted GitHub app must not be available for the governed repository workflow. Small MCP cannot intercept another app's tools; it is meant to be the only GitHub capability exposed for this workflow.

## Exposed MCP tools

Small MCP intentionally exposes only three tools:

1. `toolchain_submit_request`
   - Writes only the configured toolchain request file (default: `dev_scripts/github-filepatcher.json`).
   - Requires a Scope Lock-bearing schema-v2 request.
   - Requires `operations` to be empty so the model cannot smuggle direct FilePatcher mutations through the gateway. Patch authoring remains the repository toolchain's job.
   - Cannot write any other repository path.

2. `toolchain_inspect_run`
   - Reads canonical commit status and the configured toolchain workflow run.
   - Returns bounded failure evidence rather than raw unrestricted workflow logs.
   - Extracts source-access grants only from toolchain-produced grant markers or the certified `Targeted patch surface` section.
   - Stores those grants server-side with a short TTL.

3. `toolchain_read_granted_file`
   - Reads one exact repository path at the exact request commit SHA.
   - Succeeds only if `toolchain_inspect_run` previously derived a still-valid grant for that exact `(repository, commit, path)` tuple.
   - Provides no search, listing, guessed reads, moving refs, or arbitrary fetches.

There is deliberately no generic `search`, `fetch_file`, `update_file`, commit, branch, PR, issue, workflow dispatch, or shell tool.

## Why the grant is server-side

The model is not allowed to manufacture its own source-access grant. `toolchain_inspect_run` derives a grant from GitHub-hosted output produced by the configured canonical workflow and records it in process memory. `toolchain_read_granted_file` consults that server-side record.

A later version should replace the legacy `Targeted patch surface` parser with an explicit signed/machine-readable Abstraction Lock grant emitted by the toolchain.

## Current scope and future direction

Version 0.1 is intentionally compatible with the existing Frame Conn model: the repository still owns Scope Lock, Abstraction Lock, diagnostics, Patch Corridor, Context Pack, staging, propagation, FilePatcher, and validation.

The longer-term direction is to move repository-independent versions of those policy and orchestration capabilities into Small MCP itself. At that point a repository would supply only its project-specific diagnostics/adapters while Small MCP provides the common governed execution spine.

## Requirements

- Node.js 22+
- A GitHub token restricted to the repositories Small MCP is allowed to govern
- GitHub permissions sufficient for:
  - Contents: read/write (only the configured request file is written by Small MCP)
  - Commit statuses: read
  - Actions: read
- A remote MCP deployment or a supported secure MCP tunnel for ChatGPT

Small MCP uses the current MCP TypeScript SDK's Streamable HTTP server model.

## Configuration

Copy `.env.example` into your deployment environment and provide secrets through the deployment platform rather than committing them.

Important variables:

```text
GITHUB_TOKEN
ALLOWED_REPOSITORIES
TOOLCHAIN_REQUEST_PATH
TOOLCHAIN_WORKFLOW_NAME
TOOLCHAIN_REQUIRED_STATUS_CONTEXTS
```

`ALLOWED_REPOSITORIES` is a comma-separated allowlist such as:

```text
jonkellyrice-cmyk/Lancer-Frame-Conn
```

The request path defaults to:

```text
dev_scripts/github-filepatcher.json
```

The Frame Conn workflow defaults are represented in `.env.example`, but every value is configurable so the server is not permanently coupled to Frame Conn.

## Development

```bash
npm install
npm run check
npm run dev
```

The MCP endpoint is:

```text
POST /mcp
```

A simple health endpoint is available at:

```text
GET /healthz
```

## Production notes

Do not expose an unauthenticated public deployment. The included server can enforce a static bearer token for development/private proxy use with `MCP_BEARER_TOKEN`; a production ChatGPT deployment should use an authentication mechanism supported by the hosting and ChatGPT MCP configuration, with OAuth preferred when appropriate.

The in-memory grant store is intentionally simple for v0.1. A multi-instance deployment should replace it with a shared store or keep the service at one instance until grants become signed, self-contained toolchain artifacts.
