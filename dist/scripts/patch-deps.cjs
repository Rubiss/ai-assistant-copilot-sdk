// Patches @github/copilot-sdk/dist/session.js to use 'vscode-jsonrpc/node.js'
// instead of 'vscode-jsonrpc/node'. The missing .js extension breaks Node's
// strict ESM resolver when vscode-jsonrpc has no package exports map (v8.x).
// client.js in the same package already uses the correct .js extension;
// this brings session.js in line.
const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "node_modules/@github/copilot-sdk/dist/session.js"
);

try {
  const original = fs.readFileSync(target, "utf8");
  const patched = original.replace(
    'from "vscode-jsonrpc/node"',
    'from "vscode-jsonrpc/node.js"'
  );
  if (original !== patched) {
    fs.writeFileSync(target, patched);
    console.log(
      "✅ Patched @github/copilot-sdk/dist/session.js (vscode-jsonrpc ESM fix)"
    );
  }
} catch (_) {
  // Non-fatal: file may not exist in all environments
}

// Heals @github/copilot/definitions/ when it is missing after an
// `npm install -g --install-links` run. That flag uses a stricter tar
// extractor that fails to create the directory before writing files into it,
// producing TAR_ENTRY_ERROR ENOENT warnings and leaving the dir absent.
const copilotPkg = path.resolve(
  process.cwd(),
  "node_modules/@github/copilot/package.json"
);
const defsDir = path.resolve(
  process.cwd(),
  "node_modules/@github/copilot/definitions"
);

try {
  if (!fs.existsSync(defsDir)) {
    const { execSync } = require("child_process");
    const version = JSON.parse(fs.readFileSync(copilotPkg, "utf8")).version;
    console.log(
      `⚠️  @github/copilot/definitions/ missing — healing (v${version})…`
    );
    execSync(
      `npm install --no-save --no-install-links --no-fund --no-audit --prefix="${process.cwd()}" "@github/copilot@${version}"`,
      { stdio: "pipe" }
    );
    console.log("✅ Healed @github/copilot/definitions/");
  }
} catch (_) {
  // Non-fatal: warn and move on; user can re-run without --install-links
  console.warn(
    "⚠️  Could not heal @github/copilot/definitions/. Re-install without --install-links:\n" +
      "   npm install -g github:Rubiss/ai-assistant-copilot-sdk"
  );
}
