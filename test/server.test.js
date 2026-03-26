import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { createAgentlyServer } from "../src/server.js";

const createTestContext = async (t, { initialState, twilio, websiteImportFetch } = {}) => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "agently-server-"));
  const dataFile = path.join(tempDirectory, "store.json");
  if (initialState !== undefined) {
    await writeFile(dataFile, JSON.stringify(initialState, null, 2), "utf8");
  }
  const { handler } = await createAgentlyServer({
    dataFile,
    storeProvider: "json",
    twilio,
    websiteImportFetch,
  });

  t.after(async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  });

  return { handler };
};

const invoke = async ({ handler, method, path: requestPath, token, body, headers: extraHeaders = {} }) => {
  const headers = {
    host: "localhost:4000",
  };
  Object.assign(headers, extraHeaders);

  const requestContentType = String(headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
  const payload = body == null
    ? ""
    : typeof body === "string"
      ? body
      : requestContentType.includes("application/x-www-form-urlencoded")
        ? new URLSearchParams(body).toString()
        : JSON.stringify(body);

  if (payload && !requestContentType) {
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

const buildTwilioTestSignature = ({ authToken, requestUrl, params = {} }) => {
  const payload = Object.keys(params)
    .sort()
    .reduce((result, key) => result + key + String(params[key] ?? ""), requestUrl);

  return createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
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

test("onboarding FAQ import extracts knowledge from website HTML", async (t) => {
  const websiteImportFetch = async () => ({
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : "";
      },
    },
    async text() {
      return `
        <html>
          <head>
            <title>Acme Receptionists</title>
            <meta name="description" content="Acme helps home service teams answer calls, capture leads, and book jobs without missing customers." />
          </head>
          <body>
            <main>
              <h1>24/7 call handling</h1>
              <p>Our voice agents answer calls around the clock, qualify leads, and hand urgent issues to your team fast.</p>
              <h2>Booking and scheduling</h2>
              <p>Customers can request appointments, share addresses, and leave callback preferences for the team.</p>
              <h2>Contact us</h2>
              <p>Call +1 (833) 555-0110 or email hello@acme.example for onboarding support.</p>
            </main>
          </body>
        </html>
      `;
    },
  });

  const { handler } = await createTestContext(t, { websiteImportFetch });
  const response = await invoke({
    handler,
    method: "POST",
    path: "/api/onboarding/faqs",
    token: "demo-owner-token",
    body: {
      website: "acme.example.com",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.website, "acme.example.com");
  assert.ok(response.json.faqs.some((faq) => faq.answer.includes("answer calls around the clock")));
  assert.ok(response.json.faqs.some((faq) => faq.answer.includes("hello@acme.example")));
});

test("agent FAQ sync replaces knowledge with imported website content", async (t) => {
  const websiteImportFetch = async () => ({
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : "";
      },
    },
    async text() {
      return `
        <html>
          <head>
            <meta name="description" content="Bright Clinic helps patients request appointments and get fast answers from a virtual receptionist." />
          </head>
          <body>
            <main>
              <h1>Insurance and intake</h1>
              <p>Patients can share insurance details, appointment goals, and callback preferences before a staff member follows up.</p>
              <h2>Urgent questions</h2>
              <p>After-hours callers can leave urgent concerns and the office can prioritize them the next morning.</p>
            </main>
          </body>
        </html>
      `;
    },
  });

  const { handler } = await createTestContext(t, { websiteImportFetch });
  const syncResponse = await invoke({
    handler,
    method: "POST",
    path: "/api/agent/faqs/sync",
    token: "demo-owner-token",
    body: {
      website: "brightclinic.example",
    },
  });

  assert.equal(syncResponse.status, 200);
  assert.ok(syncResponse.json.faqs.some((faq) => faq.answer.includes("insurance details")));

  const faqsResponse = await invoke({
    handler,
    method: "GET",
    path: "/api/agent/faqs",
    token: "demo-owner-token",
  });

  assert.equal(faqsResponse.status, 200);
  assert.ok(faqsResponse.json.some((faq) => faq.answer.includes("insurance details")));
});

test("website import rejects localhost targets", async (t) => {
  const { handler } = await createTestContext(t);
  const response = await invoke({
    handler,
    method: "POST",
    path: "/api/onboarding/faqs",
    token: "demo-owner-token",
    body: {
      website: "localhost:3000",
    },
  });

  assert.equal(response.status, 400);
  assert.match(response.json.error.message, /public URL/i);
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
      direction: "outbound",
      twilioPhoneNumber: "+1 (833) 555-0110",
      twilioPhoneSid: "PNluciaoutbound",
      language: "Spanish",
      tone: "Friendly",
    },
  });

  assert.equal(voiceAgentResponse.status, 201);
  assert.equal(voiceAgentResponse.json.name, "Lucia");
  assert.equal(voiceAgentResponse.json.direction, "outbound");
  assert.equal(voiceAgentResponse.json.twilioPhoneNumber, "+1 (833) 555-0110");

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
      faqs: [
        {
          id: "booking_policy",
          question: "Do you offer Saturday appointments?",
          answer: "Yes. Saturday booking requests are supported through this chatbot and routed for confirmation within one business day.",
        },
      ],
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
      message: "Do you offer Saturday appointments?",
    },
  });

  assert.equal(publicMessageResponse.status, 200);
  assert.ok(publicMessageResponse.json.assistantMessage.text.includes("Saturday booking requests"));

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

