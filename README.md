# Stage-Is Shoot Day Simulator

Stage-Is is a static production-planning tool for Korean video creators. It combines solar windows, short-term weather, crew and timing constraints into a printable shoot-day operation brief.

## Product surface

- `index.html`: simulator, interactive 3D field view and operation brief
- `js/scene.js`: Three.js field model, solar path, shadows and weather visualization
- `field-guide.html`: first-party field rules generalized from production records
- `method.html`: scoring method, data sources and limitations
- `about.html`, `contact.html`, `privacy.html`: trust and policy pages

## Data

- Solar calculations: SunCalc
- Exact location selection: Leaflet with OpenStreetMap tiles
- Initial weather evaluation: Open-Meteo non-commercial public endpoint
- Before advertising or other monetization is activated, replace the evaluation weather endpoint with the official KMA short-term forecast API or a licensed commercial weather endpoint.

The site has no article crawler, generated article archive or scheduled content workflow.
