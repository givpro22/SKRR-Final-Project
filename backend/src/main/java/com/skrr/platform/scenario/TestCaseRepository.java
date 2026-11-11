package com.skrr.platform.scenario;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TestCaseRepository extends JpaRepository<TestCase, UUID> {

    List<TestCase> findByScenarioIdInAndActiveTrueOrderByOrdAsc(Collection<UUID> scenarioIds);

    List<TestCase> findByScenarioIdAndActiveTrueOrderByOrdAsc(UUID scenarioId);

    List<TestCase> findByTestRequestId(UUID testRequestId);

    long countByTestRequestIdAndActiveTrue(UUID testRequestId);
}
