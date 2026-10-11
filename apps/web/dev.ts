// Developer panels (raw IDs, plan inspector, advanced governance) stay out of the presented site.
// They show in the local dev server, or on any page opened with ?dev.
export const devMode=import.meta.env.DEV||new URLSearchParams(window.location.search).has('dev');
