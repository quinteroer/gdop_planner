# Flight and GCP Planner

The visualizer runs the callable Python geometric optimizer in a browser worker. It searches GCP-pair midpoints, reorders waypoints using nearest-neighbour and 2-opt, removes detours, and evaluates rounded turns. Visualizer route seeds cover the bounding extent of the supplied terrain samples rather than empty orthomosaic margins. Refinement evaluates the largest shortcuts first, distributes equal-gain attempts across the route, and reserves work for every feasible alternative. Every accepted route passes the sampled photo-coverage and GDOP checks.

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

The map opens in **3D terrain** using **Original 3D mesh** for the supplied sites. This uses the original ArcGIS SLPK geometry and its texture atlases, converted into the planner's local UTM coordinates. It is a reduced-detail copy for browser performance, rather than an overhead image stretched over the ground grid. The source EGM96 elevations and vertex UVs are preserved. The original mesh is displayed at 1× true scale.

Choose **Ground elevations (DTM)** to inspect the bare-earth height samples as a shaded surface. This view deliberately uses no overhead image texture, so roof pixels cannot be mistaken for building geometry. The optional 2× and 5× vertical scales apply only to this ground view and affect display only. The three supplied sites use 51 × 51 DTM grids for optimization, with missing samples left as gaps. Custom dimension-only areas use flat ground at 0 m. The 2D map continues to use the orthomosaic.

Drag to orbit, scroll to zoom, and Shift-drag or right-drag to pan. Touch supports a two-finger pinch and pan. Arrow keys rotate, plus/minus zoom, and zero resets the camera. **Reset view** restores the initial viewpoint and fits the actual model and route to the canvas. The scene mesh uses WebGL depth testing. If WebGL or mesh loading is unavailable, a labelled ground view is shown.

Use **2D map** for boundary and exclusion editing. Choosing a drawing tool automatically switches to the top-down view. Returning to 3D retains accepted boundaries, exclusions, and optimization results. Ground targets and the airborne route share the same projected coordinate system. Labels and route lines overlay the mesh for visibility. Mesh display is separate from the existing DTM-based optimization.

Advanced settings control height range, clearance, minimum photo overlaps, shutter speed, speed, photo budget, corner rounding, and route checks per height. Increasing the search budget allows more refinement. The default objective is shortest distance. Fewest GCPs, flight time, and lowest height are also available. Changing requirements invalidates downloads until a new plan passes.

An imaging polygon limits the surveyed samples and GCP candidates. It is not a flight fence. GCP exclusion circles affect target placement. Terrain line-of-sight checks reject hidden views, unknown terrain, and insufficient clearance along the sampled route. Unknown terrain can therefore make an otherwise plausible plan fail.

## Tree and building screening and GDOP heatmap

**Keep targets clear of trees and buildings** is on by default for the supplied sites. Full-resolution DSM minus DTM screening rejects raised cover over 1 m within 2.5 m of each candidate, along with unknown raster data. This is a conservative raised-cover screen for canopy, buildings and other objects. It is not a semantic tree classification. Manual exclusions remain available for missed vegetation, water, inaccessible areas and changed conditions. Custom areas without surface data explicitly show that automatic screening is unavailable.

GDOP is recomputed for every ground sample using only cameras with an unblocked observation ray through the DSM height field, with a 0.5 m allowance for surface/ground model disagreement. A ground target below the modelled opaque canopy or roof has no observation rows. Too few or singular observations produce infinite/undefined GDOP, which is displayed as no valid geometry. Cameras inside modelled cover also contribute no observations. This surface-aware calculation remains active when the optional placement buffer is turned off. Placement screening is an additional hard eligibility constraint before selection. Invisible or poorly observed candidates cannot be selected. The surface model checks GCP visibility. Flight clearance continues to use the existing terrain-clearance model, with optional terrain line of sight.

**Show placement screening** overlays rejected areas. **GDOP heatmap** overlays the current route's surface-aware ground-sample scores in 2D and 3D. Green means lower GDOP and red means higher GDOP, using a relative logarithmic scale with numeric limits in the legend. Gray marks blocked or unknown targets and singular observation geometry. Finite GDOP scores are shown independently of the extra placement buffer; Show placement screening displays those restrictions. The overlay is available after optimization and never changes the plan or export state. Scores and target eligibility are recomputed when planning requirements change.

Rebuild these fields with `python prepare_placement.py` after generating new site terrain data. The build script needs numpy and Pillow and reads the original DSM and DTM GeoTIFFs without modifying them.

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

