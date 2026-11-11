package com.skrr.platform.report;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RootCauseCandidateRepository extends JpaRepository<RootCauseCandidate, UUID> {

    List<RootCauseCandidate> findByCaseResultIdOrderByRankAsc(UUID caseResultId);

    @Modifying
    @Query("delete from RootCauseCandidate r where r.caseResultId = :caseResultId")
    void deleteByCaseResultId(@Param("caseResultId") UUID caseResultId);
}
