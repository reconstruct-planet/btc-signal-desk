# BTC 실시간 방향성 리포트

브라우저에서 아래 주소를 열면 됩니다.

```text
http://127.0.0.1:4175/index.html
```

서버가 꺼져 있으면 Codex에 “다시 서버 켜줘”라고 말하면 됩니다. 파일 위치는 아래와 같습니다.

```text
C:\Users\1\Documents\Codex\2026-05-24\vscode-ai\index.html
```

## 들어간 기능

- TradingView Lightweight Charts 기반 실시간 차트
- Binance BTC/USDT 캔들 REST + WebSocket 실시간 반영
- 5분, 15분, 1시간, 4시간, 1일 예측
- 5분 간격 자동 리포트 갱신
- 사용자가 확대/이동한 차트 화면 유지
- 차트 설정을 하단 툴바로 배치해 차트 가로폭 확대
- EMA, Bollinger, VWAP 표시/숨김
- 차트 확대/축소, 드래그 이동, 화면 맞춤
- 수동 가격선 추가
- `현재가 진입 표시` 버튼으로 클릭 순간의 현재 가격을 진입가로 고정하고 지지, 저항, TP, SP/SL 라인 확인
- `추천 시나리오` 버튼으로 선택한 시간봉의 추천 진입 구간, 지지, 저항, TP, SL/SP 라인 확인
- 예측 카드 클릭으로 시간봉 전환과 추천 시나리오 표시 연동
- 추천/현재가 시나리오 모두 과거 유사 패턴 백테스트 기반으로 승률, 기대값, 표본 수 표시
- 자동 진입 구간, 익절, 손절, 지지, 저항 라인 표시
- 단타 시나리오 근거 설명
- 계좌 규모, 리스크 %, 수수료, 슬리피지를 반영한 포지션 크기 계산
- 진입 트리거, 거래량, 손익비, 손절폭, 거래 비용 체크리스트
- 20개 기술 지표 분석
- mempool.space, Blockchain.com 공개 온체인 데이터 반영

## 참고

TradingView Advanced Charts의 전체 툴바, 드로잉 도구, Pine Script 수준 편집 기능은 별도 라이선스가 필요한 영역입니다. 이 버전은 무료 공개 라이브러리인 Lightweight Charts를 사용하고, 지표와 리포트 로직은 직접 구현했습니다.

전체 온체인 데이터 커버리지를 원하면 Glassnode, CryptoQuant, CoinMetrics 같은 데이터 제공자의 API 키를 연결하는 백엔드가 필요합니다.
## Local Preview

If `http://127.0.0.1:4175/index.html` is not opening, start the local server with `start-local-server.cmd` from this folder and then refresh the page.
