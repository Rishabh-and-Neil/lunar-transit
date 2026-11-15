// Entry point. Auto-starts only when run directly (node dist/index.js / tsx src/index.ts).
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startServer } from "./app";

export { startServer } from "./app";
export type { RunningServer, StartOptions } from "./app";

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const port = Number(process.env.PORT) || 3001;
  startServer(port)
    .then((srv) => {
      console.log(`[server] listening on :${srv.port} (CLIENT_ORIGIN=${process.env.CLIENT_ORIGIN ?? "localhost (dev default)"})`);
      const shutdown = (): void => {
        void srv.close().then(() => process.exit(0));
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((err: unknown) => {
      console.error("[server] failed to start", err);
      process.exit(1);
    });
}
