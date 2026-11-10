package com.skrr.platform.common.config;

import com.skrr.platform.common.error.ErrorCode;
import com.skrr.platform.document.DocumentType;
import io.swagger.v3.oas.models.Components;
import org.springdoc.core.customizers.OpenApiCustomizer;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.media.ArraySchema;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.IntegerSchema;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.responses.ApiResponse;
import java.util.Arrays;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * /v3/api-docs 를 계약(platform-api.openapi.yaml)과 비교할 수 있게 공통 오류 응답을 같은 이름으로 등록한다.
 * 각 API는 @ApiResponse(ref = "NotFound") 처럼 참조한다.
 */
@Configuration
public class OpenApiConfig {

    public static final String BAD_REQUEST = "#/components/responses/BadRequest";
    public static final String NOT_FOUND = "#/components/responses/NotFound";
    public static final String CONFLICT = "#/components/responses/Conflict";
    public static final String PAYLOAD_TOO_LARGE = "#/components/responses/PayloadTooLarge";
    public static final String SERVICE_UNAVAILABLE = "#/components/responses/ServiceUnavailable";

    @Bean
    public OpenAPI platformOpenApi() {
        return new OpenAPI()
                .info(new Info().title("SKRR 플랫폼 API").version("0.1.0"))
                .components(new Components()
                        .addResponses("BadRequest", problemResponse("입력값 오류 (VALIDATION_FAILED)"))
                        .addResponses("NotFound", problemResponse("대상 없음 (RESOURCE_NOT_FOUND)"))
                        .addResponses("Conflict", problemResponse("현재 상태에서 불가능한 요청"))
                        .addResponses("PayloadTooLarge", problemResponse("파일 크기 초과 (FILE_TOO_LARGE)"))
                        .addResponses("ServiceUnavailable",
                                problemResponse("연동 서비스 장애 (DEPENDENCY_UNAVAILABLE)")));
    }

    /**
     * Problem, ErrorCode 스키마는 코드에서 직접 참조되지 않아 springdoc 이 생성 단계에서 지운다.
     * 문서 생성이 끝난 뒤 넣는다.
     */
    @Bean
    public OpenApiCustomizer problemSchemaCustomizer() {
        return openApi -> {
            Components components = openApi.getComponents();
            components.addSchemas("ErrorCode", errorCodeSchema());
            components.addSchemas("Problem", problemSchema());
        };
    }

    private static Schema<?> errorCodeSchema() {
        return enumSchema(ErrorCode.values());
    }

    private static Schema<?> enumSchema(Enum<?>[] values) {
        return new StringSchema()._enum(Arrays.stream(values).map(Enum::name).toList());
    }

    private static Schema<?> problemSchema() {
        return new ObjectSchema()
                .addProperty("type", new StringSchema())
                .addProperty("title", new StringSchema())
                .addProperty("status", new IntegerSchema())
                .addProperty("detail", new StringSchema())
                .addProperty("instance", new StringSchema().description("요청 경로"))
                .addProperty("code", new Schema<>().$ref("#/components/schemas/ErrorCode"))
                .addProperty("missingDocumentTypes", new ArraySchema()
                        .description("409 MISSING_REQUIRED_DOCUMENTS일 때만. 빠진 필수 문서 종류")
                        .items(enumSchema(DocumentType.values())))
                .addProperty("allowedExtensions", new ArraySchema()
                        .description("400 UNSUPPORTED_FILE_TYPE일 때만. 허용 확장자 (소문자, 점 없음)")
                        .items(new StringSchema()))
                .addProperty("fieldErrors", new ArraySchema().items(fieldError()))
                .required(List.of("title", "status", "code"));
    }

    private static Schema<?> fieldError() {
        return new ObjectSchema()
                .addProperty("field", new StringSchema())
                .addProperty("message", new StringSchema())
                .required(List.of("field", "message"));
    }

    private static ApiResponse problemResponse(String description) {
        return new ApiResponse().description(description).content(new Content().addMediaType(
                "application/problem+json",
                new MediaType().schema(new Schema<>().$ref("#/components/schemas/Problem"))));
    }
}
