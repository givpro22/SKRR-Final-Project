package com.skrr.platform.common.job;

import jakarta.persistence.LockModeType;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AsyncJobRepository extends JpaRepository<AsyncJob, UUID> {

    List<AsyncJob> findByStatusInOrderByCreatedAtAsc(Collection<JobStatus> statuses);

    List<AsyncJob> findByTypeAndSubjectTypeAndSubjectIdAndStatusIn(
            JobType type, String subjectType, UUID subjectId, Collection<JobStatus> statuses);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select j from AsyncJob j where j.id = :id")
    Optional<AsyncJob> findByIdForUpdate(@Param("id") UUID id);
}
