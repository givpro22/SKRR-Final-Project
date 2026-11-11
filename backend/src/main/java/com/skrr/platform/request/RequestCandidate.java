package com.skrr.platform.request;

import com.skrr.platform.scenario.JsonValues.Reference;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** AI가 RAG 근거로 정제한 요청 후보 (UI-02-1B). */
@Entity
@Table(name = "request_candidate")
public class RequestCandidate {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "test_request_id", nullable = false)
    private UUID testRequestId;

    @Column(nullable = false)
    private short ord;

    @Column(name = "refined_text", nullable = false)
    private String refinedText;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "references_json", nullable = false)
    private List<Reference> references = new ArrayList<>();

    @Column(name = "is_selected", nullable = false)
    private boolean selected;

    protected RequestCandidate() {
    }

    public RequestCandidate(UUID testRequestId, int ord, String refinedText, List<Reference> references) {
        this.testRequestId = testRequestId;
        this.ord = (short) ord;
        this.refinedText = refinedText;
        this.references = references == null ? new ArrayList<>() : new ArrayList<>(references);
    }

    public void markSelected() {
        selected = true;
    }

    public UUID getId() {
        return id;
    }

    public UUID getTestRequestId() {
        return testRequestId;
    }

    public int getOrd() {
        return ord;
    }

    public String getRefinedText() {
        return refinedText;
    }

    public List<Reference> getReferences() {
        return references;
    }

    public boolean isSelected() {
        return selected;
    }
}
