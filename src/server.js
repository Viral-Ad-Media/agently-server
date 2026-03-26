import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";

import {
  AGENT_LANGUAGES,
  AGENT_TONES,
  AGENT_VOICES,
  CALL_OUTCOMES,
  CHATBOT_POSITIONS,
  PLAN_LIMITS,
  VOICE_AGENT_DIRECTIONS,
  createChatbot,
  createDefaultState,
  createVoiceAgent,
  normalizeWorkspaceState,
} from "./defaults.js";
import { createStore } from "./store.js";
import {
  buildTwimlResponse,
  createTwilioCall,
  resolveTwilioConfig,
  twimlDial,
  twimlGather,
  twimlHangup,
  twimlPause,
  twimlSay,
  validateTwilioSignature,
} from "./twilio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORT = Number(process.env.PORT || 4000);
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_DATA_FILE = process.env.AGENTLY_DATA_FILE || path.join(__dirname, "..", "data", "store.json");
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

const BODY_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const PUBLIC_ROUTES = new Set([
  "GET /",
  "GET /health",
  "GET /api",
  "GET /api/docs",
  "GET /embed/chatbot.js",
  "POST /api/auth/login",
  "POST /api/auth/register",
  "POST /api/auth/magic-link",
  "POST /api/auth/magic-link/verify",
  "GET /api/public/chatbots/:id/config",
  "POST /api/public/chatbots/:id/messages",
  "POST /api/contact",
  "POST /api/contact-sales",
  "POST /api/twilio/voice/:id/inbound",
  "POST /api/twilio/voice/:id/continue",
  "POST /api/twilio/voice/:id/outbound/:sessionId/twiml",
  "POST /api/twilio/voice/:id/outbound/:sessionId/continue",
  "POST /api/twilio/voice/status",
]);

const ROUTE_DOCS = [
  { method: "GET", path: "/", auth: false, description: "Root landing response for serverless platforms and uptime checks." },
  { method: "GET", path: "/health", auth: false, description: "Simple uptime and health check." },
  { method: "GET", path: "/api", auth: false, description: "Small API landing response with version and docs link." },
  { method: "GET", path: "/api/docs", auth: false, description: "Structured list of every available endpoint." },
  { method: "GET", path: "/embed/chatbot.js", auth: false, description: "Embeddable widget script for public website chatbot deployments." },
  { method: "POST", path: "/api/auth/login", auth: false, description: "Password login for an existing workspace member." },
  { method: "POST", path: "/api/auth/register", auth: false, description: "Create a new owner session and bootstrap the workspace." },
  { method: "POST", path: "/api/auth/magic-link", auth: false, description: "Create a one-time sign-in link token." },
  { method: "POST", path: "/api/auth/magic-link/verify", auth: false, description: "Exchange a magic-link token for a session." },
  { method: "GET", path: "/api/auth/me", auth: true, description: "Return the authenticated user and session summary." },
  { method: "POST", path: "/api/auth/logout", auth: true, description: "Invalidate the current bearer token." },
  { method: "GET", path: "/api/bootstrap", auth: true, description: "Return the full dashboard bootstrap payload." },
  { method: "GET", path: "/api/dashboard", auth: true, description: "Return dashboard KPIs, charts, and recent activity." },
  { method: "GET", path: "/api/organization", auth: true, description: "Return the current organization record." },
  { method: "PATCH", path: "/api/organization/profile", auth: true, description: "Update organization profile fields used during onboarding." },
  { method: "GET", path: "/api/settings", auth: true, description: "Return organization settings used by the settings screen." },
  { method: "PATCH", path: "/api/settings", auth: true, description: "Update organization settings like timezone or phone number." },
  { method: "POST", path: "/api/onboarding/faqs", auth: true, description: "Generate starter FAQ entries from a website URL." },
  { method: "POST", path: "/api/onboarding/complete", auth: true, description: "Persist onboarding profile and agent configuration." },
  { method: "GET", path: "/api/voice-agents", auth: true, description: "List all configured voice agents." },
  { method: "POST", path: "/api/voice-agents", auth: true, description: "Create a new voice agent." },
  { method: "PATCH", path: "/api/voice-agents/:id", auth: true, description: "Update a specific voice agent." },
  { method: "DELETE", path: "/api/voice-agents/:id", auth: true, description: "Delete a non-last voice agent." },
  { method: "POST", path: "/api/voice-agents/:id/activate", auth: true, description: "Set the active voice agent used across the workspace." },
  { method: "POST", path: "/api/voice-agents/:id/outbound-calls", auth: true, description: "Launch a real outbound Twilio call from a configured outbound voice agent." },
  { method: "GET", path: "/api/agent", auth: true, description: "Return the current agent configuration." },
  { method: "PATCH", path: "/api/agent", auth: true, description: "Update agent configuration and nested rules." },
  { method: "GET", path: "/api/agent/faqs", auth: true, description: "Return the agent FAQ list." },
  { method: "POST", path: "/api/agent/faqs", auth: true, description: "Create a custom FAQ entry." },
  { method: "PATCH", path: "/api/agent/faqs/:id", auth: true, description: "Update a single FAQ entry." },
  { method: "DELETE", path: "/api/agent/faqs/:id", auth: true, description: "Delete a single FAQ entry." },
  { method: "POST", path: "/api/agent/faqs/sync", auth: true, description: "Regenerate FAQs from the organization website and replace the list." },
  { method: "POST", path: "/api/agent/restart", auth: true, description: "Record a restart event for the agent." },
  { method: "GET", path: "/api/chatbots", auth: true, description: "List all configured chatbots and their embed snippets." },
  { method: "POST", path: "/api/chatbots", auth: true, description: "Create a new customizable chatbot." },
  { method: "PATCH", path: "/api/chatbots/:id", auth: true, description: "Update chatbot appearance, behavior, or linked voice agent." },
  { method: "DELETE", path: "/api/chatbots/:id", auth: true, description: "Delete a non-last chatbot." },
  { method: "POST", path: "/api/chatbots/:id/activate", auth: true, description: "Set the active chatbot used in the workspace preview." },
  { method: "GET", path: "/api/chatbots/:id/embed", auth: true, description: "Return the embeddable script snippet for a chatbot." },
  { method: "GET", path: "/api/messenger/messages", auth: true, description: "Return the current messenger thread." },
  { method: "POST", path: "/api/messenger/messages", auth: true, description: "Append a user message and generate an agent reply." },
  { method: "DELETE", path: "/api/messenger/messages", auth: true, description: "Reset the messenger thread back to the greeting state." },
  { method: "GET", path: "/api/public/chatbots/:id/config", auth: false, description: "Return public widget configuration for a chatbot." },
  { method: "POST", path: "/api/public/chatbots/:id/messages", auth: false, description: "Generate a public widget reply for an embedded chatbot." },
  { method: "GET", path: "/api/calls", auth: true, description: "List calls with search and outcome filters." },
  { method: "POST", path: "/api/calls/simulate", auth: true, description: "Create a simulated call, summary, and optional lead." },
  { method: "GET", path: "/api/calls/:id", auth: true, description: "Return a single call record." },
  { method: "GET", path: "/api/calls/:id/transcript", auth: true, description: "Return transcript lines for a call." },
  { method: "GET", path: "/api/calls/:id/report", auth: true, description: "Download a text report for a call." },
  { method: "GET", path: "/api/leads", auth: true, description: "List leads with search and status filters." },
  { method: "POST", path: "/api/leads", auth: true, description: "Create a lead manually." },
  { method: "PATCH", path: "/api/leads/:id", auth: true, description: "Update a lead status or contact information." },
  { method: "DELETE", path: "/api/leads/:id", auth: true, description: "Delete a lead." },
  { method: "GET", path: "/api/leads/export.csv", auth: true, description: "Export leads as CSV." },
  { method: "GET", path: "/api/team/members", auth: true, description: "List current organization members." },
  { method: "POST", path: "/api/team/invitations", auth: true, description: "Create and send a team invitation." },
  { method: "PATCH", path: "/api/team/members/:id", auth: true, description: "Update a member role." },
  { method: "DELETE", path: "/api/team/members/:id", auth: true, description: "Remove a non-owner team member." },
  { method: "GET", path: "/api/billing", auth: true, description: "Return billing summary, usage, and invoices." },
  { method: "PATCH", path: "/api/billing/plan", auth: true, description: "Change the active subscription plan and limits." },
  { method: "POST", path: "/api/billing/cancel", auth: true, description: "Cancel the active plan." },
  { method: "GET", path: "/api/billing/invoices", auth: true, description: "List invoices." },
  { method: "GET", path: "/api/billing/invoices/:id", auth: true, description: "Return invoice metadata." },
  { method: "GET", path: "/api/billing/invoices/:id/download", auth: true, description: "Download a plain-text invoice receipt." },
  { method: "POST", path: "/api/contact", auth: false, description: "Submit a public contact form message." },
  { method: "POST", path: "/api/contact-sales", auth: false, description: "Submit a pricing or enterprise sales inquiry." },
  { method: "POST", path: "/api/twilio/voice/:id/inbound", auth: false, description: "Twilio inbound voice webhook that starts a live inbound agent conversation." },
  { method: "POST", path: "/api/twilio/voice/:id/continue", auth: false, description: "Twilio Gather callback that continues an inbound voice-agent conversation." },
  { method: "POST", path: "/api/twilio/voice/:id/outbound/:sessionId/twiml", auth: false, description: "Twilio webhook that serves outbound call instructions for a launched voice agent call." },
  { method: "POST", path: "/api/twilio/voice/:id/outbound/:sessionId/continue", auth: false, description: "Twilio Gather callback that continues an outbound voice-agent conversation." },
  { method: "POST", path: "/api/twilio/voice/status", auth: false, description: "Twilio status callback for inbound and outbound call lifecycle updates." },
];

const KNOWN_ROUTE_KEYS = new Set(ROUTE_DOCS.map((entry) => `${entry.method} ${entry.path}`));

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

const nowIso = () => new Date().toISOString();

const getCorsOrigin = (pathname = "") => (
  pathname.startsWith("/api/public/") || pathname.startsWith("/embed/")
    ? "*"
    : ALLOWED_ORIGIN
);

const setCorsHeaders = (res) => {
  res.setHeader("Access-Control-Allow-Origin", getCorsOrigin(res.__corsPathname || ""));
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
};

const sendJson = (res, statusCode, payload) => {
  setCorsHeaders(res);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
};

const sendText = (res, statusCode, text, headers = {}) => {
  setCorsHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    ...headers,
  });
  res.end(text);
};

const sendXml = (res, statusCode, xml) => {
  setCorsHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": "text/xml; charset=utf-8",
  });
  res.end(xml);
};

const sendScript = (res, statusCode, script) => {
  setCorsHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": "application/javascript; charset=utf-8",
  });
  res.end(script);
};

const sendCsv = (res, filename, content) => {
  setCorsHeaders(res);
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  res.end(content);
};

const readRequestBody = async (req) => {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const searchParams = new URLSearchParams(raw);
    const parsed = {};

    for (const [key, value] of searchParams) {
      if (Object.prototype.hasOwnProperty.call(parsed, key)) {
        const previousValue = parsed[key];
        parsed[key] = Array.isArray(previousValue) ? [...previousValue, value] : [previousValue, value];
      } else {
        parsed[key] = value;
      }
    }

    return parsed;
  }

  if (contentType.includes("application/json") || !contentType) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new HttpError(400, "Request body must be valid JSON.");
    }
  }

  return {
    raw,
  };
};

const parseBearerToken = (req) => {
  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
};

const getUserById = (state, userId) => state.organization.members.find((member) => member.id === userId) || null;

const getSessionFromRequest = (req, state) => {
  const token = parseBearerToken(req);
  if (!token) {
    return null;
  }

  return state.auth.sessions.find((session) => session.token === token) || null;
};

const requireSession = (req, state, routeKey) => {
  if (!PUBLIC_ROUTES.has(routeKey)) {
    const session = getSessionFromRequest(req, state);
    if (!session) {
      throw new HttpError(401, "Authentication required. Provide a bearer token.");
    }

    const user = getUserById(state, session.userId);
    if (!user) {
      throw new HttpError(401, "The authenticated user no longer exists.");
    }

    return { session, user };
  }

  return { session: null, user: null };
};

const matchRoute = (pathname, pattern) => {
  const pathParts = pathname.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);

  if (pathParts.length !== patternParts.length) {
    return null;
  }

  const params = {};

  for (let index = 0; index < patternParts.length; index += 1) {
    const actualPart = pathParts[index];
    const patternPart = patternParts[index];

    if (patternPart.startsWith(":")) {
      params[patternPart.slice(1)] = decodeURIComponent(actualPart);
      continue;
    }

    if (actualPart !== patternPart) {
      return null;
    }
  }

  return params;
};

const assertObject = (value, fieldName) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${fieldName} must be an object.`);
  }

  return value;
};

const assertString = (value, fieldName, { required = true, maxLength = 5000 } = {}) => {
  if (value == null || value === "") {
    if (required) {
      throw new HttpError(400, `${fieldName} is required.`);
    }
    return "";
  }

  if (typeof value !== "string") {
    throw new HttpError(400, `${fieldName} must be a string.`);
  }

  const trimmed = value.trim();
  if (required && !trimmed) {
    throw new HttpError(400, `${fieldName} is required.`);
  }

  if (trimmed.length > maxLength) {
    throw new HttpError(400, `${fieldName} must be at most ${maxLength} characters.`);
  }

  return trimmed;
};

const assertBoolean = (value, fieldName) => {
  if (typeof value !== "boolean") {
    throw new HttpError(400, `${fieldName} must be a boolean.`);
  }

  return value;
};

const assertEnum = (value, values, fieldName) => {
  const normalized = assertString(value, fieldName);
  if (!values.includes(normalized)) {
    throw new HttpError(400, `${fieldName} must be one of: ${values.join(", ")}.`);
  }

  return normalized;
};

const toDisplayName = (email, fallback = "Business Owner") => {
  const prefix = (email || "").split("@")[0] || fallback;
  return prefix
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || fallback;
};

const uniqueId = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;

const normalizeWebsite = (website) => {
  const input = assertString(website, "website");
  return input.replace(/^https?:\/\//i, "");
};

const applyWorkspaceNormalization = (state) => {
  const normalized = normalizeWorkspaceState(state);
  for (const key of Object.keys(state)) {
    delete state[key];
  }
  Object.assign(state, normalized);
  return state;
};

const getPublicBaseUrl = (req) => {
  const forwardedProto = typeof req.headers["x-forwarded-proto"] === "string"
    ? req.headers["x-forwarded-proto"].split(",")[0].trim()
    : "";
  const protocol = forwardedProto || (process.env.VERCEL ? "https" : "http");
  const forwardedHost = typeof req.headers["x-forwarded-host"] === "string"
    ? req.headers["x-forwarded-host"].split(",")[0].trim()
    : "";
  const host = forwardedHost || req.headers.host || `localhost:${DEFAULT_PORT}`;
  return `${protocol}://${host}`;
};

