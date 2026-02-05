const { SlashCommandBuilder, EmbedBuilder  } = require('discord.js');
const { LinearClient } = require('@linear/sdk');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('linearflow')
    .setDescription('Create a issue report')
    .addSubcommand(subcommand =>
      subcommand
        .setName('reportissue')
        .setDescription('Report an issue through our gateway triage')
        .addStringOption(option =>
          option
            .setName('source')
            .setDescription('Source of the issue')
            .setRequired(true)
            .addChoices(
              { name: 'Quality Assurance', value: 'QA' },
              { name: 'Community Support', value: 'CS' }
            )
        )
        .addStringOption(option =>
          option
            .setName('title')
            .setDescription('Brief title of the issue')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('description')
            .setDescription('Detailed description of the issue')
            .setRequired(true)
        )
        .addAttachmentOption(option =>
          option
            .setName('attachment1')
            .setDescription('Screenshot or video (optional)')
            .setRequired(false)
        )
        .addAttachmentOption(option =>
          option
            .setName('attachment2')
            .setDescription('Additional screenshot or video (optional)')
            .setRequired(false)
        )
        .addAttachmentOption(option =>
          option
            .setName('attachment3')
            .setDescription('Additional screenshot or video (optional)')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    // Defer reply since Linear API might take a moment
    await interaction.deferReply();

    try {
      const linearClient = new LinearClient({
        apiKey: process.env.LINEAR_API_KEY,
      });

      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');
      const source = interaction.options.getString('source');
      const teamId = process.env.LINEAR_TEAM_GATEWAY;

      // Get attachments
      const attachment1 = interaction.options.getAttachment('attachment1');
      const attachment2 = interaction.options.getAttachment('attachment2');
      const attachment3 = interaction.options.getAttachment('attachment3');

      const attachments = [attachment1, attachment2, attachment3].filter(Boolean);

      // Check if team ID is set
      if (!teamId) {
        await interaction.editReply({
          content: 'Gateway team not configured. Please contact an admin.',
        });
        return;
      }

      // Build attachment links for description
      let attachmentLinks = '';
      if (attachments.length > 0) {
        attachmentLinks = '\n\n**Attachments:**\n\n';
        attachments.forEach((att, index) => {
          // Check if it's an image (png, jpg, jpeg, gif, webp)
          if (att.contentType && att.contentType.startsWith('image/')) {
            // Embed image directly
            attachmentLinks += `![${att.name}](${att.url})\n\n`;
          } else {
            // Link for videos and other files
            attachmentLinks += `${index + 1}. [${att.name}](${att.url})\n`;
          }
        });
      }

      // Create the issue in Linear
      const issue = await linearClient.createIssue({
        teamId: teamId,
        title: title,
        description: `**Source:** ${source}
**User Description:** ${description}\n${attachmentLinks}`,
        priority: 3,
      });

      // Get the created issue details
      const createdIssue = await issue.issue;
      
      if (createdIssue) {

        // Extract identifier from URL
        // URL format: https://linear.app/kizmotek/issue/INK-17/test
        const identifier = createdIssue.url ? createdIssue.url.split('/issue/')[1]?.split('/')[0] : null;

        // Build Discord message URL
        const messageUrl = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${interaction.id}`;

        await linearClient.createAttachment({
          issueId: createdIssue.id,
          title: 'Bug Report from Discord',
          url: messageUrl,
          subtitle: `#${interaction.channel?.name || 'unknown'} - ${interaction.user.tag} :: Issue ${identifier} created`,
        });

        // Add each Discord attachment as a Linear attachment
        for (const attachment of attachments) {
          await linearClient.createAttachment({
            issueId: createdIssue.id,
            title: attachment.name,
            url: attachment.url,
            subtitle: `Uploaded by ${interaction.user.tag}`,
          });
        }

        // Create the embed
        const embed = new EmbedBuilder()
          .setColor(0x5E6AD2)
          .setTitle('Bug Report Created')
          .setDescription(identifier ? `**${identifier}** - ${title}` : title)
          .addFields(
            { name: 'Reported by', value: interaction.user.tag, inline: true },
            { name: 'Team', value: 'Gateway', inline: true },
            { name: 'Source', value: source, inline: true },
            { name: 'Status', value: 'Triage', inline: true },
          )
          .setURL(createdIssue.url)
          .setTimestamp()
          .setFooter({ text: 'LinearFlow Bot' });

        // Add attachment info to embed
        if (attachments.length > 0) {
          embed.addFields({
            name: 'Attachments',
            value: attachments.map(att => `📎 ${att.name}`).join('\n'),
            inline: false
          });
        }

        // Send the embed
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply({
          content: 'Bug report submitted successfully!',
        });
      }

    } catch (error) {
      console.error('Error creating Linear issue:', error);
      
      // Error embed
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('Error')
        .setDescription('Failed to create bug report. Please try again later.')
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};