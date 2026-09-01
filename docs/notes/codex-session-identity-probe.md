# Brief: probe Codex's own hook payload and session identity

You are Codex. This asks you to investigate yourself. Run real commands and report what
you observe. Do not answer from documentation or from memory alone. If a claim comes from
reading a doc rather than from a command you ran, label it as unverified.

## Why this matters

`pair-mode` is a `PreToolUse` hook that holds a proposed edit so a human can annotate the
diff before the agent applies it. Today it opens ONE Unix socket per directory. A person
who runs several concurrent agent sessions in one repo gets every session's diffs in every
watcher. We want to key each socket by the agent's session id instead.

That design needs to know exactly what Codex puts in a hook payload and in the shell
environment. We already answered the same questions for Claude Code by direct experiment.
We could not answer them for Codex.

## What we already verified for Claude Code

Run with a throwaway `PreToolUse` hook that appended the raw payload to a JSONL file:

- The payload top-level keys are: `cwd`, `effort`, `hook_event_name`, `permission_mode`,
  `prompt_id`, `session_id`, `tool_input`, `tool_name`, `tool_use_id`, `transcript_path`.
- A subagent's edit carries the SAME `session_id` as the parent, plus its own `agent_id`
  and `agent_type`.
- `session_id` survives both `--resume <id>` and `--continue`.
- `CLAUDE_CODE_SESSION_ID` in a shell tool's environment matches the payload `session_id`
  exactly.

We want the equivalent facts for Codex.

## What we tried and how it failed

We built an isolated `CODEX_HOME` to avoid touching the user's real config:

1. Created a temp dir, symlinked `auth.json` from the real `~/.codex`, wrote a minimal
   `config.toml` with a trusted project entry, and wrote a `hooks.json`.
2. Ran `CODEX_HOME=<temp> codex exec --sandbox workspace-write --skip-git-repo-check
   "Create codex.txt containing the word codex." < /dev/null`.

Result: Codex created the file every time. The hook never fired. We tried the matcher
`apply_patch|Edit|Write`, which is what the user's real `~/.codex/hooks.json` already
uses for pair-mode. We then tried a matcher-less `PreToolUse` entry, which should fire on
every tool call. Neither produced a single line of output.

Two earlier runs failed for unrelated reasons, so discount them. One died because `timeout`
is not installed on this machine. One hung because `codex exec` blocks reading stdin unless
you redirect `< /dev/null`.

So the open question includes our own method: does a custom `CODEX_HOME` load `hooks.json`
at all, or did we get the schema or the file location wrong?

## Questions to answer

Answer each with the command you ran and the raw output.

1. **Payload shape.** What are ALL top-level keys in a Codex `PreToolUse` payload? Dump one
   verbatim, with any secrets redacted.

2. **Session id.** Does the payload carry `session_id`? What about `turn_id`, `agent_id`,
   `agent_type`? Give the real values from one run.

3. **Resume stability.** Start a session, capture its `session_id`, then `codex resume` it
   and make another edit. Does `session_id` stay the same?

4. **Delegated work.** If Codex can delegate to a sub-agent or a second thread that edits
   files, does that edit carry the parent's `session_id`? Does it set `agent_id` and
   `agent_type`? If Codex has no such feature, say so plainly.

5. **Environment.** Inside a shell tool call, which environment variables identify the
   session? We found the string `CODEX_SESSION_ID` in the binary but never saw it set. Run
   `env | grep -i codex` from inside a Codex shell tool and report the real list.

6. **Hook config loading.** Does Codex read `hooks.json` from a custom `CODEX_HOME`? If it
   does, what did we get wrong above? If it does not, where must a hook live?

7. **The apply_patch tool name.** pair-mode matches `apply_patch|Edit|Write` and its adapter
   reads `tool_input.command` looking for `*** Begin Patch`. Which is correct? What is the
   literal `tool_name` when Codex edits a file, and what is the exact shape of `tool_input`?
   This one affects shipped code, so be precise.

## Constraints

- Do not leave the user's `~/.codex/hooks.json` modified. If you must edit it to get a hook
  to fire, back it up first and restore it before you finish. Confirm the restore.
- Do not disable or delete the pair-mode hook entry permanently.
- Redact any token, key, or credential before you paste output.

## Output format

Return a short prose answer per question, then one JSON block:

```json
{
  "payload_top_level_keys": [],
  "has_session_id": null,
  "session_id_stable_across_resume": null,
  "subagent_inherits_session_id": null,
  "subagent_fields": [],
  "session_env_vars": [],
  "custom_codex_home_loads_hooks": null,
  "edit_tool_name": "",
  "tool_input_shape": {}
}
```

