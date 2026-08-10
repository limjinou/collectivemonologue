const LOCATIONS = [
  { name: '서울', aliases: ['서울특별시'], label: '서울특별시 중구 태평로1가', latitude: 37.5665, longitude: 126.9780 },
  { name: '인천', aliases: ['인천광역시'], label: '인천광역시 남동구 구월동', latitude: 37.4563, longitude: 126.7052 },
  { name: '수원', aliases: ['수원시'], label: '경기도 수원시 팔달구', latitude: 37.2636, longitude: 127.0286 },
  { name: '고양', aliases: ['고양시', '일산'], label: '경기도 고양시 일산동구', latitude: 37.6584, longitude: 126.8320 },
  { name: '파주', aliases: ['파주시'], label: '경기도 파주시 금촌동', latitude: 37.7599, longitude: 126.7800 },
  { name: '성남', aliases: ['성남시', '분당'], label: '경기도 성남시 분당구', latitude: 37.4200, longitude: 127.1265 },
  { name: '춘천', aliases: ['춘천시'], label: '강원특별자치도 춘천시', latitude: 37.8813, longitude: 127.7298 },
  { name: '강릉', aliases: ['강릉시'], label: '강원특별자치도 강릉시', latitude: 37.7519, longitude: 128.8761 },
  { name: '대전', aliases: ['대전광역시'], label: '대전광역시 중구', latitude: 36.3504, longitude: 127.3845 },
  { name: '전주', aliases: ['전주시'], label: '전북특별자치도 전주시 완산구', latitude: 35.8242, longitude: 127.1480 },
  { name: '광주', aliases: ['광주광역시'], label: '광주광역시 동구', latitude: 35.1595, longitude: 126.8526 },
  { name: '대구', aliases: ['대구광역시'], label: '대구광역시 중구', latitude: 35.8714, longitude: 128.6014 },
  { name: '부산', aliases: ['부산광역시'], label: '부산광역시 중구', latitude: 35.1796, longitude: 129.0756 },
  { name: '울산', aliases: ['울산광역시'], label: '울산광역시 중구', latitude: 35.5384, longitude: 129.3114 },
  { name: '제주', aliases: ['제주시', '제주도'], label: '제주특별자치도 제주시', latitude: 33.4996, longitude: 126.5312 },
  { name: '서귀포', aliases: ['서귀포시'], label: '제주특별자치도 서귀포시', latitude: 33.2541, longitude: 126.5601 }
];

const STORAGE_KEY = 'stageis-sun-weather-plan-v2';
const WEATHER_CACHE_KEY = 'stageis-weather-cache-v1';
const GEOCODE_CACHE_KEY = 'stageis-geocode-cache-v1';
const DAY_MINUTES = 1440;
const KOREA_TIME_ZONE = 'Asia/Seoul';
const NOMINATIM_GAP_MS = 1100;
const WEATHER_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';

let selectedLocation = { ...LOCATIONS[0], name: LOCATIONS[0].label, source: 'preset' };
let currentContext = null;
let currentReport = '';
let toastTimer;
let simulationVersion = 0;
let simulationTimer;
let locationMap;
let locationMarker;
let pendingMapLocation;
let nominatimQueue = Promise.resolve();
let lastNominatimAt = 0;

document.addEventListener('DOMContentLoaded', () => {
  initializeIcons();
  populateLocations();
  initializeDate();
  restorePlan();
  bindEvents();
  updateLocationDisplay();
  window.setTimeout(() => runSimulation(), 120);
});

function initializeIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function populateLocations() {
  const list = document.getElementById('location-list');
  if (!list) return;
  list.innerHTML = '';
  LOCATIONS.forEach((location) => {
    const option = document.createElement('option');
    option.value = location.name;
    option.label = location.label;
    list.appendChild(option);
  });
}

function initializeDate() {
  const input = document.getElementById('shoot-date');
  if (!input) return;
  const today = startOfDay(new Date());
  input.min = toDateInput(today);
  input.max = toDateInput(addDays(today, 180));
  if (!input.value) input.value = toDateInput(addDays(today, 1));
}

function bindEvents() {
  const form = document.getElementById('shoot-form');
  const locationInput = document.getElementById('location');

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (await resolveTypedLocation()) runSimulation();
  });

  locationInput?.addEventListener('change', syncPresetLocation);
  locationInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      resolveTypedLocation().then((resolved) => {
        if (resolved) runSimulation();
      });
    }
  });

  ['shoot-date', 'start-time', 'end-time', 'light-goal'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', scheduleSimulation);
  });

  document.getElementById('scene-time')?.addEventListener('input', (event) => {
    renderFocusedTime(Number(event.target.value));
  });
  document.getElementById('search-location')?.addEventListener('click', async () => {
    if (await resolveTypedLocation(true)) runSimulation();
  });
  document.getElementById('use-location')?.addEventListener('click', useCurrentLocation);
  document.getElementById('open-location-map')?.addEventListener('click', openLocationMap);
  document.getElementById('close-location-map')?.addEventListener('click', closeLocationMap);
  document.getElementById('map-use-current')?.addEventListener('click', useCurrentLocationInMap);
  document.getElementById('apply-map-location')?.addEventListener('click', applyMapLocation);
  document.getElementById('reset-plan')?.addEventListener('click', resetPlan);
  document.getElementById('copy-report')?.addEventListener('click', copyReport);
  document.getElementById('download-report')?.addEventListener('click', downloadReport);
  document.getElementById('print-report')?.addEventListener('click', () => window.print());

  document.getElementById('location-map-dialog')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeLocationMap();
  });
}

function scheduleSimulation() {
  window.clearTimeout(simulationTimer);
  simulationTimer = window.setTimeout(() => runSimulation(), 180);
}