const getWorkspaceTwilioConfig = (req, settings = {}, twilioRuntimeConfig = {}) => {
  const workspaceTwilio = settings?.twilio || {};
  return {
    accountSid: workspaceTwilio.accountSid || twilioRuntimeConfig.accountSid || "",
    authToken: workspaceTwilio.authToken || twilioRuntimeConfig.authToken || "",
    validateRequests: workspaceTwilio.validateRequests ?? twilioRuntimeConfig.validateRequests ?? true,
    webhookBaseUrl: twilioRuntimeConfig.webhookBaseUrl || getPublicBaseUrl(req),
    fetchImpl: twilioRuntimeConfig.fetchImpl,
  };
};

const serializeTwilioSettings = (req, settings = {}, twilioRuntimeConfig = {}) => {
  const workspaceTwilio = settings?.twilio || {};
  const authToken = workspaceTwilio.authToken || "";

  return {
    accountSid: workspaceTwilio.accountSid || "",
    authTokenConfigured: Boolean(authToken),
    authTokenLastFour: authToken ? authToken.slice(-4) : "",
    validateRequests: workspaceTwilio.validateRequests ?? true,
    webhookBaseUrl: getWorkspaceTwilioConfig(req, settings, twilioRuntimeConfig).webhookBaseUrl,
  };
};

const serializeSettings = (req, settings = {}, twilioRuntimeConfig = {}) => ({
  timezone: settings?.timezone || "America/New_York",
  phoneNumber: settings?.phoneNumber || "",
  twilio: serializeTwilioSettings(req, settings, twilioRuntimeConfig),
});

const findCallById = (state, id) => state.calls.find((call) => call.id === id) || null;
const findLeadById = (state, id) => state.leads.find((lead) => lead.id === id) || null;
const findInvoiceById = (state, id) => state.organization.invoices.find((invoice) => invoice.id === id) || null;
const findVoiceAgentById = (state, id) => state.organization.voiceAgents.find((agent) => agent.id === id) || null;
const findChatbotById = (state, id) => state.organization.chatbots.find((chatbot) => chatbot.id === id) || null;
const getActiveVoiceAgent = (state) => findVoiceAgentById(state, state.organization.activeVoiceAgentId) || state.organization.voiceAgents[0];
const getActiveChatbot = (state) => findChatbotById(state, state.organization.activeChatbotId) || state.organization.chatbots[0];
const getVoiceAgentForChatbot = (state, chatbot = getActiveChatbot(state)) => (
  findVoiceAgentById(state, chatbot.voiceAgentId) || getActiveVoiceAgent(state)
);

const toAvatarLabel = (value) => (
  (value || "AG")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "AG"
);

const buildEmbedScriptTag = (req, chatbot) => (
  `<script src="${getPublicBaseUrl(req)}/embed/chatbot.js" data-chatbot-id="${chatbot.id}" defer></script>`
);

const serializeChatbot = (req, chatbot) => ({
  ...chatbot,
  embedScript: buildEmbedScriptTag(req, chatbot),
  widgetScriptUrl: `${getPublicBaseUrl(req)}/embed/chatbot.js`,
});

const serializeOrganization = (req, organization, twilioRuntimeConfig) => ({
  ...organization,
  settings: serializeSettings(req, organization.settings, twilioRuntimeConfig),
  chatbots: organization.chatbots.map((chatbot) => serializeChatbot(req, chatbot)),
});

const buildVoiceAgentTemplate = (state) => {
  const current = getActiveVoiceAgent(state);
  const index = state.organization.voiceAgents.length + 1;
  return createVoiceAgent({
    ...current,
    id: uniqueId("voice_agent"),
    name: `Voice Agent ${index}`,
    twilioPhoneNumber: "",
    twilioPhoneSid: "",
    greeting: `Hello, thank you for calling ${state.organization.profile.name}. This is Voice Agent ${index}. How can I help you today?`,
    faqs: current.faqs.map((faq) => ({ ...faq, id: uniqueId("faq") })),
  });
};

const buildChatbotTemplate = (state) => {
  const activeAgent = getActiveVoiceAgent(state);
  const index = state.organization.chatbots.length + 1;
  return createChatbot({
    id: uniqueId("chatbot"),
    voiceAgentId: activeAgent.id,
    name: `Chatbot ${index}`,
    faqs: activeAgent.faqs.map((faq) => ({ ...faq, id: uniqueId("faq") })),
    headerTitle: `${state.organization.profile.name} Assistant`,
    welcomeMessage: `Hi! I'm ${activeAgent.name}'s website assistant for ${state.organization.profile.name}. Ask me anything and I can guide you from here.`,
    launcherLabel: "Need help?",
    avatarLabel: toAvatarLabel(state.organization.profile.name),
    suggestedPrompts: [
      "What services do you offer?",
      "Can I book an appointment?",
      "What are your hours?",
    ],
  });
};

const replaceVoiceAgentById = (state, agentId, nextAgent) => {
  const index = state.organization.voiceAgents.findIndex((agent) => agent.id === agentId);
  if (index === -1) {
    throw new HttpError(404, "Voice agent not found.");
  }

  state.organization.voiceAgents[index] = {
    ...nextAgent,
    id: agentId,
  };
  state.organization.agent = state.organization.voiceAgents[index];
  return state.organization.agent;
};

const csvEscape = (value) => {
  const stringValue = String(value ?? "");
  if (/[,"\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }

  return stringValue;
};

const buildWeeklySeries = (calls, leads) => {
  const today = new Date();
  const result = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(today);
    day.setHours(0, 0, 0, 0);
    day.setDate(today.getDate() - offset);

    const nextDay = new Date(day);
    nextDay.setDate(day.getDate() + 1);

    const callCount = calls.filter((call) => {
      const timestamp = new Date(call.timestamp).getTime();
      return timestamp >= day.getTime() && timestamp < nextDay.getTime();
    }).length;

    const leadCount = leads.filter((lead) => {
      const timestamp = new Date(lead.createdAt).getTime();
      return timestamp >= day.getTime() && timestamp < nextDay.getTime();
    }).length;

    result.push({
      name: day.toLocaleDateString("en-US", { weekday: "short" }),
      calls: callCount,
      leads: leadCount,
    });
  }

  return result;
};

const buildOutcomeBreakdown = (calls) => {
  const total = calls.length || 1;
  const tracked = [
    CALL_OUTCOMES.LEAD_CAPTURED,
    CALL_OUTCOMES.FAQ_ANSWERED,
    CALL_OUTCOMES.APPOINTMENT_BOOKED,
  ];
  const escalatedAndOther = calls.filter((call) => !tracked.includes(call.outcome)).length;

  return [
    {
      label: CALL_OUTCOMES.LEAD_CAPTURED,
      count: Math.round((calls.filter((call) => call.outcome === CALL_OUTCOMES.LEAD_CAPTURED).length / total) * 100),
      color: "bg-indigo-600",
    },
    {
      label: CALL_OUTCOMES.FAQ_ANSWERED,
      count: Math.round((calls.filter((call) => call.outcome === CALL_OUTCOMES.FAQ_ANSWERED).length / total) * 100),
      color: "bg-violet-500",
    },
    {
      label: CALL_OUTCOMES.APPOINTMENT_BOOKED,
      count: Math.round((calls.filter((call) => call.outcome === CALL_OUTCOMES.APPOINTMENT_BOOKED).length / total) * 100),
      color: "bg-emerald-500",
    },
    {
      label: "Escalated/Other",
      count: Math.round((escalatedAndOther / total) * 100),
      color: "bg-slate-200",
    },
  ];
};

const buildDashboard = (state) => {
  const activeVoiceAgent = getActiveVoiceAgent(state);
  const averageDurationMinutes = state.calls.length > 0
    ? state.calls.reduce((total, call) => total + call.duration, 0) / state.calls.length / 60
    : 0;

  return {
    stats: {
      totalCalls: state.calls.length,
      leadsCaptured: state.leads.length,
      missedCalls: state.calls.filter((call) => call.outcome === CALL_OUTCOMES.VOICEMAIL).length,
      avgDurationMinutes: Number(averageDurationMinutes.toFixed(1)),
    },
    weeklyFlow: buildWeeklySeries(state.calls, state.leads),
    outcomeBreakdown: buildOutcomeBreakdown(state.calls),
    recentCalls: [...state.calls].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 5),
    recentLeads: [...state.leads].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5),
    usage: state.organization.subscription.usage,
    agentStatus: {
      online: true,
      agentName: activeVoiceAgent.name,
      phoneNumber: activeVoiceAgent.twilioPhoneNumber || state.organization.phoneNumber,
      direction: activeVoiceAgent.direction,
    },
  };
};

const inferIndustryFromWebsite = (website) => {
  const normalized = website.toLowerCase();
  if (normalized.includes("dental")) {
    return "Healthcare";
  }
  if (normalized.includes("legal") || normalized.includes("law")) {
    return "Legal";
  }
  if (normalized.includes("realestate") || normalized.includes("property")) {
    return "Real Estate";
  }
  if (normalized.includes("plumb") || normalized.includes("electric") || normalized.includes("hvac")) {
    return "Home Services";
  }
  return "SaaS";
};

const buildFaqsFromWebsite = (website, organization) => {
  const normalized = normalizeWebsite(website);
  const businessName = organization?.profile?.name || normalized.split(".")[0] || "your business";
  const industry = organization?.profile?.industry || inferIndustryFromWebsite(normalized);

  const faqSets = {
    Healthcare: [
      ["What are your office hours?", `${businessName} is available Monday to Friday during regular business hours, and after-hours calls can still be captured by the virtual receptionist.`],
      ["Do you accept new patients?", `Yes. ${businessName} is currently welcoming new patients and can help them request a first appointment.`],
      ["How do I schedule a visit?", `You can call in to request a time, and the receptionist will collect your details for the office team to confirm.`],
      ["What insurance plans do you work with?", `Insurance questions can be routed to the team for confirmation, and complex cases can be escalated to a staff member.`],
    ],
    Legal: [
      ["What type of matters do you handle?", `${businessName} can capture the caller's legal matter summary and route it to the right attorney or intake specialist.`],
      ["Can I book a consultation?", `Yes. Prospective clients can request a consultation and share the best callback number.`],
      ["Do you offer urgent callbacks?", `Urgent legal inquiries can be escalated so the team can follow up quickly.`],
      ["What information should I prepare?", `The receptionist will gather your name, phone number, and a brief summary of your matter.`],
    ],
    "Real Estate": [
      ["Can I ask about a listing?", `Yes. ${businessName} can capture property questions and route listing inquiries to the correct agent.`],
      ["How do I schedule a showing?", `Callers can request a showing and provide their contact information for confirmation.`],
      ["Do you help with rentals and purchases?", `${businessName} can gather the caller's goals and connect them with the right specialist.`],
      ["Can I leave my budget and timeline?", `Absolutely. Budget and timeline details can be collected during intake.`],
    ],
    "Home Services": [
      ["Do you handle same-day service requests?", `${businessName} can capture urgent service requests and prioritize them for the team.`],
      ["Can I book an estimate?", `Yes. The receptionist can collect your address, issue summary, and preferred callback time.`],
      ["What areas do you serve?", `Service-area questions can be answered immediately or escalated when needed.`],
      ["What details should I provide?", `Callers should share their name, phone number, and a short description of the issue.`],
    ],
    SaaS: [
      ["What does the product do?", `${businessName} provides an AI-powered receptionist workflow that helps businesses capture leads and handle routine conversations.`],
      ["Can I request a demo?", `Yes. Prospective customers can request a demo and leave contact details for the sales team.`],
      ["Do you offer onboarding support?", `Implementation and onboarding support are available, and enterprise questions can be routed to sales.`],
      ["How can I reach your team?", `The virtual receptionist can collect your message and direct it to the right teammate.`],
    ],
  };

  return (faqSets[industry] || faqSets.SaaS).map(([question, answer], index) => ({
    id: uniqueId(`faq${index + 1}`),
    question,
    answer,
  }));
};

const extractLeadDetails = (transcript, fallbackLead = {}) => {
  const text = transcript || "";
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = text.match(/(?:\+?\d[\d()\-\s]{7,}\d)/);
  const nameMatch = text.match(/(?:my name is|this is|i am)\s+([A-Za-z]+(?:\s+[A-Za-z]+){0,2})/i);

  let reason = fallbackLead.reason || "";
  const lower = text.toLowerCase();

  if (!reason) {
    if (lower.includes("tooth")) {
      reason = "Dental pain inquiry";
    } else if (lower.includes("cleaning")) {
      reason = "Cleaning appointment request";
    } else if (lower.includes("appointment") || lower.includes("schedule")) {
      reason = "Appointment request";
    } else if (lower.includes("pricing") || lower.includes("cost")) {
      reason = "Pricing question";
    } else if (lower.includes("hours") || lower.includes("location")) {
      reason = "General FAQ";
    } else if (lower.includes("insurance")) {
      reason = "Insurance question";
    } else {
      reason = "General inquiry";
    }
  }

  return {
    name: fallbackLead.name || (nameMatch ? nameMatch[1].trim() : ""),
    email: fallbackLead.email || (emailMatch ? emailMatch[0] : ""),
    phone: fallbackLead.phone || (phoneMatch ? phoneMatch[0].trim() : ""),
    reason,
  };
};

const inferCallOutcome = (transcript, explicitOutcome) => {
  if (explicitOutcome) {
    if (!Object.values(CALL_OUTCOMES).includes(explicitOutcome)) {
      throw new HttpError(400, `outcome must be one of: ${Object.values(CALL_OUTCOMES).join(", ")}.`);
    }
    return explicitOutcome;
  }

  const lower = (transcript || "").toLowerCase();

  if (lower.includes("transfer") || lower.includes("human") || lower.includes("person")) {
    return CALL_OUTCOMES.ESCALATED;
  }
  if (lower.includes("voicemail") || lower.includes("leave a message")) {
    return CALL_OUTCOMES.VOICEMAIL;
  }
  if (lower.includes("appointment") || lower.includes("schedule") || lower.includes("book")) {
    return CALL_OUTCOMES.APPOINTMENT_BOOKED;
  }
  if (lower.includes("call me") || lower.includes("contact me") || lower.includes("my number is") || lower.includes("email me")) {
    return CALL_OUTCOMES.LEAD_CAPTURED;
  }

  return CALL_OUTCOMES.FAQ_ANSWERED;
};

const summarizeTranscript = (transcript, outcome, lead) => {
  switch (outcome) {
    case CALL_OUTCOMES.APPOINTMENT_BOOKED:
      return `${lead.name || "Caller"} requested an appointment and shared contact details for follow-up.`;
    case CALL_OUTCOMES.LEAD_CAPTURED:
      return `${lead.name || "Caller"} asked to be contacted about ${lead.reason.toLowerCase()} and left their details.`;
    case CALL_OUTCOMES.ESCALATED:
      return `${lead.name || "Caller"} requested a human handoff for a higher-touch conversation.`;
    case CALL_OUTCOMES.VOICEMAIL:
      return `${lead.name || "Caller"} was routed to voicemail after leaving a short message.`;
    default:
      return transcript
        ? "Caller received an answer to a routine question and the conversation ended successfully."
        : "Routine question handled by the AI receptionist.";
  }
};

