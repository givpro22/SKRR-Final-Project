package com.skrr.platform.client.runner;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** runner-api.openapi.yaml checkTargetConnectivity 응답. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ConnectivityResult(boolean reachable, Integer statusCode, String message) {
}
