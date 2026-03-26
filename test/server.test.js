import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAgentlyServer } from "../src/server.js";

const createTestContext = async (t) => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "agently-server-"));
  const dataFile = path.join(tempDirectory, "store.json");
  const { handler } = await createAgentlyServer({
    dataFile,
    storeProvider: "json",
  });

  t.after(async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  });

  return { handler };
};

const invoke = async ({ handler, method, path: requestPath, token, body }) => {
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
  assert.ok(messengerPayload.assistantMessage.text.includes("Maya"));

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
