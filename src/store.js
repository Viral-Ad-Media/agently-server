import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const clone = (value) => structuredClone(value);

const isPlainObject = (value) => (
  value != null
  && typeof value === "object"
  && !Array.isArray(value)
);

const mergeWithDefaults = (defaults, value) => {
  if (Array.isArray(defaults)) {
    return Array.isArray(value) ? clone(value) : clone(defaults);
  }

  if (isPlainObject(defaults)) {
    const next = {};
    const source = isPlainObject(value) ? value : {};

    for (const key of Object.keys(defaults)) {
      next[key] = mergeWithDefaults(defaults[key], source[key]);
    }

    for (const key of Object.keys(source)) {
      if (!(key in next)) {
        next[key] = clone(source[key]);
      }
    }

    return next;
  }

  return value === undefined ? defaults : clone(value);
};

const hydrateState = (createDefaultState, value) => mergeWithDefaults(createDefaultState(), value);

const parseJsonResponse = async (response, context) => {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase ${context} failed (${response.status}): ${body || response.statusText}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

export class JsonStore {
  constructor(filePath, createDefaultState, normalizeState = (value) => value) {
    this.mode = "json";
    this.filePath = filePath;
    this.createDefaultState = createDefaultState;
    this.normalizeState = normalizeState;
    this.state = null;
  }

  async init() {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf8");
      this.state = this.normalizeState(hydrateState(this.createDefaultState, JSON.parse(raw)));
      await this.persist();
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      this.state = this.normalizeState(this.createDefaultState());
      await this.persist();
    }
  }

  read() {
    return clone(this.state);
  }

  async update(mutator) {
    const draft = clone(this.state);
    const result = await mutator(draft);
    this.state = this.normalizeState(draft);
    await this.persist();
    return result;
  }

  async replace(nextState) {
    this.state = this.normalizeState(clone(nextState));
    await this.persist();
  }

  async persist() {
    await writeFile(this.filePath, JSON.stringify(this.state, null, 2) + "\n", "utf8");
  }
}

export class SupabaseStateStore {
  constructor({ url, serviceRoleKey, schema = "public", table = "agently_state", rowId = "primary", createDefaultState, normalizeState = (value) => value }) {
    this.mode = "supabase";
    this.url = url.replace(/\/$/, "");
    this.serviceRoleKey = serviceRoleKey;
    this.schema = schema;
    this.table = table;
    this.rowId = rowId;
    this.createDefaultState = createDefaultState;
    this.normalizeState = normalizeState;
  }

  buildHeaders(extra = {}) {
    return {
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Accept-Profile": this.schema,
      "Content-Profile": this.schema,
      ...extra,
    };
  }

  buildTableUrl(searchParams = new URLSearchParams()) {
    const url = new URL(`${this.url}/rest/v1/${encodeURIComponent(this.table)}`);
    url.search = searchParams.toString();
    return url.toString();
  }

  async fetchRow() {
    const searchParams = new URLSearchParams({
      select: "payload",
      id: `eq.${this.rowId}`,
    });

    const response = await fetch(this.buildTableUrl(searchParams), {
      method: "GET",
      headers: this.buildHeaders(),
    });

    const payload = await parseJsonResponse(response, "select");
    return Array.isArray(payload) && payload.length > 0 ? payload[0] : null;
  }

  async upsertState(state) {
    const response = await fetch(this.buildTableUrl(new URLSearchParams({ on_conflict: "id" })), {
      method: "POST",
      headers: this.buildHeaders({
        Prefer: "resolution=merge-duplicates,return=representation",
      }),
      body: JSON.stringify([
        {
          id: this.rowId,
          payload: state,
          updated_at: new Date().toISOString(),
        },
      ]),
    });

    await parseJsonResponse(response, "upsert");
  }

  async init() {
    if (!this.url || !this.serviceRoleKey) {
      throw new Error("Supabase store requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    }

    const existingRow = await this.fetchRow();
    if (!existingRow) {
      await this.upsertState(this.normalizeState(this.createDefaultState()));
    }
  }

  async read() {
    const row = await this.fetchRow();
    if (!row) {
      const nextState = this.normalizeState(this.createDefaultState());
      await this.upsertState(nextState);
      return clone(nextState);
    }

    const hydratedState = this.normalizeState(hydrateState(this.createDefaultState, row.payload));
    if (JSON.stringify(hydratedState) !== JSON.stringify(row.payload)) {
      await this.upsertState(hydratedState);
    }

    return clone(hydratedState);
  }

  async update(mutator) {
    const currentState = await this.read();
    const draft = clone(currentState);
    const result = await mutator(draft);
    await this.upsertState(this.normalizeState(draft));
    return result;
  }

  async replace(nextState) {
    await this.upsertState(this.normalizeState(clone(nextState)));
  }
}

export const createStore = ({
  provider = process.env.AGENTLY_STORE_PROVIDER,
  dataFile,
  createDefaultState,
  normalizeState,
} = {}) => {
  const resolvedProvider = provider || (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "json");

  if (resolvedProvider === "supabase") {
    return new SupabaseStateStore({
      url: process.env.SUPABASE_URL || "",
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
      schema: process.env.SUPABASE_SCHEMA || "public",
      table: process.env.SUPABASE_STATE_TABLE || "agently_state",
      rowId: process.env.SUPABASE_STATE_ROW_ID || "primary",
      createDefaultState,
      normalizeState,
    });
  }

  if (resolvedProvider === "json") {
    return new JsonStore(dataFile, createDefaultState, normalizeState);
  }

  throw new Error(`Unsupported store provider: ${resolvedProvider}`);
};
