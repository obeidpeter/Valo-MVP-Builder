---
name: GitHub push blocked by token workflow scope
description: Why Replit→GitHub pushes get rejected with a misleading "remote has commits" message when a commit touches .github/workflows.
---

# GitHub push rejection: token `workflow` scope

GitHub refuses to accept ANY push that creates or updates files under `.github/workflows/` unless the pushing token carries the `workflow` scope. The real error is explicit only on a direct CLI push:

```
! [remote rejected] main -> main
(refusing to allow a Personal Access Token to create or update workflow
`.github/workflows/ci.yml` without `workflow` scope)
```

**Why this misleads:** Replit's Git pane surfaces this (and other push-auth failures) as the generic message:
"The push was rejected by the remote. This is usually because the remote has commits that aren't in the local repository."
That message is NOT reliable — it is shown even when the local branch is a clean fast-forward ahead of an unprotected remote. Do not trust it as a real non-fast-forward.

**How to diagnose when a Replit→GitHub push keeps failing:**
- Verify history is actually a fast-forward: `git merge-base --is-ancestor <remote-main> HEAD` (0 = yes) and `git rev-list --left-right --count HEAD...<remote-main>`.
- Confirm remote isn't protected: `curl -s https://api.github.com/repos/<owner>/<repo>/branches/main` → `protected`.
- If history/protection are fine, suspect token scope — especially if any commit touches `.github/workflows/`.

**Fix that worked:** have the user create a PAT WITH `workflow` scope (classic: check `repo` + `workflow`; fine-grained: Contents=Read/write AND Workflows=Read/write), store it as a Replit Secret, then push from the CLI using a credential helper that reads the token from env (keeps token out of argv/logs):

```
git -c credential.helper='!f() { echo username=x-access-token; echo "password=$GITHUB_PUSH_TOKEN"; }; f' \
  push https://github.com/<owner>/<repo>.git main:refs/heads/main
```

**Note on Replit env:** the CLI has NO GitHub credentials by default (a bare CLI push fails with "Invalid username or token"); pushes normally go through the user's Git pane. Bypassing the pane with a user-supplied PAT-in-Secrets is the reliable escape hatch when the pane keeps failing.