All coordinates and distances are local metres. Direct Python callers can set `use_sample_bounds=True` to seed routes around their known terrain samples. Otherwise the supplied width and height retain their rectangular mission extent. The Python function also accepts `gcp_allowed(point)` for a hard placement filter and `surface_at(x,y)` for surface-aware GCP observation visibility. The Python docstring documents camera parameters, optional start/end transit positions, a separate simple flight boundary, terrain callbacks, progress callbacks, and the search budget. `plan` is null when the sampled search finds no accepted route. Python raises ValueError for invalid settings.

## Algorithm and limits

The pre-flight GDOP formula and fixed-count placement ranking follow Sharma et al., *GDOP-Based GCP Optimization for UAV Photogrammetry*, Section II-A equations 1–3 and II-B. Unit camera-to-point directions form A and the score is sqrt(trace(inverse(A transpose A))). The selector takes the lowest finite point scores, with the requested minimum spacing. Setting `min_gcp_spacing=0` gives the paper's unconstrained ranking on the supplied candidate set.

Count search, maximum distance to control, spacing, midpoint routing, 2-opt and rounded turns are project extensions. Midpoints are optional candidates, accepted when they improve the objective and preserve coverage. The shortest accepted candidate is reported with no global-optimum guarantee. The paper's post-flight and reconstruction experiments have not been reproduced here.

The camera is nadir with fixed yaw independent of travel direction. Its ideal footprint enforces the requested overlap conservatively along curved travel. Photos are spaced along the route, and speed respects camera interval and translation-blur limits. The capture budget applies to the actual photo locations. Corner rounding controls geometric trimming and does not certify an aircraft turn radius. Elevation is constant for each candidate mission.

Flight CSVs include both route samples and actual photo locations. `capture_photo=true` identifies photos, and elapsed times use route arc length and constant speed. GCP coordinates use EPSG:32618 and EGM96 heights for attached sites, or local metres for custom surveys. Targets are planning suggestions that require field surveying.

Distance to control and GDOP are planning metrics. Validate mapping accuracy with independent checkpoints. The sampled terrain model does not include trees, buildings, wind, launch/landing, acceleration, or battery stops.

## Files

- `drone_optimizer.py` is the standalone Python implementation.
- `planner_request.py` converts visualizer settings, placement masks, and surface grids to the function call.
- `gdop-heatmap.js` supplies the shared 2D/3D GDOP color scale.
- `prepare_placement.py` prepares DSM/DTM placement screening and surface-height grids.
- `python-worker.js` loads Pyodide and executes that same Python code.
- `python-planner.js` manages worker progress/cancellation and adapts results for drawing and CSV exports.
- `terrain-view.js` handles orbit controls, shaded ground terrain, and planning overlays.
- `mesh-surface.js` renders the original texture atlases and depth-tested scene geometry.
- `assets/meshes/` contains the reduced-detail mesh buffers, textures, and coordinate manifests.
- `prepare_meshes.py` rebuilds those assets from the original SLPK packages. It needs numpy, Pillow, and pyproj at build time, with no extra browser runtime libraries.
- `planner-ui.js`, `index.html`, and `planner.css` implement the visualizer.
- `sites.js` and `assets/` provide prepared terrain and map previews.
- The original JavaScript algorithm modules remain available for existing library callers and comparison tests. The visualizer uses the Python implementation.

## Verification

```sh
python verify_mesh_assets.py
python -m unittest -v test_drone_optimizer test_planner_request
node optimizer.test.cjs
node network.test.cjs
node capture-planning.test.cjs
```

With Playwright and Chromium installed, `node verify-python.cjs` starts a temporary static server and checks the actual browser Python worker, count search, rounded route, capture exports, failure, cancellation/retry, and mobile layout. Set PLAYWRIGHT_MODULE and CHROMIUM_PATH when using bundled browser tools. The browser test needs internet access for Pyodide. `node verify-3d.cjs` checks original-mesh loading, ground-mode switching, real elevation ranges, mouse and touch controls, keyboard/reset, automatic 2D editing, the actual Python route overlay, and mobile layout. It uses the same browser environment variables. `node verify-placement.cjs` checks actual Spring Run targets against the prepared placement mask, surface-aware scores, heatmaps in both views, and settings invalidation. `node verify-route-extent.cjs` reproduces the Williams Island uneven-strip case and verifies the shortened route stays within the known terrain-sample bounds while preserving photo timing, screened GCPs, and the GDOP overlay. The older `verify.cjs` and `verify-capture.cjs` now expect the static server at port 8000, or GDOP_TEST_URL. Their existing bundled Playwright paths remain supported.

Adapted from https://github.com/quinteroer/gdop_planner.
