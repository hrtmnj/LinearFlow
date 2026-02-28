const {
  SlashCommandBuilder,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  FileUploadBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  EmbedBuilder,
} = require('discord.js');
const { LinearClient } = require('@linear/sdk');

// ─── Linear Helpers ───────────────────────────────────────────────────────────
function getLabelIds(source) {
  const labelIds = [];
  if (source === 'QA' && process.env.LINEAR_LABEL_QA) labelIds.push(process.env.LINEAR_LABEL_QA);
  else if (source === 'CS' && process.env.LINEAR_LABEL_CS) labelIds.push(process.env.LINEAR_LABEL_CS);
  return labelIds;
}

const ALLOWED_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/mov',
];

async function uploadFileToLinear(linearClient, file) {
  try {
    if (file.contentType && !ALLOWED_CONTENT_TYPES.includes(file.contentType)) {
      console.warn(`Unexpected file type uploaded: ${file.contentType} (${file.name})`);
    }

    const response = await fetch(file.url);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const uploadPayload = await linearClient.fileUpload(
      file.contentType || 'application/octet-stream',
      file.name,
      buffer.length
    );

    await fetch(uploadPayload.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000',
      },
      body: buffer,
    });

    return uploadPayload.assetUrl;
  } catch (error) {
    console.error(`Error uploading file to Linear (${file.name}):`, error);
    return null;
  }
}

// ─── Triage State ─────────────────────────────────────────────────────────────
// Keyed by userId. Tracks select menu picks until all 4 are chosen.
// In-memory is fine — if the bot restarts mid-triage the user just runs /reportissue again.
const userTriage = new Map();

// Prune sessions abandoned for more than 10 minutes to prevent memory leak
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [userId, triage] of userTriage) {
    if (triage.startedAt < cutoff) userTriage.delete(userId);
  }
}, 5 * 60 * 1000);

