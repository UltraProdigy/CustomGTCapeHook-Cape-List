# Cape Requests Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Turn contributor cape requests into reviewed capedev additions.

**Architecture:** An issue form supplies structured input to a GitHub Actions script.
The script validates Mojang profiles and uses the GitHub API for one-file PRs.

**Tech Stack:** GitHub issue forms, Actions, github-script, Node built-in test runner.

**Spec:** ../specs/2026-10-29-cape-requests-design.md

## Global Constraints

- Target master; only capedev UUID matches are duplicates.
- Preserve other cape entries and use lowercase, undashed UUIDs.
- Publish only to the UltraProdigy fork for testing; leave the GTNH checkout untouched.

## Review Focus

- User-supplied text must remain data, never shell or executable code.
- Missing, mismatched, or unavailable Mojang profiles must leave requests open.
- Repeated processing must reuse branches/PRs after partial failures.
- Preserve newline style, comments, and cape groups outside capedev.
- Never close a new request as completed before its PR exists.

## Task 1: Request validation and list insertion

**Files:** `.github/scripts/cape-request.cjs`, `.github/scripts/cape-request.test.cjs`.
**Interfaces:** `parseRequest(body)`, `resolveProfile(request, fetch)`,
`addCape(content, profile)` returning updated content or null for a duplicate.

- [x] Write failing tests for parsing, normalization, profile failures, sorting,
      duplicate detection, other cape groups, and newline preservation.
- [x] Run `node --test .github/scripts/cape-request.test.cjs`; observe missing behavior.
- [x] Implement the functions and rerun until green.

## Task 2: GitHub orchestration, form, and documentation

**Files:** `.github/scripts/cape-request.cjs`, `.github/scripts/cape-request.test.cjs`,
`.github/ISSUE_TEMPLATE/cape-request.yml`, `.github/workflows/cape-request.yml`,
`.github/workflows/test-cape-request.yml`, `README.md`.
**Interface:** `run({github, context, core, fetch})` consumes the helpers from Task 1.

- [x] Write failing API-boundary tests for successful PRs, existing capes, retries,
      invalid input, and API failure without premature issue closure.
- [x] Implement orchestration; fetch current master before constructing the change.
- [x] Add the form, minimally scoped workflows, and setup/retry documentation.
- [x] Run the complete Node test command, syntax checks, YAML validation, and diff review.
- [x] Initially kept local; the user subsequently authorized committing and pushing to the UltraProdigy fork.

## Verification record

- 23 tests pass, including RED→GREEN regressions for interrupted branch creation
  followed by master advancement and edits during lookup/PR creation.
- A fresh, read-only code review identified both regression cases; both are fixed.
- actionlint v1.7.12 validates both workflows; js-yaml parses the issue form.
- An in-memory dry run against the actual list inserts one entry alphabetically,
  preserves the original bytes, and detects a repeated UUID. No cape list edits.
- Mojang's public profile endpoint and the pinned action tags were verified live.
- Local branch: `codex/cape-requests`. No commits, pushes, PRs, or remote settings changes.

## Fork test deployment

The user authorized cloning into UPD-Repositories and committing and pushing to
the UltraProdigy fork. The original GTNH checkout remains untouched.

## Requested revisions

- Simplify to Discord Username, Minecraft IGN, and developer-only GTNH Roles.
- Resolve UUID only from Mojang and generate an IGN-based issue title.
- Include the issue author, label Chore, and use Closes references.
- Add a trusted close-event handler for declining requests as not planned.
- Verify regressions and workflows, then commit and push only to the UltraProdigy fork.

Revision verification: 28 tests pass, including label retries, declined PRs,
changed IGNs, and preserved PR metadata through validation failures. Shared PR
updates use the documented GitHub concurrency queue (queue: max), which the
current actionlint release does not yet recognize; all other workflow lint
checks pass with only that known schema warning excluded. The form parses
with js-yaml. Original cape data and CODEOWNERS remain unchanged.
