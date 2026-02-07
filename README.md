# Voidly MCP Server

Model Context Protocol (MCP) server for the **Voidly Global Censorship Index**. Enables AI systems to query real-time internet censorship data.

## Data Scale

- **11.7M** live OONI measurements
- **1B+** historical measurements (10-year archive)
- **120+** countries monitored
- Updated every 5 minutes

## Installation

```bash
npx @voidly/mcp-server
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "voidly": {
      "command": "npx",
      "args": ["@voidly/mcp-server"]
    }
  }
}
```

### Cursor / Windsurf / Cline

Add to your MCP config:

```json
{
  "mcpServers": {
    "voidly": {
      "command": "npx",
      "args": ["@voidly/mcp-server"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `get_censorship_index` | Global overview of all monitored countries |
| `get_country_status` | Detailed status for a specific country |
| `check_domain_blocked` | Check if a domain is blocked in a country |
| `get_most_censored` | Ranked list of most censored countries |
| `get_active_incidents` | Currently active censorship incidents |

## Usage Examples

Once configured, you can ask:

- "What countries have the most internet censorship?"
- "Is the internet censored in China?"
- "What's the censorship status in Iran?"
- "Are there any active internet shutdowns?"
- "Is Twitter blocked in Russia?"

## Other AI Platforms

### OpenAI / ChatGPT

MCP isn't supported by OpenAI yet. Use our **OpenAI Action** instead:

1. Go to ChatGPT → Create GPT → Actions
2. Import [`openai-action/openapi.yaml`](../openai-action/openapi.yaml)
3. Your GPT can now query Voidly data

### Direct API

Public endpoints (no auth):
- `https://api.voidly.ai/data/censorship-index.json`
- `https://api.voidly.ai/data/country/{code}`
- `https://api.voidly.ai/data/methodology`

## Data Sources

- **Primary**: OONI (Open Observatory of Network Interference)
- **Secondary**: Voidly probe network
- **License**: CC BY 4.0

## Development

```bash
npm install
npm run build
npm run dev
```

## Links

- [Voidly Censorship Index](https://voidly.ai/censorship-index)
- [npm Package](https://www.npmjs.com/package/@voidly/mcp-server)
- [OpenAI Action Spec](../openai-action/)

## License

MIT
