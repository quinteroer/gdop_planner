"""Map the visualizer's JSON settings onto the callable Python optimizer."""
import math
from drone_optimizer import optimize


def plan_request(payload, on_progress=None):
    state, limits = payload['state'], payload['limits']
    points = payload['points']
    minimum, maximum = limits['minAltitude'], limits['maxAltitude']
    if not 10 <= minimum <= maximum <= 200:
        raise ValueError('Check limit ranges: minimum height must not exceed maximum height (10–200 m).')
    altitudes = list(range(math.ceil(minimum),math.floor(maximum)+1,5))
    altitudes = sorted(set([minimum,maximum]+altitudes))
    mode = payload.get('gcpMode','optimize')
    if mode not in ('fixed','optimize'):
        raise ValueError('Choose fixed or optimized GCP count.')
    counts = state['numGcps'] if mode == 'fixed' else (payload['minGcps'],state['numGcps'])
    max_distance = payload.get('maxGcpDistance')
    if max_distance is None and mode == 'fixed':
        max_distance = math.hypot(state['width'],state['height'])
    camera = {'image_width_px':8064,'interval_s':5.0}
    if state['cameraProfile'] == 'mini12':
        camera.update(image_width_px=4032,interval_s=2.0)
    elif state['cameraProfile'] != 'mini48':
        raise ValueError('Choose a supported camera profile.')
    terrain_at = None
    if payload.get('checkTerrain'):
        grid = payload.get('terrainGrid')
        if grid is None:
            terrain_at = lambda x,y: 0 if 0<=x<=state['width'] and 0<=y<=state['height'] else None
        else:
            n, values = grid['gridSize'],grid['elevations']
            if n<2 or len(values)!=n*n:
                raise ValueError('Invalid terrain grid.')
            def terrain_at(x,y):
                if not (0<=x<=state['width'] and 0<=y<=state['height']):
                    return None
                col = math.floor(x/state['width']*(n-1)+.5)
                row = math.floor(y/state['height']*(n-1)+.5)
                return values[row*n+col]
    return optimize(points,width=state['width'],height=state['height'],
        ground=payload['ground'],altitudes=altitudes,gcp_count=counts,
        max_gcp_distance=max_distance,min_gcp_spacing=state['minSpacing'],
        camera=camera,forward_overlap=limits['minForward']/100,
        side_overlap=limits['minSide']/100,max_gsd=limits['maxGsd'],
        min_clearance=limits['minClearance'],max_speed=limits['maxSpeed'],
        min_speed=limits['minSpeed'],max_photos=limits['maxPhotos'],
        exposure_s=limits['exposure'],blur_pixels=limits['blurPixels'],
        max_gdop=limits['maxGdop'],boundary=state.get('boundary'),
        exclusions=payload.get('exclusions',()),terrain_at=terrain_at,
        turn_radius=payload.get('turnRadius',5),
        max_route_evaluations=payload.get('searchBudget',120),
        objective=limits['priority'],on_progress=on_progress)
