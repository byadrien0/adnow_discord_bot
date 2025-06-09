import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  ChannelType,
  PermissionsBitField,
} from "discord.js";
import fetch from "node-fetch";
import { parseStringPromise } from "xml2js";
import fs from "fs";

// Configuration du client Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences, // Intent nécessaire pour obtenir les présences des membres
  ],
});

// Configuration du REST pour enregistrer les commandes slash
const YOUR_CLIENT_ID = "YOUR_CLIENT_ID";
const YOUR_BOT_TOKEN = "YOUR_BOT_TOKEN";

const rest = new REST({ version: "10" }).setToken(YOUR_BOT_TOKEN);

const commands = [
  {
    name: "token",
    description: "Enregistrez un token pour ce serveur.",
    options: [
      {
        type: 3, // Type 3 pour STRING
        name: "value",
        description: "Le token à enregistrer.",
        required: true,
      },
    ],
  },
  {
    name: "setchannel",
    description: "Définissez le salon textuel pour diffuser les messages.",
    options: [
      {
        type: 7, // Type 7 pour CHANNEL
        name: "channel",
        description: "Le salon textuel où diffuser les messages.",
        required: true,
      },
    ],
  },
];

// Enregistrement des commandes slash
(async () => {
  try {
    console.log("Enregistrement des commandes slash...");
    await rest.put(Routes.applicationCommands(YOUR_CLIENT_ID), {
      body: commands,
    });
    console.log("Commandes slash enregistrées avec succès.");
  } catch (error) {
    console.error(
      "Erreur lors de l'enregistrement des commandes slash:",
      error
    );
  }
})();

// Chargement des tokens et salons sauvegardés
const tokensPath = "./tokens.json";
const channelsPath = "./channels.json";
const tokens = fs.existsSync(tokensPath)
  ? JSON.parse(fs.readFileSync(tokensPath, "utf8"))
  : {};
const channels = fs.existsSync(channelsPath)
  ? JSON.parse(fs.readFileSync(channelsPath, "utf8"))
  : {}; // Format { guildId: { defaultChannelId: "" } }

// Gestion de l'événement 'ready'
client.once(Events.ClientReady, () => {
  console.log("Bot est prêt !");
});

// Fonction pour vérifier la validité du token avec l'API
async function verifyToken(token, guildId) {
  const apiUrl = `https://YOUR_URL/plugins/discord/api_token_check.php?token=${token}&games=2&guildId=${guildId}`;
  try {
    const response = await fetch(apiUrl);
    const xml = await response.text();
    const result = await parseStringPromise(xml);

    const status = result.response?.status?.[0] || "error";
    const message = result.response?.message?.[0] || "Une erreur est survenue.";

    if (status === "success") {
      return { valid: true, message: "Token valide." };
    } else {
      return { valid: false, message: `Token invalide : ${message}` };
    }
  } catch (error) {
    console.error("Erreur lors de la vérification du token:", error);
    return {
      valid: false,
      message: "Erreur lors de la vérification du token.",
    };
  }
}

// Fonction pour obtenir le nombre de membres en ligne et leurs pseudonymes, en excluant les bots
async function getOnlineMembersWithAccess(channel) {
  try {
    // Obtenir la liste des membres qui ont accès au canal
    const members = await channel.guild.members.fetch();
    const onlineMembers = members.filter((member) => {
      return (
        !member.user.bot && // Exclure les bots
        channel
          .permissionsFor(member)
          .has(PermissionsBitField.Flags.ViewChannel) && // Vérifier si le membre peut voir le canal
        member.presence &&
        ["online", "idle", "dnd"].includes(member.presence.status) // Vérifier si le membre est en ligne, inactif, ou en mode Ne pas déranger
      );
    });

    // Récupérer les pseudonymes des membres en ligne
    const onlineMemberNames = onlineMembers.map(
      (member) => member.user.username
    );

    return {
      count: onlineMembers.size,
      names: onlineMemberNames,
    };
  } catch (error) {
    console.error(
      "Erreur lors de la récupération des membres en ligne:",
      error
    );
    return {
      count: 0,
      names: [],
    };
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, options } = interaction;

  // Vérification de la présence du guildId
  if (!interaction.guildId) {
    await interaction.reply(
      "Cette commande doit être utilisée dans un serveur."
    );
    return;
  }

  console.log(`guildId: ${interaction.guildId}`); // Log pour vérifier l'ID de la guilde

  // Gestion de la commande "token"
  if (commandName === "token") {
    // Vérification des permissions (administrateur requis)
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.Administrator
      )
    ) {
      await interaction.reply(
        "Vous devez être administrateur pour utiliser cette commande."
      );
      return;
    }

    const token = options.getString("value");

    // Vérification du token via l'API
    const verificationResult = await verifyToken(token, interaction.guildId);

    if (verificationResult.valid) {
      const guildId = interaction.guildId;
      tokens[guildId] = token;
      fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));
      await interaction.reply("Token valide et enregistré avec succès !");
    } else {
      await interaction.reply(verificationResult.message);
    }
  }

  // Gestion de la commande "setchannel"
  if (commandName === "setchannel") {
    // Vérification des permissions (administrateur requis)
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.Administrator
      )
    ) {
      await interaction.reply(
        "Vous devez être administrateur pour utiliser cette commande."
      );
      return;
    }

    const channel = options.getChannel("channel");
    if (!channel || channel.type !== ChannelType.GuildText) {
      return interaction.reply(
        "Le salon spécifié n'est pas valide ou n'est pas un salon textuel."
      );
    }

    const guildId = interaction.guildId;
    if (!channels[guildId]) {
      channels[guildId] = {};
    }
    channels[guildId].defaultChannelId = channel.id;
    fs.writeFileSync(channelsPath, JSON.stringify(channels, null, 2));

    await interaction.reply("Salon textuel enregistré avec succès !");
  }
});

