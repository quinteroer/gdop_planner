"""Drone flight and GCP planning using standard-library Python only.

Example function call (synthetic flat site)::

    from drone_optimizer import optimize
    points = [(x, y, 0) for y in range(0, 41, 10)
              for x in range(0, 61, 10)]
    result = optimize(points, width=60, height=40, gcp_count=(3, 8),
                      max_gcp_distance=35, altitudes=(30, 35, 40))
    plan = result['plan']
    if plan is not None:
        route = plan['path']
        gcps = plan['gcps']

Call optimize(points, width=..., height=...). Points are local [x, y, z]
metres with a common vertical datum. Import this file as drone_optimizer.

The GDOP formula and fixed-count ranking implement Sharma et al.,
IGRASS2026.pdf II-A/II-B. Count selection, midpoint routing, 2-opt and
rounded turns are project extensions. Distance and GDOP are planning metrics.
The shortest accepted candidate is reported, without a global-optimum claim.
"""
from collections import Counter
from functools import lru_cache
from itertools import combinations
import heapq
import math


def gdop(point, cameras):
    """sqrt(trace((A.T A)^-1)), using unit camera-to-point directions."""
    matrix = [[0.0] * 3 for _ in range(3)]
    for camera in cameras:
        delta = [point[i] - camera[i] for i in range(3)]
        length = math.sqrt(sum(value * value for value in delta))
        if length <= 1e-12:
            continue
        unit = [value / length for value in delta]
        for i in range(3):
            for j in range(3):
                matrix[i][j] += unit[i] * unit[j]
    a, b, c = matrix[0]
    _, e, f = matrix[1]
    _, _, i = matrix[2]
    determinant = a * (e * i - f * f) - b * (b * i - f * c) + c * (b * f - e * c)
    scale = max(a, e, i, 1.0)
    if determinant <= 1e-12 * scale ** 3:
        return math.inf
    trace = ((e * i - f * f) + (a * i - c * c) + (a * e - b * b)) / determinant
    return math.sqrt(trace) if trace > 0 else math.inf


def _inside(point, polygon):
    if polygon is None:
        return True
    x, y = point[:2]
    hit = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])
        if abs(cross) <= 1e-8 and min(a[0], b[0]) - 1e-8 <= x <= max(a[0], b[0]) + 1e-8 and min(a[1], b[1]) - 1e-8 <= y <= max(a[1], b[1]) + 1e-8:
            return True
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            hit = not hit
    return hit


def _distance(a, b):
    return math.dist(a[:2], b[:2])


def _densify(path, step):
    result = [path[0]]
    for a, b in zip(path, path[1:]):
        count = max(1, math.ceil(_distance(a, b) / step))
        result.extend(tuple(a[j] + (b[j] - a[j]) * k / count for j in range(2)) for k in range(1, count + 1))
    return result


def _round(path, radius, step):
    if radius == 0 or len(path) < 3:
        return _densify(path, step)
    result = [path[0]]
    for a, b, c in zip(path, path[1:], path[2:]):
        before, after = _distance(a, b), _distance(b, c)
        if min(before, after) < 1e-9:
            continue
        trim = min(radius, before / 3, after / 3)
        entry = tuple(b[j] + (a[j] - b[j]) * trim / before for j in range(2))
        exit_point = tuple(b[j] + (c[j] - b[j]) * trim / after for j in range(2))
        result.extend(_densify([result[-1], entry], step)[1:])
        steps = max(8, math.ceil(2 * trim / step))
        for k in range(1, steps + 1):
            t = k / steps
            result.append(tuple((1-t)**2 * entry[j] + 2*(1-t)*t*b[j] + t*t*exit_point[j] for j in range(2)))
    result.extend(_densify([result[-1], path[-1]], step)[1:])
    return result


def _photos(path, spacing):
    """Uniform arc-length capture spacing, with no short final interval."""
    photos = [path[0]]
    remaining = spacing
    for a, b in zip(path, path[1:]):
        length = _distance(a, b)
        while length >= remaining and length > 1e-12:
            fraction = remaining / length
            a = tuple(a[j] + fraction * (b[j] - a[j]) for j in range(2))
            photos.append(a)
            length = _distance(a, b)
            remaining = spacing
        remaining -= length
    return photos


