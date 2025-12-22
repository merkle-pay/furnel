import { Worker } from "@temporalio/worker";
import * as activities from "./activities/index.js";

async function run() {
  const worker = await Worker.create({
    workflowsPath: new URL("./workflows/index.js", import.meta.url).pathname,
    activities,
    taskQueue: "furnel-queue",
    connection: {
      address: process.env.TEMPORAL_ADDRESS || "temporal:7233",
    },
  });

  console.log("Furnel worker started");
  console.log("Task queue: furnel-queue");
  console.log(`Temporal address: ${process.env.TEMPORAL_ADDRESS || "temporal:7233"}`);

  await worker.run();
}

run().catch((err) => {
  console.error("Worker failed:", err);
  process.exit(1);
});
