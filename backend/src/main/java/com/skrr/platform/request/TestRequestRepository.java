package com.skrr.platform.request;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TestRequestRepository extends JpaRepository<TestRequest, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from TestRequest r where r.id = :id")
    Optional<TestRequest> findByIdForUpdate(@Param("id") UUID id);

    @Query("select coalesce(max(r.seq), 0) from TestRequest r where r.projectId = :projectId")
    int findMaxSeq(@Param("projectId") UUID projectId);

    List<TestRequest> findByProjectIdOrderBySeqDesc(UUID projectId, Pageable pageable);

    List<TestRequest> findByProjectIdAndSeqLessThanOrderBySeqDesc(UUID projectId, int seq, Pageable pageable);
}
