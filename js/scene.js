import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const visual = document.getElementById('field-visual');
const canvas = document.getElementById('field-canvas');
const canvasWrap = document.getElementById('field-canvas-wrap');

if (visual && canvas && canvasWrap) {
  try {
    initializeFieldScene();
  } catch (error) {
    visual.classList.add('is-fallback');
    visual.dataset.sceneReady = 'error';
    console.error('Stage-Is 3D scene failed to initialize.', error);
  }
}

function initializeFieldScene() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc8df);
  scene.fog = new THREE.Fog(0x9fc8df, 22, 54);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.enablePan = false;
  controls.minDistance = 7;
  controls.maxDistance = 27;
  controls.minPolarAngle = 0.42;
  controls.maxPolarAngle = 1.44;
  controls.target.set(0, 1.35, 0);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clock = new THREE.Clock();
  const field = buildField(scene);
  const atmosphere = buildAtmosphere(scene);
  const solar = buildSolarSystem(scene);
  const lighting = buildLighting(scene, field.subjectTarget);

  const state = {
    snapshot: null,
    minute: 720,
    cloudCover: 32,
    rainSignal: 0,
    gust: 8,
    sunBearing: 0,
    shadowBearing: 180,
    firstFrame: true
  };

  resetCamera();
  bindSceneControls();
  resize();

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvasWrap);

  window.addEventListener('stageis:simulation', (event) => applySnapshot(event.detail));
  if (window.stageIsSimulation) applySnapshot(window.stageIsSimulation);
  else applyPlaceholderState();

  window.__stageIs3D = {
    getState: () => ({
      ready: visual.dataset.sceneReady === 'true',
      minute: state.minute,
      decision: state.snapshot?.analysis?.decision || null,
      latitude: state.snapshot?.plan?.latitude ?? null,
      longitude: state.snapshot?.plan?.longitude ?? null,
      sunBearing: state.sunBearing,
      shadowBearing: state.shadowBearing,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height
    }),
    resetView: resetCamera
  };

  animate();

  function applyPlaceholderState() {
    const today = new Date();
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    applySnapshot({
      plan: {
        location: '서울',
        latitude: 37.5665,
        longitude: 126.978,
        date: toDateInput(date),
        startTime: '08:00',
        endTime: '18:00',
        environment: 'outdoor',
        lightGoal: 'daylight'
      },
      solar: { dawn: 320, sunrise: 350, goldenMorningEnd: 410, goldenEveningStart: 1050, sunset: 1110, dusk: 1140 },
      weather: null,
      analysis: { decision: 'SUN', label: '태양 계산', tone: 'clear', focusMinute: 720 }
    });
  }

  function applySnapshot(snapshot) {
    if (!snapshot?.plan) return;
    state.snapshot = snapshot;

    const start = timeToMinutes(snapshot.plan.startTime || '08:00');
    const end = normalizeEndMinutes(snapshot.plan.startTime || '08:00', snapshot.plan.endTime || '18:00');
    const preferredMinute = chooseSceneMinute(snapshot, start, end);
    const slider = document.getElementById('scene-time');

    if (slider) {
      slider.min = String(start);
      slider.max = String(Math.max(start + 5, end));
      slider.value = String(preferredMinute);
    }

    state.minute = preferredMinute;
    setText('scene-time-start', formatClock(start));
    setText('scene-time-end', formatClock(end));
    setText('scene-place', `${snapshot.plan.location} · ${formatKoreanDate(snapshot.plan.date)}`);

    const decision = document.getElementById('scene-decision');
    if (decision) {
      decision.textContent = snapshot.analysis?.label || snapshot.analysis?.decision || '--';
      decision.className = snapshot.analysis?.tone ? `is-${snapshot.analysis.tone}` : '';
    }

    const weather = snapshot.weather;
    const weatherAvailable = weather && !weather.unavailable;
    state.cloudCover = weatherAvailable && Number.isFinite(weather.averageCloud) ? weather.averageCloud : 30;
    state.rainSignal = weatherAvailable && Number.isFinite(weather.totalRain) ? Math.min(100, weather.totalRain * 24) : 0;
    state.gust = weatherAvailable && Number.isFinite(weather.maxWind) ? weather.maxWind : 8;

    updateEnvironment(field, lighting, 'outdoor');
    updateWeather(atmosphere, state);
    rebuildSolarPaths(solar, snapshot);
    updateDecisionBeacon(field, snapshot.analysis?.tone);
    updateSceneTime();
  }

  function bindSceneControls() {
    document.getElementById('scene-time')?.addEventListener('input', (event) => {
      state.minute = Number(event.target.value);
      updateSceneTime();
    });

    document.getElementById('scene-reset-view')?.addEventListener('click', resetCamera);
  }

  function updateSceneTime() {
    if (!state.snapshot) return;
    setText('scene-time-output', formatClock(state.minute));

    const weatherPoint = nearestWeatherPoint(state.snapshot.weather, state.minute);
    if (weatherPoint) {
      state.cloudCover = Number.isFinite(weatherPoint.cloud) ? weatherPoint.cloud : state.cloudCover;
      state.rainSignal = precipitationSignal(weatherPoint);
      state.gust = Number.isFinite(weatherPoint.wind) ? weatherPoint.wind : state.gust;
      setText('scene-weather', weatherPoint.label || '--');
      setText('scene-feels', Number.isFinite(weatherPoint.apparent) ? `${Math.round(weatherPoint.apparent)}°` : '--');
    } else {
      setText('scene-weather', state.snapshot.weather?.reason === 'loading' ? '불러오는 중' : '예보 범위 밖');
      setText('scene-feels', '--');
    }
    updateWeather(atmosphere, state);

    const sunData = getSunData(state.snapshot.plan, state.minute, solar.radius);
    const reading = sceneReading(weatherPoint, sunData.altitudeDegrees);
    const decision = document.getElementById('scene-decision');
    if (decision) {
      decision.textContent = reading.label;
      decision.className = `is-${reading.tone}`;
    }
    updateDecisionBeacon(field, reading.tone);
    solar.sun.position.copy(sunData.position);
    solar.sunRing.position.copy(sunData.position);
    solar.sunRing.lookAt(camera.position);

    const lightPosition = sunData.direction.clone().multiplyScalar(18);
    lightPosition.y = Math.max(2.4, lightPosition.y);
    lighting.sun.position.copy(lightPosition);

    const daylightStrength = THREE.MathUtils.smoothstep(sunData.altitudeDegrees, -5, 28);
    const cloudAttenuation = THREE.MathUtils.lerp(1, 0.34, THREE.MathUtils.clamp(state.cloudCover / 100, 0, 1));
    lighting.sun.intensity = (1.2 + daylightStrength * 3.3) * cloudAttenuation;
    lighting.hemisphere.intensity = 1.3 + daylightStrength * 1.6;
    lighting.sun.color.copy(sunColorForAltitude(sunData.altitudeDegrees));

    solar.sun.visible = sunData.altitudeDegrees > -8;
    solar.sunRing.visible = solar.sun.visible;

    const sky = skyColorForConditions(sunData.altitudeDegrees, state.cloudCover, 'outdoor');
    scene.background.copy(sky);
    scene.fog.color.copy(sky);
    state.sunBearing = sunData.bearingDegrees;
    state.shadowBearing = (sunData.bearingDegrees + 180) % 360;
    setText('scene-sun-altitude', `${sunData.altitudeDegrees >= 0 ? '+' : ''}${sunData.altitudeDegrees.toFixed(1)}°`);
    setText('scene-sun-direction', `${compassDirection(state.sunBearing)} ${Math.round(state.sunBearing)}°`);
    setText('scene-shadow-direction', `${compassDirection(state.shadowBearing)} ${Math.round(state.shadowBearing)}°`);
  }

  function resetCamera() {
    const compact = canvasWrap.clientWidth < 650;
    camera.position.set(compact ? 11.6 : 13.5, compact ? 7.8 : 8.6, compact ? 17.5 : 16.4);
    controls.target.set(0, 1.35, 0);
    controls.update();
  }

  function resize() {
    const width = Math.max(1, canvasWrap.clientWidth);
    const height = Math.max(1, canvasWrap.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.elapsedTime;

    if (!reducedMotion) {
      animateClouds(atmosphere, delta, state.gust);
      animateRain(atmosphere, delta, state.rainSignal);
      field.beacon.rotation.z += delta * 0.16;
      solar.sunRing.rotation.z = elapsed * 0.08;
    }

    controls.update();
    renderer.render(scene, camera);

    if (state.firstFrame) {
      state.firstFrame = false;
      visual.dataset.sceneReady = 'true';
    }
  }
}

