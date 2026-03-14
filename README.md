# CCK Groups Server

Groups 전용 API 서버입니다.

- 대회/라운드 조회: Ranking API 프록시
- 그룹 설정/배정 저장: MySQL

## Run

```bash
cp .env.local.example .env.local
npm install
npm run dev
```

## API

- `GET /api/health`
- `GET /api/competitions?status=now|future|past`
- `GET /api/competitions/:competitionId`
- `GET /api/competitions/:competitionId/rounds/day/:dayCount`
- `POST /api/auth/token?code=...`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/info`
- `GET /api/auth/info/:cckId`
- `GET /api/v1/competition/:compIdx/player/:cckId`
- `GET /api/v1/round/:roundIdx`
- `POST /api/v1/admin/competition/:compIdx/player-assignment`
- `POST /api/v1/admin/competition/:compIdx/auto-assign`
- `POST /api/v1/admin/competition/:compIdx/reset-assignments`

## Assignment Role Keys

- 저장 테이블: `group_assignment`
- DB `role`(현행): `competitor | judge | runner | scrambler`
- API 응답 키: `competitor | judge | runner | scrambler`
- `player-assignment` 입력 `role`: `competitor | judge | runner | scrambler`
- CCK ID 처리: 요청/저장/응답 모두 대문자(`UPPERCASE`)로 정규화
