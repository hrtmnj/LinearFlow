const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { LinearClient } = require('@linear/sdk');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listqa')
    .setDescription('List QA tickets in triage status')
    .addIntegerOption(option =>
      option
        .setName('amount')
        .setDescription('Number of tickets to display (max 50)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(50)
    ),

  async execute(interaction) {
    // Defer reply since Linear API might take a moment
    await interaction.deferReply();

    try {
      const linearClient = new LinearClient({
        apiKey: process.env.LINEAR_API_KEY,
      });

      const teamId = process.env.LINEAR_TEAM_GATEWAY;
      const qaLabelId = process.env.LINEAR_LABEL_QA;
      const requestedAmount = interaction.options.getInteger('amount') || 50; // Default to 50 if not specified

      // Check if required env vars are set
      if (!teamId || !qaLabelId) {
        await interaction.editReply({
          content: 'QA label or Gateway team not configured. Please contact an admin.',
        });
        return;
      }

      // Validate amount (extra safety check even though Discord validates min/max)
      if (requestedAmount > 50) {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('Error')
          .setDescription('You cannot request more than 50 tickets. Please use a number between 1 and 50.')
          .setTimestamp();

        await interaction.editReply({ embeds: [errorEmbed] });
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

      // Query issues with QA label and Triage status
      const issues = await linearClient.issues({
        filter: {
          team: { id: { eq: teamId } },
          state: { id: { eq: triageState.id } },
          labels: { some: { id: { eq: qaLabelId } } }
        },
        orderBy: 'createdAt',
        first: requestedAmount
      });

      const qaIssues = issues.nodes;

      if (qaIssues.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(0x5E6AD2)
          .setTitle('QA Tickets in Triage')
          .setDescription('No QA tickets currently in triage status.')
          .setTimestamp()
          .setFooter({ text: 'LinearFlow Bot' });

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Determine if pagination is needed (more than 10 items)
      const needsPagination = qaIssues.length > 10;

      if (!needsPagination) {
        // Simple embed without pagination
        const embed = new EmbedBuilder()
          .setColor(0x5E6AD2)
          .setTitle(`QA Tickets in Triage (${qaIssues.length} total)`)
          .setTimestamp()
          .setFooter({ text: 'LinearFlow Bot' });

        qaIssues.forEach((issue, index) => {
          const identifier = issue.identifier || '';
          const title = issue.title.length > 50 
            ? issue.title.substring(0, 47) + '...' 
            : issue.title;

          embed.addFields({
            name: `${index + 1}. ${identifier} - ${title}`,
            value: `[View Issue](${issue.url})`,
            inline: false
          });
        });

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Pagination setup for 10+ items
      const itemsPerPage = 10;
      const totalPages = Math.ceil(qaIssues.length / itemsPerPage);
      let currentPage = 0;

      // Function to generate embed for a specific page
      const generateEmbed = (page) => {
        const start = page * itemsPerPage;
        const end = start + itemsPerPage;
        const pageIssues = qaIssues.slice(start, end);

        const embed = new EmbedBuilder()
          .setColor(0x5E6AD2)
          .setTitle(`QA Tickets in Triage (${qaIssues.length} total)`)
          .setTimestamp()
          .setFooter({ text: `LinearFlow Bot • Page ${page + 1} of ${totalPages}` });

        pageIssues.forEach((issue, index) => {
          const identifier = issue.identifier || '';
          const title = issue.title.length > 50 
            ? issue.title.substring(0, 47) + '...' 
            : issue.title;
          const globalIndex = start + index + 1;

          embed.addFields({
            name: `${globalIndex}. ${identifier} - ${title}`,
            value: `[View Issue](${issue.url})`,
            inline: false
          });
        });

        return embed;
      };

      // Function to generate buttons
      const generateButtons = (page) => {
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('first')
              .setLabel('⏮️ First')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(page === 0),
            new ButtonBuilder()
              .setCustomId('previous')
              .setLabel('◀️ Previous')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(page === 0),
            new ButtonBuilder()
              .setCustomId('next')
              .setLabel('Next ▶️')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(page === totalPages - 1),
            new ButtonBuilder()
              .setCustomId('last')
              .setLabel('Last ⏭️')
              .setStyle(ButtonStyle.Primary)
              .setDisabled(page === totalPages - 1)
          );
        return row;
      };

      // Send initial message
      const embed = generateEmbed(currentPage);
      const buttons = generateButtons(currentPage);

      const message = await interaction.editReply({
        embeds: [embed],
        components: [buttons]
      });

      // Create collector for button interactions
      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 300000 // 5 minutes
      });

      collector.on('collect', async (buttonInteraction) => {
        // Check if the person clicking is the one who ran the command
        if (buttonInteraction.user.id !== interaction.user.id) {
          await buttonInteraction.reply({
            content: 'These buttons are not for you!',
            ephemeral: true
          });
          return;
        }

        // Update page based on button clicked
        if (buttonInteraction.customId === 'first') {
          currentPage = 0;
        } else if (buttonInteraction.customId === 'previous') {
          currentPage = Math.max(0, currentPage - 1);
        } else if (buttonInteraction.customId === 'next') {
          currentPage = Math.min(totalPages - 1, currentPage + 1);
        } else if (buttonInteraction.customId === 'last') {
          currentPage = totalPages - 1;
        }

        // Update the message
        await buttonInteraction.update({
          embeds: [generateEmbed(currentPage)],
          components: [generateButtons(currentPage)]
        });
      });

      collector.on('end', async () => {
        // Disable buttons after timeout
        try {
          await message.edit({
            embeds: [generateEmbed(currentPage)],
            components: []
          });
        } catch (error) {
          // Message might have been deleted
          console.log('Could not disable buttons:', error.message);
        }
      });

    } catch (error) {
      console.error('Error listing QA tickets:', error);
      
      // Error embed
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('Error')
        .setDescription(`Failed to list QA tickets: ${error.message}`)
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};