import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities/index.js";

async function run() {
  const connection = await NativeConnection.connect({
    address: "temporal:7233",
  });

  // workflowsPath needs to point to source .ts files for Temporal to bundle
  // When running from dist/, we need to go up to find src/
  const worker = await Worker.create({
    connection,
    workflowsPath: new URL("../src/workflows/index.ts", import.meta.url).pathname,
    activities,
    taskQueue: "furnel-queue",
  });

  console.log("Furnel worker started");
  console.log("Task queue: furnel-queue");

  await worker.run();
}

run().catch((err) => {
  console.error("Worker failed:", err);
  process.exit(1);
});
