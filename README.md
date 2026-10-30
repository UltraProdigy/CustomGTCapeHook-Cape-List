# CustomGTCapeHook cape list

`capesUUID.txt` maps Minecraft Java Edition UUIDs to cape types.

## Developer cape requests

Open a new issue using **Request a GTNH developer cape**. Supply your current
Minecraft IGN and optionally your Discord Username. Leave the prefilled title
alone; the workflow sets it from your Minecraft account name. GTNH Developer is
currently the only available role.

The workflow looks up the account's 32-character UUID through Mojang, then:

- If that UUID already has `capedev` on `master`, closes the issue as **not planned**.
- Otherwise, inserts `UUID:capedev // IGN` alphabetically and opens a new PR to
  `master` with the `Chore` label and the requester's GitHub/account details.
- Includes `Closes #ISSUE_NUMBER`, so merging the PR closes its issue automatically.
  Declined PRs and their issues are handled manually.

Only newly opened issues trigger processing. Editing or reopening an issue does
not start another run, and existing PRs are not searched or reused. Errors leave
feedback on the issue. A maintainer can inspect and rerun the existing workflow
run after correcting a request; if a PR was already created, inspect it before
retrying.

Other cape types are preserved. Existing CODEOWNERS handles PR review; the
workflow does not merge automatically. The `Chore` label must already exist.

## Repository setup

Enable issues and GitHub Actions, and place the form/workflow on `master`.
Under **Settings → Actions → General → Workflow permissions**, enable
**Allow GitHub Actions to create and approve pull requests**. No extra secret is
required; the workflow uses `GITHUB_TOKEN`.

## Local verification

With Node.js 20 or newer:

```sh
node --test .github/scripts/cape-request.test.cjs
```

The fork keeps regression tests and a test workflow for verification. These are
not part of the minimal three-file implementation in the GTNH local checkout.
