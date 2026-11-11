package com.skrr.platform.scenario;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ScenarioRepository extends JpaRepository<Scenario, UUID> {

    List<Scenario> findByTestRequestIdOrderByCodeAsc(UUID testRequestId);

    long countByTestRequestId(UUID testRequestId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Scenario s where s.id = :id")
    Optional<Scenario> findByIdForUpdate(@Param("id") UUID id);
}
