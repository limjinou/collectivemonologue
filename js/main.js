const LOCATIONS = [
  { name: '서울', aliases: ['서울특별시'], latitude: 37.5665, longitude: 126.9780 },
  { name: '인천', aliases: ['인천광역시'], latitude: 37.4563, longitude: 126.7052 },
  { name: '수원', aliases: ['수원시'], latitude: 37.2636, longitude: 127.0286 },
  { name: '고양', aliases: ['고양시', '일산'], latitude: 37.6584, longitude: 126.8320 },
  { name: '파주', aliases: ['파주시'], latitude: 37.7599, longitude: 126.7800 },
  { name: '성남', aliases: ['성남시', '분당'], latitude: 37.4200, longitude: 127.1265 },
  { name: '춘천', aliases: ['춘천시'], latitude: 37.8813, longitude: 127.7298 },
  { name: '강릉', aliases: ['강릉시'], latitude: 37.7519, longitude: 128.8761 },
  { name: '대전', aliases: ['대전광역시'], latitude: 36.3504, longitude: 127.3845 },
  { name: '전주', aliases: ['전주시'], latitude: 35.8242, longitude: 127.1480 },
  { name: '광주', aliases: ['광주광역시'], latitude: 35.1595, longitude: 126.8526 },
  { name: '대구', aliases: ['대구광역시'], latitude: 35.8714, longitude: 128.6014 },
  { name: '부산', aliases: ['부산광역시'], latitude: 35.1796, longitude: 129.0756 },
  { name: '울산', aliases: ['울산광역시'], latitude: 35.5384, longitude: 129.3114 },
  { name: '제주', aliases: ['제주시', '제주도'], latitude: 33.4996, longitude: 126.5312 },
  { name: '서귀포', aliases: ['서귀포시'], latitude: 33.2541, longitude: 126.5601 }
];

const STORAGE_KEY = 'stageis-shoot-plan-v1';
const DAY_MINUTES = 1440;

let selectedLocation = { ...LOCATIONS[0], source: 'preset' };
let currentReport = '';
let toastTimer;
let locationMap;
let locationMarker;
let pendingMapLocation;

document.addEventListener('DOMContentLoaded', () => {
  initializeIcons();
  populateLocations();
  initializeDate();
  restorePlan();
  bindEvents();
  updateLocationFromInput();
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
    list.appendChild(option);
  });
}

function initializeDate() {
  const input = document.getElementById('shoot-date');
  if (!input) return;

  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  const maxDate = addDays(today, 180);
  input.min = toDateInput(today);
  input.max = toDateInput(maxDate);
  if (!input.value) input.value = toDateInput(tomorrow);
}

function bindEvents() {
  const form = document.getElementById('shoot-form');
  const locationInput = document.getElementById('location');

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    runSimulation();
  });

  locationInput?.addEventListener('change', updateLocationFromInput);
  locationInput?.addEventListener('blur', updateLocationFromInput);

  document.querySelectorAll('[data-stepper]').forEach((stepper) => {
    stepper.querySelectorAll('button[data-step]').forEach((button) => {
      button.addEventListener('click', () => {
        const input = stepper.querySelector('input[type="number"]');
        if (!input) return;
        const step = Number(button.dataset.step || 1);
        const min = Number(input.min || -Infinity);
        const max = Number(input.max || Infinity);
        input.value = String(clamp(Number(input.value || 0) + step, min, max));
      });
    });
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

function updateLocationFromInput() {
  const input = document.getElementById('location');
  const status = document.getElementById('location-status');
  if (!input || !status) return;

  const query = input.value.trim().toLowerCase();
  const currentName = String(selectedLocation.name || '').trim().toLowerCase();

  if (query && query === currentName && Number.isFinite(selectedLocation.latitude) && Number.isFinite(selectedLocation.longitude)) {
    const sourceLabel = selectedLocation.source === 'map' ? '지도 선택 좌표' : selectedLocation.source === 'device' ? '기기 위치' : '선택 좌표';
    status.textContent = `${selectedLocation.latitude.toFixed(5)}, ${selectedLocation.longitude.toFixed(5)} · ${sourceLabel}`;
    return;
  }

  const match = LOCATIONS.find((location) => {
    const candidates = [location.name, ...(location.aliases || [])];
    return candidates.some((candidate) => candidate.toLowerCase() === query);
  });

  if (match) {
    selectedLocation = { ...match, source: 'preset' };
    input.value = match.name;
    status.textContent = `${match.name} 중심 좌표 · ${match.latitude.toFixed(3)}, ${match.longitude.toFixed(3)}`;
    return;
  }

  status.textContent = '목록의 도시를 선택하거나 현재 위치를 사용하세요.';
}

function useCurrentLocation() {
  const status = document.getElementById('location-status');
  const input = document.getElementById('location');

  if (!navigator.geolocation) {
    showToast('이 브라우저에서는 현재 위치를 사용할 수 없습니다.');
    return;
  }

  if (status) status.textContent = '현재 위치를 확인하고 있습니다.';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      const nearest = findNearestLocation(latitude, longitude);
      selectedLocation = {
        name: nearest.distance < 40 ? `${nearest.location.name} 인근` : '현재 위치',
        latitude,
        longitude,
        source: 'device'
      };
      if (input) input.value = selectedLocation.name;
      if (status) status.textContent = `${latitude.toFixed(4)}, ${longitude.toFixed(4)} · 기기 위치`;
      runSimulation();
    },
    () => {
      if (status) status.textContent = '위치 권한을 확인한 뒤 다시 시도하세요.';
      showToast('현재 위치를 가져오지 못했습니다.');
    },
    { enableHighAccuracy: false, timeout: 9000, maximumAge: 600000 }
  );
}

