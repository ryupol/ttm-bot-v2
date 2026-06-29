import { parentPort, workerData } from "node:worker_threads";
import type { WorkerInit } from "../ipc/types.ts";
import { createBotRuntime } from "./workflow.ts";

if (!parentPort) throw new Error("worker requires parentPort");

void createBotRuntime(workerData as WorkerInit, parentPort).start();
