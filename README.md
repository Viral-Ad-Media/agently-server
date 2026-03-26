# Agently Backend Server

Standalone Node backend for the Agently frontend demo. It uses only built-in Node modules, prefers Supabase for persistence, and exposes the full API surface the current app needs.

## Features

- Zero external dependencies
- Supabase-backed persistence through the REST API
- Local JSON fallback for offline development and tests
- Demo auth with bearer tokens
- Onboarding, organization, agent, dashboard, messaging, calls, leads, team, billing, and contact endpoints
- Built-in API docs route
- Local smoke tests with `node --test`

## Run

1. Create the Supabase table with [supabase/001_agently_state.sql](/Users/demola/www/Agently-/agently-server/supabase/001_agently_state.sql).
2. Copy [.env.example](/Users/demola/www/Agently-/agently-server/.env.example) to `.env` and fill in your Supabase values. The `npm run start` and `npm run dev` scripts load `.env` automatically.
3. Run:

```bash
cd agently-server
npm run start
```

The server defaults to `http://localhost:4000`.

## Environment variables

- `PORT`: server port, defaults to `4000`
- `ALLOWED_ORIGIN`: CORS origin, defaults to `*`
- `AGENTLY_STORE_PROVIDER`: `supabase` or `json`
- `SUPABASE_URL`: your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: service-role key used by the backend
- `SUPABASE_SCHEMA`: schema name, defaults to `public`
- `SUPABASE_STATE_TABLE`: table name, defaults to `agently_state`
- `SUPABASE_STATE_ROW_ID`: row id used for the app snapshot, defaults to `primary`
- `AGENTLY_DATA_FILE`: JSON fallback path when `AGENTLY_STORE_PROVIDER=json`

## Demo auth

Protected routes expect:

```text
Authorization: Bearer demo-owner-token
```

You can also create a fresh session with:

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@example.com","password":"demo-password"}'
```

## Core endpoints

- `GET /health`
- `GET /api`
- `GET /api/docs`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/magic-link`
- `POST /api/auth/magic-link/verify`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/bootstrap`
- `GET /api/dashboard`
- `GET /api/organization`
- `PATCH /api/organization/profile`
- `GET /api/settings`
- `PATCH /api/settings`
- `POST /api/onboarding/faqs`
- `POST /api/onboarding/complete`
- `GET /api/agent`
- `PATCH /api/agent`
- `GET /api/agent/faqs`
- `POST /api/agent/faqs`
- `PATCH /api/agent/faqs/:id`
- `DELETE /api/agent/faqs/:id`
- `POST /api/agent/faqs/sync`
- `POST /api/agent/restart`
- `GET /api/messenger/messages`
- `POST /api/messenger/messages`
- `DELETE /api/messenger/messages`
- `GET /api/calls`
- `POST /api/calls/simulate`
- `GET /api/calls/:id`
- `GET /api/calls/:id/transcript`
- `GET /api/calls/:id/report`
- `GET /api/leads`
- `POST /api/leads`
- `PATCH /api/leads/:id`
- `DELETE /api/leads/:id`
- `GET /api/leads/export.csv`
- `GET /api/team/members`
- `POST /api/team/invitations`
- `PATCH /api/team/members/:id`
- `DELETE /api/team/members/:id`
- `GET /api/billing`
- `PATCH /api/billing/plan`
- `POST /api/billing/cancel`
- `GET /api/billing/invoices`
- `GET /api/billing/invoices/:id`
- `GET /api/billing/invoices/:id/download`
- `POST /api/contact`
- `POST /api/contact-sales`

## Notes

- Supabase is the primary persistence layer. The JSON store remains only as a fallback for offline development and tests.
- AI-heavy actions use deterministic heuristics so the backend works offline.
- The docs route at `GET /api/docs` returns descriptions, auth requirements, and sample headers.
- The data file is created automatically on first run.
