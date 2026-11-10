package com.skrr.platform.document.storage;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

/**
 * 로컬 개발용 저장소. 파일은 {localDir}/{key}에 두고, 다운로드 링크는 HMAC 서명과 만료 시각을 붙여
 * LocalStorageController 가 검사한다. 운영에서는 쓰지 않는다.
 */
public class LocalFileStorage implements FileStorage {

    static final String DOWNLOAD_PATH = "/api/local-storage/";

    private final Path root;
    private final byte[] signingKey;

    public LocalFileStorage(Path root, byte[] signingKey) {
        this.root = root.toAbsolutePath().normalize();
        this.signingKey = signingKey;
    }

    @Override
    public void put(String key, byte[] content, String contentType) {
        Path target = resolve(key);
        try {
            Files.createDirectories(target.getParent());
            Path temp = Files.createTempFile(target.getParent(), ".upload-", ".tmp");
            Files.write(temp, content);
            Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException ex) {
            throw new UncheckedIOException("파일을 저장하지 못했습니다: " + key, ex);
        }
    }

    @Override
    public void delete(String key) {
        try {
            Files.deleteIfExists(resolve(key));
        } catch (IOException ex) {
            throw new UncheckedIOException("파일을 삭제하지 못했습니다: " + key, ex);
        }
    }

    @Override
    public PresignedLink presignDownload(String key, String downloadFilename, Duration ttl) {
        Instant expiresAt = Instant.now().plus(ttl).truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        long expires = expiresAt.getEpochSecond();
        String url = ServletUriComponentsBuilder.fromCurrentContextPath().build().toUriString()
                + DOWNLOAD_PATH + encodePath(key)
                + "?expires=" + expires
                + "&filename=" + URLEncoder.encode(downloadFilename, StandardCharsets.UTF_8)
                + "&signature=" + sign(key, expires, downloadFilename);
        return new PresignedLink(url, expiresAt);
    }

    boolean verify(String key, long expires, String filename, String signature) {
        if (Instant.now().getEpochSecond() > expires || signature == null) {
            return false;
        }
        return MessageDigest.isEqual(sign(key, expires, filename).getBytes(StandardCharsets.UTF_8),
                signature.getBytes(StandardCharsets.UTF_8));
    }

    Path resolve(String key) {
        Path target = root.resolve(key).normalize();
        if (!target.startsWith(root) || target.equals(root)) {
            throw new IllegalArgumentException("저장소 밖의 경로입니다: " + key);
        }
        return target;
    }

    private String sign(String key, long expires, String filename) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(signingKey, "HmacSHA256"));
            byte[] digest = mac.doFinal((key + "\n" + expires + "\n" + filename).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException | InvalidKeyException ex) {
            throw new IllegalStateException(ex);
        }
    }

    private static String encodePath(String key) {
        StringBuilder out = new StringBuilder();
        for (String segment : key.split("/")) {
            if (!out.isEmpty()) {
                out.append('/');
            }
            out.append(URLEncoder.encode(segment, StandardCharsets.UTF_8).replace("+", "%20"));
        }
        return out.toString();
    }
}
