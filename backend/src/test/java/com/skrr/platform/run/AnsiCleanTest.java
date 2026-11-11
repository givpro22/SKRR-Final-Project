package com.skrr.platform.run;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class AnsiCleanTest {

    @Test
    void stripsTerminalColorCodes() {
        assertThat(RunWorker.clean("\u001B[2mexpect(locator)\u001B[22m 요소를 찾지 못했어요 \u001B[31;1m!\u001B[0m"))
                .isEqualTo("expect(locator) 요소를 찾지 못했어요 !");
        assertThat(RunWorker.clean("그대로")).isEqualTo("그대로");
        assertThat(RunWorker.clean(null)).isNull();
    }
}
