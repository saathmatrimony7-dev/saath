# Developer setup: Claude Code on Kimi K3 (Kimi Code subscription)

Kimi K3 is the **coding assistant** only. The app's in-app AI uses the **Claude API** (see the end of this guide).

Values below are from Kimi's official guide as of October 2026:
https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html
Kimi changes these occasionally. If something fails, check that page first.

---

## 1. Get your Kimi Code API key

1. Log in at **https://www.kimi.com/code/console** with the account that has your Kimi membership.
2. Make sure Kimi Code benefits are active for your plan.
3. Click **Create API Key**, name it (e.g. `saath-dev-laptop`), and confirm.
4. **Copy the key immediately.** It is shown only once. Store it in your password manager.

Note: this is a _Kimi Code_ key. A key from Moonshot's pay-per-token developer platform will not work on the coding endpoint, and vice versa.

## 2. Install Claude Code

Install Claude Code using Anthropic's official instructions. **Don't log in to Anthropic and don't start it yet.**

## 3. Create a separate Kimi settings file (keeps any Anthropic login untouched)

macOS / Linux:

```bash
cp docs/kimi-settings.example.json ~/.claude/kimi-settings.json
chmod 600 ~/.claude/kimi-settings.json
```

Windows: copy it to `C:\Users\<you>\.claude\kimi-settings.json`.

Then edit `~/.claude/kimi-settings.json` and replace `PASTE_YOUR_KIMI_CODE_KEY_HERE` with your key.

What the settings do:

| Variable                                                             | Value                         | Purpose                                                                    |
| -------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| `ANTHROPIC_BASE_URL`                                                 | `https://api.kimi.ai/coding/` | Sends Claude Code's requests to Kimi (keep the trailing slash)             |
| `ANTHROPIC_API_KEY`                                                  | your Kimi Code key            | Auth                                                                       |
| `ANTHROPIC_MODEL`                                                    | `k3[1m]`                      | Main model: K3 with the 1M context (Pro plan)                              |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` / `_SONNET_` / `_FABLE_`              | `k3[1m]`                      | Every "tier" Claude Code may pick → K3                                     |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL`                                      | `kimi-for-coding`             | Small background tasks (titles, summaries) → cheaper model, saves K3 quota |
| `CLAUDE_CODE_SUBAGENT_MODEL`                                         | `k3[1m]`                      | All subagents run on K3                                                    |
| `CLAUDE_CODE_EFFORT_LEVEL`                                           | `high`                        | Reasoning effort                                                           |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS` / `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | `1048576` / `950000`          | Must match the model's context window                                      |

## 4. Add a launcher

macOS / Linux (`~/.zshrc` or `~/.bashrc`):

```bash
claude-kimi() {
  command claude --settings "$HOME/.claude/kimi-settings.json" "$@"
}
```

Reload the shell (`exec zsh` or `source ~/.bashrc`).

Windows PowerShell (`$PROFILE`):

```powershell
function claude-kimi { claude --settings "$HOME\.claude\kimi-settings.json" @args }
```

Make sure `~/.claude/settings.json` has **no** `env` block with `ANTHROPIC_*` values, and that your shell profile doesn't export any `ANTHROPIC_*` variables. Leftovers override or conflict.

## 5. Verify

```bash
cd ~/code/saath
claude-kimi
```

Inside Claude Code:

1. If asked whether to use the API key → **Yes**. Trust the project folder.
2. Run `/status`. The base URL must show `https://api.kimi.ai/coding/`. (The model label may still say a Claude name. That's cosmetic; calls go to Kimi.)
3. Send a test prompt: `Read CLAUDE.md and summarise the rules in 5 bullets.`

## 6. Troubleshooting

| Symptom                                     | Fix                                                                                                                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401` + "model id does not exist… k3[1m]"   | Some accounts reject the `[1m]` suffix. Replace every `k3[1m]` with `k3` (still 1M context on Pro).                                                                          |
| `401` invalid key                           | You used a developer-platform key, or the key has a typo. Create a new one in the Kimi Code console.                                                                         |
| `404`                                       | Check the base URL and the trailing slash. If `api.kimi.ai` fails, try `https://api.kimi.com/coding/` (some guides use this host) and check Kimi's docs for the current one. |
| Subagents or background tasks fail silently | One of the `ANTHROPIC_DEFAULT_*_MODEL` or `CLAUDE_CODE_SUBAGENT_MODEL` values is missing.                                                                                    |
| "Please run /login"                         | Don't run `/login`. Close all sessions; in `~/.claude.json`, under `customApiKeyResponses`, move your key's last 20 characters from `rejected` to `approved`.                |
| Hitting usage limits                        | The plan meters requests per rolling 5-hour window. Subagents and high effort use more. Run fewer subagents in parallel, or use `/effort` low for simple tasks.              |
| Changes ignored                             | Settings are read at launch. Restart Claude Code.                                                                                                                            |

Known limitation: **WebFetch doesn't work** on the Kimi coding endpoint. Save any external docs you need into `docs/reference/`.

## 7. VS Code (optional)

1. Complete steps 1–5 first.
2. Open the Claude Code extension → start a session → click **Run `claude` in terminal**. In the terminal, trust the folder and accept the API key.
3. Fully quit and reopen VS Code.

The VS Code extension reads `~/.claude/settings.json`, not your `kimi-settings.json` launcher. If you want the extension on Kimi, put the `env` block in `~/.claude/settings.json` instead. That makes Kimi the default everywhere on that machine.

## 8. Security checklist

- [ ] The key is only in `~/.claude/kimi-settings.json` (chmod 600) and your password manager.
- [ ] No key in the repo, in `.claude/settings.json` inside the repo, or in shell history.
- [ ] `pre-commit` with gitleaks installed (`pre-commit install`).
- [ ] Only synthetic data in the repo. Never paste production data or logs into a Claude Code session.
- [ ] Rotate the key if a laptop is lost or a dotfile is shared. Delete it in the Kimi Code console.

---

## In-app AI: Claude API (separate from all of the above)

The product's agents call the Claude API from `services/agents` via the LLM Gateway.

1. Create an API key at **https://console.anthropic.com** → _API Keys_. Use separate keys per environment (dev, staging, prod) and set spend limits per workspace.
2. **Local dev:** put it in `services/agents/.env.local` (git-ignored):
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   LLM_MODEL_SMALL=claude-haiku-5-5
   LLM_MODEL_MID=claude-sonnet-5-5
   LLM_MODEL_LARGE=claude-opus-5-5
   ```
3. **Staging/prod:** store the key in AWS Secrets Manager (`saath/<env>/anthropic-api-key`); ECS injects it at runtime.
4. Don't confuse the two. The `ANTHROPIC_*` variables in `kimi-settings.json` configure your **coding tool**. The `ANTHROPIC_API_KEY` in `.env.local` / Secrets Manager is the **app's** Claude key. The app never reads your Kimi settings, and Claude Code (on Kimi) never needs the app's key.
