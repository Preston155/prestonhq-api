# Nexora Dashboard API Deploy Notes

## Authentication model

- Uses Discord OAuth2 with `identify guilds`.
- Uses `express-session` cookie sessions.
- No `x-user-id` header authentication.
- No Discord access token is exposed to frontend responses.

## Required environment

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=https://api.prestonhq.com/api/auth/discord/callback
SESSION_SECRET=
API_PORT=3001
FRONTEND_ORIGIN=https://prestonhq.com
PUBLIC_API_BASE_URL=https://api.prestonhq.com
COOKIE_DOMAIN=.prestonhq.com
COOKIE_SAMESITE=lax
NODE_ENV=production
```

## OAuth routes

- `GET /api/auth/discord`
- `GET /api/auth/discord/callback`
- `GET /api/auth/me`
- `POST /api/auth/logout`

## Security checks on protected dashboard routes

- `requireAuth` checks `req.session.user`.
- `requireGuildAdmin` checks:
  - guild exists in `req.session.guilds`
  - user has `Administrator` or `Manage Server` in session guild permissions
  - bot is currently in the guild via Discord.js client

## Test steps

1. Start API/bot on VPS:
   - `cd /root/bots/bot6`
   - `npm start`
2. Public health check:
   - `curl http://localhost:3001/api/health`
3. Open OAuth login in browser:
   - [https://api.prestonhq.com/api/auth/discord](https://api.prestonhq.com/api/auth/discord)
4. Complete Discord login/consent.
5. Confirm redirect arrives at:
   - [https://prestonhq.com/dashboard](https://prestonhq.com/dashboard)
6. Verify authenticated session:
   - Open [https://api.prestonhq.com/api/auth/me](https://api.prestonhq.com/api/auth/me) in same browser session
7. Logout:
   - `POST https://api.prestonhq.com/api/auth/logout` from frontend with `credentials: "include"`

## Frontend fetch requirements

- Use `credentials: "include"` on dashboard API requests.
- Do not pass user identity in headers/query/body.
