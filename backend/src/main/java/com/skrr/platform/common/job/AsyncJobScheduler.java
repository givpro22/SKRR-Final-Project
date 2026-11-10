package com.skrr.platform.common.job;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/** skrr.jobs.polling-enabled=false 이면 꺼진다 (테스트에서 직접 pollOnce 를 부른다). */
@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "skrr.jobs.polling-enabled", havingValue = "true", matchIfMissing = true)
public class AsyncJobScheduler {

    private final AsyncJobPoller poller;

    public AsyncJobScheduler(AsyncJobPoller poller) {
        this.poller = poller;
    }

    @Scheduled(fixedDelayString = "${skrr.jobs.poll-interval-ms:2000}", initialDelay = 1000)
    public void poll() {
        poller.pollOnce();
    }
}
