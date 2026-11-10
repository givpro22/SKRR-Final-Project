package com.skrr.platform.common.user;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AppUserRepository extends JpaRepository<AppUser, UUID> {
}
