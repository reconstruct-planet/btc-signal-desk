const INTERVALS = [
  { key: "5m", label: "5분", limit: 1000 },
  { key: "15m", label: "15분", limit: 1000 },
  { key: "1h", label: "1시간", limit: 1000 },
  { key: "4h", label: "4시간", limit: 1000 },
  { key: "1d", label: "1일", limit: 1000 },
];

const REPORT_MS = 5 * 60 * 1000;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const VALIDATION_INTERVAL_MAP = {
  "5m": "1h",
  "15m": "1h",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
};
const BOT_DESK_STORAGE_KEY = "btc-signal-bot-desk-v1";
const BOT_SNAPSHOT_VERSION = 2;
const BOT_LEARNING_MIN_TRADES = 4;
const BOT_RECENT_WINDOW = 18;
const RECOMMENDATION_MIN_SAMPLE = 24;
const RECOMMENDATION_STRONG_SAMPLE = 36;
const RECOMMENDATION_BOT_MIN_MATCHES = 5;

const state = {
  interval: "5m",
  candlesByInterval: {},
  validationCandlesByInterval: {},
  analyses: {},
  onchain: null,
  ws: null,
  chart: null,
  series: {},
  manualLines: [],
  autoLines: [],
  chartHasInitialFit: false,
  levelsVisible: false,
  scenarioMode: "none",
  selectedScenarioIndex: 0,
  entrySnapshot: null,
  reportDueAt: Date.now() + REPORT_MS,
  botDesk: {
    settings: {
      capital: 10000,
      leverage: 5,
    },
    bots: [],
    running: false,
    seeded: false,
    activeHistoryBotId: null,
  },
  risk: {
    accountSize: 10000,
    riskPct: 1,
    feePct: 0.08,
    slippagePct: 0.03,
  },
  overlays: {
    ema20: true,
    ema50: true,
    ema200: false,
    bb: true,
    vwap: true,
  },
};

const els = {
  refreshBtn: document.querySelector("#refreshBtn"),
  timeframeBtns: [...document.querySelectorAll(".timeframe")],
  overlayToggles: [...document.querySelectorAll(".overlay-toggle")],
  signalBadge: document.querySelector("#signalBadge"),
  updatedAt: document.querySelector("#updatedAt"),
  signalText: document.querySelector("#signalText"),
  scoreText: document.querySelector("#scoreText"),
  meterFill: document.querySelector("#meterFill"),
  signalReason: document.querySelector("#signalReason"),
  priceText: document.querySelector("#priceText"),
  changeText: document.querySelector("#changeText"),
  kpiEntryText: document.querySelector("#kpiEntryText"),
  kpiTp1Text: document.querySelector("#kpiTp1Text"),
  kpiStopText: document.querySelector("#kpiStopText"),
  kpiSupportText: document.querySelector("#kpiSupportText"),
  kpiResistanceText: document.querySelector("#kpiResistanceText"),
  activeIntervalText: document.querySelector("#activeIntervalText"),
  nextReportText: document.querySelector("#nextReportText"),
  rangeText: document.querySelector("#rangeText"),
  chart: document.querySelector("#chart"),
  fitBtn: document.querySelector("#fitBtn"),
  showLevelsBtn: document.querySelector("#showLevelsBtn"),
  recommendScenarioBtn: document.querySelector("#recommendScenarioBtn"),
  priceLineInput: document.querySelector("#priceLineInput"),
  addLineBtn: document.querySelector("#addLineBtn"),
  predictionGrid: document.querySelector("#predictionGrid"),
  reportText: document.querySelector("#reportText"),
  onchainGrid: document.querySelector("#onchainGrid"),
  indicatorList: document.querySelector("#indicatorList"),
  tradeSideBadge: document.querySelector("#tradeSideBadge"),
  tradeSummary: document.querySelector("#tradeSummary"),
  scenarioButtons: document.querySelector("#scenarioButtons"),
  tradeEvidenceList: document.querySelector("#tradeEvidenceList"),
  tradePlanList: document.querySelector("#tradePlanList"),
  executionChecklist: document.querySelector("#executionChecklist"),
  botDeskSummary: document.querySelector("#botDeskSummary"),
  botCapitalInput: document.querySelector("#botCapitalInput"),
  botLeverageInput: document.querySelector("#botLeverageInput"),
  botStartBtn: document.querySelector("#botStartBtn"),
  botPauseBtn: document.querySelector("#botPauseBtn"),
  botResetBtn: document.querySelector("#botResetBtn"),
  botExportBtn: document.querySelector("#botExportBtn"),
  botImportBtn: document.querySelector("#botImportBtn"),
  botImportInput: document.querySelector("#botImportInput"),
  botGrid: document.querySelector("#botGrid"),
  botHistoryPanel: document.querySelector("#botHistoryPanel"),
  resistanceText: document.querySelector("#resistanceText"),
  supportText: document.querySelector("#supportText"),
  atrText: document.querySelector("#atrText"),
};

const fmtUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const fmt = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 2,
});

