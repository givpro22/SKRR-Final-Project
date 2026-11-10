package com.skrr.platform.document.storage;

import com.skrr.platform.common.error.ApiException;
import com.skrr.platform.common.error.ErrorCode;
import io.swagger.v3.oas.annotations.Hidden;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 로컬 저장소의 서명된 다운로드 링크를 처리한다. 계약 밖의 개발용 경로라 API 문서에서 숨긴다. */
@Hidden
@RestController
@ConditionalOnProperty(name = "skrr.storage.type", havingValue = "local", matchIfMissing = true)
public class LocalStorageController {

    private final LocalFileStorage storage;

    public LocalStorageController(FileStorage storage) {
        this.storage = (LocalFileStorage) storage;
    }

    @GetMapping(LocalFileStorage.DOWNLOAD_PATH + "**")
    public ResponseEntity<Resource> download(HttpServletRequest request,
                                             @RequestParam long expires,
                                             @RequestParam String filename,
                                             @RequestParam String signature) {
        String encoded = request.getRequestURI().substring(
                request.getContextPath().length() + LocalFileStorage.DOWNLOAD_PATH.length());
        String key = URLDecoder.decode(encoded.replace("+", "%2B"), StandardCharsets.UTF_8);
        if (!storage.verify(key, expires, filename, signature)) {
            throw new ApiException(ErrorCode.RESOURCE_NOT_FOUND, "링크가 만료되었거나 올바르지 않습니다.");
        }
        Path file = storage.resolve(key);
        if (!Files.isRegularFile(file)) {
            throw ApiException.notFound("파일");
        }
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(filename, StandardCharsets.UTF_8).build().toString())
                .body(new FileSystemResource(file));
    }
}
