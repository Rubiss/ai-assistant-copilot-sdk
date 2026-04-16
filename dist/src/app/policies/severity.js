const DEFAULT_MAPPINGS = [
    {
        source: "alertmanager",
        mappings: {
            critical: "critical",
            warning: "warning",
            info: "info",
            none: "info",
        },
        default: "warning",
    },
    {
        source: "grafana",
        mappings: {
            alerting: "warning",
            critical: "critical",
            warning: "warning",
            info: "info",
            no_data: "info",
            ok: "info",
        },
        default: "warning",
    },
    {
        source: "influx",
        mappings: {
            crit: "critical",
            warn: "warning",
            info: "info",
            ok: "info",
        },
        default: "warning",
    },
    {
        source: "docker",
        mappings: {
            critical: "critical",
            warning: "warning",
            info: "info",
        },
        default: "warning",
    },
];
let customMappings = [];
export function mapSeverity(source, externalSeverity) {
    const mapping = [...customMappings, ...DEFAULT_MAPPINGS].find((m) => m.source === source);
    if (!mapping)
        return "warning";
    return mapping.mappings[externalSeverity.toLowerCase()] ?? mapping.default;
}
export function addMapping(mapping) {
    customMappings = customMappings.filter((m) => m.source !== mapping.source);
    customMappings.push(mapping);
}
export function resetMappings() {
    customMappings = [];
}