const fmtInt = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 0,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pct(current, base) {
  return base ? ((current - base) / base) * 100 : 0;
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function last(values) {
  return values[values.length - 1];
}

function rollingExtreme(values, period, mode) {
  return values.map((_, index) => {
    if (index + 1 < period) return null;
    const slice = values.slice(index + 1 - period, index + 1);
    return mode === "high" ? Math.max(...slice) : Math.min(...slice);
  });
}

function getIndicator(analysis, name) {
  return analysis.indicators.find((item) => item.name === name);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchCandles(interval, limit = 1000) {
  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
  const data = await fetchJson(url);

  return data.map((row) => ({
    time: Math.floor(row[0] / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

function intervalToMs(intervalKey) {
  const map = {
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
  };
  return map[intervalKey] || map["1h"];
}

function validationIntervalFor(intervalKey) {
  return VALIDATION_INTERVAL_MAP[intervalKey] || "1h";
}

async function fetchCandlesWindow(interval, { startTime, endTime, limit = 1000 } = {}) {
  const params = new URLSearchParams({
    symbol: "BTCUSDT",
    interval,
    limit: String(limit),
  });
  if (Number.isFinite(startTime)) params.set("startTime", String(Math.floor(startTime)));
  if (Number.isFinite(endTime)) params.set("endTime", String(Math.floor(endTime)));
  const data = await fetchJson(`https://api.binance.com/api/v3/klines?${params.toString()}`);
  return data.map((row) => ({
    time: Math.floor(row[0] / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}

async function fetchYearCandles(intervalKey) {
  const intervalMs = intervalToMs(intervalKey);
  const end = Date.now();
  const start = end - ONE_YEAR_MS;
  const unique = new Map();
  let cursor = start;

  while (cursor < end) {
    const batch = await fetchCandlesWindow(intervalKey, { startTime: cursor, endTime: end, limit: 1000 });
    if (!batch.length) break;
    batch.forEach((candle) => unique.set(candle.time, candle));
    const lastTime = batch[batch.length - 1].time * 1000;
    const nextCursor = lastTime + intervalMs;
    if (nextCursor <= cursor) break;
    cursor = nextCursor;
    if (batch.length < 1000) break;
  }

  return [...unique.values()].filter((candle) => candle.time * 1000 >= start && candle.time * 1000 <= end).sort((a, b) => a.time - b.time);
}

function buildBacktestMetrics(candles) {
  const closes = candles.map((candle) => candle.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const volumes = candles.map((candle) => candle.volume);
  const bands = bollinger(closes);
  return {
    closes,
    highs,
    lows,
    volumes,
    ema20: emaSeries(closes, 20),
    ema50: emaSeries(closes, 50),
    rsi: rsiSeries(closes, 14),
    macdHist: macdValues(closes).hist,
    vwap: vwapSeries(candles),
    atr: atrSeries(candles, 14),
    volumeSma: sma(volumes, 20),
    bbWidth: bands.middle.map((middle, index) => (
      Number.isFinite(middle) && middle !== 0
        ? ((bands.upper[index] - bands.lower[index]) / middle) * 100
        : null
    )),
    donchianHigh: rollingExtreme(highs, 20, "high"),
    donchianLow: rollingExtreme(lows, 20, "low"),
  };
}

async function fetchOnchain() {
  const requests = await Promise.allSettled([
    fetchJson("https://mempool.space/api/mempool"),
    fetchJson("https://mempool.space/api/v1/fees/recommended"),
    fetchJson("https://mempool.space/api/v1/difficulty-adjustment"),
    fetchJson("https://api.blockchain.info/charts/hash-rate?timespan=30days&format=json"),
    fetchJson("https://api.blockchain.info/charts/n-transactions?timespan=30days&format=json"),
    fetchJson("https://api.blockchain.info/charts/miners-revenue?timespan=30days&format=json"),
  ]);

  const value = (index) => (requests[index].status === "fulfilled" ? requests[index].value : null);
  return {
    mempool: value(0),
    fees: value(1),
    difficulty: value(2),
    hashRate: value(3),
    transactions: value(4),
    minerRevenue: value(5),
    partial: requests.some((result) => result.status === "rejected"),
  };
}

function sma(values, period) {
  return values.map((_, index) => {
    if (index + 1 < period) return null;
    return average(values.slice(index + 1 - period, index + 1));
  });
}

function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const result = [];
  values.forEach((value, index) => {
    result.push(index === 0 ? value : value * k + result[index - 1] * (1 - k));
  });
  return result;
}

function rsiSeries(values, period = 14) {
  const result = Array(values.length).fill(null);
  for (let i = period; i < values.length; i += 1) {
    let gains = 0;
    let losses = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const diff = values[j] - values[j - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    result[i] = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
  }
  return result;
}

function macdValues(values) {
  const fast = emaSeries(values, 12);
  const slow = emaSeries(values, 26);
  const line = values.map((_, index) => fast[index] - slow[index]);
  const signal = emaSeries(line, 9);
  const hist = line.map((value, index) => value - signal[index]);
  return { line, signal, hist };
}

function atrSeries(candles, period = 14) {
  const trs = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  return sma(trs, period);
}

function bollinger(values, period = 20, mult = 2) {
  const middle = sma(values, period);
  const upper = [];
  const lower = [];
  values.forEach((_, index) => {
    if (index + 1 < period) {
      upper.push(null);
      lower.push(null);
      return;
    }
    const slice = values.slice(index + 1 - period, index + 1);
    const mean = middle[index];
    const variance = average(slice.map((value) => (value - mean) ** 2));
    const sd = Math.sqrt(variance);
    upper.push(mean + sd * mult);
    lower.push(mean - sd * mult);
  });
  return { middle, upper, lower };
}

function stochasticRsi(values) {
  const rsi = rsiSeries(values, 14);
  return rsi.map((value, index) => {
    if (index < 28 || value === null) return null;
    const slice = rsi.slice(index - 13, index + 1).filter((item) => item !== null);
    const min = Math.min(...slice);
    const max = Math.max(...slice);
    return max === min ? 50 : ((value - min) / (max - min)) * 100;
  });
}

function adx(candles, period = 14) {
  const plusDm = [0];
  const minusDm = [0];
  const tr = [candles[0].high - candles[0].low];

  for (let i = 1; i < candles.length; i += 1) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    ));
  }

  const plusDi = plusDm.map((_, index) => {
    if (index + 1 < period) return null;
    return (average(plusDm.slice(index + 1 - period, index + 1)) / average(tr.slice(index + 1 - period, index + 1))) * 100;
  });
  const minusDi = minusDm.map((_, index) => {
    if (index + 1 < period) return null;
    return (average(minusDm.slice(index + 1 - period, index + 1)) / average(tr.slice(index + 1 - period, index + 1))) * 100;
  });
  const dx = plusDi.map((plus, index) => {
    const minus = minusDi[index];
    if (plus === null || minus === null || plus + minus === 0) return null;
    return (Math.abs(plus - minus) / (plus + minus)) * 100;
  });

  return {
    adx: average(dx.slice(-period).filter((value) => value !== null)),
    plusDi: last(plusDi.filter((value) => value !== null)),
    minusDi: last(minusDi.filter((value) => value !== null)),
  };
}

function cci(candles, period = 20) {
  const typical = candles.map((candle) => (candle.high + candle.low + candle.close) / 3);
  const values = typical.map((value, index) => {
    if (index + 1 < period) return null;
    const slice = typical.slice(index + 1 - period, index + 1);
    const mean = average(slice);
    const meanDeviation = average(slice.map((item) => Math.abs(item - mean)));
    return meanDeviation === 0 ? 0 : (value - mean) / (0.015 * meanDeviation);
  });
  return last(values.filter((value) => value !== null));
}

function obv(candles) {
  const values = [0];
  for (let i = 1; i < candles.length; i += 1) {
    const direction = candles[i].close > candles[i - 1].close ? 1 : candles[i].close < candles[i - 1].close ? -1 : 0;
    values.push(values[i - 1] + candles[i].volume * direction);
  }
  return values;
}

function mfi(candles, period = 14) {
  let positive = 0;
  let negative = 0;
  for (let i = candles.length - period; i < candles.length; i += 1) {
    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    const prevTp = (candles[i - 1].high + candles[i - 1].low + candles[i - 1].close) / 3;
    const flow = tp * candles[i].volume;
    if (tp >= prevTp) positive += flow;
    else negative += flow;
  }
  return negative === 0 ? 100 : 100 - 100 / (1 + positive / negative);
}

function vwapSeries(candles) {
  let pv = 0;
  let volume = 0;
  return candles.map((candle) => {
    const typical = (candle.high + candle.low + candle.close) / 3;
    pv += typical * candle.volume;
    volume += candle.volume;
    return volume === 0 ? candle.close : pv / volume;
  });
}

function supertrendDirection(candles, period = 10, multiplier = 3) {
  const atr = atrSeries(candles, period);
  const candle = last(candles);
  const currentAtr = last(atr.filter((value) => value !== null));
  const hl2 = (candle.high + candle.low) / 2;
  const upper = hl2 + multiplier * currentAtr;
  const lower = hl2 - multiplier * currentAtr;
  const previous = candles[candles.length - 2];
  if (candle.close > upper || candle.close > previous.close) return 1;
  if (candle.close < lower || candle.close < previous.close) return -1;
  return 0;
}

function backtestConfig(intervalKey, mode) {
  const recommended = {
    "5m": { lookahead: 24, fillWindow: 5 },
    "15m": { lookahead: 20, fillWindow: 4 },
    "1h": { lookahead: 16, fillWindow: 3 },
    "4h": { lookahead: 12, fillWindow: 3 },
    "1d": { lookahead: 8, fillWindow: 2 },
  };
  const current = {
    "5m": { lookahead: 18, fillWindow: 0 },
    "15m": { lookahead: 16, fillWindow: 0 },
    "1h": { lookahead: 12, fillWindow: 0 },
    "4h": { lookahead: 9, fillWindow: 0 },
    "1d": { lookahead: 6, fillWindow: 0 },
  };
  return (mode === "recommended" ? recommended : current)[intervalKey] || { lookahead: 12, fillWindow: 0 };
}

function rangeQuality(value, idealLow, idealHigh, outerLow, outerHigh) {
  if (!Number.isFinite(value)) return 0.5;
  if (value >= idealLow && value <= idealHigh) return 1;
  if (value < idealLow) return clamp((value - outerLow) / Math.max(idealLow - outerLow, 0.0001), 0, 1);
  return clamp((outerHigh - value) / Math.max(outerHigh - idealHigh, 0.0001), 0, 1);
}

function wilsonLowerBound(wins, trades, z = 1.28) {
  if (!trades) return 0;
  const p = wins / trades;
  const denominator = 1 + (z ** 2) / trades;
  const centre = p + (z ** 2) / (2 * trades);
  const margin = z * Math.sqrt((p * (1 - p) + (z ** 2) / (4 * trades)) / trades);
  return clamp((centre - margin) / denominator, 0, 1);
}

function setupQualityScore(side, index, metrics, mode) {
  const close = metrics.closes[index];
  const ema20 = metrics.ema20[index];
  const ema50 = metrics.ema50[index];
  const rsi = metrics.rsi[index];
  const macdHist = metrics.macdHist[index];
  const prevMacdHist = metrics.macdHist[index - 1];
  const vwap = metrics.vwap[index];
  const atr = metrics.atr[index];
  const volume = metrics.volumes?.[index];
  const volumeAvg = metrics.volumeSma?.[index];
  const bbWidth = metrics.bbWidth?.[index];
  const donchianHigh = metrics.donchianHigh?.[index];
  const donchianLow = metrics.donchianLow?.[index];

  if (![close, ema20, ema50, rsi, macdHist, vwap, atr].every(Number.isFinite)) {
    return { pass: false, score: 0 };
  }

  const volumeRatio = Number.isFinite(volume) && Number.isFinite(volumeAvg) && volumeAvg > 0 ? volume / volumeAvg : 1;
  const atrPct = (atr / close) * 100;
  const emaGapPct = Math.abs(ema20 - ema50) / close * 100;
  const ema20DistancePct = Math.abs(close - ema20) / close * 100;
  const vwapDistancePct = Math.abs(close - vwap) / close * 100;
  const donchianPos = Number.isFinite(donchianHigh) && Number.isFinite(donchianLow) && donchianHigh !== donchianLow
    ? ((close - donchianLow) / (donchianHigh - donchianLow)) * 100
    : 50;

  const trendAligned = side === "long"
    ? close >= ema20 && ema20 >= ema50
    : close <= ema20 && ema20 <= ema50;
  const softTrendAligned = side === "long" ? close >= ema50 : close <= ema50;
  const momentumAligned = side === "long"
    ? macdHist >= 0 || macdHist >= (Number.isFinite(prevMacdHist) ? prevMacdHist : macdHist)
    : macdHist <= 0 || macdHist <= (Number.isFinite(prevMacdHist) ? prevMacdHist : macdHist);
  const vwapAligned = side === "long" ? close >= vwap : close <= vwap;

  const trendScore = trendAligned ? 1 : softTrendAligned ? 0.58 : 0.18;
  const momentumScore = momentumAligned ? 1 : 0.28;
  const rsiScore = side === "long"
    ? rangeQuality(rsi, 52, 66, 45, 75)
    : rangeQuality(rsi, 34, 48, 25, 55);
  const volumeScore = clamp((volumeRatio - 0.72) / 0.78, 0, 1);
  const extensionScore = 1 - clamp((Math.max(ema20DistancePct, vwapDistancePct * 0.45) - 0.08) / 1.2, 0, 1);
  const volatilityScore = rangeQuality(atrPct, 0.08, 4.8, 0.02, 8.5);
  const bandScore = rangeQuality(bbWidth, 0.35, 9, 0.08, 18);
  const donchianScore = side === "long"
    ? rangeQuality(donchianPos, 42, 86, 22, 96)
    : rangeQuality(donchianPos, 14, 58, 4, 78);
  const structureScore = (vwapAligned ? 0.62 : 0.34) + clamp(emaGapPct / 1.1, 0, 0.38);

  const score =
    trendScore * 0.2 +
    momentumScore * 0.16 +
    rsiScore * 0.16 +
    volumeScore * 0.1 +
    extensionScore * 0.13 +
    volatilityScore * 0.09 +
    bandScore * 0.06 +
    donchianScore * 0.06 +
    structureScore * 0.04;
  const threshold = mode === "recommended" ? 0.58 : 0.5;
  return { pass: score >= threshold, score };
}

function signalMatchesSide(side, index, metrics, mode) {
  return setupQualityScore(side, index, metrics, mode).pass;
}

function simulateTradeOutcome(candles, side, entry, stop, target, startIndex, lookaheadBars) {
  const risk = Math.abs(entry - stop);
  if (!Number.isFinite(risk) || risk <= 0) return null;
  const endIndex = Math.min(candles.length - 1, startIndex + lookaheadBars);
  let maxAdverseR = 0;

  for (let i = startIndex + 1; i <= endIndex; i += 1) {
    const bar = candles[i];
    const adverseR = side === "long"
      ? Math.max(0, (entry - bar.low) / risk)
      : Math.max(0, (bar.high - entry) / risk);
    maxAdverseR = Math.max(maxAdverseR, adverseR);

    if (side === "long") {
      const hitStop = bar.low <= stop;
      const hitTarget = bar.high >= target;
      if (hitStop && hitTarget) return { result: "loss", rMultiple: -1, barsHeld: i - startIndex, ambiguous: true, maxAdverseR };
      if (hitStop) return { result: "loss", rMultiple: -1, barsHeld: i - startIndex, maxAdverseR };
      if (hitTarget) return { result: "win", rMultiple: (target - entry) / risk, barsHeld: i - startIndex, maxAdverseR };
    } else {
      const hitStop = bar.high >= stop;
      const hitTarget = bar.low <= target;
      if (hitStop && hitTarget) return { result: "loss", rMultiple: -1, barsHeld: i - startIndex, ambiguous: true, maxAdverseR };
      if (hitStop) return { result: "loss", rMultiple: -1, barsHeld: i - startIndex, maxAdverseR };
      if (hitTarget) return { result: "win", rMultiple: (entry - target) / risk, barsHeld: i - startIndex, maxAdverseR };
    }
  }

  const exit = candles[endIndex].close;
  const rMultiple = side === "long" ? (exit - entry) / risk : (entry - exit) / risk;
  return {
    result: rMultiple >= 0 ? "timeout-win" : "timeout-loss",
    rMultiple,
    barsHeld: endIndex - startIndex,
    maxAdverseR,
  };
}

function buildHistoricalEdge({ candles, intervalKey, side, mode, metrics }) {
  const { lookahead, fillWindow } = backtestConfig(intervalKey, mode);
  const stopGrid = mode === "recommended" ? [0.8, 0.95, 1.1, 1.25] : [0.85, 1.0, 1.15];
  const rrGrid = mode === "recommended" ? [1.05, 1.25, 1.55, 1.9] : [0.9, 1.1, 1.35];
  const entryOffsets = mode === "recommended" ? [0, 0.08, 0.16] : [0];
  let best = null;
  const candidates = [];

  for (const stopAtr of stopGrid) {
    for (const rr of rrGrid) {
      for (const entryOffsetAtr of entryOffsets) {
        let trades = 0;
        let wins = 0;
        let grossProfitR = 0;
        let grossLossR = 0;
        let totalR = 0;
        let totalBars = 0;
        let totalSetupQuality = 0;
        let totalAdverseR = 0;
        let worstAdverseR = 0;

        for (let i = 80; i < candles.length - lookahead - 1; i += 1) {
          const setup = setupQualityScore(side, i, metrics, mode);
          if (!setup.pass) continue;
          const atr = metrics.atr[i];
          const close = metrics.closes[i];
          if (!Number.isFinite(atr) || !Number.isFinite(close)) continue;

          const proposedEntry = side === "long" ? close - atr * entryOffsetAtr : close + atr * entryOffsetAtr;
          let entryIndex = i;

          if (entryOffsetAtr > 0) {
            let filled = false;
            for (let j = i + 1; j <= Math.min(candles.length - 1, i + fillWindow); j += 1) {
              if ((side === "long" && candles[j].low <= proposedEntry) || (side === "short" && candles[j].high >= proposedEntry)) {
                entryIndex = j;
                filled = true;
                break;
              }
            }
            if (!filled) continue;
          }

          const stop = side === "long" ? proposedEntry - atr * stopAtr : proposedEntry + atr * stopAtr;
          const target = side === "long" ? proposedEntry + atr * stopAtr * rr : proposedEntry - atr * stopAtr * rr;
          const outcome = simulateTradeOutcome(candles, side, proposedEntry, stop, target, entryIndex, lookahead);
          if (!outcome) continue;

          trades += 1;
          totalSetupQuality += setup.score;
          totalR += outcome.rMultiple;
          totalBars += outcome.barsHeld;
          totalAdverseR += outcome.maxAdverseR || 0;
          worstAdverseR = Math.max(worstAdverseR, outcome.maxAdverseR || 0);
          if (outcome.rMultiple > 0) {
            wins += 1;
            grossProfitR += outcome.rMultiple;
          } else {
            grossLossR += Math.abs(outcome.rMultiple);
          }
        }

        if (!trades) continue;
        const winRate = (wins / trades) * 100;
        const expectancyR = totalR / trades;
        const profitFactor = grossLossR > 0 ? grossProfitR / grossLossR : grossProfitR;
        const avgSetupQuality = totalSetupQuality / trades;
        const winLowerBound = wilsonLowerBound(wins, trades);
        const avgAdverseR = totalAdverseR / trades;
        const sampleFactor = trades >= 60 ? 1 : trades >= 30 ? 0.94 : trades >= 18 ? 0.82 : 0.64;
        const winRateScore = clamp((winRate - 48) / 18, 0, 1);
        const winSafetyScore = clamp(((winLowerBound * 100) - 44) / 18, 0, 1);
        const expectancyScore = clamp((expectancyR + 0.04) / 0.62, 0, 1);
        const profitFactorScore = clamp((profitFactor - 0.95) / 1.35, 0, 1);
        const adverseScore = 1 - clamp((avgAdverseR - 0.34) / 0.72, 0, 1);
        const holdingPenalty = totalBars / trades > lookahead * 0.82 ? 0.9 : 1;
        const edgePenalty = expectancyR <= 0 || profitFactor < 1.05 ? 0.36 : winRate < 52 ? 0.66 : 1;
        const score = (
          winRateScore * 0.31 +
          winSafetyScore * 0.25 +
          profitFactorScore * 0.17 +
          expectancyScore * 0.14 +
          adverseScore * 0.08 +
          avgSetupQuality * 0.05
        ) * sampleFactor * holdingPenalty * edgePenalty;
        const candidate = {
          mode,
          side,
          stopAtr,
          rr,
          entryOffsetAtr,
          lookaheadBars: lookahead,
          trades,
          wins,
          losses: trades - wins,
          winRate,
          winLowerBound: winLowerBound * 100,
          expectancyR,
          profitFactor,
          avgBarsHeld: totalBars / trades,
          avgSetupQuality,
          avgAdverseR,
          maxAdverseR: worstAdverseR,
          score,
          quality: trades >= 24 ? "strong" : trades >= 14 ? "moderate" : "weak",
        };
        candidates.push(candidate);

        if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.winRate > best.winRate)) {
          best = candidate;
        }
      }
    }
  }

  const fallback = {
    mode,
    side,
    stopAtr: mode === "recommended" ? 1.15 : 1.05,
    rr: mode === "recommended" ? 1.8 : 1.6,
    entryOffsetAtr: mode === "recommended" ? 0.15 : 0,
    lookaheadBars: lookahead,
    trades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    winLowerBound: 0,
    expectancyR: 0,
    profitFactor: 0,
    avgBarsHeld: 0,
    avgSetupQuality: 0,
    avgAdverseR: 0,
    maxAdverseR: 0,
    score: 0,
    quality: "weak",
  };
  const sortedCandidates = candidates.sort((a, b) => b.score - a.score || b.winRate - a.winRate);
  return {
    best: best || fallback,
    candidates: sortedCandidates.slice(0, 3).length ? sortedCandidates.slice(0, 3) : [fallback],
  };
}

function entryWidthProfile(intervalKey) {
  const map = {
    "5m": { widthAtr: 0.045, maxPct: 0.0018, lowerWindowAtr: 0.22, upperWindowAtr: 0.22 },
    "15m": { widthAtr: 0.055, maxPct: 0.0026, lowerWindowAtr: 0.28, upperWindowAtr: 0.28 },
    "1h": { widthAtr: 0.07, maxPct: 0.0038, lowerWindowAtr: 0.36, upperWindowAtr: 0.36 },
    "4h": { widthAtr: 0.09, maxPct: 0.0055, lowerWindowAtr: 0.5, upperWindowAtr: 0.5 },
    "1d": { widthAtr: 0.11, maxPct: 0.0075, lowerWindowAtr: 0.65, upperWindowAtr: 0.65 },
  };
  return map[intervalKey] || map["1h"];
}

function buildEntryConfluence({ side, price, support, resistance, atr, ema20, ema50, vwap, bbMiddle, intervalKey }) {
  const profile = entryWidthProfile(intervalKey);
  const upperBound = price + atr * 0.9;
  const lowerBound = price - atr * 0.9;
  const candidates = side === "long"
    ? [
        { label: "support", price: support },
        { label: "ema20", price: ema20 },
        { label: "ema50", price: ema50 },
        { label: "vwap", price: vwap },
        { label: "bbMiddle", price: bbMiddle },
      ].filter((item) => Number.isFinite(item.price) && item.price <= price && item.price >= lowerBound)
    : [
        { label: "resistance", price: resistance },
        { label: "ema20", price: ema20 },
        { label: "ema50", price: ema50 },
        { label: "vwap", price: vwap },
        { label: "bbMiddle", price: bbMiddle },
      ].filter((item) => Number.isFinite(item.price) && item.price >= price && item.price <= upperBound);

  const fallback = { label: side === "long" ? "support" : "resistance", price: side === "long" ? support : resistance };
  const selectedBase = candidates.length ? candidates : [fallback];
  const maxCandidates = intervalKey === "5m" ? 1 : intervalKey === "15m" ? 2 : 3;
  const selected = selectedBase
    .map((item) => ({ ...item, distance: Math.abs(price - item.price) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxCandidates);
  const weighted = selected.reduce((sum, item) => sum + item.price * (1 / Math.max(item.distance + atr * 0.01, atr * 0.03)), 0);
  const weightTotal = selected.reduce((sum, item) => sum + (1 / Math.max(item.distance + atr * 0.01, atr * 0.03)), 0);
  const rawAnchor = weightTotal > 0 ? weighted / weightTotal : average(selected.map((item) => item.price));
  const anchor = side === "long"
    ? clamp(rawAnchor, price - atr * profile.lowerWindowAtr, price)
    : clamp(rawAnchor, price, price + atr * profile.upperWindowAtr);
  return { anchor, labels: selected.map((item) => item.label) };
}

function entryRangePolicy(intervalKey) {
  const map = {
    "5m": { idealMinPct: 0.12, idealMaxPct: 0.25, hardMaxPct: 0.32 },
    "15m": { idealMinPct: 0.18, idealMaxPct: 0.35, hardMaxPct: 0.44 },
    "1h": { idealMinPct: 0.25, idealMaxPct: 0.52, hardMaxPct: 0.68 },
    "4h": { idealMinPct: 0.32, idealMaxPct: 0.78, hardMaxPct: 0.96 },
    "1d": { idealMinPct: 0.45, idealMaxPct: 1.05, hardMaxPct: 1.28 },
  };
  return map[intervalKey] || map["1h"];
}

function entryRangePct(plan, price) {
  if (!plan || !price) return 0;
  return Math.abs((plan.entryHigh || 0) - (plan.entryLow || 0)) / price * 100;
}

function normalizeEntryRange(plan, { price, atr, intervalKey, support, resistance }) {
  if (!plan || plan.isCurrentEntry || !Number.isFinite(price) || price <= 0) return plan;
  const policy = entryRangePolicy(intervalKey);
  const hardWidth = price * (policy.hardMaxPct / 100);
  const atrFloor = Math.max((atr || price * 0.003) * 0.035, price * 0.00018);
  const maxWidth = Math.max(atrFloor, hardWidth);
  const originalLow = Number(plan.entryLow);
  const originalHigh = Number(plan.entryHigh);
  if (!Number.isFinite(originalLow) || !Number.isFinite(originalHigh)) return plan;

  let low = Math.min(originalLow, originalHigh);
  let high = Math.max(originalLow, originalHigh);
  const currentWidth = high - low;

  if (currentWidth > maxWidth) {
    if (plan.side === "long") {
      high = Math.min(high, price);
      low = high - maxWidth;
    } else if (plan.side === "short") {
      low = Math.max(low, price);
      high = low + maxWidth;
    } else {
      const center = clamp((low + high) / 2, support || low, resistance || high);
      low = center - maxWidth / 2;
      high = center + maxWidth / 2;
    }
  }

  if (plan.side === "long") {
    low = Math.max(Number.isFinite(support) ? support : low, low);
    high = Math.min(price, Math.max(high, low));
  } else if (plan.side === "short") {
    high = Math.min(Number.isFinite(resistance) ? resistance : high, high);
    low = Math.max(price, Math.min(low, high));
  }

  const normalized = {
    ...plan,
    entryLow: low,
    entryHigh: Math.max(high, low),
  };
  normalized.entryRangePct = entryRangePct(normalized, price);
  normalized.entryRangeStatus = normalized.entryRangePct > policy.idealMaxPct
    ? "Wide entry range / wait for confirmation"
    : normalized.entryRangePct < policy.idealMinPct
      ? "Tight tactical entry"
      : "Controlled entry range";
  normalized.entryRangeWide = normalized.entryRangePct > policy.idealMaxPct;
  normalized.entryRangePolicy = policy;
  return normalized;
}

function finalizeTradePlan(plan, context) {
  const normalized = normalizeEntryRange(plan, context);
  const validation = normalized.validationBacktest || normalized.backtest || {};
  const formulaScore = Number.isFinite(normalized.formulaScore)
    ? normalized.formulaScore
    : scenarioFormulaScore({
        edge: normalized.backtest,
        validationEdge: validation,
        side: normalized.side,
        bias: context.bias,
        technicalScore: context.score,
      });
  return {
    ...normalized,
    formulaScore,
  };
}

function buildTradePlan({
  price,
  score,
  bias,
  support,
  resistance,
  atr,
  previous,
  ema20,
  ema50,
  vwap,
  bbMiddle,
  historicalEdge,
  validationEdge,
  validationPass,
  validationIntervalKey,
  intervalKey,
  localSupport,
  localResistance,
}) {
  const atrValue = Math.max(atr || price * 0.006, price * 0.002);
  const momentum = price >= previous ? 1 : -1;
  const side = bias === "bearish" ? "short" : bias === "neutral" && momentum < 0 ? "short" : "long";
  const edge = historicalEdge || { stopAtr: 1.15, rr: 1.8, entryOffsetAtr: 0.15, trades: 0, winRate: 0, expectancyR: 0 };
  const profile = entryWidthProfile(intervalKey);
  const activeSupport = Number.isFinite(localSupport) ? Math.max(support, localSupport) : support;
  const activeResistance = Number.isFinite(localResistance) ? Math.min(resistance, localResistance) : resistance;
  const confluence = buildEntryConfluence({
    side,
    price,
    support: activeSupport,
    resistance: activeResistance,
    atr: atrValue,
    ema20,
    ema50,
    vwap,
    bbMiddle,
    intervalKey,
  });

  if (side === "long" && bias !== "neutral") {
    const entryCenter = Math.min(price, confluence.anchor);
    const zoneWidth = Math.min(
      Math.max(atrValue * profile.widthAtr, atrValue * edge.entryOffsetAtr * 0.18),
      price * profile.maxPct,
    );
    const entryLow = Math.max(activeSupport, entryCenter - zoneWidth * 0.9);
    const entryHigh = Math.min(price, Math.max(entryLow + atrValue * 0.02, entryCenter + zoneWidth * 0.22));
    const stopLoss = Math.min(activeSupport - atrValue * 0.04, entryLow - atrValue * Math.max(edge.stopAtr, 0.9));
    const riskUnit = Math.max(entryHigh - stopLoss, atrValue * edge.stopAtr);
    const takeProfit1 = Math.max(activeResistance, entryHigh + riskUnit * Math.min(1, edge.rr * 0.72));
    const takeProfit2 = entryHigh + riskUnit * edge.rr;
    const takeProfit3 = entryHigh + riskUnit * Math.max(edge.rr + 0.8, edge.rr * 1.35);
    return {
      side: "long",
      title: "롱 우선",
      summary: "추세 유지 구간에서 지지/EMA/VWAP 겹침을 기다리는 추천 시나리오",
      entryLow,
      entryHigh,
      stopLoss,
      takeProfit1,
      takeProfit2,
      takeProfit3,
      invalidation: stopLoss,
      rr: (takeProfit2 - entryHigh) / Math.max(entryHigh - stopLoss, 1),
      confluence,
      backtest: edge,
      validationBacktest: validationEdge || edge,
      validationPass: Boolean(validationPass),
      validationIntervalKey: validationIntervalKey || validationIntervalFor(intervalKey),
    };
  }

  if (side === "short" && bias !== "neutral") {
    const entryCenter = Math.max(price, confluence.anchor);
    const zoneWidth = Math.min(
      Math.max(atrValue * profile.widthAtr, atrValue * edge.entryOffsetAtr * 0.18),
      price * profile.maxPct,
    );
    const entryHigh = Math.min(activeResistance, entryCenter + zoneWidth * 0.9);
    const entryLow = Math.max(price, Math.min(entryHigh - atrValue * 0.02, entryCenter - zoneWidth * 0.22));
    const stopLoss = Math.max(activeResistance + atrValue * 0.04, entryHigh + atrValue * Math.max(edge.stopAtr, 0.9));
    const riskUnit = Math.max(stopLoss - entryLow, atrValue * edge.stopAtr);
    const takeProfit1 = Math.min(activeSupport, entryLow - riskUnit * Math.min(1, edge.rr * 0.72));
    const takeProfit2 = entryLow - riskUnit * edge.rr;
    const takeProfit3 = entryLow - riskUnit * Math.max(edge.rr + 0.8, edge.rr * 1.35);
    return {
      side: "short",
      title: "숏 우선",
      summary: "약세 추세에서 저항/EMA/VWAP 되돌림을 기다리는 추천 시나리오",
      entryLow,
      entryHigh,
      stopLoss,
      takeProfit1,
      takeProfit2,
      takeProfit3,
      invalidation: stopLoss,
      rr: (entryLow - takeProfit2) / Math.max(stopLoss - entryLow, 1),
      confluence,
      backtest: edge,
      validationBacktest: validationEdge || edge,
      validationPass: Boolean(validationPass),
      validationIntervalKey: validationIntervalKey || validationIntervalFor(intervalKey),
    };
  }

  const breakoutLong = resistance + atrValue * 0.18;
  const breakdownShort = support - atrValue * 0.18;
  const leanLong = score >= 50 || momentum > 0;
  const riskUnit = atrValue * Math.max(edge.stopAtr, 1);
  const rangeSpan = Math.min(
    Math.max(atrValue * profile.widthAtr * 1.4, atrValue * 0.08),
    Math.max((resistance - support) * 0.25, atrValue * 0.08),
    price * profile.maxPct,
  );
  const entryLow = leanLong
    ? Math.max(support, support + rangeSpan * 0.05)
    : Math.max(support, resistance - rangeSpan);
  const entryHigh = leanLong
    ? Math.min(resistance, support + rangeSpan)
    : Math.min(resistance, resistance - rangeSpan * 0.05);
  return {
    side: "range",
    title: "돌파 대기",
    summary: "박스권에서는 상단 돌파나 하단 이탈 확인 이후에만 추격하는 보수적 시나리오",
    entryLow,
    entryHigh,
    breakoutLong,
    breakdownShort,
    stopLoss: leanLong ? support - atrValue * 0.35 : resistance + atrValue * 0.35,
    takeProfit1: leanLong ? Math.max(resistance, breakoutLong + riskUnit * 0.7) : Math.min(support, breakdownShort - riskUnit * 0.7),
    takeProfit2: leanLong ? breakoutLong + riskUnit * edge.rr : breakdownShort - riskUnit * edge.rr,
    takeProfit3: leanLong ? breakoutLong + riskUnit * Math.max(edge.rr + 0.8, edge.rr * 1.35) : breakdownShort - riskUnit * Math.max(edge.rr + 0.8, edge.rr * 1.35),
    invalidation: leanLong ? support - atrValue * 0.35 : resistance + atrValue * 0.35,
    rr: 0,
    confluence,
    backtest: edge,
    validationBacktest: validationEdge || edge,
    validationPass: Boolean(validationPass),
    validationIntervalKey: validationIntervalKey || validationIntervalFor(intervalKey),
  };
}

function buildTradePlan({
  price,
  score,
  bias,
  support,
  resistance,
  atr,
  previous,
  ema20,
  ema50,
  vwap,
  bbMiddle,
  historicalEdge,
  validationEdge,
  validationPass,
  validationIntervalKey,
  intervalKey,
  localSupport,
  localResistance,
}) {
  const atrValue = Math.max(atr || price * 0.006, price * 0.002);
  const momentum = price >= previous ? 1 : -1;
  const side = bias === "bearish" ? "short" : bias === "neutral" && momentum < 0 ? "short" : "long";
  const edge = historicalEdge || { stopAtr: 1.15, rr: 1.25, entryOffsetAtr: 0.08, trades: 0, winRate: 0, expectancyR: 0, profitFactor: 0 };
  const activeSupport = Number.isFinite(localSupport) ? Math.max(support, localSupport) : support;
  const activeResistance = Number.isFinite(localResistance) ? Math.min(resistance, localResistance) : resistance;
  const confluence = buildEntryConfluence({
    side,
    price,
    support: activeSupport,
    resistance: activeResistance,
    atr: atrValue,
    ema20,
    ema50,
    vwap,
    bbMiddle,
    intervalKey,
  });
  const context = { price, atr: atrValue, intervalKey, support: activeSupport, resistance: activeResistance, bias, score };

  if (side === "long" && bias !== "neutral") {
    const entryCenter = Math.min(price, confluence.anchor);
    const pullback = Math.max(atrValue * Math.min(edge.entryOffsetAtr || 0.08, 0.14), atrValue * 0.035);
    const entryHigh = Math.min(price, entryCenter + pullback * 0.32);
    const entryLow = Math.max(activeSupport, entryHigh - Math.max(pullback, atrValue * 0.055));
    const stopLoss = Math.min(activeSupport - atrValue * 0.06, entryLow - atrValue * Math.max(edge.stopAtr || 1, 0.9));
    const riskUnit = Math.max(entryHigh - stopLoss, atrValue * Math.max(edge.stopAtr || 1, 0.9));
    const rr = clamp(edge.rr || 1.25, 0.95, 1.75);
    return finalizeTradePlan({
      side: "long",
      title: "High-probability long",
      summary: "Waits for a controlled pullback into support, EMA, or VWAP confluence before a simulated long setup.",
      entryLow,
      entryHigh,
      stopLoss,
      takeProfit1: entryHigh + riskUnit * Math.min(0.95, rr * 0.7),
      takeProfit2: entryHigh + riskUnit * rr,
      takeProfit3: entryHigh + riskUnit * Math.max(rr + 0.55, rr * 1.28),
      invalidation: stopLoss,
      rr,
      confluence,
      backtest: edge,
      validationBacktest: validationEdge || edge,
      validationPass: Boolean(validationPass),
      validationIntervalKey: validationIntervalKey || validationIntervalFor(intervalKey),
    }, context);
  }

  if (side === "short" && bias !== "neutral") {
    const entryCenter = Math.max(price, confluence.anchor);
    const pullback = Math.max(atrValue * Math.min(edge.entryOffsetAtr || 0.08, 0.14), atrValue * 0.035);
    const entryLow = Math.max(price, entryCenter - pullback * 0.32);
    const entryHigh = Math.min(activeResistance, entryLow + Math.max(pullback, atrValue * 0.055));
    const stopLoss = Math.max(activeResistance + atrValue * 0.06, entryHigh + atrValue * Math.max(edge.stopAtr || 1, 0.9));
    const riskUnit = Math.max(stopLoss - entryLow, atrValue * Math.max(edge.stopAtr || 1, 0.9));
    const rr = clamp(edge.rr || 1.25, 0.95, 1.75);
    return finalizeTradePlan({
      side: "short",
      title: "High-probability short",
      summary: "Waits for a controlled rejection near resistance, EMA, or VWAP confluence before a simulated short setup.",
      entryLow,
      entryHigh,
      stopLoss,
      takeProfit1: entryLow - riskUnit * Math.min(0.95, rr * 0.7),
      takeProfit2: entryLow - riskUnit * rr,
      takeProfit3: entryLow - riskUnit * Math.max(rr + 0.55, rr * 1.28),
      invalidation: stopLoss,
      rr,
      confluence,
      backtest: edge,
      validationBacktest: validationEdge || edge,
      validationPass: Boolean(validationPass),
      validationIntervalKey: validationIntervalKey || validationIntervalFor(intervalKey),
    }, context);
  }

  const leanLong = score >= 50 || momentum > 0;
  const rangeCenter = leanLong
    ? Math.min(price, activeSupport + (activeResistance - activeSupport) * 0.28)
    : Math.max(price, activeResistance - (activeResistance - activeSupport) * 0.28);
  const rangeWidth = Math.max(atrValue * 0.08, price * 0.0012);
  const entryLow = rangeCenter - rangeWidth / 2;
  const entryHigh = rangeCenter + rangeWidth / 2;
  const riskUnit = atrValue * Math.max(edge.stopAtr || 1, 1);
  return finalizeTradePlan({
    side: leanLong ? "long" : "short",
    title: "Wait-first range setup",
    summary: "Market structure is mixed; this scenario is treated as a wait-first simulation until a cleaner edge appears.",
    entryLow,
    entryHigh,
    breakoutLong: resistance + atrValue * 0.18,
    breakdownShort: support - atrValue * 0.18,
    stopLoss: leanLong ? activeSupport - atrValue * 0.35 : activeResistance + atrValue * 0.35,
    takeProfit1: leanLong ? entryHigh + riskUnit * 0.8 : entryLow - riskUnit * 0.8,
    takeProfit2: leanLong ? entryHigh + riskUnit * 1.15 : entryLow - riskUnit * 1.15,
    takeProfit3: leanLong ? entryHigh + riskUnit * 1.55 : entryLow - riskUnit * 1.55,
    invalidation: leanLong ? activeSupport - atrValue * 0.35 : activeResistance + atrValue * 0.35,
    rr: 1.15,
    confluence,
    backtest: edge,
    validationBacktest: validationEdge || edge,
    validationPass: Boolean(validationPass),
    validationIntervalKey: validationIntervalKey || validationIntervalFor(intervalKey),
  }, context);
}

function buildCurrentEntryPlan(analysis, historicalEdge, validationEdge, formulaScore) {
  const entry = analysis.price;
  const atrValue = Math.max(analysis.atr || entry * 0.006, entry * 0.002);
  const side = analysis.bias === "bearish" ? "short" : "long";
  const edge = historicalEdge || { stopAtr: 1.05, rr: 1.6, trades: 0, winRate: 0, expectancyR: 0 };
  const validation = validationEdge || edge;
  const successScore = Number.isFinite(formulaScore)
    ? formulaScore
    : scenarioFormulaScore({ edge, validationEdge: validation, side, bias: analysis.bias, technicalScore: analysis.score || 50 });

  if (side === "short") {
    const stopLoss = Math.max(entry + atrValue * edge.stopAtr, analysis.resistance + atrValue * 0.08);
    const riskUnit = Math.max(stopLoss - entry, atrValue * edge.stopAtr);
    const takeProfit1 = Math.min(analysis.support, entry - riskUnit * Math.min(1, edge.rr * 0.72));
    const takeProfit2 = entry - riskUnit * edge.rr;
    const takeProfit3 = entry - riskUnit * Math.max(edge.rr + 0.8, edge.rr * 1.35);
    return {
      side: "short",
      title: "현재가 숏 진입",
      summary: "실시간 현재가를 기준으로 즉시 숏 진입했을 때의 보수적 리스크/리워드 시나리오",
      entryLow: entry,
      entryHigh: entry,
      stopLoss,
      takeProfit1,
      takeProfit2,
      takeProfit3,
      invalidation: stopLoss,
      rr: (entry - takeProfit2) / Math.max(stopLoss - entry, 1),
      isCurrentEntry: true,
      backtest: edge,
      validationBacktest: validation,
      validationPass: validationPasses(validation),
      validationIntervalKey: analysis.validationSummary?.intervalKey || validationIntervalFor(state.interval),
      formulaScore: successScore,
    };
  }

  const stopLoss = Math.min(entry - atrValue * edge.stopAtr, analysis.support - atrValue * 0.08);
  const riskUnit = Math.max(entry - stopLoss, atrValue * edge.stopAtr);
  const takeProfit1 = Math.max(analysis.resistance, entry + riskUnit * Math.min(1, edge.rr * 0.72));
  const takeProfit2 = entry + riskUnit * edge.rr;
  const takeProfit3 = entry + riskUnit * Math.max(edge.rr + 0.8, edge.rr * 1.35);
  return {
    side: "long",
    title: "현재가 롱 진입",
    summary: "실시간 현재가를 기준으로 즉시 롱 진입했을 때의 보수적 리스크/리워드 시나리오",
    entryLow: entry,
    entryHigh: entry,
    stopLoss,
    takeProfit1,
    takeProfit2,
    takeProfit3,
    invalidation: stopLoss,
    rr: (takeProfit2 - entry) / Math.max(entry - stopLoss, 1),
    isCurrentEntry: true,
    backtest: edge,
    validationBacktest: validation,
    validationPass: validationPasses(validation),
    validationIntervalKey: analysis.validationSummary?.intervalKey || validationIntervalFor(state.interval),
    formulaScore: successScore,
  };
}

function buildCurrentEntryPlan(analysis, historicalEdge, validationEdge, formulaScore) {
  const entry = analysis.price;
  const atrValue = Math.max(analysis.atr || entry * 0.006, entry * 0.002);
  const side = analysis.bias === "bearish" ? "short" : "long";
  const edge = historicalEdge || { stopAtr: 1.05, rr: 1.25, trades: 0, winRate: 0, expectancyR: 0, profitFactor: 0 };
  const validation = validationEdge || edge;
  const rr = clamp(edge.rr || 1.25, 0.95, 1.7);
  const successScore = Number.isFinite(formulaScore)
    ? formulaScore
    : scenarioFormulaScore({ edge, validationEdge: validation, side, bias: analysis.bias, technicalScore: analysis.score || 50 });

  if (side === "short") {
    const stopLoss = Math.max(entry + atrValue * Math.max(edge.stopAtr || 1, 0.9), analysis.resistance + atrValue * 0.08);
    const riskUnit = Math.max(stopLoss - entry, atrValue * Math.max(edge.stopAtr || 1, 0.9));
    return {
      side: "short",
      title: "Current-price short lock",
      summary: "Uses the current price as the simulated short entry and keeps the chart levels fixed while live candles update.",
      entryLow: entry,
      entryHigh: entry,
      stopLoss,
      takeProfit1: entry - riskUnit * Math.min(0.95, rr * 0.7),
      takeProfit2: entry - riskUnit * rr,
      takeProfit3: entry - riskUnit * Math.max(rr + 0.55, rr * 1.28),
      invalidation: stopLoss,
      rr,
      isCurrentEntry: true,
      backtest: edge,
      validationBacktest: validation,
      validationPass: validationPasses(validation),
      validationIntervalKey: analysis.validationSummary?.intervalKey || validationIntervalFor(state.interval),
      formulaScore: successScore,
    };
  }

  const stopLoss = Math.min(entry - atrValue * Math.max(edge.stopAtr || 1, 0.9), analysis.support - atrValue * 0.08);
  const riskUnit = Math.max(entry - stopLoss, atrValue * Math.max(edge.stopAtr || 1, 0.9));
  return {
    side: "long",
    title: "Current-price long lock",
    summary: "Uses the current price as the simulated long entry and keeps the chart levels fixed while live candles update.",
    entryLow: entry,
    entryHigh: entry,
    stopLoss,
    takeProfit1: entry + riskUnit * Math.min(0.95, rr * 0.7),
    takeProfit2: entry + riskUnit * rr,
    takeProfit3: entry + riskUnit * Math.max(rr + 0.55, rr * 1.28),
    invalidation: stopLoss,
    rr,
    isCurrentEntry: true,
    backtest: edge,
    validationBacktest: validation,
    validationPass: validationPasses(validation),
    validationIntervalKey: analysis.validationSummary?.intervalKey || validationIntervalFor(state.interval),
    formulaScore: successScore,
  };
}

function validationPasses(edge) {
  return Boolean(
    edge &&
    edge.trades >= 24 &&
    edge.winRate >= 55 &&
    (edge.winLowerBound || 0) >= 47 &&
    edge.expectancyR > 0.03 &&
    edge.profitFactor >= 1.1 &&
    (edge.avgAdverseR || 0) <= 0.9
  );
}

function matchValidationEdge(edge, validationCandidates) {
  if (!validationCandidates?.length) return edge;
  return [...validationCandidates].sort((a, b) => {
    const distanceA =
      Math.abs((a.stopAtr ?? 0) - (edge.stopAtr ?? 0)) * 1.2 +
      Math.abs((a.rr ?? 0) - (edge.rr ?? 0)) +
      Math.abs((a.entryOffsetAtr ?? 0) - (edge.entryOffsetAtr ?? 0)) * 0.8;
    const distanceB =
      Math.abs((b.stopAtr ?? 0) - (edge.stopAtr ?? 0)) * 1.2 +
      Math.abs((b.rr ?? 0) - (edge.rr ?? 0)) +
      Math.abs((b.entryOffsetAtr ?? 0) - (edge.entryOffsetAtr ?? 0)) * 0.8;
    return distanceA - distanceB || (b.score ?? 0) - (a.score ?? 0);
  })[0];
}

function scenarioFormulaScore({ edge, validationEdge, side, bias, technicalScore }) {
  const validation = validationEdge || edge;
  const setupScore = average([
    edge?.avgSetupQuality ?? 0,
    validation?.avgSetupQuality ?? edge?.avgSetupQuality ?? 0,
  ]);
  const sampleScore = clamp(((validation?.trades ?? 0) - 16) / 56, 0.18, 1);
  const winRateScore = clamp(((validation?.winRate ?? 0) - 48) / 20, 0, 1);
  const winSafety = clamp(((validation?.winLowerBound ?? 0) - 43) / 20, 0, 1);
  const profitFactorScore = clamp(((validation?.profitFactor ?? 0) - 0.95) / 1.25, 0, 1);
  const expectancyScore = clamp(((validation?.expectancyR ?? 0) + 0.03) / 0.62, 0, 1);
  const adverseScore = 1 - clamp(((validation?.avgAdverseR ?? 0.55) - 0.35) / 0.8, 0, 1);
  const directionAligned =
    bias === "neutral" ||
    (bias === "bullish" && side === "long") ||
    (bias === "bearish" && side === "short");
  const directionFactor = directionAligned ? 1 : technicalScore > 45 && technicalScore < 55 ? 0.93 : 0.82;
  const edgeFactor = (validation?.expectancyR ?? 0) > 0 && (validation?.profitFactor ?? 0) >= 1.05 ? 1 : 0.48;
  const score =
    winRateScore * 0.25 +
    winSafety * 0.2 +
    profitFactorScore * 0.16 +
    expectancyScore * 0.13 +
    sampleScore * 0.12 +
    adverseScore * 0.08 +
    setupScore * 0.06;
  return clamp(score * directionFactor * edgeFactor * 100, 0, 100);
}

function buildScenarioPlans({
  price,
  score,
  bias,
  support,
  resistance,
  localSupport,
  localResistance,
  atr,
  previous,
  ema20,
  ema50,
  vwap,
  bbMiddle,
  intervalKey,
  historicalEdges,
  validationEdges,
  validationIntervalKey,
}) {
  const trendSide = bias === "bearish" ? "short" : "long";
  const sourcePack = trendSide === "short" ? historicalEdges.recommendedShort : historicalEdges.recommendedLong;
  const validationPack = trendSide === "short" ? validationEdges.recommendedShort : validationEdges.recommendedLong;
  const sourceCandidates = sourcePack?.candidates || [sourcePack?.best].filter(Boolean);
  const validationCandidates = validationPack?.candidates || [validationPack?.best].filter(Boolean);

  return sourceCandidates.slice(0, 3).map((edge, index) => {
    const validationEdge = validationCandidates[index] || validationCandidates[0] || edge;
    const validationPass = validationEdge.trades >= 24 && validationEdge.winRate >= 52 && validationEdge.expectancyR > 0;
    const plan = buildTradePlan({
      price,
      score,
      bias,
      support,
      resistance,
      localSupport,
      localResistance,
      atr,
      previous,
      ema20,
      ema50,
      vwap,
      bbMiddle,
      historicalEdge: edge,
      validationEdge,
      validationPass,
      validationIntervalKey,
      intervalKey,
    });

    return {
      ...plan,
      scenarioIndex: index,
      scenarioId: `scenario-${index}`,
      scenarioLabel: `시나리오 ${index + 1}`,
      scenarioName: index === 0 ? "기본" : index === 1 ? "보수" : "공격",
      scenarioHint: `${fmt.format(plan.validationBacktest?.winRate ?? 0)}% · ${fmt.format(plan.validationBacktest?.expectancyR ?? 0)}R`,
    };
  });
}

function buildScenarioPlansV2({
  price,
  score,
  bias,
  support,
  resistance,
  localSupport,
  localResistance,
  atr,
  previous,
  ema20,
  ema50,
  vwap,
  bbMiddle,
  intervalKey,
  historicalEdges,
  validationEdges,
  validationIntervalKey,
}) {
  const pools = [
    { side: "long", sourcePack: historicalEdges.recommendedLong, validationPack: validationEdges.recommendedLong },
    { side: "short", sourcePack: historicalEdges.recommendedShort, validationPack: validationEdges.recommendedShort },
  ];
  const plans = [];

  pools.forEach(({ side, sourcePack, validationPack }) => {
    const sourceCandidates = sourcePack?.candidates || [sourcePack?.best].filter(Boolean);
    const validationCandidates = validationPack?.candidates || [validationPack?.best].filter(Boolean);

    sourceCandidates.slice(0, 3).forEach((edge, candidateIndex) => {
      const validationEdge = matchValidationEdge(edge, validationCandidates);
      const validationPass = validationPasses(validationEdge);
      const formulaScore = scenarioFormulaScore({ edge, validationEdge, side, bias, technicalScore: score });
      const scenarioBias = side === "short" ? "bearish" : "bullish";
      const scenarioScore = formulaScore + (validationPass ? 4 : 0) + (edge.expectancyR > 0 ? 2 : 0);
      const plan = buildTradePlan({
        price,
        score,
        bias: scenarioBias,
        support,
        resistance,
        localSupport,
        localResistance,
        atr,
        previous,
        ema20,
        ema50,
        vwap,
        bbMiddle,
        historicalEdge: edge,
        validationEdge,
        validationPass,
        validationIntervalKey,
        intervalKey,
      });

      plans.push({
        ...plan,
        scenarioSourceIndex: candidateIndex,
        scenarioScore,
        formulaScore,
        validationPass,
        backtest: edge,
        validationBacktest: validationEdge || edge,
        scenarioDirection: side,
      });
    });
  });

  return plans
    .sort((a, b) => b.scenarioScore - a.scenarioScore || (b.validationBacktest?.expectancyR ?? 0) - (a.validationBacktest?.expectancyR ?? 0))
    .slice(0, 3)
    .map((plan, index) => {
      const directionName = plan.side === "short" ? "Short" : "Long";
      const validation = plan.validationBacktest || plan.backtest || {};
      return {
        ...plan,
        scenarioIndex: index,
        scenarioId: `scenario-${index}-${plan.side}`,
        scenarioLabel: `Plan ${index + 1}`,
        scenarioName: index === 0 ? `Best ${directionName}` : index === 1 ? `Alt ${directionName}` : `Fast ${directionName}`,
        scenarioHint: `Score ${Math.round(plan.formulaScore ?? 0)}/100 - 1Y ${fmt.format(validation.winRate ?? 0)}% - ${fmt.format(validation.expectancyR ?? 0)}R`,
      };
    });
}

function sideSign(side) {
  return side === "short" ? -1 : 1;
}

function technicalSideBias(analysis, side) {
  if (!analysis) return 0;
  const tech = analysis.technicals || {};
  let score = 0;
  let total = 0;

  const add = (condition, weight = 1) => {
    total += weight;
    score += condition ? weight : 0;
  };

  add(side === "long" ? analysis.score >= 56 : analysis.score <= 44, 1.2);
  add(side === "long" ? tech.ema20 >= tech.ema50 && tech.ema50 >= tech.ema200 : tech.ema20 <= tech.ema50 && tech.ema50 <= tech.ema200, 1.1);
  add(side === "long" ? analysis.price >= tech.vwap : analysis.price <= tech.vwap, 0.9);
  add(side === "long" ? tech.macdHist >= 0 : tech.macdHist <= 0, 0.9);
  add(side === "long" ? tech.plusDi >= tech.minusDi : tech.minusDi >= tech.plusDi, 0.9);
  add((tech.adx || 0) >= 16, 0.6);
  add(side === "long" ? tech.rsi >= 44 && tech.rsi <= 68 : tech.rsi >= 32 && tech.rsi <= 56, 0.8);
  add((tech.volumeRatio || 0) >= 0.82, 0.5);

  return total ? clamp(((score / total) - 0.5) * 2, -1, 1) : 0;
}

function multiTimeframeAlignment(side) {
  const weights = { "5m": 0.18, "15m": 0.22, "1h": 0.32, "4h": 0.28 };
  let alignedWeight = 0;
  let totalWeight = 0;
  const aligned = [];
  const conflicts = [];

  Object.entries(weights).forEach(([intervalKey, weight]) => {
    const analysis = state.analyses[intervalKey];
    if (!analysis) return;
    totalWeight += weight;
    const bias = technicalSideBias(analysis, side);
    if (bias > 0.18) {
      alignedWeight += weight;
      aligned.push(intervalKey);
    } else if (bias < -0.18) {
      conflicts.push(intervalKey);
    }
  });

  const ratio = totalWeight ? alignedWeight / totalWeight : 0.5;
  return {
    ratio,
    score: ratio * 100,
    aligned,
    conflicts,
    label: `${aligned.length}/${aligned.length + conflicts.length || 1} frames aligned`,
  };
}

function scenarioFeatureKeys(plan, analysis, chain) {
  const entry = tradeEntryReference(plan);
  const snapshot = buildTradeSnapshot({
    bot: { id: "top-recommendation", name: "Top recommendation", strategy: "winrate", allocation: 0 },
    analysis: { ...analysis, chain },
    plan,
    entry,
    reason: "top-recommendation-preview",
  });
  return tradeFeatureKeysFromSnapshot(snapshot);
}

function recommendationBotAdjustment(plan, analysis, chain) {
  const keys = new Set(scenarioFeatureKeys(plan, analysis, chain));
  const matched = [];
  (state.botDesk?.bots || []).forEach((bot) => {
    (bot.history || []).map(normalizeBotTradeRecord).forEach((trade) => {
      const tradeKeys = tradeFeatureKeysFromSnapshot(trade.snapshot);
      if (tradeKeys.some((key) => keys.has(key))) matched.push(trade);
    });
  });

  if (matched.length < RECOMMENDATION_BOT_MIN_MATCHES) {
    return { adjustment: 0, matches: matched.length, winRate: 0, avgR: 0, note: "Bot record sample is still too small for top recommendation adjustment." };
  }

  const wins = matched.filter((trade) => trade.pnl >= 0).length;
  const avgR = matched.reduce((sum, trade) => sum + (Number(trade.rMultiple) || 0), 0) / matched.length;
  const stopRate = matched.filter((trade) => trade.exitReason === "stop").length / matched.length * 100;
  const targetRate = matched.filter((trade) => trade.exitReason === "target").length / matched.length * 100;
  const winRate = (wins / matched.length) * 100;
  const adjustment = clamp((winRate - 50) * 0.12 + avgR * 9 + (targetRate - stopRate) * 0.035, -12, 10);
  return {
    adjustment,
    matches: matched.length,
    winRate,
    avgR,
    stopRate,
    targetRate,
    note: `Bot pattern sample ${fmtInt.format(matched.length)} / win ${fmt.format(winRate)}% / avg ${fmt.format(avgR)}R`,
  };
}

function buildRecommendationChecks(plan, analysis, chain) {
  const tech = analysis.technicals || {};
  const side = plan.side === "short" ? "short" : "long";
  const isLong = side === "long";
  const validation = plan.validationBacktest || plan.backtest || {};
  const backtest = plan.backtest || validation;
  const entry = tradeEntryReference(plan);
  const stopDistancePct = entry > 0 ? Math.abs(entry - plan.stopLoss) / entry * 100 : 0;
  const rr = plan.rr || 0;
  const rangePct = entryRangePct(plan, analysis.price);
  const policy = entryRangePolicy(state.interval);
  const levelDistance = isLong ? analysis.resistanceGap : analysis.supportGap;
  const onchainDirectional = isLong ? chain.score : 100 - chain.score;
  const mtf = multiTimeframeAlignment(side);

  return {
    validation,
    backtest,
    side,
    entry,
    rangePct,
    policy,
    mtf,
    bot: recommendationBotAdjustment(plan, analysis, chain),
    checks: {
      sample: (validation.trades || 0) >= RECOMMENDATION_MIN_SAMPLE,
      strongSample: (validation.trades || 0) >= RECOMMENDATION_STRONG_SAMPLE,
      winRate: (validation.winRate || 0) >= 55,
      winLower: (validation.winLowerBound || 0) >= 47,
      expectancy: (validation.expectancyR || 0) > 0.03,
      profitFactor: (validation.profitFactor || 0) >= 1.1,
      adverse: (validation.avgAdverseR || 0.55) <= 0.9,
      ema: isLong ? tech.ema20 >= tech.ema50 && tech.ema50 >= tech.ema200 : tech.ema20 <= tech.ema50 && tech.ema50 <= tech.ema200,
      vwap: isLong ? analysis.price >= tech.vwap : analysis.price <= tech.vwap,
      macd: isLong ? tech.macdHist >= 0 : tech.macdHist <= 0,
      adx: (tech.adx || 0) >= 16 && (isLong ? tech.plusDi >= tech.minusDi : tech.minusDi >= tech.plusDi),
      rsi: isLong ? tech.rsi >= 44 && tech.rsi <= 68 : tech.rsi >= 32 && tech.rsi <= 56,
      volatility: (tech.atrPct || 0) >= 0.05 && (tech.atrPct || 0) <= (state.interval === "5m" ? 1.35 : state.interval === "15m" ? 1.65 : 2.4),
      volume: (tech.volumeRatio || 0) >= 0.82,
      levelRoom: Number.isFinite(levelDistance) && levelDistance >= Math.max(stopDistancePct * 0.7, 0.18),
      range: rangePct <= policy.idealMaxPct,
      rr: rr >= 0.95 && rr <= 1.9,
      mtf: mtf.ratio >= 0.52,
      onchain: onchainDirectional >= 42,
    },
  };
}

function recommendationScoreFromChecks(plan, analysis, chain) {
  const built = buildRecommendationChecks(plan, analysis, chain);
  const { checks, validation, backtest, mtf, bot, rangePct, policy } = built;
  const weightedChecks = [
    ["sample", 8], ["winRate", 13], ["winLower", 8], ["expectancy", 8], ["profitFactor", 9], ["adverse", 5],
    ["ema", 7], ["vwap", 5], ["macd", 5], ["adx", 5], ["rsi", 5], ["volatility", 5], ["volume", 4],
    ["levelRoom", 4], ["range", 4], ["rr", 3], ["mtf", 8], ["onchain", 2],
  ];
  const checkScore = weightedChecks.reduce((sum, [key, weight]) => sum + (checks[key] ? weight : 0), 0);
  const maxCheckScore = weightedChecks.reduce((sum, [, weight]) => sum + weight, 0);
  const currentScore = maxCheckScore ? (checkScore / maxCheckScore) * 100 : 50;
  const validationScore =
    clamp(((validation.winRate || 0) - 45) / 20, 0, 1) * 30 +
    clamp(((validation.winLowerBound || 0) - 40) / 20, 0, 1) * 18 +
    clamp(((validation.profitFactor || 0) - 0.95) / 1.25, 0, 1) * 16 +
    clamp(((validation.expectancyR || 0) + 0.03) / 0.62, 0, 1) * 14 +
    clamp(((validation.trades || 0) - 12) / 56, 0, 1) * 12 +
    (1 - clamp(((validation.avgAdverseR || 0.55) - 0.35) / 0.8, 0, 1)) * 10;
  const similarScore =
    clamp(((backtest.winRate || 0) - 45) / 18, 0, 1) * 40 +
    clamp(((backtest.expectancyR || 0) + 0.03) / 0.6, 0, 1) * 25 +
    clamp(((backtest.profitFactor || 0) - 0.95) / 1.2, 0, 1) * 20 +
    clamp(((backtest.trades || 0) - 8) / 36, 0, 1) * 15;
  const rangePenalty = rangePct > policy.hardMaxPct ? 12 : rangePct > policy.idealMaxPct ? 5 : 0;
  const conflictPenalty = mtf.conflicts.length >= 2 ? 8 : mtf.conflicts.length === 1 ? 3 : 0;
  const thinPenalty = (validation.trades || 0) < RECOMMENDATION_MIN_SAMPLE ? 12 : 0;
  const rawScore = validationScore * 0.42 + currentScore * 0.27 + similarScore * 0.12 + mtf.score * 0.12 + bot.adjustment + (chain.score - 50) * (plan.side === "long" ? 0.04 : -0.02);
  const recommendationScore = clamp(rawScore - rangePenalty - conflictPenalty - thinPenalty, 0, 100);
  const estimatedWinRate = clamp(
    (validation.winRate || 0) * 0.6 +
    (backtest.winRate || validation.winRate || 0) * 0.2 +
    (currentScore - 50) * 0.08 +
    (mtf.score - 50) * 0.06 +
    bot.adjustment * 0.1,
    35,
    72,
  );
  const hardGate =
    checks.sample &&
    checks.winRate &&
    checks.expectancy &&
    checks.profitFactor &&
    checks.mtf &&
    checks.range &&
    currentScore >= 56;

  let grade = "C";
  if (hardGate && recommendationScore >= 84 && estimatedWinRate >= 58 && checks.strongSample && checks.winLower) grade = "A+";
  else if (hardGate && recommendationScore >= 72 && estimatedWinRate >= 55) grade = "A";
  else if (recommendationScore >= 58 && (validation.trades || 0) >= 12) grade = "B";

  const reasons = [];
  if (checks.winRate) reasons.push(`1Y validation win rate ${fmt.format(validation.winRate)}%`);
  if (checks.profitFactor) reasons.push(`Profit factor ${fmt.format(validation.profitFactor)} with positive expectancy`);
  if (checks.mtf) reasons.push(`${mtf.label}: ${mtf.aligned.join(", ") || "current frame"} supports ${plan.side}`);
  if (checks.ema) reasons.push("EMA 20/50/200 alignment supports the scenario");
  if (checks.vwap) reasons.push("Price is on the correct VWAP side");
  if (checks.adx) reasons.push("Trend strength / DI direction confirms momentum");
  if (checks.range) reasons.push(`Entry range is controlled at ${fmt.format(rangePct)}%`);
  if (bot.matches >= RECOMMENDATION_BOT_MIN_MATCHES && bot.adjustment > 0) reasons.push(bot.note);

  const risks = [];
  if (!checks.sample) risks.push(`1Y sample is thin: ${fmtInt.format(validation.trades || 0)} trades`);
  if (!checks.winRate) risks.push(`Validation win rate is below the high-probability threshold (${fmt.format(validation.winRate || 0)}%)`);
  if (!checks.profitFactor) risks.push(`Profit factor is weak (${fmt.format(validation.profitFactor || 0)})`);
  if (!checks.expectancy) risks.push(`Expectancy is not strong enough (${fmt.format(validation.expectancyR || 0)}R)`);
  if (!checks.mtf) risks.push(`Timeframes conflict: ${mtf.conflicts.join(", ") || "mixed signals"}`);
  if (!checks.range) risks.push(`Entry range is wide (${fmt.format(rangePct)}%); wait for a tighter trigger`);
  if (!checks.volatility) risks.push(`ATR volatility is outside the preferred band (${fmt.format(analysis.technicals?.atrPct || 0)}%)`);
  if (!checks.volume) risks.push(`Volume confirmation is weak (${fmt.format(analysis.technicals?.volumeRatio || 0)}x average)`);
  if (bot.matches >= RECOMMENDATION_BOT_MIN_MATCHES && bot.adjustment < 0) risks.push(bot.note);

  return {
    recommendationScore,
    estimatedWinRate,
    grade,
    highProbability: grade === "A+" || grade === "A",
    currentScore,
    validationScore,
    similarScore,
    mtf,
    botAdjustment: bot,
    reasons: reasons.slice(0, 5),
    risks: risks.slice(0, 4),
  };
}

function applyRecommendationModelToPlan(plan, analysis, chain) {
  if (!plan) return plan;
  const normalized = normalizeEntryRange(plan, {
    price: analysis.price,
    atr: analysis.atr,
    intervalKey: state.interval,
    support: analysis.localSupport || analysis.support,
    resistance: analysis.localResistance || analysis.resistance,
  });
  const evaluation = recommendationScoreFromChecks(normalized, analysis, chain);
  const validation = normalized.validationBacktest || normalized.backtest || {};
  return {
    ...normalized,
    ...evaluation,
    validationPass: validationPasses(validation),
    recommendationStatus: evaluation.highProbability ? "candidate" : "wait",
    scenarioHint: `${evaluation.grade} - win ${fmt.format(evaluation.estimatedWinRate)}% - S${Math.round(evaluation.recommendationScore)}`,
  };
}

function applyRecommendationModelToScenarios(scenarios, analysis, chain) {
  const evaluated = (scenarios || [])
    .filter(Boolean)
    .map((plan) => applyRecommendationModelToPlan(plan, analysis, chain))
    .sort((a, b) =>
      (b.highProbability ? 1 : 0) - (a.highProbability ? 1 : 0) ||
      (b.recommendationScore || 0) - (a.recommendationScore || 0) ||
      (b.estimatedWinRate || 0) - (a.estimatedWinRate || 0)
    );
  return evaluated.slice(0, 3).map((plan, index) => ({
    ...plan,
    scenarioIndex: index,
    scenarioId: `scenario-${index}-${plan.side}`,
    scenarioLabel: index === 0 ? "Top pick" : `Alt ${index + 1}`,
    scenarioName: plan.grade === "C" ? "Wait-first" : `${plan.grade} ${plan.side === "short" ? "Short" : "Long"}`,
  }));
}

function scoreLabel(signal) {
  if (signal > 0) return "상승";
  if (signal < 0) return "하락";
  return "중립";
}

function indicatorEvidence(analysis, name, label) {
  const indicator = getIndicator(analysis, name);
  if (!indicator) return null;
  return {
    label,
    detail: `${indicator.name}: ${indicator.reading}`,
    type: indicator.signal > 0 ? "positive" : indicator.signal < 0 ? "negative" : "neutral",
  };
}

function buildTradeEvidence(analysis) {
  const plan = analysis.tradePlan;
  const backtest = plan.backtest || { trades: 0, winRate: 0, expectancyR: 0, profitFactor: 0, quality: "weak" };
  const validation = plan.validationBacktest || backtest;
  const confluenceText = plan.confluence?.labels?.length ? plan.confluence.labels.join(", ") : "price structure";
  const levelText = plan.side === "long"
    ? `진입 구간이 현재가 아래/부근에 있어 눌림 후 반등 확인에 적합합니다. 저항까지 여유는 ${fmt.format(analysis.resistanceGap)}%입니다.`
    : plan.side === "short"
      ? `진입 구간이 현재가 위/부근에 있어 반등 실패 확인에 적합합니다. 지지까지 여유는 ${fmt.format(analysis.supportGap)}%입니다.`
      : `지지와 저항 사이의 박스권입니다. 상단 돌파 ${fmtUsd.format(plan.breakoutLong)} 또는 하단 이탈 ${fmtUsd.format(plan.breakdownShort)} 확인이 필요합니다.`;
  const chain = analysis.chain?.notes?.[0] || "온체인 데이터는 공개 API 기준으로 보조 반영 중입니다.";

  return [
    {
      label: "1년 검증",
      detail: `검증 구간 ${plan.validationIntervalKey || "1h"} 기준 ${fmtInt.format(validation.trades)}건에서 승률 ${fmt.format(validation.winRate)}%, 기대값 ${fmt.format(validation.expectancyR)}R, PF ${fmt.format(validation.profitFactor)}입니다.`,
      type: plan.validationPass && validation.expectancyR > 0 && validation.winRate >= 52 ? "positive" : validation.trades >= 12 ? "neutral" : "negative",
    },
    {
      label: "백테스트",
      detail: `유사 조건 ${fmtInt.format(backtest.trades)}건에서 승률 ${fmt.format(backtest.winRate)}%, 기대값 ${fmt.format(backtest.expectancyR)}R, PF ${fmt.format(backtest.profitFactor)}입니다.`,
      type: backtest.expectancyR > 0 && backtest.winRate >= 50 ? "positive" : backtest.expectancyR < 0 ? "negative" : "neutral",
    },
    indicatorEvidence(analysis, "EMA 추세", "추세"),
    indicatorEvidence(analysis, "MACD", "모멘텀"),
    indicatorEvidence(analysis, "RSI 14", "과열/침체"),
    indicatorEvidence(analysis, "거래량 돌파", "거래량"),
    {
      label: "가격 구조",
      detail: `${levelText} 진입 근거 겹침은 ${confluenceText}입니다.`,
      type: analysis.bias === "bullish" ? "positive" : analysis.bias === "bearish" ? "negative" : "neutral",
    },
    {
      label: "온체인",
      detail: chain,
      type: analysis.chain?.score > 55 ? "positive" : analysis.chain?.score < 45 ? "negative" : "neutral",
    },
  ].filter(Boolean);
}

function makeIndicator(name, reading, signal, weight = 1) {
  return {
    name,
    reading,
    signal,
    weight,
    points: signal * weight,
  };
}

function analyzeCandles(candles) {
  const closes = candles.map((candle) => candle.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const volumes = candles.map((candle) => candle.volume);
  const price = last(closes);
  const previous = closes[closes.length - 2];
  const change24h = pct(price, closes[Math.max(0, closes.length - 288)] || closes[0]);
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const ema200 = emaSeries(closes, 200);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsi = rsiSeries(closes, 14);
  const macd = macdValues(closes);
  const stoch = stochasticRsi(closes);
  const bands = bollinger(closes);
  const atr = atrSeries(candles, 14);
  const adxValue = adx(candles);
  const cciValue = cci(candles);
  const roc = pct(price, closes[closes.length - 13]);
  const momentum = price - closes[closes.length - 11];
  const williams = ((Math.max(...highs.slice(-14)) - price) / (Math.max(...highs.slice(-14)) - Math.min(...lows.slice(-14)))) * -100;
  const obvValues = obv(candles);
  const obvSlope = last(obvValues) - obvValues[obvValues.length - 15];
  const mfiValue = mfi(candles);
  const vwap = vwapSeries(candles);
  const volumeRatio = last(volumes) / average(volumes.slice(-31, -1));
  const donchianHigh = Math.max(...highs.slice(-20));
  const donchianLow = Math.min(...lows.slice(-20));
  const donchianPos = ((price - donchianLow) / (donchianHigh - donchianLow)) * 100;
  const tenkan = (Math.max(...highs.slice(-9)) + Math.min(...lows.slice(-9))) / 2;
  const kijun = (Math.max(...highs.slice(-26)) + Math.min(...lows.slice(-26))) / 2;
  const support = Math.min(...lows.slice(-48));
  const resistance = Math.max(...highs.slice(-48));
  const supportGap = pct(price, support);
  const resistanceGap = pct(resistance, price);
  const bbUpper = last(bands.upper.filter((value) => value !== null));
  const bbLower = last(bands.lower.filter((value) => value !== null));
  const bbMiddle = last(bands.middle.filter((value) => value !== null));
  const bbPercent = ((price - bbLower) / (bbUpper - bbLower)) * 100;
  const bbWidth = ((bbUpper - bbLower) / bbMiddle) * 100;
  const atrNow = last(atr.filter((value) => value !== null));

  const indicators = [
    makeIndicator("EMA 추세", `20/50/200: ${fmtUsd.format(last(ema20))} / ${fmtUsd.format(last(ema50))} / ${fmtUsd.format(last(ema200))}`, price > last(ema20) && last(ema20) > last(ema50) ? 1 : price < last(ema20) && last(ema20) < last(ema50) ? -1 : 0, 1.35),
    makeIndicator("SMA 추세", `SMA20 ${fmtUsd.format(last(sma20.filter(Boolean)))} / SMA50 ${fmtUsd.format(last(sma50.filter(Boolean)))}`, last(sma20.filter(Boolean)) > last(sma50.filter(Boolean)) ? 1 : -1, 1.05),
    makeIndicator("MACD", `히스토그램 ${fmt.format(last(macd.hist))}`, last(macd.hist) > 0 ? 1 : -1, 1.25),
    makeIndicator("RSI 14", fmt.format(last(rsi.filter((value) => value !== null))), last(rsi.filter((value) => value !== null)) > 68 ? -1 : last(rsi.filter((value) => value !== null)) < 32 ? 1 : last(rsi.filter((value) => value !== null)) > 52 ? 0.6 : last(rsi.filter((value) => value !== null)) < 48 ? -0.6 : 0, 1.1),
    makeIndicator("Stoch RSI", fmt.format(last(stoch.filter((value) => value !== null))), last(stoch.filter((value) => value !== null)) > 80 ? -0.7 : last(stoch.filter((value) => value !== null)) < 20 ? 0.7 : 0, 0.8),
    makeIndicator("Bollinger %B", `${fmt.format(bbPercent)}%`, bbPercent > 90 ? -0.5 : bbPercent < 10 ? 0.5 : price > bbMiddle ? 0.4 : -0.4, 0.85),
    makeIndicator("Bollinger 폭", `${fmt.format(bbWidth)}%`, bbWidth > 4 && price > previous ? 0.4 : bbWidth > 4 && price < previous ? -0.4 : 0, 0.55),
    makeIndicator("ATR 변동성", `${fmtUsd.format(atrNow)} (${fmt.format((atrNow / price) * 100)}%)`, price > previous ? 0.3 : -0.3, 0.65),
    makeIndicator("ADX 방향성", `ADX ${fmt.format(adxValue.adx)} / +DI ${fmt.format(adxValue.plusDi)} / -DI ${fmt.format(adxValue.minusDi)}`, adxValue.plusDi > adxValue.minusDi ? 1 : -1, 1),
    makeIndicator("CCI 20", fmt.format(cciValue), cciValue > 100 ? 0.8 : cciValue < -100 ? -0.8 : cciValue > 0 ? 0.3 : -0.3, 0.75),
    makeIndicator("ROC 12", `${fmt.format(roc)}%`, roc > 0 ? 1 : -1, 0.85),
    makeIndicator("Momentum 10", fmtUsd.format(momentum), momentum > 0 ? 1 : -1, 0.8),
    makeIndicator("Williams %R", fmt.format(williams), williams > -20 ? -0.6 : williams < -80 ? 0.6 : williams > -50 ? 0.3 : -0.3, 0.7),
    makeIndicator("OBV 흐름", fmtInt.format(obvSlope), obvSlope > 0 ? 1 : -1, 0.9),
    makeIndicator("MFI 14", fmt.format(mfiValue), mfiValue > 80 ? -0.8 : mfiValue < 20 ? 0.8 : mfiValue > 50 ? 0.4 : -0.4, 0.8),
    makeIndicator("VWAP 위치", fmtUsd.format(last(vwap)), price > last(vwap) ? 1 : -1, 1),
    makeIndicator("거래량 돌파", `평균 대비 ${fmt.format(volumeRatio)}배`, volumeRatio > 1.25 && price > previous ? 1 : volumeRatio > 1.25 && price < previous ? -1 : 0, 0.7),
    makeIndicator("Donchian 위치", `${fmt.format(donchianPos)}%`, donchianPos > 75 ? 0.8 : donchianPos < 25 ? -0.8 : 0, 0.75),
    makeIndicator("Ichimoku 기본선", `전환선 ${fmtUsd.format(tenkan)} / 기준선 ${fmtUsd.format(kijun)}`, tenkan > kijun && price > kijun ? 1 : tenkan < kijun && price < kijun ? -1 : 0, 0.9),
    makeIndicator("Supertrend", supertrendDirection(candles) > 0 ? "상방" : "하방", supertrendDirection(candles), 1),
  ];

  const maxPoints = indicators.reduce((sum, item) => sum + item.weight, 0);
  const raw = indicators.reduce((sum, item) => sum + item.points, 0);
  const score = Math.round(clamp(50 + (raw / maxPoints) * 50, 0, 100));
  const bias = score >= 62 ? "bullish" : score <= 38 ? "bearish" : "neutral";
  const text = bias === "bullish" ? "상승 우위" : bias === "bearish" ? "하락 우위" : "중립/관망";
  const confidence = Math.round(average(indicators.map((item) => Math.abs(item.signal))) * 100);
  const targetMove = ((score - 50) / 50) * atrNow * 1.35;
  const target = price + targetMove;
  const rangeLow = target - atrNow * 0.75;
  const rangeHigh = target + atrNow * 0.75;
  const tradePlan = buildTradePlan({ price, score, bias, support, resistance, atr: atrNow, previous });

  return {
    price,
    previous,
    change24h,
    score,
    bias,
    text,
    confidence,
    indicators,
    support,
    resistance,
    supportGap,
    resistanceGap,
    atr: atrNow,
    target,
    rangeLow,
    rangeHigh,
    tradePlan,
    overlays: {
      ema20,
      ema50,
      ema200,
      bands,
      vwap,
    },
  };
}

function analyzeCandlesV2(candles, intervalKey = state.interval, validationCandles = candles, validationIntervalKey = validationIntervalFor(intervalKey)) {
  const closes = candles.map((candle) => candle.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const volumes = candles.map((candle) => candle.volume);
  const price = last(closes);
  const previous = closes[closes.length - 2];
  const change24h = pct(price, closes[Math.max(0, closes.length - 288)] || closes[0]);
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const ema200 = emaSeries(closes, 200);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsi = rsiSeries(closes, 14);
  const macd = macdValues(closes);
  const stoch = stochasticRsi(closes);
  const bands = bollinger(closes);
  const atr = atrSeries(candles, 14);
  const adxValue = adx(candles);
  const cciValue = cci(candles);
  const roc = pct(price, closes[closes.length - 13]);
  const momentum = price - closes[closes.length - 11];
  const williams = ((Math.max(...highs.slice(-14)) - price) / (Math.max(...highs.slice(-14)) - Math.min(...lows.slice(-14)))) * -100;
  const obvValues = obv(candles);
  const obvSlope = last(obvValues) - obvValues[obvValues.length - 15];
  const mfiValue = mfi(candles);
  const vwap = vwapSeries(candles);
  const volumeRatio = last(volumes) / average(volumes.slice(-31, -1));
  const donchianHigh = Math.max(...highs.slice(-20));
  const donchianLow = Math.min(...lows.slice(-20));
  const donchianPos = ((price - donchianLow) / (donchianHigh - donchianLow)) * 100;
  const tenkan = (Math.max(...highs.slice(-9)) + Math.min(...lows.slice(-9))) / 2;
  const kijun = (Math.max(...highs.slice(-26)) + Math.min(...lows.slice(-26))) / 2;
  const support = Math.min(...lows.slice(-48));
  const resistance = Math.max(...highs.slice(-48));
  const localSupport = Math.min(...lows.slice(-16));
  const localResistance = Math.max(...highs.slice(-16));
  const supportGap = pct(price, support);
  const resistanceGap = pct(resistance, price);
  const bbUpper = last(bands.upper.filter((value) => value !== null));
  const bbLower = last(bands.lower.filter((value) => value !== null));
  const bbMiddle = last(bands.middle.filter((value) => value !== null));
  const bbPercent = ((price - bbLower) / (bbUpper - bbLower)) * 100;
  const bbWidth = ((bbUpper - bbLower) / bbMiddle) * 100;
  const atrNow = last(atr.filter((value) => value !== null));
  const macdHist = macd.hist;
  const rsiNow = last(rsi.filter((value) => value !== null));
  const macdHistNow = last(macd.hist.filter((value) => value !== null));
  const macdHistPrev = macd.hist.filter((value) => value !== null).slice(-2)[0] || macdHistNow;
  const ema20Now = last(ema20);
  const ema50Now = last(ema50);
  const ema200Now = last(ema200);
  const vwapNow = last(vwap);

  const indicators = [
    makeIndicator("EMA 추세", `20/50/200: ${fmtUsd.format(last(ema20))} / ${fmtUsd.format(last(ema50))} / ${fmtUsd.format(last(ema200))}`, price > last(ema20) && last(ema20) > last(ema50) ? 1 : price < last(ema20) && last(ema20) < last(ema50) ? -1 : 0, 1.35),
    makeIndicator("SMA 추세", `SMA20 ${fmtUsd.format(last(sma20.filter(Boolean)))} / SMA50 ${fmtUsd.format(last(sma50.filter(Boolean)))}`, last(sma20.filter(Boolean)) > last(sma50.filter(Boolean)) ? 1 : -1, 1.05),
    makeIndicator("MACD", `히스토그램 ${fmt.format(last(macd.hist))}`, last(macd.hist) > 0 ? 1 : -1, 1.25),
    makeIndicator("RSI 14", fmt.format(last(rsi.filter((value) => value !== null))), last(rsi.filter((value) => value !== null)) > 68 ? -1 : last(rsi.filter((value) => value !== null)) < 32 ? 1 : last(rsi.filter((value) => value !== null)) > 52 ? 0.6 : last(rsi.filter((value) => value !== null)) < 48 ? -0.6 : 0, 1.1),
    makeIndicator("Stoch RSI", fmt.format(last(stoch.filter((value) => value !== null))), last(stoch.filter((value) => value !== null)) > 80 ? -0.7 : last(stoch.filter((value) => value !== null)) < 20 ? 0.7 : 0, 0.8),
    makeIndicator("Bollinger %B", `${fmt.format(bbPercent)}%`, bbPercent > 90 ? -0.5 : bbPercent < 10 ? 0.5 : price > bbMiddle ? 0.4 : -0.4, 0.85),
    makeIndicator("Bollinger 폭", `${fmt.format(bbWidth)}%`, bbWidth > 4 && price > previous ? 0.4 : bbWidth > 4 && price < previous ? -0.4 : 0, 0.55),
    makeIndicator("ATR 변동성", `${fmtUsd.format(atrNow)} (${fmt.format((atrNow / price) * 100)}%)`, price > previous ? 0.3 : -0.3, 0.65),
    makeIndicator("ADX 방향성", `ADX ${fmt.format(adxValue.adx)} / +DI ${fmt.format(adxValue.plusDi)} / -DI ${fmt.format(adxValue.minusDi)}`, adxValue.plusDi > adxValue.minusDi ? 1 : -1, 1),
    makeIndicator("CCI 20", fmt.format(cciValue), cciValue > 100 ? 0.8 : cciValue < -100 ? -0.8 : cciValue > 0 ? 0.3 : -0.3, 0.75),
    makeIndicator("ROC 12", `${fmt.format(roc)}%`, roc > 0 ? 1 : -1, 0.85),
    makeIndicator("Momentum 10", fmtUsd.format(momentum), momentum > 0 ? 1 : -1, 0.8),
    makeIndicator("Williams %R", fmt.format(williams), williams > -20 ? -0.6 : williams < -80 ? 0.6 : williams > -50 ? 0.3 : -0.3, 0.7),
    makeIndicator("OBV 흐름", fmtInt.format(obvSlope), obvSlope > 0 ? 1 : -1, 0.9),
    makeIndicator("MFI 14", fmt.format(mfiValue), mfiValue > 80 ? -0.8 : mfiValue < 20 ? 0.8 : mfiValue > 50 ? 0.4 : -0.4, 0.8),
    makeIndicator("VWAP 위치", fmtUsd.format(last(vwap)), price > last(vwap) ? 1 : -1, 1),
    makeIndicator("거래량 돌파", `평균 대비 ${fmt.format(volumeRatio)}배`, volumeRatio > 1.25 && price > previous ? 1 : volumeRatio > 1.25 && price < previous ? -1 : 0, 0.7),
    makeIndicator("Donchian 위치", `${fmt.format(donchianPos)}%`, donchianPos > 75 ? 0.8 : donchianPos < 25 ? -0.8 : 0, 0.75),
    makeIndicator("Ichimoku 기본선", `전환선 ${fmtUsd.format(tenkan)} / 기준선 ${fmtUsd.format(kijun)}`, tenkan > kijun && price > kijun ? 1 : tenkan < kijun && price < kijun ? -1 : 0, 0.9),
    makeIndicator("Supertrend", supertrendDirection(candles) > 0 ? "상방" : "하방", supertrendDirection(candles), 1),
  ];

  const maxPoints = indicators.reduce((sum, item) => sum + item.weight, 0);
  const raw = indicators.reduce((sum, item) => sum + item.points, 0);
  const score = Math.round(clamp(50 + (raw / maxPoints) * 50, 0, 100));
  const bias = score >= 62 ? "bullish" : score <= 38 ? "bearish" : "neutral";
  const text = bias === "bullish" ? "상승 우위" : bias === "bearish" ? "하락 우위" : "중립/관망";
  const confidence = Math.round(average(indicators.map((item) => Math.abs(item.signal))) * 100);
  const targetMove = ((score - 50) / 50) * atrNow * 1.35;
  const target = price + targetMove;
  const rangeLow = target - atrNow * 0.75;
  const rangeHigh = target + atrNow * 0.75;

  const metrics = buildBacktestMetrics(candles);
  const validationMetrics = buildBacktestMetrics(validationCandles);
  const historicalEdges = {
    recommendedLong: buildHistoricalEdge({ candles, intervalKey, side: "long", mode: "recommended", metrics }),
    recommendedShort: buildHistoricalEdge({ candles, intervalKey, side: "short", mode: "recommended", metrics }),
    currentLong: buildHistoricalEdge({ candles, intervalKey, side: "long", mode: "current-entry", metrics }),
    currentShort: buildHistoricalEdge({ candles, intervalKey, side: "short", mode: "current-entry", metrics }),
  };
  const validationEdges = {
    recommendedLong: buildHistoricalEdge({ candles: validationCandles, intervalKey: validationIntervalKey, side: "long", mode: "recommended", metrics: validationMetrics }),
    recommendedShort: buildHistoricalEdge({ candles: validationCandles, intervalKey: validationIntervalKey, side: "short", mode: "recommended", metrics: validationMetrics }),
    currentLong: buildHistoricalEdge({ candles: validationCandles, intervalKey: validationIntervalKey, side: "long", mode: "current-entry", metrics: validationMetrics }),
    currentShort: buildHistoricalEdge({ candles: validationCandles, intervalKey: validationIntervalKey, side: "short", mode: "current-entry", metrics: validationMetrics }),
  };
  const selectedHistoricalEdgePack = bias === "bearish" ? historicalEdges.recommendedShort : historicalEdges.recommendedLong;
  const selectedValidationEdgePack = bias === "bearish" ? validationEdges.recommendedShort : validationEdges.recommendedLong;
  const selectedValidationEdge = selectedValidationEdgePack.best;
  const validationPass = validationPasses(selectedValidationEdge);
  const validationBoost = validationPass
    ? Math.min(10, selectedValidationEdge.expectancyR * 5 + Math.max(0, selectedValidationEdge.winRate - 50) * 0.3)
    : selectedValidationEdge.trades >= 12
      ? -8
      : -12;
  const validatedScore = Math.round(clamp(score + validationBoost, 0, 100));
  const validatedBias = validatedScore >= 62 ? "bullish" : validatedScore <= 38 ? "bearish" : "neutral";
  const validationSummary = {
    intervalKey: validationIntervalKey,
    trades: selectedValidationEdge.trades,
    winRate: selectedValidationEdge.winRate,
    expectancyR: selectedValidationEdge.expectancyR,
    profitFactor: selectedValidationEdge.profitFactor,
    quality: selectedValidationEdge.quality,
    pass: validationPass,
  };
  const tradeScenarios = buildScenarioPlansV2({
    price,
    score: validatedScore,
    bias: validatedBias,
    support,
    resistance,
    localSupport,
    localResistance,
    atr: atrNow,
    previous,
    ema20: last(ema20),
    ema50: last(ema50),
    vwap: last(vwap),
    bbMiddle,
    historicalEdges,
    validationEdges,
    validationIntervalKey,
    intervalKey,
  });
  const tradePlan = tradeScenarios[0] || buildTradePlan({
    price,
    score: validatedScore,
    bias: validatedBias,
    support,
    resistance,
    localSupport,
    localResistance,
    atr: atrNow,
    previous,
    ema20: last(ema20),
    ema50: last(ema50),
    vwap: last(vwap),
    bbMiddle,
    historicalEdge: selectedHistoricalEdgePack.best,
    validationEdge: selectedValidationEdge,
    validationPass,
    validationIntervalKey,
    intervalKey,
  });

  return {
    price,
    previous,
    change24h,
    score: validatedScore,
    bias: validatedBias,
    text: validatedBias === "bullish" ? "상승 우위" : validatedBias === "bearish" ? "하락 우위" : "중립/관망",
    confidence,
    indicators,
    support,
    resistance,
    localSupport,
    localResistance,
    supportGap,
    resistanceGap,
    atr: atrNow,
    target,
    rangeLow,
    rangeHigh,
    tradePlan,
    tradeScenarios,
    historicalEdges,
    validationEdges,
    validationSummary,
    technicals: {
      ema20: ema20Now,
      ema50: ema50Now,
      ema200: ema200Now,
      vwap: vwapNow,
      rsi: rsiNow,
      macdHist: macdHistNow,
      macdHistPrev,
      adx: adxValue.adx,
      plusDi: adxValue.plusDi,
      minusDi: adxValue.minusDi,
      atrPct: price > 0 ? (atrNow / price) * 100 : 0,
      volumeRatio,
      bbWidth,
      donchianPos,
    },
    overlays: {
      ema20,
      ema50,
      ema200,
      bands,
      vwap,
    },
  };
}

function onchainScore(onchain) {
  if (!onchain) return { score: 50, notes: ["온체인 데이터 대기 중"] };

  let score = 50;
  const notes = [];
  const mempool = onchain.mempool;
  const fees = onchain.fees;
  const difficulty = onchain.difficulty;
  const hashValues = onchain.hashRate?.values || [];
  const txValues = onchain.transactions?.values || [];

  if (mempool?.count) {
    if (mempool.count > 150000) {
      score -= 5;
      notes.push("mempool 대기 거래가 많아 단기 네트워크 혼잡 부담");
    } else {
      score += 2;
      notes.push("mempool 혼잡은 과도하지 않음");
    }
  }
  if (fees?.fastestFee) {
    if (fees.fastestFee > 80) score -= 4;
    else if (fees.fastestFee < 20) score += 3;
    notes.push(`권장 빠른 수수료 ${fees.fastestFee} sat/vB`);
  }
  if (difficulty?.difficultyChange !== undefined) {
    score += difficulty.difficultyChange > 0 ? 3 : -2;
    notes.push(`난이도 예상 변화 ${fmt.format(difficulty.difficultyChange)}%`);
  }
  if (hashValues.length > 7) {
    const recent = last(hashValues).y;
    const earlier = hashValues[hashValues.length - 8].y;
    score += recent > earlier ? 4 : -4;
    notes.push(`해시레이트 7일 변화 ${fmt.format(pct(recent, earlier))}%`);
  }
  if (txValues.length > 7) {
    const recent = last(txValues).y;
    const earlier = txValues[txValues.length - 8].y;
    score += recent > earlier ? 2 : -2;
    notes.push(`일일 트랜잭션 7일 변화 ${fmt.format(pct(recent, earlier))}%`);
  }

  if (onchain.partial) notes.push("일부 공개 온체인 API 응답 실패");
  return { score: clamp(Math.round(score), 0, 100), notes };
}

function compositeAnalysis() {
  const selected = state.analyses[state.interval];
  if (!selected) return null;

  const chain = onchainScore(state.onchain);
  const score = Math.round(selected.score * 0.78 + chain.score * 0.22);
  const bias = score >= 62 ? "bullish" : score <= 38 ? "bearish" : "neutral";
  const text = bias === "bullish" ? "상승 우위" : bias === "bearish" ? "하락 우위" : "중립/관망";
  const baseScenarios = selected.tradeScenarios || [selected.tradePlan].filter(Boolean);
  const scenarios = applyRecommendationModelToScenarios(baseScenarios, { ...selected, score, bias, text, chain }, chain);
  const selectedIndex = clamp(state.selectedScenarioIndex, 0, Math.max(0, scenarios.length - 1));
  state.selectedScenarioIndex = selectedIndex;
  const tradePlan = scenarios[selectedIndex] || selected.tradePlan;
  return { ...selected, score, bias, text, tradePlan, tradeScenarios: scenarios, selectedScenarioIndex: selectedIndex, chain };
}

function getDisplayAnalysis() {
  const analysis = compositeAnalysis();
  if (!analysis) return null;
  if (state.scenarioMode !== "current-entry") return analysis;
  if (!state.entrySnapshot || state.entrySnapshot.interval !== state.interval) return analysis;

  return {
    ...analysis,
    support: state.entrySnapshot.support,
    resistance: state.entrySnapshot.resistance,
    atr: state.entrySnapshot.atr,
    tradePlan: state.entrySnapshot.tradePlan,
    entryCapturedAt: state.entrySnapshot.capturedAt,
    entryLocked: true,
  };
}

function captureCurrentEntry() {
  const analysis = compositeAnalysis();
  if (!analysis) return null;
  state.scenarioMode = "current-entry";
  const longEdge = analysis.historicalEdges?.currentLong?.best;
  const shortEdge = analysis.historicalEdges?.currentShort?.best;
  const longValidation = analysis.validationEdges?.currentLong?.best;
  const shortValidation = analysis.validationEdges?.currentShort?.best;
  const longScore = scenarioFormulaScore({ edge: longEdge, validationEdge: longValidation, side: "long", bias: analysis.bias, technicalScore: analysis.score || 50 });
  const shortScore = scenarioFormulaScore({ edge: shortEdge, validationEdge: shortValidation, side: "short", bias: analysis.bias, technicalScore: analysis.score || 50 });
  const currentSide = shortScore > longScore ? "short" : "long";
  const currentEdge = currentSide === "short" ? shortEdge : longEdge;
  const currentValidation = currentSide === "short" ? shortValidation : longValidation;
  const currentScore = currentSide === "short" ? shortScore : longScore;
  const planAnalysis = currentSide === "short" ? { ...analysis, bias: "bearish" } : { ...analysis, bias: "bullish" };
  state.entrySnapshot = {
    interval: state.interval,
    capturedAt: Date.now(),
    entry: analysis.price,
    support: analysis.support,
    resistance: analysis.resistance,
    atr: analysis.atr,
    tradePlan: buildCurrentEntryPlan(planAnalysis, currentEdge, currentValidation, currentScore),
  };
  return state.entrySnapshot;
}

function activateRecommendedScenario() {
  state.scenarioMode = "recommended";
  state.entrySnapshot = null;
  state.levelsVisible = true;
  state.selectedScenarioIndex = 0;
}

function tradeEntryReference(plan) {
  if (plan.side === "long") return plan.entryHigh;
  if (plan.side === "short") return plan.entryLow;
  return (plan.entryLow + plan.entryHigh) / 2;
}

function calculateRisk(analysis) {
  const plan = analysis.tradePlan;
  const entry = tradeEntryReference(plan);
  const stopDistance = Math.abs(entry - plan.stopLoss);
  const riskCapital = state.risk.accountSize * (state.risk.riskPct / 100);
  const quantity = stopDistance > 0 ? riskCapital / stopDistance : 0;
  const notional = quantity * entry;
  const feeCost = notional * (state.risk.feePct / 100);
  const slippageCost = notional * (state.risk.slippagePct / 100);
  const totalCost = feeCost + slippageCost;
  const tp1Gross = Math.abs(plan.takeProfit1 - entry) * quantity;
  const tp2Gross = Math.abs(plan.takeProfit2 - entry) * quantity;
  const netTp1 = tp1Gross - totalCost;
  const netTp2 = tp2Gross - totalCost;
  const maxLoss = riskCapital + totalCost;
  const netRr = maxLoss > 0 ? netTp2 / maxLoss : 0;
  const leverageUsed = state.risk.accountSize > 0 ? notional / state.risk.accountSize : 0;

  return {
    entry,
    stopDistance,
    stopDistancePct: entry > 0 ? (stopDistance / entry) * 100 : 0,
    riskCapital,
    quantity,
    notional,
    feeCost,
    slippageCost,
    totalCost,
    netTp1,
    netTp2,
    maxLoss,
    netRr,
    leverageUsed,
  };
}

function createDefaultBotDesk() {
  return {
    settings: {
      capital: 10000,
      leverage: 5,
    },
    running: false,
    seeded: false,
    activeHistoryBotId: null,
    bots: [
      {
        id: "alpha",
        name: "안정형 봇",
        strategy: "winrate",
        allocation: 0.12,
        trades: 0,
        wins: 0,
        losses: 0,
        realizedPnl: 0,
        history: [],
        openTrade: null,
        lastTradeTime: null,
      },
      {
        id: "beta",
        name: "균형형 봇",
        strategy: "expectancy",
        allocation: 0.11,
        trades: 0,
        wins: 0,
        losses: 0,
        realizedPnl: 0,
        history: [],
        openTrade: null,
        lastTradeTime: null,
      },
      {
        id: "gamma",
        name: "공격형 봇",
        strategy: "rr",
        allocation: 0.1,
        trades: 0,
        wins: 0,
        losses: 0,
        realizedPnl: 0,
        history: [],
        openTrade: null,
        lastTradeTime: null,
      },
      {
        id: "delta",
        name: "스캘핑 봇",
        strategy: "expectancy",
        allocation: 0.1,
        trades: 0,
        wins: 0,
        losses: 0,
        realizedPnl: 0,
        history: [],
        openTrade: null,
        lastTradeTime: null,
      },
      {
        id: "epsilon",
        name: "추세추종 봇",
        strategy: "rr",
        allocation: 0.11,
        trades: 0,
        wins: 0,
        losses: 0,
        realizedPnl: 0,
        history: [],
        openTrade: null,
        lastTradeTime: null,
      },
      {
        id: "zeta",
        name: "검증형 봇",
        strategy: "winrate",
        allocation: 0.12,
        trades: 0,
        wins: 0,
        losses: 0,
        realizedPnl: 0,
        history: [],
        openTrade: null,
        lastTradeTime: null,
      },
      {
        id: "eta",
        name: "고확률 컨플루언스 봇",
        strategy: "probability",
        allocation: 0.12,
        trades: 0,
        wins: 0,
        losses: 0,
        realizedPnl: 0,
        history: [],
        openTrade: null,
        lastTradeTime: null,
      },
      {
        id: "theta",
        name: "저변동 검증 봇",
        strategy: "quality",
        allocation: 0.11,
        trades: 0,
        wins: 0,
        losses: 0,
        realizedPnl: 0,
        history: [],
        openTrade: null,
        lastTradeTime: null,
      },
      {
        id: "iota",
        name: "리테스트 확률 봇",
        strategy: "retest",
        allocation: 0.11,
        trades: 0,
        wins: 0,
        losses: 0,
        realizedPnl: 0,
        history: [],
        openTrade: null,
        lastTradeTime: null,
      },
    ],
  };
}

function botTimeToMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Date.now();
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

function normalizeBotTradeRecord(trade) {
  const record = trade && typeof trade === "object" ? trade : {};
  const normalized = {
    ...record,
    entry: Number(record.entry) || 0,
    exit: Number(record.exit) || 0,
    pnl: Number(record.pnl) || 0,
    rMultiple: Number(record.rMultiple) || 0,
    snapshot: record.snapshot || record.contextSnapshot || null,
    closeSnapshot: record.closeSnapshot || null,
  };
  if (!Number.isFinite(Number(normalized.holdingMinutes)) && normalized.snapshot?.capturedAt && normalized.time) {
    normalized.holdingMinutes = Math.max(0, (botTimeToMs(normalized.time) - botTimeToMs(normalized.snapshot.capturedAt)) / 60000);
  }
  return normalized;
}

function hydrateBotDesk(raw) {
  const fallback = createDefaultBotDesk();
  const bots = fallback.bots.map((base, index) => {
    const source = raw?.bots?.find?.((bot) => bot?.id === base.id) || raw?.bots?.[index] || {};
    return {
      ...base,
      ...source,
      allocation: base.allocation,
      history: Array.isArray(source.history) ? source.history.map(normalizeBotTradeRecord) : [],
      openTrade: source.openTrade || null,
      lastTradeTime: source.lastTradeTime ?? null,
    };
  });

  return {
    settings: {
      capital: Number(raw?.settings?.capital) > 0 ? Number(raw.settings.capital) : fallback.settings.capital,
      leverage: Number(raw?.settings?.leverage) > 0 ? Number(raw.settings.leverage) : fallback.settings.leverage,
    },
    running: Boolean(raw?.running),
    seeded: Boolean(raw?.seeded),
    activeHistoryBotId: raw?.activeHistoryBotId ?? null,
    bots,
  };
}

function loadBotDeskState() {
  try {
    const raw = localStorage.getItem(BOT_DESK_STORAGE_KEY);
    if (!raw) return createDefaultBotDesk();
    return hydrateBotDesk(JSON.parse(raw));
  } catch {
    return createDefaultBotDesk();
  }
}

function saveBotDeskState() {
  try {
    localStorage.setItem(BOT_DESK_STORAGE_KEY, JSON.stringify(state.botDesk));
  } catch {
    // ignore storage issues
  }
}

function lastFinite(values = []) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(values[index])) return values[index];
  }
  return null;
}

function compactIndicatorSnapshot(analysis, limit = 20) {
  return (analysis?.indicators || []).slice(0, limit).map((item) => ({
    name: item.name,
    reading: item.reading,
    signal: Number(item.signal) || 0,
    points: Number(item.points) || 0,
    weight: Number(item.weight) || 0,
  }));
}

function namedIndicatorValue(analysis, pattern) {
  const indicator = (analysis?.indicators || []).find((item) => item.name.includes(pattern));
  return indicator ? {
    name: indicator.name,
    reading: indicator.reading,
    signal: Number(indicator.signal) || 0,
    points: Number(indicator.points) || 0,
  } : null;
}

function buildTradeSnapshot({ bot, analysis, plan, entry, reason }) {
  const backtest = plan?.backtest || { trades: 0, winRate: 0, expectancyR: 0, profitFactor: 0 };
  const validation = plan?.validationBacktest || backtest;
  const chain = analysis?.chain || onchainScore(state.onchain);
  const ema20 = lastFinite(analysis?.overlays?.ema20 || []);
  const ema50 = lastFinite(analysis?.overlays?.ema50 || []);
  const ema200 = lastFinite(analysis?.overlays?.ema200 || []);
  const vwap = lastFinite(analysis?.overlays?.vwap || []);
  const atrPct = analysis?.price > 0 ? (analysis.atr / analysis.price) * 100 : 0;

  return {
    version: BOT_SNAPSHOT_VERSION,
    capturedAt: Date.now(),
    bot: {
      id: bot.id,
      name: bot.name,
      strategy: bot.strategy,
      allocation: bot.allocation,
    },
    market: {
      interval: state.interval,
      price: analysis?.price || entry,
      previous: analysis?.previous || null,
      change24h: analysis?.change24h || 0,
      compositeScore: analysis?.score || 0,
      bias: analysis?.bias || "neutral",
      text: analysis?.text || "",
      confidence: analysis?.confidence || 0,
      support: analysis?.support || null,
      resistance: analysis?.resistance || null,
      localSupport: analysis?.localSupport || null,
      localResistance: analysis?.localResistance || null,
      atr: analysis?.atr || null,
      atrPct,
      target: analysis?.target || null,
      rangeLow: analysis?.rangeLow || null,
      rangeHigh: analysis?.rangeHigh || null,
      ema20,
      ema50,
      ema200,
      vwap,
      macd: namedIndicatorValue(analysis, "MACD"),
      rsi: namedIndicatorValue(analysis, "RSI"),
      adx: namedIndicatorValue(analysis, "ADX"),
      volume: namedIndicatorValue(analysis, "Volume") || namedIndicatorValue(analysis, "거래"),
    },
    scenario: {
      id: plan?.scenarioId || null,
      name: plan?.scenarioName || plan?.title || "Scenario",
      label: plan?.scenarioLabel || "",
      title: plan?.title || "",
      side: plan?.side || "neutral",
      summary: plan?.summary || "",
      entry,
      entryLow: plan?.entryLow || entry,
      entryHigh: plan?.entryHigh || entry,
      takeProfit1: plan?.takeProfit1 || null,
      takeProfit2: plan?.takeProfit2 || null,
      takeProfit3: plan?.takeProfit3 || null,
      stopLoss: plan?.stopLoss || null,
      invalidation: plan?.invalidation || null,
      rr: plan?.rr || 0,
      formulaScore: plan?.formulaScore || 0,
      recommendationScore: plan?.recommendationScore || 0,
      estimatedWinRate: plan?.estimatedWinRate || 0,
      grade: plan?.grade || "",
      validationPass: Boolean(plan?.validationPass),
      confluence: plan?.confluence?.labels || [],
    },
    validation: {
      intervalKey: plan?.validationIntervalKey || analysis?.validationSummary?.intervalKey || validationIntervalFor(state.interval),
      trades: validation.trades || 0,
      winRate: validation.winRate || 0,
      expectancyR: validation.expectancyR || 0,
      profitFactor: validation.profitFactor || 0,
      avgBarsHeld: validation.avgBarsHeld || 0,
      avgAdverseR: validation.avgAdverseR || 0,
      maxAdverseR: validation.maxAdverseR || 0,
      quality: validation.quality || "unknown",
    },
    backtest: {
      trades: backtest.trades || 0,
      winRate: backtest.winRate || 0,
      expectancyR: backtest.expectancyR || 0,
      profitFactor: backtest.profitFactor || 0,
      avgBarsHeld: backtest.avgBarsHeld || 0,
      avgAdverseR: backtest.avgAdverseR || 0,
      maxAdverseR: backtest.maxAdverseR || 0,
      quality: backtest.quality || "unknown",
    },
    onchain: {
      score: chain.score || 50,
      notes: (chain.notes || []).slice(0, 5),
    },
    indicators: compactIndicatorSnapshot(analysis),
    decision: {
      reason,
      learningAdjustment: 0,
      strategyScore: 0,
    },
  };
}

function buildCloseSnapshot(trade, exitPrice, candle, exitReason, pnl, rMultiple) {
  const openedAt = botTimeToMs(trade.openedAt || trade.snapshot?.capturedAt);
  const closedAt = botTimeToMs(candle?.time ?? Date.now());
  return {
    closedAt,
    exitPrice,
    exitReason,
    pnl,
    rMultiple,
    holdingMinutes: Math.max(0, (closedAt - openedAt) / 60000),
    candle: candle ? {
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    } : null,
  };
}

function bucketNumber(value, low, high) {
  if (!Number.isFinite(value)) return "unknown";
  if (value < low) return "low";
  if (value > high) return "high";
  return "mid";
}

function tradeFeatureKeysFromSnapshot(snapshot) {
  if (!snapshot) return [];
  const market = snapshot.market || {};
  const scenario = snapshot.scenario || {};
  const validation = snapshot.validation || {};
  const onchain = snapshot.onchain || {};
  const keys = [
    `interval:${market.interval || "unknown"}`,
    `side:${scenario.side || "neutral"}`,
    `bias:${market.bias || "neutral"}`,
    `confidence:${bucketNumber(market.confidence, 45, 70)}`,
    `onchain:${bucketNumber(onchain.score, 45, 58)}`,
    `atr:${bucketNumber(market.atrPct, 0.35, 1.6)}`,
    `validation:${validation.trades >= 24 && validation.winRate >= 52 && validation.expectancyR > 0 ? "strong" : validation.trades >= 12 ? "mixed" : "thin"}`,
  ];
  (snapshot.indicators || [])
    .filter((item) => Math.abs(Number(item.signal) || 0) >= 0.7)
    .slice(0, 6)
    .forEach((item) => keys.push(`indicator:${item.name}:${item.signal > 0 ? "up" : "down"}`));
  return keys;
}

function summarizeBotPerformance(bot) {
  const closed = (bot.history || []).map(normalizeBotTradeRecord);
  const wins = closed.filter((trade) => trade.pnl >= 0).length;
  const losses = closed.length - wins;
  const totalPnl = closed.reduce((sum, trade) => sum + trade.pnl, 0);
  const totalR = closed.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const targetCount = closed.filter((trade) => trade.exitReason === "target").length;
  const stopCount = closed.filter((trade) => trade.exitReason === "stop").length;
  const recent = closed.slice(-BOT_RECENT_WINDOW);
  const recentR = recent.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const featureMap = new Map();

  closed.forEach((trade) => {
    tradeFeatureKeysFromSnapshot(trade.snapshot).forEach((key) => {
      const item = featureMap.get(key) || { key, trades: 0, wins: 0, totalR: 0, pnl: 0 };
      item.trades += 1;
      if (trade.pnl >= 0) item.wins += 1;
      item.totalR += trade.rMultiple;
      item.pnl += trade.pnl;
      featureMap.set(key, item);
    });
  });

  const edges = [...featureMap.values()].map((item) => ({
    ...item,
    winRate: item.trades ? (item.wins / item.trades) * 100 : 0,
    avgR: item.trades ? item.totalR / item.trades : 0,
  }));

  const strongEdges = edges
    .filter((item) => item.trades >= BOT_LEARNING_MIN_TRADES && item.avgR > 0.08)
    .sort((a, b) => b.avgR - a.avgR)
    .slice(0, 5);
  const weakEdges = edges
    .filter((item) => item.trades >= BOT_LEARNING_MIN_TRADES && item.avgR < -0.08)
    .sort((a, b) => a.avgR - b.avgR)
    .slice(0, 5);

  return {
    trades: closed.length,
    wins,
    losses,
    winRate: closed.length ? (wins / closed.length) * 100 : 0,
    totalPnl,
    avgR: closed.length ? totalR / closed.length : 0,
    targetRate: closed.length ? (targetCount / closed.length) * 100 : 0,
    stopRate: closed.length ? (stopCount / closed.length) * 100 : 0,
    recentTrades: recent.length,
    recentAvgR: recent.length ? recentR / recent.length : 0,
    strongEdges,
    weakEdges,
  };
}

function botLearningProfile(bot) {
  const performance = summarizeBotPerformance(bot);
  if (performance.trades < BOT_LEARNING_MIN_TRADES) {
    return {
      ...performance,
      ready: false,
      summary: `학습 대기: 최소 ${BOT_LEARNING_MIN_TRADES}건 이상 청산 기록이 쌓이면 조건별 보정이 시작됩니다.`,
    };
  }

  const recentText = performance.recentAvgR >= 0
    ? `최근 ${performance.recentTrades}건 평균 ${fmt.format(performance.recentAvgR)}R로 우호적입니다.`
    : `최근 ${performance.recentTrades}건 평균 ${fmt.format(performance.recentAvgR)}R라 진입 점수를 보수적으로 낮춥니다.`;
  const edgeText = performance.strongEdges[0]
    ? `강한 조건: ${performance.strongEdges[0].key.replaceAll(":", " ")}`
    : "강한 조건은 아직 선별 중입니다.";
  const weakText = performance.weakEdges[0]
    ? `취약 조건: ${performance.weakEdges[0].key.replaceAll(":", " ")}`
    : "뚜렷한 취약 조건은 아직 없습니다.";

  return {
    ...performance,
    ready: true,
    summary: `${recentText} ${edgeText}. ${weakText}.`,
  };
}

function botStrategyScore(bot, plan, analysis) {
  const validation = plan?.validationBacktest || plan?.backtest || {};
  const entry = tradeEntryReference(plan);
  const tpMovePct = entry > 0 ? Math.abs((plan.takeProfit1 || entry) - entry) / entry * 100 : 0;
  const atrPct = analysis?.price > 0 ? (analysis.atr / analysis.price) * 100 : 0;
  const indicators = analysis?.indicators || [];
  const namedSignal = (pattern) => indicators.find((item) => item.name.includes(pattern))?.signal || 0;
  const trendAlignment =
    (plan.side === "long" ? 1 : -1) *
    (namedSignal("EMA") + namedSignal("ADX") + namedSignal("VWAP") + namedSignal("Supertrend"));

  if (bot.id === "alpha") {
    return (validation.winRate || 0) * 1.9 + (plan.validationPass ? 28 : -8) + (validation.profitFactor || 0) * 8;
  }
  if (bot.id === "beta") {
    return (validation.winRate || 0) + (validation.expectancyR || 0) * 24 + (plan.rr || 0) * 8;
  }
  if (bot.id === "gamma") {
    return (plan.rr || 0) * 30 + (plan.breakoutLong || plan.breakdownShort ? 14 : 0) + (validation.expectancyR || 0) * 14;
  }
  if (bot.id === "delta") {
    return 60 - Math.min(28, tpMovePct * 8) + (atrPct < 1.2 ? 14 : -8) + (validation.winRate || 0) * 0.8;
  }
  if (bot.id === "epsilon") {
    return trendAlignment * 10 + (analysis?.confidence || 0) * 0.8 + (plan.rr || 0) * 10;
  }
  if (bot.id === "zeta") {
    return Math.min(45, (validation.trades || 0) * 0.75) + (validation.profitFactor || 0) * 18 + (plan.validationPass ? 20 : -12);
  }
  return botTradePlanKey(bot, plan);
}

function botLearningAdjustment(bot, plan, analysis) {
  const profile = botLearningProfile(bot);
  if (!profile.ready) return 0;
  const snapshot = buildTradeSnapshot({ bot, analysis, plan, entry: tradeEntryReference(plan), reason: "score-preview" });
  const keys = new Set(tradeFeatureKeysFromSnapshot(snapshot));
  const matchingStrong = profile.strongEdges.filter((edge) => keys.has(edge.key));
  const matchingWeak = profile.weakEdges.filter((edge) => keys.has(edge.key));
  const strongBonus = matchingStrong.reduce((sum, edge) => sum + clamp(edge.avgR * 10 + (edge.winRate - 50) * 0.12, 1, 8), 0);
  const weakPenalty = matchingWeak.reduce((sum, edge) => sum + clamp(Math.abs(edge.avgR) * 12 + (50 - edge.winRate) * 0.12, 2, 10), 0);
  const recentBias = clamp(profile.recentAvgR * 10, -12, 12);
  return clamp(strongBonus - weakPenalty + recentBias, -30, 24);
}

function botStrategyLabel(strategy) {
  if (strategy === "winrate") return "승률 우선";
  if (strategy === "expectancy") return "기대값 우선";
  if (strategy === "rr") return "손익비 우선";
  return "시나리오";
}

function botProfileLabel(bot) {
  const labels = {
    alpha: "검증 통과와 승률을 가장 먼저 봅니다.",
    beta: "기대값과 승률의 균형을 봅니다.",
    gamma: "R/R과 돌파형 시나리오를 선호합니다.",
    delta: "짧은 TP와 빠른 재진입 조건을 선호합니다.",
    epsilon: "추세, ADX, EMA/VWAP 정렬을 우선합니다.",
    zeta: "1년 표본 수와 profit factor를 강하게 봅니다.",
  };
  return labels[bot.id] || "봇별 기록 기반 보정을 적용합니다.";
}

function botTradePlanKey(bot, plan) {
  const validation = plan.validationBacktest || plan.backtest || {};
  if (bot.strategy === "winrate") {
    return (validation.winRate || 0) * 2 + (validation.expectancyR || 0) * 10 + (plan.validationPass ? 25 : 0);
  }
  if (bot.strategy === "expectancy") {
    return (validation.expectancyR || 0) * 18 + (validation.winRate || 0) + (plan.rr || 0) * 3;
  }
  return (plan.rr || 0) * 20 + (validation.expectancyR || 0) * 8 + (plan.validationPass ? 10 : 0);
}

function pickBotScenario(analysis, bot) {
  const scenarios = (analysis?.tradeScenarios || [analysis?.tradePlan].filter(Boolean)).slice(0, 3);
  if (!scenarios.length) return null;
  return scenarios
    .map((plan) => {
      const baseScore = botTradePlanKey(bot, plan);
      const strategyScore = botStrategyScore(bot, plan, analysis);
      const learningAdjustment = botLearningAdjustment(bot, plan, analysis);
      return { plan, score: baseScore + strategyScore + learningAdjustment, strategyScore, learningAdjustment };
    })
    .sort((a, b) => b.score - a.score)[0]?.plan || scenarios[0];
}

function botAllocatedCapital(bot) {
  return state.botDesk.settings.capital * bot.allocation;
}

function botAvailableCapital(bot) {
  return Math.max(0, botAllocatedCapital(bot) + (Number(bot.realizedPnl) || 0));
}

function botEquity(bot, price) {
  return botAllocatedCapital(bot) + (Number(bot.realizedPnl) || 0) + botOpenPnl(bot, price);
}

function botIsDepleted(bot, price = 0) {
  return botEquity(bot, price) <= 0 && !bot.openTrade;
}

function botRiskBudget(bot) {
  return botAvailableCapital(bot);
}

function botOpenPnl(bot, price) {
  const trade = bot.openTrade;
  if (!trade) return 0;
  const move = trade.side === "long" ? price - trade.entry : trade.entry - price;
  return move * trade.quantity;
}

function shouldOpenBotTrade(bot, analysis, plan) {
  if (!plan) return false;
  const validation = plan.validationBacktest || plan.backtest || {};
  const nearEntry = Math.abs(analysis.price - tradeEntryReference(plan)) <= Math.max(analysis.atr * 0.35, analysis.price * 0.0015);
  const inRange = analysis.price >= plan.entryLow && analysis.price <= plan.entryHigh;
  const priceOk = inRange || nearEntry;
  const confidenceOk = analysis.confidence >= (bot.strategy === "rr" ? 42 : 48);

  if (bot.strategy === "winrate") {
    return priceOk && confidenceOk && plan.validationPass && validation.winRate >= 55 && validation.expectancyR > 0;
  }
  if (bot.strategy === "expectancy") {
    return priceOk && confidenceOk && validation.expectancyR > 0.2 && validation.winRate >= 50;
  }
  return priceOk && confidenceOk && (plan.rr || 0) >= 1.4 && validation.expectancyR > 0;
}

function pickBotTarget(bot, plan, entry, analysis) {
  const targets = bot.strategy === "rr"
    ? [plan.takeProfit3, plan.takeProfit2, plan.takeProfit1]
    : bot.strategy === "expectancy"
      ? [plan.takeProfit2, plan.takeProfit1, plan.takeProfit3]
      : [plan.takeProfit1, plan.takeProfit2, plan.takeProfit3];
  const validTarget = targets.find((target) => Number.isFinite(target) && (plan.side === "short" ? target < entry : target > entry));
  if (validTarget) return validTarget;
  const fallbackMove = Math.max(analysis?.atr || entry * 0.004, entry * 0.0025);
  return plan.side === "short" ? entry - fallbackMove * 1.5 : entry + fallbackMove * 1.5;
}

function pickBotStop(plan, entry, analysis) {
  if (Number.isFinite(plan.stopLoss) && (plan.side === "short" ? plan.stopLoss > entry : plan.stopLoss < entry)) {
    return plan.stopLoss;
  }
  const fallbackMove = Math.max(analysis?.atr || entry * 0.004, entry * 0.0025);
  return plan.side === "short" ? entry + fallbackMove : entry - fallbackMove;
}

function openBotTrade(bot, analysis, plan, candle, reason = "live") {
  if (bot.openTrade) return false;

  const margin = botRiskBudget(bot);
  if (!Number.isFinite(margin) || margin <= 0) return false;
  const leverage = Math.max(1, Number(state.botDesk.settings.leverage) || 1);
  const notional = margin * leverage;
  const entry = candle?.close ?? analysis.price;
  const quantity = entry > 0 ? notional / entry : 0;
  const stopLoss = pickBotStop(plan, entry, analysis);
  const takeProfit = pickBotTarget(bot, plan, entry, analysis);
  const riskUsd = Math.abs(entry - stopLoss) * quantity;

  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(riskUsd) || riskUsd <= 0) return false;

  const snapshot = buildTradeSnapshot({ bot, analysis, plan, entry, reason });
  snapshot.decision.strategyScore = botStrategyScore(bot, plan, analysis);
  snapshot.decision.learningAdjustment = botLearningAdjustment(bot, plan, analysis);
  snapshot.decision.finalScore = botTradePlanKey(bot, plan) + snapshot.decision.strategyScore + snapshot.decision.learningAdjustment;

  bot.openTrade = {
    entry,
    side: plan.side,
    stopLoss,
    takeProfit,
    quantity,
    notional,
    riskUsd,
    openedAt: candle?.time ?? Date.now(),
    interval: state.interval,
    scenarioId: plan.scenarioId,
    scenarioName: plan.scenarioName,
    scenarioLabel: plan.scenarioLabel,
    reason,
    snapshot,
  };
  bot.lastTradeTime = candle?.time ?? Date.now();
  return true;
}

function closeBotTrade(bot, exitPrice, candle, exitReason) {
  const trade = bot.openTrade;
  if (!trade) return false;
  const gross = trade.side === "long"
    ? (exitPrice - trade.entry) * trade.quantity
    : (trade.entry - exitPrice) * trade.quantity;
  const costRate = ((state.risk.feePct || 0) + (state.risk.slippagePct || 0)) / 100;
  const cost = trade.notional * costRate;
  const pnl = gross - cost;
  const rMultiple = trade.riskUsd > 0 ? pnl / trade.riskUsd : 0;
  const closeSnapshot = buildCloseSnapshot(trade, exitPrice, candle, exitReason, pnl, rMultiple);

  bot.trades += 1;
  if (pnl >= 0) bot.wins += 1;
  else bot.losses += 1;
  bot.realizedPnl += pnl;
  bot.history.push({
    time: candle?.time ?? Date.now(),
    interval: trade.interval,
    side: trade.side,
    scenarioName: trade.scenarioName,
    scenarioLabel: trade.scenarioLabel,
    entry: trade.entry,
    exit: exitPrice,
    pnl,
    rMultiple,
    exitReason,
    snapshot: trade.snapshot || null,
    closeSnapshot,
    holdingMinutes: closeSnapshot.holdingMinutes,
  });
  bot.openTrade = null;
  bot.lastTradeTime = candle?.time ?? Date.now();
  return true;
}

function updateBotDeskOnCandle(candle, analysis) {
  if (!analysis) return;
  let changed = false;

  state.botDesk.bots.forEach((bot) => {
    if (bot.openTrade && bot.lastTradeTime !== candle.time) {
      const trade = bot.openTrade;
      const stopHit = trade.side === "long" ? candle.low <= trade.stopLoss : candle.high >= trade.stopLoss;
      const targetHit = trade.side === "long" ? candle.high >= trade.takeProfit : candle.low <= trade.takeProfit;

      if (stopHit || targetHit) {
        let exitReason = stopHit ? "stop" : "target";
        let exitPrice = stopHit ? trade.stopLoss : trade.takeProfit;
        if (stopHit && targetHit) {
          exitReason = candle.close >= candle.open ? "target" : "stop";
          exitPrice = exitReason === "target" ? trade.takeProfit : trade.stopLoss;
        }
        changed = closeBotTrade(bot, exitPrice, candle, exitReason) || changed;
      }
    }
  });

  if (!state.botDesk.running) {
    if (changed) saveBotDeskState();
    return;
  }

  const hasTradableCapital = state.botDesk.bots.some((bot) => bot.openTrade || !botIsDepleted(bot, candle.close));
  if (!hasTradableCapital) {
    state.botDesk.running = false;
    saveBotDeskState();
    return;
  }

  state.botDesk.bots.forEach((bot) => {
    if (bot.openTrade || bot.lastTradeTime === candle.time || botIsDepleted(bot, candle.close)) return;
    const plan = pickBotScenario(analysis, bot);
    if (plan) {
      changed = openBotTrade(bot, analysis, plan, candle, "live") || changed;
    }
  });

  if (changed) {
    saveBotDeskState();
  }
}

function seedBotDeskFromCurrentAnalysis(analysis) {
  if (!state.botDesk.running) return;
  if (!analysis || state.botDesk.seeded) return;
  const hasActivity = state.botDesk.bots.some((bot) => bot.trades > 0 || bot.history.length > 0 || bot.openTrade);
  if (hasActivity) {
    state.botDesk.seeded = true;
    saveBotDeskState();
    return;
  }

  state.botDesk.bots.forEach((bot) => {
    if (botIsDepleted(bot, analysis.price)) return;
    const plan = pickBotScenario(analysis, bot);
    if (plan) {
      openBotTrade(bot, analysis, plan, { time: Date.now(), close: analysis.price }, "seed");
    } else {
      bot.history.push({
        time: Date.now(),
        interval: state.interval,
        side: plan?.side || "neutral",
        scenarioName: plan?.scenarioName || "대기",
        scenarioLabel: plan?.scenarioLabel || bot.name,
        entry: analysis.price,
        exit: analysis.price,
        pnl: 0,
        rMultiple: 0,
        exitReason: "snapshot",
      });
    }
  });
  state.botDesk.seeded = true;
  saveBotDeskState();
}

function startBotDeskTrading() {
  const analysis = getDisplayAnalysis() || state.analyses[state.interval];
  if (!analysis) return;
  state.botDesk.running = true;
  state.botDesk.seeded = true;
  const candle = { time: Date.now(), close: analysis.price };
  let changed = false;

  state.botDesk.bots.forEach((bot) => {
    if (bot.openTrade || botIsDepleted(bot, analysis.price)) return;
    const plan = pickBotScenario(analysis, bot);
    if (plan) changed = openBotTrade(bot, analysis, plan, candle, "manual-start") || changed;
  });

  saveBotDeskState();
  if (changed) renderAll();
  else renderBotDesk();
}

function pauseBotDeskTrading() {
  state.botDesk.running = false;
  saveBotDeskState();
  renderBotDesk();
}

function exportBotDeskRecords() {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "btc-signal-desk",
    version: 2,
    botDesk: state.botDesk,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `btc-bot-records-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importBotDeskRecords(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      const imported = parsed.botDesk || parsed;
      state.botDesk = hydrateBotDesk(imported);
      state.risk.accountSize = state.botDesk.settings.capital;
      saveBotDeskState();
      renderBotDesk();
    } catch {
      window.alert("봇 기록 파일을 읽지 못했습니다. Export records로 받은 JSON 파일인지 확인해 주세요.");
    } finally {
      if (els.botImportInput) els.botImportInput.value = "";
    }
  });
  reader.readAsText(file);
}

function botTradeDisplayName(trade) {
  const rawName = trade?.scenarioName || trade?.name || "Scenario";
  const side = String(trade?.side || "").toUpperCase();
  if (!side || rawName.toUpperCase().includes(side)) return rawName;
  return `${side} · ${rawName}`;
}

function renderBotDesk() {
  if (!els.botGrid) return;
  const bots = state.botDesk.bots || [];
  const analysis = getDisplayAnalysis() || state.analyses[state.interval];
  const price = analysis?.price || 0;
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const totalPnL = bots.reduce((sum, bot) => sum + bot.realizedPnl + botOpenPnl(bot, price), 0);
  const totalEquity = bots.reduce((sum, bot) => sum + Math.max(0, botEquity(bot, price)), 0);
  const depletedBots = bots.filter((bot) => botIsDepleted(bot, price)).length;
  const activeBots = bots.length - depletedBots;
  const runningLabel = state.botDesk.running ? "RUNNING" : "PAUSED";
  els.botDeskSummary.textContent = `${runningLabel} · ${fmtInt.format(activeBots)}/${fmtInt.format(bots.length)} active bots · ${fmtInt.format(totalTrades)} trades · 승률 ${totalTrades ? fmt.format((totalWins / totalTrades) * 100) : "0"}% · 누적손익 ${fmtUsd.format(totalPnL)} · 잔여자산 ${fmtUsd.format(totalEquity)}`;

  els.botCapitalInput.value = fmtInt.format(state.botDesk.settings.capital);
  els.botLeverageInput.value = fmt.format(state.botDesk.settings.leverage);
  els.botStartBtn.disabled = state.botDesk.running || activeBots <= 0;
  els.botPauseBtn.disabled = !state.botDesk.running;

  els.botGrid.innerHTML = bots.map((bot) => {
    const openTrade = bot.openTrade;
    const openPnl = botOpenPnl(bot, price);
    const openPnlClass = openPnl > 0 ? "positive" : openPnl < 0 ? "negative" : "neutral";
    const history = [...bot.history].reverse();
    const recent = history.slice(0, 8);
    const currentValue = botEquity(bot, price);
    const depleted = botIsDepleted(bot, price);
    const winRate = bot.trades ? (bot.wins / bot.trades) * 100 : 0;
    const historyOpen = state.botDesk.activeHistoryBotId === bot.id;
    const learning = botLearningProfile(bot);

    return `
      <article class="bot-card ${openTrade ? "is-hot" : "is-cold"} ${depleted ? "is-depleted" : ""}">
        <div class="section-head">
          <h3>${bot.name}</h3>
          <span class="badge ${openTrade ? "bullish" : depleted ? "bearish" : state.botDesk.running ? "neutral" : "bearish"}">${openTrade ? "운용 중" : depleted ? "자산 소진" : state.botDesk.running ? "즉시 재진입" : "중단"}</span>
        </div>
        <div class="bot-meta">
          <div class="bot-line"><span>전략</span><strong>${botStrategyLabel(bot.strategy)}</strong></div>
          <div class="bot-line"><span>가용 자산</span><strong>${fmtUsd.format(Math.max(0, currentValue))}</strong></div>
          <div class="bot-line"><span>레버리지</span><strong>${fmt.format(state.botDesk.settings.leverage)}x</strong></div>
          <div class="bot-line"><span>초기 배분</span><strong>${fmtUsd.format(botAllocatedCapital(bot))}</strong></div>
        </div>
        <div class="bot-stats">
          <div class="bot-line"><span>누적 손익</span><strong class="${bot.realizedPnl >= 0 ? "positive" : "negative"}">${fmtUsd.format(bot.realizedPnl)}</strong></div>
          <div class="bot-line"><span>승률</span><strong>${fmt.format(winRate)}%</strong></div>
          <div class="bot-line"><span>거래 수</span><strong>${fmtInt.format(bot.trades)}회</strong></div>
        </div>
        <div class="bot-learning">
          <strong>${botProfileLabel(bot)}</strong>
          <span>${learning.summary}</span>
        </div>
        <div class="bot-open">
          <div class="bot-line"><span>현재 시나리오</span><strong>${openTrade ? botTradeDisplayName(openTrade) : "대기"}</strong></div>
          <div class="bot-line"><span>미실현 손익</span><strong class="${openPnlClass}">${fmtUsd.format(openPnl)}</strong></div>
          ${openTrade ? `
            <div class="bot-line"><span>진입 / 목표</span><strong>${fmtUsd.format(openTrade.avgEntry || openTrade.entry)} → ${fmtUsd.format(openTrade.takeProfit)}</strong></div>
            <div class="bot-line"><span>분할 진입</span><strong>${botScaleInSummary(openTrade)}</strong></div>
            <div class="bot-line"><span>분할 익절</span><strong>${botPartialExitSummary(openTrade)}</strong></div>
            <div class="bot-line"><span>손절</span><strong>${fmtUsd.format(openTrade.stopLoss)}</strong></div>
            <div class="bot-line"><span>손실 한도</span><strong>${fmtUsd.format(openTrade.riskUsd || 0)} / ${fmtUsd.format(openTrade.maxRiskUsd || 0)}</strong></div>
          ` : `
            <div class="bot-line"><span>진입 상태</span><strong>${bot.lastSkipReason || (state.botDesk.running ? "조건 확인 중" : "일시중단")}</strong></div>
          `}
        </div>
        <div class="bot-history">
          <button class="history-toggle ${historyOpen ? "is-active" : ""}" type="button" data-bot-history="${bot.id}" aria-pressed="${historyOpen ? "true" : "false"}">
            ${historyOpen ? "기록 닫기" : "기록 보기"} · ${fmtInt.format(bot.history.length)}건
          </button>
          ${historyOpen ? `
            <div class="bot-trades">
              ${recent.length ? recent.map((trade) => `
                <div class="trade-pill">
                  <div>
                    <span>${botTradeDisplayName(trade)} · ${trade.exitReason}</span>
                    <small>${fmtUsd.format(trade.entry)} → ${fmtUsd.format(trade.exit)} · ${fmt.format(trade.rMultiple)}R</small>
                  </div>
                  <strong class="${trade.pnl >= 0 ? "positive" : "negative"}">${fmtUsd.format(trade.pnl)}</strong>
                </div>
              `).join("") : `<div class="trade-pill"><span>기록 대기 중</span><strong class="neutral">-</strong></div>`}
            </div>
          ` : ""}
        </div>
      </article>
    `;
  }).join("");
  renderBotHistoryPanel();
}

function renderLearningEdges(profile) {
  const strong = profile.strongEdges?.length
    ? profile.strongEdges.map((edge) => `<li><span>${edge.key.replaceAll(":", " ")}</span><strong>${fmt.format(edge.avgR)}R / ${fmt.format(edge.winRate)}%</strong></li>`).join("")
    : `<li><span>강한 조건 수집 중</span><strong>-</strong></li>`;
  const weak = profile.weakEdges?.length
    ? profile.weakEdges.map((edge) => `<li><span>${edge.key.replaceAll(":", " ")}</span><strong>${fmt.format(edge.avgR)}R / ${fmt.format(edge.winRate)}%</strong></li>`).join("")
    : `<li><span>취약 조건 수집 중</span><strong>-</strong></li>`;
  return `
    <div class="learning-edge-grid">
      <section><h4>가산 조건</h4><ul>${strong}</ul></section>
      <section><h4>감점 조건</h4><ul>${weak}</ul></section>
    </div>
  `;
}

function renderTradeSnapshotDetails(trade) {
  const snapshot = trade.snapshot;
  if (!snapshot) {
    return `<div class="history-snapshot-empty">이전 버전 거래라 당시 지표 스냅샷이 없습니다. 새 거래부터 자동 저장됩니다.</div>`;
  }
  const market = snapshot.market || {};
  const scenario = snapshot.scenario || {};
  const validation = snapshot.validation || {};
  const backtest = snapshot.backtest || {};
  const onchain = snapshot.onchain || {};
  const close = trade.closeSnapshot || {};
  const topIndicators = (snapshot.indicators || [])
    .slice()
    .sort((a, b) => Math.abs(b.points || 0) - Math.abs(a.points || 0))
    .slice(0, 8)
    .map((item) => `<li><span>${item.name}<small>${item.reading}</small></span><strong>${scoreLabel(item.signal)}</strong></li>`)
    .join("");

  return `
    <div class="history-snapshot">
      <div class="snapshot-grid">
        <div><span>진입 상황</span><strong>${market.interval || "-"} · ${fmtUsd.format(market.price || trade.entry)}</strong><small>Score ${market.compositeScore || 0}/100 · Confidence ${market.confidence || 0}% · ${market.bias || "neutral"}</small></div>
        <div><span>가격 구조</span><strong>${fmtUsd.format(market.support || 0)} / ${fmtUsd.format(market.resistance || 0)}</strong><small>ATR ${fmtUsd.format(market.atr || 0)} · ${fmt.format(market.atrPct || 0)}%</small></div>
        <div><span>시나리오</span><strong>${scenario.name || trade.scenarioName || "-"}</strong><small>Entry ${fmtUsd.format(scenario.entry || trade.entry)} · TP ${fmtUsd.format(scenario.takeProfit1 || 0)} · SL ${fmtUsd.format(scenario.stopLoss || 0)}</small></div>
        <div><span>1년 검증</span><strong>${fmt.format(validation.winRate || 0)}% · ${fmt.format(validation.expectancyR || 0)}R</strong><small>${fmtInt.format(validation.trades || 0)} samples · PF ${fmt.format(validation.profitFactor || 0)}</small></div>
        <div><span>과거 유사 조건</span><strong>${fmt.format(backtest.winRate || 0)}% · ${fmt.format(backtest.expectancyR || 0)}R</strong><small>${fmtInt.format(backtest.trades || 0)} samples · PF ${fmt.format(backtest.profitFactor || 0)}</small></div>
        <div><span>청산</span><strong>${trade.exitReason || "-"} · ${fmt.format(trade.rMultiple || 0)}R</strong><small>${fmt.format(close.holdingMinutes || trade.holdingMinutes || 0)} min · ${fmtUsd.format(trade.pnl || 0)}</small></div>
      </div>
      <div class="snapshot-note"><strong>진입 근거</strong><span>${scenario.summary || "시나리오와 지표 합의도를 기준으로 진입했습니다."}</span></div>
      <div class="snapshot-note"><strong>온체인</strong><span>${fmtInt.format(onchain.score || 50)}/100 · ${(onchain.notes || []).join(" · ") || "온체인 메모 없음"}</span></div>
      <ul class="snapshot-indicators">${topIndicators || `<li><span>지표 스냅샷 없음</span><strong>-</strong></li>`}</ul>
    </div>
  `;
}

function renderBotHistoryPanel() {
  if (!els.botHistoryPanel) return;
  const bot = (state.botDesk.bots || []).find((item) => item.id === state.botDesk.activeHistoryBotId);
  if (!bot) {
    els.botHistoryPanel.innerHTML = "";
    return;
  }

  const profile = botLearningProfile(bot);
  const history = [...bot.history].map(normalizeBotTradeRecord).reverse();
  const totalPnl = bot.history.reduce((sum, trade) => sum + (Number(trade.pnl) || 0), 0);
  const bestTrade = bot.history.reduce((best, trade) => Math.max(best, Number(trade.pnl) || 0), 0);
  const worstTrade = bot.history.reduce((worst, trade) => Math.min(worst, Number(trade.pnl) || 0), 0);

  els.botHistoryPanel.innerHTML = `
    <section class="history-detail">
      <div class="section-head">
        <h3>${bot.name} 매매 기록</h3>
        <span class="muted">${fmtInt.format(bot.history.length)}건 · 손익 ${fmtUsd.format(totalPnl)}</span>
      </div>
      <div class="history-summary">
        <div><span>최고 거래</span><strong class="${bestTrade >= 0 ? "positive" : "negative"}">${fmtUsd.format(bestTrade)}</strong></div>
        <div><span>최저 거래</span><strong class="${worstTrade >= 0 ? "positive" : "negative"}">${fmtUsd.format(worstTrade)}</strong></div>
        <div><span>승 / 패</span><strong>${fmtInt.format(bot.wins)} / ${fmtInt.format(bot.losses)}</strong></div>
        <div><span>평균 R</span><strong>${fmt.format(profile.avgR)}R</strong></div>
        <div><span>TP / SL</span><strong>${fmt.format(profile.targetRate)}% / ${fmt.format(profile.stopRate)}%</strong></div>
        <div><span>최근 평균</span><strong>${fmt.format(profile.recentAvgR)}R</strong></div>
      </div>
      <div class="history-learning">
        <strong>알고리즘 조정 요약</strong>
        <p>${profile.summary}</p>
        ${renderLearningEdges(profile)}
      </div>
      <div class="history-table">
        <div class="history-row history-head">
          <span>시나리오</span>
          <span>방향</span>
          <span>진입</span>
          <span>청산</span>
          <span>R</span>
          <span>손익</span>
        </div>
        ${history.length ? history.map((trade) => `
          <details class="history-entry">
            <summary class="history-row">
              <span>${botTradeDisplayName(trade)}</span>
              <span>${trade.side || "-"} · ${trade.exitReason || "-"}</span>
              <span>${fmtUsd.format(trade.entry)}</span>
              <span>${fmtUsd.format(trade.exit)}</span>
              <span>${fmt.format(trade.rMultiple || 0)}R</span>
              <strong class="${trade.pnl >= 0 ? "positive" : "negative"}">${fmtUsd.format(trade.pnl)}</strong>
            </summary>
            ${renderTradeSnapshotDetails(trade)}
          </details>
        `).join("") : `<div class="history-empty">아직 청산된 매매 기록이 없습니다.</div>`}
      </div>
    </section>
  `;
}
function buildExecutionChecklist(analysis, risk) {
  const plan = analysis.tradePlan;
  const backtest = plan.backtest || { trades: 0, winRate: 0, expectancyR: 0 };
  const validation = plan.validationBacktest || backtest;
  const volumeSignal = getIndicator(analysis, "거래량 돌파")?.signal || 0;
  const adxSignal = getIndicator(analysis, "ADX 방향성")?.reading || "";
  const inEntryZone = analysis.price >= plan.entryLow && analysis.price <= plan.entryHigh;
  const rrOk = risk.netRr >= 1.2;
  const costPct = risk.notional > 0 ? (risk.totalCost / risk.notional) * 100 : 0;
  const stopTightEnough = risk.stopDistancePct <= 2.5;
  const scenarioClear = analysis.confidence >= 45;
  const validationOk = plan.validationPass && validation.trades >= 24 && validation.winRate >= 52 && validation.expectancyR > 0;
  const historicalEdgeOk = validationOk || (backtest.trades >= 12 && backtest.winRate >= 50 && backtest.expectancyR > 0);

  return [
    {
      label: "진입 트리거",
      detail: inEntryZone ? "현재가가 진입 구간 안에 있습니다." : "가격이 진입 구간에 들어올 때까지 대기합니다.",
      status: inEntryZone ? "충족" : "대기",
      type: inEntryZone ? "positive" : "neutral",
    },
    {
      label: "거래량 확인",
      detail: volumeSignal > 0 ? "상승 방향 거래량이 평균 대비 강합니다." : volumeSignal < 0 ? "하락 방향 거래량이 강해 반대 진입은 주의입니다." : "거래량 확증은 아직 약합니다.",
      status: volumeSignal !== 0 ? "확인" : "주의",
      type: volumeSignal > 0 ? "positive" : volumeSignal < 0 ? "negative" : "neutral",
    },
    {
      label: "손익비",
      detail: `수수료/슬리피지 반영 R/R은 1 : ${fmt.format(risk.netRr)}입니다.`,
      status: rrOk ? "충족" : "부족",
      type: rrOk ? "positive" : "negative",
    },
    {
      label: "손절폭",
      detail: `진입 기준 손절폭은 ${fmt.format(risk.stopDistancePct)}%입니다.`,
      status: stopTightEnough ? "관리 가능" : "넓음",
      type: stopTightEnough ? "positive" : "negative",
    },
    {
      label: "거래 비용",
      detail: `예상 비용은 명목가의 ${fmt.format(costPct)}%입니다. 작은 목표가에서는 비용 영향이 커집니다.`,
      status: costPct <= 0.2 ? "양호" : "주의",
      type: costPct <= 0.2 ? "positive" : "neutral",
    },
    {
      label: "1년 검증",
      detail: `검증 구간 ${plan.validationIntervalKey || "1h"} 기준 ${fmtInt.format(validation.trades)}건, 승률 ${fmt.format(validation.winRate)}%, 기대값 ${fmt.format(validation.expectancyR)}R입니다.`,
      status: validationOk ? "통과" : validation.trades >= 12 ? "재확인" : "표본 부족",
      type: validationOk ? "positive" : validation.trades >= 12 ? "neutral" : "negative",
    },
    {
      label: "과거 유사 패턴",
      detail: `표본 ${fmtInt.format(backtest.trades)}건 · 승률 ${fmt.format(backtest.winRate)}% · 기대값 ${fmt.format(backtest.expectancyR)}R`,
      status: historicalEdgeOk ? "우위" : backtest.trades >= 8 ? "재확인" : "표본 부족",
      type: historicalEdgeOk ? "positive" : backtest.trades >= 8 ? "neutral" : "negative",
    },
    {
      label: "신뢰도",
      detail: `지표 합의도 ${analysis.confidence}% · ADX 참고값 ${adxSignal}`,
      status: scenarioClear ? "충분" : "낮음",
      type: scenarioClear ? "positive" : "neutral",
    },
  ];
}

function addSeries(typeName, options) {
  const tv = window.LightweightCharts;
  if (state.chart.addSeries && tv[typeName]) return state.chart.addSeries(tv[typeName], options);
  const legacy = {
    CandlestickSeries: "addCandlestickSeries",
    HistogramSeries: "addHistogramSeries",
    LineSeries: "addLineSeries",
  };
  return state.chart[legacy[typeName]](options);
}

function initChart() {
  if (!window.LightweightCharts) {
    els.chart.innerHTML = '<div class="reason">TradingView 차트 라이브러리를 불러오지 못했습니다. 인터넷 연결 또는 CDN 차단 여부를 확인해 주세요.</div>';
    return;
  }

  state.chart = LightweightCharts.createChart(els.chart, {
    autoSize: true,
    layout: {
      background: { color: "#151a1d" },
      textColor: "#d8dfdc",
    },
    grid: {
      vertLines: { color: "#273033" },
      horzLines: { color: "#273033" },
    },
    crosshair: {
      mode: 1,
    },
    rightPriceScale: {
      borderColor: "#30383a",
    },
    timeScale: {
      borderColor: "#30383a",
      timeVisible: true,
      secondsVisible: false,
    },
  });

  state.series.candles = addSeries("CandlestickSeries", {
    upColor: "#42d392",
    downColor: "#ff6b6b",
    borderUpColor: "#42d392",
    borderDownColor: "#ff6b6b",
    wickUpColor: "#42d392",
    wickDownColor: "#ff6b6b",
  });
  state.series.volume = addSeries("HistogramSeries", {
    priceFormat: { type: "volume" },
    priceScaleId: "",
    scaleMargins: { top: 0.82, bottom: 0 },
  });
  state.series.ema20 = addSeries("LineSeries", { color: "#58c7d8", lineWidth: 2, priceLineVisible: false });
  state.series.ema50 = addSeries("LineSeries", { color: "#f2c94c", lineWidth: 2, priceLineVisible: false });
  state.series.ema200 = addSeries("LineSeries", { color: "#7aa7ff", lineWidth: 2, priceLineVisible: false });
  state.series.bbUpper = addSeries("LineSeries", { color: "rgba(180, 190, 198, 0.7)", lineWidth: 1, priceLineVisible: false });
  state.series.bbLower = addSeries("LineSeries", { color: "rgba(180, 190, 198, 0.7)", lineWidth: 1, priceLineVisible: false });
  state.series.vwap = addSeries("LineSeries", { color: "#c084fc", lineWidth: 2, priceLineVisible: false });
}

function toLineData(candles, values) {
  return candles
    .map((candle, index) => ({ time: candle.time, value: values[index] }))
    .filter((item) => Number.isFinite(item.value));
}

function getVisibleRange() {
  try {
    return state.chart?.timeScale().getVisibleLogicalRange?.() || null;
  } catch {
    return null;
  }
}

function restoreVisibleRange(range) {
  if (!range || !state.chart?.timeScale().setVisibleLogicalRange) return;
  try {
    state.chart.timeScale().setVisibleLogicalRange(range);
  } catch {
    // Ignore range restore errors from a newly initialized chart.
  }
}

function clearAutoLines() {
  if (!state.series.candles?.removePriceLine) return;
  state.autoLines.forEach((line) => state.series.candles.removePriceLine(line));
  state.autoLines = [];
}

function addAutoLine(price, title, color, style = 2) {
  if (!Number.isFinite(price) || !state.series.candles?.createPriceLine) return;
  state.autoLines.push(state.series.candles.createPriceLine({
    price,
    color,
    lineWidth: 2,
    lineStyle: style,
    axisLabelVisible: true,
    title,
  }));
}

function renderAutoLevels(analysis) {
  clearAutoLines();
  if (!state.levelsVisible) return;
  const plan = analysis.tradePlan;
  if (!plan) return;
  const scoreTag = Number.isFinite(plan.formulaScore) ? ` S${Math.round(plan.formulaScore)}` : "";

  addAutoLine(analysis.support, "Support", "#35d08f", 2);
  addAutoLine(analysis.resistance, "Resistance", "#ff5f6d", 2);
  if (plan.isCurrentEntry || plan.entryLow === plan.entryHigh) {
    addAutoLine(plan.entryHigh, `Current Entry${scoreTag}`, "#5ac8fa", 0);
  } else {
    addAutoLine(plan.entryLow, `Entry L${scoreTag}`, "#5ac8fa", 1);
    addAutoLine(plan.entryHigh, `Entry H${scoreTag}`, "#5ac8fa", 1);
  }
  addAutoLine(plan.takeProfit1, "TP1", "#f4bd50", 1);
  addAutoLine(plan.takeProfit2, "TP2", "#f4bd50", 2);
  addAutoLine(plan.takeProfit3, "TP3", "#f4bd50", 2);
  addAutoLine(plan.stopLoss, "SP/SL", "#ff5f6d", 0);
  if (plan.breakoutLong) addAutoLine(plan.breakoutLong, "Breakout", "#7aa7ff", 1);
  if (plan.breakdownShort) addAutoLine(plan.breakdownShort, "Breakdown", "#a78bfa", 1);
}

function focusCurrentLevels() {
  const candles = state.candlesByInterval[state.interval];
  if (!state.chart || !candles?.length) return;
  state.levelsVisible = true;
  const snapshot = captureCurrentEntry();
  if (!snapshot) return;
  renderAll();
  els.showLevelsBtn.textContent = "현재가 진입 고정됨";
  window.setTimeout(() => {
    els.showLevelsBtn.textContent = "현재가 진입 표시";
  }, 1400);
}

function focusRecommendedScenario() {
  const candles = state.candlesByInterval[state.interval];
  if (!state.chart || !candles?.length) return;
  activateRecommendedScenario();
  renderAll();
  els.recommendScenarioBtn.textContent = "추천 시나리오 표시됨";
  window.setTimeout(() => {
    els.recommendScenarioBtn.textContent = "추천 시나리오";
  }, 1400);
}

function renderChart({ fit = false } = {}) {
  if (!state.chart || !state.series.candles) return;
  const candles = state.candlesByInterval[state.interval];
  const analysis = state.analyses[state.interval];
  if (!candles || !analysis) return;
  const levelAnalysis = getDisplayAnalysis() || analysis;

  const visibleRange = getVisibleRange();

  state.series.candles.setData(candles);
  state.series.volume.setData(candles.map((candle) => ({
    time: candle.time,
    value: candle.volume,
    color: candle.close >= candle.open ? "rgba(66, 211, 146, 0.32)" : "rgba(255, 107, 107, 0.32)",
  })));

  state.series.ema20.setData(state.overlays.ema20 ? toLineData(candles, analysis.overlays.ema20) : []);
  state.series.ema50.setData(state.overlays.ema50 ? toLineData(candles, analysis.overlays.ema50) : []);
  state.series.ema200.setData(state.overlays.ema200 ? toLineData(candles, analysis.overlays.ema200) : []);
  state.series.bbUpper.setData(state.overlays.bb ? toLineData(candles, analysis.overlays.bands.upper) : []);
  state.series.bbLower.setData(state.overlays.bb ? toLineData(candles, analysis.overlays.bands.lower) : []);
  state.series.vwap.setData(state.overlays.vwap ? toLineData(candles, analysis.overlays.vwap) : []);
  renderAutoLevels(levelAnalysis);

  if (fit || !state.chartHasInitialFit) {
    state.chart.timeScale().fitContent();
    state.chartHasInitialFit = true;
  } else {
    restoreVisibleRange(visibleRange);
  }
}

function renderSummary() {
  const analysis = getDisplayAnalysis();
  if (!analysis) return;
  const plan = analysis.tradePlan;
  const backtest = plan.backtest || { trades: 0, winRate: 0, expectancyR: 0 };

  els.signalBadge.textContent = analysis.text;
  els.signalBadge.className = `badge ${analysis.bias}`;
  els.signalText.textContent = analysis.text;
  els.scoreText.textContent = `종합 점수 ${analysis.score} / 100`;
  els.meterFill.style.width = `${analysis.score}%`;
  els.meterFill.style.background = analysis.bias === "bullish" ? "var(--green)" : analysis.bias === "bearish" ? "var(--red)" : "var(--amber)";
  els.priceText.textContent = fmtUsd.format(analysis.price);
  els.changeText.textContent = `24h ${analysis.change24h >= 0 ? "+" : ""}${fmt.format(analysis.change24h)}%`;
  els.changeText.className = `change ${analysis.change24h > 0 ? "positive" : analysis.change24h < 0 ? "negative" : "neutral"}`;
  els.activeIntervalText.textContent = INTERVALS.find((item) => item.key === state.interval).label;
  els.updatedAt.textContent = new Date().toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  els.rangeText.textContent = `최근 ${state.candlesByInterval[state.interval]?.length || 0}개 ${state.interval} 캔들 · WebSocket 실시간 반영`;
  els.resistanceText.textContent = fmtUsd.format(analysis.resistance);
  els.supportText.textContent = fmtUsd.format(analysis.support);
  els.atrText.textContent = fmtUsd.format(analysis.atr);
  els.kpiEntryText.textContent = plan.isCurrentEntry || plan.entryLow === plan.entryHigh
    ? fmtUsd.format(plan.entryHigh)
    : `${fmtUsd.format(plan.entryLow)} ~ ${fmtUsd.format(plan.entryHigh)}`;
  els.kpiTp1Text.textContent = fmtUsd.format(plan.takeProfit1);
  els.kpiStopText.textContent = fmtUsd.format(plan.stopLoss);
  els.kpiSupportText.textContent = fmtUsd.format(analysis.support);
  els.kpiResistanceText.textContent = fmtUsd.format(analysis.resistance);

  const topPositive = analysis.indicators.filter((item) => item.signal > 0).length;
  const topNegative = analysis.indicators.filter((item) => item.signal < 0).length;
  const validation = analysis.tradePlan?.validationBacktest || backtest;
  const lockedText = analysis.entryLocked
    ? ` 현재가 진입은 ${new Date(analysis.entryCapturedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} 기준으로 고정되어 있습니다.`
    : "";
  const recommendedText = state.scenarioMode === "recommended" && !analysis.entryLocked
    ? ` 현재 선택한 ${INTERVALS.find((item) => item.key === state.interval).label} 추천 시나리오가 차트에 표시 중입니다.`
    : "";
  els.signalReason.textContent = `기술 지표 ${topPositive}개 상승, ${topNegative}개 하락 신호입니다. 온체인 보정 점수는 ${analysis.chain.score}/100이며, 현재 신뢰도는 ${analysis.confidence}%입니다. 1년 검증 승률은 ${fmt.format(validation.winRate)}%, 기대값은 ${fmt.format(validation.expectancyR)}R이고, 과거 유사 패턴 승률은 ${fmt.format(backtest.winRate)}%, 기대값은 ${fmt.format(backtest.expectancyR)}R입니다.${lockedText}${recommendedText}`;
}

function renderTradePlan() {
  const analysis = getDisplayAnalysis();
  if (!analysis?.tradePlan) return;
  const plan = analysis.tradePlan;
  const backtest = plan.backtest || { trades: 0, winRate: 0, expectancyR: 0, quality: "weak" };
  const validation = plan.validationBacktest || backtest;
  const risk = calculateRisk(analysis);
  const evidence = buildTradeEvidence(analysis);
  const checklist = buildExecutionChecklist(analysis, risk);
  const badgeType = plan.side === "long" ? "bullish" : plan.side === "short" ? "bearish" : "neutral";
  els.tradeSideBadge.textContent = plan.title;
  els.tradeSideBadge.className = `badge ${badgeType}`;
  const entryText = plan.isCurrentEntry
    ? `고정 진입가 ${fmtUsd.format(tradeEntryReference(plan))}`
    : `진입 구간 ${fmtUsd.format(plan.entryLow)} ~ ${fmtUsd.format(plan.entryHigh)}`;
  const scenarioText = plan.isCurrentEntry
    ? "현재가 기준 시나리오"
    : `추천 ${INTERVALS.find((item) => item.key === state.interval).label} 시나리오`;
  const validationText = plan.validationPass
    ? ` 1년 검증(${plan.validationIntervalKey || "1h"})을 통과했습니다.`
    : ` 1년 검증(${plan.validationIntervalKey || "1h"})은 아직 보수적으로 해석해야 합니다.`;
  const cautionText = !plan.validationPass
    ? " 최종 추천으로 보기엔 1년 검증이 아직 약합니다."
    : plan.isCurrentEntry && (backtest.expectancyR <= 0 || backtest.winRate < 50)
      ? " 현재가 즉시 진입은 과거 유사 패턴 기준 우위가 약해 보수적 대응이 필요합니다."
      : "";
  els.tradeSummary.textContent = `${scenarioText}. ${plan.summary}. ${entryText}, 실시간 현재가 ${fmtUsd.format(analysis.price)}, 신뢰도 ${analysis.confidence}%, 1년 검증 승률 ${fmt.format(validation.winRate)}%, 과거 유사 패턴 승률 ${fmt.format(backtest.winRate)}%, 표본 ${fmtInt.format(validation.trades)}건입니다.${validationText}${cautionText}`;

  els.tradeEvidenceList.innerHTML = evidence.map((item) => `
    <li>
      <strong class="${item.type}">${item.label}</strong>
      <span>${item.detail}</span>
    </li>
  `).join("");

  const rows = [
    ["Success Score", `${Math.round(plan.formulaScore ?? 0)}/100`, (plan.formulaScore ?? 0) >= 65 ? "positive" : "neutral"],
    ["진입", plan.isCurrentEntry || plan.entryLow === plan.entryHigh ? fmtUsd.format(plan.entryHigh) : `${fmtUsd.format(plan.entryLow)} ~ ${fmtUsd.format(plan.entryHigh)}`, "neutral"],
    ["익절 1", fmtUsd.format(plan.takeProfit1), "positive"],
    ["익절 2", fmtUsd.format(plan.takeProfit2), "positive"],
    ["익절 3", fmtUsd.format(plan.takeProfit3), "positive"],
    ["손절", fmtUsd.format(plan.stopLoss), "negative"],
    ["무효화", fmtUsd.format(plan.invalidation), "negative"],
    ["1년 승률", `${fmt.format(validation.winRate)}%`, validation.winRate >= 52 ? "positive" : "neutral"],
    ["1년 기대값", `${fmt.format(validation.expectancyR)}R`, validation.expectancyR > 0 ? "positive" : "negative"],
    ["1년 표본", `${fmtInt.format(validation.trades)}건`, validation.trades >= 24 ? "positive" : "neutral"],
    ["과거 승률", `${fmt.format(backtest.winRate)}%`, backtest.winRate >= 50 ? "positive" : "neutral"],
    ["과거 기대값", `${fmt.format(backtest.expectancyR)}R`, backtest.expectancyR > 0 ? "positive" : "negative"],
    ["과거 표본", `${fmtInt.format(backtest.trades)}건`, backtest.trades >= 12 ? "positive" : "neutral"],
  ];

  if (plan.breakoutLong) rows.splice(1, 0, ["상방 돌파", fmtUsd.format(plan.breakoutLong), "positive"]);
  if (plan.breakdownShort) rows.splice(2, 0, ["하방 이탈", fmtUsd.format(plan.breakdownShort), "negative"]);
  rows.push(["1Y PF", fmt.format(validation.profitFactor), validation.profitFactor >= 1.05 ? "positive" : "neutral"]);
  rows.push(["Avg Hold", `${fmt.format(validation.avgBarsHeld || backtest.avgBarsHeld || 0)} bars`, "neutral"]);
  if (plan.rr > 0) rows.push(["R/R", `1 : ${fmt.format(plan.rr)}`, "neutral"]);

  els.tradePlanList.innerHTML = rows.map(([label, value, type]) => `
    <div class="trade-row">
      <span>${label}</span>
      <strong class="${type}">${value}</strong>
    </div>
  `).join("");

  els.executionChecklist.innerHTML = checklist.map((item) => `
    <li>
      <strong class="${item.type}">${item.status}</strong>
      <span>${item.label}<small>${item.detail}</small></span>
    </li>
  `).join("");
}

function renderIndicators() {
  const analysis = state.analyses[state.interval];
  if (!analysis) return;
  els.indicatorList.innerHTML = analysis.indicators
    .map((item) => `
      <li>
        <span>${item.name}<small>${item.reading}</small></span>
        <strong class="${item.signal > 0 ? "positive" : item.signal < 0 ? "negative" : "neutral"}">${scoreLabel(item.signal)}</strong>
      </li>
    `)
    .join("");
}

function renderPredictions() {
  els.predictionGrid.innerHTML = INTERVALS.map((interval) => {
    const analysis = state.analyses[interval.key];
    if (!analysis) {
      return `<article class="prediction-card" data-interval-card="${interval.key}"><h3>${interval.label}</h3><strong>-</strong><p>분석 대기</p></article>`;
    }
    const backtest = analysis.tradePlan?.backtest || { winRate: 0, trades: 0 };
    const validation = analysis.tradePlan?.validationBacktest || backtest;
    return `
      <article class="prediction-card ${state.interval === interval.key ? "is-active" : ""}" data-interval-card="${interval.key}">
        <h3>${interval.label} 예측</h3>
        <strong class="${analysis.bias === "bullish" ? "positive" : analysis.bias === "bearish" ? "negative" : "neutral"}">${analysis.text}</strong>
        <span>점수 ${analysis.score}/100 · 신뢰도 ${analysis.confidence}% · 1년 승률 ${fmt.format(validation.winRate)}% · 승률 ${fmt.format(backtest.winRate)}%</span>
        <p>예상 중심 ${fmtUsd.format(analysis.target)}<br />범위 ${fmtUsd.format(analysis.rangeLow)} ~ ${fmtUsd.format(analysis.rangeHigh)}</p>
      </article>
    `;
  }).join("");
}

function renderScenarioButtons() {
  const analysis = compositeAnalysis();
  if (!analysis?.tradeScenarios?.length || state.scenarioMode === "current-entry") {
    if (els.scenarioButtons) els.scenarioButtons.innerHTML = "";
    return;
  }

  els.scenarioButtons.innerHTML = analysis.tradeScenarios.slice(0, 3).map((plan, index) => `
    <button
      class="scenario-chip ${index === analysis.selectedScenarioIndex ? "is-active" : ""}"
      type="button"
      data-scenario-index="${index}"
      aria-pressed="${index === analysis.selectedScenarioIndex ? "true" : "false"}"
    >
      <span>${plan.scenarioLabel || `시나리오 ${index + 1}`}</span>
      <small>${plan.scenarioName || "기본"} · ${plan.scenarioHint || `승률 ${fmt.format(plan.validationBacktest?.winRate ?? 0)}%`}</small>
    </button>
  `).join("");
}

function renderOnchain() {
  const chain = onchainScore(state.onchain);
  const items = [];
  const onchain = state.onchain;

  items.push(["온체인 보정 점수", `${chain.score}/100`]);
  if (onchain?.mempool) {
    items.push(["mempool 대기 거래", `${fmtInt.format(onchain.mempool.count || 0)}건`]);
    items.push(["mempool 가상 크기", `${fmt.format((onchain.mempool.vsize || 0) / 1_000_000)} MB`]);
  }
  if (onchain?.fees) {
    items.push(["빠른 수수료", `${onchain.fees.fastestFee} sat/vB`]);
    items.push(["1시간 수수료", `${onchain.fees.hourFee} sat/vB`]);
  }
  if (onchain?.difficulty?.difficultyChange !== undefined) {
    items.push(["난이도 예상 변화", `${fmt.format(onchain.difficulty.difficultyChange)}%`]);
  }
  if (onchain?.hashRate?.values?.length) {
    items.push(["최근 해시레이트", fmtInt.format(last(onchain.hashRate.values).y)]);
  }
  if (onchain?.transactions?.values?.length) {
    items.push(["최근 일일 트랜잭션", `${fmtInt.format(last(onchain.transactions.values).y)}건`]);
  }
  if (onchain?.minerRevenue?.values?.length) {
    items.push(["최근 채굴자 수익", fmtUsd.format(last(onchain.minerRevenue.values).y)]);
  }
  if (onchain?.partial) {
    items.push(["데이터 상태", "일부 공개 API 제한"]);
  }

  els.onchainGrid.innerHTML = items.map(([label, value]) => `
    <div class="metric"><span>${label}</span><strong>${value}</strong></div>
  `).join("");
}

function htmlSafe(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function gradeClass(grade) {
  if (grade === "A+") return "grade-aplus";
  if (grade === "A") return "grade-a";
  if (grade === "B") return "grade-b";
  return "grade-c";
}

function entryDisplay(plan) {
  if (!plan) return "-";
  if (plan.isCurrentEntry || plan.entryLow === plan.entryHigh) return fmtUsd.format(plan.entryHigh);
  return `${fmtUsd.format(plan.entryLow)} - ${fmtUsd.format(plan.entryHigh)}`;
}

function buildTradeEvidence(analysis) {
  const plan = analysis.tradePlan;
  const validation = plan.validationBacktest || plan.backtest || {};
  const backtest = plan.backtest || validation;
  const reasons = plan.reasons?.length ? plan.reasons : [
    `Validation win rate ${fmt.format(validation.winRate || 0)}% with ${fmtInt.format(validation.trades || 0)} samples`,
    `Current indicator confidence ${analysis.confidence}%`,
    `Entry range ${fmt.format(plan.entryRangePct || entryRangePct(plan, analysis.price))}%`,
  ];
  const risks = plan.risks?.length ? plan.risks : ["No high-probability risk filter has enough evidence yet."];
  return [
    {
      label: "Recommendation grade",
      detail: `${plan.grade || "C"} / simulated win ${fmt.format(plan.estimatedWinRate || validation.winRate || 0)}% / confidence ${analysis.confidence}%`,
      type: plan.highProbability ? "positive" : plan.grade === "B" ? "neutral" : "negative",
    },
    {
      label: "1Y validation",
      detail: `${fmtInt.format(validation.trades || 0)} samples / win ${fmt.format(validation.winRate || 0)}% / expectancy ${fmt.format(validation.expectancyR || 0)}R / PF ${fmt.format(validation.profitFactor || 0)} / avg MAE ${fmt.format(validation.avgAdverseR || 0)}R`,
      type: plan.validationPass ? "positive" : (validation.trades || 0) >= 12 ? "neutral" : "negative",
    },
    {
      label: "Similar pattern backtest",
      detail: `${fmtInt.format(backtest.trades || 0)} samples / win ${fmt.format(backtest.winRate || 0)}% / expectancy ${fmt.format(backtest.expectancyR || 0)}R / PF ${fmt.format(backtest.profitFactor || 0)}`,
      type: (backtest.expectancyR || 0) > 0 && (backtest.winRate || 0) >= 50 ? "positive" : "neutral",
    },
    {
      label: "Entry range",
      detail: `${entryDisplay(plan)} / width ${fmt.format(plan.entryRangePct || entryRangePct(plan, analysis.price))}% / ${plan.entryRangeStatus || "controlled"}`,
      type: plan.entryRangeWide ? "negative" : "positive",
    },
    {
      label: "Bot record adjustment",
      detail: plan.botAdjustment?.note || "Bot record sample is still too small for this setup.",
      type: (plan.botAdjustment?.adjustment || 0) > 0 ? "positive" : (plan.botAdjustment?.adjustment || 0) < 0 ? "negative" : "neutral",
    },
    {
      label: "On-chain context",
      detail: `${analysis.chain?.score ?? 50}/100 - ${(analysis.chain?.notes || []).slice(0, 2).join(" / ") || "public on-chain context pending"}`,
      type: (analysis.chain?.score || 50) >= 56 ? "positive" : (analysis.chain?.score || 50) <= 44 ? "negative" : "neutral",
    },
    {
      label: "Why this recommendation",
      detail: reasons.join(" | "),
      type: plan.highProbability ? "positive" : "neutral",
      details: reasons,
    },
    {
      label: "Entry avoidance risks",
      detail: risks.join(" | "),
      type: risks.length && !plan.highProbability ? "negative" : "neutral",
      details: risks,
    },
  ];
}

function buildExecutionChecklist(analysis, risk) {
  const plan = analysis.tradePlan;
  const validation = plan.validationBacktest || plan.backtest || {};
  const inEntryZone = analysis.price >= plan.entryLow && analysis.price <= plan.entryHigh;
  const risks = plan.risks?.length ? plan.risks : [];
  return [
    {
      label: "High-probability gate",
      detail: plan.highProbability ? "A/A+ gate passed: validation, trend agreement, and entry range are aligned." : "Gate did not pass. Treat this as wait-first simulation, not an aggressive entry.",
      status: plan.highProbability ? "PASS" : "WAIT",
      type: plan.highProbability ? "positive" : "negative",
    },
    {
      label: "Entry trigger",
      detail: inEntryZone ? "Current price is inside the planned entry range." : "Wait until price enters the planned entry range or forms a tighter retest.",
      status: inEntryZone ? "IN RANGE" : "WAIT",
      type: inEntryZone ? "positive" : "neutral",
    },
    {
      label: "Validation sample",
      detail: `${fmtInt.format(validation.trades || 0)} samples. Minimum ${RECOMMENDATION_MIN_SAMPLE}, strong ${RECOMMENDATION_STRONG_SAMPLE}.`,
      status: (validation.trades || 0) >= RECOMMENDATION_MIN_SAMPLE ? "OK" : "THIN",
      type: (validation.trades || 0) >= RECOMMENDATION_MIN_SAMPLE ? "positive" : "negative",
    },
    {
      label: "Entry width",
      detail: `${fmt.format(plan.entryRangePct || entryRangePct(plan, analysis.price))}% width. ${plan.entryRangeStatus || "Controlled"}.`,
      status: plan.entryRangeWide ? "WIDE" : "OK",
      type: plan.entryRangeWide ? "negative" : "positive",
    },
    {
      label: "Cost-adjusted R/R",
      detail: `Fee/slippage adjusted R/R is 1 : ${fmt.format(risk.netRr)}.`,
      status: risk.netRr >= 1.05 ? "OK" : "LOW",
      type: risk.netRr >= 1.05 ? "positive" : "negative",
    },
    {
      label: "Main risk",
      detail: risks[0] || "No major avoidance risk detected by the current simulation filters.",
      status: risks.length ? "CHECK" : "CLEAR",
      type: risks.length ? "negative" : "positive",
    },
  ];
}

function renderAutoLevels(analysis) {
  clearAutoLines();
  if (!state.levelsVisible) return;
  const plan = analysis.tradePlan;
  if (!plan) return;
  const gradeTag = plan.grade ? ` ${plan.grade}` : "";
  const scoreTag = Number.isFinite(plan.recommendationScore)
    ? ` S${Math.round(plan.recommendationScore)}`
    : Number.isFinite(plan.formulaScore) ? ` S${Math.round(plan.formulaScore)}` : "";

  addAutoLine(analysis.support, `Support${gradeTag}`, "#35d08f", 2);
  addAutoLine(analysis.resistance, `Resistance${gradeTag}`, "#ff5f6d", 2);
  if (plan.isCurrentEntry || plan.entryLow === plan.entryHigh) {
    addAutoLine(plan.entryHigh, `Entry${gradeTag}${scoreTag}`, "#5ac8fa", 0);
  } else {
    addAutoLine(plan.entryLow, `Entry L${gradeTag}${scoreTag}`, "#5ac8fa", 1);
    addAutoLine(plan.entryHigh, `Entry H${gradeTag}${scoreTag}`, "#5ac8fa", 1);
  }
  addAutoLine(plan.takeProfit1, `TP1${gradeTag}`, "#f4bd50", 1);
  addAutoLine(plan.takeProfit2, "TP2", "#f4bd50", 2);
  addAutoLine(plan.takeProfit3, "TP3", "#f4bd50", 2);
  addAutoLine(plan.stopLoss, `SL${gradeTag}`, "#ff5f6d", 0);
  if (plan.breakoutLong) addAutoLine(plan.breakoutLong, "Breakout trigger", "#7aa7ff", 1);
  if (plan.breakdownShort) addAutoLine(plan.breakdownShort, "Breakdown trigger", "#a78bfa", 1);
}

function renderSummary() {
  const analysis = getDisplayAnalysis();
  if (!analysis) return;
  const plan = analysis.tradePlan;
  const validation = plan.validationBacktest || plan.backtest || {};
  const backtest = plan.backtest || validation;
  const grade = plan.grade || "C";

  els.signalBadge.textContent = `${grade} ${plan.highProbability ? "Candidate" : "Wait"}`;
  els.signalBadge.className = `badge ${analysis.bias}`;
  els.signalText.textContent = analysis.text;
  els.scoreText.textContent = `Recommendation ${Math.round(plan.recommendationScore || plan.formulaScore || analysis.score)} / 100`;
  els.meterFill.style.width = `${clamp(plan.recommendationScore || analysis.score, 0, 100)}%`;
  els.meterFill.style.background = plan.highProbability ? "var(--green)" : grade === "B" ? "var(--amber)" : "var(--red)";
  els.priceText.textContent = fmtUsd.format(analysis.price);
  els.changeText.textContent = `24h ${analysis.change24h >= 0 ? "+" : ""}${fmt.format(analysis.change24h)}%`;
  els.changeText.className = `change ${analysis.change24h > 0 ? "positive" : analysis.change24h < 0 ? "negative" : "neutral"}`;
  els.activeIntervalText.textContent = INTERVALS.find((item) => item.key === state.interval).label;
  els.updatedAt.textContent = new Date().toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  els.rangeText.textContent = `${state.candlesByInterval[state.interval]?.length || 0} ${state.interval} candles / live update keeps chart position`;
  els.resistanceText.textContent = fmtUsd.format(analysis.resistance);
  els.supportText.textContent = fmtUsd.format(analysis.support);
  els.atrText.textContent = fmtUsd.format(analysis.atr);
  els.kpiEntryText.textContent = entryDisplay(plan);
  els.kpiTp1Text.textContent = fmtUsd.format(plan.takeProfit1);
  els.kpiStopText.textContent = fmtUsd.format(plan.stopLoss);
  els.kpiSupportText.textContent = fmtUsd.format(analysis.support);
  els.kpiResistanceText.textContent = fmtUsd.format(analysis.resistance);

  const lockedText = analysis.entryLocked
    ? ` Current entry is locked from ${new Date(analysis.entryCapturedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.`
    : "";
  const modeText = state.scenarioMode === "recommended" && !analysis.entryLocked
    ? ` ${INTERVALS.find((item) => item.key === state.interval).label} recommended scenario is displayed on the chart.`
    : "";
  els.signalReason.textContent = `This is a probability simulation, not investment advice. Grade ${grade}, estimated win ${fmt.format(plan.estimatedWinRate || validation.winRate || 0)}%, confidence ${analysis.confidence}%, 1Y validation ${fmt.format(validation.winRate || 0)}% / ${fmt.format(validation.expectancyR || 0)}R / PF ${fmt.format(validation.profitFactor || 0)}, similar pattern ${fmt.format(backtest.winRate || 0)}%. ${plan.highProbability ? "A/A+ gate passed." : "High-probability gate did not pass; waiting is preferred."}${lockedText}${modeText}`;
}

function renderTradePlan() {
  const analysis = getDisplayAnalysis();
  if (!analysis?.tradePlan) return;
  const plan = analysis.tradePlan;
  const validation = plan.validationBacktest || plan.backtest || {};
  const backtest = plan.backtest || validation;
  const risk = calculateRisk(analysis);
  const evidence = buildTradeEvidence(analysis);
  const checklist = buildExecutionChecklist(analysis, risk);
  const badgeType = plan.side === "long" ? "bullish" : plan.side === "short" ? "bearish" : "neutral";
  const grade = plan.grade || "C";

  els.tradeSideBadge.textContent = `${grade} ${plan.highProbability ? "Candidate" : "Wait"}`;
  els.tradeSideBadge.className = `badge ${badgeType} recommendation-grade ${gradeClass(grade)}`;
  els.tradeSummary.innerHTML = `
    <strong>${htmlSafe(plan.title || "Scenario")}</strong>
    <span>${htmlSafe(plan.summary || "")}</span>
    <span>Entry ${entryDisplay(plan)} / TP1 ${fmtUsd.format(plan.takeProfit1)} / SL ${fmtUsd.format(plan.stopLoss)} / support ${fmtUsd.format(analysis.support)} / resistance ${fmtUsd.format(analysis.resistance)}</span>
    <span>${plan.highProbability ? "A/A+ high-probability simulation candidate." : "Conditions are not strong enough; wait-first simulation is preferred."}</span>
  `;

  els.tradeEvidenceList.innerHTML = evidence.map((item) => `
    <li class="${item.details ? "evidence-expand" : ""}">
      ${item.details ? `
        <details>
          <summary><strong class="${item.type}">${htmlSafe(item.label)}</strong><span>${htmlSafe(item.detail)}</span></summary>
          <ul>${item.details.map((detail) => `<li>${htmlSafe(detail)}</li>`).join("")}</ul>
        </details>
      ` : `
        <strong class="${item.type}">${htmlSafe(item.label)}</strong>
        <span>${htmlSafe(item.detail)}</span>
      `}
    </li>
  `).join("");

  const rows = [
    ["Grade", grade, grade === "A+" || grade === "A" ? "positive" : grade === "B" ? "neutral" : "negative"],
    ["Estimated win", `${fmt.format(plan.estimatedWinRate || validation.winRate || 0)}%`, (plan.estimatedWinRate || 0) >= 55 ? "positive" : "neutral"],
    ["Confidence", `${analysis.confidence}%`, analysis.confidence >= 55 ? "positive" : "neutral"],
    ["Entry range", `${entryDisplay(plan)} (${fmt.format(plan.entryRangePct || entryRangePct(plan, analysis.price))}%)`, plan.entryRangeWide ? "negative" : "positive"],
    ["TP / SL", `${fmtUsd.format(plan.takeProfit1)} / ${fmtUsd.format(plan.stopLoss)}`, "neutral"],
    ["Support / Resistance", `${fmtUsd.format(analysis.support)} / ${fmtUsd.format(analysis.resistance)}`, "neutral"],
    ["1Y sample", fmtInt.format(validation.trades || 0), (validation.trades || 0) >= RECOMMENDATION_MIN_SAMPLE ? "positive" : "negative"],
    ["1Y win", `${fmt.format(validation.winRate || 0)}%`, (validation.winRate || 0) >= 55 ? "positive" : "neutral"],
    ["1Y PF", fmt.format(validation.profitFactor || 0), (validation.profitFactor || 0) >= 1.1 ? "positive" : "negative"],
    ["Expectancy", `${fmt.format(validation.expectancyR || 0)}R`, (validation.expectancyR || 0) > 0 ? "positive" : "negative"],
    ["Avg MAE", `${fmt.format(validation.avgAdverseR || 0)}R`, (validation.avgAdverseR || 0) <= 0.9 ? "positive" : "neutral"],
    ["Similar win", `${fmt.format(backtest.winRate || 0)}%`, (backtest.winRate || 0) >= 50 ? "positive" : "neutral"],
  ];

  if (plan.rr > 0) rows.push(["R/R", `1 : ${fmt.format(plan.rr)}`, "neutral"]);
  if (plan.botAdjustment?.matches) rows.push(["Bot match", `${fmtInt.format(plan.botAdjustment.matches)} / ${fmt.format(plan.botAdjustment.avgR)}R`, plan.botAdjustment.adjustment > 0 ? "positive" : "negative"]);

  els.tradePlanList.innerHTML = rows.map(([label, value, type]) => `
    <div class="trade-row">
      <span>${htmlSafe(label)}</span>
      <strong class="${type}">${htmlSafe(value)}</strong>
    </div>
  `).join("");

  els.executionChecklist.innerHTML = checklist.map((item) => `
    <li>
      <strong class="${item.type}">${htmlSafe(item.status)}</strong>
      <span>${htmlSafe(item.label)}<small>${htmlSafe(item.detail)}</small></span>
    </li>
  `).join("");
}

function renderPredictions() {
  els.predictionGrid.innerHTML = INTERVALS.map((interval) => {
    const analysis = state.analyses[interval.key];
    if (!analysis) {
      return `<article class="prediction-card" data-interval-card="${interval.key}"><h3>${interval.label}</h3><strong>-</strong><p>Waiting for analysis</p></article>`;
    }
    const validation = analysis.tradePlan?.validationBacktest || analysis.tradePlan?.backtest || {};
    const grade = validationPasses(validation) ? "A" : (validation.trades || 0) >= 12 ? "B" : "C";
    return `
      <article class="prediction-card ${state.interval === interval.key ? "is-active" : ""}" data-interval-card="${interval.key}">
        <h3>${interval.label} forecast</h3>
        <strong class="${analysis.bias === "bullish" ? "positive" : analysis.bias === "bearish" ? "negative" : "neutral"}">${htmlSafe(analysis.text)}</strong>
        <span>Grade ${grade} / score ${analysis.score}/100 / confidence ${analysis.confidence}% / 1Y win ${fmt.format(validation.winRate || 0)}%</span>
        <p>Simulation center ${fmtUsd.format(analysis.target)}<br />Range ${fmtUsd.format(analysis.rangeLow)} - ${fmtUsd.format(analysis.rangeHigh)}</p>
      </article>
    `;
  }).join("");
}

function renderScenarioButtons() {
  const analysis = compositeAnalysis();
  if (!analysis?.tradeScenarios?.length || state.scenarioMode === "current-entry") {
    if (els.scenarioButtons) els.scenarioButtons.innerHTML = "";
    return;
  }

  els.scenarioButtons.innerHTML = analysis.tradeScenarios.slice(0, 3).map((plan, index) => `
    <button
      class="scenario-chip ${index === analysis.selectedScenarioIndex ? "is-active" : ""} ${gradeClass(plan.grade)}"
      type="button"
      data-scenario-index="${index}"
      aria-pressed="${index === analysis.selectedScenarioIndex ? "true" : "false"}"
    >
      <span>${htmlSafe(plan.scenarioLabel || `Scenario ${index + 1}`)} · ${htmlSafe(plan.grade || "C")}</span>
      <small>${htmlSafe(plan.scenarioName || "Setup")} · win ${fmt.format(plan.estimatedWinRate || plan.validationBacktest?.winRate || 0)}% · S${Math.round(plan.recommendationScore || plan.formulaScore || 0)}</small>
    </button>
  `).join("");
}

function renderReport() {
  const composite = getDisplayAnalysis();
  if (!composite) return;

  const intervalScores = INTERVALS
    .map((interval) => {
      const score = state.analyses[interval.key]?.score;
      return `<span><b>${interval.label}</b>${score ?? "-"}</span>`;
    })
    .join("");
  const plan = composite.tradePlan;
  const validation = plan.validationBacktest || plan.backtest || {};
  const risks = plan.risks?.length ? plan.risks.map((risk) => `<li>${htmlSafe(risk)}</li>`).join("") : "<li>No major avoidance risk detected.</li>";
  const reasons = plan.reasons?.length ? plan.reasons.map((reason) => `<li>${htmlSafe(reason)}</li>`).join("") : "<li>Waiting for stronger validation evidence.</li>";

  els.reportText.innerHTML = `
    <div class="report-brief recommendation-report ${gradeClass(plan.grade)}">
      <span class="report-chip">${htmlSafe(INTERVALS.find((item) => item.key === state.interval)?.label || state.interval)} / Grade ${htmlSafe(plan.grade || "C")}</span>
      <strong>${plan.highProbability ? "High-probability simulation candidate" : "Wait-first probability simulation"}</strong>
      <small>Estimated win ${fmt.format(plan.estimatedWinRate || validation.winRate || 0)}% / confidence ${composite.confidence}% / recommendation score ${Math.round(plan.recommendationScore || 0)}/100</small>
    </div>
    <div class="report-score-strip" aria-label="timeframe score map">
      ${intervalScores}
    </div>
    <div class="report-matrix">
      <section>
        <span>Trade levels</span>
        <strong>${htmlSafe(plan.title || "Scenario")}</strong>
        <dl>
          <div><dt>Entry</dt><dd>${entryDisplay(plan)}</dd></div>
          <div><dt>TP1</dt><dd>${fmtUsd.format(plan.takeProfit1)}</dd></div>
          <div><dt>SL</dt><dd>${fmtUsd.format(plan.stopLoss)}</dd></div>
        </dl>
      </section>
      <section>
        <span>1Y validation</span>
        <strong>${plan.validationPass ? "Gate passed" : "Needs caution"}</strong>
        <dl>
          <div><dt>Win</dt><dd>${fmt.format(validation.winRate || 0)}%</dd></div>
          <div><dt>Expectancy</dt><dd>${fmt.format(validation.expectancyR || 0)}R</dd></div>
          <div><dt>PF</dt><dd>${fmt.format(validation.profitFactor || 0)}</dd></div>
        </dl>
      </section>
    </div>
    <div class="report-evidence">
      <section><span>Why it ranked here</span><ul>${reasons}</ul></section>
      <section><span>Risks that block higher grade</span><ul>${risks}</ul></section>
      <section><span>On-chain context</span><p>${htmlSafe((composite.chain.notes || []).slice(0, 3).join(" / ") || "Public on-chain data pending.")}</p></section>
    </div>
  `;
}

function renderReport() {
  const composite = getDisplayAnalysis();
  if (!composite) return;

  const intervalScores = INTERVALS
    .map((interval) => {
      const score = state.analyses[interval.key]?.score;
      return `<span><b>${interval.label}</b>${score ?? "-"}</span>`;
    })
    .join("");
  const chainNotes = composite.chain.notes.slice(0, 4).join(" · ");
  const strongest = [...composite.indicators]
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, 4)
    .map((item) => `<li><span>${item.name}</span><strong>${scoreLabel(item.signal)}</strong></li>`)
    .join("");
  const plan = composite.tradePlan;
  const backtest = plan.backtest || { trades: 0, winRate: 0, expectancyR: 0 };
  const validation = plan.validationBacktest || backtest;
  const activeInterval = INTERVALS.find((item) => item.key === state.interval)?.label || state.interval;
  const entryText =
    plan.isCurrentEntry || plan.entryLow === plan.entryHigh
      ? fmtUsd.format(plan.entryHigh)
      : `${fmtUsd.format(plan.entryLow)} - ${fmtUsd.format(plan.entryHigh)}`;
  const validationText = plan.validationPass ? "검증 통과" : "보수적 확인";

  els.reportText.innerHTML = `
    <div class="report-brief">
      <span class="report-chip">${activeInterval} 기준</span>
      <strong>${composite.text}</strong>
      <small>예상 중심 ${fmtUsd.format(composite.target)} · 범위 ${fmtUsd.format(composite.rangeLow)} - ${fmtUsd.format(composite.rangeHigh)}</small>
    </div>
    <div class="report-score-strip" aria-label="timeframe score map">
      ${intervalScores}
    </div>
    <div class="report-matrix">
      <section>
        <span>매매 계획</span>
        <strong>${plan.title}</strong>
        <dl>
          <div><dt>진입</dt><dd>${entryText}</dd></div>
          <div><dt>TP1</dt><dd>${fmtUsd.format(plan.takeProfit1)}</dd></div>
          <div><dt>SL</dt><dd>${fmtUsd.format(plan.stopLoss)}</dd></div>
        </dl>
      </section>
      <section>
        <span>1년 검증</span>
        <strong>${validationText}</strong>
        <dl>
          <div><dt>승률</dt><dd>${fmt.format(validation.winRate)}%</dd></div>
          <div><dt>기대값</dt><dd>${fmt.format(validation.expectancyR)}R</dd></div>
          <div><dt>표본</dt><dd>${fmtInt.format(validation.trades)}</dd></div>
        </dl>
      </section>
    </div>
    <div class="report-evidence">
      <section>
        <span>핵심 지표</span>
        <ul>${strongest}</ul>
      </section>
      <section>
        <span>온체인 맥락</span>
        <p>${chainNotes || "공개 API 데이터 대기 중"}</p>
      </section>
      <section>
        <span>백테스트 요약</span>
        <p>유사 조건 ${fmtInt.format(backtest.trades)}건 · 승률 ${fmt.format(backtest.winRate)}% · 기대값 ${fmt.format(backtest.expectancyR)}R</p>
      </section>
    </div>
  `;
}

function renderReport() {
  const composite = getDisplayAnalysis();
  if (!composite) return;

  const intervalScores = INTERVALS
    .map((interval) => {
      const score = state.analyses[interval.key]?.score;
      return `<span><b>${interval.label}</b>${score ?? "-"}</span>`;
    })
    .join("");
  const plan = composite.tradePlan;
  const validation = plan.validationBacktest || plan.backtest || {};
  const risks = plan.risks?.length ? plan.risks.map((risk) => `<li>${htmlSafe(risk)}</li>`).join("") : "<li>No major avoidance risk detected.</li>";
  const reasons = plan.reasons?.length ? plan.reasons.map((reason) => `<li>${htmlSafe(reason)}</li>`).join("") : "<li>Waiting for stronger validation evidence.</li>";

  els.reportText.innerHTML = `
    <div class="report-brief recommendation-report ${gradeClass(plan.grade)}">
      <span class="report-chip">${htmlSafe(INTERVALS.find((item) => item.key === state.interval)?.label || state.interval)} / Grade ${htmlSafe(plan.grade || "C")}</span>
      <strong>${plan.highProbability ? "High-probability simulation candidate" : "Wait-first probability simulation"}</strong>
      <small>Estimated win ${fmt.format(plan.estimatedWinRate || validation.winRate || 0)}% / confidence ${composite.confidence}% / recommendation score ${Math.round(plan.recommendationScore || 0)}/100</small>
    </div>
    <div class="report-score-strip" aria-label="timeframe score map">
      ${intervalScores}
    </div>
    <div class="report-matrix">
      <section>
        <span>Trade levels</span>
        <strong>${htmlSafe(plan.title || "Scenario")}</strong>
        <dl>
          <div><dt>Entry</dt><dd>${entryDisplay(plan)}</dd></div>
          <div><dt>TP1</dt><dd>${fmtUsd.format(plan.takeProfit1)}</dd></div>
          <div><dt>SL</dt><dd>${fmtUsd.format(plan.stopLoss)}</dd></div>
        </dl>
      </section>
      <section>
        <span>1Y validation</span>
        <strong>${plan.validationPass ? "Gate passed" : "Needs caution"}</strong>
        <dl>
          <div><dt>Win</dt><dd>${fmt.format(validation.winRate || 0)}%</dd></div>
          <div><dt>Expectancy</dt><dd>${fmt.format(validation.expectancyR || 0)}R</dd></div>
          <div><dt>PF</dt><dd>${fmt.format(validation.profitFactor || 0)}</dd></div>
        </dl>
      </section>
    </div>
    <div class="report-evidence">
      <section><span>Why it ranked here</span><ul>${reasons}</ul></section>
      <section><span>Risks that block higher grade</span><ul>${risks}</ul></section>
      <section><span>On-chain context</span><p>${htmlSafe((composite.chain.notes || []).slice(0, 3).join(" / ") || "Public on-chain data pending.")}</p></section>
    </div>
  `;
}

function renderAll() {
  renderSummary();
  renderChart();
  renderTradePlan();
  renderScenarioButtons();
  renderIndicators();
  renderPredictions();
  renderOnchain();
  renderReport();
  renderBotDesk();
}

function startSocket() {
  if (state.ws) state.ws.close();
  const stream = `wss://stream.binance.com:9443/ws/btcusdt@kline_${state.interval}`;
  state.ws = new WebSocket(stream);

  state.ws.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    const k = payload.k;
    const candle = {
      time: Math.floor(k.t / 1000),
      open: Number(k.o),
      high: Number(k.h),
      low: Number(k.l),
      close: Number(k.c),
      volume: Number(k.v),
    };
    const candles = state.candlesByInterval[state.interval] || [];
    const lastIndex = candles.length - 1;
    if (lastIndex >= 0 && candles[lastIndex].time === candle.time) candles[lastIndex] = candle;
    else candles.push(candle);
    const intervalLimit = INTERVALS.find((item) => item.key === state.interval)?.limit || 1000;
    state.candlesByInterval[state.interval] = candles.slice(-intervalLimit);
    const validationIntervalKey = validationIntervalFor(state.interval);
    const validationCandles = state.validationCandlesByInterval[validationIntervalKey] || state.candlesByInterval[state.interval];
    state.analyses[state.interval] = analyzeCandlesV2(state.candlesByInterval[state.interval], state.interval, validationCandles, validationIntervalKey);
    updateBotDeskOnCandle(candle, state.analyses[state.interval]);
    renderAll();
  };

  state.ws.onerror = () => {
    els.rangeText.textContent = "WebSocket 연결 실패 · 5분 리포트 갱신은 유지됩니다";
  };
}

async function refreshAll() {
  els.refreshBtn.disabled = true;
  els.updatedAt.textContent = "데이터를 갱신하는 중";

  try {
    const marketResults = await Promise.all(INTERVALS.map((interval) => fetchCandles(interval.key, interval.limit)));
    const validationIntervals = [...new Set(INTERVALS.map((interval) => validationIntervalFor(interval.key)))];
    const validationResults = await Promise.all(validationIntervals.map((intervalKey) => fetchYearCandles(intervalKey)));
    state.validationCandlesByInterval = Object.fromEntries(validationIntervals.map((intervalKey, index) => [intervalKey, validationResults[index]]));
    INTERVALS.forEach((interval, index) => {
      state.candlesByInterval[interval.key] = marketResults[index];
      const validationIntervalKey = validationIntervalFor(interval.key);
      const validationCandles = state.validationCandlesByInterval[validationIntervalKey] || marketResults[index];
      state.analyses[interval.key] = analyzeCandlesV2(marketResults[index], interval.key, validationCandles, validationIntervalKey);
    });
    state.onchain = await fetchOnchain();
    seedBotDeskFromCurrentAnalysis(state.analyses[state.interval]);
    state.reportDueAt = Date.now() + REPORT_MS;
    startSocket();
    renderAll();
  } catch (error) {
    els.signalBadge.textContent = "데이터 오류";
    els.signalBadge.className = "badge bearish";
    els.signalText.textContent = "확인 필요";
    els.signalReason.textContent = `시장 데이터를 불러오지 못했습니다. 네트워크, Binance API, CDN 차단 여부를 확인해 주세요. (${error.message})`;
  } finally {
    els.refreshBtn.disabled = false;
  }
}

function updateCountdown() {
  const remaining = Math.max(0, state.reportDueAt - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  els.nextReportText.textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function bindEvents() {
  els.timeframeBtns.forEach((button) => {
    button.addEventListener("click", () => {
      state.interval = button.dataset.interval;
      state.selectedScenarioIndex = 0;
els.timeframeBtns.forEach((item) => item.classList.toggle("is-active", item === button));
      state.chartHasInitialFit = false;
      if (state.scenarioMode === "current-entry") {
        state.entrySnapshot = null;
        state.levelsVisible = false;
        state.scenarioMode = "none";
      } else if (state.scenarioMode === "recommended") {
        state.levelsVisible = true;
      }
      startSocket();
      renderAll();
    });
  });

  els.overlayToggles.forEach((toggle) => {
    toggle.addEventListener("change", () => {
      state.overlays[toggle.dataset.overlay] = toggle.checked;
      renderChart();
    });
  });

  els.refreshBtn.addEventListener("click", refreshAll);
  els.fitBtn.addEventListener("click", () => state.chart?.timeScale().fitContent());
  els.showLevelsBtn.addEventListener("click", focusCurrentLevels);
  els.recommendScenarioBtn.addEventListener("click", focusRecommendedScenario);
  els.scenarioButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-scenario-index]");
    if (!button) return;
    const nextIndex = Number(button.dataset.scenarioIndex);
    if (!Number.isFinite(nextIndex)) return;
    state.scenarioMode = "recommended";
    state.entrySnapshot = null;
    state.levelsVisible = true;
    state.selectedScenarioIndex = nextIndex;
    renderAll();
  });
  els.botCapitalInput.addEventListener("input", () => {
    const value = Number(els.botCapitalInput.value.replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) return;
    state.botDesk.settings.capital = value;
    state.risk.accountSize = value;
    saveBotDeskState();
    renderBotDesk();
  });
  els.botLeverageInput.addEventListener("input", () => {
    const value = Number(els.botLeverageInput.value.replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) return;
    state.botDesk.settings.leverage = value;
    saveBotDeskState();
    renderBotDesk();
  });
  els.botStartBtn.addEventListener("click", startBotDeskTrading);
  els.botPauseBtn.addEventListener("click", pauseBotDeskTrading);
  els.botExportBtn.addEventListener("click", exportBotDeskRecords);
  els.botImportBtn.addEventListener("click", () => els.botImportInput.click());
  els.botImportInput.addEventListener("change", () => importBotDeskRecords(els.botImportInput.files?.[0]));
  els.botGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-bot-history]");
    if (!button) return;
    const botId = button.dataset.botHistory;
    state.botDesk.activeHistoryBotId = state.botDesk.activeHistoryBotId === botId ? null : botId;
    saveBotDeskState();
    renderBotDesk();
  });
  els.botResetBtn.addEventListener("click", () => {
    state.botDesk = createDefaultBotDesk();
    state.risk.accountSize = state.botDesk.settings.capital;
    saveBotDeskState();
    renderBotDesk();
  });
  els.predictionGrid.addEventListener("click", (event) => {
    const card = event.target.closest("[data-interval-card]");
    if (!card) return;
    const interval = card.dataset.intervalCard;
    if (!interval || interval === state.interval) {
      if (state.scenarioMode === "recommended") focusRecommendedScenario();
      return;
    }
    state.interval = interval;
    state.selectedScenarioIndex = 0;
    els.timeframeBtns.forEach((item) => item.classList.toggle("is-active", item.dataset.interval === interval));
    state.chartHasInitialFit = false;
    if (state.scenarioMode === "current-entry") {
      state.entrySnapshot = null;
      state.levelsVisible = false;
      state.scenarioMode = "none";
    } else {
      state.scenarioMode = "recommended";
      state.levelsVisible = true;
    }
    startSocket();
    renderAll();
  });
  els.addLineBtn.addEventListener("click", () => {
    const price = Number(els.priceLineInput.value.replace(/,/g, ""));
    if (!Number.isFinite(price) || !state.series.candles) return;
    const line = state.series.candles.createPriceLine({
      price,
      color: "#7aa7ff",
      lineWidth: 2,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "수동선",
    });
    state.manualLines.push(line);
    els.priceLineInput.value = "";
  });
}

function parseSnapshotNumber(value) {
  if (Number.isFinite(value)) return Number(value);
  const parsed = Number(String(value ?? "").replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatFeatureKey(key) {
  return String(key || "")
    .replaceAll(":", " ")
    .replaceAll("indicator", "indicator")
    .replaceAll("validation", "validation")
    .replaceAll("confidence", "confidence")
    .replaceAll("interval", "interval");
}

function tradeFeatureKeysFromSnapshot(snapshot) {
  if (!snapshot) return [];
  const market = snapshot.market || {};
  const scenario = snapshot.scenario || {};
  const validation = snapshot.validation || {};
  const onchain = snapshot.onchain || {};
  const price = Number(market.price) || Number(scenario.entry) || 0;
  const ema20 = Number(market.ema20);
  const ema50 = Number(market.ema50);
  const ema200 = Number(market.ema200);
  const vwap = Number(market.vwap);
  const rsi = parseSnapshotNumber(market.rsi);
  const supportGap = price > 0 && Number.isFinite(Number(market.support)) ? ((price - Number(market.support)) / price) * 100 : null;
  const resistanceGap = price > 0 && Number.isFinite(Number(market.resistance)) ? ((Number(market.resistance) - price) / price) * 100 : null;
  const rr = Number(scenario.rr) || 0;
  const entryWidthPct = price > 0 ? Math.abs((Number(scenario.entryHigh) || price) - (Number(scenario.entryLow) || price)) / price * 100 : 0;

  const keys = [
    `interval:${market.interval || "unknown"}`,
    `side:${scenario.side || "neutral"}`,
    `bias:${market.bias || "neutral"}`,
    `confidence:${bucketNumber(market.confidence, 48, 68)}`,
    `score:${bucketNumber(market.compositeScore, 45, 68)}`,
    `onchain:${bucketNumber(onchain.score, 45, 58)}`,
    `atr:${bucketNumber(market.atrPct, 0.35, 1.6)}`,
    `rr:${bucketNumber(rr, 1.05, 1.65)}`,
    `entryWidth:${bucketNumber(entryWidthPct, 0.12, 0.42)}`,
    `validation:${validation.trades >= 24 && validation.winRate >= 55 && validation.expectancyR > 0 ? "strong" : validation.trades >= 12 ? "mixed" : "thin"}`,
  ];

  if (scenario.grade) keys.push(`grade:${scenario.grade}`);
  if (Number.isFinite(ema20) && Number.isFinite(ema50) && Number.isFinite(ema200)) {
    keys.push(`emaStack:${ema20 >= ema50 && ema50 >= ema200 ? "bull" : ema20 <= ema50 && ema50 <= ema200 ? "bear" : "mixed"}`);
  }
  if (price > 0 && Number.isFinite(vwap)) keys.push(`vwap:${price >= vwap ? "above" : "below"}`);
  if (Number.isFinite(rsi)) keys.push(`rsi:${bucketNumber(rsi, 42, 64)}`);
  if (Number.isFinite(supportGap)) keys.push(`supportGap:${bucketNumber(supportGap, 0.28, 1.2)}`);
  if (Number.isFinite(resistanceGap)) keys.push(`resistanceGap:${bucketNumber(resistanceGap, 0.28, 1.2)}`);

  (snapshot.indicators || [])
    .filter((item) => Math.abs(Number(item.signal) || 0) >= 0.7)
    .slice(0, 7)
    .forEach((item) => keys.push(`indicator:${item.name}:${item.signal > 0 ? "up" : "down"}`));

  return [...new Set(keys)];
}

function summarizeBotPerformance(bot) {
  const closed = (bot.history || []).map(normalizeBotTradeRecord);
  const wins = closed.filter((trade) => trade.pnl >= 0).length;
  const totalPnl = closed.reduce((sum, trade) => sum + trade.pnl, 0);
  const totalR = closed.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const targetCount = closed.filter((trade) => trade.exitReason === "target").length;
  const stopCount = closed.filter((trade) => trade.exitReason === "stop").length;
  const recent = closed.slice(-BOT_RECENT_WINDOW);
  const recentR = recent.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const featureMap = new Map();
  const sideMap = new Map();
  const intervalMap = new Map();

  const addStats = (map, key, trade) => {
    const item = map.get(key) || { key, trades: 0, wins: 0, stops: 0, targets: 0, totalR: 0, pnl: 0 };
    item.trades += 1;
    if (trade.pnl >= 0) item.wins += 1;
    if (trade.exitReason === "stop") item.stops += 1;
    if (trade.exitReason === "target") item.targets += 1;
    item.totalR += trade.rMultiple;
    item.pnl += trade.pnl;
    map.set(key, item);
  };

  closed.forEach((trade) => {
    addStats(sideMap, trade.side || "unknown", trade);
    addStats(intervalMap, trade.interval || trade.snapshot?.market?.interval || "unknown", trade);
    tradeFeatureKeysFromSnapshot(trade.snapshot).forEach((key) => addStats(featureMap, key, trade));
  });

  const enrich = (item) => ({
    ...item,
    winRate: item.trades ? (item.wins / item.trades) * 100 : 0,
    stopRate: item.trades ? (item.stops / item.trades) * 100 : 0,
    targetRate: item.trades ? (item.targets / item.trades) * 100 : 0,
    avgR: item.trades ? item.totalR / item.trades : 0,
  });
  const edges = [...featureMap.values()].map(enrich);
  const bySide = [...sideMap.values()].map(enrich).sort((a, b) => b.avgR - a.avgR);
  const byInterval = [...intervalMap.values()].map(enrich).sort((a, b) => b.avgR - a.avgR);
  const strongEdges = edges
    .filter((item) => item.trades >= BOT_LEARNING_MIN_TRADES && (item.avgR > 0.08 || item.winRate >= 58 || item.targetRate > item.stopRate + 18))
    .sort((a, b) => b.avgR - a.avgR || b.winRate - a.winRate)
    .slice(0, 6);
  const weakEdges = edges
    .filter((item) => item.trades >= BOT_LEARNING_MIN_TRADES && (item.avgR < -0.06 || item.stopRate >= 58))
    .sort((a, b) => a.avgR - b.avgR || b.stopRate - a.stopRate)
    .slice(0, 6);
  const blockedEdges = weakEdges
    .filter((item) => item.avgR < -0.16 || item.stopRate >= 66)
    .slice(0, 4);
  const recentAvgR = recent.length ? recentR / recent.length : 0;
  const recentStopRate = recent.length ? (recent.filter((trade) => trade.exitReason === "stop").length / recent.length) * 100 : 0;
  const recentSlump = recent.length >= 4 && (recentAvgR < -0.14 || recentStopRate >= 62);

  return {
    trades: closed.length,
    wins,
    losses: closed.length - wins,
    winRate: closed.length ? (wins / closed.length) * 100 : 0,
    totalPnl,
    avgR: closed.length ? totalR / closed.length : 0,
    targetRate: closed.length ? (targetCount / closed.length) * 100 : 0,
    stopRate: closed.length ? (stopCount / closed.length) * 100 : 0,
    recentTrades: recent.length,
    recentAvgR,
    recentStopRate,
    recentSlump,
    strongEdges,
    weakEdges,
    blockedEdges,
    bySide,
    byInterval,
  };
}

function botLearningProfile(bot) {
  const performance = summarizeBotPerformance(bot);
  if (performance.trades < BOT_LEARNING_MIN_TRADES) {
    return {
      ...performance,
      ready: false,
      mode: "collecting",
      summary: `Learning pending: ${performance.trades}/${BOT_LEARNING_MIN_TRADES} closed trades. The bot keeps using its base profile until enough records exist.`,
    };
  }

  const best = performance.strongEdges[0];
  const worst = performance.weakEdges[0];
  const bestSegment = performance.byInterval[0] || performance.bySide[0];
  const mode = performance.recentSlump ? "defensive" : best ? "focused" : "balanced";
  const modeText = mode === "defensive"
    ? "Defensive mode: recent stops or negative R are lowering entries in similar conditions."
    : mode === "focused"
      ? "Focused mode: the bot is favoring conditions that produced stronger R multiples."
      : "Balanced mode: no dominant edge yet, so base strategy still carries more weight.";
  const edgeText = best ? `Boost: ${formatFeatureKey(best.key)} (${fmt.format(best.avgR)}R / ${fmt.format(best.winRate)}%).` : "Boost: still collecting reliable positive patterns.";
  const avoidText = worst ? `Avoid: ${formatFeatureKey(worst.key)} (${fmt.format(worst.avgR)}R / stop ${fmt.format(worst.stopRate)}%).` : "Avoid: no repeated weak pattern yet.";
  const segmentText = bestSegment ? `Best segment: ${formatFeatureKey(bestSegment.key)} (${fmt.format(bestSegment.avgR)}R).` : "";

  return {
    ...performance,
    ready: true,
    mode,
    summary: `${modeText} ${edgeText} ${avoidText} ${segmentText}`,
  };
}

function botStrategyLabel(strategy) {
  if (strategy === "winrate") return "Win-rate first";
  if (strategy === "expectancy") return "Expectancy balance";
  if (strategy === "rr") return "R/R breakout";
  return "Scenario";
}

function botProfileLabel(bot) {
  const labels = {
    alpha: "Stable bot: prioritizes win rate, validation pass, and weak-condition avoidance.",
    beta: "Balanced bot: weighs win rate, expectancy, and recent learned edges.",
    gamma: "Aggressive bot: still likes R/R, but avoids repeated stop-heavy patterns.",
    delta: "Scalping bot: prefers tight TP, tight range, and low-volatility winners.",
    epsilon: "Trend bot: favors EMA/VWAP/ADX alignment proven in its own records.",
    zeta: "Validation bot: prioritizes 1Y sample size, profit factor, and learned reliability.",
  };
  return labels[bot.id] || "Record-aware bot profile.";
}

function botLearningGate(bot, plan, analysis) {
  const profile = botLearningProfile(bot);
  if (!profile.ready) return { allowed: true, adjustment: 0, reasons: [] };
  const snapshot = buildTradeSnapshot({ bot, analysis, plan, entry: tradeEntryReference(plan), reason: "gate-preview" });
  const keys = new Set(tradeFeatureKeysFromSnapshot(snapshot));
  const blocked = profile.blockedEdges.filter((edge) => keys.has(edge.key));
  const weak = profile.weakEdges.filter((edge) => keys.has(edge.key));
  const strong = profile.strongEdges.filter((edge) => keys.has(edge.key));
  const reasons = [];
  let adjustment = 0;

  strong.forEach((edge) => {
    adjustment += clamp(edge.avgR * 14 + (edge.winRate - 50) * 0.16 + (edge.targetRate - edge.stopRate) * 0.04, 2, 12);
    reasons.push(`boost ${formatFeatureKey(edge.key)}`);
  });
  weak.forEach((edge) => {
    adjustment -= clamp(Math.abs(edge.avgR) * 18 + Math.max(0, edge.stopRate - 45) * 0.12, 3, 18);
    reasons.push(`penalty ${formatFeatureKey(edge.key)}`);
  });
  if (profile.recentSlump && !strong.length) {
    adjustment -= 8;
    reasons.push("recent defensive mode");
  }
  if (plan.grade === "A+" || plan.grade === "A") adjustment += 4;
  if (plan.grade === "C") adjustment -= 7;

  const hardBlocked = blocked.some((edge) => edge.avgR < -0.22 || edge.stopRate >= 70);
  const allowed = !(hardBlocked && !strong.length) && !(profile.recentSlump && plan.grade === "C");
  return {
    allowed,
    adjustment: clamp(adjustment, -42, 32),
    reasons,
    blocked,
    weak,
    strong,
  };
}

function botLearningAdjustment(bot, plan, analysis) {
  return botLearningGate(bot, plan, analysis).adjustment;
}

function pickBotScenario(analysis, bot) {
  const scenarios = (analysis?.tradeScenarios || [analysis?.tradePlan].filter(Boolean)).slice(0, 3);
  if (!scenarios.length) return null;
  return scenarios
    .map((plan) => {
      const baseScore = botTradePlanKey(bot, plan);
      const strategyScore = botStrategyScore(bot, plan, analysis);
      const gate = botLearningGate(bot, plan, analysis);
      const blockedPenalty = gate.allowed ? 0 : -999;
      return {
        plan,
        score: baseScore + strategyScore + gate.adjustment + blockedPenalty,
        strategyScore,
        learningAdjustment: gate.adjustment,
      };
    })
    .sort((a, b) => b.score - a.score)[0]?.plan || scenarios[0];
}

function shouldOpenBotTrade(bot, analysis, plan) {
  if (!plan) return false;
  const validation = plan.validationBacktest || plan.backtest || {};
  const gate = botLearningGate(bot, plan, analysis);
  if (!gate.allowed) return false;

  const nearEntry = Math.abs(analysis.price - tradeEntryReference(plan)) <= Math.max(analysis.atr * 0.28, analysis.price * 0.0012);
  const inRange = analysis.price >= plan.entryLow && analysis.price <= plan.entryHigh;
  const priceOk = inRange || nearEntry;
  const confidenceFloor = bot.strategy === "rr" ? 44 : bot.strategy === "winrate" || bot.id === "zeta" ? 52 : 48;
  const confidenceOk = analysis.confidence >= Math.max(42, confidenceFloor - Math.max(0, gate.adjustment) * 0.08);
  const gradeOk = plan.grade !== "C" || (bot.id === "gamma" && validation.expectancyR > 0.18 && gate.adjustment >= 0);
  const learnedOk = gate.adjustment > -18;

  if (!priceOk || !confidenceOk || !gradeOk || !learnedOk) return false;

  if (bot.strategy === "winrate") {
    return plan.validationPass && validation.winRate >= 55 && validation.expectancyR > 0 && validation.profitFactor >= 1.08;
  }
  if (bot.strategy === "expectancy") {
    return validation.expectancyR > 0.14 && validation.winRate >= 50 && validation.profitFactor >= 1.03;
  }
  if (bot.id === "delta") {
    const entry = tradeEntryReference(plan);
    const tpMovePct = entry > 0 ? Math.abs((plan.takeProfit1 || entry) - entry) / entry * 100 : 0;
    return tpMovePct <= 0.9 && validation.winRate >= 49 && validation.expectancyR > 0;
  }
  if (bot.id === "epsilon") {
    return validation.expectancyR > 0 && analysis.confidence >= 50 && (plan.grade === "A+" || plan.grade === "A" || gate.adjustment > 4);
  }
  if (bot.id === "zeta") {
    return validation.trades >= RECOMMENDATION_MIN_SAMPLE && validation.profitFactor >= 1.1 && validation.winRate >= 53;
  }
  return (plan.rr || 0) >= 1.2 && validation.expectancyR > 0 && validation.winRate >= 48;
}

function renderLearningEdges(profile) {
  const strong = profile.strongEdges?.length
    ? profile.strongEdges.map((edge) => `<li><span>${formatFeatureKey(edge.key)}</span><strong>${fmt.format(edge.avgR)}R / ${fmt.format(edge.winRate)}%</strong></li>`).join("")
    : `<li><span>Collecting positive patterns</span><strong>-</strong></li>`;
  const weak = profile.weakEdges?.length
    ? profile.weakEdges.map((edge) => `<li><span>${formatFeatureKey(edge.key)}</span><strong>${fmt.format(edge.avgR)}R / stop ${fmt.format(edge.stopRate)}%</strong></li>`).join("")
    : `<li><span>No repeated weak pattern</span><strong>-</strong></li>`;
  const segments = profile.byInterval?.length
    ? profile.byInterval.slice(0, 3).map((edge) => `<li><span>${formatFeatureKey(edge.key)}</span><strong>${fmt.format(edge.avgR)}R / ${fmt.format(edge.winRate)}%</strong></li>`).join("")
    : `<li><span>Segment data pending</span><strong>-</strong></li>`;
  return `
    <div class="learning-edge-grid">
      <section><h4>Boost conditions</h4><ul>${strong}</ul></section>
      <section><h4>Avoid conditions</h4><ul>${weak}</ul></section>
      <section><h4>Best segments</h4><ul>${segments}</ul></section>
    </div>
  `;
}

function oppositeSide(side) {
  return side === "short" ? "long" : "short";
}

function botDirectionProfile(bot) {
  const map = {
    alpha: { mode: "primary", maxSameSide: 4, hedgeBonus: 0, label: "primary trend" },
    beta: { mode: "balanced", maxSameSide: 4, hedgeBonus: 7, label: "balanced rotation" },
    gamma: { mode: "counter", maxSameSide: 3, hedgeBonus: 18, label: "counter/hedge" },
    delta: { mode: "mean-reversion", maxSameSide: 3, hedgeBonus: 14, label: "mean reversion" },
    epsilon: { mode: "primary", maxSameSide: 4, hedgeBonus: 2, label: "trend follow" },
    zeta: { mode: "validation", maxSameSide: 4, hedgeBonus: 6, label: "validation best-side" },
  };
  return map[bot.id] || { mode: "balanced", maxSameSide: 4, hedgeBonus: 6, label: "balanced" };
}

function currentBotSideCounts(excludeBotId = null) {
  const counts = { long: 0, short: 0 };
  (state.botDesk?.bots || []).forEach((bot) => {
    if (excludeBotId && bot.id === excludeBotId) return;
    const side = bot.openTrade?.side;
    if (side === "long" || side === "short") counts[side] += 1;
  });
  return counts;
}

function buildDirectionalPlanForBot(analysis, side) {
  if (!analysis || !side) return null;
  const sourcePack = side === "short" ? analysis.historicalEdges?.recommendedShort : analysis.historicalEdges?.recommendedLong;
  const validationPack = side === "short" ? analysis.validationEdges?.recommendedShort : analysis.validationEdges?.recommendedLong;
  const edge = sourcePack?.best || sourcePack?.candidates?.[0];
  const validationEdge = matchValidationEdge(edge, validationPack?.candidates || [validationPack?.best].filter(Boolean));
  if (!edge) return null;
  const scenarioBias = side === "short" ? "bearish" : "bullish";
  const plan = buildTradePlan({
    price: analysis.price,
    score: analysis.score,
    bias: scenarioBias,
    support: analysis.support,
    resistance: analysis.resistance,
    localSupport: analysis.localSupport,
    localResistance: analysis.localResistance,
    atr: analysis.atr,
    previous: analysis.previous,
    ema20: analysis.technicals?.ema20 || lastFinite(analysis.overlays?.ema20 || []),
    ema50: analysis.technicals?.ema50 || lastFinite(analysis.overlays?.ema50 || []),
    vwap: analysis.technicals?.vwap || lastFinite(analysis.overlays?.vwap || []),
    bbMiddle: lastFinite(analysis.overlays?.bands?.middle || []),
    historicalEdge: edge,
    validationEdge,
    validationPass: validationPasses(validationEdge),
    validationIntervalKey: analysis.validationIntervalKey || analysis.validationSummary?.intervalKey || validationIntervalFor(state.interval),
    intervalKey: state.interval,
  });
  return applyRecommendationModelToPlan({
    ...plan,
    scenarioName: `${side === "short" ? "Short" : "Long"} hedge candidate`,
    scenarioLabel: `${side === "short" ? "Short" : "Long"} route`,
    scenarioId: `bot-${side}-route`,
  }, analysis, analysis.chain || onchainScore(state.onchain));
}

function botScenarioPool(analysis, bot) {
  const base = (analysis?.tradeScenarios || [analysis?.tradePlan].filter(Boolean)).filter(Boolean);
  const profile = botDirectionProfile(bot);
  const consensusSide = analysis?.bias === "bearish" ? "short" : "long";
  const hedgeSide = oppositeSide(consensusSide);
  const pool = [...base];

  if (!pool.some((plan) => plan.side === hedgeSide)) {
    const hedgePlan = buildDirectionalPlanForBot(analysis, hedgeSide);
    if (hedgePlan) pool.push(hedgePlan);
  }
  if (!pool.some((plan) => plan.side === consensusSide)) {
    const primaryPlan = buildDirectionalPlanForBot(analysis, consensusSide);
    if (primaryPlan) pool.push(primaryPlan);
  }
  if (profile.mode === "validation") {
    ["long", "short"].forEach((side) => {
      if (!pool.some((plan) => plan.side === side)) {
        const plan = buildDirectionalPlanForBot(analysis, side);
        if (plan) pool.push(plan);
      }
    });
  }

  return pool.slice(0, 5);
}

function botDirectionScore(bot, plan, analysis) {
  const profile = botDirectionProfile(bot);
  const consensusSide = analysis?.bias === "bearish" ? "short" : "long";
  const counts = currentBotSideCounts(bot.id);
  const sameSideCount = counts[plan.side] || 0;
  const oppositeCount = counts[oppositeSide(plan.side)] || 0;
  let score = 0;

  if (profile.mode === "primary" && plan.side === consensusSide) score += 10;
  if (profile.mode === "counter" && plan.side !== consensusSide) score += profile.hedgeBonus;
  if (profile.mode === "mean-reversion" && plan.side !== consensusSide && analysis?.confidence < 70) score += profile.hedgeBonus;
  if (profile.mode === "balanced" && sameSideCount > oppositeCount) score -= 8;
  if (profile.mode === "validation") {
    const validation = plan.validationBacktest || plan.backtest || {};
    score += (validation.winRate || 0) * 0.18 + (validation.profitFactor || 0) * 3;
  }

  if (sameSideCount >= profile.maxSameSide) score -= 34;
  if (sameSideCount >= 3 && oppositeCount === 0 && profile.mode !== "primary") score -= 18;
  if (sameSideCount < oppositeCount) score += 4;
  return score;
}

function botPortfolioExposureGate(bot, plan) {
  const profile = botDirectionProfile(bot);
  const counts = currentBotSideCounts(bot.id);
  const sameSideCount = counts[plan.side] || 0;
  if (sameSideCount >= profile.maxSameSide && !(plan.grade === "A+" && profile.mode === "primary")) {
    return {
      allowed: false,
      reason: `Portfolio side cap: ${sameSideCount} bots already ${plan.side}. ${bot.name} waits or looks for a hedge route.`,
    };
  }
  return { allowed: true, reason: "" };
}

function botLossStreak(bot) {
  const history = [...(bot.history || [])].map(normalizeBotTradeRecord).reverse();
  let streak = 0;
  for (const trade of history) {
    if ((Number(trade.pnl) || 0) < 0) streak += 1;
    else break;
  }
  return streak;
}

function botMaxRiskPct(bot) {
  const map = {
    alpha: 0.008,
    beta: 0.01,
    gamma: 0.012,
    delta: 0.006,
    epsilon: 0.009,
    zeta: 0.007,
  };
  return map[bot.id] || 0.008;
}

function botRiskMultiplier(bot) {
  const streak = botLossStreak(bot);
  if (streak >= 3) return 0.35;
  if (streak === 2) return 0.55;
  if (streak === 1) return 0.75;
  return 1;
}

function pickBotScenario(analysis, bot) {
  const scenarios = botScenarioPool(analysis, bot);
  if (!scenarios.length) return null;
  return scenarios
    .map((plan) => {
      const baseScore = botTradePlanKey(bot, plan);
      const strategyScore = botStrategyScore(bot, plan, analysis);
      const gate = botLearningGate(bot, plan, analysis);
      const exposure = botPortfolioExposureGate(bot, plan);
      const directionScore = botDirectionScore(bot, plan, analysis);
      const blockedPenalty = gate.allowed && exposure.allowed ? 0 : -999;
      return {
        plan,
        score: baseScore + strategyScore + gate.adjustment + directionScore + blockedPenalty,
        strategyScore,
        learningAdjustment: gate.adjustment,
        directionScore,
      };
    })
    .sort((a, b) => b.score - a.score)[0]?.plan || scenarios[0];
}

function shouldOpenBotTrade(bot, analysis, plan) {
  if (!plan) return false;
  const validation = plan.validationBacktest || plan.backtest || {};
  const gate = botLearningGate(bot, plan, analysis);
  const exposure = botPortfolioExposureGate(bot, plan);
  if (!gate.allowed || !exposure.allowed) return false;
  if (botLossStreak(bot) >= 3 && plan.grade === "C") return false;

  const nearEntry = Math.abs(analysis.price - tradeEntryReference(plan)) <= Math.max(analysis.atr * 0.24, analysis.price * 0.001);
  const inRange = analysis.price >= plan.entryLow && analysis.price <= plan.entryHigh;
  const priceOk = inRange || nearEntry;
  const confidenceFloor = bot.strategy === "rr" ? 44 : bot.strategy === "winrate" || bot.id === "zeta" ? 52 : 48;
  const confidenceOk = analysis.confidence >= Math.max(42, confidenceFloor - Math.max(0, gate.adjustment) * 0.08);
  const gradeOk = plan.grade !== "C" || (bot.id === "gamma" && validation.expectancyR > 0.18 && gate.adjustment >= 0);
  const learnedOk = gate.adjustment > -18;

  if (!priceOk || !confidenceOk || !gradeOk || !learnedOk) return false;

  if (bot.strategy === "winrate") {
    return plan.validationPass && validation.winRate >= 55 && validation.expectancyR > 0 && validation.profitFactor >= 1.08;
  }
  if (bot.strategy === "expectancy") {
    return validation.expectancyR > 0.14 && validation.winRate >= 50 && validation.profitFactor >= 1.03;
  }
  if (bot.id === "delta") {
    const entry = tradeEntryReference(plan);
    const tpMovePct = entry > 0 ? Math.abs((plan.takeProfit1 || entry) - entry) / entry * 100 : 0;
    return tpMovePct <= 0.9 && validation.winRate >= 49 && validation.expectancyR > 0;
  }
  if (bot.id === "epsilon") {
    return validation.expectancyR > 0 && analysis.confidence >= 50 && (plan.grade === "A+" || plan.grade === "A" || gate.adjustment > 4);
  }
  if (bot.id === "zeta") {
    return validation.trades >= RECOMMENDATION_MIN_SAMPLE && validation.profitFactor >= 1.1 && validation.winRate >= 53;
  }
  return (plan.rr || 0) >= 1.2 && validation.expectancyR > 0 && validation.winRate >= 48;
}

function openBotTrade(bot, analysis, plan, candle, reason = "live") {
  if (bot.openTrade) return false;

  const available = botAvailableCapital(bot);
  if (!Number.isFinite(available) || available <= 0) return false;
  const leverage = Math.max(1, Number(state.botDesk.settings.leverage) || 1);
  const entry = candle?.close ?? analysis.price;
  const stopLoss = pickBotStop(plan, entry, analysis);
  const stopDistance = Math.abs(entry - stopLoss);
  if (!Number.isFinite(stopDistance) || stopDistance <= 0) return false;

  const maxRiskUsd = Math.max(1, available * botMaxRiskPct(bot) * botRiskMultiplier(bot));
  const rawMargin = Math.min(available, botAllocatedCapital(bot) * 0.42);
  const rawNotional = rawMargin * leverage;
  const quantityByMargin = entry > 0 ? rawNotional / entry : 0;
  const quantityByRisk = maxRiskUsd / stopDistance;
  const quantity = Math.min(quantityByMargin, quantityByRisk);
  const notional = quantity * entry;
  const marginUsed = leverage > 0 ? notional / leverage : notional;
  const takeProfit = pickBotTarget(bot, plan, entry, analysis);
  const riskUsd = stopDistance * quantity;

  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(riskUsd) || riskUsd <= 0 || marginUsed > available) return false;

  const snapshot = buildTradeSnapshot({ bot, analysis, plan, entry, reason });
  const learningGate = botLearningGate(bot, plan, analysis);
  const exposure = botPortfolioExposureGate(bot, plan);
  snapshot.decision.strategyScore = botStrategyScore(bot, plan, analysis);
  snapshot.decision.learningAdjustment = learningGate.adjustment;
  snapshot.decision.directionProfile = botDirectionProfile(bot).label;
  snapshot.decision.exposureReason = exposure.reason;
  snapshot.decision.maxRiskUsd = maxRiskUsd;
  snapshot.decision.marginUsed = marginUsed;
  snapshot.decision.finalScore = botTradePlanKey(bot, plan) + snapshot.decision.strategyScore + snapshot.decision.learningAdjustment + botDirectionScore(bot, plan, analysis);

  bot.openTrade = {
    entry,
    side: plan.side,
    stopLoss,
    takeProfit,
    quantity,
    notional,
    marginUsed,
    maxRiskUsd,
    riskUsd,
    openedAt: candle?.time ?? Date.now(),
    interval: state.interval,
    scenarioId: plan.scenarioId,
    scenarioName: plan.scenarioName,
    scenarioLabel: plan.scenarioLabel,
    reason,
    snapshot,
  };
  bot.lastSkipReason = null;
  bot.lastTradeTime = candle?.time ?? Date.now();
  return true;
}

function closeBotTrade(bot, exitPrice, candle, exitReason) {
  const trade = bot.openTrade;
  if (!trade) return false;
  const gross = trade.side === "long"
    ? (exitPrice - trade.entry) * trade.quantity
    : (trade.entry - exitPrice) * trade.quantity;
  const costRate = ((state.risk.feePct || 0) + (state.risk.slippagePct || 0)) / 100;
  const cost = trade.notional * costRate;
  const pnl = gross - cost;
  const rMultiple = trade.riskUsd > 0 ? pnl / trade.riskUsd : 0;
  const closeSnapshot = buildCloseSnapshot(trade, exitPrice, candle, exitReason, pnl, rMultiple);
  const lossDiagnostics = {
    largeLoss: rMultiple <= -0.9 || pnl <= -(trade.maxRiskUsd || trade.riskUsd || 0) * 0.9,
    reason: exitReason === "stop"
      ? "Stop-loss was hit. Size was capped by max-risk rules; similar future conditions are penalized by the learning gate."
      : exitReason === "target"
        ? "Target was hit."
        : "Trade closed by timeout or snapshot rule.",
    riskUsd: trade.riskUsd,
    maxRiskUsd: trade.maxRiskUsd || trade.riskUsd,
    marginUsed: trade.marginUsed || 0,
    notional: trade.notional || 0,
    leverage: state.botDesk.settings.leverage,
    stopDistancePct: trade.entry > 0 ? Math.abs(trade.entry - trade.stopLoss) / trade.entry * 100 : 0,
  };

  bot.trades += 1;
  if (pnl >= 0) bot.wins += 1;
  else bot.losses += 1;
  bot.realizedPnl += pnl;
  bot.history.push({
    time: candle?.time ?? Date.now(),
    interval: trade.interval,
    side: trade.side,
    scenarioName: trade.scenarioName,
    scenarioLabel: trade.scenarioLabel,
    entry: trade.entry,
    exit: exitPrice,
    pnl,
    rMultiple,
    exitReason,
    snapshot: trade.snapshot || null,
    closeSnapshot,
    holdingMinutes: closeSnapshot.holdingMinutes,
    riskDiagnostics: lossDiagnostics,
  });
  bot.openTrade = null;
  bot.lastTradeTime = candle?.time ?? Date.now();
  return true;
}

function renderTradeSnapshotDetails(trade) {
  const snapshot = trade.snapshot;
  if (!snapshot) {
    return `<div class="history-snapshot-empty">Previous record has no indicator snapshot. New trades store full context automatically.</div>`;
  }
  const market = snapshot.market || {};
  const scenario = snapshot.scenario || {};
  const validation = snapshot.validation || {};
  const backtest = snapshot.backtest || {};
  const onchain = snapshot.onchain || {};
  const close = trade.closeSnapshot || {};
  const risk = trade.riskDiagnostics || {};
  const topIndicators = (snapshot.indicators || [])
    .slice()
    .sort((a, b) => Math.abs(b.points || 0) - Math.abs(a.points || 0))
    .slice(0, 8)
    .map((item) => `<li><span>${item.name}<small>${item.reading}</small></span><strong>${scoreLabel(item.signal)}</strong></li>`)
    .join("");

  return `
    <div class="history-snapshot">
      <div class="snapshot-grid">
        <div><span>Entry context</span><strong>${market.interval || "-"} · ${fmtUsd.format(market.price || trade.entry)}</strong><small>Score ${market.compositeScore || 0}/100 · Confidence ${market.confidence || 0}% · ${market.bias || "neutral"}</small></div>
        <div><span>Price structure</span><strong>${fmtUsd.format(market.support || 0)} / ${fmtUsd.format(market.resistance || 0)}</strong><small>ATR ${fmtUsd.format(market.atr || 0)} · ${fmt.format(market.atrPct || 0)}%</small></div>
        <div><span>Scenario</span><strong>${scenario.name || trade.scenarioName || "-"}</strong><small>Entry ${fmtUsd.format(scenario.entry || trade.entry)} · TP ${fmtUsd.format(scenario.takeProfit1 || 0)} · SL ${fmtUsd.format(scenario.stopLoss || 0)}</small></div>
        <div><span>1Y validation</span><strong>${fmt.format(validation.winRate || 0)}% · ${fmt.format(validation.expectancyR || 0)}R</strong><small>${fmtInt.format(validation.trades || 0)} samples · PF ${fmt.format(validation.profitFactor || 0)}</small></div>
        <div><span>Similar pattern</span><strong>${fmt.format(backtest.winRate || 0)}% · ${fmt.format(backtest.expectancyR || 0)}R</strong><small>${fmtInt.format(backtest.trades || 0)} samples · PF ${fmt.format(backtest.profitFactor || 0)}</small></div>
        <div><span>Exit</span><strong>${trade.exitReason || "-"} · ${fmt.format(trade.rMultiple || 0)}R</strong><small>${fmt.format(close.holdingMinutes || trade.holdingMinutes || 0)} min · ${fmtUsd.format(trade.pnl || 0)}</small></div>
        <div><span>Risk cap</span><strong>${fmtUsd.format(risk.riskUsd || 0)} / max ${fmtUsd.format(risk.maxRiskUsd || 0)}</strong><small>Margin ${fmtUsd.format(risk.marginUsed || 0)} · stop ${fmt.format(risk.stopDistancePct || 0)}%</small></div>
      </div>
      <div class="snapshot-note"><strong>Entry reason</strong><span>${scenario.summary || "Scenario and indicator confluence drove the simulated entry."}</span></div>
      <div class="snapshot-note"><strong>Loss analysis</strong><span>${risk.reason || "Risk diagnostics are stored for new trades."}</span></div>
      <div class="snapshot-note"><strong>On-chain</strong><span>${fmtInt.format(onchain.score || 50)}/100 · ${(onchain.notes || []).join(" · ") || "No on-chain memo"}</span></div>
      <ul class="snapshot-indicators">${topIndicators || `<li><span>No indicator snapshot</span><strong>-</strong></li>`}</ul>
    </div>
  `;
}

function scenarioKey(value) {
  return String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "unknown";
}

function edgeQualityKey(edge = {}) {
  const trades = Number(edge.trades) || 0;
  const winRate = Number(edge.winRate) || 0;
  const expectancy = Number(edge.expectancyR) || 0;
  const profitFactor = Number(edge.profitFactor) || 0;
  if (trades < RECOMMENDATION_MIN_SAMPLE) return "thin";
  if (expectancy < 0 || profitFactor < 1 || winRate < 49) return "negative";
  if (winRate >= 55 && expectancy > 0.05 && profitFactor >= 1.1) return "strong";
  return "mixed";
}

function botPlanValidationWeak(plan) {
  const validation = plan?.validationBacktest || plan?.backtest || {};
  const trades = Number(validation.trades) || 0;
  if (trades < RECOMMENDATION_MIN_SAMPLE) return true;
  return (Number(validation.expectancyR) || 0) < 0.02 || (Number(validation.profitFactor) || 0) < 1.05 || (Number(validation.winRate) || 0) < 50;
}

function tradeFeatureKeysFromSnapshot(snapshot) {
  if (!snapshot) return [];
  const market = snapshot.market || {};
  const scenario = snapshot.scenario || {};
  const validation = snapshot.validation || {};
  const backtest = snapshot.backtest || {};
  const onchain = snapshot.onchain || {};
  const price = Number(market.price) || Number(scenario.entry) || 0;
  const ema20 = Number(market.ema20);
  const ema50 = Number(market.ema50);
  const ema200 = Number(market.ema200);
  const vwap = Number(market.vwap);
  const rsi = parseSnapshotNumber(market.rsi);
  const supportGap = price > 0 && Number.isFinite(Number(market.support)) ? ((price - Number(market.support)) / price) * 100 : null;
  const resistanceGap = price > 0 && Number.isFinite(Number(market.resistance)) ? ((Number(market.resistance) - price) / price) * 100 : null;
  const rr = Number(scenario.rr) || 0;
  const entryWidthPct = price > 0 ? Math.abs((Number(scenario.entryHigh) || price) - (Number(scenario.entryLow) || price)) / price * 100 : 0;
  const side = scenario.side || "neutral";
  const bias = market.bias || "neutral";

  const keys = [
    `interval:${market.interval || "unknown"}`,
    `side:${side}`,
    `bias:${bias}`,
    `sideBias:${side}-${bias}`,
    `scenario:${scenarioKey(scenario.name || scenario.label || scenario.id)}`,
    `confidence:${bucketNumber(market.confidence, 48, 68)}`,
    `score:${bucketNumber(market.compositeScore, 45, 68)}`,
    `onchain:${bucketNumber(onchain.score, 45, 58)}`,
    `atr:${bucketNumber(market.atrPct, 0.35, 1.6)}`,
    `rr:${bucketNumber(rr, 1.05, 1.65)}`,
    `entryWidth:${bucketNumber(entryWidthPct, 0.12, 0.42)}`,
    `validation:${edgeQualityKey(validation)}`,
    `similar:${edgeQualityKey(backtest)}`,
  ];

  if (scenario.grade) keys.push(`grade:${scenario.grade}`);
  if (Number.isFinite(ema20) && Number.isFinite(ema50) && Number.isFinite(ema200)) {
    keys.push(`emaStack:${ema20 >= ema50 && ema50 >= ema200 ? "bull" : ema20 <= ema50 && ema50 <= ema200 ? "bear" : "mixed"}`);
  }
  if (price > 0 && Number.isFinite(vwap)) keys.push(`vwap:${price >= vwap ? "above" : "below"}`);
  if (Number.isFinite(rsi)) keys.push(`rsi:${bucketNumber(rsi, 42, 64)}`);
  if (Number.isFinite(supportGap)) keys.push(`supportGap:${bucketNumber(supportGap, 0.28, 1.2)}`);
  if (Number.isFinite(resistanceGap)) keys.push(`resistanceGap:${bucketNumber(resistanceGap, 0.28, 1.2)}`);

  (snapshot.indicators || [])
    .filter((item) => Math.abs(Number(item.signal) || 0) >= 0.7)
    .slice(0, 7)
    .forEach((item) => keys.push(`indicator:${item.name}:${item.signal > 0 ? "up" : "down"}`));

  return [...new Set(keys)];
}

function isBotLossTrade(trade) {
  return (Number(trade.pnl) || 0) < 0 || (Number(trade.rMultiple) || 0) < 0 || trade.exitReason === "stop";
}

function summarizeBotPerformance(bot) {
  const closed = (bot.history || []).map(normalizeBotTradeRecord);
  const wins = closed.filter((trade) => trade.pnl >= 0).length;
  const totalPnl = closed.reduce((sum, trade) => sum + trade.pnl, 0);
  const totalR = closed.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const targetCount = closed.filter((trade) => trade.exitReason === "target").length;
  const stopCount = closed.filter((trade) => trade.exitReason === "stop").length;
  const recent = closed.slice(-BOT_RECENT_WINDOW);
  const recentR = recent.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const featureMap = new Map();
  const sideMap = new Map();
  const intervalMap = new Map();
  const lossMap = new Map();

  const addStats = (map, key, trade) => {
    const item = map.get(key) || { key, trades: 0, wins: 0, stops: 0, targets: 0, totalR: 0, pnl: 0 };
    item.trades += 1;
    if (trade.pnl >= 0) item.wins += 1;
    if (trade.exitReason === "stop") item.stops += 1;
    if (trade.exitReason === "target") item.targets += 1;
    item.totalR += trade.rMultiple;
    item.pnl += trade.pnl;
    map.set(key, item);
  };
  const addLossStats = (key, trade) => {
    const item = lossMap.get(key) || { key, losses: 0, stops: 0, largeLosses: 0, totalLossR: 0, pnl: 0 };
    const lossR = Math.abs(Math.min(0, Number(trade.rMultiple) || 0));
    item.losses += 1;
    if (trade.exitReason === "stop") item.stops += 1;
    if (trade.riskDiagnostics?.largeLoss || lossR >= 0.9) item.largeLosses += 1;
    item.totalLossR += lossR;
    item.pnl += Number(trade.pnl) || 0;
    lossMap.set(key, item);
  };

  closed.forEach((trade) => {
    addStats(sideMap, trade.side || "unknown", trade);
    addStats(intervalMap, trade.interval || trade.snapshot?.market?.interval || "unknown", trade);
    const keys = tradeFeatureKeysFromSnapshot(trade.snapshot);
    keys.forEach((key) => addStats(featureMap, key, trade));
    if (isBotLossTrade(trade)) keys.forEach((key) => addLossStats(key, trade));
  });

  const enrich = (item) => ({
    ...item,
    winRate: item.trades ? (item.wins / item.trades) * 100 : 0,
    stopRate: item.trades ? (item.stops / item.trades) * 100 : 0,
    targetRate: item.trades ? (item.targets / item.trades) * 100 : 0,
    avgR: item.trades ? item.totalR / item.trades : 0,
  });
  const edges = [...featureMap.values()].map(enrich);
  const bySide = [...sideMap.values()].map(enrich).sort((a, b) => b.avgR - a.avgR);
  const byInterval = [...intervalMap.values()].map(enrich).sort((a, b) => b.avgR - a.avgR);
  const lossHotspots = [...lossMap.values()]
    .map((item) => {
      const total = featureMap.get(item.key) || { trades: item.losses, wins: 0, stops: item.stops, targets: 0, totalR: -item.totalLossR, pnl: item.pnl };
      const enriched = enrich(total);
      return {
        ...item,
        totalTrades: total.trades || item.losses,
        lossRate: total.trades ? (item.losses / total.trades) * 100 : 100,
        stopRate: total.trades ? (item.stops / total.trades) * 100 : 0,
        avgLossR: item.losses ? item.totalLossR / item.losses : 0,
        avgR: enriched.avgR,
        winRate: enriched.winRate,
      };
    })
    .filter((item) => item.losses >= 2 || item.largeLosses >= 1)
    .sort((a, b) => b.avgLossR - a.avgLossR || b.lossRate - a.lossRate)
    .slice(0, 8);
  const strongEdges = edges
    .filter((item) => item.trades >= BOT_LEARNING_MIN_TRADES && (item.avgR > 0.08 || item.winRate >= 58 || item.targetRate > item.stopRate + 18))
    .sort((a, b) => b.avgR - a.avgR || b.winRate - a.winRate)
    .slice(0, 6);
  const weakEdges = edges
    .filter((item) => item.trades >= BOT_LEARNING_MIN_TRADES && (item.avgR < -0.06 || item.stopRate >= 58 || lossHotspots.some((loss) => loss.key === item.key && loss.lossRate >= 55)))
    .sort((a, b) => a.avgR - b.avgR || b.stopRate - a.stopRate)
    .slice(0, 6);
  const blockedEdges = weakEdges
    .filter((item) => item.avgR < -0.16 || item.stopRate >= 66 || lossHotspots.some((loss) => loss.key === item.key && loss.losses >= 2 && loss.avgLossR >= 0.85))
    .slice(0, 4);
  const recentAvgR = recent.length ? recentR / recent.length : 0;
  const recentStopRate = recent.length ? (recent.filter((trade) => trade.exitReason === "stop").length / recent.length) * 100 : 0;
  const recentLosses = recent.filter(isBotLossTrade).length;
  const recentSlump = recent.length >= 4 && (recentAvgR < -0.14 || recentStopRate >= 62 || recentLosses >= Math.ceil(recent.length * 0.65));

  return {
    trades: closed.length,
    wins,
    losses: closed.length - wins,
    winRate: closed.length ? (wins / closed.length) * 100 : 0,
    totalPnl,
    avgR: closed.length ? totalR / closed.length : 0,
    targetRate: closed.length ? (targetCount / closed.length) * 100 : 0,
    stopRate: closed.length ? (stopCount / closed.length) * 100 : 0,
    recentTrades: recent.length,
    recentAvgR,
    recentStopRate,
    recentSlump,
    strongEdges,
    weakEdges,
    blockedEdges,
    lossHotspots,
    bySide,
    byInterval,
  };
}

function botLearningProfile(bot) {
  const performance = summarizeBotPerformance(bot);
  const lossCluster = performance.lossHotspots[0];
  if (performance.trades < BOT_LEARNING_MIN_TRADES) {
    const lossText = lossCluster
      ? `Loss watch: ${formatFeatureKey(lossCluster.key)} (${lossCluster.losses}/${lossCluster.totalTrades} losses, avg -${fmt.format(lossCluster.avgLossR)}R).`
      : "Loss watch: no repeated loss cluster yet.";
    return {
      ...performance,
      ready: false,
      mode: lossCluster ? "watch" : "collecting",
      summary: `Learning pending: ${performance.trades}/${BOT_LEARNING_MIN_TRADES} closed trades. ${lossText} The bot reduces risk after losses until more records exist.`,
    };
  }

  const best = performance.strongEdges[0];
  const worst = performance.weakEdges[0];
  const bestSegment = performance.byInterval[0] || performance.bySide[0];
  const mode = performance.recentSlump ? "defensive" : lossCluster ? "loss-aware" : best ? "focused" : "balanced";
  const modeText = mode === "defensive"
    ? "Defensive mode: recent stops or negative R are lowering entries and shrinking risk in similar conditions."
    : mode === "loss-aware"
      ? "Loss-aware mode: repeated losing clusters are being blocked or heavily discounted."
      : mode === "focused"
        ? "Focused mode: the bot is favoring conditions that produced stronger R multiples."
        : "Balanced mode: no dominant edge yet, so base strategy still carries more weight.";
  const edgeText = best ? `Boost: ${formatFeatureKey(best.key)} (${fmt.format(best.avgR)}R / ${fmt.format(best.winRate)}%).` : "Boost: still collecting reliable positive patterns.";
  const avoidText = worst ? `Avoid: ${formatFeatureKey(worst.key)} (${fmt.format(worst.avgR)}R / stop ${fmt.format(worst.stopRate)}%).` : "Avoid: no repeated weak pattern yet.";
  const lossText = lossCluster ? `Loss cluster: ${formatFeatureKey(lossCluster.key)} (${lossCluster.losses}/${lossCluster.totalTrades} losses, avg -${fmt.format(lossCluster.avgLossR)}R).` : "";
  const segmentText = bestSegment ? `Best segment: ${formatFeatureKey(bestSegment.key)} (${fmt.format(bestSegment.avgR)}R).` : "";

  return {
    ...performance,
    ready: true,
    mode,
    summary: `${modeText} ${edgeText} ${avoidText} ${lossText} ${segmentText}`,
  };
}

function lossPressureForPlan(bot, plan, analysis, profile = null) {
  const learning = profile || botLearningProfile(bot);
  const snapshot = buildTradeSnapshot({ bot, analysis, plan, entry: tradeEntryReference(plan), reason: "loss-pressure-preview" });
  const keys = new Set(tradeFeatureKeysFromSnapshot(snapshot));
  const matches = (learning.lossHotspots || []).filter((edge) => keys.has(edge.key));
  const validationWeak = botPlanValidationWeak(plan);
  if (!matches.length) return { penalty: 0, hardBlock: false, matches: [], reasons: [] };

  let penalty = 0;
  const reasons = [];
  matches.forEach((edge) => {
    const itemPenalty = clamp(edge.avgLossR * 9 + Math.max(0, edge.lossRate - 45) * 0.16 + edge.largeLosses * 3, 4, 24);
    penalty += itemPenalty;
    reasons.push(`loss ${formatFeatureKey(edge.key)}`);
  });
  const repeated = matches.some((edge) => edge.losses >= 2 && edge.lossRate >= 55 && edge.avgLossR >= 0.75);
  const hardBlock = repeated && validationWeak && !matches.some((edge) => edge.winRate >= 58 && edge.avgR > 0.05);
  return {
    penalty: clamp(penalty, 0, 46),
    hardBlock,
    matches,
    reasons,
  };
}

function botLearningGate(bot, plan, analysis) {
  const profile = botLearningProfile(bot);
  const snapshot = buildTradeSnapshot({ bot, analysis, plan, entry: tradeEntryReference(plan), reason: "gate-preview" });
  const keys = new Set(tradeFeatureKeysFromSnapshot(snapshot));
  const blocked = profile.blockedEdges.filter((edge) => keys.has(edge.key));
  const weak = profile.weakEdges.filter((edge) => keys.has(edge.key));
  const strong = profile.strongEdges.filter((edge) => keys.has(edge.key));
  const lossPressure = lossPressureForPlan(bot, plan, analysis, profile);
  const reasons = [];
  let adjustment = 0;

  strong.forEach((edge) => {
    adjustment += clamp(edge.avgR * 14 + (edge.winRate - 50) * 0.16 + (edge.targetRate - edge.stopRate) * 0.04, 2, 12);
    reasons.push(`boost ${formatFeatureKey(edge.key)}`);
  });
  weak.forEach((edge) => {
    adjustment -= clamp(Math.abs(edge.avgR) * 18 + Math.max(0, edge.stopRate - 45) * 0.12, 3, 18);
    reasons.push(`penalty ${formatFeatureKey(edge.key)}`);
  });
  if (lossPressure.penalty) {
    adjustment -= lossPressure.penalty;
    reasons.push(...lossPressure.reasons);
  }
  if (profile.recentSlump && !strong.length) {
    adjustment -= botPlanValidationWeak(plan) ? 14 : 8;
    reasons.push("recent defensive mode");
  }
  if (plan.grade === "A+" || plan.grade === "A") adjustment += 4;
  if (plan.grade === "C") adjustment -= 7;

  const hardBlocked = blocked.some((edge) => edge.avgR < -0.22 || edge.stopRate >= 70);
  const allowed = !(lossPressure.hardBlock && !strong.length) && !(hardBlocked && !strong.length) && !(profile.recentSlump && plan.grade === "C");
  return {
    allowed,
    adjustment: clamp(adjustment, -58, 32),
    reasons,
    blocked,
    weak,
    strong,
    lossPressure,
  };
}

function botRiskMultiplier(bot) {
  const streak = botLossStreak(bot);
  const profile = botLearningProfile(bot);
  let multiplier = 1;
  if (streak >= 3) multiplier *= 0.3;
  else if (streak === 2) multiplier *= 0.5;
  else if (streak === 1) multiplier *= 0.7;
  if (profile.recentSlump) multiplier *= 0.55;
  if (profile.avgR < -0.5 || profile.stopRate >= 70) multiplier *= 0.7;
  return clamp(multiplier, 0.2, 1);
}

function botPlanRiskMultiplier(bot, plan, analysis) {
  const profile = botLearningProfile(bot);
  const pressure = lossPressureForPlan(bot, plan, analysis, profile);
  let multiplier = botRiskMultiplier(bot);
  if (pressure.hardBlock) return 0;
  if (pressure.penalty >= 24) multiplier *= 0.45;
  else if (pressure.penalty >= 12) multiplier *= 0.65;
  if (botPlanValidationWeak(plan) && pressure.matches.length) multiplier *= 0.75;
  return clamp(multiplier, 0.15, 1);
}

function pickBotScenario(analysis, bot) {
  const scenarios = botScenarioPool(analysis, bot);
  if (!scenarios.length) return null;
  return scenarios
    .map((plan) => {
      const baseScore = botTradePlanKey(bot, plan);
      const strategyScore = botStrategyScore(bot, plan, analysis);
      const gate = botLearningGate(bot, plan, analysis);
      const exposure = botPortfolioExposureGate(bot, plan);
      const directionScore = botDirectionScore(bot, plan, analysis);
      const lossPenalty = gate.lossPressure?.penalty || 0;
      const blockedPenalty = gate.allowed && exposure.allowed ? 0 : -999;
      return {
        plan,
        score: baseScore + strategyScore + gate.adjustment + directionScore - lossPenalty + blockedPenalty,
        strategyScore,
        learningAdjustment: gate.adjustment,
        directionScore,
        lossPenalty,
      };
    })
    .sort((a, b) => b.score - a.score)[0]?.plan || scenarios[0];
}

function shouldOpenBotTrade(bot, analysis, plan) {
  if (!plan) return false;
  const validation = plan.validationBacktest || plan.backtest || {};
  const gate = botLearningGate(bot, plan, analysis);
  const exposure = botPortfolioExposureGate(bot, plan);
  const lossPressure = gate.lossPressure || lossPressureForPlan(bot, plan, analysis);
  if (!gate.allowed || !exposure.allowed || lossPressure.hardBlock) return false;
  if (botLossStreak(bot) >= 3 && plan.grade === "C") return false;
  const consensusSide = analysis?.bias === "bearish" ? "short" : analysis?.bias === "bullish" ? "long" : null;
  const counterTrend = consensusSide && plan.side !== consensusSide;
  if (counterTrend && botPlanValidationWeak(plan) && gate.adjustment <= 4) return false;
  if (lossPressure.penalty >= 28 && plan.grade !== "A+") return false;

  const nearEntry = Math.abs(analysis.price - tradeEntryReference(plan)) <= Math.max(analysis.atr * 0.22, analysis.price * 0.0009);
  const inRange = analysis.price >= plan.entryLow && analysis.price <= plan.entryHigh;
  const priceOk = inRange || nearEntry;
  const confidenceFloor = bot.strategy === "rr" ? 48 : bot.strategy === "winrate" || bot.id === "zeta" ? 54 : 50;
  const confidenceOk = analysis.confidence >= Math.max(44, confidenceFloor - Math.max(0, gate.adjustment) * 0.06);
  const gradeOk = plan.grade !== "C" || (bot.id === "gamma" && validation.expectancyR > 0.22 && gate.adjustment >= 6);
  const learnedOk = gate.adjustment > -20;

  if (!priceOk || !confidenceOk || !gradeOk || !learnedOk) return false;

  if (bot.strategy === "winrate") {
    return plan.validationPass && validation.winRate >= 55 && validation.expectancyR > 0 && validation.profitFactor >= 1.08;
  }
  if (bot.strategy === "expectancy") {
    return validation.expectancyR > 0.14 && validation.winRate >= 50 && validation.profitFactor >= 1.03;
  }
  if (bot.id === "delta") {
    const entry = tradeEntryReference(plan);
    const tpMovePct = entry > 0 ? Math.abs((plan.takeProfit1 || entry) - entry) / entry * 100 : 0;
    return tpMovePct <= 0.75 && validation.winRate >= 50 && validation.expectancyR > 0;
  }
  if (bot.id === "epsilon") {
    return validation.expectancyR > 0 && analysis.confidence >= 52 && (plan.grade === "A+" || plan.grade === "A" || gate.adjustment > 6);
  }
  if (bot.id === "zeta") {
    return validation.trades >= RECOMMENDATION_MIN_SAMPLE && validation.profitFactor >= 1.1 && validation.winRate >= 53;
  }
  return (plan.rr || 0) >= 1.2 && validation.expectancyR > 0 && validation.winRate >= 49;
}

function openBotTrade(bot, analysis, plan, candle, reason = "live") {
  if (bot.openTrade) return false;

  const available = botAvailableCapital(bot);
  if (!Number.isFinite(available) || available <= 0) return false;
  const riskMultiplier = botPlanRiskMultiplier(bot, plan, analysis);
  if (riskMultiplier <= 0) return false;
  const leverage = Math.max(1, Number(state.botDesk.settings.leverage) || 1);
  const entry = candle?.close ?? analysis.price;
  const stopLoss = pickBotStop(plan, entry, analysis);
  const stopDistance = Math.abs(entry - stopLoss);
  if (!Number.isFinite(stopDistance) || stopDistance <= 0) return false;

  const maxRiskUsd = Math.max(1, available * botMaxRiskPct(bot) * riskMultiplier);
  const rawMargin = Math.min(available, botAllocatedCapital(bot) * 0.38);
  const rawNotional = rawMargin * leverage;
  const quantityByMargin = entry > 0 ? rawNotional / entry : 0;
  const quantityByRisk = maxRiskUsd / stopDistance;
  const quantity = Math.min(quantityByMargin, quantityByRisk);
  const notional = quantity * entry;
  const marginUsed = leverage > 0 ? notional / leverage : notional;
  const takeProfit = pickBotTarget(bot, plan, entry, analysis);
  const riskUsd = stopDistance * quantity;

  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(riskUsd) || riskUsd <= 0 || marginUsed > available) return false;

  const snapshot = buildTradeSnapshot({ bot, analysis, plan, entry, reason });
  const learningGate = botLearningGate(bot, plan, analysis);
  const exposure = botPortfolioExposureGate(bot, plan);
  const lossPressure = learningGate.lossPressure || lossPressureForPlan(bot, plan, analysis);
  snapshot.decision.strategyScore = botStrategyScore(bot, plan, analysis);
  snapshot.decision.learningAdjustment = learningGate.adjustment;
  snapshot.decision.directionProfile = botDirectionProfile(bot).label;
  snapshot.decision.exposureReason = exposure.reason;
  snapshot.decision.lossPressure = {
    penalty: lossPressure.penalty,
    hardBlock: lossPressure.hardBlock,
    matches: lossPressure.matches.map((item) => ({
      key: item.key,
      losses: item.losses,
      totalTrades: item.totalTrades,
      avgLossR: item.avgLossR,
      lossRate: item.lossRate,
    })),
  };
  snapshot.decision.riskMultiplier = riskMultiplier;
  snapshot.decision.maxRiskUsd = maxRiskUsd;
  snapshot.decision.marginUsed = marginUsed;
  snapshot.decision.finalScore = botTradePlanKey(bot, plan) + snapshot.decision.strategyScore + snapshot.decision.learningAdjustment + botDirectionScore(bot, plan, analysis) - (lossPressure.penalty || 0);

  bot.openTrade = {
    entry,
    side: plan.side,
    stopLoss,
    takeProfit,
    quantity,
    notional,
    marginUsed,
    maxRiskUsd,
    riskUsd,
    openedAt: candle?.time ?? Date.now(),
    interval: state.interval,
    scenarioId: plan.scenarioId,
    scenarioName: plan.scenarioName,
    scenarioLabel: plan.scenarioLabel,
    reason,
    snapshot,
  };
  bot.lastSkipReason = null;
  bot.lastTradeTime = candle?.time ?? Date.now();
  return true;
}

function diagnoseBotTradeExit(trade, exitReason, pnl, rMultiple) {
  if (pnl >= 0) return exitReason === "target" ? "Target was hit." : "Closed positive by timeout or rule.";
  const snapshot = trade.snapshot || {};
  const market = snapshot.market || {};
  const scenario = snapshot.scenario || {};
  const validation = snapshot.validation || {};
  const backtest = snapshot.backtest || {};
  const reasons = [];
  if (exitReason === "stop") reasons.push("Stop-loss was hit");
  if (Math.abs(rMultiple) >= 1) reasons.push("full-R loss");
  if (edgeQualityKey(validation) === "negative") reasons.push("weak 1Y validation");
  if (edgeQualityKey(backtest) === "negative") reasons.push("weak similar-pattern backtest");
  const marketSide = market.bias === "bearish" ? "short" : market.bias === "bullish" ? "long" : null;
  if (scenario.side && marketSide && scenario.side !== marketSide) reasons.push("counter-bias entry");
  if ((Number(market.compositeScore) || 0) < 45) reasons.push("low composite score");
  if ((Number(market.atrPct) || 0) < 0.25) reasons.push("low-volatility chop risk");
  return `${reasons.join(", ") || "Negative close"}; future matching conditions receive stronger penalties and lower risk sizing.`;
}

function closeBotTrade(bot, exitPrice, candle, exitReason) {
  const trade = bot.openTrade;
  if (!trade) return false;
  const gross = trade.side === "long"
    ? (exitPrice - trade.entry) * trade.quantity
    : (trade.entry - exitPrice) * trade.quantity;
  const costRate = ((state.risk.feePct || 0) + (state.risk.slippagePct || 0)) / 100;
  const cost = trade.notional * costRate;
  const pnl = gross - cost;
  const rMultiple = trade.riskUsd > 0 ? pnl / trade.riskUsd : 0;
  const closeSnapshot = buildCloseSnapshot(trade, exitPrice, candle, exitReason, pnl, rMultiple);
  const stopDistancePct = trade.entry > 0 ? Math.abs(trade.entry - trade.stopLoss) / trade.entry * 100 : 0;
  const lossDiagnostics = {
    largeLoss: rMultiple <= -0.9 || pnl <= -(trade.maxRiskUsd || trade.riskUsd || 0) * 0.9,
    reason: diagnoseBotTradeExit(trade, exitReason, pnl, rMultiple),
    riskUsd: trade.riskUsd,
    maxRiskUsd: trade.maxRiskUsd || trade.riskUsd,
    marginUsed: trade.marginUsed || 0,
    notional: trade.notional || 0,
    leverage: state.botDesk.settings.leverage,
    stopDistancePct,
    featureKeys: tradeFeatureKeysFromSnapshot(trade.snapshot).slice(0, 16),
  };

  bot.trades += 1;
  if (pnl >= 0) bot.wins += 1;
  else bot.losses += 1;
  bot.realizedPnl += pnl;
  bot.history.push({
    time: candle?.time ?? Date.now(),
    interval: trade.interval,
    side: trade.side,
    scenarioName: trade.scenarioName,
    scenarioLabel: trade.scenarioLabel,
    entry: trade.entry,
    exit: exitPrice,
    pnl,
    rMultiple,
    exitReason,
    snapshot: trade.snapshot || null,
    closeSnapshot,
    holdingMinutes: closeSnapshot.holdingMinutes,
    riskDiagnostics: lossDiagnostics,
  });
  bot.openTrade = null;
  bot.lastTradeTime = candle?.time ?? Date.now();
  return true;
}

function renderLearningEdges(profile) {
  const strong = profile.strongEdges?.length
    ? profile.strongEdges.map((edge) => `<li><span>${formatFeatureKey(edge.key)}</span><strong>${fmt.format(edge.avgR)}R / ${fmt.format(edge.winRate)}%</strong></li>`).join("")
    : `<li><span>Collecting positive patterns</span><strong>-</strong></li>`;
  const weak = profile.weakEdges?.length
    ? profile.weakEdges.map((edge) => `<li><span>${formatFeatureKey(edge.key)}</span><strong>${fmt.format(edge.avgR)}R / stop ${fmt.format(edge.stopRate)}%</strong></li>`).join("")
    : `<li><span>No repeated weak pattern</span><strong>-</strong></li>`;
  const losses = profile.lossHotspots?.length
    ? profile.lossHotspots.slice(0, 4).map((edge) => `<li><span>${formatFeatureKey(edge.key)}</span><strong>${edge.losses}/${edge.totalTrades} · -${fmt.format(edge.avgLossR)}R</strong></li>`).join("")
    : `<li><span>No loss cluster</span><strong>-</strong></li>`;
  const segments = profile.byInterval?.length
    ? profile.byInterval.slice(0, 3).map((edge) => `<li><span>${formatFeatureKey(edge.key)}</span><strong>${fmt.format(edge.avgR)}R / ${fmt.format(edge.winRate)}%</strong></li>`).join("")
    : `<li><span>Segment data pending</span><strong>-</strong></li>`;
  return `
    <div class="learning-edge-grid">
      <section><h4>Boost conditions</h4><ul>${strong}</ul></section>
      <section><h4>Avoid conditions</h4><ul>${weak}</ul></section>
      <section><h4>Loss clusters</h4><ul>${losses}</ul></section>
      <section><h4>Best segments</h4><ul>${segments}</ul></section>
    </div>
  `;
}

function botSplitProfile(bot) {
  const profiles = {
    alpha: { entries: [0.55, 0.3, 0.15], exits: [0.5, 0.3, 1], name: "stable split" },
    beta: { entries: [0.5, 0.3, 0.2], exits: [0.42, 0.33, 1], name: "balanced split" },
    gamma: { entries: [0.45, 0.25, 0.3], exits: [0.3, 0.35, 1], name: "breakout split" },
    delta: { entries: [0.65, 0.25, 0.1], exits: [0.58, 0.28, 1], name: "scalp split" },
    epsilon: { entries: [0.5, 0.25, 0.25], exits: [0.32, 0.33, 1], name: "trend split" },
    zeta: { entries: [0.55, 0.25, 0.2], exits: [0.48, 0.32, 1], name: "validation split" },
  };
  return profiles[bot.id] || { entries: [0.55, 0.3, 0.15], exits: [0.45, 0.35, 1], name: "split" };
}

function validTargetForSide(side, entry, value) {
  return Number.isFinite(value) && (side === "short" ? value < entry : value > entry);
}

function clampBetween(value, a, b) {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return clamp(value, min, max);
}

function splitEntryLevels(plan, entry, stopLoss, analysis) {
  const side = plan.side === "short" ? "short" : "long";
  const riskUnit = Math.max(Math.abs(entry - stopLoss), analysis?.atr || entry * 0.003, entry * 0.0015);
  const tp1 = validTargetForSide(side, entry, plan.takeProfit1) ? plan.takeProfit1 : pickBotTarget({ strategy: "winrate" }, plan, entry, analysis);
  const pullback = side === "long"
    ? clampBetween(Math.min(entry - riskUnit * 0.28, Number(plan.entryLow) || entry - riskUnit * 0.18), stopLoss + riskUnit * 0.22, entry - riskUnit * 0.08)
    : clampBetween(Math.max(entry + riskUnit * 0.28, Number(plan.entryHigh) || entry + riskUnit * 0.18), entry + riskUnit * 0.08, stopLoss - riskUnit * 0.22);
  const confirmation = side === "long"
    ? clampBetween(entry + riskUnit * 0.2, entry + riskUnit * 0.08, tp1 - riskUnit * 0.08)
    : clampBetween(entry - riskUnit * 0.2, tp1 + riskUnit * 0.08, entry - riskUnit * 0.08);

  return [
    { id: "initial", label: "Initial", trigger: "market", price: entry, filled: true },
    { id: "pullback", label: side === "long" ? "Support add" : "Resistance add", trigger: "pullback", price: pullback, filled: false },
    { id: "confirmation", label: side === "long" ? "Breakout add" : "Breakdown add", trigger: "confirmation", price: confirmation, filled: false },
  ];
}

function splitTargetLevels(bot, plan, entry, analysis) {
  const side = plan.side === "short" ? "short" : "long";
  const profile = botSplitProfile(bot);
  const fallback = pickBotTarget(bot, plan, entry, analysis);
  const riskUnit = Math.max(Math.abs(entry - pickBotStop(plan, entry, analysis)), analysis?.atr || entry * 0.003, entry * 0.0015);
  const targets = [plan.takeProfit1, plan.takeProfit2, plan.takeProfit3].map((target, index) => {
    if (validTargetForSide(side, entry, target)) return target;
    const rr = [0.8, 1.25, 1.8][index];
    return side === "short" ? entry - riskUnit * rr : entry + riskUnit * rr;
  });
  if (!validTargetForSide(side, entry, targets[0])) targets[0] = fallback;
  return targets.map((price, index) => ({
    id: `tp${index + 1}`,
    label: `TP${index + 1}`,
    price,
    fraction: profile.exits[index] ?? (index === 2 ? 1 : 0.33),
    filled: false,
  }));
}

function trancheSizing(entry, stopLoss, riskUsd, marginUsd, leverage) {
  const stopDistance = Math.abs(entry - stopLoss);
  if (!Number.isFinite(stopDistance) || stopDistance <= 0 || !Number.isFinite(entry) || entry <= 0) return null;
  const qtyByRisk = riskUsd / stopDistance;
  const qtyByMargin = marginUsd > 0 ? (marginUsd * leverage) / entry : qtyByRisk;
  const quantity = Math.min(qtyByRisk, qtyByMargin);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const notional = quantity * entry;
  return {
    quantity,
    notional,
    marginUsed: leverage > 0 ? notional / leverage : notional,
    riskUsd: stopDistance * quantity,
  };
}

function refreshTradeNextTarget(trade) {
  const nextTarget = (trade.targetPlan || []).find((target) => !target.filled);
  trade.takeProfit = nextTarget ? nextTarget.price : trade.takeProfit;
}

function normalizeSplitOpenTrade(trade, bot = null, analysis = null) {
  if (!trade) return null;
  const side = trade.side === "short" ? "short" : "long";
  const totalQuantity = Number(trade.quantity) || Number(trade.remainingQuantity) || 0;
  const remaining = Number.isFinite(Number(trade.remainingQuantity)) ? Number(trade.remainingQuantity) : totalQuantity;
  trade.quantity = totalQuantity;
  trade.remainingQuantity = Math.max(0, remaining);
  trade.avgEntry = Number(trade.avgEntry) || Number(trade.entry) || 0;
  trade.realizedPnl = Number(trade.realizedPnl) || 0;
  trade.realizedCost = Number(trade.realizedCost) || 0;
  trade.closedQuantity = Number(trade.closedQuantity) || Math.max(0, totalQuantity - trade.remainingQuantity);
  trade.scaleIns = Array.isArray(trade.scaleIns) && trade.scaleIns.length
    ? trade.scaleIns
    : [{
        id: "initial",
        label: "Initial",
        trigger: "market",
        price: trade.entry,
        portion: 1,
        filled: true,
        quantity: totalQuantity,
        notional: Number(trade.notional) || totalQuantity * (Number(trade.entry) || 0),
        marginUsed: Number(trade.marginUsed) || 0,
        riskUsd: Number(trade.riskUsd) || 0,
        time: trade.openedAt || Date.now(),
      }];
  if (!Array.isArray(trade.targetPlan) || !trade.targetPlan.length) {
    const fallbackPlan = {
      side,
      takeProfit1: trade.takeProfit,
      takeProfit2: side === "short" ? trade.takeProfit - Math.abs(trade.entry - trade.takeProfit) * 0.65 : trade.takeProfit + Math.abs(trade.takeProfit - trade.entry) * 0.65,
      takeProfit3: side === "short" ? trade.takeProfit - Math.abs(trade.entry - trade.takeProfit) * 1.2 : trade.takeProfit + Math.abs(trade.takeProfit - trade.entry) * 1.2,
      stopLoss: trade.stopLoss,
    };
    trade.targetPlan = splitTargetLevels(bot || { id: "alpha", strategy: "winrate" }, fallbackPlan, trade.avgEntry || trade.entry, analysis || {});
  }
  trade.partialExits = Array.isArray(trade.partialExits) ? trade.partialExits : [];
  refreshTradeNextTarget(trade);
  return trade;
}

function botOpenPnl(bot, price) {
  const trade = normalizeSplitOpenTrade(bot.openTrade, bot);
  if (!trade) return 0;
  const quantity = Number(trade.remainingQuantity) || 0;
  if (!quantity || !Number.isFinite(price)) return 0;
  const entry = Number(trade.avgEntry) || Number(trade.entry) || 0;
  const move = trade.side === "long" ? price - entry : entry - price;
  return move * quantity;
}

function botScaleInSummary(trade) {
  const normalized = normalizeSplitOpenTrade(trade);
  if (!normalized) return "-";
  const scaleIns = normalized.scaleIns || [];
  const filled = scaleIns.filter((item) => item.filled).length;
  return `${filled}/${scaleIns.length} · avg ${fmtUsd.format(normalized.avgEntry || normalized.entry)}`;
}

function botPartialExitSummary(trade) {
  const normalized = normalizeSplitOpenTrade(trade);
  if (!normalized) return "-";
  const targets = normalized.targetPlan || [];
  const filled = targets.filter((item) => item.filled).length;
  const total = Number(normalized.quantity) || 0;
  const remaining = Number(normalized.remainingQuantity) || 0;
  const remainPct = total > 0 ? (remaining / total) * 100 : 0;
  return `${filled}/${targets.length} · remain ${fmt.format(remainPct)}%`;
}

function splitHit(trade, candle, price, trigger = "target") {
  if (!Number.isFinite(price)) return false;
  if (trade.side === "short") {
    return trigger === "pullback" ? candle.high >= price : candle.low <= price;
  }
  return trigger === "pullback" ? candle.low <= price : candle.high >= price;
}

function moveStopAfterPartial(trade, target) {
  const entry = Number(trade.avgEntry) || Number(trade.entry) || 0;
  if (!entry) return;
  if (target.id === "tp1") {
    trade.stopLoss = trade.side === "short" ? Math.min(trade.stopLoss, entry) : Math.max(trade.stopLoss, entry);
  }
  if (target.id === "tp2") {
    const tp1 = (trade.targetPlan || []).find((item) => item.id === "tp1");
    const trail = Number(tp1?.price) || entry;
    trade.stopLoss = trade.side === "short" ? Math.min(trade.stopLoss, trail) : Math.max(trade.stopLoss, trail);
  }
}

function applyPartialExit(bot, trade, target, candle) {
  normalizeSplitOpenTrade(trade, bot);
  const remaining = Number(trade.remainingQuantity) || 0;
  if (!remaining || target.filled) return false;
  const isFinal = target.id === "tp3" || (trade.targetPlan || []).filter((item) => !item.filled).length <= 1;
  const closeQty = isFinal ? remaining : Math.min(remaining, remaining * clamp(Number(target.fraction) || 0.33, 0.1, 0.85));
  if (!Number.isFinite(closeQty) || closeQty <= 0) return false;
  const exitPrice = target.price;
  const entry = Number(trade.avgEntry) || Number(trade.entry) || 0;
  const gross = trade.side === "long" ? (exitPrice - entry) * closeQty : (entry - exitPrice) * closeQty;
  const costRate = ((state.risk.feePct || 0) + (state.risk.slippagePct || 0)) / 100;
  const cost = Math.abs(exitPrice * closeQty) * costRate;
  const pnl = gross - cost;

  target.filled = true;
  target.filledAt = candle?.time ?? Date.now();
  target.quantity = closeQty;
  target.pnl = pnl;
  target.exitPrice = exitPrice;
  trade.remainingQuantity = Math.max(0, remaining - closeQty);
  trade.closedQuantity = (Number(trade.closedQuantity) || 0) + closeQty;
  trade.realizedPnl = (Number(trade.realizedPnl) || 0) + pnl;
  trade.realizedCost = (Number(trade.realizedCost) || 0) + cost;
  trade.partialExits.push({
    id: target.id,
    label: target.label,
    price: exitPrice,
    quantity: closeQty,
    pnl,
    time: candle?.time ?? Date.now(),
  });
  bot.realizedPnl += pnl;
  moveStopAfterPartial(trade, target);
  refreshTradeNextTarget(trade);
  return true;
}

function applyScaleIn(bot, trade, tranche, candle) {
  normalizeSplitOpenTrade(trade, bot);
  if (tranche.filled || trade.partialExits?.length) return false;
  const leverage = Math.max(1, Number(state.botDesk.settings.leverage) || 1);
  const maxMargin = Number(trade.maxMarginUsed) || Number(trade.marginUsed) || 0;
  const usedMargin = Number(trade.marginUsed) || 0;
  const marginBudget = Math.max(0, (Number(tranche.marginBudget) || 0) || maxMargin * (Number(tranche.portion) || 0));
  const remainingMargin = Math.max(0, maxMargin - usedMargin);
  const sizing = trancheSizing(tranche.price, trade.stopLoss, Number(tranche.riskBudget) || 0, Math.min(marginBudget, remainingMargin), leverage);
  if (!sizing) return false;
  const oldQuantity = Number(trade.remainingQuantity) || 0;
  const oldEntry = Number(trade.avgEntry) || Number(trade.entry) || tranche.price;
  const newQuantity = oldQuantity + sizing.quantity;
  trade.avgEntry = newQuantity > 0 ? ((oldEntry * oldQuantity) + (tranche.price * sizing.quantity)) / newQuantity : oldEntry;
  trade.entry = trade.avgEntry;
  trade.quantity = (Number(trade.quantity) || 0) + sizing.quantity;
  trade.remainingQuantity = newQuantity;
  trade.notional = (Number(trade.notional) || 0) + sizing.notional;
  trade.marginUsed = usedMargin + sizing.marginUsed;
  trade.riskUsd = (Number(trade.riskUsd) || 0) + sizing.riskUsd;
  tranche.filled = true;
  tranche.filledAt = candle?.time ?? Date.now();
  tranche.quantity = sizing.quantity;
  tranche.notional = sizing.notional;
  tranche.marginUsed = sizing.marginUsed;
  tranche.riskUsd = sizing.riskUsd;
  return true;
}

function processSplitScaleIns(bot, candle) {
  const trade = normalizeSplitOpenTrade(bot.openTrade, bot);
  if (!trade || trade.partialExits?.length) return false;
  let changed = false;
  (trade.scaleIns || []).forEach((tranche) => {
    if (tranche.filled || tranche.trigger === "market") return;
    const trigger = tranche.trigger === "pullback" ? "pullback" : "confirmation";
    if (splitHit(trade, candle, tranche.price, trigger)) {
      changed = applyScaleIn(bot, trade, tranche, candle) || changed;
    }
  });
  refreshTradeNextTarget(trade);
  return changed;
}

function processSplitTargets(bot, candle) {
  const trade = normalizeSplitOpenTrade(bot.openTrade, bot);
  if (!trade) return false;
  let changed = false;
  for (const target of trade.targetPlan || []) {
    if (target.filled) continue;
    if (!splitHit(trade, candle, target.price, "target")) continue;
    changed = applyPartialExit(bot, trade, target, candle) || changed;
    if (!bot.openTrade || (Number(trade.remainingQuantity) || 0) <= 0) {
      closeBotTrade(bot, target.price, candle, "target");
      return true;
    }
  }
  return changed;
}

function openBotTrade(bot, analysis, plan, candle, reason = "live") {
  if (bot.openTrade) return false;

  const available = botAvailableCapital(bot);
  if (!Number.isFinite(available) || available <= 0) return false;
  const riskMultiplier = botPlanRiskMultiplier(bot, plan, analysis);
  if (riskMultiplier <= 0) return false;
  const leverage = Math.max(1, Number(state.botDesk.settings.leverage) || 1);
  const entry = candle?.close ?? analysis.price;
  const stopLoss = pickBotStop(plan, entry, analysis);
  const stopDistance = Math.abs(entry - stopLoss);
  if (!Number.isFinite(stopDistance) || stopDistance <= 0) return false;

  const profile = botSplitProfile(bot);
  const entryPlan = splitEntryLevels(plan, entry, stopLoss, analysis);
  const targetPlan = splitTargetLevels(bot, plan, entry, analysis);
  const maxRiskUsd = Math.max(1, available * botMaxRiskPct(bot) * riskMultiplier);
  const maxMarginUsed = Math.min(available, botAllocatedCapital(bot) * 0.38);
  const initialRisk = maxRiskUsd * profile.entries[0];
  const initialMargin = maxMarginUsed * profile.entries[0];
  const sizing = trancheSizing(entry, stopLoss, initialRisk, initialMargin, leverage);
  if (!sizing) return false;

  const snapshot = buildTradeSnapshot({ bot, analysis, plan, entry, reason });
  const learningGate = botLearningGate(bot, plan, analysis);
  const exposure = botPortfolioExposureGate(bot, plan);
  const lossPressure = learningGate.lossPressure || lossPressureForPlan(bot, plan, analysis);
  snapshot.decision.strategyScore = botStrategyScore(bot, plan, analysis);
  snapshot.decision.learningAdjustment = learningGate.adjustment;
  snapshot.decision.directionProfile = botDirectionProfile(bot).label;
  snapshot.decision.exposureReason = exposure.reason;
  snapshot.decision.lossPressure = {
    penalty: lossPressure.penalty,
    hardBlock: lossPressure.hardBlock,
    matches: lossPressure.matches.map((item) => ({
      key: item.key,
      losses: item.losses,
      totalTrades: item.totalTrades,
      avgLossR: item.avgLossR,
      lossRate: item.lossRate,
    })),
  };
  snapshot.decision.splitProfile = profile.name;
  snapshot.decision.riskMultiplier = riskMultiplier;
  snapshot.decision.maxRiskUsd = maxRiskUsd;
  snapshot.decision.marginUsed = sizing.marginUsed;
  snapshot.decision.finalScore = botTradePlanKey(bot, plan) + snapshot.decision.strategyScore + snapshot.decision.learningAdjustment + botDirectionScore(bot, plan, analysis) - (lossPressure.penalty || 0);

  entryPlan.forEach((tranche, index) => {
    tranche.portion = profile.entries[index] || 0;
    tranche.riskBudget = maxRiskUsd * tranche.portion;
    tranche.marginBudget = maxMarginUsed * tranche.portion;
  });
  Object.assign(entryPlan[0], {
    quantity: sizing.quantity,
    notional: sizing.notional,
    marginUsed: sizing.marginUsed,
    riskUsd: sizing.riskUsd,
    time: candle?.time ?? Date.now(),
  });

  bot.openTrade = {
    entry,
    avgEntry: entry,
    side: plan.side,
    stopLoss,
    takeProfit: targetPlan[0]?.price || pickBotTarget(bot, plan, entry, analysis),
    targetPlan,
    scaleIns: entryPlan,
    partialExits: [],
    quantity: sizing.quantity,
    remainingQuantity: sizing.quantity,
    closedQuantity: 0,
    notional: sizing.notional,
    marginUsed: sizing.marginUsed,
    maxMarginUsed,
    maxRiskUsd,
    riskUsd: sizing.riskUsd,
    totalPlannedRiskUsd: maxRiskUsd,
    realizedPnl: 0,
    realizedCost: 0,
    openedAt: candle?.time ?? Date.now(),
    interval: state.interval,
    scenarioId: plan.scenarioId,
    scenarioName: plan.scenarioName,
    scenarioLabel: plan.scenarioLabel,
    reason,
    snapshot,
  };
  bot.lastSkipReason = null;
  bot.lastTradeTime = candle?.time ?? Date.now();
  return true;
}

function closeBotTrade(bot, exitPrice, candle, exitReason) {
  const trade = normalizeSplitOpenTrade(bot.openTrade, bot);
  if (!trade) return false;
  const remaining = Number.isFinite(Number(trade.remainingQuantity))
    ? Math.max(0, Number(trade.remainingQuantity))
    : Math.max(0, Number(trade.quantity) || 0);
  const entry = Number(trade.avgEntry) || Number(trade.entry) || 0;
  const costRate = ((state.risk.feePct || 0) + (state.risk.slippagePct || 0)) / 100;
  const gross = trade.side === "long" ? (exitPrice - entry) * remaining : (entry - exitPrice) * remaining;
  const cost = Math.abs(exitPrice * remaining) * costRate;
  const finalPnl = remaining > 0 ? gross - cost : 0;
  const totalPnl = (Number(trade.realizedPnl) || 0) + finalPnl;
  const totalRisk = Math.max(Number(trade.riskUsd) || Number(trade.maxRiskUsd) || 0, 1);
  const rMultiple = totalPnl / totalRisk;
  const closeSnapshot = buildCloseSnapshot(trade, exitPrice, candle, exitReason, totalPnl, rMultiple);
  const stopDistancePct = entry > 0 ? Math.abs(entry - trade.stopLoss) / entry * 100 : 0;
  const finalExit = remaining > 0 ? {
    id: exitReason,
    label: exitReason === "target" ? "Final TP" : exitReason,
    price: exitPrice,
    quantity: remaining,
    pnl: finalPnl,
    time: candle?.time ?? Date.now(),
  } : null;
  const partialExits = finalExit ? [...(trade.partialExits || []), finalExit] : [...(trade.partialExits || [])];
  const lossDiagnostics = {
    largeLoss: rMultiple <= -0.9 || totalPnl <= -(trade.maxRiskUsd || trade.riskUsd || 0) * 0.9,
    reason: diagnoseBotTradeExit(trade, exitReason, totalPnl, rMultiple),
    riskUsd: trade.riskUsd,
    maxRiskUsd: trade.maxRiskUsd || trade.riskUsd,
    marginUsed: trade.marginUsed || 0,
    notional: trade.notional || 0,
    leverage: state.botDesk.settings.leverage,
    stopDistancePct,
    featureKeys: tradeFeatureKeysFromSnapshot(trade.snapshot).slice(0, 16),
  };

  bot.trades += 1;
  if (totalPnl >= 0) bot.wins += 1;
  else bot.losses += 1;
  bot.realizedPnl += finalPnl;
  bot.history.push({
    time: candle?.time ?? Date.now(),
    interval: trade.interval,
    side: trade.side,
    scenarioName: trade.scenarioName,
    scenarioLabel: trade.scenarioLabel,
    entry: trade.avgEntry || trade.entry,
    exit: exitPrice,
    pnl: totalPnl,
    rMultiple,
    exitReason,
    snapshot: trade.snapshot || null,
    closeSnapshot,
    holdingMinutes: closeSnapshot.holdingMinutes,
    scaleIns: trade.scaleIns || [],
    partialExits,
    riskDiagnostics: lossDiagnostics,
  });
  bot.openTrade = null;
  bot.lastTradeTime = candle?.time ?? Date.now();
  return true;
}

function updateBotDeskOnCandle(candle, analysis) {
  if (!analysis) return;
  let changed = false;

  state.botDesk.bots.forEach((bot) => {
    if (!bot.openTrade || bot.lastTradeTime === candle.time) return;
    const trade = normalizeSplitOpenTrade(bot.openTrade, bot, analysis);
    const stopHit = trade.side === "long" ? candle.low <= trade.stopLoss : candle.high >= trade.stopLoss;
    const nextTarget = (trade.targetPlan || []).find((target) => !target.filled);
    const targetHit = nextTarget ? splitHit(trade, candle, nextTarget.price, "target") : false;
    const favorableCandle = trade.side === "long" ? candle.close >= candle.open : candle.close <= candle.open;

    if (stopHit && (!targetHit || !favorableCandle)) {
      changed = closeBotTrade(bot, trade.stopLoss, candle, "stop") || changed;
      return;
    }

    changed = processSplitScaleIns(bot, candle) || changed;
    changed = processSplitTargets(bot, candle) || changed;
  });

  if (!state.botDesk.running) {
    if (changed) saveBotDeskState();
    return;
  }

  const hasTradableCapital = state.botDesk.bots.some((bot) => bot.openTrade || !botIsDepleted(bot, candle.close));
  if (!hasTradableCapital) {
    state.botDesk.running = false;
    saveBotDeskState();
    return;
  }

  state.botDesk.bots.forEach((bot) => {
    if (bot.openTrade || bot.lastTradeTime === candle.time || botIsDepleted(bot, candle.close)) return;
    const plan = pickBotScenario(analysis, bot);
    if (plan && shouldOpenBotTrade(bot, analysis, plan)) {
      changed = openBotTrade(bot, analysis, plan, candle, "live") || changed;
    }
  });

  if (changed) saveBotDeskState();
}

function isHighProbabilityBot(bot) {
  return ["eta", "theta", "iota"].includes(bot?.id);
}

function botStrategyLabel(strategy) {
  if (strategy === "winrate") return "Win-rate first";
  if (strategy === "expectancy") return "Expectancy balance";
  if (strategy === "rr") return "R/R breakout";
  if (strategy === "probability") return "High-probability confluence";
  if (strategy === "quality") return "Low-volatility validation";
  if (strategy === "retest") return "Retest confirmation";
  return "Scenario";
}

function botProfileLabel(bot) {
  const labels = {
    alpha: "Stable bot: prioritizes win rate, validation pass, and weak-condition avoidance.",
    beta: "Balanced bot: weighs win rate, expectancy, and recent learned edges.",
    gamma: "Aggressive bot: still likes R/R, but avoids repeated stop-heavy patterns.",
    delta: "Scalping bot: prefers tight TP, tight range, and low-volatility winners.",
    epsilon: "Trend bot: favors EMA/VWAP/ADX alignment proven in its own records.",
    zeta: "Validation bot: prioritizes 1Y sample size, profit factor, and learned reliability.",
    eta: "High-probability bot: enters only when multi-indicator confluence and validation agree.",
    theta: "Quality bot: prefers calm volatility, high win-rate samples, and low adverse movement.",
    iota: "Retest bot: waits for price to be near a validated retest entry before entering.",
  };
  return labels[bot.id] || "Record-aware bot profile.";
}

function botTradePlanKey(bot, plan) {
  const validation = plan.validationBacktest || plan.backtest || {};
  const win = Number(validation.winRate) || 0;
  const expectancy = Number(validation.expectancyR) || 0;
  const pf = Number(validation.profitFactor) || 0;
  const sample = Number(validation.trades) || 0;
  if (bot.strategy === "probability") {
    return win * 2.25 + Math.max(0, expectancy) * 18 + pf * 14 + (plan.validationPass ? 22 : -12) + Math.min(sample, 80) * 0.08;
  }
  if (bot.strategy === "quality") {
    return win * 2.1 + pf * 18 + Math.max(0, 0.75 - (validation.avgAdverseR || 0.55)) * 18 + (plan.grade === "A+" ? 12 : plan.grade === "A" ? 7 : 0);
  }
  if (bot.strategy === "retest") {
    const widthPenalty = Math.max(0, (plan.entryHigh - plan.entryLow) / Math.max(tradeEntryReference(plan), 1) * 100 - 0.35) * 12;
    return win * 1.9 + expectancy * 16 + pf * 10 + (plan.validationPass ? 18 : -8) - widthPenalty;
  }
  if (bot.strategy === "winrate") {
    return win * 2 + expectancy * 10 + (plan.validationPass ? 25 : 0);
  }
  if (bot.strategy === "expectancy") {
    return expectancy * 18 + win + (plan.rr || 0) * 3;
  }
  return (plan.rr || 0) * 20 + expectancy * 8 + (plan.validationPass ? 10 : 0);
}

function botDirectionProfile(bot) {
  const map = {
    alpha: { mode: "primary", maxSameSide: 5, hedgeBonus: 0, label: "primary trend" },
    beta: { mode: "balanced", maxSameSide: 5, hedgeBonus: 7, label: "balanced rotation" },
    gamma: { mode: "counter", maxSameSide: 4, hedgeBonus: 18, label: "counter/hedge" },
    delta: { mode: "mean-reversion", maxSameSide: 4, hedgeBonus: 14, label: "mean reversion" },
    epsilon: { mode: "primary", maxSameSide: 5, hedgeBonus: 2, label: "trend follow" },
    zeta: { mode: "validation", maxSameSide: 5, hedgeBonus: 6, label: "validation best-side" },
    eta: { mode: "validation", maxSameSide: 5, hedgeBonus: 4, label: "probability confluence" },
    theta: { mode: "validation", maxSameSide: 5, hedgeBonus: 3, label: "quality validation" },
    iota: { mode: "balanced", maxSameSide: 5, hedgeBonus: 9, label: "retest rotation" },
  };
  return map[bot.id] || { mode: "balanced", maxSameSide: 5, hedgeBonus: 6, label: "balanced" };
}

function botMaxRiskPct(bot) {
  const map = {
    alpha: 0.008,
    beta: 0.009,
    gamma: 0.011,
    delta: 0.006,
    epsilon: 0.008,
    zeta: 0.007,
    eta: 0.0055,
    theta: 0.005,
    iota: 0.006,
  };
  return map[bot.id] || 0.007;
}

function botSplitProfile(bot) {
  const profiles = {
    alpha: { entries: [0.55, 0.3, 0.15], exits: [0.5, 0.3, 1], name: "stable split" },
    beta: { entries: [0.5, 0.3, 0.2], exits: [0.42, 0.33, 1], name: "balanced split" },
    gamma: { entries: [0.45, 0.25, 0.3], exits: [0.3, 0.35, 1], name: "breakout split" },
    delta: { entries: [0.65, 0.25, 0.1], exits: [0.58, 0.28, 1], name: "scalp split" },
    epsilon: { entries: [0.5, 0.25, 0.25], exits: [0.32, 0.33, 1], name: "trend split" },
    zeta: { entries: [0.55, 0.25, 0.2], exits: [0.48, 0.32, 1], name: "validation split" },
    eta: { entries: [0.6, 0.25, 0.15], exits: [0.55, 0.3, 1], name: "probability split" },
    theta: { entries: [0.62, 0.23, 0.15], exits: [0.6, 0.25, 1], name: "quality split" },
    iota: { entries: [0.5, 0.35, 0.15], exits: [0.5, 0.3, 1], name: "retest split" },
  };
  return profiles[bot.id] || { entries: [0.55, 0.3, 0.15], exits: [0.45, 0.35, 1], name: "split" };
}

function lossKeySpecificity(key) {
  const value = String(key || "");
  if (value.startsWith("scenario:")) return 1;
  if (value.startsWith("indicator:") || value === "validation:negative" || value === "similar:negative") return 0.9;
  if (value.startsWith("sideBias:")) return 0.55;
  if (value.startsWith("side:") || value.startsWith("emaStack:") || value.startsWith("vwap:") || value.startsWith("rsi:")) return 0.6;
  return 0.25;
}

function lossKeyCanHardBlock(key) {
  const value = String(key || "");
  return value.startsWith("scenario:") || value.startsWith("indicator:") || value === "validation:negative" || value === "similar:negative";
}

function lossPressureForPlan(bot, plan, analysis, profile = null) {
  const learning = profile || botLearningProfile(bot);
  const snapshot = buildTradeSnapshot({ bot, analysis, plan, entry: tradeEntryReference(plan), reason: "loss-pressure-preview" });
  const keys = new Set(tradeFeatureKeysFromSnapshot(snapshot));
  const matches = (learning.lossHotspots || []).filter((edge) => keys.has(edge.key));
  const validationWeak = botPlanValidationWeak(plan);
  if (!matches.length) return { penalty: 0, hardBlock: false, matches: [], reasons: [] };

  let penalty = 0;
  const reasons = [];
  matches.forEach((edge) => {
    const specificity = lossKeySpecificity(edge.key);
    const itemPenalty = clamp((edge.avgLossR * 9 + Math.max(0, edge.lossRate - 45) * 0.16 + edge.largeLosses * 3) * specificity, 2, 22);
    penalty += itemPenalty;
    reasons.push(`loss ${formatFeatureKey(edge.key)}`);
  });
  const specificRepeats = matches.filter((edge) => lossKeyCanHardBlock(edge.key));
  const repeatedSpecific = specificRepeats.some((edge) => edge.losses >= 2 && edge.lossRate >= 55 && edge.avgLossR >= 0.75);
  const hardBlock = repeatedSpecific && validationWeak && !specificRepeats.some((edge) => edge.winRate >= 58 && edge.avgR > 0.05);
  return {
    penalty: clamp(penalty, 0, 38),
    hardBlock,
    matches,
    reasons,
  };
}

function botLearningGate(bot, plan, analysis) {
  const profile = botLearningProfile(bot);
  const snapshot = buildTradeSnapshot({ bot, analysis, plan, entry: tradeEntryReference(plan), reason: "gate-preview" });
  const keys = new Set(tradeFeatureKeysFromSnapshot(snapshot));
  const blocked = profile.blockedEdges.filter((edge) => keys.has(edge.key));
  const weak = profile.weakEdges.filter((edge) => keys.has(edge.key));
  const strong = profile.strongEdges.filter((edge) => keys.has(edge.key));
  const lossPressure = lossPressureForPlan(bot, plan, analysis, profile);
  const reasons = [];
  let adjustment = 0;

  strong.forEach((edge) => {
    adjustment += clamp(edge.avgR * 14 + (edge.winRate - 50) * 0.16 + (edge.targetRate - edge.stopRate) * 0.04, 2, 12);
    reasons.push(`boost ${formatFeatureKey(edge.key)}`);
  });
  weak.forEach((edge) => {
    const specificity = lossKeySpecificity(edge.key);
    adjustment -= clamp((Math.abs(edge.avgR) * 18 + Math.max(0, edge.stopRate - 45) * 0.12) * specificity, 2, 18);
    reasons.push(`penalty ${formatFeatureKey(edge.key)}`);
  });
  if (lossPressure.penalty) {
    adjustment -= lossPressure.penalty;
    reasons.push(...lossPressure.reasons);
  }
  if (profile.recentSlump && !strong.length) {
    adjustment -= botPlanValidationWeak(plan) ? 10 : 6;
    reasons.push("recent defensive mode");
  }
  if (plan.grade === "A+" || plan.grade === "A") adjustment += 4;
  if (plan.grade === "C") adjustment -= 7;

  const hardBlocked = blocked.some((edge) => lossKeyCanHardBlock(edge.key) && (edge.avgR < -0.22 || edge.stopRate >= 70));
  const allowed = !(lossPressure.hardBlock && !strong.length) && !(hardBlocked && !strong.length) && !(profile.recentSlump && plan.grade === "C");
  return {
    allowed,
    adjustment: clamp(adjustment, -50, 32),
    reasons,
    blocked,
    weak,
    strong,
    lossPressure,
  };
}

function highProbabilityChecks(bot, plan, analysis, gate) {
  const validation = plan.validationBacktest || plan.backtest || {};
  const backtest = plan.backtest || validation;
  const entry = tradeEntryReference(plan);
  const distancePct = entry > 0 ? Math.abs(analysis.price - entry) / entry * 100 : 99;
  const mtf = multiTimeframeAlignment(plan.side);
  const atrPct = analysis.technicals?.atrPct ?? (analysis.price > 0 ? (analysis.atr / analysis.price) * 100 : 0);
  const win = Number(validation.winRate) || 0;
  const pf = Number(validation.profitFactor) || 0;
  const expectancy = Number(validation.expectancyR) || 0;
  const sample = Number(validation.trades) || 0;
  const similarOk = (Number(backtest.profitFactor) || 0) >= 1.02 && (Number(backtest.expectancyR) || 0) >= -0.03;
  const base = sample >= RECOMMENDATION_MIN_SAMPLE && win >= 53 && expectancy > 0 && pf >= 1.04 && analysis.confidence >= 50 && gate.adjustment > -26 && similarOk;
  if (bot.id === "eta") return base && win >= 55 && pf >= 1.08 && mtf.ratio >= 0.5;
  if (bot.id === "theta") return base && win >= 55 && pf >= 1.1 && atrPct >= 0.05 && atrPct <= 0.72 && (validation.avgAdverseR || 0.55) <= 0.85;
  if (bot.id === "iota") return base && distancePct <= Math.max(0.22, (analysis.atr / Math.max(analysis.price, 1)) * 100 * 0.95) && (plan.grade === "A+" || plan.grade === "A" || win >= 57);
  return base;
}

function botEntryEvaluation(bot, analysis, plan) {
  if (!plan) return { allowed: false, reason: "추천 후보 없음" };
  const validation = plan.validationBacktest || plan.backtest || {};
  const gate = botLearningGate(bot, plan, analysis);
  const exposure = botPortfolioExposureGate(bot, plan);
  const lossPressure = gate.lossPressure || lossPressureForPlan(bot, plan, analysis);
  if (!exposure.allowed) return { allowed: false, reason: "동일 방향 노출 제한" };
  if (!gate.allowed || lossPressure.hardBlock) return { allowed: false, reason: "반복 손실 조건 차단" };

  const nearEntry = Math.abs(analysis.price - tradeEntryReference(plan)) <= Math.max(analysis.atr * 0.34, analysis.price * 0.0014);
  const inRange = analysis.price >= plan.entryLow && analysis.price <= plan.entryHigh;
  const priceOk = inRange || nearEntry;
  if (!priceOk) return { allowed: false, reason: "진입가 대기" };

  if (isHighProbabilityBot(bot)) {
    return highProbabilityChecks(bot, plan, analysis, gate)
      ? { allowed: true, reason: "고확률 조건 충족" }
      : { allowed: false, reason: "고확률 조건 대기" };
  }

  if (botLossStreak(bot) >= 3 && plan.grade === "C") return { allowed: false, reason: "연속 손실 후 C등급 회피" };
  if (lossPressure.penalty >= 42 && plan.grade !== "A+") return { allowed: false, reason: "손실 클러스터 감점 과다" };

  const confidenceFloor = bot.strategy === "rr" ? 44 : bot.strategy === "winrate" || bot.id === "zeta" ? 49 : 46;
  const confidenceOk = analysis.confidence >= Math.max(40, confidenceFloor - Math.max(0, gate.adjustment) * 0.07);
  if (!confidenceOk) return { allowed: false, reason: "지표 합의도 부족" };

  if (bot.strategy === "winrate") {
    return plan.validationPass && (validation.winRate || 0) >= 52 && (validation.expectancyR || 0) > -0.01 && (validation.profitFactor || 0) >= 1
      ? { allowed: true, reason: "승률 조건 충족" }
      : { allowed: false, reason: "승률/검증 부족" };
  }
  if (bot.strategy === "expectancy") {
    return (validation.expectancyR || 0) > 0.06 && (validation.winRate || 0) >= 48 && (validation.profitFactor || 0) >= 1
      ? { allowed: true, reason: "기대값 조건 충족" }
      : { allowed: false, reason: "기대값 부족" };
  }
  if (bot.id === "delta") {
    const entry = tradeEntryReference(plan);
    const tpMovePct = entry > 0 ? Math.abs((plan.takeProfit1 || entry) - entry) / entry * 100 : 0;
    return tpMovePct <= 0.85 && (validation.winRate || 0) >= 48 && (validation.expectancyR || 0) >= -0.01
      ? { allowed: true, reason: "스캘핑 조건 충족" }
      : { allowed: false, reason: "스캘핑 조건 대기" };
  }
  if (bot.id === "epsilon") {
    return (validation.expectancyR || 0) > 0 && analysis.confidence >= 48
      ? { allowed: true, reason: "추세 조건 충족" }
      : { allowed: false, reason: "추세 조건 대기" };
  }
  return (plan.rr || 0) >= 1.05 && (validation.expectancyR || 0) >= -0.01 && (validation.winRate || 0) >= 46
    ? { allowed: true, reason: "기본 진입 조건 충족" }
    : { allowed: false, reason: "검증 조건 부족" };
}

function shouldOpenBotTrade(bot, analysis, plan) {
  return botEntryEvaluation(bot, analysis, plan).allowed;
}

function pickBotScenario(analysis, bot) {
  const scenarios = botScenarioPool(analysis, bot);
  if (!scenarios.length) return null;
  const ranked = scenarios
    .map((plan) => {
      const gate = botLearningGate(bot, plan, analysis);
      const exposure = botPortfolioExposureGate(bot, plan);
      const validation = plan.validationBacktest || plan.backtest || {};
      const highProbBonus = isHighProbabilityBot(bot)
        ? (Number(validation.winRate) || 0) * 0.55 + (Number(validation.profitFactor) || 0) * 8 + (plan.grade === "A+" ? 12 : plan.grade === "A" ? 7 : -4)
        : 0;
      const lossPenalty = gate.lossPressure?.penalty || 0;
      const blockedPenalty = gate.allowed && exposure.allowed ? 0 : -999;
      return {
        plan,
        score: botTradePlanKey(bot, plan) + botStrategyScore(bot, plan, analysis) + gate.adjustment + botDirectionScore(bot, plan, analysis) + highProbBonus - lossPenalty + blockedPenalty,
      };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.plan || null;
}

function attemptOpenBotTrade(bot, analysis, candle, reason) {
  if (bot.openTrade || botIsDepleted(bot, candle.close ?? analysis.price)) return false;
  const plan = pickBotScenario(analysis, bot);
  const evaluation = botEntryEvaluation(bot, analysis, plan);
  bot.lastSkipReason = evaluation.reason;
  if (!evaluation.allowed) return false;
  const opened = openBotTrade(bot, analysis, plan, candle, reason);
  if (!opened) bot.lastSkipReason = "리스크 한도 대기";
  return opened;
}

function startBotDeskTrading() {
  const analysis = getDisplayAnalysis() || state.analyses[state.interval];
  if (!analysis) return;
  state.botDesk.running = true;
  state.botDesk.seeded = true;
  const candle = { time: Date.now(), close: analysis.price, open: analysis.previous || analysis.price, high: analysis.price, low: analysis.price };
  let changed = false;
  state.botDesk.bots.forEach((bot) => {
    changed = attemptOpenBotTrade(bot, analysis, candle, "manual-start") || changed;
  });
  saveBotDeskState();
  if (changed) renderAll();
  else renderBotDesk();
}

function updateBotDeskOnCandle(candle, analysis) {
  if (!analysis) return;
  let changed = false;

  state.botDesk.bots.forEach((bot) => {
    if (!bot.openTrade || bot.lastTradeTime === candle.time) return;
    const trade = normalizeSplitOpenTrade(bot.openTrade, bot, analysis);
    const stopHit = trade.side === "long" ? candle.low <= trade.stopLoss : candle.high >= trade.stopLoss;
    const nextTarget = (trade.targetPlan || []).find((target) => !target.filled);
    const targetHit = nextTarget ? splitHit(trade, candle, nextTarget.price, "target") : false;
    const favorableCandle = trade.side === "long" ? candle.close >= candle.open : candle.close <= candle.open;

    if (stopHit && (!targetHit || !favorableCandle)) {
      changed = closeBotTrade(bot, trade.stopLoss, candle, "stop") || changed;
      return;
    }

    changed = processSplitScaleIns(bot, candle) || changed;
    changed = processSplitTargets(bot, candle) || changed;
  });

  if (!state.botDesk.running) {
    if (changed) saveBotDeskState();
    return;
  }

  const hasTradableCapital = state.botDesk.bots.some((bot) => bot.openTrade || !botIsDepleted(bot, candle.close));
  if (!hasTradableCapital) {
    state.botDesk.running = false;
    saveBotDeskState();
    return;
  }

  state.botDesk.bots.forEach((bot) => {
    if (bot.openTrade || bot.lastTradeTime === candle.time) return;
    changed = attemptOpenBotTrade(bot, analysis, candle, "live") || changed;
  });

  if (changed) saveBotDeskState();
}

function boot() {
  bindEvents();
  state.botDesk = loadBotDeskState();
  state.risk.accountSize = state.botDesk.settings.capital;
  initChart();
  refreshAll();
  setInterval(refreshAll, REPORT_MS);
  setInterval(updateCountdown, 1000);
}

window.addEventListener("DOMContentLoaded", boot);
