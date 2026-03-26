import { createHmac, timingSafeEqual } from "node:crypto";

const encodeBasicAuth = (username, password) => Buffer.from(`${username}:${password}`, "utf8").toString("base64");

const normalizeBaseUrl = (value) => String(value || "").replace(/\/$/, "");

const normalizeTwilioParamValue = (value) => {
  if (Array.isArray(value)) {
    return value.join("");
  }

  return value == null ? "" : String(value);
};

const parseTwilioJson = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return text ? { raw: text } : {};
};

export const resolveTwilioConfig = (overrides = {}) => ({
  accountSid: overrides.accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? "",
  authToken: overrides.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? "",
  webhookBaseUrl: normalizeBaseUrl(overrides.webhookBaseUrl ?? process.env.TWILIO_WEBHOOK_BASE_URL ?? ""),
  validateRequests: overrides.validateRequests ?? process.env.TWILIO_VALIDATE_REQUESTS !== "false",
  fetchImpl: overrides.fetchImpl ?? globalThis.fetch?.bind(globalThis),
});

export const buildTwilioSignature = ({ authToken, requestUrl, params = {} }) => {
  const payload = Object.keys(params)
    .sort()
    .reduce((result, key) => result + key + normalizeTwilioParamValue(params[key]), requestUrl);

  return createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
};

export const validateTwilioSignature = ({ authToken, signature, requestUrl, params = {} }) => {
  if (!authToken || !signature) {
    return false;
  }

  const expectedSignature = buildTwilioSignature({ authToken, requestUrl, params });
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const actualBuffer = Buffer.from(String(signature), "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
};

export const escapeXml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

export const twimlSay = (text) => `<Say>${escapeXml(text)}</Say>`;

export const twimlPause = (length = 1) => `<Pause length="${Number(length) || 1}"/>`;

export const twimlHangup = () => "<Hangup/>";

export const twimlDial = (phoneNumber) => `<Dial>${escapeXml(phoneNumber)}</Dial>`;

export const twimlGather = (attributes = {}, content = "") => {
  const attributeString = Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join("");

  return `<Gather${attributeString}>${content}</Gather>`;
};

export const buildTwimlResponse = (...verbs) => `<?xml version="1.0" encoding="UTF-8"?><Response>${verbs.join("")}</Response>`;

export const createTwilioCall = async ({
  config,
  to,
  from,
  instructionsUrl,
  statusCallbackUrl,
  machineDetection,
}) => {
  if (!config.accountSid || !config.authToken) {
    throw new Error("Twilio outbound calling requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.");
  }

  if (typeof config.fetchImpl !== "function") {
    throw new Error("Twilio outbound calling requires a fetch implementation.");
  }

  const payload = new URLSearchParams();
  payload.set("To", to);
  payload.set("From", from);
  payload.set("Url", instructionsUrl);
  payload.set("Method", "POST");
  payload.set("StatusCallback", statusCallbackUrl);
  payload.set("StatusCallbackMethod", "POST");
  payload.append("StatusCallbackEvent", "initiated");
  payload.append("StatusCallbackEvent", "ringing");
  payload.append("StatusCallbackEvent", "answered");
  payload.append("StatusCallbackEvent", "completed");

  if (machineDetection) {
    payload.set("MachineDetection", machineDetection);
  }

  const response = await config.fetchImpl(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${encodeBasicAuth(config.accountSid, config.authToken)}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "application/json",
      },
      body: payload.toString(),
    }
  );

  const payloadBody = await parseTwilioJson(response);
  if (!response.ok) {
    const detail = typeof payloadBody === "object" ? JSON.stringify(payloadBody) : String(payloadBody || response.statusText);
    throw new Error(`Twilio call creation failed (${response.status}): ${detail}`);
  }

  return payloadBody;
};
