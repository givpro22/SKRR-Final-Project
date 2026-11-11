package com.skrr.platform.run;

import com.skrr.platform.run.RunEnums.Verdict;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;

/** 화면·API·DB 교차 검증 1행 (UI-04 표). 케이스의 마지막 시도 값만 남긴다. */
@Entity
@Table(name = "verification")
public class Verification {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "case_result_id", nullable = false)
    private UUID caseResultId;

    @Column(nullable = false)
    private short ord;

    @Column(name = "item_label", nullable = false, length = 200)
    private String itemLabel;

    @Column(name = "ui_value")
    private String uiValue;

    @Column(name = "api_value")
    private String apiValue;

    @Column(name = "db_value")
    private String dbValue;

    @Column(name = "expected_value")
    private String expectedValue;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Verdict verdict;

    protected Verification() {
    }

    public Verification(UUID caseResultId, int ord, String itemLabel, String uiValue, String apiValue, String dbValue,
                        String expectedValue, Verdict verdict) {
        this.caseResultId = caseResultId;
        this.ord = (short) ord;
        this.itemLabel = itemLabel.length() > 200 ? itemLabel.substring(0, 200) : itemLabel;
        this.uiValue = uiValue;
        this.apiValue = apiValue;
        this.dbValue = dbValue;
        this.expectedValue = expectedValue;
        this.verdict = verdict;
    }

    public UUID getCaseResultId() {
        return caseResultId;
    }

    public int getOrd() {
        return ord;
    }

    public String getItemLabel() {
        return itemLabel;
    }

    public String getUiValue() {
        return uiValue;
    }

    public String getApiValue() {
        return apiValue;
    }

    public String getDbValue() {
        return dbValue;
    }

    public String getExpectedValue() {
        return expectedValue;
    }

    public Verdict getVerdict() {
        return verdict;
    }
}
