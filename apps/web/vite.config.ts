import {defineConfig} from 'vite';
export default defineConfig({server:{host:'127.0.0.1',port:Number(process.env.WEB_PORT??5173),strictPort:true,proxy:{'/api':process.env.PRECEDENT_API_URL??'http://127.0.0.1:4311'}},build:{outDir:'../../dist/web',emptyOutDir:true}});
