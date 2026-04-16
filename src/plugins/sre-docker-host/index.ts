import type { Plugin, PluginContext } from "../../app/plugins/types.js";
import {
  createAlertmanagerRoute,
  createGrafanaRoute,
  createInfluxRoute,
  createServarrRoute,
} from "./webhooks.js";
import { createDockerWatcher } from "./dockerWatcher.js";
import {
  opsStatus,
  incidentCommand,
  reportNow,
} from "./commands.js";
import { createDailyReport, createWeeklyReport } from "./reports.js";
import { sreResearcher, sreRemediator, reportWriter } from "./agents.js";

let alertChannelId = "";

export const sreDockerHostPlugin: Plugin = {
  name: "sre-docker-host",
  category: "hybrid",
  contributions: {
    bot: {
      commands: [opsStatus, incidentCommand, reportNow],
      messageRoutes: [],
    },
    worker: {
      webhooks: [],
      watchers: [],
      schedules: [],
    },
    copilot: {
      customAgents: [sreResearcher, sreRemediator, reportWriter],
    },
    policies: [],
  },

  async init(context: PluginContext) {
    alertChannelId =
      (context.pluginConfig.alertChannelId as string) ?? "";

    if (alertChannelId && context.processType === "worker") {
      const webhookConfig = { alertChannelId };

      this.contributions.worker!.webhooks = [
        createAlertmanagerRoute(webhookConfig),
        createGrafanaRoute(webhookConfig),
        createInfluxRoute(webhookConfig),
        createServarrRoute(webhookConfig),
      ];

      this.contributions.worker!.watchers = [
        createDockerWatcher({ alertChannelId }),
      ];

      this.contributions.worker!.schedules = [
        createDailyReport(alertChannelId),
        createWeeklyReport(alertChannelId),
      ];
    }

    console.log(
      `[sre-docker-host] Initialized for ${context.processType} process`,
    );
  },
};
