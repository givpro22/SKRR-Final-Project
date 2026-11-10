/**
 * 실행기는 한 번에 한 건만 실행한다 (ADR-005, startExecution 409 RUNNER_BUSY).
 * 이번 범위에서는 readiness 판단에만 쓰고, 실행 API가 생기면 acquire/release를 호출한다.
 */
export class ExecutionSlot {
  private current: string | null = null;

  get busy(): boolean {
    return this.current !== null;
  }

  get executionId(): string | null {
    return this.current;
  }

  tryAcquire(executionId: string): boolean {
    if (this.current !== null) return false;
    this.current = executionId;
    return true;
  }

  release(executionId: string): void {
    if (this.current === executionId) this.current = null;
  }
}
