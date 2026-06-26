require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { createApiServer } = require("./src/api/server");
const { registerMessageHandler } = require("./src/bot/messageHandler");
const { registerInteractionHandler } = require("./src/bot/interactionHandler");

const token = process.env.DISCORD_TOKEN;
const apiPort = Number(process.env.API_PORT || "3001");
const frontendOrigin = process.env.FRONTEND_ORIGIN || "https://api.prestonhq.com";
const publicApiBaseUrl = process.env.PUBLIC_API_BASE_URL || "https://api.prestonhq.com";
const sessionSecret = process.env.SESSION_SECRET;
const dashboardPassword = process.env.DASHBOARD_PASSWORD;
const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
const cookieSameSite = process.env.COOKIE_SAMESITE || "lax";
const isProduction = process.env.NODE_ENV === "production";

if (!token || !sessionSecret || !dashboardPassword) {
  console.error("Missing required env values: DISCORD_TOKEN, SESSION_SECRET, DASHBOARD_PASSWORD");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

registerMessageHandler(client);
registerInteractionHandler(client);
createApiServer({ client, port: apiPort, frontendOrigin, publicApiBaseUrl, sessionSecret, dashboardPassword, cookieDomain, cookieSameSite, isProduction });

client.once("clientReady", () => {
  console.log("Logged in as " + client.user.tag);
});

client.login(token).catch((error) => {
  console.error("Discord login failed:", error.message);
});
