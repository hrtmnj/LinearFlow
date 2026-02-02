const express = require('express');
const bodyParser = require('body-parser');

class WebhookServer {
  constructor(client) {
    this.app = express();

    // Discord client
    this.client = client;
    this.port = process.env.WEBHOOK_PORT || 3000;

    // Middleware
    this.app.use(bodyParser.json());

    // Routes
    this.setupRoutes();
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });

    // Linear webhook endpoint
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

    // Filter: Only process certain event types
    const allowedEvents = ['Issue', 'IssueUpdate', 'Comment'];
    if (!allowedEvents.includes(payload.type)) {
      console.log('Ignoring event type:', payload.type);
      return;
    }

    // Filter: Only process issues from specific teams
    const teamId = payload.data?.team?.id;
    if (teamId !== process.env.LINEAR_TEAM_GATEWAY) {
      console.log('Ignoring event from team:', teamId);
      return;
    }

    // Route to appropriate handler
    switch (payload.type) {
      case 'Issue':
        await this.handleIssueCreated(payload.data);
        break;
      case 'IssueUpdate':
        await this.handleIssueUpdated(payload.data, payload.updatedFrom);
        break;
      case 'Comment':
        await this.handleComment(payload.data);
        break;
    }
  }

  async handleIssueCreated(issue) {
    const channelId = process.env.DISCORD_CHANNEL_ISSUES;
    const channel = await this.client.channels.fetch(channelId);

    if (!channel) {
      console.error('Channel not found:', channelId);
      return;
    }

    const { EmbedBuilder } = require('discord.js');

    const embed = new EmbedBuilder()
      .setColor(0x5E6AD2)
      .setTitle(`🆕 New Issue: ${issue.identifier}`)
      .setDescription(issue.title)
      .addFields(
        { name: 'Status', value: issue.state?.name || 'Unknown', inline: true },
        { name: 'Priority', value: this.getPriorityText(issue.priority), inline: true },
        { name: 'Assignee', value: issue.assignee?.name || 'Unassigned', inline: true },
      )
      .setURL(issue.url)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  }

  async handleIssueUpdated(issue, updatedFrom) {
    // Filter: Only notify on status changes
    if (!updatedFrom.stateId) {
      console.log('Ignoring non-status update');
      return;
    }

    const channelId = process.env.DISCORD_CHANNEL_ISSUES;
    const channel = await this.client.channels.fetch(channelId);

    if (!channel) return;

    const { EmbedBuilder } = require('discord.js');

    const embed = new EmbedBuilder()
      .setColor(0xFFA500)
      .setTitle(`Issue Updated: ${issue.identifier}`)
      .setDescription(issue.title)
      .addFields(
        { name: 'New Status', value: issue.state?.name || 'Unknown', inline: true },
      )
      .setURL(issue.url)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  }

  async handleComment(comment) {
    const channelId = process.env.DISCORD_CHANNEL_ISSUES;
    const channel = await this.client.channels.fetch(channelId);

    if (!channel) return;

    const { EmbedBuilder } = require('discord.js');

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle(`💬 New Comment on ${comment.issue?.identifier}`)
      .setDescription(comment.body?.substring(0, 200) + '...')
      .addFields(
        { name: 'Author', value: comment.user?.name || 'Unknown', inline: true },
      )
      .setURL(comment.issue?.url)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  }

  getPriorityText(priority) {
    const priorities = {
      0: '⚪ No priority',
      1: '🔥 Urgent',
      2: '⚠️ High',
      3: '📋 Medium',
      4: '📝 Low',
    };
    return priorities[priority] || 'Unknown';
  }

  start() {
    this.app.listen(this.port, () => {
      console.log(`📡 Webhook server listening on port ${this.port}`);
    });
  }
}

module.exports = WebhookServer;