function buildField(scene) {
  const fieldGroup = new THREE.Group();
  scene.add(fieldGroup);

  const ground = mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0xb9b8ad, roughness: 0.96, metalness: 0 }),
    [0, 0, 0],
    [-Math.PI / 2, 0, 0]
  );
  ground.receiveShadow = true;
  fieldGroup.add(ground);

  const grid = new THREE.GridHelper(48, 48, 0x353535, 0x77776f);
  grid.position.y = 0.012;
  grid.material.opacity = 0.24;
  grid.material.transparent = true;
  fieldGroup.add(grid);

  const shootFloor = mesh(
    new THREE.BoxGeometry(8.8, 0.1, 6.2),
    new THREE.MeshStandardMaterial({ color: 0x35383a, roughness: 0.82 }),
    [0, 0.05, 0]
  );
  shootFloor.receiveShadow = true;
  fieldGroup.add(shootFloor);

  addTapeMark(fieldGroup, -1.2, 0.12, 0.3);
  addTapeMark(fieldGroup, 1.15, 0.12, -0.7);

  const subject = buildPerson(0xe14b39, 1.04);
  subject.position.set(0, 0.1, 0);
  fieldGroup.add(subject);

  const secondSubject = buildPerson(0xf2c14e, 0.96);
  secondSubject.position.set(1.45, 0.1, -0.8);
  secondSubject.rotation.y = -0.32;
  fieldGroup.add(secondSubject);

  const cameraRig = buildCameraRig();
  cameraRig.position.set(4.8, 0.1, 6.9);
  cameraRig.rotation.y = 0.58;
  fieldGroup.add(cameraRig);

  const leftLight = buildLightStand(0xf5f3df);
  leftLight.position.set(-4.2, 0.1, 2.2);
  leftLight.rotation.y = -0.7;
  fieldGroup.add(leftLight);

  const rightLight = buildLightStand(0xf0d45d);
  rightLight.position.set(4.1, 0.1, -2.1);
  rightLight.rotation.y = 2.25;
  fieldGroup.add(rightLight);

  const crewOne = buildPerson(0x222831, 0.86);
  crewOne.position.set(-5.7, 0.08, -3.4);
  fieldGroup.add(crewOne);

  const crewTwo = buildPerson(0x2866ad, 0.82);
  crewTwo.position.set(6.1, 0.08, -4.1);
  fieldGroup.add(crewTwo);

  const cases = new THREE.Group();
  cases.add(buildCase(-4.7, 0.34, -1.55, 0x16191c));
  cases.add(buildCase(-5.25, 0.28, -1.25, 0x324453));
  fieldGroup.add(cases);

  const horizon = buildHorizon();
  fieldGroup.add(horizon);

  const groundCompass = buildGroundCompass();
  fieldGroup.add(groundCompass);

  const mixedShell = buildMixedShell();
  fieldGroup.add(mixedShell);

  const indoorShell = buildIndoorShell();
  fieldGroup.add(indoorShell);

  const beacon = mesh(
    new THREE.TorusGeometry(1.05, 0.055, 12, 64),
    new THREE.MeshStandardMaterial({ color: 0x32ce84, emissive: 0x11633f, emissiveIntensity: 1.4, roughness: 0.35 }),
    [0, 0.16, 0],
    [-Math.PI / 2, 0, 0]
  );
  fieldGroup.add(beacon);

  return {
    group: fieldGroup,
    ground,
    grid,
    mixedShell,
    indoorShell,
    beacon,
    subjectTarget: new THREE.Object3D()
  };
}

