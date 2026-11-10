package com.skrr.platform.project;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ActivityLogRepository extends JpaRepository<ActivityLog, Long> {

    List<ActivityLog> findByProjectIdOrderByCreatedAtDescIdDesc(UUID projectId, Pageable pageable);
}
