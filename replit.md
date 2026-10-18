# Discord Ticket Bot

A Discord bot that lets server admins configure private support tickets, manage ticket types, and update the bot's visible profile settings.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secret: `DISCORD_BOT_TOKEN` — Discord bot token; never log or commit it
- Enable Discord's Message Content Intent in the bot's Developer Portal application settings for `-help`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Discord bot commands and ticket interactions: `artifacts/api-server/src/discord-bot/`
- Ticket configuration persistence: `.data/discord-ticket-bot.json` (ignored by Git)
- Bot setup and operator instructions: `artifacts/api-server/README.md`

## Architecture decisions

- The Discord Gateway bot runs in the API Server workflow so one managed process keeps the bot and health endpoint available together.
- Per-server ticket configuration is persisted as local JSON; the configuration file is excluded from Git.
- Ticket profile changes are restricted to the Discord application owner because username, avatar, and activity apply globally to the bot.

## Product

- `-help` opens an interactive Arabic admin menu for ticket setup, ticket categories, and bot profile settings.
- Admins choose an optional role or member to mention when a ticket opens; the selected target can view and reply in tickets.
- Admins customize the ticket panel's title, description, and HTTPS image URL. Closing a ticket requires confirmation and deletes the channel and its messages.
- Members open private tickets from a posted panel; ticket channels contain owner/category/time details and close/summon controls.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