const buildLeadFromDetails = (details, timestamp) => {
  if (!details.name && !details.phone && !details.email) {
    return null;
  }

  return {
    id: uniqueId("lead"),
    name: details.name || "Unknown Caller",
    phone: details.phone || "Unknown",
    email: details.email || "",
    reason: details.reason || "General inquiry",
    createdAt: timestamp,
    status: "new",
  };
};

const buildCallFromSimulation = ({ transcript, callerName, callerPhone, duration, outcome, summary, lead }) => {
  const timestamp = nowIso();
  return {
    call: {
      id: uniqueId("call"),
      callerName: callerName || lead?.name || "Unknown",
      callerPhone: callerPhone || lead?.phone || "Unknown",
      duration: duration || 60,
      timestamp,
      outcome,
      summary,
      transcript: transcript
        ? transcript.split("\n").map((line) => {
          const [speaker, ...rest] = line.split(":");
          const text = rest.join(":").trim();
          return {
            speaker: ["Caller", "You"].includes(speaker?.trim()) ? "Caller" : "Agent",
            text: text || line.trim(),
          };
        })
        : [
          { speaker: "Agent", text: "Hello, thank you for calling. How can I help you today?" },
          { speaker: "Caller", text: summary },
        ],
    },
    timestamp,
  };
};

const TWILIO_SPEECH_LANGUAGE_BY_AGENT_LANGUAGE = {
  English: "en-US",
  Spanish: "es-ES",
  French: "fr-FR",
  German: "de-DE",
};

const CALL_OUTCOME_PRIORITY = {
  [CALL_OUTCOMES.FAQ_ANSWERED]: 1,
  [CALL_OUTCOMES.VOICEMAIL]: 2,
  [CALL_OUTCOMES.LEAD_CAPTURED]: 3,
  [CALL_OUTCOMES.APPOINTMENT_BOOKED]: 4,
  [CALL_OUTCOMES.ESCALATED]: 5,
};

const getTwilioBaseUrl = (req, twilioConfig) => twilioConfig.webhookBaseUrl || getPublicBaseUrl(req);

const buildTwilioWebhookUrl = (req, twilioConfig, pathname, searchParams = null) => {
  const query = searchParams instanceof URLSearchParams && [...searchParams.keys()].length > 0
    ? `?${searchParams.toString()}`
    : "";
  return `${getTwilioBaseUrl(req, twilioConfig)}${pathname}${query}`;
};

const requireTwilioRequestValidation = (req, url, body, twilioConfig) => {
  if (twilioConfig.validateRequests === false) {
    return;
  }

  if (!twilioConfig.authToken) {
    throw new HttpError(500, "Twilio webhook validation requires TWILIO_AUTH_TOKEN. Set it or disable validation with TWILIO_VALIDATE_REQUESTS=false.");
  }

  const signature = req.headers["x-twilio-signature"];
  if (!signature) {
    throw new HttpError(403, "Missing X-Twilio-Signature header.");
  }

  const requestUrl = `${getTwilioBaseUrl(req, twilioConfig)}${url.pathname}${url.search}`;
  const isValid = validateTwilioSignature({
    authToken: twilioConfig.authToken,
    signature,
    requestUrl,
    params: body,
  });

  if (!isValid) {
    throw new HttpError(403, "Twilio request signature is invalid.");
  }
};

const getTwilioActiveCall = (state, callSid) => state.twilio?.activeCalls?.[callSid] || null;

const getPendingTwilioOutboundCall = (state, sessionId) => state.twilio?.pendingOutboundCalls?.[sessionId] || null;

const ensureTwilioState = (state) => {
  state.twilio = state.twilio || {};
  state.twilio.activeCalls = state.twilio.activeCalls || {};
  state.twilio.pendingOutboundCalls = state.twilio.pendingOutboundCalls || {};
};

const mergeCallOutcome = (currentOutcome, nextOutcome) => {
  if (!nextOutcome) {
    return currentOutcome;
  }

  const currentPriority = CALL_OUTCOME_PRIORITY[currentOutcome] || 0;
  const nextPriority = CALL_OUTCOME_PRIORITY[nextOutcome] || 0;
  return nextPriority >= currentPriority ? nextOutcome : currentOutcome;
};

const mergeLeadDetails = (currentLead = {}, nextLead = {}) => ({
  name: nextLead.name || currentLead.name || "",
  email: nextLead.email || currentLead.email || "",
  phone: nextLead.phone || currentLead.phone || "",
  reason: nextLead.reason || currentLead.reason || "",
});

const appendTranscriptLine = (session, speaker, text) => {
  const normalizedText = String(text || "").trim();
  if (!normalizedText) {
    return;
  }

  session.transcript.push({
    speaker,
    text: normalizedText,
  });
};

const buildVoiceKnowledgeResponse = (message, state, agent) => {
  const normalized = message.toLowerCase();

  for (const faq of agent.faqs) {
    const questionWords = faq.question.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3);
    if (questionWords.some((word) => normalized.includes(word))) {
      return faq.answer;
    }
  }

  if (normalized.includes("hour")) {
    return `We are available during ${agent.businessHours}.`;
  }

  if (normalized.includes("where") || normalized.includes("location")) {
    return `We are based in ${state.organization.profile.location}.`;
  }

  return null;
};

const buildVoiceFallbackResponse = (agent) => {
  const toneFallbacks = {
    Professional: "I can help with that. Please share a little more detail and I will capture it for the team.",
    Friendly: "Happy to help. Tell me a little more and I will make sure the team gets what they need.",
    Empathetic: "I'm here to help. Share a few more details and I will make sure your request is handled with care.",
  };

  return toneFallbacks[agent.tone] || toneFallbacks.Professional;
};

const buildVoiceTurn = ({ message, state, agent, session }) => {
  const normalized = String(message || "").toLowerCase();
  const leadDetails = extractLeadDetails(message, {
    ...session.lead,
    phone: session.lead.phone || session.customerPhone || "",
    name: session.lead.name || session.customerName || "",
  });

  const requestedTransfer = normalized.includes("human") || normalized.includes("person") || normalized.includes("transfer");
  if (requestedTransfer) {
    return {
      responseText: agent.rules.autoEscalate && agent.escalationPhone
        ? `I'm connecting you to our team at ${agent.escalationPhone} now.`
        : "I've captured your request for a human follow-up and our team will call you back.",
      leadDetails,
      outcome: CALL_OUTCOMES.ESCALATED,
      shouldCaptureLead: true,
      shouldDial: Boolean(agent.rules.autoEscalate && agent.escalationPhone),
      shouldContinue: false,
    };
  }

  const requestedAppointment = normalized.includes("appointment") || normalized.includes("schedule") || normalized.includes("book");
  if (requestedAppointment) {
    return {
      responseText: agent.rules.autoBook
        ? `I've captured your appointment request and our team will follow up at ${leadDetails.phone || session.customerPhone || "the number on file"}.`
        : "I've captured your appointment request and the team will review it for a callback.",
      leadDetails,
      outcome: CALL_OUTCOMES.APPOINTMENT_BOOKED,
      shouldCaptureLead: true,
      shouldDial: false,
      shouldContinue: false,
    };
  }

  const wantsFollowUp = normalized.includes("call me") || normalized.includes("contact me") || normalized.includes("my number is") || normalized.includes("email me");
  if (wantsFollowUp) {
    return {
      responseText: `Thanks. I've captured your details and our team will follow up at ${leadDetails.phone || session.customerPhone || "the number you provided"}.`,
      leadDetails,
      outcome: CALL_OUTCOMES.LEAD_CAPTURED,
      shouldCaptureLead: true,
      shouldDial: false,
      shouldContinue: false,
    };
  }

  const knowledgeResponse = buildVoiceKnowledgeResponse(message, state, agent);
  return {
    responseText: knowledgeResponse || buildVoiceFallbackResponse(agent),
    leadDetails,
    outcome: knowledgeResponse ? CALL_OUTCOMES.FAQ_ANSWERED : inferCallOutcome(message),
    shouldCaptureLead: false,
    shouldDial: false,
    shouldContinue: session.turnCount < 2,
  };
};

const createTwilioSession = ({
  agent,
  direction,
  callSid,
  customerPhone,
  customerName,
  prompt = "",
  outboundSessionId = "",
}) => ({
  callSid,
  agentId: agent.id,
  agentName: agent.name,
  direction,
  customerPhone: customerPhone || "",
  customerName: customerName || "",
  prompt,
  status: "started",
  startedAt: nowIso(),
  updatedAt: nowIso(),
  turnCount: 0,
  transcript: [],
  lead: {
    name: customerName || "",
    email: "",
    phone: customerPhone || "",
    reason: "",
  },
  shouldCaptureLead: false,
  outcome: CALL_OUTCOMES.FAQ_ANSWERED,
  answeredBy: "",
  callRecordId: "",
  outboundSessionId,
  twilioStatusHistory: [],
});

const buildGatherActionAttributes = (req, twilioConfig, actionPath, agent) => ({
  input: "speech dtmf",
  method: "POST",
  action: buildTwilioWebhookUrl(req, twilioConfig, actionPath),
  timeout: "4",
  speechTimeout: "auto",
  language: TWILIO_SPEECH_LANGUAGE_BY_AGENT_LANGUAGE[agent.language] || "en-US",
});

const buildCallRecordFromSession = (session, fallbackStatus = "") => {
  const outcome = session.outcome
    || (["busy", "failed", "no-answer", "canceled"].includes(fallbackStatus) ? CALL_OUTCOMES.VOICEMAIL : CALL_OUTCOMES.FAQ_ANSWERED);
  const transcript = session.transcript.length > 0
    ? session.transcript
    : [
      {
        speaker: "Agent",
        text: session.direction === "outbound"
          ? `Outbound call attempt to ${session.customerPhone || "unknown number"}.`
          : "Incoming call connected to the voice agent.",
      },
    ];
  const transcriptText = transcript.map((line) => `${line.speaker}: ${line.text}`).join("\n");
  const summary = summarizeTranscript(transcriptText, outcome, session.lead);

  return {
    id: uniqueId("call"),
    callerName: session.customerName || session.lead.name || "Unknown",
    callerPhone: session.customerPhone || session.lead.phone || "Unknown",
    duration: Number(session.duration || 0),
    timestamp: session.startedAt || nowIso(),
    outcome,
    summary,
    transcript,
  };
};

const finalizeTwilioCallSession = (draft, session, statusPayload = {}) => {
  if (session.callRecordId) {
    return {
      call: draft.calls.find((entry) => entry.id === session.callRecordId) || null,
      lead: null,
    };
  }

  const call = buildCallRecordFromSession(session, statusPayload.callStatus);
  draft.calls.unshift(call);
  session.callRecordId = call.id;

  let lead = null;
  if (session.shouldCaptureLead && (session.lead.name || session.lead.phone || session.lead.email)) {
    lead = buildLeadFromDetails(session.lead, call.timestamp);
    if (lead) {
      draft.leads.unshift(lead);
    }
  }

  const additionalMinutes = Math.max(1, Math.ceil((call.duration || 1) / 60));
  draft.organization.subscription.usage.calls = Math.min(
    draft.organization.subscription.usage.callLimit,
    draft.organization.subscription.usage.calls + 1
  );
  draft.organization.subscription.usage.minutes = Math.min(
    draft.organization.subscription.usage.minuteLimit,
    draft.organization.subscription.usage.minutes + additionalMinutes
  );

  delete draft.twilio.activeCalls[session.callSid];
  if (session.outboundSessionId) {
    delete draft.twilio.pendingOutboundCalls[session.outboundSessionId];
  }

  return {
    call,
    lead,
  };
};

const getConversation = (state, chatbotId = state.organization.activeChatbotId) => {
  const chatbot = findChatbotById(state, chatbotId) || getActiveChatbot(state);
  const greeting = {
    id: `msg_greeting_${chatbot.id}`,
    role: "model",
    text: chatbot.welcomeMessage,
    timestamp: nowIso(),
  };

  const conversation = state.conversations.byChatbotId?.[chatbot.id] || state.conversations.default || [];
  return conversation.length > 0 ? conversation : [greeting];
};

const findFaqResponse = (message, state, chatbotId = state.organization.activeChatbotId) => {
  const normalized = message.toLowerCase();
  const profile = state.organization.profile;
  const chatbot = findChatbotById(state, chatbotId) || getActiveChatbot(state);
  const agent = getVoiceAgentForChatbot(state, chatbot);

  for (const faq of chatbot.faqs) {
    const questionWords = faq.question.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3);
    if (questionWords.some((word) => normalized.includes(word))) {
      return `${chatbot.name}: ${faq.answer}`;
    }
  }

  for (const faq of agent.faqs) {
    const questionWords = faq.question.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3);
    if (questionWords.some((word) => normalized.includes(word))) {
      return `${chatbot.name}: ${faq.answer}`;
    }
  }

  if (normalized.includes("hour")) {
    return `${chatbot.name}: We are available during ${agent.businessHours}.`;
  }
  if (normalized.includes("where") || normalized.includes("location")) {
    return `${chatbot.name}: We are based in ${profile.location}.`;
  }
  if (normalized.includes("human") || normalized.includes("transfer") || normalized.includes("person")) {
    return `${chatbot.name}: I can escalate this to our team at ${agent.escalationPhone}.`;
  }
  if (normalized.includes("appointment") || normalized.includes("book") || normalized.includes("schedule")) {
    return `${chatbot.name}: I can help with that. Please share your name, phone number, and preferred time so the team can confirm the appointment.`;
  }

  if (chatbot.customPrompt) {
    return `${chatbot.name}: ${chatbot.customPrompt}`;
  }

  const toneFallbacks = {
    Professional: `${chatbot.name}: I can help with that. Please share a few more details and I will capture the request for the team.`,
    Friendly: `${chatbot.name}: Happy to help! Share a bit more detail and I will make sure the team gets everything they need.`,
    Empathetic: `${chatbot.name}: I’m here to help. Tell me a little more and I’ll make sure your message is handled with care.`,
  };

  return toneFallbacks[agent.tone] || toneFallbacks.Professional;
};

