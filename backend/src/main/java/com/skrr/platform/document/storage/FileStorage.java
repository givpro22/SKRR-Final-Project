package com.skrr.platform.document.storage;

import java.time.Duration;
import java.time.Instant;

/**
 * 문서·실행 증거 파일 저장소. 운영은 S3, 로컬 개발은 디렉터리 구현을 쓴다 (skrr.storage.type).
 * 키 구조는 docs/architecture.md "S3 키 구조"를 따른다.
 */
public interface FileStorage {

    void put(String key, byte[] content, String contentType);

    void delete(String key);

    /** 저장된 파일 본문. 없으면 UncheckedIOException. */
    byte[] read(String key);

    /** 짧은 유효 시간의 다운로드 링크 (S3 presigned URL). */
    PresignedLink presignDownload(String key, String downloadFilename, Duration ttl);

    record PresignedLink(String url, Instant expiresAt) {
    }
}
