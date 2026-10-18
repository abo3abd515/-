import {
  ActivityType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type Interaction,
  type Message,
  type TextChannel,
} from "discord.js";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger";
import {
  findOpenTicketForOwner,
  findTicket,
  getGuildConfig,
  updateGuildConfig,
  type GuildTicketConfig,
  type TicketCategory,
  type TicketRecord,
} from "./store";

const HELP_MENU_ID = "ticketbot:help";
const PANEL_MENU_ID = "ticketbot:create";
const CATEGORY_LIMIT = 25;

function buildHelpMessage() {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("مساعدة بوت التكت")
    .setDescription(
      [
        "اختر إجراءً من القائمة. إعداد التكت وإدارة الخيارات متاحة لمشرفي السيرفر فقط.",
        "",
        "• **تنصيب التكت:** اختر رومًا لنشر لوحة فتح التذاكر.",
        "• **خيارات التكت:** أضف أو احذف أنواع التذاكر.",
        "• **مظهر البوت:** غيّر الاسم والصورة وحالة النشاط.",
        "",
        "تغيير وصف البوت (Bio) يتم يدويًا من Discord Developer Portal.",
      ].join("\n"),
    );

  const menu = new StringSelectMenuBuilder()
    .setCustomId(HELP_MENU_ID)
    .setPlaceholder("اختر ما تريد إعداده")
    .addOptions(
      {
        label: "تنصيب نظام التكت",
        description: "اختر روم لوحة التكت ودور الدعم اختياريًا",
        value: "setup",
      },
      {
        label: "خيارات التكت",
        description: "إضافة أو حذف خيارات فتح التكت",
        value: "categories",
      },
      {
        label: "مظهر البوت",
        description: "تغيير الاسم والصورة وحالة النشاط",
        value: "appearance",
      },
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  };
}

function buildPanelPayload(config: GuildTicketConfig) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("الدعم الفني")
    .setDescription("لفتح تذكرة، اختر نوع الطلب من القائمة أدناه.");

  const menu = new StringSelectMenuBuilder()
    .setCustomId(PANEL_MENU_ID)
    .setPlaceholder(
      config.categories.length ? "اختر نوع التذكرة" : "لا توجد خيارات متاحة",
    )
    .setDisabled(config.categories.length === 0);

  for (const category of config.categories.slice(0, CATEGORY_LIMIT)) {
    menu.addOptions({
      label: category.label,
      description: category.description || "فتح تذكرة جديدة",
      value: category.id,
    });
  }

  return {
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  };
}

function buildTicketControls(disabled = false) {
  const close = new ButtonBuilder()
    .setCustomId("ticketbot:close")
    .setLabel("قفل التكت")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(disabled);
  const summon = new ButtonBuilder()
    .setCustomId("ticketbot:summon")
    .setLabel("استدعاء صاحب التكت")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);

  return [new ActionRowBuilder<ButtonBuilder>().addComponents(close, summon)];
}

function isAdministrator(interaction: Interaction): boolean {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator),
  );
}

function hasSupportRole(
  interaction: Interaction,
  supportRoleId: string | null,
): boolean {
  if (!supportRoleId || !interaction.guild || !interaction.member) {
    return false;
  }

  const member = interaction.member;
  if ("roles" in member && Array.isArray(member.roles)) {
    return member.roles.includes(supportRoleId);
  }

  if ("roles" in member && "cache" in member.roles) {
    return member.roles.cache.has(supportRoleId);
  }

  return false;
}

function isTicketStaff(
  interaction: Interaction,
  config: GuildTicketConfig,
): boolean {
  return isAdministrator(interaction) || hasSupportRole(interaction, config.supportRoleId);
}

async function getApplicationOwnerId(client: Client): Promise<string | null> {
  const application = client.application;
  if (!application) {
    return null;
  }

  const fetched = await application.fetch();
  return fetched.owner && "id" in fetched.owner ? fetched.owner.id : null;
}

async function replyEphemeral(
  interaction: Interaction,
  content: string,
): Promise<void> {
  if (!interaction.isRepliable()) {
    return;
  }

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ content, ephemeral: true });
  } else {
    await interaction.reply({ content, ephemeral: true });
  }
}

