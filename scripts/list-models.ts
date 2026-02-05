/**
 * List available models
 * Run with: npx tsx scripts/list-models.ts
 */

import { CodexAppServer } from "../src/infrastructure/codex";

async function main() {
  const codex = CodexAppServer.getInstance();

  await codex.initialize(
    {
      name: "model-list-test",
      version: "0.1.0",
      title: "Model List Test",
    },
    { experimentalApi: true },
  );

  console.log("Fetching models...\n");
  const response = await codex.listModels({});

  console.log("Available models:");
  for (const model of response.data) {
    console.log(`- ${model.id}`);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
