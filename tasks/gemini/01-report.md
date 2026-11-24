# Gemini task 01 — follow-up audit

At PR head `0f46938`, Node 24 comes from `.nvmrc`. The package requires Node >=24, the lockfile is outside the diff, and all four workflows (including the new Data Health workflow from task 02) use the version file. Dependabot groups monthly npm minor/patch updates, excludes TypeScript majors, sets a seven-day cooldown and limits npm PRs to three. GitHub Actions updates use a separate monthly group.

| Action | Major update | Effect on this repository |
| --- | --- | --- |
| [checkout](https://github.com/actions/checkout/releases/tag/v7.0.0) | 4 → 7 | v7 restricts fork PR checkouts in privileged events. Production deploy checks out a successful push to this repository's master. |
| [setup-node](https://github.com/actions/setup-node/releases/tag/v7.0.0) | 4 → 7 | v7 removes the dummy NODE_AUTH_TOKEN export. This project installs public packages and explicitly enables npm caching. |
| [upload-pages-artifact](https://github.com/actions/upload-pages-artifact/releases/tag/v5.0.0) | 3 → 5 | Hidden files are excluded by default. The client and SW do not require the Vite build manifest at runtime. |
| [deploy-pages](https://github.com/actions/deploy-pages/releases/tag/v5.0.0) | 4 → 5 | The action runs on Node 24. Deployment uses a GitHub-hosted Ubuntu runner on GitHub.com. |

[CI run 45374759344](https://github.com/serchg0george/watchlist/actions/runs/45374759344) passed installation, type checks, tests, build and data validation for the original PR head. This audit did not repeat those commands on a local Node 24 installation. Dependabot scheduling has not been exercised on the default branch.
