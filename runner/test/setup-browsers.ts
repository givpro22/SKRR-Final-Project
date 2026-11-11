// 로컬에서는 runner/.browsers의 Chromium을 쓴다 (이미지에서는 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright).
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const local = resolve(".browsers");
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(local)) process.env.PLAYWRIGHT_BROWSERS_PATH = local;
