# Survey GDOP planner

Open `index.html` in a modern browser. Prepared assets work directly from disk. Choose an attached survey, adjust flight and GCP settings, and use **Export GCP CSV**.

Adapted from https://github.com/quinteroer/gdop_planner (index.html blob c9dd878885609729332061007e286f9f4bc7f49b).

The attached folder contains survey imagery and terrain rather than a precomputed GDOP table. `sites.js` contains a 51 × 51 sampling of each DTM. Orthomosaic GeoTIFF metadata supplies bounds; supplied PNG previews provide browser imagery. Missing terrain is excluded. Original survey files are read only.

Exports use metres in EPSG:32618 (WGS84 / UTM zone 18N) and preserve the source GeoTIFF EGM96 height datum. Suggested GCP positions are sampled estimates, not surveyed control coordinates.

GDOP uses the original camera-to-point geometry formula with terrain elevations. Flights are simulated lawnmower patterns at constant elevation above median sampled terrain. All simulated cameras contribute to every candidate. Image visibility, camera attitude, obstacles, water, access, and actual photo positions are not modeled. Review placement in the field. GDOP here does not establish reconstruction RMSE or measured GNSS GDOP. Baselines outside valid terrain are omitted, so comparison counts may differ.

To regenerate assets, run `prepare_sites.py` with Python, Pillow, and numpy. It reads the sibling `Site Scan Data and Model Photos` directory. The bundled interpreter in this workspace is `C:\Users\equin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`.

Optional local server: run `python -m http.server 8000 --bind 127.0.0.1` from this directory and visit http://127.0.0.1:8000.

## Optimize mission

**Optimize everything** searches both north–south and east–west lawnmower patterns, altitude in 5 m increments, and overlaps in 5 percentage-point increments, also including range endpoints. It retains the chosen camera, required GCP count, GCP spacing and site bounds. Set altitude and overlap ranges, minimum sampled terrain clearance, maximum GDOP and photo budget. A feasible result must meet the GDOP limit at every terrain candidate and fit every required GCP with its spacing.

**Shortest flight first** minimizes in-site path distance, then altitude. **Lowest altitude first** minimizes altitude, then distance. **Balance distance and height** minimizes distance divided by the shortest candidate distance plus altitude divided by the minimum requested altitude. Plans are checked in objective order; the first feasible plan is applied. This is the best feasible plan in the discrete search, not a continuous global optimum. No feasible result leaves the current settings unchanged.

The model assumes a square camera footprint and uses the highest sampled DTM elevation to bound photo/line spacing conservatively. Clearance checks cover sampled terrain only, not buildings, trees or other obstacles. Flights cover the rectangular site bounds. Distance includes curved connectors when selected, and excludes takeoff, landing, approach and transit to the site. Wind and aircraft dynamics are not modeled. Height is above median sampled terrain, not maximum AGL everywhere. GDOP still uses all simulated cameras without a visibility test. Flight CSV contains simulated photo and transit positions with camera elevations in the site datum, not an autopilot mission file.

Manual flight/camera/GCP changes invalidate the optimized route; display toggles preserve it. `node optimizer.test.cjs` checks the search math, and `node verify.cjs` performs browser checks using the bundled Playwright runtime configured for this workspace.

## Curved turns

Choose **Survey lines with curved turns** for straight photo passes joined by two tangent quarter circles and a connector beyond each end of the site. Set the curve radius and allowed outside-site extension. A plan is rejected if the extension is too small or adjacent survey lines are less than two radii apart. Photo passes and their overlap remain unchanged; transit through the turns contributes no photos or GDOP observations. The radius is a geometric input, not a verified aircraft performance limit.

**Compare both styles** adds straight and curved connectors to the search. Since this optimizer measures distance rather than acceleration or flight time, straight connectors generally win. Curves add `(π − 2) × radius` distance per turn but avoid the straight connector's abrupt heading changes. Actual time and energy benefits require a speed/acceleration model. The route is sampled for preview/export, while distance uses exact arc lengths. CSV now includes `capture_photo` to distinguish survey photos from turn transit points.

Turns extend outside the surveyed footprint and have unverified terrain clearance there. The outside-site buffer represents available geometric room; it does not establish airspace permission or obstacle clearance. The planner does not yet support curved photo passes, circles, spirals, or an autopilot-ready spline mission.
