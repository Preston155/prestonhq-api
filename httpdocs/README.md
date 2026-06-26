# PrestonHQ Dashboard Frontend (`httpdocs`)

Upload **everything in this folder** to your Cybrancee web root (`httpdocs`) for `https://prestonhq.com`.

## Folder layout

```
httpdocs/
├── .htaccess
├── index.html                 ← Landing page + auto-redirect if logged in
├── dashboard/
│   └── index.html             ← Main bot dashboard UI
└── assets/
    ├── css/
    │   └── app.css            ← Dark modern theme
    └── js/
        ├── config.js          ← API URLs (edit if needed)
        ├── api.js             ← API client wrapper
        └── dashboard.js       ← Dashboard logic
```

## Upload steps (Cybrancee)

1. Open your Cybrancee file manager or FTP for `prestonhq.com`.
2. Go to the site **document root** (`httpdocs` or `public_html`).
3. Upload all files from this folder, preserving paths:
   - `/index.html`
   - `/dashboard/index.html`
   - `/assets/...`
   - `/.htaccess`
4. Visit `https://prestonhq.com` — you should see the landing page.
5. Click **Login with Discord** or go to `https://prestonhq.com/dashboard/`.

## How it connects to the bot

| Frontend | Backend |
|----------|---------|
| `https://prestonhq.com` | Static site on Cybrancee |
| `https://api.prestonhq.com/api` | Nexora bot + Express API on VPS |

All API calls use:

```javascript
fetch("https://api.prestonhq.com/api/...", { credentials: "include" })
```

Login redirects to:

```
https://api.prestonhq.com/api/auth/discord
```

After OAuth, Discord sends the user back to the API callback, which sets the `nexora_sid` cookie on `.prestonhq.com` and redirects to `/dashboard`.

## Requirements (already on VPS)

- Bot API running (`prestonhq-bot-api` PM2 process)
- Nginx proxy: `api.prestonhq.com` → `localhost:3001`
- SSL on `api.prestonhq.com`
- Discord Developer Portal redirect URI:
  `https://api.prestonhq.com/api/auth/discord/callback`
- `.env` on VPS:
  - `FRONTEND_ORIGIN=https://prestonhq.com`
  - `COOKIE_DOMAIN=.prestonhq.com`
  - Valid `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`

## Dashboard modules

- **Overview** — bot health + guild snapshot
- **Commands** — enable/disable built-in commands, cooldowns
- **Custom Commands** — create/edit/delete trigger commands
- **Custom Replies** — auto-reply triggers
- **Tickets** — panel settings + send panel to channel
- **Welcome** — welcome message settings + test send
- **Reaction Roles** — send button role panel
- **Logging** — mod/member log channels
- **General Settings** — prefix + feature toggles

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Login loops back to home | Check Discord redirect URI and `DISCORD_CLIENT_ID` in VPS `.env` |
| API calls fail / CORS | Ensure `FRONTEND_ORIGIN=https://prestonhq.com` on VPS |
| Cookie not set | Cookie domain must be `.prestonhq.com`; use HTTPS on both domains |
| No servers in dropdown | Bot must be in the server; you need Manage Server permission |
| `/dashboard` 404 | Upload `dashboard/index.html` and `.htaccess` |

## Customizing

Edit `assets/js/config.js` if API URL changes:

```javascript
PrestonHQ.config = {
  API_BASE: "https://api.prestonhq.com/api",
  LOGIN_URL: "https://api.prestonhq.com/api/auth/discord",
  SITE_NAME: "PrestonHQ",
  BOT_NAME: "Nexora"
};
```
