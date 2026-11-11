package com.skrr.platform.run;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ScenarioRunRepository extends JpaRepository<ScenarioRun, UUID> {

    List<ScenarioRun> findByRunIdOrderByOrdAsc(UUID runId);
}