function syncPresetLocation() {
  const input = document.getElementById('location');
  if (!input) return false;
  const query = input.value.trim().toLowerCase();
  const currentName = String(selectedLocation.name || '').trim().toLowerCase();
  if (query === currentName) {
    updateLocationDisplay();
    return true;
  }

  const match = LOCATIONS.find((location) => {
    const candidates = [location.name, location.label, ...(location.aliases || [])];
    return candidates.some((candidate) => candidate.toLowerCase() === query);
  });

  if (!match) {
    setText('location-status', '주소를 입력한 뒤 검색 버튼을 누르거나 지도에 핀을 찍으세요.');
    return false;
  }

  selectedLocation = { ...match, name: match.label, source: 'preset' };
  input.value = match.label;
  updateLocationDisplay();
  return true;
}

async function resolveTypedLocation(showFailureToast = false) {
  if (syncPresetLocation()) return true;
  const input = document.getElementById('location');
  const query = input?.value.trim();
  if (!query) return false;

  setText('location-status', '주소를 검색하고 있습니다.');
  setLocationButtonsDisabled(true);
  try {
    const result = await searchAddress(query);
    if (!result) throw new Error('not-found');
    selectedLocation = {
      name: formatAddress(result),
      latitude: Number(result.lat),
      longitude: Number(result.lon),
      source: 'search'
    };
    if (input) input.value = selectedLocation.name;
    updateLocationDisplay();
    if (locationMap) setPendingMapLocation(selectedLocation.latitude, selectedLocation.longitude, true, 16);
    return true;
  } catch {
    if (input) input.value = selectedLocation.name;
    setText('location-status', `주소를 찾지 못해 기존 위치를 유지합니다 · ${selectedLocation.name}`);
    if (showFailureToast) showToast('주소를 찾지 못했습니다. 지도에서 직접 선택해 보세요.');
    return false;
  } finally {
    setLocationButtonsDisabled(false);
  }
}

function updateLocationDisplay() {
  const input = document.getElementById('location');
  const status = document.getElementById('location-status');
  if (input) input.value = selectedLocation.name;
  if (status) {
    status.textContent = `${selectedLocation.latitude.toFixed(5)}, ${selectedLocation.longitude.toFixed(5)} · ${selectedLocation.name}`;
  }
}

function setLocationButtonsDisabled(disabled) {
  ['search-location', 'use-location', 'open-location-map'].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.disabled = disabled;
  });
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    showToast('이 브라우저에서는 현재 위치를 사용할 수 없습니다.');
    return;
  }

  setText('location-status', '현재 위치를 확인하고 있습니다.');
  setLocationButtonsDisabled(true);
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      selectedLocation = { name: '현재 위치', latitude, longitude, source: 'device' };
      try {
        const address = await reverseAddress(latitude, longitude);
        if (address) selectedLocation.name = address;
      } catch {
        selectedLocation.name = `현재 위치 ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      }
      setLocationButtonsDisabled(false);
      updateLocationDisplay();
      runSimulation();
    },
    () => {
      setLocationButtonsDisabled(false);
      setText('location-status', '위치 권한을 확인한 뒤 다시 시도하세요.');
      showToast('현재 위치를 가져오지 못했습니다.');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 }
  );
}

function openLocationMap() {
  const dialog = document.getElementById('location-map-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') {
    showToast('이 브라우저에서는 지도 선택창을 열 수 없습니다.');
    return;
  }
  if (!window.L) {
    showToast('지도를 불러오지 못했습니다. 잠시 후 다시 시도하세요.');
    return;
  }

  pendingMapLocation = {
    latitude: selectedLocation.latitude,
    longitude: selectedLocation.longitude
  };
  dialog.showModal();
  if (!locationMap) initializeLocationMap();
  window.setTimeout(() => {
    locationMap.invalidateSize();
    setPendingMapLocation(pendingMapLocation.latitude, pendingMapLocation.longitude, true, 16);
  }, 80);
}

function closeLocationMap() {
  const dialog = document.getElementById('location-map-dialog');
  if (dialog?.open) dialog.close();
}

function initializeLocationMap() {
  locationMap = window.L.map('location-map', {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true
  }).setView([selectedLocation.latitude, selectedLocation.longitude], 16);

  window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(locationMap);

  locationMarker = window.L.circleMarker([selectedLocation.latitude, selectedLocation.longitude], {
    radius: 9,
    color: '#151515',
    weight: 3,
    fillColor: '#ffd60a',
    fillOpacity: 1
  }).addTo(locationMap);

  locationMap.on('click', (event) => {
    setPendingMapLocation(event.latlng.lat, event.latlng.lng, false);
  });
}

function setPendingMapLocation(latitude, longitude, moveMap, zoom) {
  pendingMapLocation = { latitude, longitude };
  locationMarker?.setLatLng([latitude, longitude]);
  setText('map-coordinate-value', `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
  if (moveMap && locationMap) locationMap.setView([latitude, longitude], zoom || locationMap.getZoom(), { animate: false });
}

function useCurrentLocationInMap() {
  if (!navigator.geolocation) {
    showToast('이 브라우저에서는 현재 위치를 사용할 수 없습니다.');
    return;
  }
  const button = document.getElementById('map-use-current');
  if (button) button.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      setPendingMapLocation(position.coords.latitude, position.coords.longitude, true, 17);
      if (button) button.disabled = false;
    },
    () => {
      if (button) button.disabled = false;
      showToast('현재 위치를 가져오지 못했습니다.');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 }
  );
}

async function applyMapLocation() {
  if (!pendingMapLocation) return;
  const button = document.getElementById('apply-map-location');
  if (button) button.disabled = true;
  setText('map-coordinate-value', '상세 주소 확인 중');

  let name = `지도 위치 ${pendingMapLocation.latitude.toFixed(4)}, ${pendingMapLocation.longitude.toFixed(4)}`;
  try {
    name = await reverseAddress(pendingMapLocation.latitude, pendingMapLocation.longitude) || name;
  } catch {
    showToast('좌표는 적용했지만 상세 주소는 찾지 못했습니다.');
  }

  selectedLocation = {
    name,
    latitude: pendingMapLocation.latitude,
    longitude: pendingMapLocation.longitude,
    source: 'map'
  };
  if (button) button.disabled = false;
  closeLocationMap();
  updateLocationDisplay();
  runSimulation();
}

