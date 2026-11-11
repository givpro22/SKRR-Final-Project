package com.skrr.platform.run;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ApiCallRepository extends JpaRepository<ApiCallEntry, Long> {

    List<ApiCallEntry> findByRunIdAndIdGreaterThanOrderByIdAsc(UUID runId, long afterId, Pageable pageable);

    long countByRunId(UUID runId);

    List<ApiCallEntry> findByCaseResultIdOrderByIdAsc(UUID caseResultId);

    @Query("select avg(a.durationMs) from ApiCallEntry a where a.runId = :runId and a.durationMs is not null")
    Double averageDuration(@Param("runId") UUID runId);
}
