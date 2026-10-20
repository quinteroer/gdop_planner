# Photo acquisition improvements

Historical capture-research notes. The current interface focuses on flight-path search and GCP placement; photo audits, reconstruction imports and supplemental-view controls are no longer exposed. See `README.md` for the current UI. The underlying standalone helpers are retained for research and algorithm tests.

Implemented October 20, 2026. Open `index.html` and use **Photo coverage and field checks**. The accepted mission remains a constant-elevation nadir survey. The additions improve planning and field diagnostics; they have not been field validated.

## Coverage and routes

- Map layers show usable view count, viewing spread, worst visible GSD, capture gaps, imported capture gaps and reconstruction support. Red marks gaps or unavailable observations. Export per-patch coverage as CSV. GSD limits filter usable observations. Coverage is not measured reconstruction accuracy.
- **Search headings every 15°** compares twelve headings from 0° to 165°, clockwise from north, instead of only the two cardinal axes. It searches strip missions, not arbitrary paths.
- Enter an imaging boundary as `[[east,north],...]` in local metres from the site's southwest corner, then click **Apply boundary**. The polygon must be simple and inside the site; concave shapes are supported. Cameras are clipped to strip intersections. Straight connectors may cross outside the polygon, including notches; this is not a flight-permission fence. Clear the boundary to restore the rectangle. Heading search and clipping require Straight or Compare both styles; curved-only search reports an error and retains the current mission.
- **Check sampled terrain line of sight** rejects rays hidden by sampled terrain or crossing missing DTM data. Sampling uses half the smaller DTM cell dimension. This approximate height field cannot represent vertical walls, overhangs, trees, thin obstacles or collision clearance. Unknown terrain is rejected. Terrain following is not implemented.
- Capture-speed checks include every consecutive capture, including row transitions and disjoint clipped segments. Flight CSV includes estimated elapsed time, footprint heading and nadir tilt. `photo_interval_s` is the minimum supported timed interval, not a claim that every planned capture has exactly that interval. Constant-speed time estimates omit launch/landing, acceleration, wind and battery stops. The CSV is not an autopilot mission.

## Supplemental view selection

Click **Suggest supplemental views** after planning or importing capture/reconstruction feedback. A bounded greedy multicover search samples up to forty weak locations with four candidate directions each. It chooses complementary 30°-from-nadir views, rewarding additional usable observations and angular spread. Reconstruction-support gaps can also be targeted for additional observations. The algorithm is heuristic, not globally optimal.

Purple squares and a separate CSV show candidate camera positions and orientations. They are not added to the accepted mission. Route, timing, aircraft/gimbal capability, obstacles, matching and field clearance still require validation. Displayed before/after gaps refer only to modeled geometry. Repair of a reconstruction requires recapture and reprocessing. Candidates use a horizontal-surface resolution approximation; vertical-face planning needs a suitable 3D surface model.

## Actual capture audits

Download the capture template and populate one numeric row per image in chronological order:

```csv
x_m,y_m,z_m,timestamp_s,heading_deg,tilt_deg,exposure_s,gsd_m,sharpness
50,50,30,0,0,0,0.001,0.005,125
55,50,30,5,0,0,0.001,0.005,120
```

Coordinates must be local metres and camera elevations in the selected terrain's height datum. Subtract the site's west/south coordinates from projected eastings/northings. Convert latitude/longitude and takeoff-relative or ellipsoidal heights before importing. Heading is clockwise from north; tilt is 0° at nadir and less than 90°. Timestamps are numeric seconds with a common arbitrary origin and must strictly increase. The parser accepts unquoted numeric CSV, up to 5000 captures and 5 MB.

Exposure, local GSD and sharpness are optional; blanks remain unverified. The audit excludes known sharpness/translation-blur failures, reports the largest time gap and nearest planned-photo distance, and computes posed-camera geometric coverage from remaining images. Blur is estimated from consecutive displacement, exposure and supplied GSD; the first image has no speed estimate. Poses are not verified feature matches. EXIF/flight-log conversion, clock synchronization and datum conversion are not automatic.

Select JPEG/PNG files under **Check local photo sharpness and exposure** to calculate Laplacian variance and near-black/near-white percentages locally in the browser. Each preview has maximum dimension 1024 pixels. Export results and merge by filename with your capture log before importing the audit CSV. Calibrate the sharpness threshold with known good and blurred images from the same camera: texture, lighting and resizing affect the score. More than 5% clipping is a review flag, not automatic rejection. Images are not uploaded.

## Reconstruction feedback

Run a quick reconstruction in your processor and convert its georeferenced QA samples into:

```csv
x_m,y_m,z_m,registered_views,reprojection_error_px
50,50,0,5,0.6
```

Use local coordinates and heights matching the DTM. `registered_views` is the number of registered images observing that point; residuals are pixels. A spatial hash finds samples within the configured 3D support radius. An individual nearby sample must satisfy both view count and residual limits; tracks of unrelated points are not summed. Up to 200000 samples and 20 MB are accepted.

Missing support is a screening flag, particularly with sparse exports; it can reflect texture rather than a surface hole. Low residuals do not establish absolute accuracy. The planner does not run SfM, launch ArcGIS or automatically convert its native outputs. Feedback is cleared on site changes and re-evaluated when the boundary or thresholds change. Independent surveyed checkpoints remain necessary for the 1 cm requirement.

## Verification

Run `node optimizer.test.cjs`, `node network.test.cjs`, and `node capture-planning.test.cjs`. Browser integration checks are `node verify.cjs` and `node verify-capture.cjs`; these currently reference this workspace's bundled Playwright/Chromium paths. Checks cover concave/invalid boundaries, rotated strips, ray occlusion, posed cameras, malformed capture imports, quality screening, reconstruction support and supplemental exports. These are software checks, not a flight or accuracy certification.
