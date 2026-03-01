const express = require('express');
const bodyParser = require('body-parser');

class WebhookServer {
  constructor(client) {
    this.app = express();

    this.client = client;
    this.port = process.env.WEBHOOK_PORT || 3000;

    this.app.use(bodyParser.json());
    this.setupRoutes();
  }

  setupRoutes() {
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });

    this.app.post('/webhook/linear', async (req, res) => {
      try {
        await this.handleLinearWebhook(req.body);
        res.status(200).json({ received: true });
      } catch (error) {
        console.error('Error handling webhook:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }

  async handleLinearWebhook(payload) {
    console.log('Received webhook:', payload.type);

    if (payload.type !== 'Issue' || payload.action !== 'create') {
      console.log('Ignoring event:', payload.type, payload.action);
      return;
    }

    const teamId = payload.data?.team?.id;
    if (teamId !== process.env.LINEAR_TEAM_GATEWAY) {
      console.log('Ignoring event from team:', teamId);
      return;
    }

    await this.handleIssueCreated(payload.data, payload.actor);
  }

  async handleIssueCreated(issue, actor) {
    const channelId = process.env.DISCORD_CHANNEL_ISSUES;
    const channel = await this.client.channels.fetch(channelId);

    if (!channel) {
      console.error('Channel not found:', channelId);
      return;
    }

    const { EmbedBuilder } = require('discord.js');

    // Extract plain text description (strip markdown images/links)
    let description = null;
    if (issue.description) {
      description = issue.description
        .replace(/!\[.*?\]\(.*?\)/g, '')   // remove images
        .replace(/\[.*?\]\(.*?\)/g, '')    // remove links
        .replace(/\*\*/g, '')              // remove bold
        .trim();
      if (description.length > 300) description = description.substring(0, 297) + '...';
      if (description.length === 0) description = null;
    }

    const actorName = actor?.name || 'Someone';
    const assignee = issue.assignee?.name || 'Unassigned';
    const type = issue.labelIds?.length ? (issue.labels?.[0]?.name || 'Issue') : 'Issue';

    const embed = new EmbedBuilder()
      .setColor(0x5E6AD2)
      .setAuthor({ name: `${actorName} created a new issue` })
      .setTitle(`${issue.identifier} - ${issue.title}`)
      .setURL(issue.url)
      .addFields(
        { name: 'Type',        value: issue.state?.name || 'Unknown', inline: true },
        { name: 'Assigned To', value: assignee,                       inline: true },
      )
      .setTimestamp();

    if (description) {
      embed.addFields({ name: 'Description', value: description, inline: false });
    }

    await channel.send({ embeds: [embed] });
  }

  start() {
    this.app.listen(this.port, () => {
      console.log(`📡 Webhook server listening on port ${this.port}`);
    });
  }
}

module.exports = WebhookServer;