async function requireGuild(interaction: Interaction): Promise<Guild | null> {
  if (interaction.guild) {
    return interaction.guild;
  }
  await replyEphemeral(interaction, "هذا الخيار متاح داخل السيرفر فقط.");
  return null;
}

function createSetupModal(): ModalBuilder {
  const channelId = new TextInputBuilder()
    .setCustomId("panelChannelId")
    .setLabel("ID روم لوحة التكت")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("مثال: 123456789012345678")
    .setRequired(true)
    .setMinLength(17)
    .setMaxLength(22);
  const supportRoleId = new TextInputBuilder()
    .setCustomId("supportRoleId")
    .setLabel("ID دور الدعم (اختياري)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("اتركه فارغًا إذا لم ترد تعيين دور")
    .setRequired(false)
    .setMaxLength(22);

  return new ModalBuilder()
    .setCustomId("ticketbot:setup-modal")
    .setTitle("تنصيب نظام التكت")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(channelId),
      new ActionRowBuilder<TextInputBuilder>().addComponents(supportRoleId),
    );
}

function createCategoryModal(): ModalBuilder {
  const label = new TextInputBuilder()
    .setCustomId("categoryLabel")
    .setLabel("اسم خيار التكت")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("مثال: الدعم الفني")
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(80);
  const description = new TextInputBuilder()
    .setCustomId("categoryDescription")
    .setLabel("وصف قصير")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("مثال: للمساعدة والاستفسارات")
    .setRequired(false)
    .setMaxLength(100);

  return new ModalBuilder()
    .setCustomId("ticketbot:category-add-modal")
    .setTitle("إضافة خيار تكت")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(label),
      new ActionRowBuilder<TextInputBuilder>().addComponents(description),
    );
}

function createAppearanceModal(): ModalBuilder {
  const username = new TextInputBuilder()
    .setCustomId("botUsername")
    .setLabel("اسم البوت (اختياري)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("من 2 إلى 32 حرفًا")
    .setRequired(false)
    .setMaxLength(32);
  const avatarUrl = new TextInputBuilder()
    .setCustomId("botAvatarUrl")
    .setLabel("رابط صورة البوت (اختياري)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("https://example.com/avatar.png")
    .setRequired(false)
    .setMaxLength(500);
  const activity = new TextInputBuilder()
    .setCustomId("botActivity")
    .setLabel("حالة النشاط (اختياري)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("مثال: نظام التكت")
    .setRequired(false)
    .setMaxLength(100);

  return new ModalBuilder()
    .setCustomId("ticketbot:appearance-modal")
    .setTitle("تغيير مظهر البوت")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(username),
      new ActionRowBuilder<TextInputBuilder>().addComponents(avatarUrl),
      new ActionRowBuilder<TextInputBuilder>().addComponents(activity),
    );
}

function createCategoryManager(config: GuildTicketConfig) {
  const description =
    config.categories.length > 0
      ? config.categories
          .map((category, index) => `${index + 1}. **${category.label}**`)
          .join("\n")
      : "لا توجد خيارات حاليًا.";
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("إدارة خيارات التكت")
    .setDescription(description)
    .setFooter({ text: `الحد الأقصى ${CATEGORY_LIMIT} خيارًا` });
  const add = new ButtonBuilder()
    .setCustomId("ticketbot:category-add")
    .setLabel("إضافة خيار")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(config.categories.length >= CATEGORY_LIMIT);
  const remove = new ButtonBuilder()
    .setCustomId("ticketbot:category-remove")
    .setLabel("حذف خيار")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(config.categories.length <= 1);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(add, remove)],
  };
}

async function refreshTicketPanel(
  guild: Guild,
  config: GuildTicketConfig,
): Promise<void> {
  if (!config.panelChannelId || !config.panelMessageId) {
    return;
  }

  try {
    const channel = await guild.channels.fetch(config.panelChannelId);
    if (!channel || !channel.isTextBased() || !("messages" in channel)) {
      return;
    }
    const message = await (channel as TextChannel).messages.fetch(
      config.panelMessageId,
    );
    await message.edit(buildPanelPayload(config));
  } catch (error) {
    logger.warn({ err: error, guildId: guild.id }, "Could not refresh ticket panel");
  }
}

