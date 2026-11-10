# syntax=docker/dockerfile:1
# 백엔드: Maven Wrapper로 실행 jar를 만들고 JRE 이미지에서 비루트로 실행한다. 포트 8080.
# 테스트는 CI에서 실행하므로 이미지 빌드는 -DskipTests.

FROM eclipse-temurin:21.0.13_9-jdk-noble AS build
WORKDIR /src
# 의존성 해석을 먼저 해 두어 소스만 바뀌면 캐시를 재사용한다
COPY mvnw ./
COPY .mvn .mvn
COPY pom.xml ./
RUN chmod +x mvnw && ./mvnw -B -q dependency:go-offline
COPY src src
RUN ./mvnw -B -DskipTests package \
 && find target -maxdepth 1 -name '*.jar' ! -name '*-sources.jar' ! -name '*-javadoc.jar' -exec cp {} /src/app.jar \;

FROM eclipse-temurin:21.0.13_9-jre-noble AS runtime
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app \
 && mkdir -p /data/documents \
 && chown 10001:10001 /data/documents
WORKDIR /app
COPY --from=build --chown=10001:10001 /src/app.jar /app/app.jar
USER 10001
EXPOSE 8080
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError -Djava.io.tmpdir=/tmp"
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
