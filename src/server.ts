import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp({ config });

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
