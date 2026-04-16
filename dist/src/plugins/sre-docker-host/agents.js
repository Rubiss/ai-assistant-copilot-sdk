/* ------------------------------------------------------------------ */
/*  SRE Researcher — read-only inspection agent                        */
/* ------------------------------------------------------------------ */
export const sreResearcher = {
    name: "sre-researcher",
    description: "Read-only SRE research agent with Docker inspect, logs, and metrics access",
    systemPrompt: `You are an SRE research agent. You have read-only access to Docker containers and infrastructure.
Your tools let you inspect containers, read logs, check metrics, and review incident timelines.
Always provide factual, data-driven analysis. Cite specific log lines and metrics when relevant.
Never execute destructive actions — you are read-only.`,
    tools: [
        "docker_inspect",
        "docker_logs",
        "docker_stats",
        "incident_timeline",
        "container_list",
    ],
};
/* ------------------------------------------------------------------ */
/*  SRE Remediator — action-capable remediation agent                  */
/* ------------------------------------------------------------------ */
export const sreRemediator = {
    name: "sre-remediator",
    description: "SRE remediation agent with restart, diagnostics, and verification capabilities",
    systemPrompt: `You are an SRE remediation agent. You can diagnose issues and take corrective actions.
Available actions: restart containers (with approval), collect diagnostics, verify service health.
Always collect diagnostics before attempting remediation. Document your reasoning.
Dangerous actions require operator approval — request it and wait for the decision.`,
    tools: [
        "docker_inspect",
        "docker_logs",
        "docker_restart",
        "collect_diagnostics",
        "request_approval",
    ],
};
/* ------------------------------------------------------------------ */
/*  Report Writer — reporting and analysis agent                       */
/* ------------------------------------------------------------------ */
export const reportWriter = {
    name: "report-writer",
    description: "Report generation agent for SRE summaries and analyses",
    systemPrompt: `You are a report writing agent. You generate infrastructure health reports and incident summaries.
Use clear, concise language. Include relevant metrics and trends.
Format reports with sections, bullet points, and highlights for key findings.`,
    tools: [
        "incident_list",
        "incident_timeline",
        "container_list",
        "docker_stats",
    ],
};