test("twilio inbound webhooks validate signatures and finalize a real inbound call", async (t) => {
  const twilioAuthToken = "twilio-test-token";
  const twilioBaseUrl = "https://agently-server.test";
  const { handler } = await createTestContext(t, {
    twilio: {
      webhookBaseUrl: twilioBaseUrl,
      validateRequests: true,
    },
  });

  const connectResponse = await invoke({
    handler,
    method: "PATCH",
    path: "/api/settings",
    token: "demo-owner-token",
    body: {
      twilio: {
        accountSid: "ACworkspace123",
        authToken: twilioAuthToken,
        validateRequests: true,
      },
    },
  });

  assert.equal(connectResponse.status, 200);
  assert.equal(connectResponse.json.twilio.accountSid, "ACworkspace123");
  assert.equal(connectResponse.json.twilio.authTokenConfigured, true);
  assert.equal(connectResponse.json.twilio.authTokenLastFour, "oken");
  assert.equal(Object.prototype.hasOwnProperty.call(connectResponse.json.twilio, "authToken"), false);

  const inboundBody = {
    CallSid: "CAinbound123",
    From: "+15551234567",
    CallerName: "Jamie North",
    CallStatus: "in-progress",
  };

  const inboundSignature = buildTwilioTestSignature({
    authToken: twilioAuthToken,
    requestUrl: `${twilioBaseUrl}/api/twilio/voice/voice_agent_1/inbound`,
    params: inboundBody,
  });

  const inboundResponse = await invoke({
    handler,
    method: "POST",
    path: "/api/twilio/voice/voice_agent_1/inbound",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": inboundSignature,
    },
    body: inboundBody,
  });

  assert.equal(inboundResponse.status, 200);
  assert.ok(inboundResponse.text.includes("<Gather"));
  assert.ok(inboundResponse.text.includes("How can I assist you today?"));

  const continueBody = {
    CallSid: "CAinbound123",
    From: "+15551234567",
    CallerName: "Jamie North",
    CallStatus: "in-progress",
    SpeechResult: "What are your office hours?",
  };
  const continueSignature = buildTwilioTestSignature({
    authToken: twilioAuthToken,
    requestUrl: `${twilioBaseUrl}/api/twilio/voice/voice_agent_1/continue`,
    params: continueBody,
  });

  const continueResponse = await invoke({
    handler,
    method: "POST",
    path: "/api/twilio/voice/voice_agent_1/continue",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": continueSignature,
    },
    body: continueBody,
  });

  assert.equal(continueResponse.status, 200);
  assert.ok(continueResponse.text.includes("<Response>"));

  const statusBody = {
    CallSid: "CAinbound123",
    CallStatus: "completed",
    CallDuration: "64",
    From: "+15551234567",
  };
  const statusSignature = buildTwilioTestSignature({
    authToken: twilioAuthToken,
    requestUrl: `${twilioBaseUrl}/api/twilio/voice/status`,
    params: statusBody,
  });

  const statusResponse = await invoke({
    handler,
    method: "POST",
    path: "/api/twilio/voice/status",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": statusSignature,
    },
    body: statusBody,
  });

  assert.equal(statusResponse.status, 200);
  assert.equal(statusResponse.json.finalized, true);
  assert.equal(statusResponse.json.call.outcome, "FAQ Answered");
  assert.equal(statusResponse.json.call.callerPhone, "+15551234567");
  assert.ok(statusResponse.json.call.transcript.some((line) => line.text.includes("office hours")));
});

