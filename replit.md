# AI Bot Tracker

## Overview

A full-stack dashboard for tracking AI bots crawling client websites. Clients deploy a Cloudflare Worker that sends bot hit data to this server. The dashboard shows real-time analytics per client.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: Vanilla HTML/CSS/JS served statically from Express

## Architecture

- `artifacts/api-server` — Express backend that:
  - Serves the dashboard frontend (static HTML at `/`)
  - Provides API routes under `/api`
  - Authenticates dashboard requests via Basic Auth with `DASHBOARD_PASSWORD`
  - Receives bot hits from Cloudflare Workers via `POST /api/hit`
- `lib/db` — Drizzle ORM schema + database connection
- `public/index.html` — Single-page dashboard with login, client management, charts

## Database Schema

- `clients` — client websites being tracked (id, name, domain, api_key, created_at)
- `bot_hits` — individual bot hit records (client_id, url, bot_name, user_agent, status_code, country, referrer, timestamp)

## Key API Endpoints

- `POST /api/hit` — Receive a bot hit (used by Cloudflare Workers, authenticated by api_key)
- `GET /api/clients` — List all clients (requires DASHBOARD_PASSWORD)
- `POST /api/clients` — Create a new client with generated API key
- `DELETE /api/clients/:id` — Delete a client
- `GET /api/stats/:clientId` — Get analytics stats for a client
- `GET /api/hits/:clientId` — Get recent hits for a client

## Environment Variables

- `DATABASE_URL` — PostgreSQL connection string (Replit managed)
- `DASHBOARD_PASSWORD` — Password to access the dashboard (set to `admin123` by default)
- `PORT` — Server port (managed by Replit)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Cloudflare Worker Setup

The included Cloudflare Worker template (`cloudflare-worker.js`) goes in Cloudflare Workers. Configure:
- `API_ENDPOINT` — URL of this deployed app + `/api/hit`
- `CLIENT_API_KEY` — The API key shown when adding a client in the dashboard