Use `null` for anything you could not verify. Do not guess.

---

## Verified findings from Codex 0.149.1

**Codex 0.149.1 provides a stable session ID in root, resume, and subagent hook payloads.**

### 1. Payload shape

Command:

```text
rtk proxy jq -c 'select(.hook_event_name=="PreToolUse" and .tool_name=="apply_patch")' /private/tmp/codex-session-identity-probe/raw-events.jsonl
```

One verbatim root payload:

```text
{"session_id":"01a05d7b-a56a-71b2-9f6e-fb4084031858","turn_id":"01a05d7d-8580-7741-96e0-94130609fe62","transcript_path":"/private/tmp/codex-session-identity-probe/home/sessions/2026/09/01/rollout-2026-09-01T10-59-39-01a05d7b-a56a-71b2-9f6e-fb4084031858.jsonl","cwd":"/private/tmp/codex-session-identity-probe/work","hook_event_name":"PreToolUse","model":"gpt-5.6-sol","permission_mode":"bypassPermissions","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Update File: probe.txt\n@@\n-first\n+resumed\n*** End Patch"},"tool_use_id":"exec-c6222926-f6c7-4f11-841a-7c37093f34c9"}
```

The complete root key set is `cwd`, `hook_event_name`, `model`, `permission_mode`, `session_id`, `tool_input`, `tool_name`, `tool_use_id`, `transcript_path`, and `turn_id`.

### 2. Session fields

- The root payload has `session_id` and `turn_id`.
- The root payload omits `agent_id` and `agent_type`.
- The observed session ID is `01a05d7b-a56a-71b2-9f6e-fb4084031858`.
- The observed root turn ID is `01a05d7d-8580-7741-96e0-94130609fe62`.

### 3. Resume stability

Command:

```text
CODEX_HOME=/private/tmp/codex-session-identity-probe/home rtk proxy codex exec resume --json --skip-git-repo-check --dangerously-bypass-hook-trust -c 'sandbox_mode="workspace-write"' 01a05d7b-a56a-71b2-9f6e-fb4084031858 'Use apply_patch to change probe.txt from first to resumed.' < /dev/null
```

Relevant raw output:

```text
{"type":"thread.started","thread_id":"01a05d7b-a56a-71b2-9f6e-fb4084031858"}
{"type":"item.completed","item":{"id":"item_3","type":"file_change","changes":[{"path":"/private/tmp/codex-session-identity-probe/work/probe.txt","kind":"update"}],"status":"completed"}}
```

The resumed `PreToolUse` payload keeps session ID `01a05d7b-a56a-71b2-9f6e-fb4084031858`. Its new turn ID is `01a05d7d-8580-7741-96e0-94130609fe62`.

### 4. Delegated work

Command:

```text
CODEX_HOME=/private/tmp/codex-session-identity-probe/home rtk proxy codex exec resume --json --skip-git-repo-check --dangerously-bypass-hook-trust --enable multi_agent -c 'sandbox_mode="workspace-write"' 01a05d7b-a56a-71b2-9f6e-fb4084031858 'Use spawn_agent to delegate this exact task to a subagent: use apply_patch to create delegated.txt containing child. Wait for the subagent and report its result. Do not create the file yourself.' < /dev/null
```

Verbatim subagent edit payload:

```text
{"session_id":"01a05d7b-a56a-71b2-9f6e-fb4084031858","turn_id":"01a05d7d-fff0-7691-944d-8ea132b02fce","agent_id":"01a05d7d-ffdc-7da3-ab4f-d0ea43e03fbd","agent_type":"default","transcript_path":"/private/tmp/codex-session-identity-probe/home/sessions/2026/09/01/rollout-2026-09-01T11-02-13-01a05d7d-ffdc-7da3-ab4f-d0ea43e03fbd.jsonl","cwd":"/private/tmp/codex-session-identity-probe/work","hook_event_name":"PreToolUse","model":"gpt-5.6-sol","permission_mode":"bypassPermissions","tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch\n*** Add File: delegated.txt\n+child\n*** End Patch"},"tool_use_id":"exec-1978f2ca-e082-4ff5-b351-0fef80c3a4c2"}
```

The subagent inherits the parent session ID. It adds `agent_id` and `agent_type` to its tool payloads.

### 5. Environment

Command from the nested Codex shell tool:

```text
env | grep -i codex
```

Raw output:

