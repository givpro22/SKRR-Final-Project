package com.skrr.platform.document;

import static org.assertj.core.api.Assertions.assertThat;

import com.skrr.platform.document.storage.StorageKeys;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class StorageKeysTest {

    @Test
    void removesPathAndControlCharacters() {
        assertThat(StorageKeys.sanitizeFilename("../../etc/passwd")).isEqualTo("passwd");
        assertThat(StorageKeys.sanitizeFilename("C:\\Users\\me\\요구사항 v3.pdf")).isEqualTo("요구사항 v3.pdf");
        assertThat(StorageKeys.sanitizeFilename("a\u0000b<c>|d.pdf")).isEqualTo("abcd.pdf");
        assertThat(StorageKeys.sanitizeFilename("..hidden.yaml")).isEqualTo("hidden.yaml");
        assertThat(StorageKeys.sanitizeFilename("")).isEqualTo("file");
        assertThat(StorageKeys.sanitizeFilename("x".repeat(300) + ".json")).hasSize(200).endsWith(".json");
    }

    @Test
    void keyFollowsArchitectureLayout() {
        UUID projectId = UUID.randomUUID();
        String key = StorageKeys.documentKey("api-specs", projectId, "openapi shop.yaml");
        assertThat(key).matches("api-specs/" + projectId + "/[0-9a-f-]{36}_openapi_shop\\.yaml");
    }

    @Test
    void extensionIsLowercase() {
        assertThat(StorageKeys.extensionOf("A.PDF")).contains("pdf");
        assertThat(StorageKeys.extensionOf("noext")).isEmpty();
        assertThat(DocumentType.CATALOG.accepts("csv")).isTrue();
        assertThat(DocumentType.REQUIREMENT.accepts("yaml")).isFalse();
    }
}
