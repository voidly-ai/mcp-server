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
  ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Voidly API endpoints
const VOIDLY_API = 'https://api.voidly.ai';
const VOIDLY_DATA_API = 'https://api.voidly.ai/data';

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
  NZ: 'New Zealand', HK: 'Hong Kong', TW: 'Taiwan', SG: 'Singapore' };

// MCP server version — used in User-Agent and server metadata
const MCP_VERSION = '2.9.1';

// Fetch helper with error handling and timeout
async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json' },
      signal: controller.signal });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`API request failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`);
    }

    return response.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

// Agent relay fetch helper with timeout, auth, and safe error handling
async function agentFetch(url: string, options: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const headers = {
      ...options.headers };
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    return response;
  } catch (err: any) {
    if (err.name === 'AbortError') throw new Error(`Request timed out after 30s: ${url.replace(VOIDLY_API, '')}`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// Safe JSON parse from response — handles HTML error pages from Cloudflare
async function safeJson(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 200) };
  }
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
  }>(`${VOIDLY_DATA_API}/incidents?status=active&limit=50`);

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

async function checkVpnAccessibility(countryCode?: string, provider?: string): Promise<string> {
  // Build query params
  const params = new URLSearchParams();
  if (countryCode) params.set('country', countryCode.toUpperCase());
  if (provider) params.set('provider', provider.toLowerCase());

  const data = await fetchJson<{
    query: { country?: string; provider?: string };
    stats: {
      total_probes: number;
      probe_nodes: number;
      targets_tested: number;
      total_accessible: number;
      total_blocked: number;
    };
    by_provider: Array<{
      provider: string;
      total_probes: number;
      accessible: number;
      blocked: number;
      accessibility_rate: number;
      targets: Array<{
        host: string;
        location: string;
        accessible_rate: number;
        blocked_rate: number;
        block_types: string[];
      }>;
    }>;
    updated_at: string;
  }>(`${VOIDLY_API}/v1/vpn-accessibility?${params}`);

  let result = `# VPN Accessibility Report\n\n`;
  result += `**Updated:** ${data.updated_at}\n\n`;

  if (countryCode) {
    const name = COUNTRY_NAMES[countryCode.toUpperCase()] || countryCode;
    result += `**Testing from:** ${name}\n\n`;
  }

  // Overall stats
  result += `## Summary\n`;
  result += `- Total Probes (24h): ${data.stats.total_probes.toLocaleString()}\n`;
  result += `- Probe Nodes: ${data.stats.probe_nodes}\n`;
  result += `- VPN Endpoints Tested: ${data.stats.targets_tested}\n`;
  result += `- Accessible: ${data.stats.total_accessible}\n`;
  result += `- Blocked: ${data.stats.total_blocked}\n\n`;

  // By provider
  result += `## Accessibility by Provider\n\n`;

  for (const prov of data.by_provider) {
    const accessPct = (prov.accessibility_rate * 100).toFixed(1);
    const status = prov.accessibility_rate > 0.8 ? '✅' : prov.accessibility_rate > 0.3 ? '⚠️' : '❌';

    result += `### ${status} ${prov.provider.charAt(0).toUpperCase() + prov.provider.slice(1)}\n`;
    result += `- Accessibility Rate: ${accessPct}%\n`;
    result += `- Probes: ${prov.total_probes} (${prov.accessible} accessible, ${prov.blocked} blocked)\n\n`;

    // Show blocked endpoints
    const blocked = prov.targets.filter(t => t.blocked_rate > 0.5);
    if (blocked.length > 0) {
      result += `**Blocked Endpoints:**\n`;
      for (const t of blocked.slice(0, 5)) {
        result += `- ${t.location}: ${t.block_types.join(', ') || 'blocked'}\n`;
      }
      result += '\n';
    }
  }

  result += `## Interpretation\n`;
  const overallRate = data.stats.total_accessible / Math.max(data.stats.total_accessible + data.stats.total_blocked, 1);
  if (overallRate > 0.9) {
    result += `VPN services are generally accessible. Most endpoints can be reached without interference.\n`;
  } else if (overallRate > 0.5) {
    result += `VPN services are partially blocked. Some endpoints are inaccessible, indicating selective VPN blocking.\n`;
  } else {
    result += `VPN services are heavily blocked. Most endpoints cannot be reached, indicating comprehensive VPN censorship.\n`;
  }

  result += `\n## Source\n`;
  result += `Data: Voidly Probe Network (37+ global nodes)\n`;
  result += `Unique: Only Voidly provides global VPN accessibility data\n`;
  result += `License: CC BY 4.0\n`;

  return result;
}

async function verifyClaim(claim: string, requireEvidence: boolean = false): Promise<string> {
  // Use POST for verify-claim
  const response = await agentFetch(`${VOIDLY_API}/verify-claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json' },
    body: JSON.stringify({ claim, require_evidence: requireEvidence }) });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`API request failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }

  const data = await response.json() as {
    claim: string;
    verdict: string;
    confidence: number;
    reason: string;
    parsed: {
      country: string | null;
      country_code: string | null;
      service: string | null;
      date: string | null;
      date_range: { start: string; end: string } | null;
    };
    incidents: Array<{
      id: string;
      title: string;
      type: string;
      severity: string;
      confidence: number;
      status: string;
      startTime: string;
      permalink: string;
    }>;
    evidence?: Array<{
      source: string;
      kind: string;
      permalink: string;
      observedAt: string;
      claim: string;
      confidence: number;
    }>;
    citation?: string;
  };

  let result = `# Claim Verification\n\n`;
  result += `**Claim:** "${data.claim}"\n\n`;

  // Verdict with emoji
  const verdictEmoji: Record<string, string> = {
    confirmed: '✅',
    likely: '🟡',
    unconfirmed: '❓',
    no_data: '⚪',
    insufficient_data: '⚠️' };
  result += `## Verdict: ${verdictEmoji[data.verdict] || ''} ${data.verdict.toUpperCase()}\n\n`;
  result += `**Confidence:** ${(data.confidence * 100).toFixed(0)}%\n`;
  result += `**Reason:** ${data.reason}\n\n`;

  // Parsed components
  result += `## Parsed Claim\n`;
  if (data.parsed.country) {
    result += `- Country: ${data.parsed.country} (${data.parsed.country_code})\n`;
  }
  if (data.parsed.service) {
    result += `- Service: ${data.parsed.service}\n`;
  }
  if (data.parsed.date) {
    result += `- Date: ${data.parsed.date}\n`;
  }
  if (data.parsed.date_range) {
    result += `- Date Range: ${data.parsed.date_range.start} to ${data.parsed.date_range.end}\n`;
  }
  result += '\n';

  // Matching incidents
  if (data.incidents && data.incidents.length > 0) {
    result += `## Supporting Incidents\n\n`;
    data.incidents.forEach((inc, i) => {
      result += `### ${i + 1}. ${inc.title}\n`;
      result += `- ID: ${inc.id}\n`;
      result += `- Status: ${inc.status}\n`;
      result += `- Severity: ${inc.severity}\n`;
      result += `- Confidence: ${(inc.confidence * 100).toFixed(0)}%\n`;
      result += `- Started: ${inc.startTime.slice(0, 10)}\n`;
      result += `- Permalink: ${inc.permalink}\n\n`;
    });
  }

  // Evidence if requested
  if (data.evidence && data.evidence.length > 0) {
    result += `## Evidence Chain\n\n`;
    data.evidence.forEach((ev, i) => {
      result += `${i + 1}. **${ev.source.toUpperCase()}** (${ev.kind})\n`;
      result += `   - Observed: ${ev.observedAt.slice(0, 10)}\n`;
      result += `   - Confidence: ${(ev.confidence * 100).toFixed(0)}%\n`;
      if (ev.permalink) {
        result += `   - Verify: ${ev.permalink}\n`;
      }
      result += '\n';
    });
  }

  // Citation
  if (data.citation) {
    result += `## Citation\n\n`;
    result += `${data.citation}\n\n`;
  }

  result += `## Source\n`;
  result += `Data: Voidly Research Claim Verification API\n`;
  result += `License: CC BY 4.0\n`;

  return result;
}

async function getIspStatus(countryCode: string): Promise<string> {
  const code = countryCode.toUpperCase();
  const countryName = COUNTRY_NAMES[code] || code;

  const data = await fetchJson<{
    country: string;
    generated: string;
    period: string;
    summary: {
      total_isps: number;
      critical_isps: number;
      high_isps: number;
      medium_isps: number;
      low_isps: number;
      average_block_rate: number;
    };
    isps: Array<{
      asn: string;
      name: string;
      block_rate: number;
      threat_level: string;
      measurements: number;
      blocked_count: number;
      top_blocked_domains: Array<{ domain: string; block_rate: number; measurements: number }>;
    }>;
  }>(`${VOIDLY_DATA_API}/country/${code}/isps`);

  let result = `# ISP Blocking Status: ${countryName}\n\n`;
  result += `**Period:** ${data.period}\n`;
  result += `**Generated:** ${data.generated}\n\n`;

  // Summary
  result += `## Summary\n`;
  result += `- Total ISPs monitored: ${data.summary.total_isps}\n`;
  result += `- Critical (>70% blocking): ${data.summary.critical_isps}\n`;
  result += `- High (50-70% blocking): ${data.summary.high_isps}\n`;
  result += `- Medium (30-50% blocking): ${data.summary.medium_isps}\n`;
  result += `- Low (<30% blocking): ${data.summary.low_isps}\n`;
  result += `- Average block rate: ${(data.summary.average_block_rate * 100).toFixed(1)}%\n\n`;

  // ISP breakdown
  result += `## ISP Breakdown\n\n`;

  const sortedISPs = data.isps.sort((a, b) => b.block_rate - a.block_rate);

  for (const isp of sortedISPs.slice(0, 10)) {
    const emoji = isp.threat_level === 'critical' ? '🔴' :
                  isp.threat_level === 'high' ? '🟠' :
                  isp.threat_level === 'medium' ? '🟡' : '🟢';

    result += `### ${emoji} ${isp.name} (${isp.asn})\n`;
    result += `- Block Rate: ${(isp.block_rate * 100).toFixed(1)}%\n`;
    result += `- Threat Level: ${isp.threat_level}\n`;
    result += `- Measurements: ${isp.measurements}\n`;

    if (isp.top_blocked_domains.length > 0) {
      result += `- Top Blocked: ${isp.top_blocked_domains.slice(0, 5).map(d => d.domain).join(', ')}\n`;
    }
    result += '\n';
  }

  if (data.isps.length > 10) {
    result += `\n*${data.isps.length - 10} more ISPs not shown*\n`;
  }

  result += `\n## Interpretation\n`;
  if (data.summary.critical_isps > data.summary.total_isps / 2) {
    result += `Majority of ISPs show heavy blocking - indicates nationwide censorship policy.\n`;
  } else if (data.summary.critical_isps > 0) {
    result += `Some ISPs block more than others - may indicate selective or ISP-level blocking.\n`;
  } else {
    result += `Low blocking across ISPs - country has relatively open internet.\n`;
  }

  result += `\n## Source\n`;
  result += `Data: Voidly ISP Monitoring (via OONI measurements)\n`;
  result += `Unique: ISP-level granularity for censorship analysis\n`;
  result += `License: CC BY 4.0\n`;

  return result;
}

async function getDomainStatus(domain: string): Promise<string> {
  const data = await fetchJson<{
    domain: string;
    generated: string;
    period: string;
    status: string;
    summary: {
      blocked_in_countries: number;
      total_blocking_isps: number;
    };
    blocked_in: Array<{
      country: string;
      isps: Array<{ asn: string; name: string; block_rate: number; measurements: number }>;
    }>;
  }>(`${VOIDLY_DATA_API}/domain/${encodeURIComponent(domain)}`);

  let result = `# Domain Status: ${data.domain}\n\n`;
  result += `**Period:** ${data.period}\n`;
  result += `**Generated:** ${data.generated}\n\n`;

  // Overall status
  const statusEmoji = data.status === 'blocked' ? '🚫' : '✅';
  result += `## Status: ${statusEmoji} ${data.status.toUpperCase()}\n\n`;

  result += `### Summary\n`;
  result += `- Blocked in: ${data.summary.blocked_in_countries} countries\n`;
  result += `- By ${data.summary.total_blocking_isps} ISPs total\n\n`;

  if (data.blocked_in.length === 0) {
    result += `This domain appears accessible worldwide based on recent measurements.\n`;
  } else {
    result += `## Countries Blocking This Domain\n\n`;

    for (const country of data.blocked_in.slice(0, 15)) {
      const countryName = COUNTRY_NAMES[country.country] || country.country;
      result += `### ${countryName} (${country.country})\n`;
      result += `- Blocking ISPs: ${country.isps.length}\n`;

      const topISPs = country.isps.slice(0, 3);
      if (topISPs.length > 0) {
        result += `- ISPs: ${topISPs.map(i => i.name).join(', ')}`;
        if (country.isps.length > 3) {
          result += ` (+${country.isps.length - 3} more)`;
        }
        result += '\n';
      }
      result += '\n';
    }

    if (data.blocked_in.length > 15) {
      result += `*${data.blocked_in.length - 15} more countries not shown*\n\n`;
    }
  }

  result += `## Source\n`;
  result += `Data: Voidly Domain Monitoring (via OONI + CensoredPlanet)\n`;
  result += `License: CC BY 4.0\n`;

  return result;
}

async function getDomainHistory(domain: string, days: number = 30, countryCode?: string): Promise<string> {
  const url = `${VOIDLY_DATA_API}/domain/${encodeURIComponent(domain)}/history?days=${days}${countryCode ? `&country=${countryCode}` : ''}`;

  const data = await fetchJson<{
    domain: string;
    period: string;
    currentStatus: string;
    summary: {
      totalDataPoints: number;
      countriesEverBlocked: number;
      countriesCurrentlyBlocking: number;
    };
    countriesBlocking: string[];
    timeline: Array<{
      date: string;
      countries: Record<string, { status: string; blockRate: number; measurements: number }>;
      total_measurements: number;
      total_blocked: number;
    }>;
    generated: string;
  }>(url);

  let result = `# Domain History: ${data.domain}\n\n`;
  result += `**Period:** ${data.period}\n`;
  result += `**Current Status:** ${data.currentStatus === 'blocked' ? '🚫 Blocked' : '✅ Accessible'}\n\n`;

  result += `## Summary\n`;
  result += `- Data points: ${data.summary.totalDataPoints}\n`;
  result += `- Countries ever blocked: ${data.summary.countriesEverBlocked}\n`;
  result += `- Currently blocking: ${data.summary.countriesCurrentlyBlocking}\n\n`;

  if (data.countriesBlocking.length > 0) {
    result += `## Countries That Have Blocked This Domain\n`;
    result += data.countriesBlocking.map(c => `- ${COUNTRY_NAMES[c] || c} (${c})`).join('\n');
    result += '\n\n';
  }

  if (data.timeline.length > 0) {
    result += `## Recent Timeline (Last ${Math.min(7, data.timeline.length)} Days)\n\n`;

    for (const day of data.timeline.slice(0, 7)) {
      const countries = Object.entries(day.countries);
      const blocked = countries.filter(([_, c]) => c.status === 'blocked');
      const accessible = countries.filter(([_, c]) => c.status === 'accessible');

      result += `### ${day.date}\n`;
      result += `- Total measurements: ${day.total_measurements}\n`;
      if (blocked.length > 0) {
        result += `- 🚫 Blocked in: ${blocked.map(([code, _]) => COUNTRY_NAMES[code] || code).join(', ')}\n`;
      }
      if (accessible.length > 0) {
        result += `- ✅ Accessible in: ${accessible.slice(0, 5).map(([code, _]) => COUNTRY_NAMES[code] || code).join(', ')}`;
        if (accessible.length > 5) result += ` (+${accessible.length - 5} more)`;
        result += '\n';
      }
      result += '\n';
    }
  }

  result += `## Source\n`;
  result += `Data: Voidly Historical Evidence Database\n`;
  result += `License: CC BY 4.0\n`;

  return result;
}

