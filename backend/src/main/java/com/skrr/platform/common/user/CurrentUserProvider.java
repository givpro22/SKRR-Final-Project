package com.skrr.platform.common.user;

import com.skrr.platform.common.config.SkrrProperties;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 현재 사용자 조회를 한곳에 모은다. MVP에는 로그인이 없어(ADR-011, ADR-013) 기본 사용자 1명을 돌려준다.
 * 인증을 도입하면 이 클래스만 바꾼다.
 */
@Component
public class CurrentUserProvider {

    private final AppUserRepository users;
    private final UUID defaultUserId;

    public CurrentUserProvider(AppUserRepository users, SkrrProperties properties) {
        this.users = users;
        this.defaultUserId = properties.defaultUserId();
    }

    public UUID currentUserId() {
        return defaultUserId;
    }

    @Transactional(readOnly = true)
    public AppUser currentUser() {
        return users.findById(defaultUserId)
                .orElseThrow(() -> new IllegalStateException("기본 사용자가 DB에 없습니다: " + defaultUserId));
    }
}