function buildAtmosphere(scene) {
  const cloudGroup = new THREE.Group();
  const clouds = [];
  const random = seededRandom(1827);

  for (let index = 0; index < 12; index += 1) {
    const cloud = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: 0xf4f6f4,
      roughness: 1,
      transparent: true,
      opacity: 0.62,
      depthWrite: false
    });

    for (let puff = 0; puff < 5; puff += 1) {
      const radius = 0.7 + random() * 0.8;
      const cloudPiece = mesh(
        new THREE.IcosahedronGeometry(radius, 1),
        material,
        [(puff - 2) * 0.65, random() * 0.45, (random() - 0.5) * 0.7]
      );
      cloud.add(cloudPiece);
    }

    cloud.position.set(-18 + random() * 36, 8 + random() * 6, -8 - random() * 17);
    cloud.scale.setScalar(0.75 + random() * 0.8);
    cloud.userData.speed = 0.12 + random() * 0.2;
    clouds.push(cloud);
    cloudGroup.add(cloud);
  }
  scene.add(cloudGroup);

  const rainCount = 900;
  const rainPositions = new Float32Array(rainCount * 3);
  for (let index = 0; index < rainCount; index += 1) {
    rainPositions[index * 3] = (random() - 0.5) * 24;
    rainPositions[index * 3 + 1] = 1 + random() * 14;
    rainPositions[index * 3 + 2] = (random() - 0.5) * 20;
  }

  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  const rain = new THREE.Points(
    rainGeometry,
    new THREE.PointsMaterial({ color: 0xa7dcff, size: 0.055, transparent: true, opacity: 0.78 })
  );
  rain.visible = false;
  scene.add(rain);

  return { cloudGroup, clouds, rain, rainCount };
}

