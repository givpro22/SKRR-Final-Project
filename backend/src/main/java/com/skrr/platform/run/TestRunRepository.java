package com.skrr.platform.run;

import jakarta.persistence.LockModeType;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TestRunRepository extends JpaRepository<TestRun, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from TestRun r where r.id = :id")
    Optional<TestRun> findByIdForUpdate(@Param("id") UUID id);

    @Query("select coalesce(max(r.seq), 0) from TestRun r where r.projectId = :projectId")
    int findMaxSeq(@Param("projectId") UUID projectId);

    boolean existsByStatusIn(Collection<RunStatus> statuses);

    List<TestRun> findByStatusIn(Collection<RunStatus> statuses);

    List<TestRun> findByTestRequestIdAndStatusInAndCreatedAtBeforeOrderByCreatedAtDesc(UUID testRequestId,
            Collection<RunStatus> statuses, java.time.Instant before, Pageable pageable);

    List<TestRun> findByProjectIdOrderBySeqDesc(UUID projectId, Pageable pageable);

    List<TestRun> findByProjectIdAndSeqLessThanOrderBySeqDesc(UUID projectId, int seq, Pageable pageable);
}
