package com.skrr.platform.project;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** UI-01 "최근 활동". 호출한 쪽의 트랜잭션에 함께 기록한다. */
@Service
public class ActivityService {

    private final ActivityLogRepository activities;

    public ActivityService(ActivityLogRepository activities) {
        this.activities = activities;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void record(UUID projectId, String message) {
        activities.save(new ActivityLog(projectId, message));
    }

    @Transactional(readOnly = true)
    public List<ActivityLog> recent(UUID projectId, int limit) {
        return activities.findByProjectIdOrderByCreatedAtDescIdDesc(projectId, PageRequest.of(0, limit));
    }
}
