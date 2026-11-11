package com.skrr.platform.common.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** 작업 조회(skrr.jobs.polling-enabled 로 끔)와 SSE heartbeat 가 함께 쓴다. */
@Configuration
@EnableScheduling
public class SchedulingConfig {
}
