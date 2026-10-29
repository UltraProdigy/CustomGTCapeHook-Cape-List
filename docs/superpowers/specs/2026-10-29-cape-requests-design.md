# Cape requests

Provide a GitHub issue form with optional Discord Username, required Minecraft
IGN, and a GTNH Roles dropdown containing only GTNH Developer. Use DreamMasterXXL
and boubou19 as the Discord and Minecraft examples. The introduction contains
only the PR-review sentence; a note beneath the dropdown says capes for other
contributors are coming soon.

Prefill the issue title as Cape Request, then rename it to Cape Request: IGN
using Mojang's canonical account name. GitHub displays the title field but users
do not need to edit it. Obtain the lowercase, 32-character UUID solely through
Mojang; do not ask users for a UUID.

Insert UUID:capedev // IGN alphabetically into the existing capedev group,
preserving other cape types. An existing capedev UUID closes the request as not
planned; other cape types do not prevent a request.

Create a PR against master with Closes #ISSUE_NUMBER, the issue author's GitHub
username, IGN, UUID, optional Discord Username, and GTNH Roles. Add Chore, creating
the label if needed. Keep the issue open until merge. A small trusted PR-close
handler closes linked requests as not planned when a same-repository automation
PR closes unmerged. Reused PRs gain closing references for each request.

Invalid inputs and service failures leave requests open with feedback. Edits,
reopening, and manual dispatch support retries. Use GitHub Actions with a
JavaScript script and local tests; existing CODEOWNERS handles review. The
workflow never merges automatically and never executes code from a PR head.

Publish only to the UltraProdigy fork for testing. Leave the original GTNH
checkout untouched.
