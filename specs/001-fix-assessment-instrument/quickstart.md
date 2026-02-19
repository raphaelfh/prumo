# Quickstart: Fix Assessment Instrument Configuration and Data Loading

## Prerequisites

- Node.js 18+, npm
- Supabase CLI (local instance running)
- Backend running on port 8000

## Setup

```bash
# Start all services
make start

# Or manually:
cd backend && uv run uvicorn app.main:app --reload --port 8000  # terminal 1
npm run dev                                                       # terminal 2
```

## Verify Fixes

1. Open http://localhost:8080
2. Log in and navigate to a project
3. Go to "Avaliacao" tab

### Bug 2 (Data Loading):
- Select any article for assessment
- Verify instrument loads without errors (check browser console for 406)

### Bug 1 (Configurar Button):
- Go to assessment configuration
- Click "Configurar" on an imported instrument
- Verify editor opens with items grouped by domain
- Toggle an item's required status
- Edit an item's question text
- Delete an item
- Add a new custom item via "Adicionar Item" button
- Reload page and verify all changes persisted

## Type Check

```bash
npx tsc --noEmit
```
