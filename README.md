# Need or Want

Stop impulse buying. Need or Want is an MCP server that checks a purchase before you make it: is it a need or a want, and should you buy it now, wait, or skip it?

It asks a few fixed multiple-choice questions, then computes a verdict with plain arithmetic. You can argue with it, but the verdict only changes when a fact changes, never because you push harder. Every decision is logged and reviewed at 30 and 90 days, so you can see whether it was right.

- **Deterministic:** same inputs, same verdict. No AI decides anything.
- **Local:** your data stays in `~/.need-or-want/`. No network calls, no accounts, no telemetry.
- **Honest:** it scores its own past verdicts and tells you how often it was right.

## Install

Claude Code:

```bash
claude mcp add --scope user need-or-want -- npx -y need-or-want-mcp
```

Claude Desktop, in `claude_desktop_config.json`:

```json
{ "mcpServers": { "need-or-want": { "command": "npx", "args": ["-y", "need-or-want-mcp"] } } }
```

Then tell Claude: "Set up Need or Want. My currency is USD and my monthly spending budget is 2000."

From source: `npm install && npm run build`, then point the client at `node /path/to/need-or-want-mcp/dist/src/index.js`.

## Use

Talk about buying something and Claude runs the check. Or use the `should-i-buy` prompt (a slash command in Claude Code, a menu item in Claude Desktop).

| Tool | What it does |
|---|---|
| `setup` | Currency, monthly budget (or a month-by-month schedule), credit card policy |
| `check_purchase` | Returns the questions, then the verdict: BUY, WAIT or SKIP, plus NEED, MIXED or WANT |
| `challenge_verdict` | Argue with the verdict by changing one fact |
| `record_outcome` | Bought, didn't buy, or a 30/90-day review |
| `get_status` | Money left this month, waits ending, reviews due, accuracy |

## How the verdict works

A score from 0 to 100: need 40%, budget fit 25%, honest cost per use 20%, your track record 10%, real discount 5%. 70 or more is BUY after a wait, 50 to 69 is WAIT for twice as long, under 50 is SKIP. Vetoes (EMI, new credit, over budget, blocked category) come first.

The full maths, the psychology and the research behind it: [docs/DESIGN.md](docs/DESIGN.md).

## Settings

Edit `~/.need-or-want/config.json`. Tightening a setting applies at once. Loosening one waits 7 days, so you can't raise your own budget mid-craving.

## Optional: run the check whenever you look at a product (Claude Code)

Add a hook to `~/.claude/settings.json`, with a matcher for your shopping MCP:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "mcp__amazon-in__.*",
        "hooks": [
          {
            "type": "command",
            "command": "echo '{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":\"The user is looking at a product. Before helping them buy it, run need-or-want check_purchase.\"}}'"
          }
        ]
      }
    ]
  }
}
```

## Privacy

Everything stays in the data folder on your machine. The server makes no network calls, and a test fails the build if any source file could.

## License

MIT
