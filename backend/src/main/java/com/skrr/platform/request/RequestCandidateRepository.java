package com.skrr.platform.request;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RequestCandidateRepository extends JpaRepository<RequestCandidate, UUID> {

    List<RequestCandidate> findByTestRequestIdOrderByOrdAsc(UUID testRequestId);

    List<RequestCandidate> findByTestRequestIdInOrderByOrdAsc(List<UUID> testRequestIds);
}
