import { createApp } from "../../src/server.js";
import { PORT } from "../../src/paths.js";
import * as sessionStore from "../../src/session-store.js";

const app = createApp();
const server = app.listen(PORT, "127.0.0.1", () => {
  sessionStore.writeServerLock({ pid: process.pid, port: PORT });
  console.log(JSON.stringify({ port: PORT }));
});
server.on("error", (err) => {
  console.error(String(err));
  process.exit(1);
});
