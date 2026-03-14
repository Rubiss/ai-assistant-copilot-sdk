import { tmpdir } from "os";
import { join } from "path";
import { writeFile, unlink } from "fs/promises";
import { randomUUID } from "crypto";
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILE_COUNT = 5;
const FETCH_TIMEOUT_MS = 30_000; // 30 seconds per file download
// Code/config file extensions that Discord may report as application/octet-stream
// or application/* rather than text/*, but are safe to pass to Copilot as text.
const TEXT_EXTENSIONS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".pyw",
    ".go",
    ".rs",
    ".java",
    ".c", ".cpp", ".cc", ".cxx", ".h", ".hpp",
    ".cs",
    ".rb",
    ".php",
    ".swift",
    ".kt", ".kts",
    ".sh", ".bash", ".zsh", ".fish",
    ".sql",
    ".md", ".mdx",
    ".graphql", ".gql",
    ".proto",
    ".tf", ".tfvars",
    ".yaml", ".yml",
    ".toml",
    ".json", ".jsonc",
    ".r",
    ".lua",
    ".ex", ".exs",
    ".erl",
    ".hs",
    ".ml", ".mli",
    ".scala",
    ".clj", ".cljs",
    ".vim",
    ".dockerfile",
]);
// Extensionless filenames that are common code/config files.
const BARE_FILENAMES = new Set([
    "dockerfile",
    "makefile",
    "gemfile",
    "procfile",
    "vagrantfile",
    "brewfile",
    "cmakelists",
]);
function isAcceptedFile(contentType, name) {
    if (contentType?.startsWith("image/"))
        return true;
    if (contentType?.startsWith("text/"))
        return true;
    const ext = name.match(/\.[^.]+$/)?.[0]?.toLowerCase();
    if (ext !== undefined)
        return TEXT_EXTENSIONS.has(ext);
    // No extension — check against known bare filenames (e.g. Dockerfile, Makefile)
    return BARE_FILENAMES.has(name.toLowerCase());
}
/**
 * Downloads file attachments from Discord CDN to temporary local files.
 * Accepts images (image/*), plain text (text/*), and common code/config file
 * extensions that Discord may classify as application/octet-stream.
 * Enforces per-file size and count limits, and a per-fetch timeout.
 * Returns the temp file paths and a cleanup function to delete them.
 */
export async function downloadFileAttachments(attachments) {
    const downloaded = [];
    let count = 0;
    for (const attachment of attachments) {
        if (!isAcceptedFile(attachment.contentType, attachment.name))
            continue;
        if (count >= MAX_FILE_COUNT) {
            console.warn(`[downloadAttachments] Skipping excess file (limit: ${MAX_FILE_COUNT})`);
            break;
        }
        if (attachment.size !== undefined && attachment.size > MAX_FILE_SIZE_BYTES) {
            console.warn(`[downloadAttachments] Skipping oversized file "${attachment.name}" (${attachment.size} bytes)`);
            continue;
        }
        const ext = attachment.name.match(/\.[^.]+$/)?.[0]
            ?? (attachment.contentType?.startsWith("image/") ? ".png" : ".txt");
        const tempPath = join(tmpdir(), `discord-file-${randomUUID()}${ext}`);
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
            let response;
            try {
                response = await fetch(attachment.url, { signal: controller.signal });
            }
            finally {
                clearTimeout(timer);
            }
            if (!response.ok) {
                console.warn(`[downloadAttachments] Failed to download "${attachment.name}": HTTP ${response.status}`);
                continue;
            }
            // Guard against server reporting wrong Content-Length or missing size metadata
            const contentLength = Number(response.headers.get("content-length") ?? 0);
            if (contentLength > MAX_FILE_SIZE_BYTES) {
                console.warn(`[downloadAttachments] Skipping oversized file "${attachment.name}" (Content-Length: ${contentLength})`);
                continue;
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
                console.warn(`[downloadAttachments] Skipping oversized file "${attachment.name}" (actual: ${buffer.byteLength} bytes)`);
                continue;
            }
            await writeFile(tempPath, buffer);
            downloaded.push({ filePath: tempPath, displayName: attachment.name });
            count++;
        }
        catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                console.warn(`[downloadAttachments] Timeout downloading "${attachment.name}"`);
            }
            else {
                console.warn(`[downloadAttachments] Error downloading "${attachment.name}":`, err);
            }
        }
    }
    return {
        attachments: downloaded,
        cleanup: async () => {
            await Promise.all(downloaded.map((d) => unlink(d.filePath).catch(() => { })));
        },
    };
}
/** @deprecated Use {@link downloadFileAttachments} instead. */
export const downloadImageAttachments = downloadFileAttachments;
