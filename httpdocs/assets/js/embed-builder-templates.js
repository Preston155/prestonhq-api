(function () {
  PrestonHQ.embedTemplates = {
    blank: {
      label: "Blank",
      data: {
        accentColor: "#5865f2",
        blocks: []
      }
    },
    announcement: {
      label: "📢 Announcement",
      data: {
        accentColor: "#5865f2",
        blocks: [
          { type: "text", content: "## 📢 Server Announcement\nBig news for **{server}** — read below for details." },
          { type: "separator", spacing: "small" },
          { type: "text", content: "**Status:** 🟢 Live\n**Channel:** {channel}" },
          { type: "buttons", buttons: [{ label: "Learn More", style: "link", url: "https://discord.com" }] }
        ]
      }
    },
    rules: {
      label: "📜 Rules",
      data: {
        accentColor: "#57f287",
        blocks: [
          { type: "text", content: "## 📜 Community Rules\nFollow these rules to keep **{server}** awesome.\n\n1. **Respect** everyone\n2. **No spam** in channels\n3. **Stay safe** — follow Discord ToS" }
        ]
      }
    },
    ticket: {
      label: "🎫 Ticket Panel",
      data: {
        accentColor: "#eb459e",
        blocks: [
          { type: "text", content: "## 🎫 Support\nNeed help? Open a ticket and our team will assist you privately." },
          { type: "buttons", buttons: [{ label: "Open Ticket", style: "primary", customId: "ticket:open", emoji: "🎫" }] }
        ]
      }
    },
    giveaway: {
      label: "🎁 Giveaway",
      data: {
        accentColor: "#fee75c",
        blocks: [
          { type: "text", content: "## 🎁 GIVEAWAY!\nReact or click below to enter!\n\n**Prize:** Nitro Classic\n**Winners:** 1" },
          { type: "buttons", buttons: [{ label: "Enter Giveaway", style: "success", customId: "gw:enter", emoji: "🎉" }] }
        ]
      }
    },
    welcome: {
      label: "👋 Welcome",
      data: {
        accentColor: "#5865f2",
        blocks: [
          { type: "text", content: "Hey **{user}**! Welcome to **{server}** 🎉\n\nYou are member **#{memberCount}**.\n\nRead the rules and grab roles below." },
          { type: "separator", spacing: "small" },
          { type: "buttons", buttons: [
            { label: "Rules", style: "link", url: "https://discord.com" },
            { label: "Get Roles", style: "primary", customId: "roles:pick" }
          ]}
        ]
      }
    },
    changelog: {
      label: "📋 Changelog",
      data: {
        accentColor: "#6366f1",
        blocks: [
          { type: "text", content: "## 📋 Update v2.4.0\n\n**Added**\nMessage Studio (V2 only)\n\n**Fixed**\nTicket close flow\n\n**Improved**\nDashboard performance" }
        ]
      }
    },
    shop: {
      label: "🛒 Shop",
      data: {
        accentColor: "#f47fff",
        blocks: [
          { type: "text", content: "## 🛒 Server Shop\nBrowse packages and perks in **{server}**.\n\n| Package | Price |\n| --- | --- |\n| VIP | $9.99/mo |\n| Booster | Nitro perk |\n| Custom Role | $4.99 |" },
          { type: "buttons", buttons: [{ label: "Checkout", style: "success", customId: "shop:buy" }] }
        ]
      }
    },
    event: {
      label: "📅 Event",
      data: {
        accentColor: "#ed4245",
        blocks: [
          { type: "text", content: "## 📅 Community Event\nJoin us for game night!\n\n**When:** Saturday 8 PM EST\n**Where:** Voice channel" },
          { type: "buttons", buttons: [
            { label: "Interested", style: "primary", customId: "event:yes", emoji: "✅" },
            { label: "Maybe", style: "secondary", customId: "event:maybe", emoji: "🤔" },
            { label: "Can't Go", style: "danger", customId: "event:no", emoji: "❌" }
          ]}
        ]
      }
    },
    poll: {
      label: "📊 Poll",
      data: {
        accentColor: "#5865f2",
        blocks: [
          { type: "text", content: "## 📊 Quick Poll\nWhat's your favorite feature?\n\nVote with the buttons below." },
          { type: "buttons", buttons: [
            { label: "Tickets", style: "primary", customId: "poll:tickets", emoji: "🎫" },
            { label: "Commands", style: "secondary", customId: "poll:cmds", emoji: "⚡" },
            { label: "Welcome", style: "secondary", customId: "poll:welcome", emoji: "👋" }
          ]}
        ]
      }
    },
    v2card: {
      label: "⚡ V2 Card",
      data: {
        accentColor: "#6366f1",
        blocks: [
          { type: "text", content: "## ✨ Components V2\nPremium layouts with **markdown**, buttons & media." },
          { type: "separator", spacing: "small" },
          { type: "text", content: "### Features\n- Text displays\n- Separators\n- Button rows\n- Media galleries" },
          { type: "separator", spacing: "large" },
          { type: "buttons", buttons: [
            { label: "Primary", style: "primary", customId: "v2:go" },
            { label: "Website", style: "link", url: "https://discord.com" }
          ]}
        ]
      }
    },
    v2status: {
      label: "⚡ V2 Status",
      data: {
        accentColor: "#57f287",
        blocks: [
          { type: "text", content: "## 🟢 All Systems Operational\n**Nexora** is online and serving **{guildCount}** guilds." },
          { type: "separator", spacing: "small" },
          { type: "text", content: "| Service | Status |\n| --- | --- |\n| Bot API | ✅ |\n| Dashboard | ✅ |" },
          { type: "buttons", buttons: [{ label: "Status Page", style: "link", url: "https://discord.com" }] }
        ]
      }
    }
  };
})();
