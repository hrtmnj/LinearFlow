const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { LinearClient } = require('@linear/sdk');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listcs')
    .setDescription('List CS tickets in triage status'),

  async execute(interaction) {
    // Defer reply since Linear API might take a moment
    await interaction.deferReply();

    try {
      const linearClient = new LinearClient({
        apiKey: process.env.LINEAR_API_KEY,
      });

      const teamId = process.env.LINEAR_TEAM_GATEWAY;
      const csLabelId = process.env.LINEAR_LABEL_CS;

      // Check if required env vars are set
      if (!teamId || !csLabelId) {
        await interaction.editReply({
          content: 'CS label or Gateway team not configured. Please contact an admin.',
        });
        return;
      }

      // Get the team to find the triage state
      const team = await linearClient.team(teamId);
      const states = await team.states();
      
      // Find the "Triage" state (case-insensitive)
      const triageState = states.nodes.find(
        state => state.name.toLowerCase() === 'triage'
      );

      if (!triageState) {
        await interaction.editReply({
          content: 'Could not find "Triage" status in the Gateway team.',
        });
        return;
      }

      // Query issues with CS label and Triage status
      const issues = await linearClient.issues({
        filter: {
          team: { id: { eq: teamId } },
          labels: { id: { eq: csLabelId } },
          state: { id: { eq: triageState.id } }
        },
        orderBy: 'createdAt',
        first: 25 // Limit to 25 most recent issues
      });

      const issueNodes = issues.nodes;

      if (issueNodes.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(0x5E6AD2)
          .setTitle('CS Tickets in Triage')
          .setDescription('No CS tickets currently in triage status.')
          .setTimestamp()
          .setFooter({ text: 'LinearFlow Bot' });

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Build embed with issue list
      const embed = new EmbedBuilder()
        .setColor(0x5E6AD2)
        .setTitle(`CS Tickets in Triage (${issueNodes.length})`)
        .setTimestamp()
        .setFooter({ text: 'LinearFlow Bot' });

      // Add issues as fields (Discord has a limit of 25 fields)
      const fieldsToAdd = issueNodes.slice(0, 25);
      
      for (const issue of fieldsToAdd) {
        // Extract identifier from URL
        const identifier = issue.url ? issue.url.split('/issue/')[1]?.split('/')[0] : issue.identifier;
        
        // Get priority emoji
        let priorityEmoji = '⚪';
        if (issue.priority === 1) priorityEmoji = '🔴'; // Urgent
        else if (issue.priority === 2) priorityEmoji = '🟠'; // High
        else if (issue.priority === 3) priorityEmoji = '🟡'; // Medium
        else if (issue.priority === 4) priorityEmoji = '🔵'; // Low

        // Truncate title if too long
        const title = issue.title.length > 50 
          ? issue.title.substring(0, 47) + '...' 
          : issue.title;

        embed.addFields({
          name: `${priorityEmoji} ${identifier} - ${title}`,
          value: `[View Issue](${issue.url})`,
          inline: false
        });
      }

      if (issueNodes.length > 25) {
        embed.setDescription(`Showing 25 of ${issueNodes.length} tickets`);
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Error listing CS tickets:', error);
      
      // Error embed
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('Error')
        .setDescription('Failed to list CS tickets. Please try again later.')
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};