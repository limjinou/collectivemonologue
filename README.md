# Stage-Is Shoot Day Simulator

Stage-Is is a static production-planning tool for Korean video creators. It combines solar windows, user-entered field weather, crew and timing constraints into a printable shoot-day operation brief.

## Product surface

- `index.html`: simulator, interactive 3D field view and operation brief
- `js/scene.js`: Three.js field model, solar path, shadows and weather visualization
- `field-guide.html`: first-party field rules generalized from production records
- `method.html`: scoring method, data sources and limitations
- `about.html`, `contact.html`, `privacy.html`: trust and policy pages

## Data

- Solar calculations: SunCalc
- Exact location selection: Leaflet with OpenStreetMap tiles
- Weather risk input: manually entered conditions checked by the user from KMA forecasts or field observations
- No live weather endpoint is called; exact coordinates stay in the browser except for requested OpenStreetMap tiles.

## Advertising

- Google AdSense publisher: `ca-pub-7015444869634194`
- The standard Auto ads loader is present on the six main public pages.
- EEA, UK and Switzerland consent is managed through Google Privacy & messaging using a Google-certified CMP.
- `assets/stage-is-logo.png` is the 5:1 brand mark registered with the consent message.

The site has no article crawler, generated article archive or scheduled content workflow.
