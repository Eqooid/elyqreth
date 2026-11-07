import {fileURLToPath} from 'node:url';
// Workspace test commands can start Vite from apps/api; dist/ is maintained city source.
// No application environment values are public. Browser configuration uses validated local UI input.
// An empty prefix prevents accidental VITE_* substitution from a shared build environment.
export default {envPrefix:[],root:fileURLToPath(new URL('./dist/',import.meta.url)),server:{host:'0.0.0.0',allowedHosts:['terminal.local']}};
