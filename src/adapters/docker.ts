import http from "node:http";

const DOCKER_SOCKET = process.env.DOCKER_HOST ?? "/var/run/docker.sock";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface DockerContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Labels: Record<string, string>;
}

export interface ContainerInspect {
  Id: string;
  Name: string;
  State: {
    Status: string;
    Running: boolean;
    Pid: number;
    ExitCode: number;
    StartedAt: string;
    FinishedAt: string;
    Health?: {
      Status: string;
      FailingStreak: number;
      Log: Array<{ Start: string; End: string; Output: string; ExitCode: number }>;
    };
  };
  Config: {
    Image: string;
    Labels: Record<string, string>;
    Env: string[];
  };
  HostConfig: {
    RestartPolicy: { Name: string; MaximumRetryCount: number };
    Memory: number;
    CpuShares: number;
  };
  NetworkSettings: {
    Networks: Record<string, { IPAddress: string }>;
  };
  Mounts: Array<{ Source: string; Destination: string; Type: string }>;
}

export interface ContainerStats {
  cpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
    online_cpus: number;
  };
  precpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
  };
  memory_stats: { usage: number; limit: number };
}

export interface DockerEvent {
  Type: string;
  Action: string;
  Actor: { ID: string; Attributes: Record<string, string> };
  time: number;
  timeNano: number;
}

/* ------------------------------------------------------------------ */
/*  Low-level request                                                  */
/* ------------------------------------------------------------------ */

function dockerRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      socketPath: DOCKER_SOCKET,
      path,
      method,
      headers: { "Content-Type": "application/json" },
    };
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode ?? 0, data: raw });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/*  Container operations                                               */
/* ------------------------------------------------------------------ */

export async function listContainers(all = false): Promise<DockerContainer[]> {
  const { data } = await dockerRequest("GET", `/containers/json?all=${all}`);
  return data as DockerContainer[];
}

export async function inspectContainer(id: string): Promise<ContainerInspect> {
  const { data } = await dockerRequest(
    "GET",
    `/containers/${encodeURIComponent(id)}/json`,
  );
  return data as ContainerInspect;
}

export async function getContainerLogs(
  id: string,
  tail = 100,
): Promise<string> {
  const { data } = await dockerRequest(
    "GET",
    `/containers/${encodeURIComponent(id)}/logs?stdout=true&stderr=true&tail=${tail}`,
  );
  return typeof data === "string" ? data : String(data);
}

export async function restartContainer(
  id: string,
  timeout = 10,
): Promise<void> {
  const { status } = await dockerRequest(
    "POST",
    `/containers/${encodeURIComponent(id)}/restart?t=${timeout}`,
  );
  if (status !== 204) throw new Error(`Docker restart failed with status ${status}`);
}

export async function getContainerStats(id: string): Promise<ContainerStats> {
  const { data } = await dockerRequest(
    "GET",
    `/containers/${encodeURIComponent(id)}/stats?stream=false`,
  );
  return data as ContainerStats;
}

/* ------------------------------------------------------------------ */
/*  Event stream                                                       */
/* ------------------------------------------------------------------ */

export function getEvents(
  filters?: Record<string, string[]>,
): { stream: AsyncGenerator<DockerEvent>; abort: () => void } {
  const controller = new AbortController();

  async function* generate(): AsyncGenerator<DockerEvent> {
    const query = filters
      ? `?filters=${encodeURIComponent(JSON.stringify(filters))}`
      : "";

    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request(
        {
          socketPath: DOCKER_SOCKET,
          path: `/events${query}`,
          method: "GET",
        },
        resolve,
      );
      req.on("error", reject);

      controller.signal.addEventListener("abort", () => req.destroy());

      req.end();
    });

    let buffer = "";
    const eventQueue: DockerEvent[] = [];
    let resolvePending: (() => void) | null = null;
    let done = false;

    res.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          eventQueue.push(JSON.parse(trimmed) as DockerEvent);
          resolvePending?.();
        } catch {
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
        yield eventQueue.shift()!;
      } else if (!done) {
        await new Promise<void>((r) => {
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
