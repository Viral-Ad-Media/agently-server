import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAgentlyServer } from "../src/server.js";

const createTestContext = async (t, { initialState } = {}) => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "agently-server-"));
  const dataFile = path.join(tempDirectory, "store.json");
  if (initialState !== undefined) {
    await writeFile(dataFile, JSON.stringify(initialState, null, 2), "utf8");
  }
  const { handler } = await createAgentlyServer({
    dataFile,
    storeProvider: "json",
  });

  t.after(async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  });

  return { handler };
};

const invoke = async ({ handler, method, path: requestPath, token, body, headers: extraHeaders = {} }) => {
  const payload = body == null
    ? ""
    : typeof body === "string"
      ? body
      : JSON.stringify(body);

  const headers = {
    host: "localhost:4000",
  };

  if (payload) {
    headers["content-type"] = "application/json";
  }
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  Object.assign(headers, extraHeaders);

  const req = {
    method,
    url: requestPath,
    headers,
    async *[Symbol.asyncIterator]() {
      if (payload) {
        yield Buffer.from(payload);
      }
    },
  };

  const responseState = {
    statusCode: 200,
    headers: {},
    body: "",
  };

  const res = {
    setHeader(name, value) {
      responseState.headers[name.toLowerCase()] = value;
    },
    writeHead(statusCode, headersToWrite = {}) {
      responseState.statusCode = statusCode;
      for (const [key, value] of Object.entries(headersToWrite)) {
        responseState.headers[key.toLowerCase()] = value;
      }
    },
    end(chunk = "") {
      responseState.body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    },
  };

  await handler(req, res);

  const contentType = responseState.headers["content-type"] || "";
  const parsedJson = responseState.body && contentType.includes("application/json")
    ? JSON.parse(responseState.body)
    : null;

  return {
    status: responseState.statusCode,
    headers: responseState.headers,
    text: responseState.body,
    json: parsedJson,
  };
};

test("health route returns ok", async (t) => {
  const { handler } = await createTestContext(t);
  const response = await invoke({ handler, method: "GET", path: "/health" });

  assert.equal(response.status, 200);
  const payload = response.json;
  assert.equal(payload.status, "ok");
});

test("login returns a bearer token and authenticated endpoints work", async (t) => {
  const { handler } = await createTestContext(t);

  const loginResponse = await invoke({
    handler,
    method: "POST",
    path: "/api/auth/login",
    body: {
      email: "owner@example.com",
      password: "demo-password",
    },
  });

  assert.equal(loginResponse.status, 200);
  const loginPayload = loginResponse.json;
  assert.ok(loginPayload.token);

  const dashboardResponse = await invoke({
    handler,
    method: "GET",
    path: "/api/dashboard",
    token: loginPayload.token,
  });

  assert.equal(dashboardResponse.status, 200);
  const dashboardPayload = dashboardResponse.json;
  assert.equal(typeof dashboardPayload.stats.totalCalls, "number");
});

