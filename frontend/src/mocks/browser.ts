import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";
import { runHandlers } from "./runHandlers";
import { runSseHandlers } from "./runSseHandler";
import { scenarioHandlers } from "./scenarioHandlers";

export const worker = setupWorker(...handlers, ...scenarioHandlers, ...runHandlers, ...runSseHandlers);