function buildSolarSystem(scene) {
  const group = new THREE.Group();
  const pathGroup = new THREE.Group();
  const radius = 15.5;

  const sun = mesh(
    new THREE.SphereGeometry(0.42, 28, 20),
    new THREE.MeshBasicMaterial({ color: 0xffdd38 }),
    [0, 10, -8]
  );

  const sunRing = mesh(
    new THREE.TorusGeometry(0.62, 0.035, 10, 48),
    new THREE.MeshBasicMaterial({ color: 0xffed8a, transparent: true, opacity: 0.9 }),
    [0, 10, -8]
  );

  group.add(pathGroup, sun, sunRing);
  scene.add(group);
  return { group, pathGroup, sun, sunRing, radius };
}

function buildLighting(scene, subjectTarget) {
  scene.add(subjectTarget);
  subjectTarget.position.set(0, 1.35, 0);

  const hemisphere = new THREE.HemisphereLight(0xcfe9ff, 0x43453f, 2.2);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(0xfff0cc, 4.2);
  sun.castShadow = true;
  sun.target = subjectTarget;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -12;
  sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 45;
  sun.shadow.bias = -0.00015;
  scene.add(sun);

  const key = new THREE.SpotLight(0xe8f1ff, 34, 22, Math.PI / 5, 0.42, 1.2);
  key.position.set(-4.2, 5.2, 3.2);
  key.target = subjectTarget;
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);

  const rim = new THREE.SpotLight(0xffc64a, 20, 18, Math.PI / 4, 0.5, 1.4);
  rim.position.set(4.4, 4.8, -3.4);
  rim.target = subjectTarget;
  scene.add(rim);

  return { hemisphere, sun, key, rim };
}

function updateEnvironment(field, lighting, environment) {
  field.mixedShell.visible = environment === 'mixed';
  field.indoorShell.visible = environment === 'indoor';
  field.grid.visible = environment !== 'indoor';
  field.ground.material.color.set(environment === 'indoor' ? 0x5f6263 : 0xb9b8ad);
  lighting.key.intensity = environment === 'indoor' ? 72 : environment === 'mixed' ? 48 : 28;
  lighting.rim.intensity = environment === 'indoor' ? 52 : 22;
}

function updateWeather(atmosphere, state) {
  const visibleClouds = Math.round(THREE.MathUtils.clamp(state.cloudCover / 100, 0.08, 1) * atmosphere.clouds.length);
  atmosphere.clouds.forEach((cloud, index) => {
    cloud.visible = index < visibleClouds;
    cloud.children.forEach((piece) => {
      piece.material.opacity = 0.28 + THREE.MathUtils.clamp(state.cloudCover / 100, 0, 1) * 0.52;
      piece.material.color.set(state.cloudCover > 75 ? 0xb8c0c3 : 0xf4f6f4);
    });
  });

  const drops = Math.round(THREE.MathUtils.clamp(state.rainSignal / 100, 0, 1) * atmosphere.rainCount);
  atmosphere.rain.geometry.setDrawRange(0, drops);
  atmosphere.rain.visible = drops > 0;
}