async function handleHelpMenu(
  interaction: import("discord.js").StringSelectMenuInteraction,
  client: Client,
): Promise<void> {
  const guild = await requireGuild(interaction);
  if (!guild) {
    return;
  }

  const choice = interaction.values[0];
  if (!choice) {
    await replyEphemeral(interaction, "لم يتم اختيار إجراء.");
    return;
  }

  if (choice === "setup") {
    if (!isAdministrator(interaction)) {
      await replyEphemeral(interaction, "يحتاج هذا الإجراء إلى صلاحية المشرف.");
      return;
    }
    await interaction.showModal(createSetupModal());
    return;
  }

  if (choice === "categories") {
    if (!isAdministrator(interaction)) {
      await replyEphemeral(interaction, "يحتاج هذا الإجراء إلى صلاحية المشرف.");
      return;
    }
    const config = await getGuildConfig(guild.id);
    await interaction.reply({
      ...createCategoryManager(config),
      ephemeral: true,
    });
    return;
  }

  if (choice === "appearance") {
    if (!isAdministrator(interaction)) {
      await replyEphemeral(interaction, "يحتاج هذا الإجراء إلى صلاحية المشرف.");
      return;
    }

    const applicationOwnerId = await getApplicationOwnerId(client);
    if (!applicationOwnerId || applicationOwnerId !== interaction.user.id) {
      await replyEphemeral(
        interaction,
        "تغيير ملف البوت متاح لمالك تطبيق البوت فقط. وصف البوت (Bio) يُغيّر يدويًا من Developer Portal.",
      );
      return;
    }
    await interaction.showModal(createAppearanceModal());
  }
}

