# Agently Backend

Express backend for the Agently SaaS workspace. It exposes the full API used by the frontend and persists workspace state in Supabase by default.

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

Supabase storage is implemented through the REST API. Express is the only added backend framework dependency.

## Setup

### 1. Create the Supabase table

Run [001_agently_state.sql](/Users/demola/www/Agently-/agently-server/supabase/001_agently_state.sql) in your Supabase project.
The backend will create and hydrate the `primary` state row automatically, so the migration does not seed a row up front. It now also adds `created_at`/`updated_at`, keeps `updated_at` fresh with a trigger, enforces `payload` as a JSON object, and locks the table down to backend `service_role` access.

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
- `TWILIO_ACCOUNT_SID`: optional server-level fallback for local development or single-tenant installs
- `TWILIO_AUTH_TOKEN`: optional server-level fallback for local development or single-tenant installs
- `TWILIO_WEBHOOK_BASE_URL`: optional override for the public backend origin Twilio will call, for example `https://agently-server.vercel.app`
- `TWILIO_VALIDATE_REQUESTS`: defaults to `true`; workspace settings can override this per customer

### 3. Start the server

```bash
cd agently-server
npm install
npm run start
```

The server listens on `http://localhost:4000` by default.

## Twilio Voice Integration

The backend now supports real Twilio inbound voice webhooks and outbound call initiation.
Each workspace can now save its own Twilio Account SID and Auth Token from the Settings screen, so customer traffic does not depend on one global Twilio account for the whole SaaS. The `TWILIO_*` environment variables are now only fallback defaults.

Inbound setup:

- create or pick an inbound voice agent in Agently
- connect that workspace's Twilio account from the Settings screen
- assign that agent a real Twilio number and save the number SID in the agent settings
- in Twilio Console, configure that phone number's Voice webhook to `HTTP POST`
- point it to:
  - `https://your-backend.example.com/api/twilio/voice/<voice-agent-id>/inbound`

Outbound setup:

- create an outbound voice agent with a Twilio number assigned
- connect that workspace's Twilio account from the Settings screen
- call `POST /api/voice-agents/:id/outbound-calls` with a `to` number and optional `contactName`, `prompt`, and `machineDetection`
- the backend will create the Twilio call, serve outbound TwiML, receive status callbacks, and write the completed call into the existing call log and lead pipeline

The backend signs and validates Twilio traffic using `X-Twilio-Signature` when request validation is enabled for that workspace. The Twilio-generated instruction and status callback URLs are built from `TWILIO_WEBHOOK_BASE_URL` when it is set, otherwise from the current public request origin.

## Vercel Deployment

Vercel can deploy the Express app directly from [src/server.js](/Users/demola/www/Agently-/agently-server/src/server.js#L1727). No custom `api/*` wrapper functions or rewrites are required; the default export in that file is the serverless entrypoint, and the Express routes continue to serve `/`, `/health`, `/api`, and the rest of the `/api/*` surface.

For production on Vercel, set these environment variables:

- `AGENTLY_STORE_PROVIDER=supabase`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SCHEMA`
- `SUPABASE_STATE_TABLE`
- `SUPABASE_STATE_ROW_ID`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WEBHOOK_BASE_URL`
- `TWILIO_VALIDATE_REQUESTS=true`

If those Supabase variables are missing, the app will fall back to the JSON store. On Vercel that fallback uses `/tmp/agently-store.json`, which prevents a read-only filesystem crash but does not give durable persistence across deployments or cold starts.

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
- `GET /api/voice-agents`
- `POST /api/voice-agents`
- `PATCH /api/voice-agents/:id`
- `DELETE /api/voice-agents/:id`
- `POST /api/voice-agents/:id/activate`
- `POST /api/voice-agents/:id/outbound-calls`
- `GET /api/agent`
- `PATCH /api/agent`
- `GET /api/agent/faqs`
- `POST /api/agent/faqs`
- `PATCH /api/agent/faqs/:id`
- `DELETE /api/agent/faqs/:id`
- `POST /api/agent/faqs/sync`
- `POST /api/agent/restart`
- `GET /api/chatbots`
- `POST /api/chatbots`
- `PATCH /api/chatbots/:id`
- `DELETE /api/chatbots/:id`
- `POST /api/chatbots/:id/activate`
- `GET /api/chatbots/:id/embed`
- `GET /api/messenger/messages`
- `POST /api/messenger/messages`
- `DELETE /api/messenger/messages`
- `GET /api/public/chatbots/:id/config`
- `POST /api/public/chatbots/:id/messages`
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
- `POST /api/twilio/voice/:id/inbound`
- `POST /api/twilio/voice/:id/continue`
- `POST /api/twilio/voice/:id/outbound/:sessionId/twiml`
- `POST /api/twilio/voice/:id/outbound/:sessionId/continue`
- `POST /api/twilio/voice/status`

## Verification

Run the backend test suite with:

```bash
npm test
```

The tests intentionally use the JSON fallback so they can run without a live Supabase project.
