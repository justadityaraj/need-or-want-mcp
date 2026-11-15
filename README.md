# Need or Want

An MCP server that checks a purchase before you make it. It asks a few fixed multiple-choice questions, computes a verdict (BUY, WAIT or SKIP) with plain arithmetic, and logs every decision and its outcome.

You can argue with it. The verdict changes only when a fact changes, never because you push harder.

- Deterministic: same inputs, same verdict. No AI decides anything.
- Local: your data stays in `~/.need-or-want/`. No network calls, no accounts, no telemetry.
- Honest: it reviews its own verdicts at 30 and 90 days and reports how often it was right.

**Status: in development.** See [docs/DESIGN.md](docs/DESIGN.md) for the full design, the maths and the research behind it.

## License

MIT
