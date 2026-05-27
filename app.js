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

  for (let i = startIndex + 1; i <= endIndex; i += 1) {
    const bar = candles[i];
    if (side === "long") {
      const hitStop = bar.low <= stop;
      const hitTarget = bar.high >= target;
      if (hitStop && hitTarget) return { result: "loss", rMultiple: -1, barsHeld: i - startIndex, ambiguous: true };
      if (hitStop) return { result: "loss", rMultiple: -1, barsHeld: i - startIndex };
      if (hitTarget) return { result: "win", rMultiple: (target - entry) / risk, barsHeld: i - startIndex };
    } else {
      const hitStop = bar.high >= stop;
      const hitTarget = bar.low <= target;
      if (hitStop && hitTarget) return { result: "loss", rMultiple: -1, barsHeld: i - startIndex, ambiguous: true };
      if (hitStop) return { result: "loss", rMultiple: -1, barsHeld: i - startIndex };
      if (hitTarget) return { result: "win", rMultiple: (entry - target) / risk, barsHeld: i - startIndex };
    }
  }

  const exit = candles[endIndex].close;
  const rMultiple = side === "long" ? (exit - entry) / risk : (entry - exit) / risk;
  return {
    result: rMultiple >= 0 ? "timeout-win" : "timeout-loss",
    rMultiple,
    barsHeld: endIndex - startIndex,
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
        const sampleFactor = trades >= 60 ? 1 : trades >= 30 ? 0.94 : trades >= 18 ? 0.82 : 0.64;
        const expectancyScore = clamp((expectancyR + 0.08) / 0.72, 0, 1);
        const profitFactorScore = clamp((profitFactor - 0.9) / 1.25, 0, 1);
        const holdingPenalty = totalBars / trades > lookahead * 0.82 ? 0.92 : 1;
        const edgePenalty = expectancyR <= 0 || profitFactor < 1.05 ? 0.48 : winRate < 49 ? 0.72 : 1;
        const score = (
          winLowerBound * 0.33 +
          expectancyScore * 0.3 +
          profitFactorScore * 0.2 +
          avgSetupQuality * 0.17
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

function validationPasses(edge) {
  return Boolean(
    edge &&
    edge.trades >= 24 &&
    edge.winRate >= 51 &&
    edge.expectancyR > 0 &&
    edge.profitFactor >= 1.05
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
  const sampleScore = clamp(((validation?.trades ?? 0) - 12) / 48, 0.35, 1);
  const winSafety = clamp(((validation?.winLowerBound ?? 0) - 42) / 22, 0, 1);
  const directionAligned =
    bias === "neutral" ||
    (bias === "bullish" && side === "long") ||
    (bias === "bearish" && side === "short");
  const directionFactor = directionAligned ? 1 : technicalScore > 45 && technicalScore < 55 ? 0.93 : 0.82;
  const edgeFactor = (validation?.expectancyR ?? 0) > 0 && (validation?.profitFactor ?? 0) >= 1.05 ? 1 : 0.55;
  const score =
    (edge?.score ?? 0) * 0.28 +
    (validation?.score ?? 0) * 0.36 +
    setupScore * 0.16 +
    winSafety * 0.1 +
    sampleScore * 0.1;
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
  const scenarios = selected.tradeScenarios || [selected.tradePlan].filter(Boolean);
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
        allocation: 0.18,
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
        allocation: 0.17,
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
        allocation: 0.17,
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
        allocation: 0.16,
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
        allocation: 0.16,
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
        allocation: 0.16,
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

function hydrateBotDesk(raw) {
  const fallback = createDefaultBotDesk();
  const bots = fallback.bots.map((base, index) => {
    const source = raw?.bots?.find?.((bot) => bot?.id === base.id) || raw?.bots?.[index] || {};
    return {
      ...base,
      ...source,
      allocation: base.allocation,
      history: Array.isArray(source.history) ? source.history : [],
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

function botStrategyLabel(strategy) {
  if (strategy === "winrate") return "승률 우선";
  if (strategy === "expectancy") return "기대값 우선";
  if (strategy === "rr") return "손익비 우선";
  return "시나리오";
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
    .map((plan) => ({ plan, score: botTradePlanKey(bot, plan) }))
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
        <div class="bot-open">
          <div class="bot-line"><span>현재 시나리오</span><strong>${openTrade ? openTrade.scenarioName : "대기"}</strong></div>
          <div class="bot-line"><span>미실현 손익</span><strong class="${openPnlClass}">${fmtUsd.format(openPnl)}</strong></div>
          ${openTrade ? `
            <div class="bot-line"><span>진입 / 목표</span><strong>${fmtUsd.format(openTrade.entry)} → ${fmtUsd.format(openTrade.takeProfit)}</strong></div>
            <div class="bot-line"><span>손절</span><strong>${fmtUsd.format(openTrade.stopLoss)}</strong></div>
          ` : ""}
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
                    <span>${trade.scenarioName} · ${trade.exitReason}</span>
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

function renderBotHistoryPanel() {
  if (!els.botHistoryPanel) return;
  const bot = (state.botDesk.bots || []).find((item) => item.id === state.botDesk.activeHistoryBotId);
  if (!bot) {
    els.botHistoryPanel.innerHTML = "";
    return;
  }

  const history = [...bot.history].reverse();
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
          <div class="history-row">
            <span>${trade.scenarioName || "-"}</span>
            <span>${trade.side || "-"} · ${trade.exitReason || "-"}</span>
            <span>${fmtUsd.format(trade.entry)}</span>
            <span>${fmtUsd.format(trade.exit)}</span>
            <span>${fmt.format(trade.rMultiple || 0)}R</span>
            <strong class="${trade.pnl >= 0 ? "positive" : "negative"}">${fmtUsd.format(trade.pnl)}</strong>
          </div>
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
    state.analyses[state.interval] = analyzeCandlesV2(state.candlesByInterval[state.interval], state.interval);
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