```text
CODEX_CI=1
CODEX_HOME=/private/tmp/codex-session-identity-probe/home
CODEX_SANDBOX=seatbelt
CODEX_SANDBOX_NETWORK_DISABLED=1
CODEX_SESSION_ID=01a05d7b-a56a-71b2-9f6e-fb4084031858
CODEX_THREAD_ID=01a05d7b-a56a-71b2-9f6e-fb4084031858
NODE_REPL_TRUSTED_CODE_PATHS=/Users/owen/.codex:/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules
OLDPWD=/private/tmp/codex-session-identity-probe/work
PATH=/Users/owen/.codex/packages/standalone/releases/0.149.1-aarch64-apple-darwin/codex-path:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/private/tmp/codex-session-identity-probe/home/tmp/arg0/codex-arg0f3aPO4:/Users/owen/.codex/packages/standalone/releases/0.149.1-aarch64-apple-darwin/codex-path:/Users/owen/.codex/tmp/arg0/codex-arg0392433:/opt/homebrew/opt/libpq/bin:/Users/owen/.bun/bin:/Users/owen/.local/share/mise/installs/elixir/1.19.5-otp-28/bin:/Users/owen/.local/share/mise/installs/elixir/1.19.5-otp-28/.mix/escripts:/Users/owen/.local/share/mise/installs/erlang/28/bin:/Users/owen/Library/pnpm/bin:/Users/owen/.local/bin:/Users/owen/.cargo/bin:/Applications/Ghostty.app/Contents/MacOS
PWD=/private/tmp/codex-session-identity-probe/work
__MISE_ORIG_PATH=/Users/owen/Library/pnpm/bin:/Users/owen/.local/bin:/Users/owen/.cargo/bin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Applications/Ghostty.app/Contents/MacOS
```

`CODEX_SESSION_ID` and `CODEX_THREAD_ID` both identify the session. Both values match the payload session ID.

The hook process environment retained the outer session ID during this nested probe. The payload remains the correct source for hook identity.

### 6. Hook config loading

The custom `CODEX_HOME` loads `hooks.json`. A new hook requires explicit trust or `--dangerously-bypass-hook-trust`.

Command without the bypass flag:

```text
CODEX_HOME=/private/tmp/codex-session-identity-probe/home rtk proxy codex exec --json --sandbox workspace-write --skip-git-repo-check -C /private/tmp/codex-session-identity-probe/work 'Use apply_patch to create trust-check.txt containing skipped.' < /dev/null
rtk proxy wc -l /private/tmp/codex-session-identity-probe/raw-events.jsonl
```

Relevant raw output:

```text
{"type":"item.completed","item":{"id":"item_1","type":"file_change","changes":[{"path":"/private/tmp/codex-session-identity-probe/work/trust-check.txt","kind":"add"}],"status":"completed"}}
17 /private/tmp/codex-session-identity-probe/raw-events.jsonl
```

The file changed while the hook event count stayed at 17. The same config captured events with the bypass flag.

The trusted project entry does not trust a new hook definition. The prior experiment omitted the required hook trust step.

The [official OpenAI Hooks documentation](https://learn.chatgpt.com/docs/hooks) describes this trust gate and the bypass flag. That documentation supports the observed result.

### 7. The edit tool name

The literal tool name is `apply_patch`. The observed input contains one `command` string with the complete patch.

The matchers `apply_patch`, `Edit`, and `Write` all target this tool. The hook payload still reports `apply_patch`.

The shipped matcher is correct. The adapter reads the correct field.

### Cleanup

- The probe never modified `/Users/owen/.codex/hooks.json`.
- Its size remains 2,073 bytes.
- Its modification time remains August 23 at 11:15.
- I removed the temporary `auth.json` symlink.
- The raw evidence remains under `/private/tmp/codex-session-identity-probe/`.

```json
{
  "payload_top_level_keys": [
    "cwd",
    "hook_event_name",
    "model",
    "permission_mode",
    "session_id",
    "tool_input",
    "tool_name",
    "tool_use_id",
    "transcript_path",
    "turn_id"
  ],
  "has_session_id": true,
  "session_id_stable_across_resume": true,
  "subagent_inherits_session_id": true,
  "subagent_fields": ["agent_id", "agent_type"],
  "session_env_vars": ["CODEX_SESSION_ID", "CODEX_THREAD_ID"],
  "custom_codex_home_loads_hooks": true,
  "edit_tool_name": "apply_patch",
  "tool_input_shape": {
    "command": "*** Begin Patch\n*** Update File: probe.txt\n@@\n-first\n+resumed\n*** End Patch"
  }
}
```