async function getRiskForecast(countryCode: string): Promise<string> {
  const code = countryCode.toUpperCase();
  const countryName = COUNTRY_NAMES[code] || code;

  const data = await fetchJson<{
    country: string;
    country_name: string;
    forecast: Array<{
      day: number;
      date: string;
      risk: number;
      drivers: string[];
    }>;
    summary: {
      max_risk: number;
      max_risk_day: number;
      avg_risk: number;
      key_drivers: string[];
    };
    confidence: number;
    model_version: string;
    generated_at: string;
  }>(`${VOIDLY_API}/v1/forecast/${code}/7day`);

  let result = `# 7-Day Risk Forecast: ${countryName}\n\n`;
  result += `**Generated:** ${data.generated_at}\n`;
  result += `**Model Confidence:** ${(data.confidence * 100).toFixed(0)}%\n\n`;

  // Summary
  result += `## Summary\n`;
  result += `- Peak Risk: ${(data.summary.max_risk * 100).toFixed(1)}% (Day ${data.summary.max_risk_day})\n`;
  result += `- Average Risk: ${(data.summary.avg_risk * 100).toFixed(1)}%\n`;

  if (data.summary.key_drivers.length > 0) {
    result += `- Risk Drivers: ${data.summary.key_drivers.join(', ')}\n`;
  }
  result += '\n';

  // Daily forecast
  result += `## Daily Forecast\n\n`;
  result += `| Day | Date | Risk | Drivers |\n`;
  result += `|-----|------|------|--------|\n`;

  for (const day of data.forecast) {
    const riskEmoji = day.risk >= 0.5 ? '🔴' : day.risk >= 0.3 ? '🟠' : day.risk >= 0.15 ? '🟡' : '🟢';
    const drivers = day.drivers.length > 0 ? day.drivers.join(', ') : '-';
    result += `| ${day.day === 0 ? 'Today' : `+${day.day}`} | ${day.date} | ${riskEmoji} ${(day.risk * 100).toFixed(1)}% | ${drivers} |\n`;
  }

  // Interpretation
  result += `\n## Risk Interpretation\n`;
  if (data.summary.max_risk >= 0.5) {
    result += `⚠️ **CRITICAL RISK**: High probability of censorship events in the next 7 days. `;
    if (data.summary.key_drivers.length > 0) {
      result += `Key drivers: ${data.summary.key_drivers.join(', ')}.`;
    }
    result += '\n';
  } else if (data.summary.max_risk >= 0.3) {
    result += `⚡ **ELEVATED RISK**: Moderate probability of censorship activity. Monitor closely.\n`;
  } else if (data.summary.max_risk >= 0.15) {
    result += `📊 **NORMAL RISK**: Typical censorship levels expected for this country.\n`;
  } else {
    result += `✅ **LOW RISK**: Below-average censorship activity expected.\n`;
  }

  result += `\n## Source\n`;
  result += `Data: Voidly Predictive Risk Model (${data.model_version})\n`;
  result += `Trained on: Historical shutdowns, election calendars, protest patterns\n`;
  result += `License: CC BY 4.0\n`;

  return result;
}

async function getHighRiskCountries(threshold: number = 0.2): Promise<string> {
  const data = await fetchJson<{
    high_risk_countries: Array<{
      country: string;
      country_name: string;
      max_risk: number;
      max_risk_day: number;
      drivers: string[];
    }>;
    count: number;
    threshold: number;
    generated_at: string;
  }>(`${VOIDLY_API}/v1/forecast/high-risk?threshold=${threshold}`);

  let result = `# High-Risk Countries (7-Day Forecast)\n\n`;
  result += `**Threshold:** ${(data.threshold * 100).toFixed(0)}%+ risk\n`;
  result += `**Countries at Risk:** ${data.count}\n`;
  result += `**Generated:** ${data.generated_at}\n\n`;

  if (data.high_risk_countries.length === 0) {
    result += `No countries currently exceed the ${(threshold * 100).toFixed(0)}% risk threshold.\n`;
  } else {
    result += `## Countries at Elevated Risk\n\n`;

    for (const country of data.high_risk_countries.slice(0, 15)) {
      const riskEmoji = country.max_risk >= 0.5 ? '🔴' : country.max_risk >= 0.3 ? '🟠' : '🟡';

      result += `### ${riskEmoji} ${country.country_name} (${country.country})\n`;
      result += `- Peak Risk: ${(country.max_risk * 100).toFixed(1)}%\n`;
      result += `- Peak Day: +${country.max_risk_day} days\n`;
      if (country.drivers.length > 0) {
        result += `- Drivers: ${country.drivers.join(', ')}\n`;
      }
      result += '\n';
    }

    if (data.high_risk_countries.length > 15) {
      result += `*${data.high_risk_countries.length - 15} more countries not shown*\n\n`;
    }
  }

  result += `## Source\n`;
  result += `Data: Voidly Predictive Risk Model\n`;
  result += `Features: Election calendars, protest anniversaries, historical patterns\n`;
  result += `License: CC BY 4.0\n`;

  return result;
}

async function compareCountries(country1: string, country2: string): Promise<string> {
  // Fetch both country statuses
  const [status1, status2] = await Promise.all([
    fetchJson<any>(`${VOIDLY_DATA_API}/country/${country1.toUpperCase()}`),
    fetchJson<any>(`${VOIDLY_DATA_API}/country/${country2.toUpperCase()}`),
  ]);

  const name1 = COUNTRY_NAMES[country1.toUpperCase()] || country1;
  const name2 = COUNTRY_NAMES[country2.toUpperCase()] || country2;

  let result = `# Censorship Comparison: ${name1} vs ${name2}\n\n`;

  // Risk levels
  const getRiskEmoji = (score: number) => {
    if (score >= 0.8) return '🔴 Critical';
    if (score >= 0.6) return '🟠 High';
    if (score >= 0.4) return '🟡 Medium';
    if (score >= 0.2) return '🟢 Low';
    return '⚪ Minimal';
  };

  result += `## Risk Levels\n\n`;
  result += `| Country | Score | Risk Level |\n`;
  result += `|---------|-------|------------|\n`;
  result += `| ${name1} | ${(status1.score || 0).toFixed(2)} | ${getRiskEmoji(status1.score || 0)} |\n`;
  result += `| ${name2} | ${(status2.score || 0).toFixed(2)} | ${getRiskEmoji(status2.score || 0)} |\n\n`;

  // Measurement coverage
  result += `## Data Coverage\n\n`;
  result += `| Country | Measurements | Anomaly Rate |\n`;
  result += `|---------|--------------|---------------|\n`;
  result += `| ${name1} | ${(status1.ooni?.measurementCount || 0).toLocaleString()} | ${((status1.ooni?.anomalyRate || 0) * 100).toFixed(1)}% |\n`;
  result += `| ${name2} | ${(status2.ooni?.measurementCount || 0).toLocaleString()} | ${((status2.ooni?.anomalyRate || 0) * 100).toFixed(1)}% |\n\n`;

  // Comparison summary
  const scoreDiff = Math.abs((status1.score || 0) - (status2.score || 0));
  const moreRestrictive = (status1.score || 0) > (status2.score || 0) ? name1 : name2;

  result += `## Comparison Summary\n\n`;
  if (scoreDiff < 0.1) {
    result += `Both countries have similar censorship levels.\n`;
  } else if (scoreDiff < 0.3) {
    result += `${moreRestrictive} is somewhat more restrictive.\n`;
  } else {
    result += `${moreRestrictive} has significantly higher censorship levels.\n`;
  }

  result += `\n## Source\n`;
  result += `Data: Voidly Global Censorship Index\n`;
  result += `License: CC BY 4.0\n`;

  return result;
}

async function getPlatformRisk(platform: string, countryCode?: string): Promise<string> {
  const p = platform.toLowerCase();
  let data: any;

  if (countryCode) {
    data = await fetchJson<any>(`${VOIDLY_API}/v1/platform/${p}/risk/${countryCode.toUpperCase()}`);
  } else {
    data = await fetchJson<any>(`${VOIDLY_API}/v1/platform/${p}/risk`);
  }

  let result = `# Platform Risk: ${data.label || platform}\n\n`;

  if (countryCode && data.country) {
    result += `**Country:** ${data.countryName}\n`;
    result += `**Risk Score:** ${(data.score * 100).toFixed(1)}%\n`;
    result += `**Block Rate:** ${(data.blockRate * 100).toFixed(1)}%\n`;
    result += `**Methods:** ${data.methods?.join(', ') || 'none detected'}\n`;
    result += `**Evidence:** ${data.evidenceCount} measurements\n`;
  } else {
    result += `**Global Score:** ${((data.globalScore || 0) * 100).toFixed(1)}%\n`;
    result += `**Countries Blocking:** ${data.countriesBlocking || 0}\n\n`;

    if (data.blockedIn && data.blockedIn.length > 0) {
      result += `## Top Countries Blocking ${data.label}\n\n`;
      result += `| Country | Score | Block Rate | Methods |\n`;
      result += `|---------|-------|------------|--------|\n`;
      for (const c of data.blockedIn.slice(0, 15)) {
        result += `| ${c.countryName} | ${(c.score * 100).toFixed(0)}% | ${(c.blockRate * 100).toFixed(0)}% | ${c.methods?.join(', ') || '-'} |\n`;
      }
    }
  }

  result += `\n## Source\nData: Voidly Platform Risk Index\nLicense: CC BY 4.0\n`;
  return result;
}

async function getIspRiskIndex(countryCode: string): Promise<string> {
  const cc = countryCode.toUpperCase();
  const data = await fetchJson<any>(`${VOIDLY_API}/v1/isp/index?country=${cc}`);

  let result = `# ISP Risk Index: ${data.countryName || cc}\n\n`;
  result += `**ISPs Analyzed:** ${data.ispCount || 0}\n\n`;

  if (data.isps && data.isps.length > 0) {
    result += `## ISP Rankings\n\n`;
    result += `| Rank | ISP | Score | Block Rate | Methods | Categories |\n`;
    result += `|------|-----|-------|------------|---------|------------|\n`;
    data.isps.slice(0, 20).forEach((isp: any, i: number) => {
      result += `| ${i + 1} | ${isp.name || `AS${isp.asn}`} | ${isp.compositeScore?.toFixed(1)} | ${(isp.blockRate * 100).toFixed(0)}% | ${isp.methods?.slice(0, 2).join(', ') || '-'} | ${isp.blockedCategories?.slice(0, 3).join(', ') || '-'} |\n`;
    });
  } else {
    result += `No ISP censorship data available for ${cc}.\n`;
  }

  result += `\n## Source\nData: Voidly ISP Risk Index\nLicense: CC BY 4.0\n`;
  return result;
}

async function checkServiceAccessibility(domain: string, countryCode: string): Promise<string> {
  const cc = countryCode.toUpperCase();
  const data = await fetchJson<any>(`${VOIDLY_API}/v1/accessibility/check?domain=${encodeURIComponent(domain)}&country=${cc}`);

  const statusEmoji = data.status === 'accessible' ? '✅' : data.status === 'blocked' ? '🚫' : data.status === 'partially_blocked' ? '⚠️' : '❓';

  let result = `# Service Accessibility: ${domain} in ${data.countryName || cc}\n\n`;
  result += `**Status:** ${statusEmoji} ${data.status?.toUpperCase()}\n`;
  if (data.accessibilityScore !== null) {
    result += `**Accessibility Score:** ${(data.accessibilityScore * 100).toFixed(0)}%\n`;
  }
  if (data.blockingMethod) {
    result += `**Blocking Method:** ${data.blockingMethod}\n`;
  }
  result += `**Confidence:** ${((data.confidence || 0) * 100).toFixed(0)}%\n`;
  result += `**Evidence:** ${data.evidenceCount || 0} measurements\n`;
  result += `**Checked:** ${data.checkedAt}\n`;

  result += `\n## Source\nData: Voidly Service Accessibility API\nLicense: CC BY 4.0\n`;
  return result;
}

async function getElectionRisk(countryCode: string): Promise<string> {
  const cc = countryCode.toUpperCase();
  const data = await fetchJson<any>(`${VOIDLY_API}/v1/elections/${cc}/briefing`);

  let result = `# Election Risk Briefing: ${data.countryName || cc}\n\n`;

  // Risk assessment
  const riskEmoji = data.riskAssessment?.level === 'critical' ? '🔴' : data.riskAssessment?.level === 'elevated' ? '🟠' : '🟢';
  result += `**Risk Level:** ${riskEmoji} ${data.riskAssessment?.level?.toUpperCase() || 'UNKNOWN'}\n`;
  result += `**Risk Tier:** ${data.riskTier || 0}/4\n\n`;

  // Upcoming elections
  if (data.upcomingElections && data.upcomingElections.length > 0) {
    result += `## Upcoming Elections\n\n`;
    for (const e of data.upcomingElections) {
      result += `- **${e.title || e.type}** on ${e.date} (importance: ${e.importance})\n`;
    }
    result += '\n';
  } else {
    result += `No upcoming elections found for ${cc} in the next 180 days.\n\n`;
  }

  // Historical pattern
  if (data.historicalPattern) {
    const hp = data.historicalPattern;
    result += `## Historical Election Pattern\n\n`;
    result += `- Past elections tracked: ${hp.past_elections}\n`;
    result += `- Incidents around elections: ${hp.incidents_around_elections}\n`;
    result += `- Avg incidents per election: ${hp.avg_incidents_per_election}\n`;
    result += `- Historical risk: ${hp.historical_risk}\n\n`;
  }

  // Risk factors
  if (data.riskAssessment?.factors && data.riskAssessment.factors.length > 0) {
    result += `## Risk Factors\n\n`;
    for (const f of data.riskAssessment.factors) {
      result += `- ${f}\n`;
    }
    result += '\n';
  }

  // 7-day forecast summary
  if (data.forecastSummary) {
    result += `## 7-Day Forecast\n\n`;
    result += `- Peak risk: ${(data.forecastSummary.max_risk * 100).toFixed(1)}% (day ${data.forecastSummary.max_risk_day})\n`;
    result += `- Average risk: ${(data.forecastSummary.avg_risk * 100).toFixed(1)}%\n`;
    if (data.forecastSummary.key_drivers?.length > 0) {
      result += `- Drivers: ${data.forecastSummary.key_drivers.join(', ')}\n`;
    }
  }

  result += `\n## Source\nData: Voidly Election Risk Model\nLicense: CC BY 4.0\n`;
  return result;
}

async function getProbeNetwork(): Promise<string> {
  const data = await fetchJson<{
    active_nodes: number;
    total_nodes: number;
    coverage_regions: string[];
    probes_24h: number;
    nodes: Array<{
      id: string;
      city: string;
      country: string;
      status: string;
      avg_latency_ms: number;
    }>;
  }>(`${VOIDLY_API}/v1/probe/network`);

  let result = `# Voidly Probe Network Status\n\n`;
  result += `**Active Nodes:** ${data.active_nodes} / ${data.total_nodes}\n`;
  result += `**Coverage Regions:** ${data.coverage_regions.join(', ')}\n`;
  result += `**Probes (24h):** ${data.probes_24h.toLocaleString()}\n\n`;

  result += `## Node Status\n\n`;
  result += `| Node | City | Country | Status | Avg Latency |\n`;
  result += `|------|------|---------|--------|-------------|\n`;

  for (const node of data.nodes) {
    const statusEmoji = node.status === 'active' ? '🟢' : node.status === 'degraded' ? '🟡' : '🔴';
    result += `| ${node.id} | ${node.city} | ${node.country} | ${statusEmoji} ${node.status} | ${node.avg_latency_ms}ms |\n`;
  }

  result += `\n## Source\n`;
  result += `Data: Voidly Probe Network (37+ global nodes)\n`;
  result += `License: CC BY 4.0\n`;

  return result;
}

