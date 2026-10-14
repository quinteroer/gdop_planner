# Survey flight and GCP planner

Open `index.html` in a modern browser and choose an attached survey. The app uses prepared orthomosaic previews and a 51 x 51 DTM sample for each site. Missing terrain is excluded. Original survey files remain read only.

## Flight optimization

The optimizer enumerates altitude at 5 m steps and front/side overlaps at 5 percentage-point steps, including range endpoints. It compares north-south and east-west survey lines, optionally both footprint orientations and straight/curved connectors. It rejects sampled terrain clearance, turn geometry, photo budget, GSD, capture timing and translation blur violations before ranking routes. Objectives are estimated time, distance, altitude, or normalized distance plus altitude. Ranked routes undergo visible-image geometry and GCP network checks; the first accepted route is applied. If none is accepted, the current mission is retained. This is a sampled heuristic search, not proof of global optimality or infeasibility.

Mini 4 Pro profiles use an ideal rectangular nadir footprint from 82.1-degree diagonal FOV and 4:3 aspect ratio, 8064 x 6048 or 4032 x 3024 pixels, and timed-photo intervals of 5 or 2 seconds respectively. The 24 mm equivalent focal length is not substituted for physical focal length. The default maximum GSD is 0.5 cm/pixel. Speed is capped by requested speed, actual photo spacing divided by capture interval, and permitted blur times GSD divided by exposure. Lower ground limits worst GSD; higher ground limits overlap and blur. These ideal estimates require verification with actual captures. Comparing footprint orientations assumes the selected physical camera orientation is available in flight.

Estimated time is distance divided by constant speed. It excludes launch, landing, transit, acceleration, turn slowdown, wind, battery limits and image-write variability. Straight connectors contain abrupt changes of heading. Curved connectors comprise two quarter circles with a joining segment outside the site. They require line separation of at least twice the radius and sufficient outside buffer; radius is not a validated aircraft performance constraint. Outside-site terrain and obstacles are unverified. Photos occur on straight survey lines only.

## GCP network optimization

The default selector replaces individual-score greedy selection with deterministic multistart exchange. Eligible locations must satisfy spacing, visible photo count, minimum maximum-pair intersection angle and manual exclusion circles. Click the map with exclusion mode enabled to mask water, inaccessible ground or other unsuitable control locations. These masks apply to GCP placement, not image coverage or flight safety.

The search builds six spatial starting layouts and retains a valid legacy greedy seed when available. It requires all occupied quadrants when control count permits, plus a central control when an eligible central location and sufficient count exist. It minimizes a dimensionless planning objective:

`maximum nearest-control distance / diagonal + 0.5 * mean nearest-control distance / diagonal + 0.05 * mean bounded geometry diagnostic + 0.1 * elevation-range deficit`

Each seed receives up to six best-improvement one-point exchange passes, followed by a bounded two-point exchange pass to escape some local traps. Exchanges use a spatial/geometry candidate pool and at most 144 demand samples. Final layouts and original seeds are compared using all terrain demand points. A valid original greedy seed therefore cannot be worsened under this full objective. Hard spacing and distribution constraints remain enforced. The restricted pool and bounded exchanges can miss feasible or better layouts. Legacy greedy selection is available for comparison. Network coverage distance is a proxy for control distribution, not predicted survey error.

## Geometry and accuracy

Only simulated cameras whose rectangular nadir footprints contain a terrain point contribute to that point's direction-matrix diagnostic. The app also checks visible image count and largest pairwise viewing angle. It does not model line-of-sight occlusion, image matching, lens calibration uncertainty, rolling shutter, correlated observations, GCP survey error or bundle-adjustment covariance. Its dimensionless diagnostic is neither measured GNSS GDOP nor reconstruction RMSE.

A GSD threshold does not establish the requested <=1 cm horizontal and vertical RMSE. That requires independently surveyed checkpoints withheld from adjustment, suitable survey uncertainty, and reconstruction validation. No optimizer here certifies that requirement. Flight covers rectangular survey bounds at constant elevation above median sampled terrain; height varies above terrain. Sampled clearance does not cover trees or buildings.

## Exports and validation

GCP CSV uses metres in EPSG:32618 and preserves source EGM96 height datum. Locations are sampled suggestions, not surveyed coordinates. Flight CSV contains simulated photo/transit positions, capture flags, speed and interval; it is not an autopilot mission. Manual flight/camera/GCP changes invalidate the optimized route; display toggles preserve it.

Run `node optimizer.test.cjs` and `node network.test.cjs` for algorithm checks. `node verify.cjs` runs three-site optimization, exports, curved route and retained-mission browser checks with this workspace's bundled Playwright configuration.

To regenerate prepared data, run `prepare_sites.py` with Python, Pillow and numpy. It reads the sibling `Site Scan Data and Model Photos` directory. Adapted from https://github.com/quinteroer/gdop_planner.
