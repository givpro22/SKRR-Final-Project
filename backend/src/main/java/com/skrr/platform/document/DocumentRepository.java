package com.skrr.platform.document;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DocumentRepository extends JpaRepository<Document, UUID> {

    List<Document> findByProjectIdAndActiveTrue(UUID projectId);

    Optional<Document> findByProjectIdAndTypeAndActiveTrue(UUID projectId, DocumentType type);

    @Query("select coalesce(max(d.version), 0) from Document d where d.projectId = :projectId and d.type = :type")
    int findMaxVersion(@Param("projectId") UUID projectId, @Param("type") DocumentType type);

    List<Document> findByProjectIdAndStatus(UUID projectId, DocumentStatus status);
}
