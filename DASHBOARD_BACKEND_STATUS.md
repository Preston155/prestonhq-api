# Dashboard Backend Status

Updated: 2026-06-03

## What Runs Where

- Website/frontend: https://prestonhq.com
- Bot/API backend: https://api.prestonhq.com/api
- VPS project: /root/bots/bot6
- PM2 app: prestonhq-bot-api
- API port: 3001
- Discord client: created once in index.js
- API server: created in src/api/server.js

## Auth

The backend uses Discord OAuth with express-session.

- GET /api/auth/discord redirects to Discord OAuth.
- GET /api/auth/discord/callback exchanges the code server-side.
- GET /api/auth/me returns the logged-in session user and guilds.
- POST /api/auth/logout destroys the session.

Discord access tokens are never returned to the frontend. Protected routes trust req.session.user only.

## Added/Verified Routes

- GET /api/health
- GET /api/guilds
- GET /api/guilds/:guildId
- GET /api/guilds/:guildId/channels
- GET /api/guilds/:guildId/roles
- GET/PATCH /api/guilds/:guildId/settings
- GET/PATCH /api/guilds/:guildId/tickets/settings
- POST /api/guilds/:guildId/tickets/panel
- GET/PATCH /api/guilds/:guildId/moderation/settings
- GET /api/guilds/:guildId/moderation/cases
- GET /api/guilds/:guildId/giveaways
- POST /api/guilds/:guildId/giveaways/:giveawayId/end
- POST /api/guilds/:guildId/giveaways/:giveawayId/reroll
- GET/PATCH /api/guilds/:guildId/reaction-roles/settings
- POST /api/guilds/:guildId/reaction-roles/panel
- GET/PATCH /api/guilds/:guildId/leveling/settings
- GET /api/guilds/:guildId/leveling/leaderboard
- GET/PATCH /api/guilds/:guildId/welcome/settings
- POST /api/guilds/:guildId/welcome/test
- GET/PATCH /api/guilds/:guildId/logging/settings
- GET/PATCH /api/guilds/:guildId/commands
- GET/POST/PATCH/DELETE /api/guilds/:guildId/custom-commands
- GET/POST/PATCH/DELETE /api/guilds/:guildId/custom-replies

## Dashboard Control

The dashboard now pulls real Discord guilds, channels, and roles through the logged-in Discord session. It can save settings, send ticket panels, send reaction role panels, toggle reaction roles from panel buttons, send welcome tests, manage command enable/cooldown settings, create custom commands, and create custom replies.

## Storage

JSON storage is used under src/data:

- guildSettings.json
- commandSettings.json
- customCommands.json
- customReplies.json

Invalid JSON is backed up and replaced with a safe fallback instead of crashing the bot.

## Commands And Custom Commands

The message handler checks command settings before running built-in commands. Custom commands and replies use safe allowedMentions defaults, response length limits, blocked dangerous names, channel/role validation from the API, cooldowns, and role/channel restrictions.

## Not Fully Implemented Yet

- Giveaway end/reroll works only for giveaways stored in JSON. There is no full giveaway manager in Bot6 yet.
- Moderation cases return stored JSON cases. There is no moderation case writer in Bot6 yet.
- Ticket button currently logs/acknowledges requests; a full private ticket channel workflow can be added next.
- Leveling settings and leaderboard are stored for the dashboard, but Bot6 does not yet include a full XP engine.

## Tests

Local health:

```
curl -i http://localhost:3001/api/health
```

Public health:

```
curl -i https://api.prestonhq.com/api/health
```

OAuth redirect:

```
curl -I https://api.prestonhq.com/api/auth/discord
```
