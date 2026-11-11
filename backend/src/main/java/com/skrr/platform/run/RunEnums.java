package com.skrr.platform.run;

/** 실행 결과에 쓰는 계약 enum 모음 (platform-api, schema.sql). */
public final class RunEnums {

    private RunEnums() {
    }

    /** enum:StepKind */
    public enum StepKind { SETUP, UI, API, DB, ASSERT, TEARDOWN }

    /** enum:StepStatus */
    public enum StepStatus { PENDING, RUNNING, PASSED, FAILED, SKIPPED }

    /** enum:Verdict */
    public enum Verdict { MATCH, MISMATCH, NOT_APPLICABLE }

    /** enum:SchemaCheckStatus */
    public enum SchemaCheckStatus { PASSED, FAILED, NOT_CHECKED }

    /** enum:FailureType */
    public enum FailureType {
        DATA_MISMATCH, ASSERTION_FAILED, ELEMENT_NOT_FOUND, API_ERROR, API_SCHEMA_MISMATCH, TIMEOUT,
        ENVIRONMENT_ERROR, TEST_CODE_ERROR
    }

    /** enum:ArtifactType */
    public enum ArtifactType { SCREENSHOT, TRACE, HAR, SPEC }

    /** enum:CompileStatus */
    public enum CompileStatus { PASSED, FAILED }

    /** enum:RunEventType. 계약 이름(run.status)과 enum 이름을 함께 둔다. */
    public enum RunEventType {
        RUN_STATUS("run.status"), SCENARIO_STATUS("scenario.status"), CASE_STATUS("case.status"),
        STEP_STATUS("step.status"), LOG("log"), API_CALL("api.call"), SCREENSHOT("screenshot"),
        VERIFICATION("verification"), HEARTBEAT("heartbeat");

        private final String wireName;

        RunEventType(String wireName) {
            this.wireName = wireName;
        }

        public String wireName() {
            return wireName;
        }
    }

    /** enum:AnalysisStatus (M4에서 사용) */
    public enum AnalysisStatus { NOT_REQUIRED, PENDING, RUNNING, COMPLETED, FAILED }
}