const sanitizeAgentPatch = (body, currentAgent) => {
  const nextAgent = { ...currentAgent };

  if ("name" in body) {
    nextAgent.name = assertString(body.name, "agent.name");
  }
  if ("direction" in body) {
    nextAgent.direction = assertEnum(body.direction, VOICE_AGENT_DIRECTIONS, "agent.direction");
  }
  if ("twilioPhoneNumber" in body) {
    nextAgent.twilioPhoneNumber = assertString(body.twilioPhoneNumber, "agent.twilioPhoneNumber", { required: false, maxLength: 50 });
  }
  if ("twilioPhoneSid" in body) {
    nextAgent.twilioPhoneSid = assertString(body.twilioPhoneSid, "agent.twilioPhoneSid", { required: false, maxLength: 100 });
  }
  if ("voice" in body) {
    nextAgent.voice = assertEnum(body.voice, AGENT_VOICES, "agent.voice");
  }
  if ("language" in body) {
    nextAgent.language = assertEnum(body.language, AGENT_LANGUAGES, "agent.language");
  }
  if ("greeting" in body) {
    nextAgent.greeting = assertString(body.greeting, "agent.greeting");
  }
  if ("tone" in body) {
    nextAgent.tone = assertEnum(body.tone, AGENT_TONES, "agent.tone");
  }
  if ("businessHours" in body) {
    nextAgent.businessHours = assertString(body.businessHours, "agent.businessHours");
  }
  if ("escalationPhone" in body) {
    nextAgent.escalationPhone = assertString(body.escalationPhone, "agent.escalationPhone", { required: false, maxLength: 50 });
  }
  if ("voicemailFallback" in body) {
    nextAgent.voicemailFallback = assertBoolean(body.voicemailFallback, "agent.voicemailFallback");
  }
  if ("dataCaptureFields" in body) {
    if (!Array.isArray(body.dataCaptureFields)) {
      throw new HttpError(400, "agent.dataCaptureFields must be an array.");
    }
    nextAgent.dataCaptureFields = body.dataCaptureFields.map((field) => assertString(field, "agent.dataCaptureFields[]", { maxLength: 50 }));
  }
  if ("rules" in body) {
    const rules = assertObject(body.rules, "agent.rules");
    nextAgent.rules = {
      ...currentAgent.rules,
      ...(Object.prototype.hasOwnProperty.call(rules, "autoBook") ? { autoBook: assertBoolean(rules.autoBook, "agent.rules.autoBook") } : {}),
      ...(Object.prototype.hasOwnProperty.call(rules, "autoEscalate") ? { autoEscalate: assertBoolean(rules.autoEscalate, "agent.rules.autoEscalate") } : {}),
      ...(Object.prototype.hasOwnProperty.call(rules, "captureAllLeads") ? { captureAllLeads: assertBoolean(rules.captureAllLeads, "agent.rules.captureAllLeads") } : {}),
    };
  }

  return nextAgent;
};

const sanitizeChatbotPatch = (body, currentChatbot, state) => {
  const nextChatbot = { ...currentChatbot };

  if ("name" in body) {
    nextChatbot.name = assertString(body.name, "chatbot.name", { maxLength: 120 });
  }
  if ("voiceAgentId" in body) {
    const voiceAgentId = assertString(body.voiceAgentId, "chatbot.voiceAgentId", { maxLength: 120 });
    if (!findVoiceAgentById(state, voiceAgentId)) {
      throw new HttpError(404, "Linked voice agent not found.");
    }
    nextChatbot.voiceAgentId = voiceAgentId;
  }
  if ("faqs" in body) {
    if (!Array.isArray(body.faqs)) {
      throw new HttpError(400, "chatbot.faqs must be an array.");
    }
    nextChatbot.faqs = body.faqs.map((faq, index) => ({
      id: assertString(faq?.id || uniqueId(`chatbot_faq_${index + 1}`), "chatbot.faqs[].id", { required: false, maxLength: 100 }) || uniqueId(`chatbot_faq_${index + 1}`),
      question: assertString(faq?.question, "chatbot.faqs[].question"),
      answer: assertString(faq?.answer, "chatbot.faqs[].answer"),
    }));
  }
  if ("headerTitle" in body) {
    nextChatbot.headerTitle = assertString(body.headerTitle, "chatbot.headerTitle", { maxLength: 120 });
  }
  if ("welcomeMessage" in body) {
    nextChatbot.welcomeMessage = assertString(body.welcomeMessage, "chatbot.welcomeMessage", { maxLength: 600 });
  }
  if ("placeholder" in body) {
    nextChatbot.placeholder = assertString(body.placeholder, "chatbot.placeholder", { maxLength: 120 });
  }
  if ("launcherLabel" in body) {
    nextChatbot.launcherLabel = assertString(body.launcherLabel, "chatbot.launcherLabel", { maxLength: 80 });
  }
  if ("accentColor" in body) {
    nextChatbot.accentColor = assertString(body.accentColor, "chatbot.accentColor", { maxLength: 20 });
  }
  if ("position" in body) {
    nextChatbot.position = assertEnum(body.position, CHATBOT_POSITIONS, "chatbot.position");
  }
  if ("avatarLabel" in body) {
    nextChatbot.avatarLabel = assertString(body.avatarLabel, "chatbot.avatarLabel", { maxLength: 6 });
  }
  if ("customPrompt" in body) {
    nextChatbot.customPrompt = assertString(body.customPrompt, "chatbot.customPrompt", { maxLength: 500 });
  }
  if ("suggestedPrompts" in body) {
    if (!Array.isArray(body.suggestedPrompts)) {
      throw new HttpError(400, "chatbot.suggestedPrompts must be an array.");
    }
    nextChatbot.suggestedPrompts = body.suggestedPrompts
      .slice(0, 4)
      .map((prompt) => assertString(prompt, "chatbot.suggestedPrompts[]", { maxLength: 120 }));
  }

  return nextChatbot;
};

const createInvoice = (plan) => ({
  id: uniqueId("inv"),
  date: nowIso(),
  amount: PLAN_LIMITS[plan].amount,
  status: "Paid",
  pdfUrl: "",
});

const appendAuditEvent = (state, action, actorId, details = {}) => {
  state.auditLog.unshift({
    id: uniqueId("audit"),
    action,
    actorId,
    details,
    timestamp: nowIso(),
  });
  state.auditLog = state.auditLog.slice(0, 100);
};

const buildBootstrapPayload = (req, state, user, twilioRuntimeConfig) => ({
  user,
  organization: serializeOrganization(req, state.organization, twilioRuntimeConfig),
  leads: state.leads,
  calls: state.calls,
  conversation: getConversation(state),
  dashboard: buildDashboard(state),
});

const buildWidgetScript = (baseUrl) => `(() => {
  const currentScript = document.currentScript || Array.from(document.scripts).find((script) => script.src && script.src.indexOf("/embed/chatbot.js") !== -1);
  if (!currentScript) return;

  const chatbotId = currentScript.dataset.chatbotId || new URL(currentScript.src).searchParams.get("chatbotId");
  if (!chatbotId) {
    console.warn("Agently widget requires data-chatbot-id or chatbotId query parameter.");
    return;
  }

  const apiBase = ${JSON.stringify(baseUrl)};
  const state = {
    config: null,
    isOpen: false,
    isSending: false,
    button: null,
    panel: null,
    body: null,
    input: null,
    sendButton: null,
  };

  const createNode = (tag, styles = {}, text) => {
    const node = document.createElement(tag);
    Object.assign(node.style, styles);
    if (text) node.textContent = text;
    return node;
  };

  const appendMessage = (role, text) => {
    if (!state.body) return;
    const row = createNode("div", {
      display: "flex",
      justifyContent: role === "user" ? "flex-end" : "flex-start",
      marginBottom: "10px",
    });
    const bubble = createNode("div", {
      maxWidth: "80%",
      padding: "12px 14px",
      borderRadius: "16px",
      fontSize: "14px",
      lineHeight: "1.5",
      whiteSpace: "pre-wrap",
      background: role === "user" ? (state.config?.accentColor || "#4F46E5") : "#FFFFFF",
      color: role === "user" ? "#FFFFFF" : "#0F172A",
      border: role === "user" ? "none" : "1px solid #E2E8F0",
      boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
    }, text);
    row.appendChild(bubble);
    state.body.appendChild(row);
    state.body.scrollTop = state.body.scrollHeight;
  };

  const setSending = (sending) => {
    state.isSending = sending;
    if (state.sendButton) state.sendButton.disabled = sending;
    if (state.input) state.input.disabled = sending;
  };

  const sendMessage = async () => {
    if (!state.input || state.isSending) return;
    const message = state.input.value.trim();
    if (!message) return;

    appendMessage("user", message);
    state.input.value = "";
    setSending(true);

    try {
      const response = await fetch(apiBase + "/api/public/chatbots/" + encodeURIComponent(chatbotId) + "/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message || "Unable to reach chatbot.");
      }

      appendMessage("model", payload.assistantMessage.text);
    } catch (error) {
      appendMessage("model", error instanceof Error ? error.message : "Unable to reach chatbot right now.");
    } finally {
      setSending(false);
      if (state.input) state.input.focus();
    }
  };

  const togglePanel = () => {
    state.isOpen = !state.isOpen;
    if (state.panel) state.panel.style.display = state.isOpen ? "flex" : "none";
    if (state.button) state.button.textContent = state.isOpen ? "Close" : (state.config?.launcherLabel || "Chat");
  };

  const mountWidget = () => {
    if (state.button || !state.config) return;
    const positionRight = state.config.position !== "left";
    const wrapper = createNode("div", {
      position: "fixed",
      bottom: "24px",
      [positionRight ? "right" : "left"]: "24px",
      zIndex: "2147483647",
      fontFamily: "Inter, Arial, sans-serif",
    });

    state.panel = createNode("div", {
      width: "360px",
      maxWidth: "calc(100vw - 32px)",
      height: "540px",
      display: "none",
      flexDirection: "column",
      overflow: "hidden",
      borderRadius: "24px",
      background: "#F8FAFC",
      border: "1px solid #E2E8F0",
      boxShadow: "0 24px 80px rgba(15, 23, 42, 0.24)",
      marginBottom: "12px",
    });

    const header = createNode("div", {
      padding: "18px 20px",
      background: state.config.accentColor,
      color: "#FFFFFF",
      display: "flex",
      alignItems: "center",
      gap: "12px",
    });
    const avatar = createNode("div", {
      width: "42px",
      height: "42px",
      borderRadius: "14px",
      background: "rgba(255,255,255,0.18)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: "700",
      letterSpacing: "0.08em",
      fontSize: "14px",
    }, state.config.avatarLabel || "AG");
    const titleWrap = createNode("div");
    titleWrap.appendChild(createNode("div", { fontSize: "16px", fontWeight: "800" }, state.config.headerTitle));
    titleWrap.appendChild(createNode("div", { fontSize: "11px", opacity: "0.8", textTransform: "uppercase", letterSpacing: "0.14em" }, "Embedded chatbot"));
    header.appendChild(avatar);
    header.appendChild(titleWrap);

    state.body = createNode("div", {
      flex: "1",
      overflowY: "auto",
      padding: "18px",
      background: "#F8FAFC",
    });

    const composer = createNode("div", {
      display: "flex",
      gap: "10px",
      padding: "16px",
      borderTop: "1px solid #E2E8F0",
      background: "#FFFFFF",
    });

    state.input = createNode("input", {
      flex: "1",
      border: "1px solid #CBD5E1",
      borderRadius: "14px",
      padding: "12px 14px",
      fontSize: "14px",
      outline: "none",
    });
    state.input.placeholder = state.config.placeholder;
    state.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void sendMessage();
      }
    });

    state.sendButton = createNode("button", {
      border: "none",
      borderRadius: "14px",
      padding: "0 16px",
      cursor: "pointer",
      background: state.config.accentColor,
      color: "#FFFFFF",
      fontWeight: "700",
    }, "Send");
    state.sendButton.addEventListener("click", () => {
      void sendMessage();
    });

    composer.appendChild(state.input);
    composer.appendChild(state.sendButton);

    state.panel.appendChild(header);
    state.panel.appendChild(state.body);
    state.panel.appendChild(composer);

    state.button = createNode("button", {
      border: "none",
      borderRadius: "999px",
      padding: "14px 18px",
      cursor: "pointer",
      background: state.config.accentColor,
      color: "#FFFFFF",
      fontWeight: "800",
      boxShadow: "0 20px 40px rgba(15, 23, 42, 0.22)",
    }, state.config.launcherLabel || "Chat");
    state.button.addEventListener("click", togglePanel);

    wrapper.appendChild(state.panel);
    wrapper.appendChild(state.button);
    document.body.appendChild(wrapper);

    appendMessage("model", state.config.welcomeMessage);
  };

  fetch(apiBase + "/api/public/chatbots/" + encodeURIComponent(chatbotId) + "/config")
    .then((response) => response.json().then((payload) => ({ ok: response.ok, payload })))
    .then(({ ok, payload }) => {
      if (!ok) {
        throw new Error(payload?.error?.message || "Unable to load chatbot.");
      }
      state.config = payload;
      mountWidget();
    })
    .catch((error) => {
      console.error("Agently widget failed to initialize:", error);
    });
})();`;