async function installTicketPanel(
  interaction: import("discord.js").ModalSubmitInteraction,
  guild: Guild,
): Promise<void> {
  const channelId = interaction.fields.getTextInputValue("panelChannelId").trim();
  const supportRoleId =
    interaction.fields.getTextInputValue("supportRoleId").trim() || null;

  if (!/^\d{17,22}$/.test(channelId)) {
    await replyEphemeral(interaction, "ID الروم غير صحيح. انسخه من Discord وحاول مرة أخرى.");
    return;
  }

  if (supportRoleId && !/^\d{17,22}$/.test(supportRoleId)) {
    await replyEphemeral(interaction, "ID دور الدعم غير صحيح.");
    return;
  }

  const channel = await guild.channels.fetch(channelId);
  if (
    !channel ||
    (channel.type !== ChannelType.GuildText &&
      channel.type !== ChannelType.GuildAnnouncement)
  ) {
    await replyEphemeral(interaction, "لم أجد رومًا نصيًا بهذا الـID في هذا السيرفر.");
    return;
  }

  if (supportRoleId && !(await guild.roles.fetch(supportRoleId))) {
    await replyEphemeral(interaction, "لم أجد دورًا بهذا الـID في هذا السيرفر.");
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const current = await getGuildConfig(guild.id);
  const panelChannel = channel as TextChannel;
  let panelMessage: Message | undefined;

  if (
    current.panelChannelId === panelChannel.id &&
    current.panelMessageId
  ) {
    try {
      panelMessage = await panelChannel.messages.fetch(current.panelMessageId);
      await panelMessage.edit(buildPanelPayload(current));
    } catch {
      panelMessage = undefined;
    }
  }

  if (!panelMessage) {
    panelMessage = await panelChannel.send(buildPanelPayload(current));
    if (
      current.panelChannelId &&
      current.panelMessageId &&
      current.panelChannelId !== panelChannel.id
    ) {
      try {
        const oldChannel = await guild.channels.fetch(current.panelChannelId);
        if (oldChannel?.isTextBased() && "messages" in oldChannel) {
          const oldMessage = await (oldChannel as TextChannel).messages.fetch(
            current.panelMessageId,
          );
          await oldMessage.delete();
        }
      } catch {
        logger.info({ guildId: guild.id }, "Previous ticket panel was not available to remove");
      }
    }
  }

  await updateGuildConfig(guild.id, (config) => {
    config.panelChannelId = panelChannel.id;
    config.panelMessageId = panelMessage.id;
    config.supportRoleId = supportRoleId;
  });
  await interaction.editReply(`تم نشر لوحة فتح التكت في <#${panelChannel.id}>.`);
}

async function createTicket(
  interaction: import("discord.js").StringSelectMenuInteraction,
): Promise<void> {
  const guild = await requireGuild(interaction);
  if (!guild) {
    return;
  }

  const config = await getGuildConfig(guild.id);
  const categoryId = interaction.values[0];
  const category = config.categories.find((item) => item.id === categoryId);
  if (!category) {
    await replyEphemeral(interaction, "هذا الخيار لم يعد متاحًا. حدّث لوحة التكت.");
    return;
  }

  const existing = await findOpenTicketForOwner(guild.id, interaction.user.id);
  if (existing) {
    await replyEphemeral(
      interaction,
      `لديك تكت مفتوح بالفعل: <#${existing.channelId}>`,
    );
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const panelChannel = config.panelChannelId
    ? await guild.channels.fetch(config.panelChannelId).catch(() => null)
    : null;
  const parentId =
    panelChannel?.type === ChannelType.GuildText
      ? panelChannel.parentId
      : null;
  const safeUsername = interaction.user.username
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 25) || "member";
  const safeCategory = category.label
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff-]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20) || "ticket";
  const botId = interaction.client.user?.id;
  if (!botId) {
    await interaction.editReply("تعذر تحديد حساب البوت. حاول مرة أخرى.");
    return;
  }

  const channel = await guild.channels.create({
    name: `ticket-${safeUsername}-${safeCategory}`.slice(0, 90),
    type: ChannelType.GuildText,
    ...(parentId ? { parent: parentId } : {}),
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      {
        id: botId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
        ],
      },
      ...(config.supportRoleId
        ? [
            {
              id: config.supportRoleId,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            },
          ]
        : []),
    ],
    reason: `Ticket opened by ${interaction.user.tag}`,
  });

  const ticket: TicketRecord = {
    channelId: channel.id,
    openerId: interaction.user.id,
    categoryId: category.id,
    categoryLabel: category.label,
    createdAt: new Date().toISOString(),
    controlMessageId: "",
    closedAt: null,
  };

  try {
    await updateGuildConfig(guild.id, (currentConfig) => {
      currentConfig.tickets.push(ticket);
    });

    const ticketEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`تذكرة ${category.label}`)
      .setDescription(
        [
          `صاحب التكت: <@${interaction.user.id}>`,
          `نوع التكت: **${category.label}**`,
          `وقت الفتح: <t:${Math.floor(Date.now() / 1000)}:F>`,
        ].join("\n"),
      )
      .setTimestamp();
    const controlMessage = await channel.send({
      content: `<@${interaction.user.id}>`,
      embeds: [ticketEmbed],
      components: buildTicketControls(),
      allowedMentions: { users: [interaction.user.id] },
    });
    await updateGuildConfig(guild.id, (currentConfig) => {
      const stored = currentConfig.tickets.find(
        (item) => item.channelId === channel.id,
      );
      if (stored) {
        stored.controlMessageId = controlMessage.id;
      }
    });
  } catch (error) {
    await updateGuildConfig(guild.id, (currentConfig) => {
      currentConfig.tickets = currentConfig.tickets.filter(
        (item) => item.channelId !== channel.id,
      );
    });
    await channel.delete("Could not finish setting up the ticket");
    throw error;
  }

  await interaction.editReply(`تم فتح تذكرتك: <#${channel.id}>`);
}

