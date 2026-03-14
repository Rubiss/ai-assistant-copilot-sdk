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