async function searchAddress(query) {
  const key = `search:${query.trim().toLowerCase()}`;
  const cached = readObjectCache(GEOCODE_CACHE_KEY)[key];
  if (cached) return cached;
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    format: 'jsonv2',
    q: `${query}, 대한민국`,
    limit: '1',
    addressdetails: '1',
    countrycodes: 'kr',
    'accept-language': 'ko'
  }).toString();
  const data = await requestNominatim(url.toString());
  const result = Array.isArray(data) ? data[0] : null;
  if (result) writeObjectCache(GEOCODE_CACHE_KEY, key, result, 40);
  return result;
}

async function reverseAddress(latitude, longitude) {
  const key = `reverse:${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  const cached = readObjectCache(GEOCODE_CACHE_KEY)[key];
  if (cached) return formatAddress(cached);
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.search = new URLSearchParams({
    format: 'jsonv2',
    lat: latitude.toFixed(5),
    lon: longitude.toFixed(5),
    zoom: '18',
    addressdetails: '1',
    'accept-language': 'ko'
  }).toString();
  const data = await requestNominatim(url.toString());
  writeObjectCache(GEOCODE_CACHE_KEY, key, data, 40);
  return formatAddress(data);
}

function requestNominatim(url) {
  const task = nominatimQueue.then(async () => {
    const waitMs = Math.max(0, NOMINATIM_GAP_MS - (Date.now() - lastNominatimAt));
    if (waitMs) await delay(waitMs);
    lastNominatimAt = Date.now();
    const response = await fetch(url, { headers: { 'Accept-Language': 'ko' } });
    if (!response.ok) throw new Error(`Geocoding failed: ${response.status}`);
    return response.json();
  });
  nominatimQueue = task.then(() => undefined, () => undefined);
  return task;
}

function formatAddress(item) {
  const address = item?.address || {};
  const localArea = address.quarter || address.neighbourhood || address.suburb || address.village || address.town || address.municipality;
  const parts = [
    address.state,
    address.city,
    address.county,
    address.borough,
    address.city_district,
    localArea,
    address.road,
    address.house_number
  ].filter(Boolean);
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);
  if (unique.length) return unique.join(' ');
  return String(item?.display_name || '선택한 위치').split(',').slice(0, 5).join(', ').trim();
}

async function runSimulation() {
  const form = document.getElementById('shoot-form');
  const panel = document.getElementById('result-panel');
  if (!form || !panel) return;
  const version = ++simulationVersion;
  const plan = readPlan(form);
  const validation = validatePlan(plan);
  if (validation) {
    showToast(validation);
    return;
  }

  panel.setAttribute('aria-busy', 'true');
  updateForecastBadge('자동 예보 불러오는 중');
  setText('weather-fetch-status', '시간별 하늘과 기온을 불러오고 있습니다.');
  savePlan(plan);

  const solar = calculateSolar(plan);
  const loadingWeather = { unavailable: true, reason: 'loading', hours: [] };
  renderSimulation(plan, solar, loadingWeather);

  const weather = await fetchWeather(plan);
  if (version !== simulationVersion) return;
  renderSimulation(plan, solar, weather);
  panel.setAttribute('aria-busy', 'false');
}

function readPlan(form) {
  const data = new FormData(form);
  return {
    location: selectedLocation.name,
    latitude: selectedLocation.latitude,
    longitude: selectedLocation.longitude,
    locationSource: selectedLocation.source || 'preset',
    date: String(data.get('shootDate')),
    lightGoal: String(data.get('lightGoal')),
    startTime: String(data.get('startTime')),
    endTime: String(data.get('endTime')),
    environment: 'outdoor'
  };
}

function validatePlan(plan) {
  if (!plan.date) return '촬영일을 선택하세요.';
  if (!plan.startTime || !plan.endTime) return '확인 시작과 종료 시간을 입력하세요.';
  const duration = durationMinutes(plan.startTime, plan.endTime);
  if (duration < 60) return '확인 구간은 최소 한 시간 이상으로 잡아주세요.';
  if (duration > 24 * 60) return '한 번에 확인할 수 있는 범위는 24시간입니다.';
  return '';
}

function calculateSolar(plan) {
  if (!window.SunCalc) return null;
  const anchor = new Date(`${plan.date}T12:00:00+09:00`);
  const times = window.SunCalc.getTimes(anchor, plan.latitude, plan.longitude);
  return {
    dawn: times.dawn,
    sunrise: times.sunrise,
    goldenMorningEnd: times.goldenHourEnd,
    goldenEveningStart: times.goldenHour,
    sunset: times.sunset,
    dusk: times.dusk
  };
}

async function fetchWeather(plan) {
  const lat = Number(plan.latitude.toFixed(4));
  const lon = Number(plan.longitude.toFixed(4));
  const key = `${lat},${lon}`;
  const cache = readObjectCache(WEATHER_CACHE_KEY);
  const cached = cache[key];
  let payload;
  let expiresAt = 0;

  try {
    if (cached && cached.expiresAt > Date.now() && cached.payload) {
      payload = cached.payload;
      expiresAt = cached.expiresAt;
    } else {
      const url = `${WEATHER_URL}?lat=${lat}&lon=${lon}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Weather failed: ${response.status}`);
      payload = await response.json();
      expiresAt = Date.parse(response.headers.get('Expires') || '') || Date.now() + 30 * 60 * 1000;
      writeObjectCache(WEATHER_CACHE_KEY, key, { payload, expiresAt, savedAt: Date.now() }, 6);
    }
    return normalizeWeather(payload, plan, expiresAt);
  } catch (error) {
    console.warn('Stage-Is weather fetch failed.', error);
    return {
      unavailable: true,
      reason: 'network',
      hours: [],
      label: '예보를 불러오지 못함',
      source: 'MET Norway'
    };
  }
}

function normalizeWeather(payload, plan, expiresAt) {
  const timeseries = payload?.properties?.timeseries;
  if (!Array.isArray(timeseries)) return { unavailable: true, reason: 'format', hours: [] };
  const [planYear, planMonth, planDay] = plan.date.split('-').map(Number);
  const planDateOrdinal = Date.UTC(planYear, planMonth - 1, planDay);
  const start = timeToMinutes(plan.startTime);
  const end = normalizeEndMinutes(plan.startTime, plan.endTime);

  const allPoints = timeseries.map((entry) => {
    const date = new Date(entry.time);
    const parts = koreaDateParts(date);
    const localDayOrdinal = Date.UTC(parts.year, parts.month - 1, parts.day);
    const dayOffset = Math.round((localDayOrdinal - planDateOrdinal) / 86400000);
    const minute = dayOffset * DAY_MINUTES + parts.hour * 60 + parts.minute;
    const instant = entry.data?.instant?.details || {};
    const interval = entry.data?.next_1_hours || entry.data?.next_6_hours || entry.data?.next_12_hours || {};
    const intervalHours = entry.data?.next_1_hours ? 1 : entry.data?.next_6_hours ? 6 : entry.data?.next_12_hours ? 12 : 0;
    const temperature = numberOrNull(instant.air_temperature);
    const humidity = numberOrNull(instant.relative_humidity);
    const windMs = numberOrNull(instant.wind_speed);
    const wind = windMs === null ? null : windMs * 3.6;
    const symbol = String(interval.summary?.symbol_code || 'unknown');
    const precipitation = numberOrNull(interval.details?.precipitation_amount) ?? 0;
    return {
      time: date.toISOString(),
      minute,
      temperature,
      apparent: temperature === null ? null : calculateApparentTemperature(temperature, humidity, windMs),
      humidity,
      cloud: numberOrNull(instant.cloud_area_fraction),
      wind,
      windDirection: numberOrNull(instant.wind_from_direction),
      precipitation,
      intervalHours,
      symbol,
      label: weatherLabel(symbol, numberOrNull(instant.cloud_area_fraction), precipitation)
    };
  }).filter((point) => point.minute >= start - 60 && point.minute <= end + 60);

  const windowPoints = allPoints.filter((point) => point.minute >= start && point.minute <= end);
  if (!windowPoints.length) {
    const availableTimes = timeseries.map((entry) => new Date(entry.time).getTime()).filter(Number.isFinite);
    return {
      unavailable: true,
      reason: 'range',
      hours: [],
      availableFrom: availableTimes.length ? new Date(Math.min(...availableTimes)) : null,
      availableTo: availableTimes.length ? new Date(Math.max(...availableTimes)) : null,
      updatedAt: payload.properties?.meta?.updated_at || null,
      source: 'MET Norway'
    };
  }

  const visibleHours = sampleForecastPoints(windowPoints, 16);
  return {
    unavailable: false,
    source: 'MET Norway',
    updatedAt: payload.properties?.meta?.updated_at || null,
    expiresAt,
    hours: visibleHours,
    allHours: windowPoints,
    averageCloud: average(windowPoints.map((point) => point.cloud)),
    minTemperature: minimum(windowPoints.map((point) => point.temperature)),
    maxTemperature: maximum(windowPoints.map((point) => point.temperature)),
    minApparent: minimum(windowPoints.map((point) => point.apparent)),
    maxApparent: maximum(windowPoints.map((point) => point.apparent)),
    totalRain: sumPrecipitation(windowPoints),
    maxWind: maximum(windowPoints.map((point) => point.wind)),
    label: dominantWeatherLabel(windowPoints)
  };
}

function sampleForecastPoints(points, limit) {
  if (points.length <= limit) return points;
  const sampled = [];
  const step = (points.length - 1) / (limit - 1);
  for (let index = 0; index < limit; index += 1) sampled.push(points[Math.round(index * step)]);
  return sampled.filter((point, index) => sampled.indexOf(point) === index);
}

function calculateApparentTemperature(temperature, humidity, windMs) {
  const relativeHumidity = Number.isFinite(humidity) ? humidity : 50;
  const wind = Number.isFinite(windMs) ? windMs : 1;
  if (temperature <= 10 && wind * 3.6 >= 4.8) {
    const windKmh = wind * 3.6;
    return 13.12 + 0.6215 * temperature - 11.37 * windKmh ** 0.16 + 0.3965 * temperature * windKmh ** 0.16;
  }
  const vaporPressure = relativeHumidity / 100 * 6.105 * Math.exp(17.27 * temperature / (237.7 + temperature));
  return temperature + 0.33 * vaporPressure - 0.70 * wind - 4.0;
}

function renderSimulation(plan, solar, weather) {
  const start = timeToMinutes(plan.startTime);
  const end = normalizeEndMinutes(plan.startTime, plan.endTime);
  const focusMinute = chooseFocusMinute(plan, solar, start, end);
  currentContext = { plan, solar, weather, focusMinute };

  renderForecastBadge(weather);
  renderMetrics(solar, weather, focusMinute);
  renderLightTrack(plan, solar);
  renderHourlyForecast(weather, focusMinute);
  renderWeatherTimeline(plan, solar, weather);
  publishSceneState(plan, solar, weather, focusMinute);

  const slider = document.getElementById('scene-time');
  if (slider) {
    slider.min = String(start);
    slider.max = String(Math.max(start + 5, end));
    slider.value = String(focusMinute);
  }
  renderFocusedTime(focusMinute);
  initializeIcons();
}

function chooseFocusMinute(plan, solar, start, end) {
  if (solar && plan.lightGoal === 'golden') {
    const evening = dateToMinutes(solar.goldenEveningStart);
    if (evening >= start && evening <= end) return evening;
    const morning = dateToMinutes(solar.sunrise) + 20;
    if (morning >= start && morning <= end) return morning;
  }
  return Math.round((start + end) / 2 / 5) * 5;
}

function publishSceneState(plan, solar, weather, focusMinute) {
  const solarState = solar ? {
    dawn: dateToMinutes(solar.dawn),
    sunrise: dateToMinutes(solar.sunrise),
    goldenMorningEnd: dateToMinutes(solar.goldenMorningEnd),
    goldenEveningStart: dateToMinutes(solar.goldenEveningStart),
    sunset: dateToMinutes(solar.sunset),
    dusk: dateToMinutes(solar.dusk)
  } : null;
  const focusPoint = nearestWeatherPoint(weather, focusMinute);
  const reading = createReading(plan, focusMinute, focusPoint);
  const snapshot = {
    plan: { ...plan },
    solar: solarState,
    weather: weather ? { ...weather, allHours: undefined } : null,
    analysis: {
      decision: reading.code,
      label: reading.label,
      tone: reading.tone,
      focusMinute
    }
  };
  window.stageIsSimulation = snapshot;
  window.dispatchEvent(new CustomEvent('stageis:simulation', { detail: snapshot }));
}

function renderForecastBadge(weather) {
  if (weather?.reason === 'loading') {
    updateForecastBadge('자동 예보 불러오는 중');
    return;
  }
  if (weather?.unavailable) {
    const message = weather.reason === 'range' ? '예보 범위 밖 · 태양만 계산' : '예보 연결 실패 · 태양만 계산';
    updateForecastBadge(message);
    setText('weather-fetch-status', weather.reason === 'range'
      ? '선택일은 현재 시간별 예보 범위 밖입니다. 태양 위치는 계속 계산됩니다.'
      : '기상 데이터를 불러오지 못했습니다. 잠시 후 다시 시도하세요.');
    return;
  }
  updateForecastBadge(`자동 예보 · ${formatUpdatedTime(weather.updatedAt)}`);
  setText('weather-fetch-status', `MET Norway 시간별 예보 · 갱신 ${formatUpdatedTime(weather.updatedAt)} · 체감온도는 Stage-Is 계산값`);
}

function updateForecastBadge(message) {
  setText('forecast-badge', message);
}

function renderMetrics(solar, weather, focusMinute) {
  setText('sunrise-value', solar ? formatTime(solar.sunrise) : '확인 불가');
  setText('sunset-value', solar ? formatTime(solar.sunset) : '확인 불가');
  const point = nearestWeatherPoint(weather, focusMinute);
  setText('cloud-value', point?.cloud === null || point?.cloud === undefined ? '--' : `${Math.round(point.cloud)}%`);
  setText('feels-value', point?.apparent === null || point?.apparent === undefined ? '--' : `${Math.round(point.apparent)}℃`);
  const daylight = solar ? dateToMinutes(solar.sunset) - dateToMinutes(solar.sunrise) : null;
  setText('daylight-duration', daylight !== null ? formatDuration(daylight) : '계산 불가');
}

function renderFocusedTime(minute) {
  if (!currentContext) return;
  const { plan, solar, weather } = currentContext;
  currentContext.focusMinute = minute;
  const point = nearestWeatherPoint(weather, minute);
  const reading = createReading(plan, minute, point);
  const sun = solarPosition(plan, minute);

  setText('focus-time', minutesToClock(minute));
  setText('focus-condition', reading.label);
  setText('decision-summary', reading.summary);
  setText('cloud-value', point?.cloud === null || point?.cloud === undefined ? '--' : `${Math.round(point.cloud)}%`);
  setText('feels-value', point?.apparent === null || point?.apparent === undefined ? '--' : `${Math.round(point.apparent)}℃`);
  setText('sun-bearing-value', `${compassDirection(sun.bearing)} ${Math.round(sun.bearing)}°`);
  setText('shadow-bearing-value', `${compassDirection((sun.bearing + 180) % 360)} ${Math.round((sun.bearing + 180) % 360)}°`);
  setText('sun-altitude-value', `${sun.altitude >= 0 ? '+' : ''}${sun.altitude.toFixed(1)}°`);
  rotateArrow('sun-arrow', sun.bearing);
  rotateArrow('shadow-arrow', (sun.bearing + 180) % 360);
  updateActiveHour(minute);
  currentReport = buildReport(plan, solar, weather, minute, reading, sun);
}

function createReading(plan, minute, point) {
  const sun = solarPosition(plan, minute);
  if (!point) {
    const night = sun.altitude < -6;
    return {
      code: night ? 'NIGHT' : 'SUN',
      label: night ? '야간' : '태양 경로 계산',
      tone: night ? 'night' : 'clear',
      summary: night
        ? '자동 기상예보 범위 밖입니다. 선택 시각의 태양은 지평선 아래에 있습니다.'
        : `자동 기상예보 범위 밖입니다. 태양은 ${compassDirection(sun.bearing)} ${Math.round(sun.bearing)}° 방향, 고도 ${sun.altitude.toFixed(1)}°입니다.`
    };
  }

  const isWet = point.precipitation >= 0.2 || /(rain|sleet|snow|thunder)/.test(point.symbol);
  const isNight = sun.altitude < -6 || /night/.test(point.symbol);
  let code = 'SOFT';
  let label = '부드러운 확산광';
  let tone = 'soft';
  if (isNight) {
    code = 'NIGHT';
    label = point.label.includes('비') ? '비 오는 야간' : '야간';
    tone = 'night';
  } else if (isWet) {
    code = 'WET';
    label = point.label;
    tone = 'wet';
  } else if ((point.cloud ?? 50) < 20) {
    code = 'DIRECT';
    label = '강한 직사광';
    tone = 'clear';
  } else if ((point.cloud ?? 50) < 60) {
    code = 'VARIABLE';
    label = '변화하는 혼합광';
    tone = 'variable';
  } else if ((point.cloud ?? 50) >= 90) {
    code = 'FLAT';
    label = '평평한 흐린빛';
    tone = 'overcast';
  }

  const detail = [
    `구름 ${Math.round(point.cloud ?? 0)}%`,
    `체감 ${Math.round(point.apparent ?? point.temperature ?? 0)}℃`,
    point.precipitation > 0 ? `강수 ${formatMillimeters(point.precipitation, point.intervalHours)}` : '강수 없음',
    `바람 ${Math.round(point.wind ?? 0)}km/h`
  ].join(' · ');
  return { code, label, tone, summary: `${detail}. 태양 ${compassDirection(sun.bearing)} ${Math.round(sun.bearing)}°, 그림자 ${compassDirection((sun.bearing + 180) % 360)} 방향입니다.` };
}

function renderLightTrack(plan, solar) {
  const track = document.getElementById('light-track');
  if (!track) return;
  track.innerHTML = '';
  if (solar) {
    addTrackBlock(track, 'dawn', dateToMinutes(solar.dawn), dateToMinutes(solar.sunrise));
    addTrackBlock(track, 'day', dateToMinutes(solar.sunrise), dateToMinutes(solar.sunset));
    addTrackBlock(track, 'dawn', dateToMinutes(solar.sunset), dateToMinutes(solar.dusk));
    addTrackBlock(track, 'golden', dateToMinutes(solar.sunrise), dateToMinutes(solar.goldenMorningEnd));
    addTrackBlock(track, 'golden', dateToMinutes(solar.goldenEveningStart), dateToMinutes(solar.sunset));
    addTrackLabel(track, dateToMinutes(solar.sunrise), formatTime(solar.sunrise));
    addTrackLabel(track, dateToMinutes(solar.sunset), formatTime(solar.sunset));
  }
  addShootWindows(track, timeToMinutes(plan.startTime), normalizeEndMinutes(plan.startTime, plan.endTime));
}

function addTrackBlock(track, className, start, end) {
  const block = document.createElement('span');
  block.className = `light-block ${className}`;
  block.style.left = `${clamp(start / DAY_MINUTES * 100, 0, 100)}%`;
  block.style.width = `${clamp((end - start) / DAY_MINUTES * 100, 0, 100)}%`;
  track.appendChild(block);
}

function addShootWindows(track, start, end) {
  const windows = end <= DAY_MINUTES ? [[start, end]] : [[start, DAY_MINUTES], [0, end - DAY_MINUTES]];
  windows.forEach(([windowStart, windowEnd]) => {
    const block = document.createElement('span');
    block.className = 'shoot-window';
    block.style.left = `${windowStart / DAY_MINUTES * 100}%`;
    block.style.width = `${Math.max(0.5, (windowEnd - windowStart) / DAY_MINUTES * 100)}%`;
    track.appendChild(block);
  });
}

function addTrackLabel(track, minute, label) {
  const marker = document.createElement('span');
  marker.className = 'track-label';
  marker.style.left = `${clamp(minute / DAY_MINUTES * 100, 3, 97)}%`;
  marker.textContent = label;
  track.appendChild(marker);
}

function renderHourlyForecast(weather, focusMinute) {
  const container = document.getElementById('hourly-forecast');
  if (!container) return;
  container.innerHTML = '';
  if (!weather || weather.unavailable || !weather.hours?.length) {
    const empty = document.createElement('p');
    empty.className = 'forecast-empty';
    empty.textContent = weather?.reason === 'loading' ? '시간별 예보를 불러오고 있습니다.' : '이 날짜에는 시간별 예보가 없습니다. 태양 방향은 계속 확인할 수 있습니다.';
    container.appendChild(empty);
    setText('hourly-range', '태양 계산만');
    return;
  }

  setText('hourly-range', `${minutesToClock(weather.hours[0].minute)}–${minutesToClock(weather.hours.at(-1).minute)}`);
  weather.hours.forEach((point) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'weather-hour';
    card.dataset.minute = String(point.minute);
    card.setAttribute('aria-label', `${minutesToClock(point.minute)} ${point.label}, 체감 ${Math.round(point.apparent ?? point.temperature ?? 0)}도`);
    const time = document.createElement('time');
    time.textContent = minutesToClock(point.minute);
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', weatherIcon(point.symbol, point.cloud));
    icon.setAttribute('aria-hidden', 'true');
    const condition = document.createElement('strong');
    condition.textContent = point.label;
    const temperature = document.createElement('span');
    temperature.textContent = `${Math.round(point.temperature ?? 0)}° / 체감 ${Math.round(point.apparent ?? point.temperature ?? 0)}°`;
    const details = document.createElement('small');
    details.textContent = `구름 ${Math.round(point.cloud ?? 0)}% · ${point.precipitation > 0 ? formatMillimeters(point.precipitation, point.intervalHours) : '강수 없음'}`;
    card.append(time, icon, condition, temperature, details);
    card.addEventListener('click', () => {
      const slider = document.getElementById('scene-time');
      if (slider) {
        slider.value = String(point.minute);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
      document.getElementById('field-visual')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    container.appendChild(card);
  });
  updateActiveHour(focusMinute);
}

function updateActiveHour(minute) {
  const cards = [...document.querySelectorAll('.weather-hour')];
  if (!cards.length) return;
  const nearest = cards.reduce((best, card) => {
    const distance = Math.abs(Number(card.dataset.minute) - minute);
    return !best || distance < best.distance ? { card, distance } : best;
  }, null);
  cards.forEach((card) => card.classList.toggle('is-active', card === nearest?.card));
}

function renderWeatherTimeline(plan, solar, weather) {
  const list = document.getElementById('weather-timeline');
  if (!list) return;
  const start = timeToMinutes(plan.startTime);
  const end = normalizeEndMinutes(plan.startTime, plan.endTime);
  const events = [];
  if (solar) {
    addTimelineEvent(events, dateToMinutes(solar.sunrise), '일출', '태양이 지평선 위로 올라옵니다.', start, end);
    addTimelineEvent(events, dateToMinutes(solar.goldenMorningEnd), '아침 골든아워 종료', '직사광 대비가 빠르게 강해집니다.', start, end);
    addTimelineEvent(events, dateToMinutes(solar.goldenEveningStart), '저녁 골든아워 시작', '낮은 각도의 따뜻한 빛이 시작됩니다.', start, end);
    addTimelineEvent(events, dateToMinutes(solar.sunset), '일몰', '태양 직사광이 사라집니다.', start, end);
  }
  if (weather && !weather.unavailable) {
    let previousBucket = null;
    weather.allHours.forEach((point) => {
      const bucket = weatherBucket(point);
      if (bucket !== previousBucket) {
        events.push({ time: point.minute, title: point.label, detail: `구름 ${Math.round(point.cloud ?? 0)}% · 체감 ${Math.round(point.apparent ?? point.temperature ?? 0)}℃` });
        previousBucket = bucket;
      }
    });
  }
  events.sort((a, b) => a.time - b.time);
  const visible = events.slice(0, 10);
  list.innerHTML = '';
  visible.forEach((event) => {
    const item = document.createElement('li');
    const time = document.createElement('time');
    const title = document.createElement('strong');
    const detail = document.createElement('span');
    time.textContent = minutesToClock(event.time);
    title.textContent = event.title;
    detail.textContent = event.detail;
    item.append(time, title, detail);
    list.appendChild(item);
  });
  if (!visible.length) {
    const item = document.createElement('li');
    item.innerHTML = '<time>--:--</time><strong>변화 데이터 없음</strong><span>선택 구간을 넓혀 보세요.</span>';
    list.appendChild(item);
  }
  setText('change-count', `${visible.length}개 구간`);
}

function addTimelineEvent(events, time, title, detail, start, end) {
  if (time >= start && time <= end) events.push({ time, title, detail });
}

function weatherBucket(point) {
  if (point.precipitation >= 0.2 || /(rain|sleet|snow|thunder)/.test(point.symbol)) return `wet:${point.label}`;
  if ((point.cloud ?? 0) < 20) return 'clear';
  if ((point.cloud ?? 0) < 60) return 'mixed';
  if ((point.cloud ?? 0) < 90) return 'cloudy';
  return 'overcast';
}

function nearestWeatherPoint(weather, minute) {
  const points = weather?.allHours || weather?.hours;
  if (!Array.isArray(points) || !points.length) return null;
  return points.reduce((nearest, point) => Math.abs(point.minute - minute) < Math.abs(nearest.minute - minute) ? point : nearest, points[0]);
}

function weatherLabel(symbol, cloud, precipitation) {
  if (/thunder/.test(symbol)) return '천둥·번개';
  if (/heavyrain/.test(symbol)) return '강한 비';
  if (/rain|sleet/.test(symbol) || precipitation >= 0.2) return /snow|sleet/.test(symbol) ? '진눈깨비' : '비';
  if (/snow/.test(symbol)) return '눈';
  if (/fog/.test(symbol)) return '안개';
  if (/partlycloudy/.test(symbol)) return '구름 사이 햇빛';
  if (/cloudy/.test(symbol) || (cloud ?? 0) >= 85) return '흐림';
  if (/fair/.test(symbol) || (cloud ?? 0) >= 20) return '구름 조금';
  return '맑음';
}

function weatherIcon(symbol, cloud) {
  if (/thunder/.test(symbol)) return 'cloud-lightning';
  if (/snow|sleet/.test(symbol)) return 'cloud-snow';
  if (/rain/.test(symbol)) return 'cloud-rain';
  if (/fog/.test(symbol)) return 'cloud-fog';
  if (/night/.test(symbol)) return (cloud ?? 0) > 40 ? 'cloud-moon' : 'moon';
  if (/cloudy/.test(symbol) || (cloud ?? 0) > 75) return 'cloud';
  if (/partlycloudy|fair/.test(symbol) || (cloud ?? 0) > 20) return 'cloud-sun';
  return 'sun';
}

function dominantWeatherLabel(points) {
  const wet = points.find((point) => point.precipitation >= 0.2 || /(rain|sleet|snow|thunder)/.test(point.symbol));
  if (wet) return wet.label;
  const cloud = average(points.map((point) => point.cloud)) ?? 0;
  return weatherLabel('', cloud, 0);
}

function sumPrecipitation(points) {
  return points.reduce((total, point) => total + (Number.isFinite(point.precipitation) ? point.precipitation : 0), 0);
}

function solarPosition(plan, minute) {
  if (!window.SunCalc) return { bearing: 0, altitude: 0 };
  const date = new Date(Date.parse(`${plan.date}T00:00:00+09:00`) + minute * 60000);
  const position = window.SunCalc.getPosition(date, plan.latitude, plan.longitude);
  return {
    bearing: (position.azimuth * 180 / Math.PI + 180 + 360) % 360,
    altitude: position.altitude * 180 / Math.PI
  };
}

function compassDirection(bearing) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return directions[Math.round(((bearing % 360) + 360) % 360 / 45) % 8];
}

function rotateArrow(id, bearing) {
  const arrow = document.getElementById(id);
  if (arrow) arrow.style.transform = `translateX(-50%) rotate(${bearing}deg)`;
}

function buildReport(plan, solar, weather, minute, reading, sun) {
  const point = nearestWeatherPoint(weather, minute);
  const lines = [
    'STAGE-IS / 촬영 빛과 날씨 리포트',
    '',
    `장소: ${plan.location}`,
    `좌표: ${plan.latitude.toFixed(5)}, ${plan.longitude.toFixed(5)}`,
    `날짜와 시간: ${plan.date} ${minutesToClock(minute)}`,
    `하늘 판독: ${reading.label}`,
    `태양: ${compassDirection(sun.bearing)} ${Math.round(sun.bearing)}° / 고도 ${sun.altitude.toFixed(1)}°`,
    `그림자: ${compassDirection((sun.bearing + 180) % 360)} ${Math.round((sun.bearing + 180) % 360)}°`,
    solar ? `일출 ${formatTime(solar.sunrise)} / 일몰 ${formatTime(solar.sunset)}` : '일출·일몰 계산 불가',
    point
      ? `기상: ${point.label} / ${Math.round(point.temperature ?? 0)}℃ / 체감 ${Math.round(point.apparent ?? point.temperature ?? 0)}℃ / 구름 ${Math.round(point.cloud ?? 0)}% / 강수 ${formatMillimeters(point.precipitation, point.intervalHours)} / 바람 ${Math.round(point.wind ?? 0)}km/h`
      : '기상: 현재 예보 범위 밖',
    '',
    reading.summary,
    '',
    '기상 원자료: MET Norway (CC BY 4.0)',
    '태양 계산: SunCalc / 체감온도와 촬영광 판독: Stage-Is',
    '예보는 실제 현장 관측과 다를 수 있으며 건물·산·수목에 의한 차폐는 계산하지 않습니다.',
    'https://stage-is.com/'
  ];
  return lines.join('\n');
}

async function copyReport() {
  if (!currentReport) return;
  try {
    await navigator.clipboard.writeText(currentReport);
    showToast('빛과 날씨 리포트를 복사했습니다.');
  } catch {
    const area = document.createElement('textarea');
    area.value = currentReport;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    showToast('빛과 날씨 리포트를 복사했습니다.');
  }
}

function downloadReport() {
  if (!currentReport) return;
  const date = document.getElementById('shoot-date')?.value || toDateInput(new Date());
  const blob = new Blob([currentReport], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `stage-is-light-weather-${date}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast('리포트 파일을 저장했습니다.');
}