// Fonction pour envoyer les pseudonymes en ligne via l'API
async function sendPlayerNames(token, campaignId, playerNames) {
  try {
    const apiUrl = `https://YOUR_URL/plugins/discord/send_player_names.php?token=${token}&campaign_id=${campaignId}&player_names=${encodeURIComponent(
      playerNames.join(", ")
    )}`;
    const response = await fetch(apiUrl);

    if (response.ok) {
      console.log("Les pseudonymes ont été envoyés avec succès.");
    } else {
      console.error(
        "Erreur lors de l'envoi des pseudonymes:",
        response.statusText
      );
    }
  } catch (error) {
    console.error("Erreur lors de l'envoi des pseudonymes:", error);
  }
}

// Fonction pour récupérer et diffuser les messages de la campagne avec les membres en ligne et leurs pseudonymes
async function fetchChatBotMessages() {
  for (const [guildId, channelInfo] of Object.entries(channels)) {
    // Vérification de l'existence du salon dans le fichier JSON
    if (!channelInfo || !channelInfo.defaultChannelId) {
      console.warn(`Aucun salon défini pour la guilde: ${guildId}`);
      continue;
    }

    const defaultChannelId = channelInfo.defaultChannelId;
    const token = tokens[guildId];
    if (!token) {
      console.warn(`Aucun token défini pour la guilde: ${guildId}`);
      continue;
    }

    const apiUrl = `https://YOUR_URL/plugins/discord/get_campagne_message.php?token=${token}`;
    try {
      const response = await fetch(apiUrl);
      const xml = await response.text();

      if (!xml.trim()) {
        console.warn("Réponse vide reçue de l'API.");
        continue;
      }

      const result = await parseStringPromise(xml);
      console.log("Résultat du parsing:", result);

      const status = result.response.$?.status || "error";
      const message = result.response.$?.message || "Une erreur est survenue.";

      if (status !== "success") {
        if (status === "no-campaigns") {
          console.info(
            `Aucune campagne disponible pour la guilde ${guildId}: ${message}`
          );
        } else {
          console.error(`Erreur API pour la guilde ${guildId}: ${message}`);
        }
        continue;
      }

      if (
        !result.response.campaigns ||
        !result.response.campaigns[0].campaign
      ) {
        console.error("La réponse XML n'a pas le format attendu.");
        continue;
      }

      const campaigns = result.response.campaigns[0].campaign || [];

      if (campaigns.length === 0) {
        console.info(`Aucune campagne trouvée pour la guilde ${guildId}.`);
        continue;
      }

      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const channel = guild.channels.cache.get(defaultChannelId);
        if (channel && channel.type === ChannelType.GuildText) {
          // Récupérer le nombre de membres en ligne qui ont accès au salon et leurs pseudonymes
          const { count, names } = await getOnlineMembersWithAccess(channel);

          for (const campaign of campaigns) {
            const message = campaign.chat_msg_discord?.[0];
            const linkTo = campaign.link_to?.[0]; // Récupérer link_to
            const linkCode = campaign.link_code?.[0]; // Récupérer link_code
            const server_id = campaign.server_id?.[0]; // Récupérer server_id
            const campaign_id = campaign.campaign_id?.[0]; // Récupérer campaign_id

            if (message) {
              // Construire le message final avec les pseudonymes des membres en ligne
              const finalMessage = `${message} ${linkTo}/?s=${server_id}&c=${linkCode}`;
              console.log(`Diffusion du message: ${finalMessage}`);
              channel.send(finalMessage);

              // Envoyer les pseudonymes à l'API
              await sendPlayerNames(token, campaign_id, names);
            } else {
              console.warn("Message vide trouvé.");
            }
          }
        } else {
          console.warn(
            `Salon non trouvé ou ce n'est pas un salon textuel: ${defaultChannelId} dans la guilde ${guildId}`
          );
        }
      } else {
        console.warn(`Guilde non trouvée: ${guildId}`);
      }
    } catch (error) {
      console.error(
        "Erreur lors de la récupération des messages du ChatBot:",
        error
      );
    }
  }
}

// Lancer le bot
client.login(YOUR_BOT_TOKEN);

// Diffusion des messages de campagne toutes les X minutes (par exemple, toutes les 1 minutes)
setInterval(fetchChatBotMessages, 60 * 1000); // 60 seconds