function findNearestLocation(latitude, longitude) {
  return LOCATIONS.map((location) => ({
    location,
    distance: haversine(latitude, longitude, location.latitude, location.longitude)
  })).sort((a, b) => a.distance - b.distance)[0];
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
    setPendingMapLocation(pendingMapLocation.latitude, pendingMapLocation.longitude, true, 15);
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
  }).setView([selectedLocation.latitude, selectedLocation.longitude], 15);

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

  if (moveMap && locationMap) {
    locationMap.setView([latitude, longitude], zoom || locationMap.getZoom(), { animate: false });
  }
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

function applyMapLocation() {
  if (!pendingMapLocation) return;

  const nearest = findNearestLocation(pendingMapLocation.latitude, pendingMapLocation.longitude);
  const name = nearest.distance < 80 ? `${nearest.location.name} 지도 지점` : '지도 지정 위치';
  selectedLocation = {
    name,
    latitude: pendingMapLocation.latitude,
    longitude: pendingMapLocation.longitude,
    source: 'map'
  };

  const input = document.getElementById('location');
  const status = document.getElementById('location-status');
  if (input) input.value = name;
  if (status) status.textContent = `${selectedLocation.latitude.toFixed(5)}, ${selectedLocation.longitude.toFixed(5)} · 지도 선택 좌표`;

  closeLocationMap();
  runSimulation();
}

function runSimulation() {
  const form = document.getElementById('shoot-form');
  const panel = document.getElementById('result-panel');
  if (!form || !panel) return;

  updateLocationFromInput();
  const plan = readPlan(form);
  const validation = validatePlan(plan);
  if (validation) {
    showToast(validation);
    return;
  }

  panel.setAttribute('aria-busy', 'true');
  updateForecastBadge('입력값 계산 중');
  savePlan(plan);

  const solar = calculateSolar(plan);
  const weather = buildManualWeather(plan);
  const analysis = analyzePlan(plan, solar, weather);
  renderResult(plan, solar, weather, analysis);

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
    environment: String(data.get('environment')),
    startTime: String(data.get('startTime')),
    endTime: String(data.get('endTime')),
    crewSize: Number(data.get('crewSize')),
    setupMinutes: Number(data.get('setupMinutes')),
    weatherCondition: String(data.get('weatherCondition')),
    apparentTemperature: Number(data.get('apparentTemperature')),
    rainChance: Number(data.get('rainChance')),
    gustSpeed: Number(data.get('gustSpeed')),
    parkingConfirmed: data.get('parkingConfirmed') === 'on',
    backupReady: data.get('backupReady') === 'on',
    weatherChecked: data.get('weatherChecked') === 'on'
  };
}

