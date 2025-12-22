import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities/index.js";

async function run() {
  const connection = await NativeConnection.connect({
    address: "temporal:7233",
  });

  const worker = await Worker.create({
    connection,
    workflowsPath: new URL("./workflows/index.ts", import.meta.url).pathname,
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
