package com.skrr.platform.run;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ArtifactRepository extends JpaRepository<Artifact, UUID> {

    java.util.List<Artifact> findByCaseResultIdOrderByCreatedAtAsc(UUID caseResultId);

    Optional<Artifact> findFirstByRunIdAndTypeOrderByCreatedAtDesc(UUID runId, RunEnums.ArtifactType type);
}
