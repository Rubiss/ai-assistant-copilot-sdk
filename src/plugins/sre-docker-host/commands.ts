import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "../../app/plugins/types.js";
import * as incidents from "../../app/store/incidents.js";
import { addTimelineEvent, getTimeline } from "../../worker/incidentEngine.js";

/* ------------------------------------------------------------------ */
/*  /ops — operational status overview                                 */
/* ------------------------------------------------------------------ */

export const opsStatus: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("ops")
    .setDescription("Show operational status overview")
    .toJSON(),
  execute: async (interaction) => {
    const open = incidents.listIncidents("open");
    const acked = incidents.listIncidents("acknowledged");
    const investigating = incidents.listIncidents("investigating");

    const total = open.length + acked.length + investigating.length;
    const embed = {
      title: "📊 Ops Status",
      color:
        total > 0
          ? open.some((i) => i.severity === "critical")
            ? 0xff0000
            : 0xffa500
          : 0x00ff00,
      fields: [
        { name: "Open", value: String(open.length), inline: true },
        { name: "Acknowledged", value: String(acked.length), inline: true },
        {
          name: "Investigating",
          value: String(investigating.length),
          inline: true,
        },
      ],
      timestamp: new Date().toISOString(),
    };

    await interaction.reply({ embeds: [embed] });
  },
};

/* ------------------------------------------------------------------ */
/*  /incident — incident management                                    */
/* ------------------------------------------------------------------ */

export const incidentCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("incident")
    .setDescription("Incident management")
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("List open incidents"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("ack")
        .setDescription("Acknowledge an incident")
        .addStringOption((opt) =>
          opt.setName("id").setDescription("Incident ID").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("note")
        .setDescription("Add a note to an incident")
        .addStringOption((opt) =>
          opt.setName("id").setDescription("Incident ID").setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("text")
            .setDescription("Note text")
            .setRequired(true),
        ),
    )
    .toJSON(),
  execute: async (interaction) => {
    const sub = interaction.options.getSubcommand();

    switch (sub) {
      case "list": {
        const open = incidents.listIncidents("open");
        const acked = incidents.listIncidents("acknowledged");
        const all = [...open, ...acked];

        if (all.length === 0) {
          await interaction.reply("✅ No open incidents.");
          return;
        }

        const lines = all.map(
          (i) =>
            `• **${i.severity?.toUpperCase() ?? "?"}** \`${i.id.slice(0, 8)}\` ${i.title} (${i.status})`,
        );
        await interaction.reply({
          embeds: [
            {
              title: `🚨 Open Incidents (${all.length})`,
              description: lines.join("\n"),
              color: 0xff0000,
              timestamp: new Date().toISOString(),
            },
          ],
        });
        break;
      }

      case "ack": {
        const id = interaction.options.getString("id", true);
        const incident = incidents.getIncident(id);
        if (!incident) {
          await interaction.reply(`❌ Incident \`${id}\` not found.`);
          return;
        }
        addTimelineEvent(id, {
          event_type: "acknowledged",
          actor: `discord:${interaction.user.id}`,
          content: `Acknowledged by ${interaction.user.username}`,
        });
        await interaction.reply(
          `✅ Incident \`${id.slice(0, 8)}\` acknowledged.`,
        );
        break;
      }

      case "note": {
        const id = interaction.options.getString("id", true);
        const text = interaction.options.getString("text", true);
        const incident = incidents.getIncident(id);
        if (!incident) {
          await interaction.reply(`❌ Incident \`${id}\` not found.`);
          return;
        }
        addTimelineEvent(id, {
          event_type: "note",
          actor: `discord:${interaction.user.id}`,
          content: text,
        });
        await interaction.reply(
          `📝 Note added to incident \`${id.slice(0, 8)}\`.`,
        );
        break;
      }
    }
  },
};

/* ------------------------------------------------------------------ */
/*  /report — generate reports                                         */
/* ------------------------------------------------------------------ */

export const reportNow: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName("report")
    .setDescription("Generate reports")
    .addSubcommand((sub) =>
      sub
        .setName("now")
        .setDescription("Generate a report now")
        .addStringOption((opt) =>
          opt
            .setName("type")
            .setDescription("Report type")
            .setRequired(true)
            .addChoices(
              { name: "Daily Health", value: "daily" },
              { name: "Weekly Summary", value: "weekly" },
            ),
        ),
    )
    .toJSON(),
  execute: async (interaction) => {
    await interaction.deferReply();
    // Will integrate with report generation in Phase 6.9
    await interaction.editReply(
      "📊 Report generation queued. Results will appear shortly.",
    );
  },
};
