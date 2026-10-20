# Flight & GCP Planner

Open `index.html` in a modern browser. No server, build step, external fonts or package install is needed. Original survey data remains read-only.

## Main workflow

1. Choose an attached site or enter a custom rectangular area's dimensions.
2. Choose the Mini 4 Pro photo mode, maximum pixel size, GCP count and minimum GCP spacing.
3. Select **Find best plan**. The app searches flight routes and selects a distributed GCP network for each accepted candidate.
4. Inspect the route and numbered GCPs, review time/photos/height, then download the flight and GCP CSVs. **View plan details** contains the coordinates and search diagnostics.

Changing a planning requirement clears the result and disables downloads until a new plan passes. Toggling coverage only changes the display. Preview imagery remains visible before optimization; unvalidated flight paths and GCPs are not presented as accepted plans.

**Advanced settings** contains height limits, terrain clearance, maximum speed, optimization priority, minimum overlaps, shutter speed, photo budget, optional terrain line of sight and map refinements. Defaults are 80% forward/side overlap, four usable images and at least 10 degrees viewing spread per sampled terrain patch, a 0.5-pixel translation-blur budget and a minimum flight speed of 0.3 m/s. The overlap search spans the chosen minimum through five percentage points higher, capped at 90% forward and 85% side.

Draw an imaging polygon by choosing **Draw survey boundary**, clicking its corners and selecting **Use boundary**. Simple concave polygons are supported. Straight transit can cross outside that imaging boundary; it is not a flight fence. **Exclude GCP placement** lets you click unsuitable target areas with a configurable radius. Exclusions affect GCP placement, not aircraft travel or required photo coverage. Boundary and exclusion changes require re-optimization.

The photo-quality panel, capture-log import, reconstruction-feedback import, supplemental-view controls, legacy GCP comparison, manual flight sliders and diagnostic layer menus have been removed from the interface. Capture research helpers remain available in the standalone JavaScript module; `CAPTURE_PLANNING.md` records that earlier workflow and is not the current UI guide.

## Flight algorithm

The discrete search enumerates altitude in 5 m steps and overlap in 5 percentage-point steps, including range endpoints. It automatically compares twelve headings at 15-degree increments, plus the original cardinal-axis grid layouts, so expanding the search preserves the original feasible candidates. All missions use straight survey strips at a constant elevation. Camera orientation is fixed to the short image dimension along flight; the UI no longer asks users to compare unverified camera-roll configurations.

Routes are ranked by estimated flight time by default, with distance and altitude available as advanced priorities. Initial filters enforce sampled terrain clearance, photo budget, worst GSD, minimum speed, image-save interval and translation blur. Timing includes all consecutive capture positions, including row transitions. Ranked candidates undergo visible-image geometry checks and GCP network selection. The first accepted candidate is the best accepted route under that ranking in the sampled set; this is not proof of global optimality or infeasibility.

The Mini 4 Pro footprint is an ideal nadir rectangle based on 82.1-degree diagonal FOV, 4:3 aspect ratio and 8064 x 6048 or 4032 x 3024 image dimensions. Timed-capture intervals are 5 seconds at 48 MP and 2 seconds at 12 MP. The 24 mm equivalent focal length is not substituted for physical focal length. Speed is capped by requested speed, minimum consecutive capture spacing divided by camera interval, and blur budget times GSD divided by exposure. These ideal estimates require validation with the actual camera workflow.

Time is distance divided by constant speed. It excludes launch, landing, acceleration, turning slowdown, transit to/from the survey, wind and battery stops. The app does not split flights into battery missions or model aircraft dynamics, obstacles, trees, rolling shutter or image-write variability. A DTM is not a model of buildings, dam faces or overhangs. Optional ray sampling rejects terrain occlusion and unknown terrain; it does not certify visibility or clearance between samples.

## GCP algorithm

Eligible locations must satisfy minimum image count, viewing spread and manual placement exclusions. The deterministic multi-start network search seeds six spatial layouts and retains a valid greedy seed when available. It requires occupied quadrants and an eligible central location when count permits, then improves the set through bounded one- and two-point exchanges.

The dimensionless objective combines maximum and mean distance to the nearest GCP, bounded geometry quality and elevation-range representation. Search uses a restricted candidate pool and at most 144 demand samples, then compares final layouts and original seeds against all demand points. This avoids worsening a valid original seed under the full objective, but bounded exchanges can miss better or feasible layouts.

Network coverage is distance to control, not reconstruction error. Direction-matrix geometry is neither GNSS GDOP nor predicted RMSE. The app does not compute bundle-adjustment covariance, calibration uncertainty, correlated observations, verified image matches or GCP measurement uncertainty. Maximum pixel size does not certify 1 cm horizontal or vertical RMSE; independent surveyed checkpoints are required.

## Files and exports

- `index.html`, `planner.css`, `planner-ui.js`: focused interface and interactions.
- `optimizer.js`: route generation and constrained search.
- `app-model.js`, `capture-planning.js`: footprint visibility, sampled terrain rays and geometry diagnostics.
- `gcp-network.js`: distributed GCP network refinement.
- `sites.js`, `assets/`: prepared terrain and orthomosaic previews.

GCP exports use EPSG:32618 and EGM96 heights for attached sites. Coordinates are sampled planning suggestions, not surveyed control. Custom sites use local metres. Flight exports include capture positions, estimated elapsed time, footprint heading, nadir tilt, speed and the minimum supported capture interval; they are not executable autopilot missions. `photo_interval_s` is the camera's minimum timed interval, not a promise that every capture occurs exactly that far apart.

## Verification

Run `node optimizer.test.cjs`, `node network.test.cjs` and `node capture-planning.test.cjs` for algorithm checks. `node verify.cjs` verifies the focused UI across all three sites, timing/spacing exports, invalidation and mobile layout. `node verify-capture.cjs` checks advanced boundary drawing, exclusions, terrain visibility and failure states. Browser tests currently reference this workspace's bundled Playwright and Chromium paths. Software tests do not establish flight safety or field accuracy.

Adapted from https://github.com/quinteroer/gdop_planner.