function updateDecisionBeacon(field, tone) {
  const wet = tone === 'wet';
  const variable = ['variable', 'overcast', 'soft'].includes(tone);
  const night = tone === 'night';
  const color = wet ? 0x52a9ff : night ? 0x7679c8 : variable ? 0xffc84a : 0x32ce84;
  const emissive = wet ? 0x124a72 : night ? 0x24275f : variable ? 0x713309 : 0x11633f;
  field.beacon.material.color.setHex(color);
  field.beacon.material.emissive.setHex(emissive);
}

function rebuildSolarPaths(solarSystem, snapshot) {
  solarSystem.pathGroup.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
  solarSystem.pathGroup.clear();

  const dawn = snapshot.solar?.dawn ?? 300;
  const dusk = snapshot.solar?.dusk ?? 1170;
  const fullPoints = sampleSunPath(snapshot.plan, dawn - 30, dusk + 30, 40, solarSystem.radius);
  const fullPath = tubeFromPoints(fullPoints, 0xffdc38, 0.026, 0.9);
  solarSystem.pathGroup.add(fullPath);

  const start = timeToMinutes(snapshot.plan.startTime);
  const end = normalizeEndMinutes(snapshot.plan.startTime, snapshot.plan.endTime);
  const shootPoints = sampleSunPath(snapshot.plan, start, end, 24, solarSystem.radius);
  const shootPath = tubeFromPoints(shootPoints, 0x52caff, 0.06, 1);
  solarSystem.pathGroup.add(shootPath);

  [snapshot.solar?.sunrise, snapshot.solar?.sunset].filter(Number.isFinite).forEach((minute) => {
    const marker = mesh(
      new THREE.SphereGeometry(0.14, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff3a4 }),
      getSunData(snapshot.plan, minute, solarSystem.radius).position.toArray()
    );
    solarSystem.pathGroup.add(marker);
  });
}

function animateClouds(atmosphere, delta, gust) {
  const windFactor = 0.5 + THREE.MathUtils.clamp(gust / 30, 0, 2);
  atmosphere.clouds.forEach((cloud) => {
    cloud.position.x += cloud.userData.speed * windFactor * delta;
    if (cloud.position.x > 22) cloud.position.x = -22;
  });
}

function animateRain(atmosphere, delta, rainChance) {
  if (!atmosphere.rain.visible) return;
  const positions = atmosphere.rain.geometry.attributes.position;
  const fallSpeed = 10 + rainChance * 0.08;

  for (let index = 0; index < positions.count; index += 1) {
    const nextY = positions.getY(index) - fallSpeed * delta;
    positions.setY(index, nextY < 0.25 ? 14 : nextY);
    positions.setX(index, positions.getX(index) + 0.7 * delta);
    if (positions.getX(index) > 12) positions.setX(index, -12);
  }
  positions.needsUpdate = true;
}

function nearestWeatherPoint(weather, minute) {
  const points = weather?.hours;
  if (!Array.isArray(points) || !points.length) return null;
  return points.reduce((nearest, point) => Math.abs(point.minute - minute) < Math.abs(nearest.minute - minute) ? point : nearest, points[0]);
}

function precipitationSignal(point) {
  const wetSymbol = /(rain|sleet|snow|thunder)/.test(String(point.symbol || ''));
  const amount = Number.isFinite(point.precipitation) ? point.precipitation : 0;
  return THREE.MathUtils.clamp((wetSymbol ? 42 : 0) + amount * 28, 0, 100);
}

function sceneReading(point, altitude) {
  if (altitude < -6) return { label: point?.label?.includes('비') ? '비 오는 야간' : '야간', tone: 'night' };
  if (!point) return { label: '태양 경로 계산', tone: 'clear' };
  if (point.precipitation >= 0.2 || /(rain|sleet|snow|thunder)/.test(String(point.symbol || ''))) {
    return { label: point.label || '강수', tone: 'wet' };
  }
  if ((point.cloud ?? 50) < 20) return { label: '강한 직사광', tone: 'clear' };
  if ((point.cloud ?? 50) < 60) return { label: '변화하는 혼합광', tone: 'variable' };
  if ((point.cloud ?? 50) >= 90) return { label: '평평한 흐린빛', tone: 'overcast' };
  return { label: '부드러운 확산광', tone: 'soft' };
}

