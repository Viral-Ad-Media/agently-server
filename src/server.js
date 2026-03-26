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
  PLAN_LIMITS,
  createDefaultState,
} from "./defaults.js";
import { createStore } from "./store.js";

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
  "POST /api/auth/login",
  "POST /api/auth/register",
  "POST /api/auth/magic-link",
  "POST /api/auth/magic-link/verify",
  "POST /api/contact",
  "POST /api/contact-sales",
]);

const ROUTE_DOCS = [
  { method: "GET", path: "/", auth: false, description: "Root landing response for serverless platforms and uptime checks." },
  { method: "GET", path: "/health", auth: false, description: "Simple uptime and health check." },
  { method: "GET", path: "/api", auth: false, description: "Small API landing response with version and docs link." },
  { method: "GET", path: "/api/docs", auth: false, description: "Structured list of every available endpoint." },
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
  { method: "GET", path: "/api/agent", auth: true, description: "Return the current agent configuration." },
  { method: "PATCH", path: "/api/agent", auth: true, description: "Update agent configuration and nested rules." },
  { method: "GET", path: "/api/agent/faqs", auth: true, description: "Return the agent FAQ list." },
  { method: "POST", path: "/api/agent/faqs", auth: true, description: "Create a custom FAQ entry." },
  { method: "PATCH", path: "/api/agent/faqs/:id", auth: true, description: "Update a single FAQ entry." },
  { method: "DELETE", path: "/api/agent/faqs/:id", auth: true, description: "Delete a single FAQ entry." },
  { method: "POST", path: "/api/agent/faqs/sync", auth: true, description: "Regenerate FAQs from the organization website and replace the list." },
  { method: "POST", path: "/api/agent/restart", auth: true, description: "Record a restart event for the agent." },
  { method: "GET", path: "/api/messenger/messages", auth: true, description: "Return the current messenger thread." },
  { method: "POST", path: "/api/messenger/messages", auth: true, description: "Append a user message and generate an agent reply." },
  { method: "DELETE", path: "/api/messenger/messages", auth: true, description: "Reset the messenger thread back to the greeting state." },
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

const setCorsHeaders = (res) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
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

const sendCsv = (res, filename, content) => {
  setCorsHeaders(res);
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  res.end(content);
};

const readJsonBody = async (req) => {
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

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
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

const findCallById = (state, id) => state.calls.find((call) => call.id === id) || null;
const findLeadById = (state, id) => state.leads.find((lead) => lead.id === id) || null;
const findInvoiceById = (state, id) => state.organization.invoices.find((invoice) => invoice.id === id) || null;

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
      agentName: state.organization.agent.name,
      phoneNumber: state.organization.phoneNumber,
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

const getConversation = (state) => {
  const greeting = {
    id: "msg_greeting",
    role: "model",
    text: state.organization.agent.greeting,
    timestamp: nowIso(),
  };

  const conversation = state.conversations.default;
  return conversation.length > 0 ? conversation : [greeting];
};

const findFaqResponse = (message, state) => {
  const normalized = message.toLowerCase();
  const { profile, agent } = state.organization;

  if (normalized.includes("hour")) {
    return `${agent.name}: We are available during ${agent.businessHours}.`;
  }
  if (normalized.includes("where") || normalized.includes("location")) {
    return `${agent.name}: We are based in ${profile.location}.`;
  }
  if (normalized.includes("human") || normalized.includes("transfer") || normalized.includes("person")) {
    return `${agent.name}: I can escalate this to our team at ${agent.escalationPhone}.`;
  }
  if (normalized.includes("appointment") || normalized.includes("book") || normalized.includes("schedule")) {
    return `${agent.name}: I can help with that. Please share your name, phone number, and preferred time so the team can confirm the appointment.`;
  }

  for (const faq of agent.faqs) {
    const questionWords = faq.question.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3);
    if (questionWords.some((word) => normalized.includes(word))) {
      return `${agent.name}: ${faq.answer}`;
    }
  }

  const toneFallbacks = {
    Professional: `${agent.name}: I can help with that. Please share a few more details and I will capture the request for the team.`,
    Friendly: `${agent.name}: Happy to help! Share a bit more detail and I will make sure the team gets everything they need.`,
    Empathetic: `${agent.name}: I’m here to help. Tell me a little more and I’ll make sure your message is handled with care.`,
  };

  return toneFallbacks[agent.tone] || toneFallbacks.Professional;
};

const sanitizeAgentPatch = (body, currentAgent) => {
  const nextAgent = { ...currentAgent };

  if ("name" in body) {
    nextAgent.name = assertString(body.name, "agent.name");
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

const buildBootstrapPayload = (state, user) => ({
  user,
  organization: state.organization,
  leads: state.leads,
  calls: state.calls,
  conversation: getConversation(state),
  dashboard: buildDashboard(state),
});

const route = async (req, res, url, store, routeKey, params) => {
  const snapshot = await store.read();
  const { session, user } = requireSession(req, snapshot, routeKey);
  const body = BODY_METHODS.has(req.method) ? await readJsonBody(req) : {};
  const pathname = url.pathname;

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
      baseUrl: `http://${req.headers.host || `localhost:${DEFAULT_PORT}`}`,
      auth: {
        type: "Bearer",
        seedToken: "demo-owner-token",
      },
      routes: ROUTE_DOCS,
    });
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

    return sendJson(res, 200, result);
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

    return sendJson(res, 201, result);
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
    return sendJson(res, 200, buildBootstrapPayload(snapshot, user));
  }

  if (routeKey === "GET /api/dashboard") {
    return sendJson(res, 200, buildDashboard(snapshot));
  }

  if (routeKey === "GET /api/organization") {
    return sendJson(res, 200, snapshot.organization);
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
    return sendJson(res, 200, snapshot.organization.settings);
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
      appendAuditEvent(draft, "settings.update", user.id, settingsPatch);
      return draft.organization.settings;
    });

    return sendJson(res, 200, settings);
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

      draft.organization.agent = sanitizeAgentPatch(agent, {
        ...draft.organization.agent,
        faqs: Array.isArray(agent.faqs) && agent.faqs.length > 0
          ? agent.faqs.map((faq) => ({
            id: assertString(faq.id || uniqueId("faq"), "agent.faqs[].id", { required: false, maxLength: 100 }) || uniqueId("faq"),
            question: assertString(faq.question, "agent.faqs[].question"),
            answer: assertString(faq.answer, "agent.faqs[].answer"),
          }))
          : draft.organization.agent.faqs,
      });

      appendAuditEvent(draft, "onboarding.complete", user.id, {
        organizationName: draft.organization.profile.name,
      });

      return draft.organization;
    });

    return sendJson(res, 200, organization);
  }

  if (routeKey === "GET /api/agent") {
    return sendJson(res, 200, snapshot.organization.agent);
  }

  if (routeKey === "PATCH /api/agent") {
    const nextAgent = await store.update((draft) => {
      draft.organization.agent = sanitizeAgentPatch(assertObject(body, "agent"), draft.organization.agent);
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
      appendAuditEvent(draft, "agent.restart", user.id, {
        phoneNumber: draft.organization.phoneNumber,
      });
    });

    return sendJson(res, 200, {
      success: true,
      message: `${snapshot.organization.agent.name} was restarted successfully.`,
      restartedAt: nowIso(),
    });
  }

  if (routeKey === "GET /api/messenger/messages") {
    return sendJson(res, 200, getConversation(snapshot));
  }

  if (routeKey === "POST /api/messenger/messages") {
    const message = assertString(body.message, "message");

    const response = await store.update((draft) => {
      const thread = getConversation(draft);
      draft.conversations.default = [...thread];

      const userMessage = {
        id: uniqueId("msg"),
        role: "user",
        text: message,
        timestamp: nowIso(),
      };
      const assistantMessage = {
        id: uniqueId("msg"),
        role: "model",
        text: findFaqResponse(message, draft),
        timestamp: nowIso(),
      };

      draft.conversations.default.push(userMessage, assistantMessage);
      appendAuditEvent(draft, "messenger.message", user.id, { message });

      return {
        userMessage,
        assistantMessage,
        conversation: draft.conversations.default,
      };
    });

    return sendJson(res, 200, response);
  }

  if (routeKey === "DELETE /api/messenger/messages") {
    await store.update((draft) => {
      draft.conversations.default = [];
      appendAuditEvent(draft, "messenger.reset", user.id);
    });

    return sendJson(res, 200, {
      success: true,
      conversation: [
        {
          id: "msg_greeting",
          role: "model",
          text: snapshot.organization.agent.greeting,
          timestamp: nowIso(),
        },
      ],
    });
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
    "/api/agent",
    "/api/agent/faqs",
    "/api/agent/faqs/sync",
    "/api/agent/restart",
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
  ];

  if (exactRoutes.includes(pathname)) {
    return { routeKey: `${method} ${pathname}`, params: {} };
  }

  const dynamicPatterns = [
    "/api/agent/faqs/:id",
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
} = {}) => {
  const store = createStore({
    provider: storeProvider,
    dataFile,
    createDefaultState,
  });
  await store.init();

  const handleRequest = async (req, res, overrideRouteContext = null) => {
    try {
      setCorsHeaders(res);

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const requestTarget = req.originalUrl || req.url || "/";
      const url = new URL(requestTarget, `http://${req.headers.host || "localhost"}`);
      const { routeKey, params } = overrideRouteContext || buildRouteKey(req.method, url.pathname);
      if (!KNOWN_ROUTE_KEYS.has(routeKey)) {
        throw new HttpError(404, `No handler was found for ${url.pathname}.`);
      }

      await route(req, res, url, store, routeKey, params);
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
