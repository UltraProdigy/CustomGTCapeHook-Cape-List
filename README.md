# CustomGTCapeHook cape list

`capesUUID.txt` maps Minecraft Java Edition UUIDs to cape types.

## Developer cape requests

Open an issue using **Request a GTNH developer cape**. Supply your Minecraft IGN
and optionally your Discord Username. GTNH Developer is currently the only
available role; capes for other contributors are coming soon.

The title is prefilled as **Cape Request**, so you can submit without editing it.
The workflow renames the issue to **Cape Request: MinecraftUsername** using the
account name returned by Mojang. GitHub issue forms always display their title
field, but no title entry is needed from the requester.

UUIDs are looked up automatically through Mojang's public profile endpoint:
`https://api.mojang.com/users/profiles/minecraft/<IGN>`. It returns the account's
name and 32-character UUID without dashes; no UUID input or lookup site is needed.

- If your UUID already has `capedev` on `master`, the issue closes as **not planned**.
- Otherwise, the workflow inserts `UUID:capedev // IGN` alphabetically by IGN in
  the capedev group and opens a PR against `master` with the **Chore** label.
  The PR lists your GitHub username, Minecraft IGN, Minecraft UUID, Discord
  Username, and GTNH Roles.
- The issue stays open during review. The PR includes `Closes #ISSUE_NUMBER`, so
  merging it closes the issue automatically. Closing the PR without merging
  closes linked cape requests as **not planned**. Manually closing an issue
  leaves its PR open for a maintainer to handle.
- Entries for other cape types are preserved and do not prevent a capedev request.
- Requests for a UUID with an open automation PR reuse that PR and add another
  closing reference. If no PR is open and capedev is absent from master, a new
  PR is opened even if an earlier one was closed. Changing the IGN detaches the
  old PR; a superseded PR closes if no other requests still depend on it.
- Invalid input or service failures leave the issue open with feedback. Edit the
  issue to correct it or retry. Reopening also retries; maintainers can run
  **Actions → Cape request → Run workflow** with the issue number. GitHub's
  **Re-run jobs** control reads the current issue.

Keep the form's three field headings intact. Existing `CODEOWNERS` handles
review requests; this automation does not merge PRs. Roles are self-reported for
maintainers to verify in review.

## Repository setup

The form and workflow must be present on the default branch (`master`). Enable
GitHub Actions, and under **Settings → Actions → General → Workflow permissions**,
enable **Allow GitHub Actions to create and approve pull requests**. Organization
policy must permit this setting. The request job grants its `GITHUB_TOKEN`
`contents: write`, `issues: write`, and `pull-requests: write`; no extra secret is
needed. The PR-close job uses read-only code from master and only writes issues.
See [GitHub's repository Actions settings documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository#preventing-github-actions-from-creating-or-approving-pull-requests).

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