const route = async (req, res, url, store, routeKey, params, twilioConfig) => {
  const snapshot = await store.read();
  const { session, user } = requireSession(req, snapshot, routeKey);
  const body = BODY_METHODS.has(req.method) ? await readRequestBody(req) : {};
  const pathname = url.pathname;
  const workspaceTwilioConfig = getWorkspaceTwilioConfig(req, snapshot.organization?.settings, twilioConfig);

  if (routeKey === "GET /health") {
    return sendJson(res, 200, {
      status: "ok",
      service: "agently-server",
      timestamp: nowIso(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  }

  if (routeKey === "GET /" || routeKey === "GET /api") {
    return sendJson(res, 200, {
      service: "Agently Backend API",
      version: "1.0.0",
      storeProvider: store.mode,
      docs: "/api/docs",
      authHint: "Use Authorization: Bearer <session-token> from login/register, or the seeded dev token demo-owner-token.",
    });
  }

  if (routeKey === "GET /api/docs") {
    return sendJson(res, 200, {
      service: "Agently Backend API",
      storeProvider: store.mode,
      baseUrl: getPublicBaseUrl(req),
      auth: {
        type: "Bearer",
        seedToken: "demo-owner-token",
      },
      routes: ROUTE_DOCS,
    });
  }

  if (routeKey === "GET /embed/chatbot.js") {
    return sendScript(res, 200, buildWidgetScript(getPublicBaseUrl(req)));
  }

  if (routeKey === "POST /api/auth/login") {
    const email = assertString(body.email, "email");
    assertString(body.password, "password");

    const result = await store.update((draft) => {
      let foundUser = draft.organization.members.find((member) => member.email.toLowerCase() === email.toLowerCase());

      if (!foundUser) {
        foundUser = {
          id: "u1",
          name: toDisplayName(email),
          email,
          role: "Owner",
        };
        draft.organization.members = [
          foundUser,
          ...draft.organization.members.filter((member) => member.role !== "Owner" && member.email.toLowerCase() !== email.toLowerCase()),
        ];
        draft.currentUserId = foundUser.id;
      }

      const token = uniqueId("token");
      draft.auth.sessions.push({
        token,
        userId: foundUser.id,
        createdAt: nowIso(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      appendAuditEvent(draft, "auth.login", foundUser.id, { email });

      return {
        token,
        user: foundUser,
        organization: draft.organization,
      };
    });

    return sendJson(res, 200, {
      ...result,
      organization: serializeOrganization(req, result.organization, twilioConfig),
    });
  }

  if (routeKey === "POST /api/auth/register") {
    const name = assertString(body.name, "name");
    const email = assertString(body.email, "email");
    assertString(body.password, "password");
    const companyName = assertString(body.companyName || "New Agently Workspace", "companyName");

    const result = await store.update((draft) => {
      const owner = {
        id: "u1",
        name,
        email,
        role: "Owner",
      };

      draft.organization.profile.name = companyName;
      draft.organization.members = [owner];
      draft.currentUserId = owner.id;
      draft.organization.agent.greeting = `Hello, thank you for calling ${companyName}. This is ${draft.organization.agent.name}. How can I assist you today?`;

      const activeChatbot = getActiveChatbot(draft);
      if (activeChatbot) {
        activeChatbot.headerTitle = `${companyName} Assistant`;
        activeChatbot.welcomeMessage = `Hi there! I'm here to help visitors learn more about ${companyName} and get connected with your team.`;
      }

      const token = uniqueId("token");
      draft.auth.sessions.push({
        token,
        userId: owner.id,
        createdAt: nowIso(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      appendAuditEvent(draft, "auth.register", owner.id, { companyName });

      return {
        token,
        user: owner,
        organization: draft.organization,
      };
    });

    return sendJson(res, 201, {
      ...result,
      organization: serializeOrganization(req, result.organization, twilioConfig),
    });
  }

  if (routeKey === "POST /api/auth/magic-link") {
    const email = assertString(body.email, "email");
    const magicLinkToken = uniqueId("magic");
    const requestOrigin = typeof req.headers.origin === "string" && /^https?:\/\//.test(req.headers.origin)
      ? req.headers.origin.replace(/\/$/, "")
      : null;

    await store.update((draft) => {
      draft.auth.pendingMagicLinks.push({
        token: magicLinkToken,
        email,
        createdAt: nowIso(),
      });
    });

    return sendJson(res, 200, {
      message: "Magic link created.",
      email,
      magicLinkToken,
      verifyEndpoint: "/api/auth/magic-link/verify",
      magicLinkUrl: requestOrigin ? `${requestOrigin}/#/login?magicToken=${encodeURIComponent(magicLinkToken)}` : null,
    });
  }

  if (routeKey === "POST /api/auth/magic-link/verify") {
    const token = assertString(body.token, "token");

    const result = await store.update((draft) => {
      const index = draft.auth.pendingMagicLinks.findIndex((entry) => entry.token === token);
      if (index === -1) {
        throw new HttpError(404, "Magic-link token not found.");
      }

      const entry = draft.auth.pendingMagicLinks[index];
      draft.auth.pendingMagicLinks.splice(index, 1);

      let foundUser = draft.organization.members.find((member) => member.email.toLowerCase() === entry.email.toLowerCase());
      if (!foundUser) {
        foundUser = {
          id: "u1",
          name: toDisplayName(entry.email),
          email: entry.email,
          role: "Owner",
        };
        draft.organization.members = [foundUser, ...draft.organization.members.filter((member) => member.role !== "Owner")];
      }

      const sessionToken = uniqueId("token");
      draft.auth.sessions.push({
        token: sessionToken,
        userId: foundUser.id,
        createdAt: nowIso(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      appendAuditEvent(draft, "auth.magic_link.verify", foundUser.id, { email: entry.email });

      return {
        token: sessionToken,
        user: foundUser,
      };
    });

    return sendJson(res, 200, result);
  }

  if (routeKey === "GET /api/auth/me") {
    return sendJson(res, 200, {
      user,
      session: {
        token: session.token,
        expiresAt: session.expiresAt,
      },
    });
  }

  if (routeKey === "POST /api/auth/logout") {
    await store.update((draft) => {
      draft.auth.sessions = draft.auth.sessions.filter((entry) => entry.token !== session.token);
      appendAuditEvent(draft, "auth.logout", user.id);
    });

    return sendJson(res, 200, { success: true });
  }

  if (routeKey === "GET /api/bootstrap") {
    return sendJson(res, 200, buildBootstrapPayload(req, snapshot, user, twilioConfig));
  }

  if (routeKey === "GET /api/dashboard") {
    return sendJson(res, 200, buildDashboard(snapshot));
  }

  if (routeKey === "GET /api/organization") {
    return sendJson(res, 200, serializeOrganization(req, snapshot.organization, twilioConfig));
  }

  if (routeKey === "PATCH /api/organization/profile") {
    const updates = assertObject(body, "profile");

    const organization = await store.update((draft) => {
      const nextProfile = { ...draft.organization.profile };

      if ("name" in updates) {
        nextProfile.name = assertString(updates.name, "profile.name");
      }
      if ("industry" in updates) {
        nextProfile.industry = assertString(updates.industry, "profile.industry");
      }
      if ("website" in updates) {
        nextProfile.website = normalizeWebsite(updates.website);
      }
      if ("location" in updates) {
        nextProfile.location = assertString(updates.location, "profile.location");
      }
      if ("onboarded" in updates) {
        nextProfile.onboarded = assertBoolean(updates.onboarded, "profile.onboarded");
      }
      if ("timezone" in updates) {
        nextProfile.timezone = assertString(updates.timezone, "profile.timezone");
        draft.organization.settings.timezone = nextProfile.timezone;
      }

      draft.organization.profile = nextProfile;
      appendAuditEvent(draft, "organization.profile.update", user.id, updates);
      return draft.organization;
    });

    return sendJson(res, 200, organization);
  }

  if (routeKey === "GET /api/settings") {
    return sendJson(res, 200, serializeSettings(req, snapshot.organization.settings, twilioConfig));
  }

  if (routeKey === "PATCH /api/settings") {
    const settingsPatch = assertObject(body, "settings");

    const settings = await store.update((draft) => {
      if ("timezone" in settingsPatch) {
        draft.organization.settings.timezone = assertString(settingsPatch.timezone, "settings.timezone");
        draft.organization.profile.timezone = draft.organization.settings.timezone;
      }
      if ("phoneNumber" in settingsPatch) {
        draft.organization.settings.phoneNumber = assertString(settingsPatch.phoneNumber, "settings.phoneNumber", { maxLength: 50 });
        draft.organization.phoneNumber = draft.organization.settings.phoneNumber;
      }
      if ("twilio" in settingsPatch) {
        const twilioPatch = assertObject(settingsPatch.twilio, "settings.twilio");
        draft.organization.settings.twilio = draft.organization.settings.twilio || {
          accountSid: "",
          authToken: "",
          validateRequests: true,
        };

        const clearCredentials = "clearCredentials" in twilioPatch
          ? assertBoolean(twilioPatch.clearCredentials, "settings.twilio.clearCredentials")
          : false;

        if (clearCredentials) {
          draft.organization.settings.twilio.accountSid = "";
          draft.organization.settings.twilio.authToken = "";
        }
        if ("accountSid" in twilioPatch) {
          draft.organization.settings.twilio.accountSid = assertString(
            twilioPatch.accountSid,
            "settings.twilio.accountSid",
            { required: false, maxLength: 80 }
          );
        }
        if ("authToken" in twilioPatch) {
          draft.organization.settings.twilio.authToken = assertString(
            twilioPatch.authToken,
            "settings.twilio.authToken",
            { required: false, maxLength: 120 }
          );
        }
        if ("validateRequests" in twilioPatch) {
          draft.organization.settings.twilio.validateRequests = assertBoolean(
            twilioPatch.validateRequests,
            "settings.twilio.validateRequests"
          );
        }
      }
      appendAuditEvent(draft, "settings.update", user.id, settingsPatch);
      return draft.organization.settings;
    });

    return sendJson(res, 200, serializeSettings(req, settings, twilioConfig));
  }

  if (routeKey === "POST /api/onboarding/faqs") {
    const website = normalizeWebsite(body.website);
    return sendJson(res, 200, {
      website,
      faqs: buildFaqsFromWebsite(website, snapshot.organization),
    });
  }

  if (routeKey === "POST /api/onboarding/complete") {
    const profile = assertObject(body.profile, "profile");
    const agent = assertObject(body.agent, "agent");

    const organization = await store.update((draft) => {
      draft.organization.profile = {
        ...draft.organization.profile,
        name: assertString(profile.name, "profile.name"),
        industry: assertString(profile.industry || draft.organization.profile.industry, "profile.industry"),
        website: normalizeWebsite(profile.website || draft.organization.profile.website),
        location: assertString(profile.location || draft.organization.profile.location, "profile.location"),
        onboarded: true,
        timezone: assertString(profile.timezone || draft.organization.profile.timezone, "profile.timezone"),
      };

      const nextAgent = sanitizeAgentPatch(agent, {
        ...draft.organization.agent,
        faqs: Array.isArray(agent.faqs) && agent.faqs.length > 0
          ? agent.faqs.map((faq) => ({
            id: assertString(faq.id || uniqueId("faq"), "agent.faqs[].id", { required: false, maxLength: 100 }) || uniqueId("faq"),
            question: assertString(faq.question, "agent.faqs[].question"),
            answer: assertString(faq.answer, "agent.faqs[].answer"),
          }))
          : draft.organization.agent.faqs,
      });
      replaceVoiceAgentById(draft, draft.organization.activeVoiceAgentId, nextAgent);

      appendAuditEvent(draft, "onboarding.complete", user.id, {
        organizationName: draft.organization.profile.name,
      });

      return draft.organization;
    });

    return sendJson(res, 200, organization);
  }

  if (routeKey === "GET /api/voice-agents") {
    return sendJson(res, 200, {
      items: snapshot.organization.voiceAgents,
      activeVoiceAgentId: snapshot.organization.activeVoiceAgentId,
    });
  }

  if (routeKey === "POST /api/voice-agents") {
    const voiceAgent = await store.update((draft) => {
      const nextAgent = buildVoiceAgentTemplate(draft);
      const patch = assertObject(body || {}, "voiceAgent");
      const sanitized = sanitizeAgentPatch(patch, nextAgent);

      if (Array.isArray(patch.faqs) && patch.faqs.length > 0) {
        sanitized.faqs = patch.faqs.map((faq) => ({
          id: assertString(faq.id || uniqueId("faq"), "voiceAgent.faqs[].id", { required: false, maxLength: 100 }) || uniqueId("faq"),
          question: assertString(faq.question, "voiceAgent.faqs[].question"),
          answer: assertString(faq.answer, "voiceAgent.faqs[].answer"),
        }));
      }

      draft.organization.voiceAgents.push(sanitized);
      draft.organization.activeVoiceAgentId = sanitized.id;
      appendAuditEvent(draft, "voice_agent.create", user.id, { voiceAgentId: sanitized.id });
      return sanitized;
    });

    return sendJson(res, 201, voiceAgent);
  }

  if (routeKey === "PATCH /api/voice-agents/:id") {
    const voiceAgent = await store.update((draft) => {
      const existingAgent = findVoiceAgentById(draft, params.id);
      if (!existingAgent) {
        throw new HttpError(404, "Voice agent not found.");
      }

      const patch = assertObject(body, "voiceAgent");
      const sanitized = sanitizeAgentPatch(patch, existingAgent);
      Object.assign(existingAgent, sanitized);
      appendAuditEvent(draft, "voice_agent.update", user.id, { voiceAgentId: existingAgent.id });
      return existingAgent;
    });

    return sendJson(res, 200, voiceAgent);
  }

  if (routeKey === "DELETE /api/voice-agents/:id") {
    await store.update((draft) => {
      if (draft.organization.voiceAgents.length <= 1) {
        throw new HttpError(400, "At least one voice agent must remain.");
      }

      const exists = findVoiceAgentById(draft, params.id);
      if (!exists) {
        throw new HttpError(404, "Voice agent not found.");
      }

      draft.organization.voiceAgents = draft.organization.voiceAgents.filter((agent) => agent.id !== params.id);
      const fallbackAgent = draft.organization.voiceAgents[0];
      if (draft.organization.activeVoiceAgentId === params.id) {
        draft.organization.activeVoiceAgentId = fallbackAgent.id;
      }
      for (const chatbot of draft.organization.chatbots) {
        if (chatbot.voiceAgentId === params.id) {
          chatbot.voiceAgentId = fallbackAgent.id;
        }
      }

      appendAuditEvent(draft, "voice_agent.delete", user.id, { voiceAgentId: params.id });
    });

    return sendJson(res, 200, { success: true });
  }

  if (routeKey === "POST /api/voice-agents/:id/activate") {
    const activeVoiceAgent = await store.update((draft) => {
      const existingAgent = findVoiceAgentById(draft, params.id);
      if (!existingAgent) {
        throw new HttpError(404, "Voice agent not found.");
      }

      draft.organization.activeVoiceAgentId = existingAgent.id;
      appendAuditEvent(draft, "voice_agent.activate", user.id, { voiceAgentId: existingAgent.id });
      return existingAgent;
    });

    return sendJson(res, 200, activeVoiceAgent);
  }

  if (routeKey === "POST /api/voice-agents/:id/outbound-calls") {
    const existingAgent = findVoiceAgentById(snapshot, params.id);
    if (!existingAgent) {
      throw new HttpError(404, "Voice agent not found.");
    }
    if (existingAgent.direction !== "outbound") {
      throw new HttpError(400, "Only outbound voice agents can launch Twilio outbound calls.");
    }
    if (!existingAgent.twilioPhoneNumber) {
      throw new HttpError(400, "Assign a Twilio phone number to this voice agent before launching outbound calls.");
    }

    const to = assertString(body.to, "to", { maxLength: 50 });
    const contactName = assertString(body.contactName || body.callerName || "", "contactName", { required: false, maxLength: 120 });
    const prompt = assertString(
      body.prompt || `Hello, this is ${existingAgent.name} from ${snapshot.organization.profile.name}. I'm following up on your recent inquiry.`,
      "prompt",
      { maxLength: 600 }
    );
    const machineDetection = body.machineDetection
      ? assertEnum(body.machineDetection, ["Enable", "DetectMessageEnd"], "machineDetection")
      : "";

    const outboundSessionId = uniqueId("twilio_outbound");
    await store.update((draft) => {
      ensureTwilioState(draft);
      draft.twilio.pendingOutboundCalls[outboundSessionId] = {
        id: outboundSessionId,
        agentId: existingAgent.id,
        customerPhone: to,
        customerName: contactName,
        prompt,
        createdByUserId: user.id,
        createdAt: nowIso(),
        machineDetection,
        status: "queued",
        callSid: "",
      };
    });

    const instructionsUrl = buildTwilioWebhookUrl(
      req,
      workspaceTwilioConfig,
      `/api/twilio/voice/${encodeURIComponent(existingAgent.id)}/outbound/${encodeURIComponent(outboundSessionId)}/twiml`
    );
    const statusCallbackParams = new URLSearchParams({
      sessionId: outboundSessionId,
      agentId: existingAgent.id,
    });
    const statusCallbackUrl = buildTwilioWebhookUrl(req, workspaceTwilioConfig, "/api/twilio/voice/status", statusCallbackParams);

    let createdCall;
    try {
      createdCall = await createTwilioCall({
        config: workspaceTwilioConfig,
        to,
        from: existingAgent.twilioPhoneNumber,
        instructionsUrl,
        statusCallbackUrl,
        machineDetection,
      });
    } catch (error) {
      await store.update((draft) => {
        ensureTwilioState(draft);
        delete draft.twilio.pendingOutboundCalls[outboundSessionId];
      });
      throw new HttpError(502, error.message);
    }

    const responsePayload = await store.update((draft) => {
      ensureTwilioState(draft);
      const pending = draft.twilio.pendingOutboundCalls[outboundSessionId];
      if (!pending) {
        throw new HttpError(500, "Outbound call session was lost before it could be stored.");
      }

      pending.callSid = createdCall.sid || "";
      pending.status = createdCall.status || "queued";

      const twilioSession = createTwilioSession({
        agent: existingAgent,
        direction: "outbound",
        callSid: createdCall.sid || uniqueId("twilio_call"),
        customerPhone: to,
        customerName: contactName,
        prompt,
        outboundSessionId,
      });
      twilioSession.startedAt = pending.createdAt;
      twilioSession.updatedAt = nowIso();
      twilioSession.status = createdCall.status || "queued";

      draft.twilio.activeCalls[twilioSession.callSid] = twilioSession;
      appendAuditEvent(draft, "twilio.outbound_call.create", user.id, {
        voiceAgentId: existingAgent.id,
        callSid: twilioSession.callSid,
        to,
        from: existingAgent.twilioPhoneNumber,
      });

      return {
        id: outboundSessionId,
        callSid: twilioSession.callSid,
        status: createdCall.status || "queued",
        to,
        from: existingAgent.twilioPhoneNumber,
        direction: "outbound",
        prompt,
        instructionsUrl,
        statusCallbackUrl,
      };
    });

    return sendJson(res, 201, responsePayload);
  }

  if (routeKey === "GET /api/chatbots") {
    return sendJson(res, 200, {
      items: snapshot.organization.chatbots.map((chatbot) => serializeChatbot(req, chatbot)),
      activeChatbotId: snapshot.organization.activeChatbotId,
    });
  }

  if (routeKey === "POST /api/chatbots") {
    const chatbot = await store.update((draft) => {
      const nextChatbot = buildChatbotTemplate(draft);
      const patch = assertObject(body || {}, "chatbot");
      const sanitized = sanitizeChatbotPatch(patch, nextChatbot, draft);
      draft.organization.chatbots.push(sanitized);
      draft.organization.activeChatbotId = sanitized.id;
      draft.conversations.byChatbotId[sanitized.id] = [];
      appendAuditEvent(draft, "chatbot.create", user.id, { chatbotId: sanitized.id });
      return sanitized;
    });

    return sendJson(res, 201, serializeChatbot(req, chatbot));
  }

  if (routeKey === "PATCH /api/chatbots/:id") {
    const chatbot = await store.update((draft) => {
      const existingChatbot = findChatbotById(draft, params.id);
      if (!existingChatbot) {
        throw new HttpError(404, "Chatbot not found.");
      }

      const sanitized = sanitizeChatbotPatch(assertObject(body, "chatbot"), existingChatbot, draft);
      Object.assign(existingChatbot, sanitized);
      appendAuditEvent(draft, "chatbot.update", user.id, { chatbotId: existingChatbot.id });
      return existingChatbot;
    });

    return sendJson(res, 200, serializeChatbot(req, chatbot));
  }

  if (routeKey === "DELETE /api/chatbots/:id") {
    await store.update((draft) => {
      if (draft.organization.chatbots.length <= 1) {
        throw new HttpError(400, "At least one chatbot must remain.");
      }

      const exists = findChatbotById(draft, params.id);
      if (!exists) {
        throw new HttpError(404, "Chatbot not found.");
      }

      draft.organization.chatbots = draft.organization.chatbots.filter((chatbot) => chatbot.id !== params.id);
      delete draft.conversations.byChatbotId[params.id];
      if (draft.organization.activeChatbotId === params.id) {
        draft.organization.activeChatbotId = draft.organization.chatbots[0].id;
      }
      appendAuditEvent(draft, "chatbot.delete", user.id, { chatbotId: params.id });
    });

    return sendJson(res, 200, { success: true });
  }

  if (routeKey === "POST /api/chatbots/:id/activate") {
    const activeChatbot = await store.update((draft) => {
      const existingChatbot = findChatbotById(draft, params.id);
      if (!existingChatbot) {
        throw new HttpError(404, "Chatbot not found.");
      }

      draft.organization.activeChatbotId = existingChatbot.id;
      appendAuditEvent(draft, "chatbot.activate", user.id, { chatbotId: existingChatbot.id });
      return existingChatbot;
    });

    return sendJson(res, 200, serializeChatbot(req, activeChatbot));
  }

  if (routeKey === "GET /api/chatbots/:id/embed") {
    const chatbot = findChatbotById(snapshot, params.id);
    if (!chatbot) {
      throw new HttpError(404, "Chatbot not found.");
    }

    return sendJson(res, 200, {
      chatbot: serializeChatbot(req, chatbot),
      script: buildEmbedScriptTag(req, chatbot),
    });
  }

  if (routeKey === "GET /api/agent") {
    return sendJson(res, 200, snapshot.organization.agent);
  }

  if (routeKey === "PATCH /api/agent") {
    const nextAgent = await store.update((draft) => {
      const updatedAgent = sanitizeAgentPatch(assertObject(body, "agent"), draft.organization.agent);
      replaceVoiceAgentById(draft, draft.organization.activeVoiceAgentId, updatedAgent);
      appendAuditEvent(draft, "agent.update", user.id, body);
      return draft.organization.agent;
    });

    return sendJson(res, 200, nextAgent);
  }

  if (routeKey === "GET /api/agent/faqs") {
    return sendJson(res, 200, snapshot.organization.agent.faqs);
  }

  if (routeKey === "POST /api/agent/faqs") {
    const faq = await store.update((draft) => {
      const nextFaq = {
        id: uniqueId("faq"),
        question: assertString(body.question, "question"),
        answer: assertString(body.answer, "answer"),
      };
      draft.organization.agent.faqs.push(nextFaq);
      appendAuditEvent(draft, "agent.faq.create", user.id, { faqId: nextFaq.id });
      return nextFaq;
    });

    return sendJson(res, 201, faq);
  }

  if (routeKey === "PATCH /api/agent/faqs/:id") {
    const faq = await store.update((draft) => {
      const existingFaq = draft.organization.agent.faqs.find((entry) => entry.id === params.id);
      if (!existingFaq) {
        throw new HttpError(404, "FAQ entry not found.");
      }

      if ("question" in body) {
        existingFaq.question = assertString(body.question, "question");
      }
      if ("answer" in body) {
        existingFaq.answer = assertString(body.answer, "answer");
      }
      appendAuditEvent(draft, "agent.faq.update", user.id, { faqId: existingFaq.id });
      return existingFaq;
    });

    return sendJson(res, 200, faq);
  }

  if (routeKey === "DELETE /api/agent/faqs/:id") {
    await store.update((draft) => {
      const startLength = draft.organization.agent.faqs.length;
      draft.organization.agent.faqs = draft.organization.agent.faqs.filter((faq) => faq.id !== params.id);
      if (draft.organization.agent.faqs.length === startLength) {
        throw new HttpError(404, "FAQ entry not found.");
      }
      appendAuditEvent(draft, "agent.faq.delete", user.id, { faqId: params.id });
    });

    return sendJson(res, 200, { success: true });
  }

  if (routeKey === "POST /api/agent/faqs/sync") {
    const website = normalizeWebsite(body.website || snapshot.organization.profile.website);

    const faqs = await store.update((draft) => {
      draft.organization.profile.website = website;
      draft.organization.agent.faqs = buildFaqsFromWebsite(website, draft.organization);
      appendAuditEvent(draft, "agent.faq.sync", user.id, { website });
      return draft.organization.agent.faqs;
    });

    return sendJson(res, 200, { website, faqs });
  }

  if (routeKey === "POST /api/agent/restart") {
    await store.update((draft) => {
      const activeVoiceAgent = getActiveVoiceAgent(draft);
      appendAuditEvent(draft, "agent.restart", user.id, {
        phoneNumber: activeVoiceAgent.twilioPhoneNumber || draft.organization.phoneNumber,
        direction: activeVoiceAgent.direction,
      });
    });

    return sendJson(res, 200, {
      success: true,
      message: `${snapshot.organization.agent.name} was restarted successfully.`,
      restartedAt: nowIso(),
    });
  }

  if (routeKey === "GET /api/messenger/messages") {
    const chatbotId = url.searchParams.get("chatbotId") || snapshot.organization.activeChatbotId;
    const chatbot = findChatbotById(snapshot, chatbotId);
    if (!chatbot) {
      throw new HttpError(404, "Chatbot not found.");
    }

    return sendJson(res, 200, getConversation(snapshot, chatbot.id));
  }

  if (routeKey === "POST /api/messenger/messages") {
    const message = assertString(body.message, "message");
    const chatbotId = assertString(body.chatbotId || url.searchParams.get("chatbotId") || snapshot.organization.activeChatbotId, "chatbotId");
    if (!findChatbotById(snapshot, chatbotId)) {
      throw new HttpError(404, "Chatbot not found.");
    }

    const response = await store.update((draft) => {
      const thread = getConversation(draft, chatbotId);
      draft.conversations.byChatbotId[chatbotId] = [...thread];

      const userMessage = {
        id: uniqueId("msg"),
        role: "user",
        text: message,
        timestamp: nowIso(),
      };
      const assistantMessage = {
        id: uniqueId("msg"),
        role: "model",
        text: findFaqResponse(message, draft, chatbotId),
        timestamp: nowIso(),
      };

      draft.conversations.byChatbotId[chatbotId].push(userMessage, assistantMessage);
      appendAuditEvent(draft, "messenger.message", user.id, { message, chatbotId });

      return {
        userMessage,
        assistantMessage,
        conversation: draft.conversations.byChatbotId[chatbotId],
      };
    });

    return sendJson(res, 200, response);
  }

  if (routeKey === "DELETE /api/messenger/messages") {
    const chatbotId = body.chatbotId || url.searchParams.get("chatbotId") || snapshot.organization.activeChatbotId;
    const chatbot = findChatbotById(snapshot, chatbotId);
    if (!chatbot) {
      throw new HttpError(404, "Chatbot not found.");
    }

    await store.update((draft) => {
      draft.conversations.byChatbotId[chatbotId] = [];
      appendAuditEvent(draft, "messenger.reset", user.id, { chatbotId });
    });

    return sendJson(res, 200, {
      success: true,
      conversation: [
        {
          id: `msg_greeting_${chatbot.id}`,
          role: "model",
          text: chatbot.welcomeMessage,
          timestamp: nowIso(),
        },
      ],
    });
  }

  if (routeKey === "GET /api/public/chatbots/:id/config") {
    const chatbot = findChatbotById(snapshot, params.id);
    if (!chatbot) {
      throw new HttpError(404, "Chatbot not found.");
    }

    return sendJson(res, 200, {
      id: chatbot.id,
      name: chatbot.name,
      headerTitle: chatbot.headerTitle,
      welcomeMessage: chatbot.welcomeMessage,
      placeholder: chatbot.placeholder,
      launcherLabel: chatbot.launcherLabel,
      accentColor: chatbot.accentColor,
      position: chatbot.position,
      avatarLabel: chatbot.avatarLabel,
      suggestedPrompts: chatbot.suggestedPrompts,
    });
  }

  if (routeKey === "POST /api/public/chatbots/:id/messages") {
    const chatbot = findChatbotById(snapshot, params.id);
    if (!chatbot) {
      throw new HttpError(404, "Chatbot not found.");
    }

    const message = assertString(body.message, "message");
    const assistantMessage = {
      id: uniqueId("msg"),
      role: "model",
      text: findFaqResponse(message, snapshot, chatbot.id),
      timestamp: nowIso(),
    };

    return sendJson(res, 200, {
      assistantMessage,
      chatbot: {
        id: chatbot.id,
        name: chatbot.name,
      },
    });
  }

  if (routeKey === "POST /api/twilio/voice/:id/inbound") {
    requireTwilioRequestValidation(req, url, body, workspaceTwilioConfig);

    const agent = findVoiceAgentById(snapshot, params.id);
    if (!agent) {
      throw new HttpError(404, "Voice agent not found.");
    }
    if (agent.direction !== "inbound") {
      throw new HttpError(400, "This voice agent is configured for outbound calling, not inbound webhooks.");
    }

    const callSid = assertString(body.CallSid, "CallSid", { maxLength: 120 });
    const callerPhone = assertString(body.From || body.Caller || "", "From", { required: false, maxLength: 50 });
    const callerName = assertString(body.CallerName || "", "CallerName", { required: false, maxLength: 120 });

    await store.update((draft) => {
      ensureTwilioState(draft);
      const existingSession = getTwilioActiveCall(draft, callSid);
      const nextSession = existingSession || createTwilioSession({
        agent,
        direction: "inbound",
        callSid,
        customerPhone: callerPhone,
        customerName: callerName,
      });

      nextSession.customerPhone = nextSession.customerPhone || callerPhone;
      nextSession.customerName = nextSession.customerName || callerName;
      nextSession.status = assertString(body.CallStatus || "in-progress", "CallStatus", { maxLength: 50 });
      nextSession.updatedAt = nowIso();
      if (nextSession.transcript.length === 0) {
        appendTranscriptLine(nextSession, "Agent", agent.greeting);
      }
      nextSession.twilioStatusHistory.unshift({
        status: nextSession.status,
        timestamp: nowIso(),
      });
      nextSession.twilioStatusHistory = nextSession.twilioStatusHistory.slice(0, 10);
      draft.twilio.activeCalls[callSid] = nextSession;
    });

    const gather = twimlGather(
      buildGatherActionAttributes(req, workspaceTwilioConfig, `/api/twilio/voice/${encodeURIComponent(agent.id)}/continue`, agent),
      twimlSay(agent.greeting)
    );

    return sendXml(
      res,
      200,
      buildTwimlResponse(
        gather,
        twimlSay("Thanks for calling. Goodbye."),
        twimlHangup()
      )
    );
  }

  if (routeKey === "POST /api/twilio/voice/:id/continue") {
    requireTwilioRequestValidation(req, url, body, workspaceTwilioConfig);

    const agent = findVoiceAgentById(snapshot, params.id);
    if (!agent) {
      throw new HttpError(404, "Voice agent not found.");
    }

    const callSid = assertString(body.CallSid, "CallSid", { maxLength: 120 });
    const speechResult = assertString(
      body.SpeechResult || (["0", "1"].includes(body.Digits) ? "transfer me to a human" : body.Digits || ""),
      "SpeechResult",
      { required: false, maxLength: 1000 }
    );

    if (!speechResult) {
      return sendXml(res, 200, buildTwimlResponse(
        twimlSay("Thanks for calling. Goodbye."),
        twimlHangup()
      ));
    }

    const turn = await store.update((draft) => {
      ensureTwilioState(draft);
      const session = getTwilioActiveCall(draft, callSid) || createTwilioSession({
        agent,
        direction: "inbound",
        callSid,
        customerPhone: assertString(body.From || "", "From", { required: false, maxLength: 50 }),
        customerName: assertString(body.CallerName || "", "CallerName", { required: false, maxLength: 120 }),
      });

      const nextTurn = buildVoiceTurn({
        message: speechResult,
        state: draft,
        agent,
        session,
      });

      session.customerPhone = session.customerPhone || assertString(body.From || "", "From", { required: false, maxLength: 50 });
      session.customerName = session.customerName || assertString(body.CallerName || "", "CallerName", { required: false, maxLength: 120 });
      session.lead = mergeLeadDetails(session.lead, nextTurn.leadDetails);
      session.shouldCaptureLead = session.shouldCaptureLead || nextTurn.shouldCaptureLead;
      session.outcome = mergeCallOutcome(session.outcome, nextTurn.outcome);
      session.turnCount += 1;
      session.updatedAt = nowIso();
      session.status = assertString(body.CallStatus || session.status || "in-progress", "CallStatus", { maxLength: 50 });
      appendTranscriptLine(session, "Caller", speechResult);
      appendTranscriptLine(session, "Agent", nextTurn.responseText);
      if (nextTurn.shouldContinue) {
        appendTranscriptLine(session, "Agent", "Is there anything else I can help you with today?");
      }
      draft.twilio.activeCalls[callSid] = session;

      return nextTurn;
    });

    if (turn.shouldDial) {
      return sendXml(
        res,
        200,
        buildTwimlResponse(
          twimlSay(turn.responseText),
          twimlDial(agent.escalationPhone)
        )
      );
    }

    if (turn.shouldContinue) {
      const gather = twimlGather(
        buildGatherActionAttributes(req, workspaceTwilioConfig, `/api/twilio/voice/${encodeURIComponent(agent.id)}/continue`, agent),
        twimlSay(turn.responseText) + twimlPause(1) + twimlSay("Is there anything else I can help you with today?")
      );

      return sendXml(
        res,
        200,
        buildTwimlResponse(
          gather,
          twimlSay("Thanks for calling. Goodbye."),
          twimlHangup()
        )
      );
    }

    return sendXml(
      res,
      200,
      buildTwimlResponse(
        twimlSay(turn.responseText),
        twimlSay("Thanks for calling. Goodbye."),
        twimlHangup()
      )
    );
  }

  if (routeKey === "POST /api/twilio/voice/:id/outbound/:sessionId/twiml") {
    requireTwilioRequestValidation(req, url, body, workspaceTwilioConfig);

    const agent = findVoiceAgentById(snapshot, params.id);
    if (!agent) {
      throw new HttpError(404, "Voice agent not found.");
    }
    if (agent.direction !== "outbound") {
      throw new HttpError(400, "This voice agent is not configured for outbound calling.");
    }

    const pending = getPendingTwilioOutboundCall(snapshot, params.sessionId);
    if (!pending) {
      throw new HttpError(404, "Outbound call session not found.");
    }

    const callSid = assertString(body.CallSid, "CallSid", { maxLength: 120 });
    await store.update((draft) => {
      ensureTwilioState(draft);
      const session = getTwilioActiveCall(draft, callSid) || createTwilioSession({
        agent,
        direction: "outbound",
        callSid,
        customerPhone: pending.customerPhone || assertString(body.To || "", "To", { required: false, maxLength: 50 }),
        customerName: pending.customerName || "",
        prompt: pending.prompt,
        outboundSessionId: params.sessionId,
      });

      session.customerPhone = session.customerPhone || pending.customerPhone || assertString(body.To || "", "To", { required: false, maxLength: 50 });
      session.customerName = session.customerName || pending.customerName || "";
      session.prompt = session.prompt || pending.prompt || "";
      session.status = assertString(body.CallStatus || "in-progress", "CallStatus", { maxLength: 50 });
      session.updatedAt = nowIso();
      if (session.transcript.length === 0) {
        appendTranscriptLine(session, "Agent", agent.greeting);
        appendTranscriptLine(session, "Agent", session.prompt);
      }
      draft.twilio.activeCalls[callSid] = session;
      draft.twilio.pendingOutboundCalls[params.sessionId] = {
        ...pending,
        callSid,
        status: session.status,
      };
    });

    const gather = twimlGather(
      buildGatherActionAttributes(
        req,
        workspaceTwilioConfig,
        `/api/twilio/voice/${encodeURIComponent(agent.id)}/outbound/${encodeURIComponent(params.sessionId)}/continue`,
        agent
      ),
      twimlSay(agent.greeting)
        + twimlPause(1)
        + twimlSay(pending.prompt)
        + twimlPause(1)
        + twimlSay("You can tell me more about your needs, or press 1 if you want to be connected to our team.")
    );

    return sendXml(
      res,
      200,
      buildTwimlResponse(
        gather,
        twimlSay("Thanks for your time. Goodbye."),
        twimlHangup()
      )
    );
  }

  if (routeKey === "POST /api/twilio/voice/:id/outbound/:sessionId/continue") {
    requireTwilioRequestValidation(req, url, body, workspaceTwilioConfig);

    const agent = findVoiceAgentById(snapshot, params.id);
    if (!agent) {
      throw new HttpError(404, "Voice agent not found.");
    }

    const pending = getPendingTwilioOutboundCall(snapshot, params.sessionId);
    if (!pending) {
      throw new HttpError(404, "Outbound call session not found.");
    }

    const callSid = assertString(body.CallSid, "CallSid", { maxLength: 120 });
    const speechResult = assertString(
      body.SpeechResult || (["0", "1"].includes(body.Digits) ? "transfer me to a human" : body.Digits || ""),
      "SpeechResult",
      { required: false, maxLength: 1000 }
    );

    if (!speechResult) {
      return sendXml(res, 200, buildTwimlResponse(
        twimlSay("Thanks for your time. Goodbye."),
        twimlHangup()
      ));
    }

    const turn = await store.update((draft) => {
      ensureTwilioState(draft);
      const session = getTwilioActiveCall(draft, callSid) || createTwilioSession({
        agent,
        direction: "outbound",
        callSid,
        customerPhone: pending.customerPhone || assertString(body.To || "", "To", { required: false, maxLength: 50 }),
        customerName: pending.customerName || "",
        prompt: pending.prompt,
        outboundSessionId: params.sessionId,
      });

      const nextTurn = buildVoiceTurn({
        message: speechResult,
        state: draft,
        agent,
        session,
      });

      session.customerPhone = session.customerPhone || pending.customerPhone || assertString(body.To || "", "To", { required: false, maxLength: 50 });
      session.customerName = session.customerName || pending.customerName || "";
      session.lead = mergeLeadDetails(session.lead, nextTurn.leadDetails);
      session.shouldCaptureLead = session.shouldCaptureLead || nextTurn.shouldCaptureLead;
      session.outcome = mergeCallOutcome(session.outcome, nextTurn.outcome);
      session.turnCount += 1;
      session.updatedAt = nowIso();
      session.status = assertString(body.CallStatus || session.status || "in-progress", "CallStatus", { maxLength: 50 });
      appendTranscriptLine(session, "Caller", speechResult);
      appendTranscriptLine(session, "Agent", nextTurn.responseText);
      if (nextTurn.shouldContinue) {
        appendTranscriptLine(session, "Agent", "Is there anything else you'd like us to help with?");
      }
      draft.twilio.activeCalls[callSid] = session;

      return nextTurn;
    });

    if (turn.shouldDial) {
      return sendXml(
        res,
        200,
        buildTwimlResponse(
          twimlSay(turn.responseText),
          twimlDial(agent.escalationPhone)
        )
      );
    }

    if (turn.shouldContinue) {
      const gather = twimlGather(
        buildGatherActionAttributes(
          req,
          workspaceTwilioConfig,
          `/api/twilio/voice/${encodeURIComponent(agent.id)}/outbound/${encodeURIComponent(params.sessionId)}/continue`,
          agent
        ),
        twimlSay(turn.responseText) + twimlPause(1) + twimlSay("Is there anything else you'd like us to help with?")
      );

      return sendXml(
        res,
        200,
        buildTwimlResponse(
          gather,
          twimlSay("Thanks for your time. Goodbye."),
          twimlHangup()
        )
      );
    }

    return sendXml(
      res,
      200,
      buildTwimlResponse(
        twimlSay(turn.responseText),
        twimlSay("Thanks for your time. Goodbye."),
        twimlHangup()
      )
    );
  }

  if (routeKey === "POST /api/twilio/voice/status") {
    requireTwilioRequestValidation(req, url, body, workspaceTwilioConfig);

    const callSid = assertString(body.CallSid, "CallSid", { maxLength: 120 });
    const callStatus = assertString(body.CallStatus || "unknown", "CallStatus", { maxLength: 50 });
    const sessionId = assertString(url.searchParams.get("sessionId") || "", "sessionId", { required: false, maxLength: 120 });
    const result = await store.update((draft) => {
      ensureTwilioState(draft);

      let session = getTwilioActiveCall(draft, callSid);
      const pending = sessionId ? getPendingTwilioOutboundCall(draft, sessionId) : null;
      if (!session && pending) {
        const pendingAgent = findVoiceAgentById(draft, pending.agentId);
        if (pendingAgent) {
          session = createTwilioSession({
            agent: pendingAgent,
            direction: "outbound",
            callSid,
            customerPhone: pending.customerPhone,
            customerName: pending.customerName,
            prompt: pending.prompt,
            outboundSessionId: sessionId,
          });
          session.startedAt = pending.createdAt;
          draft.twilio.activeCalls[callSid] = session;
        }
      }

      if (!session) {
        return {
          success: true,
          callSid,
          status: callStatus,
          finalized: false,
        };
      }

      session.callSid = callSid;
      session.status = callStatus;
      session.updatedAt = nowIso();
      session.answeredBy = assertString(body.AnsweredBy || session.answeredBy || "", "AnsweredBy", { required: false, maxLength: 120 });
      session.duration = Number.parseInt(body.CallDuration || session.duration || "0", 10) || 0;
      session.customerPhone = session.customerPhone
        || (session.direction === "outbound"
          ? assertString(body.To || "", "To", { required: false, maxLength: 50 })
          : assertString(body.From || "", "From", { required: false, maxLength: 50 }));
      session.twilioStatusHistory.unshift({
        status: callStatus,
        timestamp: nowIso(),
      });
      session.twilioStatusHistory = session.twilioStatusHistory.slice(0, 10);

      if (pending) {
        draft.twilio.pendingOutboundCalls[sessionId] = {
          ...pending,
          callSid,
          status: callStatus,
        };
      }

      if (["busy", "failed", "no-answer", "canceled"].includes(callStatus)) {
        session.outcome = mergeCallOutcome(session.outcome, CALL_OUTCOMES.VOICEMAIL);
      }

      if (["completed", "busy", "failed", "no-answer", "canceled"].includes(callStatus)) {
        const finalized = finalizeTwilioCallSession(draft, session, { callStatus });
        appendAuditEvent(draft, "twilio.call.completed", session.direction === "outbound" ? (pending?.createdByUserId || "system") : "system", {
          callSid,
          callStatus,
          direction: session.direction,
          voiceAgentId: session.agentId,
          callRecordId: finalized.call?.id || null,
        });

        return {
          success: true,
          callSid,
          status: callStatus,
          finalized: true,
          call: finalized.call,
          lead: finalized.lead,
        };
      }

      return {
        success: true,
        callSid,
        status: callStatus,
        finalized: false,
      };
    });

    return sendJson(res, 200, result);
  }

  if (routeKey === "GET /api/calls") {
    const search = (url.searchParams.get("search") || "").toLowerCase();
    const outcome = url.searchParams.get("outcome");
    const limit = Number(url.searchParams.get("limit") || 0);

    let calls = [...snapshot.calls].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    if (search) {
      calls = calls.filter((call) =>
        call.callerName.toLowerCase().includes(search) ||
        call.callerPhone.toLowerCase().includes(search) ||
        call.summary.toLowerCase().includes(search)
      );
    }
    if (outcome && outcome !== "All") {
      calls = calls.filter((call) => call.outcome === outcome);
    }
    if (limit > 0) {
      calls = calls.slice(0, limit);
    }

    return sendJson(res, 200, calls);
  }

  if (routeKey === "POST /api/calls/simulate") {
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    const outcome = inferCallOutcome(transcript, body.outcome);
    const leadDetails = extractLeadDetails(transcript, assertObject(body.lead || {}, "lead"));
    const summary = summarizeTranscript(transcript, outcome, leadDetails);
    const { call, timestamp } = buildCallFromSimulation({
      transcript,
      callerName: body.callerName,
      callerPhone: body.callerPhone,
      duration: typeof body.duration === "number" ? body.duration : 60,
      outcome,
      summary,
      lead: leadDetails,
    });

    const payload = await store.update((draft) => {
      draft.calls.unshift(call);

      const createdLead = [CALL_OUTCOMES.LEAD_CAPTURED, CALL_OUTCOMES.APPOINTMENT_BOOKED].includes(outcome)
        ? buildLeadFromDetails(leadDetails, timestamp)
        : null;

      if (createdLead) {
        draft.leads.unshift(createdLead);
      }

      const additionalMinutes = Math.max(1, Math.ceil(call.duration / 60));
      draft.organization.subscription.usage.calls = Math.min(
        draft.organization.subscription.usage.callLimit,
        draft.organization.subscription.usage.calls + 1
      );
      draft.organization.subscription.usage.minutes = Math.min(
        draft.organization.subscription.usage.minuteLimit,
        draft.organization.subscription.usage.minutes + additionalMinutes
      );
      appendAuditEvent(draft, "call.simulate", user.id, { callId: call.id, outcome });

      return {
        call,
        lead: createdLead,
      };
    });

    return sendJson(res, 201, payload);
  }

  if (routeKey === "GET /api/calls/:id") {
    const call = findCallById(snapshot, params.id);
    if (!call) {
      throw new HttpError(404, "Call not found.");
    }

    return sendJson(res, 200, call);
  }

  if (routeKey === "GET /api/calls/:id/transcript") {
    const call = findCallById(snapshot, params.id);
    if (!call) {
      throw new HttpError(404, "Call not found.");
    }

    return sendJson(res, 200, {
      id: call.id,
      transcript: call.transcript,
    });
  }

  if (routeKey === "GET /api/calls/:id/report") {
    const call = findCallById(snapshot, params.id);
    if (!call) {
      throw new HttpError(404, "Call not found.");
    }

    const report = [
      `Agently Call Report`,
      ``,
      `Call ID: ${call.id}`,
      `Caller: ${call.callerName}`,
      `Phone: ${call.callerPhone}`,
      `Timestamp: ${call.timestamp}`,
      `Duration: ${call.duration} seconds`,
      `Outcome: ${call.outcome}`,
      ``,
      `Summary:`,
      `${call.summary}`,
      ``,
      `Transcript:`,
      ...call.transcript.map((line) => `${line.speaker}: ${line.text}`),
    ].join("\n");

    return sendText(res, 200, report, {
      "Content-Disposition": `attachment; filename="${call.id}-report.txt"`,
    });
  }

  if (routeKey === "GET /api/leads") {
    const search = (url.searchParams.get("search") || "").toLowerCase();
    const status = url.searchParams.get("status");

    let leads = [...snapshot.leads].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    if (search) {
      leads = leads.filter((lead) =>
        lead.name.toLowerCase().includes(search) ||
        lead.phone.toLowerCase().includes(search) ||
        lead.email.toLowerCase().includes(search) ||
        lead.reason.toLowerCase().includes(search)
      );
    }
    if (status && status !== "All") {
      leads = leads.filter((lead) => lead.status === status);
    }

    return sendJson(res, 200, leads);
  }

  if (routeKey === "POST /api/leads") {
    const lead = await store.update((draft) => {
      const nextLead = {
        id: uniqueId("lead"),
        name: assertString(body.name, "name"),
        email: assertString(body.email || "", "email", { required: false, maxLength: 320 }),
        phone: assertString(body.phone, "phone", { maxLength: 50 }),
        reason: assertString(body.reason, "reason"),
        createdAt: nowIso(),
        status: body.status ? assertEnum(body.status, ["new", "contacted", "closed"], "status") : "new",
      };
      draft.leads.unshift(nextLead);
      appendAuditEvent(draft, "lead.create", user.id, { leadId: nextLead.id });
      return nextLead;
    });

    return sendJson(res, 201, lead);
  }

  if (routeKey === "PATCH /api/leads/:id") {
    const lead = await store.update((draft) => {
      const existingLead = findLeadById(draft, params.id);
      if (!existingLead) {
        throw new HttpError(404, "Lead not found.");
      }

      if ("name" in body) {
        existingLead.name = assertString(body.name, "name");
      }
      if ("email" in body) {
        existingLead.email = assertString(body.email, "email", { required: false, maxLength: 320 });
      }
      if ("phone" in body) {
        existingLead.phone = assertString(body.phone, "phone", { maxLength: 50 });
      }
      if ("reason" in body) {
        existingLead.reason = assertString(body.reason, "reason");
      }
      if ("status" in body) {
        existingLead.status = assertEnum(body.status, ["new", "contacted", "closed"], "status");
      }
      appendAuditEvent(draft, "lead.update", user.id, { leadId: existingLead.id });
      return existingLead;
    });

    return sendJson(res, 200, lead);
  }

  if (routeKey === "DELETE /api/leads/:id") {
    await store.update((draft) => {
      const startLength = draft.leads.length;
      draft.leads = draft.leads.filter((lead) => lead.id !== params.id);
      if (draft.leads.length === startLength) {
        throw new HttpError(404, "Lead not found.");
      }
      appendAuditEvent(draft, "lead.delete", user.id, { leadId: params.id });
    });

    return sendJson(res, 200, { success: true });
  }

  if (routeKey === "GET /api/leads/export.csv") {
    const rows = [
      ["id", "name", "email", "phone", "reason", "createdAt", "status"],
      ...snapshot.leads.map((lead) => [
        lead.id,
        lead.name,
        lead.email,
        lead.phone,
        lead.reason,
        lead.createdAt,
        lead.status,
      ]),
    ];

    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    return sendCsv(res, "agently-leads.csv", csv);
  }

  if (routeKey === "GET /api/team/members") {
    return sendJson(res, 200, snapshot.organization.members);
  }

  if (routeKey === "POST /api/team/invitations") {
    const email = assertString(body.email, "email");
    const role = assertEnum(body.role || "Viewer", ["Admin", "Viewer"], "role");

    const member = await store.update((draft) => {
      const exists = draft.organization.members.find((entry) => entry.email.toLowerCase() === email.toLowerCase());
      if (exists) {
        throw new HttpError(409, "A member with that email already exists.");
      }

      const nextMember = {
        id: uniqueId("user"),
        name: toDisplayName(email, "Teammate"),
        email,
        role,
      };
      draft.organization.members.push(nextMember);
      appendAuditEvent(draft, "team.invite", user.id, { email, role });
      return nextMember;
    });

    return sendJson(res, 201, {
      invitation: {
        email,
        role,
        status: "sent",
      },
      member,
    });
  }

  if (routeKey === "PATCH /api/team/members/:id") {
    const member = await store.update((draft) => {
      const existingMember = draft.organization.members.find((entry) => entry.id === params.id);
      if (!existingMember) {
        throw new HttpError(404, "Member not found.");
      }
      if (existingMember.role === "Owner") {
        throw new HttpError(400, "Owner role cannot be modified from this endpoint.");
      }

      existingMember.role = assertEnum(body.role, ["Admin", "Viewer"], "role");
      appendAuditEvent(draft, "team.member.update", user.id, { memberId: existingMember.id, role: existingMember.role });
      return existingMember;
    });

    return sendJson(res, 200, member);
  }

  if (routeKey === "DELETE /api/team/members/:id") {
    await store.update((draft) => {
      const existingMember = draft.organization.members.find((entry) => entry.id === params.id);
      if (!existingMember) {
        throw new HttpError(404, "Member not found.");
      }
      if (existingMember.role === "Owner") {
        throw new HttpError(400, "Owner cannot be removed.");
      }

      draft.organization.members = draft.organization.members.filter((entry) => entry.id !== params.id);
      appendAuditEvent(draft, "team.member.delete", user.id, { memberId: params.id });
    });

    return sendJson(res, 200, { success: true });
  }

  if (routeKey === "GET /api/billing") {
    return sendJson(res, 200, {
      subscription: snapshot.organization.subscription,
      invoices: snapshot.organization.invoices,
      usagePercent: snapshot.organization.subscription.usage.minuteLimit > 0
        ? Math.min(100, Math.round((snapshot.organization.subscription.usage.minutes / snapshot.organization.subscription.usage.minuteLimit) * 100))
        : 0,
    });
  }

  if (routeKey === "PATCH /api/billing/plan") {
    const plan = assertEnum(body.plan, ["Starter", "Pro"], "plan");

    const subscription = await store.update((draft) => {
      draft.organization.subscription.plan = plan;
      draft.organization.subscription.status = "active";
      draft.organization.subscription.currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      draft.organization.subscription.usage.callLimit = PLAN_LIMITS[plan].callLimit;
      draft.organization.subscription.usage.minuteLimit = PLAN_LIMITS[plan].minuteLimit;

      const invoice = createInvoice(plan);
      invoice.pdfUrl = `/api/billing/invoices/${invoice.id}/download`;
      draft.organization.invoices.unshift(invoice);

      appendAuditEvent(draft, "billing.plan.update", user.id, { plan });
      return draft.organization.subscription;
    });

    return sendJson(res, 200, subscription);
  }

  if (routeKey === "POST /api/billing/cancel") {
    const subscription = await store.update((draft) => {
      draft.organization.subscription.status = "canceled";
      appendAuditEvent(draft, "billing.plan.cancel", user.id);
      return draft.organization.subscription;
    });

    return sendJson(res, 200, subscription);
  }

  if (routeKey === "GET /api/billing/invoices") {
    return sendJson(res, 200, snapshot.organization.invoices);
  }

  if (routeKey === "GET /api/billing/invoices/:id") {
    const invoice = findInvoiceById(snapshot, params.id);
    if (!invoice) {
      throw new HttpError(404, "Invoice not found.");
    }

    return sendJson(res, 200, invoice);
  }

  if (routeKey === "GET /api/billing/invoices/:id/download") {
    const invoice = findInvoiceById(snapshot, params.id);
    if (!invoice) {
      throw new HttpError(404, "Invoice not found.");
    }

    const receipt = [
      `Agently Invoice`,
      ``,
      `Invoice ID: ${invoice.id}`,
      `Date: ${invoice.date}`,
      `Status: ${invoice.status}`,
      `Amount: $${Number(invoice.amount).toFixed(2)}`,
      `Plan: ${snapshot.organization.subscription.plan}`,
      `Organization: ${snapshot.organization.profile.name}`,
    ].join("\n");

    return sendText(res, 200, receipt, {
      "Content-Disposition": `attachment; filename="${invoice.id}.txt"`,
    });
  }

  if (routeKey === "POST /api/contact") {
    const payload = {
      id: uniqueId("contact"),
      name: assertString(body.name, "name"),
      email: assertString(body.email, "email"),
      subject: assertString(body.subject, "subject"),
      message: assertString(body.message, "message"),
      createdAt: nowIso(),
    };

    await store.update((draft) => {
      draft.contactMessages.unshift(payload);
    });

    return sendJson(res, 201, {
      success: true,
      message: "Contact message received.",
      submission: payload,
    });
  }

  if (routeKey === "POST /api/contact-sales") {
    const payload = {
      id: uniqueId("sales"),
      name: assertString(body.name || "Sales Lead", "name"),
      email: assertString(body.email, "email"),
      companyName: assertString(body.companyName || "Unknown Company", "companyName"),
      expectedVolume: assertString(body.expectedVolume || "Not specified", "expectedVolume"),
      message: assertString(body.message || "Interested in enterprise pricing.", "message"),
      createdAt: nowIso(),
    };

    await store.update((draft) => {
      draft.salesInquiries.unshift(payload);
    });

    return sendJson(res, 201, {
      success: true,
      message: "Sales inquiry received.",
      inquiry: payload,
    });
  }

  throw new HttpError(404, `No handler was found for ${pathname}.`);
};

const buildRouteKey = (method, pathname) => {
  const exactRoutes = [
    "/",
    "/health",
    "/api",
    "/api/docs",
    "/embed/chatbot.js",
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/magic-link",
    "/api/auth/magic-link/verify",
    "/api/auth/me",
    "/api/auth/logout",
    "/api/bootstrap",
    "/api/dashboard",
    "/api/organization",
    "/api/organization/profile",
    "/api/settings",
    "/api/onboarding/faqs",
    "/api/onboarding/complete",
    "/api/voice-agents",
    "/api/agent",
    "/api/agent/faqs",
    "/api/agent/faqs/sync",
    "/api/agent/restart",
    "/api/chatbots",
    "/api/messenger/messages",
    "/api/calls",
    "/api/calls/simulate",
    "/api/leads",
    "/api/leads/export.csv",
    "/api/team/members",
    "/api/team/invitations",
    "/api/billing",
    "/api/billing/plan",
    "/api/billing/cancel",
    "/api/billing/invoices",
    "/api/contact",
    "/api/contact-sales",
    "/api/twilio/voice/status",
  ];

  if (exactRoutes.includes(pathname)) {
    return { routeKey: `${method} ${pathname}`, params: {} };
  }

  const dynamicPatterns = [
    "/api/voice-agents/:id",
    "/api/voice-agents/:id/activate",
    "/api/voice-agents/:id/outbound-calls",
    "/api/agent/faqs/:id",
    "/api/chatbots/:id",
    "/api/chatbots/:id/activate",
    "/api/chatbots/:id/embed",
    "/api/public/chatbots/:id/config",
    "/api/public/chatbots/:id/messages",
    "/api/twilio/voice/:id/inbound",
    "/api/twilio/voice/:id/continue",
    "/api/twilio/voice/:id/outbound/:sessionId/twiml",
    "/api/twilio/voice/:id/outbound/:sessionId/continue",
    "/api/calls/:id",
    "/api/calls/:id/transcript",
    "/api/calls/:id/report",
    "/api/leads/:id",
    "/api/team/members/:id",
    "/api/billing/invoices/:id",
    "/api/billing/invoices/:id/download",
  ];

  for (const pattern of dynamicPatterns) {
    const params = matchRoute(pathname, pattern);
    if (params) {
      return { routeKey: `${method} ${pattern}`, params };
    }
  }

  return { routeKey: `${method} ${pathname}`, params: {} };
};

export const createAgentlyServer = async ({
  port = DEFAULT_PORT,
  host = DEFAULT_HOST,
  dataFile = DEFAULT_DATA_FILE,
  storeProvider,
  twilio,
} = {}) => {
  const twilioConfig = resolveTwilioConfig(twilio);
  const store = createStore({
    provider: storeProvider,
    dataFile,
    createDefaultState,
    normalizeState: normalizeWorkspaceState,
  });
  await store.init();

  const handleRequest = async (req, res, overrideRouteContext = null) => {
    try {
      const requestTarget = req.originalUrl || req.url || "/";
      const url = new URL(requestTarget, `http://${req.headers.host || "localhost"}`);
      res.__corsPathname = url.pathname;
      setCorsHeaders(res);

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const { routeKey, params } = overrideRouteContext || buildRouteKey(req.method, url.pathname);
      if (!KNOWN_ROUTE_KEYS.has(routeKey)) {
        throw new HttpError(404, `No handler was found for ${url.pathname}.`);
      }

      await route(req, res, url, store, routeKey, params, twilioConfig);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, {
          error: {
            message: error.message,
            details: error.details || null,
          },
          timestamp: nowIso(),
        });
        return;
      }

      console.error("Unhandled server error:", error);
      sendJson(res, 500, {
        error: {
          message: "Internal server error.",
        },
        timestamp: nowIso(),
      });
    }
  };

  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.__corsPathname = req.path || req.url || "";
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    next();
  });

  for (const entry of ROUTE_DOCS) {
    const methodName = entry.method.toLowerCase();
    app[methodName](entry.path, (req, res) => {
      void handleRequest(req, res, {
        routeKey: `${entry.method} ${entry.path}`,
        params: req.params || {},
      });
    });
  }

  app.use((req, res) => {
    void handleRequest(req, res);
  });

  const server = http.createServer(app);

  server.keepAliveTimeout = 10_000;

  return {
    app,
    server,
    store,
    handler: handleRequest,
    start: () =>
      new Promise((resolve) => {
        server.listen(port, host, () => {
          const address = server.address();
          const resolvedPort = typeof address === "object" && address ? address.port : port;
          resolve({ port: resolvedPort, host, dataFile });
        });
      }),
  };
};

let cachedDefaultAppPromise = null;

const getDefaultApp = async () => {
  if (!cachedDefaultAppPromise) {
    const dataFile = process.env.AGENTLY_DATA_FILE
      || (process.env.VERCEL ? path.join("/tmp", "agently-store.json") : DEFAULT_DATA_FILE);

    cachedDefaultAppPromise = createAgentlyServer({ dataFile }).then(({ app }) => app);
  }

  return cachedDefaultAppPromise;
};

export default async function handler(req, res) {
  const app = await getDefaultApp();
  return app(req, res);
}

const isMainModule = process.argv[1] === __filename;

if (isMainModule) {
  void (async () => {
    const { server, start } = await createAgentlyServer();
    await start();
    console.log(`Agently backend listening on http://${DEFAULT_HOST}:${DEFAULT_PORT}`);

    const shutdown = () => {
      server.close(() => {
        process.exit(0);
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })().catch((error) => {
    console.error("Failed to start Agently backend:", error);
    process.exit(1);
  });
}
