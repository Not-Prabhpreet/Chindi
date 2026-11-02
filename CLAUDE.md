# Chindi

A manual-entry budgeting PWA that lovingly roasts you into not wasting money.
Full spec: docs/SPEC.md. Mockups: design/png/*.png and design/mockups/*.html.
Read the relevant SPEC section before starting any task.

## Stack
- backend/: FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, PostgreSQL, pytest
- frontend/: React, Vite, TypeScript, React Router, TanStack Query, Tailwind
  reading src/styles/tokens.css, Motion, vite-plugin-pwa

## Commands
- Backend: cd backend && uv run pytest | uv run ruff check . | uv run alembic upgrade head
- Frontend: cd frontend && npm run dev | npm test | npm run lint | npm run build
- Everything: docker compose up --build

## Non-negotiable rules
- Money is Decimal / NUMERIC(12,2). Never float. Format with the user's currency.
- Every table has user_id; every query filters by the current user.
- Dates are stored in UTC; days, weeks and months use the user's timezone.
- Logging an expense must stay at 3 taps after typing the amount.
- Never show a "safe to spend" number. Show kept, left in category, and vs last month.
- Insights are one plain sentence each. No heatmaps or charts that need a legend.
- No AI or network calls at runtime for quips; use backend/app/quips rules + templates.
- Only use colours, radii, shadows and fonts from tokens.css. No new colours.
- Dark text on light backgrounds; touch targets at least 44px; respect prefers-reduced-motion.
- Personality goes in headings, quips, celebrations and empty states. Numbers and buttons stay plain.
- New calculations go in services/calculations.py with a unit test.

## Workflow
- Plan first, then build. Keep changes to the task you were given.
- Match the mockup PNG for any screen that has one; open it before building.
- Write or update tests, run lint and tests, then commit with a clear message.
- If the spec is unclear, ask instead of guessing.
