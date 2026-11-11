package com.skrr.platform.run;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CaseResultRepository extends JpaRepository<CaseResult, UUID> {

    List<CaseResult> findByScenarioRunIdIn(Collection<UUID> scenarioRunIds);

    List<CaseResult> findByScenarioRunId(UUID scenarioRunId);
}
