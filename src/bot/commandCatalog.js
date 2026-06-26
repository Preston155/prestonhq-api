const baseCommands = [
  {
    name: "ping",
    description: "Check bot latency.",
    category: "utility",
    usage: "!ping",
    enabled: true,
    permission: "EVERYONE",
    cooldown: 0,
    type: "prefix"
  },
  {
    name: "order-panel",
    description: "Send the Vexel Studios order ticket panel.",
    category: "tickets",
    usage: "/order-panel",
    enabled: true,
    permission: "MANAGE_CHANNELS",
    cooldown: 0,
    type: "slash"
  }
];

module.exports = {
  baseCommands
};
