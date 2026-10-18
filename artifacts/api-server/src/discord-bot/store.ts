import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TicketCategory {
  id: string;
  label: string;
  description: string;
}

export interface TicketRecord {
  channelId: string;
  openerId: string;
  categoryId: string;
  categoryLabel: string;
  createdAt: string;
  controlMessageId: string;
  closedAt: string | null;
}

export interface GuildTicketConfig {
  panelChannelId: string | null;
  panelMessageId: string | null;
  supportRoleId: string | null;
  categories: TicketCategory[];
  tickets: TicketRecord[];
}

interface PersistentState {
  guilds: Record<string, GuildTicketConfig>;
}

const dataDirectory =
  process.env["DISCORD_DATA_DIR"] ?? path.resolve(process.cwd(), ".data");
const dataFile = path.join(dataDirectory, "discord-ticket-bot.json");

let state: PersistentState | undefined;
let loadPromise: Promise<void> | undefined;
let mutationQueue: Promise<void> = Promise.resolve();

function newGuildConfig(): GuildTicketConfig {
  return {
    panelChannelId: null,
    panelMessageId: null,
    supportRoleId: null,
    categories: [
      {
        id: "general",
        label: "استفسار عام",
        description: "للاستفسارات العامة",
      },
      {
        id: "problem",
        label: "مشكلة",
        description: "للمساعدة في حل مشكلة",
      },
      {
        id: "request",
        label: "طلب",
        description: "لتقديم طلب جديد",
      },
    ],
    tickets: [],
  };
}

async function loadState(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const content = await readFile(dataFile, "utf8");
        const parsed: unknown = JSON.parse(content);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          !("guilds" in parsed) ||
          typeof parsed.guilds !== "object" ||
          parsed.guilds === null
        ) {
          throw new Error("Discord ticket configuration has an invalid format.");
        }
        state = parsed as PersistentState;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
        state = { guilds: {} };
      }
    })();
  }

  await loadPromise;
}

function copyConfig(config: GuildTicketConfig): GuildTicketConfig {
  return {
    ...config,
    categories: config.categories.map((category) => ({ ...category })),
    tickets: config.tickets.map((ticket) => ({ ...ticket })),
  };
}

async function persist(): Promise<void> {
  if (!state) {
    throw new Error("Discord ticket configuration was not initialized.");
  }

  await mkdir(dataDirectory, { recursive: true });
  const temporaryFile = `${dataFile}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(state, null, 2), "utf8");
  await rename(temporaryFile, dataFile);
}

export async function getGuildConfig(
  guildId: string,
): Promise<GuildTicketConfig> {
  await loadState();
  if (!state) {
    throw new Error("Discord ticket configuration was not initialized.");
  }

  if (!state.guilds[guildId]) {
    return updateGuildConfig(guildId, () => undefined);
  }

  return copyConfig(state.guilds[guildId]);
}

export async function updateGuildConfig(
  guildId: string,
  update: (config: GuildTicketConfig) => void,
): Promise<GuildTicketConfig> {
  await loadState();

  const mutation = mutationQueue.then(async () => {
    if (!state) {
      throw new Error("Discord ticket configuration was not initialized.");
    }

    const config = (state.guilds[guildId] ??= newGuildConfig());
    update(config);
    await persist();
    return copyConfig(config);
  });

  mutationQueue = mutation.then(
    () => undefined,
    () => undefined,
  );

  return mutation;
}

export async function findTicket(
  channelId: string,
): Promise<{ guildId: string; ticket: TicketRecord } | null> {
  await loadState();
  if (!state) {
    throw new Error("Discord ticket configuration was not initialized.");
  }

  for (const [guildId, config] of Object.entries(state.guilds)) {
    const ticket = config.tickets.find((item) => item.channelId === channelId);
    if (ticket) {
      return { guildId, ticket: { ...ticket } };
    }
  }

  return null;
}

export async function findOpenTicketForOwner(
  guildId: string,
  openerId: string,
): Promise<TicketRecord | null> {
  const config = await getGuildConfig(guildId);
  const ticket = config.tickets.find(
    (item) => item.openerId === openerId && item.closedAt === null,
  );
  return ticket ? { ...ticket } : null;
}
