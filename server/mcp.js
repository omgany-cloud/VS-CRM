// MCP (Model Context Protocol) layer over the same curated external API as
// server/externalApi.js — same 4 read-only scopes (read:lp/read:portfolio/
// read:deals/read:funds), same API-key identity space, same tenant scoping.
// This is deliberately a thin wrapper, not a second copy of the query
// logic: every tool below runs the exact same SELECT the equivalent REST
// route does, so the two surfaces can never drift apart on what data they
// expose.
//
// One McpServer + one StreamableHTTPServerTransport per HTTP request
// (stateless mode: sessionIdGenerator left undefined) rather than a
// long-lived session — matches how requireApiKey already treats every
// request independently, and sidesteps needing a session store that maps
// an MCP session id back to a tenant.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { db } = require('./db');
const { rowToLp, withLiveFinancials } = require('./lpMapping');
const { rowToDeal } = require('./dealMapping');
const { rowToPortfolio } = require('./portfolioMapping');
const { rowToFund } = require('./fundMapping');

// Tool callbacks throw a scope error rather than letting requireApiKey
// reject the whole request the way the REST routes do — a single MCP
// connection lists ALL four tools regardless of the key's actual scopes
// (so the caller can see what exists), and only refuses at call time.
// Returning { isError: true } (not throwing past the SDK) is the
// documented way to signal a tool-level failure without it looking like a
// transport/protocol error to the client.
function scopeErrorResult(scope) {
  return { isError: true, content: [{ type: 'text', text: `This API key does not have the '${scope}' scope.` }] };
}

function jsonResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

// req must already be authenticated by requireApiKey() (no specific scope
// required at that middleware — this builds one server per request, and
// each tool checks its own scope against req.apiKey.scopes individually).
function buildMcpServer(req) {
  const server = new McpServer({ name: 'turan-crm', version: '1.0.0' });
  const hasScope = (scope) => req.apiKey.scopes.includes(scope);

  server.registerTool('list_lp', {
    title: 'List LP Register',
    description: "Returns the fund's Limited Partner register for the authenticated tenant — name, commitment, called/paid amounts, distributions, ownership %, KYC status, and document links. Requires the 'read:lp' scope.",
    inputSchema: {},
  }, async () => {
    if (!hasScope('read:lp')) return scopeErrorResult('read:lp');
    const rows = db.prepare('SELECT * FROM lp_register WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
    return jsonResult(rows.map(r => withLiveFinancials(db, req.tenantId, r.id, rowToLp(r))));
  });

  server.registerTool('list_portfolio', {
    title: 'List Portfolio Companies',
    description: "Returns the fund's portfolio companies for the authenticated tenant — invested/current value, sector, status, monitoring and financial data. Requires the 'read:portfolio' scope.",
    inputSchema: {},
  }, async () => {
    if (!hasScope('read:portfolio')) return scopeErrorResult('read:portfolio');
    const rows = db.prepare('SELECT * FROM portfolio WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
    return jsonResult(rows.map(rowToPortfolio));
  });

  server.registerTool('list_deals', {
    title: 'List Deal Pipeline',
    description: "Returns the fund's deal pipeline for the authenticated tenant — company, sector, stage, amount, IC status, and related metadata. Requires the 'read:deals' scope.",
    inputSchema: {},
  }, async () => {
    if (!hasScope('read:deals')) return scopeErrorResult('read:deals');
    const rows = db.prepare('SELECT * FROM deals WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
    return jsonResult(rows.map(rowToDeal));
  });

  server.registerTool('list_funds', {
    title: 'List Funds',
    description: "Returns the funds managed under the authenticated tenant — name, GP, currency, target size, vintage, status, and economics (management fee, carry, preferred return). Requires the 'read:funds' scope.",
    inputSchema: {},
  }, async () => {
    if (!hasScope('read:funds')) return scopeErrorResult('read:funds');
    const rows = db.prepare('SELECT * FROM funds WHERE tenant_id = ? ORDER BY id').all(req.tenantId);
    return jsonResult(rows.map(rowToFund));
  });

  return server;
}

// Express handler for POST /api/v1/external/mcp — mount behind
// requireApiKey() (no scope arg: this endpoint authenticates the key but
// doesn't gate on any one scope, since it hosts all four tools at once)
// and the same apiKeyRateLimit as the REST routes.
async function handleMcpRequest(req, res) {
  const server = buildMcpServer(req);
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close();
      server.close();
    });
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
}

// GET/DELETE are part of the Streamable HTTP spec (resumable streams /
// explicit session teardown) but only meaningful in stateful mode — this
// server never hands out a session id, so there's nothing for either to
// do. Same 405 shape the SDK's own stateless example returns.
function methodNotAllowed(req, res) {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
}

module.exports = { handleMcpRequest, methodNotAllowed };