function buildPerson(color, scale = 1) {
  const group = new THREE.Group();
  const fabric = new THREE.MeshStandardMaterial({ color, roughness: 0.84 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98a65, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17191b, roughness: 0.9 });

  const torso = mesh(new THREE.CapsuleGeometry(0.42, 0.9, 5, 10), fabric, [0, 1.65, 0]);
  const head = mesh(new THREE.SphereGeometry(0.31, 16, 12), skin, [0, 2.62, 0]);
  const leftLeg = mesh(new THREE.CapsuleGeometry(0.14, 0.72, 4, 8), dark, [-0.2, 0.62, 0]);
  const rightLeg = mesh(new THREE.CapsuleGeometry(0.14, 0.72, 4, 8), dark, [0.2, 0.62, 0]);
  const leftArm = mesh(new THREE.CapsuleGeometry(0.1, 0.72, 4, 8), fabric, [-0.54, 1.67, 0], [0, 0, -0.16]);
  const rightArm = mesh(new THREE.CapsuleGeometry(0.1, 0.72, 4, 8), fabric, [0.54, 1.67, 0], [0, 0, 0.16]);

  [torso, head, leftLeg, rightLeg, leftArm, rightArm].forEach((part) => {
    part.castShadow = true;
    part.receiveShadow = true;
    group.add(part);
  });
  group.scale.setScalar(scale);
  return group;
}

function buildCameraRig() {
  const group = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: 0x111417, metalness: 0.5, roughness: 0.45 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x444b50, metalness: 0.72, roughness: 0.32 });

  const column = mesh(new THREE.CylinderGeometry(0.055, 0.07, 2.15, 10), metal, [0, 1.25, 0]);
  const body = mesh(new THREE.BoxGeometry(0.82, 0.5, 0.62), black, [0, 2.48, 0]);
  const screen = mesh(new THREE.BoxGeometry(0.4, 0.26, 0.05), new THREE.MeshStandardMaterial({ color: 0x235f71, emissive: 0x123541, emissiveIntensity: 1 }), [0, 2.58, 0.34]);
  const lens = mesh(new THREE.CylinderGeometry(0.18, 0.23, 0.62, 18), black, [0, 2.46, -0.58], [Math.PI / 2, 0, 0]);

  [column, body, screen, lens].forEach((part) => {
    part.castShadow = true;
    group.add(part);
  });

  [[0.95, 0, 0.82], [-0.95, 0, 0.82], [0, 0, -1.05]].forEach((end) => {
    const leg = cylinderBetween(new THREE.Vector3(0, 1.25, 0), new THREE.Vector3(...end), 0.045, metal);
    leg.castShadow = true;
    group.add(leg);
  });
  return group;
}

function buildLightStand(panelColor) {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x363b3e, metalness: 0.75, roughness: 0.35 });
  const panelMaterial = new THREE.MeshStandardMaterial({ color: panelColor, emissive: panelColor, emissiveIntensity: 0.6, roughness: 0.6 });
  const pole = mesh(new THREE.CylinderGeometry(0.045, 0.06, 3.15, 10), metal, [0, 1.62, 0]);
  const panel = mesh(new THREE.BoxGeometry(1.32, 0.92, 0.1), panelMaterial, [0, 3.15, 0]);
  pole.castShadow = true;
  panel.castShadow = true;
  group.add(pole, panel);

  [[0.78, 0, 0.58], [-0.78, 0, 0.58], [0, 0, -0.85]].forEach((end) => {
    const leg = cylinderBetween(new THREE.Vector3(0, 0.62, 0), new THREE.Vector3(...end), 0.035, metal);
    leg.castShadow = true;
    group.add(leg);
  });
  return group;
}

function buildCase(x, y, z, color) {
  const item = mesh(
    new THREE.BoxGeometry(1.1, 0.62, 0.68),
    new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.62 }),
    [x, y, z]
  );
  item.castShadow = true;
  item.receiveShadow = true;
  return item;
}

