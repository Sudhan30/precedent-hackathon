import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'tests',testMatch:'*.spec.ts',
 // All spec files share one API server and in-memory database; run them serially.
 workers:1,
 use:{baseURL:'http://127.0.0.1:5174',channel:'chromium',launchOptions:{args:['--disable-dev-shm-usage']}},
 webServer:[
  {command:'npm run server',url:'http://127.0.0.1:4312/api/login',env:{ALLOW_FIXTURE_PLANNER:'true',PORT:'4312',PRECEDENT_DB:':memory:',CONNECTOR_DB:':memory:',AUTH_MODE:'demo',MONGODB_URI:'',VOYAGE_API_KEY:'',GROQ_API_KEY:'',RAINDROP_QUERY_API_KEY:'',EVE_WORKER_URL:'',RAINDROP_WRITE_KEY:''},reuseExistingServer:false},
  {command:'npm run web',url:'http://127.0.0.1:5174',env:{WEB_PORT:'5174',PRECEDENT_API_URL:'http://127.0.0.1:4312'},reuseExistingServer:false}
 ]
});
