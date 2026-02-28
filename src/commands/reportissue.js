const {
  SlashCommandBuilder,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  FileUploadBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
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

// ─── Modal 1: Source + Ticket Type ───────────────────────────────────────────
function buildModal1() {
  const modal = new ModalBuilder()
    .setCustomId('report_step1')
    .setTitle('Create New Report');

  const sourceSelect = new StringSelectMenuBuilder()
    .setCustomId('report_source')
    .setPlaceholder('Select a source...')
    .setRequired(true)
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
    .setCustomId('report_type')
    .setPlaceholder('Select a ticket type...')
    .setRequired(true)
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

  const sourceLabel = new LabelBuilder()
    .setLabel('Source')
    .setStringSelectMenuComponent(sourceSelect);

  const typeLabel = new LabelBuilder()
    .setLabel('Ticket Type')
    .setStringSelectMenuComponent(typeSelect);

  modal.addLabelComponents(sourceLabel, typeLabel);
  return modal;
}

// ─── Modal 2: Priority + Platform + Title + Description + Attachments ─────────
// Source and type are encoded into the customId so they survive between modals.
function buildModal2(source, type) {
  const descHints = {
    bug:     'Steps to reproduce, expected vs actual behaviour, any error messages',
    feature: "Problem you're trying to solve and your proposed solution",
    general: 'Describe your question or what you need help with',
    outage:  'What is affected, when it started, how many users impacted',
  };

  const modal = new ModalBuilder()
    .setCustomId(`report_step2::${source}::${type}`)
    .setTitle('Create New Report');

  const prioritySelect = new StringSelectMenuBuilder()
    .setCustomId('report_priority')
    .setPlaceholder('Select a priority...')
    .setRequired(true)
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
    .setCustomId('report_platform')
    .setPlaceholder('Select a platform...')
    .setRequired(true)
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('Desktop').setValue('desktop'),
      new StringSelectMenuOptionBuilder().setLabel('Console').setValue('console'),
      new StringSelectMenuOptionBuilder().setLabel('Mobile - iOS').setValue('ios'),
      new StringSelectMenuOptionBuilder().setLabel('Mobile - Android').setValue('android'),
    );

  const titleInput = new TextInputBuilder()
    .setCustomId('report_title')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Brief summary of the issue or request')
    .setMaxLength(100)
    .setRequired(true);

  const descInput = new TextInputBuilder()
    .setCustomId('report_description')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(descHints[type] ?? 'Provide as much detail as possible...')
    .setMaxLength(2000)
    .setRequired(true);

  const fileUpload = new FileUploadBuilder()
    .setCustomId('report_attachments')
    .setMinValues(0)
    .setMaxValues(3)
    .setRequired(false);

  const priorityLabel = new LabelBuilder()
    .setLabel('Priority')
    .setStringSelectMenuComponent(prioritySelect);

  const platformLabel = new LabelBuilder()
    .setLabel('Platform')
    .setStringSelectMenuComponent(platformSelect);

  const titleLabel = new LabelBuilder()
    .setLabel('Title')
    .setTextInputComponent(titleInput);

  const descLabel = new LabelBuilder()
    .setLabel('Description')
    .setDescription(descHints[type])
    .setTextInputComponent(descInput);

  const fileLabel = new LabelBuilder()
    .setLabel('Attachments')
    .setDescription('Screenshots or videos (optional, max 3)')
    .setFileUploadComponent(fileUpload);

  modal.addLabelComponents(priorityLabel, platformLabel, titleLabel, descLabel, fileLabel);
  return modal;
}

// ─── Handle Step 1 Submission → show Modal 2 ─────────────────────────────────
async function handleStep1(interaction) {
  const source = interaction.fields.getStringSelectValues('report_source')[0];
  const type   = interaction.fields.getStringSelectValues('report_type')[0];

  // Respond immediately with Modal 2 — no defer allowed before showModal
  await interaction.showModal(buildModal2(source, type));
}

// ─── Handle Step 2 Submission → create Linear issue ──────────────────────────
async function handleStep2(interaction) {
  await interaction.deferReply();

  const [, source, type] = interaction.customId.split('::');
  const priority      = interaction.fields.getStringSelectValues('report_priority')[0];
  const platform      = interaction.fields.getStringSelectValues('report_platform')[0];
  const title         = interaction.fields.getTextInputValue('report_title');
  const description   = interaction.fields.getTextInputValue('report_description');
  const uploadedFiles = interaction.fields.getUploadedFiles('report_attachments') ?? [];

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

  // Slash command → immediately show Modal 1
  async execute(interaction) {
    await interaction.showModal(buildModal1());
  },

  // Modal submissions routed here from index.js
  async handleInteraction(interaction) {
    if (!interaction.isModalSubmit()) return;

    if (interaction.customId === 'report_step1') {
      await handleStep1(interaction);
      return;
    }

    if (interaction.customId.startsWith('report_step2::')) {
      await handleStep2(interaction);
      return;
    }
  },
};