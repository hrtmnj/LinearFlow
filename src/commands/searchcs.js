const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { LinearClient } = require('@linear/sdk');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('searchcs')
    .setDescription('Search for a CS ticket by ID')
    .addStringOption(option =>
      option
        .setName('ticket_id')
        .setDescription('The ticket ID (e.g., INK-123)')
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

      // Get the current identifier (in case it was moved)
      const currentIdentifier = issue.identifier;
      const wasMoved = currentIdentifier !== ticketId;

      // Check if issue has CS label by NAME instead of ID
      const labels = await issue.labels();
      const hasCSLabel = labels.nodes.some(label => label.name.toUpperCase() === 'CS');

      if (!hasCSLabel) {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('Access Denied')
          .setDescription(
            wasMoved 
              ? `Ticket **${ticketId}** has been moved to **${currentIdentifier}** and no longer has the CS label. You can only search CS tickets.`
              : `Ticket **${ticketId}** does not have the CS label. You can only search CS tickets.`
          )
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

      // Get decline/archive reason from comments if archived or canceled
      let declineReason = null;
      if (stateName.toLowerCase() === 'canceled' || stateName.toLowerCase() === 'archive') {
        const comments = await issue.comments();
        
        console.log('Total comments:', comments.nodes.length);
        
        if (comments.nodes.length > 0) {
          // Comments are ordered by creation date descending (newest first)
          // Get the last comment (oldest, which is likely the decline reason)
          const lastComment = comments.nodes[comments.nodes.length - 1];
          
          console.log('Last comment:', lastComment.body);
          
          declineReason = lastComment.body;
          
          // Cap at 200 characters
          if (declineReason.length > 200) {
            declineReason = declineReason.substring(0, 197) + '...';
          }
        } else {
          // No comments found - use generic message
          declineReason = 'This ticket was declined without a specific reason provided.';
        }
      }

      // Check for duplicates (related issues) and get full info
      let duplicateInfo = null;
      const relations = await issue.relations();
      for (const relation of relations.nodes) {
        const relatedIssue = await relation.relatedIssue;
        if (relatedIssue && relation.type === 'duplicate') {
          duplicateInfo = {
            identifier: relatedIssue.identifier,
            title: relatedIssue.title
          };
          break;
        }
      }

      // Build the embed
      const embed = new EmbedBuilder()
        .setColor(stateName.toLowerCase() === 'done' ? 0x00FF00 : 
                 stateName.toLowerCase() === 'canceled' ? 0xFF0000 : 
                 stateName.toLowerCase() === 'archive' ? 0xFF0000 :
                 stateName.toLowerCase() === 'in progress' ? 0xFFFF00 : 
                 0x5E6AD2)
        .setTitle(`${currentIdentifier} - ${issue.title}`)
        .setURL(issue.url)
        .addFields(
          { name: 'Status', value: stateName, inline: true },
          { name: 'Priority', value: issue.priority === 1 ? 'Urgent' : 
                                     issue.priority === 2 ? 'High' : 
                                     issue.priority === 3 ? 'Medium' : 
                                     issue.priority === 4 ? 'Low' : '⚪ None', inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'LinearFlow Bot' });

      // Add note if ticket was moved
      if (wasMoved) {
        embed.setDescription(`*Note: This ticket was originally **${ticketId}** but has been moved to a different team.*`);
      }

      // Add user description
      embed.addFields({
        name: 'Description',
        value: userDescription,
        inline: false
      });

      // Add duplicate info if exists
      if (duplicateInfo) {
        embed.addFields({
          name: 'Duplicate Of',
          value: `This ticket is marked as a duplicate of **${duplicateInfo.identifier} - ${duplicateInfo.title}**`,
          inline: false
        });
      }

      // Add decline reason if exists (for archived/canceled tickets)
      if (declineReason) {
        embed.addFields({
          name: 'Decline Reason',
          value: declineReason,
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