function buildHorizon() {
  const group = new THREE.Group();
  const random = seededRandom(712);
  for (let index = 0; index < 28; index += 1) {
    const width = 1.2 + random() * 2.8;
    const height = 1.4 + random() * 6;
    const depth = 1.5 + random() * 3;
    const building = mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color: index % 4 === 0 ? 0x6d777a : 0x858d8d, roughness: 0.94 }),
      [-24 + index * 1.8, height / 2 - 0.2, -18 - random() * 5]
    );
    building.castShadow = true;
    building.receiveShadow = true;
    group.add(building);
  }
  return group;
}

function buildMixedShell() {
  const group = new THREE.Group();
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xd7d3c7, roughness: 0.9, side: THREE.DoubleSide });
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x25292b, metalness: 0.62, roughness: 0.42 });
  const wall = mesh(new THREE.BoxGeometry(9.8, 4.6, 0.18), wallMaterial, [0, 2.3, -5.2]);
  wall.receiveShadow = true;
  group.add(wall);
  [-4.7, 0, 4.7].forEach((x) => group.add(mesh(new THREE.BoxGeometry(0.16, 5.4, 0.16), frameMaterial, [x, 2.7, -4.95])));
  group.visible = false;
  return group;
}

function buildIndoorShell() {
  const group = new THREE.Group();
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x767978, roughness: 0.88, side: THREE.DoubleSide });
  const back = mesh(new THREE.BoxGeometry(12, 6.2, 0.2), wallMaterial, [0, 3.1, -5.8]);
  const side = mesh(new THREE.BoxGeometry(0.2, 6.2, 11.8), wallMaterial, [-6, 3.1, 0]);
  const ceiling = mesh(new THREE.BoxGeometry(12, 0.18, 11.8), wallMaterial, [0, 6.15, 0]);
  [back, side, ceiling].forEach((part) => {
    part.receiveShadow = true;
    group.add(part);
  });

  const practicalMaterial = new THREE.MeshStandardMaterial({ color: 0xffe596, emissive: 0xffd45c, emissiveIntensity: 2.2 });
  [-3.4, 0, 3.4].forEach((x) => {
    group.add(mesh(new THREE.BoxGeometry(1.9, 0.08, 0.56), practicalMaterial, [x, 5.95, -1.3]));
  });
  group.visible = false;
  return group;
}

function buildGroundCompass() {
  const group = new THREE.Group();
  group.position.set(-6.4, 0.1, 4.5);

  const ring = mesh(
    new THREE.TorusGeometry(0.86, 0.026, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0xf5f1e6, transparent: true, opacity: 0.82 }),
    [0, 0, 0],
    [-Math.PI / 2, 0, 0]
  );
  const eastWest = mesh(
    new THREE.BoxGeometry(1.7, 0.018, 0.035),
    new THREE.MeshBasicMaterial({ color: 0xf5f1e6, transparent: true, opacity: 0.62 })
  );
  const northArrow = mesh(
    new THREE.ConeGeometry(0.2, 0.92, 3),
    new THREE.MeshBasicMaterial({ color: 0xe94c3d }),
    [0, 0.03, -0.34],
    [-Math.PI / 2, 0, 0]
  );
  const southArrow = mesh(
    new THREE.ConeGeometry(0.16, 0.68, 3),
    new THREE.MeshBasicMaterial({ color: 0xf5f1e6 }),
    [0, 0.028, 0.3],
    [Math.PI / 2, 0, 0]
  );

  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 128;
  labelCanvas.height = 128;
  const context = labelCanvas.getContext('2d');
  context.clearRect(0, 0, 128, 128);
  context.fillStyle = '#ffffff';
  context.font = '700 82px IBM Plex Mono, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('N', 64, 64);
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false }));
  label.position.set(0, 0.42, -1.1);
  label.scale.set(0.52, 0.52, 0.52);

  group.add(ring, eastWest, northArrow, southArrow, label);
  return group;
}

function addTapeMark(group, x, y, z) {
  const material = new THREE.MeshBasicMaterial({ color: 0xffd60a });
  group.add(mesh(new THREE.BoxGeometry(0.75, 0.015, 0.08), material, [x, y, z], [0, 0.45, 0]));
  group.add(mesh(new THREE.BoxGeometry(0.75, 0.015, 0.08), material, [x, y + 0.002, z], [0, -0.45, 0]));
}

