# Agently Backend

Node backend for the Agently SaaS workspace. It exposes the full API used by the frontend and persists workspace state in Supabase by default.

## What It Handles

- session auth, registration, and secure-link verification
- onboarding and FAQ generation
- dashboard bootstrap and analytics
- agent configuration and FAQ CRUD
- messenger threads
- call simulation, transcripts, and downloadable reports
- lead CRUD and CSV export
- team invitations and member removal
- billing plan updates, cancellation, and invoice downloads
- public contact and sales submissions

## Persistence

The server uses two storage modes:

- `supabase`: primary mode for real persistence
- `json`: offline fallback for local development and automated tests

Supabase storage is implemented through the REST API, so there are still no extra runtime dependencies.

## Setup

### 1. Create the Supabase table

Run [001_agently_state.sql](/Users/demola/www/Agently-/agently-server/supabase/001_agently_state.sql) in your Supabase project.

### 2. Configure environment variables

Copy [.env.example](/Users/demola/www/Agently-/agently-server/.env.example) to `.env`.

Important variables:

- `PORT`: server port, defaults to `4000`
- `ALLOWED_ORIGIN`: CORS origin, defaults to `*`
- `AGENTLY_STORE_PROVIDER`: `supabase` or `json`
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: service-role key used by the backend
- `SUPABASE_SCHEMA`: schema name, defaults to `public`
- `SUPABASE_STATE_TABLE`: table name, defaults to `agently_state`
- `SUPABASE_STATE_ROW_ID`: row id, defaults to `primary`
- `AGENTLY_DATA_FILE`: JSON fallback path when `AGENTLY_STORE_PROVIDER=json`

### 3. Start the server

```bash
cd agently-server
npm install
npm run start
```

The server listens on `http://localhost:4000` by default.

## Development Auth

Protected routes use a bearer token.

You can:

- create a new session through `POST /api/auth/login`
- register a workspace through `POST /api/auth/register`
- use the seeded development token `demo-owner-token` for quick local API checks

Example:

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@example.com","password":"demo-password"}'
```

## Core Endpoints

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

## Verification

Run the backend test suite with:

```bash
npm test
```

The tests intentionally use the JSON fallback so they can run without a live Supabase project.
