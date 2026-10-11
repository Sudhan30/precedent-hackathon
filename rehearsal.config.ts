import {defineConfig} from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig(base,{
 testDir:'tests/rehearsal',testMatch:'record-demo.ts',timeout:180000,workers:1,
 outputDir:'.data/rehearsal/test-results',
 use:{viewport:{width:1440,height:1000},launchOptions:{args:['--disable-dev-shm-usage'],slowMo:300}},
});
