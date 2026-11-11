# Flight and GCP Planner

The visualizer runs the callable Python geometric optimizer in a browser worker. It searches GCP-pair midpoints, reorders waypoints using nearest-neighbour and 2-opt, removes detours, and evaluates rounded turns. Every accepted route passes the sampled photo-coverage and GDOP checks.

## Open the visualizer

From this repository directory, run:

```sh
python -m http.server 8000
```

Open http://localhost:8000. Static hosting such as GitHub Pages also works. Opening index.html directly from disk cannot load the Python worker. The first search downloads the pinned Pyodide 0.29.3 runtime from jsDelivr, so internet access is required. Site coordinates and optimization run inside the browser.

1. Choose an attached site or enter custom rectangular dimensions.
2. Set the camera and maximum ground pixel size. Choose a fixed GCP count or a count range. The automatic maximum distance to control is one-third of the survey diagonal for count search.
3. Select **Find best plan**. The status shows route checks and altitude. **Cancel search** stops the worker.
4. Inspect the curved route, numbered GCPs, and optional midpoint markers. Download flight and GCP CSVs.

The map opens in **3D terrain** view using the same elevation grid as the optimizer. The existing orthomosaic is draped over the elevation surface. Drag to orbit, scroll to zoom, and Shift-drag or right-drag to pan. Touch supports a two-finger pinch and pan. Arrow keys rotate, plus/minus zoom, and zero resets the camera. **Reset view** restores the initial viewpoint.

**Vertical scale** defaults to 1× true scale. The optional 2× and 5× settings exaggerate heights for inspection and affect only the display. Flight and GCP elevations remain in metres. The three supplied sites use 51 × 51 sampled DTM grids, with missing samples left as gaps. The ground elevation range and datum appear above the map. Custom dimension-only areas use flat ground at 0 m.

Use **2D map** for boundary and exclusion editing. Choosing a drawing tool automatically switches to the top-down view. Returning to 3D retains accepted boundaries, exclusions, and optimization results. Ground targets, midpoint candidates, and the airborne flight route share the same local coordinate system. Labels and route lines overlay the terrain for visibility. The renderer uses native Canvas with perspective projection and depth-sorted terrain triangles.

Advanced settings control height range, clearance, minimum photo overlaps, shutter speed, speed, photo budget, corner rounding, and route checks per height. Increasing the search budget allows more refinement. The default objective is shortest distance. Fewest GCPs, flight time, and lowest height are also available. Changing requirements invalidates downloads until a new plan passes.

An imaging polygon limits the surveyed samples and GCP candidates. It is not a flight fence. GCP exclusion circles affect target placement. Terrain line-of-sight checks reject hidden views, unknown terrain, and insufficient clearance along the sampled route. Unknown terrain can therefore make an otherwise plausible plan fail.

## Call the Python function

No additional Python packages are needed.

```python
from drone_optimizer import optimize

points = [(x, y, 0) for y in range(0, 41, 10)
          for x in range(0, 61, 10)]
result = optimize(
    points,
    width=60,
    height=40,
    gcp_count=(3, 8),
    max_gcp_distance=35,
    altitudes=(30, 35, 40),
)
plan = result['plan']
if plan is not None:
    path = plan['path']
    photo_positions = plan['cams']
    control_points = plan['gcps']
```

All coordinates and distances are local metres. The Python docstring documents camera parameters, optional start/end transit positions, a separate simple flight boundary, terrain callbacks, progress callbacks, and the search budget. `plan` is null when the sampled search finds no accepted route. Python raises ValueError for invalid settings.

## Algorithm and limits

The pre-flight GDOP formula and fixed-count placement ranking follow Sharma et al., *GDOP-Based GCP Optimization for UAV Photogrammetry*, Section II-A equations 1–3 and II-B. Unit camera-to-point directions form A and the score is sqrt(trace(inverse(A transpose A))). The selector takes the lowest finite point scores, with the requested minimum spacing. Setting `min_gcp_spacing=0` gives the paper's unconstrained ranking on the supplied candidate set.

Count search, maximum distance to control, spacing, midpoint routing, 2-opt and rounded turns are project extensions. Midpoints are optional candidates, accepted when they improve the objective and preserve coverage. The shortest accepted candidate is reported with no global-optimum guarantee. The paper's post-flight and reconstruction experiments have not been reproduced here.

The camera is nadir with fixed yaw independent of travel direction. Its ideal footprint enforces the requested overlap conservatively along curved travel. Photos are spaced along the route, and speed respects camera interval and translation-blur limits. The capture budget applies to the actual photo locations. Corner rounding controls geometric trimming and does not certify an aircraft turn radius. Elevation is constant for each candidate mission.

Flight CSVs include both route samples and actual photo locations. `capture_photo=true` identifies photos, and elapsed times use route arc length and constant speed. GCP coordinates use EPSG:32618 and EGM96 heights for attached sites, or local metres for custom surveys. Targets are planning suggestions that require field surveying.

Distance to control and GDOP are planning metrics. Validate mapping accuracy with independent checkpoints. The sampled terrain model does not include trees, buildings, wind, launch/landing, acceleration, or battery stops.

## Files

- `drone_optimizer.py` is the standalone Python implementation.
- `planner_request.py` converts visualizer settings to the function call.
- `python-worker.js` loads Pyodide and executes that same Python code.
- `python-planner.js` manages worker progress/cancellation and adapts results for drawing and CSV exports.
- `terrain-view.js` renders textured 3D terrain and handles orbit, pan, zoom, and touch controls.
- `planner-ui.js`, `index.html`, and `planner.css` implement the visualizer.
- `sites.js` and `assets/` provide prepared terrain and map previews.
- The original JavaScript algorithm modules remain available for existing library callers and comparison tests. The visualizer uses the Python implementation.

## Verification

```sh
python -m unittest -v test_drone_optimizer test_planner_request
node optimizer.test.cjs
node network.test.cjs
node capture-planning.test.cjs
```

With Playwright and Chromium installed, `node verify-python.cjs` starts a temporary static server and checks the actual browser Python worker, count search, rounded route, capture exports, failure, cancellation/retry, and mobile layout. Set PLAYWRIGHT_MODULE and CHROMIUM_PATH when using bundled browser tools. The browser test needs internet access for Pyodide. `node verify-3d.cjs` checks real elevation ranges, mouse and touch controls, keyboard/reset, automatic 2D editing, the actual Python route overlay, and mobile layout. It uses the same browser environment variables. The older `verify.cjs` and `verify-capture.cjs` now expect the static server at port 8000, or GDOP_TEST_URL. Their existing bundled Playwright paths remain supported.

Adapted from https://github.com/quinteroer/gdop_planner.
