# CCK Groups API Reference

기준 일시: 2026-03-14  
소스: `CCK_Groups_Server/src/routes/*.js`

## Base URL
- 기본(baseUrl): `{{baseUrl}} = http://localhost:8080/api/v1`

## Postman Collection 구성
- `CCKGroups_Health.postman_collection.json`
- `CCKGroups_Auth.postman_collection.json`
- `CCKGroups_Competition.postman_collection.json`
- `CCKGroups_Player.postman_collection.json`
- `CCKGroups_AdminRoundConfig.postman_collection.json`
- `CCKGroups_AdminAssignment.postman_collection.json`

## Health
| Name | Method | Path | 설명 |
|---|---|---|---|
| Health Check | `GET` | `/api/v1/health` | 서버/DB 헬스체크 |

## Auth
| Name | Method | Path | Query/Body | 설명 |
|---|---|---|---|---|
| Issue Token | `POST` | `/api/v1/auth/token` | Query: `code` | OAuth code로 토큰 발급 |
| Refresh Token | `POST` | `/api/v1/auth/refresh` | Body: `{}` | access token 재발급 |
| Logout | `POST` | `/api/v1/auth/logout` | Body: `{}` | 로그아웃 |
| Get Auth Info By CCK ID | `GET` | `/api/v1/auth/info/:cckId` | Path: `cckId` | 특정 사용자 정보 조회 |
| Get My Auth Info | `GET` | `/api/v1/auth/info` | Header: `Authorization`(optional) | 현재 인증 사용자 정보 조회 |

## Competition
| Name | Method | Path | Query/Path | 설명 |
|---|---|---|---|---|
| Get Competitions | `GET` | `/api/v1/competitions` | Query: `status=past|now|future` | 대회 목록 |
| Get Competition Detail | `GET` | `/api/v1/competitions/:competitionId` | Path: `competitionId` | 대회 상세 + 라운드 목록 |
| Get Rounds By Day | `GET` | `/api/v1/competitions/:competitionId/rounds/day/:dayCount` | Path: `competitionId`, `dayCount` | 일차별 라운드 |
| Get Confirmed Registrations | `GET` | `/api/v1/competitions/:competitionId/registrations/confirmed` | Path: `competitionId` | 결제 완료 참가자 |

## Player
| Name | Method | Path | Query/Path | 설명 |
|---|---|---|---|---|
| Get Player Assignments In Competition | `GET` | `/api/v1/competition/:compIdx/player/:cckId` | Path: `compIdx`, `cckId` | 대회 내 개인 배정 조회 |
| Get Round Assignments | `GET` | `/api/v1/round/:roundIdx` | Path: `roundIdx` | 라운드별 역할 배정 조회 |

## Admin - Round Config
| Name | Method | Path | Body | 설명 |
|---|---|---|---|---|
| Get Round Config | `GET` | `/api/v1/admin/competition/:compIdx/round/:roundIdx/config` | - | 라운드 조 설정 조회 |
| Get Round Config (Alias) | `GET` | `/api/v1/admin/competition/:compIdx/round/:roundIdx/configs` | - | 위와 동일(별칭) |
| Update Round Config (PUT) | `PUT` | `/api/v1/admin/competition/:compIdx/round/:roundIdx/config` | `{ "groups": [{ "groupName": "A", "playerCount": 0, "judgeCount": 0, "runnerCount": 0, "scramblerCount": 0 }] }` | 라운드 조 설정 저장 |
| Update Round Config (POST) | `POST` | `/api/v1/admin/competition/:compIdx/round/:roundIdx/config` | 동일 | 위와 동일(메서드 별칭) |
| Update Round Config Alias (PUT) | `PUT` | `/api/v1/admin/competition/:compIdx/round/:roundIdx/configs` | 동일 | 위와 동일(경로 별칭) |
| Update Round Config Alias (POST) | `POST` | `/api/v1/admin/competition/:compIdx/round/:roundIdx/configs` | 동일 | 위와 동일(메서드/경로 별칭) |

## Admin - Assignment
| Name | Method | Path | Body | 설명 |
|---|---|---|---|---|
| Update Player Assignment | `POST` | `/api/v1/admin/competition/:compIdx/player-assignment` | `{ "cckId":"user1", "role":"competition|judge|runner|scrambler", "roundIdx":123, "groups":["A"] }` | 단일 유저 역할 배정 업데이트 |
| Update Player Assignment (Alias plural) | `POST` | `/api/v1/admin/competitions/:compIdx/player-assignment` | 동일 | 위와 동일(별칭) |
| Auto Assign | `POST` | `/api/v1/admin/competition/:compIdx/auto-assign` | 아래 샘플 참고 | 자동 배정 실행 |
| Auto Assign (Alias plural) | `POST` | `/api/v1/admin/competitions/:compIdx/auto-assign` | 동일 | 위와 동일(별칭) |
| Reset All Assignments | `POST` | `/api/v1/admin/competition/:compIdx/reset-assignments` | `{ "confirmCompetitionName": "대회명" }` | 해당 대회의 모든 조편성/배정 초기화 |
| Reset All Assignments (Alias plural) | `POST` | `/api/v1/admin/competitions/:compIdx/reset-assignments` | 동일 | 위와 동일(별칭) |

### Auto Assign Body 샘플
아래 필드들은 호환 입력으로 함께 지원됩니다.

```json
{
  "confirmCompetitionName": "대회명",
  "scramblerCandidateCckIds": ["user1", "user2"],
  "scramblerCckIds": ["user1", "user2"],
  "excludedCckIds": ["user3"],
  "scrambler": {
    "candidateCckIds": ["user1", "user2"]
  },
  "exclusion": {
    "cckIds": ["user3"]
  }
}
```

### 주요 응답 필드
- 공통 실패: `{"message": "...", "upstream": ...}` 형태 사용
- Reset 성공:
  - `data.compIdx`
  - `data.competitionName`
  - `data.roundCount`
  - `data.deletedRows`
  - `data.reset`
- Auto-assign 성공:
  - `data.rounds[]` (라운드별 충족 여부/사유)
  - `data.inserted` (`competition/scrambler/runner/judge`)
  - `data.needsManualAssignment`
  - `data.manualAssignmentRounds[]`
