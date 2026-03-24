# 원격 호스팅형 Streamable HTTP 확장 계획

## 요약

- 기존 `LOCAL-STREAMABLE-HTTP-PLAN.md`의 "로컬 전용 HTTP 브리지" 전제를 폐기하고, `stdio` 기본 동작은 유지하면서 공개 HTTPS 엔드포인트로 운영 가능한 `streamable-http` 모드를 1급 transport로 추가한다.
- v1 원격 호스팅 모드는 `정적 Bearer 토큰`으로 MCP 서버 접근을 보호하고, Azure DevOps 호출은 `공유 서버 신원`으로 수행한다.
- 클라이언트별 Azure DevOps 사용자 위임과 토큰 전달 방식은 이번 범위에서 제외한다.
- 설치 경험은 이원화한다. 로컬/one-click 사용자는 계속 `stdio`를 사용하고, 공개 원격 사용자는 `streamable-http` 엔드포인트와 원격 메타데이터를 사용한다.

## 공개 인터페이스 변경

- CLI transport 옵션을 `--transport <stdio|streamable-http>`로 확장하고 기본값은 계속 `stdio`로 둔다.
- HTTP 설정 옵션을 추가한다.
- `--http-host <host>`: 기본값 `127.0.0.1`
- `--http-port <port>`: 기본값 `3001`
- `--http-path <path>`: 기본값 `/mcp`
- `--http-auth-token <token>`: HTTP 모드에서 필수
- `--http-allowed-origin <origin>`: 반복 가능, 기본값 없음
- `--http-session-mode <stateful|stateless>`: 기본값 `stateless`
- `--http-session-idle-timeout-seconds <seconds>`: 기본값 `1800`, `stateful`일 때만 적용
- `ADO_MCP_HTTP_AUTH_TOKEN`: `--http-auth-token`의 환경변수 fallback
- 비루프백 바인딩에서 `--authentication` 기본값을 `env`로 바꾸고 `interactive`는 금지한다.
- 비루프백 hosted 모드에서는 `env`와 `envvar`만 허용한다.
- `server.json`은 `packages` 기반 `stdio` 메타데이터를 유지하고, 공개 호스팅 URL이 준비되면 같은 메타데이터에 `remotes` 항목을 추가한다.
- 원격 항목은 `streamable-http` URL과 secret `Authorization` 헤더 입력을 포함한다.
- 원격 메타데이터를 손대는 시점에 package identifier/version이 실제 배포 산출물과 일치하는지 함께 정리한다.

## 구현 변경

- `src/index.ts`의 책임을 `인자 파싱`, `공유 런타임 생성`, `MCP 서버 factory`, `stdio runner`, `streamable-http runner`로 분리한다.
- 공유 런타임은 프로세스당 한 번만 만든다. 여기에는 조직/도메인 해석, Azure DevOps credential provider, connection factory, user-agent 조합기, 공통 로깅이 포함된다.
- HTTP 모드는 Node 내장 `http`와 MCP SDK의 Streamable HTTP transport만 사용한다.
- `stateful` 모드는 세션별로 `McpServer`와 transport를 생성하고 `MCP-Session-Id` 기준 메모리 맵으로 관리한다.
- `stateful` 세션은 초기화 시 생성하고 마지막 활동 시각을 갱신한다.
- `stateful`에서는 idle timeout 또는 `DELETE /mcp` 시 세션을 정리하며, 종료된 세션으로 다시 접근하면 `404`를 반환한다.
- `stateless` 모드는 요청마다 새 `McpServer`와 transport를 생성하고 응답 종료 시 즉시 정리한다.
- `stateless`에서는 `MCP-Session-Id`를 발급하지 않고 `DELETE /mcp`도 지원하지 않는다.
- `POST /mcp`는 MCP JSON-RPC를 처리한다.
- `GET /mcp`는 v1에서는 SSE 스트림을 제공하지 않으므로 `405`를 반환한다.
- legacy HTTP+SSE 별도 엔드포인트는 추가하지 않는다.
- 인증 계층은 모든 HTTP 요청에서 `Authorization: Bearer <token>`을 검증한다.
- 잘못된 토큰이나 누락은 `401`로 처리한다.
- 브라우저 origin은 기본 차단으로 바꾼다.
- `Origin` 헤더가 있는 경우 `--http-allowed-origin`에 명시된 값만 허용하고, 나머지는 `403`으로 처리한다.
- `Origin`이 없는 일반 MCP 클라이언트 요청은 허용한다.
- 원격 hosted 모드의 Azure DevOps 접근은 서버 측 자격으로만 수행한다.
- MCP 클라이언트가 제시한 Bearer 토큰은 Azure DevOps로 전달하지 않는다.
- README/GETTINGSTARTED/TROUBLESHOOTING/FAQ는 "local only" 서술을 "local stdio + optional hosted streamable-http"로 재구성한다.
- FAQ의 원격 미지원 문구는 새 동작에 맞게 교체한다.
- 배포는 애플리케이션 내 TLS 종료가 아니라 HTTPS reverse proxy 또는 managed ingress 앞단 배치를 전제로 문서화한다.

