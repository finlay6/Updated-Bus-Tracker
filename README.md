# Bus Tracker

A small static bus tracker built with HTML, CSS and browser JavaScript. There is no package install or build step.

## Publish with GitHub Pages

1. Keep `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `icons/` and `assets/` together in the Pages root.
2. Push the repository to GitHub.
3. In the repository settings, set Pages to deploy from the `main` branch and the root folder.

The Worker URL is prefilled in Settings. The site sends Bustimes requests through that Worker, which keeps provider credentials on the Worker side. No API keys belong in these static files. Change the URL in the website’s Settings if you deploy your own Worker.

## Route history

History is read for every day in the selected period. Each date request asks for up to 1,000 journeys and follows every pagination link until the provider has no more pages. The page keeps a local IndexedDB cache of completed days and fleet records, so a repeat visit can render right away and only refresh recent data. A first 365-day request still depends on the provider’s response time and rate limits; progress is shown as days finish.

Models are grouped by model and livery. A different livery creates a separate card. Records without model details remain visible under “Model not identified.”

## Sources

- Live locations and historical vehicle journeys: Bustimes, through the project Worker.
- Satellite and place-label tiles: Esri ArcGIS World Imagery and World Boundaries and Places. Attribution is shown on the map. Review [Esri’s current service terms](https://www.esri.com/en-us/legal/terms/web-site-service) before commercial use; the terms require a separate license for commercial use.
- The [Bus Open Data Service guide](https://www.gov.uk/guidance/find-and-use-bus-open-data) describes real-time vehicle locations and timetables, along with historic punctuality data. It does not document an equivalent archived per-vehicle/livery journey feed, so it cannot replace the records used by route history.