def _analyze(points, cameras, camera, terrain_at, ray_step, requirements=None, occlusion_tolerance=.05):
    width_per_height = camera['sensor_width_mm'] / camera['focal_length_mm']
    height_per_height = camera['sensor_height_mm'] / camera['focal_length_mm']
    radians = math.radians(camera['heading_deg'])
    cosine, sine = math.cos(radians), math.sin(radians)
    # Spatial bins avoid testing every camera against every terrain sample.
    max_height = max((c[2] for c in cameras),default=0)-min(p[2] for p in points)
    half_width = max_height*width_per_height/2
    half_height = max_height*height_per_height/2
    radius_x = abs(cosine)*half_width+abs(sine)*half_height
    radius_y = abs(sine)*half_width+abs(cosine)*half_height
    cell = max(radius_x,radius_y,1.0)
    bins = {}
    for position in cameras:
        if terrain_at is not None:
            surface=terrain_at(position[0],position[1])
            if surface is None or not math.isfinite(surface) or position[2]<=surface+occlusion_tolerance:
                continue
        key = (math.floor(position[0]/cell),math.floor(position[1]/cell))
        bins.setdefault(key,[]).append(position)
    records = []
    for point in points:
        if terrain_at is not None:
            surface=terrain_at(point[0],point[1])
            # A height field models cover as opaque above the ground target.
            # Such a target contributes no camera observation rows to A.
            if surface is None or not math.isfinite(surface) or surface>point[2]+occlusion_tolerance:
                records.append({'gdop':math.inf,'views':0,'view_spread_deg':0.0})
                if requirements is not None:
                    return None
                continue
        nearby = []
        for x in range(math.floor((point[0]-radius_x)/cell),math.floor((point[0]+radius_x)/cell)+1):
            for y in range(math.floor((point[1]-radius_y)/cell),math.floor((point[1]+radius_y)/cell)+1):
                nearby.extend(bins.get((x,y),()))
        visible = []
        for position in nearby:
            height = position[2] - point[2]
            dx, dy = point[0] - position[0], point[1] - position[1]
            across, along = dx*cosine - dy*sine, dx*sine + dy*cosine
            if height <= 0 or abs(across) > height*width_per_height/2 + 1e-8 or abs(along) > height*height_per_height/2 + 1e-8:
                continue
            if terrain_at is not None:
                steps = max(2, math.ceil(_distance(point, position) / ray_step))
                blocked = False
                for k in range(1, steps):
                    t = k / steps
                    z = terrain_at(point[0] + t*(position[0]-point[0]), point[1] + t*(position[1]-point[1]))
                    if z is None or not math.isfinite(z) or z > point[2] + t*height + occlusion_tolerance:
                        blocked = True
                        break
                if blocked:
                    continue
            visible.append(position)
        directions = []
        for position in visible:
            delta = [position[j] - point[j] for j in range(3)]
            norm = math.sqrt(sum(value*value for value in delta))
            directions.append([value/norm for value in delta])
        # A witnessed angle above the limit suffices during search. Recompute
        # the exact maximum spread once for the final accepted flight below.
        min_dot = 1.0
        threshold = math.cos(math.radians(requirements[1])) if requirements else -2.0
        for a,b in combinations(directions,2):
            min_dot = min(min_dot,a[0]*b[0]+a[1]*b[1]+a[2]*b[2])
            if min_dot <= threshold:
                break
        records.append({'gdop': gdop(point, visible), 'views': len(visible),
                        'view_spread_deg': math.degrees(math.acos(max(-1, min(1, min_dot))))})
        if requirements is not None:
            views, spread, limit = requirements
            record = records[-1]
            if record['views']<views or record['view_spread_deg']<spread or record['gdop']>limit:
                return None
    return records


