# Contributing to Prumo

Thank you for your interest in contributing to Prumo.
This guide explains how to contribute effectively and consistently.

## Submitting issues

Before opening a new issue, search existing issues and discussions to avoid duplicates.
When reporting a bug, include:

- Steps to reproduce
- Expected behavior and actual behavior
- Environment details (OS, browser, Node/Python versions)
- Logs and screenshots when applicable

## Development setup

### Requirements

- Node.js 18+
- Python 3.11+
- Docker Desktop
- Supabase CLI

### Local setup

1. Clone the repository.
2. Run `make setup`.
3. Configure `.env` and `backend/.env`.
4. Run `make start`.

The app is available at:

- Frontend: `http://localhost:8080`
- Backend: `http://localhost:8000`

## Coding guidelines

- Add or update tests for feature and bug-fix changes.
- Keep TypeScript strict and avoid `any` whenever possible.
- Follow existing linting and formatting rules.
- Keep PRs focused and small when feasible.

## Pull request process

1. Fork the repository and create a topic branch.
2. Implement the change and add/update tests.
3. Run local checks (`npm run lint`, `npm run test`).
4. Open a PR with a clear description and linked issue.
5. Address review feedback until approval.

## Code of conduct

By participating, you agree to follow [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
