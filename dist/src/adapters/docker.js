import http from "node:http";
const DOCKER_SOCKET = process.env.DOCKER_HOST ?? "/var/run/docker.sock";
/* ------------------------------------------------------------------ */
/*  Low-level request                                                  */
/* ------------------------------------------------------------------ */
function dockerRequest(method, path, body) {
    return new Promise((resolve, reject) => {
        const options = {
            socketPath: DOCKER_SOCKET,
            path,
            method,
            headers: { "Content-Type": "application/json" },
        };
        const req = http.request(options, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
                const raw = Buffer.concat(chunks).toString();
                try {
                    resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
                }
                catch {
                    resolve({ status: res.statusCode ?? 0, data: raw });
                }
            });
        });
        req.on("error", reject);
        if (body)
            req.write(JSON.stringify(body));
        req.end();
    });
}
/* ------------------------------------------------------------------ */
/*  Container operations                                               */
/* ------------------------------------------------------------------ */
export async function listContainers(all = false) {
    const { data } = await dockerRequest("GET", `/containers/json?all=${all}`);
    return data;
}
export async function inspectContainer(id) {
    const { data } = await dockerRequest("GET", `/containers/${encodeURIComponent(id)}/json`);
    return data;
}
export async function getContainerLogs(id, tail = 100) {
    const { data } = await dockerRequest("GET", `/containers/${encodeURIComponent(id)}/logs?stdout=true&stderr=true&tail=${tail}`);
    return typeof data === "string" ? data : String(data);
}
export async function restartContainer(id, timeout = 10) {
    const { status } = await dockerRequest("POST", `/containers/${encodeURIComponent(id)}/restart?t=${timeout}`);
    if (status !== 204)
        throw new Error(`Docker restart failed with status ${status}`);
}
export async function getContainerStats(id) {
    const { data } = await dockerRequest("GET", `/containers/${encodeURIComponent(id)}/stats?stream=false`);
    return data;
}
/* ------------------------------------------------------------------ */
/*  Event stream                                                       */
/* ------------------------------------------------------------------ */
export function getEvents(filters) {
    const controller = new AbortController();
    async function* generate() {
        const query = filters
            ? `?filters=${encodeURIComponent(JSON.stringify(filters))}`
            : "";
        const res = await new Promise((resolve, reject) => {
            const req = http.request({
                socketPath: DOCKER_SOCKET,
                path: `/events${query}`,
                method: "GET",
            }, resolve);
            req.on("error", reject);
            controller.signal.addEventListener("abort", () => req.destroy());
            req.end();
        });
        let buffer = "";
        const eventQueue = [];
        let resolvePending = null;
        let done = false;
        res.on("data", (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                try {
                    eventQueue.push(JSON.parse(trimmed));
                    resolvePending?.();
                }
                catch {
                    /* skip malformed lines */
                }
            }
        });
        res.on("end", () => {
            done = true;
            resolvePending?.();
        });
        res.on("error", () => {
            done = true;
            resolvePending?.();
        });
        while (!done || eventQueue.length > 0) {
            if (eventQueue.length > 0) {
                yield eventQueue.shift();
            }
            else if (!done) {
                await new Promise((r) => {
                    resolvePending = r;
                });
            }
        }
    }
    return {
        stream: generate(),
        abort: () => controller.abort(),
    };
}
