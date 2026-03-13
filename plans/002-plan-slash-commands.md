# Plan: Expose All `session.rpc` Methods as Discord Slash Commands

## Problem

The Copilot SDK's `session.rpc` object exposes rich session-control RPCs (agent selection, mode switching, compaction, fleet, plan management, workspace files). Currently only `model.switchTo` is exposed (as `/model set`). The rest are inaccessible to Discord users.

## Approach

Follow the existing pattern: **SessionManager method → Discord slash command → handler file**. Each RPC maps to a new public method on `SessionManager`, a new `SlashCommandBuilder` entry, a handler file, and a switch case in `bot.ts`.

### Excluded RPCs (not user-facing)
- `shell.exec` / `shell.kill` — User opted to exclude (security risk)
- `tools.handlePendingToolCall` — Internal SDK plumbing
- `permissions.handlePendingPermissionRequest` — Internal SDK plumbing

### Session key pattern (reuse everywhere)
```typescript
const sessionKey = interaction.channel?.isThread()
  ? interaction.channelId
  : interaction.user.id;
```

---

## New Discord Commands

### 1. `/model current` (add subcommand to existing `/model`)
- **RPC**: `session.rpc.model.getCurrent()`
- **SessionManager**: `getCurrentModel(key): Promise<string | undefined>`
- **Handler**: Extend existing `src/handlers/slash/model.ts`
- **Files**: `src/copilot.ts`, `src/commands.ts`, `src/handlers/slash/model.ts`

### 2. `/agent` (new command group)
| Subcommand | RPC | SessionManager Method |
|---|---|---|
| `/agent list` | `agent.list()` | `listAgents(key)` |
| `/agent current` | `agent.getCurrent()` | `getCurrentAgent(key)` |
| `/agent select <name>` | `agent.select({ name })` | `selectAgent(key, name)` |
| `/agent deselect` | `agent.deselect()` | `deselectAgent(key)` |
- **Files**: `src/copilot.ts`, `src/commands.ts`, `src/handlers/slash/agent.ts`, `src/bot.ts`

### 3. `/mode` (new command group)
| Subcommand | RPC | SessionManager Method |
|---|---|---|
| `/mode get` | `mode.get()` | `getMode(key)` |
| `/mode set <mode>` | `mode.set({ mode })` | `setMode(key, mode)` |
- Mode choices: `interactive`, `plan`, `autopilot`
- **Files**: `src/copilot.ts`, `src/commands.ts`, `src/handlers/slash/mode.ts`, `src/bot.ts`

### 4. `/compact` (new standalone command)
- **RPC**: `session.rpc.compaction.compact()`
- **SessionManager**: `compact(key): Promise<{ success, tokensRemoved, messagesRemoved }>`
- **Response**: "✅ Compacted: removed {n} tokens, {m} messages"
- **Files**: `src/copilot.ts`, `src/commands.ts`, `src/handlers/slash/compact.ts`, `src/bot.ts`

### 5. `/fleet` (new command)
- **RPC**: `session.rpc.fleet.start({ prompt? })`
- **SessionManager**: `startFleet(key, prompt?): Promise<boolean>`
- **Option**: optional `prompt` string
- **Files**: `src/copilot.ts`, `src/commands.ts`, `src/handlers/slash/fleet.ts`, `src/bot.ts`

### 6. `/plan` (new command group)
| Subcommand | RPC | SessionManager Method |
|---|---|---|
| `/plan read` | `plan.read()` | `readPlan(key)` |
| `/plan update <content>` | `plan.update({ content })` | `updatePlan(key, content)` |
| `/plan delete` | `plan.delete()` | `deletePlan(key)` |
- **Files**: `src/copilot.ts`, `src/commands.ts`, `src/handlers/slash/plan.ts`, `src/bot.ts`

### 7. `/workspace` (new command group)
| Subcommand | RPC | SessionManager Method |
|---|---|---|
| `/workspace list` | `workspace.listFiles()` | `listWorkspaceFiles(key)` |
| `/workspace read <path>` | `workspace.readFile({ path })` | `readWorkspaceFile(key, path)` |
| `/workspace create <path> <content>` | `workspace.createFile({ path, content })` | `createWorkspaceFile(key, path, content)` |
- **Files**: `src/copilot.ts`, `src/commands.ts`, `src/handlers/slash/workspace.ts`, `src/bot.ts`

---

## Implementation Order (Todos)

### Phase 1: SessionManager API (`src/copilot.ts`)
Add all new public methods. Each follows the existing `setModel` pattern:
```typescript
async methodName(key: string, ...args): Promise<Result> {
  const session = await this.getOrCreateSession(key);
  return session.rpc.namespace.method(...args);
}
```

### Phase 2: Command Definitions (`src/commands.ts`)
- Add `current` subcommand to existing `/model` builder
- Add new `SlashCommandBuilder` entries for: `agent`, `mode`, `compact`, `fleet`, `plan`, `workspace`
- Update `CommandName` type union

### Phase 3: Handler Files (`src/handlers/slash/`)
Create 6 new handler files + extend `model.ts`:
- `agent.ts`, `mode.ts`, `compact.ts`, `fleet.ts`, `plan.ts`, `workspace.ts`
- Extend: `model.ts` (add `current` subcommand handling)

### Phase 4: Bot Router (`src/bot.ts`)
- Import all new handlers
- Add switch cases for each new command

### Phase 5: Register & Verify
- Run `npm run build` to verify TypeScript compiles
- Run `npm run register` to push commands to Discord

---

## File Change Summary

| File | Change Type | Risk |
|---|---|---|
| `src/copilot.ts` | Add ~15 public methods | 🟡 Core session logic |
| `src/commands.ts` | Add 6 new builders + modify 1 | 🟢 Additive |
| `src/bot.ts` | Add 6 imports + 6 switch cases | 🟢 Additive |
| `src/handlers/slash/model.ts` | Add `current` subcommand branch | 🟢 Small extension |
| `src/handlers/slash/agent.ts` | New file | 🟢 New |
| `src/handlers/slash/mode.ts` | New file | 🟢 New |
| `src/handlers/slash/compact.ts` | New file | 🟢 New |
| `src/handlers/slash/fleet.ts` | New file | 🟢 New |
| `src/handlers/slash/plan.ts` | New file | 🟢 New |
| `src/handlers/slash/workspace.ts` | New file | 🟢 New |

## Notes
- All responses use `ephemeral: true` (only the invoking user sees the response) for control commands
- All handlers follow the existing error-handling pattern (try/catch, deferred reply)
- `getOrCreateSession` is reused — creating a session for a control command is consistent with `setModel` behavior
- Session key pattern (thread ID vs user ID) is applied uniformly
