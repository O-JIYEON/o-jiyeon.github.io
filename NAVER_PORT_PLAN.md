# Naver Port Plan

## Goal

Mapbox 편집 지도 기능을 네이버 지도 위에 최대한 동일한 사용자 경험으로 이식한다.

중요 전제:

- Mapbox 쪽 지도 자체는 현재 회전된 상태다.
- 네이버 지도 JS API v3는 현재 코드가 사용하는 기본 `Map` 기준으로 Mapbox처럼 지도를 자유 회전시키는 API가 없다.
- 따라서 이식 시 "지도 회전"이 아니라 "편집 좌표계/격자/도형/오버레이를 회전된 기준으로 계산"해야 한다.

## Feature Matrix

### Direct Port

- 격자 표시/숨김
- 격자 셀 선택
- 좌표 + 물리번지 팝업
- 지번 생성
- 블록 생성
- 원형 블록 생성
- 이미지 블록 생성
- 이름 수정
- 색상 수정
- 크기 수정
- 목록 선택/포커스
- 도형 삭제
- 상태 패널

### Port With Custom Naver Overlay Logic

- 회전된 기준 격자 좌표계
- 선택 셀 하이라이트
- 텍스트 라벨 마커
- 이미지 블록 렌더링
- 블록 회전 핸들
- 도형 드래그 이동
- 회전된 사각형 도형 편집

### Not 1:1 With Current Naver API

- Mapbox처럼 지도 자체 bearing 회전
- 4점 왜곡 이미지 오버레이를 `GroundOverlay`만으로 구현

## Naver API Mapping

### Native APIs we can use directly

- `naver.maps.Polygon`
- `naver.maps.Polyline`
- `naver.maps.Marker`
- `naver.maps.InfoWindow`
- `naver.maps.Circle`
- `naver.maps.GroundOverlay` for axis-aligned image overlays only

### APIs that require custom wrapper logic

- `naver.maps.OverlayView`
  - HTML 기반 이미지 블록
  - 회전 핸들
  - 픽셀 위치 동기화

## Implementation Order

### Phase 1: Shared Geometry and Rotated Grid Basis

- Mapbox 회전 기준값(`DEFAULT_GRID_ROTATION`, `DEFAULT_GRID_OFFSET_Y`, `DEFAULT_CENTER`)을 네이버 이식용 기준 좌표계로 복사
- 네이버 페이지에서 내부적으로 회전된 격자 좌표계를 다시 사용
- UI에는 회전 슬라이더를 노출하지 않음
- 셀 선택/물리번지를 회전 기준으로 다시 계산

### Phase 2: Read-Only Overlay Parity

- 회전된 격자 셀 하이라이트
- 고정 라벨 표시
- 지번/블록 목록 패널 렌더
- 도면 이미지의 read-only 렌더

### Phase 3: Create/Edit Overlays

- polygon / circle / rectangle / imageBlock 생성
- 이름/색상/크기 편집
- 삭제
- 선택 후 포커스 이동

### Phase 4: Advanced Interaction

- 도형 드래그 이동
- 회전된 rectangle 유지 편집
- 이미지 블록 썸네일 교체
- 회전 핸들

### Phase 5: Custom Overlay Replacement

- `GroundOverlay` 한계 때문에 4점 왜곡 도면/이미지 블록을 `OverlayView` 기반으로 교체

## Recommended First Shipping Scope

실제 배포 기준 1차는 아래까지만 권장:

- 회전 기준 격자
- 셀 선택 + 물리번지
- 지번 생성
- 원/사각형/이미지 블록 생성
- 이름/색상/크기 수정
- 삭제
- 목록 포커스

아래는 2차:

- 도형 드래그 이동
- 이미지 블록 자유 회전
- 왜곡 오버레이

## Current Gap Summary

Current Naver page:

- grid
- base map type
- gps track
- origin reset

Missing from Mapbox:

- rotated grid basis
- right-side measure panel
- parcel/block creation
- selection state
- editable overlays
- block image workflow
- overlay labels
- drag/rotate editing
