require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const WebhookServer = require('./webhook-server');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ─── Load Commands ────────────────────────────────────────────────────────────
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  client.commands.set(command.data.name, command);
  console.log(`Loaded command: ${command.data.name}`);
}

// ─── Interaction Handler ──────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {

  // Slash commands — route to command.execute()
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) {
      console.error(`No command matching ${interaction.commandName} was found.`);
      return;
    }
    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Error executing ${interaction.commandName}:`, error);
      await interaction.reply({
        content: 'There was an error executing this command!',
        ephemeral: true,
      });
    }
    return;
  }

  // Select menus — route to the owning command's handleInteraction()
  // customId format: 'triage_source', 'triage_type', etc. — prefix maps to reportissue
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId.startsWith('triage_')) {
      const command = client.commands.get('reportissue');
      if (command?.handleInteraction) await command.handleInteraction(interaction);
    }
    return;
  }

  // Modal submissions — route based on customId prefix
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('ticket_details::')) {
      const command = client.commands.get('reportissue');
      if (command?.handleInteraction) await command.handleInteraction(interaction);
    }
    return;
  }
});

// ─── Ready ────────────────────────────────────────────────────────────────────
client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📝 Loaded ${client.commands.size} commands`);

  const webhookServer = new WebhookServer(client);
  webhookServer.start();
});

client.login(process.env.DISCORD_TOKEN);