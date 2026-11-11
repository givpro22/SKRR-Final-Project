package com.skrr.platform.report;

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

/** AI 가 제시한 실패 원인 후보 (UI-04). 판정이 아니라 후보다. */
@Entity
@Table(name = "root_cause_candidate")
public class RootCauseCandidate {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "case_result_id", nullable = false)
    private UUID caseResultId;

    @Column(nullable = false)
    private short rank;

    @Column(nullable = false)
    private String description;

    @Column(name = "confidence_pct", nullable = false)
    private short confidencePct;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private List<String> evidence = new ArrayList<>();

    @Column
    private String remediation;

    protected RootCauseCandidate() {
    }

    public RootCauseCandidate(UUID caseResultId, int rank, String description, int confidencePct,
                              List<String> evidence, String remediation) {
        this.caseResultId = caseResultId;
        this.rank = (short) rank;
        this.description = description;
        this.confidencePct = (short) Math.max(0, Math.min(100, confidencePct));
        this.evidence = new ArrayList<>(evidence);
        this.remediation = remediation;
    }

    public UUID getCaseResultId() {
        return caseResultId;
    }

    public int getRank() {
        return rank;
    }

    public String getDescription() {
        return description;
    }

    public int getConfidencePct() {
        return confidencePct;
    }

    public List<String> getEvidence() {
        return evidence;
    }

    public String getRemediation() {
        return remediation;
    }
}
