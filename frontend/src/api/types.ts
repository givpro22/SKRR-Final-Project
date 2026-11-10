// 생성된 schema.d.ts에서 화면이 쓰는 타입에 이름만 붙인다. 필드를 새로 정의하지 않는다.
import type { components } from "./schema";

type Schemas = components["schemas"];

export type User = Schemas["User"];
export type Project = Schemas["Project"];
export type ProjectCreate = Schemas["ProjectCreate"];
export type ProjectUpdate = Schemas["ProjectUpdate"];
export type TargetUrlStatus = Schemas["TargetUrlStatus"];
export type TargetVerification = Schemas["TargetVerification"];
export type Document = Schemas["Document"];
export type DocumentType = Schemas["DocumentType"];
export type DocumentStatus = Schemas["DocumentStatus"];
export type DownloadLink = Schemas["DownloadLink"];
export type KnowledgeBase = Schemas["KnowledgeBase"];
export type KnowledgeBaseStatus = Schemas["KnowledgeBaseStatus"];
export type ReadinessItem = Schemas["ReadinessItem"];
export type Activity = Schemas["Activity"];
export type Problem = Schemas["Problem"];
export type ErrorCode = Schemas["ErrorCode"];
