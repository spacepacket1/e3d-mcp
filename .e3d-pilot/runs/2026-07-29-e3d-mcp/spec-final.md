# Zero-Install npm and npx Distribution

## Overview

Make the E3D.ai MCP server publish-ready as the `e3d-mcp` npm command and document an `npx` registration flow that avoids cloning the repository, installing dependencies manually, or hardcoding a local path.

## Goals

- Expose `server.js` through an npm executable named `e3d-mcp`.
- Ensure the executable launches correctly under Node.js 18 or newer.
- Limit the published package to the runtime and documentation files users need.
- Make the zero-install `npx` flow the primary Claude Code setup path.
- Preserve source-based installation as a contributor and fallback workflow.

## Non-Goals

- Publishing a release to npm or changing external registry state.
- Choosing, storing, or using npm credentials.
- Changing MCP tools, API behavior, authentication, or transport behavior.
- Changing the package version or adding dependencies.
- Modifying the claim-flow example.
- Adding release automation, CI workflows, or a new package manager.
- Updating generated dependency lockfiles.

## Existing Files

- `package.json` defines the package metadata, runtime dependencies, and entry point.
- `server.js` implements the stdio MCP server.
- `README.md` documents installation and Claude client registration.
- `package-lock.json` records dependency resolution and is protected from modification.
- `examples/claim-token.js` is a protected runnable example and remains unchanged.

## Shared Constraints

- Keep the implementation within three changed files and well below 600 changed lines.
- Do not modify `examples/claim-token.js`, `package-lock.json`, `.codex-spec-runner/**`, `.claude/**`, or `.git/**`.
- Do not add dependencies or run commands that rewrite `package-lock.json`.
- Preserve the server's stdio protocol behavior and emit no startup text to stdout.
- Preserve anonymous operation and the existing `E3D_API_KEY` and `E3D_API_BASE_URL` behavior.
- Support Node.js 18 and newer.
- Use the existing package name when it is already `e3d-mcp`; do not silently rename a differently named package.
- Do not run `npm publish`; publication remains an explicitly authorized release operation after these repository changes are reviewed.

## Phase 1 - Publish-Ready CLI Package

<!-- runner:model=codex:gpt-5.4-mini -->
<!-- pilot:touches=package.json -->
<!-- pilot:touches=server.js -->
<!-- runner:read=package.json -->
<!-- runner:read=server.js -->
<!-- runner:verify=node --check server.js -->

### Requirements

- Add an npm `bin` mapping in `package.json` that exposes the command `e3d-mcp` and points it to `server.js`.
- Ensure `package.json` declares Node.js 18 or newer through its `engines.node` metadata.
- Add a conservative npm `files` allowlist containing only the runtime server and user-facing documentation needed by the package. Include `server.js` and `README.md`; rely on npm's automatic inclusion of `package.json`.
- Preserve the existing package name, version, module mode, entry point, dependencies, and other unrelated metadata.
- Do not add a `prepublish`, `prepare`, or other lifecycle script that performs network access, mutates generated files, or publishes automatically.
- Make `server.js` directly executable by placing `#!/usr/bin/env node` on its first line if that shebang is not already present.
- Preserve all existing MCP server logic and ensure direct execution continues to use stdio without additional stdout output.
- Do not modify `package-lock.json`; these metadata-only changes must not trigger dependency installation or lockfile regeneration.

### Acceptance Criteria

- `package.json` is valid JSON.
- `package.json` maps `bin.e3d-mcp` to `server.js` or `./server.js`.
- `package.json` declares compatibility with Node.js 18 and newer.
- The npm package allowlist includes `server.js` and `README.md` and does not include protected paths.
- The first line of `server.js` is `#!/usr/bin/env node`.
- `node --check server.js` exits successfully.
- No dependency, MCP tool, API request, authentication, or response-format behavior changes.
- No publishing command or credential-dependent operation is introduced or executed.

## Phase 2 - Zero-Install User Documentation

<!-- runner:model=codex:gpt-5.4-mini -->
<!-- pilot:touches=README.md -->
<!-- runner:read=README.md -->
<!-- runner:read=package.json -->
<!-- runner:verify=node --check server.js -->

### Requirements

- Rewrite the primary installation and Claude Code registration path to use the packaged executable through `npx -y e3d-mcp`.
- Provide an anonymous registration command using the existing MCP server name and user scope:
  `claude mcp add e3d-ai --scope user -- npx -y e3d-mcp`.
- Provide an authenticated registration command that passes `E3D_API_KEY` through Claude Code's existing `-e` option while launching `npx -y e3d-mcp`.
- Explain briefly that `-y` allows `npx` to fetch the published package without an interactive install confirmation.
- Retain a clearly labeled source-installation section for contributors and users who prefer to clone the repository.
- Keep the source registration example functional with `node /path/to/e3d-mcp/server.js`.
- Update the Claude Desktop example to launch through `npx` with arguments `["-y", "e3d-mcp"]`, while retaining the optional API-key environment block and restart guidance.
- Keep the existing `claude mcp list` verification step and update its expected command description so it no longer claims that the primary setup runs a local `server.js` path.
- Preserve the tools table, usage examples, API tiers, environment-variable documentation, and claim-flow example link.
- State that the `npx` commands require the package to have been published to npm; do not claim that this repository change itself performs publication.
- Do not include npm credentials, account-specific release instructions, or an automated `npm publish` command.

### Acceptance Criteria

- A new user can copy one anonymous command from the README to register the server without cloning the repository or running `npm install`.
- A user with an E3D API key can copy a corresponding `npx` registration command that passes the key through the existing environment mechanism.
- Claude Desktop documentation uses `npx` as the command and supplies `-y` and `e3d-mcp` as separate arguments.
- Source-based installation remains documented as a fallback or contributor workflow.
- The README clearly distinguishes publish-ready repository changes from the separate npm release operation.
- All documented executable names and package names agree with the `package.json` `bin` mapping.
- `node --check server.js` exits successfully after the documentation changes.
- Only `README.md` is changed in this phase.
