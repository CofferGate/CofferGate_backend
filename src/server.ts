import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createRepositories } from "./repositories/create-repositories.js";

const config = loadConfig();
const repositories = createRepositories(config);
const app = createApp({ config, ...repositories });

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
