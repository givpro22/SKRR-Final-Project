package com.skrr.platform.scenario;

/** enum:GuardFailureKind. CATALOG_GAP 은 재생성으로 해결되지 않아 카탈로그 수정이 필요하다는 뜻이다. */
public enum GuardFailureKind {
    SCHEMA_INVALID, UNKNOWN_REQUIREMENT, UNKNOWN_API, UNKNOWN_TEST_ID, UNKNOWN_VARIABLE, NO_ASSERTION,
    MISSING_EXPECTED, EXPECTED_NOT_APPROVED, CATALOG_GAP
}
