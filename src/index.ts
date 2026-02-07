#!/usr/bin/env node
/**
 * Voidly MCP Server
 *
 * Model Context Protocol server that exposes Voidly's Global Censorship Index
 * to AI systems like Claude, ChatGPT, and other MCP-compatible clients.
 *
 * Tools provided:
 * - get_censorship_index: Global overview of all monitored countries
 * - get_country_status: Detailed censorship status for a specific country
 * - check_domain_blocked: Check if a domain is blocked in a country
 * - get_most_censored: Get the most censored countries
 * - get_active_incidents: Get active censorship incidents
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Voidly API endpoints
const VOIDLY_API = 'https://censorship.voidly.ai';
const VOIDLY_DATA_API = 'https://voidly.ai/api/data';

// Country metadata for enriching responses
const COUNTRY_NAMES: Record<string, string> = {
  CN: 'China', IR: 'Iran', RU: 'Russia', VE: 'Venezuela', CU: 'Cuba',
  MM: 'Myanmar', BY: 'Belarus', SA: 'Saudi Arabia', AE: 'UAE', EG: 'Egypt',
  MX: 'Mexico', VN: 'Vietnam', PH: 'Philippines', IN: 'India', PK: 'Pakistan',
  BD: 'Bangladesh', CO: 'Colombia', BR: 'Brazil', HT: 'Haiti', TR: 'Turkey',
  TH: 'Thailand', ID: 'Indonesia', MY: 'Malaysia', KZ: 'Kazakhstan', UA: 'Ukraine',
  YE: 'Yemen', IQ: 'Iraq', DZ: 'Algeria', NG: 'Nigeria', KE: 'Kenya',
  GH: 'Ghana', ZA: 'South Africa', AR: 'Argentina', CL: 'Chile', PE: 'Peru',
  EC: 'Ecuador', US: 'United States', GB: 'United Kingdom', DE: 'Germany',
  FR: 'France', ES: 'Spain', IT: 'Italy', CA: 'Canada', AU: 'Australia',
  JP: 'Japan', KR: 'South Korea', NL: 'Netherlands', CH: 'Switzerland',
  NZ: 'New Zealand', HK: 'Hong Kong', TW: 'Taiwan', SG: 'Singapore',
};

// Fetch helper with error handling
async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Voidly-MCP-Server/1.0',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

// Tool implementations
async function getCensorshipIndex(): Promise<string> {
  const data = await fetchJson<{
    timestamp: string;
    summary: {
      fullOutage: number;
      partialOutage: number;
      degraded: number;
      normal: number;
      unknown: number;
    };
    countries: Array<{
      country: string;
      name: string;
      status: string;
      ooni?: {
        anomalyRate: number;
        measurementCount: number;
      };
    }>;
  }>(`${VOIDLY_API}/v1/censorship-index`);

  const { summary, countries } = data;

  // Format response for AI consumption
  let result = `# Voidly Global Censorship Index\n`;
  result += `Updated: ${data.timestamp}\n\n`;
  result += `## Summary\n`;
  result += `- Full Outage: ${summary.fullOutage} countries\n`;
  result += `- Partial Outage: ${summary.partialOutage} countries\n`;
  result += `- Degraded: ${summary.degraded} countries\n`;
  result += `- Normal: ${summary.normal} countries\n`;
  result += `- Unknown: ${summary.unknown} countries\n\n`;

  // Top censored countries by anomaly rate
  const withData = countries
    .filter(c => c.ooni && c.ooni.measurementCount > 0)
    .sort((a, b) => (b.ooni?.anomalyRate || 0) - (a.ooni?.anomalyRate || 0));

  result += `## Most Censored Countries (by anomaly rate)\n`;
  withData.slice(0, 10).forEach((c, i) => {
    const pct = ((c.ooni?.anomalyRate || 0) * 100).toFixed(1);
    result += `${i + 1}. ${c.name} (${c.country}): ${pct}% anomaly rate, ${c.ooni?.measurementCount.toLocaleString()} measurements\n`;
  });

  result += `\n## Data Source\n`;
  result += `Source: Voidly Research Global Censorship Index\n`;
  result += `Based on OONI (Open Observatory of Network Interference) measurements\n`;
  result += `URL: https://voidly.ai/censorship-index\n`;
  result += `License: CC BY 4.0\n`;

  return result;
}

async function getCountryStatus(countryCode: string): Promise<string> {
  const code = countryCode.toUpperCase();
  const name = COUNTRY_NAMES[code] || code;

  const data = await fetchJson<{
    country: string;
    name: string;
    status: string;
    ooni?: {
      status: string;
      anomalyRate: number;
      confirmedRate: number;
      measurementCount: number;
      affectedServices: string[];
      lastUpdated: string;
    };
    activeIncidents?: Array<{
      title: string;
      severity: string;
    }>;
  }>(`${VOIDLY_API}/v1/censorship-index/${code}`);

  let result = `# Censorship Status: ${name} (${code})\n\n`;

  if (data.ooni) {
    const { ooni } = data;
    result += `## Current Status: ${ooni.status.toUpperCase()}\n\n`;
    result += `### Metrics\n`;
    result += `- Anomaly Rate: ${(ooni.anomalyRate * 100).toFixed(1)}%\n`;
    result += `- Confirmed Censorship Rate: ${(ooni.confirmedRate * 100).toFixed(2)}%\n`;
    result += `- Total Measurements: ${ooni.measurementCount.toLocaleString()}\n`;
    result += `- Last Updated: ${ooni.lastUpdated}\n\n`;

    if (ooni.affectedServices && ooni.affectedServices.length > 0) {
      result += `### Affected Services\n`;
      ooni.affectedServices.forEach(s => {
        result += `- ${s}\n`;
      });
      result += '\n';
    }
  } else {
    result += `## Status: No recent data available\n\n`;
  }

  if (data.activeIncidents && data.activeIncidents.length > 0) {
    result += `### Active Incidents\n`;
    data.activeIncidents.forEach(i => {
      result += `- [${i.severity.toUpperCase()}] ${i.title}\n`;
    });
    result += '\n';
  }

  result += `## Interpretation\n`;
  if (data.ooni?.anomalyRate && data.ooni.anomalyRate > 0.5) {
    result += `${name} shows significant internet censorship with over 50% of measurements detecting anomalies. `;
    result += `This indicates widespread blocking of websites and services.\n`;
  } else if (data.ooni?.anomalyRate && data.ooni.anomalyRate > 0.2) {
    result += `${name} shows moderate internet censorship with ${(data.ooni.anomalyRate * 100).toFixed(0)}% of measurements detecting anomalies. `;
    result += `Some websites and services may be blocked.\n`;
  } else if (data.ooni?.anomalyRate) {
    result += `${name} shows relatively low censorship levels. Most internet services are accessible.\n`;
  }

  result += `\n## Source\n`;
  result += `Data: Voidly Research Global Censorship Index\n`;
  result += `URL: https://voidly.ai/censorship-index/${code.toLowerCase()}\n`;

  return result;
}

async function checkDomainBlocked(domain: string, countryCode: string): Promise<string> {
  const code = countryCode.toUpperCase();
  const name = COUNTRY_NAMES[code] || code;

  // For now, we provide general country status since domain-level data
  // requires the Hydra API with authentication
  const countryStatus = await getCountryStatus(code);

  let result = `# Domain Block Check: ${domain} in ${name}\n\n`;
  result += `## Note\n`;
  result += `Domain-specific blocking data requires the Voidly Hydra API.\n`;
  result += `Below is the general censorship status for ${name}.\n\n`;
  result += `---\n\n`;
  result += countryStatus;

  return result;
}

async function getMostCensored(limit: number = 10): Promise<string> {
  const data = await fetchJson<{
    countries: Array<{
      country: string;
      name: string;
      ooni?: {
        anomalyRate: number;
        measurementCount: number;
        affectedServices: string[];
      };
    }>;
  }>(`${VOIDLY_API}/v1/censorship-index`);

  const ranked = data.countries
    .filter(c => c.ooni && c.ooni.measurementCount > 100)
    .sort((a, b) => (b.ooni?.anomalyRate || 0) - (a.ooni?.anomalyRate || 0))
    .slice(0, limit);

  let result = `# Most Censored Countries (Top ${limit})\n\n`;
  result += `Based on OONI measurement anomaly rates from the past 7 days.\n\n`;

  ranked.forEach((c, i) => {
    const pct = ((c.ooni?.anomalyRate || 0) * 100).toFixed(1);
    result += `## ${i + 1}. ${c.name} (${c.country})\n`;
    result += `- Anomaly Rate: ${pct}%\n`;
    result += `- Measurements: ${c.ooni?.measurementCount.toLocaleString()}\n`;
    if (c.ooni?.affectedServices && c.ooni.affectedServices.length) {
      result += `- Affected: ${c.ooni.affectedServices.slice(0, 5).join(', ')}\n`;
    }
    result += '\n';
  });

  result += `## Source\n`;
  result += `Data: Voidly Research Global Censorship Index\n`;
  result += `Methodology: Based on OONI network interference measurements\n`;
  result += `URL: https://voidly.ai/censorship-index\n`;

  return result;
}

async function getActiveIncidents(): Promise<string> {
  const data = await fetchJson<{
    count: number;
    incidents: Array<{
      id: string;
      country: string;
      countryName: string;
      title: string;
      description: string;
      severity: string;
      status: string;
      startTime: string;
      affectedServices: string[];
    }>;
  }>(`${VOIDLY_API}/v1/censorship-index/incidents`);

  let result = `# Active Censorship Incidents\n\n`;
  result += `Total: ${data.count} incidents\n\n`;

  if (data.incidents.length === 0) {
    result += `No active incidents currently reported.\n`;
  } else {
    data.incidents.slice(0, 20).forEach(i => {
      result += `## ${i.countryName}: ${i.title}\n`;
      result += `- Severity: ${i.severity.toUpperCase()}\n`;
      result += `- Status: ${i.status}\n`;
      result += `- Started: ${i.startTime}\n`;
      if (i.affectedServices.length) {
        result += `- Affected Services: ${i.affectedServices.join(', ')}\n`;
      }
      if (i.description) {
        result += `- Details: ${i.description.slice(0, 200)}${i.description.length > 200 ? '...' : ''}\n`;
      }
      result += '\n';
    });
  }

  result += `## Source\n`;
  result += `Data: Voidly Research Incident Tracker\n`;
  result += `URL: https://voidly.ai/censorship-index\n`;

  return result;
}

// Create MCP server
const server = new Server(
  {
    name: 'voidly-censorship-index',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_censorship_index',
      description: 'Get the Voidly Global Censorship Index - a comprehensive overview of internet censorship across 50+ countries. Returns summary statistics and the most censored countries ranked by anomaly rate.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_country_status',
      description: 'Get detailed censorship status for a specific country including anomaly rates, affected services, and active incidents.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          country_code: {
            type: 'string',
            description: 'ISO 3166-1 alpha-2 country code (e.g., CN for China, IR for Iran, RU for Russia)',
          },
        },
        required: ['country_code'],
      },
    },
    {
      name: 'check_domain_blocked',
      description: 'Check if a specific domain is likely blocked in a country. Returns general censorship status for the country.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          domain: {
            type: 'string',
            description: 'Domain to check (e.g., google.com, twitter.com)',
          },
          country_code: {
            type: 'string',
            description: 'ISO 3166-1 alpha-2 country code',
          },
        },
        required: ['domain', 'country_code'],
      },
    },
    {
      name: 'get_most_censored',
      description: 'Get a ranked list of the most censored countries by anomaly rate.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          limit: {
            type: 'number',
            description: 'Number of countries to return (default: 10, max: 50)',
          },
        },
        required: [],
      },
    },
    {
      name: 'get_active_incidents',
      description: 'Get currently active censorship incidents worldwide including internet shutdowns, social media blocks, and VPN restrictions.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case 'get_censorship_index':
        result = await getCensorshipIndex();
        break;

      case 'get_country_status':
        if (!args?.country_code) {
          throw new Error('country_code is required');
        }
        result = await getCountryStatus(args.country_code as string);
        break;

      case 'check_domain_blocked':
        if (!args?.domain || !args?.country_code) {
          throw new Error('domain and country_code are required');
        }
        result = await checkDomainBlocked(args.domain as string, args.country_code as string);
        break;

      case 'get_most_censored':
        const limit = Math.min(Math.max(1, (args?.limit as number) || 10), 50);
        result = await getMostCensored(limit);
        break;

      case 'get_active_incidents':
        result = await getActiveIncidents();
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${message}`,
        },
      ],
      isError: true,
    };
  }
});

// Register resource handlers for direct data access
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'voidly://censorship-index',
      name: 'Global Censorship Index',
      description: 'Complete censorship index data in JSON format',
      mimeType: 'application/json',
    },
    {
      uri: 'voidly://methodology',
      name: 'Methodology',
      description: 'Data collection and scoring methodology',
      mimeType: 'application/json',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  switch (uri) {
    case 'voidly://censorship-index':
      const indexData = await fetchJson(`${VOIDLY_API}/v1/censorship-index`);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(indexData, null, 2),
          },
        ],
      };

    case 'voidly://methodology':
      const methodData = await fetchJson(`${VOIDLY_DATA_API}/methodology`);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(methodData, null, 2),
          },
        ],
      };

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Voidly MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