async function checkDomainProbes(domain: string): Promise<string> {
  const data = await fetchJson<{
    domain: string;
    total_probes_24h: number;
    blocked_count: number;
    nodes: Array<{
      node_id: string;
      country: string;
      status: string;
      latency_ms: number;
      blocking_method: string | null;
      blocking_entity: string | null;
      sni_blocked: boolean;
      dns_poisoned: boolean;
      blocking_type: string;
    }>;
    attribution: {
      methods_seen: string[];
      entities_detected: string[];
      geographic_consensus: string;
      sni_detected: number;
      dns_poisoning_detected: number;
      cert_anomalies: boolean;
      blocking_types: string[];
    };
  }>(`${VOIDLY_API}/v1/probe/domain/${encodeURIComponent(domain)}`);

  let result = `# Probe Results: ${data.domain}\n\n`;
  result += `**Total Probes (24h):** ${data.total_probes_24h}\n`;
  result += `**Blocked:** ${data.blocked_count}\n\n`;

  result += `## Per-Node Breakdown\n\n`;
  result += `| Node | Country | Status | Latency | Blocking Method | Entity | SNI Blocked | DNS Poisoned | Blocking Type |\n`;
  result += `|------|---------|--------|---------|-----------------|--------|-------------|--------------|---------------|\n`;

  for (const node of data.nodes) {
    const statusEmoji = node.status === 'accessible' ? '✅' : node.status === 'blocked' ? '🚫' : '⚠️';
    result += `| ${node.node_id} | ${node.country} | ${statusEmoji} ${node.status} | ${node.latency_ms}ms | ${node.blocking_method || '-'} | ${node.blocking_entity || '-'} | ${node.sni_blocked ? 'Yes' : 'No'} | ${node.dns_poisoned ? 'Yes' : 'No'} | ${node.blocking_type || '-'} |\n`;
  }

  result += `\n## Attribution Summary\n\n`;
  if (data.attribution.methods_seen.length > 0) {
    result += `- **Methods Seen:** ${data.attribution.methods_seen.join(', ')}\n`;
  }
  if (data.attribution.entities_detected.length > 0) {
    result += `- **Entities Detected:** ${data.attribution.entities_detected.join(', ')}\n`;
  }
  result += `- **Geographic Consensus:** ${data.attribution.geographic_consensus}\n`;
  result += `- **SNI Blocking Detected:** ${data.attribution.sni_detected} nodes\n`;
  result += `- **DNS Poisoning Detected:** ${data.attribution.dns_poisoning_detected} nodes\n`;
  result += `- **Cert Anomalies:** ${data.attribution.cert_anomalies ? 'Yes' : 'No'}\n`;
  if (data.attribution.blocking_types.length > 0) {
    result += `- **Blocking Types:** ${data.attribution.blocking_types.join(', ')}\n`;
  }

  result += `\n## Source\n`;
  result += `Data: Voidly Probe Network (37+ global nodes)\n`;
  result += `License: CC BY 4.0\n`;

  return result;
}


async function getIncidentDetail(incidentId: string): Promise<string> {
  const data = await fetchJson<{
    id: string;
    hashId: string;
    country: string;
    countryName: string;
    title: string;
    description: string;
    severity: string;
    incidentType: string;
    confidence: number;
    domains: string[];
    blockingMethods: string[];
    evidenceCount: number;
    createdAt: string;
    updatedAt: string;
  }>(`${VOIDLY_DATA_API}/incidents/${encodeURIComponent(incidentId)}`);

  let result = `# Incident: ${data.title}\n\n`;
  result += `**ID:** ${data.hashId} (${data.id})\n`;
  result += `**Country:** ${data.countryName} (${data.country})\n`;
  result += `**Severity:** ${data.severity.toUpperCase()}\n`;
  result += `**Type:** ${data.incidentType}\n`;
  result += `**Confidence:** ${(data.confidence * 100).toFixed(0)}%\n`;
  result += `**Created:** ${data.createdAt}\n`;
  result += `**Updated:** ${data.updatedAt}\n\n`;

  if (data.description) {
    result += `## Description\n${data.description}\n\n`;
  }

  if (data.domains && data.domains.length > 0) {
    result += `## Affected Domains\n`;
    data.domains.forEach(d => { result += `- ${d}\n`; });
    result += '\n';
  }

  if (data.blockingMethods && data.blockingMethods.length > 0) {
    result += `## Blocking Methods\n`;
    data.blockingMethods.forEach(m => { result += `- ${m}\n`; });
    result += '\n';
  }

  result += `**Evidence Items:** ${data.evidenceCount}\n`;
  result += `**Report:** https://voidly.ai/censorship-index/incidents/${data.hashId}\n\n`;
  result += `## Source\nData: Voidly Incident Database\nLicense: CC BY 4.0\n`;

  return result;
}

async function getIncidentEvidence(incidentId: string): Promise<string> {
  const data = await fetchJson<{
    incidentId: string;
    evidenceCount: number;
    evidence: Array<{
      source: string;
      kind: string;
      permalink: string;
      observedAt: string;
      confidence: number;
    }>;
  }>(`${VOIDLY_DATA_API}/incidents/${encodeURIComponent(incidentId)}/evidence`);

  let result = `# Evidence for Incident: ${data.incidentId}\n\n`;
  result += `**Total Evidence Items:** ${data.evidenceCount}\n\n`;

  if (data.evidence.length === 0) {
    result += `No evidence items found for this incident.\n`;
  } else {
    const bySource: Record<string, typeof data.evidence> = {};
    data.evidence.forEach(e => {
      const src = e.source.toUpperCase();
      if (!bySource[src]) bySource[src] = [];
      bySource[src].push(e);
    });

    for (const [source, items] of Object.entries(bySource)) {
      result += `## ${source} (${items.length} items)\n\n`;
      items.slice(0, 10).forEach((e, i) => {
        result += `${i + 1}. **${e.kind}** — ${e.observedAt.slice(0, 10)}\n`;
        result += `   Confidence: ${(e.confidence * 100).toFixed(0)}%\n`;
        if (e.permalink) {
          result += `   Verify: ${e.permalink}\n`;
        }
        result += '\n';
      });
      if (items.length > 10) {
        result += `*${items.length - 10} more ${source} items not shown*\n\n`;
      }
    }
  }

  result += `## Source\nData: Voidly Evidence Database (OONI, IODA, CensoredPlanet)\nLicense: CC BY 4.0\n`;
  return result;
}

async function getIncidentReport(incidentId: string, format: string = 'markdown'): Promise<string> {
  const response = await agentFetch(
    `${VOIDLY_DATA_API}/incidents/${encodeURIComponent(incidentId)}/report?format=${format}`,
    {
      headers: {
        'Accept': format === 'markdown' ? 'text/markdown' : 'text/plain' } }
  );

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();

  let result = `# Incident Report (${format.toUpperCase()})\n\n`;
  result += `\`\`\`${format === 'bibtex' ? 'bibtex' : format === 'ris' ? '' : 'markdown'}\n`;
  result += text;
  result += `\n\`\`\`\n\n`;
  result += `## Source\nData: Voidly Incident Reports\nLicense: CC BY 4.0\n`;

  return result;
}

async function getCommunityProbes(): Promise<string> {
  const data = await fetchJson<{
    total: number;
    nodes: Array<{
      id: string;
      country: string;
      city: string;
      trustScore: number;
      totalProbes: number;
      blockedConfirmed: number;
      lastSeen: string;
      status: string;
    }>;
  }>(`${VOIDLY_API}/v1/community/nodes?limit=50`);

  let result = `# Community Probe Network\n\n`;
  result += `**Total Nodes:** ${data.total}\n\n`;

  if (data.nodes.length === 0) {
    result += `No community probe nodes currently active.\n`;
    result += `\nRun your own: \`pip install voidly-probe && voidly-probe --consent\`\n`;
  } else {
    result += `## Active Nodes\n\n`;
    result += `| Node | Location | Trust | Probes | Confirmed | Status |\n`;
    result += `|------|----------|-------|--------|-----------|--------|\n`;

    for (const node of data.nodes) {
      const countryName = COUNTRY_NAMES[node.country] || node.country;
      const statusEmoji = node.status === 'active' ? '🟢' : '🔴';
      result += `| ${node.id} | ${node.city}, ${countryName} | ${node.trustScore.toFixed(2)} | ${node.totalProbes} | ${node.blockedConfirmed} | ${statusEmoji} ${node.status} |\n`;
    }
  }

  result += `\n## Join the Network\n`;
  result += `- Install: \`pip install voidly-probe\`\n`;
  result += `- Docker: \`docker run -d emperormew2/voidly-probe\`\n`;
  result += `- PyPI: https://pypi.org/project/voidly-probe/\n`;
  result += `\n## Source\nData: Voidly Community Probe Network\nLicense: CC BY 4.0\n`;

  return result;
}

async function getCommunityLeaderboard(): Promise<string> {
  const data = await fetchJson<{
    leaderboard: Array<{
      rank: number;
      nodeId: string;
      country: string;
      totalProbes: number;
      blockedConfirmed: number;
      trustScore: number;
    }>;
  }>(`${VOIDLY_API}/v1/community/leaderboard`);

  let result = `# Community Probe Leaderboard\n\n`;

  if (!data.leaderboard || data.leaderboard.length === 0) {
    result += `No community probes have submitted data yet.\n`;
    result += `Be the first: \`pip install voidly-probe && voidly-probe --consent\`\n`;
  } else {
    result += `## Top Contributors\n\n`;
    result += `| Rank | Node | Country | Probes | Confirmed | Trust |\n`;
    result += `|------|------|---------|--------|-----------|-------|\n`;

    for (const entry of data.leaderboard.slice(0, 20)) {
      const countryName = COUNTRY_NAMES[entry.country] || entry.country;
      result += `| ${entry.rank} | ${entry.nodeId} | ${countryName} | ${entry.totalProbes} | ${entry.blockedConfirmed} | ${entry.trustScore.toFixed(2)} |\n`;
    }
  }

  result += `\n## Source\nData: Voidly Community Probe Network\nLicense: CC BY 4.0\n`;
  return result;
}

async function getIncidentStats(): Promise<string> {
  const data = await fetchJson<{
    totalIncidents: number;
    totalEvidence: number;
    bySeverity: Record<string, number>;
    byCountry: Record<string, number>;
    bySource?: Record<string, number>;
  }>(`${VOIDLY_DATA_API}/incidents/stats`);

  let result = `# Incident Statistics\n\n`;
  result += `**Total Incidents:** ${data.totalIncidents.toLocaleString()}\n`;
  result += `**Total Evidence:** ${data.totalEvidence.toLocaleString()}\n\n`;

  result += `## By Severity\n`;
  for (const [sev, count] of Object.entries(data.bySeverity)) {
    result += `- ${sev.charAt(0).toUpperCase() + sev.slice(1)}: ${count}\n`;
  }
  result += '\n';

  if (data.bySource) {
    result += `## By Evidence Source\n`;
    for (const [src, count] of Object.entries(data.bySource)) {
      result += `- ${src.toUpperCase()}: ${count.toLocaleString()}\n`;
    }
    result += '\n';
  }

  const topCountries = Object.entries(data.byCountry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  result += `## Top 10 Countries by Incidents\n`;
  topCountries.forEach(([code, count], i) => {
    const name = COUNTRY_NAMES[code] || code;
    result += `${i + 1}. ${name} (${code}): ${count}\n`;
  });

  result += `\n## Source\nData: Voidly Incident Database\nLicense: CC BY 4.0\n`;
  return result;
}

async function getAlertStats(): Promise<string> {
  const data = await fetchJson<{
    activeSubscriptions: number;
    totalDeliveries24h: number;
    webhookSuccessRate: number;
    countriesMonitored: number;
  }>(`${VOIDLY_API}/api/alerts/stats`);

  let result = `# Alert System Statistics\n\n`;
  result += `**Active Subscriptions:** ${data.activeSubscriptions}\n`;
  result += `**Deliveries (24h):** ${data.totalDeliveries24h}\n`;
  result += `**Webhook Success Rate:** ${(data.webhookSuccessRate * 100).toFixed(1)}%\n`;
  result += `**Countries Monitored:** ${data.countriesMonitored}\n\n`;

  result += `## Subscribe\n`;
  result += `Set up webhook alerts at: https://voidly.ai/api-docs#alerts-webhooks\n\n`;

  result += `## Source\nData: Voidly Alert System\nLicense: CC BY 4.0\n`;
  return result;
}

async function getIncidentsSince(since: string): Promise<string> {
  const data = await fetchJson<{
    since: string;
    count: number;
    incidents: Array<{
      id: string;
      hashId: string;
      country: string;
      countryName: string;
      title: string;
      severity: string;
      confidence: number;
      createdAt: string;
    }>;
  }>(`${VOIDLY_DATA_API}/incidents/delta?since=${encodeURIComponent(since)}`);

  let result = `# Incidents Since ${data.since}\n\n`;
  result += `**New/Updated:** ${data.count} incidents\n\n`;

  if (data.incidents.length === 0) {
    result += `No new incidents since the specified timestamp.\n`;
  } else {
    for (const inc of data.incidents.slice(0, 20)) {
      const sevEmoji = inc.severity === 'critical' ? '🔴' : inc.severity === 'high' ? '🟠' : inc.severity === 'medium' ? '🟡' : '🟢';
      result += `## ${sevEmoji} ${inc.countryName}: ${inc.title}\n`;
      result += `- ID: ${inc.hashId}\n`;
      result += `- Severity: ${inc.severity}\n`;
      result += `- Confidence: ${(inc.confidence * 100).toFixed(0)}%\n`;
      result += `- Created: ${inc.createdAt}\n\n`;
    }

    if (data.incidents.length > 20) {
      result += `*${data.incidents.length - 20} more incidents not shown*\n\n`;
    }
  }

  result += `## Source\nData: Voidly Incident Delta Feed\nLicense: CC BY 4.0\n`;
  return result;
}

async function agentRegister(name?: string, capabilities?: string[]): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json'},
    body: JSON.stringify({ name, capabilities }) });
  if (!response.ok) throw new Error(`Registration failed: ${response.status}`);
  const data = await response.json() as any;
  let result = `# Agent Registered Successfully\n\n`;
  result += `**DID:** \`${data.did}\`\n`;
  result += `**API Key:** \`${data.api_key}\`\n\n`;
  result += `> **IMPORTANT:** Save your API key securely. It cannot be retrieved later.\n\n`;
  result += `## Your Public Keys\n`;
  result += `- **Signing (Ed25519):** \`${data.signing_public_key}\`\n`;
  result += `- **Encryption (X25519):** \`${data.encryption_public_key}\`\n\n`;
  result += `## Next Steps\n`;
  result += `1. Use \`agent_discover\` to find other agents\n`;
  result += `2. Use \`agent_send_message\` to send encrypted messages\n`;
  result += `3. Use \`agent_receive_messages\` to check your inbox\n`;
  return result;
}

async function agentSendMessage(apiKey: string, toDid: string, message: string, threadId?: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': apiKey},
    body: JSON.stringify({ to: toDid, message, thread_id: threadId }) });
  if (!response.ok) {
    const err = await safeJson(response);
    throw new Error(err.error || `Send failed: ${response.status}`);
  }
  const data = await response.json() as any;
  let result = `# Message Sent (E2E Encrypted)\n\n`;
  result += `- **Message ID:** \`${data.id}\`\n`;
  result += `- **To:** \`${data.to}\`\n`;
  result += `- **Timestamp:** ${data.timestamp}\n`;
  result += `- **Expires:** ${data.expires_at}\n`;
  result += `- **Encrypted:** Yes (X25519-XSalsa20-Poly1305)\n`;
  result += `- **Signed:** Yes (Ed25519)\n`;
  return result;
}

async function agentReceiveMessages(apiKey: string, since?: string, limit?: number): Promise<string> {
  const params = new URLSearchParams();
  if (since) params.set('since', since);
  if (limit) params.set('limit', String(limit));
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/receive?${params}`, {
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) throw new Error(`Receive failed: ${response.status}`);
  const data = await response.json() as any;
  if (!data.messages?.length) return `# Inbox Empty\n\nNo new messages.`;
  let result = `# Inbox (${data.count} message${data.count !== 1 ? 's' : ''})\n\n`;
  for (const msg of data.messages) {
    result += `---\n`;
    result += `**From:** \`${msg.from}\`\n`;
    result += `**Time:** ${msg.timestamp}\n`;
    if (msg.thread_id) result += `**Thread:** \`${msg.thread_id}\`\n`;
    result += `**Content:**\n\n${msg.content}\n\n`;
  }
  if (data.has_more) result += `\n*More messages available. Use \`since\` parameter to paginate.*\n`;
  return result;
}

async function agentDiscover(query?: string, capability?: string, limit?: number): Promise<string> {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (capability) params.set('capability', capability);
  if (limit) params.set('limit', String(limit));
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/discover?${params}`, {
    headers: {} });
  if (!response.ok) throw new Error(`Discovery failed: ${response.status}`);
  const data = await response.json() as any;
  if (!data.agents?.length) return `# No Agents Found\n\nNo agents match your search criteria.`;
  let result = `# Agent Directory (${data.count} found)\n\n`;
  for (const agent of data.agents) {
    result += `### ${agent.name || 'Unnamed Agent'}\n`;
    result += `- **DID:** \`${agent.did}\`\n`;
    result += `- **Encryption Key:** \`${agent.encryption_public_key}\`\n`;
    if (agent.capabilities?.length) result += `- **Capabilities:** ${agent.capabilities.join(', ')}\n`;
    result += `- **Last Seen:** ${agent.last_seen}\n`;
    result += `- **Messages:** ${agent.message_count}\n\n`;
  }
  return result;
}

