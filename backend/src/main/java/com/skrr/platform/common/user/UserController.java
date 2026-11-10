package com.skrr.platform.common.user;

import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
@Tag(name = "project")
public class UserController {

    private final CurrentUserProvider currentUser;

    public UserController(CurrentUserProvider currentUser) {
        this.currentUser = currentUser;
    }

    @Operation(operationId = "getCurrentUser", summary = "현재 사용자 (사이드바 하단 프로필)")
    @GetMapping("/me")
    public UserResponse getCurrentUser() {
        return UserResponse.from(currentUser.currentUser());
    }

    @Schema(name = "User")

    public record UserResponse(UUID id, String displayName, String roleLabel) {
        public static UserResponse from(AppUser user) {
            return new UserResponse(user.getId(), user.getDisplayName(), user.getRoleLabel());
        }
    }
}
