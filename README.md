# EchoTech Grid Demo

React + Vite + 네이버 지도 JS API 기반의 커스텀 격자 레이어 데모입니다.

## 실행

Node.js 18+가 먼저 필요합니다.

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:8082` 으로 접속합니다.

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

- 네이버 지도 위 미터 단위 커스텀 격자 레이어
- 가로/세로 셀 크기 조정
- 격자 표시 토글
- 네이버 기본 지도 타입 전환
- 현재 중심을 격자 원점으로 재설정
- 원래 기준 좌표로 복귀
- 격자 자체 회전

## 메모

- 사용자 제공 키(`s31twgmyf4`)로 네이버 지도 SDK를 동적 로드합니다.
- 격자 간격은 위경도 변환 근사값을 사용하므로 넓은 영역에서는 실제 거리와 약간 차이가 날 수 있습니다.
- 네이버 기본 2D 지도는 자유 회전이 제한적일 수 있어 현재 슬라이더는 격자 회전에 적용됩니다.
- NCP 콘솔 웹 서비스 URL에 `http://localhost:8082`, `http://127.0.0.1:8082` 등록이 필요합니다.
- 배포한 GitHub Pages URL도 NCP 콘솔 웹 서비스 URL 허용 목록에 추가해야 지도가 표시됩니다.
