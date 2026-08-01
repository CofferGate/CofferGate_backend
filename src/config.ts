import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  ENVIRONMENT: z.enum(["mock", "devnet", "mainnet-beta"]).default("devnet"),
  DATA_MODE: z.enum(["mock", "live"]).default("live"),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  return configSchema.parse(environment);
}
