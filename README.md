# 🍞 빵친자

빵집 지도 서비스 — 테스트 배포 버전

## 로컬 실행

```bash
npm install
npm run dev
# → http://localhost:3000
```

## Railway 배포 방법

### 1. GitHub에 올리기
```bash
git init
git add .
git commit -m "feat: 빵친자 초기 배포"
git remote add origin https://github.com/YOUR_ID/bbangchincha.git
git push -u origin main
```

### 2. Railway 연결
1. [railway.app](https://railway.app) 로그인
2. **New Project → Deploy from GitHub repo** 선택
3. `bbangchincha` 레포 선택
4. 자동 감지 → Node.js로 배포됨
5. **Settings → Networking → Generate Domain** 클릭하면 URL 발급

### 환경변수 (Railway 대시보드 Variables 탭)
| 키 | 값 |
|---|---|
| PORT | Railway가 자동 주입 (설정 불필요) |
| DATABASE_URL | PostgreSQL 추가 시 입력 |

## 현재 기능
- OSM 기반 지도 (MapLibre GL)
- 빵집 레벨별 마커 (🥖🥐🧁🍞👑)
- 레벨 필터 (빵신/빵달인/빵고수/빵순이/빵린이)
- 빵집 카드 사이드패널
- 마커 클릭 → 팝업 + 지도 이동
- `/api/bakeries` REST API (목 데이터)
- `/health` 헬스체크 엔드포인트

## 다음 단계
- [ ] PostGIS 연동 (실제 공간 쿼리)
- [ ] GeoServer WMS 레이어 연동
- [ ] 카카오/네이버 API 크롤러
- [ ] 사용자 후기 등록 폼
- [ ] 레벨 자동 계산 트리거
