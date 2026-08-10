# Stage-Is Sun + Weather Simulator

Stage-Is is a static location-light tool for Korean video creators. It combines exact map coordinates, solar direction, shadows and automatic hourly weather into an interactive 3D view and a printable light-and-weather brief.

## Product surface

- `index.html`: simulator, interactive 3D field view and hourly forecast
- `js/scene.js`: Three.js field model, solar path, shadows and weather visualization
- `field-guide.html`: practical guidance for sun direction, shadows, cloud cover and weather
- `method.html`: location, solar and weather calculation sources and limitations
- `about.html`, `contact.html`, `privacy.html`: trust and policy pages

## Data

- Solar calculations: SunCalc
- Exact location selection: Leaflet with OpenStreetMap tiles
- Address search and reverse geocoding: OpenStreetMap Nominatim, user-triggered and browser-cached
- Hourly weather: MET Norway Locationforecast 2.0 under CC BY 4.0
- Apparent temperature and production-light labels: calculated in the browser by Stage-Is
- Solar direction: calculated in the browser from the full-precision pin; weather requests use coordinates rounded to four decimals.

## Advertising

- Google AdSense publisher: `ca-pub-7015444869634194`
- The standard Auto ads loader is present on the six main public pages.
- EEA, UK and Switzerland consent is managed through Google Privacy & messaging using a Google-certified CMP.
- `assets/stage-is-logo.png` is the 5:1 brand mark registered with the consent message.

The site has no article crawler, generated article archive or scheduled content workflow.