function resetPlan() {
  const form = document.getElementById('shoot-form');
  if (!form) return;
  form.reset();
  selectedLocation = { ...LOCATIONS[0], name: LOCATIONS[0].label, source: 'preset' };
  document.getElementById('location').value = selectedLocation.name;
  document.getElementById('start-time').value = '08:00';
  document.getElementById('end-time').value = '18:00';
  document.getElementById('shoot-date').value = toDateInput(addDays(startOfDay(new Date()), 1));
  localStorage.removeItem(STORAGE_KEY);
  updateLocationDisplay();
  runSimulation();
}

function savePlan(plan) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  } catch {
    // The simulator still works when browser storage is unavailable.
  }
}

function restorePlan() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    const form = document.getElementById('shoot-form');
    if (!form) return;
    if (saved.date && new Date(`${saved.date}T00:00:00`) >= startOfDay(new Date())) document.getElementById('shoot-date').value = saved.date;
    if (saved.lightGoal) document.getElementById('light-goal').value = saved.lightGoal;
    if (saved.startTime) document.getElementById('start-time').value = saved.startTime;
    if (saved.endTime) document.getElementById('end-time').value = saved.endTime;
    if (Number.isFinite(saved.latitude) && Number.isFinite(saved.longitude)) {
      selectedLocation = {
        name: saved.location || '저장된 위치',
        latitude: saved.latitude,
        longitude: saved.longitude,
        source: saved.locationSource || 'saved'
      };
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function readObjectCache(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
}

function writeObjectCache(storageKey, key, value, limit) {
  try {
    const cache = readObjectCache(storageKey);
    cache[key] = value;
    const entries = Object.entries(cache);
    if (entries.length > limit) {
      entries.slice(0, entries.length - limit).forEach(([oldKey]) => delete cache[oldKey]);
    }
    localStorage.setItem(storageKey, JSON.stringify(cache));
  } catch {
    // Cache failure must not stop the simulator.
  }
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2400);
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function timeToMinutes(value) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function normalizeEndMinutes(startTime, endTime) {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);
  if (end <= start) end += DAY_MINUTES;
  return end;
}

