/* Run the same importable Python module in a dedicated browser worker. */
let runtime;
async function initialize() {
  if (!runtime) {
    runtime = (async () => {
      self.postMessage({type:'status',message:'Loading Python for the first run…'});
      const indexURL='https://cdn.jsdelivr.net/pyodide/v0.29.3/full/';
      importScripts(indexURL+'pyodide.js');
      const python=await loadPyodide({indexURL});
      for (const name of ['drone_optimizer.py','planner_request.py']) {
        const response=await fetch(new URL(name,self.location.href));
        if (!response.ok) throw Error(`Could not load ${name} (${response.status}).`);
        python.FS.writeFile('/home/pyodide/'+name,await response.text());
      }
      return python;
    })().catch(error=>{runtime=undefined;throw error;});
  }
  return runtime;
}
self.onmessage=async ({data}) => {
  try {
    const python=await initialize();
    python.globals.set('request_json',JSON.stringify(data));
    const serialized=await python.runPythonAsync(`
import json
import time
from js import postMessage
from planner_request import plan_request
_last_progress = 0
def report_progress(progress):
    global _last_progress
    now = time.monotonic()
    if now - _last_progress >= 0.2:
        postMessage(json.dumps({'type':'progress', **progress}))
        _last_progress = now
_result = plan_request(json.loads(request_json), on_progress=report_progress)
json.dumps(_result, allow_nan=False)
`);
    python.globals.delete('request_json');
    python.runPython('del _result');
    self.postMessage({type:'result',result:JSON.parse(serialized)});
  } catch (error) {
    self.postMessage({type:'error',message:error.message||String(error)});

  }
};
