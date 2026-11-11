package com.skrr.platform.client.ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.skrr.platform.scenario.JsonValues.Reference;
import java.util.List;

/** ai-api.openapi.yaml 의 RefinementResult. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RefinementResult(String kind, List<Candidate> candidates) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Candidate(String refinedText, List<Reference> references) {
    }
}