function tubeFromPoints(points, color, radius, opacity) {
  const safePoints = points.length >= 2 ? points : [new THREE.Vector3(), new THREE.Vector3(0.01, 0, 0)];
  const curve = new THREE.CatmullRomCurve3(safePoints);
  const geometry = new THREE.TubeGeometry(curve, Math.max(16, safePoints.length * 2), radius, 7, false);
  const material = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false });
  return new THREE.Mesh(geometry, material);
}

function sampleSunPath(plan, start, end, samples, radius) {
  const points = [];
  for (let index = 0; index <= samples; index += 1) {
    const minute = start + (end - start) * (index / samples);
    points.push(getSunData(plan, minute, radius).position);
  }
  return points;
}

function getSunData(plan, minute, radius) {
  const date = new Date(Date.parse(`${plan.date}T00:00:00+09:00`) + minute * 60000);
  const positionData = window.SunCalc?.getPosition(date, plan.latitude, plan.longitude) || { altitude: Math.PI / 4, azimuth: 0 };
  const altitude = positionData.altitude;
  const azimuth = positionData.azimuth;
  const bearingDegrees = (THREE.MathUtils.radToDeg(azimuth) + 540) % 360;
  const bearing = THREE.MathUtils.degToRad(bearingDegrees);
  const horizontal = Math.cos(altitude);
  const direction = new THREE.Vector3(
    Math.sin(bearing) * horizontal,
    Math.sin(altitude),
    -Math.cos(bearing) * horizontal
  ).normalize();
  const position = direction.clone().multiplyScalar(radius);
  position.y = Math.max(-1.4, position.y);
  return { position, direction, altitudeDegrees: THREE.MathUtils.radToDeg(altitude), bearingDegrees };
}

function skyColorForConditions(altitude, cloudCover, environment) {
  if (environment === 'indoor') return new THREE.Color(0x343b40);

  let color;
  if (altitude < -8) {
    color = new THREE.Color(0x101827);
  } else if (altitude < 3) {
    const amount = THREE.MathUtils.smoothstep(altitude, -8, 3);
    color = new THREE.Color(0x263f62).lerp(new THREE.Color(0xd88767), amount);
  } else if (altitude < 16) {
    const amount = THREE.MathUtils.smoothstep(altitude, 3, 16);
    color = new THREE.Color(0xe2a070).lerp(new THREE.Color(0x8fc5e4), amount);
  } else {
    color = new THREE.Color(0x8fc9e8);
  }

  const cloudAmount = THREE.MathUtils.clamp(cloudCover / 100, 0, 1) * 0.62;
  return color.lerp(new THREE.Color(0x77858d), cloudAmount);
}

function sunColorForAltitude(altitude) {
  const amount = THREE.MathUtils.smoothstep(altitude, 0, 20);
  return new THREE.Color(0xffa35c).lerp(new THREE.Color(0xfff1d2), amount);
}

function compassDirection(degrees) {
  const directions = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'];
  return directions[Math.round(((degrees % 360) + 360) % 360 / 22.5) % directions.length];
}

function chooseSceneMinute(snapshot, start, end) {
  if (snapshot.plan.lightGoal === 'golden' && Number.isFinite(snapshot.solar?.goldenEveningStart)) {
    const golden = snapshot.solar.goldenEveningStart;
    if (golden >= start && golden <= end) return golden;
  }
  return Math.round((start + end) / 2 / 5) * 5;
}

function mesh(geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(...position);
  item.rotation.set(...rotation);
  return item;
}

function cylinderBetween(start, end, radius, material) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const item = mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 10), material, midpoint.toArray());
  item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  return item;
}

function seededRandom(seed) {
  let value = seed % 2147483647;
  return () => {
    value = value * 16807 % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || '00:00').split(':').map(Number);
  return hours * 60 + minutes;
}

function normalizeEndMinutes(startTime, endTime) {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);
  if (end <= start) end += 1440;
  return end;
}

function formatClock(minutes) {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatKoreanDate(value) {
  const date = new Date(`${value}T12:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' }).format(date);
}

function toDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