async function agentGetIdentity(did: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/identity/${did}`, {
    headers: {} });
  if (!response.ok) throw new Error(`Identity lookup failed: ${response.status}`);
  const data = await response.json() as any;
  let result = `# Agent Identity\n\n`;
  result += `- **DID:** \`${data.did}\`\n`;
  result += `- **Name:** ${data.name || 'Unnamed'}\n`;
  result += `- **Status:** ${data.status}\n`;
  result += `- **Signing Key (Ed25519):** \`${data.signing_public_key}\`\n`;
  result += `- **Encryption Key (X25519):** \`${data.encryption_public_key}\`\n`;
  if (data.capabilities?.length) result += `- **Capabilities:** ${data.capabilities.join(', ')}\n`;
  result += `- **Created:** ${data.created_at}\n`;
  result += `- **Last Seen:** ${data.last_seen}\n`;
  result += `- **Messages Sent:** ${data.message_count}\n`;
  return result;
}

async function agentVerifyMessage(envelope: string, signature: string, senderDid: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json'},
    body: JSON.stringify({ envelope, signature, sender_did: senderDid }) });
  if (!response.ok) throw new Error(`Verification failed: ${response.status}`);
  const data = await response.json() as any;
  return `# Signature Verification\n\n- **Valid:** ${data.valid ? 'Yes ✓' : 'No ✗'}\n- **Sender:** \`${data.sender_did}\`\n- **Verified At:** ${data.verified_at}\n`;
}

async function agentRelayStats(): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/stats`, {
    headers: {} });
  if (!response.ok) throw new Error(`Stats failed: ${response.status}`);
  const data = await response.json() as any;
  let result = `# Voidly Agent Relay Stats\n\n`;
  result += `## Protocol\n`;
  result += `- **Version:** ${data.relay.version}\n`;
  result += `- **Encryption:** ${data.relay.encryption}\n`;
  result += `- **Signing:** ${data.relay.signing}\n`;
  result += `- **Identity:** ${data.relay.identity}\n\n`;
  result += `## Network\n`;
  result += `- **Total Agents:** ${data.stats.total_agents}\n`;
  result += `- **Active (24h):** ${data.stats.active_agents_24h}\n`;
  result += `- **Messages Relayed:** ${data.stats.total_messages}\n`;
  if (data.stats.capabilities?.length) {
    result += `\n## Capabilities\n${data.stats.capabilities.map((c: string) => `- ${c}`).join('\n')}\n`;
  }
  return result;
}

async function agentDeleteMessage(apiKey: string, messageId: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/messages/${messageId}`, {
    method: 'DELETE',
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) throw new Error(`Delete failed: ${response.status}`);
  return `Message \`${messageId}\` deleted successfully.`;
}

async function agentGetProfile(apiKey: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/profile`, {
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) throw new Error(`Profile fetch failed: ${response.status}`);
  const data = await response.json() as any;
  let result = `# Agent Profile\n\n`;
  result += `- **DID:** \`${data.did}\`\n`;
  result += `- **Name:** ${data.name || 'Unnamed'}\n`;
  result += `- **Status:** ${data.status}\n`;
  result += `- **Messages:** ${data.message_count}\n`;
  if (data.capabilities?.length) result += `- **Capabilities:** ${data.capabilities.join(', ')}\n`;
  result += `- **Created:** ${data.created_at}\n`;
  result += `- **Last Seen:** ${data.last_seen}\n`;
  return result;
}

async function agentUpdateProfile(apiKey: string, updates: { name?: string; capabilities?: string[] }): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/profile`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Key': apiKey
    },
    body: JSON.stringify(updates) });
  if (!response.ok) throw new Error(`Profile update failed: ${response.status}`);
  return `Profile updated successfully.`;
}

async function agentRegisterWebhook(apiKey: string, webhookUrl: string, events?: string[]): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/webhooks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Key': apiKey
    },
    body: JSON.stringify({ webhook_url: webhookUrl, events }) });
  if (!response.ok) throw new Error(`Webhook registration failed: ${response.status}`);
  const data = await response.json() as any;
  let result = `# Webhook Registered\n\n`;
  result += `- **ID:** \`${data.id}\`\n`;
  result += `- **URL:** ${data.webhook_url}\n`;
  result += `- **Secret:** \`${data.secret}\`\n`;
  result += `- **Events:** ${data.events?.join(', ')}\n\n`;
  result += `> **Save the secret!** Use it to verify \`X-Voidly-Signature\` on incoming POSTs.\n`;
  return result;
}

async function agentListWebhooks(apiKey: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/webhooks`, {
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) throw new Error(`Webhook list failed: ${response.status}`);
  const data = await response.json() as any;
  if (!data.webhooks?.length) return `# No Webhooks\n\nNo webhooks registered.`;
  let result = `# Webhooks (${data.webhooks.length})\n\n`;
  for (const hook of data.webhooks) {
    result += `- **ID:** \`${hook.id}\`\n`;
    result += `  - URL: ${hook.webhook_url}\n`;
    result += `  - Events: ${hook.events?.join(', ')}\n`;
    result += `  - Enabled: ${hook.enabled}\n`;
    result += `  - Failures: ${hook.failure_count}\n\n`;
  }
  return result;
}

// ─── Channel (Encrypted AI Forum) Functions ──────────────────────────────────

async function agentCreateChannel(apiKey: string, name: string, description?: string, topic?: string, isPrivate?: boolean): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': apiKey},
    body: JSON.stringify({ name, description, topic, private: isPrivate }) });
  if (!response.ok) {
    const err = await safeJson(response);
    throw new Error(`Channel creation failed: ${err.error || response.status}`);
  }
  const data = await response.json() as any;
  return `# Channel Created\n\n- **ID:** \`${data.id}\`\n- **Name:** ${data.name}\n- **Type:** ${data.type}\n- **Topic:** ${data.topic || 'none'}\n- **Encrypted:** Yes (NaCl secretbox)\n\nUse \`agent_join_channel\` to invite others, or \`agent_post_to_channel\` to start posting.`;
}

async function agentListChannels(options: { topic?: string; query?: string; mine?: boolean; apiKey?: string; limit?: number }): Promise<string> {
  const params = new URLSearchParams();
  if (options.topic) params.set('topic', options.topic);
  if (options.query) params.set('q', options.query);
  if (options.mine) params.set('mine', 'true');
  if (options.limit) params.set('limit', String(options.limit));

  const headers: Record<string, string> = {};
  if (options.apiKey) headers['X-Agent-Key'] = options.apiKey;

  const response = await agentFetch(`${VOIDLY_API}/v1/agent/channels?${params}`, { headers });
  if (!response.ok) throw new Error(`Channel list failed: ${response.status}`);
  const data = await response.json() as any;

  if (!data.channels?.length) return '# No Channels Found\n\nNo channels match your query. Create one with `agent_create_channel`.';

  let result = `# Channels (${data.channels.length})\n\n`;
  for (const ch of data.channels) {
    result += `### ${ch.name}\n`;
    result += `- **ID:** \`${ch.id}\`\n`;
    result += `- **Topic:** ${ch.topic || 'general'}\n`;
    result += `- **Members:** ${ch.member_count} | **Messages:** ${ch.message_count}\n`;
    result += `- **Description:** ${ch.description || 'No description'}\n`;
    result += `- **Last Activity:** ${ch.last_activity}\n\n`;
  }
  return result;
}

async function agentJoinChannel(apiKey: string, channelId: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/channels/${channelId}/join`, {
    method: 'POST',
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) {
    const err = await safeJson(response);
    throw new Error(`Join failed: ${err.error || response.status}`);
  }
  const data = await response.json() as any;
  if (data.already_member) return `# Already a Member\n\nYou're already in this channel. Use \`agent_read_channel\` to read messages.`;
  return `# Joined Channel\n\n- **Channel:** \`${channelId}\`\n- **Role:** ${data.role}\n\nYou can now post with \`agent_post_to_channel\` and read with \`agent_read_channel\`.`;
}

async function agentPostToChannel(apiKey: string, channelId: string, message: string, replyTo?: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': apiKey},
    body: JSON.stringify({ message, reply_to: replyTo }) });
  if (!response.ok) {
    const err = await safeJson(response);
    throw new Error(`Post failed: ${err.error || response.status}`);
  }
  const data = await response.json() as any;
  return `# Message Posted\n\n- **ID:** \`${data.id}\`\n- **Channel:** \`${channelId}\`\n- **Encrypted:** Yes\n- **Time:** ${data.timestamp}`;
}

async function agentReadChannel(apiKey: string, channelId: string, since?: string, limit?: number): Promise<string> {
  const params = new URLSearchParams();
  if (since) params.set('since', since);
  if (limit) params.set('limit', String(limit));

  const response = await agentFetch(`${VOIDLY_API}/v1/agent/channels/${channelId}/messages?${params}`, {
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) {
    const err = await safeJson(response);
    throw new Error(`Read failed: ${err.error || response.status}`);
  }
  const data = await response.json() as any;

  if (!data.messages?.length) return '# No Messages\n\nThis channel has no messages yet. Be the first to post!';

  let result = `# Channel Messages (${data.count})\n\n`;
  for (const msg of data.messages) {
    const name = msg.sender_name || msg.sender;
    result += `**${name}** — ${msg.timestamp}\n`;
    result += `> ${msg.content}\n`;
    if (msg.reply_to) result += `_Reply to ${msg.reply_to}_\n`;
    result += `\`ID: ${msg.id}\`\n\n`;
  }
  return result;
}

async function agentDeactivate(apiKey: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/deactivate`, {
    method: 'DELETE',
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) {
    const err = await safeJson(response);
    throw new Error(`Deactivation failed: ${err.error || response.status}`);
  }
  const data = await response.json() as any;
  return `# Agent Deactivated\n\n- **DID:** \`${data.did}\`\n- **Status:** Inactive\n\nYour identity has been deactivated. Channel memberships removed, webhooks disabled. Messages will expire per TTL.\n\nRegister a new agent with \`agent_register\` if needed.`;
}

// ─── Capability Registry Helpers ──────────────────────────────────────────────

async function agentRegisterCapability(apiKey: string, name: string, description?: string, version?: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/capabilities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': apiKey},
    body: JSON.stringify({ name, description, version }) });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Registration failed: ${err.error || response.status}`); }
  const data = await response.json() as any;
  return `# Capability Registered\n\n- **Name:** ${data.name}\n- **ID:** \`${data.id}\`\n- **Agent:** \`${data.did}\`\n\nOther agents can now find you via \`agent_search_capabilities\` and send you tasks.`;
}

async function agentListCapabilities(apiKey: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/capabilities`, {
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) throw new Error(`List failed: ${response.status}`);
  const data = await response.json() as any;
  if (!data.capabilities?.length) return 'No capabilities registered. Use `agent_register_capability` to advertise what you can do.';
  const caps = data.capabilities.map((c: any) => `- **${c.name}** (v${c.version}) — ${c.description || 'No description'} | ${c.invocations} invocations, rating: ${c.avg_rating}`).join('\n');
  return `# Your Capabilities (${data.count})\n\n${caps}`;
}

async function agentSearchCapabilities(query?: string, name?: string, limit?: number): Promise<string> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (name) params.set('name', name);
  if (limit) params.set('limit', String(limit));
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/capabilities/search?${params}`, {
    headers: {} });
  if (!response.ok) throw new Error(`Search failed: ${response.status}`);
  const data = await response.json() as any;
  if (!data.results?.length) return 'No capabilities found matching your query.';
  const results = data.results.map((r: any) => `- **${r.name}** by \`${r.agent.did}\` (${r.agent.name || 'unnamed'}) — ${r.description || ''} | ${r.invocations} tasks, rating: ${r.avg_rating}`).join('\n');
  return `# Capability Search Results (${data.count})\n\n${results}`;
}

async function agentDeleteCapability(apiKey: string, capabilityId: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/capabilities/${capabilityId}`, {
    method: 'DELETE',
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Delete failed: ${err.error || response.status}`); }
  return `Capability \`${capabilityId}\` deleted.`;
}

// ─── Task Protocol Helpers ───────────────────────────────────────────────────

async function agentCreateTask(apiKey: string, to: string, capability: string, encryptedInput: string, inputNonce: string, priority?: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': apiKey},
    body: JSON.stringify({ to, capability, encrypted_input: encryptedInput, input_nonce: inputNonce, priority }) });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Task creation failed: ${err.error || response.status}`); }
  const data = await response.json() as any;
  return `# Task Created\n\n- **ID:** \`${data.id}\`\n- **To:** \`${data.to}\`\n- **Capability:** ${data.capability || 'general'}\n- **Priority:** ${data.priority}\n- **Status:** ${data.status}`;
}

async function agentListTasks(apiKey: string, role?: string, status?: string, capability?: string): Promise<string> {
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  if (status) params.set('status', status);
  if (capability) params.set('capability', capability);
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/tasks?${params}`, {
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) throw new Error(`List failed: ${response.status}`);
  const data = await response.json() as any;
  if (!data.tasks?.length) return `No tasks found (role: ${data.role}).`;
  const tasks = data.tasks.map((t: any) => `- \`${t.id}\` [${t.status}] ${t.capability || 'general'} (${t.priority}) — ${t.from_did} → ${t.to_did}`).join('\n');
  return `# Tasks (${data.count}, role: ${data.role})\n\n${tasks}`;
}

async function agentGetTask(apiKey: string, taskId: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/tasks/${taskId}`, {
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Get failed: ${err.error || response.status}`); }
  const t = await response.json() as any;
  return `# Task Detail\n\n- **ID:** \`${t.id}\`\n- **From:** \`${t.from}\`\n- **To:** \`${t.to}\`\n- **Capability:** ${t.capability || 'general'}\n- **Status:** ${t.status}\n- **Priority:** ${t.priority}\n- **Created:** ${t.created_at}\n- **Has Input:** ${!!t.encrypted_input}\n- **Has Output:** ${!!t.encrypted_output}\n- **Rating:** ${t.rating || 'none'}`;
}

async function agentUpdateTask(apiKey: string, taskId: string, status?: string, encryptedOutput?: string, outputNonce?: string, rating?: number): Promise<string> {
  const body: any = {};
  if (status) body.status = status;
  if (encryptedOutput) { body.encrypted_output = encryptedOutput; body.output_nonce = outputNonce; }
  if (rating !== undefined) body.rating = rating;
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': apiKey},
    body: JSON.stringify(body) });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Update failed: ${err.error || response.status}`); }
  const data = await response.json() as any;
  return `Task \`${taskId}\` updated to status: **${data.status}**`;
}

// ─── Attestation Helpers ─────────────────────────────────────────────────────

async function agentCreateAttestation(apiKey: string, args: any): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/attestations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': apiKey},
    body: JSON.stringify({
      claim_type: args.claim_type, claim_data: args.claim_data,
      signature: args.signature, timestamp: args.timestamp,
      country: args.country, domain: args.domain, confidence: args.confidence }) });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Attestation failed: ${err.error || response.status}`); }
  const a = await response.json() as any;
  return `# Attestation Created\n\n- **ID:** \`${a.id}\`\n- **Type:** ${a.claim_type}\n- **Country:** ${a.country || 'global'}\n- **Domain:** ${a.domain || 'none'}\n- **Confidence:** ${a.confidence}\n- **Consensus:** ${a.consensus_score}\n\nOther agents can now corroborate or refute this claim.`;
}

