import "@testing-library/jest-dom/vitest";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// MSW 없이 실제 백엔드를 부른다. jsdom의 File·FormData 대신 Node 구현을 쓴다 (setup.ts와 같은 이유).
const NodeFormData = (await new Response(new URLSearchParams()).formData()).constructor;
Object.assign(globalThis, { File: NodeFile, Blob: NodeBlob, FormData: NodeFormData });

afterEach(() => cleanup());