## 테스트 계획

- 인자 파싱 테스트로 `stdio` 기본값, HTTP 옵션 검증, HTTP 모드의 토큰 필수 규칙, 비루프백 hosted 모드의 인증 타입 제한을 확인한다.
- 부트스트랩 테스트로 `stdio` 경로가 기존과 동일하게 동작하고, `streamable-http` 경로가 공유 런타임을 재사용하는지 검증한다.
- HTTP 라우팅 테스트로 잘못된 path `404`, 미지원 method `405`, 토큰 실패 `401`, origin 거부 `403`, 세션 누락/만료 `400` 또는 `404`를 검증한다.
- `stateful` 세션 테스트로 `initialize` 후 `tools/list` 호출, `DELETE` 이후 재호출 실패, idle timeout 만료 후 새 세션 재시작 흐름을 검증한다.
- `stateless` 테스트로 `initialize` 후 세션 ID 없이 `tools/list`가 계속 동작하는지, `DELETE`가 `405`인지, 멀티 레플리카에서도 정상 호출되는지 검증한다.
- 회귀 테스트로 기존 도메인 필터링과 Azure DevOps 연결 동작이 `stdio`와 HTTP 모두에서 동일한 tool surface를 노출하는지 확인한다.
- 문서 및 메타데이터 검증으로 README 예시, FAQ 설명, `server.json` schema 적합성, 원격 header 프롬프트 구성이 서로 모순되지 않는지 확인한다.

## 가정과 기본값

- 이번 계획의 hosted 모드는 `Streamable HTTP`만 지원하고, 별도 SSE transport 호환성은 범위에서 제외한다.
- 공개 원격 메타데이터는 실제로 공개 HTTPS URL이 준비된 뒤에만 배포한다.
- URL이 고정되기 전까지는 `stdio` 메타데이터를 기본 경로로 유지한다.
- hosted `streamable-http`의 기본 session mode는 `stateless`다.
- `stateful` 모드는 pod 메모리 세션을 사용하므로 멀티 레플리카에서 sticky routing 또는 단일 replica 배치가 필요하다.
- v1 hosted 모드는 멀티유저 Azure DevOps 사용자 위임을 제공하지 않는다.
- 해당 기능은 MCP OAuth resource server 구현과 별도 Azure DevOps 위임 설계가 필요하므로 후속 단계로 분리한다.
- 보안과 메타데이터 기준은 최신 MCP 공식 문서를 따른다.
- [Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [Security Best Practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices)
- [Publishing Remote Servers](https://modelcontextprotocol.io/registry/remote-servers)
- [MCP Registry About](https://modelcontextprotocol.io/registry/about)