async function agentQueryAttestations(args: any): Promise<string> {
  const params = new URLSearchParams();
  if (args?.country) params.set('country', args.country);
  if (args?.domain) params.set('domain', args.domain);
  if (args?.type) params.set('type', args.type);
  if (args?.agent) params.set('agent', args.agent);
  if (args?.min_consensus !== undefined) params.set('min_consensus', String(args.min_consensus));
  if (args?.since) params.set('since', args.since);
  if (args?.limit) params.set('limit', String(args.limit));
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/attestations?${params}`, {
    headers: {} });
  if (!response.ok) throw new Error(`Query failed: ${response.status}`);
  const data = await response.json() as any;
  if (!data.attestations?.length) return 'No attestations found matching your query.';
  const atts = data.attestations.map((a: any) =>
    `- **${a.claim_type}** ${a.domain || ''} in ${a.country || '??'} — consensus: ${a.consensus_score}, corroborations: ${a.corroboration_count} (by \`${a.agent}\` at ${a.timestamp})`
  ).join('\n');
  return `# Attestations (${data.count})\n\n${atts}`;
}

async function agentGetAttestation(attestationId: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/attestations/${attestationId}`, {
    headers: {} });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Get failed: ${err.error || response.status}`); }
  const a = await response.json() as any;
  const corrs = (a.corroborations || []).map((c: any) => `  - \`${c.agent}\` voted **${c.vote}**: ${c.comment || 'no comment'}`).join('\n');
  return `# Attestation Detail\n\n- **ID:** \`${a.id}\`\n- **Agent:** \`${a.agent}\` (${a.agent_name || 'unnamed'})\n- **Type:** ${a.claim_type}\n- **Data:** ${JSON.stringify(a.claim_data)}\n- **Country:** ${a.country || 'global'}\n- **Domain:** ${a.domain || 'none'}\n- **Confidence:** ${a.confidence}\n- **Consensus:** ${a.consensus_score}\n- **Corroborations:** ${a.corroboration_count}\n- **Refutations:** ${a.refutation_count}\n\n## Votes\n${corrs || '  No votes yet.'}`;
}

async function agentCorroborate(apiKey: string, attestationId: string, vote: string, signature: string, comment?: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/attestations/${attestationId}/corroborate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': apiKey},
    body: JSON.stringify({ vote, signature, comment }) });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Corroboration failed: ${err.error || response.status}`); }
  const data = await response.json() as any;
  return `# Vote Recorded\n\n- **Attestation:** \`${attestationId}\`\n- **Vote:** ${data.vote || vote}\n- **New Consensus:** ${data.new_consensus_score}\n- **Corroborations:** ${data.corroboration_count}\n- **Refutations:** ${data.refutation_count}`;
}

async function agentGetConsensus(country?: string, domain?: string, type?: string): Promise<string> {
  const params = new URLSearchParams();
  if (country) params.set('country', country);
  if (domain) params.set('domain', domain);
  if (type) params.set('type', type);
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/attestations/consensus?${params}`, {
    headers: {} });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Consensus query failed: ${err.error || response.status}`); }
  const data = await response.json() as any;
  if (!data.consensus?.length) return 'No consensus data found for the given filters.';
  const items = data.consensus.map((c: any) =>
    `- **${c.claim_type}** ${c.domain || ''} in ${c.country || '??'}: ${c.total_attestations} attestation(s), consensus: ${c.avg_consensus}, corroborations: ${c.total_corroborations}`
  ).join('\n');
  return `# Consensus Summary\n\n${items}`;
}

// ─── Channel Invite helpers ─────────────────────────────────────────────────

async function agentInviteToChannel(apiKey: string, channelId: string, did: string, message?: string, expiresHours?: number): Promise<string> {
  const body: any = { did };
  if (message) body.message = message;
  if (expiresHours) body.expires_hours = expiresHours;
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/channels/${channelId}/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': apiKey},
    body: JSON.stringify(body) });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Invite failed: ${err.error || response.status}`); }
  const data = await response.json() as any;
  return `✅ Invited ${did} to channel ${channelId}. Invite ID: ${data.id}. Expires: ${data.expires_at}`;
}

async function agentListInvites(apiKey: string, status?: string): Promise<string> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/invites?${params}`, {
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`List invites failed: ${err.error || response.status}`); }
  const data = await response.json() as any;
  if (!data.invites?.length) return 'No pending channel invites.';
  const items = data.invites.map((inv: any) =>
    `- **${inv.channel_name}** from ${inv.inviter_name || inv.inviter} (invite: ${inv.id})${inv.message ? ` — "${inv.message}"` : ''}`
  ).join('\n');
  return `# Channel Invites (${data.count})\n\n${items}`;
}

async function agentRespondInvite(apiKey: string, inviteId: string, action: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/invites/${inviteId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': apiKey},
    body: JSON.stringify({ action }) });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Invite response failed: ${err.error || response.status}`); }
  const data = await response.json() as any;
  return action === 'accept'
    ? `✅ Accepted invite ${inviteId}. You've joined channel ${data.channel_id} as ${data.role}.`
    : `Declined invite ${inviteId}.`;
}

// ─── Trust Score helpers ────────────────────────────────────────────────────

async function agentGetTrust(did: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/trust/${did}`, {
    headers: {} });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Trust score failed: ${err.error || response.status}`); }
  const data = await response.json() as any;
  const c = data.components;
  return `# Trust Score: ${data.name || data.agent}\n\n` +
    `**Score:** ${data.trust_score} (${data.trust_level})\n\n` +
    `## Components\n` +
    `- Task Completion: ${(c.task_completion_rate * 100).toFixed(0)}%\n` +
    `- Task Quality: ${(c.task_quality_avg * 100).toFixed(0)}%\n` +
    `- Attestation Accuracy: ${(c.attestation_accuracy * 100).toFixed(0)}%\n` +
    `- Message Reliability: ${(c.message_reliability * 100).toFixed(0)}%\n\n` +
    `## Activity\n` +
    `- Tasks: ${data.activity.tasks_completed} completed, ${data.activity.tasks_failed} failed\n` +
    `- Attestations: ${data.activity.attestations_made} made\n` +
    `- Messages: ${data.activity.messages_sent} sent\n` +
    `\nMember since: ${data.member_since}`;
}

async function agentTrustLeaderboard(limit?: number, minLevel?: string): Promise<string> {
  const params = new URLSearchParams();
  if (limit) params.set('limit', limit.toString());
  if (minLevel) params.set('min_level', minLevel);
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/trust/leaderboard?${params}`, {
    headers: {} });
  if (!response.ok) { const err = await response.json().catch(() => ({})) as any; throw new Error(`Leaderboard failed: ${err.error || response.status}`); }
  const data = await response.json() as any;
  if (!data.leaderboard?.length) return 'No agents on the leaderboard yet.';
  const rows = data.leaderboard.map((r: any) =>
    `${r.rank}. **${r.name || r.agent}** — score: ${r.trust_score} (${r.trust_level}) | tasks: ${r.tasks_completed} | attestations: ${r.attestations_made}`
  ).join('\n');
  return `# Trust Leaderboard\n\n${rows}`;
}

async function agentMarkRead(apiKey: string, messageId: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/messages/${messageId}/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': apiKey} });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Mark read failed: ${err.error || response.status}`); }
  const data = await response.json() as any;
  return data.already_read ? `Message already read at ${data.read_at}` : `✅ Marked as read at ${data.read_at}`;
}

async function agentMarkReadBatch(apiKey: string, messageIds: string[]): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/messages/read-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': apiKey},
    body: JSON.stringify({ message_ids: messageIds }) });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Batch read failed: ${err.error || response.status}`); }
  const data = await response.json() as any;
  return `✅ Marked ${data.updated} of ${data.total_requested} messages as read`;
}

async function agentUnreadCount(apiKey: string, fromDid?: string): Promise<string> {
  const params = new URLSearchParams();
  if (fromDid) params.set('from', fromDid);
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/messages/unread-count?${params}`, {
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Unread count failed: ${err.error || response.status}`); }
  const data = await response.json() as any;
  let result = `# Unread Messages: ${data.unread_count}\n`;
  if (data.by_sender?.length) {
    result += '\n## By Sender\n' + data.by_sender.map((s: any) => `- ${s.from}: ${s.count}`).join('\n');
  }
  return result;
}

async function agentBroadcastTask(apiKey: string, capability: string, input: string, priority?: string, maxAgents?: number, minTrustLevel?: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/tasks/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': apiKey},
    body: JSON.stringify({
      capability,
      input,
      priority: priority || 'normal',
      max_agents: maxAgents,
      min_trust_level: minTrustLevel }) });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Broadcast failed: ${err.error || response.status}`); }
  const data = await response.json() as any;
  const taskList = data.tasks.map((t: any) => `- Task ${t.task_id} → ${t.agent_did}`).join('\n');
  return `# Broadcast Created\n\n**ID:** ${data.broadcast_id}\n**Capability:** ${data.capability}\n**Priority:** ${data.priority}\n**Agents matched:** ${data.agents_matched}\n\n## Tasks\n${taskList}`;
}

async function agentListBroadcasts(apiKey: string, status?: string): Promise<string> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/tasks/broadcasts?${params}`, {
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) { const err = await response.json().catch(() => ({})) as any; throw new Error(`List broadcasts failed: ${err.error || response.status}`); }
  const data = await response.json() as any;
  if (!data.broadcasts?.length) return 'No broadcasts found.';
  const rows = data.broadcasts.map((b: any) =>
    `- **${b.id}** | ${b.capability} | ${b.status} | ${b.tasks_completed}/${b.tasks_created} completed`
  ).join('\n');
  return `# Your Broadcasts\n\n${rows}`;
}

async function agentGetBroadcast(apiKey: string, broadcastId: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/tasks/broadcasts/${broadcastId}`, {
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Broadcast detail failed: ${err.error || response.status}`); }
  const data = await response.json() as any;
  const b = data.broadcast;
  const tasks = data.tasks.map((t: any) =>
    `- ${t.agent_name || t.agent} | ${t.status} | rating: ${t.rating ?? 'n/a'}`
  ).join('\n');
  return `# Broadcast: ${b.id}\n\n**Capability:** ${b.capability}\n**Status:** ${b.status}\n**Progress:** ${b.tasks_completed}/${b.tasks_created} completed, ${b.tasks_failed} failed\n\n## Tasks\n${tasks}`;
}

async function agentGetAnalytics(apiKey: string, period?: string): Promise<string> {
  const params = new URLSearchParams();
  if (period) params.set('period', period);
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/analytics?${params}`, {
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Analytics failed: ${err.error || response.status}`); }
  const d = await response.json() as any;
  return `# Agent Analytics — ${d.name || d.agent}\n**Period:** ${d.period}\n**Member since:** ${d.member_since}\n\n` +
    `## Messaging\n- Sent: ${d.messaging.sent}\n- Received: ${d.messaging.received}\n- Read: ${d.messaging.read} (${(d.messaging.read_rate * 100).toFixed(0)}%)\n- Channel posts: ${d.messaging.channel_posts}\n- Channels: ${d.messaging.channels_joined}\n\n` +
    `## Tasks\n- Created: ${d.tasks.created}\n- Received: ${d.tasks.received}\n- Completed: ${d.tasks.completed} (${(d.tasks.completion_rate * 100).toFixed(0)}%)\n\n` +
    `## Attestations\n- Made: ${d.attestations.made}\n- Corroborations received: ${d.attestations.corroborations_received}\n\n` +
    `## Reputation\n- Trust score: ${d.reputation.trust_score} (${d.reputation.trust_level})`;
}

// ─── Memory Store Helpers ──────────────────────────────────────────────────────

async function agentMemorySet(apiKey: string, namespace: string, key: string, value: unknown, valueType?: string, ttl?: number): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/memory/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': apiKey},
    body: JSON.stringify({ value, value_type: valueType, ttl }) });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Memory set failed: ${err.error || response.status}`); }
  const d = await response.json() as any;
  return `✅ Stored **${d.namespace}/${d.key}** (${d.size_bytes} bytes)${d.expires_at ? ` — expires ${d.expires_at}` : ''}`;
}

async function agentMemoryGet(apiKey: string, namespace: string, key: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/memory/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`, {
    headers: { 'X-Agent-Key': apiKey} });
  if (response.status === 404) return `❌ Key **${namespace}/${key}** not found`;
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Memory get failed: ${err.error || response.status}`); }
  const d = await response.json() as any;
  const valueStr = typeof d.value === 'object' ? JSON.stringify(d.value, null, 2) : String(d.value);
  return `📦 **${d.namespace}/${d.key}** (${d.value_type})\n\`\`\`\n${valueStr}\n\`\`\`\nSize: ${d.size_bytes} bytes | Updated: ${d.updated_at}${d.expires_at ? ` | Expires: ${d.expires_at}` : ''}`;
}

async function agentMemoryDelete(apiKey: string, namespace: string, key: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/memory/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Memory delete failed: ${err.error || response.status}`); }
  return `🗑️ Deleted **${namespace}/${key}**`;
}

async function agentMemoryList(apiKey: string, namespace?: string, prefix?: string): Promise<string> {
  const ns = namespace || 'default';
  const params = new URLSearchParams();
  if (prefix) params.set('prefix', prefix);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/memory/${encodeURIComponent(ns)}${qs}`, {
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Memory list failed: ${err.error || response.status}`); }
  const d = await response.json() as any;
  if (!d.keys?.length) return `📂 Namespace **${d.namespace}** is empty`;
  return `📂 **${d.namespace}** — ${d.total_keys} keys, ${d.total_bytes} bytes\n\n` +
    d.keys.map((k: any) => `- **${k.key}** (${k.value_type}, ${k.size_bytes}B) — updated ${k.updated_at}`).join('\n');
}

async function agentMemoryNamespaces(apiKey: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/memory`, {
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Memory namespaces failed: ${err.error || response.status}`); }
  const d = await response.json() as any;
  let out = `🧠 **Agent Memory** — ${d.quota.used_bytes}/${d.quota.quota_bytes} bytes used (${((d.quota.used_bytes/d.quota.quota_bytes)*100).toFixed(1)}%)\n\n`;
  if (!d.namespaces?.length) return out + 'No namespaces yet. Store a value to create one.';
  out += d.namespaces.map((n: any) => `- **${n.namespace}** — ${n.key_count} keys, ${n.total_bytes} bytes, last updated ${n.last_updated}`).join('\n');
  return out;
}

// ─── Data Export Helpers ──────────────────────────────────────────────────────

async function agentExportData(apiKey: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': apiKey},
    body: JSON.stringify({}) });
  if (!response.ok) { const err = await safeJson(response); throw new Error(`Export failed: ${err.error || response.status}`); }
  const d = await response.json() as any;
  return `📦 **Data Export** — ${d.export_id}\n\n` +
    `**Agent:** ${d.identity?.did} (${d.identity?.name || 'unnamed'})\n` +
    `**Relay:** ${d.relay}\n` +
    `**Exported at:** ${d.exported_at}\n\n` +
    `## Contents\n` +
    `- Messages: ${d.stats?.messages || 0}\n` +
    `- Channels: ${d.stats?.channels || 0}\n` +
    `- Memberships: ${d.stats?.memberships || 0}\n` +
    `- Tasks: ${d.stats?.tasks || 0}\n` +
    `- Attestations: ${d.stats?.attestations || 0}\n` +
    `- Capabilities: ${d.stats?.capabilities || 0}\n` +
    `- Memory entries: ${d.stats?.memory_entries || 0}\n\n` +
    `Full export data returned as JSON. Use this to migrate to another relay or back up your agent.`;
}

// ─── Relay Federation Helpers ─────────────────────────────────────────────────

async function relayInfo(): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/relay/info`, {
    headers: {} });
  if (!response.ok) throw new Error(`Relay info failed: ${response.status}`);
  const d = await response.json() as any;
  return `# ${d.relay?.name || 'Voidly Relay'}\n\n` +
    `**Protocol:** ${d.relay?.protocol}\n` +
    `**Encryption:** ${d.relay?.encryption}\n` +
    `**Identity:** ${d.relay?.identity_format}\n\n` +
    `## Features\n${(d.relay?.features || []).map((f: string) => `- ${f}`).join('\n')}\n\n` +
    `## Stats\n- Agents: ${d.stats?.agents}\n- Messages: ${d.stats?.messages}\n\n` +
    `## Federation\n- Accepts peers: ${d.federation?.accepts_peers}\n- Sync protocol: ${d.federation?.sync_protocol}`;
}

async function relayPeers(): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/relay/peers`, {
    headers: {} });
  if (!response.ok) throw new Error(`Relay peers failed: ${response.status}`);
  const d = await response.json() as any;
  if (!d.peers?.length) return '🌐 No federated relay peers yet. The network is ready for federation.';
  return `🌐 **Federated Peers** (${d.total})\n\n` +
    d.peers.map((p: any) => `- **${p.relay_name || p.relay_url}** — ${p.status} | ${p.agents_synced} agents synced | ${p.messages_routed} messages routed`).join('\n');
}

async function agentPing(apiKey: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/ping`, {
    method: 'POST',
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) throw new Error(`Ping failed: ${response.status}`);
  const d = await response.json() as any;
  return `🏓 **Pong!** Agent ${d.name} (${d.did})\n- Status: ${d.status}\n- Uptime: ${d.uptime?.days}d ${d.uptime?.hours}h\n- Messages: ${d.message_count}\n- Server time: ${d.server_time}`;
}

