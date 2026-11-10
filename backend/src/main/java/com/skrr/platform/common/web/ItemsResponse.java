package com.skrr.platform.common.web;

import java.util.List;

/** 계약의 {"items": [...]} 목록 응답. */
public record ItemsResponse<T>(List<T> items) {
}
