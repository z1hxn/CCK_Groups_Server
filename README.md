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
- `GET /api/groups/competitions/:competitionId/config`
- `PUT /api/groups/competitions/:competitionId/config`
- `GET /api/groups/competitions/:competitionId/assignments`
- `POST /api/groups/competitions/:competitionId/assignments/bulk`