test("register accepts preflight and creates a new workspace session", async (t) => {
  const { handler } = await createTestContext(t);

  const preflightResponse = await invoke({
    handler,
    method: "OPTIONS",
    path: "/api/auth/register",
    headers: {
      origin: "https://agently-xi.vercel.app",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });

  assert.equal(preflightResponse.status, 204);
  assert.equal(preflightResponse.headers["access-control-allow-methods"], "GET,POST,PATCH,PUT,DELETE,OPTIONS");

  const registerResponse = await invoke({
    handler,
    method: "POST",
    path: "/api/auth/register",
    headers: {
      origin: "https://agently-xi.vercel.app",
    },
    body: {
      name: "New Owner",
      email: "new-owner@example.com",
      password: "demo-password",
      companyName: "Agently Test Co",
    },
  });

  assert.equal(registerResponse.status, 201);
  assert.ok(registerResponse.headers["access-control-allow-origin"]);
  assert.ok(registerResponse.json.token);
  assert.equal(registerResponse.json.user.email, "new-owner@example.com");
});

test("register hydrates an incomplete persisted state before writing", async (t) => {
  const { handler } = await createTestContext(t, {
    initialState: {},
  });

  const registerResponse = await invoke({
    handler,
    method: "POST",
    path: "/api/auth/register",
    body: {
      name: "Recovered Owner",
      email: "recovered-owner@example.com",
      password: "demo-password",
      companyName: "Recovered Workspace",
    },
  });

  assert.equal(registerResponse.status, 201);
  assert.equal(registerResponse.json.user.email, "recovered-owner@example.com");
});

test("voice agent and chatbot collections support creation and public embed delivery", async (t) => {
  const { handler } = await createTestContext(t);
  const token = "demo-owner-token";

  const voiceAgentResponse = await invoke({
    handler,
    method: "POST",
    path: "/api/voice-agents",
    token,
    body: {
      name: "Lucia",
      language: "Spanish",
      tone: "Friendly",
    },
  });

  assert.equal(voiceAgentResponse.status, 201);
  assert.equal(voiceAgentResponse.json.name, "Lucia");

  const chatbotResponse = await invoke({
    handler,
    method: "POST",
    path: "/api/chatbots",
    token,
    body: {
      name: "Booking Bot",
      voiceAgentId: voiceAgentResponse.json.id,
      accentColor: "#0EA5E9",
      welcomeMessage: "Hi! I can help visitors book faster.",
    },
  });

  assert.equal(chatbotResponse.status, 201);
  assert.ok(chatbotResponse.json.embedScript.includes("data-chatbot-id"));

  const configResponse = await invoke({
    handler,
    method: "GET",
    path: `/api/public/chatbots/${chatbotResponse.json.id}/config`,
  });

  assert.equal(configResponse.status, 200);
  assert.equal(configResponse.json.name, "Booking Bot");

  const publicMessageResponse = await invoke({
    handler,
    method: "POST",
    path: `/api/public/chatbots/${chatbotResponse.json.id}/messages`,
    body: {
      message: "What are your hours?",
    },
  });

  assert.equal(publicMessageResponse.status, 200);
  assert.ok(publicMessageResponse.json.assistantMessage.text.includes("Booking Bot"));

  const embedScriptResponse = await invoke({
    handler,
    method: "GET",
    path: "/embed/chatbot.js",
  });

  assert.equal(embedScriptResponse.status, 200);
  assert.ok((embedScriptResponse.headers["content-type"] || "").includes("application/javascript"));
  assert.ok(embedScriptResponse.text.includes("data-chatbot-id"));
});

test("faq sync, messenger, call simulation, and csv export all respond", async (t) => {
  const { handler } = await createTestContext(t);
  const token = "demo-owner-token";

  const faqResponse = await invoke({
    handler,
    method: "POST",
    path: "/api/onboarding/faqs",
    token,
    body: {
      website: "www.brightpathdental.com",
    },
  });
  assert.equal(faqResponse.status, 200);
  const faqPayload = faqResponse.json;
  assert.ok(Array.isArray(faqPayload.faqs));
  assert.ok(faqPayload.faqs.length > 0);

  const messengerResponse = await invoke({
    handler,
    method: "POST",
    path: "/api/messenger/messages",
    token,
    body: {
      message: "What are your office hours?",
    },
  });
  assert.equal(messengerResponse.status, 200);
  const messengerPayload = messengerResponse.json;
  assert.ok(messengerPayload.assistantMessage.text.includes("Website Concierge"));

  const callResponse = await invoke({
    handler,
    method: "POST",
    path: "/api/calls/simulate",
    token,
    body: {
      transcript: "Caller: My name is Jamie North. I want to schedule a cleaning. My number is 555-111-2222.",
      duration: 95,
    },
  });
  assert.equal(callResponse.status, 201);
  const callPayload = callResponse.json;
  assert.equal(callPayload.call.outcome, "Appointment Booked");
  assert.ok(callPayload.lead);

  const csvResponse = await invoke({
    handler,
    method: "GET",
    path: "/api/leads/export.csv",
    token,
  });
  assert.equal(csvResponse.status, 200);
  const csvText = csvResponse.text;
  assert.ok(csvText.includes("name,email,phone"));
  assert.ok(csvText.includes("Jamie North"));
});