async function showCategoryRemoval(
  interaction: import("discord.js").ButtonInteraction,
  guild: Guild,
): Promise<void> {
  const config = await getGuildConfig(guild.id);
  if (config.categories.length <= 1) {
    await replyEphemeral(interaction, "يجب أن يبقى خيار واحد على الأقل.");
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId("ticketbot:category-remove-select")
    .setPlaceholder("اختر الخيار الذي تريد حذفه")
    .addOptions(
      config.categories.map((category) => ({
        label: category.label,
        value: category.id,
      })),
    );
  await interaction.reply({
    content: "اختر خيار التكت الذي تريد حذفه:",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    ephemeral: true,
  });
}

async function setBotAppearance(
  interaction: import("discord.js").ModalSubmitInteraction,
  client: Client,
): Promise<void> {
  const applicationOwnerId = await getApplicationOwnerId(client);
  if (!applicationOwnerId || applicationOwnerId !== interaction.user.id) {
    await replyEphemeral(interaction, "تغيير مظهر البوت متاح لمالك تطبيق البوت فقط.");
    return;
  }

  const username = interaction.fields.getTextInputValue("botUsername").trim();
  const avatarUrl = interaction.fields.getTextInputValue("botAvatarUrl").trim();
  const activity = interaction.fields.getTextInputValue("botActivity").trim();
  const outcomes: string[] = [];

  await interaction.deferReply({ ephemeral: true });

  if (username) {
    if (username.length < 2 || username.length > 32) {
      outcomes.push("الاسم لم يتغير: يجب أن يكون بين حرفين و32 حرفًا.");
    } else {
      try {
        await client.user!.setUsername(username);
        outcomes.push("تم تغيير اسم البوت.");
      } catch (error) {
        logger.warn({ err: error }, "Discord rejected bot username update");
        outcomes.push("تعذر تغيير الاسم الآن؛ قد يكون Discord حدّ من تغييره مؤقتًا.");
      }
    }
  }

  if (avatarUrl) {
    try {
      const url = new URL(avatarUrl);
      if (url.protocol !== "https:") {
        throw new Error("Avatar URL must use HTTPS.");
      }
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const contentType = response.headers.get("content-type") ?? "";
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (!response.ok || !contentType.startsWith("image/")) {
        throw new Error("The URL did not return an image.");
      }
      if (contentLength > 8 * 1024 * 1024) {
        throw new Error("The image is too large.");
      }
      const image = Buffer.from(await response.arrayBuffer());
      if (image.byteLength > 8 * 1024 * 1024) {
        throw new Error("The image is too large.");
      }
      await client.user!.setAvatar(image);
      outcomes.push("تم تغيير صورة البوت.");
    } catch (error) {
      logger.warn({ err: error }, "Could not update bot avatar");
      outcomes.push("تعذر تغيير الصورة. استخدم رابط HTTPS مباشرًا لصورة أصغر من 8 MB.");
    }
  }

  client.user!.setPresence({
    status: "online",
    activities: activity
      ? [{ name: activity, type: ActivityType.Playing }]
      : [],
  });
  if (activity) {
    outcomes.push("تم تحديث حالة نشاط البوت.");
  }

  outcomes.push("وصف البوت (Bio) لا يتغير من هذا الأمر؛ عدّله يدويًا من Developer Portal.");
  await interaction.editReply(outcomes.join("\n"));
}

async function handleModal(
  interaction: import("discord.js").ModalSubmitInteraction,
  client: Client,
): Promise<void> {
  const guild = await requireGuild(interaction);
  if (!guild) {
    return;
  }
  if (!isAdministrator(interaction)) {
    await replyEphemeral(interaction, "يحتاج هذا الإجراء إلى صلاحية المشرف.");
    return;
  }

  if (interaction.customId === "ticketbot:setup-modal") {
    await installTicketPanel(interaction, guild);
  } else if (interaction.customId === "ticketbot:category-add-modal") {
    const label = interaction.fields.getTextInputValue("categoryLabel").trim();
    const description =
      interaction.fields.getTextInputValue("categoryDescription").trim() ||
      "فتح تذكرة جديدة";
    if (!label) {
      await replyEphemeral(interaction, "اكتب اسمًا لخيار التكت.");
      return;
    }

    let didAdd = false;
    const updated = await updateGuildConfig(guild.id, (config) => {
      if (config.categories.length >= CATEGORY_LIMIT) {
        return;
      }
      config.categories.push({
        id: `category-${randomUUID()}`,
        label,
        description,
      });
      didAdd = true;
    });
    if (!didAdd) {
      await replyEphemeral(interaction, "وصلت إلى الحد الأقصى: 25 خيارًا.");
      return;
    }
    await refreshTicketPanel(guild, updated);
    await interaction.reply({
      ...createCategoryManager(updated),
      ephemeral: true,
    });
  } else if (interaction.customId === "ticketbot:appearance-modal") {
    await setBotAppearance(interaction, client);
  }
}

async function confirmCloseTicket(
  interaction: import("discord.js").ButtonInteraction,
): Promise<void> {
  const ticketInfo = interaction.channelId
    ? await findTicket(interaction.channelId)
    : null;
  if (!ticketInfo || ticketInfo.ticket.closedAt) {
    await replyEphemeral(interaction, "هذا التكت مغلق أو غير مسجل.");
    return;
  }

  const config = await getGuildConfig(ticketInfo.guildId);
  const canClose =
    interaction.user.id === ticketInfo.ticket.openerId ||
    isTicketStaff(interaction, config);
  if (!canClose) {
    await replyEphemeral(interaction, "لا تملك صلاحية إغلاق هذا التكت.");
    return;
  }

  if (interaction.customId === "ticketbot:cancel-close") {
    await interaction.update({ content: "تم إلغاء إغلاق التكت.", components: [] });
    return;
  }

  const channel = interaction.channel;
  if (!channel || !channel.isTextBased() || !("permissionOverwrites" in channel)) {
    await replyEphemeral(interaction, "تعذر تحديث صلاحيات روم التكت.");
    return;
  }

  await interaction.deferUpdate();
  await channel.permissionOverwrites.edit(ticketInfo.ticket.openerId, {
    SendMessages: false,
    AttachFiles: false,
  });

  const closedAt = new Date().toISOString();
  await updateGuildConfig(ticketInfo.guildId, (currentConfig) => {
    const stored = currentConfig.tickets.find(
      (ticket) => ticket.channelId === ticketInfo.ticket.channelId,
    );
    if (stored) {
      stored.closedAt = closedAt;
    }
  });

  try {
    const textChannel = channel as TextChannel;
    const controlMessage = await textChannel.messages.fetch(
      ticketInfo.ticket.controlMessageId,
    );
    await controlMessage.edit({
      content: "تم إغلاق هذا التكت.",
      components: buildTicketControls(true),
    });
  } catch (error) {
    logger.warn({ err: error, channelId: channel.id }, "Could not update ticket controls");
  }
  await interaction.editReply({
    content: "تم إغلاق التكت. أصبح بإمكان صاحبه القراءة دون الكتابة.",
    components: [],
  });
}

async function handleTicketButton(
  interaction: import("discord.js").ButtonInteraction,
): Promise<void> {
  const ticketInfo = interaction.channelId
    ? await findTicket(interaction.channelId)
    : null;
  if (!ticketInfo) {
    await replyEphemeral(interaction, "هذا الزر يعمل داخل روم تكت مسجل فقط.");
    return;
  }

  const config = await getGuildConfig(ticketInfo.guildId);
  if (interaction.customId === "ticketbot:close") {
    if (ticketInfo.ticket.closedAt) {
      await replyEphemeral(interaction, "هذا التكت مغلق بالفعل.");
      return;
    }
    if (
      interaction.user.id !== ticketInfo.ticket.openerId &&
      !isTicketStaff(interaction, config)
    ) {
      await replyEphemeral(interaction, "لا تملك صلاحية إغلاق هذا التكت.");
      return;
    }

    const confirm = new ButtonBuilder()
      .setCustomId("ticketbot:confirm-close")
      .setLabel("تأكيد الإغلاق")
      .setStyle(ButtonStyle.Danger);
    const cancel = new ButtonBuilder()
      .setCustomId("ticketbot:cancel-close")
      .setLabel("إلغاء")
      .setStyle(ButtonStyle.Secondary);
    await interaction.reply({
      content: "هل أنت متأكد من إغلاق التكت؟",
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(confirm, cancel),
      ],
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId === "ticketbot:summon") {
    if (!isTicketStaff(interaction, config)) {
      await replyEphemeral(interaction, "استدعاء صاحب التكت متاح لفريق الدعم فقط.");
      return;
    }
    await interaction.reply({
      content: `تنبيه <@${ticketInfo.ticket.openerId}>: فريق الدعم يستدعيك للعودة إلى تذكرتك.`,
      allowedMentions: { users: [ticketInfo.ticket.openerId] },
    });
  }
}

async function handleCategoryRemoval(
  interaction: import("discord.js").StringSelectMenuInteraction,
): Promise<void> {
  const guild = await requireGuild(interaction);
  if (!guild) {
    return;
  }
  if (!isAdministrator(interaction)) {
    await replyEphemeral(interaction, "يحتاج هذا الإجراء إلى صلاحية المشرف.");
    return;
  }

  const selectedId = interaction.values[0];
  let removedLabel = "";
  const updated = await updateGuildConfig(guild.id, (config) => {
    if (config.categories.length <= 1) {
      return;
    }
    const selected = config.categories.find((item) => item.id === selectedId);
    if (selected) {
      removedLabel = selected.label;
      config.categories = config.categories.filter(
        (item) => item.id !== selectedId,
      );
    }
  });

  if (!removedLabel) {
    await replyEphemeral(interaction, "لم يتم حذف الخيار؛ يجب أن يبقى خيار واحد على الأقل.");
    return;
  }
  await refreshTicketPanel(guild, updated);
  await interaction.update({
    content: `تم حذف خيار **${removedLabel}** وتحديث لوحة التكت.`,
    components: [],
  });
}

async function handleInteraction(
  interaction: Interaction,
  client: Client,
): Promise<void> {
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === HELP_MENU_ID) {
      await handleHelpMenu(interaction, client);
    } else if (interaction.customId === PANEL_MENU_ID) {
      await createTicket(interaction);
    } else if (interaction.customId === "ticketbot:category-remove-select") {
      await handleCategoryRemoval(interaction);
    }
    return;
  }

  if (interaction.isButton()) {
    if (
      interaction.customId === "ticketbot:close" ||
      interaction.customId === "ticketbot:summon"
    ) {
      await handleTicketButton(interaction);
    } else if (
      interaction.customId === "ticketbot:confirm-close" ||
      interaction.customId === "ticketbot:cancel-close"
    ) {
      await confirmCloseTicket(interaction);
    } else if (
      interaction.customId === "ticketbot:category-add" ||
      interaction.customId === "ticketbot:category-remove"
    ) {
      const guild = await requireGuild(interaction);
      if (!guild) {
        return;
      }
      if (!isAdministrator(interaction)) {
        await replyEphemeral(interaction, "يحتاج هذا الإجراء إلى صلاحية المشرف.");
        return;
      }
      if (interaction.customId === "ticketbot:category-add") {
        await interaction.showModal(createCategoryModal());
      } else {
        await showCategoryRemoval(interaction, guild);
      }
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    await handleModal(interaction, client);
  }
}

export async function startDiscordBot(): Promise<void> {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    throw new Error(
      "DISCORD_BOT_TOKEN is missing. Add it in Replit Secrets before starting the Discord bot.",
    );
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(
      { botTag: readyClient.user.tag, guildCount: readyClient.guilds.cache.size },
      "Discord bot connected",
    );
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) {
      return;
    }
    if (message.content.trim().toLowerCase() !== "-help") {
      return;
    }
    try {
      await message.reply(buildHelpMessage());
    } catch (error) {
      logger.error({ err: error, guildId: message.guild.id }, "Could not reply to -help");
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      await handleInteraction(interaction, client);
    } catch (error) {
      logger.error(
        {
          err: error,
          interactionId: interaction.id,
          guildId: interaction.guildId,
        },
        "Discord interaction failed",
      );
      try {
        await replyEphemeral(
          interaction,
          "صار خطأ أثناء تنفيذ الطلب. تحقق من صلاحيات البوت وحاول مرة أخرى.",
        );
      } catch (replyError) {
        logger.warn({ err: replyError }, "Could not send interaction error reply");
      }
    }
  });

  await client.login(token);
}