def _select_gcps(points, analysis, count, spacing, exclusions, allowed=None):
    ranked = sorted(range(len(points)), key=lambda i: (analysis[i]['gdop'], i))
    chosen = []
    for i in ranked:
        if (allowed is not None and not allowed[i]) or not math.isfinite(analysis[i]['gdop']):
            continue
        if any(_distance(points[i], (e['x'], e['y'])) < e['radius'] for e in exclusions):
            continue
        if all(_distance(points[i], points[j]) + 1e-9 >= spacing for j in chosen):
            chosen.append(i)
        if len(chosen) == count:
            return chosen
    return []


def _spread_order(count):
    """Visit the middle, quarters, eighths, etc. before adjacent positions."""
    pending=[(0,count-1)]
    order=[]
    for low,high in pending:
        if low>high:
            continue
        middle=(low+high)//2
        order.append(middle)
        pending.extend(((low,middle-1),(middle+1,high)))
    return order


def optimize(points, *, width, height, ground=None, altitudes=(35.0,),
             gcp_count=(3, 12), max_gcp_distance=None, min_gcp_spacing=16.0,
             camera=None, forward_overlap=.8, side_overlap=.8,
             max_gsd=.01, min_clearance=15.0, min_views=4,
             min_view_spread=10.0, max_gdop=10.0, max_photos=3000,
             max_speed=5.0, min_speed=.3, exposure_s=.001, blur_pixels=.5,
             boundary=None, flight_boundary=None, terrain_at=None,
             exclusions=(), start=None, end=None, turn_radius=5.0,
             path_step=2.0, improvement_passes=2, objective="distance",
             max_route_evaluations=None, on_progress=None,
             gcp_allowed=None, surface_at=None, use_sample_bounds=False):
    """Return {'plan': dict or None, 'diagnostics': dict}.

    All coordinates and distances are local metres. Camera defaults model the
    Mini 4 Pro 48 MP ideal footprint (82.1 degree diagonal FOV, 4:3 image,
    8064 pixels wide, 5 second minimum photo interval). Override camera with
    sensor_width_mm, sensor_height_mm, focal_length_mm, image_width_px,
    interval_s and heading_deg. Yaw stays fixed independent of travel direction.

    gcp_count is a fixed integer or inclusive (minimum, maximum) range.
    The default objective is total route distance including supplied start/end.
    Set objective="gcp_count" to prioritize fewest accepted GCPs, then distance.
    max_gcp_distance defaults to survey diagonal / 3. Boundary clips the imaging
    area. flight_boundary is a separate simple polygon that confines aircraft.
    No-fly holes are unsupported. terrain_at(x,y) returns elevation or None for
    unknown terrain. Without it clearance uses the highest supplied elevation.

    gcp_allowed(point) is a hard placement filter. surface_at(x,y) optionally
    checks GCP observation rays against a canopy/building surface model.
    Surface checks allow 0.5 m for DSM/DTM ground-model disagreement.

    Set use_sample_bounds=True to seed routes within the bounding extent of
    supplied terrain samples. Otherwise width and height define the seed extent.
    Refinement is distributed across feasible candidates and across each route.
    Routes compare coverage grids against midpoint-based tours, reorder using
    nearest-neighbour and 2-opt, and remove waypoints only after full revalidation.
    max_route_evaluations optionally bounds refinement work per altitude.
    on_progress accepts a callback receiving evaluated-route and altitude data.
    Rounded quadratic turns are sampled and checked. turn_radius controls corner
    trimming distance, not a certified aircraft minimum turn radius.
    start/end, if supplied, are [x,y] transit endpoints at the survey elevation.
    The result has no launch, landing, battery or wind model.
    """
    if objective not in ('distance', 'gcp_count', 'time', 'height'):
        raise ValueError('objective must be distance, gcp_count, time or height')
    def rank(plan):
        primary = {'distance':plan['distance_m'], 'gcp_count':plan['gcp_count'],
                   'time':plan['time_s'], 'height':plan['altitude_m']}[objective]
        return (primary, plan['distance_m'], plan['gcp_count'])
    points = [tuple(float(v) for v in p) for p in points]
    if not points or any(len(p) != 3 or not all(math.isfinite(v) for v in p) for p in points):
        raise ValueError('points must contain finite [x, y, elevation] triples')
    positive = (width, height, max_gsd, min_clearance, max_speed, min_speed,
                exposure_s, blur_pixels, path_step, max_gdop)
    if any(not math.isfinite(v) or v <= 0 for v in positive) or min_speed > max_speed:
        raise ValueError('Dimensions and limits must be finite and positive')
    if not 0 < forward_overlap < 1 or not 0 < side_overlap < 1:
        raise ValueError('Overlaps must be fractions between 0 and 1')
    if not math.isfinite(min_gcp_spacing) or min_gcp_spacing < 0 or not math.isfinite(turn_radius) or turn_radius < 0:
        raise ValueError('Spacing and corner trimming must be finite and nonnegative')
    if not isinstance(min_views, int) or min_views < 3 or not isinstance(max_photos, int) or max_photos < min_views:
        raise ValueError('Provide valid image count limits')
    if not math.isfinite(min_view_spread) or not 0 <= min_view_spread <= 180:
        raise ValueError('View spread must be between 0 and 180 degrees')
    if max_route_evaluations is not None and (not isinstance(max_route_evaluations,int) or max_route_evaluations<1):
        raise ValueError('max_route_evaluations must be a positive integer or None')
    if not isinstance(improvement_passes, int) or improvement_passes < 0:
        raise ValueError('improvement_passes must be a nonnegative integer')
    def polygon(value):
        if value is None:
            return None
        vertices = [tuple(float(v) for v in p) for p in value]
        if len(vertices) < 3 or any(len(p) != 2 or not all(math.isfinite(v) for v in p) for p in vertices):
            raise ValueError('Provide a simple polygon with finite [x,y] vertices')
        area = sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(vertices,vertices[1:]+vertices[:1]))
        if abs(area) < 1e-8:
            raise ValueError('Polygon must have nonzero area')
        def orient(a, b, c):
            return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
        edges = list(zip(vertices, vertices[1:]+vertices[:1]))
        if any(_distance(a,b)<1e-9 for a,b in edges):
            raise ValueError('Polygon has duplicate adjacent vertices')
        for i,(a,b) in enumerate(edges):
            for j,(c,d) in enumerate(edges[i+1:],i+1):
                if j == i+1 or (i == 0 and j == len(edges)-1):
                    continue
                overlaps = (max(min(a[0],b[0]),min(c[0],d[0])) <= min(max(a[0],b[0]),max(c[0],d[0])) and
                            max(min(a[1],b[1]),min(c[1],d[1])) <= min(max(a[1],b[1]),max(c[1],d[1])))
                if overlaps and orient(a,b,c)*orient(a,b,d)<=0 and orient(c,d,a)*orient(c,d,b)<=0:
                    raise ValueError('Polygon must not intersect itself')
        return vertices
    boundary, flight_boundary = polygon(boundary), polygon(flight_boundary)
    if any(not (0 <= p[0] <= width and 0 <= p[1] <= height) for p in points):
        raise ValueError('Terrain samples must lie within the site dimensions')
    points = [p for p in points if _inside(p, boundary)]
    if not points:
        raise ValueError('No terrain samples inside the imaging boundary')
    survey_bounds=(min(p[0] for p in points),min(p[1] for p in points),
                   max(p[0] for p in points),max(p[1] for p in points)) if use_sample_bounds else (0,0,width,height)
    placement_allowed=[bool(gcp_allowed(p)) if gcp_allowed else True for p in points]
    for endpoint in (start, end):
        if endpoint is not None and (len(endpoint) != 2 or not all(math.isfinite(v) for v in endpoint) or not _inside(endpoint, flight_boundary)):
            raise ValueError('Start and end must be finite [x,y] locations inside the flight boundary')
    for exclusion in exclusions:
        if not all(math.isfinite(exclusion[k]) for k in ('x','y','radius')) or exclusion['radius'] < 0:
            raise ValueError('Invalid GCP exclusion')
    placement_allowed=[allowed and not any(_distance(p,(e['x'],e['y']))<e['radius'] for e in exclusions) for p,allowed in zip(points,placement_allowed)]
    count_range = (gcp_count, gcp_count) if isinstance(gcp_count, int) else tuple(gcp_count)
    if len(count_range) != 2 or any(not isinstance(n, int) or isinstance(n, bool) for n in count_range) or not 1 <= count_range[0] <= count_range[1]:
        raise ValueError('gcp_count must be a positive integer or inclusive range')
    count_min, count_max = count_range
    max_gcp_distance = math.hypot(width, height)/3 if max_gcp_distance is None else max_gcp_distance
    if not math.isfinite(max_gcp_distance) or max_gcp_distance <= 0:
        raise ValueError('max_gcp_distance must be finite and positive')
    altitudes = tuple(altitudes)
    if not altitudes or any(not math.isfinite(v) or v <= 0 for v in altitudes):
        raise ValueError('Supply positive flight altitudes')
    ground = min(p[2] for p in points) if ground is None else ground
    if not math.isfinite(ground):
        raise ValueError('ground must be finite')
    cam = dict(sensor_width_mm=4.0, sensor_height_mm=3.0,
               focal_length_mm=2.5/math.tan(math.radians(82.1/2)),
               image_width_px=8064, interval_s=5.0, heading_deg=0.0)
    cam.update(camera or {})
    if any(not math.isfinite(v) for v in cam.values()) or any(cam[k] <= 0 for k in cam if k != 'heading_deg'):
        raise ValueError('Camera parameters must be finite and positive')
    failures = Counter()
    evaluated = 0
    best = None
    seed_distances = []
    midpoint_trials = 0
    refinement_checks = []

    def segment_valid(a, b):
        # Include all boundary crossing parameters, not just regular samples.
        cuts = [0.0, 1.0]
        if flight_boundary is not None:
            dx, dy = b[0]-a[0], b[1]-a[1]
            for c, d in zip(flight_boundary, flight_boundary[1:]+flight_boundary[:1]):
                ex, ey = d[0]-c[0], d[1]-c[1]
                determinant = dx*ey-dy*ex
                if abs(determinant) > 1e-12:
                    t = ((c[0]-a[0])*ey-(c[1]-a[1])*ex)/determinant
                    u = ((c[0]-a[0])*dy-(c[1]-a[1])*dx)/determinant
                    if 0 <= t <= 1 and 0 <= u <= 1:
                        cuts.append(t)
        cuts.sort()
        return all(_inside((a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1])), flight_boundary)
                   for t in cuts + [(x+y)/2 for x,y in zip(cuts,cuts[1:])])

    @lru_cache(maxsize=10000)
    def connection(a, b):
        if segment_valid(a, b):
            return (a, b)
        vertices = [a, b] + list(flight_boundary or [])
        heap, seen = [(0.0, 0, (0,))], set()
        while heap:
            distance, i, route = heapq.heappop(heap)
            if i in seen:
                continue
            if i == 1:
                return tuple(vertices[j] for j in route)
            seen.add(i)
            for j, point in enumerate(vertices):
                if j not in seen and segment_valid(vertices[i], point):
                    heapq.heappush(heap, (distance+_distance(vertices[i],point),j,route+(j,)))
        return ()

    def travel(a, b):
        path = connection(tuple(a), tuple(b))
        return sum(_distance(x,y) for x,y in zip(path,path[1:])) if path else math.inf

    def order_route(nodes):
        nodes = list(dict.fromkeys(nodes))
        if start is not None:
            nodes = [p for p in nodes if p != tuple(start)]
        if end is not None:
            nodes = [p for p in nodes if p != tuple(end)]
        routes = []
        for first in nodes[:3]:
            remaining = set(nodes)
            ordered = [tuple(start)] if start is not None else [first]
            remaining.discard(ordered[0])
            while remaining:
                point = min(remaining, key=lambda p: (travel(ordered[-1],p),p))
                remaining.remove(point)
                ordered.append(point)
            if end is not None:
                ordered.append(tuple(end))
            # Open-route 2-opt also considers free endpoint changes.
            for _ in range(8):
                changed = False
                for i in range(1 if start is not None else 0,len(ordered)-1):
                    for j in range(i+1,len(ordered)-(1 if end is not None else 0)):
                        old = (travel(ordered[i-1],ordered[i]) if i else 0) + (travel(ordered[j],ordered[j+1]) if j+1<len(ordered) else 0)
                        new = (travel(ordered[i-1],ordered[j]) if i else 0) + (travel(ordered[i],ordered[j+1]) if j+1<len(ordered) else 0)
                        if new < old-1e-8:
                            ordered[i:j+1] = reversed(ordered[i:j+1])
                            changed = True
                if not changed:
                    break
            routes.append(ordered)
        return min(routes,key=lambda r:sum(travel(a,b) for a,b in zip(r,r[1:]))) if routes else []

    for altitude in altitudes:
        if sum(placement_allowed)<count_min:
            failures['insufficient_open_ground']=1
            break
        altitude_evaluations = 0
        candidate_limit = None
        elevation = ground + altitude
        highest, lowest = max(p[2] for p in points), min(p[2] for p in points)
        if elevation-highest < min_clearance:
            failures['clearance'] += 1
            continue
        footprint_width = (elevation-highest)*cam['sensor_width_mm']/cam['focal_length_mm']
        footprint_height = (elevation-highest)*cam['sensor_height_mm']/cam['focal_length_mm']
        worst_gsd = (elevation-lowest)*cam['sensor_width_mm']/cam['focal_length_mm']/cam['image_width_px']
        if worst_gsd > max_gsd:
            failures['gsd'] += 1
            continue
        spacing = min(footprint_width*(1-side_overlap),footprint_height*(1-forward_overlap))
        speed = min(max_speed, spacing/cam['interval_s'],
                    blur_pixels*footprint_width/cam['image_width_px']/exposure_s)
        if speed < min_speed:
            failures['speed'] += 1
            continue

        def evaluate(nodes, radius):
            nonlocal evaluated, altitude_evaluations
            if ((max_route_evaluations is not None and altitude_evaluations >= max_route_evaluations) or
                    (candidate_limit is not None and altitude_evaluations >= candidate_limit)):
                return None
            evaluated += 1
            altitude_evaluations += 1
            if on_progress is not None:
                on_progress({'evaluated_routes':evaluated, 'altitude_m':altitude,
                             'best_distance_m':best['distance_m'] if best else None})
            expanded = [nodes[0]] if nodes else []
            for a,b in zip(nodes,nodes[1:]):
                link = connection(tuple(a),tuple(b))
                if not link:
                    failures['flight_boundary'] += 1
                    return None
                expanded.extend(link[1:])
            if len(expanded) < 2:
                return None
            path = _round(expanded,radius,path_step)
            if any(not segment_valid(a,b) for a,b in zip(path,path[1:])):
                failures['rounded_boundary'] += 1
                return None
            if terrain_at is not None:
                for x,y in path:
                    z = terrain_at(x,y)
                    if z is None or not math.isfinite(z) or elevation-z < min_clearance:
                        failures['terrain_clearance'] += 1
                        return None
            photos = [(x,y,elevation) for x,y in _photos(path,spacing)]
            if len(photos)>max_photos:
                failures['photo_budget'] += 1
                return None
            analysis = _analyze(points,photos,cam,terrain_at,path_step,
                                (min_views,min_view_spread,max_gdop))
            if analysis is None:
                failures['coverage_or_gdop'] += 1
                return None
            gcp_analysis=analysis
            eligible=placement_allowed[:]
            if surface_at is not None:
                gcp_analysis=_analyze(points,photos,cam,surface_at,path_step,occlusion_tolerance=.5)
                eligible=[allowed and r['views']>=min_views and r['view_spread_deg']>=min_view_spread and r['gdop']<=max_gdop
                          for allowed,r in zip(placement_allowed,gcp_analysis)]
            for count in range(count_min,min(count_max,len(points))+1):
                indices = _select_gcps(points,gcp_analysis,count,min_gcp_spacing,exclusions,eligible)
                if not indices:
                    continue
                distances = [min(_distance(p,points[i]) for i in indices) for p in points]
                if max(distances) > max_gcp_distance:
                    continue
                distance = sum(_distance(a,b) for a,b in zip(path,path[1:]))
                return dict(path=[(x,y,elevation) for x,y in path],cams=photos,
                            gcps=[points[i] for i in indices],gcp_indices=indices,
                            gcp_count=count,mean_gdop=sum(gcp_analysis[i]['gdop'] for i in indices)/count,
                            gcp_values=[gcp_analysis[i]['gdop'] for i in indices],
                            gcp_view_counts=[gcp_analysis[i]['views'] for i in indices],
                            placement_allowed=placement_allowed,
                            gdop_heatmap=[r['gdop'] if math.isfinite(r['gdop']) else None for r in gcp_analysis],
                            gdop_view_counts=[r['views'] for r in gcp_analysis],
                            max_gcp_distance=max(distances),analysis=analysis,
                            distance_m=distance,time_s=distance/speed,speed_m_s=speed,
                            altitude_m=altitude,elevation_m=elevation,
                            photo_interval_s=spacing/speed,capture_spacing_m=spacing,
                            gsd_m=worst_gsd,clearance_m=elevation-highest,
                            camera_heading_deg=cam['heading_deg'],
                            rounded_turns=radius>0,waypoints=list(nodes))
            failures['gcp_constraints'] += 1
            return None

        grids = []
        # Conservative world-aligned grids also support fixed rotated camera yaw.
        gap_x = footprint_width*(1-side_overlap)
        gap_y = footprint_height*(1-forward_overlap)
        yaw = math.radians(cam['heading_deg'])
        if abs(math.cos(yaw))<1e-8:
            gap_x,gap_y = gap_y,gap_x
        elif abs(math.sin(yaw))>1e-8:
            gap_x = gap_y = min(gap_x,gap_y)/math.sqrt(2)
        west,south,east,north=survey_bounds
        survey_width,survey_height=east-west,north-south
        nx, ny = max(1,math.ceil(survey_width/gap_x)),max(1,math.ceil(survey_height/gap_y))
        if min(nx,ny)*2>max_photos:
            failures['seed_budget'] += 1
            continue
        for swap in (False,True):
            across,along = (ny,nx) if swap else (nx,ny)
            nodes = []
            for i in range(across+1):
                for j in ((0,along) if i%2==0 else (along,0)):
                    point = (west+j*survey_width/nx,south+i*survey_height/ny) if swap else (west+i*survey_width/nx,south+j*survey_height/ny)
                    if _inside(point,flight_boundary):
                        nodes.append(point)
            if start is not None:
                nodes.insert(0,tuple(start))
            if end is not None:
                nodes.append(tuple(end))
            grids.append(nodes)
        candidates = []
        for nodes in grids:
            seed = evaluate(nodes,0)
            if seed is not None:
                candidates.append((nodes,seed,[]))
                seed_distances.append(seed['distance_m'])
                midpoint_nodes = list(dict.fromkeys(tuple((a[k]+b[k])/2 for k in range(2))
                    for a,b in combinations(seed['gcps'],2)))
                midpoint_nodes = [p for p in midpoint_nodes if _inside(p,flight_boundary)]
                # Try just midpoints first, then supplement with coverage waypoints.
                for targets in (midpoint_nodes,midpoint_nodes+nodes):
                    midpoint_trials += 1
                    tour = order_route(targets)
                    if len(tour)>=2:
                        trial = evaluate(tour,0)
                        if trial is not None:
                            candidates.append((tour,trial,midpoint_nodes))
        candidates.sort(key=lambda candidate:rank(candidate[1]))
        for candidate_index,(nodes,seed,midpoint_nodes) in enumerate(candidates):
            # Reserve work for every feasible alternative instead of letting the
            # first grid consume the entire altitude's refinement budget.
            if max_route_evaluations is not None:
                remaining=max_route_evaluations-altitude_evaluations
                share=max(0,remaining//(len(candidates)-candidate_index))
                candidate_limit=altitude_evaluations+share
            candidate_start=altitude_evaluations
            current = seed
            for radius in dict.fromkeys((turn_radius,0)):
                trial = evaluate(nodes,radius)
                if trial and rank(trial) < rank(current):
                    current = trial
            # Full geometry and coverage revalidation on every accepted deletion.
            for _ in range(improvement_passes):
                improved = False
                free=list(range(1 if start is not None else 0,
                                len(nodes)-(1 if end is not None else 0)))
                spread={free[i]:position for position,i in enumerate(_spread_order(len(free)))}
                def removal_gain(i):
                    before=travel(nodes[i-1],nodes[i]) if i else 0
                    after=travel(nodes[i],nodes[i+1]) if i+1<len(nodes) else 0
                    shortcut=travel(nodes[i-1],nodes[i+1]) if i and i+1<len(nodes) else 0
                    return before+after-shortcut
                targets=[nodes[i] for i in sorted(free,key=lambda i:(-round(removal_gain(i),6),spread[i]))]
                for target in targets:
                    if ((max_route_evaluations is not None and altitude_evaluations>=max_route_evaluations) or
                            (candidate_limit is not None and altitude_evaluations>=candidate_limit)):
                        break
                    i=nodes.index(target)
                    if (i==0 and start is not None) or (i==len(nodes)-1 and end is not None) or len(nodes)<=2:
                        continue
                    reduced=nodes[:i]+nodes[i+1:]
                    trials=[evaluate(reduced,r) for r in dict.fromkeys((turn_radius,0))]
                    valid=[r for r in trials if r is not None]
                    trial=min(valid,key=rank) if valid else None
                    if trial and rank(trial)<rank(current) and trial['distance_m']<current['distance_m']-1e-8:
                        nodes,current,improved=reduced,trial,True
                if not improved:
                    break
            # Try moving a nearby free waypoint onto a midpoint of the GCPs
            # selected for this route. Every move must improve the objective
            # and pass the same final-flight geometry checks.
            current_midpoints = list(dict.fromkeys(tuple((a[k]+b[k])/2 for k in range(2))
                for a,b in combinations(current['gcps'],2)))
            free_indices = range(1 if start is not None else 0,
                                 len(nodes)-(1 if end is not None else 0))
            for midpoint in current_midpoints:
                if not _inside(midpoint,flight_boundary) or not free_indices:
                    continue
                nearest = min(free_indices,key=lambda i:_distance(nodes[i],midpoint))
                moved = nodes[:]
                moved[nearest] = midpoint
                for radius in dict.fromkeys((turn_radius,0)):
                    trial = evaluate(moved,radius)
                    if trial and rank(trial) < rank(current):
                        nodes,current = moved,trial
            midpoint_nodes = list(dict.fromkeys(midpoint_nodes+current_midpoints))
            refinement_checks.append({'altitude_m':altitude,'candidate':candidate_index,
                                      'checks':altitude_evaluations-candidate_start})
            current['midpoints_considered'] = midpoint_nodes
            # Report passage relative to the returned GCP set, since ranking can
            # change after camera locations change during route refinement.
            final_midpoints = list(dict.fromkeys(tuple((a[k]+b[k])/2 for k in range(2))
                for a,b in combinations(current['gcps'],2)))
            current['gcp_pair_midpoints'] = final_midpoints
            current['midpoint_passage'] = [
                {'point':point, 'nearest_path_sample_m':min(_distance(point,p) for p in current['path'])}
                for point in final_midpoints]

            current['midpoints_retained_as_waypoints'] = [p for p in midpoint_nodes if p in current['waypoints']]
            if best is None or rank(current) < rank(best):
                best = current
    if best is not None:
        best['analysis'] = _analyze(points,best['cams'],cam,terrain_at,path_step)
    return {'plan':best,'points':points,'diagnostics':{'evaluated_routes':evaluated,'rejections':dict(failures),
            'optimality':'Shortest accepted candidate found by bounded geometric search',
            'objective':objective,
            'evaluation_budget_per_altitude':max_route_evaluations,
            'shortest_grid_seed_m':min(seed_distances) if seed_distances else None,
            'midpoint_routes_attempted':midpoint_trials,
            'terrain_check':'Sampled height callback' if terrain_at else 'Highest supplied terrain sample',
            'midpoint_rule':'Pairwise GCP midpoints are optional route candidates',
            'eligible_gcp_samples':sum(placement_allowed),
            'survey_bounds_m':survey_bounds,
            'refinement_order':'Largest shortcut first, spatially distributed tie breaks',
            'refinement_checks':refinement_checks,
            'gcp_surface_visibility':surface_at is not None}}
