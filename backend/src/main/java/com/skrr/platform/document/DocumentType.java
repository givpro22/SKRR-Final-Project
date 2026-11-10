package com.skrr.platform.document;

import java.util.Arrays;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * enum:DocumentType. 허용 확장자는 docs/contracts/target-site-contract.md 의 문서 형식을 따른다.
 * S3 키 접두어는 docs/architecture.md "S3 키 구조"를 따른다.
 */
public enum DocumentType {
    REQUIREMENT("요구사항 명세서", "requirements", true, Set.of("pdf", "docx")),
    API_SPEC("API 명세서", "api-specs", true, Set.of("yaml", "yml", "json")),
    CATALOG("카탈로그", "catalog", true, Set.of("csv", "json")),
    TEST_DATA("테스트 데이터", "test-data", false, Set.of("json"));

    private static final Map<String, String> CONTENT_TYPES = Map.of(
            "pdf", "application/pdf",
            "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "yaml", "application/yaml",
            "yml", "application/yaml",
            "json", "application/json",
            "csv", "text/csv");

    private final String label;
    private final String storagePrefix;
    private final boolean required;
    private final Set<String> extensions;

    DocumentType(String label, String storagePrefix, boolean required, Set<String> extensions) {
        this.label = label;
        this.storagePrefix = storagePrefix;
        this.required = required;
        this.extensions = extensions;
    }

    public String label() {
        return label;
    }

    public String storagePrefix() {
        return storagePrefix;
    }

    /** 지식 베이스 구축에 반드시 필요한 문서 (FR-01). */
    public boolean required() {
        return required;
    }

    /** AI 서버가 인덱싱하는 문서. TEST_DATA 는 비밀값이 있어 AI로 보내지 않는다. */
    public boolean indexed() {
        return required;
    }

    public boolean accepts(String extension) {
        return extensions.contains(extension);
    }

    public List<String> extensions() {
        return extensions.stream().sorted().toList();
    }

    public static String contentTypeOf(String extension) {
        return CONTENT_TYPES.getOrDefault(extension, "application/octet-stream");
    }

    public static Set<DocumentType> requiredTypes() {
        EnumSet<DocumentType> set = EnumSet.noneOf(DocumentType.class);
        Arrays.stream(values()).filter(DocumentType::required).forEach(set::add);
        return set;
    }
}
