package com.skrr.platform.run;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface VerificationRepository extends JpaRepository<Verification, UUID> {

    List<Verification> findByCaseResultIdOrderByOrdAsc(UUID caseResultId);

    @Modifying
    @Query("delete from Verification v where v.caseResultId = :caseResultId")
    void deleteByCaseResultId(@Param("caseResultId") UUID caseResultId);
}