function durationMinutes(startTime, endTime) {
  return normalizeEndMinutes(startTime, endTime) - timeToMinutes(startTime);
}

function minutesToClock(totalMinutes) {
  const normalized = ((Math.round(totalMinutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function dateToMinutes(date) {
  const parts = koreaDateParts(date);
  return parts.hour * 60 + parts.minute;
}

function formatTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '확인 불가';
  const parts = koreaDateParts(date);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!remainder) return `${hours}시간`;
  if (!hours) return `${remainder}분`;
  return `${hours}시간 ${remainder}분`;
}

function formatUpdatedTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '최근 갱신';
  const parts = koreaDateParts(date);
  return `${String(parts.month).padStart(2, '0')}.${String(parts.day).padStart(2, '0')} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function koreaDateParts(date) {
  const values = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: KOREA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).forEach((part) => {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  });
  return values;
}

function formatMillimeters(amount, intervalHours) {
  if (!Number.isFinite(amount) || amount <= 0) return '0mm';
  const interval = intervalHours > 1 ? `/${intervalHours}h` : '';
  return `${amount < 0.1 ? '<0.1' : amount.toFixed(amount < 10 ? 1 : 0)}mm${interval}`;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function minimum(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? Math.min(...valid) : null;
}

function maximum(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : null;
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function toDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
