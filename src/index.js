import path from "node:path";

import { createAgentlyServer } from "./server.js";

const defaultDataFile = process.env.AGENTLY_DATA_FILE
  || (process.env.VERCEL ? path.join("/tmp", "agently-store.json") : undefined);

const { app } = await createAgentlyServer(
  defaultDataFile
    ? { dataFile: defaultDataFile }
    : {}
);

export default app;
