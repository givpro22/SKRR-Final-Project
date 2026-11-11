"""시나리오 가드. 판정은 LLM이 아니라 코드로 한다 (판정 자체가 환각하면 안 되므로).

| 검사 | 실패 종류 |
|---|---|
| 출력이 스키마와 맞음, 케이스가 1개 이상 | SCHEMA_INVALID |
| requirementRef가 지식 베이스에 있음 | UNKNOWN_REQUIREMENT |
| 참조 API가 명세에 있음 | UNKNOWN_API |
| testId가 카탈로그에 있음 | UNKNOWN_TEST_ID |
| 케이스에 기대 결과 문장이 있음 | NO_ASSERTION |
| 케이스마다 expectedValues가 있고, 각 값이 expected 또는 consistencyOnly+reason 중 하나 | MISSING_EXPECTED |
| LLM이 카탈로그에 없는 필수 요소를 알림, 또는 같은 testId가 2회 연속 없음 | CATALOG_GAP |

UNKNOWN_VARIABLE, EXPECTED_NOT_APPROVED는 TestQuery 단계(FR-04) 검사다.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass

from app.core.codes import GuardFailureKind
from app.pipeline.context import Catalog
from app.pipeline.models import CaseOut, ScenarioDraftOut

_BACKTICK = re.compile(r"`([^`\n]{1,200})`")
_API_REF = re.compile(r"^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(/\S*)$", re.I)


@dataclass(frozen=True)
class GuardFailure:
    kind: GuardFailureKind
    message: str  # 화면에 보여 줄 문장
    subject: str | None = None
    # 진행 문구 "{cause} 재생성 중"에 쓰는 구절 (화면이 "가드 실패: "와 (N/3회)를 붙인다)
    cause: str = ""

    def to_contract(self) -> dict[str, str]:
        out = {"kind": self.kind.value, "message": self.message}
        if self.subject:
            out["subject"] = self.subject
        return out


def schema_invalid(detail: str) -> GuardFailure:
    return GuardFailure(
        GuardFailureKind.SCHEMA_INVALID,
        f"생성 결과가 형식과 맞지 않아요: {detail[:200]}",
        cause="생성 결과의 형식이 맞지 않아",
    )


def _refs_in_text(texts: Iterable[str]) -> tuple[set[str], set[str]]:
    """단계 문장의 백틱 표기에서 testId와 API 작업을 뽑는다. `/cart`처럼 /로 시작하면 화면 경로라 건너뛴다."""
    test_ids: set[str] = set()
    apis: set[str] = set()
    for text in texts:
        for token in _BACKTICK.findall(text):
            token = token.strip()
            if _API_REF.match(token):
                apis.add(token)
            elif token and not token.startswith("/") and " " not in token:
                test_ids.add(token)
    return test_ids, apis


def case_references(case: CaseOut) -> tuple[list[str], list[str]]:
    """케이스가 쓰는 testId와 API 작업(선언 + 단계 문장의 백틱). 순서를 지켜 중복 없이."""
    text_ids, text_apis = _refs_in_text([*case.steps, *case.preconditions])
    test_ids = list(dict.fromkeys([*case.uiElements, *sorted(text_ids)]))
    apis = list(dict.fromkeys([*(a.strip() for a in case.apiOperations), *sorted(text_apis)]))
    return test_ids, apis


def check_scenario(draft: ScenarioDraftOut, catalog: Catalog) -> list[GuardFailure]:
    failures: list[GuardFailure] = []

    for missing in draft.missingElements:
        missing = missing.strip()
        if missing:
            failures.append(
                GuardFailure(
                    GuardFailureKind.CATALOG_GAP,
                    f"카탈로그에 '{missing}' 요소가 없어 시나리오를 만들 수 없어요. 카탈로그를 고쳐 주세요",
                    subject=missing,
                    cause=f"카탈로그에 '{missing}' 요소가 없어",
                )
            )

    ref = draft.requirementRef
    if ref is not None and ref not in catalog.requirements:
        failures.append(
            GuardFailure(
                GuardFailureKind.UNKNOWN_REQUIREMENT,
                f"요구사항 명세서에 '{ref}' 요구사항이 없어요",
                subject=ref,
                cause=f"요구사항 명세서에 '{ref}'가 없어",
            )
        )

    if not draft.cases:
        failures.append(schema_invalid("테스트 케이스가 없어요"))

    known_ids = catalog.test_ids
    seen_ids: set[str] = set()
    seen_apis: set[str] = set()
    for i, case in enumerate(draft.cases, start=1):
        label = f"{i}번째 케이스"
        test_ids, apis = case_references(case)
        for test_id in test_ids:
            if test_id not in known_ids and test_id not in seen_ids:
                seen_ids.add(test_id)
                failures.append(
                    GuardFailure(
                        GuardFailureKind.UNKNOWN_TEST_ID,
                        f"카탈로그에 '{test_id}' 요소가 없어요",
                        subject=test_id,
                        cause=f"카탈로그에 '{test_id}' 요소가 없어",
                    )
                )
        for api in apis:
            match = _API_REF.match(api)
            known = match is not None and catalog.find_operation(match.group(1), match.group(2)) is not None
            if not known and api not in seen_apis:
                seen_apis.add(api)
                failures.append(
                    GuardFailure(
                        GuardFailureKind.UNKNOWN_API,
                        f"API 명세에 '{api}' 작업이 없어요",
                        subject=api,
                        cause=f"API 명세에 '{api}'가 없어",
                    )
                )
        if not case.expectedResult.strip():
            failures.append(
                GuardFailure(
                    GuardFailureKind.NO_ASSERTION,
                    f"{label}({case.title})에 기대 결과가 없어요",
                    subject=case.title,
                    cause=f"{label}에 기대 결과가 없어",
                )
            )
        failures.extend(_expected_value_failures(case, label))
    return failures


def _expected_value_failures(case: CaseOut, label: str) -> list[GuardFailure]:
    if not case.expectedValues:
        return [
            GuardFailure(
                GuardFailureKind.MISSING_EXPECTED,
                f"{label}({case.title})에 기대값이 없어요",
                subject=case.title,
                cause=f"{label}에 기대값이 없어",
            )
        ]
    failures = []
    for ev in case.expectedValues:
        has_expected = bool(ev.expected and ev.expected.strip())
        if not ev.label.strip():
            problem = "검증 항목 이름이 비어 있어요"
        elif has_expected and ev.consistencyOnly:
            problem = f"'{ev.label}'에 기대값과 일관성 확인을 함께 썼어요"
        elif not has_expected and not ev.consistencyOnly:
            problem = f"'{ev.label}'에 기대값이 없어요"
        elif ev.consistencyOnly and not (ev.reason and ev.reason.strip()):
            problem = f"'{ev.label}'은 일관성만 확인하는 이유가 없어요"
        else:
            continue
        failures.append(
            GuardFailure(
                GuardFailureKind.MISSING_EXPECTED,
                f"{label}({case.title}): {problem}",
                subject=ev.label or case.title,
                cause=f"{label}의 기대값이 올바르지 않아",
            )
        )
    return failures


def escalate_catalog_gap(current: list[GuardFailure], previous: list[GuardFailure]) -> list[GuardFailure]:
    """같은 testId가 재생성 뒤에도 없으면 환각이 아니라 카탈로그 공백으로 본다 (재생성으로 해결되지 않음)."""
    prev_ids = {f.subject for f in previous if f.kind is GuardFailureKind.UNKNOWN_TEST_ID}
    out: list[GuardFailure] = []
    for f in current:
        if f.kind is GuardFailureKind.UNKNOWN_TEST_ID and f.subject in prev_ids:
            out.append(
                GuardFailure(
                    GuardFailureKind.CATALOG_GAP,
                    f"다시 만들어도 카탈로그에 없는 '{f.subject}' 요소가 필요해요. 카탈로그를 고쳐 주세요",
                    subject=f.subject,
                    cause=f"카탈로그에 '{f.subject}' 요소가 없어",
                )
            )
        else:
            out.append(f)
    return out


def progress_message(failures: list[GuardFailure]) -> str:
    """진행 문구. 계약(platform-api GuardState.message) 예: "카탈로그에 'x' 요소가 없어 재생성 중".

    화면이 "가드 실패: {사유} (N/3회)"로 감싸므로 접두어와 회차는 넣지 않는다 (Q-M2-1).
    """
    first = failures[0]
    return f"{first.cause or first.message} 재생성 중"
