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

const WEATHER_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const STORAGE_KEY = 'stageis-shoot-plan-v1';
const DAY_MINUTES = 1440;

let selectedLocation = { ...LOCATIONS[0] };
let currentReport = '';
let toastTimer;

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
  document.getElementById('reset-plan')?.addEventListener('click', resetPlan);
  document.getElementById('copy-report')?.addEventListener('click', copyReport);
  document.getElementById('download-report')?.addEventListener('click', downloadReport);
  document.getElementById('print-report')?.addEventListener('click', () => window.print());
}

function updateLocationFromInput() {
  const input = document.getElementById('location');
  const status = document.getElementById('location-status');
  if (!input || !status) return;

  const query = input.value.trim().toLowerCase();
  const match = LOCATIONS.find((location) => {
    const candidates = [location.name, ...(location.aliases || [])];
    return candidates.some((candidate) => candidate.toLowerCase() === query);
  });

  if (match) {
    selectedLocation = { ...match };
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
        longitude
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

async function runSimulation() {
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
  updateForecastBadge('날씨 확인 중');
  savePlan(plan);

  const solar = calculateSolar(plan);
  const weather = await fetchWeather(plan).catch(() => null);
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
    date: String(data.get('shootDate')),
    lightGoal: String(data.get('lightGoal')),
    environment: String(data.get('environment')),
    startTime: String(data.get('startTime')),
    endTime: String(data.get('endTime')),
    crewSize: Number(data.get('crewSize')),
    setupMinutes: Number(data.get('setupMinutes')),
    parkingConfirmed: data.get('parkingConfirmed') === 'on',
    backupReady: data.get('backupReady') === 'on'
  };
}

function validatePlan(plan) {
  if (!plan.date) return '촬영일을 선택하세요.';
  if (!plan.startTime || !plan.endTime) return '콜타임과 철수 시간을 입력하세요.';
  if (plan.crewSize < 1) return '현장 인원은 한 명 이상이어야 합니다.';

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

async function fetchWeather(plan) {
  const target = startOfDay(new Date(`${plan.date}T00:00:00`));
  const today = startOfDay(new Date());
  const distance = daysBetween(today, target);

  if (distance < 0 || distance > 15) {
    return { unavailable: true, reason: 'range' };
  }

  const params = new URLSearchParams({
    latitude: String(plan.latitude),
    longitude: String(plan.longitude),
    hourly: [
      'temperature_2m',
      'apparent_temperature',
      'precipitation_probability',
      'precipitation',
      'weather_code',
      'cloud_cover',
      'wind_speed_10m',
      'wind_gusts_10m'
    ].join(','),
    timezone: 'Asia/Seoul',
    start_date: plan.date,
    end_date: plan.date
  });

  const response = await fetch(`${WEATHER_ENDPOINT}?${params.toString()}`);
  if (!response.ok) throw new Error(`Weather request failed: ${response.status}`);
  const payload = await response.json();
  if (!payload.hourly?.time?.length) throw new Error('Weather data is empty');

  const start = timeToMinutes(plan.startTime);
  const end = normalizeEndMinutes(plan.startTime, plan.endTime);
  const indexes = payload.hourly.time.map((value, index) => {
    const time = value.slice(11, 16);
    let minute = timeToMinutes(time);
    if (minute < start && end > DAY_MINUTES) minute += DAY_MINUTES;
    return minute >= start && minute <= end ? index : -1;
  }).filter((index) => index >= 0);

  const safeIndexes = indexes.length ? indexes : payload.hourly.time.map((_, index) => index);
  const collect = (key) => safeIndexes.map((index) => Number(payload.hourly[key]?.[index])).filter(Number.isFinite);
  const max = (values) => values.length ? Math.max(...values) : null;
  const min = (values) => values.length ? Math.min(...values) : null;

  const temperatures = collect('temperature_2m');
  const apparent = collect('apparent_temperature');
  const rainChance = collect('precipitation_probability');
  const rainfall = collect('precipitation');
  const wind = collect('wind_speed_10m');
  const gust = collect('wind_gusts_10m');
  const cloud = collect('cloud_cover');
  const weatherCodes = collect('weather_code');

  return {
    unavailable: false,
    minTemperature: min(temperatures),
    maxTemperature: max(temperatures),
    minApparent: min(apparent),
    maxApparent: max(apparent),
    maxRainChance: max(rainChance),
    totalRain: rainfall.reduce((sum, value) => sum + value, 0),
    maxWind: max(wind),
    maxGust: max(gust),
    averageCloud: cloud.length ? cloud.reduce((sum, value) => sum + value, 0) / cloud.length : null,
    dominantCode: mode(weatherCodes),
    label: weatherCodeLabel(mode(weatherCodes))
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
  if (weather?.unavailable) {
    if (decision === 'GO') return '빛과 운영 조건은 진행 가능 범위입니다. 날짜가 가까워지면 날씨를 다시 계산하세요.';
    return '운영 조건을 먼저 수정하세요. 날씨는 예보 범위에 들어온 뒤 다시 확인해야 합니다.';
  }
  if (!weather) return '빛과 운영 조건만 계산했습니다. 날씨 연결 후 최종 판단이 필요합니다.';
  if (decision === 'GO') return `${weather.label} 기준으로 진행 가능성이 높습니다. 출발 전 현장 확인 항목만 닫으세요.`;
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
  initializeIcons();
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
  if (!weather) {
    updateForecastBadge('날씨 연결 실패');
  } else if (weather.unavailable) {
    updateForecastBadge('예보 범위 밖');
  } else {
    updateForecastBadge('예보 연결됨');
  }
}

function updateForecastBadge(message) {
  const badge = document.getElementById('forecast-badge');
  if (badge) badge.textContent = message;
}

function renderMetrics(solar, weather) {
  setText('sunrise-value', solar ? formatTime(solar.sunrise) : '확인 불가');
  setText('sunset-value', solar ? formatTime(solar.sunset) : '확인 불가');
  setText('rain-value', weather && !weather.unavailable && weather.maxRainChance !== null ? `${Math.round(weather.maxRainChance)}%` : '예보 없음');
  setText('wind-value', weather && !weather.unavailable && weather.maxGust !== null ? `${Math.round(weather.maxGust)} km/h` : '예보 없음');

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
    { label: '출발 직전 기상특보 재확인', checked: Boolean(weather && !weather.unavailable) }
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
    weather && !weather.unavailable
      ? `날씨: ${weather.label} / 강수확률 최대 ${Math.round(weather.maxRainChance ?? 0)}% / 돌풍 최대 ${Math.round(weather.maxGust ?? 0)}km/h / 기온 ${roundRange(weather.minTemperature, weather.maxTemperature)}℃`
      : '날씨: 예보 범위 밖 또는 연결되지 않음',
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
  selectedLocation = { ...LOCATIONS[0] };
  document.getElementById('location').value = '서울';
  document.getElementById('start-time').value = '08:00';
  document.getElementById('end-time').value = '18:00';
  document.getElementById('crew-size').value = '8';
  document.getElementById('setup-minutes').value = '60';
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
    form.elements.parkingConfirmed.checked = Boolean(saved.parkingConfirmed);
    form.elements.backupReady.checked = Boolean(saved.backupReady);
    const environment = form.querySelector(`input[name="environment"][value="${saved.environment}"]`);
    if (environment) environment.checked = true;

    if (Number.isFinite(saved.latitude) && Number.isFinite(saved.longitude)) {
      selectedLocation = {
        name: saved.location || '저장된 위치',
        latitude: saved.latitude,
        longitude: saved.longitude
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

function weatherCodeLabel(code) {
  if (code === null || code === undefined) return '예보 정보';
  if (code === 0) return '맑음';
  if ([1, 2].includes(code)) return '대체로 맑음';
  if (code === 3) return '흐림';
  if ([45, 48].includes(code)) return '안개';
  if ([51, 53, 55, 56, 57].includes(code)) return '이슬비';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '비';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '눈';
  if ([95, 96, 99].includes(code)) return '뇌우';
  return '변화 가능';
}

function mode(values) {
  if (!values.length) return null;
  const counts = new Map();
  let result = values[0];
  values.forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
    if (counts.get(value) > (counts.get(result) || 0)) result = value;
  });
  return result;
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

function roundRange(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return '--';
  return `${Math.round(min)}~${Math.round(max)}`;
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

function daysBetween(start, end) {
  return Math.round((end - start) / 86400000);
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
