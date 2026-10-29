# CustomGTCapeHook cape list

`capesUUID.txt` maps Minecraft Java Edition UUIDs to cape types.

## Developer cape requests

Open an issue using **Request a GTNH developer cape**. Supply your current
Minecraft IGN, optionally your Discord username and Minecraft UUID, and select
every applicable GTNH role. Developer, Contributor, Texture Creator, and Sound
Designer currently all map to `capedev`.

The workflow looks up the IGN through Mojang and uses the returned name and
lowercase, 32-character UUID without dashes. A supplied UUID is checked against
that lookup. You can also find your UUID at [MCUUID](https://mcuuid.net/).

- If your UUID already has `capedev` on `master`, the issue closes as **not planned**.
- Otherwise, the workflow inserts `UUID:capedev // IGN` alphabetically by IGN in
  the capedev group, opens a PR against `master`, links it, and closes the issue
  as **completed**. The cape becomes available after the PR is merged.
- Entries for other cape types are preserved and do not prevent a capedev request.
- Requests for a UUID with an open automation PR reuse that PR. A previously
  closed PR requires a maintainer's decision before another request proceeds.
- Invalid input or service failures leave the issue open with feedback. Edit the
  issue to correct it or retry. Reopening also retries; maintainers can run
  **Actions → Cape request → Run workflow** with the issue number. GitHub's
  **Re-run jobs** control also works because processing reads the current issue.

The title must keep the `[Cape Request]:` prefix and the form's four field
headings must remain intact. Role claims are self-reported for maintainers to
verify in review. Existing `CODEOWNERS` handles review requests; this automation
does not merge PRs.

## Repository setup

The form and workflow must be present on the default branch (`master`). Enable
GitHub Actions, and under **Settings → Actions → General → Workflow permissions**,
enable **Allow GitHub Actions to create and approve pull requests**. Organization
policy must permit this setting. The workflow grants its `GITHUB_TOKEN` only
`contents: write`, `issues: write`, and `pull-requests: write`; no extra secret is
needed. See [GitHub's repository Actions settings documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#preventing-github-actions-from-creating-or-approving-pull-requests).

PR workflows triggered by `GITHUB_TOKEN` require a user with write access to
select **Approve workflows to run** on the PR. If cape-only PRs require checks
that should start automatically, use an appropriately scoped GitHub App token
instead. See [GitHub's workflow trigger documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).

## Local verification

With Node.js 20 or newer, run:

```sh
node --test .github/scripts/cape-request.test.cjs
```

Tests run entirely locally with simulated GitHub/Mojang API boundaries. They do
not create real issues, branches, commits, or PRs. The test workflow runs the same
suite for changes to the automation.
