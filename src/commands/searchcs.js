const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { LinearClient } = require('@linear/sdk');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('searchcs')
    .setDescription('Search for a CS ticket by ID')
    .addStringOption(option =>
      option
        .setName('ticket_id')
        .setDescription('The ticket ID (e.g., INK-53)')
        .setRequired(true)
    ),

  async execute(interaction) {
    // Defer reply since Linear API might take a moment
    await interaction.deferReply();

    try {
      const linearClient = new LinearClient({
        apiKey: process.env.LINEAR_API_KEY,
      });

      const ticketId = interaction.options.getString('ticket_id').trim().toUpperCase();
      const csLabelId = process.env.LINEAR_LABEL_CS;

      // Check if CS label is configured
      if (!csLabelId) {
        await interaction.editReply({
          content: 'CS label not configured. Please contact an admin.',
        });
        return;
      }

      // Use the issue() method with the identifier directly
      let issue;
      try {
        issue = await linearClient.issue(ticketId);
      } catch (error) {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('Ticket Not Found')
          .setDescription(`Could not find ticket **${ticketId}**.`)
          .setTimestamp();

        await interaction.editReply({ embeds: [errorEmbed] });
        return;
      }

      // Check if issue has CS label
      const labels = await issue.labels();
      const hasCSLabel = labels.nodes.some(label => label.id === csLabelId);

      if (!hasCSLabel) {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('Access Denied')
          .setDescription(`Ticket **${ticketId}** does not have the CS label. You can only search CS tickets.`)
          .setTimestamp();

        await interaction.editReply({ embeds: [errorEmbed] });
        return;
      }

      // Get state information
      const state = await issue.state;
      const stateName = state?.name || 'Unknown';

      // Extract user description from issue description
      let userDescription = 'No description available';
      if (issue.description) {
        // Look for "User Description:" and extract text after it
        const descMatch = issue.description.match(/\*\*User Description:\*\*\s*(.+?)(\n\n|\*\*|$)/s);
        if (descMatch) {
          userDescription = descMatch[1].trim();
          // Remove any markdown image/video syntax
          userDescription = userDescription.replace(/!\[.*?\]\(.*?\)/g, '').trim();
          // Remove any markdown links at the end
          userDescription = userDescription.replace(/\[.*?\]\(.*?\)/g, '').trim();
          // Cap at 200 characters
          if (userDescription.length > 200) {
            userDescription = userDescription.substring(0, 197) + '...';
          }
        } else {
          // Fallback: just take the first part of the description
          userDescription = issue.description.substring(0, 200);
          if (issue.description.length > 200) {
            userDescription += '...';
          }
        }
      }

      // Check if archived/canceled and get reason from comments
      let archiveReason = null;
      if (stateName.toLowerCase() === 'canceled' || stateName.toLowerCase() === 'archived') {
        const comments = await issue.comments();
        // Look for a comment that might explain why it was archived
        const recentComment = comments.nodes[0];
        if (recentComment) {
          archiveReason = recentComment.body;
          if (archiveReason.length > 150) {
            archiveReason = archiveReason.substring(0, 147) + '...';
          }
        }
      }

      // Check for duplicates (related issues)
      let duplicateOf = null;
      const relations = await issue.relations();
      for (const relation of relations.nodes) {
        const relatedIssue = await relation.relatedIssue;
        if (relatedIssue && relation.type === 'duplicate') {
          duplicateOf = relatedIssue.identifier;
          break;
        }
      }

      // Build the embed
      const embed = new EmbedBuilder()
        .setColor(stateName.toLowerCase() === 'done' ? 0x00FF00 : 
                 stateName.toLowerCase() === 'canceled' ? 0xFF0000 : 
                 stateName.toLowerCase() === 'in progress' ? 0xFFFF00 : 
                 0x5E6AD2)
        .setTitle(`${issue.identifier} - ${issue.title}`)
        .setURL(issue.url)
        .addFields(
          { name: 'Status', value: stateName, inline: true },
          { name: 'Priority', value: issue.priority === 1 ? '🔴 Urgent' : 
                                     issue.priority === 2 ? '🟠 High' : 
                                     issue.priority === 3 ? '🟡 Medium' : 
                                     issue.priority === 4 ? '🔵 Low' : '⚪ None', inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'LinearFlow Bot' });

      // Add user description
      embed.addFields({
        name: 'Description',
        value: userDescription,
        inline: false
      });

      // Add duplicate info if exists
      if (duplicateOf) {
        embed.addFields({
          name: '🔗 Duplicate Of',
          value: `This ticket is marked as a duplicate of **${duplicateOf}**`,
          inline: false
        });
      }

      // Add archive/cancel reason if exists
      if (archiveReason) {
        embed.addFields({
          name: '📝 Reason',
          value: archiveReason,
          inline: false
        });
      }

      // Add created date
      if (issue.createdAt) {
        const createdDate = new Date(issue.createdAt);
        embed.addFields({
          name: 'Created',
          value: `<t:${Math.floor(createdDate.getTime() / 1000)}:R>`,
          inline: true
        });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error searching ticket:', error);
      
      // Error embed
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('Error')
        .setDescription(`Failed to search ticket: ${error.message}`)
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};