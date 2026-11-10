package com.skrr.platform.document.storage;

import java.text.Normalizer;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/** 파일명 정리와 저장소 키 생성. 파일명에서 경로 문자와 제어 문자를 없앤다. */
public final class StorageKeys {

    private static final int MAX_FILENAME_LENGTH = 200;

    private StorageKeys() {
    }

    public static String sanitizeFilename(String original) {
        String name = original == null ? "" : original;
        name = Normalizer.normalize(name, Normalizer.Form.NFC);
        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (slash >= 0) {
            name = name.substring(slash + 1);
        }
        name = name.replaceAll("[\\p{Cntrl}:*?\"<>|]", "")
                .replaceAll("\\s+", " ")
                .trim();
        while (name.startsWith(".")) {
            name = name.substring(1);
        }
        if (name.isEmpty()) {
            name = "file";
        }
        if (name.length() > MAX_FILENAME_LENGTH) {
            String ext = extensionOf(name).map(e -> "." + e).orElse("");
            name = name.substring(0, MAX_FILENAME_LENGTH - ext.length()) + ext;
        }
        return name;
    }

    public static Optional<String> extensionOf(String filename) {
        int dot = filename.lastIndexOf('.');
        if (dot < 0 || dot == filename.length() - 1) {
            return Optional.empty();
        }
        return Optional.of(filename.substring(dot + 1).toLowerCase(Locale.ROOT));
    }

    /** {prefix}/{projectId}/{uuid}_{파일명} */
    public static String documentKey(String prefix, UUID projectId, String sanitizedFilename) {
        return prefix + "/" + projectId + "/" + UUID.randomUUID() + "_" + sanitizedFilename.replace(' ', '_');
    }
}
