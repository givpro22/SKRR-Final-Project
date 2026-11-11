package com.skrr.platform.run;

import com.skrr.platform.common.time.Times;
import com.skrr.platform.run.RunEnums.CompileStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** 케이스 version·렌더러 버전별 TestQuery 와 spec. 테스트 데이터 값은 넣지 않는다 (A16). */
@Entity
@Table(name = "generated_spec")
public class GeneratedSpec {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "test_case_id", nullable = false)
    private UUID testCaseId;

    @Column(name = "test_case_version", nullable = false)
    private int testCaseVersion;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "test_query", nullable = false)
    private Map<String, Object> testQuery;

    @Column(name = "spec_source", nullable = false)
    private String specSource;

    @Column(name = "renderer_version", nullable = false, length = 20)
    private String rendererVersion;

    @Enumerated(EnumType.STRING)
    @Column(name = "compile_status", nullable = false, length = 20)
    private CompileStatus compileStatus;

    @Column(name = "compile_error")
    private String compileError;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Times.now();

    protected GeneratedSpec() {
    }

    public GeneratedSpec(UUID testCaseId, int testCaseVersion, Map<String, Object> testQuery, String specSource,
                         String rendererVersion, CompileStatus compileStatus, String compileError) {
        this.testCaseId = testCaseId;
        this.testCaseVersion = testCaseVersion;
        replace(testQuery, specSource, rendererVersion, compileStatus, compileError);
    }

    public void replace(Map<String, Object> newTestQuery, String newSource, String newRendererVersion,
                        CompileStatus status, String error) {
        this.testQuery = newTestQuery;
        this.specSource = newSource;
        this.rendererVersion = newRendererVersion.length() > 20 ? newRendererVersion.substring(0, 20) : newRendererVersion;
        this.compileStatus = status;
        this.compileError = error;
        this.createdAt = Times.now();
    }

    public UUID getId() {
        return id;
    }

    public UUID getTestCaseId() {
        return testCaseId;
    }

    public int getTestCaseVersion() {
        return testCaseVersion;
    }

    public Map<String, Object> getTestQuery() {
        return testQuery;
    }

    public String getSpecSource() {
        return specSource;
    }

    public String getRendererVersion() {
        return rendererVersion;
    }

    public CompileStatus getCompileStatus() {
        return compileStatus;
    }

    public String getCompileError() {
        return compileError;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