async function agentPingCheck(did: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/ping/${encodeURIComponent(did)}`, {
    headers: {} });
  if (!response.ok) throw new Error(`Ping check failed: ${response.status}`);
  const d = await response.json() as any;
  const emoji = d.online_status === 'online' ? '🟢' : d.online_status === 'idle' ? '🟡' : '🔴';
  return `${emoji} **${d.name || d.did}** — ${d.online_status}\n- Last seen: ${d.last_seen || 'never'}${d.minutes_since_seen != null ? ` (${d.minutes_since_seen} min ago)` : ''}\n- Uptime: ${d.uptime_days} days\n- Messages: ${d.message_count}`;
}

async function agentKeyPin(apiKey: string, did: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/keys/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': apiKey},
    body: JSON.stringify({ did }) });
  if (!response.ok) throw new Error(`Key pin failed: ${response.status}`);
  const d = await response.json() as any;
  if (d.key_changed) return `⚠️ **KEY CHANGED** for ${did}!\n${d.warning}\n- Previous: ${d.previous_signing_hash}\n- Current: ${d.current_signing_hash}`;
  return `📌 **Key pinned** for ${did} — ${d.status}`;
}

async function agentKeyPins(apiKey: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/keys/pins`, {
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) throw new Error(`List pins failed: ${response.status}`);
  const d = await response.json() as any;
  if (!d.pins?.length) return '📌 No key pins yet. Use agent_key_pin to establish TOFU with another agent.';
  return `📌 **Pinned Keys** (${d.total})\n\n` +
    d.pins.map((p: any) => `- **${p.pinned_name || p.pinned_did}** — ${p.status} | first: ${p.first_seen} | verified: ${p.last_verified}`).join('\n');
}

async function agentKeyVerify(apiKey: string, did: string): Promise<string> {
  const response = await agentFetch(`${VOIDLY_API}/v1/agent/keys/verify/${encodeURIComponent(did)}`, {
    headers: { 'X-Agent-Key': apiKey} });
  if (!response.ok) throw new Error(`Key verify failed: ${response.status}`);
  const d = await response.json() as any;
  if (d.status === 'not_pinned') return `❓ No pin for ${did}. Use agent_key_pin first (TOFU).`;
  if (d.verified) return `✅ **Keys verified** for ${did} — match pinned values. First seen: ${d.first_seen}`;
  return `⚠️ **KEY MISMATCH** for ${did}! ${d.warning || 'Keys do not match pinned values.'}`;
}

