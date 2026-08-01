# CofferGate Contribution Guide

이 문서는 CofferGate 저장소의 브랜치, 커밋, Pull Request 규칙을 정의합니다.

## 기본 원칙

- 기본 브랜치는 `main`입니다.
- `main`에 직접 push하지 않습니다.
- 모든 변경은 작업 브랜치와 Pull Request를 통해 병합합니다.
- 하나의 브랜치는 하나의 목적만 다룹니다.
- 비밀키, API 키, 지갑 자격증명, 개인 환경 파일은 커밋하지 않습니다.

## 브랜치 규칙

브랜치 이름은 `<type>/<issue-number>-<short-description>` 형식을 사용합니다.

| Type | 용도 | 예시 |
| --- | --- | --- |
| `feat` | 새로운 기능 | `feat/24-policy-gate` |
| `fix` | 버그 수정 | `fix/31-expired-quote` |
| `refactor` | 동작 변경 없는 구조 개선 | `refactor/42-firestore-repository` |
| `test` | 테스트 추가·수정 | `test/18-execution-lock` |
| `docs` | 문서 변경 | `docs/12-local-setup` |
| `chore` | 설정·도구·의존성 관리 | `chore/7-ci-workflow` |
| `hotfix` | 운영 긴급 수정 | `hotfix/55-disable-auto-execution` |

규칙:

- 소문자 영문과 숫자, 하이픈만 사용합니다.
- 설명은 2~5개 단어로 짧게 작성합니다.
- 이슈가 없다면 `issue-number`를 생략할 수 있습니다.
- 개인 이름이나 `temp`, `test2`, `final` 같은 모호한 이름은 사용하지 않습니다.

## 커밋 규칙

Conventional Commits 형식을 사용합니다.

```text
<type>(<scope>): <summary>
```

예시:

```text
feat(policy): add deterministic AUTO decision
fix(executor): reject unexpected transaction signer
test(firestore): cover concurrent execution claims
docs(setup): document local emulator workflow
```

허용 type:

- `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `perf`, `build`, `revert`

작성 기준:

- 제목은 영문 명령형으로 작성하고 72자 이내로 유지합니다.
- 서로 다른 목적의 변경을 한 커밋에 섞지 않습니다.
- 테스트를 통과하지 않는 중간 커밋은 PR 병합 전에 정리합니다.
- 자동 생성 파일과 불필요한 포맷 변경을 기능 변경과 섞지 않습니다.
- Breaking change는 본문에 `BREAKING CHANGE:`를 기록합니다.

## Pull Request 규칙

PR을 열기 전에 다음을 확인합니다.

1. 최신 `main`을 반영합니다.
2. 관련 테스트, lint, type check를 실행합니다.
3. API·schema 변경은 프론트엔드 호환성을 확인합니다.
4. 보안 경계와 자금 실행 경로 변경은 실패·BLOCK 테스트를 포함합니다.
5. 민감정보와 실제 지갑 주소가 diff 또는 로그에 포함되지 않았는지 확인합니다.

PR 작성 기준:

- 제목도 Conventional Commits 형식을 사용합니다.
- PR 본문은 변경 이유, 변경 내용, 검증 결과, 영향 및 위험 순서로 작성합니다.
- 변경 이유에는 이 작업이 필요한 배경과 달성하려는 목적을 기록합니다.
- 변경 내용에는 리뷰어가 확인해야 할 구현·설정·계약 변경을 구체적으로 기록합니다.
- 영향 및 위험에는 호환성, 보안 경계, 후속 작업, 아직 연결되지 않은 외부 의존성을 기록합니다.
- 관련 이슈를 `Closes #123` 형식으로 연결합니다.
- Draft PR은 논의용으로 사용하고 병합 준비가 끝나면 Ready로 전환합니다.

권장 PR 본문 구조:

```markdown
## 변경 이유

이 변경이 필요한 배경과 목적을 설명합니다.

## 변경 내용

- 주요 구현 내용을 작성합니다.
- API·schema·설정 변경을 명시합니다.

## 검증

- 실행한 테스트, lint, type check와 결과를 작성합니다.

## 영향 및 위험

- 호환성, 보안, 운영 영향과 후속 작업을 작성합니다.
```

## 병합

- Squash 커밋 제목은 PR 제목과 동일하게 정리합니다.

## 보호가 필요한 변경

다음 변경은 특히 신중하게 검증합니다.

- Cloud KMS, IAM, Service Account
- Policy Gate와 거래 한도
- Jupiter program·signer allowlist
- Firestore 실행 잠금과 idempotency
- Solana submit·confirm·reconciliation
- Circuit breaker와 자동 실행 모드
- API 인증·권한·비밀정보 처리

위 항목은 정상 경로뿐 아니라 거절, 만료, 중복, 외부 장애 테스트를 포함해야 합니다.

## 권장 GitHub Branch Protection

`main`에 다음 규칙을 적용합니다.

- Require a pull request before merging
- Block force pushes
- Block branch deletion
