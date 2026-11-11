import { setupServer } from "msw/node";
import { handlers } from "./handlers";
import { runHandlers } from "./runHandlers";
import { scenarioHandlers } from "./scenarioHandlers";

export const server = setupServer(...handlers, ...scenarioHandlers, ...runHandlers);