test("twilio outbound initiation creates a call and finalizes callbacks into call logs", async (t) => {
  const twilioRequests = [];
  const twilioAuthToken = "twilio-test-token";
  const twilioBaseUrl = "https://agently-server.test";
  const fetchImpl = async (requestUrl, options) => {
    twilioRequests.push({
      requestUrl,
      options,
    });

    return {
      ok: true,
      status: 201,
      headers: {
        get(name) {
          return name.toLowerCase() === "content-type" ? "application/json" : null;
        },
      },
      async json() {
        return {
          sid: "CAoutbound123",
          status: "queued",
        };
      },
    };
  };

  const { handler } = await createTestContext(t, {
    twilio: {
      webhookBaseUrl: twilioBaseUrl,
      validateRequests: true,
      fetchImpl,
    },
  });

  const token = "demo-owner-token";
  const settingsResponse = await invoke({
    handler,
    method: "PATCH",
    path: "/api/settings",
    token,
    body: {
      twilio: {
        accountSid: "ACworkspace456",
        authToken: twilioAuthToken,
        validateRequests: true,
      },
    },
  });

  assert.equal(settingsResponse.status, 200);
  assert.equal(settingsResponse.json.twilio.accountSid, "ACworkspace456");

  const voiceAgentResponse = await invoke({
    handler,
    method: "POST",
    path: "/api/voice-agents",
    token,
    body: {
      name: "Outbound Maya",
      direction: "outbound",
      twilioPhoneNumber: "+18335550110",
      twilioPhoneSid: "PNoutboundmaya",
    },
  });

  assert.equal(voiceAgentResponse.status, 201);

  const launchResponse = await invoke({
    handler,
    method: "POST",
    path: `/api/voice-agents/${voiceAgentResponse.json.id}/outbound-calls`,
    token,
    body: {
      to: "+15557654321",
      contactName: "Jordan Lee",
      prompt: "Hi Jordan, we are following up on your demo request.",
      machineDetection: "DetectMessageEnd",
    },
  });

  assert.equal(launchResponse.status, 201);
  assert.equal(launchResponse.json.callSid, "CAoutbound123");
  assert.equal(twilioRequests.length, 1);
  assert.ok(twilioRequests[0].requestUrl.includes("/Calls.json"));
  assert.ok(String(twilioRequests[0].options.body).includes("To=%2B15557654321"));
  assert.ok(String(twilioRequests[0].options.body).includes("From=%2B18335550110"));

  const twimlBody = {
    CallSid: "CAoutbound123",
    To: "+15557654321",
    CallStatus: "in-progress",
  };
  const twimlSignature = buildTwilioTestSignature({
    authToken: twilioAuthToken,
    requestUrl: `${twilioBaseUrl}/api/twilio/voice/${voiceAgentResponse.json.id}/outbound/${launchResponse.json.id}/twiml`,
    params: twimlBody,
  });

  const twimlResponse = await invoke({
    handler,
    method: "POST",
    path: `/api/twilio/voice/${voiceAgentResponse.json.id}/outbound/${launchResponse.json.id}/twiml`,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twimlSignature,
    },
    body: twimlBody,
  });

  assert.equal(twimlResponse.status, 200);
  assert.ok(twimlResponse.text.includes("demo request"));

  const continueBody = {
    CallSid: "CAoutbound123",
    To: "+15557654321",
    CallStatus: "in-progress",
    SpeechResult: "Please call me back tomorrow. My number is +15557654321.",
  };
  const outboundContinueSignature = buildTwilioTestSignature({
    authToken: twilioAuthToken,
    requestUrl: `${twilioBaseUrl}/api/twilio/voice/${voiceAgentResponse.json.id}/outbound/${launchResponse.json.id}/continue`,
    params: continueBody,
  });

  const continueResponse = await invoke({
    handler,
    method: "POST",
    path: `/api/twilio/voice/${voiceAgentResponse.json.id}/outbound/${launchResponse.json.id}/continue`,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": outboundContinueSignature,
    },
    body: continueBody,
  });

  assert.equal(continueResponse.status, 200);
  assert.ok(continueResponse.text.includes("captured your details"));

  const statusBody = {
    CallSid: "CAoutbound123",
    CallStatus: "completed",
    CallDuration: "91",
    To: "+15557654321",
  };
  const statusSignature = buildTwilioTestSignature({
    authToken: twilioAuthToken,
    requestUrl: `${twilioBaseUrl}/api/twilio/voice/status?sessionId=${launchResponse.json.id}&agentId=${voiceAgentResponse.json.id}`,
    params: statusBody,
  });

  const statusResponse = await invoke({
    handler,
    method: "POST",
    path: `/api/twilio/voice/status?sessionId=${launchResponse.json.id}&agentId=${voiceAgentResponse.json.id}`,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": statusSignature,
    },
    body: statusBody,
  });

  assert.equal(statusResponse.status, 200);
  assert.equal(statusResponse.json.finalized, true);
  assert.equal(statusResponse.json.call.outcome, "Lead Captured");
  assert.ok(statusResponse.json.lead);
  assert.equal(statusResponse.json.lead.phone, "+15557654321");
});
