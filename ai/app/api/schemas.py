"""계약(docs/contracts/ai-api.openapi.yaml)의 요청 모델. 응답은 Job.to_contract()로 만든다."""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator

from app.knowledge.models import DocumentType
from app.pipeline.scenario import PreviousScenario


class KnowledgeBaseDocument(BaseModel):
    model_config = ConfigDict(extra="ignore")

    documentId: UUID
    type: DocumentType
    version: int
    s3Key: Annotated[str, Field(min_length=1)]
    contentType: str
    checksumSha256: Annotated[str, Field(min_length=1)]


class KnowledgeBaseBuildRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    documents: Annotated[list[KnowledgeBaseDocument], Field(min_length=3)]


class RefinementRequest(BaseModel):
    """startRequestRefinement"""

    model_config = ConfigDict(extra="ignore")

    projectId: UUID
    text: Annotated[str, Field(min_length=1, max_length=500)]
    candidateCount: Annotated[int, Field(ge=1, le=6)] = 4
    topK: Annotated[int, Field(ge=1, le=10)] = 3


class RegenerateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    scenarioCode: Annotated[str, Field(min_length=1)]
    previous: PreviousScenario | None = None
    feedback: str | None = None


class ScenarioGenerationRequest(BaseModel):
    """startScenarioGeneration"""

    model_config = ConfigDict(extra="ignore")

    projectId: UUID
    testRequestCode: Annotated[str, Field(min_length=1)]
    requestText: Annotated[str, Field(min_length=1)]
    firstScenarioNumber: Annotated[int, Field(ge=1)] = 1
    firstCaseNumber: Annotated[int, Field(ge=1)] = 1
    regenerate: RegenerateRequest | None = None


class ScenarioRef(BaseModel):
    model_config = ConfigDict(extra="ignore")

    code: Annotated[str, Field(min_length=1)]
    title: str
    requirementRef: str | None = None


class ExpectedValueIn(BaseModel):
    """승인된 기대값. expected와 consistencyOnly(true) 중 하나만, consistencyOnly면 reason 필수 (ADR-017)."""

    model_config = ConfigDict(extra="ignore")

    label: Annotated[str, Field(min_length=1)]
    expected: str | None = None
    consistencyOnly: bool | None = None
    reason: str | None = None

    @model_validator(mode="after")
    def _exclusive(self) -> ExpectedValueIn:
        only = self.consistencyOnly is True
        if (self.expected is not None) == only:
            raise ValueError("expected와 consistencyOnly(true) 중 하나만 써야 해요")
        if only and not (self.reason and self.reason.strip()):
            raise ValueError("consistencyOnly면 reason이 필요해요")
        return self


class GeneratedCaseIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # TestQuery testCaseCode 형식과 같다
    code: Annotated[str, Field(pattern=r"^TC-[0-9]{2,4}$")]
    title: Annotated[str, Field(min_length=1)]
    type: Literal["NORMAL", "EXCEPTION", "BOUNDARY"]
    scopes: list[Literal["UI", "API", "DB"]]
    preconditions: list[str] = []
    steps: list[str]
    expectedResult: str
    expectedValues: Annotated[list[ExpectedValueIn], Field(min_length=1)]


class TestQueryGenerationRequest(BaseModel):
    """startTestQueryGeneration"""

    model_config = ConfigDict(extra="ignore")

    projectId: UUID
    scenario: ScenarioRef
    testCase: GeneratedCaseIn
    availableVariables: list[str] = []
    # 선택: 프로젝트의 읽기 전용 조회 API 주소. 있으면 가드가 dbChecks 경로 접두를 검사한다
    queryApiBaseUrl: AnyHttpUrl | None = None
    previousError: str | None = None


FailureTypeIn = Literal[
    "DATA_MISMATCH",
    "ASSERTION_FAILED",
    "ELEMENT_NOT_FOUND",
    "API_ERROR",
    "API_SCHEMA_MISMATCH",
    "TIMEOUT",
    "ENVIRONMENT_ERROR",
    "TEST_CODE_ERROR",
]


class AnalysisStepIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    order: int
    kind: str
    title: str
    status: str
    detail: str | None = None
    expectedValue: str | None = None
    actualValue: str | None = None
    schemaCheck: Literal["PASSED", "FAILED", "NOT_CHECKED"] | None = None


class AnalysisApiCallIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    method: str
    path: str
    statusCode: int | None = None
    durationMs: int | None = None


class AnalysisVerificationIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    itemLabel: str
    uiValue: str | None = None
    apiValue: str | None = None
    dbValue: str | None = None
    expectedValue: str | None = None
    verdict: Literal["MATCH", "MISMATCH", "NOT_APPLICABLE"]


class FailureAnalysisRequest(BaseModel):
    """startFailureAnalysis. consoleErrors는 MVP에서 오지 않으며 와도 쓰지 않는다 (ai-api)."""

    model_config = ConfigDict(extra="ignore")

    projectId: UUID
    caseCode: Annotated[str, Field(min_length=1)]
    caseTitle: str
    requirementRef: str | None = None
    expectedResult: str
    failureType: FailureTypeIn
    failureMessage: str
    attempts: int | None = None
    failedAttempts: int | None = None
    steps: list[AnalysisStepIn]
    apiCalls: list[AnalysisApiCallIn]
    verifications: list[AnalysisVerificationIn]
    specSource: str | None = None
