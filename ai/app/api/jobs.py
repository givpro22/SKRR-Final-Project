"""작업 저장소. 프로세스 메모리에 두며 재시작하면 사라진다 (ADR-007, 백엔드가 재요청).

모든 생성 API는 202와 Job을 돌려주고, 실제 작업은 asyncio 태스크로 돈다.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from app.core.codes import AiErrorCode
from app.core.errors import JobFailure
from app.llm.client import LLMError

logger = logging.getLogger(__name__)


class JobType(StrEnum):
    KB_BUILD = "KB_BUILD"
    REQUEST_REFINE = "REQUEST_REFINE"
    SCENARIO_GENERATE = "SCENARIO_GENERATE"
    TEST_QUERY_GENERATE = "TEST_QUERY_GENERATE"
    FAILURE_ANALYZE = "FAILURE_ANALYZE"


class JobStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


FINISHED = {JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED}


@dataclass
class JobProgress:
    phase: str | None = None
    percent: int = 0
    message: str | None = None
    attempt: int | None = None
    max_attempts: int | None = None
    # SCENARIO_GENERATE에서 지금 처리 중인 시나리오 코드 (예 SC-06)
    scenario_code: str | None = None

    def to_contract(self) -> dict[str, Any]:
        out: dict[str, Any] = {"percent": self.percent}
        if self.scenario_code is not None:
            out["scenarioCode"] = self.scenario_code
        if self.phase is not None:
            out["phase"] = self.phase
        if self.message is not None:
            out["message"] = self.message
        if self.attempt is not None:
            out["attempt"] = self.attempt
        if self.max_attempts is not None:
            out["maxAttempts"] = self.max_attempts
        return out


@dataclass
class Job:
    job_id: str
    type: JobType
    status: JobStatus = JobStatus.QUEUED
    progress: JobProgress = field(default_factory=JobProgress)
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    task: asyncio.Task[None] | None = field(default=None, repr=False)

    def set_progress(self, phase: str, percent: int, message: str, **extra: int | None) -> None:
        # 진행률은 뒤로 가지 않는다 (화면 표시가 흔들리지 않게).
        self.progress.phase = phase
        self.progress.percent = max(self.progress.percent, min(100, max(0, percent)))
        self.progress.message = message
        if "attempt" in extra:
            self.progress.attempt = extra["attempt"]
        if "max_attempts" in extra:
            self.progress.max_attempts = extra["max_attempts"]

    def to_contract(self) -> dict[str, Any]:
        return {
            "jobId": self.job_id,
            "type": self.type.value,
            "status": self.status.value,
            "progress": self.progress.to_contract(),
            "result": self.result,
            "error": self.error,
        }


JobWork = Callable[[Job], Awaitable[dict[str, Any]]]


class JobStore:
    def __init__(self, max_retained: int = 500) -> None:
        self._jobs: OrderedDict[str, Job] = OrderedDict()
        self._max_retained = max_retained

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def submit(self, job_type: JobType, work: JobWork) -> Job:
        job = Job(job_id=str(uuid.uuid4()), type=job_type)
        self._jobs[job.job_id] = job
        self._evict()
        job.task = asyncio.create_task(self._run(job, work), name=f"job-{job.job_id}")
        return job

    def cancel(self, job_id: str) -> Job | None:
        job = self._jobs.get(job_id)
        if job is None:
            return None
        if job.status not in FINISHED and job.task is not None:
            job.task.cancel()
        return job

    async def _run(self, job: Job, work: JobWork) -> None:
        job.status = JobStatus.RUNNING
        try:
            job.result = await work(job)
            job.status = JobStatus.SUCCEEDED
            job.progress.percent = 100
        except asyncio.CancelledError:
            job.status = JobStatus.CANCELLED
            job.progress.message = "작업을 취소했어요"
        except JobFailure as exc:
            job.status = JobStatus.FAILED
            job.result = exc.result
            job.error = {"code": exc.code, "message": exc.message, "retryable": exc.retryable}
        except LLMError as exc:
            job.status = JobStatus.FAILED
            job.error = {"code": exc.code, "message": exc.message, "retryable": exc.retryable}
        except Exception:
            logger.exception("작업 %s(%s) 처리 중 예상하지 못한 오류", job.job_id, job.type)
            job.status = JobStatus.FAILED
            job.error = {
                "code": AiErrorCode.INTERNAL_ERROR,
                "message": "AI 서버 내부 오류로 작업을 끝내지 못했어요",
                "retryable": True,
            }
        finally:
            job.task = None

    def _evict(self) -> None:
        # 끝난 작업부터 오래된 순서로 지운다. 진행 중인 작업은 지우지 않는다.
        if len(self._jobs) <= self._max_retained:
            return
        for job_id in list(self._jobs):
            if len(self._jobs) <= self._max_retained:
                break
            if self._jobs[job_id].status in FINISHED:
                del self._jobs[job_id]

    async def shutdown(self) -> None:
        tasks = [j.task for j in self._jobs.values() if j.task is not None]
        for t in tasks:
            t.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
