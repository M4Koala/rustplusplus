# Development workflow

- This Windows checkout is dev-only. The bot actually runs on a Linux host via Docker, and
  changes only take effect there after `git pull && docker compose up -d --build`.
- Standing policy: after making code changes in this repo, commit them and push to `master`
  on GitHub without asking for confirmation first. Committing/pushing promptly is expected
  as the normal completion of a change here, not an optional extra step.
- This does not waive normal git safety: never force-push, never `--amend` a commit that's
  already been pushed, and never rewrite history — those still require an explicit request.
