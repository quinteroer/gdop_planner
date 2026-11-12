import json
import unittest
from planner_request import plan_request


class RequestTests(unittest.TestCase):
    def setUp(self):
        self.request = dict(state=dict(width=60,height=40,numGcps=4,minSpacing=16,
                            cameraProfile='mini48'),
            limits=dict(minAltitude=35,maxAltitude=35,minClearance=15,maxSpeed=5,
                        minSpeed=.3,maxPhotos=3000,exposure=.001,blurPixels=.5,
                        maxGdop=10,maxGsd=.01,minForward=80,minSide=80,priority='distance'),
            points=[(x,y,0) for y in range(0,41,10) for x in range(0,61,10)],
            ground=0,gcpMode='fixed',searchBudget=25)

    def test_normal_call_budget_and_progress(self):
        progress=[]
        result=plan_request(self.request,on_progress=progress.append)
        self.assertIsNotNone(result['plan'])
        self.assertLessEqual(result['diagnostics']['evaluated_routes'],25)
        self.assertTrue(progress)
        json.dumps(result,allow_nan=False)
        self.assertEqual(len(result['points']),len(self.request['points']))

    def test_count_mode_and_camera_profile(self):
        self.request.update(gcpMode='optimize',minGcps=3,maxGcpDistance=60)
        self.request['state']['numGcps']=6
        self.request['state']['cameraProfile']='mini12'
        self.request['limits']['maxGsd']=.02
        result=plan_request(self.request)
        self.assertIsNotNone(result['plan'])
        self.assertGreaterEqual(result['plan']['photo_interval_s'],2)
        self.assertLessEqual(result['plan']['gcp_count'],6)

    def test_placement_mask_filters_candidates(self):
        self.request['placementGrid']={'gridSize':2,'allowed':[False,False,False,False]}
        self.assertIsNone(plan_request(self.request)['plan'])
        self.request['avoidRaisedCover']=False
        self.assertIsNotNone(plan_request(self.request)['plan'])

    def test_invalid_range(self):
        self.request['limits']['minAltitude']=80
        with self.assertRaisesRegex(ValueError,'Check limit ranges'):
            plan_request(self.request)

    def test_unknown_terrain_is_rejected(self):
        self.request.update(checkTerrain=True,
                            terrainGrid=dict(gridSize=2,elevations=[None]*4))
        self.assertIsNone(plan_request(self.request)['plan'])


if __name__=='__main__':
    unittest.main()
