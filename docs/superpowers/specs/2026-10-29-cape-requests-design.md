# Cape requests

Provide a GitHub issue form with optional Discord username, required Minecraft IGN,
optional UUID linked to https://mcuuid.net/, and a required multiple-selection dropdown
for GTNH Developer, GTNH Contributor, GTNH Texture Creator, and GTNH Sound Designer.
All four roles currently request `capedev`.

Resolve the IGN through Mojang, verify any supplied UUID, and write the lowercase
32-character UUID. Insert `UUID:capedev // IGN` alphabetically by IGN into the
existing capedev group, preserving other entries. Only an existing capedev entry
counts as a duplicate; other cape groups may contain the same UUID.

Create a reviewable PR against master, then close the request as completed. Close
existing-capedev requests as not planned. Invalid inputs and service failures leave
the issue open with actionable feedback. Edits, reopening, and a manual dispatch
allow retries; repeated processing reuses the same request branch and PR.

Use a native GitHub Actions workflow and dependency-free JavaScript through
github-script. Required UUID input was considered, but automatic lookup reduces
mistakes and effort. An external bot was considered, but adds hosting and credentials.
Existing CODEOWNERS remains responsible for review. Never merge automatically.

The original GTNH checkout stays untouched. The user subsequently authorized cloning,
committing, and pushing this implementation to the UltraProdigy fork for testing.
