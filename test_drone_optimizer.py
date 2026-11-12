"""Regression checks for Python geometry, GDOP and normal function calls."""
import math
import unittest
from drone_optimizer import optimize, gdop, _inside, _round, _photos, _distance


class OptimizerTests(unittest.TestCase):
    def setUp(self):
        self.points = [(x,y,0) for y in range(0,41,10) for x in range(0,61,10)]
        self.options = dict(width=60,height=40,gcp_count=4,
                            max_gcp_distance=60,improvement_passes=0)

    def test_gdop_equation(self):
        self.assertAlmostEqual(gdop((0,0,0),[(1,0,0),(0,1,0),(0,0,1)]),math.sqrt(3))
        self.assertEqual(gdop((0,0,0),[(0,0,1),(0,0,2),(0,0,3)]),math.inf)

    def test_rounding_and_photo_spacing(self):
        path = _round([(0,0),(10,0),(10,10)],3,0.2)
        self.assertTrue(any(0 < p[1] < 3 and 7 < p[0] < 10 for p in path))
        self.assertLess(sum(_distance(a,b) for a,b in zip(path,path[1:])),20)
        self.assertEqual(_photos([(0,0),(10,0)],3),[(0,0),(3,0),(6,0),(9,0)])

    def test_callable_route_and_paper_selection(self):
        result = optimize(self.points,**self.options)
        plan = result['plan']
        self.assertIsNotNone(plan)
        self.assertTrue(plan['rounded_turns'])
        self.assertLess(plan['distance_m'],result['diagnostics']['shortest_grid_seed_m'])
        self.assertTrue(all(r['views']>=4 and r['gdop']<=10 and r['view_spread_deg']>=10
                            for r in plan['analysis']))
        self.assertGreaterEqual(plan['photo_interval_s'],5)
        self.assertEqual(plan['gcp_count'],4)
        for a,b in __import__('itertools').combinations(plan['gcps'],2):
            self.assertGreaterEqual(_distance(a,b),16-1e-8)
        # Recompute visible-camera GDOP from the returned photo coordinates.
        focal_length = 2.5 / math.tan(math.radians(82.1/2))
        for point,index in zip(plan['gcps'],plan['gcp_indices']):
            self.assertEqual(point,self.points[index])
            visible = [c for c in plan['cams']
                       if abs(c[0]-point[0]) <= (c[2]-point[2])*4/focal_length/2+1e-8
                       and abs(c[1]-point[1]) <= (c[2]-point[2])*3/focal_length/2+1e-8]
            self.assertAlmostEqual(gdop(point,visible),plan['analysis'][index]['gdop'])

    def test_impossible_constraints(self):
        self.assertIsNone(optimize(self.points,**{**self.options,'min_clearance':100})['plan'])
        self.assertIsNone(optimize(self.points,**{**self.options,'max_gcp_distance':.01})['plan'])
        self.assertIsNone(optimize(self.points,**{**self.options,'terrain_at':lambda x,y:None})['plan'])
        self.assertIsNone(optimize(self.points,**{**self.options,'exclusions':[{'x':30,'y':20,'radius':1000}]})['plan'])

    def test_input_validation(self):
        for updates in ({'forward_overlap':80},{'gcp_count':(6,3)},
                        {'flight_boundary':[(0,0),(1,1),(0,1),(1,0)]},
                        {'altitudes':()}, {'path_step':0}):
            with self.assertRaises(ValueError):
                optimize(self.points,**{**self.options,**updates})

    def test_flight_boundary_and_transit_endpoints(self):
        fence = [(0,0),(60,0),(60,40),(0,40)]
        result = optimize(self.points,**self.options,flight_boundary=fence,start=(0,0),end=(60,40))
        plan = result['plan']
        self.assertIsNotNone(plan)
        self.assertEqual(plan['path'][0][:2],(0,0))
        self.assertEqual(plan['path'][-1][:2],(60,40))
        self.assertTrue(all(_inside(point,fence) for point in plan['path']))

    def test_concave_flight_boundary(self):
        fence = [(0,0),(60,0),(60,15),(25,15),(25,40),(0,40)]
        points = [p for p in self.points if _inside(p,fence)]
        result = optimize(points,**self.options,flight_boundary=fence,
                          start=(60,10),end=(10,40))
        self.assertIsNotNone(result['plan'])
        for a,b in zip(result['plan']['path'],result['plan']['path'][1:]):
            for t in (.25,.5,.75):
                self.assertTrue(_inside((a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])),fence))

    def test_placement_filter_is_hard_constraint(self):
        result=optimize(self.points,**self.options,gcp_allowed=lambda p:p[0]<=20)
        self.assertIsNotNone(result['plan'])
        plan=result['plan']
        self.assertTrue(all(p[0]<=20 for p in plan['gcps']))
        self.assertTrue(all(not plan['placement_allowed'][i] for i,p in enumerate(result['points']) if p[0]>20))
        rejected=optimize(self.points,**self.options,gcp_allowed=lambda p:False)
        self.assertIsNone(rejected['plan'])
        self.assertEqual(rejected['diagnostics']['evaluated_routes'],0)

    def test_canopy_removes_observations_from_gdop_matrix(self):
        from drone_optimizer import _analyze
        camera={'sensor_width_mm':4,'sensor_height_mm':3,'focal_length_mm':3,'heading_deg':0}
        photos=[(-5,-5,35),(5,-5,35),(-5,5,35),(5,5,35)]
        bare=_analyze([(0,0,0)],photos,camera,None,1)[0]
        covered=_analyze([(0,0,0)],photos,camera,lambda x,y:8,1,occlusion_tolerance=.5)[0]
        self.assertTrue(math.isfinite(bare['gdop']))
        self.assertEqual(covered['views'],0)
        self.assertEqual(covered['gdop'],math.inf)

    def test_intervening_cover_removes_camera_rows(self):
        from drone_optimizer import _analyze
        camera={'sensor_width_mm':4,'sensor_height_mm':3,'focal_length_mm':3,'heading_deg':0}
        photos=[(-5,-5,35),(5,-5,35),(-5,5,35),(5,5,35)]
        wall=lambda x,y:30 if 2<x<4 else 0
        observed=_analyze([(0,0,0)],photos,camera,wall,.5,occlusion_tolerance=.5)[0]
        self.assertEqual(observed['views'],2)
        self.assertEqual(observed['gdop'],math.inf)

    def test_surface_visibility_rejects_hidden_targets(self):
        result=optimize(self.points,**self.options,surface_at=lambda x,y:100)
        self.assertIsNone(result['plan'])

    def test_count_search_and_pure_gdop_ranking(self):
        result = optimize(self.points,**{**self.options,'gcp_count':(3,6),'min_gcp_spacing':0})
        plan = result['plan']
        self.assertIsNotNone(plan)
        self.assertEqual(plan['gcp_count'],3)
        ranked = sorted(range(len(self.points)),key=lambda i:(plan['analysis'][i]['gdop'],i))[:3]
        self.assertEqual(plan['gcp_indices'],ranked)


if __name__ == '__main__':
    unittest.main()