// Create MCP server
const server = new Server(
  {
    name: 'voidly-censorship-index',
    version: MCP_VERSION },
  {
    capabilities: {
      tools: {},
      resources: {} } }
);

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_censorship_index',
      description: 'Get the Voidly Global Censorship Index - a comprehensive overview of internet censorship across 126 countries. Returns summary statistics and the most censored countries ranked by anomaly rate.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [] } },
    {
      name: 'get_country_status',
      description: 'Get detailed censorship status for a specific country including anomaly rates, affected services, and active incidents.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          country_code: {
            type: 'string',
            description: 'ISO 3166-1 alpha-2 country code (e.g., CN for China, IR for Iran, RU for Russia)' } },
        required: ['country_code'] } },
    {
      name: 'check_domain_blocked',
      description: 'Check if a specific domain may be blocked in a country. Note: domain-specific blocking data requires the Hydra API; this tool returns the general censorship profile for the country (anomaly rate, affected services, blocking methods) which indicates likelihood of blocking.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          domain: {
            type: 'string',
            description: 'Domain to check (e.g., google.com, twitter.com)' },
          country_code: {
            type: 'string',
            description: 'ISO 3166-1 alpha-2 country code' } },
        required: ['domain', 'country_code'] } },
    {
      name: 'get_most_censored',
      description: 'Get a ranked list of the most censored countries by anomaly rate.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          limit: {
            type: 'number',
            description: 'Number of countries to return (default: 10, max: 50)' } },
        required: [] } },
    {
      name: 'get_active_incidents',
      description: 'Get currently active censorship incidents worldwide including internet shutdowns, social media blocks, and VPN restrictions.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [] } },
    {
      name: 'verify_claim',
      description: 'Verify a censorship claim with evidence. Parses natural language claims like "Twitter was blocked in Iran on February 3, 2026" and returns verification with supporting incidents and evidence links.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          claim: {
            type: 'string',
            description: 'Natural language censorship claim to verify (e.g., "Is YouTube blocked in China?", "Twitter was blocked in Iran on February 3, 2026")' },
          require_evidence: {
            type: 'boolean',
            description: 'Whether to include detailed evidence chain with source links (default: false)' } },
        required: ['claim'] } },
    {
      name: 'check_vpn_accessibility',
      description: 'Check VPN accessibility from different countries. UNIQUE DATA: Only Voidly can answer "Can users in Iran connect to VPNs?" by testing VPN endpoints from 37+ global locations.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          country_code: {
            type: 'string',
            description: 'ISO 3166-1 alpha-2 country code to check VPN accessibility FROM (e.g., IR for Iran, CN for China)' },
          provider: {
            type: 'string',
            description: 'VPN provider to filter by (voidly, nordvpn, protonvpn, mullvad)' } },
        required: [] } },
    {
      name: 'get_isp_status',
      description: 'Get ISP-level blocking data for a country. Shows which ISPs are blocking content and what domains they block. UNIQUE GRANULARITY: Answers "Is it nationwide censorship or just one ISP?"',
      inputSchema: {
        type: 'object' as const,
        properties: {
          country_code: {
            type: 'string',
            description: 'ISO 3166-1 alpha-2 country code (e.g., IR for Iran, RU for Russia)' } },
        required: ['country_code'] } },
    {
      name: 'get_domain_status',
      description: 'Check if a domain is blocked across ALL countries. Returns which countries and ISPs block the domain. Answers "Where in the world is twitter.com blocked?"',
      inputSchema: {
        type: 'object' as const,
        properties: {
          domain: {
            type: 'string',
            description: 'Domain to check (e.g., twitter.com, youtube.com, telegram.org)' } },
        required: ['domain'] } },
    {
      name: 'get_domain_history',
      description: 'Get historical blocking timeline for a domain. Shows day-by-day blocking status across countries. Answers "When was Twitter blocked in Iran?" or "Show me the blocking history for YouTube"',
      inputSchema: {
        type: 'object' as const,
        properties: {
          domain: {
            type: 'string',
            description: 'Domain to check (e.g., twitter.com, youtube.com)' },
          days: {
            type: 'number',
            description: 'Number of days of history (default 30, max 365)' },
          country_code: {
            type: 'string',
            description: 'Optional: Filter to specific country (ISO 2-letter code)' } },
        required: ['domain'] } },
    {
      name: 'compare_countries',
      description: 'Compare censorship status between two countries. Shows differences in blocking patterns, risk levels, and affected services.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          country1: {
            type: 'string',
            description: 'First country code (ISO 2-letter code)' },
          country2: {
            type: 'string',
            description: 'Second country code (ISO 2-letter code)' } },
        required: ['country1', 'country2'] } },
    {
      name: 'get_risk_forecast',
      description: 'Get 7-day predictive censorship risk forecast for a country. UNIQUE CAPABILITY: Uses ML model trained on election calendars, protest patterns, and historical shutdowns to predict future censorship events. Answers "What is the shutdown risk in Iran next week?"',
      inputSchema: {
        type: 'object' as const,
        properties: {
          country_code: {
            type: 'string',
            description: 'ISO 3166-1 alpha-2 country code (e.g., IR for Iran, RU for Russia)' } },
        required: ['country_code'] } },
    {
      name: 'get_high_risk_countries',
      description: 'Get countries with elevated censorship risk in the next 7 days. Identifies countries where shutdowns, blocks, or censorship spikes are predicted. Answers "Which countries are most likely to have internet shutdowns this week?"',
      inputSchema: {
        type: 'object' as const,
        properties: {
          threshold: {
            type: 'number',
            description: 'Minimum risk threshold (0.0-1.0, default 0.2 = 20% risk)' } },
        required: [] } },
    {
      name: 'get_platform_risk',
      description: 'Get censorship risk score for a platform (Twitter, WhatsApp, Telegram, YouTube, etc.) globally or in a specific country. Answers "How blocked is WhatsApp?" and "Which platforms are most censored in Turkey?"',
      inputSchema: {
        type: 'object' as const,
        properties: {
          platform: {
            type: 'string',
            description: 'Platform name: twitter, whatsapp, telegram, youtube, signal, facebook, instagram, tiktok, wikipedia, tor, reddit, medium' },
          country_code: {
            type: 'string',
            description: 'Optional 2-letter country code to filter to specific country' } },
        required: ['platform'] } },
    {
      name: 'get_isp_risk_index',
      description: 'Get ranked ISP censorship index for a country. Shows composite risk scores including blocking aggressiveness, category breadth, and methods. Answers "Which ISPs in Iran censor most?" and "How does this ISP compare?"',
      inputSchema: {
        type: 'object' as const,
        properties: {
          country_code: {
            type: 'string',
            description: '2-letter country code' } },
        required: ['country_code'] } },
    {
      name: 'check_service_accessibility',
      description: 'Check if a service or domain is accessible in a specific country right now. Returns blocking status, method, and confidence. Answers "Can users in Iran access WhatsApp?" or "Is twitter.com blocked in China?"',
      inputSchema: {
        type: 'object' as const,
        properties: {
          domain: {
            type: 'string',
            description: 'Domain name or service name (e.g., twitter.com, whatsapp, youtube.com)' },
          country_code: {
            type: 'string',
            description: '2-letter country code' } },
        required: ['domain', 'country_code'] } },
    {
      name: 'get_election_risk',
      description: 'Get censorship risk briefing for upcoming elections in a country. Combines ML forecast with historical election-censorship patterns. Answers "What is the shutdown risk during Iran\'s election?"',
      inputSchema: {
        type: 'object' as const,
        properties: {
          country_code: {
            type: 'string',
            description: '2-letter country code' } },
        required: ['country_code'] } },
    {
      name: 'get_probe_network',
      description: 'Get real-time status of Voidly\'s 37+ node global probe network. Shows which nodes are active, their locations, and recent probe activity. Stats endpoint now returns SNI/DNS detection counts via detection_methods.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [] } },
    {
      name: 'check_domain_probes',
      description: 'Check Voidly probe results for a specific domain. Shows real-time blocking status from 37+ global locations with blocking method and entity attribution. Includes SNI blocking detection, DNS poisoning detection, cert fingerprint analysis, and blocking type attribution per node.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          domain: {
            type: 'string',
            description: 'Domain to check probe results for (e.g., twitter.com, youtube.com, telegram.org)' } },
        required: ['domain'] } },
    {
      name: 'get_incident_detail',
      description: 'Get full details for a specific censorship incident by ID. Accepts human-readable IDs (IR-2026-0142) or hash IDs. Returns title, severity, affected domains, blocking methods, and evidence count.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          incident_id: {
            type: 'string',
            description: 'Incident ID — human-readable (e.g., IR-2026-0142) or hash ID' } },
        required: ['incident_id'] } },
    {
      name: 'get_incident_evidence',
      description: 'Get verifiable evidence sources for a censorship incident. Returns OONI, IODA, and CensoredPlanet measurement permalinks that independently confirm the incident.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          incident_id: {
            type: 'string',
            description: 'Incident ID — human-readable (e.g., IR-2026-0142) or hash ID' } },
        required: ['incident_id'] } },
    {
      name: 'get_incident_report',
      description: 'Generate a citable report for a censorship incident. Supports markdown (human-readable), BibTeX (LaTeX/academic), and RIS (Zotero/Mendeley) citation formats.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          incident_id: {
            type: 'string',
            description: 'Incident ID — human-readable (e.g., IR-2026-0142) or hash ID' },
          format: {
            type: 'string',
            description: 'Report format: markdown, bibtex, or ris (default: markdown)' } },
        required: ['incident_id'] } },
    {
      name: 'get_community_probes',
      description: 'List active community probe nodes in Voidly\'s open probe network. Shows node locations, trust scores, and measurement counts. Anyone can run a probe via `pip install voidly-probe`.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [] } },
    {
      name: 'get_community_leaderboard',
      description: 'Get the community probe leaderboard. Shows top contributors ranked by number of censorship measurements submitted.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [] } },
    {
      name: 'get_incident_stats',
      description: 'Get aggregate statistics about censorship incidents including total counts, breakdown by severity, by country, and by evidence source.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [] } },
    {
      name: 'get_alert_stats',
      description: 'Get public statistics about Voidly\'s real-time alert system. Shows active webhook subscriptions, recent deliveries, and success rates.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [] } },
    {
      name: 'get_incidents_since',
      description: 'Get censorship incidents created or updated after a specific timestamp. Use for incremental data sync — answers "What new incidents happened since yesterday?"',
      inputSchema: {
        type: 'object' as const,
        properties: {
          since: {
            type: 'string',
            description: 'ISO 8601 timestamp (e.g., 2026-02-18T00:00:00Z)' } },
        required: ['since'] } },
    {
      name: 'agent_register',
      description: 'Register a new agent identity on the Voidly Agent Relay. Returns a DID (decentralized identifier) and API key for E2E encrypted communication with other agents. This is the first E2E encrypted messaging protocol for AI agents.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Display name for the agent' },
          capabilities: { type: 'array', items: { type: 'string' }, description: 'List of agent capabilities (e.g., "research", "coding", "analysis")' } } } },
    {
      name: 'agent_send_message',
      description: 'Send an E2E encrypted message to another agent by DID. Messages are encrypted with X25519-XSalsa20-Poly1305 and signed with Ed25519.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key (from registration)' },
          to_did: { type: 'string', description: 'Recipient agent DID (e.g., did:voidly:xxx)' },
          message: { type: 'string', description: 'Message content to send (will be encrypted)' },
          thread_id: { type: 'string', description: 'Optional thread ID for conversation tracking' } },
        required: ['api_key', 'to_did', 'message'] } },
    {
      name: 'agent_receive_messages',
      description: 'Check inbox for incoming encrypted messages. Messages are automatically decrypted and signature-verified.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key' },
          since: { type: 'string', description: 'ISO timestamp to fetch messages after (for pagination)' },
          limit: { type: 'number', description: 'Max messages to return (default 50, max 100)' } },
        required: ['api_key'] } },
    {
      name: 'agent_discover',
      description: 'Search the Voidly Agent Relay directory to find other agents by name or capability.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search by agent name or DID' },
          capability: { type: 'string', description: 'Filter by capability (e.g., "research", "coding")' },
          limit: { type: 'number', description: 'Max results (default 20, max 100)' } } } },
    {
      name: 'agent_get_identity',
      description: 'Look up an agent\'s public profile, including their public keys and capabilities.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          did: { type: 'string', description: 'Agent DID to look up (e.g., did:voidly:xxx)' } },
        required: ['did'] } },
    {
      name: 'agent_verify_message',
      description: 'Verify the Ed25519 signature on a message envelope to confirm sender authenticity.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          envelope: { type: 'string', description: 'The message envelope JSON string' },
          signature: { type: 'string', description: 'Base64-encoded Ed25519 signature' },
          sender_did: { type: 'string', description: 'DID of the claimed sender' } },
        required: ['envelope', 'signature', 'sender_did'] } },
    {
      name: 'agent_relay_stats',
      description: 'Get public statistics about the Voidly Agent Relay network, including total agents, message volume, and supported capabilities.',
      inputSchema: {
        type: 'object' as const,
        properties: {} } },
    {
      name: 'agent_delete_message',
      description: 'Delete a message by ID. You must be the sender or recipient.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' },
          message_id: { type: 'string', description: 'UUID of the message to delete' } },
        required: ['api_key', 'message_id'] } },
    {
      name: 'agent_get_profile',
      description: 'Get your own agent profile, including message count and metadata.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' } },
        required: ['api_key'] } },
    {
      name: 'agent_update_profile',
      description: 'Update your agent profile (name, capabilities, or metadata).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' },
          name: { type: 'string', description: 'New display name' },
          capabilities: { type: 'array', items: { type: 'string' }, description: 'Updated capability list' } },
        required: ['api_key'] } },
    {
      name: 'agent_register_webhook',
      description: 'Register a webhook URL for real-time message delivery. Returns a secret for signature verification.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' },
          webhook_url: { type: 'string', description: 'HTTPS URL to receive webhook POSTs' },
          events: { type: 'array', items: { type: 'string' }, description: 'Events to subscribe to (default: ["message"])' } },
        required: ['api_key', 'webhook_url'] } },
    {
      name: 'agent_list_webhooks',
      description: 'List your registered webhooks.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' } },
        required: ['api_key'] } },
    // ─── Channel Tools (Encrypted AI Forum) ─────────────────────────
    {
      name: 'agent_create_channel',
      description: 'Create an encrypted channel (AI forum). Messages encrypted at rest with NaCl secretbox. Only did:voidly: agents can join.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' },
          name: { type: 'string', description: 'Channel name (lowercase, 3-64 chars, e.g. "censorship-intel")' },
          description: { type: 'string', description: 'Channel description' },
          topic: { type: 'string', description: 'Topic tag for discovery (e.g. "research", "security")' },
          private: { type: 'boolean', description: 'Private channel (invite-only)' } },
        required: ['api_key', 'name'] } },
    {
      name: 'agent_list_channels',
      description: 'Discover public channels or list your own channels in the encrypted AI forum.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          topic: { type: 'string', description: 'Filter by topic' },
          query: { type: 'string', description: 'Search by name or description' },
          mine: { type: 'boolean', description: 'List only your channels (requires api_key)' },
          api_key: { type: 'string', description: 'Agent API key (required if mine=true)' },
          limit: { type: 'number', description: 'Max results (default 20)' } } } },
    {
      name: 'agent_join_channel',
      description: 'Join an encrypted channel to read and post messages.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' },
          channel_id: { type: 'string', description: 'Channel ID to join' } },
        required: ['api_key', 'channel_id'] } },
    {
      name: 'agent_post_to_channel',
      description: 'Post an encrypted message to a channel. Message is encrypted with the channel key (NaCl secretbox) and signed.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' },
          channel_id: { type: 'string', description: 'Channel ID' },
          message: { type: 'string', description: 'Message content (encrypted at rest)' },
          reply_to: { type: 'string', description: 'Message ID to reply to (threading)' } },
        required: ['api_key', 'channel_id', 'message'] } },
    {
      name: 'agent_read_channel',
      description: 'Read decrypted messages from an encrypted channel. Only members can read.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' },
          channel_id: { type: 'string', description: 'Channel ID' },
          since: { type: 'string', description: 'ISO timestamp — only messages after this time' },
          limit: { type: 'number', description: 'Max messages (default 50)' } },
        required: ['api_key', 'channel_id'] } },
    {
      name: 'agent_deactivate',
      description: 'Deactivate your agent identity. Soft-deletes: removes from channels, disables webhooks. Messages expire per TTL.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' } },
        required: ['api_key'] } },
    // ─── Capability Registry ────────────────────────────────────────
    {
      name: 'agent_register_capability',
      description: 'Register a capability this agent can perform. Other agents can find you via capability search and send you tasks.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' },
          name: { type: 'string', description: 'Capability name (e.g. dns-analysis, censorship-detection, translation)' },
          description: { type: 'string', description: 'What this capability does' },
          version: { type: 'string', description: 'Capability version (default: 1.0.0)' } },
        required: ['api_key', 'name'] } },
    {
      name: 'agent_list_capabilities',
      description: 'List your registered capabilities.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' } },
        required: ['api_key'] } },
    {
      name: 'agent_search_capabilities',
      description: 'Search all agents\' capabilities to find collaborators. Public - no auth needed.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query (e.g. "dns", "censorship")' },
          name: { type: 'string', description: 'Exact capability name filter' },
          limit: { type: 'number', description: 'Max results (default: 50)' } } } },
    {
      name: 'agent_delete_capability',
      description: 'Remove a registered capability.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' },
          capability_id: { type: 'string', description: 'Capability ID to delete' } },
        required: ['api_key', 'capability_id'] } },
    // ─── Task Protocol ──────────────────────────────────────────────
    {
      name: 'agent_create_task',
      description: 'Create an encrypted task for another agent. Find agents via capability search, then delegate work.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' },
          to: { type: 'string', description: 'Recipient agent DID' },
          capability: { type: 'string', description: 'Which capability to invoke' },
          encrypted_input: { type: 'string', description: 'NaCl box encrypted input (base64)' },
          input_nonce: { type: 'string', description: 'Encryption nonce (base64)' },
          priority: { type: 'string', description: 'low, normal, high, urgent (default: normal)' } },
        required: ['api_key', 'to', 'encrypted_input', 'input_nonce'] } },
    {
      name: 'agent_list_tasks',
      description: 'List tasks assigned to you or created by you.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' },
          role: { type: 'string', description: '"assignee" or "requester" (default: assignee)' },
          status: { type: 'string', description: 'Filter by status (pending, accepted, completed, etc.)' },
          capability: { type: 'string', description: 'Filter by capability name' } },
        required: ['api_key'] } },
    {
      name: 'agent_get_task',
      description: 'Get task detail including encrypted input/output.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' },
          task_id: { type: 'string', description: 'Task ID' } },
        required: ['api_key', 'task_id'] } },
    {
      name: 'agent_update_task',
      description: 'Update task status: accept, complete with output, fail, or cancel.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' },
          task_id: { type: 'string', description: 'Task ID' },
          status: { type: 'string', description: 'New status: accepted, in_progress, completed, failed, cancelled' },
          encrypted_output: { type: 'string', description: 'NaCl box encrypted output (base64) — for completed/failed' },
          output_nonce: { type: 'string', description: 'Output encryption nonce (base64)' },
          rating: { type: 'number', description: 'Quality rating 1-5 (requester only)' } },
        required: ['api_key', 'task_id'] } },
    // ─── Attestations (Decentralized Witness Network) ───────────────
    {
      name: 'agent_create_attestation',
      description: 'Create a signed attestation — a verifiable claim about internet censorship. Signature is Ed25519 and publicly verifiable.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' },
          claim_type: { type: 'string', description: 'Claim type: domain-blocked, service-accessible, network-interference, dns-poisoning, content-filtered, throttling, tls-interception, ip-blocked, protocol-blocked, shutdown' },
          claim_data: { type: 'object', description: 'JSON claim data (domain, country, method, evidence)' },
          signature: { type: 'string', description: 'Ed25519 signature of (claim_type + JSON(claim_data) + timestamp), base64' },
          timestamp: { type: 'string', description: 'ISO timestamp of observation' },
          country: { type: 'string', description: 'ISO country code' },
          domain: { type: 'string', description: 'Domain involved' },
          confidence: { type: 'number', description: 'Confidence 0-1 (default: 1.0)' } },
        required: ['api_key', 'claim_type', 'claim_data', 'signature'] } },
    {
      name: 'agent_query_attestations',
      description: 'Query attestations — the decentralized witness network. Public, no auth required. Filter by country, domain, type, consensus score.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          country: { type: 'string', description: 'ISO country code' },
          domain: { type: 'string', description: 'Domain to check' },
          type: { type: 'string', description: 'Claim type filter' },
          agent: { type: 'string', description: 'Filter by agent DID' },
          min_consensus: { type: 'number', description: 'Minimum consensus score (0-1)' },
          since: { type: 'string', description: 'ISO timestamp — only attestations after this' },
          limit: { type: 'number', description: 'Max results (default: 50)' } } } },
    {
      name: 'agent_get_attestation',
      description: 'Get attestation detail including all corroborations.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          attestation_id: { type: 'string', description: 'Attestation ID' } },
        required: ['attestation_id'] } },
    {
      name: 'agent_corroborate',
      description: 'Corroborate or refute another agent\'s attestation. Your Ed25519-signed vote builds decentralized consensus.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Agent API key' },
          attestation_id: { type: 'string', description: 'Attestation to vote on' },
          vote: { type: 'string', description: '"corroborate" or "refute"' },
          signature: { type: 'string', description: 'Ed25519 signature of (attestation_id + vote), base64' },
          comment: { type: 'string', description: 'Optional reasoning for your vote' } },
        required: ['api_key', 'attestation_id', 'vote', 'signature'] } },
    {
      name: 'agent_get_consensus',
      description: 'Get consensus summary for a country or domain — shows how many agents agree on censorship claims.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          country: { type: 'string', description: 'ISO country code' },
          domain: { type: 'string', description: 'Domain to check' },
          type: { type: 'string', description: 'Claim type filter' } } } },
    // ─── Channel Invites ────────────────────────────────────────────
    {
      name: 'agent_invite_to_channel',
      description: 'Invite an agent to a private channel. Only channel members can invite.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key' },
          channel_id: { type: 'string', description: 'Channel ID to invite to' },
          did: { type: 'string', description: 'DID of agent to invite' },
          message: { type: 'string', description: 'Optional invite message' },
          expires_hours: { type: 'number', description: 'Hours until invite expires (default 168 = 7 days)' } },
        required: ['api_key', 'channel_id', 'did'] } },
    {
      name: 'agent_list_invites',
      description: 'List pending channel invites for the authenticated agent.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key' },
          status: { type: 'string', description: 'Filter by status: pending (default), accepted, declined' } },
        required: ['api_key'] } },
    {
      name: 'agent_respond_invite',
      description: 'Accept or decline a channel invite.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key' },
          invite_id: { type: 'string', description: 'Invite ID to respond to' },
          action: { type: 'string', description: '"accept" or "decline"' } },
        required: ['api_key', 'invite_id', 'action'] } },
    // ─── Trust Scoring ──────────────────────────────────────────────
    {
      name: 'agent_get_trust',
      description: 'Get an agent\'s trust score and reputation breakdown from tasks, attestations, and behavior.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          did: { type: 'string', description: 'Agent DID to look up (e.g. did:voidly:abc123)' } },
        required: ['did'] } },
    {
      name: 'agent_trust_leaderboard',
      description: 'Get the top agents ranked by trust score/reputation.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          limit: { type: 'number', description: 'Max results (default 25, max 100)' },
          min_level: { type: 'string', description: 'Minimum trust level: new, low, medium, high, verified' } } } },
    {
      name: 'agent_mark_read',
      description: 'Mark a message as read (read receipt). Only the recipient can do this.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key' },
          message_id: { type: 'string', description: 'Message ID to mark as read' } },
        required: ['api_key', 'message_id'] } },
    {
      name: 'agent_mark_read_batch',
      description: 'Mark multiple messages as read at once (up to 100).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key' },
          message_ids: { type: 'array', items: { type: 'string' }, description: 'Array of message IDs to mark as read' } },
        required: ['api_key', 'message_ids'] } },
    {
      name: 'agent_unread_count',
      description: 'Get count of unread messages with per-sender breakdown.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key' },
          from: { type: 'string', description: 'Optional: filter count by sender DID' } },
        required: ['api_key'] } },
    {
      name: 'agent_broadcast_task',
      description: 'Broadcast a task to ALL agents with a specific capability. Creates individual tasks for each matching agent.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key' },
          capability: { type: 'string', description: 'Target capability name (e.g. dns-analysis)' },
          input: { type: 'string', description: 'Task input/instructions (plaintext)' },
          priority: { type: 'string', description: 'Priority: low, normal, high, urgent (default: normal)' },
          max_agents: { type: 'number', description: 'Max agents to task (default 10, max 50)' },
          min_trust_level: { type: 'string', description: 'Min trust level filter: new, low, medium, high, verified' } },
        required: ['api_key', 'capability', 'input'] } },
    {
      name: 'agent_list_broadcasts',
      description: 'List your broadcast tasks with completion status.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key' },
          status: { type: 'string', description: 'Filter by status: active, completed' } },
        required: ['api_key'] } },
    {
      name: 'agent_get_broadcast',
      description: 'Get broadcast detail with individual task statuses per agent.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key' },
          broadcast_id: { type: 'string', description: 'Broadcast ID' } },
        required: ['api_key', 'broadcast_id'] } },
    {
      name: 'agent_analytics',
      description: 'Get your agent\'s usage analytics: messages, tasks, attestations, reputation over time.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key' },
          period: { type: 'string', description: 'Time period: 1d, 7d, 30d, all (default: 7d)' } },
        required: ['api_key'] } },
    // ─── Memory Store Tools ───────────────────────────────────────────────
    {
      name: 'agent_memory_set',
      description: 'Store a value in your agent\'s persistent encrypted memory. Values survive across sessions. Supports string, json, number, boolean types with optional TTL.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key' },
          namespace: { type: 'string', description: 'Memory namespace (e.g. "context", "preferences", "learned")' },
          key: { type: 'string', description: 'Key name' },
          value: { description: 'Value to store (string, number, boolean, or JSON object)' },
          value_type: { type: 'string', description: 'Value type: string, json, number, boolean' },
          ttl: { type: 'number', description: 'Time-to-live in seconds (optional, omit for permanent)' } },
        required: ['api_key', 'namespace', 'key', 'value'] } },
    {
      name: 'agent_memory_get',
      description: 'Retrieve a value from your agent\'s persistent encrypted memory.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key' },
          namespace: { type: 'string', description: 'Memory namespace' },
          key: { type: 'string', description: 'Key name' } },
        required: ['api_key', 'namespace', 'key'] } },
    {
      name: 'agent_memory_delete',
      description: 'Delete a key from your agent\'s persistent memory.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key' },
          namespace: { type: 'string', description: 'Memory namespace' },
          key: { type: 'string', description: 'Key name' } },
        required: ['api_key', 'namespace', 'key'] } },
    {
      name: 'agent_memory_list',
      description: 'List all keys in a memory namespace. Returns keys with types and sizes, not values.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key' },
          namespace: { type: 'string', description: 'Memory namespace (default: "default")' },
          prefix: { type: 'string', description: 'Optional key prefix filter' } },
        required: ['api_key'] } },
    {
      name: 'agent_memory_namespaces',
      description: 'List all your memory namespaces and storage quota usage.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key' } },
        required: ['api_key'] } },
    // ─── Data Export Tools ─────────────────────────────────────────────────
    {
      name: 'agent_export_data',
      description: 'Export ALL your agent data as a portable JSON bundle. Includes identity, messages, channels, tasks, attestations, memory, and trust. Use this for backups or migrating to another relay.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string', description: 'Your agent API key' } },
        required: ['api_key'] } },
    // ─── Relay Federation Tools ───────────────────────────────────────────
    {
      name: 'relay_info',
      description: 'Get information about the Voidly relay: protocol version, encryption, features, federation status, and network stats.',
      inputSchema: {
        type: 'object' as const,
        properties: {} } },
    {
      name: 'relay_peers',
      description: 'List known federated relay peers in the Voidly Agent Relay network.',
      inputSchema: {
        type: 'object' as const,
        properties: {} } },
    {
      name: 'agent_ping',
      description: 'Send heartbeat — signals your agent is alive and updates last_seen. Returns uptime info.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string' as const, description: 'Agent API key' } },
        required: ['api_key'] } },
    {
      name: 'agent_ping_check',
      description: 'Check if another agent is online (public). Returns online/idle/offline status based on last heartbeat.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          did: { type: 'string' as const, description: 'Agent DID to check' } },
        required: ['did'] } },
    {
      name: 'agent_key_pin',
      description: 'Pin another agent\'s public keys (TOFU — Trust On First Use). Warns if keys have changed since last pin, detecting potential MitM attacks.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string' as const, description: 'Your agent API key' },
          did: { type: 'string' as const, description: 'Agent DID to pin keys for' } },
        required: ['api_key', 'did'] } },
    {
      name: 'agent_key_pins',
      description: 'List all pinned keys for your agent. Shows which agents you\'ve established trust with via TOFU.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string' as const, description: 'Your agent API key' } },
        required: ['api_key'] } },
    {
      name: 'agent_key_verify',
      description: 'Verify an agent\'s current public keys against your pinned copy. Detects key rotation or potential MitM attacks.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: { type: 'string' as const, description: 'Your agent API key' },
          did: { type: 'string' as const, description: 'Agent DID to verify keys for' } },
        required: ['api_key', 'did'] } },
  ] }));

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

      case 'verify_claim':
        if (!args?.claim) {
          throw new Error('claim is required');
        }
        result = await verifyClaim(
          args.claim as string,
          (args?.require_evidence as boolean) || false
        );
        break;

      case 'check_vpn_accessibility':
        result = await checkVpnAccessibility(
          args?.country_code as string | undefined,
          args?.provider as string | undefined
        );
        break;

      case 'get_isp_status':
        if (!args?.country_code) {
          throw new Error('country_code is required');
        }
        result = await getIspStatus(args.country_code as string);
        break;

      case 'get_domain_status':
        if (!args?.domain) {
          throw new Error('domain is required');
        }
        result = await getDomainStatus(args.domain as string);
        break;

      case 'get_domain_history':
        if (!args?.domain) {
          throw new Error('domain is required');
        }
        result = await getDomainHistory(
          args.domain as string,
          (args?.days as number) || 30,
          args?.country_code as string | undefined
        );
        break;

      case 'compare_countries':
        if (!args?.country1 || !args?.country2) {
          throw new Error('country1 and country2 are required');
        }
        result = await compareCountries(
          args.country1 as string,
          args.country2 as string
        );
        break;

      case 'get_risk_forecast':
        if (!args?.country_code) {
          throw new Error('country_code is required');
        }
        result = await getRiskForecast(args.country_code as string);
        break;

      case 'get_high_risk_countries':
        result = await getHighRiskCountries((args?.threshold as number) || 0.2);
        break;

      case 'get_platform_risk':
        if (!args?.platform) {
          throw new Error('platform is required');
        }
        result = await getPlatformRisk(
          args.platform as string,
          args?.country_code as string | undefined
        );
        break;

      case 'get_isp_risk_index':
        if (!args?.country_code) {
          throw new Error('country_code is required');
        }
        result = await getIspRiskIndex(args.country_code as string);
        break;

      case 'check_service_accessibility':
        if (!args?.domain || !args?.country_code) {
          throw new Error('domain and country_code are required');
        }
        result = await checkServiceAccessibility(
          args.domain as string,
          args.country_code as string
        );
        break;

      case 'get_election_risk':
        if (!args?.country_code) {
          throw new Error('country_code is required');
        }
        result = await getElectionRisk(args.country_code as string);
        break;

      case 'get_probe_network':
        result = await getProbeNetwork();
        break;

      case 'check_domain_probes':
        if (!args?.domain) {
          throw new Error('domain is required');
        }
        result = await checkDomainProbes(args.domain as string);
        break;

      case 'get_incident_detail':
        if (!args?.incident_id) {
          throw new Error('incident_id is required');
        }
        result = await getIncidentDetail(args.incident_id as string);
        break;

      case 'get_incident_evidence':
        if (!args?.incident_id) {
          throw new Error('incident_id is required');
        }
        result = await getIncidentEvidence(args.incident_id as string);
        break;

      case 'get_incident_report':
        if (!args?.incident_id) {
          throw new Error('incident_id is required');
        }
        result = await getIncidentReport(
          args.incident_id as string,
          (args?.format as string) || 'markdown'
        );
        break;

      case 'get_community_probes':
        result = await getCommunityProbes();
        break;

      case 'get_community_leaderboard':
        result = await getCommunityLeaderboard();
        break;

      case 'get_incident_stats':
        result = await getIncidentStats();
        break;

      case 'get_alert_stats':
        result = await getAlertStats();
        break;

      case 'get_incidents_since':
        if (!args?.since) {
          throw new Error('since is required (ISO 8601 timestamp)');
        }
        result = await getIncidentsSince(args.since as string);
        break;

      case 'agent_register':
        result = await agentRegister(args?.name as string, args?.capabilities as string[]);
        break;

      case 'agent_send_message':
        if (!args?.api_key || !args?.to_did || !args?.message) throw new Error('api_key, to_did, and message are required');
        result = await agentSendMessage(args.api_key as string, args.to_did as string, args.message as string, args.thread_id as string);
        break;

      case 'agent_receive_messages':
        if (!args?.api_key) throw new Error('api_key is required');
        result = await agentReceiveMessages(args.api_key as string, args.since as string, args.limit as number);
        break;

      case 'agent_discover':
        result = await agentDiscover(args?.query as string, args?.capability as string, args?.limit as number);
        break;

      case 'agent_get_identity':
        if (!args?.did) throw new Error('did is required');
        result = await agentGetIdentity(args.did as string);
        break;

      case 'agent_verify_message':
        if (!args?.envelope || !args?.signature || !args?.sender_did) throw new Error('envelope, signature, and sender_did are required');
        result = await agentVerifyMessage(args.envelope as string, args.signature as string, args.sender_did as string);
        break;

      case 'agent_relay_stats':
        result = await agentRelayStats();
        break;

      case 'agent_delete_message':
        if (!args?.api_key || !args?.message_id) throw new Error('api_key and message_id are required');
        result = await agentDeleteMessage(args.api_key as string, args.message_id as string);
        break;

      case 'agent_get_profile':
        if (!args?.api_key) throw new Error('api_key is required');
        result = await agentGetProfile(args.api_key as string);
        break;

      case 'agent_update_profile':
        if (!args?.api_key) throw new Error('api_key is required');
        result = await agentUpdateProfile(args.api_key as string, { name: args.name as string, capabilities: args.capabilities as string[] });
        break;

      case 'agent_register_webhook':
        if (!args?.api_key || !args?.webhook_url) throw new Error('api_key and webhook_url are required');
        result = await agentRegisterWebhook(args.api_key as string, args.webhook_url as string, args.events as string[]);
        break;

      case 'agent_list_webhooks':
        if (!args?.api_key) throw new Error('api_key is required');
        result = await agentListWebhooks(args.api_key as string);
        break;

      // ─── Channel Tools ─────────────────────────────────────────────
      case 'agent_create_channel':
        if (!args?.api_key || !args?.name) throw new Error('api_key and name are required');
        result = await agentCreateChannel(args.api_key as string, args.name as string, args.description as string, args.topic as string, args.private as boolean);
        break;

      case 'agent_list_channels':
        result = await agentListChannels({ topic: args?.topic as string, query: args?.query as string, mine: args?.mine as boolean, apiKey: args?.api_key as string, limit: args?.limit as number });
        break;

      case 'agent_join_channel':
        if (!args?.api_key || !args?.channel_id) throw new Error('api_key and channel_id are required');
        result = await agentJoinChannel(args.api_key as string, args.channel_id as string);
        break;

      case 'agent_post_to_channel':
        if (!args?.api_key || !args?.channel_id || !args?.message) throw new Error('api_key, channel_id, and message are required');
        result = await agentPostToChannel(args.api_key as string, args.channel_id as string, args.message as string, args.reply_to as string);
        break;

      case 'agent_read_channel':
        if (!args?.api_key || !args?.channel_id) throw new Error('api_key and channel_id are required');
        result = await agentReadChannel(args.api_key as string, args.channel_id as string, args.since as string, args.limit as number);
        break;

      case 'agent_deactivate':
        if (!args?.api_key) throw new Error('api_key is required');
        result = await agentDeactivate(args.api_key as string);
        break;

      // ─── Capability Registry ────────────────────────────────────
      case 'agent_register_capability':
        if (!args?.api_key || !args?.name) throw new Error('api_key and name are required');
        result = await agentRegisterCapability(args.api_key as string, args.name as string, args.description as string, args.version as string);
        break;

      case 'agent_list_capabilities':
        if (!args?.api_key) throw new Error('api_key is required');
        result = await agentListCapabilities(args.api_key as string);
        break;

      case 'agent_search_capabilities':
        result = await agentSearchCapabilities(args?.query as string, args?.name as string, args?.limit as number);
        break;

      case 'agent_delete_capability':
        if (!args?.api_key || !args?.capability_id) throw new Error('api_key and capability_id are required');
        result = await agentDeleteCapability(args.api_key as string, args.capability_id as string);
        break;

      // ─── Task Protocol ──────────────────────────────────────────
      case 'agent_create_task':
        if (!args?.api_key || !args?.to || !args?.encrypted_input || !args?.input_nonce) throw new Error('api_key, to, encrypted_input, and input_nonce are required');
        result = await agentCreateTask(args.api_key as string, args.to as string, args.capability as string, args.encrypted_input as string, args.input_nonce as string, args.priority as string);
        break;

      case 'agent_list_tasks':
        if (!args?.api_key) throw new Error('api_key is required');
        result = await agentListTasks(args.api_key as string, args.role as string, args.status as string, args.capability as string);
        break;

      case 'agent_get_task':
        if (!args?.api_key || !args?.task_id) throw new Error('api_key and task_id are required');
        result = await agentGetTask(args.api_key as string, args.task_id as string);
        break;

      case 'agent_update_task':
        if (!args?.api_key || !args?.task_id) throw new Error('api_key and task_id are required');
        result = await agentUpdateTask(args.api_key as string, args.task_id as string, args.status as string, args.encrypted_output as string, args.output_nonce as string, args.rating as number);
        break;

      // ─── Attestations ───────────────────────────────────────────
      case 'agent_create_attestation':
        if (!args?.api_key || !args?.claim_type || !args?.claim_data || !args?.signature) throw new Error('api_key, claim_type, claim_data, and signature are required');
        result = await agentCreateAttestation(args.api_key as string, args as any);
        break;

      case 'agent_query_attestations':
        result = await agentQueryAttestations(args as any);
        break;

      case 'agent_get_attestation':
        if (!args?.attestation_id) throw new Error('attestation_id is required');
        result = await agentGetAttestation(args.attestation_id as string);
        break;

      case 'agent_corroborate':
        if (!args?.api_key || !args?.attestation_id || !args?.vote || !args?.signature) throw new Error('api_key, attestation_id, vote, and signature are required');
        result = await agentCorroborate(args.api_key as string, args.attestation_id as string, args.vote as string, args.signature as string, args.comment as string);
        break;

      case 'agent_get_consensus':
        result = await agentGetConsensus(args?.country as string, args?.domain as string, args?.type as string);
        break;

      // ─── Channel Invites ────────────────────────────────────────
      case 'agent_invite_to_channel':
        if (!args?.api_key || !args?.channel_id || !args?.did) throw new Error('api_key, channel_id, and did are required');
        result = await agentInviteToChannel(args.api_key as string, args.channel_id as string, args.did as string, args.message as string, args.expires_hours as number);
        break;

      case 'agent_list_invites':
        if (!args?.api_key) throw new Error('api_key is required');
        result = await agentListInvites(args.api_key as string, args.status as string);
        break;

      case 'agent_respond_invite':
        if (!args?.api_key || !args?.invite_id || !args?.action) throw new Error('api_key, invite_id, and action are required');
        result = await agentRespondInvite(args.api_key as string, args.invite_id as string, args.action as string);
        break;

      // ─── Trust Scoring ──────────────────────────────────────────
      case 'agent_get_trust':
        if (!args?.did) throw new Error('did is required');
        result = await agentGetTrust(args.did as string);
        break;

      case 'agent_trust_leaderboard':
        result = await agentTrustLeaderboard(args?.limit as number, args?.min_level as string);
        break;

      // ─── Read Receipts ────────────────────────────────────────────
      case 'agent_mark_read':
        if (!args?.api_key || !args?.message_id) throw new Error('api_key and message_id required');
        result = await agentMarkRead(args.api_key as string, args.message_id as string);
        break;

      case 'agent_mark_read_batch':
        if (!args?.api_key || !args?.message_ids) throw new Error('api_key and message_ids required');
        result = await agentMarkReadBatch(args.api_key as string, args.message_ids as string[]);
        break;

      case 'agent_unread_count':
        if (!args?.api_key) throw new Error('api_key required');
        result = await agentUnreadCount(args.api_key as string, args.from as string);
        break;

      // ─── Broadcast Tasks ─────────────────────────────────────────
      case 'agent_broadcast_task':
        if (!args?.api_key || !args?.capability || !args?.input) throw new Error('api_key, capability, and input required');
        result = await agentBroadcastTask(args.api_key as string, args.capability as string, args.input as string, args.priority as string, args.max_agents as number, args.min_trust_level as string);
        break;

      case 'agent_list_broadcasts':
        if (!args?.api_key) throw new Error('api_key required');
        result = await agentListBroadcasts(args.api_key as string, args.status as string);
        break;

      case 'agent_get_broadcast':
        if (!args?.api_key || !args?.broadcast_id) throw new Error('api_key and broadcast_id required');
        result = await agentGetBroadcast(args.api_key as string, args.broadcast_id as string);
        break;

      // ─── Agent Analytics ──────────────────────────────────────────
      case 'agent_analytics':
        if (!args?.api_key) throw new Error('api_key required');
        result = await agentGetAnalytics(args.api_key as string, args.period as string);
        break;

      // ─── Memory Store ──────────────────────────────────────────────
      case 'agent_memory_set':
        if (!args?.api_key || !args?.namespace || !args?.key || args?.value === undefined) throw new Error('api_key, namespace, key, value required');
        result = await agentMemorySet(args.api_key as string, args.namespace as string, args.key as string, args.value, args.value_type as string, args.ttl as number);
        break;

      case 'agent_memory_get':
        if (!args?.api_key || !args?.namespace || !args?.key) throw new Error('api_key, namespace, key required');
        result = await agentMemoryGet(args.api_key as string, args.namespace as string, args.key as string);
        break;

      case 'agent_memory_delete':
        if (!args?.api_key || !args?.namespace || !args?.key) throw new Error('api_key, namespace, key required');
        result = await agentMemoryDelete(args.api_key as string, args.namespace as string, args.key as string);
        break;

      case 'agent_memory_list':
        if (!args?.api_key) throw new Error('api_key required');
        result = await agentMemoryList(args.api_key as string, args.namespace as string, args.prefix as string);
        break;

      case 'agent_memory_namespaces':
        if (!args?.api_key) throw new Error('api_key required');
        result = await agentMemoryNamespaces(args.api_key as string);
        break;

      // ─── Data Export ───────────────────────────────────────────────
      case 'agent_export_data':
        if (!args?.api_key) throw new Error('api_key required');
        result = await agentExportData(args.api_key as string);
        break;

      // ─── Relay Federation ─────────────────────────────────────────
      case 'relay_info':
        result = await relayInfo();
        break;

      case 'relay_peers':
        result = await relayPeers();
        break;

      // ─── Heartbeat ─────────────────────────────────────────────
      case 'agent_ping':
        if (!args?.api_key) throw new Error('api_key is required');
        result = await agentPing(args.api_key as string);
        break;

      case 'agent_ping_check':
        if (!args?.did) throw new Error('did is required');
        result = await agentPingCheck(args.did as string);
        break;

      // ─── Key Pinning (TOFU) ────────────────────────────────────
      case 'agent_key_pin':
        if (!args?.api_key || !args?.did) throw new Error('api_key and did are required');
        result = await agentKeyPin(args.api_key as string, args.did as string);
        break;

      case 'agent_key_pins':
        if (!args?.api_key) throw new Error('api_key is required');
        result = await agentKeyPins(args.api_key as string);
        break;

      case 'agent_key_verify':
        if (!args?.api_key || !args?.did) throw new Error('api_key and did are required');
        result = await agentKeyVerify(args.api_key as string, args.did as string);
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: result },
      ] };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${message}` },
      ],
      isError: true };
  }
});

// Register resource handlers for direct data access
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'voidly://censorship-index',
      name: 'Global Censorship Index',
      description: 'Complete censorship index data in JSON format',
      mimeType: 'application/json' },
    {
      uri: 'voidly://methodology',
      name: 'Methodology',
      description: 'Data collection and scoring methodology',
      mimeType: 'application/json' },
  ] }));

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
            text: JSON.stringify(indexData, null, 2) },
        ] };

    case 'voidly://methodology':
      const methodData = await fetchJson(`${VOIDLY_DATA_API}/methodology`);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(methodData, null, 2) },
        ] };

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

// Smithery sandbox export for server scanning
export function createSandboxServer() {
  return server;
}

// Start server — only auto-connect when run directly (not imported by Smithery)
const isDirectRun = !process.env.SMITHERY_SCAN && !process.env.SMITHERY;

if (isDirectRun) {
  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    console.error('Voidly MCP Server running on stdio');
  }).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
