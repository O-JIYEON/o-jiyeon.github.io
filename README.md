# EchoTech Grid Demo

React + Vite + Mapbox GL JS 기반의 지도 데모입니다.

## 실행

Node.js 18+가 먼저 필요합니다.

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:8082` 으로 접속합니다.

## 환경 변수

지도 페이지는 프로젝트 루트 `.env` 파일의 아래 값을 사용합니다.

```env
VITE_MAPBOX_ACCESS_TOKEN=your_mapbox_access_token_here
```

`.env.example`를 복사해서 `.env`를 만든 뒤 개발 서버를 다시 시작하세요.

## GitHub Pages 배포

이 프로젝트는 소스(`src/main.jsx`)를 직접 서빙하면 안 되고, 반드시 빌드 결과물(`dist`)을 배포해야 합니다.
이미 `.github/workflows/deploy-pages.yml`이 포함되어 있어 `main` 브랜치 푸시 시 자동 배포됩니다.

수동 확인:

```bash
npm install
npm run build
```

그 후 `dist` 폴더가 생성되어야 정상입니다.

## 포함 기능

- Mapbox GL JS 기반 회전 가능한 지도 페이지
- 가로/세로 셀 크기 조정
- 격자 표시 토글
- 현재 중심을 격자 원점으로 재설정
- 원래 기준 좌표로 복귀
- 격자 자체 회전

## 메모

- Mapbox 페이지는 `VITE_MAPBOX_ACCESS_TOKEN` 환경 변수가 있어야 동작합니다.
- 격자 간격은 위경도 변환 근사값을 사용하므로 넓은 영역에서는 실제 거리와 약간 차이가 날 수 있습니다.
