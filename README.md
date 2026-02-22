# @voidly/mcp-server

[Model Context Protocol](https://modelcontextprotocol.io) server for the **Voidly Global Censorship Index** — giving AI systems real-time access to censorship data across 119 countries, 5,356+ documented incidents, and 11.7M measurements.

[![npm](https://img.shields.io/npm/v/@voidly/mcp-server)](https://www.npmjs.com/package/@voidly/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Install

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
      "args": ["-y", "@voidly/mcp-server"]
    }
  }
}
```

### Cursor / Windsurf

Add to your MCP configuration:

```json
{
  "voidly": {
    "command": "npx",
    "args": ["-y", "@voidly/mcp-server"]
  }
}
```

## Tools (27)

### Censorship Index

| Tool | Description |
|------|-------------|
| `get_censorship_index` | Global overview of all 119 monitored countries with scores and rankings |
| `get_country_status` | Detailed censorship status for a specific country (score, blocked services, trend) |
| `get_most_censored` | Top N most censored countries by composite score |
| `compare_countries` | Side-by-side comparison of censorship metrics between countries |

### Incidents

| Tool | Description |
|------|-------------|
| `get_active_incidents` | Current censorship incidents with filtering by country, severity, type |
| `get_incident_detail` | Full detail for a single incident by hash ID (e.g., `IR-2026-0142`) |
| `get_incident_evidence` | Evidence permalinks (OONI, IODA, CensoredPlanet) for an incident |
| `get_incident_report` | Generate citable markdown/BibTeX/RIS report for an incident |
| `get_incident_stats` | Aggregate incident statistics (counts by country, type, severity) |
| `get_incidents_since` | Delta feed — incidents created after a given timestamp |

### Domain & Service Risk

| Tool | Description |
|------|-------------|
| `check_domain_blocked` | Check if a specific domain is blocked in a specific country |
| `get_domain_status` | Full blocking status for a domain across all monitored countries |
| `get_domain_history` | Historical blocking trend for a domain (30-day window) |
| `check_service_accessibility` | Real-time accessibility oracle — "can users access X in Y?" |

### Verification

| Tool | Description |
|------|-------------|
| `verify_claim` | Fact-check a natural language censorship claim against evidence |

### Predictive Intelligence

| Tool | Description |
|------|-------------|
| `get_risk_forecast` | 7-day shutdown risk forecast for a country |
| `get_high_risk_countries` | All countries above a risk threshold for the next 7 days |
| `get_election_risk` | Election-censorship correlation briefings with forecast overlay |

### Platform & ISP Analysis

| Tool | Description |
|------|-------------|
| `get_platform_risk` | Censorship risk scores for a platform across all countries |
| `get_isp_risk_index` | ISP censorship scoring — aggressiveness, breadth, methods |

### Network Probes

| Tool | Description |
|------|-------------|
| `get_probe_network` | Status of the global probe network (16 nodes, 62 domains) |
| `check_domain_probes` | Live probe results for a specific domain |
| `check_vpn_accessibility` | VPN/proxy protocol accessibility by country |
| `get_isp_status` | ISP-level blocking detail for a country |

### Community

| Tool | Description |
|------|-------------|
| `get_community_probes` | Community-contributed probe results |
| `get_community_leaderboard` | Top community probe contributors |

### Alerts

| Tool | Description |
|------|-------------|
| `get_alert_stats` | Real-time alert system statistics |

## Example Prompts

Once connected, ask your AI assistant:

- *"Is Twitter blocked in Iran?"*
- *"Which countries have the most censorship right now?"*
- *"Compare internet freedom in Russia vs China"*
- *"What censorship incidents happened in Turkey this week?"*
- *"Is there election-related censorship risk in the next 30 days?"*
- *"Which ISPs in Egypt are the most aggressive at blocking?"*
- *"Can users access WhatsApp in Saudi Arabia?"*
- *"Verify: Telegram is blocked in Russia"*

## Data Sources

| Source | Coverage |
|--------|----------|
| [OONI](https://ooni.org) | 8 test types, 80 countries |
| [CensoredPlanet](https://censoredplanet.org) | DNS + HTTP/S blocking, 50 countries |
| [IODA](https://ioda.inetintel.cc.gatech.edu) | ASN-level outage detection |
| Voidly Probe Network | 16 nodes, 62 domains, 5-min intervals |

All data licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## API

The MCP server connects to the public Voidly API at `api.voidly.ai`. No API key required for read-only access.

- [API Documentation](https://voidly.ai/api-docs)
- [Open Data Hub](https://voidly.ai/data)
- [HuggingFace Dataset](https://huggingface.co/datasets/emperor-mew/global-censorship-index)

## Related

- [Voidly Censorship Index](https://voidly.ai/censorship-index) — Live rankings
- [Community Probes](https://github.com/voidly-ai/community-probe) — Run a probe node
- [Incident Feed](https://voidly.ai/live) — Real-time stream

## License

MIT — see [LICENSE](LICENSE)