function validatePlan(plan) {
  if (!plan.date) return '촬영일을 선택하세요.';
  if (!plan.startTime || !plan.endTime) return '콜타임과 철수 시간을 입력하세요.';
  if (plan.crewSize < 1) return '현장 인원은 한 명 이상이어야 합니다.';
  if (plan.apparentTemperature < -30 || plan.apparentTemperature > 45) return '체감온도는 -30℃에서 45℃ 사이로 입력하세요.';
  if (plan.rainChance < 0 || plan.rainChance > 100) return '강수확률은 0%에서 100% 사이로 입력하세요.';
  if (plan.gustSpeed < 0 || plan.gustSpeed > 100) return '돌풍은 0km/h에서 100km/h 사이로 입력하세요.';

  const duration = durationMinutes(plan.startTime, plan.endTime);
  if (duration < 120) return '촬영 구간은 최소 두 시간 이상으로 잡아주세요.';
  if (plan.setupMinutes >= duration) return '세팅 시간이 전체 촬영 시간보다 깁니다.';
  return '';
}

function calculateSolar(plan) {
  if (!window.SunCalc) return null;
  const anchor = new Date(`${plan.date}T12:00:00`);
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

function buildManualWeather(plan) {
  const conditions = {
    clear: { label: '맑음', cloud: 8, code: 0 },
    mixed: { label: '구름 조금', cloud: 42, code: 2 },
    overcast: { label: '흐림', cloud: 88, code: 3 },
    rain: { label: '비', cloud: 96, code: 61 },
    snow: { label: '눈', cloud: 96, code: 71 }
  };
  const condition = conditions[plan.weatherCondition] || conditions.mixed;
  const rainChance = clamp(plan.rainChance, 0, 100);
  const gust = clamp(plan.gustSpeed, 0, 100);
  const apparent = clamp(plan.apparentTemperature, -30, 45);

  return {
    unavailable: false,
    source: 'manual',
    minTemperature: apparent,
    maxTemperature: apparent,
    minApparent: apparent,
    maxApparent: apparent,
    maxRainChance: rainChance,
    totalRain: ['rain', 'snow'].includes(plan.weatherCondition) ? Math.max(0.2, rainChance / 20) : 0,
    maxWind: Math.round(gust * 0.65),
    maxGust: gust,
    averageCloud: condition.cloud,
    dominantCode: condition.code,
    label: condition.label
  };
}

function analyzePlan(plan, solar, weather) {
  let score = 100;
  const risks = [];
  const duration = durationMinutes(plan.startTime, plan.endTime);
  const weatherSensitive = plan.environment !== 'indoor';

  if (weather && !weather.unavailable && weatherSensitive) {
    if (weather.maxRainChance >= 70) {
      score -= 34;
      risks.push(risk('비 또는 눈 가능성이 매우 높습니다.', '강수', 'critical'));
    } else if (weather.maxRainChance >= 40) {
      score -= 20;
      risks.push(risk('우천 전환 기준과 장비 방수 계획이 필요합니다.', '강수', 'warning'));
    } else if (weather.maxRainChance >= 20) {
      score -= 8;
      risks.push(risk('짧은 강수 가능성을 현장에서 다시 확인하세요.', '강수', 'warning'));
    }

    if (weather.maxGust >= 45) {
      score -= 25;
      risks.push(risk('돌풍이 조명과 스탠드 안전에 위험한 수준입니다.', '바람', 'critical'));
    } else if (weather.maxGust >= 30) {
      score -= 14;
      risks.push(risk('대형 확산판과 조명 스탠드 고정 인력을 확보하세요.', '바람', 'warning'));
    } else if (weather.maxGust >= 20) {
      score -= 6;
      risks.push(risk('핀 마이크와 반사판의 바람 영향을 점검하세요.', '바람', 'warning'));
    }

    if (weather.minApparent <= 0 || weather.maxApparent >= 34) {
      score -= 14;
      risks.push(risk('체감온도로 인한 출연자·스태프 컨디션 저하가 큽니다.', '체감', 'critical'));
    } else if (weather.minApparent <= 5 || weather.maxApparent >= 30) {
      score -= 7;
      risks.push(risk('보온·냉방과 휴식 시간을 별도로 잡으세요.', '체감', 'warning'));
    }
  }

  if (solar && plan.environment !== 'indoor') {
    const start = timeToMinutes(plan.startTime);
    const end = normalizeEndMinutes(plan.startTime, plan.endTime);
    const sunrise = dateToMinutes(solar.sunrise);
    const sunset = dateToMinutes(solar.sunset);
    const overlap = intervalOverlap(start, end, sunrise, sunset);
    const shootingAfterSetup = Math.max(1, duration - plan.setupMinutes);

    if (plan.lightGoal === 'daylight' && overlap < shootingAfterSetup * 0.7) {
      score -= 18;
      risks.push(risk('주요 촬영 시간의 30% 이상이 자연광 밖에 있습니다.', '빛', 'critical'));
    }

    if (plan.lightGoal === 'golden') {
      const morning = dateToMinutes(solar.goldenMorningEnd);
      const evening = dateToMinutes(solar.goldenEveningStart);
      const goldenOverlap = intervalOverlap(start, end, sunrise, morning)
        + intervalOverlap(start, end, evening, sunset);
      if (goldenOverlap < 20) {
        score -= 22;
        risks.push(risk('현재 시간표는 골든아워와 거의 겹치지 않습니다.', '빛', 'critical'));
      }
    }
  }

  if (duration > 720) {
    score -= 12;
    risks.push(risk('12시간을 넘는 현장은 후반 집중력과 철수 안전이 떨어집니다.', '시간', 'critical'));
  } else if (duration > 600) {
    score -= 6;
    risks.push(risk('10시간 이상 현장입니다. 식사와 교대 시간을 고정하세요.', '시간', 'warning'));
  }

  if (plan.crewSize >= 16) {
    score -= 9;
    risks.push(risk('16명 이상이면 장소 수용 인원과 추가 인원비를 다시 확인하세요.', '인원', 'warning'));
  } else if (plan.crewSize >= 10 && plan.setupMinutes < 60) {
    score -= 7;
    risks.push(risk('현재 인원 대비 세팅 시간이 짧습니다.', '인원', 'warning'));
  }

  if (!plan.parkingConfirmed && plan.crewSize >= 6) {
    score -= 9;
    risks.push(risk('주차·상하차 동선이 아직 확인되지 않았습니다.', '이동', 'warning'));
  }

  if (!plan.backupReady && weatherSensitive && weather && !weather.unavailable && weather.maxRainChance >= 30) {
    score -= 8;
    risks.push(risk('강수 가능성은 있는데 실내 대체안이 없습니다.', '대체안', 'critical'));
  }

  if (plan.setupMinutes < 30 && plan.crewSize > 4) {
    score -= 8;
    risks.push(risk('30분 미만 세팅은 장비와 인원 배치에 부족합니다.', '세팅', 'warning'));
  }

  score = clamp(Math.round(score), 0, 100);
  const decision = score >= 80 ? 'GO' : score >= 60 ? 'CHECK' : 'HOLD';
  const summary = createDecisionSummary(decision, risks, weather);

  return { score, decision, summary, risks, duration };
}

function risk(message, label, severity) {
  return { message, label, severity };
}

function createDecisionSummary(decision, risks, weather) {
  if (!weather) return '빛과 운영 조건만 계산했습니다. 기상 입력값을 확인하세요.';
  if (decision === 'GO') return `${weather.label} 입력값 기준으로 진행 가능성이 높습니다. 출발 전 최신 특보를 확인하세요.`;
  if (decision === 'CHECK') return `진행은 가능하지만 ${risks[0]?.label || '현장 조건'} 변수를 먼저 해결해야 합니다.`;
  return `${risks[0]?.label || '핵심 조건'} 위험이 큽니다. 일정 또는 장소를 바꾸는 편이 안전합니다.`;
}

function renderResult(plan, solar, weather, analysis) {
  renderDecision(analysis);
  renderForecastBadge(weather);
  renderMetrics(solar, weather);
  renderLightTrack(plan, solar);
  renderTimeline(plan, solar, analysis.duration);
  renderRisks(analysis.risks);
  renderChecklist(plan, weather);
  currentReport = buildReport(plan, solar, weather, analysis);
  publishSceneState(plan, solar, weather, analysis);
  initializeIcons();
}

function publishSceneState(plan, solar, weather, analysis) {
  const solarState = solar ? {
    dawn: dateToMinutes(solar.dawn),
    sunrise: dateToMinutes(solar.sunrise),
    goldenMorningEnd: dateToMinutes(solar.goldenMorningEnd),
    goldenEveningStart: dateToMinutes(solar.goldenEveningStart),
    sunset: dateToMinutes(solar.sunset),
    dusk: dateToMinutes(solar.dusk)
  } : null;

  const snapshot = {
    plan: { ...plan },
    solar: solarState,
    weather: weather ? { ...weather } : null,
    analysis: {
      score: analysis.score,
      decision: analysis.decision,
      duration: analysis.duration
    }
  };

  window.stageIsSimulation = snapshot;
  window.dispatchEvent(new CustomEvent('stageis:simulation', { detail: snapshot }));
}

function renderDecision(analysis) {
  const code = document.getElementById('decision-code');
  const score = document.getElementById('score-value');
  const summary = document.getElementById('decision-summary');
  const bar = document.getElementById('score-bar');
  if (!code || !score || !summary || !bar) return;

  code.textContent = analysis.decision;
  code.className = `decision-code ${analysis.decision === 'CHECK' ? 'is-check' : analysis.decision === 'HOLD' ? 'is-hold' : ''}`;
  score.textContent = String(analysis.score);
  summary.textContent = analysis.summary;
  bar.style.width = `${analysis.score}%`;
  bar.style.background = analysis.decision === 'GO' ? 'var(--signal)' : analysis.decision === 'CHECK' ? 'var(--orange)' : 'var(--red)';
}

function renderForecastBadge(weather) {
  updateForecastBadge(weather ? '수동 기상값' : '기상값 없음');
}

function updateForecastBadge(message) {
  const badge = document.getElementById('forecast-badge');
  if (badge) badge.textContent = message;
}

function renderMetrics(solar, weather) {
  setText('sunrise-value', solar ? formatTime(solar.sunrise) : '확인 불가');
  setText('sunset-value', solar ? formatTime(solar.sunset) : '확인 불가');
  setText('rain-value', weather && weather.maxRainChance !== null ? `${Math.round(weather.maxRainChance)}%` : '미입력');
  setText('wind-value', weather && weather.maxGust !== null ? `${Math.round(weather.maxGust)} km/h` : '미입력');

  const daylight = solar ? dateToMinutes(solar.sunset) - dateToMinutes(solar.sunrise) : null;
  setText('daylight-duration', daylight !== null ? formatDuration(daylight) : '계산 불가');
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

  const start = timeToMinutes(plan.startTime);
  const end = normalizeEndMinutes(plan.startTime, plan.endTime);
  addShootWindows(track, start, end);
}

function addTrackBlock(track, className, start, end) {
  const block = document.createElement('span');
  block.className = `light-block ${className}`;
  block.style.left = `${clamp(start / DAY_MINUTES * 100, 0, 100)}%`;
  block.style.width = `${clamp((end - start) / DAY_MINUTES * 100, 0, 100)}%`;
  track.appendChild(block);
}

function addShootWindows(track, start, end) {
  const windows = end <= DAY_MINUTES
    ? [[start, end]]
    : [[start, DAY_MINUTES], [0, end - DAY_MINUTES]];

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

function renderTimeline(plan, solar, duration) {
  const list = document.getElementById('operation-timeline');
  if (!list) return;

  const start = timeToMinutes(plan.startTime);
  const end = normalizeEndMinutes(plan.startTime, plan.endTime);
  const setupEnd = start + plan.setupMinutes;
  const events = [
    { time: start, title: '집결·장비 반입', detail: '콜타임' },
    { time: setupEnd, title: '세팅 완료·첫 테이크', detail: `${plan.setupMinutes}분 세팅` }
  ];

  if (solar && plan.lightGoal === 'golden') {
    const eveningGolden = dateToMinutes(solar.goldenEveningStart);
    if (eveningGolden >= start && eveningGolden <= end) {
      events.push({ time: eveningGolden, title: '골든아워 핵심 장면', detail: '빛 우선' });
    }
  }

  if (duration >= 390) {
    const meal = Math.min(end - 90, Math.max(setupEnd + 150, start + 300));
    events.push({ time: meal, title: '식사·배터리·메모리 교체', detail: '30~60분' });
  }

  events.push({ time: Math.max(setupEnd, end - 60), title: '마지막 테이크·데이터 확인', detail: '철수 전' });
  events.push({ time: end, title: '철수 완료', detail: formatDuration(duration) });
  events.sort((a, b) => a.time - b.time);

  list.innerHTML = '';
  events.forEach((event) => {
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

  setText('shoot-duration', formatDuration(duration));
}

function renderRisks(risks) {
  const list = document.getElementById('risk-list');
  if (!list) return;
  list.innerHTML = '';

  const visible = risks.slice(0, 6);
  setText('risk-count', `${risks.length}개`);

  if (!visible.length) {
    visible.push({
      message: '현재 입력값에서 즉시 중단할 운영 변수는 없습니다.',
      label: 'CLEAR',
      severity: 'clear'
    });
  }

  visible.forEach((item) => {
    const li = document.createElement('li');
    li.className = item.severity === 'critical' ? 'is-critical' : item.severity === 'clear' ? 'is-clear' : '';
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', item.severity === 'clear' ? 'circle-check' : item.severity === 'critical' ? 'octagon-alert' : 'triangle-alert');
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    const label = document.createElement('small');
    text.textContent = item.message;
    label.textContent = item.label;
    li.append(icon, text, label);
    list.appendChild(li);
  });
}

function renderChecklist(plan, weather) {
  const grid = document.getElementById('check-grid');
  if (!grid) return;

  const items = [
    { label: '실제 현장 인원과 예약 인원 대조', checked: plan.crewSize < 10 },
    { label: '주차·상하차·엘리베이터 확인', checked: plan.parkingConfirmed },
    { label: '최종 결정자와 연락망 고정', checked: false },
    { label: '장비 전력·배터리·메모리 확인', checked: false },
    { label: '출연자 대기·식사 공간 확인', checked: false },
    { label: '우천 대체안 또는 취소 기준 합의', checked: plan.backupReady || plan.environment === 'indoor' },
    { label: '원본 데이터 이중 백업 담당 지정', checked: false },
    { label: '출발 직전 기상특보 재확인', checked: plan.weatherChecked }
  ];

  grid.innerHTML = '';
  items.forEach((item, index) => {
    const label = document.createElement('label');
    label.className = 'check-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = item.checked;
    input.setAttribute('aria-label', item.label);
    const span = document.createElement('span');
    span.textContent = item.label;
    label.append(input, span);
    grid.appendChild(label);
    if (index === 0 && plan.crewSize >= 10) input.checked = false;
  });
}

function buildReport(plan, solar, weather, analysis) {
  const lines = [
    'STAGE-IS / 촬영일 작전표',
    '',
    `판단: ${analysis.decision} (${analysis.score}/100)`,
    `장소: ${plan.location} (${plan.latitude.toFixed(4)}, ${plan.longitude.toFixed(4)})`,
    `일정: ${plan.date} ${plan.startTime}-${plan.endTime}`,
    `환경: ${environmentLabel(plan.environment)} / 현장 ${plan.crewSize}명 / 세팅 ${plan.setupMinutes}분`,
    `빛: 일출 ${solar ? formatTime(solar.sunrise) : '확인 불가'} / 일몰 ${solar ? formatTime(solar.sunset) : '확인 불가'}`,
    weather
      ? `기상 입력: ${weather.label} / 강수확률 ${Math.round(weather.maxRainChance ?? 0)}% / 돌풍 ${Math.round(weather.maxGust ?? 0)}km/h / 체감 ${Math.round(weather.minApparent ?? 0)}℃`
      : '기상 입력: 없음',
    '',
    analysis.summary,
    '',
    '먼저 막을 것',
    ...(analysis.risks.length ? analysis.risks.map((item, index) => `${index + 1}. ${item.message}`) : ['1. 즉시 중단할 운영 변수 없음']),
    '',
    '필수 확인',
    '- 실제 현장 인원과 예약 인원 대조',
    '- 주차·상하차·엘리베이터 확인',
    '- 최종 결정자와 연락망 고정',
    '- 장비 전력·배터리·메모리 확인',
    '- 우천 대체안 또는 취소 기준 합의',
    '- 원본 데이터 이중 백업 담당 지정',
    '',
    '본 결과는 제작 판단을 보조하며 현장 안전과 최종 결정은 사용자 책임입니다.',
    'https://stage-is.com/'
  ];
  return lines.join('\n');
}

async function copyReport() {
  if (!currentReport) return;
  try {
    await navigator.clipboard.writeText(currentReport);
    showToast('작전표를 복사했습니다.');
  } catch {
    const area = document.createElement('textarea');
    area.value = currentReport;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    showToast('작전표를 복사했습니다.');
  }
}

function downloadReport() {
  if (!currentReport) return;
  const date = document.getElementById('shoot-date')?.value || toDateInput(new Date());
  const blob = new Blob([currentReport], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `stage-is-shoot-plan-${date}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast('작전표 파일을 저장했습니다.');
}

function resetPlan() {
  const form = document.getElementById('shoot-form');
  if (!form) return;
  form.reset();
  selectedLocation = { ...LOCATIONS[0], source: 'preset' };
  document.getElementById('location').value = '서울';
  document.getElementById('start-time').value = '08:00';
  document.getElementById('end-time').value = '18:00';
  document.getElementById('crew-size').value = '8';
  document.getElementById('setup-minutes').value = '60';
  document.getElementById('weather-condition').value = 'mixed';
  document.getElementById('apparent-temperature').value = '20';
  document.getElementById('rain-chance').value = '10';
  document.getElementById('gust-speed').value = '10';
  document.getElementById('shoot-date').value = toDateInput(addDays(startOfDay(new Date()), 1));
  localStorage.removeItem(STORAGE_KEY);
  updateLocationFromInput();
  runSimulation();
}

function savePlan(plan) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  } catch {
    // The simulator still works when storage is unavailable.
  }
}

function restorePlan() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    const form = document.getElementById('shoot-form');
    if (!form) return;

    if (saved.location) document.getElementById('location').value = saved.location;
    if (saved.date && new Date(`${saved.date}T00:00:00`) >= startOfDay(new Date())) document.getElementById('shoot-date').value = saved.date;
    if (saved.lightGoal) document.getElementById('light-goal').value = saved.lightGoal;
    if (saved.startTime) document.getElementById('start-time').value = saved.startTime;
    if (saved.endTime) document.getElementById('end-time').value = saved.endTime;
    if (saved.crewSize) document.getElementById('crew-size').value = String(saved.crewSize);
    if (saved.setupMinutes) document.getElementById('setup-minutes').value = String(saved.setupMinutes);
    if (saved.weatherCondition) document.getElementById('weather-condition').value = saved.weatherCondition;
    if (Number.isFinite(saved.apparentTemperature)) document.getElementById('apparent-temperature').value = String(saved.apparentTemperature);
    if (Number.isFinite(saved.rainChance)) document.getElementById('rain-chance').value = String(saved.rainChance);
    if (Number.isFinite(saved.gustSpeed)) document.getElementById('gust-speed').value = String(saved.gustSpeed);
    form.elements.parkingConfirmed.checked = Boolean(saved.parkingConfirmed);
    form.elements.backupReady.checked = Boolean(saved.backupReady);
    form.elements.weatherChecked.checked = Boolean(saved.weatherChecked);
    const environment = form.querySelector(`input[name="environment"][value="${saved.environment}"]`);
    if (environment) environment.checked = true;

    if (Number.isFinite(saved.latitude) && Number.isFinite(saved.longitude)) {
      selectedLocation = {
        name: saved.location || '저장된 위치',
        latitude: saved.latitude,
        longitude: saved.longitude,
        source: saved.locationSource || 'saved'
      };
      const status = document.getElementById('location-status');
      if (status) status.textContent = `${saved.latitude.toFixed(4)}, ${saved.longitude.toFixed(4)} · 저장된 위치`;
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function environmentLabel(value) {
  return { outdoor: '야외', mixed: '실내·야외 혼합', indoor: '실내' }[value] || value;
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
  const normalized = ((totalMinutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function dateToMinutes(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function intervalOverlap(startA, endA, startB, endB) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function formatTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '확인 불가';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!remainder) return `${hours}시간`;
  if (!hours) return `${remainder}분`;
  return `${hours}시간 ${remainder}분`;
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

function haversine(lat1, lon1, lat2, lon2) {
  const toRadians = (value) => value * Math.PI / 180;
  const radius = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