// ─── Triage Select Menus ──────────────────────────────────────────────────────
function buildTriageComponents() {
  const sourceSelect = new StringSelectMenuBuilder()
    .setCustomId('triage_source')
    .setPlaceholder('Source')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Quality Assurance')
        .setDescription('Internal QA team reporting')
        .setValue('QA'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Community Support')
        .setDescription('Customer-facing support team')
        .setValue('CS'),
    );

  const typeSelect = new StringSelectMenuBuilder()
    .setCustomId('triage_type')
    .setPlaceholder('Ticket Type')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Bug Report')
        .setDescription('Something is broken or not working as expected')
        .setValue('bug'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Feature Request')
        .setDescription('Suggest a new feature or improvement')
        .setValue('feature'),
      new StringSelectMenuOptionBuilder()
        .setLabel('General Inquiry')
        .setDescription('Questions or general support')
        .setValue('general'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Performance / Outage')
        .setDescription('Service is slow, down, or degraded')
        .setValue('outage'),
    );

  const prioritySelect = new StringSelectMenuBuilder()
    .setCustomId('triage_priority')
    .setPlaceholder('Priority')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Critical')
        .setDescription('Production is down, immediate action needed')
        .setValue('critical'),
      new StringSelectMenuOptionBuilder()
        .setLabel('High')
        .setDescription('Major feature broken, no workaround')
        .setValue('high'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Medium')
        .setDescription('Issue exists but a workaround is available')
        .setValue('medium'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Low')
        .setDescription('Minor issue or cosmetic problem')
        .setValue('low'),
    );

  const platformSelect = new StringSelectMenuBuilder()
    .setCustomId('triage_platform')
    .setPlaceholder('Platform')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('Desktop').setValue('desktop'),
      new StringSelectMenuOptionBuilder().setLabel('Console').setValue('console'),
      new StringSelectMenuOptionBuilder().setLabel('Mobile - iOS').setValue('ios'),
      new StringSelectMenuOptionBuilder().setLabel('Mobile - Android').setValue('android'),
    );

  return [
    new ActionRowBuilder().addComponents(sourceSelect),
    new ActionRowBuilder().addComponents(typeSelect),
    new ActionRowBuilder().addComponents(prioritySelect),
    new ActionRowBuilder().addComponents(platformSelect),
  ];
}

// ─── Details Modal ────────────────────────────────────────────────────────────
function buildDetailsModal(source, type, priority, platform) {
  const titles = {
    bug:     'Bug Report — Details',
    feature: 'Feature Request — Details',
    general: 'General — Details',
    outage:  'Performance / Outage — Details',
  };

  const descHints = {
    bug:     'Steps to reproduce, expected vs actual behaviour, any error messages',
    feature: "Problem you're trying to solve and your proposed solution",
    general: 'Describe your question or what you need help with',
    outage:  'What is affected, when it started, how many users impacted',
  };

  const modal = new ModalBuilder()
    .setCustomId(`ticket_details::${source}::${type}::${priority}::${platform}`)
    .setTitle(titles[type] ?? 'Ticket Details');

  const titleInput = new TextInputBuilder()
    .setCustomId('ticket_title')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Brief summary of the issue or request')
    .setMaxLength(100)
    .setRequired(true);

  const titleLabel = new LabelBuilder()
    .setLabel('Title')
    .setTextInputComponent(titleInput);

  const descInput = new TextInputBuilder()
    .setCustomId('ticket_description')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(descHints[type] ?? 'Provide as much detail as possible...')
    .setMaxLength(2000)
    .setRequired(true);

  const descLabel = new LabelBuilder()
    .setLabel('Description')
    .setDescription(descHints[type])
    .setTextInputComponent(descInput);

  const fileUpload = new FileUploadBuilder()
    .setCustomId('ticket_attachments')
    .setMinValues(0)
    .setMaxValues(3)
    .setRequired(false);

  const fileLabel = new LabelBuilder()
    .setLabel('Attachments')
    .setDescription('Screenshots or videos (optional, max 3)')
    .setFileUploadComponent(fileUpload);

  modal.addLabelComponents(titleLabel, descLabel, fileLabel);
  return modal;
}

// ─── Lookup Maps ──────────────────────────────────────────────────────────────
const linearPriority = { critical: 1, high: 2, medium: 3, low: 4 };
const priorityEmoji  = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
const typeEmoji      = { bug: '🐛', feature: '✨', general: '💬', outage: '🚨' };
const platformEmoji  = { desktop: '🖥️', console: '🎮', ios: '📱', android: '🤖' };
const sourceEmoji    = { QA: '🔬', CS: '🎧' };
const sourceLabel    = { QA: 'Quality Assurance', CS: 'Community Support' };
const embedColor     = { critical: 0xe74c3c, high: 0xe67e22, medium: 0xf1c40f, low: 0x2ecc71 };

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── Handle Modal Submission ──────────────────────────────────────────────────
async function handleModalSubmit(interaction) {
  await interaction.deferReply();

  const [, source, type, priority, platform] = interaction.customId.split('::');
  const title       = interaction.fields.getTextInputValue('ticket_title');
  const description = interaction.fields.getTextInputValue('ticket_description');
  const uploadedFiles = interaction.fields.getUploadedFiles('ticket_attachments') ?? [];

  try {
    const linearClient = new LinearClient({ apiKey: process.env.LINEAR_API_KEY });
    const teamId = process.env.LINEAR_TEAM_GATEWAY;

    if (!teamId) {
      await interaction.editReply({ content: 'Gateway team not configured. Please contact an admin.' });
      return;
    }

    // Upload all attachments to Linear in parallel
    let attachmentMarkdown = '';
    if (uploadedFiles.length > 0) {
      const uploadedUrls = await Promise.all(
        uploadedFiles.map(file => uploadFileToLinear(linearClient, file))
      );

      attachmentMarkdown = '\n\n**Attachments:**\n\n';
      uploadedFiles.forEach((file, i) => {
        const url = uploadedUrls[i] || file.url;
        if (file.contentType?.startsWith('image/') || file.contentType?.startsWith('video/')) {
          attachmentMarkdown += `![${file.name}](${url})\n\n`;
        } else {
          attachmentMarkdown += `[${file.name}](${url})\n\n`;
        }
      });
    }

    const issue = await linearClient.createIssue({
      teamId,
      title,
      description: [
        `**Source:** ${sourceLabel[source] ?? source}`,
        `**Type:** ${capitalize(type)}`,
        `**Priority:** ${capitalize(priority)}`,
        `**Platform:** ${capitalize(platform)}`,
        '',
        '**Description:**',
        description,
        attachmentMarkdown,
      ].join('\n'),
      priority: linearPriority[priority] ?? 3,
      labelIds: getLabelIds(source),
    });

    const createdIssue = await issue.issue;

    if (createdIssue) {
      const identifier = createdIssue.url
        ? createdIssue.url.split('/issue/')[1]?.split('/')[0]
        : null;

      const messageUrl = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${interaction.id}`;
      await linearClient.createAttachment({
        issueId: createdIssue.id,
        title: 'Issue Report from Discord',
        url: messageUrl,
        subtitle: `#${interaction.channel?.name || 'unknown'} — ${interaction.user.tag} :: ${identifier} created`,
      });

      const embed = new EmbedBuilder()
        .setColor(embedColor[priority] ?? 0x5E6AD2)
        .setTitle(`${typeEmoji[type]}  ${title}`)
        .setDescription(identifier ? `**${identifier}** — ${title}` : title)
        .addFields(
          { name: 'Source',      value: `${sourceEmoji[source]}  ${sourceLabel[source] ?? source}`, inline: true },
          { name: 'Type',        value: `${typeEmoji[type]}  ${capitalize(type)}`,                  inline: true },
          { name: 'Priority',    value: `${priorityEmoji[priority]}  ${capitalize(priority)}`,      inline: true },
          { name: 'Platform',    value: `${platformEmoji[platform]}  ${capitalize(platform)}`,      inline: true },
          { name: 'Reported by', value: interaction.user.tag,                                       inline: true },
          { name: 'Status',      value: 'Triage',                                                   inline: true },
          { name: 'Description', value: description },
        )
        .setURL(createdIssue.url)
        .setTimestamp()
        .setFooter({ text: 'LinearFlow Bot' });

      if (uploadedFiles.length > 0) {
        embed.addFields({
          name: 'Attachments',
          value: uploadedFiles.map(f => f.name).join('\n'),
          inline: false,
        });
      }

      const ticketChannelId = process.env.TICKET_CHANNEL_ID;
      if (ticketChannelId) {
        const channel = await interaction.client.channels.fetch(ticketChannelId);
        await channel.send({ embeds: [embed] });
        await interaction.editReply({ content: '✅ Your issue has been submitted to Linear!' });
      } else {
        await interaction.editReply({ embeds: [embed] });
      }

    } else {
      await interaction.editReply({ content: '✅ Issue submitted to Linear successfully!' });
    }

  } catch (error) {
    console.error('Error creating Linear issue:', error);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle('Error')
          .setDescription('Failed to create the issue in Linear. Please try again later.')
          .setTimestamp(),
      ],
    });
  }
}

