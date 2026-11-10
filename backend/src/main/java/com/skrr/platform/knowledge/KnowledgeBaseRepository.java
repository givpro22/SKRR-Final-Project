package com.skrr.platform.knowledge;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface KnowledgeBaseRepository extends JpaRepository<KnowledgeBase, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select k from KnowledgeBase k where k.projectId = :projectId")
    Optional<KnowledgeBase> findByIdForUpdate(@Param("projectId") UUID projectId);
}
