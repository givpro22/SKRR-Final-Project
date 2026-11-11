package com.skrr.platform.run;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RunStepRepository extends JpaRepository<RunStep, UUID> {

    List<RunStep> findByCaseResultIdInOrderByAttemptAscOrdAsc(Collection<UUID> caseResultIds);

    List<RunStep> findByCaseResultIdAndAttemptOrderByOrdAsc(UUID caseResultId, int attempt);

    List<RunStep> findByCaseResultIdOrderByAttemptAscOrdAsc(UUID caseResultId);
}