// ─── Command Export ───────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('reportissue')
    .setDescription('Report an issue through our gateway triage'),

  // Called by index.js for slash command interactions
  async execute(interaction) {
    await interaction.reply({
      content: '### Create New Report\nMake your selections below — the details form will open once all four are chosen.',
      components: buildTriageComponents(),
      ephemeral: true,
    });
    userTriage.set(interaction.user.id, {
      source: null, type: null, priority: null, platform: null,
      startedAt: Date.now(),
    });
  },

  // Called by index.js for select menu and modal interactions belonging to this command
  async handleInteraction(interaction) {
    // Select menu picks — accumulate until all 4 chosen, then fire modal
    if (interaction.isStringSelectMenu()) {
      const triage = userTriage.get(interaction.user.id) ?? {};

      if (interaction.customId === 'triage_source')   triage.source   = interaction.values[0];
      if (interaction.customId === 'triage_type')     triage.type     = interaction.values[0];
      if (interaction.customId === 'triage_priority') triage.priority = interaction.values[0];
      if (interaction.customId === 'triage_platform') triage.platform = interaction.values[0];

      userTriage.set(interaction.user.id, triage);

      if (triage.source && triage.type && triage.priority && triage.platform) {
        const modal = buildDetailsModal(triage.source, triage.type, triage.priority, triage.platform);
        await interaction.showModal(modal);
        userTriage.delete(interaction.user.id);
      } else {
        await interaction.deferUpdate();
      }
      return;
    }

    // Modal submission
    if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
    }
  },
};