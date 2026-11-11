package com.skrr.platform.run;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RunEventRepository extends JpaRepository<RunEvent, Long> {

    List<RunEvent> findByRunIdAndSeqGreaterThanOrderBySeqAsc(UUID runId, long afterSeq);

    List<RunEvent> findByRunIdAndTypeAndSeqGreaterThanOrderBySeqAsc(UUID runId, String type, long afterSeq,
                                                                   Pageable pageable);

    @Query("select coalesce(max(e.seq), 0) from RunEvent e where e.runId = :runId")
    long findLastSeq(@Param("runId") UUID runId);
}
