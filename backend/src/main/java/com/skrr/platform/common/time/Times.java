package com.skrr.platform.common.time;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

/** DB(timestamptz)가 마이크로초까지 저장하므로 저장 전과 후의 값이 같도록 맞춘다. */
public final class Times {

    private Times() {
    }

    public static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }
}
